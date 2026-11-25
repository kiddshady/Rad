// Las tools en la conversación: la fila de cada llamada con su estado, el
// contador que va debajo de la respuesta y la tarjeta que pide permiso.
//
// La regla que viene de NeonCode: la interfaz dice HECHOS. Cada llamada deja
// su fila, también la que el usuario rechazó y la que la app cortó, y el
// contador aparece siempre que el turno tuvo tools, aunque no haya corrido
// ninguna. Si solo apareciera cuando algo anda mal, sería una acusación.

import { openModal } from '/@core/modal.js';
import { wireControls } from '/@core/controls.js';
import { swapText } from '/@core/motion.js';
import * as datos from './datos.js';
import { h, icono } from './piezas.js';
import { iconoTool } from './iconos-tools.js';

const ESTADOS = {
  run: 'running',
  ok: 'done',
  error: 'failed',
  declined: 'declined',
  aborted: 'cancelled',
  blocked: 'blocked',
};

/** La fila de una llamada: qué tool, sobre qué, y cómo terminó. Se abre para
 *  ver lo que devolvió. */
export function filaTool(m) {
  const cabeza = h('button', 'dm-tool-cabeza', { type: 'button', 'aria-expanded': 'false' },
    iconoTool(m.tool, 'dm-tool-icono'),
    h('span', 'dm-tool-nombre'),
    h('span', 'dm-tool-que rad-swap'),
    h('span', 'dm-tool-estado rad-swap'),
    icono('chevron', 'dm-tool-chevron'));
  const salida = h('pre', 'dm-tool-pre');
  // las imágenes que dejó la llamada (un gráfico de run_code): siempre a la vista
  const imagenes = h('div', 'dm-tool-imagenes');
  const nodo = h('div', 'dm-tool', {}, cabeza, h('div', 'dm-tool-salida', {}, h('div', 'dm-tool-salida-in', {}, salida)), imagenes);
  cabeza.addEventListener('click', () => {
    if (!nodo.hasAttribute('data-con-salida')) return;
    const abierto = !nodo.hasAttribute('data-abierto');
    nodo.toggleAttribute('data-abierto', abierto);
    cabeza.setAttribute('aria-expanded', String(abierto));
  });
  ponerTool(nodo, m);
  return nodo;
}

export function ponerTool(nodo, m) {
  nodo.dataset.estado = m.estado;
  nodo.dataset.tool = m.tool;
  // Lo que corrió un subagente cuelga de la fila de delegate que lo lanzó; con
  // varios a la vez, cada fila dice de cuál es.
  if (m.sub) {
    nodo.dataset.sub = m.sub;
    if (m.subN) nodo.dataset.subn = String(m.subN);
  }
  const nombre = nodo.querySelector('.dm-tool-nombre');
  if (nombre.textContent !== m.tool) nombre.textContent = m.tool;
  swapText(nodo.querySelector('.dm-tool-que'), m.texto || '');
  swapText(nodo.querySelector('.dm-tool-estado'), ESTADOS[m.estado] ?? m.estado);
  const texto = m.salida ? `${m.salida}${m.cortada ? '\n… (the rest was cut here; the agent got all of it)' : ''}` : '';
  const pre = nodo.querySelector('.dm-tool-pre');
  if (pre.textContent !== texto) pre.textContent = texto;
  nodo.toggleAttribute('data-con-salida', Boolean(texto));
  const caja = nodo.querySelector('.dm-tool-imagenes');
  const lista = Array.isArray(m.imagenes) ? m.imagenes : [];
  if (caja.childElementCount !== lista.length) {
    caja.replaceChildren(...lista.map((im) => h('img', 'dm-tool-imagen', { src: im.dataUrl, alt: im.name, 'data-rad-tip': im.name })));
  }
  nodo.toggleAttribute('data-con-imagenes', lista.length > 0);
  if (!texto) { nodo.removeAttribute('data-abierto'); nodo.querySelector('.dm-tool-cabeza').setAttribute('aria-expanded', 'false'); }
}

/** «3 tools · 2 done, 1 failed», «no tools», o '' si el turno no tenía tools. */
export function cuentaTools(m) {
  if (!Array.isArray(m.tools)) return '';
  const agotado = m.agotado ? ' · tool steps ran out for this turn, so something may be unfinished' : '';
  if (!m.tools.length) return `no tools${agotado}`;
  const de = (s) => m.tools.filter((t) => t.status === s).length;
  const partes = [
    de('ok') && `${de('ok')} done`,
    de('error') && `${de('error')} failed`,
    de('declined') && `${de('declined')} declined`,
    de('aborted') && `${de('aborted')} cancelled`,
    de('blocked') && `${de('blocked')} blocked`,
  ].filter(Boolean);
  return `${m.tools.length} ${m.tools.length === 1 ? 'tool' : 'tools'} · ${partes.join(', ')}${agotado}`;
}

