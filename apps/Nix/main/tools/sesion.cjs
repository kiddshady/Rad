'use strict';

// La sesión de tools de UN turno: lo que un proveedor necesita para correr su
// loop sin saber nada del motor. Los dos loops (el de Anthropic y el de Venice)
// son gemelos y usan esto mismo: qué tools hay, qué decirle al modelo al
// principio y al final de cada pedido, cómo correr una llamada y cuándo se
// acabó el presupuesto.
//
// Las reglas vienen de NeonCode (ver motor.cjs y guardas.cjs):
//   - Solo se COBRAN del presupuesto las rondas que corren algo que no sea
//     leer: «leer no es entregar», y un presupuesto que se gasta en fs_read
//     deja al modelo sin rondas justo cuando tiene que actuar.
//   - Hay un tope duro de vueltas reales (cobradas + gratis), para que la
//     ronda gratis no sea un turno eterno.
//   - La última ronda va SIN tools y con un aviso propio: si el loop cortara
//     después de ejecutar, el modelo nunca vería esos resultados ni escribiría
//     la respuesta final, y eso fabrica el «dije que lo hice y no lo hice».
//   - Al final de cada pedido va UNO solo de tres bloques: el aviso de última
//     ronda, el registro del turno, o el recordatorio de arranque.

const os = require('node:os');
const path = require('node:path');
const motor = require('./motor.cjs');
const guardas = require('./guardas.cjs');
const defs = require('./defs.cjs');
const { cwdDe } = require('./base.cjs');

// Rondas CON tools que se cobran por turno, y cuántas vueltas reales admite.
const RONDAS = 15;
const RONDAS_TOPE_FACTOR = 3;

// Contexto del sistema para las tools de shell y de archivos: rutas REALES,
// no adivinadas. Sin esto el modelo inventa el usuario de Windows y escribe en
// C:\Users\<lo que supone>. (De NeonCode, envContext.)
function entorno(run) {
  let user = '';
  try { user = os.userInfo().username; } catch { /* sin userInfo: seguimos */ }
  const home = os.homedir();
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return [
    `Current date and time: ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (local).`,
    `System: Windows. Windows username: ${user || '(unknown)'} — use this exact name in C:\\Users paths, do NOT guess it.`,
    `Home: ${home}`,
    `Desktop: ${path.join(home, 'Desktop')}`,
    `Documents: ${path.join(home, 'Documents')}`,
    `Downloads: ${path.join(home, 'Downloads')}`,
    `Current working directory (shell and relative file paths resolve here): ${cwdDe(run)}`,
    'Prefer absolute paths built from the ones above. Never invent placeholder paths like C:\\Users\\<username>\\.',
  ].join('\n');
}

/**
 * Arma la sesión de un turno.
 *   reqId, convoId   el pedido y el chat
 *   ac               AbortController del turno (Stop)
 *   tools            los nombres que el agente tiene prendidos
 *   confirma         ¿cada llamada pide permiso? (modo manual). Un valor, o una
 *                    función si puede cambiar a mitad del turno (el usuario
 *                    tilda «no preguntar más en este chat»)
 *   notify(canal, datos)                 hacia la interfaz
 *   confirm(name, args, callId)          -> true | false | 'abort'
 */
