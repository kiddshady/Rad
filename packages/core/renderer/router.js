// Rad · router de vistas.
//
// Cada vista es una superficie entera, así que el cambio es un FUNDIDO, no un
// relevo con espera (que destaparía media pantalla en el medio):
//   - la nueva está entera y quieta debajo desde el primer cuadro;
//   - la vieja queda encima, opaca, y lo único que se mueve es su opacidad,
//     en ease-in-out. La pantalla está tapada en todo momento;
//   - si ya había otra yéndose (dos cambios seguidos), la nueva que se va
//     queda DEBAJO de esa: el cuadro siguiente es igual al anterior;
//   - si se vuelve a una vista que se estaba yendo, vuelve a subir desde la
//     opacidad que tenía, sin saltar.
//
// Las vistas se montan la primera vez que se visitan y quedan vivas: al volver
// conservan su scroll y su estado. Las ocultas van con visibility e inert, no
// con display: none, que tira el scroll.

import { ms, token, whenDone, opacityNow, SAFETY_MS } from './motion.js';
import { wireScroll } from './scroll.js';
import { wireControls } from './controls.js';

const Z_ACTIVE = '1';
const Z_LEAVING_TOP = 1000;

export function createRouter({ stage, views, initial }) {
  const events = new EventTarget();
  const entries = new Map();
  let current = null;
  let leaveSeq = 0;

  for (const def of views) {
    const el = document.createElement('section');
    el.className = 'rad-view';
    el.dataset.view = def.id;
    el.dataset.state = 'hidden';
    el.inert = true;
    if (def.scroll !== false) el.classList.add('rad-scroll');
    // Una vista de hojas (core 0.21.0): en vez de ser una superficie entera,
    // se reparte en hojas sueltas (.rad-sheet) con aire entre ellas. La piel
    // pinta la vista como el telón y cada hoja como el escenario.
    if (def.sheets === true) el.dataset.radSheets = '';
    if (def.label) el.setAttribute('aria-label', def.label);
    stage.append(el);
    entries.set(def.id, { def, el, mounted: false, stopWait: null, anim: null });
  }

  const stopAnim = (entry) => {
    entry.stopWait?.();
    entry.stopWait = null;
    entry.anim?.cancel();
    entry.anim = null;
  };

  const hide = (entry) => {
    stopAnim(entry);
    entry.el.dataset.state = 'hidden';
    entry.el.inert = true;
    entry.el.style.zIndex = '';
    // (terminó de irse la última que se iba: el cambio de forma también)
    if (![...entries.values()].some((e) => e.el.dataset.state === 'leaving')) stage.removeAttribute('data-rad-sheets-swap');
  };

  const activate = (entry) => {
    entry.el.dataset.state = 'active';
    entry.el.inert = false;
    entry.el.style.zIndex = Z_ACTIVE;
    if (!entry.mounted) {
      entry.mounted = true;
      entry.def.mount?.(entry.el, api);
      if (entry.el.classList.contains('rad-scroll')) wireScroll(entry.el);
      wireControls(entry.el);
    }
  };

  const leave = (entry) => {
    const from = opacityNow(entry.el);
    stopAnim(entry);
    entry.el.dataset.state = 'leaving';
    entry.el.inert = true;
    // Más nueva = más abajo, pero siempre encima de la activa.
    entry.el.style.zIndex = String(Math.max(2, Z_LEAVING_TOP - ++leaveSeq));
    const dur = ms('dur-base') * from;
    entry.anim = entry.el.animate([{ opacity: from }, { opacity: 0 }], { duration: dur, easing: token('ease-in-out'), fill: 'forwards' });
    entry.stopWait = whenDone(entry.anim, dur + SAFETY_MS, () => hide(entry));
  };

  // Vuelve una vista que se estaba yendo: sube desde donde iba, encima de la
  // que la había reemplazado, y recién arriba del todo baja a su lugar.
  const comeBack = (entry, others) => {
    const from = opacityNow(entry.el);
    stopAnim(entry);
    entry.el.dataset.state = 'active';
    entry.el.inert = false;
    const dur = ms('dur-base') * (1 - from);
    entry.anim = entry.el.animate([{ opacity: from }, { opacity: 1 }], { duration: dur, easing: token('ease-in-out') });
    entry.stopWait = whenDone(entry.anim, dur + SAFETY_MS, () => {
      entry.anim?.cancel();
      entry.anim = null;
      entry.stopWait = null;
      entry.el.style.zIndex = Z_ACTIVE;
      for (const other of others) if (other !== current && other.el.dataset.state === 'active') hide(other);
    });
  };

  function go(id, { instant = false } = {}) {
    const next = entries.get(id);
    if (!next) throw new Error(`[rad] no hay ninguna vista "${id}"`);
    // 'go' avisa de CADA pedido de ir a una vista, también a la que ya se ve:
    // lo que flota encima (un modal de ajustes) lo usa para cerrarse. 'change'
    // sigue avisando solo cuando la vista cambia.
    events.dispatchEvent(new CustomEvent('go', { detail: { id, from: current?.def.id ?? null } }));
    if (next === current) return;
    const prev = current;
    current = next;
    // Mientras se ve una vista de hojas, el escenario lo sabe: la piel le
    // apaga su canto y su sombra (las hojas traen los suyos), fundiéndolos a
    // la par del cambio de vista.
    stage.toggleAttribute('data-rad-sheets', next.def.sheets === true);
    // Y mientras dura un cambio de FORMA (de una vista de hojas a una común o
    // al revés), lo marca hasta que la que se va termina de irse (core
    // 0.21.4): lo que la piel pinta encima de todo en el escenario (el canto
    // de glass) no puede seguir ahí, dibujado sobre las hojas de la otra; lo
    // lleva la vista común, y se funde con ella. Fran lo vio en BlackCode al
    // pasar de Memory a Notes: la línea del canto cruzaba por encima de las
    // hojas, por el aire del medio y por la esquina.
    if (!instant && prev && (prev.def.sheets === true) !== (next.def.sheets === true)) stage.setAttribute('data-rad-sheets-swap', '');

    if (next.el.dataset.state === 'leaving' && !instant) {
      comeBack(next, prev ? [prev] : []);
    } else {
      stopAnim(next);
      activate(next);
      if (prev) {
        if (instant) hide(prev);
        else leave(prev);
      }
    }
    if (!next.mounted) activate(next);

    events.dispatchEvent(new CustomEvent('change', { detail: { id, from: prev?.def.id ?? null, label: next.def.label } }));
  }

  const api = {
    go,
    get current() { return current?.def.id ?? null; },
    get views() { return views.map((v) => v.id); },
    viewEl: (id) => entries.get(id)?.el ?? null,
    on: (type, fn) => {
      const listener = (e) => fn(e.detail);
      events.addEventListener(type, listener);
      return () => events.removeEventListener(type, listener);
    },
  };

  if (initial ?? views[0]?.id) go(initial ?? views[0].id, { instant: true });
  return api;
}
