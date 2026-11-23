// Rad · el anillo de carga.
//
// Una luz que recorre el reborde de algo mientras carga, con su resplandor.
//
//   import { setBusy } from '/@core/busy.js';
//   setBusy(tarjeta, true);     // la luz entra y empieza a dar vueltas
//   setBusy(tarjeta, false);    // se apaga y sale del DOM
//
// Cómo está hecho, y por qué así:
//   - Es un SVG con el contorno del elemento (un rect con su mismo redondeo)
//     y la luz es un trazo de rayas que avanza. Un conic-gradient girando es
//     más corto de escribir, pero gira a velocidad ANGULAR pareja: en algo
//     ancho y bajo (una barra) la luz se arrastra por el medio de los lados
//     largos y pega un latigazo en las puntas. Por el trazo va a la misma
//     velocidad en todo el recorrido.
//   - El degradado de la cola a la cabeza son varios trazos encimados, cada
//     uno más corto y más cerca del color de la cabeza: un trazo de SVG no
//     acepta un degradado a lo largo del camino.
//   - El resplandor es una copia de los mismos trazos, más gruesa y
//     desenfocada, debajo.
//   - Todos los anillos de la página van en fase (arrancan de la hora del
//     documento, no del momento en que nacen): dos cosas cargando a la vez
//     giran juntas, y si algo vuelve a cargar mientras su anillo anterior
//     todavía se está yendo, el nuevo lo releva sin salto.
//
// Los colores, el grosor, el resplandor y la vuelta son perillas de anatomía
// (--rad-a-busy-*) que el núcleo define en .rad-busy y una piel puede pisar.
//
// Límites: el anillo es un hijo del elemento, así que no sirve en un <input>
// (se pone en lo que lo envuelve) ni en algo que scrollea (se iría con el
// contenido). Si el elemento recorta (overflow: hidden) se ve la línea pero
// no el resplandor de afuera.

import { present, dismiss } from './motion.js';

const SEGMENTS = 9;
const TAIL = 0.62; // cuánto del recorrido ocupa la luz, cola incluida
const HEAD = 0.015;

function build() {
  const ring = document.createElement('span');
  ring.className = 'rad-busy';
  ring.setAttribute('aria-hidden', 'true');
  const segs = '<rect pathLength="1"/>'.repeat(SEGMENTS);
  ring.innerHTML = `<svg class="rad-busy-svg" focusable="false"><g class="rad-busy-halo">${segs}</g><g class="rad-busy-line">${segs}</g></svg>`;
  // Lo de cada trazo se pone por CSSOM: la CSP no deja estilos en atributos.
  for (const group of ring.querySelectorAll('g')) {
    [...group.children].forEach((rect, i) => {
      const t = i / (SEGMENTS - 1); // 0 = toda la cola, 1 = la cabeza
      const len = HEAD + (TAIL - HEAD) * (1 - t) ** 1.7;
      const alpha = 0.16 + 0.84 * t ** 2.4;
      rect.style.setProperty('--rad-a-len', len.toFixed(4));
      rect.style.setProperty('--rad-a-mix', `${Math.round(t * 100)}%`);
      rect.style.setProperty('--rad-a-alpha', alpha.toFixed(3));
    });
  }
  return ring;
}

const leaving = (ring) => ring.hasAttribute('data-rad-leaving') || ring.dataset.state === 'closing';

/** Prende o apaga el anillo de carga de un elemento. Prenderlo dos veces no
    hace nada; apagar uno que no lo tiene, tampoco. */
export function setBusy(el, on = true) {
  const current = el._radBusy && el._radBusy.isConnected && !leaving(el._radBusy) ? el._radBusy : null;

  if (!on) {
    if (!current) return;
    el._radBusy = null;
    el.removeAttribute('aria-busy');
    dismiss(current).then(() => {
      // La clase que lo vuelve posicionado se va con el último anillo.
      if (!el.querySelector(':scope > .rad-busy')) el.classList.remove('rad-busy-host');
    });
    return;
  }
  if (current) return;

  // El anillo es absoluto: su dueño tiene que ser su bloque contenedor.
  if (getComputedStyle(el).position === 'static') el.classList.add('rad-busy-host');
  const ring = build();
  ring.style.setProperty('--rad-a-busy-r', getComputedStyle(el).borderTopLeftRadius || '0px');
  el.append(ring);

  // En fase con la hora del documento. La vuelta sale del estilo ya resuelto
  // (la perilla es un calc sobre tokens de la piel).
  const lap = parseFloat(getComputedStyle(ring.querySelector('rect')).animationDuration) * 1000;
  if (lap > 0) ring.style.setProperty('--rad-a-busy-phase', `${-(performance.now() % lap)}ms`);

  el._radBusy = ring;
  el.setAttribute('aria-busy', 'true');
  present(ring);
}

/** ¿Está cargando? */
export function isBusy(el) {
  return Boolean(el._radBusy && el._radBusy.isConnected && !leaving(el._radBusy));
}
