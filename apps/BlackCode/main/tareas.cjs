'use strict';

// Las tareas programadas: un pedido que un agente corre solo, a una hora o
// cada tanto, y cuyo resultado queda en una bandeja (la pestaña Tasks).
//
// La idea viene de NeonCode (main.js: computeNextRun, runTask, tickScheduler).
// Acá cambia que una tarea es de un AGENTE (su modelo, sus instrucciones y sus
// tools), y lo que Fran eligió el 25/11/2026:
//   - el resultado va a una bandeja propia, no a un chat por corrida;
//   - sin nadie mirando, la corrida solo LEE, salvo que la tarea tenga prendido
//     «Let it act» (y ni así genera imágenes, usa un servidor MCP que pregunta,
//     agenda otra tarea o lanza subagentes): eso lo decide motor.cjs;
//   - un agente puede crearlas con la tool `schedule`, que siempre pide permiso.
//
// Este módulo no sabe de Electron ni de modelos: recibe dónde guardar, el reloj
// y cómo se corre una tarea (chat.cjs). Por eso se prueba con node pelado.
//
// Cuándo corre:
//   once   una vez: en `minutos`, o a la próxima vez que sean las `a` (HH:MM)
//   every  cada `minutos` (5 como mínimo: cada corrida gasta tokens)
//   daily  todos los días a las `a`
// Una tarea que debía correr con la app cerrada corre UNA vez al abrirla, no
// una por cada vez que faltó: después de correr, la próxima se calcula desde
// ese momento.

const TAREAS_MAX = 50;
const BANDEJA_MAX = 100;
const TITULO_MAX = 80;
const PROMPT_MAX = 8000;
const SALIDA_MAX = 60000;
const CADA_MIN = 5;                 // minutos: el piso de «every»
const CADA_MAX = 60 * 24 * 30;      // …y su techo: un mes
const UNA_VEZ_MAX = 60 * 24 * 366;  // «en N minutos»: hasta un año
const PAPELERA_MS = 10 * 60 * 1000; // cuánto se puede deshacer un borrado
const TIC_MS = 30000;

/** 'HH:MM' de 24 horas → [h, m], o null. Fuera de rango se RECHAZA, no se
 *  acomoda: un «25:70» corregido a 23:59 es una tarea a una hora que nadie pidió. */
function horaDe(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : [h, mi];
}
const dos = (n) => String(n).padStart(2, '0');

/** Revisa «cuándo corre». `{ spec }` limpio, o `{ error }`. */
function revisarSpec(s = {}) {
  const kind = s.kind;
  if (kind === 'daily') {
    const h = horaDe(s.a);
    return h ? { spec: { kind, a: `${dos(h[0])}:${dos(h[1])}` } } : { error: 'A daily task needs a time of day like "09:00" (24 hours).' };
  }
  if (kind === 'every') {
    const n = Math.round(Number(s.minutos));
    if (!Number.isFinite(n) || n < CADA_MIN) return { error: `A repeating task runs every ${CADA_MIN} minutes at the least.` };
    if (n > CADA_MAX) return { error: 'A repeating task can wait up to 30 days between runs.' };
    return { spec: { kind, minutos: n } };
  }
  if (kind === 'once') {
    if (s.a !== undefined && s.a !== null && s.a !== '') {
      const h = horaDe(s.a);
      return h ? { spec: { kind, a: `${dos(h[0])}:${dos(h[1])}` } } : { error: 'The time of day must look like "09:00" (24 hours).' };
    }
    const n = Math.round(Number(s.minutos));
    if (!Number.isFinite(n) || n < 1) return { error: 'Say in how many minutes it runs, or at what time of day.' };
    if (n > UNA_VEZ_MAX) return { error: 'A one-time task can be up to a year away.' };
    return { spec: { kind, minutos: n } };
  }
  return { error: 'The task must run once, every so many minutes, or daily.' };
}

