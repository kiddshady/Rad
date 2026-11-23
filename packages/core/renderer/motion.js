// Rad · movimiento.
//
// Las duraciones y las curvas no viven acá: se leen de los tokens de la piel
// en el momento de animar. Así una piel lenta, una seca o una con steps() no
// tocan este archivo.
//
// Reglas que este módulo hace cumplir (salen de bugs reales):
//   - lo que se va termina de irse antes de salir del DOM, y toda salida tiene
//     su plazo de red: una ventana tapada o minimizada no avanza su línea de
//     tiempo y el `finished` puede no llegar nunca;
//   - dos cosas que se reemplazan hacen un relevo en la misma celda, no se
//     enciman ni se ponen al lado;
//   - la salida que otro espera va en ease-in-out, no en ease-in.

const root = () => getComputedStyle(document.documentElement);

/** El valor crudo de un token, sin el prefijo: token('ease-out'). */
export function token(name) {
  return root().getPropertyValue(`--rad-${name}`).trim();
}

/** Un token de duración en milisegundos: ms('dur-base') -> 200. */
export function ms(name) {
  const v = token(name);
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.endsWith('ms') ? n : n * 1000;
}

/** Margen del plazo de red, por encima de la duración de la animación. */
export const SAFETY_MS = 120;

/** Espera a que lo último que se tocó esté pintado: dos cuadros, con un tope
    por si la ventana no está pintando (oculta o minimizada). */
export function raf2(cap = 80) {
  return new Promise((resolve) => {
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(end));
    setTimeout(end, cap);
  });
}

/** Corre fn cuando termina la animación, o cuando vence su plazo de red. Lo
    que llegue primero; nunca las dos veces. */
export function whenDone(animation, timeoutMs, fn) {
  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    fn();
  };
  const stop = () => { fired = true; clearTimeout(timer); };
  const timer = setTimeout(run, timeoutMs);
  // Cancelada: alguien más tomó el control del elemento, y ese decide.
  animation.finished.then(run, stop);
  return stop;
}

/** La opacidad que se ve ahora, para que una animación nueva arranque desde
    ahí y no desde 1 o 0. */
export function opacityNow(el) {
  return parseFloat(getComputedStyle(el).opacity);
}

/** Termina las animaciones de un elemento sin dejarlas retenidas. */
export function cancelAll(el) {
  for (const a of el.getAnimations()) a.cancel();
}

/**
 * Relevo chico: cambia el texto de una celda .rad-swap. Lo viejo se esfuma en
 * su lugar (ease-in-out) y lo nuevo asoma cuando lo viejo va por un tercio.
 * El primer llenado no es un cambio: aparece sin relevo.
 */
export function swapText(cell, text) {
  const live = cell.querySelector(':scope > :not(.rad-swap-out)');
  if (live && live.textContent === text) return;

  const next = document.createElement('span');
  next.textContent = text;

  if (!live) {
    cell.append(next);
    return;
  }

  const dur = ms('dur-base');
  const easeBoth = token('ease-in-out');

  // Lo viejo sale desde la opacidad que tiene ahora (puede venir entrando).
  const from = opacityNow(live);
  cancelAll(live);
  live.classList.add('rad-swap-out');
  live.setAttribute('aria-hidden', 'true');
  const out = live.animate([{ opacity: from }, { opacity: 0 }], { duration: dur * 0.8, easing: easeBoth, fill: 'forwards' });
  whenDone(out, dur * 0.8 + SAFETY_MS, () => live.remove());

  // Lo nuevo espera su turno, salvo que lo viejo ya casi no se viera.
  cell.append(next);
  const delay = from > 0.3 ? dur * 0.45 : 0;
  const enter = next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, easing: token('ease-out'), fill: 'backwards' });
  whenDone(enter, delay + dur + SAFETY_MS, () => enter.finish());
}
