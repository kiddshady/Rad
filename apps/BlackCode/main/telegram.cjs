'use strict';
// El puente a Telegram: hablarle a un agente desde Telegram, con un bot propio.
//
// Lo pidió Fran el 27/11/2026, para hablar con Zac desde el celu. Eligió:
//   - Solo él: el bot le contesta a UNA cuenta de Telegram (la que vinculó
//     desde Settings). A cualquier otra no le contesta nada, y lo que escribe
//     ni siquiera llega a la interfaz. Hasta vincular, el bot solo dice cómo.
//   - Un chat que sigue: todo va al mismo chat del agente (en Channels) hasta
//     que manda /new, que arranca otro.
//   - Los permisos, con botones: lo que pide permiso llega como un mensaje con
//     Allow / Always in this chat / Deny. «Let Telegram act» (apagado de
//     fábrica) lo deja actuar sin preguntar, como «Let voice act».
//   - Fotos, archivos de texto y audios: un audio se pasa a texto con el
//     mismo Whisper del Atom Echo, y se contesta con una nota de voz (la voz
//     elegida en Settings › Voice).
//
// Cómo llega: BlackCode le pregunta a Telegram por los mensajes nuevos
// (getUpdates, «long polling»), desde esta PC. No hay servidor ni puerto
// abierto, y por eso contesta solo mientras BlackCode está abierta (en la
// bandeja alcanza).
//
// El reparto es el de la voz y el celu: este proceso es transporte (Telegram,
// la llave, la lista blanca, los archivos y el audio); el turno lo lleva la
// interfaz (renderer/telegram.js), que recibe cada mensaje como si se
// hubiera tipeado y devuelve la respuesta para mandarla.
//
// Lo que guarda: `_telegram`, un documento reservado (la interfaz no lo lee):
// { activo, token (cifrado), bot, agente, dueno, actua, conVoz, offset }. El
// token del bot entra una vez desde Settings y no vuelve a salir.
//
// `crear` es el cliente de Telegram, sin Electron (tools/test-blackcode-
// telegram.mjs lo prueba con node pelado contra main/telegram-simulado.cjs).
// `wire` lo une con la app.

const path = require('node:path');
const formato = require('./telegram-formato.cjs');

const API = 'https://api.telegram.org';
const DOC = '_telegram';
const SONDEO_S = 50;           // lo que Telegram espera con la pregunta abierta
const PLAZO_MS = 30000;        // una llamada común
const DESCARGA_MAX = 20 * 1024 * 1024; // lo que deja bajar la API de bots
const ESCRIBIENDO_MS = 4500;   // «escribiendo…» dura unos 5 s: se repite
const ESCRIBIENDO_TOPE_MS = 15 * 60000;
const AVISO_CANDIDATO_MS = 60000;
// Los comandos que aparecen en el menú del bot.
const COMANDOS = [
  { command: 'new', description: 'Start a new chat' },
  { command: 'stop', description: 'Stop the answer in progress' },
  { command: 'help', description: 'What this bot does' },
];
// Lo que se le dice al agente en un turno que vino de Telegram.
// (1.21.1: Zac escribía la negrita como en Telegram, `*así*`, y en markdown
// común un asterisco solo es cursiva: le salía todo en cursiva. La nota le
// dice que escriba markdown común, que la conversión la hace BlackCode.)
const TELEGRAM_NOTE = '[Telegram] The user is writing to you from Telegram on their phone, away from this PC’s screen. Keep replies compact. Write ordinary Markdown, exactly as you would in this app: BlackCode converts it for Telegram. So bold is **double asterisks** and italic is *single asterisks* or _underscores_; do not use Telegram’s own *single-asterisk* bold. Telegram shows bold, italic, code, code blocks and links; headings come out as bold lines and tables as plain fixed-width text, so prefer short lists. The images you make with generate_image and the images (charts, molecules, plots) that run_code saves are sent to them as photos; other files you make stay on this PC, so say where you left them.';
const TELEGRAM_VOICE_NOTE = '[Telegram voice] The user sent this as a voice message on Telegram (transcribed by Whisper, so it may have small mistakes), and your final reply will be sent back to them as a voice message read by a text-to-speech voice. Answer in the language the user spoke, in one to three short plain sentences, the way you would say it out loud: no markdown, no lists, no code, no URLs, no emoji. If you ran tools, say only what matters about the result.';
const AYUDA = 'You are talking to <b>%AGENTE%</b> in BlackCode, on your PC.\n\nWrite, or send a photo, a text file or a voice message. Everything goes to the same chat until you send /new.\n\n/new starts a new chat\n/stop stops the answer in progress';

