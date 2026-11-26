// El canvas: un panel al lado de la conversación donde el agente deja un
// documento largo o un archivo de código, en vez de volcarlo en el mensaje.
// Hay muchos por chat, y una biblioteca con los de todos los chats.
//
// Es el canvas de NeonCode, con sus tres superficies (el panel, la barra de
// tarjetas del chat y la biblioteca) y sus reglas, reescrito sobre Rad:
//   - el cuerpo NO viaja en la conversación: el agente lo lee con su tool y el
//     usuario lo ve acá;
//   - lo que el agente escribe mientras el usuario está editando ese mismo
//     canvas no le pisa el borrador: se avisa y el borrador queda;
//   - un borrador sin guardar no se pierde si el panel se cierra por un camino
//     que no pregunta (cambiar de chat): se rescata y vuelve al reabrirlo;
//   - lo que borra el usuario se va del todo; lo que borra el agente queda una
//     semana en la papelera, y se puede restaurar desde el aviso o desde la
//     biblioteca.
//
// Un documento se pinta con el markdown de la app (fórmulas incluidas); el
// código, con sus números de línea. El panel empuja a la conversación, no la
// tapa: el hueco se reserva de UN paso y lo que se ve moverse es el panel
// (transform y opacidad, nunca el ancho: animar el ancho remaquetaría la
// conversación en cada cuadro).

import { openModal, confirm } from '/@core/modal.js';
import { toast } from '/@core/toast.js';
import { reconcile } from '/@core/list.js';
import { swapText, ms } from '/@core/motion.js';
import { wireScroll } from '/@core/scroll.js';
import { wireControls } from '/@core/controls.js';
import * as datos from './datos.js';
import { pintar } from './markdown.js';
import { h, icono } from './piezas.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
const liviano = ({ id, title, kind, language, version, conversation_id: conv, updated_at: tocado }) => ({ id, title, kind, language, version, conversation_id: conv, updated_at: tocado });
const meta = (c) => [c.kind === 'code' ? (c.language || 'code') : 'document', c.version > 1 ? `v${c.version}` : ''].filter(Boolean).join(' · ');

/**
 * Arma el canvas adentro de la vista de chat.
 *   escena  el contenedor de la conversación y el panel (su marco)
 *   turnos  { pedir(quien) }: cierra el otro panel antes de abrir este
 * Devuelve { panel, barra, botonBiblioteca, alCambiarDeChat() }.
 */
