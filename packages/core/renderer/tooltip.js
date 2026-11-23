// Rad · tooltips propios. Nunca el title= nativo (lento, sin estilo).
//
//   <button data-rad-tip="Guardar" data-rad-tip-key="Ctrl+S">…</button>
//
// data-rad-tip-side="bottom" lo pone abajo (por defecto va arriba). Se activa
// solo al importar el núcleo (boot.js lo importa): cualquier elemento con
// data-rad-tip lo tiene.
//
// La primera vez espera un poco; si ya había uno abierto hace nada, el
// siguiente sale enseguida (recorrer una barra de botones no hace esperar en
// cada uno). Con el teclado aparece al enfocar.

import { present, dismiss } from './motion.js';
import { layer, place, nextId } from './overlays.js';

const DELAY_MS = 500;
const WARM_MS = 400;

let current = null;
let timer = null;
let warmUntil = 0;

const targetOf = (node) => (node instanceof Element ? node.closest('[data-rad-tip]') : null);

function show(target) {
  const text = target.getAttribute('data-rad-tip');
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'rad-tooltip';
  el.id = nextId('rad-tip');
  el.setAttribute('role', 'tooltip');
  const label = document.createElement('span');
  label.textContent = text;
  el.append(label);
  const key = target.getAttribute('data-rad-tip-key');
  if (key) {
    const kbd = document.createElement('kbd');
    kbd.className = 'rad-tooltip-key';
    kbd.textContent = key;
    el.append(kbd);
  }
  layer().append(el);
  place(el, target, { side: target.getAttribute('data-rad-tip-side') || 'top', align: 'center' });
  present(el);
  target.setAttribute('aria-describedby', el.id);
  current = { el, target };
}

export function hideTooltip() {
  clearTimeout(timer);
  if (!current) return;
  current.target.removeAttribute('aria-describedby');
  dismiss(current.el);
  current = null;
  warmUntil = performance.now() + WARM_MS;
}

function schedule(target) {
  clearTimeout(timer);
  const warm = current || performance.now() < warmUntil;
  if (current) hideTooltip();
  if (warm) show(target);
  else timer = setTimeout(() => { if (target.isConnected) show(target); }, DELAY_MS);
}

document.addEventListener('pointerover', (e) => {
  const t = targetOf(e.target);
  if (!t || t === current?.target) return;
  schedule(t);
});
document.addEventListener('pointerout', (e) => {
  const t = targetOf(e.target);
  if (!t) return;
  if (t.contains(e.relatedTarget)) return;
  if (current?.target === t) hideTooltip();
  else clearTimeout(timer);
});
document.addEventListener('focusin', (e) => {
  const t = targetOf(e.target);
  if (t && t !== current?.target && t.matches(':focus-visible')) {
    if (current) hideTooltip();
    show(t);
  }
});
document.addEventListener('focusout', (e) => {
  if (current && targetOf(e.target) === current.target) hideTooltip();
});
for (const type of ['pointerdown', 'wheel', 'keydown']) {
  document.addEventListener(type, () => hideTooltip(), true);
}
window.addEventListener('blur', hideTooltip);
window.addEventListener('resize', hideTooltip);
