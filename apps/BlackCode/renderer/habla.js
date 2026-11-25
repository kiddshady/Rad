// El habla, del lado que suena: recibe el audio que genera el proceso principal
// (main/habla.cjs, por tramos mientras se genera) y lo reproduce pegando un
// tramo al final del anterior, así no se corta entre uno y otro. Callar corta
// lo que suena en el acto y descarta lo que quedaba por sonar.

const oyentes = new Set();
let ctx = null;
let cursor = 0;            // hasta cuándo (en el reloj del audio) ya hay algo programado
const sonando = new Set(); // las fuentes programadas que todavía no terminaron
const callados = new Set(); // turnos que se callaron: lo que llegue de ellos no suena
let avisado = false;

const avisar = () => { const h = hablando(); if (h === avisado) return; avisado = h; for (const fn of oyentes) fn(h); };

/** ¿Está sonando (o por sonar) algo? */
export const hablando = () => sonando.size > 0;
/** Avisa cuando empieza y cuando termina de hablar. */
export function alCambiar(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

/** El estado del audio, para el humo: si el contexto corre y cuánto se programó. */
export const medidas = () => ({ estado: ctx?.state ?? 'none', reloj: ctx?.currentTime ?? 0, cursor, sonando: sonando.size });

function tramo({ turno, sr, pcm }) {
  if (callados.has(turno) || typeof pcm !== 'string' || !pcm) return;
  const crudo = atob(pcm);
  const n = crudo.length >> 1;
  if (!n) return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const buffer = ctx.createBuffer(1, n, Number(sr) || 24000);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const v = crudo.charCodeAt(i * 2) | (crudo.charCodeAt(i * 2 + 1) << 8);
    datos[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  const fuente = ctx.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(ctx.destination);
  // el primero arranca con un respiro mínimo; los demás, donde termina el anterior
  const cuando = Math.max(ctx.currentTime + 0.04, cursor);
  cursor = cuando + buffer.duration;
  fuente.turno = turno;
  sonando.add(fuente);
  fuente.onended = () => { sonando.delete(fuente); avisar(); };
  fuente.start(cuando);
  avisar();
}

/** Corta lo que suena y descarta lo que quedaba (de todos los turnos en curso). */
export function callar() {
  for (const f of [...sonando]) {
    callados.add(f.turno);
    f.onended = null;
    try { f.stop(); } catch { /* ya había terminado */ }
    sonando.delete(f);
  }
  cursor = 0;
  avisar();
}

export function montarHabla() {
  window.rad.on('voz:audio', (a) => { if (a && typeof a === 'object') tramo(a); });
  window.rad.on('voz:callar', () => callar());
  // (el turno terminó de generarse: si lo habían callado, ya no hace falta recordarlo)
  window.rad.on('voz:dicho', (f) => { if (f?.turno) setTimeout(() => callados.delete(f.turno), 5000); });
}
