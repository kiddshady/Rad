// Lo chico que comparten las vistas: armar nodos y los íconos.

/** Un elemento: h('button', 'rad-button', { type: 'button' }, 'Guardar'). */
export function h(tag, className, attrs = {}, ...children) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}

// Íconos propios, de trazo, en la grilla de 16. Cero glifos.
const svg = (paths) => `<svg viewBox="0 0 16 16" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONOS = {
  chat: svg('<path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H7.5l-3 2.5V11H4a1.5 1.5 0 0 1-1.5-1.5z"/>'),
  agentes: svg('<circle cx="6" cy="5.75" r="2.5"/><path d="M1.5 13c.4-2.2 2.2-3.5 4.5-3.5s4.1 1.3 4.5 3.5"/><path d="M10.6 3.4a2.5 2.5 0 0 1 0 4.7M12.2 9.9c1.2.5 2 1.6 2.3 3.1"/>'),
  ajustes: svg('<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>'),
  mas: svg('<path d="M8 3v10M3 8h10"/>'),
  puntos: svg('<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  enviar: svg('<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'),
  frenar: svg('<rect x="4" y="4" width="8" height="8" rx="1.75" fill="currentColor" stroke="none"/>'),
  lapiz: svg('<path d="M10.5 2.5l3 3-8 8h-3v-3z"/>'),
  tacho: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/>'),
  chevron: svg('<path d="M4.5 6.5 8 10l3.5-3.5"/>'),
  llave: svg('<circle cx="5.25" cy="10.75" r="2.75"/><path d="M7.3 8.7l6.2-6.2M11 5l2 2M9.2 6.8l1.6 1.6"/>'),
  cerrar: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  copiar: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
  bajar: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  volver: svg('<path d="M5.5 3.5l-3 3 3 3M2.5 6.5H9a3.5 3.5 0 0 1 0 7H6.5"/>'),
  // el canvas: una hoja con su cabecera y una columna
  canvas: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.75"/><path d="M2.5 6.25h11M6.5 6.25v7.25"/>'),
  codigo: svg('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'),
  biblioteca: svg('<path d="M3 2.75v10.5M6 4.75v8.5M9 3.5v9.75l4-1-1.75-9z"/>'),
  // una tool: una llave fija
  tool: svg('<path d="M10.2 2.6a3.4 3.4 0 0 0-3 4.9L2.6 12.1a1 1 0 0 0 0 1.4l.1.1a1 1 0 0 0 1.4 0l4.6-4.6a3.4 3.4 0 0 0 4.8-3.7l-2 2-1.9-.5-.5-1.9 2-2a3.4 3.4 0 0 0-.9-.3z"/>'),
};

/** Un ícono en su caja: icono('mas') -> <span class="rad-icon">…</span>. */
export function icono(nombre, extra = '') {
  const caja = h('span', `rad-icon ${extra}`.trim());
  caja.innerHTML = ICONOS[nombre];
  return caja;
}

/** «3 chats», «1 chat», «Sin chats». */
export const cuantos = (n, uno, muchos, nada) => (n === 0 ? nada : n === 1 ? `1 ${uno}` : `${n} ${muchos}`);
