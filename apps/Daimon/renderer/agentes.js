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
  const campoNombre = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Nombre'), nombre);

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
    const sinLista = `Pegá la llave de ${datos.nombreProveedor(actual)} en Ajustes para traer sus modelos.`;
    swapText(nota, s.modelos.length ? s.modelos.find((m) => m.id === s.select.value)?.nota ?? '' : sinLista);
  };
  for (const p of lista) {
    const suyo = agente?.proveedor === p.id ? agente.modelo : null;
    // El modelo de un agente puede haber salido de la lista (Venice los
    // cambia seguido): se lo deja elegible, con su id, en vez de perderlo.
    const modelos = suyo && !p.modelos.some((m) => m.id === suyo) ? [{ id: suyo, nombre: suyo, nota: 'ya no figura en la lista del proveedor' }, ...p.modelos] : p.modelos;
    const select = createSelect({
      options: modelos.map((m) => ({ value: m.id, label: m.nombre })),
      value: suyo ?? p.inicial,
      placeholder: 'Sin modelos todavía',
      onChange: ponerNota,
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
    onChange: (v) => { actual = v; setFieldError(campoModelo, null); ponerProveedor(); },
  });
  proveedor.el.setAttribute('aria-labelledby', `dm-proveedor-${n}`);
  proveedor.el.dataset.campo = 'proveedor';
  const campoProveedor = h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: `dm-proveedor-${n}` }, 'Proveedor'), proveedor.el);
  const campoModelo = h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: `dm-modelo-${n}` }, 'Modelo'), celda, nota);
  ponerProveedor();

  const instrucciones = h('textarea', 'rad-input', { rows: '7', spellcheck: 'false', placeholder: 'Quién es este agente, qué sabe y cómo contesta.', 'data-campo': 'instrucciones' });
  instrucciones.value = agente?.instrucciones ?? '';
  const campoInstr = h('label', 'rad-field', {},
    h('span', 'rad-field-label', {}, 'Instrucciones'),
    instrucciones,
    h('span', 'rad-field-hint', {}, 'Es lo que el modelo lee antes de cada chat. Puede quedar vacío.'));

  const form = h('form', 'dm-form', {}, campoNombre, h('div', 'dm-form-par', {}, campoProveedor, campoModelo), campoInstr);
  wireControls(form);
  form.addEventListener('submit', (e) => e.preventDefault());

  let resultado = null;
  const guardar = () => {
    if (!nombre.value.trim()) {
      setFieldError(campoNombre, 'Ponele un nombre.');
      nombre.focus();
      return false; // el formulario sigue abierto
    }
    const modelo = selects.get(actual).select.value;
    if (!modelo) {
      setFieldError(campoModelo, `Todavía no hay modelos de ${datos.nombreProveedor(actual)} para elegir.`);
      return false;
    }
    const valores = { nombre: nombre.value, proveedor: actual, modelo, instrucciones: instrucciones.value };
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
    title: agente ? 'Editar agente' : 'Nuevo agente',
    body: form,
    actions: [
      { id: 'cancel', label: 'Cancelar' },
      { id: 'ok', label: agente ? 'Guardar' : 'Crear agente', variant: 'primary', onClick: guardar },
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
    title: `¿Eliminar a ${agente.nombre}?`,
    text: n ? `Se borra el agente con ${cuantos(n, 'chat', 'chats')}. Esto no se puede deshacer.` : 'Se borra el agente. Esto no se puede deshacer.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (si && await datos.borrarAgente(agente.id)) toast({ text: `Se eliminó a ${agente.nombre}` });
}

export function montarAgentes(el, { router }) {
  const nuevo = h('button', 'rad-button', { type: 'button', 'data-variant': 'primary', 'data-accion': 'nuevo-agente' }, icono('mas'), 'Nuevo agente');
  nuevo.addEventListener('click', () => abrirAgente());
  const lista = h('div', 'dm-agentes', { role: 'list' });
  el.append(h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {},
      h('div', '', {}, h('h1', '', {}, 'Agentes'), h('p', '', {}, 'Cada agente tiene su modelo, sus instrucciones y sus propios chats.')),
      nuevo),
    lista));

  const tarjeta = (a) => {
    const nombre = h('h2', 'dm-tarjeta-nombre rad-swap');
    const modelo = h('span', 'dm-tarjeta-modelo rad-swap');
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Editar', 'data-rad-tip': 'Editar', 'data-accion': 'editar' }, icono('lapiz'));
    const borrar = h('button', 'rad-iconbutton', { type: 'button', 'aria-label': 'Eliminar', 'data-accion': 'eliminar' }, icono('tacho'));
    const instr = h('p', 'dm-tarjeta-instr');
    const cuenta = h('span', 'dm-tarjeta-cuenta rad-swap');
    const abrir = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'abrir' }, 'Abrir sus chats');
    const nodo = h('article', 'dm-tarjeta', { role: 'listitem' },
      h('div', 'dm-tarjeta-cabeza', {}, h('div', 'dm-tarjeta-titulo', {}, nombre, modelo), h('div', 'dm-tarjeta-acciones', {}, editar, borrar)),
      instr,
      h('div', 'dm-tarjeta-pie', {}, cuenta, abrir));
    const yo = () => datos.agente(nodo.dataset.radKey);
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
    const texto = a.instrucciones || 'Sin instrucciones: contesta como el modelo, sin más.';
    if (instr.textContent !== texto) instr.textContent = texto;
    instr.toggleAttribute('data-vacio', !a.instrucciones);
    swapText(nodo.querySelector('.dm-tarjeta-cuenta'), cuantos(datos.chatsDe(a.id).length, 'chat', 'chats', 'Sin chats'));
    // El último agente no se borra: la app siempre tiene con quién hablar.
    const unico = datos.listaAgentes().length <= 1;
    const borrar = nodo.querySelector('[data-accion="eliminar"]');
    borrar.setAttribute('aria-disabled', String(unico));
    borrar.setAttribute('data-rad-tip', unico ? 'Tiene que quedar al menos un agente' : 'Eliminar');
  };

  const dibujar = () => reconcile(lista, datos.listaAgentes(), { key: (a) => a.id, create: tarjeta, update: poner });
  dibujar();
  datos.on('agentes', dibujar);
  datos.on('chats', dibujar);
  datos.on('modelos', dibujar);
}
