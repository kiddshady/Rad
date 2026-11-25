'use strict';

// schedule: el agente arma, lista y borra tareas programadas.
//
// La definición viene de NeonCode (main.js, runSchedule). Lo que cambia acá:
//   - La tarea es del AGENTE que la crea: corre con su modelo, sus
//     instrucciones y sus tools (ver main/tareas.cjs).
//   - Lo que crea un agente corre en modo de solo lectura. «Let it act» lo
//     prende el usuario en la pestaña Tasks: un agente no se lo da a sí mismo.
//   - Crear y borrar piden permiso SIEMPRE, también en automático y aunque el
//     chat esté en «no preguntar más» (chat.cjs): dejar algo corriendo solo, o
//     sacarlo, lo decide el usuario mirando qué es.
//
// El contrato de un runner está en la cabecera de base.cjs.

const { describir } = require('../tareas.cjs');

let deps = {
  tareas: null,            // las tareas de la app (main/tareas.cjs)
  agentes: () => [],       // [{ id, nombre }]: para decir de quién es cada una
  alBorrar: () => {},      // el agente borró una: la app le avisa al usuario, que la puede recuperar
};

function configurar(d = {}) {
  if (d.tareas) deps.tareas = d.tareas;
  if (typeof d.agentes === 'function') deps.agentes = d.agentes;
  if (typeof d.alBorrar === 'function') deps.alBorrar = d.alBorrar;
}

const fecha = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const nombreDe = (id) => deps.agentes().find((a) => a.id === id)?.nombre ?? '(deleted agent)';

/** Los argumentos de la tool, como el «cuándo corre» de una tarea. */
function specDe(a = {}) {
  if (a.kind === 'every') return { kind: 'every', minutos: a.every_minutes };
  if (a.kind === 'daily') return { kind: 'daily', a: a.at };
  if (a.kind === 'once') return a.at !== undefined && a.at !== null && a.at !== '' ? { kind: 'once', a: a.at } : { kind: 'once', minutos: a.minutes_from_now };
  return { kind: a.kind };
}
const accionDe = (a) => (a?.action === 'list' || a?.action === 'delete' ? a.action : 'create');

async function runSchedule(run, a = {}) {
  const T = deps.tareas;
  if (!T) return 'error: scheduled tasks are not available in this build';
  const accion = accionDe(a);

  if (accion === 'list') {
    run.notify('tool:activity', { reqId: run.reqId, kind: 'schedule', label: 'list' });
    const l = T.lista();
    if (!l.length) return 'No tasks are scheduled.';
    return `Scheduled tasks:\n${l.map((t) => `- ${t.id} · "${t.titulo}" · ${t.cuando} · agent ${nombreDe(t.agente)} · ${!t.activa ? (t.spec.kind === 'once' && t.corridas ? 'done' : 'paused') : `next run ${fecha(t.proxima)}`}${t.actuar ? ' · allowed to act' : ' · read-only'}`).join('\n')}`;
  }

  if (accion === 'delete') {
    const id = String(a.id ?? '').trim();
    if (!id) return 'error: id is required to delete a task. Call schedule with action "list" to see the ids';
    const tarea = T.buscar(id);
    if (!tarea) return `error: there is no task ${JSON.stringify(id)}. Call schedule with action "list" to see the ids`;
    run.notify('tool:activity', { reqId: run.reqId, kind: 'schedule', label: tarea.titulo });
    await T.quitar(id);
    try { deps.alBorrar(tarea); } catch { /* el aviso no tumba la tool */ }
    return `Deleted the task "${tarea.titulo}". The app just showed the user a notice with an Undo, in case it was not the one.`;
  }

  if (!run.agente) return 'error: this run does not belong to an agent, so it cannot schedule a task';
  const r = await T.agregar({ titulo: a.title, prompt: a.prompt, agente: run.agente, spec: specDe(a), actuar: false, de: 'agent' });
  if (!r.ok) return `error: ${r.error}`;
  run.notify('tool:activity', { reqId: run.reqId, kind: 'schedule', label: r.tarea.titulo });
  return [
    `Scheduled "${r.tarea.titulo}" (${describir(r.tarea.spec)}). First run: ${fecha(r.tarea.proxima)}.`,
    'It runs as you, unattended, in a fresh context with no memory of this chat, and read-only: it can search and read, not write, run or send anything. The user can allow that for this task with "Let it act", in the Tasks tab.',
    'The result lands in the Tasks tab, not in this chat: tell the user where to look. Tasks run while BlackCode is open or in the system tray.',
  ].join('\n');
}

/** Para la tarjeta de permiso: qué se va a agendar (o a borrar), y cada cuánto corre. */
function vista(run, a = {}) {
  const T = deps.tareas;
  const accion = accionDe(a);
  if (!T || accion === 'list') return null;
  if (accion === 'delete') {
    const tarea = T.buscar(String(a.id ?? '').trim());
    return tarea
      ? { mode: 'tarea', accion: 'delete', titulo: tarea.titulo, cuando: describir(tarea.spec), agente: nombreDe(tarea.agente) }
      : { mode: 'fail', error: 'There is no task with that id.' };
  }
  const r = T.revisar({ titulo: a.title, prompt: a.prompt, agente: run?.agente, spec: specDe(a) });
  if (r.error) return { mode: 'fail', error: r.error };
  return { mode: 'tarea', accion: 'create', titulo: r.datos.titulo, cuando: describir(r.datos.spec), agente: nombreDe(r.datos.agente), prompt: r.datos.prompt.slice(0, 1200) };
}

const runners = {
  schedule: (run, a) => runSchedule(run, a),
};

module.exports = { runners, configurar, runSchedule, vista, specDe, accionDe };
