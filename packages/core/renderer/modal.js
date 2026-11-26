// Rad · modales.
//
//   import { openModal, confirm } from '/@core/modal.js';
//   const m = openModal({
//     title: 'Renombrar',
//     body: nodoOTexto,
//     actions: [
//       { id: 'cancel', label: 'Cancelar' },
//       { id: 'ok', label: 'Guardar', variant: 'primary', onClick() { … } },
//     ],
//   });
//   const resultado = await m.closed;   // el id de la acción, o 'dismiss'
//   await m.removed;                    // …y cuando terminó de irse y salió del documento
//
//   if (await confirm({ title: '¿Eliminar?', text: '…', confirmLabel: 'Eliminar', danger: true })) …
//
// `className` le suma clases al panel (un modal con su propia forma: ancho,
// sin relleno) y `label` lo nombra cuando no lleva título.
//
// Mientras hay un modal, la app de atrás queda inert (ni foco ni clicks) y el
// Tab da vueltas adentro del modal. Al cerrar, el foco vuelve a donde estaba.
//
// La entrada del modal no se asienta (present con settle: false): tiene la
// sombra más grande, y al bajar de capa la sombra se repinta distinta y salta.

import { present, dismiss } from './motion.js';
import { layer, pushOverlay, nextId, focusables } from './overlays.js';
import { t } from './strings.js';

let openCount = 0;
const appRoot = () => document.querySelector('.rad-root');

// Con qué se abrió el modal: lo dice la última entrada antes de abrirlo (se
// escucha en captura, antes de que nadie la ataje). Al cerrar, el foco vuelve
// a donde estaba; si el modal se abrió con el puntero, vuelve SIN el anillo.
// Si no, cerrarlo con Enter o Escape (teclas) dejaba a Chromium en modo
// teclado, y lo que recibía el foco prendía :focus-visible: la fila de un chat
// quedaba con el anillo después de renombrarlo (Fran, nov 2026). Abierto con
// el teclado, el anillo vuelve como siempre: ahí dice dónde se está.
let ultimaFueTecla = false;
window.addEventListener('keydown', () => { ultimaFueTecla = true; }, true);
window.addEventListener('pointerdown', () => { ultimaFueTecla = false; }, true);

export function openModal({ title, body, actions = [], dismissible = true, className = '', label = '' } = {}) {
  const previous = document.activeElement;
  const conTeclado = ultimaFueTecla;

  const wrap = document.createElement('div');
  wrap.className = 'rad-modal-layer';
  const scrim = document.createElement('div');
  scrim.className = 'rad-scrim';
  const panel = document.createElement('div');
  panel.className = 'rad-modal';
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  for (const c of String(className).split(/\s+/).filter(Boolean)) panel.classList.add(c);
  if (!title && label) panel.setAttribute('aria-label', label);

  if (title) {
    const h = document.createElement('h2');
    h.className = 'rad-modal-title';
    h.id = nextId('rad-modal-title');
    h.textContent = title;
    panel.setAttribute('aria-labelledby', h.id);
    panel.append(h);
  }
  const content = document.createElement('div');
  content.className = 'rad-modal-body';
  if (body instanceof Node) content.append(body);
  else if (body != null) {
    const p = document.createElement('p');
    p.textContent = String(body);
    content.append(p);
  }
  panel.append(content);

  let autofocus = null;
  if (actions.length) {
    const bar = document.createElement('div');
    bar.className = 'rad-modal-actions';
    for (const action of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rad-button';
      if (action.variant) b.dataset.variant = action.variant;
      b.textContent = action.label;
      b.addEventListener('click', () => {
        const keep = action.onClick?.(api) === false;
        if (!keep && action.close !== false) close(action.id ?? action.label);
      });
      if (action.autofocus || (!autofocus && action.variant === 'primary')) autofocus = b;
      bar.append(b);
    }
    panel.append(bar);
  }

  wrap.append(scrim, panel);
  layer().append(wrap);
  present(scrim);
  present(panel, { settle: false });

  openCount++;
  const root = appRoot();
  if (root) root.inert = true;

  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  let resolveRemoved;
  const removed = new Promise((r) => { resolveRemoved = r; });
  let isClosed = false;
  const popStack = pushOverlay({ onEscape: () => { if (dismissible) close('dismiss'); } });

  function close(result = 'dismiss') {
    if (isClosed) return closed;
    isClosed = true;
    popStack();
    openCount--;
    if (root && openCount === 0) root.inert = false;
    Promise.all([dismiss(panel, { remove: false }), dismiss(scrim, { remove: false })]).then(() => { wrap.remove(); resolveRemoved(); });
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus(conTeclado ? { preventScroll: true } : { preventScroll: true, focusVisible: false });
    resolveClosed(result);
    return closed;
  }

  scrim.addEventListener('click', () => { if (dismissible) close('dismiss'); });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables(panel);
    if (!list.length) { e.preventDefault(); panel.focus(); return; }
    const first = list[0];
    const last = list.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  (panel.querySelector('[data-autofocus]') || autofocus || panel).focus({ preventScroll: true });

  const api = { el: panel, close, closed, removed };
  return api;
}

export function confirm({ title, text, confirmLabel = t.accept, cancelLabel = t.cancel, danger = false } = {}) {
  const m = openModal({
    title,
    body: text,
    actions: [
      { id: 'cancel', label: cancelLabel },
      { id: 'confirm', label: confirmLabel, variant: danger ? 'danger' : 'primary', autofocus: !danger },
    ],
  });
  return m.closed.then((r) => r === 'confirm');
}