export function montarCanvas({ escena, turnos }) {
  let items = [];        // los canvas de este chat, livianos (sin contenido)
  let activo = null;     // el que está abierto, entero
  let editando = false;
  let chatDeLaBarra = null;
  const rescates = new Map(); // id -> borrador que quedó sin guardar
  let llegado = null;    // lo que el agente escribió en el canvas abierto mientras se lo editaba

  // ---------- El panel ----------
  const titulo = h('h3', 'dm-canvas-titulo rad-swap');
  const sub = h('span', 'dm-canvas-sub rad-swap');
  const boton = (accion, nombre, etiqueta, extra = {}) => h('button', 'rad-iconbutton', { type: 'button', 'data-accion': accion, 'aria-label': etiqueta, 'data-rad-tip': etiqueta, 'data-rad-tip-side': 'bottom', ...extra }, icono(nombre));
  const bEditar = boton('canvas-editar', 'lapiz', 'Edit');
  const bCopiar = boton('canvas-copiar', 'copiar', 'Copy');
  const bExportar = boton('canvas-exportar', 'exportar', 'Export to a file');
  const bBorrar = boton('canvas-borrar', 'tacho', 'Delete');
  const bCerrar = boton('canvas-cerrar', 'cerrar', 'Close');
  const bGuardar = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'canvas-guardar', 'data-rad-tip': 'Save', 'data-rad-tip-key': 'Ctrl+S', 'data-rad-tip-side': 'bottom' }, 'Save');
  const bCancelar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'canvas-cancelar' }, 'Cancel');
  const acciones = h('div', 'dm-canvas-acciones', {}, bEditar, bCopiar, bExportar, bBorrar, bCerrar);
  const accionesEdicion = h('div', 'dm-canvas-acciones dm-canvas-acciones-edicion', {}, bCancelar, bGuardar);
  // Arriba no hay línea: la cabecera va sobre la misma hoja, así que lo que
  // sube por debajo del título se esfuma (antes se cortaba al aire).
  const cuerpo = h('div', 'dm-canvas-cuerpo rad-scroll');
  wireScroll(cuerpo);
  const panel = h('aside', 'dm-canvas', { 'aria-label': 'Canvas', 'aria-hidden': 'true' },
    h('header', 'dm-canvas-cabeza', { 'data-rad-chrome': '' },
      icono('canvas', 'dm-canvas-icono'),
      h('div', 'dm-canvas-nombre', {}, titulo, sub),
      acciones, accionesEdicion),
    cuerpo);
  panel.inert = true;

  // ---------- La barra de tarjetas del chat ----------
  // La tira scrollea de costado, con el esfumado del lado que recorta. La
  // rueda la mueve: no tiene barra, y sin esto había que saber lo del Shift.
  const tarjetas = h('div', 'dm-canvas-tarjetas rad-scroll-x', { role: 'list' });
  wireScroll(tarjetas);
  tarjetas.addEventListener('wheel', (e) => {
    if (e.deltaX || !e.deltaY || tarjetas.scrollWidth <= tarjetas.clientWidth) return;
    e.preventDefault();
    tarjetas.scrollLeft += e.deltaY;
  }, { passive: false });
  const botonBiblioteca = h('button', 'rad-iconbutton dm-canvas-biblioteca', { type: 'button', 'data-accion': 'canvas-biblioteca', 'aria-label': 'All canvases', 'data-rad-tip': 'All canvases', 'data-rad-tip-side': 'bottom' }, icono('canvas'));
  const barra = h('div', 'dm-canvas-barra', { 'data-rad-chrome': '' }, h('div', 'dm-canvas-barra-in', {}, tarjetas));

  const abierto = () => panel.hasAttribute('data-abierto');
  const sucio = () => editando && activo && cuerpo.querySelector('.dm-canvas-area')?.value !== activo.content;

  // La tarjeta de un canvas, al día. (reconcile no llama a update para un
  // nodo recién creado: por eso create también pasa por acá.)
  let tarjetaALaVista = null;
  function ponerTarjeta(nodo, c) {
    const nombre = nodo.querySelector('.dm-canvas-tarjeta-nombre');
    if (nombre.textContent !== c.title) nombre.textContent = c.title;
    nodo.toggleAttribute('data-activa', activo?.id === c.id && abierto());
    nodo.setAttribute('data-rad-tip', meta(c));
  }
  function pintarBarra() {
    reconcile(tarjetas, items, {
      key: (c) => c.id,
      create: (c) => {
        const nombre = h('span', 'dm-canvas-tarjeta-nombre');
        const nodo = h('button', 'dm-canvas-tarjeta', { type: 'button', role: 'listitem' }, icono(c.kind === 'code' ? 'codigo' : 'canvas'), nombre);
        nodo.addEventListener('click', (e) => { const id = e.currentTarget.dataset.radKey ?? c.id; return activo?.id === id && abierto() ? cerrar() : abrir(id); });
        ponerTarjeta(nodo, c);
        return nodo;
      },
      update: ponerTarjeta,
    });
    barra.toggleAttribute('data-con-tarjetas', items.length > 0);
    // La tarjeta del que se acaba de abrir, a la vista: en una tira más larga
    // que su lugar podía quedar del lado que no se ve. Solo cuando cambia cuál
    // está abierto, para no pelearle el scroll a quien la está recorriendo.
    const abierta = abierto() ? (activo?.id ?? null) : null;
    if (abierta !== tarjetaALaVista) {
      tarjetaALaVista = abierta;
      if (abierta) requestAnimationFrame(() => tarjetas.querySelector('.dm-canvas-tarjeta[data-activa]')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }));
    }
  }

  async function cargarBarra() {
    const chat = datos.chatActual()?.id ?? null;
    chatDeLaBarra = chat;
    const lista = chat ? await pedir('canvas:lista', chat) : [];
    if (chatDeLaBarra !== chat) return; // ya se cambió de chat mientras llegaba
    items = Array.isArray(lista) ? lista : [];
    pintarBarra();
  }

  // ---------- Pintar el panel ----------
  function pintarCabeza() {
    swapText(titulo, activo?.title ?? '');
    swapText(sub, activo ? meta(activo) : '');
    panel.toggleAttribute('data-editando', editando);
  }

  function pintarCuerpo() {
    cuerpo._md = null; // el pintor de markdown guarda su estado en el nodo
    cuerpo.replaceChildren();
    cuerpo.dataset.modo = editando ? 'edicion' : activo?.kind === 'code' ? 'codigo' : 'documento';
    if (!activo) return;
    if (editando) {
      const area = h('textarea', 'rad-input dm-canvas-area rad-mono', { spellcheck: 'false', 'aria-label': 'Canvas content' });
      area.value = rescates.get(activo.id) ?? activo.content;
      rescates.delete(activo.id);
      area.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); salirDeEditar(); }
      });
      cuerpo.append(area);
      wireControls(cuerpo);
      requestAnimationFrame(() => area.focus());
    } else if (activo.kind === 'code') {
      const lineas = activo.content.split('\n');
      const numeros = h('span', 'dm-canvas-numeros', { 'aria-hidden': 'true', 'data-rad-chrome': '' }, lineas.map((_, i) => i + 1).join('\n'));
      const code = document.createElement('code');
      code.textContent = activo.content;
      cuerpo.append(h('pre', 'dm-canvas-codigo rad-mono', {}, numeros, code));
    } else {
      const doc = h('div', 'dm-canvas-doc dm-md');
      pintar(doc, activo.content);
      cuerpo.append(doc);
    }
    cuerpo.scrollTop = 0;
  }

  function pintar_() { pintarCabeza(); pintarCuerpo(); pintarBarra(); }

  // ---------- Abrir y cerrar ----------
  let cerrando = null;
  function mostrar(c) {
    turnos?.pedir('canvas'); // el hueco es uno solo: el navegador se cierra
    clearTimeout(cerrando);
    activo = c;
    llegado = null;
    editando = rescates.has(c.id);
    if (editando) toast({ text: `Your unsaved draft of “${c.title}” is back.` });
    // El hueco se reserva de un paso; lo que se ve entrar es el panel.
    escena.setAttribute('data-panel', 'canvas');
    panel.setAttribute('data-abierto', '');
    panel.removeAttribute('aria-hidden');
    panel.inert = false;
    pintar_();
  }

  async function abrir(id) {
    if (activo?.id !== id && !(await puedeCerrar())) return false;
    const c = await pedir('canvas:abrir', id);
    if (!c) { toast({ text: 'That canvas is gone.', kind: 'danger' }); await cargarBarra(); return false; }
    mostrar(c);
    return true;
  }

  /** Cierra el panel. Con `rescatar`, un borrador sin guardar queda para la
   *  próxima vez que se abra ese canvas (el camino que no pregunta). */
  function cerrar({ rescatar = false } = {}) {
    if (!abierto()) return;
    if (rescatar && sucio()) rescates.set(activo.id, cuerpo.querySelector('.dm-canvas-area').value);
    editando = false;
    panel.removeAttribute('data-abierto');
    panel.removeAttribute('data-editando');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    pintarBarra();
    // El hueco se suelta cuando el panel terminó de irse: antes, la
    // conversación se le metería por debajo mientras todavía se ve.
    clearTimeout(cerrando);
    cerrando = setTimeout(() => {
      if (abierto()) return;
      // (si mientras tanto abrió el navegador, el hueco ya es de él)
      if (escena.getAttribute('data-panel') === 'canvas') escena.removeAttribute('data-panel');
      activo = null;
      cuerpo._md = null;
      cuerpo.replaceChildren();
    }, ms('dur-base') + 40);
  }

  /** ¿Se puede dejar lo que hay abierto? Con un borrador sin guardar, pregunta. */
  async function puedeCerrar() {
    if (!sucio()) return true;
    return confirm({ title: 'Discard your changes?', text: `“${activo.title}” has edits you have not saved.`, confirmLabel: 'Discard', danger: true });
  }

  async function salirDeEditar() {
    if (!(await puedeCerrar())) return;
    editando = false;
    // se descartó el borrador: lo que queda a la vista es lo último del agente
    if (llegado?.id === activo?.id) activo = llegado;
    llegado = null;
    pintarCabeza();
    pintarCuerpo();
  }

  async function guardar() {
    if (!editando || !activo) return;
    const content = cuerpo.querySelector('.dm-canvas-area').value;
    const c = await pedir('canvas:guardar', { id: activo.id, content, title: activo.title });
    if (!c) { toast({ text: 'Could not save: that canvas is gone.', kind: 'danger' }); return; }
    activo = c;
    editando = false;
    llegado = null; // lo guardado reemplaza a lo que hubiera escrito el agente
    items = items.map((x) => (x.id === c.id ? liviano(c) : x));
    pintar_();
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(activo.content);
      toast({ text: 'Copied' });
    } catch {
      toast({ text: 'Could not copy', kind: 'danger' });
    }
  }

  async function exportar() {
    const r = await pedir('canvas:exportar', { title: activo.title, kind: activo.kind, language: activo.language, content: activo.content });
    if (r?.ok) toast({ text: `Saved to ${r.path}` });
    else if (!r?.canceled) toast({ text: `Could not export: ${r?.error ?? 'unknown error'}`, kind: 'danger' });
  }

  async function borrar() {
    const c = activo;
    const si = await confirm({ title: 'Delete this canvas?', text: `“${c.title}” will be deleted for good. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
    if (!si) return;
    await pedir('canvas:borrar', { id: c.id, convoId: c.conversation_id });
    rescates.delete(c.id);
    editando = false;
    cerrar();
    await cargarBarra();
  }

  bEditar.addEventListener('click', () => { editando = true; pintarCabeza(); pintarCuerpo(); });
  bGuardar.addEventListener('click', guardar);
  bCancelar.addEventListener('click', salirDeEditar);
  bCopiar.addEventListener('click', copiar);
  bExportar.addEventListener('click', exportar);
  bBorrar.addEventListener('click', borrar);
  bCerrar.addEventListener('click', async () => { if (await puedeCerrar()) cerrar(); });

  // ---------- Lo que hace el agente ----------
  // Creó o cambió un canvas: aparece en la barra y se abre, si es de este chat.
  datos.on('canvas', ({ chat, canvas }) => {
    if (chat !== datos.chatActual()?.id || !canvas) return;
    items = items.some((x) => x.id === canvas.id) ? items.map((x) => (x.id === canvas.id ? liviano(canvas) : x)) : [...items, liviano(canvas)];
    if (activo?.id === canvas.id && sucio()) {
      // el usuario lo está editando: su borrador no se pisa
      llegado = canvas;
      pintarBarra();
      toast({ text: `The agent changed “${canvas.title}” while you were editing. Your draft is still here; saving it will replace the agent’s version.` });
      return;
    }
    if (sucio()) { pintarBarra(); return; } // está editando OTRO: no se le saca de las manos
    mostrar(canvas);
  });
  // Lo borró el agente: va a la papelera, y se puede traer de vuelta.
  window.rad.on('canvas:evento', (ev) => {
    if (ev?.tipo !== 'borrado' || !ev.canvas) return;
    const era = ev.canvas;
    if (activo?.id === era.id) { editando = false; cerrar(); }
    items = items.filter((x) => x.id !== era.id);
    pintarBarra();
    toast({
      text: `The agent deleted “${era.title}”. It stays in the trash for a week.`,
      duration: 9000,
      action: { label: 'Restore', onClick: async () => { await pedir('canvas:restaurar', era.id); await cargarBarra(); } },
    });
  });

  // ---------- La biblioteca ----------
  const hace = (sqlite) => {
    const t = Date.parse(`${String(sqlite).replace(' ', 'T')}Z`);
    if (!Number.isFinite(t)) return '';
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    if (min < 1440) return `${Math.round(min / 60)} h ago`;
    return `${Math.round(min / 1440)} d ago`;
  };

  async function abrirBiblioteca() {
    let todos = await pedir('canvas:todos');
    const buscar = h('input', 'rad-input', { type: 'search', placeholder: 'Search by title or chat', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search canvases', 'data-autofocus': true });
    const lista = h('div', 'dm-biblio-lista rad-scroll', { role: 'list' });
    const vacio = h('p', 'dm-biblio-vacio rad-swap');
    const cuerpoModal = h('div', 'dm-biblio', {}, h('label', 'rad-field', {}, buscar), lista, vacio);
    wireScroll(lista);
    wireControls(cuerpoModal);
    const modal = openModal({ title: 'All canvases', body: cuerpoModal, actions: [{ id: 'cerrar', label: 'Close' }] });

    const recargar = async () => { todos = await pedir('canvas:todos'); pintarLista(); };
    const fila = (c) => {
      const nombre = h('span', 'dm-biblio-nombre');
      const detalle = h('span', 'dm-biblio-detalle');
      const restaurar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'restaurar', 'aria-label': 'Restore', 'data-rad-tip': 'Restore' }, icono('volver'));
      const quitar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'quitar', 'aria-label': 'Delete', 'data-rad-tip': 'Delete for good' }, icono('tacho'));
      const abrirla = h('button', 'dm-biblio-abrir', { type: 'button' }, icono(c.kind === 'code' ? 'codigo' : 'canvas'), h('span', 'dm-biblio-textos', {}, nombre, detalle));
      const nodo = h('div', 'dm-biblio-fila', { role: 'listitem' }, abrirla, restaurar, quitar);
      const yo = () => todos.find((x) => x.id === (nodo.dataset.radKey ?? c.id));
      abrirla.addEventListener('click', async () => {
        const x = yo();
        if (!x || x.trashed) return;
        modal.close('abrir');
        await abrir(x.id);
      });
      restaurar.addEventListener('click', async () => { await pedir('canvas:restaurar', nodo.dataset.radKey ?? c.id); await recargar(); await cargarBarra(); });
      quitar.addEventListener('click', async () => {
        const x = yo();
        if (!x) return;
        const si = await confirm({ title: 'Delete this canvas?', text: `“${x.title}” will be deleted for good. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
        if (!si) return;
        await pedir('canvas:borrar', { id: x.id, convoId: x.conversation_id });
        if (activo?.id === x.id) { editando = false; cerrar(); }
        await recargar();
        await cargarBarra();
      });
      ponerFila(nodo, c);
      return nodo;
    };
    function ponerFila(nodo, c) {
      nodo.querySelector('.dm-biblio-nombre').textContent = c.title;
      nodo.querySelector('.dm-biblio-detalle').textContent = c.trashed
        ? `In the trash · ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left`
        : [c.conversationTitle || 'No chat', meta(c), hace(c.updated_at)].filter(Boolean).join(' · ');
      nodo.toggleAttribute('data-papelera', Boolean(c.trashed));
      nodo.querySelector('[data-accion="restaurar"]').hidden = !c.trashed;
      nodo.querySelector('.dm-biblio-abrir').disabled = Boolean(c.trashed);
    }
    function pintarLista() {
      const q = buscar.value.trim().toLowerCase();
      const visibles = todos.filter((c) => !q || `${c.title} ${c.conversationTitle ?? ''}`.toLowerCase().includes(q));
      reconcile(lista, visibles, {
        key: (c) => c.id,
        create: fila,
        update: ponerFila,
      });
      swapText(vacio, visibles.length ? '' : todos.length ? 'Nothing matches.' : 'No canvases yet. An agent with the Canvas tool creates them.');
    }
    buscar.addEventListener('input', pintarLista);
    pintarLista();
  }
  botonBiblioteca.addEventListener('click', abrirBiblioteca);

  return {
    panel,
    barra,
    botonBiblioteca,
    abierto,
    abrir,
    cerrar,
    /** Se cambió de chat: el panel se cierra (rescatando un borrador) y la
     *  barra pasa a ser la del chat nuevo. */
    alCambiarDeChat() {
      if (chatDeLaBarra === (datos.chatActual()?.id ?? null)) return;
      cerrar({ rescatar: true });
      cargarBarra();
    },
  };
}
