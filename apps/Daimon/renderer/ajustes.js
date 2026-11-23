// La vista de ajustes: una llave por proveedor, y de qué está hecha la app.

import { confirm } from '/@core/modal.js';
import { setFieldError, wireControls } from '/@core/controls.js';
import { swapText } from '/@core/motion.js';
import { toast } from '/@core/toast.js';
import { setBusy } from '/@core/busy.js';
import * as llave from './llave.js';
import { h } from './piezas.js';

const PROVEEDORES = [
  {
    id: 'anthropic',
    nombre: 'Anthropic',
    texto: 'Para los agentes que usan los modelos de Anthropic. La llave se crea en su consola, en API keys, eligiendo el workspace donde va a trabajar.',
    ejemplo: 'sk-ant-…',
    sitio: 'https://console.anthropic.com/settings/keys',
    rotulo: 'Abrir la consola de Anthropic',
  },
  {
    id: 'venice',
    nombre: 'Venice',
    texto: 'Para los agentes que usan los modelos de Venice. Al guardar la llave, Daimon trae la lista de modelos que hay ahora.',
    ejemplo: 'La llave de la API de Venice',
    sitio: 'https://venice.ai/settings/api',
    rotulo: 'Abrir los ajustes de la API de Venice',
  },
];

// Por qué la API rechazó una llave, en una frase.
const RECHAZOS = {
  invalida: 'no es válida, se deshabilitó o venció. Creá otra y pegala.',
  'sin-workspace': 'no está atada a un workspace. Creá otra y, al crearla, elegí el workspace donde va a trabajar.',
  'sin-permiso': 'no tiene permiso para usar la API.',
};

// Qué decir de una llave, y de qué color va el punto. `e` es lo guardado y
// `c` lo que contestó la API cuando se le preguntó por ella. Que esté
// guardada no dice que sirva: el verde es solo para la que la API aceptó
// (o para la de un proveedor que no tiene cómo comprobarse).
function describir(p, e, c) {
  if (e.estado === 'ilegible') return { tono: 'danger', texto: 'Hay una llave guardada pero ya no se puede leer. Pegala de nuevo.' };
  if (e.estado !== 'lista') return { tono: 'idle', texto: 'No hay ninguna llave guardada.' };
  if (!e.seComprueba) return { tono: 'success', texto: `Guardada y cifrada en esta PC: ${e.pista}` };
  if (c.fase === 'comprobando') return { tono: 'idle', texto: `Guardada (${e.pista}). Preguntándole a ${p.nombre} si la acepta…` };
  if (c.fase === 'aceptada') return { tono: 'success', texto: `${p.nombre} la acepta. Guardada y cifrada en esta PC: ${e.pista}` };
  if (c.fase === 'rechazada') {
    return { tono: 'danger', texto: `${p.nombre} la rechaza (${e.pista}): ${RECHAZOS[c.motivo] ?? 'no dijo por qué.'}`, detalle: c.detalle };
  }
  if (c.fase === 'sin-comprobar') {
    const porque = c.motivo === 'conexion' ? `no hay conexión con ${p.nombre}` : `${p.nombre} no contestó bien`;
    return { tono: 'warning', texto: `Guardada (${e.pista}), pero no se pudo comprobar: ${porque}. No quiere decir que esté mal.`, detalle: c.detalle };
  }
  return { tono: 'idle', texto: `Guardada y cifrada en esta PC: ${e.pista}` };
}

