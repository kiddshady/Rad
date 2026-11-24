// Fórmulas en LaTeX, dibujadas con KaTeX (renderer/vendor/katex, con mhchem
// para la química: \ce{…} y \pu{…}).
//
// Los delimitadores y la forma de encontrar dónde cierra una fórmula son los
// de NeonCode, que los afinó contra respuestas de verdad: van en UN solo
// lugar porque los usan el partidor de bloques y el de texto en línea de
// markdown.js, y si cada uno cortara en otro caracter uno de los dos
// trabajaría sobre un pedazo que el otro no le dio.
//
// KaTeX no se carga al abrir la app (son 600 KB): llega con la primera
// fórmula. Mientras tanto la fórmula muestra su texto, y cuando KaTeX está se
// dibujan todas las que esperaban.
//
// Seguridad: lo que escribe el modelo llega a KaTeX como texto y KaTeX arma
// nodos, nunca HTML. `trust: false` deja inertes \href y \url (prenderlo
// dejaría pasar un href="javascript:"). Y KaTeX pone sus medidas por el CSSOM,
// que la CSP de la app (style-src 'self') permite; lo poco que intenta poner
// como atributo de estilo (el color de un error) la CSP lo descarta, y ese
// color lo pone nix.css.

import { h } from './piezas.js';

// Lo que hace falta para que un $…$ cuente como fórmula y no como plata:
// «cuesta $5 y $10» no es una. El contenido no empieza ni termina con un
// espacio, no cruza un párrafo, el $ que abre no viene pegado a una letra o
// un número, y el que cierra no tiene un número detrás.
const esPlata = (tex, texto, abre, cierra) => !tex.trim()
  || /^\s|\s$/.test(tex)
  || tex.includes('\n\n')
  || tex.includes('`') // cruzó un tramo de código: no es una fórmula
  || /[\w$\\]/.test(texto[abre - 1] ?? '')
  || /\d/.test(texto[cierra + 1] ?? '');

// El orden es el que consume el buscador (gana el PRIMERO que coincide), así
// que `$$` va antes que `$`: al revés, un bloque abriría como fórmula en
// línea vacía.
export const DELIMS = [
  { left: '$$', right: '$$', display: true, vale: (tex) => Boolean(tex.trim()) },
  { left: '\\[', right: '\\]', display: true, vale: (tex) => Boolean(tex.trim()) },
  { left: '\\(', right: '\\)', display: false, vale: (tex) => Boolean(tex.trim()) },
  { left: '$', right: '$', display: false, vale: (tex, texto, abre, cierra) => !esPlata(tex, texto, abre, cierra) },
];

/** Si la línea abre una fórmula en bloque, su par de delimitadores. */
export function abreBloque(linea) {
  const l = linea.replace(/^ {0,3}/, '');
  return DELIMS.find((d) => d.display && l.startsWith(d.left)) ?? null;
}

// Dónde cierra la fórmula que abrió en `desde`. Es el mismo algoritmo que el
// findEndOfMath del auto-render de KaTeX. Dos reglas y las dos importan: una
// barra invertida se come el caracter siguiente (así un `\$` adentro de la
// fórmula no la cierra) y las llaves llevan profundidad (así un `$` adentro de
// un `\text{...}` tampoco).
export function finDeFormula(right, texto, desde) {
  let llaves = 0;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (llaves <= 0 && texto.startsWith(right, i)) return i;
    if (c === '\\') i++;
    else if (c === '{') llaves++;
    else if (c === '}') llaves--;
  }
  return -1;
}

// ---------- KaTeX ----------
let katex = null;      // el módulo, cuando llegó
let cargando = null;   // la promesa de su carga
const esperando = new Set(); // fórmulas que nacieron antes de que llegara

function dibujar(nodo) {
  const tex = nodo.dataset.tex;
  try {
    const dentro = document.createElement('span');
    katex.render(tex, dentro, {
      displayMode: nodo.dataset.display === 'bloque',
      throwOnError: false,
      strict: false,
      trust: false,
    });
    nodo.replaceChildren(...dentro.childNodes);
    nodo.dataset.estado = nodo.querySelector('.katex-error') ? 'error' : 'lista';
  } catch {
    // KaTeX no pudo ni marcar el error: queda el texto de la fórmula
    nodo.textContent = tex;
    nodo.dataset.estado = 'error';
  }
}

function cargar() {
  cargando ??= Promise.all([import('/vendor/katex/katex.mjs'), import('/vendor/katex/contrib/mhchem.mjs')])
    .then(([m]) => {
      katex = m.default;
      for (const nodo of esperando) dibujar(nodo);
      esperando.clear();
    })
    .catch(() => {
      // sin KaTeX las fórmulas quedan como texto, que se puede leer igual
      cargando = null;
      esperando.clear();
    });
  return cargando;
}

/** El nodo de una fórmula. Si KaTeX ya está, sale dibujada; si no, con su
 *  texto, y se dibuja sola cuando llega. */
export function formula(tex, display = false) {
  const nodo = h('span', 'dm-formula', { 'data-display': display ? 'bloque' : 'linea', 'data-estado': 'pendiente', 'data-tex': tex });
  nodo.textContent = tex;
  if (katex) dibujar(nodo);
  else { esperando.add(nodo); cargar(); }
  return nodo;
}

/** Para las pruebas: se resuelve cuando KaTeX terminó de cargar (o falló). */
export const lista = () => cargar();
