// El notepad: las notas del usuario, que el agente también puede leer y
// escribir con sus tools (notepad y notepad_write).
//
// Es el notepad de NeonCode, con sus reglas, reescrito sobre Rad:
//   - una nota es markdown y nada más: no hay campo de título. El título es su
//     primera línea, y el resumen de la tarjeta, las que siguen;
//   - carpetas planas (sin anidar) y un grupo «Unfiled» para las sueltas. Las
//     fijadas van arriba; después, por título;
//   - se guarda sola, un rato después de la última tecla. Los guardados van en
//     fila (dos altas seguidas no duplican la nota) y antes de abrir otra, de
//     mover o de cerrar se espera al que esté pendiente: si no, se pierde la
//     última frase;
//   - si la nota abierta cambia desde afuera (la escribió el agente) y acá no
//     hay cambios, se vuelve a leer; si los hay, no se pisa ninguna de las dos
//     versiones y se avisa;
//   - lo que borra el usuario se va del todo; lo que borra el agente queda una
//     semana en la papelera, y el aviso lo trae de vuelta.
//
// Lo que cambia respecto de allá: la nota se LEE dibujada (el markdown de la
// app, con fórmulas) y se EDITA como texto; allá era un editor que hacía las
// dos cosas a la vez (Milkdown), que acá no vino. Tampoco vinieron arrastrar
// una nota a una carpeta ni «Clear all» (la selección múltiple llegó en la 1.13.1).
//
// Desde la 1.14.0 también se escriben desde el celular (renderer/movil.js):
// lo que cambia allá se trata como lo que escribe un agente (cambioAfuera).

import { openModal, confirm } from '/@core/modal.js';
import { menuButton } from '/@core/menu.js';
import { toast } from '/@core/toast.js';
import { reconcile } from '/@core/list.js';
import { swapText } from '/@core/motion.js';
import { wireScroll } from '/@core/scroll.js';
import { wireControls, setFieldError } from '/@core/controls.js';
import { pintar } from './markdown.js';
import { h, icono } from './piezas.js';

// Lo que cambia las notas se avisa (`blackcode:notas`, desde la PC): el puente
// del celular (movil.js) les dice a los celus que las vuelvan a pedir.
const SOLO_LEEN = new Set(['notas:lista', 'notas:carpetas']);
async function pedir(canal, ...args) {
  const r = await window.rad.invoke(canal, ...args);
  if (!SOLO_LEEN.has(canal)) window.dispatchEvent(new CustomEvent('blackcode:notas', { detail: { desde: 'pc' } }));
  return r;
}
const GUARDAR_MS = 700; // cuánto después de la última tecla se guarda

