// Rad · capa de overlays.
//
// Todo lo que flota (menús, modales, toasts, tooltips) vive en una sola capa
// fija, hermana de .rad-root y no adentro: así no hereda la animación de la
// raíz ni queda atrapado en un transform. Lo último que se abre queda encima,
// que es lo que se quiere: un menú abierto desde un modal va sobre el modal.
//
// La pila decide quién atiende el Escape: siempre el de más arriba.

import { token } from './motion.js';

let layerEl = null;
const stack = [];

export function layer() {
  if (!layerEl) {
    layerEl = document.createElement('div');
    layerEl.className = 'rad-overlays';
    document.body.append(layerEl);
  }
  return layerEl;
}

/** Suma un overlay a la pila. Devuelve la función que lo saca. */
export function pushOverlay(entry) {
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack.at(-1);
  if (!top.onEscape) return;
  e.preventDefault();
  e.stopPropagation();
  top.onEscape();
}, true);

/** Un token de medida en píxeles: px('space-2') -> 8. */
export function px(name) {
  return parseFloat(token(name)) || 0;
}

/**
 * Coloca el = position: fixed junto a anchor (un elemento o un DOMRect).
 * side: 'bottom' | 'top' (se da vuelta si no entra); align: 'start' |
 * 'center' | 'end'. Mide con offsetWidth/Height, que no cuentan el transform
 * de la entrada: el lugar es el de reposo. Devuelve el lado que usó.
 */
export function place(el, anchor, { side = 'bottom', align = 'start', gap = px('space-1') } = {}) {
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const margin = px('space-2');
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const below = r.bottom + gap;
  const above = r.top - gap - h;
  let used = side;
  if (side === 'bottom' && below + h > vh - margin && above >= margin) used = 'top';
  if (side === 'top' && above < margin && below + h <= vh - margin) used = 'bottom';
  let top = used === 'bottom' ? below : above;
  top = Math.min(Math.max(top, margin), Math.max(margin, vh - h - margin));

  let left = align === 'center' ? r.left + r.width / 2 - w / 2 : align === 'end' ? r.right - w : r.left;
  left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin));

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.dataset.side = used;
  return used;
}

let uid = 0;
export const nextId = (prefix) => `${prefix}-${++uid}`;

/** Los elementos que reciben el foco con Tab dentro de root. */
export function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && !el.closest('[inert]') && el.getClientRects().length);
}
