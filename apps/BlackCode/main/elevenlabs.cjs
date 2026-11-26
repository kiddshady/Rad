'use strict';
// El habla con ElevenLabs: la otra voz con la que puede contestar un agente,
// en la nube y con las voces de la cuenta del usuario (la biblioteca y las que
// clonó en su web). BlackCode no crea ni sube nada a la cuenta: solo lista
// las voces y los modelos y pide el audio.
//
// Tiene la misma forma que habla.cjs (calentar, decir, callar, apagar,
// estado), así voz.cjs elige una u otra sin que el resto se entere, y el
// audio sale por el mismo camino: PCM de 16 bits mono a 24 kHz, por tramos
// mientras llega (`output_format=pcm_24000` en el endpoint de streaming), que
// la interfaz pega uno detrás del otro.
//
// Cada respuesta gasta créditos de la cuenta. Por eso en modo simulado
// (BLACKCODE_PROVEEDOR=simulado) no sale a internet: si no le dan
// ELEVENLABS_BASE_URL (el servidor de mentira del humo y de los tests), no
// habla con nadie.
//
// Sin Electron: la llave llega por una función y `fetch` se puede cambiar.

const { enFrases } = require('./habla.cjs');

const MODELO = 'eleven_flash_v2_5';
const SR = 24000;
const TRAMO = SR * 2 / 5;         // 0,2 s de audio: lo que se junta antes de mandar un tramo
const PAGINAS = 10;               // de a 100 voces: más que eso no tiene nadie
// (multilingual v2 no acepta language_code: decide el idioma por el texto)
const SIN_IDIOMA = /^eleven_multilingual_v2/;

const SIMULADO = () => process.env.BLACKCODE_PROVEEDOR === 'simulado';
function base() {
  const propia = process.env.ELEVENLABS_BASE_URL;
  if (propia) return propia.replace(/\/+$/, '');
  if (SIMULADO()) return null;
  return 'https://api.elevenlabs.io';
}

/** Lo que dijo ElevenLabs de un pedido que no salió: { status, codigo, mensaje }. */
async function leerError(res) {
  let cuerpo = null;
  try { cuerpo = await res.json(); } catch { /* no era JSON */ }
  const d = cuerpo?.detail;
  const codigo = typeof d === 'object' && d ? String(d.status ?? d.code ?? '') : '';
  const mensaje = typeof d === 'string' ? d : typeof d === 'object' && d ? String(d.message ?? '') : String(cuerpo?.message ?? '');
  return { status: res.status, codigo, mensaje: mensaje.slice(0, 300) };
}

/** El error de un pedido de voz, en una frase para el usuario. */
function frase(e) {
  if (e.codigo === 'quota_exceeded' || e.status === 402) return 'You are out of ElevenLabs credits for now.';
  if (e.codigo === 'missing_permissions') return 'The ElevenLabs key does not have the Text to Speech permission.';
  if (e.status === 401) return 'ElevenLabs rejected the key. Paste it again in Settings › Providers.';
  if (e.codigo === 'voice_not_found' || e.status === 404) return 'That ElevenLabs voice no longer exists: choose another one in Settings › Voice.';
  if (e.status === 429) return 'ElevenLabs is busy right now (too many requests). Try again in a moment.';
  return `ElevenLabs could not speak (${e.status})${e.mensaje ? `: ${e.mensaje}` : '.'}`;
}

/**
 * ¿Sirve la llave? Se pide la primera voz de la cuenta, que no gasta créditos.
 * { fase: 'aceptada' } | { fase: 'rechazada', motivo, detalle } | { fase: 'sin-comprobar', motivo }
 */
async function comprobar(key, { fetch: f = globalThis.fetch } = {}) {
  const b = base();
  if (!b) return { fase: 'aceptada' };
  let res;
  try {
    res = await f(`${b}/v2/voices?page_size=1`, { headers: { 'xi-api-key': key } });
  } catch {
    return { fase: 'sin-comprobar', motivo: 'conexion' };
  }
  if (res.ok) return { fase: 'aceptada' };
  const e = await leerError(res);
  if (e.status === 401 && e.codigo === 'missing_permissions') return { fase: 'rechazada', motivo: 'sin-voces', detalle: e.mensaje };
  if (e.status === 401) return { fase: 'rechazada', motivo: 'invalida', detalle: e.mensaje };
  return { fase: 'sin-comprobar', motivo: 'servicio', detalle: e.mensaje };
}

/** Las voces de la cuenta y los modelos que hablan: { voces: [{ id, nombre, categoria }], modelos: [{ id, nombre }] }. */
async function catalogo(key, { fetch: f = globalThis.fetch } = {}) {
  const b = base();
  if (!b) throw new Error('ElevenLabs is not reachable in simulated mode.');
  const pedir = async (url) => {
    let res;
    try { res = await f(url, { headers: { 'xi-api-key': key } }); } catch { throw new Error('There is no connection to ElevenLabs.'); }
    if (!res.ok) throw new Error(frase(await leerError(res)));
    return res.json();
  };
  const voces = [];
  let token = '';
  for (let i = 0; i < PAGINAS; i++) {
    const r = await pedir(`${b}/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`);
    for (const v of Array.isArray(r?.voices) ? r.voices : []) {
      if (typeof v?.voice_id === 'string' && v.voice_id) voces.push({ id: v.voice_id, nombre: String(v.name ?? v.voice_id).slice(0, 80), categoria: String(v.category ?? '') });
    }
    token = r?.has_more && typeof r.next_page_token === 'string' ? r.next_page_token : '';
    if (!token) break;
  }
  const lista = await pedir(`${b}/v1/models`);
  const modelos = (Array.isArray(lista) ? lista : [])
    .filter((m) => m?.can_do_text_to_speech === true && m.requires_alpha_access !== true && typeof m.model_id === 'string')
    .map((m) => ({ id: m.model_id, nombre: String(m.name ?? m.model_id).slice(0, 80) }));
  return { voces, modelos };
}

