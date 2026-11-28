// Las señales de la conversación por el micrófono de la PC (la webcam de
// Fran): saber, desde la otra punta del cuarto o mirando la pantalla, cuándo
// BlackCode está escuchando y cuándo se cerró. Lo eligió Fran en su maqueta
// (Documents\BlackCode-mockups\voz-senales.html, 28/11/2026):
//
// - Un sonido, «Gotas»: dos notas que suben al abrirse la conversación («okay
//   zac» o Ctrl+Alt+Z) y bajan al cerrarse (con «gracias, Zac», a los 30 s sin
//   hablar o con el atajo; el mismo para los tres). Cuando el micrófono se
//   vuelve a abrir después de cada respuesta NO suena: en una charla larga
//   molestaría. Tampoco suena al apagar la voz desde Settings. Los genera Web
//   Audio en esta página, la misma que reproduce la voz de Zac: el cancelador
//   de eco del micrófono (micro.js) los saca de lo que oye.
// - La isla: una pastilla arriba, al centro, mientras la conversación está
//   abierta, con el micrófono, cinco barritas que siguen el volumen de lo que
//   oye y en qué anda (Listening, Transcribing, Thinking, Speaking). Vive en
//   la capa de overlays, así que si cae sobre el navegador lo eclipsa como un
//   menú (navegador.js); por eso entra y sale del documento con la
//   conversación, y no queda escondida.
//
// El punto rojo del ícono de la bandeja lo pone el proceso principal
// (main/bandeja.cjs), que se entera solo del estado de la conversación.
//
// En el humo (`capturar: false`) los sonidos no suenan: se cuentan.

import * as datos from './datos.js';
import * as habla from './habla.js';
import { nivelMicro } from './micro.js';
import { layer } from '/@core/overlays.js';
import { ms, raf2 } from '/@core/motion.js';
import { h, icono } from './piezas.js';

// ---------- El sonido ----------

let ctx = null;
const cuenta = { abre: 0, cierra: 0, sonados: 0 };

function nota(c, t0, f, dur, vol = 0.18) {
  const g = c.createGain();
  g.connect(c.destination);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t0);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
// Gotas: mi y si al abrir (sube), si y re al cerrar (baja).
const GOTAS = {
  abre: (c, t) => { nota(c, t, 659, 0.16); nota(c, t + 0.09, 988, 0.22); },
  cierra: (c, t) => { nota(c, t, 988, 0.16); nota(c, t + 0.09, 587, 0.26); },
};

function sonar(que) {
  cuenta[que]++;
  if (datos.voz().capturar === false) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    GOTAS[que](ctx, ctx.currentTime + 0.02);
    cuenta.sonados++;
  } catch { /* sin audio: la isla y la bandeja igual lo dicen */ }
}

// ---------- La isla ----------

const BARRAS = 5;
// (las del medio más altas: se lee como una voz y no como un ecualizador)
const PERFIL = [0.55, 0.85, 1, 0.8, 0.6];
const TEXTOS = { listening: 'Listening', transcribing: 'Transcribing', thinking: 'Thinking', speaking: 'Speaking' };

let isla = null;        // { el, barras, textos }
let quitar = 0;         // el temporizador que la saca del documento al terminar de irse
let cuadro = 0;
let nivel = 0;

/** En qué anda la conversación, para la isla: listening | transcribing | thinking | speaking, o null si está cerrada. */
function faseIsla() {
  const v = datos.voz();
  const c = v.conversacion ?? {};
  if (!v.activa || v.fuente !== 'micro' || !c.conversacion) return null;
  if (c.fase === 'listening') return 'listening';
  if (c.fase === 'transcribing') return 'transcribing';
  return habla.hablando() ? 'speaking' : 'thinking';
}

