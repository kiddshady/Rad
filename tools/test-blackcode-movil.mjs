// El puente al celular (apps/BlackCode/main/movil.cjs), con node pelado: electron
// entra de mentira (safeStorage que «cifra» con base64, un portapapeles, un
// nativeImage que no achica de verdad) y la interfaz también, contestando los
// pedidos que el puente le pasa. Se le pega por HTTP de verdad, en un puerto alto.
//
// Lo que se prueba: viene apagado y sin escuchar; al prenderlo nace la clave y
// escucha; /api/ping sin clave y todo lo demás con clave (sin ella, 401); que la
// interfaz nunca reciba la clave; los pedidos que van y vuelven por la interfaz
// con sus errores; que una interfaz que no contesta dé 503; el canal de eventos
// y que una clave nueva lo corte; las imágenes por referencia (data URL y
// archivo), y que un archivo fuera de la carpeta de la app no salga; un JSON
// roto; y apagarlo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const movil = require(process.env.BLACKCODE_MOVIL || path.join(ROOT, 'apps', 'BlackCode', 'main', 'movil.cjs'));

const failures = [];
let hechas = 0;
const ok = (name, cond, extra = '') => { hechas++; if (!cond) failures.push(`${name}${extra ? `  → ${String(extra).slice(0, 600)}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 3000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) if (await cond()) return true; return false; };

// ---------- Los dobles ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-movil-'));
const datos = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'tools', 'images'), { recursive: true });
const docs = new Map();
const handlers = new Map();
const enviados = []; // lo que el principal le manda a la interfaz
let interfaz = null; // (canal, payload) => void: la interfaz de mentira
const rad = {
  store: {
    dir: datos,
    read: (n) => (docs.has(n) ? structuredClone(docs.get(n)) : null),
    write: async (n, v) => { docs.set(n, structuredClone(v)); },
  },
  handle: (canal, fn) => handlers.set(canal, fn),
  send: (canal, payload) => { enviados.push({ canal, payload }); interfaz?.(canal, payload); },
};
let portapapeles = '';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const achicados = [];
const electron = {
  app: { getVersion: () => '9.8.7' },
  clipboard: { writeText: (t) => { portapapeles = t; } },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`cifrado:${s}`),
    decryptString: (b) => b.toString().replace(/^cifrado:/, ''),
  },
  nativeImage: {
    createFromBuffer: (buf) => {
      const vacia = !buf.length || buf[0] !== 0x89;
      const img = (w, h) => ({
        isEmpty: () => vacia,
        getSize: () => ({ width: w, height: h }),
        // (como el de Electron: con un solo lado, el otro sigue la proporción)
        resize: (o) => { achicados.push(o); return o.width ? img(o.width, Math.round((h * o.width) / w)) : img(Math.round((w * o.height) / h), o.height); },
        toJPEG: () => Buffer.from(`jpeg:${w}x${h}`),
      });
      return img(3000, 1500);
    },
  },
};
const invocar = (canal, ...args) => handlers.get(canal)(...args);

const PUERTO = 38000 + Math.floor(Math.random() * 1500);
const m = movil.crear(rad, { electron, esperaMs: 400 });

function pedir(metodo, ruta, { clave = null, cuerpo = null, crudo = null } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PUERTO, method: metodo, path: ruta, headers: { ...(clave ? { Authorization: `Bearer ${clave}` } : {}), 'Content-Type': 'application/json' } }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString();
        let json = null;
        try { json = JSON.parse(texto); } catch { /* no era JSON */ }
        resolve({ status: res.statusCode, tipo: res.headers['content-type'] ?? '', texto, json });
      });
    });
    req.on('error', (err) => resolve({ status: 0, texto: err.message, json: null }));
    if (crudo !== null) req.write(crudo);
    else if (cuerpo !== null) req.write(JSON.stringify(cuerpo));
    req.end();
  });
}

