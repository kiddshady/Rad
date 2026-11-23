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
 * Presencia: la entrada y la salida de algo que aparece y se va (un menú, un
 * modal, un toast, un tooltip). El CSS del núcleo engancha las animaciones en
 * [data-rad-presence][data-state=open|closing]; cada componente dice cuáles
 * con --rad-a-in y --rad-a-out.
 *
 * present(el): entra. Al terminar se asienta (is-settled apaga la animación):
 * una opacidad retenida le cortaría el vidrio a lo de adentro. Con
 * { settle: false } la entrada queda retenida; es para lo que tiene sombra
 * grande (el modal), que si se asienta cambia de capa y la sombra salta.
 */
export function present(el, { settle = true } = {}) {
  el.setAttribute('data-rad-presence', '');
  el.dataset.state = 'open';
  if (!settle) return;
  const done = () => {
    el.removeEventListener('animationend', onEnd);
    if (el.dataset.state === 'open') el.classList.add('is-settled');
  };
  const onEnd = (e) => { if (e.target === el) done(); };
  el.addEventListener('animationend', onEnd);
  setTimeout(done, ms('dur-slow') + SAFETY_MS);
}

/**
 * dismiss(el): sale y, cuando termina de irse, sale del DOM. Devuelve una
 * promesa que se cumple cuando ya no está. Si todavía venía entrando, no
 * arranca la salida desde entero (saltaría): da vuelta la entrada desde donde
 * iba.
 */
export function dismiss(el, { remove = true } = {}) {
  if (el._radDismiss) return el._radDismiss;
  el._radDismiss = new Promise((resolve) => {
    const finish = () => {
      if (remove) el.remove();
      resolve();
    };
    const entering = !el.classList.contains('is-settled') && el.dataset.state === 'open'
      ? el.getAnimations().find((a) => a.playState === 'running' && a.effect?.target === el)
      : null;
    if (entering) {
      el.setAttribute('data-rad-leaving', '');
      const left = Number(entering.currentTime) || 0;
      entering.reverse();
      whenDone(entering, left + SAFETY_MS, finish);
      return;
    }
    el.classList.remove('is-settled');
    el.dataset.state = 'closing';
    const onEnd = (e) => { if (e.target === el) { el.removeEventListener('animationend', onEnd); clearTimeout(timer); finish(); } };
    el.addEventListener('animationend', onEnd);
    const timer = setTimeout(() => { el.removeEventListener('animationend', onEnd); finish(); }, ms('dur-base') + SAFETY_MS);
  });
  return el._radDismiss;
}

/**
 * FLIP: corre mutate() (que mueve cosas de lugar) y hace viajar a cada hijo
 * de container desde donde estaba hasta donde quedó, con transform. Se suma
 * (composite add) a lo que el hijo ya esté animando, como su entrada.
 */
export function flip(container, mutate, { skip = () => false } = {}) {
  const kids = [...container.children].filter((k) => !skip(k));
  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect().top]));
  mutate();
  const dur = ms('dur-base');
  const easing = token('ease-in-out');
  for (const [k, top] of before) {
    if (!k.isConnected || skip(k)) continue;
    const dy = top - k.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;
    k.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }], { duration: dur, easing, composite: 'add' });
  }
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