const bytes = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 102.4) / 10} KB` : `${Math.round(n / 104857.6) / 10} MB`);

// Lo que va a pasar con un archivo, para la tarjeta: el diff de un cambio, o
// una frase cuando no hay diff que mostrar.
export function vistaDe(vista) {
  if (!vista) return null;
  const caja = h('div', 'dm-permiso-vista');
  if (vista.target) caja.append(h('p', 'dm-permiso-ruta rad-mono', {}, vista.target));
  const frase = (t, tono) => caja.append(h('p', 'dm-permiso-frase', tono ? { 'data-tono': tono } : {}, t));
  if (vista.mode === 'new') frase(`A new file, ${vista.lines} line${vista.lines === 1 ? '' : 's'}.`);
  else if (vista.mode === 'append') frase('Adds text to the end of this file.');
  else if (vista.mode === 'missing') frase('That file does not exist, so this edit will fail.', 'warning');
  else if (vista.mode === 'binary') frase('A binary file: there is nothing to preview.', 'warning');
  else if (vista.mode === 'toobig') frase('The file is too large to preview the change.', 'warning');
  else if (vista.mode === 'fail') frase(vista.error, 'warning');
  else if (vista.mode === 'nothing') frase('There is nothing at that path.', 'warning');
  else if (vista.mode === 'delfile') frase(`Moves this file to the Recycle Bin (${bytes(vista.bytes ?? 0)}). It can be restored from there.`);
  else if (vista.mode === 'deldir') {
    frase(`Moves this folder and everything in it to the Recycle Bin: ${vista.partial ? 'more than ' : ''}${vista.files} file${vista.files === 1 ? '' : 's'} in ${vista.dirs} folder${vista.dirs === 1 ? '' : 's'}. It can be restored from there.`);
  } else if (vista.mode === 'diff') {
    frase(vista.changed ? `${vista.added} line${vista.added === 1 ? '' : 's'} added, ${vista.removed} removed.` : 'No change: the file would stay the same.');
    const diff = h('div', 'dm-diff rad-mono', { role: 'group', 'aria-label': 'Changes' });
    for (const [i, tramo] of (vista.hunks ?? []).entries()) {
      if (i) diff.append(h('div', 'dm-diff-salto', { 'aria-hidden': 'true' }));
      for (const l of tramo.lines) {
        diff.append(h('div', 'dm-diff-renglon', { 'data-t': l.t === '+' ? 'mas' : l.t === '-' ? 'menos' : 'igual' },
          h('span', 'dm-diff-signo', { 'aria-hidden': 'true' }, l.t === ' ' ? '' : l.t), h('span', 'dm-diff-texto', {}, l.s)));
      }
    }
    if (diff.childElementCount) caja.append(diff);
    if (vista.truncated) frase(`${vista.truncated} more changed lines are not shown.`);
  }
  return caja;
}

/**
 * La tarjeta de permiso: qué tool quiere correr, con qué, y qué va a cambiar.
 * Cerrarla sin elegir es decir que no. Devuelve { callId, cerrar() }: la app
 * la cierra sola si el turno se frena o la llamada deja de esperar.
 */
export function abrirPermiso(chatId, pide) {
  const confiar = h('input', '', { type: 'checkbox', id: `dm-confiar-${pide.callId}` });
  const args = h('dl', 'dm-permiso-args');
  for (const [k, v] of Object.entries(pide.args ?? {})) {
    args.append(h('dt', '', {}, k), h('dd', 'rad-mono', {}, String(v)));
  }
  const vista = vistaDe(pide.vista);
  const cuerpo = h('div', 'dm-permiso', {},
    h('p', 'dm-permiso-que', pide.sub ? { 'data-sub': String(pide.sub) } : {}, pide.sub ? (pide.sub === true ? 'A subagent wants to run ' : `Subagent ${pide.sub} wants to run `) : 'The agent wants to run ', h('strong', 'rad-mono', {}, pide.name), pide.label ? ' on ' : '.', pide.label ? h('strong', '', {}, pide.label) : null, pide.label ? '.' : null),
    vista,
    // con un diff a la vista, los argumentos crudos repiten lo mismo en feo
    pide.vista?.mode === 'diff' || pide.vista?.mode === 'new' ? null : (args.childElementCount ? args : null),
    h('label', 'rad-check', {}, confiar, h('span', 'rad-check-box'), 'Don’t ask again in this chat'));
  wireControls(cuerpo);

  let porLaApp = false;
  const modal = openModal({
    title: `Allow ${pide.name}?`,
    body: cuerpo,
    actions: [
      { id: 'no', label: 'Decline' },
      { id: 'si', label: 'Allow', variant: 'primary' },
    ],
  });
  modal.el.dataset.permiso = pide.callId;
  modal.closed.then((r) => { if (!porLaApp) datos.confirmar(chatId, r === 'si', r === 'si' && confiar.checked); });
  return { callId: pide.callId, cerrar() { porLaApp = true; modal.close(); } };
}
