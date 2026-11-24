// Los adjuntos de un mensaje: imágenes y archivos de texto que el usuario
// elige con el botón +, pega o suelta sobre el redactor.
//
// Son los adjuntos de NeonCode, con sus números y sus reglas:
//   - dos clases y nada más: IMÁGENES (lo que el navegador sepa decodificar) y
//     archivos de TEXTO (por tipo, por extensión, o chicos y sin tipo). Un PDF
//     o un binario se rechaza, y se dice por qué;
//   - una imagen se achica antes de guardarla (lado mayor 1568 px, sin
//     agrandar): alcanza para leer el texto de una captura sin inflar el
//     pedido. Sale en PNG, que deja el texto nítido, y en JPEG solo si pesa
//     demasiado;
//   - un archivo de texto viaja ANTEPUESTO al mensaje, entre <file name="…"> y
//     </file>; el modelo lo lee como parte de lo que escribió el usuario;
//   - todo se lee acá, en la interfaz, de los archivos que el usuario eligió:
//     el proceso principal no abre ninguna ruta por un adjunto;
//   - quitar es por identidad y no por posición: con [A, B, C], dos clics
//     seguidos en la × de B se llevaban a C.
// Lo que acá es distinto: el lado es 1568 (el que el modelo procesa sin
// reescalar; allá 1600), el nombre de un archivo se limpia antes de ponerlo en
// la etiqueta, y un modelo que no ve imágenes no las recibe (allá viajaban
// igual y el proveedor rebotaba el pedido entero).

import { reconcile } from '/@core/list.js';
import { h, icono } from './piezas.js';

export const MAX_IMAGENES = 4;
export const MAX_ARCHIVOS = 6;
export const MAX_TEXTO = 256 * 1024; // por archivo: no reventar el contexto
const LADO = 1568;
const PESADA = 2_000_000; // caracteres del data URL en PNG a partir de los que pasa a JPEG
// (La lista de extensiones es la de NeonCode.)
const TEXT_EXT = /\.(md|markdown|txt|log|json|jsonl|csv|tsv|xml|ya?ml|toml|ini|env|conf|c|h|cpp|hpp|cc|cs|go|rs|java|kt|rb|php|py|js|mjs|cjs|jsx|ts|tsx|vue|svelte|sh|ps1|bat|sql|html?|css|scss|less|gitignore|dockerfile)$/i;
/** Lo que se le pasa al selector de archivos del sistema. */
export const ACEPTA = 'image/*,text/*,.md,.markdown,.txt,.log,.json,.jsonl,.csv,.tsv,.xml,.yml,.yaml,.toml,.ini,.env,.conf,.c,.h,.cpp,.hpp,.cc,.cs,.go,.rs,.java,.kt,.rb,.php,.py,.js,.mjs,.cjs,.jsx,.ts,.tsx,.vue,.svelte,.sh,.ps1,.bat,.sql,.html,.htm,.css,.scss,.less';

