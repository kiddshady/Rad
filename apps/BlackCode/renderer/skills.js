// La vista Skills: los procedimientos que el usuario les deja a sus agentes.
//
// Una skill es un nombre, una línea que dice cuándo usarla, y las
// instrucciones en markdown (ver main/skills.cjs). El agente que tiene
// prendido su grupo Skills ve la lista en cada chat y carga la que le sirve.
//
// Acá el usuario las escribe, las importa de un .md (el formato de las skills
// de Claude Code: `name` y `description` arriba, entre dos renglones `---`),
// las cambia, las apaga y las borra. Y REVISA lo que proponen los agentes: una
// skill que escribe un agente no se puede usar hasta que el usuario la
// aprueba acá. Si es un cambio a una que ya existía, se ve qué cambia.
//
// El único que escribe las skills es el proceso principal: la vista pide cada
// cosa por su canal.

import { openModal, confirm } from '/@core/modal.js';
import { reconcile } from '/@core/list.js';
import { swapText } from '/@core/motion.js';
import { wireControls, setFieldError } from '/@core/controls.js';
import { wireScroll } from '/@core/scroll.js';
import { toast } from '/@core/toast.js';
import { h, icono } from './piezas.js';
import { vistaDe } from './tools.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
const VACIO = '_vacio';

// Una propuesta que hay que mostrar apenas se pueda (el aviso del chat lleva
// acá): si la vista todavía no se montó, la abre al montarse.
let porRevisar = null;
let revisarYa = null;
export function revisarSkill(nombre) {
  if (revisarYa) revisarYa(nombre);
  else porRevisar = nombre;
}

