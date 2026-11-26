// El visor de imágenes: una imagen del chat en grande, con zoom. Lo abre un
// clic sobre una imagen de una tool (una captura de screen_capture, una de
// generate_image, un gráfico de run_code); el clic derecho, adentro o en la
// miniatura, abre el menú de esa imagen. Fran lo pidió el 25/11/2026.
//
// Es un modal del núcleo (entra y sale como todos) con la forma propia
// `dm-zoom-modal`. La imagen se decodifica ANTES de abrirlo: el modal entra
// con ella puesta, no aparece vacío y se llena.
//
// El zoom: la rueda acerca y aleja alrededor del puntero; arrastrar mueve la
// imagen cuando es más grande que el lienzo; doble clic va de «entera» al
// tamaño real y vuelve. Teclas: + y - acercan y alejan, 0 la deja entera y 1
// a tamaño real. El transform se transiciona (salvo arrastrando), y el
// porcentaje corre hasta el valor nuevo en vez de saltar.

import { openModal } from '/@core/modal.js';
import { contextMenu } from '/@core/menu.js';
import { ms, raf2 } from '/@core/motion.js';
import { toast } from '/@core/toast.js';
import { h, icono } from './piezas.js';

const MAXIMO = 16;
const PASO = 1.25;

/** El menú de una imagen que viaja adentro del chat (una captura, un gráfico,
 *  una que adjuntó el usuario): no tiene archivo propio, así que para abrirla
 *  afuera o guardarla el proceso principal la escribe. No hay carpeta que
 *  mostrar ni ruta que copiar. */
export function menuDeDato(dataUrl, nombre = 'image.png') {
  const pedir = (canal) => window.rad.invoke(canal, { dataUrl, nombre }).catch(() => null);
  return () => [
    { id: 'abrir', label: 'Open', icon: icono('externo').innerHTML, onSelect: async () => { if (!(await pedir('imagenes:abrir-dato'))?.ok) toast({ text: 'Could not open the image.', kind: 'danger' }); } },
    { id: 'guardar', label: 'Save as…', icon: icono('bajar').innerHTML, onSelect: async () => {
      const r = await pedir('imagenes:guardar-dato');
      if (r?.ok) toast({ text: 'Saved' }); else if (!r?.cancelado) toast({ text: `Could not save the image: ${r?.error ?? 'unknown error'}`, kind: 'danger' });
    } },
  ];
}

/** Abre el visor. `menu` es la función que arma los ítems del clic derecho
 *  (los mismos que en la miniatura). `origen` es la miniatura que lo abrió y
 *  `conPuntero`, si fue con el mouse (ver «el anillo al volver»). Devuelve el
 *  modal. */
