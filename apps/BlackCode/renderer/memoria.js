// La vista Memory: lo que BlackCode recuerda del usuario de un chat a otro.
//
// Son dos cosas (ver main/memoria.cjs):
//   - «About you» (el Core): un texto corto que escribe el usuario y que va
//     entero al contexto de cada chat. Se guarda solo.
//   - La lista: recuerdos de una línea, que anotan los agentes con su tool
//     `remember` o el usuario a mano. Cada uno puede llevar un detalle más
//     largo, que el agente lee solo cuando lo necesita.
//
// La memoria es una sola para toda la app. La ve cada agente que tenga
// prendido su grupo Memory (en el menú de tools de la conversación), y viaja
// al proveedor de ese agente con cada mensaje: la vista lo dice.
//
// El único que escribe la memoria es el proceso principal. La lista se cambia
// de a una entrada, así que no hay nada que pisar. El texto de «About you» sí
// se guarda entero, y un agente le puede agregar una línea mientras el usuario
// lo tiene abierto: por eso cada guardado manda la `base` con la que se abrió,
// y lo que entró mientras tanto se conserva (el cuidado es el de NeonCode).

import { openModal, confirm } from '/@core/modal.js';
import { reconcile } from '/@core/list.js';
import { swapText } from '/@core/motion.js';
import { wireControls, setFieldError } from '/@core/controls.js';
import { toast } from '/@core/toast.js';
import { h, icono } from './piezas.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
const GUARDAR_MS = 600;
const VACIO = '_vacio';
const tokens = (n) => Math.round(n / 4);

