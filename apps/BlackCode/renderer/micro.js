// El micrófono de la PC (la webcam de Fran): la captura. Mientras la voz esté
// prendida con «A microphone on this PC», el micrófono queda abierto y su
// audio va al proceso principal de a 100 ms (`voz:micro-audio`), que se lo da
// al detector de la palabra clave y a la conversación (main/micro.cjs).
//
// Se abre con el cancelador de eco de Chromium: la voz de Zac sale por los
// parlantes de la PC y la reproduce esta misma página (habla.js), así que el
// cancelador la saca de lo que oye el micrófono. Igual, mientras Zac habla no
// se abren frases (eso lo decide main/micro.cjs).
//
// En el humo no se abre el micrófono de verdad (`capturar: false`): el audio
// lo pone el guion.

import * as datos from './datos.js';

let actual = null;       // { stream, ctx, nodo, id }
let pedido = 0;          // sube con cada abrir/cerrar: lo que vuelve tarde de un pedido viejo se cierra
const e = { estado: 'off', error: '', nombre: '' };
const oyentes = new Set();
const avisar = () => { for (const fn of oyentes) { try { fn({ ...e }); } catch { /* el que escucha no frena esto */ } } };
const poner = (cambio) => { Object.assign(e, cambio); avisar(); };

/** El estado del micrófono: 'off', 'opening', 'on' o 'error' (con su error y el nombre del que se abrió). */
export const estadoMicro = () => ({ ...e });
export function alCambiarMicro(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

/** Los micrófonos de la PC: [{ id, nombre }]. Sin permiso todavía, los nombres
 *  vienen vacíos: `pedirPermiso` abre uno un instante para que Chromium los diga. */
export async function listarMicros({ pedirPermiso = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let lista = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput');
  if (pedirPermiso && lista.some((d) => !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of s.getTracks()) t.stop();
      lista = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput');
    } catch { /* sin permiso: quedan sin nombre */ }
  }
  // («default» y «communications» son alias que Windows le pone a uno de los de verdad)
  return lista.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, nombre: d.label || 'Microphone' }));
}

function cerrar() {
  pedido++;
  const a = actual;
  actual = null;
  if (a) {
    try { a.nodo.port.onmessage = null; a.nodo.disconnect(); } catch { /* ya estaba */ }
    for (const t of a.stream.getTracks()) { try { t.stop(); } catch { /* idem */ } }
    a.ctx.close().catch(() => {});
  }
  if (e.estado !== 'off') poner({ estado: 'off', error: '', nombre: '' });
}

async function abrir(id) {
  cerrar();
  const mio = pedido;
  poner({ estado: 'opening', error: '' });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
  } catch (err) {
    if (mio !== pedido) return;
    const falta = err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError';
    poner({ estado: 'error', error: falta ? 'That microphone is not connected.' : err?.name === 'NotAllowedError' ? 'Windows is not letting BlackCode use the microphone (Settings › Privacy › Microphone).' : `The microphone could not be opened: ${err?.message ?? err}` });
    return;
  }
  if (mio !== pedido) { for (const t of stream.getTracks()) t.stop(); return; }
  try {
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(new URL('./micro-worklet.js', import.meta.url));
    if (mio !== pedido) { ctx.close().catch(() => {}); for (const t of stream.getTracks()) t.stop(); return; }
    const fuente = ctx.createMediaStreamSource(stream);
    const nodo = new AudioWorkletNode(ctx, 'blackcode-micro', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    nodo.port.onmessage = (ev) => { window.rad.invoke('voz:micro-audio', new Uint8Array(ev.data)).catch(() => {}); };
    fuente.connect(nodo);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    actual = { stream, ctx, nodo, id };
    const pista = stream.getAudioTracks()[0];
    // (si se desenchufa, se dice; al volver a enchufarlo, se reabre cuando cambie la lista)
    pista?.addEventListener('ended', () => { if (actual?.stream === stream) { cerrar(); poner({ estado: 'error', error: 'The microphone was disconnected.' }); } });
    poner({ estado: 'on', error: '', nombre: pista?.label ?? '' });
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    if (mio === pedido) poner({ estado: 'error', error: `The microphone could not be opened: ${err?.message ?? err}` });
  }
}

function aplicar() {
  const v = datos.voz();
  const quiere = v.activa === true && v.fuente === 'micro' && v.capturar !== false;
  const id = v.micro?.id ?? '';
  if (!quiere) { cerrar(); return; }
  if (actual && actual.id === id) return;
  if (e.estado === 'opening') return; // (ya va: cuando termine se mira de nuevo)
  // (el mismo que ya falló no se reintenta a cada cambio de estado: espera a que se enchufe algo, o a que se elija otro)
  if (e.estado === 'error' && intentado === id) return;
  intentado = id;
  abrir(id).then(() => { if (actual && actual.id !== (datos.voz().micro?.id ?? '')) aplicar(); });
}
let intentado = null;

export function montarMicro() {
  datos.on('voz', aplicar);
  // un micrófono que se enchufa (o vuelve): si era el que faltaba, se abre
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (e.estado === 'error') { intentado = null; aplicar(); } avisar(); });
  aplicar();
}
