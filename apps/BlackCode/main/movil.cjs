'use strict';

// El puente al celular: una API HTTP para BlackCode Mobile (S:\tools\BlackCodeMobile),
// que llega por Tailscale. Sale del de NeonCode (mobile-bridge.js) con lo que
// cambia en BlackCode:
//
//   - Los chats y los turnos los lleva la INTERFAZ (renderer/datos.js), no este
//     proceso. Así que acá no se arma ningún turno: cada pedido del celu se le
//     pasa a la interfaz (renderer/movil.js), que contesta con su estado vivo,
//     igual que entra lo que se le dice al Atom Echo. Este archivo es transporte:
//     el servidor, la clave, el ruteo y los eventos.
//   - Los eventos van por UN canal por celu (GET /api/events, Server-Sent Events)
//     y no atados al POST que manda el mensaje. El celu ve también lo que se
//     escribe en la PC, y si se corta la conexión no se pierde nada: al volver
//     pide el chat de nuevo. Desconectarse nunca frena un turno; solo el Stop.
//   - Varios agentes: cada chat dice de quién es, y el celu elige con cuál hablar.
//
// Lo que se mantiene de NeonCode:
//   - las imágenes viajan por referencia (GET /api/image/...), nunca adentro del
//     chat: una captura son cientos de KB de base64;
//   - la clave es la frontera: todo pide `Authorization: Bearer <clave>` salvo
//     GET /api/ping, que existe para que el celu distinga «no llego a la PC» de
//     «llego pero la clave no sirve»;
//   - sin clave la API está CERRADA, y el puente viene apagado de fábrica;
//   - escucha en 0.0.0.0 para que llegue el celu por la malla de Tailscale: va
//     detrás de Tailscale, nunca de un port-forward. No habla TLS.
//
// Lo que guarda: `movil` { activo, puerto } (lo ve la interfaz) y `_movil_llave`
// { blob } con la clave cifrada (safeStorage). La interfaz nunca ve la clave:
// «Copy key» la pone en el portapapeles desde acá.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUERTO = 3830;               // 3810 es de Umbra y 3820 de NeonCode: conviven
const CUERPO_MAX = 24 * 1024 * 1024; // un mensaje con fotos del celu viaja en base64
const ESPERA_MS = 15000;           // lo que se espera a la interfaz
const LATIDO_MS = 15000;
const MINIATURA = 640;
const DOC = 'movil';
const DOC_LLAVE = '_movil_llave';

class Fallo extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * rad: el núcleo (store, handle, send). `electron` y `esperaMs` se pasan en las
 * pruebas (tools/test-blackcode-movil.mjs), que corren con node pelado.
 */