// El título de una nota: su primera línea con texto, sin las marcas de
// markdown. El resumen: lo que sigue, en un renglón.
const limpiar = (linea) => String(linea)
  .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, '')
  .replace(/(\*\*|__|~~|`)/g, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .trim();
export function tituloDe(content) {
  for (const l of String(content ?? '').split('\n')) { const t = limpiar(l); if (t) return t.slice(0, 120); }
  return 'Untitled';
}
export function resumenDe(content) {
  const lineas = String(content ?? '').split('\n').map(limpiar).filter(Boolean);
  return lineas.slice(1).join(' ').slice(0, 160);
}
// SQLite guarda la fecha en UTC y sin la Z: sin agregársela se leería como
// hora local y saldría corrida.
const fecha = (sqlite) => {
  const d = new Date(`${String(sqlite ?? '').replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
};
// Fijadas arriba; después, por título (con los números en su orden).
export const porTitulo = (a, b) => (Number(b.pinned) - Number(a.pinned)) || tituloDe(a.content).localeCompare(tituloDe(b.content), 'en', { numeric: true, sensitivity: 'base' });

/** Pide un nombre en un modal. Devuelve el texto, o null si se canceló. */
function pedirNombre({ title, value = '', label }) {
  const campo = h('input', 'rad-input', { type: 'text', maxlength: '60', autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true, 'aria-label': label });
  campo.value = value;
  const caja = h('label', 'rad-field', {}, campo);
  wireControls(caja);
  let nombre = null;
  const guardar = () => {
    if (!campo.value.trim()) { setFieldError(caja, 'Give it a name.'); campo.focus(); return false; }
    nombre = campo.value.trim();
    return true;
  };
  const modal = openModal({ title, body: caja, actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', onClick: guardar }] });
  campo.select();
  campo.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    modal.el.querySelector('.rad-button[data-variant="primary"]').click();
  });
  return modal.closed.then(() => nombre);
}

export function montarNotas(el, { router }) {
  el.classList.add('dm-notas');
  let notas = [];
  let carpetas = [];
  let busqueda = '';
  const plegadas = new Set();
  let abierta = null;       // la nota abierta: { id | null, content, folder_id, pinned }
  let editando = false;
  let guardado = '';        // lo último que se sabe que está en el disco de la nota abierta
  let cola = Promise.resolve(); // los guardados, en fila
  let reloj = null;

  // ---------- El lado: la lista ----------
  const nueva = h('button', 'rad-button dm-notas-nueva', { type: 'button', 'data-accion': 'nota-nueva' }, icono('mas'), 'New note');
  const nuevaCarpeta = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'carpeta-nueva', 'aria-label': 'New folder', 'data-rad-tip': 'New folder' }, icono('carpetaMas'));
  const buscar = h('input', 'rad-input', { type: 'search', placeholder: 'Search notes', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search notes' });
  const campoBuscar = h('label', 'rad-field', {}, buscar);
  const lista = h('div', 'dm-notas-lista rad-scroll', { role: 'list' });
  const vacia = h('p', 'dm-notas-vacia rad-swap');
  wireScroll(lista);
  // Seleccionar y borrar varias, como en Chats (1.13.1, pedido de Fran): la
  // casilla de al lado de la búsqueda entra a seleccionar, y los botones de
  // arriba dejan su lugar a la barra de la selección. Las carpetas no se
  // seleccionan: borrar todas sus notas no borra la carpeta.
  const botonSeleccionar = h('button', 'rad-iconbutton dm-seleccionar', { type: 'button', 'aria-label': 'Select notes', 'aria-pressed': 'false', 'data-rad-tip': 'Select notes', 'data-accion': 'notas-seleccionar' }, icono('seleccionar'));
  const todas = h('input', '', { type: 'checkbox', 'data-campo': 'notas-todas' });
  const cuentaSel = h('span', 'dm-sel-cuenta rad-swap');
  const borrarSel = h('button', 'rad-iconbutton dm-sel-borrar', { type: 'button', 'aria-label': 'Delete selected', 'data-rad-tip': 'Delete selected', 'data-accion': 'notas-borrar-seleccion', disabled: true }, icono('tacho'));
  const salirSel = h('button', 'rad-iconbutton dm-sel-salir', { type: 'button', 'aria-label': 'Done', 'data-rad-tip': 'Done', 'data-rad-tip-key': 'Esc', 'data-accion': 'notas-salir-seleccion' }, icono('cerrar'));
  const barraSel = h('div', 'dm-sel', {}, h('label', 'rad-check dm-sel-todos', {}, todas, h('span', 'rad-check-box'), 'Select all'), cuentaSel, borrarSel, salirSel);
  barraSel.inert = true;
  const acciones = h('div', 'dm-notas-acciones', {}, nueva, nuevaCarpeta);
  let seleccionando = false;
  const elegidas = new Set(); // ids de las notas marcadas
  const lado = h('aside', 'dm-lado dm-notas-lado rad-sheet', { 'data-rad-chrome': '' },
    h('div', 'dm-lado-cabeza', {}, acciones, barraSel), h('div', 'dm-buscar-fila', {}, campoBuscar, botonSeleccionar), lista, vacia);
  wireControls(lado);

  // ---------- La hoja: la nota abierta ----------
  const donde = h('span', 'dm-notas-donde rad-swap');
  const estadoGuardado = h('span', 'dm-notas-guardado rad-swap', { role: 'status' });
  const ib = (accion, nombre, etiqueta, extra = {}) => h('button', 'rad-iconbutton', { type: 'button', 'data-accion': accion, 'aria-label': etiqueta, 'data-rad-tip': etiqueta, 'data-rad-tip-side': 'bottom', ...extra }, icono(nombre));
  const bFijar = ib('nota-fijar', 'pin', 'Pin', { 'aria-pressed': 'false' });
  const bMover = ib('nota-mover', 'carpeta', 'Move to a folder');
  const bBorrar = ib('nota-borrar', 'tacho', 'Delete');
  const bEditar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'nota-editar' }, icono('lapiz'), h('span', 'dm-notas-editar-texto rad-swap'));
  const cuerpo = h('div', 'dm-notas-cuerpo rad-scroll', { 'data-rad-line': 'top' });
  wireScroll(cuerpo);
  const hueco = h('p', 'dm-notas-hueco', {}, 'Pick a note, or write a new one. Agents with the Notepad tools can read and write these too.');
  const hoja = h('section', 'dm-notas-hoja rad-sheet', {},
    h('header', 'dm-notas-cabeza', { 'data-rad-chrome': '' }, icono('nota', 'dm-notas-icono'), donde, estadoGuardado, bFijar, bMover, bBorrar, bEditar),
    cuerpo, hueco);
  el.append(lado, hoja);

  const area = () => cuerpo.querySelector('.dm-notas-area');
  const texto = () => (editando ? area()?.value ?? '' : abierta?.content ?? '');
  const sucia = () => Boolean(abierta) && editando && texto() !== guardado;
  const nombreCarpeta = (id) => carpetas.find((c) => c.id === id)?.name ?? null;

  // ---------- Guardar ----------
  const decir = (que) => swapText(estadoGuardado, que);
  /** Guarda lo que hay en el editor, si cambió. Va a la fila: dos guardados
   *  seguidos no se pisan ni dan de alta la nota dos veces. */
  function guardar() {
    clearTimeout(reloj);
    cola = cola.then(async () => {
      if (!abierta || !editando) return;
      const contenido = texto();
      // una nota vacía no se guarda (y borrar el texto no borra la nota)
      if (!contenido.trim() || contenido === guardado) return;
      decir('Saving…');
      try {
        if (abierta.id) {
          const ok = await pedir('notas:guardar', { id: abierta.id, content: contenido });
          if (!ok) throw new Error('no se guardó');
        } else {
          const fila = await pedir('notas:crear', { content: contenido, folderId: abierta.folder_id ?? null });
          if (!fila?.id) throw new Error('no se creó');
          abierta.id = fila.id;
        }
        abierta.content = contenido;
        guardado = contenido;
        decir('Saved');
        await cargar();
      } catch {
        // no se dice «Saved» por las dudas: el texto sigue en el editor
        decir('Not saved');
      }
    });
    return cola;
  }
  const alEscribir = () => { decir(texto() === guardado ? 'Saved' : ''); clearTimeout(reloj); reloj = setTimeout(guardar, GUARDAR_MS); };
  /** Lo pendiente baja al disco antes de seguir (abrir otra, mover, cerrar). */
  const asentar = () => guardar();

  // ---------- Pintar la hoja ----------
  function pintarHoja() {
    hoja.toggleAttribute('data-con-nota', Boolean(abierta));
    hoja.toggleAttribute('data-editando', editando);
    swapText(donde, abierta ? (nombreCarpeta(abierta.folder_id) ?? 'Unfiled') : '');
    swapText(bEditar.querySelector('.dm-notas-editar-texto'), editando ? 'Done' : 'Edit');
    bFijar.setAttribute('aria-pressed', String(Boolean(abierta?.pinned)));
    bFijar.setAttribute('data-rad-tip', abierta?.pinned ? 'Unpin' : 'Pin');
    for (const b of [bFijar, bMover, bBorrar]) b.disabled = !abierta?.id;
    cuerpo._md = null;
    cuerpo.replaceChildren();
    if (!abierta) { decir(''); return; }
    if (editando) {
      const a = h('textarea', 'rad-input dm-notas-area', { spellcheck: 'false', 'aria-label': 'Note', placeholder: 'Write here. The first line is the title.' });
      a.value = abierta.content;
      a.addEventListener('input', alEscribir);
      a.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminar(); }
      });
      cuerpo.append(a);
      wireControls(cuerpo);
      requestAnimationFrame(() => { a.focus(); a.setSelectionRange(a.value.length, a.value.length); });
    } else {
      const doc = h('div', 'dm-notas-doc dm-md');
      pintar(doc, abierta.content);
      doc.addEventListener('dblclick', () => { if (!getSelection()?.toString()) editar(); });
      cuerpo.append(doc);
    }
  }
  function editar() { if (!abierta || editando) return; editando = true; pintarHoja(); }
  async function terminar() {
    if (!editando) return;
    await asentar();
    // una nota nueva que quedó vacía no existe: se cierra
    if (!abierta?.id && !texto().trim()) { abierta = null; editando = false; pintarHoja(); pintarLista(); return; }
    if (abierta) abierta.content = texto();
    editando = false;
    pintarHoja();
  }

  // ---------- Abrir ----------
  async function abrir(id) {
    if (abierta?.id === id) return;
    await asentar();
    const n = notas.find((x) => x.id === id);
    if (!n) return;
    abierta = { id: n.id, content: n.content, folder_id: n.folder_id ?? null, pinned: Boolean(n.pinned) };
    guardado = n.content;
    editando = false;
    decir('');
    pintarHoja();
    pintarLista();
  }
  async function notaNueva(folderId = null) {
    await asentar();
    abierta = { id: null, content: '', folder_id: folderId, pinned: false };
    guardado = '';
    editando = true;
    decir('');
    pintarHoja();
    pintarLista();
  }

  // ---------- La lista ----------
  function items() {
    const q = busqueda.trim().toLowerCase();
    const visibles = notas.filter((n) => !q || n.content.toLowerCase().includes(q)).sort(porTitulo);
    const out = [];
    const grupos = [...carpetas].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
    for (const c of grupos) {
      const suyas = visibles.filter((n) => n.folder_id === c.id);
      // buscando, solo las carpetas con resultados, y abiertas
      if (q && !suyas.length) continue;
      out.push({ k: `c:${c.id}`, tipo: 'carpeta', carpeta: c, cuantas: suyas.length });
      if (q || !plegadas.has(c.id)) for (const n of suyas) out.push({ k: `n:${n.id}`, tipo: 'nota', nota: n, adentro: true });
    }
    const sueltas = visibles.filter((n) => !n.folder_id || !carpetas.some((c) => c.id === n.folder_id));
    if (grupos.length && sueltas.length) out.push({ k: 'c:', tipo: 'carpeta', carpeta: { id: '', name: 'Unfiled' }, cuantas: sueltas.length, fija: true });
    if (q || !plegadas.has('')) for (const n of sueltas) out.push({ k: `n:${n.id}`, tipo: 'nota', nota: n, adentro: grupos.length > 0 });
    return out;
  }
  function ponerItem(nodo, it) {
    if (it.tipo === 'carpeta') {
      nodo.querySelector('.dm-notas-carpeta-nombre').textContent = it.carpeta.name;
      nodo.querySelector('.dm-notas-carpeta-cuenta').textContent = String(it.cuantas);
      nodo.toggleAttribute('data-plegada', !busqueda.trim() && plegadas.has(it.carpeta.id));
      return;
    }
    const n = it.nota;
    nodo.querySelector('.dm-notas-nota-titulo').textContent = tituloDe(n.content);
    nodo.querySelector('.dm-notas-nota-resumen').textContent = resumenDe(n.content);
    nodo.querySelector('.dm-notas-nota-fecha').textContent = fecha(n.updated_at);
    nodo.toggleAttribute('data-fijada', Boolean(n.pinned));
    nodo.toggleAttribute('data-adentro', Boolean(it.adentro));
    nodo.setAttribute('aria-current', String(abierta?.id === n.id));
    const marcada = seleccionando && elegidas.has(n.id);
    nodo.querySelector('.dm-fila-marca > input').checked = marcada;
    nodo.toggleAttribute('data-elegido', marcada);
    if (seleccionando) nodo.setAttribute('aria-pressed', String(marcada));
    else nodo.removeAttribute('aria-pressed');
  }
  function crearItem(it) {
    if (it.tipo === 'carpeta') {
      const cabeza = h('button', 'dm-notas-carpeta-cabeza', { type: 'button' }, icono('chevron', 'dm-notas-carpeta-chevron'), icono('carpeta'), h('span', 'dm-notas-carpeta-nombre'), h('span', 'dm-notas-carpeta-cuenta'));
      const nodo = h('div', 'dm-notas-carpeta', { role: 'listitem' }, cabeza);
      const id = it.carpeta.id;
      cabeza.addEventListener('click', () => { if (plegadas.has(id)) plegadas.delete(id); else plegadas.add(id); pintarLista(); });
      if (!it.fija) {
        const mas = h('button', 'rad-iconbutton dm-notas-carpeta-mas', { type: 'button', 'aria-label': 'Folder actions', 'data-rad-tip': 'Actions' }, icono('puntos'));
        nodo.append(mas);
        menuButton(mas, () => [
          { id: 'nota', label: 'New note here', icon: icono('mas').innerHTML, onSelect: () => notaNueva(id) },
          { id: 'renombrar', label: 'Rename', icon: icono('lapiz').innerHTML, onSelect: () => renombrarCarpeta(id) },
          { separator: true },
          { id: 'eliminar', label: 'Delete folder', danger: true, icon: icono('tacho').innerHTML, onSelect: () => borrarCarpeta(id) },
        ], { align: 'end' });
      }
      ponerItem(nodo, it);
      return nodo;
    }
    // (la casilla solo se ve seleccionando; la marca el clic en la nota)
    const marca = h('span', 'rad-check dm-fila-marca', { 'aria-hidden': 'true' }, h('input', '', { type: 'checkbox', tabindex: '-1' }), h('span', 'rad-check-box'));
    const nodo = h('button', 'dm-notas-nota', { type: 'button', role: 'listitem' },
      marca,
      h('span', 'dm-notas-nota-arriba', {}, h('span', 'dm-notas-nota-titulo'), icono('pin', 'dm-notas-nota-pin'), h('span', 'dm-notas-nota-fecha')),
      h('span', 'dm-notas-nota-resumen'));
    wireControls(marca);
    nodo.addEventListener('click', (e) => {
      const id = (e.currentTarget.dataset.radKey ?? it.k).slice(2);
      if (seleccionando) alternar(id);
      else abrir(id);
    });
    ponerItem(nodo, it);
    return nodo;
  }
  function pintarLista() {
    const lo = items();
    reconcile(lista, lo, { key: (it) => it.k, create: crearItem, update: ponerItem });
    const hay = lo.some((it) => it.tipo === 'nota');
    swapText(vacia, hay ? '' : busqueda.trim() ? 'Nothing matches.' : notas.length ? '' : 'No notes yet.');
    ponerSeleccion();
  }

  // ---------- La selección ----------
  /** Las notas que se pueden marcar: las que se ven (con la búsqueda, y fuera de las carpetas plegadas). */
  const marcables = () => items().filter((it) => it.tipo === 'nota').map((it) => it.nota);
  const marcadas = () => marcables().filter((n) => elegidas.has(n.id));
  function ponerSeleccion() {
    lado.toggleAttribute('data-seleccion', seleccionando);
    botonSeleccionar.setAttribute('aria-pressed', String(seleccionando));
    acciones.inert = seleccionando;
    barraSel.inert = !seleccionando;
    // (lo que se borró sale de la selección)
    for (const id of elegidas) if (!notas.some((n) => n.id === id)) elegidas.delete(id);
    const total = marcables().length;
    const n = marcadas().length;
    todas.checked = total > 0 && n === total;
    todas.disabled = total === 0;
    swapText(cuentaSel, n ? `${n} selected` : '');
    borrarSel.disabled = n === 0;
    botonSeleccionar.disabled = !seleccionando && notas.length === 0;
  }
  function alternar(id) {
    if (elegidas.has(id)) elegidas.delete(id);
    else elegidas.add(id);
    pintarLista();
  }
  function entrarASeleccionar() { if (seleccionando) return; elegidas.clear(); seleccionando = true; pintarLista(); }
  function salirDeSeleccionar() { if (!seleccionando) return; seleccionando = false; elegidas.clear(); pintarLista(); }
  botonSeleccionar.addEventListener('click', () => (seleccionando ? salirDeSeleccionar() : entrarASeleccionar()));
  salirSel.addEventListener('click', salirDeSeleccionar);
  todas.addEventListener('change', () => {
    const lo = marcables();
    const ya = lo.length > 0 && lo.every((n) => elegidas.has(n.id));
    for (const n of lo) { if (ya) elegidas.delete(n.id); else elegidas.add(n.id); }
    pintarLista();
  });
  borrarSel.addEventListener('click', async () => {
    const ids = marcadas().map((n) => n.id);
    if (!ids.length) return;
    const si = await confirm({
      title: ids.length === 1 ? 'Delete 1 note?' : `Delete ${ids.length} notes?`,
      text: `${ids.length === 1 ? 'It will' : 'They will'} be deleted for good: there is no trash here. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!si) return;
    salirDeSeleccionar();
    // si la abierta está entre ellas, lo pendiente se cancela (un guardado demorado la volvería a escribir)
    if (abierta?.id && ids.includes(abierta.id)) {
      clearTimeout(reloj);
      abierta = null;
      editando = false;
      await cola;
      pintarHoja();
    }
    for (const id of ids) await pedir('notas:borrar', id);
    await cargar();
  });
  // Esc: con algo escrito en la búsqueda, es del campo; si no, sale de la selección.
  lado.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !seleccionando || (e.target === buscar && buscar.value)) return;
    e.preventDefault();
    salirDeSeleccionar();
  });
  async function cargar() {
    const [n, c] = await Promise.all([pedir('notas:lista'), pedir('notas:carpetas')]);
    notas = Array.isArray(n) ? n : [];
    carpetas = Array.isArray(c) ? c : [];
    pintarLista();
    if (abierta) swapText(donde, nombreCarpeta(abierta.folder_id) ?? 'Unfiled');
  }

  // ---------- Carpetas ----------
  async function carpetaNueva() {
    const nombre = await pedirNombre({ title: 'New folder', label: 'Folder name' });
    if (!nombre) return null;
    const c = await pedir('notas:carpeta-crear', nombre);
    if (!c) { toast({ text: 'Could not create the folder.', kind: 'danger' }); return null; }
    await cargar();
    return c;
  }
  async function renombrarCarpeta(id) {
    const nombre = await pedirNombre({ title: 'Rename folder', label: 'Folder name', value: nombreCarpeta(id) ?? '' });
    if (!nombre) return;
    await pedir('notas:carpeta-renombrar', { id, name: nombre });
    await cargar();
  }
  async function borrarCarpeta(id) {
    const si = await confirm({ title: 'Delete this folder?', text: `“${nombreCarpeta(id)}” will be deleted. Its notes are kept, without a folder.`, confirmLabel: 'Delete folder', danger: true });
    if (!si) return;
    await pedir('notas:carpeta-borrar', id);
    if (abierta?.folder_id === id) abierta.folder_id = null;
    await cargar();
  }
  async function mover(folderId) {
    if (!abierta?.id) return;
    await asentar();
    await pedir('notas:mover', { id: abierta.id, folderId });
    abierta.folder_id = folderId;
    await cargar();
  }

  // ---------- Los controles ----------
  nueva.addEventListener('click', () => notaNueva(null));
  nuevaCarpeta.addEventListener('click', carpetaNueva);
  buscar.addEventListener('input', () => { busqueda = buscar.value; pintarLista(); });
  bEditar.addEventListener('click', () => (editando ? terminar() : editar()));
  bFijar.addEventListener('click', async () => {
    if (!abierta?.id) return;
    await asentar();
    abierta.pinned = !abierta.pinned;
    await pedir('notas:fijar', { id: abierta.id, pinned: abierta.pinned });
    bFijar.setAttribute('aria-pressed', String(abierta.pinned));
    await cargar();
  });
  menuButton(bMover, () => [
    ...[...carpetas].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((c) => ({ id: c.id, label: c.name, checked: abierta?.folder_id === c.id, onSelect: () => mover(c.id) })),
    { id: 'ninguna', label: 'No folder', checked: !abierta?.folder_id, onSelect: () => mover(null) },
    { separator: true },
    { id: 'nueva', label: 'New folder…', icon: icono('carpetaMas').innerHTML, onSelect: async () => { const c = await carpetaNueva(); if (c) mover(c.id); } },
  ], { align: 'end' });
  bBorrar.addEventListener('click', async () => {
    if (!abierta?.id) return;
    const si = await confirm({ title: 'Delete this note?', text: `“${tituloDe(texto())}” will be deleted for good: there is no trash here. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
    if (!si) return;
    // lo pendiente se cancela: un guardado demorado volvería a escribir la nota
    clearTimeout(reloj);
    const id = abierta.id;
    abierta = null;
    editando = false;
    await cola;
    await pedir('notas:borrar', id);
    pintarHoja();
    await cargar();
  });

  // ---------- Lo que pasa afuera ----------
  // El agente (u otra ventana) cambió las notas. Si la abierta cambió y acá no
  // hay nada sin guardar, se vuelve a leer; si lo hay, no se pisa ninguna de
  // las dos versiones.
  async function cambioAfuera() {
    await cola;
    const eraSucia = sucia();
    await cargar();
    if (!abierta?.id) return;
    const ahora = notas.find((n) => n.id === abierta.id);
    if (!ahora) {
      if (eraSucia) {
        // la borraron y acá hay texto sin guardar: queda como una nota nueva
        abierta.id = null;
        guardado = '';
        toast({ text: 'This note was deleted elsewhere. What you have here will be saved as a new note.' });
      } else {
        abierta = null;
        editando = false;
        pintarHoja();
      }
      pintarLista();
      return;
    }
    abierta.folder_id = ahora.folder_id ?? null;
    abierta.pinned = Boolean(ahora.pinned);
    if (ahora.content === guardado) {
      // no cambió su texto: a lo sumo su carpeta o su pin. El cuerpo no se toca
      // (repintarlo le sacaría el cursor a quien está escribiendo).
      swapText(donde, nombreCarpeta(abierta.folder_id) ?? 'Unfiled');
      bFijar.setAttribute('aria-pressed', String(abierta.pinned));
      return;
    }
    if (eraSucia) {
      toast({ text: 'This note changed elsewhere while you were editing. Saving will keep your version.' });
      return;
    }
    const estabaEditando = editando;
    abierta.content = ahora.content;
    guardado = ahora.content;
    editando = estabaEditando;
    pintarHoja();
  }
  window.rad.on('notas:evento', (ev) => {
    if (ev?.tipo === 'cambio') cambioAfuera();
    else if (ev?.tipo === 'borrada') {
      toast({
        text: `The agent deleted “${ev.title ?? 'a note'}”. It stays in the trash for a week.`,
        duration: 9000,
        action: { label: 'Restore', onClick: async () => { await pedir('notas:restaurar', ev.id); await cargar(); } },
      });
    }
  });
  // Las cambió un celu (1.14.0): lo mismo que si las hubiera escrito un agente.
  window.addEventListener('blackcode:notas', (e) => { if (e.detail?.desde === 'celu') cambioAfuera(); });
  // Al irse a otra vista, lo pendiente se guarda.
  router.on('change', ({ id }) => { if (id !== 'notas') asentar(); else cargar(); });

  pintarHoja();
  cargar();
  return { cargar };
}