export function montarMemoria(el) {
  let estado = { core: '', entradas: [], topes: { core: 4000, lista: 8000, hecho: 300, detalle: 8000 }, enContexto: { usado: 0, fuera: 0 } };
  let base = '';      // el Core tal como está guardado
  let reloj = null;
  let cola = Promise.resolve();

  // ---------- About you ----------
  const area = h('textarea', 'rad-input dm-memoria-core', { rows: '6', spellcheck: 'false', 'aria-label': 'About you', 'data-campo': 'core', placeholder: 'Who you are, what you work on, how you want to be answered.' });
  const cuentaCore = h('span', 'dm-memoria-cuenta rad-mono rad-swap');
  const guardado = h('span', 'dm-memoria-guardado rad-swap', { role: 'status' });
  const tarjetaCore = h('section', 'dm-tarjeta', { 'data-tarjeta': 'core' },
    h('h2', 'dm-tarjeta-nombre', {}, 'About you'),
    h('p', 'dm-tarjeta-instr', {}, 'Always in context, in every chat. Keep it short: every line here costs a little on every message.'),
    h('label', 'rad-field', {}, area),
    h('div', 'dm-memoria-pie', {}, cuentaCore, guardado));

  const sucio = () => area.value !== base;
  function ponerCuentaCore() {
    const n = area.value.length;
    swapText(cuentaCore, `${n} of ${estado.topes.core} characters · about ${tokens(n)} tokens`);
    tarjetaCore.toggleAttribute('data-pasado', n > estado.topes.core);
  }
  /** Guarda el texto. Va a la fila: dos guardados seguidos no se pisan. */
  function guardarCore() {
    clearTimeout(reloj);
    cola = cola.then(async () => {
      if (!sucio()) return;
      const enviado = area.value;
      swapText(guardado, 'Saving…');
      try {
        const final = await pedir('memoria:core', { texto: enviado, base });
        base = final;
        // lo que quedó guardado puede traer una línea que un agente agregó
        // mientras tanto: se muestra, salvo que el usuario haya seguido tecleando
        if (area.value === enviado && final !== enviado) area.value = final;
        ponerCuentaCore();
        swapText(guardado, 'Saved');
      } catch {
        swapText(guardado, 'Could not save');
      }
    });
    return cola;
  }
  area.addEventListener('input', () => {
    ponerCuentaCore();
    swapText(guardado, '');
    clearTimeout(reloj);
    reloj = setTimeout(guardarCore, GUARDAR_MS);
  });
  area.addEventListener('blur', () => { if (sucio()) guardarCore(); });

  // ---------- La lista ----------
  const buscar = h('input', 'rad-input', { type: 'search', placeholder: 'Search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search memory', 'data-campo': 'buscar' });
  const nueva = h('button', 'rad-button', { type: 'button', 'data-accion': 'memoria-nueva' }, icono('mas'), 'Add');
  const lista = h('div', 'dm-memoria-lista', { role: 'list' });
  const cuentaLista = h('span', 'dm-memoria-cuenta rad-mono rad-swap');
  const aviso = h('div', 'dm-memoria-aviso', {}, h('div', 'dm-memoria-aviso-in', {},
    h('p', 'dm-estado', { role: 'status', 'data-tono': 'warning' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto rad-swap'))));
  const tarjetaLista = h('section', 'dm-tarjeta', { 'data-tarjeta': 'recuerdos' },
    h('h2', 'dm-tarjeta-nombre', {}, 'What your agents remember'),
    h('p', 'dm-tarjeta-instr', {}, 'One line each. Agents add these with their remember tool; you can add, change or delete them. Every line is in context; the detail behind one is read only when an agent needs it.'),
    h('div', 'dm-memoria-barra', {}, h('label', 'rad-field dm-memoria-buscar', {}, buscar), nueva),
    lista,
    h('div', 'dm-memoria-pie', {}, cuentaLista),
    aviso);

  const cuando = (ms) => {
    if (!ms) return '';
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    if (min < 1440) return `${Math.round(min / 60)} h ago`;
    return `${Math.round(min / 1440)} d ago`;
  };

  /** El formulario de un recuerdo: nuevo, o uno que ya existe. */
  function abrirEntrada(e = null) {
    const hecho = h('input', 'rad-input', { type: 'text', maxlength: String(estado.topes.hecho), autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true, 'data-campo': 'hecho', 'aria-label': 'What to remember' });
    const detalle = h('textarea', 'rad-input dm-memoria-detalle', { rows: '6', maxlength: String(estado.topes.detalle), spellcheck: 'false', 'data-campo': 'detalle', 'aria-label': 'Detail' });
    hecho.value = e?.hecho ?? '';
    detalle.value = e?.detalle ?? '';
    const campoHecho = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'What to remember'), hecho, h('span', 'rad-field-hint', {}, 'One short line. This is what agents see in every chat.'));
    const campoDetalle = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Detail (optional)'), detalle, h('span', 'rad-field-hint', {}, 'Not in context: an agent reads it only when it needs it.'));
    const cuerpo = h('div', 'dm-memoria-form', {}, campoHecho, campoDetalle);
    wireControls(cuerpo);
    const guardar = async () => {
      if (!hecho.value.trim()) { setFieldError(campoHecho, 'Write what to remember.'); hecho.focus(); return false; }
      const que = { hecho: hecho.value, detalle: detalle.value };
      const r = e ? await pedir('memoria:editar', { id: e.id, ...que }) : await pedir('memoria:agregar', que);
      if (!r?.ok) { setFieldError(campoHecho, `Could not save: ${r?.error ?? 'unknown error'}.`); return false; }
      if (r.repetida) toast({ text: 'That was already in memory.' });
      return true;
    };
    const modal = openModal({
      title: e ? 'Change what is remembered' : 'Add to memory',
      body: cuerpo,
      // (guardar espera al proceso principal: el modal se cierra recién si salió bien)
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', close: false, onClick: () => { guardar().then((bien) => { if (bien) modal.close('ok'); }); } }],
    });
    hecho.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      modal.el.querySelector('.rad-button[data-variant="primary"]').click();
    });
    return modal;
  }

  async function borrar(e) {
    const si = await confirm({ title: 'Forget this?', text: `“${e.hecho}” will be deleted from memory. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
    if (si) await pedir('memoria:borrar', e.id);
  }

  const fila = (e) => {
    // (reconcile no llama a update para un nodo recién creado)
    if (e.id === VACIO) { const p = h('p', 'dm-memoria-vacia rad-swap'); swapText(p, e.texto); return p; }
    const id = () => nodo.dataset.radKey ?? e.id;
    const yo = () => estado.entradas.find((x) => x.id === id());
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'memoria-editar', 'aria-label': 'Change', 'data-rad-tip': 'Change' }, icono('lapiz'));
    const quitar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'memoria-borrar', 'aria-label': 'Delete', 'data-rad-tip': 'Delete' }, icono('tacho'));
    const nodo = h('div', 'dm-memoria-fila', { role: 'listitem' },
      h('div', 'dm-memoria-textos', {}, h('span', 'dm-memoria-hecho'), h('span', 'dm-memoria-de')),
      editar, quitar);
    editar.addEventListener('click', () => { const x = yo(); if (x) abrirEntrada(x); });
    quitar.addEventListener('click', () => { const x = yo(); if (x) borrar(x); });
    ponerFila(nodo, e);
    return nodo;
  };
  function ponerFila(nodo, e) {
    if (e.id === VACIO) { swapText(nodo, e.texto); return; }
    const hecho = nodo.querySelector('.dm-memoria-hecho');
    if (hecho.textContent !== e.hecho) hecho.textContent = e.hecho;
    const de = [e.de === 'agent' ? 'noted by an agent' : 'added by you', cuando(e.creado), e.detalle ? 'has detail' : ''].filter(Boolean).join(' · ');
    const pie = nodo.querySelector('.dm-memoria-de');
    if (pie.textContent !== de) pie.textContent = de;
    nodo.toggleAttribute('data-con-detalle', Boolean(e.detalle));
  }

  function pintarLista() {
    const q = buscar.value.trim().toLowerCase();
    // las más nuevas arriba: son las que se acaban de anotar
    const visibles = estado.entradas.filter((e) => !q || `${e.hecho}\n${e.detalle}`.toLowerCase().includes(q)).reverse();
    const hueco = estado.entradas.length ? 'Nothing matches.' : 'Nothing remembered yet. An agent with Memory turned on notes things as you chat, or add one yourself.';
    reconcile(lista, visibles.length ? visibles : [{ id: VACIO, texto: hueco }], { key: (e) => e.id, create: fila, update: ponerFila });
    const n = estado.entradas.length;
    swapText(cuentaLista, `${n} ${n === 1 ? 'entry' : 'entries'} · ${estado.enContexto.usado} of ${estado.topes.lista} characters in context · about ${tokens(estado.enContexto.usado)} tokens`);
    const fuera = estado.enContexto.fuera;
    if (fuera) swapText(aviso.querySelector('.dm-estado-texto'), `The ${fuera} oldest ${fuera === 1 ? 'entry no longer fits' : 'entries no longer fit'} in context: agents only find ${fuera === 1 ? 'it' : 'them'} by searching. Delete what is out of date to make room.`);
    aviso.toggleAttribute('data-abierto', fuera > 0);
  }
  buscar.addEventListener('input', pintarLista);
  nueva.addEventListener('click', () => abrirEntrada());

  // ---------- Ponerse al día ----------
  async function cargar() {
    const nuevo = await pedir('memoria:leer').catch(() => null);
    if (!nuevo) return;
    estado = nuevo;
    // el Core que llega es el guardado: si el usuario no tiene nada a medio
    // escribir, se muestra; si lo tiene, su texto queda y la base no se mueve
    // (el próximo guardado conserva lo que haya entrado)
    if (!sucio()) { base = estado.core; area.value = estado.core; }
    ponerCuentaCore();
    pintarLista();
  }
  window.rad.on('memoria:evento', cargar);

  const pagina = h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {}, h('div', '', {}, h('h1', '', {}, 'Memory'),
      h('p', '', {}, 'What BlackCode remembers about you from one chat to the next. An agent sees it when its Memory group is on (the tools menu in the chat), and it travels to that agent’s provider with every message.'))),
    tarjetaCore, tarjetaLista);
  wireControls(pagina);
  el.append(pagina);
  cargar();
}
