// Rad · controles que necesitan JS. Los demás (campo, check, radio, switch,
// botón de ícono) son HTML con clases rad-* y no necesitan nada:
//
//   <label class="rad-field">
//     <span class="rad-field-label">Nombre</span>
//     <input class="rad-input" type="text">
//     <span class="rad-field-hint">Como aparece en las recetas.</span>
//   </label>
//
//   <label class="rad-check"><input type="checkbox"><span class="rad-check-box"></span>Recordarme</label>
//   <label class="rad-radio"><input type="radio" name="x"><span class="rad-radio-dot"></span>Uno</label>
//   <label class="rad-switch"><input type="checkbox" role="switch"><span class="rad-switch-track"></span>Sonido</label>
//
// Son inputs nativos de verdad (formularios, teclado, lectores de pantalla),
// escondidos y dibujados encima: nada del control de Chromium se ve.

import { swapText } from './motion.js';
import { openMenu, closeMenus } from './menu.js';
import { t } from './strings.js';

const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>';

/** Completa lo que el HTML no trae: el tilde dibujado de cada check. Lo
    llama boot.js al arrancar y cualquiera que agregue checks después. */
export function wireControls(root = document) {
  for (const box of root.querySelectorAll('.rad-check-box:empty')) box.innerHTML = CHECK_SVG;
  for (const field of root.querySelectorAll('.rad-field')) ensureErrorSlot(field);
}

function ensureErrorSlot(field) {
  let slot = field.querySelector(':scope > .rad-field-error');
  if (!slot) {
    slot = document.createElement('span');
    slot.className = 'rad-field-error';
    const inner = document.createElement('span');
    inner.className = 'rad-field-error-text rad-swap';
    inner.setAttribute('aria-live', 'polite');
    slot.append(inner);
    field.append(slot);
  }
  return slot;
}

/**
 * Marca un campo con error (o lo limpia con null). El renglón del error se
 * despliega en vez de aparecer, y si cambia de mensaje, se releva.
 */
export function setFieldError(field, message) {
  const slot = ensureErrorSlot(field);
  const input = field.querySelector('.rad-input, input, textarea');
  const on = Boolean(message);
  field.toggleAttribute('data-invalid', on);
  input?.setAttribute('aria-invalid', String(on));
  if (on) swapText(slot.firstElementChild, message);
}

/**
 * Un select propio: un botón que despliega un menú del ancho del botón. El
 * select nativo abre una lista de Chromium que no se puede vestir.
 *
 *   const s = createSelect({
 *     options: [{ value: 'a', label: 'Uno' }, { value: 'b', label: 'Dos' }],
 *     value: 'a',
 *     onChange(value) { … },
 *   });
 *   form.append(s.el);   s.value;   s.value = 'b';
 *
 * Una etiqueta que no entra en el botón se corta con puntos suspensivos (el
 * chevron no se mueve de su lugar) y el botón muestra la etiqueta entera en
 * un tooltip.
 */
export function createSelect({ options, value, placeholder = t.choose, onChange, label } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'rad-select';
  if (label) el.setAttribute('aria-label', label);
  el.setAttribute('aria-haspopup', 'menu');
  el.setAttribute('aria-expanded', 'false');
  const text = document.createElement('span');
  text.className = 'rad-select-value rad-swap';
  const chevron = document.createElement('span');
  chevron.className = 'rad-icon rad-select-chevron';
  chevron.innerHTML = CHEVRON;
  el.append(text, chevron);

  let current = options.some((o) => o.value === value) ? value : null;
  const show = () => {
    const opt = options.find((o) => o.value === current);
    el.toggleAttribute('data-empty', !opt);
    swapText(text, opt ? opt.label : placeholder);
  };
  show();

  let open = null;
  const toggle = (byKeyboard) => {
    if (open) { open.close(); return; }
    const index = options.findIndex((o) => o.value === current);
    open = openMenu({
      anchor: el,
      matchAnchorWidth: true,
      activate: byKeyboard ? (index >= 0 ? index : 'first') : null,
      items: options.map((o) => ({
        id: o.value,
        label: o.label,
        disabled: o.disabled,
        checked: o.value === current,
        onSelect: () => api.set(o.value, { emit: true }),
      })),
      onClose: () => {
        open = null;
        el.setAttribute('aria-expanded', 'false');
      },
    });
    el.setAttribute('aria-expanded', 'true');
  };

  // La etiqueta cortada se lee entera en el tooltip del botón. Se mide al
  // llegar (con el mouse o con el foco), antes de que el tooltip mire el
  // atributo: el ancho del botón puede haber cambiado desde que se eligió.
  // Un data-rad-tip que haya puesto la app no se toca.
  let ownTip = false;
  const syncTip = () => {
    if (el.hasAttribute('data-rad-tip') && !ownTip) return;
    const live = text.querySelector(':scope > :not(.rad-swap-out)');
    const cut = Boolean(live) && live.scrollWidth > live.clientWidth;
    ownTip = cut;
    if (cut) el.setAttribute('data-rad-tip', live.textContent);
    else el.removeAttribute('data-rad-tip');
  };
  el.addEventListener('pointerover', syncTip);
  el.addEventListener('focus', syncTip);

  // La trampa del ancla, igual que en menuButton: el pointerdown sobre el
  // botón cierra el menú (openMenu lo marca en _radJustClosed), y el click
  // que sigue no tiene que reabrirlo.
  el.addEventListener('click', (e) => {
    if (el._radJustClosed) { el._radJustClosed = false; return; }
    toggle(e.detail === 0);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
      e.preventDefault();
      toggle(true);
    }
  });

  const api = {
    el,
    get value() { return current; },
    set value(v) { api.set(v); },
    set(v, { emit = false } = {}) {
      if (!options.some((o) => o.value === v) || v === current) return;
      current = v;
      show();
      if (emit) onChange?.(v);
    },
    close: () => { open?.close(); closeMenus(); },
  };
  return api;
}
