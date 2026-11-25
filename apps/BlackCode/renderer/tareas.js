// La vista Tasks: las tareas programadas y lo que dejaron.
//
// Una tarea es un pedido que un agente corre solo, a una hora o cada tanto
// (ver main/tareas.cjs). Acá el usuario las arma, las prende y las apaga, las
// corre ya, y lee los resultados: cada corrida deja uno en la bandeja, que se
// puede seguir en un chat. Un agente también puede crearlas (la tool
// `schedule`), siempre con permiso.
//
// El único que escribe las tareas y la bandeja es el proceso principal: la
// vista pide cada cosa por su canal y vuelve a leer cuando le avisan.

import { openModal, confirm } from '/@core/modal.js';
import { reconcile } from '/@core/list.js';
import { swapText } from '/@core/motion.js';
import { createSelect, wireControls, setFieldError } from '/@core/controls.js';
import { wireScroll } from '/@core/scroll.js';
import { toast } from '/@core/toast.js';
import { setBusy } from '/@core/busy.js';
import * as datos from './datos.js';
import { h, icono } from './piezas.js';
import { iconoTool } from './iconos-tools.js';
import { pintar } from './markdown.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
const VACIO = '_vacio';
const fecha = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** El punto de la pestaña: hay resultados sin leer. Va fuera de la vista porque
 *  una vista se monta recién al abrirla, y el punto tiene que estar desde antes. */
export async function ponerPunto(sinLeer = null) {
  const n = sinLeer ?? (await pedir('tareas:leer').catch(() => null))?.sinLeer ?? 0;
  document.querySelector('.rad-tab[data-view="tareas"]')?.toggleAttribute('data-pendiente', n > 0);
  return n;
}

// Un resultado que hay que abrir apenas se pueda (el aviso de Windows trae acá).
let porAbrir = null;
let abrirYa = null;
export function abrirResultado(id) {
  if (abrirYa) abrirYa(id);
  else porAbrir = id;
}

// Los cuatro «cuándo corre» del formulario, y cómo se pasan a un spec.
const CUANDO = [
  { value: 'en', label: 'Once, in a while' },
  { value: 'a', label: 'Once, at a time of day' },
  { value: 'cada', label: 'Again and again' },
  { value: 'dia', label: 'Every day' },
];
const UNIDADES = [{ value: '1', label: 'minutes' }, { value: '60', label: 'hours' }, { value: '1440', label: 'days' }];
const cuandoDe = (spec) => (spec?.kind === 'daily' ? 'dia' : spec?.kind === 'every' ? 'cada' : spec?.a ? 'a' : 'en');
const partir = (minutos) => (minutos % 1440 === 0 ? [minutos / 1440, '1440'] : minutos % 60 === 0 ? [minutos / 60, '60'] : [minutos, '1']);

