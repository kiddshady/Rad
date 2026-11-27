// La vista de agentes y el formulario para crear o editar uno.

import { openModal, confirm } from '/@core/modal.js';
import { createSelect, setFieldError, wireControls } from '/@core/controls.js';
import { swapText } from '/@core/motion.js';
import { reconcile } from '/@core/list.js';
import { toast } from '/@core/toast.js';
import * as datos from './datos.js';
import { h, icono, cuantos } from './piezas.js';

let serie = 0;

/**
 * Abre el formulario de un agente: sin argumento crea uno, con un agente lo
 * edita. Devuelve una promesa con el agente (o null si se canceló).
 */
export function abrirAgente(agente = null) {
  const n = ++serie;
  const nombre = h('input', 'rad-input', { type: 'text', maxlength: '40', autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true, 'data-campo': 'nombre' });
  nombre.value = agente?.nombre ?? '';
  const campoNombre = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Name'), nombre);

  // Proveedor y modelo. Cada proveedor tiene su propio select de modelos, los
  // dos en la misma celda: al cambiar de proveedor se relevan, y cada uno se
  // acuerda de lo que tenía elegido.
  const lista = datos.proveedores();
  let actual = lista.some((p) => p.id === agente?.proveedor) ? agente.proveedor : datos.PROVEEDOR_INICIAL;
  const nota = h('span', 'rad-field-hint rad-swap');
  const celda = h('div', 'dm-modelos');
  const selects = new Map();
  const ponerNota = () => {
    const s = selects.get(actual);
    const sinLista = `Paste the ${datos.nombreProveedor(actual)} key in Settings to load its models.`;
    swapText(nota, s.modelos.length ? s.modelos.find((m) => m.id === s.select.value)?.nota ?? '' : sinLista);
  };
  for (const p of lista) {
    const suyo = agente?.proveedor === p.id ? agente.modelo : null;
    // El modelo de un agente puede haber salido de la lista (Venice los
    // cambia seguido): se lo deja elegible, con su id, en vez de perderlo.
    const modelos = suyo && !p.modelos.some((m) => m.id === suyo) ? [{ id: suyo, nombre: suyo, nota: 'no longer in the provider’s list' }, ...p.modelos] : p.modelos;
    const select = createSelect({
      options: modelos.map((m) => ({ value: m.id, label: m.nombre })),
      value: suyo ?? p.inicial,
      placeholder: 'No models yet',
      onChange: () => { ponerNota(); ponerTools(); },
    });
    select.el.setAttribute('aria-labelledby', `dm-modelo-${n}`);
    select.el.dataset.campo = 'modelo';
    select.el.dataset.proveedor = p.id;
    select.el.disabled = !modelos.length; // sin modelos no hay nada que desplegar
    selects.set(p.id, { select, modelos });
    celda.append(select.el);
  }
  const ponerProveedor = () => {
    for (const [id, { select }] of selects) {
      const activo = id === actual;
      select.el.toggleAttribute('data-activo', activo);
      select.el.inert = !activo;
      if (!activo) select.close();
    }
    ponerNota();
  };
  const proveedor = createSelect({
    options: lista.map((p) => ({ value: p.id, label: p.nombre })),
    value: actual,
    onChange: (v) => { actual = v; setFieldError(campoModelo, null); ponerProveedor(); ponerTools(); },
  });
  proveedor.el.setAttribute('aria-labelledby', `dm-proveedor-${n}`);
  proveedor.el.dataset.campo = 'proveedor';
  const campoProveedor = h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: `dm-proveedor-${n}` }, 'Provider'), proveedor.el);
  const campoModelo = h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: `dm-modelo-${n}` }, 'Model'), celda, nota);
  ponerProveedor();

  // (14 renglones: el doble de los 7 que tenía. Un system prompt es largo, y
  // en 7 se escribía a ciegas: Fran, 25/11/2026. Si la ventana es baja, el
  // formulario scrollea.)
  const instrucciones = h('textarea', 'rad-input', { rows: '14', spellcheck: 'false', placeholder: 'Who this agent is, what it knows and how it answers.', 'data-campo': 'instrucciones' });
  instrucciones.value = agente?.instrucciones ?? '';
  const campoInstr = h('label', 'rad-field', {},
    h('span', 'rad-field-label', {}, 'Instructions'),
    instrucciones,
    h('span', 'rad-field-hint', {}, 'The model reads this before every chat. It can be left empty.'));

  // Las tools del agente, por grupo. Un agente nuevo las trae todas prendidas;
  // apagadas, el agente solo conversa. Si el
  // modelo elegido no las acepta (pasa con varios de Venice) quedan como
  // están pero no se usan, y se dice.
  const elegidas = new Set(agente ? datos.toolsDe(agente) : datos.todasLasTools());
  const notaTools = h('span', 'rad-field-hint rad-swap');
  const filas = datos.gruposTools().map((g) => {
    const input = h('input', '', { type: 'checkbox', role: 'switch', 'data-grupo': g.id });
    input.checked = g.tools.some((t) => elegidas.has(t));
    return { g, input, nodo: h('label', 'rad-switch', {}, input, h('span', 'rad-switch-track'), h('span', 'dm-tools-grupo', {}, g.nombre, h('small', '', {}, g.mcp ? datos.detalleMcp(g) : g.tools.join(', ')))) };
  });
  // (la marca de un servidor MCP apagado no tiene fila: el agente la conserva)
  const sinFila = [...elegidas].filter((t) => datos.esMarcaMcp(t) && !filas.some((f) => f.g.tools.includes(t)));
  const toolsElegidas = () => [...filas.filter((f) => f.input.checked).flatMap((f) => f.g.tools), ...sinFila];
  const ponerTools = () => {
    const modelo = selects.get(actual)?.select.value;
    const acepta = !modelo || datos.modeloConTools(actual, modelo);
    swapText(notaTools, acepta
      ? 'Off, the agent only talks. On, it can act on this PC: each call asks first unless you turn that off in Settings.'
      : 'This model does not accept tools: the agent will only talk while it uses it.');
    campoTools.toggleAttribute('data-sin-soporte', !acepta);
  };
  const campoTools = h('div', 'rad-field', { 'data-campo': 'tools' },
    h('span', 'rad-field-label', {}, 'Tools'),
    h('div', 'dm-tools-lista', {}, ...filas.map((f) => f.nodo)),
    notaTools);
  ponerTools();

  const form = h('form', 'dm-form', {}, campoNombre, h('div', 'dm-form-par', {}, campoProveedor, campoModelo), campoInstr, campoTools);
  wireControls(form);
  form.addEventListener('submit', (e) => e.preventDefault());

  let resultado = null;
  const guardar = () => {
    if (!nombre.value.trim()) {
      setFieldError(campoNombre, 'Give it a name.');
      nombre.focus();
      return false; // el formulario sigue abierto
    }
    const modelo = selects.get(actual).select.value;
    if (!modelo) {
      setFieldError(campoModelo, `There are no ${datos.nombreProveedor(actual)} models to choose from yet.`);
      return false;
    }
    const valores = { nombre: nombre.value, proveedor: actual, modelo, instrucciones: instrucciones.value, tools: toolsElegidas() };
    if (agente) {
      datos.editarAgente(agente.id, valores);
      resultado = datos.agente(agente.id);
    } else {
      resultado = datos.crearAgente(valores);
    }
    return true;
  };
  nombre.addEventListener('input', () => { if (campoNombre.hasAttribute('data-invalid')) setFieldError(campoNombre, null); });

  const modal = openModal({
    title: agente ? 'Edit agent' : 'New agent',
    body: form,
    actions: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'ok', label: agente ? 'Save' : 'Create agent', variant: 'primary', onClick: guardar },
    ],
  });
  // Enter en el nombre es lo mismo que el botón primario.
  nombre.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    modal.el.querySelector('.rad-button[data-variant="primary"]').click();
  });
  return modal.closed.then(() => {
    proveedor.close();
    for (const { select } of selects.values()) select.close();
    return resultado;
  });
}