/** La próxima corrida (epoch ms) de una tarea con ese `spec`, contando desde `desde`. */
function proxima(spec, desde) {
  if (spec.kind === 'every') return desde + spec.minutos * 60000;
  if (spec.a) {
    const [h, mi] = horaDe(spec.a) ?? [9, 0];
    const d = new Date(desde);
    d.setHours(h, mi, 0, 0);
    // «Mañana a la misma hora de reloj», no «+24 h»: el día que cambia la hora
    // dura 23 o 25, y sumando milisegundos fijos la tarea de las 9 corría a las
    // 8 (y otra vez a las 9). setDate corre el día y deja la hora quieta.
    if (d.getTime() <= desde) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return desde + spec.minutos * 60000;
}

/** Cada cuánto corre, en palabras (la interfaz y la tool `schedule`). */
function describir(spec) {
  const lapso = (n) => (n % 1440 === 0 ? `${n / 1440} day${n === 1440 ? '' : 's'}` : n % 60 === 0 ? `${n / 60} hour${n === 60 ? '' : 's'}` : `${n} minute${n === 1 ? '' : 's'}`);
  if (spec?.kind === 'daily') return `every day at ${spec.a}`;
  if (spec?.kind === 'every') return `every ${lapso(spec.minutos)}`;
  if (spec?.kind === 'once') return spec.a ? `once, at ${spec.a}` : `once, in ${lapso(spec.minutos)}`;
  return 'never';
}

const texto = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');

/**
 * Las tareas de la app y su bandeja de resultados.
 *
 * @param {object} deps
 *   leer(), escribir(lista)                 el documento de las tareas
 *   leerBandeja(), escribirBandeja(lista)   …y el de los resultados
 *   correr(tarea, { signal }) → Promise<{ salida, pasos, error, cortada, agente }>
 *                                           corre el pedido (chat.cjs). No tira: lo que falla va en `error`
 *   ocupado() → boolean                     ¿hay un turno de chat en curso? (una tarea no compite con él)
 *   existeAgente(id) → boolean
 *   ahora()                                 el reloj
 *   alCambiar(que)                          'tareas' | 'bandeja' | 'corriendo'
 *   alTerminar(resultado)                   una corrida dejó su resultado (el aviso de Windows)
 *   nuevoId()
 */
function crear({ leer, escribir, leerBandeja, escribirBandeja, correr, ocupado = () => false, existeAgente = () => true, ahora = () => Date.now(),
  alCambiar = () => {}, alTerminar = () => {}, nuevoId = () => require('node:crypto').randomBytes(6).toString('hex') } = {}) {
  let tareas = null;
  let bandeja = null;
  let papelera = [];          // { tarea, hasta }: lo borrado, mientras se puede deshacer
  let enCurso = null;         // { id, ac, desde }: la tarea que corre ahora
  let reloj = null;
  let primero = null;

  const cargar = () => {
    if (!tareas) {
      const doc = leer();
      tareas = (Array.isArray(doc?.lista) ? doc.lista : []).filter((t) => t && typeof t.id === 'string' && typeof t.prompt === 'string' && !revisarSpec(t.spec).error);
    }
    return tareas;
  };
  const cargarBandeja = () => {
    if (!bandeja) {
      const doc = leerBandeja();
      bandeja = (Array.isArray(doc?.lista) ? doc.lista : []).filter((r) => r && typeof r.id === 'string');
    }
    return bandeja;
  };
  const guardar = async () => { await escribir({ v: 1, lista: cargar() }); alCambiar('tareas'); };
  const guardarBandeja = async () => { await escribirBandeja({ v: 1, lista: cargarBandeja() }); alCambiar('bandeja'); };
  const buscar = (id) => cargar().find((t) => t.id === id) ?? null;

  /** Revisa lo que llega de la interfaz o del agente. `{ datos }` o `{ error, campo }`. */
  function revisar(e = {}) {
    const titulo = texto(e.titulo, TITULO_MAX);
    if (!titulo) return { error: 'Give the task a name.', campo: 'titulo' };
    const prompt = texto(e.prompt, PROMPT_MAX);
    if (!prompt) return { error: 'Write what the agent has to do.', campo: 'prompt' };
    if (typeof e.agente !== 'string' || !existeAgente(e.agente)) return { error: 'Choose the agent that runs it.', campo: 'agente' };
    const s = revisarSpec(e.spec);
    if (s.error) return { error: s.error, campo: 'spec' };
    return { datos: { titulo, prompt, agente: e.agente, spec: s.spec, actuar: e.actuar === true } };
  }

  /** Lo que ve la interfaz: cada tarea, con cuándo corre en palabras. */
  const lista = () => cargar().map((t) => ({ ...t, cuando: describir(t.spec), corriendo: enCurso?.id === t.id }));

  async function agregar(e = {}) {
    const r = revisar(e);
    if (r.error) return { ok: false, error: r.error, campo: r.campo };
    if (cargar().length >= TAREAS_MAX) return { ok: false, error: `There can be up to ${TAREAS_MAX} tasks. Delete one first.` };
    const t = ahora();
    const tarea = { id: nuevoId(), ...r.datos, activa: true, de: e.de === 'agent' ? 'agent' : 'user', creada: t, proxima: proxima(r.datos.spec, t), ultima: null, corridas: 0 };
    cargar().push(tarea);
    await guardar();
    return { ok: true, tarea };
  }

  async function cambiar(id, e = {}) {
    const tarea = buscar(id);
    if (!tarea) return { ok: false, error: 'That task is gone.' };
    const r = revisar({ ...e, agente: e.agente ?? tarea.agente });
    if (r.error) return { ok: false, error: r.error, campo: r.campo };
    // (si no cambió CUÁNDO corre, la próxima corrida queda donde estaba: guardar
    // un título nuevo no tiene que correr el reloj de una tarea «cada 6 horas»)
    const mismo = JSON.stringify(tarea.spec) === JSON.stringify(r.datos.spec);
    Object.assign(tarea, r.datos);
    if (!mismo || tarea.proxima === null) { tarea.proxima = proxima(tarea.spec, ahora()); tarea.activa = true; }
    await guardar();
    return { ok: true, tarea };
  }

  /** Prende o apaga. Al prender, la próxima corrida se cuenta desde ahora. */
  async function activar(id, activa) {
    const tarea = buscar(id);
    if (!tarea) return { ok: false };
    tarea.activa = activa === true;
    if (tarea.activa) tarea.proxima = proxima(tarea.spec, ahora());
    await guardar();
    return { ok: true };
  }

  async function quitar(id) {
    const l = cargar();
    const i = l.findIndex((t) => t.id === id);
    if (i < 0) return { ok: false };
    if (enCurso?.id === id) enCurso.ac.abort();
    const [tarea] = l.splice(i, 1);
    papelera = [...papelera.filter((p) => p.hasta > ahora()), { tarea, hasta: ahora() + PAPELERA_MS }];
    await guardar();
    return { ok: true, tarea };
  }

  /** Deshace un borrado, mientras siga en la papelera. */
  async function restaurar(id) {
    const p = papelera.find((x) => x.tarea.id === id && x.hasta > ahora());
    if (!p || buscar(id)) return { ok: false };
    papelera = papelera.filter((x) => x !== p);
    cargar().push(p.tarea);
    await guardar();
    return { ok: true };
  }

  /** Un agente se borró: sus tareas se van con él. */
  async function alBorrarAgente(agente) {
    const antes = cargar().length;
    for (const t of cargar().filter((x) => x.agente === agente)) if (enCurso?.id === t.id) enCurso.ac.abort();
    tareas = cargar().filter((t) => t.agente !== agente);
    if (tareas.length !== antes) await guardar();
  }

  // ---------- Correr ----------

  /** Las que ya tocan, de la más atrasada a la más reciente. */
  const vencidas = (t = ahora()) => cargar().filter((x) => x.activa && typeof x.proxima === 'number' && x.proxima <= t).sort((a, b) => a.proxima - b.proxima);

  async function ejecutar(tarea, { manual = false } = {}) {
    const ac = new AbortController();
    const desde = ahora();
    enCurso = { id: tarea.id, ac, desde };
    alCambiar('corriendo');
    let r;
    try { r = await correr({ ...tarea }, { signal: ac.signal }); } catch (err) { r = { error: String(err?.message ?? err) }; }
    const fin = ahora();
    enCurso = null;
    // (la tarea pudo borrarse mientras corría: su resultado queda igual, y ella no vuelve)
    const viva = buscar(tarea.id);
    if (viva) {
      viva.ultima = fin;
      viva.corridas = (viva.corridas ?? 0) + 1;
      // «Run now» no mueve el horario: corre una vez más, y lo programado sigue como estaba.
      if (!manual) {
        if (viva.spec.kind === 'once') { viva.activa = false; viva.proxima = null; }
        else viva.proxima = proxima(viva.spec, fin);
      }
      await guardar();
    }
    const resultado = {
      id: nuevoId(),
      tarea: tarea.id,
      titulo: tarea.titulo,
      prompt: tarea.prompt,
      agente: tarea.agente,
      agenteNombre: texto(r?.agente, 80),
      salida: typeof r?.salida === 'string' ? r.salida.slice(0, SALIDA_MAX) : '',
      pasos: (Array.isArray(r?.pasos) ? r.pasos : []).slice(0, 60),
      error: r?.error ? String(r.error).slice(0, 600) : null,
      cortada: r?.cortada ?? null,
      actuo: tarea.actuar === true,
      manual,
      ts: fin,
      ms: fin - desde,
      leida: false,
    };
    cargarBandeja().unshift(resultado);
    bandeja = cargarBandeja().slice(0, BANDEJA_MAX);
    await guardarBandeja();
    alCambiar('corriendo');
    try { alTerminar(resultado); } catch { /* el aviso no tumba al scheduler */ }
    return resultado;
  }

  /** El latido: corre lo que toca, de a una, y nunca encima de un turno de chat. */
  async function tic() {
    if (enCurso) return 0;
    let hechas = 0;
    for (const t of vencidas()) {
      // (se mira antes de cada una: un chat pudo empezar mientras corría la anterior)
      if (ocupado()) break;
      // (pudo apagarse o borrarse mientras corría la anterior)
      const viva = buscar(t.id);
      if (!viva || !viva.activa || viva.proxima > ahora()) continue;
      await ejecutar(viva);
      hechas++;
    }
    return hechas;
  }

  /** «Run now»: corre una tarea ya, aunque esté apagada. No espera a que termine. */
  function correrAhora(id) {
    const tarea = buscar(id);
    if (!tarea) return { ok: false, error: 'That task is gone.' };
    if (enCurso) return { ok: false, ocupado: true, error: 'Another task is running. Try again when it ends.' };
    const trabajo = ejecutar(tarea, { manual: true });
    return { ok: true, trabajo };
  }

  // ---------- La bandeja ----------
  const resultados = () => cargarBandeja();
  const sinLeer = () => cargarBandeja().filter((r) => !r.leida).length;
  async function marcarLeida(id) {
    const r = cargarBandeja().find((x) => x.id === id);
    if (!r || r.leida) return { ok: Boolean(r) };
    r.leida = true;
    await guardarBandeja();
    return { ok: true };
  }
  async function marcarTodas() {
    if (!sinLeer()) return { ok: true };
    for (const r of cargarBandeja()) r.leida = true;
    await guardarBandeja();
    return { ok: true };
  }
  async function quitarResultado(id) {
    const antes = cargarBandeja().length;
    bandeja = cargarBandeja().filter((r) => r.id !== id);
    if (bandeja.length !== antes) await guardarBandeja();
    return { ok: bandeja.length !== antes };
  }
  async function vaciarBandeja() {
    if (!cargarBandeja().length) return { ok: true };
    bandeja = [];
    await guardarBandeja();
    return { ok: true };
  }

  return {
    lista,
    buscar,
    revisar,
    agregar,
    cambiar,
    activar,
    quitar,
    restaurar,
    alBorrarAgente,
    vencidas,
    tic,
    correrAhora,
    /** Frena la que está corriendo (el botón Stop de la pestaña). */
    frenar: () => { enCurso?.ac.abort(); return { ok: Boolean(enCurso) }; },
    corriendo: () => (enCurso ? { id: enCurso.id, desde: enCurso.desde } : null),
    resultados,
    sinLeer,
    marcarLeida,
    marcarTodas,
    quitarResultado,
    vaciarBandeja,
    /** Arranca el latido: cada 30 s, y una primera vez a los 3 s (las atrasadas). */
    arrancar({ cada = TIC_MS, alAbrir = 3000 } = {}) {
      this.parar();
      reloj = setInterval(() => { tic().catch(() => {}); }, cada);
      primero = setTimeout(() => { tic().catch(() => {}); }, alAbrir);
      reloj.unref?.();
      primero.unref?.();
    },
    parar() { clearInterval(reloj); clearTimeout(primero); reloj = null; primero = null; },
  };
}

module.exports = { crear, revisarSpec, proxima, describir, horaDe, TAREAS_MAX, BANDEJA_MAX, CADA_MIN, PROMPT_MAX, PAPELERA_MS };