/**
 * @param {object} o
 * @param {() => string|null} o.llave   la llave en claro (o null)
 * @param {() => object} o.config       { voz, modelo, idioma }
 * @param {Function} o.alAudio          ({ turno, n, sr, pcm }) un tramo de audio
 * @param {Function} o.alFin            ({ turno, callado, error }) terminó de decir ese turno
 */
function crear({ llave = () => null, config = () => ({}), fetch: f = globalThis.fetch, alAudio = () => {}, alFin = () => {}, alCambiar = () => {} } = {}) {
  let cuenta = 0;
  const turnos = new Map(); // turno → { callado, ctrl }
  const e = { estado: 'off', error: '' };
  const estado = () => ({ ...e, hablando: [...turnos.values()].some((t) => !t.callado) });
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar(estado()); } catch { /* el que escucha no frena esto */ } };

  // Lo que falta para poder hablar, o null.
  function falta() {
    if (!base()) return 'ElevenLabs is not reachable in simulated mode.';
    if (!llave()) return 'No ElevenLabs key yet: paste one in Settings › Providers.';
    if (!String(config()?.voz ?? '').trim()) return 'No ElevenLabs voice chosen yet.';
    return null;
  }

  // Una frase: el audio llega por pedazos de cualquier largo; se juntan de a
  // 0,2 s y nunca se parte una muestra (dos bytes) entre un tramo y el otro.
  async function unaFrase(turno, t, texto, { previa, siguiente, modelo, idioma, voz, key }) {
    const cuerpo = { text: texto, model_id: modelo };
    if (idioma && !SIN_IDIOMA.test(modelo)) cuerpo.language_code = idioma;
    if (previa) cuerpo.previous_text = previa;
    if (siguiente) cuerpo.next_text = siguiente;
    const res = await f(`${base()}/v1/text-to-speech/${encodeURIComponent(voz)}/stream?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/pcm' },
      body: JSON.stringify(cuerpo),
      signal: t.ctrl.signal,
    });
    if (!res.ok) throw new Error(frase(await leerError(res)));
    let junto = Buffer.alloc(0);
    const soltar = (todo) => {
      const largo = todo ? junto.length - (junto.length % 2) : Math.floor(junto.length / TRAMO) * TRAMO;
      if (!largo || t.callado) return;
      alAudio({ turno, n: t.n++, sr: SR, pcm: junto.subarray(0, largo) });
      junto = junto.subarray(largo);
    };
    for await (const pedazo of res.body) {
      if (t.callado) break;
      junto = Buffer.concat([junto, Buffer.from(pedazo)]);
      soltar(false);
    }
    soltar(true);
  }

  async function correr(turno, t, frases, datos) {
    let error = '';
    try {
      for (const [i, texto] of frases.entries()) {
        if (t.callado) break;
        await unaFrase(turno, t, texto, { ...datos, previa: frases[i - 1] ?? '', siguiente: frases[i + 1] ?? '' });
      }
    } catch (err) {
      if (!t.callado) error = err?.name === 'AbortError' ? '' : err?.message === 'fetch failed' ? 'There is no connection to ElevenLabs.' : String(err?.message ?? err).slice(0, 300);
    }
    turnos.delete(turno);
    poner(error ? { estado: 'error', error } : { estado: 'idle', error: '' });
    try { alFin({ turno, callado: t.callado, ...(error ? { error } : {}) }); } catch { /* idem */ }
  }

  /** Dice un texto. Devuelve el turno, o null si no hay nada que decir o no se puede. */
  function decir(texto) {
    const frases = enFrases(texto);
    if (!frases.length) return null;
    const porque = falta();
    if (porque) { poner({ estado: 'error', error: porque }); return null; }
    const c = config() ?? {};
    const turno = `e${++cuenta}`;
    const t = { callado: false, n: 0, ctrl: new AbortController() };
    turnos.set(turno, t);
    poner({ estado: 'idle', error: '' });
    correr(turno, t, frases, {
      voz: String(c.voz).trim(),
      modelo: typeof c.modelo === 'string' && c.modelo ? c.modelo : MODELO,
      idioma: c.idioma === 'es' || c.idioma === 'en' ? c.idioma : '',
      key: llave(),
    });
    return turno;
  }

  /** Deja de hablar: corta el pedido en curso y lo que esperaba no se pide. */
  function callar() {
    let alguno = false;
    for (const t of turnos.values()) {
      if (t.callado) continue;
      t.callado = true;
      alguno = true;
      t.ctrl.abort();
    }
    if (alguno) poner({});
    return alguno;
  }

  // (no hay nada que cargar: el error de antes se olvida, para que no quede
  // dicho uno que ya no es verdad cuando cambian la voz o la llave)
  const calentar = () => !falta();
  const apagar = () => { callar(); poner({ estado: 'off', error: '' }); };

  return { calentar, decir, callar, apagar, estado, vivo: () => turnos.size > 0 };
}

module.exports = { crear, comprobar, catalogo, frase, MODELO };