// ---------- Apagado de fábrica ----------
m.aplicar();
ok('de fábrica viene apagado', invocar('movil:estado').activo === false && invocar('movil:estado').escuchando === false);
ok('apagado no escucha', (await pedir('GET', '/api/ping')).status === 0);
ok('de fábrica no hay clave', invocar('movil:estado').conLlave === false && invocar('movil:copiar') === false);

// ---------- Prenderlo ----------
let estado = await invocar('movil:poner', { activo: true, puerto: PUERTO });
ok('al prenderlo nace su clave', estado.conLlave === true && Boolean(docs.get('_movil_llave')?.blob));
ok('la clave se guarda cifrada', !JSON.stringify(docs.get('_movil_llave')).includes(portapapeles || '§') && docs.get('_movil_llave').blob !== '');
ok('escucha en el puerto elegido', await until(() => invocar('movil:estado').escuchando), JSON.stringify(invocar('movil:estado')));
ok('el ajuste guarda prendido y puerto', docs.get('movil')?.activo === true && docs.get('movil')?.puerto === PUERTO);
let falloPuerto = null;
try { await invocar('movil:poner', { puerto: 80 }); } catch (err) { falloPuerto = err.message; }
ok('un puerto reservado se rechaza', /1024/.test(falloPuerto ?? ''), falloPuerto);
ok('la interfaz se entera del estado', enviados.some((e) => e.canal === 'movil:estado' && e.payload.escuchando));
ok('el estado nunca lleva la clave', !enviados.some((e) => JSON.stringify(e.payload).includes(electron.safeStorage.decryptString(Buffer.from(docs.get('_movil_llave').blob, 'base64')))));

const ping = await pedir('GET', '/api/ping');
ok('/api/ping contesta sin clave', ping.status === 200 && ping.json?.app === 'BlackCode' && ping.json?.version === '9.8.7', ping.texto);
ok('sin clave lo demás da 401', (await pedir('GET', '/api/state')).status === 401);
ok('con una clave equivocada da 401', (await pedir('GET', '/api/state', { clave: 'x'.repeat(24) })).status === 401);
ok('una ruta que no existe da 404', (await pedir('GET', '/api/nada', { clave: 'x' })).status === 404);

ok('«Copy key» la pone en el portapapeles', invocar('movil:copiar') === true && /^[A-Za-z2-9]{24}$/.test(portapapeles), portapapeles);
const clave = portapapeles;
ok('la clave no tiene caracteres que se confunden', !/[01lIO]/.test(clave), clave);