async function eliminar(agente) {
  const n = datos.chatsDe(agente.id).length;
  const si = await confirm({
    title: `Delete ${agente.nombre}?`,
    text: n
      ? `The agent will be deleted with its ${cuantos(n, 'chat', 'chats')}, its canvases and its memory. This can’t be undone.`
      : 'The agent will be deleted with its canvases and its memory. This can’t be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (si && await datos.borrarAgente(agente.id)) toast({ text: `${agente.nombre} was deleted` });
}

export function montarAgentes(el, { router }) {
  const nuevo = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'nuevo-agente' }, icono('mas'), 'New agent');
  nuevo.addEventListener('click', () => abrirAgente());
  const lista = h('div', 'dm-agentes', { role: 'list' });
  el.append(h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {},
      h('div', '', {}, h('h1', '', {}, 'Agents'), h('p', '', {}, 'Each agent has its own model, instructions and chats.')),
      nuevo),
    lista));

  const tarjeta = (a) => {
    const nombre = h('h2', 'dm-tarjeta-nombre rad-swap');
    const modelo = h('span', 'dm-tarjeta-modelo rad-swap');
    // Cambiarlo de lugar: el orden de acá es el del menú de agentes del chat.
    const subir = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Move up', 'data-rad-tip': 'Move up', 'data-accion': 'subir' }, icono('subir'));
    const bajar = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Move down', 'data-rad-tip': 'Move down', 'data-accion': 'bajar' }, icono('chevron'));
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Edit', 'data-rad-tip': 'Edit', 'data-accion': 'editar' }, icono('lapiz'));
    const borrar = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Delete', 'data-accion': 'eliminar' }, icono('tacho'));
    const instr = h('p', 'dm-tarjeta-instr');
    const cuenta = h('span', 'dm-tarjeta-cuenta rad-swap');
    const susTools = h('span', 'dm-tarjeta-tools rad-swap');
    const abrir = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'abrir' }, 'Open chats');
    const nodo = h('article', 'dm-tarjeta', { role: 'listitem' },
      h('div', 'dm-tarjeta-cabeza', {}, h('div', 'dm-tarjeta-titulo', {}, nombre, modelo), h('div', 'dm-tarjeta-acciones', {}, subir, bajar, editar, borrar)),
      instr,
      h('div', 'dm-tarjeta-pie', {}, h('span', 'dm-tarjeta-datos', {}, cuenta, susTools), abrir));
    const yo = () => datos.agente(nodo.dataset.radKey);
    subir.addEventListener('click', () => { if (subir.getAttribute('aria-disabled') !== 'true') datos.moverAgente(yo().id, -1); });
    bajar.addEventListener('click', () => { if (bajar.getAttribute('aria-disabled') !== 'true') datos.moverAgente(yo().id, 1); });
    editar.addEventListener('click', () => abrirAgente(yo()));
    borrar.addEventListener('click', () => { if (borrar.getAttribute('aria-disabled') !== 'true') eliminar(yo()); });
    abrir.addEventListener('click', () => { datos.elegirAgente(yo().id); router.go('chat'); });
    poner(nodo, a);
    return nodo;
  };

  const poner = (nodo, a) => {
    swapText(nodo.querySelector('.dm-tarjeta-nombre'), a.nombre);
    swapText(nodo.querySelector('.dm-tarjeta-modelo'), datos.modeloDe(a));
    const instr = nodo.querySelector('.dm-tarjeta-instr');
    const texto = a.instrucciones || 'No instructions: it answers as the plain model.';
    if (instr.textContent !== texto) instr.textContent = texto;
    instr.toggleAttribute('data-vacio', !a.instrucciones);
    swapText(nodo.querySelector('.dm-tarjeta-cuenta'), cuantos(datos.chatsDe(a.id).length, 'chat', 'chats', 'No chats'));
    const grupos = datos.modeloConTools(a.proveedor, a.modelo) ? datos.gruposDe(a) : [];
    swapText(nodo.querySelector('.dm-tarjeta-tools'), grupos.length ? `Tools: ${grupos.join(', ')}` : 'No tools');
    // El primero no sube y el último no baja.
    const lugar = datos.listaAgentes().findIndex((x) => x.id === a.id);
    nodo.querySelector('[data-accion="subir"]').setAttribute('aria-disabled', String(lugar <= 0));
    nodo.querySelector('[data-accion="bajar"]').setAttribute('aria-disabled', String(lugar >= datos.listaAgentes().length - 1));
    // El último agente no se borra: la app siempre tiene con quién hablar.
    const unico = datos.listaAgentes().length <= 1;
    const borrar = nodo.querySelector('[data-accion="eliminar"]');
    borrar.setAttribute('aria-disabled', String(unico));
    borrar.setAttribute('data-rad-tip', unico ? 'At least one agent has to remain' : 'Delete');
  };

  const dibujar = () => reconcile(lista, datos.listaAgentes(), { key: (a) => a.id, create: tarjeta, update: poner });
  dibujar();
  datos.on('agentes', dibujar);
  datos.on('chats', dibujar);
  datos.on('modelos', dibujar);
  datos.on('tools', dibujar);
}
