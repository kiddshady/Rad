'use strict';

// delegate — SUBAGENTES. De NeonCode 1.11.3 (main.js, runDelegate y
// correrSubagente), con sus textos tal cual.
//
// Un turno HIJO que corre por el mismo camino que cualquier otro (el mismo
// loop del proveedor, runTool, la tarjeta, el presupuesto de rondas) pero con
// su propia corrida: su propio historial (solo el brief), su propio system y
// su propio registro de pasos. Al padre le vuelve UNA cosa, el informe final,
// como resultado de la tool. Todo lo que el hijo leyó se queda en el hijo, que
// es el motivo de que esto exista: un barrido de veinte archivos le costaba al
// padre veinte resultados en el contexto para siempre.
//
// Qué comparte con el padre, y por qué:
//   - el reqId: es el pedido del chat, y los avisos a la interfaz van por él.
//     Los ids de sus filas no chocan porque numera bajo `callPrefix`.
//   - la tarjeta: `confirm` es el del padre. En manual, cada tool del hijo pide
//     su tarjeta en el chat del padre (y el «no preguntar más» vale para los
//     dos).
//   - el Stop: la señal del padre corta al hijo.
//   - la carpeta con la que arranca (después es suya, como en cualquier turno).
//   - las instrucciones del agente y sus tools prendidas (menos las que un
//     subagente no puede usar: ver activeToolNames en motor.cjs).
//
// Qué NO comparte: la prosa. Lo que el hijo escribe entre tools no va al chat
// y su mensaje final sale solo dentro de la fila de `delegate`. Sus filas sí
// van al chat, marcadas con `sub`: la interfaz las anida debajo de la del
// padre y NO las manda de vuelta al modelo como si las hubiera corrido el
// padre.
//
// Un solo nivel: el hijo no ve `delegate`. Varios hijos en una misma llamada
// corren a la vez; varias llamadas a `delegate` en una ronda corren en serie,
// como cualquier ronda.
//
// Adaptaciones al pasar a BlackCode:
//   - NeonCode le daba al hijo un `run` armado a mano y lo pasaba a su adapter.
//     Acá el hijo es una sesión de tools como la del padre (crearSesion) y el
//     proveedor se llama por `responder`: las dos cosas las inyecta la app.
//   - No hay «rondas» que el proveedor avise: el texto del hijo se parte en
//     rondas cada vez que la sesión cierra una (cerrarRonda).
//   - Con qué modelo corre lo resuelve la app (`destino`): el del agente, o el
//     que se eligió en Settings.
//   - Las tarjetas de dos hijos a la vez se piden de a una: la interfaz
//     muestra una sola.
//   - No vinieron: el recall de memorias, el latido para corridas sin ventana
//     (no hay), el deshacer por turno.

const { cwdDe } = require('./base.cjs');
const guardas = require('./guardas.cjs');

const DELEGATE_MAX = 4;              // hijos por llamada
const DELEGATE_REPORT_CHARS = 24000; // techo de lo que vuelve al padre, entre todos

// Lo que la app pone:
//   crearSesion(opciones)  la sesión de tools de un turno (la de index.cjs)
//   destino(run)           con qué corre un hijo de esa corrida:
//                          { proveedor, modelo, nombre, ve, error }
//   responder(pedido, opciones)  llama al proveedor: el mismo contrato que los
//                          responder de anthropic.cjs y venice.cjs, sin la llave
const deps = { crearSesion: null, destino: null, responder: null };
function configurar(d = {}) {
  for (const k of Object.keys(deps)) if (d[k] !== undefined) deps[k] = d[k];
}