function crear(rad, { electron = require('electron'), esperaMs = ESPERA_MS } = {}) {
  const { app, clipboard, nativeImage, safeStorage } = electron;
  let servidor = null;
  let escuchando = null; // el puerto, cuando está andando
  let error = null;
  const clientes = new Set(); // las respuestas SSE abiertas
  const pendientes = new Map(); // id -> { resolve, reject, timer }
  let serie = 0;

  // ---------- Ajustes y clave ----------
  const ajustes = () => {
    const d = rad.store.read(DOC) ?? {};
    const p = Number(d.puerto);
    return { activo: d.activo === true, puerto: Number.isInteger(p) && p > 1023 && p < 65536 ? p : PUERTO };
  };

  function llave() {
    const doc = rad.store.read(DOC_LLAVE);
    if (!doc?.blob || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(doc.blob, 'base64')); } catch { return null; }
  }

  async function generarLlave() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows cannot encrypt the key right now.');
    // 24 caracteres sin los que se confunden al tipearlos (0/O, 1/l/I): unos 138 bits
    const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let clave = '';
    for (const b of crypto.randomBytes(24)) clave += ALFABETO[b % ALFABETO.length];
    await rad.store.write(DOC_LLAVE, { blob: safeStorage.encryptString(clave).toString('base64'), creada: Date.now() });
    // una clave nueva corta a los celus que entraron con la vieja
    for (const res of clientes) res.end();
    clientes.clear();
    avisarClientes();
  }

  /** Por dónde llega el celu: el nombre de la PC y su IP de Tailscale (100.64.0.0/10), si hay. */
  function direcciones() {
    const ips = [];
    for (const lista of Object.values(os.networkInterfaces())) {
      for (const x of lista ?? []) {
        if (x.family !== 'IPv4' || x.internal) continue;
        const [a, b] = x.address.split('.').map(Number);
        if (a === 100 && b >= 64 && b < 128) ips.push(x.address);
      }
    }
    return { equipo: os.hostname().toLowerCase(), tailscale: ips };
  }

  function estado() {
    const a = ajustes();
    return {
      ...a,
      escuchando: escuchando !== null,
      error,
      conLlave: Boolean(rad.store.read(DOC_LLAVE)?.blob),
      clientes: clientes.size,
      ...direcciones(),
    };
  }
  const avisarEstado = () => rad.send('movil:estado', estado());
  const avisarClientes = () => { rad.send('movil:clientes', clientes.size); avisarEstado(); };

  // ---------- La interfaz ----------
  /** Le pasa un pedido a renderer/movil.js y espera lo que conteste. */
  function preguntar(que, datos = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serie;
      const timer = setTimeout(() => { pendientes.delete(id); reject(new Fallo(503, 'BlackCode did not answer in time.')); }, esperaMs);
      pendientes.set(id, { resolve, reject, timer });
      // (el número del pedido y qué es van al final: un dato que se llame igual no los pisa)
      rad.send('movil:pedido', { ...datos, id, que });
    });
  }
  rad.handle('movil:respuesta', (r) => {
    const p = pendientes.get(r?.id);
    if (!p) return;
    pendientes.delete(r.id);
    clearTimeout(p.timer);
    if (r.ok) p.resolve(r.datos);
    else p.reject(new Fallo(Number(r.status) || 400, String(r.error ?? 'error')));
  });
  // lo que pasa en los chats, para los celus conectados
  rad.handle('movil:evento', (ev) => { if (ev && typeof ev.tipo === 'string') difundir(ev.tipo, ev); });
  rad.handle('movil:clientes', () => clientes.size);

  function difundir(tipo, datos) {
    const linea = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
    for (const res of clientes) { try { res.write(linea); } catch { /* se fue: lo saca el close */ } }
  }

  // ---------- Settings ----------
  rad.handle('movil:estado', () => estado());
  rad.handle('movil:poner', async (cambio) => {
    const a = ajustes();
    const nuevo = { activo: typeof cambio?.activo === 'boolean' ? cambio.activo : a.activo, puerto: a.puerto };
    if (cambio?.puerto !== undefined) {
      const p = Number(cambio.puerto);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('The port goes from 1024 to 65535.');
      nuevo.puerto = p;
    }
    await rad.store.write(DOC, nuevo);
    // la primera vez que se prende, ya con su clave
    if (nuevo.activo && !rad.store.read(DOC_LLAVE)?.blob) await generarLlave();
    aplicar();
    return estado();
  });
  rad.handle('movil:generar', async () => { await generarLlave(); return estado(); });
  rad.handle('movil:copiar', () => {
    const k = llave();
    if (!k) return false;
    clipboard.writeText(k);
    return true;
  });

  // ---------- El servidor ----------
  function aplicar() {
    const a = ajustes();
    if (!a.activo) return parar();
    if (servidor && escuchando === a.puerto) return avisarEstado();
    parar();
    error = null;
    servidor = http.createServer((req, res) => {
      atender(req, res).catch((err) => {
        const status = err instanceof Fallo ? err.status : 500;
        if (!(err instanceof Fallo)) console.error('[movil]', err);
        json(res, status, { error: err.message });
      });
    });
    servidor.on('error', (err) => {
      error = err.code === 'EADDRINUSE' ? `Port ${a.puerto} is already in use.` : err.message;
      servidor = null;
      escuchando = null;
      avisarEstado();
    });
    servidor.listen(a.puerto, '0.0.0.0', () => { escuchando = a.puerto; avisarEstado(); });
  }

  function parar() {
    for (const res of clientes) { try { res.end(); } catch { /* ya cerrada */ } }
    clientes.clear();
    if (servidor) { try { servidor.close(); } catch { /* ya se cerraba */ } }
    servidor = null;
    escuchando = null;
    avisarClientes();
  }

  const RUTAS = [];
  const ruta = (metodo, patron, fn, abierta = false) => {
    const claves = [];
    const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; })}$`);
    RUTAS.push({ metodo, re, claves, fn, abierta });
  };

  ruta('GET', '/api/ping', () => ({ app: 'BlackCode', version: app.getVersion() }), true);
  ruta('GET', '/api/state', () => preguntar('estado'));
  ruta('GET', '/api/chats/:id', ({ p, q }) => preguntar('chat', { chat: p.id, antes: q.get('antes') }));
  ruta('POST', '/api/chats', ({ b }) => preguntar('crear', { agente: String(b.agente ?? '') }));
  ruta('POST', '/api/chats/:id/send', ({ p, b }) => preguntar('enviar', {
    chat: p.id,
    texto: String(b.texto ?? ''),
    imagenes: Array.isArray(b.imagenes) ? b.imagenes.filter((x) => typeof x === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(x)).slice(0, 8) : [],
  }));
  ruta('POST', '/api/chats/:id/stop', ({ p }) => preguntar('frenar', { chat: p.id }));
  ruta('POST', '/api/chats/:id/confirm', ({ p, b }) => preguntar('confirmar', { chat: p.id, permitir: b.permitir === true, confiar: b.confiar === true }));
  // los canvas de un agente (en el celu se leen, no se editan)
  ruta('GET', '/api/canvases', ({ q }) => preguntar('canvases', { agente: String(q.get('agente') ?? '') }));
  ruta('GET', '/api/canvases/:id', ({ p, q }) => preguntar('canvas', { canvas: p.id, agente: String(q.get('agente') ?? '') }));
  // las tareas programadas y su bandeja
  ruta('GET', '/api/tasks', () => preguntar('tareas'));
  ruta('GET', '/api/tasks/results/:id', ({ p }) => preguntar('resultado', { resultado: p.id }));
  ruta('POST', '/api/tasks/:id/active', ({ p, b }) => preguntar('tareaActivar', { tarea: p.id, activa: b.activa === true }));
  ruta('POST', '/api/tasks/:id/run', ({ p }) => preguntar('tareaCorrer', { tarea: p.id }));
  ruta('GET', '/api/image/:chat/:msg/:n', async ({ p, q, res }) => {
    const im = await preguntar('imagen', { chat: p.chat, msg: p.msg, n: Number(p.n) });
    let buf = null;
    if (typeof im?.dataUrl === 'string') {
      const i = im.dataUrl.indexOf(',');
      if (i > 0) buf = Buffer.from(im.dataUrl.slice(i + 1), 'base64');
    } else if (typeof im?.archivo === 'string') {
      // solo lo que dejó generate_image, en la carpeta de la app
      const dir = path.join(path.dirname(rad.store.dir), 'tools');
      const abs = path.resolve(im.archivo);
      if (!abs.startsWith(dir + path.sep)) throw new Fallo(403, 'outside the app folder');
      buf = await fs.promises.readFile(abs).catch(() => null);
    }
    if (!buf) throw new Fallo(404, 'no such image');
    const max = Number(q.get('max')) || MINIATURA;
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) throw new Fallo(415, 'not an image');
    const { width, height } = img.getSize();
    if (max > 0 && Math.max(width, height) > max) img = img.resize(width >= height ? { width: max, quality: 'good' } : { height: max, quality: 'good' });
    const salida = img.toJPEG(85);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': salida.length, 'Cache-Control': 'private, max-age=86400' });
    res.end(salida);
  });
  ruta('GET', '/api/events', ({ res, req }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: hola\ndata: ${JSON.stringify({ version: app.getVersion() })}\n\n`);
    clientes.add(res);
    avisarClientes();
    const latido = setInterval(() => { try { res.write(': latido\n\n'); } catch { /* se fue */ } }, LATIDO_MS);
    req.on('close', () => { clearInterval(latido); clientes.delete(res); avisarClientes(); });
  });

  async function atender(req, res) {
    const u = new URL(req.url ?? '/', 'http://x');
    const camino = u.pathname.replace(/\/+$/, '') || '/';
    const metodo = (req.method ?? 'GET').toUpperCase();
    let r = null;
    let p = {};
    for (const x of RUTAS) {
      if (x.metodo !== metodo) continue;
      const m = x.re.exec(camino);
      if (m) { r = x; x.claves.forEach((k, i) => { p[k] = decodeURIComponent(m[i + 1]); }); break; }
    }
    if (!r) throw new Fallo(404, `no route for ${metodo} ${camino}`);
    if (!r.abierta && !autorizado(req)) {
      throw new Fallo(401, rad.store.read(DOC_LLAVE)?.blob ? 'Wrong key.' : 'The bridge has no key yet: generate one in BlackCode › Settings › Integrations.');
    }
    let b = {};
    if (metodo === 'POST') {
      const crudo = await leer(req);
      if (crudo) { try { b = JSON.parse(crudo); } catch { throw new Fallo(400, 'invalid JSON'); } }
    }
    const salida = await r.fn({ p, q: u.searchParams, b, req, res });
    if (!res.headersSent) json(res, 200, salida ?? { ok: true });
  }

  /** Bearer en tiempo constante. Sin clave, nada pasa. */
  function autorizado(req) {
    const esperada = llave();
    if (!esperada) return false;
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? '').trim());
    if (!m) return false;
    const a = Buffer.from(m[1]);
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function leer(req) {
    return new Promise((resolve, reject) => {
      const partes = [];
      let n = 0;
      req.on('data', (c) => {
        n += c.length;
        if (n > CUERPO_MAX) { reject(new Fallo(413, 'too large')); req.destroy(); return; }
        partes.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
      req.on('error', reject);
    });
  }

  function json(res, status, obj) {
    if (res.headersSent) { try { res.end(); } catch { /* ya */ } return; }
    const cuerpo = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(cuerpo) });
    res.end(cuerpo);
  }

  return { aplicar, parar, estado };
}

module.exports = { crear, PUERTO };
