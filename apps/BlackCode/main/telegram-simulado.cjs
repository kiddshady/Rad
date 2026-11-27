'use strict';
// Un Telegram de mentira: la API de bots, como un `fetch` que no sale a la red.
// Lo usan tools/test-blackcode-telegram.mjs y el humo (con el proveedor de
// mentira, chat.cjs lo pasa en vez del de verdad), así que nada de las pruebas
// le escribe a nadie.
//
// Hace lo que usa main/telegram.cjs: getMe, getUpdates (con la espera larga
// de verdad: contesta apenas llega algo), sendMessage (y rechaza un HTML mal
// armado como Telegram, para probar el plan B en texto plano), editMessageText,
// sendChatAction, answerCallbackQuery, setMyCommands, deleteWebhook, getFile,
// la descarga del archivo, sendPhoto, sendDocument y sendVoice.

const BASE = 'https://telegram.invalid';
// (tiene la forma de un token: no es uno)
const TOKEN = '7000001:AAno-es-una-llave-smoke-telegram-0001';
const BOT = { id: 7000001, is_bot: true, first_name: 'Zac', username: 'zac_smoke_bot' };
const DUENO = { id: 555001, is_bot: false, first_name: 'Fran', last_name: 'Smoke', username: 'fran_smoke' };
const OTRO = { id: 555002, is_bot: false, first_name: 'Stranger', username: 'someone_else' };
const ETIQUETAS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler', 'span']);