// ---------- Los pedidos pasan por la interfaz ----------
const pedidos = [];
interfaz = (canal, p) => {
  if (canal !== 'movil:pedido') return;
  pedidos.push(p);
  const responder = (r) => setTimeout(() => invocar('movil:respuesta', { id: p.id, ...r }), 5);
  if (p.que === 'estado') responder({ ok: true, datos: { agentes: [{ id: 'z', nombre: 'Zac' }], chats: [] } });
  else if (p.que === 'chat') responder(p.chat === 'c1' ? { ok: true, datos: { chat: { id: 'c1' }, mensajes: [], antes: p.antes } } : { ok: false, status: 404, error: 'That chat does not exist anymore.' });
  else if (p.que === 'crear') responder({ ok: true, datos: { id: 'nuevo' } });
  else if (p.que === 'enviar') responder({ ok: true, datos: { ok: true } });
  else if (p.que === 'canvases') responder({ ok: true, datos: [{ id: 'cv1', agente: p.agente }] });
  else if (p.que === 'canvas') responder(p.canvas === 'cv1' ? { ok: true, datos: { id: 'cv1', contenido: '# hola' } } : { ok: false, status: 404, error: 'That canvas does not exist anymore.' });
  else if (p.que === 'tareas') responder({ ok: true, datos: { tareas: [], resultados: [], sinLeer: 2 } });
  else if (p.que === 'resultado') responder({ ok: true, datos: { id: p.resultado } });
  else if (p.que === 'tareaActivar') responder({ ok: true, datos: { ok: true, tarea: p.tarea, activa: p.activa } });
  else if (p.que === 'tareaCorrer') responder({ ok: true, datos: { ok: true, tarea: p.tarea } });
  else if (p.que === 'imagen') {
    if (p.msg === 'data') responder({ ok: true, datos: { dataUrl: `data:image/png;base64,${PNG_1x1}` } });
    else if (p.msg === 'archivo') responder({ ok: true, datos: { archivo: path.join(tmp, 'tools', 'images', 'a.png') } });
    else if (p.msg === 'afuera') responder({ ok: true, datos: { archivo: path.join(tmp, 'secreto.png') } });
    else responder({ ok: false, status: 404, error: 'no such image' });
  }
  // 'frenar' no contesta: es la interfaz colgada
};
const st = await pedir('GET', '/api/state', { clave });
ok('/api/state con clave sale de la interfaz', st.status === 200 && st.json?.agentes?.[0]?.nombre === 'Zac', st.texto);
ok('a la interfaz no le llega la clave', !pedidos.some((p) => JSON.stringify(p).includes(clave)) && !enviados.some((e) => JSON.stringify(e.payload).includes(clave)));
const ch = await pedir('GET', '/api/chats/c1?antes=40', { clave });
ok('un chat, con su página', ch.status === 200 && ch.json?.chat?.id === 'c1' && pedidos.at(-1).antes === '40', ch.texto);
const no = await pedir('GET', '/api/chats/otro', { clave });
ok('el error de la interfaz llega con su código', no.status === 404 && no.json?.error === 'That chat does not exist anymore.', no.texto);
const nuevo = await pedir('POST', '/api/chats', { clave, cuerpo: { agente: 'z' } });
ok('crear un chat', nuevo.status === 200 && nuevo.json?.id === 'nuevo' && pedidos.at(-1).agente === 'z');
await pedir('POST', '/api/chats/c1/send', { clave, cuerpo: { texto: 'hola', imagenes: [`data:image/png;base64,${PNG_1x1}`, 'data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', 42] } });
const env = pedidos.at(-1);
ok('mandar pasa el texto y solo las imágenes de verdad', env.que === 'enviar' && env.chat === 'c1' && env.texto === 'hola' && env.imagenes.length === 1 && env.imagenes[0].startsWith('data:image/png'), JSON.stringify(env).slice(0, 200));
ok('un JSON roto da 400', (await pedir('POST', '/api/chats', { clave, crudo: '{roto' })).status === 400);
const colgada = await pedir('POST', '/api/chats/c1/stop', { clave });
ok('si la interfaz no contesta, 503 (y no se cuelga)', colgada.status === 503, colgada.texto);

// ---------- Canvases y tareas ----------
const cvs = await pedir('GET', '/api/canvases?agente=z', { clave });
ok('los canvas de un agente', cvs.status === 200 && cvs.json?.[0]?.agente === 'z' && pedidos.at(-1).que === 'canvases', cvs.texto);
const cv = await pedir('GET', '/api/canvases/cv1?agente=z', { clave });
// (el bug de la 1.12.0 en desarrollo: el id del canvas viajaba como `id` y pisaba el número del pedido, que se quedaba sin respuesta)
ok('un canvas: su id no pisa el número del pedido', cv.status === 200 && cv.json?.contenido === '# hola' && pedidos.at(-1).canvas === 'cv1' && typeof pedidos.at(-1).id === 'number', cv.texto);
ok('un canvas que no existe da 404', (await pedir('GET', '/api/canvases/nada?agente=z', { clave })).status === 404);
const tt = await pedir('GET', '/api/tasks', { clave });
ok('las tareas y su bandeja', tt.status === 200 && tt.json?.sinLeer === 2);
const res = await pedir('GET', '/api/tasks/results/r9', { clave });
ok('un resultado, por su id', res.status === 200 && res.json?.id === 'r9' && typeof pedidos.at(-1).id === 'number', res.texto);
const act = await pedir('POST', '/api/tasks/t7/active', { clave, cuerpo: { activa: false } });
ok('pausar una tarea', act.status === 200 && act.json?.tarea === 't7' && act.json?.activa === false, act.texto);
const cor = await pedir('POST', '/api/tasks/t7/run', { clave });
ok('correr una tarea ahora', cor.status === 200 && cor.json?.tarea === 't7', cor.texto);

