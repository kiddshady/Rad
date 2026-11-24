// Rad · listas que se ponen al día por clave.
//
//   import { reconcile } from '/@core/list.js';
//   reconcile(lista, chats, {
//     key: (chat) => chat.id,
//     create: (chat) => fila(chat),          // arma el nodo de un item nuevo
//     update: (nodo, chat) => { … },         // pone al día el de uno que sigue
//   });
//
// Una lista que ya se ve no se rehace: se pone al día. Rehacerla (vaciar y
// volver a llenar) corta todo lo que estaba a la vista, reinicia las entradas
// y pierde el foco y el hover de las filas que seguían. Acá:
//   - el que sigue es el MISMO nodo, y si cambió de lugar viaja hasta él;
//   - el que se va sale del flujo en su lugar y se esfuma, mientras los demás
//     se acomodan; recién cuando terminó de irse sale del DOM;
//   - el nuevo entra fundiéndose, y si hay alguno yéndose espera a que casi
//     no se vea;
//   - el primer llenado no es un cambio: aparece sin entrada (salvo que se
//     pida con animateFirst).
//
// El contenedor queda a cargo de reconcile: sus hijos son los items. La
// entrada, la salida y el viaje los pone este módulo, así que las filas no
// llevan una animación de entrada propia en el CSS (mover un nodo de lugar
// se la reiniciaría).

import { ms, token, opacityNow, whenDone, SAFETY_MS } from './motion.js';

const leaving = (el) => el.hasAttribute('data-rad-leaving');
const keyOf = (el) => el.dataset.radKey;

export function reconcile(container, items, { key, create, update, animateFirst = false } = {}) {
  if (typeof key !== 'function' || typeof create !== 'function') throw new Error('[rad] reconcile necesita key y create');
  const first = !container._radList;
  container._radList = true;
  // Los que se van quedan absolutos en su lugar: el contenedor es su marco.
  container.classList.add('rad-list');

  const live = new Map();
  for (const el of container.children) {
    if (!leaving(el) && keyOf(el) !== undefined) live.set(keyOf(el), el);
  }
  const wanted = items.map((item) => ({ item, k: String(key(item)) }));
  const keep = new Set(wanted.map((w) => w.k));
  if (keep.size !== wanted.length) throw new Error('[rad] reconcile: hay claves repetidas');

  // Dónde está cada uno antes de tocar nada (para el viaje), y dónde está el
  // contenedor: el viaje se mide CONTRA ÉL, no contra la ventana.
  const origin = container.getBoundingClientRect();
  const before = new Map();
  for (const el of live.values()) before.set(el, el.getBoundingClientRect());

  // Los que se van. Las cajas se miden todas ANTES de sacar a ninguno del
  // flujo: sacar uno corre a los que tiene abajo.
  const gone = [...live.values()].filter((el) => !keep.has(keyOf(el)));
  const boxes = gone.map((el) => ({ el, left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }));
  const outDur = ms('dur-fast');
  for (const { el, left, top, width, height } of boxes) {
    const from = opacityNow(el);
    el.setAttribute('data-rad-leaving', '');
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    el.style.position = 'absolute';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.margin = '0';
    const dur = outDur * from;
    const out = el.animate([{ opacity: from }, { opacity: 0 }], { duration: dur, easing: token('ease-in-out'), fill: 'forwards' });
    // Sale del DOM al terminar, al vencer su plazo, y también si la cancelan.
    let removed = false;
    const remove = () => { if (!removed) { removed = true; el.remove(); } };
    out.finished.then(remove, remove);
    setTimeout(remove, dur + SAFETY_MS);
  }

  // Los que quedan y los nuevos, en orden. Un nodo solo se mueve si no está
  // donde tiene que estar: los que ya estaban bien no se tocan.
  const entered = [];
  const nextLive = (node) => {
    while (node && leaving(node)) node = node.nextElementSibling;
    return node;
  };
  let cursor = nextLive(container.firstElementChild);
  for (const { item, k } of wanted) {
    let el = live.get(k);
    if (el) {
      update?.(el, item);
    } else {
      el = create(item);
      el.dataset.radKey = k;
      entered.push(el);
    }
    if (el === cursor) cursor = nextLive(el.nextElementSibling);
    else container.insertBefore(el, cursor);
  }

  // El viaje (FLIP) de los que siguen. Se suma a lo que ya estén animando:
  // si venían viajando de un cambio anterior, siguen desde donde iban.
  //
  // Tres cuidados, y los tres salieron de un chat de 700 mensajes que dejaba
  // la ventana congelada 7 segundos cada vez que entraba una fila:
  //   - Se mide contra el contenedor. Si lo que cambió fue el scroll (al
  //     insertar un nodo, el navegador lo corrige solo para que lo que se
  //     estaba leyendo no salte), contra la ventana «se movieron» todos, y
  //     todos salían a viajar para quedarse donde estaban.
  //   - Primero se miden TODOS y recién después se anima. Intercalado, cada
  //     animación ensucia el estilo y la medición siguiente obliga a
  //     remaquetar la lista entera: una maquetación por fila.
  //   - El que está fuera de la ventana antes y después no viaja: nadie lo ve.
  const dur = ms('dur-base');
  const easing = token('ease-in-out');
  const frame = container.getBoundingClientRect();
  const shiftX = frame.left - origin.left;
  const shiftY = frame.top - origin.top;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const seen = (left, top, r) => left < vw && left + r.width > 0 && top < vh && top + r.height > 0;
  const moves = [];
  for (const [el, rect] of before) {
    if (leaving(el)) continue;
    const now = el.getBoundingClientRect();
    // (dónde estaba, en las coordenadas de ahora)
    const wasLeft = rect.left + shiftX;
    const wasTop = rect.top + shiftY;
    const dx = wasLeft - now.left;
    const dy = wasTop - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    if (!seen(now.left, now.top, now) && !seen(wasLeft, wasTop, rect)) continue;
    moves.push([el, dx, dy]);
  }
  for (const [el, dx, dy] of moves) {
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], { duration: dur, easing, composite: 'add' });
  }

  // La entrada de los nuevos. Con alguno yéndose, esperan a que casi no se vea.
  if (!first || animateFirst) {
    const delay = gone.length ? outDur * 0.7 : 0;
    const lift = (parseFloat(token('space-1')) || 0) / 2;
    for (const el of entered) {
      const enter = el.animate(
        [{ opacity: 0, transform: `translateY(${lift}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
        { duration: dur, delay, easing: token('ease-out'), fill: 'backwards' },
      );
      whenDone(enter, delay + dur + SAFETY_MS, () => enter.finish());
    }
  }

  return { entered, kept: [...before.keys()].filter((el) => !leaving(el)), left: gone };
}