export const pesa = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 102.4) / 10} KB` : `${Math.round(n / 104857.6) / 10} MB`);

/** Una imagen, achicada, como data URL. */
export async function achicar(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, LADO / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let url = canvas.toDataURL('image/png'); // PNG: texto nítido
  if (url.length > PESADA) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

/** Qué es un archivo: 'imagen', 'texto' o null (no se puede adjuntar). */
export function claseDe(file) {
  const tipo = String(file?.type ?? '');
  const nombre = String(file?.name ?? '');
  if (tipo.startsWith('image/')) return 'imagen';
  if (tipo.startsWith('text/') || tipo === 'application/json' || TEXT_EXT.test(nombre)) return 'texto';
  // sin tipo reconocido y chico: se prueba como texto
  if (!tipo && file.size <= MAX_TEXTO) return 'texto';
  return null;
}

// El nombre va adentro de una etiqueta que lee el modelo: sin comillas ni
// ángulos, que la cerrarían antes de tiempo.
const nombreLimpio = (n) => String(n ?? 'file').replace(/["<>\r\n]/g, '_').slice(0, 200);

/** El texto que le llega al modelo de un mensaje del usuario: sus archivos de
 *  texto, cada uno en su etiqueta, y después lo que escribió. */
export function paraElModelo(m) {
  const archivos = Array.isArray(m?.archivos) ? m.archivos : [];
  const partes = archivos.map((f) => `<file name="${nombreLimpio(f.name)}">\n${f.content}\n</file>`);
  if (String(m?.texto ?? '').trim()) partes.push(m.texto);
  return partes.join('\n\n');
}

// ---------- El visor ----------
/** Muestra una imagen a pantalla completa. Un clic o Esc la cierra. */
export function verImagen(src, nombre = '') {
  const capas = document.querySelector('.rad-overlays') ?? document.body;
  const img = h('img', 'dm-visor-imagen', { src, alt: nombre });
  const visor = h('div', 'dm-visor', { role: 'dialog', 'aria-label': nombre || 'Image', tabindex: '-1' }, img);
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alTeclear, true);
    visor.removeAttribute('data-abierto');
    visor.setAttribute('data-rad-leaving', '');
    setTimeout(() => visor.remove(), 260);
  };
  const alTeclear = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };
  visor.addEventListener('click', cerrar);
  document.addEventListener('keydown', alTeclear, true);
  capas.append(visor);
  requestAnimationFrame(() => requestAnimationFrame(() => { visor.setAttribute('data-abierto', ''); visor.focus({ preventScroll: true }); }));
  return { cerrar };
}

/** Los adjuntos de un mensaje ya enviado, para su burbuja: las imágenes y los
 *  chips de los archivos. null si no tiene. */
export function adjuntosDe(m) {
  const imagenes = Array.isArray(m?.imagenes) ? m.imagenes : [];
  const archivos = Array.isArray(m?.archivos) ? m.archivos : [];
  if (!imagenes.length && !archivos.length) return null;
  const caja = h('div', 'dm-adjuntos-msg');
  if (imagenes.length) {
    caja.append(h('div', 'dm-adjuntos-imagenes', {}, ...imagenes.map((src, i) => {
      const b = h('button', 'dm-adjunto-imagen', { type: 'button', 'aria-label': `Image ${i + 1}` }, h('img', '', { src, alt: '' }));
      b.addEventListener('click', () => verImagen(src));
      return b;
    })));
  }
  if (archivos.length) {
    caja.append(h('div', 'dm-adjuntos-archivos', {}, ...archivos.map((f) => h('span', 'dm-adjunto-archivo', {}, icono('nota'), h('span', 'dm-adjunto-nombre', {}, f.name)))));
  }
  return caja;
}

// ---------- El borrador: lo adjuntado al mensaje que se está escribiendo ----------
let serie = 0;
/**
 * Los adjuntos del redactor. `alCambiar()` avisa cada vez que entra o sale uno.
 * Devuelve { tira, agregar(file), agregarImagen(dataUrl, nombre), hay(),
 * tomar(), guardar(), restaurar(estado), vaciar() }.
 */
export function crearAdjuntos({ alCambiar = () => {} } = {}) {
  let items = []; // { id, clase: 'imagen' | 'texto', name, dataUrl? , size?, content? }
  const lista = h('div', 'dm-adjuntos-lista', { role: 'list' });
  const tira = h('div', 'dm-adjuntos-tira', {}, h('div', 'dm-adjuntos-tira-in', {}, lista));

  const cuenta = (clase) => items.filter((x) => x.clase === clase).length;
  function pintar() {
    reconcile(lista, items, {
      key: (x) => x.id,
      create: (x) => {
        const quitar = h('button', 'dm-adjunto-x', { type: 'button', 'aria-label': `Remove ${x.name}`, 'data-rad-tip': 'Remove' }, icono('cerrar'));
        // por identidad: el que se va es ESTE, esté donde esté ahora
        quitar.addEventListener('click', (e) => { e.stopPropagation(); items = items.filter((y) => y !== x); pintar(); alCambiar(); });
        if (x.clase === 'imagen') {
          const ver = h('button', 'dm-adjunto-ver', { type: 'button', 'aria-label': `View ${x.name}` }, h('img', '', { src: x.dataUrl, alt: '' }));
          ver.addEventListener('click', () => verImagen(x.dataUrl, x.name));
          return h('div', 'dm-adjunto dm-adjunto-miniatura', { role: 'listitem', 'data-clase': 'imagen' }, ver, quitar);
        }
        return h('div', 'dm-adjunto dm-adjunto-chip', { role: 'listitem', 'data-clase': 'texto' },
          icono('nota'), h('span', 'dm-adjunto-nombre', {}, x.name), h('span', 'dm-adjunto-peso', {}, pesa(x.size)), quitar);
      },
    });
    tira.toggleAttribute('data-con-adjuntos', items.length > 0);
  }

  function agregarImagen(dataUrl, name = 'image.png') {
    if (cuenta('imagen') >= MAX_IMAGENES) throw new Error(`Up to ${MAX_IMAGENES} images per message.`);
    items = [...items, { id: `a${++serie}`, clase: 'imagen', name, dataUrl }];
    pintar();
    alCambiar();
  }

  /** Suma un archivo. Tira un Error con el motivo, en palabras para el usuario,
   *  si no se puede. */
  async function agregar(file) {
    const clase = claseDe(file);
    const nombre = file?.name || (clase === 'imagen' ? 'image.png' : 'file.txt');
    if (clase === 'imagen') {
      if (cuenta('imagen') >= MAX_IMAGENES) throw new Error(`Up to ${MAX_IMAGENES} images per message.`);
      let dataUrl;
      try { dataUrl = await achicar(file); } catch { throw new Error(`${nombre}: this image can’t be read.`); }
      agregarImagen(dataUrl, nombre);
      return;
    }
    if (clase === 'texto') {
      if (cuenta('texto') >= MAX_ARCHIVOS) throw new Error(`Up to ${MAX_ARCHIVOS} text files per message.`);
      let crudo;
      try { crudo = await file.text(); } catch { throw new Error(`${nombre}: could not be read.`); }
      // ¿es texto de verdad? Unos cuantos nulos o caracteres rotos al principio dicen que no
      if ((crudo.slice(0, 4000).match(/[\u0000�]/g) || []).length > 8) throw new Error(`${nombre}: looks like a binary file.`);
      const content = crudo.length > MAX_TEXTO ? `${crudo.slice(0, MAX_TEXTO)}\n…[truncated]` : crudo;
      items = [...items, { id: `a${++serie}`, clase: 'texto', name: nombre, size: file.size, content }];
      pintar();
      alCambiar();
      return;
    }
    throw new Error(`${nombre}: this kind of file can’t be attached (images and text files only).`);
  }

  const estado = () => ({
    imagenes: items.filter((x) => x.clase === 'imagen').map((x) => x.dataUrl),
    archivos: items.filter((x) => x.clase === 'texto').map(({ name, size, content }) => ({ name, size, content })),
  });

  pintar();
  return {
    tira,
    agregar,
    agregarImagen,
    hay: () => items.length > 0,
    cuantas: () => ({ imagenes: cuenta('imagen'), archivos: cuenta('texto') }),
    /** Lo adjuntado, listo para el mensaje; el borrador queda vacío. */
    tomar() { const e = estado(); items = []; pintar(); alCambiar(); return e; },
    /** El borrador tal cual, para guardarlo al cambiar de chat… */
    guardar: () => items,
    /** …y para volver a ponerlo. */
    restaurar(guardados) { items = Array.isArray(guardados) ? guardados : []; pintar(); alCambiar(); },
    vaciar() { items = []; pintar(); alCambiar(); },
  };
}