function crearIsla() {
  const barras = Array.from({ length: BARRAS }, () => h('i', 'dm-isla-barra'));
  // Los cuatro textos viven a la vez en la misma celda y solo uno se ve: la
  // pastilla mide siempre lo del más largo y no cambia de ancho en el relevo.
  const textos = Object.fromEntries(Object.entries(TEXTOS).map(([k, t]) => [k, h('span', 'dm-isla-texto', { 'data-fase': k }, t)]));
  const el = h('div', 'dm-isla', { role: 'status', 'aria-live': 'polite', 'data-isla': '' },
    icono('micro', 'dm-isla-micro'),
    h('span', 'dm-isla-barras', { 'aria-hidden': 'true' }, ...barras),
    h('span', 'dm-isla-textos', {}, ...Object.values(textos)));
  return { el, barras, textos };
}

function dibujar(t) {
  cuadro = 0;
  if (!isla) return;
  const f = isla.el.dataset.fase;
  const objetivo = f === 'listening' ? nivelMicro() : 0;
  // sube rápido y baja despacio, como un vúmetro
  nivel += (objetivo - nivel) * (objetivo > nivel ? 0.5 : 0.14);
  isla.barras.forEach((b, i) => {
    let k;
    if (f === 'listening') k = nivel * PERFIL[i] * (0.78 + 0.22 * Math.sin(t / 90 + i * 1.7));
    // transcribiendo: una ola que recorre las barras (está pensando lo que oyó)
    else if (f === 'transcribing') k = 0.35 * (1 + Math.sin(t / 130 - i * 0.9));
    else k = 0;
    b.style.setProperty('--dm-k', Math.max(0, Math.min(1, k)).toFixed(3));
  });
  if (isla.el.dataset.visible !== undefined) cuadro = requestAnimationFrame(dibujar);
}

function mostrarIsla(fase) {
  clearTimeout(quitar);
  const nueva = !isla;
  if (nueva) {
    isla = crearIsla();
    layer().append(isla.el);
  }
  isla.el.dataset.fase = fase;
  for (const [k, span] of Object.entries(isla.textos)) span.toggleAttribute('data-activo', k === fase);
  if (nueva) raf2().then(() => { if (isla) isla.el.setAttribute('data-visible', ''); });
  else isla.el.setAttribute('data-visible', '');
  if (!cuadro) cuadro = requestAnimationFrame(dibujar);
}

function esconderIsla() {
  if (!isla || isla.el.dataset.visible === undefined) {
    // (todavía no se mostró: se va sin más)
    if (isla && !isla.el.isConnected) isla = null;
    return;
  }
  const el = isla.el;
  el.removeAttribute('data-visible');
  clearTimeout(quitar);
  // sale del documento cuando terminó de irse (si mientras tanto se reabre, se queda)
  quitar = setTimeout(() => {
    if (isla?.el !== el || el.dataset.visible !== undefined) return;
    el.remove();
    isla = null;
    nivel = 0;
  }, ms('dur-base') + 80);
}

function pintarIsla() {
  const f = faseIsla();
  if (f) mostrarIsla(f);
  else esconderIsla();
}

// ---------- Lo que se mira ----------

let abierta = false;

function alCambiarVoz() {
  const v = datos.voz();
  const c = v.conversacion ?? {};
  const ahora = v.activa === true && v.fuente === 'micro' && c.conversacion === true;
  if (ahora !== abierta) {
    abierta = ahora;
    if (ahora) sonar('abre');
    // (apagar la voz desde Settings no es terminar una charla: no suena)
    else if (c.cierre && c.cierre !== 'off') sonar('cierra');
  }
  pintarIsla();
}

/** Para el humo: cuántas veces sonó cada señal, y cómo está la isla. */
export function medidasSenales() {
  const el = isla?.el;
  return {
    ...cuenta,
    isla: el ? { enDocumento: el.isConnected, visible: el.dataset.visible !== undefined, fase: el.dataset.fase, texto: el.querySelector('.dm-isla-texto[data-activo]')?.textContent ?? '' } : null,
  };
}

export function montarSenales() {
  const v = datos.voz();
  abierta = v.activa === true && v.fuente === 'micro' && v.conversacion?.conversacion === true;
  datos.on('voz', alCambiarVoz);
  habla.alCambiar(pintarIsla);
  pintarIsla();
}