function tarjetaLlave(p) {
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);
  // Lo que dijo la API, tal cual, debajo de la frase: se despliega si hay.
  const detalle = h('span', 'dm-estado-detalle-texto rad-swap');
  const cajaDetalle = h('div', 'dm-estado-detalle', {}, h('div', 'dm-estado-detalle-in', {}, detalle));

  const campo = h('input', 'rad-input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: p.ejemplo, 'data-campo': 'llave' });
  const caja = h('label', 'rad-field', {},
    h('span', 'rad-field-label', {}, 'Pegar una llave'),
    campo,
    h('span', 'rad-field-hint', {}, 'No se muestra ni sale de esta PC: se guarda cifrada con la protección de Windows.'));
  const guardar = h('button', 'rad-button', { type: 'submit', 'data-variant': 'primary', 'data-accion': 'guardar-llave' }, 'Guardar');
  const quitar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'quitar-llave' }, 'Quitar la llave');
  const probar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'comprobar-llave' }, 'Comprobar de nuevo');
  const sitio = h('button', 'dm-link', { type: 'button' }, p.rotulo);
  sitio.addEventListener('click', () => window.rad.openExternal(p.sitio));
  const acciones = h('div', 'dm-llave-acciones', {}, quitar, guardar);
  const form = h('form', 'dm-llave', {}, caja, acciones);
  wireControls(form);
  const tarjeta = h('section', 'dm-tarjeta', { 'data-proveedor': p.id },
    h('h2', 'dm-tarjeta-nombre', {}, `Llave de ${p.nombre}`),
    h('p', 'dm-tarjeta-instr', {}, p.texto),
    estado, cajaDetalle, form, sitio);

  const poner = () => {
    const e = llave.de(p.id);
    const c = llave.comprobacion(p.id);
    const d = describir(p, e, c);
    estado.dataset.tono = d.tono;
    estado.dataset.llave = e.estado;
    estado.dataset.comprobacion = c.fase;
    estado.dataset.motivo = c.motivo ?? '';
    swapText(texto, d.texto);
    if (d.detalle) swapText(detalle, `${p.nombre} dijo: «${d.detalle}»`);
    cajaDetalle.toggleAttribute('data-abierto', Boolean(d.detalle));
    quitar.disabled = e.estado === 'falta';
    // Comprobar de nuevo: solo donde hay con qué, y mientras no esté en eso.
    if (e.seComprueba && !probar.isConnected) acciones.prepend(probar);
    probar.disabled = e.estado !== 'lista' || c.fase === 'comprobando';
    // La tarjeta trabaja mientras le pregunta a la API.
    setBusy(tarjeta, c.fase === 'comprobando');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!campo.value.trim()) { setFieldError(caja, 'Pegá la llave acá.'); campo.focus(); return; }
    const r = await llave.guardar(p.id, campo.value);
    if (!r.ok) { setFieldError(caja, r.error); campo.focus(); return; }
    setFieldError(caja, null);
    campo.value = '';
    toast({ text: `Llave de ${p.nombre} guardada`, kind: 'success' });
  });
  campo.addEventListener('input', () => { if (caja.hasAttribute('data-invalid')) setFieldError(caja, null); });
  probar.addEventListener('click', () => llave.comprobar(p.id, { forzar: true }));
  quitar.addEventListener('click', async () => {
    const si = await confirm({
      title: `¿Quitar la llave de ${p.nombre}?`,
      text: 'Los agentes que la usan no van a poder contestar hasta que pegues otra.',
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!si) return;
    await llave.borrar(p.id);
    toast({ text: `Se quitó la llave de ${p.nombre}` });
  });

  poner();
  llave.on(poner);
  return tarjeta;
}

export function montarAjustes(el, { router }) {
  const datos = h('dl', 'dm-datos');
  const fila = (k, v) => datos.append(h('dt', '', {}, k), h('dd', 'rad-mono', {}, v));
  fila('Daimon', window.rad.app?.version ?? '');
  fila('Núcleo de Rad', window.rad.core?.version ?? '');
  fila('Piel', window.rad.skin?.name ?? '');
  fila('Proveedores', llave.simulado() ? 'Simulado (no usa ninguna API)' : PROVEEDORES.map((p) => p.nombre).join(' y '));

  el.append(h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {}, h('div', '', {}, h('h1', '', {}, 'Ajustes'), h('p', '', {}, 'Lo que Daimon necesita para hablar con los modelos.'))),
    ...PROVEEDORES.map(tarjetaLlave),
    h('section', 'dm-tarjeta', {}, h('h2', 'dm-tarjeta-nombre', {}, 'Acerca de'), datos)));

  // Al abrir Ajustes se le pregunta a la API por cada llave guardada. Lo que
  // ya contestó (la acepta o la rechaza) no se vuelve a preguntar; lo que no
  // se pudo comprobar, sí.
  const comprobarTodas = () => { for (const p of PROVEEDORES) llave.comprobar(p.id); };
  comprobarTodas();
  router.on('change', ({ id }) => { if (id === 'ajustes') comprobarTodas(); });
}
