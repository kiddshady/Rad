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
    texto: 'Para los agentes que usan los modelos de Anthropic. La llave se crea en su consola, en API keys, dentro de un workspace.',
    ejemplo: 'sk-ant-api03-…',
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

// Qué decir de una llave, y de qué color va el punto.
function describir(e) {
  if (e.estado === 'lista' && e.tipo === 'usuario') {
    return { tono: 'warning', texto: `Guardada (${e.pista}), pero es una llave de usuario: la API la rechaza. Creá una dentro de un workspace, que empieza con sk-ant-api03.` };
  }
  if (e.estado === 'lista' && e.tipo === 'admin') {
    return { tono: 'warning', texto: `Guardada (${e.pista}), pero es una llave de administración: no sirve para chatear.` };
  }
  if (e.estado === 'lista') return { tono: 'success', texto: `Guardada y cifrada en esta PC: ${e.pista}` };
  if (e.estado === 'ilegible') return { tono: 'danger', texto: 'Hay una llave guardada pero ya no se puede leer. Pegala de nuevo.' };
  return { tono: 'idle', texto: 'No hay ninguna llave guardada.' };
}

function tarjetaLlave(p) {
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);

  const campo = h('input', 'rad-input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: p.ejemplo, 'data-campo': 'llave' });
  const caja = h('label', 'rad-field', {},
    h('span', 'rad-field-label', {}, 'Pegar una llave'),
    campo,
    h('span', 'rad-field-hint', {}, 'No se muestra ni sale de esta PC: se guarda cifrada con la protección de Windows.'));
  const guardar = h('button', 'rad-button', { type: 'submit', 'data-variant': 'primary', 'data-accion': 'guardar-llave' }, 'Guardar');
  const quitar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'quitar-llave' }, 'Quitar la llave');
  const sitio = h('button', 'dm-link', { type: 'button' }, p.rotulo);
  sitio.addEventListener('click', () => window.rad.openExternal(p.sitio));
  const form = h('form', 'dm-llave', {}, caja, h('div', 'dm-llave-acciones', {}, quitar, guardar));
  wireControls(form);

  const poner = () => {
    const e = llave.de(p.id);
    const d = describir(e);
    estado.dataset.tono = d.tono;
    estado.dataset.llave = e.estado;
    swapText(texto, d.texto);
    quitar.disabled = e.estado === 'falta';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!campo.value.trim()) { setFieldError(caja, 'Pegá la llave acá.'); campo.focus(); return; }
    setBusy(guardar, true);
    const r = await llave.guardar(p.id, campo.value);
    setBusy(guardar, false);
    if (!r.ok) { setFieldError(caja, r.error); campo.focus(); return; }
    setFieldError(caja, null);
    campo.value = '';
    toast({ text: `Llave de ${p.nombre} guardada`, kind: 'success' });
  });
  campo.addEventListener('input', () => { if (caja.hasAttribute('data-invalid')) setFieldError(caja, null); });
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
  return h('section', 'dm-tarjeta', { 'data-proveedor': p.id },
    h('h2', 'dm-tarjeta-nombre', {}, `Llave de ${p.nombre}`),
    h('p', 'dm-tarjeta-instr', {}, p.texto),
    estado, form, sitio);
}

export function montarAjustes(el) {
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
}