/** ¿Lo aceptaría Telegram como HTML? Etiquetas conocidas, bien cerradas, y sin `<` ni `&` sueltos. */
function htmlValido(t) {
  const pila = [];
  const re = /<(\/?)([a-z-]+)([^>]*)>|&(#\d+|#x[0-9a-f]+|[a-z]+);|[<>&]/gi;
  let m;
  while ((m = re.exec(t))) {
    if (m[0].length === 1) return false;
    if (m[4]) { if (!/^(#|lt$|gt$|amp$|quot$)/.test(m[4])) return false; continue; }
    const nombre = m[2].toLowerCase();
    if (!ETIQUETAS.has(nombre)) return false;
    if (m[1]) { if (pila.pop() !== nombre) return false; } else pila.push(nombre);
  }
  return pila.length === 0;
}

function crear() {
  let updates = [];
  let serie = 1;
  let mensajeId = 100;
  let archivoN = 0;
  const archivos = new Map(); // file_id → { datos, ruta }
  const enviados = [];        // { metodo, params, archivo }
  const esperas = new Set();  // los getUpdates abiertos
  const fallas = [];          // { metodo, error_code, description, veces }
  let webhook = false;
  let consultas = 0;          // getUpdates que llegaron

  const resp = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, arrayBuffer: async () => new ArrayBuffer(0) });
  const ok = (result) => resp({ ok: true, result });
  const mal = (error_code, description) => resp({ ok: false, error_code, description }, error_code);
  const despertar = () => { for (const w of [...esperas]) w(); };

  async function leerCuerpo(init) {
    const body = init?.body;
    if (!body) return { params: {}, archivo: null };
    if (typeof body === 'string') return { params: JSON.parse(body), archivo: null };
    // FormData: los campos, y el archivo
    const params = {};
    let archivo = null;
    for (const [k, v] of body.entries()) {
      if (typeof v === 'string') { try { params[k] = /^[[{]/.test(v) ? JSON.parse(v) : v; } catch { params[k] = v; } }
      else archivo = { campo: k, nombre: v.name, tipo: v.type, datos: Buffer.from(await v.arrayBuffer()) };
    }
    return { params, archivo };
  }

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const archivo = /^\/file\/bot([^/]+)\/(.+)$/.exec(u.pathname);
    if (archivo) {
      if (archivo[1] !== TOKEN) return resp({}, 401);
      const x = [...archivos.values()].find((a) => a.ruta === decodeURIComponent(archivo[2]));
      if (!x) return resp({}, 404);
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => x.datos.buffer.slice(x.datos.byteOffset, x.datos.byteOffset + x.datos.length) };
    }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return resp({}, 404);
    if (m[1] !== TOKEN) return mal(401, 'Unauthorized');
    const metodo = m[2];
    const { params, archivo: subido } = await leerCuerpo(init);
    const falla = fallas.find((x) => x.metodo === metodo && x.veces > 0);
    if (falla) { falla.veces--; return mal(falla.error_code, falla.description); }
    switch (metodo) {
      case 'getMe': return ok(BOT);
      case 'setMyCommands': enviados.push({ metodo, params }); return ok(true);
      case 'deleteWebhook': webhook = false; enviados.push({ metodo, params }); return ok(true);
      case 'getUpdates': {
        consultas++;
        if (webhook) return mal(409, 'Conflict: can\'t use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first');
        const desde = Number(params.offset) || 0;
        updates = updates.filter((x) => x.update_id >= desde);
        if (!updates.length && Number(params.timeout) > 0) {
          await new Promise((resolve, reject) => {
            const fin = () => { clearTimeout(t); esperas.delete(fin); init.signal?.removeEventListener('abort', cortar); resolve(); };
            const cortar = () => { clearTimeout(t); esperas.delete(fin); const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e); };
            const t = setTimeout(fin, Number(params.timeout) * 1000);
            esperas.add(fin);
            if (init.signal?.aborted) cortar(); else init.signal?.addEventListener('abort', cortar, { once: true });
          });
        }
        return ok(updates.filter((x) => x.update_id >= desde));
      }
      case 'sendMessage': {
        const text = String(params.text ?? '');
        if (!text) return mal(400, 'Bad Request: message text is empty');
        if (text.length > 4096) return mal(400, 'Bad Request: message is too long');
        if (params.parse_mode === 'HTML' && !htmlValido(text)) return mal(400, 'Bad Request: can\'t parse entities: unsupported start tag');
        const id = ++mensajeId;
        enviados.push({ metodo, params, id });
        return ok({ message_id: id, chat: { id: params.chat_id, type: 'private' }, text });
      }
      case 'editMessageText': enviados.push({ metodo, params }); return ok({ message_id: params.message_id });
      case 'sendChatAction': enviados.push({ metodo, params }); return ok(true);
      case 'answerCallbackQuery': enviados.push({ metodo, params }); return ok(true);
      case 'getFile': {
        const x = archivos.get(params.file_id);
        if (!x) return mal(400, 'Bad Request: invalid file_id');
        return ok({ file_id: params.file_id, file_size: x.datos.length, file_path: x.ruta });
      }
      case 'sendPhoto': case 'sendDocument': case 'sendVoice': {
        if (!subido) return mal(400, 'Bad Request: there is no file in the request');
        const id = ++mensajeId;
        enviados.push({ metodo, params, id, archivo: { campo: subido.campo, nombre: subido.nombre, tipo: subido.tipo, largo: subido.datos.length, cabeza: subido.datos.subarray(0, 4).toString('latin1') } });
        return ok({ message_id: id });
      }
      default: return mal(404, `Not Found: method ${metodo} not found`);
    }
  }

  // ---------- Lo que «manda» alguien ----------
  const ahora = () => Math.floor(Date.now() / 1000);
  function poner(update) { const u = { update_id: serie++, ...update }; updates.push(u); despertar(); return u.update_id; }
  function subirArchivo(datos, ruta) { const id = `f${++archivoN}`; archivos.set(id, { datos: Buffer.from(datos), ruta }); return id; }
  const mensaje = (de, extra) => poner({ message: { message_id: ++mensajeId, from: de, chat: { id: de.id, type: 'private' }, date: ahora(), ...extra } });

  /** Lo que maneja el guion del humo y el test: { que, … } → lo que pasó. */
  async function simular({ que = 'estado', texto = '', de = 'dueno', datos = null, ruta = '', tipo = '', boton = '', mensaje: idMensaje = 0, metodo = '', error_code = 500, description = 'boom', veces = 1, grupo = false } = {}) {
    const quien = de === 'otro' ? OTRO : DUENO;
    if (que === 'mensaje') {
      if (grupo) poner({ message: { message_id: ++mensajeId, from: quien, chat: { id: -100123, type: 'group', title: 'G' }, date: ahora(), text: texto } });
      else mensaje(quien, { text: texto });
    } else if (que === 'foto') {
      const id = subirArchivo(Buffer.from(datos ?? '', 'base64'), ruta || 'photos/file_1.jpg');
      mensaje(quien, { photo: [{ file_id: `${id}s`, width: 90, height: 90 }, { file_id: id, width: 640, height: 640, file_size: 1000 }], ...(texto ? { caption: texto } : {}) });
    } else if (que === 'documento') {
      const buf = Buffer.from(datos ?? '', 'base64');
      const id = subirArchivo(buf, ruta || 'documents/file.txt');
      mensaje(quien, { document: { file_id: id, file_name: ruta.split('/').pop() || 'file.txt', mime_type: tipo || 'text/plain', file_size: buf.length }, ...(texto ? { caption: texto } : {}) });
    } else if (que === 'audio') {
      // (sin datos, una nota de voz de verdad: un segundo de tono, en OGG/Opus, hecha con ffmpeg)
      let buf = Buffer.from(datos ?? '', 'base64');
      if (!buf.length) {
        const pcm = Buffer.alloc(48000);
        for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 4000), i);
        buf = await require('./ffmpeg.cjs').aOpus(pcm, 24000);
      }
      const id = subirArchivo(buf, ruta || 'voice/file_1.oga');
      mensaje(quien, { voice: { file_id: id, duration: 2, mime_type: 'audio/ogg', file_size: buf.length } });
    } else if (que === 'sticker') {
      mensaje(quien, { sticker: { file_id: 'st1', emoji: 'x' } });
    } else if (que === 'boton') {
      poner({ callback_query: { id: `q${serie}`, from: quien, message: { message_id: idMensaje, chat: { id: quien.id, type: 'private' } }, data: boton } });
    } else if (que === 'fallar') {
      fallas.push({ metodo, error_code, description, veces });
    } else if (que === 'webhook') {
      webhook = true;
    } else if (que === 'limpiar') {
      enviados.length = 0;
    }
    return { enviados: enviados.map((x) => ({ ...x })), pendientes: updates.length, consultas, webhook, dueno: DUENO.id, otro: OTRO.id, bot: BOT.username, token: TOKEN };
  }

  return { fetch, base: BASE, simular, enviados, TOKEN, BOT, DUENO, OTRO, htmlValido };
}

module.exports = { crear, TOKEN, htmlValido };