export function montarTareas(el, { router }) {
  let estado = { tareas: [], resultados: [], sinLeer: 0, corriendo: null };
  const nombreDe = (id) => datos.agente(id)?.nombre ?? 'a deleted agent';

  // ---------- El formulario ----------
  function abrirTarea(t = null) {
    const campo = (rotulo, control, pista) => h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, rotulo), control, pista ? h('span', 'rad-field-hint', {}, pista) : null);
    const titulo = h('input', 'rad-input', { type: 'text', maxlength: '80', autocomplete: 'off', 'data-autofocus': !t, 'data-campo': 'tarea-titulo', placeholder: 'Morning news' });
    const prompt = h('textarea', 'rad-input dm-tarea-prompt', { rows: '6', maxlength: '8000', 'data-campo': 'tarea-prompt', placeholder: 'Search the news about… and give me the five that matter, with their links.' });
    const numero = h('input', 'rad-input rad-mono', { type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', 'data-campo': 'tarea-numero', 'aria-label': 'How many' });
    const hora = h('input', 'rad-input rad-mono', { type: 'text', maxlength: '5', autocomplete: 'off', 'data-campo': 'tarea-hora', 'aria-label': 'Time of day', placeholder: '09:00' });
    const actuar = h('input', '', { type: 'checkbox', role: 'switch', 'data-campo': 'tarea-actuar' });
    titulo.value = t?.titulo ?? '';
    prompt.value = t?.prompt ?? '';
    actuar.checked = t?.actuar === true;
    const [n0, u0] = partir(t?.spec?.minutos ?? 30);
    numero.value = String(n0);
    hora.value = t?.spec?.a ?? '09:00';

    const agentes = datos.listaAgentes();
    const agente = createSelect({ options: agentes.map((a) => ({ value: a.id, label: a.nombre })), value: t?.agente ?? datos.agenteActual().id });
    agente.el.dataset.campo = 'tarea-agente';
    agente.el.setAttribute('aria-labelledby', 'dm-tarea-agente-rotulo');
    const unidad = createSelect({ options: UNIDADES, value: u0 });
    unidad.el.dataset.campo = 'tarea-unidad';
    unidad.el.setAttribute('aria-label', 'Unit');
    // «En un rato» y «cada tanto» piden una cantidad; «a una hora» y «todos los días», la hora.
    const parteLapso = h('div', 'dm-mcp-parte', {}, h('div', 'dm-mcp-parte-in', {}, h('div', 'dm-tarea-lapso', {}, numero, unidad.el)));
    const parteHora = h('div', 'dm-mcp-parte', {}, h('div', 'dm-mcp-parte-in', {}, hora));
    const pista = h('span', 'rad-field-hint rad-swap');
    const PISTAS = {
      en: 'It runs one time, that long from now.',
      a: 'It runs one time, the next time the clock shows that hour (24 hours, like 18:30).',
      cada: 'It runs again every time that much time goes by, 5 minutes at the least. Every run spends tokens.',
      dia: 'It runs every day at that hour (24 hours, like 09:00).',
    };
    const ponerCuando = (c) => {
      const lapso = c === 'en' || c === 'cada';
      parteLapso.toggleAttribute('data-abierto', lapso);
      parteHora.toggleAttribute('data-abierto', !lapso);
      parteLapso.inert = !lapso;
      parteHora.inert = lapso;
      swapText(pista, PISTAS[c]);
    };
    const cuando = createSelect({ options: CUANDO, value: cuandoDe(t?.spec), onChange: ponerCuando });
    cuando.el.dataset.campo = 'tarea-cuando';
    cuando.el.setAttribute('aria-labelledby', 'dm-tarea-cuando-rotulo');
    ponerCuando(cuando.value);

    const campos = {
      titulo: campo('Name', titulo),
      agente: h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: 'dm-tarea-agente-rotulo' }, 'Agent'), agente.el, h('span', 'rad-field-hint', {}, 'It runs with this agent’s model, instructions, memory and skills.')),
      prompt: campo('What to do', prompt, 'Written for an agent that starts from nothing: a run does not remember any chat.'),
      spec: h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: 'dm-tarea-cuando-rotulo' }, 'When'), cuando.el, parteLapso, parteHora, pista),
    };
    const form = h('div', 'dm-mcp-form dm-tarea-form', {}, campos.titulo, campos.agente, campos.prompt, campos.spec,
      h('label', 'rad-switch', {}, actuar, h('span', 'rad-switch-track'), h('span', 'dm-tools-grupo', {}, 'Let it act',
        h('small', '', {}, 'Off, a run can only search and read. On, it uses what this agent has (files, commands, the web) with nobody approving each step. It never makes images, schedules tasks or uses an MCP server that asks first.'))));
    wireControls(form);
    const specDe = () => {
      const c = cuando.value;
      if (c === 'a') return { kind: 'once', a: hora.value };
      if (c === 'dia') return { kind: 'daily', a: hora.value };
      const minutos = Number(numero.value.trim()) * Number(unidad.value);
      return c === 'cada' ? { kind: 'every', minutos } : { kind: 'once', minutos };
    };
    const guardar = async () => {
      for (const c of Object.values(campos)) setFieldError(c, null);
      const r = await pedir('tareas:guardar', { id: t?.id, titulo: titulo.value, prompt: prompt.value, agente: agente.value, spec: specDe(), actuar: actuar.checked })
        .catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      if (r?.ok) return true;
      const c = campos[r?.campo] ?? campos.titulo;
      setFieldError(c, r?.error ?? 'Could not save the task.');
      c.querySelector('.rad-input')?.focus();
      return false;
    };
    const modal = openModal({
      title: t ? 'Change task' : 'New task',
      body: form,
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', close: false, onClick: () => { guardar().then((bien) => { if (bien) modal.close('ok'); }); } }],
    });
    return modal;
  }

  async function borrar(t) {
    const si = await confirm({ title: 'Delete this task?', text: `“${t.titulo}” will stop running. Its results stay.`, confirmLabel: 'Delete', danger: true });
    if (!si) return;
    const r = await pedir('tareas:quitar', t.id);
    if (r?.ok) toast({ text: `Deleted “${t.titulo}”.`, duration: 9000, action: { label: 'Undo', onClick: () => pedir('tareas:restaurar', t.id) } });
  }

  // ---------- Un resultado, entero ----------
  async function abrir(id) {
    const r = estado.resultados.find((x) => x.id === id);
    if (!r) return null;
    const salida = h('div', 'dm-tarea-salida dm-md rad-scroll');
    if (r.salida) pintar(salida, r.salida);
    else salida.append(h('p', 'dm-memoria-vacia', {}, r.error ? 'It left no text.' : 'It finished with no text.'));
    wireScroll(salida);
    const pasos = h('div', 'dm-tarea-pasos', {}, ...r.pasos.map((p) => h('span', 'dm-tarea-paso', { 'data-estado': p.status }, iconoTool(p.name), h('span', 'rad-mono', {}, p.label || p.name))));
    const cuerpo = h('div', 'dm-tarea-resultado', {},
      h('p', 'dm-memoria-de', {}, `${r.agenteNombre || nombreDe(r.agente)} · ${fecha(r.ts)}${r.manual ? ' · run by hand' : ''}${r.actuo ? ' · allowed to act' : ' · read-only'}`),
      r.error ? h('p', 'dm-estado', { 'data-tono': 'danger', role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto', {}, r.error)) : null,
      r.cortada === 'stopped' ? h('p', 'dm-estado', { 'data-tono': 'warning', role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto', {}, 'It was stopped before it finished.')) : null,
      r.cortada === 'maxrounds' ? h('p', 'dm-estado', { 'data-tono': 'warning', role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto', {}, 'It used up its tool steps before finishing.')) : null,
      salida,
      r.pasos.length ? h('p', 'rad-field-label', {}, `What it ran (${r.pasos.length})`) : null,
      r.pasos.length ? pasos : null);
    const modal = openModal({
      title: r.titulo,
      body: cuerpo,
      actions: [
        { id: 'borrar', label: 'Delete', variant: 'danger' },
        { id: 'cerrar', label: 'Close' },
        { id: 'chat', label: 'Continue in a chat', variant: 'primary' },
      ],
    });
    modal.el.dataset.resultado = r.id;
    if (!r.leida) pedir('tareas:leida', r.id);
    modal.closed.then(async (que) => {
      if (que === 'borrar') await pedir('tareas:quitar-resultado', r.id);
      else if (que === 'chat') {
        const c = await datos.chatDeTarea({ agente: r.agente, titulo: r.titulo, prompt: r.prompt, salida: r.salida || (r.error ? `(The task failed: ${r.error})` : '(The task finished with no text.)') });
        if (c) router.go('chat');
        else toast({ text: 'The agent of that task no longer exists.', kind: 'danger' });
      }
    });
    return modal;
  }

  // ---------- Las tareas ----------
  const lista = h('div', 'dm-skills-lista', { role: 'list' });
  const cuandoCorre = (t) => {
    if (t.corriendo) return 'running now';
    if (!t.activa) return t.spec.kind === 'once' && t.corridas ? `done · ran ${fecha(t.ultima)}` : 'paused';
    return `next run ${fecha(t.proxima)}`;
  };
  const fila = (t) => {
    if (t.id === VACIO) { const p = h('p', 'dm-memoria-vacia rad-swap'); swapText(p, t.texto); return p; }
    const yo = () => estado.tareas.find((x) => x.id === (nodo.dataset.radKey ?? t.id));
    const activa = h('input', '', { type: 'checkbox', role: 'switch', 'aria-label': 'On', 'data-accion': 'tarea-activa' });
    const correr = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'tarea-correr', 'aria-label': 'Run now', 'data-rad-tip': 'Run now' }, icono('correr'));
    const frenar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'tarea-frenar', 'aria-label': 'Stop', 'data-rad-tip': 'Stop' }, icono('frenar'));
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'tarea-editar', 'aria-label': 'Change', 'data-rad-tip': 'Change' }, icono('lapiz'));
    const quitar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'tarea-borrar', 'aria-label': 'Delete', 'data-rad-tip': 'Delete' }, icono('tacho'));
    const nodo = h('div', 'dm-skill-fila dm-tarea-fila', { role: 'listitem' },
      h('div', 'dm-skill-textos', {}, h('span', 'dm-skill-nombre'), h('span', 'dm-skill-descripcion rad-swap'), h('span', 'dm-memoria-de')),
      h('label', 'rad-switch', { 'data-rad-tip': 'On' }, activa, h('span', 'rad-switch-track')), correr, frenar, editar, quitar);
    activa.addEventListener('change', () => { const x = yo(); if (x) pedir('tareas:activar', { id: x.id, activa: activa.checked }); });
    correr.addEventListener('click', async () => {
      const x = yo();
      if (!x) return;
      const r = await pedir('tareas:correr', x.id);
      if (!r?.ok) toast({ text: r?.error ?? 'Could not run the task.', kind: 'danger' });
    });
    frenar.addEventListener('click', () => pedir('tareas:frenar'));
    editar.addEventListener('click', () => { const x = yo(); if (x) abrirTarea(x); });
    quitar.addEventListener('click', () => { const x = yo(); if (x) borrar(x); });
    wireControls(nodo);
    ponerFila(nodo, t);
    return nodo;
  };
  function ponerFila(nodo, t) {
    if (t.id === VACIO) { swapText(nodo, t.texto); return; }
    nodo.dataset.tarea = t.titulo;
    nodo.dataset.estado = t.corriendo ? 'corriendo' : t.activa ? 'activa' : 'apagada';
    const nombre = nodo.querySelector('.dm-skill-nombre');
    if (nombre.textContent !== t.titulo) nombre.textContent = t.titulo;
    swapText(nodo.querySelector('.dm-skill-descripcion'), `${t.cuando} · ${cuandoCorre(t)}`);
    const pie = [nombreDe(t.agente), t.actuar ? 'allowed to act' : 'read-only', t.de === 'agent' ? 'made by an agent' : '', t.corridas ? `${t.corridas} run${t.corridas === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    const p = nodo.querySelector('.dm-memoria-de');
    if (p.textContent !== pie) p.textContent = pie;
    nodo.toggleAttribute('data-apagada', !t.activa && !t.corriendo);
    const sw = nodo.querySelector('[data-accion="tarea-activa"]');
    if (sw.checked !== t.activa) sw.checked = t.activa;
    nodo.querySelector('[data-accion="tarea-correr"]').hidden = t.corriendo;
    nodo.querySelector('[data-accion="tarea-frenar"]').hidden = !t.corriendo;
    setBusy(nodo, t.corriendo === true);
  }

  // ---------- La bandeja ----------
  const bandeja = h('div', 'dm-skills-lista', { role: 'list' });
  const cuenta = h('span', 'dm-memoria-cuenta rad-mono rad-swap');
  const bLeidas = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'tareas-leidas' }, 'Mark all read');
  const bVaciar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'tareas-vaciar' }, 'Clear');
  // (el resultado es markdown: en el renglón de la lista va sin sus marcas)
  const resumen = (r) => (r.error ? `Failed: ${r.error}` : r.salida || 'Finished with no text.').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 180);
  const filaR = (r) => {
    if (r.id === VACIO) { const p = h('p', 'dm-memoria-vacia rad-swap'); swapText(p, r.texto); return p; }
    const nodo = h('button', 'dm-skill-fila dm-tarea-resultado-fila', { type: 'button', role: 'listitem', 'data-accion': 'resultado-abrir' },
      h('i', 'dm-tarea-nuevo', { 'aria-hidden': 'true' }),
      h('div', 'dm-skill-textos', {}, h('span', 'dm-skill-nombre'), h('span', 'dm-skill-descripcion'), h('span', 'dm-memoria-de')));
    nodo.addEventListener('click', () => abrir(nodo.dataset.radKey ?? r.id));
    ponerFilaR(nodo, r);
    return nodo;
  };
  function ponerFilaR(nodo, r) {
    if (r.id === VACIO) { swapText(nodo, r.texto); return; }
    nodo.dataset.resultado = r.titulo;
    nodo.toggleAttribute('data-sin-leer', !r.leida);
    nodo.dataset.tono = r.error ? 'danger' : r.cortada ? 'warning' : '';
    const nombre = nodo.querySelector('.dm-skill-nombre');
    if (nombre.textContent !== r.titulo) nombre.textContent = r.titulo;
    const d = nodo.querySelector('.dm-skill-descripcion');
    if (d.textContent !== resumen(r)) d.textContent = resumen(r);
    const pie = `${r.agenteNombre || nombreDe(r.agente)} · ${fecha(r.ts)}${r.pasos.length ? ` · ${r.pasos.length} tool call${r.pasos.length === 1 ? '' : 's'}` : ''}${r.leida ? '' : ' · new'}`;
    const p = nodo.querySelector('.dm-memoria-de');
    if (p.textContent !== pie) p.textContent = pie;
  }
  bLeidas.addEventListener('click', () => pedir('tareas:leidas'));
  bVaciar.addEventListener('click', async () => {
    const si = await confirm({ title: 'Clear the results?', text: 'Every result in this list will be deleted. The tasks stay.', confirmLabel: 'Clear', danger: true });
    if (si) pedir('tareas:vaciar');
  });

  function pintarTodo() {
    const orden = [...estado.tareas].sort((a, b) => Number(b.activa) - Number(a.activa) || (a.proxima ?? Infinity) - (b.proxima ?? Infinity) || a.titulo.localeCompare(b.titulo));
    reconcile(lista, orden.length ? orden : [{ id: VACIO, texto: 'No tasks yet. Make one here, or ask an agent to remind you of something or to do it every morning.' }], { key: (t) => t.id, create: fila, update: ponerFila });
    reconcile(bandeja, estado.resultados.length ? estado.resultados : [{ id: VACIO, texto: 'Nothing yet. What a task finds shows up here when it runs.' }], { key: (r) => r.id, create: filaR, update: ponerFilaR });
    swapText(cuenta, estado.resultados.length ? `${estado.sinLeer} new of ${estado.resultados.length}` : '');
    bLeidas.disabled = !estado.sinLeer;
    bVaciar.disabled = !estado.resultados.length;
    pagina.dataset.tareas = String(estado.tareas.length);
    pagina.dataset.resultados = String(estado.resultados.length);
    pagina.dataset.sinLeer = String(estado.sinLeer);
    pagina.toggleAttribute('data-corriendo', Boolean(estado.corriendo));
    ponerPunto(estado.sinLeer);
  }

  async function cargar() {
    const nuevo = await pedir('tareas:leer').catch(() => null);
    if (!nuevo) return;
    estado = nuevo;
    pintarTodo();
  }

  const nueva = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'tarea-nueva' }, icono('mas'), 'New task');
  nueva.addEventListener('click', () => abrirTarea());
  const pagina = h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {},
      h('div', '', {}, h('h1', '', {}, 'Tasks'),
        h('p', '', {}, 'Things an agent does on its own, at a time or every so often. They run while BlackCode is open or in the system tray, and what they find lands here.')),
      h('div', 'dm-skills-acciones', {}, nueva)),
    h('section', 'dm-tarjeta', { 'data-tarjeta': 'tareas' }, h('h2', 'dm-tarjeta-nombre', {}, 'Scheduled'), lista),
    h('section', 'dm-tarjeta', { 'data-tarjeta': 'resultados' },
      h('div', 'dm-tarjeta-cabeza', {}, h('h2', 'dm-tarjeta-nombre', {}, 'Results'), h('div', 'dm-skills-acciones', {}, bLeidas, bVaciar)),
      bandeja, h('div', 'dm-memoria-pie', {}, cuenta)));
  wireControls(pagina);
  el.append(pagina);

  window.rad.on('tareas:evento', cargar);
  // (los nombres de los agentes van en cada fila)
  datos.on('agentes', pintarTodo);
  abrirYa = (id) => { cargar().then(() => abrir(id)); };
  cargar().then(() => { if (porAbrir) { const id = porAbrir; porAbrir = null; abrir(id); } });
}