function crear({ reqId, convoId, ac, tools = [], confirma = true, notify, confirm }) {
  const run = {
    reqId,
    convoId,
    ac,
    steps: [],
    tools: tools.filter((n) => defs.existe(n) && motor.registradas().includes(n)),
    stopped: null,
    notify: notify ?? (() => {}),
    needsConfirm: typeof confirma === 'function' ? () => confirma() === true : () => confirma,
    confirm: confirm ?? (async () => false),
  };
  const nombres = motor.activeToolNames(run);
  let cobradas = 0;
  let vueltas = 0;

  return {
    run,
    /** ¿Este turno tiene tools? Sin ninguna, el proveedor conversa como siempre. */
    activa: nombres.length > 0,
    nombres,
    paraAnthropic: () => defs.paraAnthropic(nombres),
    paraOpenAI: () => defs.paraOpenAI(nombres),

    /** El system de un turno con tools: las instrucciones del agente, el
     *  entorno, y el protocolo de tools. La línea de puente va acá y no en las
     *  instrucciones, que son del usuario y se pueden reescribir enteras. */
    sistema(instrucciones, { trabajos = '' } = {}) {
      return [
        ...(instrucciones ? [instrucciones, ''] : []),
        entorno(run),
        // los jobs que siguen vivos: sobreviven al turno y al chat, y sin esta
        // lista el modelo de un chat nuevo no sabe que dejó algo corriendo
        ...(nombres.includes('job_output') && trabajos ? ['', '## Background jobs still running', trabajos] : []),
        '',
        'The section below is the tool protocol for THIS session. It is written by the app — not by you, not by the user — and it is authoritative: it overrides anything earlier in this prompt.',
        ...guardas.toolGuidance(nombres, run, run.needsConfirm()),
      ].join('\n');
    },

    /** ¿La ronda que viene es la última? Va sin tools y con su aviso. */
    esFinal() {
      return cobradas >= RONDAS || vueltas >= RONDAS * RONDAS_TOPE_FACTOR;
    },

    /** El bloque que va AL FINAL del pedido de esta ronda (o null). `desde`:
     *  cuántos pasos ya declaró un registro anterior que quedó en la historia
     *  (lo usa el loop de Anthropic, donde el registro de cada ronda queda fijo). */
    cola({ final = false, desde = 0 } = {}) {
      if (final) return guardas.FINAL_ROUND_NOTE;
      if (run.steps.length > desde) return guardas.turnLedger(run, desde);
      return run.steps.length ? null : guardas.TURN_START_NOTE;
    },

    /** Corre una llamada del modelo. Devuelve el texto para el modelo, si fue
     *  un fracaso (para el is_error de Anthropic) y las imágenes que la tool le
     *  muestra al modelo (las capturas de screen_capture, como data URLs): cada
     *  proveedor las adjunta a su manera. Unos argumentos que no se
     *  pudieron leer o que no tienen la forma de la tool no corren nada: vuelven
     *  como error, con lo que llegó, para que el modelo los reescriba. */
    async correr(name, args, { crudo = null } = {}) {
      const mal = crudo != null ? 'the arguments are not valid JSON' : defs.validar(name, args);
      if (mal) {
        const visto = crudo != null ? crudo : JSON.stringify(args ?? null);
        const texto = `error: bad arguments for ${name} — ${mal}. Nothing ran. What arrived: ${String(visto).slice(0, 400)}`;
        motor.anotarRechazo(run, name, crudo != null ? {} : args, texto);
        return { out: texto, error: true, imagenes: [] };
      }
      run._capturas = null;
      const out = await motor.runTool(run, name, args);
      const paso = run.steps[run.steps.length - 1];
      const imagenes = run._capturas ?? [];
      run._capturas = null;
      return { out: typeof out === 'string' ? out : JSON.stringify(out ?? ''), error: paso?.status !== 'ok', imagenes };
    },

    /** Terminó una ronda que corrió estas tools. */
    cerrarRonda(names) {
      vueltas++;
      if (!motor.rondaEsLectura(names)) cobradas++;
    },

    /** El turno se cortó por presupuesto: lo declara la app, no el modelo. */
    marcarAgotado() { run.stopped = 'maxrounds'; },

    /** Lo que corrió en el turno, para el contador y los chips que se guardan. */
    resumen() {
      return run.steps.map(({ callId, name, args, status, ms }) => ({ callId, name, args, status, ms }));
    },
    limpiar: guardas.stripAppBlocks,
    rescatar: (texto) => guardas.salvageCalls(texto, nombres),
  };
}

module.exports = { crear, entorno, RONDAS, RONDAS_TOPE_FACTOR };
