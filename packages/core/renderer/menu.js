// Rad · menús.
//
//   import { menuButton } from '/@core/menu.js';
//   menuButton(boton, () => [
//     { id: 'dup', label: 'Duplicar', icon: '<svg…>', shortcut: 'Ctrl+D', onSelect() { … } },
//     { separator: true },
//     { id: 'del', label: 'Eliminar', danger: true, onSelect() { … } },
//   ]);
//
// Uno solo abierto a la vez. Se maneja con el teclado (flechas, Inicio, Fin,
// Enter, Escape) y el foco queda en el menú, no en los items: el item activo
// se marca con aria-activedescendant. Mover el foco item por item por código
// prendería el anillo de teclado aunque se esté usando el mouse.
//
// La trampa del ancla: el menú se cierra con un pointerdown afuera, y si ese
// afuera es su propio botón, el click que sigue lo volvería a abrir. El botón
// se acuerda de que acaba de cerrarlo y se traga ese click.

import { present, dismiss } from './motion.js';
import { layer, place, pushOverlay, nextId } from './overlays.js';

let openMenuHandle = null;

export function closeMenus() {
  openMenuHandle?.close({ restoreFocus: false });
}

const CHECK_ICON = '<svg viewBox="0 0 16 16" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

// activate: 'first' | 'last' | un índice (entre los items, sin contar
// separadores). matchAnchorWidth: el menú es por lo menos tan ancho como su
// ancla, para un desplegable que calza con su botón; un contextual no lo usa.
export function openMenu({ anchor, items, side = 'bottom', align = 'start', activate = null, matchAnchorWidth = false, onClose } = {}) {
  closeMenus();

  const el = document.createElement('div');
  el.className = 'rad-menu';
  el.id = nextId('rad-menu');
  el.tabIndex = -1;
  el.setAttribute('role', 'menu');

  const rows = [];
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'rad-menu-sep';
      sep.setAttribute('role', 'separator');
      el.append(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'rad-menu-item';
    row.id = nextId('rad-menu-item');
    row.setAttribute('role', item.checked !== undefined ? 'menuitemradio' : 'menuitem');
    if (item.checked !== undefined) row.setAttribute('aria-checked', String(Boolean(item.checked)));
    if (item.danger) row.dataset.variant = 'danger';
    if (item.disabled) row.setAttribute('aria-disabled', 'true');
    const icon = document.createElement('span');
    icon.className = 'rad-icon';
    if (item.checked) icon.innerHTML = CHECK_ICON;
    else if (item.icon) icon.innerHTML = item.icon;
    const label = document.createElement('span');
    label.className = 'rad-menu-label';
    label.textContent = item.label;
    row.append(icon, label);
    if (item.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'rad-menu-key';
      kbd.textContent = item.shortcut;
      row.append(kbd);
    }
    el.append(row);
    rows.push({ row, item });
  }

  layer().append(el);
  if (matchAnchorWidth && anchor instanceof Element) el.style.minWidth = `${anchor.offsetWidth}px`;
  place(el, anchor, { side, align });
  present(el);
  anchor?.setAttribute('aria-expanded', 'true');
  anchor?.setAttribute('aria-controls', el.id);

  let active = -1;
  const enabled = (i) => rows[i] && !rows[i].item.disabled;
  const setActive = (i) => {
    if (active >= 0) rows[active]?.row.classList.remove('is-active');
    active = i;
    if (i >= 0) {
      rows[i].row.classList.add('is-active');
      el.setAttribute('aria-activedescendant', rows[i].row.id);
      rows[i].row.scrollIntoView({ block: 'nearest' });
    } else {
      el.removeAttribute('aria-activedescendant');
    }
  };
  const step = (dir) => {
    if (!rows.length) return;
    let i = active;
    for (let n = 0; n < rows.length; n++) {
      i = (i + dir + rows.length) % rows.length;
      if (enabled(i)) return setActive(i);
    }
  };
  const edge = (fromEnd) => {
    const order = rows.map((_, i) => i);
    if (fromEnd) order.reverse();
    const i = order.find(enabled);
    if (i !== undefined) setActive(i);
  };

  let closed = false;
  const popStack = pushOverlay({ onEscape: () => close({ restoreFocus: true }) });

  const onOutside = (e) => {
    if (el.contains(e.target)) return;
    if (anchor && anchor.contains(e.target)) {
      anchor._radJustClosed = true;
      setTimeout(() => { if (anchor) anchor._radJustClosed = false; }, 400);
    }
    close({ restoreFocus: false });
  };
  const onBlur = () => close({ restoreFocus: false });

  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    popStack();
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onBlur);
    anchor?.setAttribute('aria-expanded', 'false');
    if (openMenuHandle === handle) openMenuHandle = null;
    const hadFocus = el.contains(document.activeElement);
    dismiss(el);
    if (restoreFocus && hadFocus) anchor?.focus({ preventScroll: true });
    onClose?.();
  }

  const select = (i) => {
    if (!enabled(i)) return;
    const { item } = rows[i];
    close({ restoreFocus: true });
    item.onSelect?.(item);
  };

  el.addEventListener('pointermove', (e) => {
    const i = rows.findIndex((r) => r.row.contains(e.target));
    if (i !== active) setActive(enabled(i) ? i : -1);
  });
  el.addEventListener('pointerleave', () => setActive(-1));
  el.addEventListener('click', (e) => {
    const i = rows.findIndex((r) => r.row.contains(e.target));
    if (i >= 0) select(i);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); edge(false); }
    else if (e.key === 'End') { e.preventDefault(); edge(true); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active >= 0) select(active); }
    else if (e.key === 'Tab') { e.preventDefault(); close({ restoreFocus: true }); }
  });

  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  el.focus({ preventScroll: true });
  if (activate === 'first') edge(false);
  else if (activate === 'last') edge(true);
  else if (Number.isInteger(activate) && enabled(activate)) setActive(activate);

  const handle = { el, anchor, close };
  openMenuHandle = handle;
  return handle;
}

/** Engancha un botón que abre y cierra un menú. getItems() se llama en cada
    apertura, así el menú refleja el estado del momento. */
export function menuButton(anchor, getItems, options = {}) {
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');
  const open = (activate) => openMenu({ anchor, items: getItems(), activate, ...options });
  anchor.addEventListener('click', (e) => {
    if (anchor._radJustClosed) { anchor._radJustClosed = false; return; }
    if (openMenuHandle?.anchor === anchor) { openMenuHandle.close(); return; }
    // detail 0 = el click vino del teclado (Enter o Espacio): se activa el primero.
    open(e.detail === 0 ? 'first' : null);
  });
  anchor.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (openMenuHandle?.anchor !== anchor) open(e.key === 'ArrowDown' ? 'first' : 'last');
    }
  });
}
