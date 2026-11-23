// Rad · toasts.
//
//   import { toast } from '/@core/toast.js';
//   toast({ text: 'Guardado', kind: 'success' });
//   toast({ text: 'Se borró el archivo', action: { label: 'Deshacer', onClick() { … } } });
//
// kind: 'info' | 'success' | 'warning' | 'danger'. Se apilan abajo a la
// derecha; el nuevo entra abajo y los demás suben viajando (FLIP), y cuando
// uno se va sale del flujo en su lugar mientras los otros se acomodan. El
// tiempo se frena con el mouse encima o con el foco adentro.

import { present, dismiss, flip } from './motion.js';
import { layer } from './overlays.js';

const MAX = 4;
const CLOSE_ICON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg>';

let stackEl = null;
function stack() {
  if (!stackEl) {
    stackEl = document.createElement('div');
    stackEl.className = 'rad-toasts';
    stackEl.setAttribute('aria-live', 'polite');
    layer().append(stackEl);
  }
  return stackEl;
}

const leaving = (el) => el.hasAttribute('data-rad-leaving') || el.dataset.state === 'closing';

export function toast({ text, kind = 'info', duration = 4500, action } = {}) {
  const host = stack();
  const el = document.createElement('div');
  el.className = 'rad-toast';
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');

  const dot = document.createElement('span');
  dot.className = 'rad-toast-dot';
  dot.setAttribute('aria-hidden', 'true');
  const msg = document.createElement('span');
  msg.className = 'rad-toast-text';
  msg.textContent = text;
  el.append(dot, msg);

  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rad-toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.onClick?.(); close(); });
    el.append(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'rad-toast-close';
  x.setAttribute('aria-label', 'Cerrar');
  x.setAttribute('data-rad-tip', 'Cerrar');
  x.innerHTML = CLOSE_ICON;
  x.addEventListener('click', () => close());
  el.append(x);

  flip(host, () => host.append(el), { skip: leaving });
  present(el);

  // Si hay demasiados, se va el más viejo.
  const alive = [...host.children].filter((k) => !leaving(k));
  if (alive.length > MAX) alive[0]._radClose?.();

  let remaining = duration;
  let started = performance.now();
  let timer = duration > 0 ? setTimeout(close, remaining) : null;
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining -= performance.now() - started;
  };
  const resume = () => {
    if (timer || duration <= 0 || closed) return;
    started = performance.now();
    timer = setTimeout(close, Math.max(remaining, 1200));
  };
  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) resume(); });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    // Sale del flujo en su lugar: así los demás se acomodan mientras se va.
    // Se ancla por ABAJO, no por arriba: la pila está pegada al borde de
    // abajo y crece hacia arriba, así que al sacar uno se achica y su borde
    // de arriba baja. Anclado por arriba, el que se va bajaba de golpe con
    // ella (y el último, que la deja vacía, se cortaba contra la ventana).
    flip(host, () => {
      const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = el;
      const fromBottom = host.clientHeight - offsetTop - offsetHeight;
      el.style.position = 'absolute';
      el.style.left = `${offsetLeft}px`;
      el.style.bottom = `${fromBottom}px`;
      el.style.width = `${offsetWidth}px`;
      el.setAttribute('data-rad-leaving', '');
    }, { skip: (k) => k === el || leaving(k) });
    dismiss(el);
  }
  el._radClose = close;
  return { el, close };
}