export async function abrirVisor({ src, nombre = 'Image', menu = null, origen = null, conPuntero = false }) {
  const img = new Image();
  img.className = 'dm-zoom-img';
  img.alt = nombre;
  img.draggable = false;
  img.src = src;
  try { await img.decode(); } catch { /* se abre igual: el navegador la pinta cuando pueda */ }
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;

  const lienzo = h('div', 'dm-zoom-lienzo', { 'data-quieto': '' }, img);
  const boton = (nombreIcono, rotulo, tecla) => h('button', 'rad-iconbutton', { type: 'button', 'aria-label': rotulo, 'data-rad-tip': rotulo, 'data-rad-tip-key': tecla, 'data-rad-tip-side': 'top' }, icono(nombreIcono));
  const menos = boton('lupaMenos', 'Zoom out', '-');
  const mas = boton('lupaMas', 'Zoom in', '+');
  const entera = boton('ajustar', 'Fit to window', '0');
  const cerrar = boton('cerrar', 'Close', 'Esc');
  const pct = h('button', 'rad-button dm-zoom-pct', { type: 'button', 'data-variant': 'quiet', 'aria-label': 'Actual size', 'data-rad-tip': 'Actual size', 'data-rad-tip-key': '1', 'data-rad-tip-side': 'top' }, '100%');
  const barra = h('div', 'dm-zoom-barra', {},
    h('span', 'dm-zoom-nombre', {}, nombre),
    h('span', 'dm-zoom-medida', {}, `${iw} × ${ih}`),
    menos, pct, mas, entera, cerrar);
  const caja = h('div', 'dm-zoom', { tabindex: '-1' }, lienzo, barra);
  const m = openModal({ body: caja, className: 'dm-zoom-modal', label: nombre });

  // El anillo al volver: al cerrarse, el modal le devuelve el foco a la
  // miniatura, y si se cerró con Esc Chromium lo toma como teclado y le prende
  // el anillo, que quedaba pegado (Fran, 1.8.1). Si el visor se abrió con el
  // mouse, ese foco devuelto va sin anillo (lo apaga `data-sin-anillo` en el
  // CSS) hasta que la miniatura lo pierda. Abierto con el teclado, el anillo
  // queda: ahí dice dónde se está. (El foco llega en el mismo `close`, antes
  // del cuadro siguiente: la marca está puesta cuando se pinta.)
  if (origen && conPuntero) {
    const alVolver = () => {
      origen.setAttribute('data-sin-anillo', '');
      origen.addEventListener('blur', () => origen.removeAttribute('data-sin-anillo'), { once: true });
    };
    origen.addEventListener('focus', alVolver, { once: true });
    // (si el foco no volvió a ella, el aviso no queda esperando: le apagaría
    // el anillo a la próxima llegada con Tab)
    m.removed.then(() => origen.removeEventListener('focus', alVolver));
  }

  // ---------- dónde está la imagen ----------
  let s = 1; let x = 0; let y = 0;
  let enteraS = 1;
  let ajustada = true; // si está «entera»: al cambiar el tamaño de la ventana, sigue entera
  const W = () => lienzo.clientWidth;
  const H = () => lienzo.clientHeight;
  // «Entera» deja aire alrededor: pegada al borde del lienzo parecía cortada.
  const aire = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rad-space-5')) || 24;
  const medirEntera = () => { enteraS = Math.min((W() - aire * 2) / iw, (H() - aire * 2) / ih, 1) || 1; };
  const minimo = () => Math.min(enteraS, 1) / 4;
  // Las esquinas redondeadas, como en el visor de antes. El radio va dividido
  // por la escala: el transform lo agrandaría con el zoom, y así se ve siempre
  // igual. Se transiciona junto con el transform (blackcode.css).
  const radio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rad-radius-m')) || 10;
  // Lo que es más chico que el lienzo va centrado; lo más grande no deja hueco.
  const encuadrar = () => {
    const ancho = iw * s; const alto = ih * s;
    x = ancho <= W() ? (W() - ancho) / 2 : Math.min(0, Math.max(W() - ancho, x));
    y = alto <= H() ? (H() - alto) / 2 : Math.min(0, Math.max(H() - alto, y));
  };
  const pintar = () => {
    encuadrar();
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    img.style.borderRadius = `${radio / s}px`;
    lienzo.toggleAttribute('data-movible', iw * s > W() + 0.5 || ih * s > H() + 0.5);
    lienzo.toggleAttribute('data-pixeles', s > 1.001);
    menos.disabled = s <= minimo() + 1e-6;
    mas.disabled = s >= MAXIMO - 1e-6;
    correrPct(s);
  };
  const zoomA = (nuevo, cx = W() / 2, cy = H() / 2) => {
    const n = Math.min(MAXIMO, Math.max(minimo(), nuevo));
    x = cx - (cx - x) * (n / s);
    y = cy - (cy - y) * (n / s);
    s = n;
    ajustada = Math.abs(s - enteraS) < 1e-3;
    pintar();
  };
  const ponerEntera = () => { medirEntera(); s = enteraS; ajustada = true; pintar(); };

  // ---------- el porcentaje corre, no salta ----------
  let mostrado = null; let carrera = 0;
  function correrPct(objetivo) {
    const fin = Math.round(objetivo * 100);
    if (mostrado === null) { mostrado = fin; pct.textContent = `${fin}%`; return; }
    const desde = mostrado; const t0 = performance.now(); const dur = ms('dur-fast') || 120;
    const id = ++carrera;
    const paso = (t) => {
      if (id !== carrera) return;
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      mostrado = Math.round(desde + (fin - desde) * e);
      pct.textContent = `${mostrado}%`;
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  // La primera posición va antes del primer cuadro y sin transición; recién
  // pintada, el zoom pasa a transicionarse.
  ponerEntera();
  raf2().then(() => lienzo.removeAttribute('data-quieto'));

  // ---------- los gestos ----------
  const punto = (e) => { const r = lienzo.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  lienzo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = punto(e);
    zoomA(s * Math.exp(-e.deltaY * 0.0015), cx, cy);
  }, { passive: false });
  lienzo.addEventListener('dblclick', (e) => {
    const [cx, cy] = punto(e);
    if (Math.abs(s - enteraS) < 1e-3) zoomA(enteraS < 1 ? 1 : enteraS * 2, cx, cy);
    else ponerEntera();
  });
  let arrastre = null;
  lienzo.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !lienzo.hasAttribute('data-movible')) return;
    arrastre = { id: e.pointerId, px: e.clientX, py: e.clientY, x, y };
    lienzo.setPointerCapture(e.pointerId);
    lienzo.setAttribute('data-arrastrando', '');
  });
  lienzo.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    x = arrastre.x + (e.clientX - arrastre.px);
    y = arrastre.y + (e.clientY - arrastre.py);
    pintar();
  });
  const soltar = (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    arrastre = null;
    lienzo.removeAttribute('data-arrastrando');
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);

  menos.addEventListener('click', () => zoomA(s / PASO));
  mas.addEventListener('click', () => zoomA(s * PASO));
  entera.addEventListener('click', ponerEntera);
  pct.addEventListener('click', () => zoomA(1));
  cerrar.addEventListener('click', () => m.close('dismiss'));
  caja.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const que = { '+': () => zoomA(s * PASO), '=': () => zoomA(s * PASO), '-': () => zoomA(s / PASO), '0': ponerEntera, '1': () => zoomA(1) }[e.key];
    if (que) { e.preventDefault(); que(); }
  });
  if (menu) contextMenu(lienzo, () => menu());

  // La ventana cambia de tamaño: si estaba entera, sigue entera; si no, se
  // queda donde estaba sin dejar hueco.
  const ro = new ResizeObserver(() => { if (ajustada) ponerEntera(); else { medirEntera(); pintar(); } });
  ro.observe(lienzo);
  m.closed.then(() => ro.disconnect());

  caja.focus({ preventScroll: true });
  return m;
}