// El informe es el ÚLTIMO mensaje del hijo, no toda su prosa: al hijo se le dice
// que lo de entre tools se descarta, y así es. Si lo último fue una nota de la
// app (corte por límite, refusal), va junto con la ronda anterior: la nota sola
// no informa nada.
function informeDeSubagente(rondas) {
  const r = rondas.map((t) => guardas.stripAppBlocks(String(t || ''))).filter((t) => t.trim());
  if (!r.length) return '';
  const ult = r[r.length - 1].trim();
  if (/^\[/.test(ult) && r.length > 1) return `${r[r.length - 2].trim()}\n\n${ult}`;
  return ult;
}

// "fs_read ×3, code_search, shell_exec (1 did not succeed)": la evidencia de qué
// corrió el hijo, para que el padre no tenga que creerle a la prosa.
function resumenPasos(steps) {
  if (!steps.length) return 'no tools';
  const por = new Map();
  for (const s of steps) {
    const e = por.get(s.name) || { n: 0, mal: 0 };
    e.n++;
    if (s.status !== 'ok') e.mal++;
    por.set(s.name, e);
  }
  return [...por].map(([nom, e]) => `${nom}${e.n > 1 ? ` ×${e.n}` : ''}${e.mal ? ` (${e.mal} did not succeed)` : ''}`).join(', ');
}

// Las tarjetas de los hijos, de a una: dos que corren a la vez pueden pedir
// permiso en el mismo instante, y la interfaz muestra una sola tarjeta.
function enFila(padre, pedir) {
  const turno = (padre._permisos ?? Promise.resolve()).then(pedir, pedir);
  padre._permisos = turno.catch(() => {});
  return turno;
}

async function correrSubagente(padre, { brief, i, n, padreCall, destino, access }) {
  const ac = new AbortController();
  const cortar = () => ac.abort();
  if (padre.ac?.signal?.aborted) ac.abort();
  else padre.ac?.signal?.addEventListener('abort', cortar, { once: true });
  const t0 = Date.now();
  const rondas = [];
  let ronda = '';
  let sesion = null;
  let fin = null;
  let error = null;
  try {
    sesion = deps.crearSesion({
      reqId: padre.reqId,
      convoId: padre.convoId,
      ac,
      // un modelo sin ojos no puede usar una captura (ver chat.cjs)
      tools: (padre.tools ?? []).filter((t) => destino.ve || t !== 'screen_capture'),
      confirma: () => padre.needsConfirm?.() === true,
      callPrefix: `${padreCall || padre.reqId}.${i + 1}`,
      subagente: { access, parentCall: padreCall, n: i + 1, paralelo: n > 1 },
      cwd: cwdDe(padre),
      notify(channel, payload) {
        // la fila que emita un runner del hijo se ata al paso del HIJO
        if (this._callId && !payload?.callId) payload = { ...payload, callId: this._callId };
        // `sub` ata la fila a la de `delegate` del padre; `subN` la numera cuando
        // son varios hijos a la vez (0 = uno solo, sin número)
        if (channel === 'tool:activity' || channel === 'tool:result') payload = { ...payload, sub: padreCall, subN: n > 1 ? i + 1 : 0 };
        return padre.notify(channel, payload);
      },
      confirm: (name, args, callId) => enFila(padre, () => padre.confirm(name, args, callId, { sub: n > 1 ? i + 1 : true })),
    });
    sesion.run.ve = destino.ve === true;
    // lo que la app recuerda del usuario: el hijo es una copia del agente
    sesion.run.memoria = padre.memoria ?? '';
    // …y las skills del usuario (un hijo puede cargarlas, no proponerlas)
    sesion.run.skills = sesion.nombres.includes('skill') ? (padre.skills ?? '') : '';
    // el texto del hijo no sale a ningún lado: se junta por rondas, y la última
    // es el informe
    const cerrar = sesion.cerrarRonda;
    sesion.cerrarRonda = (names) => { rondas.push(ronda); ronda = ''; return cerrar(names); };
    // Un hijo que quedó sin ninguna tool (el agente solo tenía de las que un
    // subagente no puede usar) conversa: lo que sabe de sí mismo va igual.
    const instrucciones = sesion.activa
      ? (padre.instrucciones ?? '')
      : [padre.instrucciones, guardas.SUBAGENT_NOTE].filter(Boolean).join('\n\n');
    fin = await deps.responder(
      { proveedor: destino.proveedor, modelo: destino.modelo, instrucciones, mensajes: [{ rol: 'user', texto: brief }] },
      { signal: ac.signal, onTexto: (t) => { ronda += t; }, onPensando: () => {}, sesion: sesion.activa ? sesion : null },
    );
  } catch (err) {
    if (!ac.signal.aborted) error = String(err?.message || err);
  } finally {
    padre.ac?.signal?.removeEventListener('abort', cortar);
  }
  rondas.push(ronda);
  return {
    brief,
    informe: informeDeSubagente(rondas),
    pasos: sesion?.run.steps ?? [],
    stopped: sesion?.run.stopped ?? null,
    motivo: fin?.motivo ?? null,
    tokens: fin?.uso?.salida ?? 0,
    error,
    aborted: ac.signal.aborted,
    secs: Math.round((Date.now() - t0) / 1000),
  };
}

async function runDelegate(run, { task, tasks, access } = {}) {
  // (un modelo chico manda `tasks` como un texto: es un brief, no una lista)
  const pedidos = typeof tasks === 'string' && tasks.trim() ? [tasks] : tasks;
  const briefs = (Array.isArray(pedidos) && pedidos.length ? pedidos : [task])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  const modo = access === 'full' ? 'full' : 'read';
  const destino = deps.destino ? deps.destino(run) : null;
  const corto = String(destino?.modelo || '').split('/').pop() || 'no model';
  const resumen = briefs.length > 1
    ? `${briefs.length} tasks`
    : (briefs[0] || '').replace(/\s+/g, ' ').slice(0, 80);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'delegate', label: `${corto} · ${resumen}${modo === 'full' ? ' · full access' : ''}` });
  if (run.subagent) return 'error: a subagent cannot start subagents';
  if (!briefs.length) return 'error: write the brief in `task` (or several in `tasks`)';
  if (briefs.length > DELEGATE_MAX) return `error: at most ${DELEGATE_MAX} subagents per call — put the rest in another call`;
  if (!destino || !deps.crearSesion || !deps.responder) return 'error: subagents are not set up in this app';
  if (destino.error) return `error: ${destino.error}`;

  const padreCall = run._callId;
  const res = await Promise.all(briefs.map((brief, i) =>
    correrSubagente(run, { brief, i, n: briefs.length, padreCall, destino, access: modo })));

  const techo = Math.floor(DELEGATE_REPORT_CHARS / res.length);
  const bloques = res.map((r, i) => {
    const datos = `${corto}, ${resumenPasos(r.pasos)}, ${r.secs} s${r.tokens ? `, ${r.tokens} output tokens` : ''}`;
    let cuerpo = r.informe || '(the subagent ended without writing a report)';
    if (cuerpo.length > techo) cuerpo = `${cuerpo.slice(0, techo)}\n…[report cut at ${techo} characters]`;
    const notas = [
      r.aborted && '[the run was stopped while this subagent was working: the report may be partial]',
      r.error && `[this subagent failed: ${r.error}]`,
      r.stopped === 'maxrounds' && '[this subagent ran out of tool steps: its work may be unfinished]',
      // (de BlackCode: acá estas dos notas las pone la interfaz, que el padre no lee)
      r.motivo === 'largo' && '[this subagent hit the length limit: its report is cut short]',
      r.motivo === 'rechazo' && '[the model declined this task]',
    ].filter(Boolean);
    const cabeza = res.length > 1
      ? `## Subagent ${i + 1} of ${res.length} (${datos})\nBrief: ${r.brief.replace(/\s+/g, ' ').slice(0, 120)}${r.brief.length > 120 ? '…' : ''}`
      : `Subagent report (${datos}):`;
    return [cabeza, '', cuerpo, ...(notas.length ? ['', ...notas] : [])].join('\n');
  });
  const texto = bloques.join('\n\n');
  // si fallaron TODOS sin decir nada, la fila tiene que leerse como falla
  if (res.every((r) => r.error && !r.informe)) return `error: ${texto}`;
  return texto;
}

module.exports = {
  runners: { delegate: (run, a) => runDelegate(run, a) },
  configurar,
  runDelegate, correrSubagente, informeDeSubagente, resumenPasos,
  DELEGATE_MAX, DELEGATE_REPORT_CHARS,
};
