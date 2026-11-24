// Rad · shell.
//
// Arma la estructura de la ventana: titlebar propia (con los controles de
// ventana), rail de vistas, el escenario donde viven las vistas y la
// statusbar. Solo estructura y comportamiento: cómo se ve lo pone la piel,
// enganchándose en las clases rad-* de abajo, que son parte de la API.
//
//   import { createShell } from '/@core/shell.js';
//   const shell = createShell({
//     root: document.querySelector('.rad-root'),
//     title: 'Mi app',
//     views: [{ id: 'inicio', label: 'Inicio', icon: '<svg…>', mount(el) { … } }],
//   });
//   shell.router.go('inicio');
//   shell.status.set('left', 'Listo');

import { createRouter } from './router.js';
import { swapText } from './motion.js';
import { t } from './strings.js';

// Los íconos de ventana, dibujados a mano (cero glifos).
const ICONS = {
  minimize: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8"/></svg>',
  maximize: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>',
  restore: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H7"/></svg>',
  close: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
};

function h(tag, className, attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function titlebar({ title, subtitle }) {
  const bar = h('header', 'rad-titlebar', { 'data-rad-chrome': '' });
  const head = h('div', 'rad-titlebar-head');
  const name = h('span', 'rad-titlebar-title');
  name.textContent = title ?? document.title;
  const sub = h('span', 'rad-titlebar-sub rad-swap');
  if (subtitle) swapText(sub, subtitle);
  head.append(name, sub);

  const btns = h('div', 'rad-winbtns');
  const btn = (action, label, html, extra = '') => {
    const b = h('button', `rad-winbtn ${extra}`.trim(), { 'aria-label': label, 'data-action': action, 'data-rad-tip': label, 'data-rad-tip-side': 'bottom', type: 'button' });
    b.innerHTML = html;
    b.addEventListener('click', () => {
      const w = window.rad?.window;
      if (!w) return;
      if (action === 'minimize') w.minimize();
      else if (action === 'toggle-maximize') w.toggleMaximize();
      else if (action === 'close') w.close();
    });
    return b;
  };
  // Maximizar y restaurar viven en la misma celda y se relevan por opacidad.
  const maxIcons = `<span class="rad-winbtn-swap">${ICONS.maximize.replace('<svg', '<svg class="rad-ic-max"')}${ICONS.restore.replace('<svg', '<svg class="rad-ic-restore"')}</span>`;
  const maxBtn = btn('toggle-maximize', t.maximize, maxIcons);
  btns.append(btn('minimize', t.minimize, ICONS.minimize), maxBtn, btn('close', t.close, ICONS.close, 'rad-winbtn-close'));

  const setMax = (on) => {
    bar.toggleAttribute('data-maximized', on);
    maxBtn.setAttribute('aria-label', on ? t.restore : t.maximize);
    maxBtn.setAttribute('data-rad-tip', on ? t.restore : t.maximize);
  };
  window.rad?.window.isMaximized?.().then(setMax);
  window.rad?.window.onMaximizedChange?.(setMax);

  bar.append(head, btns);
  return { el: bar, setSubtitle: (text) => swapText(sub, text) };
}

function rail({ views, router }) {
  const nav = h('nav', 'rad-rail', { 'data-rad-chrome': '', 'aria-label': t.views });
  const indicator = h('div', 'rad-rail-indicator', { 'aria-hidden': 'true' });
  nav.append(indicator);

  const items = new Map();
  for (const v of views) {
    const item = h('button', 'rad-rail-item', { type: 'button', 'data-view': v.id });
    if (v.icon) {
      const icon = h('span', 'rad-icon');
      icon.innerHTML = v.icon;
      item.append(icon);
    }
    const label = h('span', 'rad-rail-label');
    label.textContent = v.label ?? v.id;
    item.append(label);
    item.addEventListener('click', () => router.go(v.id));
    nav.append(item);
    items.set(v.id, item);
  }

  // Flechas arriba y abajo recorren el rail con el teclado.
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = [...items.values()];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
  });

  // El indicador viaja al item activo. La primera vez se coloca en el acto,
  // sin transición: si no, nacería en la punta y viajaría en cada arranque.
  let placed = false;
  const place = () => {
    const item = items.get(router.current);
    if (!item) return;
    if (!placed) indicator.classList.add('is-instant');
    indicator.style.height = `${item.offsetHeight}px`;
    indicator.style.transform = `translateY(${item.offsetTop}px)`;
    if (!placed) {
      indicator.getBoundingClientRect();
      indicator.classList.remove('is-instant');
      placed = true;
    }
  };
  const mark = () => {
    for (const [id, item] of items) {
      if (id === router.current) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    place();
  };
  router.on('change', mark);
  new ResizeObserver(() => { placed = false; place(); }).observe(nav);
  return { el: nav, mark };
}

function statusbar() {
  const bar = h('footer', 'rad-statusbar', { 'data-rad-chrome': '' });
  const left = h('div', 'rad-status-left rad-swap');
  const right = h('div', 'rad-status-right rad-swap');
  bar.append(left, right);
  return {
    el: bar,
    left,
    right,
    set: (side, text) => swapText(side === 'right' ? right : left, text),
  };
}

export function createShell({ root, title, subtitle, views = [], initial, rail: withRail = true, statusbar: withStatus = true }) {
  if (!root) throw new Error('[rad] createShell necesita root: el .rad-root de la app');
  const shell = h('div', 'rad-shell');
  shell.toggleAttribute('data-rail', withRail);
  shell.toggleAttribute('data-statusbar', withStatus);

  const tb = titlebar({ title, subtitle });
  const stage = h('main', 'rad-stage');
  const router = createRouter({ stage, views, initial });

  shell.append(tb.el);
  let railPart = null;
  if (withRail) {
    railPart = rail({ views, router });
    shell.append(railPart.el);
  }
  shell.append(stage);
  const status = withStatus ? statusbar() : null;
  if (status) shell.append(status.el);

  root.append(shell);
  railPart?.mark();

  return {
    el: shell,
    router,
    stage,
    status,
    setSubtitle: tb.setSubtitle,
  };
}