class Fallo extends Error {
  constructor(codigo, message) { super(message); this.codigo = codigo; }
}

const esToken = (t) => typeof t === 'string' && /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(t.trim());

/**
 * El cliente de Telegram.
 * @param {object} o
 * @param {Function} o.config      () → { activo, token, dueno: { id } | null, offset }
 * @param {Function} o.alMensaje   (m) un mensaje del dueño: { chat, id, texto, comando, foto, documento, audio, otro }
 * @param {Function} o.alBoton     ({ id, chat, mensaje, datos }) → texto del aviso, o '' (un botón que tocó el dueño)
 * @param {Function} o.alCandidato ({ id, nombre, usuario, chat }) alguien le escribió al bot antes de vincular
 * @param {Function} o.guardarOffset (n) hasta dónde se leyó
 * @param {Function} o.alCambiar   (estado) cambió la conexión
 */
function crear({ fetch: f = globalThis.fetch, base = API, config, alMensaje = () => {}, alBoton = () => '', alCandidato = () => {}, guardarOffset = () => {}, alCambiar = () => {}, sondeoS = SONDEO_S, reintentoMs = [2000, 30000], dormir = null } = {}) {
  const e = { conexion: 'off', error: '', bot: null };
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar({ ...e }); } catch { /* idem */ } };
  let vuelta = 0;
  let ctrl = null;
  const avisados = new Map(); // candidato → cuándo se le dijo cómo vincular
  // (una espera entre reintentos; parar() la corta)
  let despertar = null;
  const esperar = dormir ?? ((ms) => new Promise((r) => {
    const fin = () => { clearTimeout(t); despertar = null; r(); };
    const t = setTimeout(fin, ms);
    despertar = fin;
  }));
  // (el token nunca aparece en un error: va en la dirección)
  const sinToken = (texto, token) => (token ? String(texto).split(token).join('<token>') : String(texto));

  async function llamar(metodo, params = {}, { token = config().token, signal = null, plazoMs = PLAZO_MS, form = null } = {}) {
    if (!token) throw new Fallo(0, 'There is no bot token.');
    const plazo = AbortSignal.timeout(plazoMs);
    const senal = signal ? AbortSignal.any([signal, plazo]) : plazo;
    let r;
    try {
      r = await f(`${base}/bot${token}/${metodo}`, form
        ? { method: 'POST', body: form, signal: senal }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: senal });
    } catch (err) {
      if (signal?.aborted) throw new Fallo(-1, 'stopped');
      throw new Fallo(0, plazo.aborted ? 'Telegram did not answer in time.' : `No connection to Telegram (${sinToken(err?.cause?.code ?? err?.message ?? err, token)}).`);
    }
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch { /* no era JSON */ }
    if (!cuerpo?.ok) throw new Fallo(cuerpo?.error_code ?? r.status, sinToken(cuerpo?.description ?? `Telegram answered ${r.status}.`, token));
    return cuerpo.result;
  }

  /** Un archivo: el método, los campos y { campo, nombre, tipo, datos }. */
  function subir(metodo, campos, archivo) {
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(archivo.campo, new Blob([archivo.datos], { type: archivo.tipo }), archivo.nombre);
    return llamar(metodo, {}, { form, plazoMs: 120000 });
  }

  /** ¿Sirve este token? → { id, usuario, nombre } o tira con la frase para el usuario. */
  async function comprobar(token) {
    try {
      const yo = await llamar('getMe', {}, { token });
      return { id: yo.id, usuario: yo.username ?? '', nombre: yo.first_name ?? '' };
    } catch (err) {
      if (err.codigo === 401 || err.codigo === 404) throw new Error('Telegram rejected that token. Copy it again from @BotFather.');
      throw new Error(err.message);
    }
  }

  // ---------- Lo que llega ----------
  async function atender(u) {
    const c = config();
    const dueno = c.dueno?.id ?? null;
    if (u.callback_query) {
      const q = u.callback_query;
      let aviso = '';
      if (dueno !== null && q.from?.id === dueno) {
        try { aviso = String((await alBoton({ id: q.id, chat: q.message?.chat?.id ?? null, mensaje: q.message?.message_id ?? null, datos: String(q.data ?? '') })) ?? ''); } catch { /* idem */ }
      }
      await llamar('answerCallbackQuery', { callback_query_id: q.id, ...(aviso ? { text: aviso.slice(0, 190) } : {}) }).catch(() => {});
      return;
    }
    const m = u.message;
    // solo charlas de a dos: un bot metido en un grupo no lee nada
    if (!m || m.chat?.type !== 'private' || !m.from || m.from.is_bot) return;
    const quien = { id: m.from.id, nombre: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ').slice(0, 80), usuario: String(m.from.username ?? '').slice(0, 40), chat: m.chat.id };
    if (dueno === null) {
      try { alCandidato(quien); } catch { /* idem */ }
      // (se le dice cómo, una vez por minuto: si insiste, no se le contesta cada vez)
      const antes = avisados.get(quien.id) ?? 0;
      if (Date.now() - antes > AVISO_CANDIDATO_MS) {
        avisados.set(quien.id, Date.now());
        await llamar('sendMessage', { chat_id: m.chat.id, text: 'To link this chat, open BlackCode on your PC, go to Settings › Integrations › Telegram and press “This is me”.' }).catch(() => {});
      }
      return;
    }
    // a un desconocido no se le contesta nada
    if (m.from.id !== dueno) return;
    const texto = String(m.text ?? m.caption ?? '');
    const comando = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(m.text ?? '')?.[1]?.toLowerCase() ?? null;
    const foto = Array.isArray(m.photo) && m.photo.length ? m.photo[m.photo.length - 1] : null;
    const sonido = m.voice ?? m.audio ?? null;
    const otro = !foto && !sonido && !m.document && !m.text ? (['sticker', 'video', 'video_note', 'animation', 'location', 'contact', 'poll', 'venue', 'dice'].find((k) => m[k]) ?? 'otro') : null;
    alMensaje({
      chat: m.chat.id,
      id: m.message_id,
      texto,
      comando,
      foto: foto ? { id: foto.file_id, peso: foto.file_size ?? 0 } : null,
      documento: m.document ? { id: m.document.file_id, nombre: String(m.document.file_name ?? 'file'), tipo: String(m.document.mime_type ?? ''), peso: m.document.file_size ?? 0 } : null,
      audio: sonido ? { id: sonido.file_id, dur: sonido.duration ?? 0, tipo: String(sonido.mime_type ?? ''), peso: sonido.file_size ?? 0, nota: Boolean(m.voice) } : null,
      otro,
    });
  }

  async function bucle(gen, signal) {
    let espera = reintentoMs[0];
    let offset = Number(config().offset) || 0;
    let saludo = false;
    while (gen === vuelta) {
      const c = config();
      if (!c.activo || !c.token) break;
      try {
        if (!saludo) {
          const yo = await llamar('getMe', {}, { signal });
          // el menú de comandos del bot (si falla, el bot anda igual)
          llamar('setMyCommands', { commands: COMANDOS }).catch(() => {});
          saludo = true;
          poner({ bot: { id: yo.id, usuario: yo.username ?? '', nombre: yo.first_name ?? '' } });
        }
        const lista = await llamar('getUpdates', { offset, timeout: sondeoS, allowed_updates: ['message', 'callback_query'] }, { signal, plazoMs: (sondeoS + 20) * 1000 });
        if (gen !== vuelta) break;
        if (e.conexion !== 'connected' || e.error) poner({ conexion: 'connected', error: '' });
        espera = reintentoMs[0];
        for (const u of Array.isArray(lista) ? lista : []) {
          offset = Math.max(offset, Number(u.update_id) + 1);
          try { await atender(u); } catch (err) { console.warn('[telegram] un mensaje no se pudo atender:', err?.message ?? err); }
        }
        if (Array.isArray(lista) && lista.length) { try { guardarOffset(offset); } catch { /* idem */ } }
      } catch (err) {
        if (gen !== vuelta || err.codigo === -1) break;
        if (err.codigo === 401 || err.codigo === 404) { poner({ conexion: 'error', error: 'Telegram rejected the bot token. Paste it again.' }); break; }
        if (err.codigo === 409) {
          // un webhook puesto antes en este bot no deja leer: se saca (lo puso otro programa; con BlackCode no se usa)
          if (/webhook/i.test(err.message)) { await llamar('deleteWebhook', {}).catch(() => {}); poner({ conexion: 'connecting', error: '' }); continue; }
          poner({ conexion: 'error', error: 'Another program is reading this bot’s messages. Close it, or use another bot.' });
          await esperar(Math.max(espera, 15000), gen);
          continue;
        }
        poner({ conexion: 'connecting', error: err.message });
        await esperar(espera, gen);
        espera = Math.min(espera * 2, reintentoMs[1]);
      }
    }
  }

  /** (Re)arranca según la config: prendido y con token, lee; si no, para. */
  function arrancar() {
    parar({ silencio: true });
    const c = config();
    if (!c.activo || !c.token) { poner({ conexion: 'off', error: '' }); return; }
    const gen = ++vuelta;
    ctrl = new AbortController();
    poner({ conexion: 'connecting', error: '' });
    bucle(gen, ctrl.signal).catch((err) => console.warn('[telegram]', err?.message ?? err));
  }

  function parar({ silencio = false } = {}) {
    vuelta++;
    try { ctrl?.abort(); } catch { /* ya */ }
    despertar?.();
    ctrl = null;
    if (!silencio) poner({ conexion: 'off', error: '' });
  }

  // ---------- Lo que sale ----------
  /** Un markdown, en uno o varios mensajes. `botones`: un teclado debajo del último. → el id del último. */
  async function mandarTexto(chat, md, { botones = null } = {}) {
    const partes = formato.partir(md);
    let ultimo = null;
    for (const [i, p] of partes.entries()) {
      const marcas = botones && i === partes.length - 1 ? { reply_markup: { inline_keyboard: botones } } : {};
      try {
        ultimo = await llamar('sendMessage', { chat_id: chat, text: p.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...marcas });
      } catch (err) {
        // (un HTML que Telegram no entendió: va en texto, sin formato)
        if (err.codigo !== 400 || !p.texto) throw err;
        ultimo = await llamar('sendMessage', { chat_id: chat, text: p.texto, link_preview_options: { is_disabled: true }, ...marcas });
      }
    }
    return ultimo?.message_id ?? null;
  }
  /** Un HTML ya armado (sin partir: lo arma esta app, corto). */
  const mandarHtml = (chat, html, { botones = null } = {}) => llamar('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}) }).then((r) => r?.message_id ?? null);
  const editarHtml = (chat, mensaje, html) => llamar('editMessageText', { chat_id: chat, message_id: mensaje, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  const accion = (chat, que = 'typing') => llamar('sendChatAction', { chat_id: chat, action: que });
  function mandarFoto(chat, datos, { nombre = 'image.png', tipo = 'image/png', caption = '' } = {}) {
    // (más de 10 MB, o una que Telegram no quiere como foto: va como archivo)
    const comoArchivo = () => subir('sendDocument', { chat_id: chat, ...(caption ? { caption } : {}) }, { campo: 'document', nombre, tipo, datos });
    if (datos.length > 10 * 1024 * 1024) return comoArchivo();
    return subir('sendPhoto', { chat_id: chat, ...(caption ? { caption } : {}) }, { campo: 'photo', nombre, tipo, datos }).catch((err) => (err.codigo === 400 ? comoArchivo() : Promise.reject(err)));
  }
  const mandarVoz = (chat, ogg, { caption = '', dur = 0 } = {}) => subir('sendVoice', { chat_id: chat, ...(caption ? { caption, parse_mode: 'HTML' } : {}), ...(dur ? { duration: Math.round(dur) } : {}) }, { campo: 'voice', nombre: 'voice.ogg', tipo: 'audio/ogg', datos: ogg });

  /** Baja un archivo que mandaron. → Buffer, y la ruta que le dio Telegram. */
  async function descargar(fileId, max = DESCARGA_MAX) {
    const token = config().token;
    const info = await llamar('getFile', { file_id: fileId });
    if (!info?.file_path) throw new Error('Telegram did not give the file.');
    if (Number(info.file_size) > max) throw new Error('The file is too big.');
    let r;
    try { r = await f(`${base}/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(120000) }); } catch (err) { throw new Error(`The file could not be downloaded (${sinToken(err?.cause?.code ?? err?.message ?? err, token)}).`); }
    if (!r.ok) throw new Error(`The file could not be downloaded (${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error('The file is too big.');
    return { datos: buf, ruta: String(info.file_path) };
  }

  return { arrancar, parar, estado: () => ({ ...e }), comprobar, llamar, mandarTexto, mandarHtml, editarHtml, accion, mandarFoto, mandarVoz, descargar };
}

// ---------- La app ----------
const TIPOS_IMAGEN = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const TEXTO_MAX = 256 * 1024; // lo mismo que un adjunto de texto en la PC (adjuntos.js)
const EXT_TEXTO = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'bat', 'cmd', 'sh', 'c', 'h', 'cpp', 'hpp', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'sql', 'r', 'tex', 'bib', 'srt', 'vtt']);
const extDe = (nombre) => String(nombre).toLowerCase().split('.').pop();

/**
 * @param rad      el núcleo (store, handle, send)
 * @param o.cifrar / o.descifrar  safeStorage (los de chat.cjs)
 * @param o.voz    lo que devuelve voz.wire: oir(pcm) con Whisper y grabar(texto) con la voz elegida
 * @param o.simulado  el Telegram de mentira (en el humo); sin él, el de verdad
 */
function wire(rad, { cifrar, descifrar, voz, taller = null, simulado = null, ffmpeg = require('./ffmpeg.cjs'), electron = require('electron') }) {
  const leer = () => { const d = rad.store.read(DOC); return d && typeof d === 'object' ? d : {}; };
  const escribir = (d) => rad.store.write(DOC, d);
  const elToken = () => { const d = leer(); return typeof d.token === 'string' && d.token ? descifrar(d.token) : null; };
  const normalDueno = (x) => (x && Number.isSafeInteger(x.id) ? { id: x.id, nombre: String(x.nombre ?? '').slice(0, 80), usuario: String(x.usuario ?? '').slice(0, 40) } : null);
  const config = () => {
    const d = leer();
    return {
      activo: d.activo === true,
      agente: typeof d.agente === 'string' ? d.agente : '',
      dueno: normalDueno(d.dueno),
      actua: d.actua === true,
      // (contestar un audio con otro: prendido de fábrica, pero hace falta una voz en Settings › Voice)
      conVoz: d.conVoz !== false,
      hayToken: typeof d.token === 'string' && d.token.length > 0,
      bot: d.bot && typeof d.bot === 'object' ? { id: d.bot.id ?? null, usuario: String(d.bot.usuario ?? ''), nombre: String(d.bot.nombre ?? '') } : null,
    };
  };
  let candidato = null; // quien le escribió al bot antes de vincular (solo en memoria)
  let avisar = () => {};
  let enFila = Promise.resolve();

  const tg = crear({
    fetch: simulado?.fetch ?? globalThis.fetch,
    base: simulado ? simulado.base : (process.env.TELEGRAM_BASE_URL || API),
    config: () => { const c = config(); return { activo: c.activo, token: elToken(), dueno: c.dueno, offset: leer().offset }; },
    guardarOffset: (n) => { const d = leer(); d.offset = n; escribir(d); },
    alCandidato: (q) => { candidato = q; avisar(); },
    // (de a uno y en orden: una foto que tarda en bajar no queda detrás del texto que se mandó después)
    alMensaje: (m) => { enFila = enFila.then(() => recibir(m)).catch((err) => console.warn('[telegram]', err?.message ?? err)); },
    alBoton: (b) => alBoton(b),
    alCambiar: (s) => {
      // (el nombre del bot queda guardado: Settings lo muestra aunque esté desconectado)
      if (s.bot) { const d = leer(); if (JSON.stringify(d.bot) !== JSON.stringify(s.bot)) { d.bot = s.bot; escribir(d); } }
      avisar();
    },
    ...(simulado ? { reintentoMs: [200, 1000], sondeoS: 2 } : {}),
  });
  const chatDelDueno = () => config().dueno?.id ?? null;

  const vista = () => {
    const c = config();
    const s = tg.estado();
    return { ...c, cifrado: cifrar('x') !== null, conexion: s.conexion, error: s.error, bot: s.bot ?? c.bot, candidato: c.dueno ? null : candidato };
  };
  avisar = () => rad.send('telegram:evento', vista());

  // ---------- Settings ----------
  rad.handle('telegram:estado', vista);
  rad.handle('telegram:guardar', (cambio) => {
    const c = cambio && typeof cambio === 'object' ? cambio : {};
    const d = leer();
    const estaba = d.activo === true;
    if (typeof c.activo === 'boolean') d.activo = c.activo;
    if (typeof c.agente === 'string') d.agente = c.agente.slice(0, 80);
    if (typeof c.actua === 'boolean') d.actua = c.actua;
    if (typeof c.conVoz === 'boolean') d.conVoz = c.conVoz;
    escribir(d);
    if (estaba !== (d.activo === true)) tg.arrancar();
    avisar();
    return { ok: true };
  });
  // El token: se comprueba con Telegram antes de guardarlo, entra en claro una
  // sola vez y se guarda cifrado.
  rad.handle('telegram:token', async (texto) => {
    const d = leer();
    if (texto === null || texto === '') {
      delete d.token;
      delete d.bot;
      delete d.offset;
      // (otro bot es otra charla: la vinculación era con este)
      delete d.dueno;
      candidato = null;
      escribir(d);
      tg.arrancar();
      avisar();
      return { ok: true };
    }
    const t = String(texto).trim();
    if (!esToken(t)) return { ok: false, error: 'That does not look like a bot token. @BotFather gives one like 123456789:AA… (numbers, a colon and about 35 letters).' };
    let bot;
    try { bot = await tg.comprobar(t); } catch (err) { return { ok: false, error: err.message }; }
    const blob = cifrar(t);
    if (!blob) return { ok: false, error: 'Windows could not encrypt the token, so it was not saved.' };
    const otro = d.bot?.id !== bot.id;
    d.token = blob;
    d.bot = bot;
    if (otro) { delete d.offset; delete d.dueno; candidato = null; }
    escribir(d);
    tg.arrancar();
    avisar();
    return { ok: true, bot };
  });
  // Vincular a quien le escribió al bot: desde acá en más, es el único que puede usarlo.
  rad.handle('telegram:vincular', async (que) => {
    if (!candidato || Number(que?.id) !== candidato.id) return { ok: false, error: 'Send a message to the bot again, then press “This is me”.' };
    const d = leer();
    d.dueno = { id: candidato.id, nombre: candidato.nombre, usuario: candidato.usuario };
    escribir(d);
    candidato = null;
    avisar();
    const nombre = agenteNombre(config().agente);
    tg.mandarHtml(d.dueno.id, `Linked. ${AYUDA.replace('%AGENTE%', formato.escapar(nombre))}`).catch(() => {});
    return { ok: true };
  });
  rad.handle('telegram:desvincular', () => {
    const d = leer();
    const antes = normalDueno(d.dueno);
    delete d.dueno;
    escribir(d);
    avisar();
    if (antes) tg.mandarHtml(antes.id, 'This chat was unlinked from BlackCode. The bot no longer answers here.').catch(() => {});
    return { ok: true };
  });

  const agenteNombre = (id) => {
    const lista = Array.isArray(rad.store.read('agentes')?.lista) ? rad.store.read('agentes').lista : [];
    return String((lista.find((a) => a.id === id) ?? lista[0])?.nombre ?? 'BlackCode');
  };

  // ---------- Lo que llega del dueño ----------
  let cuenta = 0;
  const responder = (texto) => { const chat = chatDelDueno(); return chat === null ? Promise.resolve(null) : tg.mandarTexto(chat, texto).catch(() => null); };
  async function recibir(m) {
    const c = config();
    if (m.comando === 'start' || m.comando === 'help') { await tg.mandarHtml(m.chat, AYUDA.replace('%AGENTE%', formato.escapar(agenteNombre(c.agente)))).catch(() => {}); return; }
    if (m.comando === 'new' || m.comando === 'stop') { rad.send('telegram:comando', { cmd: m.comando, agente: c.agente }); return; }
    if (m.otro) { await responder('I can read text, photos, text files and voice messages.'); return; }
    const imagenes = [];
    const archivos = [];
    let texto = m.texto;
    let audio = false;
    try {
      if (m.foto) {
        const { datos, ruta } = await tg.descargar(m.foto.id);
        imagenes.push(`data:${TIPOS_IMAGEN[extDe(ruta)] ?? 'image/jpeg'};base64,${datos.toString('base64')}`);
      }
      if (m.documento) {
        const ext = extDe(m.documento.nombre);
        if (/^image\/(png|jpeg|webp|gif)$/.test(m.documento.tipo) || TIPOS_IMAGEN[ext]) {
          const { datos } = await tg.descargar(m.documento.id, 10 * 1024 * 1024);
          imagenes.push(`data:${/^image\//.test(m.documento.tipo) ? m.documento.tipo : TIPOS_IMAGEN[ext]};base64,${datos.toString('base64')}`);
        } else if (/^text\//.test(m.documento.tipo) || /json|xml|yaml|csv|javascript/.test(m.documento.tipo) || EXT_TEXTO.has(ext)) {
          if (m.documento.peso > 4 * 1024 * 1024) { await responder('That file is too big: send text files of up to 4 MB.'); return; }
          const { datos } = await tg.descargar(m.documento.id, 4 * 1024 * 1024);
          const crudo = datos.toString('utf8');
          if (crudo.includes('\u0000')) { await responder('That file does not look like text. I can take images and text files.'); return; }
          archivos.push({ name: m.documento.nombre.slice(0, 120), size: datos.length, content: crudo.length > TEXTO_MAX ? `${crudo.slice(0, TEXTO_MAX)}\n…[truncated]` : crudo });
        } else {
          await responder('I can take images and text files. That one I cannot read.');
          return;
        }
      }
      if (m.audio) {
        tg.accion(m.chat, 'typing').catch(() => {});
        const { datos } = await tg.descargar(m.audio.id);
        const pcm = await ffmpeg.aPcm16k(datos);
        const r = await voz.oir(pcm);
        const dicho = String(r?.texto ?? '').trim();
        if (!dicho) { await responder('I could not hear anything in that voice message.'); return; }
        texto = [dicho, texto].filter(Boolean).join('\n\n');
        audio = true;
      }
    } catch (err) {
      await responder(m.audio ? `I could not understand the voice message: ${err.message}` : `That could not be received: ${err.message}`);
      return;
    }
    if (!texto.trim() && !imagenes.length && !archivos.length) return;
    rad.send('telegram:mensaje', { n: ++cuenta, texto, imagenes, archivos, audio, agente: c.agente, actua: c.actua, conVoz: c.conVoz });
  }

  // ---------- «Escribiendo…» ----------
  let escribiendo = null;
  const pararEscribiendo = () => { if (escribiendo) { clearInterval(escribiendo.t); clearTimeout(escribiendo.tope); } escribiendo = null; };
  rad.handle('telegram:escribiendo', (que) => {
    pararEscribiendo();
    const chat = chatDelDueno();
    if (!que?.activo || chat === null) return true;
    const que2 = que.accion === 'record_voice' ? 'record_voice' : 'typing';
    const mandar = () => tg.accion(chat, que2).catch(() => {});
    mandar();
    escribiendo = { t: setInterval(mandar, ESCRIBIENDO_MS), tope: setTimeout(pararEscribiendo, ESCRIBIENDO_TOPE_MS) };
    return true;
  });

  // ---------- La respuesta ----------
  // `imagenes`: las que dejó el turno ({ archivo } de generate_image, o { dataUrl }).
  const dirTools = () => path.join(path.dirname(rad.store.dir), 'tools');
  async function bytesDe(im) {
    if (typeof im?.dataUrl === 'string') {
      const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(im.dataUrl);
      return m ? { datos: Buffer.from(m[2], 'base64'), tipo: m[1] } : null;
    }
    if (typeof im?.archivo === 'string') {
      // solo lo que quedó en la carpeta de la app (lo que deja generate_image)
      const abs = path.resolve(im.archivo);
      const raiz = taller ? path.resolve(taller) : dirTools();
      if (!abs.startsWith(raiz + path.sep) && !abs.startsWith(dirTools() + path.sep)) return null;
      const datos = await require('node:fs').promises.readFile(abs).catch(() => null);
      return datos ? { datos, tipo: TIPOS_IMAGEN[extDe(abs)] ?? 'image/png' } : null;
    }
    return null;
  }
  let ultimaRespuesta = null; // (para el humo: qué se mandó y cómo)
  rad.handle('telegram:responder', async (r) => {
    pararEscribiendo();
    const chat = chatDelDueno();
    if (chat === null) return { ok: false, error: 'not linked' };
    const texto = String(r?.texto ?? '').trim();
    const hecho = { fotos: 0, voz: false, texto: false, error: '' };
    try {
      for (const im of (Array.isArray(r?.imagenes) ? r.imagenes : []).slice(0, 10)) {
        const b = await bytesDe(im);
        if (!b) continue;
        await tg.mandarFoto(chat, b.datos, { nombre: String(im.name ?? 'image.png').slice(0, 80), tipo: b.tipo });
        hecho.fotos++;
      }
      if (texto && r?.hablar === true) {
        try {
          tg.accion(chat, 'record_voice').catch(() => {});
          const { pcm, sr } = await voz.grabar(texto);
          const ogg = await ffmpeg.aOpus(pcm, sr);
          const plano = formato.plano(texto);
          // (con el texto abajo, si entra: así se lee también)
          const caption = plano.length <= 1000 ? formato.escapar(plano) : '';
          await tg.mandarVoz(chat, ogg, { caption, dur: pcm.length / 2 / sr });
          hecho.voz = true;
          if (!caption) { await tg.mandarTexto(chat, texto); hecho.texto = true; }
        } catch (err) {
          hecho.error = err.message;
          await tg.mandarTexto(chat, `${texto}\n\n_(The voice could not be made: ${err.message})_`);
          hecho.texto = true;
        }
      } else if (texto) {
        await tg.mandarTexto(chat, texto);
        hecho.texto = true;
      }
    } catch (err) {
      hecho.error = err.message;
    }
    ultimaRespuesta = hecho;
    return { ok: !hecho.error, ...hecho };
  });
  rad.handle('telegram:avisar', async (r) => ({ ok: (await responder(String(r?.texto ?? ''))) !== null }));

  // ---------- Los permisos, con botones ----------
  const permisos = new Map(); // serie → { chat (de BlackCode), callId, mensaje, html, cerrado }
  let serie = 0;
  const resumenArgs = (args) => {
    if (!args || typeof args !== 'object') return '';
    const corto = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v]));
    const t = JSON.stringify(corto, null, 1);
    return t === '{}' ? '' : t.length > 1200 ? `${t.slice(0, 1200)}…` : t;
  };
  rad.handle('telegram:permiso', async (p) => {
    const chat = chatDelDueno();
    if (chat === null) return { ok: false };
    const callId = String(p?.callId ?? '');
    // (la misma tarjeta no se manda dos veces)
    for (const x of permisos.values()) if (x.callId === callId && !x.cerrado) return { ok: true };
    const n = ++serie;
    const args = resumenArgs(p?.args);
    const html = `<b>${formato.escapar(String(p?.agente ?? 'BlackCode'))} needs your permission</b>\n${formato.escapar(String(p?.label || p?.name || ''))}${args ? `\n<pre>${formato.escapar(args)}</pre>` : ''}`;
    const botones = [[{ text: 'Allow', callback_data: `p:${n}:a` }, { text: 'Always in this chat', callback_data: `p:${n}:t` }], [{ text: 'Deny', callback_data: `p:${n}:d` }]];
    pararEscribiendo();
    try {
      const mensaje = await tg.mandarHtml(chat, html, { botones });
      permisos.set(n, { chat: String(p?.chat ?? ''), callId, mensaje, html, cerrado: false });
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  const cerrarPermiso = (x, como) => {
    x.cerrado = true;
    const chat = chatDelDueno();
    if (chat !== null && x.mensaje) tg.editarHtml(chat, x.mensaje, `${x.html}\n\n<i>${como}</i>`).catch(() => {});
  };
  async function alBoton({ datos }) {
    const m = /^p:(\d+):([atd])$/.exec(datos);
    if (!m) return '';
    const x = permisos.get(Number(m[1]));
    if (!x || x.cerrado) return 'This was already answered.';
    const permitir = m[2] !== 'd';
    const confiar = m[2] === 't';
    cerrarPermiso(x, permitir ? (confiar ? 'Allowed, and it won’t ask again in this chat.' : 'Allowed.') : 'Denied.');
    rad.send('telegram:decision', { chat: x.chat, callId: x.callId, permitir, confiar });
    return '';
  }
  // La tarjeta se contestó en la PC (o el turno terminó): los botones se van.
  rad.handle('telegram:permiso-fin', (p) => {
    const callId = String(p?.callId ?? '');
    for (const x of permisos.values()) if (!x.cerrado && (x.callId === callId || (!callId && x.chat === String(p?.chat ?? '')))) cerrarPermiso(x, p?.como === 'fin' ? 'The answer ended before this was answered.' : 'Answered on the PC.');
    return true;
  });

  if (taller && simulado) {
    rad.handle('telegram:simular', (que) => simulado.simular(que && typeof que === 'object' ? que : {}));
    rad.handle('telegram:ultima-respuesta', () => ultimaRespuesta);
  }

  electron.app.on('before-quit', () => { pararEscribiendo(); tg.parar({ silencio: true }); });
  // (recién con la app lista: antes, safeStorage no descifra el token)
  electron.app.whenReady().then(() => tg.arrancar());
  return { tg, vista };
}

module.exports = { crear, wire, esToken, TELEGRAM_NOTE, TELEGRAM_VOICE_NOTE, DOC };
