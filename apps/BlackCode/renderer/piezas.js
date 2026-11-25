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
  // Los agentes: el robotito de Umbra (el `robot` de su Icon.jsx; Fran lo pidió
  // acá, nov 2026). Es su trazo tal cual: allá la grilla es de 24 con trazo de
  // 2, así que va escalado a esta de 16, con el trazo compensado para que quede
  // en el 1,5 de los demás. Cabeza cuadrada con antena, ojos de raya, orejas y
  // hombros.
  agentes: svg('<g transform="scale(.6667)" stroke-width="2.25"><rect x="5" y="5" width="14" height="11.5" rx="3.5"/><path d="M12 5V2.8"/><circle cx="12" cy="1.8" r="1.1" fill="currentColor" stroke="none"/><path d="M3.5 9.5v2.5M20.5 9.5v2.5M9.5 9.4v2.8M14.5 9.4v2.8"/><path d="M5.5 21v-1.5a2.5 2.5 0 0 1 2.5-2.5h8a2.5 2.5 0 0 1 2.5 2.5V21"/></g>'),
  ajustes: svg('<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>'),
  // (las pestañas de Settings que no tenían ícono: imágenes, integraciones, acerca de)
  // La de las imágenes: una varita mágica con sus destellos, la que Fran
  // diseñó con Zac (nov 2026). Su trazo tal cual, de una grilla de 24 con
  // trazo de 2, escalado a esta de 16 con el trazo compensado.
  varita: svg('<g transform="scale(.6667)" stroke-width="2.25"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></g>'),
  // (el enchufe va en diagonal, como la llave y la herramienta que tiene al lado)
  enchufe: svg('<g transform="translate(-.6 .6) rotate(45 8 8)"><path d="M6 2.5v3M10 2.5v3M4.5 5.5h7V8a3.5 3.5 0 0 1-7 0zM8 11.5v2"/></g>'),
  // La voz: la onda de Verba (las cinco barras de su marca, con las mismas
  // proporciones), en el trazo de acá. No es `canal`, que es el de los chats
  // que entran solos.
  onda: svg('<path d="M3 6.5v3M5.5 4.6v6.8M8 3v10M10.5 5.2v5.6M13 6.5v3"/>'),
  info: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 7.5V11"/><circle cx="8" cy="5.2" r=".6" fill="currentColor" stroke="none"/>'),
  mas: svg('<path d="M8 3v10M3 8h10"/>'),
  puntos: svg('<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  enviar: svg('<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'),
  frenar: svg('<rect x="4" y="4" width="8" height="8" rx="1.75" fill="currentColor" stroke="none"/>'),
  // (su pareja: correr. Relleno como el de frenar; el trazo redondea las puntas)
  correr: svg('<path d="M5.25 3.75v8.5L12 8z" fill="currentColor"/>'),
  lapiz: svg('<path d="M10.5 2.5l3 3-8 8h-3v-3z"/>'),
  tacho: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/>'),
  chevron: svg('<path d="M4.5 6.5 8 10l3.5-3.5"/>'),
  // (el mismo, hacia arriba: subir un agente en la lista)
  subir: svg('<path d="M4.5 9.5 8 6l3.5 3.5"/>'),
  // La llave es la de Prism (la de su gestor de contraseñas; Fran la pidió acá,
  // nov 2026): de contorno continuo, el ojo y el eje con su diente en una sola
  // silueta, acostada y puesta en diagonal con rotate(-45).
  llave: svg('<g transform="rotate(-45 8 8)"><path d="M8.31 6.6H1.9V9.4H3.2V11H5.8V9.4H8.31A3.3 3.3 0 1 0 8.31 6.6Z"/><circle cx="12.3" cy="8" r="1" fill="currentColor" stroke="none"/></g>'),
  cerrar: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  copiar: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
  bajar: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  volver: svg('<path d="M5.5 3.5l-3 3 3 3M2.5 6.5H9a3.5 3.5 0 0 1 0 7H6.5"/>'),
  // las notas
  nota: svg('<rect x="3.5" y="2.5" width="9" height="11" rx="1.5"/><path d="M6 5.75h4M6 8h4M6 10.25h2.5"/>'),
  carpeta: svg('<path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h2.4L8 5h4a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z"/>'),
  carpetaMas: svg('<path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h2.4L8 5h4a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 7.5v3.5M6.25 9.25h3.5"/>'),
  pin: svg('<path d="M6 2.5h4l-.6 4 2.1 2.1V10h-7V8.6l2.1-2.1zM8 10v3.5"/>'),
  // las skills: una chispa
  skills: svg('<path d="M8 2.5c0 3 2.5 5.5 5.5 5.5-3 0-5.5 2.5-5.5 5.5 0-3-2.5-5.5-5.5-5.5 3 0 5.5-2.5 5.5-5.5z"/>'),
  // la memoria: el chip de NeonCode (su `chip`, llevado de la grilla de 24 a
  // la de 16): el cuerpo, un cuadrado adentro con el centro hueco, y las patas
  memoria: svg('<path d="M4.75 4.75h6.5v6.5h-6.5zM6.75 6.75h2.5v2.5h-2.5zM6.25 1.75v1.75M9.75 1.75v1.75M6.25 12.5v1.75M9.75 12.5v1.75M1.75 6.25h1.75M1.75 9.75h1.75M12.5 6.25h1.75M12.5 9.75h1.75"/>'),
  // el navegador
  globo: svg('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.7 1.5 2.5 3.3 2.5 5.5S9.7 12 8 13.5C6.3 12 5.5 10.2 5.5 8S6.3 4 8 2.5z"/>'),
  atras: svg('<path d="M9.5 3.5 5 8l4.5 4.5"/>'),
  adelante: svg('<path d="M6.5 3.5 11 8l-4.5 4.5"/>'),
  recargar: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 3v3h-3"/>'),
  estrella: svg('<path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8L2.5 6.5l3.8-.5z"/>'),
  marcadores: svg('<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z"/>'),
  // el historial: un reloj
  reloj: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.25l2 1.25"/>'),
  // (un canal: lo que entra solo, sin tipearlo —lo dicho al Atom Echo—. Las ondas alrededor de un punto que Fran tenía en Umbra.)
  canal: svg('<circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none"/><path d="M5.5 10.5a3.55 3.55 0 0 1 0-5M10.5 5.5a3.55 3.55 0 0 1 0 5M3.4 12.6a6.5 6.5 0 0 1 0-9.2M12.6 3.4a6.5 6.5 0 0 1 0 9.2"/>'),
  externo: svg('<path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>'),
  candado: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  // la terminal: una ventana con su prompt
  terminal: svg('<rect x="2" y="3" width="12" height="10" rx="1.75"/><path d="M5 6.5 7 8 5 9.5M8.5 10H11"/>'),
  // el canvas: los cuatro cuadrados de NeonCode (su `grid`, en la grilla de 16)
  // Los canvas: «Documento + sparkle», el que Fran diseñó con Zac (nov 2026:
  // «documento que escribió Zac»). Es su trazo tal cual, de una grilla de 24
  // con trazo de 2: va escalado a esta de 16, con el trazo compensado para
  // que quede en el 1,5 de los demás. (Antes eran cuatro cuadrados.)
  canvas: svg('<g transform="scale(.6667)" stroke-width="2.25"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></g>'),
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