// ---------- Imágenes ----------
const img = await pedir('GET', '/api/image/c1/data/0?max=480', { clave });
ok('una imagen del chat sale achicada en JPEG', img.status === 200 && img.tipo === 'image/jpeg' && img.texto === 'jpeg:480x240' && achicados.at(-1)?.width === 480, `${img.status} ${img.tipo} ${img.texto}`);
fs.writeFileSync(path.join(tmp, 'tools', 'images', 'a.png'), Buffer.from(PNG_1x1, 'base64'));
const arch = await pedir('GET', '/api/image/c1/archivo/0', { clave });
ok('una generada sale de su archivo', arch.status === 200 && arch.texto.startsWith('jpeg:'), arch.texto);
fs.writeFileSync(path.join(tmp, 'secreto.png'), Buffer.from(PNG_1x1, 'base64'));
ok('un archivo fuera de la carpeta de la app no sale', (await pedir('GET', '/api/image/c1/afuera/0', { clave })).status === 403);
ok('una imagen que no existe da 404', (await pedir('GET', '/api/image/c1/ninguna/0', { clave })).status === 404);

// ---------- El canal de eventos ----------
const recibido = [];
let cerrado = false;
await new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: PUERTO, path: '/api/events', headers: { Authorization: `Bearer ${clave}` } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => recibido.push(c));
    res.on('end', () => { cerrado = true; });
    res.on('close', () => { cerrado = true; });
    resolve();
  });
});
ok('el canal saluda', await until(() => recibido.join('').includes('event: hola')));
ok('la interfaz sabe que hay un celu', await until(() => enviados.some((e) => e.canal === 'movil:clientes' && e.payload === 1)) && invocar('movil:clientes') === 1);
invocar('movil:evento', { tipo: 'texto', chat: 'c1', id: 'm', desde: 0, texto: 'hola' });
ok('lo que pasa en los chats llega al celu', await until(() => recibido.join('').includes('event: texto\ndata: {"tipo":"texto","chat":"c1","id":"m","desde":0,"texto":"hola"}')));
estado = await invocar('movil:generar');
ok('una clave nueva corta a los celus conectados', await until(() => cerrado) && invocar('movil:clientes') === 0);
ok('la clave vieja ya no sirve', (await pedir('GET', '/api/state', { clave })).status === 401);
invocar('movil:copiar');
ok('la nueva sí', portapapeles !== clave && (await pedir('GET', '/api/state', { clave: portapapeles })).status === 200);

// ---------- Apagarlo ----------
estado = await invocar('movil:poner', { activo: false });
ok('al apagarlo deja de escuchar', estado.escuchando === false && (await pedir('GET', '/api/ping')).status === 0);
ok('apagarlo no borra la clave', estado.conLlave === true);

// ---------- El cableado ----------
const main = fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'main.cjs'), 'utf8');
ok('main.cjs crea el puente y lo aplica al arrancar', main.includes("require('./main/movil.cjs').crear(rad)") && main.includes('movil.aplicar();'));
const app = fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'renderer', 'blackcode.js'), 'utf8');
ok('la interfaz monta su mitad', app.includes("import { montarMovil } from './movil.js';") && /\nmontarMovil\(\);/.test(app));
const aj = fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'renderer', 'ajustes.js'), 'utf8');
ok('la tarjeta Phone está en Integrations', aj.includes('integrations: [tarjetaMcp(), tarjetaMovil()]'));

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.log(`test-blackcode-movil: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-movil: ok (${hechas} comprobaciones: apagado de fábrica, la clave al prender y cifrada, ping abierto y lo demás con clave, la clave nunca en la interfaz, los pedidos por la interfaz y sus errores, una interfaz colgada, canvases y tareas (y que un dato llamado id no pise el pedido), las imágenes y la carpeta de la app, el canal de eventos y la clave nueva, apagarlo, y el cableado)`);
process.exit(0);