export function montarSkills(el) {
  let estado = { skills: [], topes: { descripcion: 300, cuerpo: 20000, indice: 4000 }, enContexto: { usado: 0, pasado: false } };

  // ---------- El formulario ----------
  /** Una skill nueva (con `inicial`, la que se importó) o una que ya existe. */
  function abrirSkill(s = null, inicial = null) {
    const nombre = h('input', 'rad-input rad-mono', { type: 'text', maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'data-autofocus': !s, 'data-campo': 'nombre', 'aria-label': 'Name', placeholder: 'weekly-report' });
    const descripcion = h('input', 'rad-input', { type: 'text', maxlength: String(estado.topes.descripcion), autocomplete: 'off', 'data-campo': 'descripcion', 'aria-label': 'When to use it', placeholder: 'Use it when I ask for the weekly report' });
    const cuerpo = h('textarea', 'rad-input dm-skill-cuerpo rad-mono', { rows: '14', maxlength: String(estado.topes.cuerpo), spellcheck: 'false', 'data-autofocus': Boolean(s), 'data-campo': 'cuerpo', 'aria-label': 'Instructions' });
    nombre.value = s?.nombre ?? inicial?.nombre ?? '';
    descripcion.value = s?.descripcion ?? inicial?.descripcion ?? '';
    cuerpo.value = s?.cuerpo ?? inicial?.cuerpo ?? '';
    const campoNombre = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Name'), nombre, h('span', 'rad-field-hint', {}, 'Lowercase letters, digits, - or _.'));
    const campoDescripcion = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'When to use it'), descripcion, h('span', 'rad-field-hint', {}, 'One line. It is all an agent sees until it loads the skill.'));
    const campoCuerpo = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Instructions'), cuerpo, h('span', 'rad-field-hint', {}, 'Markdown, written for an agent that knows nothing of your chats: the goal, the steps, exact names and commands.'));
    const form = h('div', 'dm-skill-form', {}, campoNombre, campoDescripcion, campoCuerpo);
    wireControls(form);
    const guardar = async () => {
      for (const c of [campoNombre, campoDescripcion, campoCuerpo]) setFieldError(c, null);
      const r = await pedir('skills:guardar', { nombre: nombre.value, descripcion: descripcion.value, cuerpo: cuerpo.value, original: s?.nombre ?? null });
      if (r?.ok) return true;
      const error = r?.error ?? 'unknown error';
      // el error dice de qué campo es
      const campo = /^the name|already a skill named/.test(error) ? campoNombre : /^the description/.test(error) ? campoDescripcion : /^the body/.test(error) ? campoCuerpo : campoNombre;
      setFieldError(campo, `${error.charAt(0).toUpperCase()}${error.slice(1)}.`);
      campo.querySelector('.rad-input').focus();
      return false;
    };
    const modal = openModal({
      title: s ? 'Change skill' : 'New skill',
      body: form,
      // (guardar espera al proceso principal: el modal se cierra recién si salió bien)
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', close: false, onClick: () => { guardar().then((bien) => { if (bien) modal.close('ok'); }); } }],
    });
    return modal;
  }

  // ---------- Revisar una propuesta ----------
  async function revisar(nombre) {
    const r = await pedir('skills:revisar', nombre);
    if (!r) { toast({ text: 'That proposal is gone.' }); return; }
    const texto = h('pre', 'dm-skill-propuesta rad-mono rad-scroll');
    texto.textContent = r.propuesta.cuerpo;
    wireScroll(texto);
    const cambio = r.cambio ? vistaDe(r.cambio) : null;
    const cuerpo = h('div', 'dm-skill-revision', {},
      h('p', 'dm-skill-revision-que', {}, r.actual ? 'An agent proposed a change to this skill. The current version stays in use until you approve it.' : 'An agent wrote this skill. No agent can use it until you approve it.'),
      h('dl', 'dm-permiso-args', {}, h('dt', '', {}, 'when'), h('dd', '', {}, r.propuesta.descripcion),
        ...(r.actual && r.actual.descripcion !== r.propuesta.descripcion ? [h('dt', '', {}, 'was'), h('dd', '', {}, r.actual.descripcion)] : [])),
      ...(cambio ? [h('p', 'rad-field-label', {}, 'What changes'), cambio, h('p', 'rad-field-label', {}, 'How it would read')] : []),
      texto);
    const modal = openModal({
      title: `Review “${r.nombre}”`,
      body: cuerpo,
      actions: [
        { id: 'descartar', label: 'Discard', variant: 'danger' },
        { id: 'despues', label: 'Not now' },
        { id: 'aprobar', label: 'Approve', variant: 'primary' },
      ],
    });
    modal.el.dataset.skill = r.nombre;
    const que = await modal.closed;
    if (que === 'aprobar') await pedir('skills:aprobar', r.nombre);
    else if (que === 'descartar') await pedir('skills:descartar', r.nombre);
  }

  async function borrar(s) {
    const si = await confirm({ title: 'Delete this skill?', text: `“${s.nombre}” will be deleted. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
    if (si) await pedir('skills:borrar', s.nombre);
  }

  // ---------- La lista ----------
  const lista = h('div', 'dm-skills-lista', { role: 'list' });
  const cuenta = h('span', 'dm-memoria-cuenta rad-mono rad-swap');
  const aviso = h('div', 'dm-memoria-aviso', {}, h('div', 'dm-memoria-aviso-in', {},
    h('p', 'dm-estado', { role: 'status', 'data-tono': 'warning' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto rad-swap'))));

  const fila = (s) => {
    if (s.nombre === VACIO) { const p = h('p', 'dm-memoria-vacia rad-swap'); swapText(p, s.texto); return p; }
    const yo = () => estado.skills.find((x) => x.nombre === (nodo.dataset.radKey ?? s.nombre));
    const bRevisar = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'skill-revisar' }, 'Review');
    const activa = h('input', '', { type: 'checkbox', role: 'switch', 'aria-label': 'In use', 'data-accion': 'skill-activa' });
    const interruptor = h('label', 'rad-switch', { 'data-rad-tip': 'In use' }, activa, h('span', 'rad-switch-track'));
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'skill-editar', 'aria-label': 'Change', 'data-rad-tip': 'Change' }, icono('lapiz'));
    const quitar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'skill-borrar', 'aria-label': 'Delete', 'data-rad-tip': 'Delete' }, icono('tacho'));
    const nodo = h('div', 'dm-skill-fila', { role: 'listitem' },
      h('div', 'dm-skill-textos', {}, h('span', 'dm-skill-nombre rad-mono'), h('span', 'dm-skill-descripcion'), h('span', 'dm-memoria-de')),
      bRevisar, interruptor, editar, quitar);
    bRevisar.addEventListener('click', () => { const x = yo(); if (x) revisar(x.nombre); });
    activa.addEventListener('change', () => { const x = yo(); if (x) pedir('skills:activar', { nombre: x.nombre, activa: activa.checked }); });
    editar.addEventListener('click', () => { const x = yo(); if (x) abrirSkill(x); });
    quitar.addEventListener('click', () => { const x = yo(); if (x) borrar(x); });
    wireControls(nodo);
    ponerFila(nodo, s);
    return nodo;
  };
  function ponerFila(nodo, s) {
    if (s.nombre === VACIO) { swapText(nodo, s.texto); return; }
    const pendiente = Boolean(s.propuesta);
    const sinVersion = !s.cuerpo;
    const nombre = nodo.querySelector('.dm-skill-nombre');
    if (nombre.textContent !== s.nombre) nombre.textContent = s.nombre;
    const descripcion = sinVersion ? s.propuesta.descripcion : s.descripcion;
    const d = nodo.querySelector('.dm-skill-descripcion');
    if (d.textContent !== descripcion) d.textContent = descripcion;
    const pie = sinVersion ? 'proposed by an agent · not in use until you approve it'
      : [s.de === 'agent' ? 'written by an agent' : 'written by you', s.activa ? '' : 'turned off', pendiente ? 'an agent proposed a change' : ''].filter(Boolean).join(' · ');
    const p = nodo.querySelector('.dm-memoria-de');
    if (p.textContent !== pie) p.textContent = pie;
    nodo.toggleAttribute('data-pendiente', pendiente);
    nodo.toggleAttribute('data-apagada', !sinVersion && !s.activa);
    nodo.querySelector('[data-accion="skill-revisar"]').hidden = !pendiente;
    nodo.querySelector('.rad-switch').hidden = sinVersion;
    nodo.querySelector('[data-accion="skill-editar"]').hidden = sinVersion;
    const sw = nodo.querySelector('[data-accion="skill-activa"]');
    if (sw.checked !== s.activa) sw.checked = s.activa;
  }

  function pintar() {
    // lo que espera una decisión, arriba
    const orden = [...estado.skills].sort((a, b) => Number(Boolean(b.propuesta)) - Number(Boolean(a.propuesta)) || a.nombre.localeCompare(b.nombre));
    reconcile(lista, orden.length ? orden : [{ nombre: VACIO, texto: 'No skills yet. Write one, import a .md, or ask an agent to save a procedure: it will show up here for you to approve.' }],
      { key: (s) => s.nombre, create: fila, update: ponerFila });
    const vivas = estado.skills.filter((s) => s.cuerpo && s.activa).length;
    const total = estado.skills.length;
    swapText(cuenta, total ? `${vivas} of ${total} in use · the list takes ${estado.enContexto.usado} of ${estado.topes.indice} characters of context` : '');
    if (estado.enContexto.pasado) swapText(aviso.querySelector('.dm-estado-texto'), 'The list no longer fits in context: agents see the first ones and have to ask for the rest. Shorten some descriptions, or turn off the skills you do not use.');
    aviso.toggleAttribute('data-abierto', estado.enContexto.pasado);
  }

  async function cargar() {
    const nuevo = await pedir('skills:leer').catch(() => null);
    if (!nuevo) return;
    estado = nuevo;
    pintar();
  }
  window.rad.on('skills:evento', cargar);

  // ---------- Nueva e importar ----------
  const nueva = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'skill-nueva' }, icono('mas'), 'New skill');
  const importar = h('button', 'rad-button', { type: 'button', 'data-accion': 'skill-importar', 'data-rad-tip': 'From a .md file, like a SKILL.md' }, icono('bajar'), 'Import');
  const archivo = h('input', 'dm-selector', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', tabindex: '-1', 'aria-hidden': 'true' });
  nueva.addEventListener('click', () => abrirSkill());
  importar.addEventListener('click', () => archivo.click());
  /** Abre el formulario con lo que trae un .md. Queda sin guardar: el usuario lo mira primero. */
  async function importarTexto(texto, nombreDeArchivo) {
    const campos = await pedir('skills:de-md', { texto, archivo: nombreDeArchivo });
    if (!campos?.cuerpo) { toast({ text: 'That file has no instructions in it.', kind: 'danger' }); return null; }
    return abrirSkill(null, campos);
  }
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    archivo.value = '';
    if (!f) return;
    if (f.size > 200000) { toast({ text: 'That file is too big to be a skill.', kind: 'danger' }); return; }
    importarTexto(await f.text(), f.name);
  });

  const pagina = h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {},
      h('div', '', {}, h('h1', '', {}, 'Skills'),
        h('p', '', {}, 'Procedures you leave for your agents: how you want something done. An agent sees the list when its Skills group is on (the tools menu in the chat) and loads the one the task calls for.')),
      h('div', 'dm-skills-acciones', {}, importar, nueva)),
    h('section', 'dm-tarjeta', { 'data-tarjeta': 'skills' }, lista, h('div', 'dm-memoria-pie', {}, cuenta), aviso),
    archivo);
  wireControls(pagina);
  el.append(pagina);

  revisarYa = (nombre) => { cargar().then(() => revisar(nombre)); };
  cargar().then(() => { if (porRevisar) { const n = porRevisar; porRevisar = null; revisar(n); } });
  // (para el humo: importar sin pasar por el diálogo de archivos)
  el._importarTexto = importarTexto;
}
