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
    // Lo que ya se está yendo no se asienta: apagarle la animación lo
    // devolvería entero a la vista.
    if (el.dataset.state === 'open' && !el.hasAttribute('data-rad-leaving')) el.classList.add('is-settled');
  };
  const onEnd = (e) => { if (e.target === el) done(); };
  el.addEventListener('animationend', onEnd);
  setTimeout(done, ms('dur-slow') + SAFETY_MS);
}

/**
 * dismiss(el): sale y, cuando termina de irse, sale del DOM. Devuelve una
 * promesa que se cumple cuando ya no está.
 *
 * Si todavía venía entrando, no arranca la salida de CSS (empieza desde
 * entero: saltaría). Pone encima una animación propia desde la opacidad que
 * tiene ahora hasta 0. No da vuelta la entrada de CSS: el CSS es dueño de esa
 * animación y la puede cancelar (al asentarse), y entonces la salida se
 * cancelaba con ella y el elemento quedaba entero y pegado para siempre
 * (los tooltips al recorrer con Tab, nov 2026). Pase lo que pase con las
 * animaciones, sale del DOM al terminar o al vencer su plazo.
 */
export function dismiss(el, { remove = true } = {}) {
  if (el._radDismiss) return el._radDismiss;
  el._radDismiss = new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (remove) el.remove();
      resolve();
    };
    const notSettled = !el.classList.contains('is-settled') && el.dataset.state === 'open';
    // Todavía no se llegó a ver (la entrada no pintó ni un cuadro): se va
    // directo. Arrancarle la salida la mostraría entera para desvanecerla.
    if (notSettled && opacityNow(el) < 0.02) {
      finish();
      return;
    }
    // "Venía entrando" = su entrada todavía corre. Lo que no se asienta nunca
    // (el modal) y ya terminó de entrar sale con su salida de CSS.
    const entering = notSettled && el.getAnimations().some((a) => a.playState === 'running' && a.effect?.target === el);
    if (entering) {
      el.setAttribute('data-rad-leaving', '');
      const from = opacityNow(el);
      const dur = ms('dur-fast') * from;
      const out = el.animate([{ opacity: from }, { opacity: 0 }], { duration: dur, easing: token('ease-in-out'), fill: 'forwards' });
      out.finished.then(finish, finish);
      setTimeout(finish, dur + SAFETY_MS);
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
  // Primero se miden todos y después se anima: intercalado, cada animación
  // obliga a remaquetar para la medición que sigue (ver reconcile en list.js).
  const moves = [];
  for (const [k, top] of before) {
    if (!k.isConnected || skip(k)) continue;
    const dy = top - k.getBoundingClientRect().top;
    if (Math.abs(dy) >= 0.5) moves.push([k, dy]);
  }
  for (const [k, dy] of moves) {
    k.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }], { duration: dur, easing, composite: 'add' });
  }
}

/**
 * Relevo chico: cambia el texto de una celda .rad-swap. Lo viejo sube apenas
 * y se esfuma; recién cuando ya no se ve, lo nuevo entra subiendo desde abajo.
 * Nunca están las dos frases a la vista: en el mismo lugar, dos textos
 * encimados se leen como letras rotas (Fran lo vio en la statusbar, nov 2026:
 * el nuevo asomaba con el viejo todavía al 9 %).
 * El primer llenado no es un cambio: aparece sin relevo.
 *
 * Los ítems se alinean al lado de la celda (--rad-a-swap-align en el CSS):
 * si no, en una celda alineada a la derecha la frase nueva nacía a la
 * izquierda del ancho de la vieja y saltaba cuando la vieja salía del DOM.
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

  const outDur = ms('dur-fast');
  const inDur = ms('dur-base');
  const lift = (parseFloat(token('space-1')) || 4) / 2;

  // Lo viejo sale desde donde está ahora (puede venir entrando).
  const from = opacityNow(live);
  cancelAll(live);
  live.classList.add('rad-swap-out');
  live.setAttribute('aria-hidden', 'true');
  const outTime = outDur * from;
  const out = live.animate(
    [{ opacity: from, transform: 'translateY(0px)' }, { opacity: 0, transform: `translateY(${-lift}px)` }],
    { duration: outTime, easing: token('ease-in-out'), fill: 'forwards' },
  );
  whenDone(out, outTime + SAFETY_MS, () => live.remove());

  // Lo nuevo espera a que lo viejo se haya ido del todo.
  cell.append(next);
  const enter = next.animate(
    [{ opacity: 0, transform: `translateY(${lift}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
    { duration: inDur, delay: outTime, easing: token('ease-out'), fill: 'backwards' },
  );
  whenDone(enter, outTime + inDur + SAFETY_MS, () => enter.finish());
}
