'use strict';

// Las tools de Nix, armadas: registra cada familia en el motor y les pasa lo
// que necesitan de la app. El chat (main/chat.cjs) solo conoce esto.
//
// Casi todo lo de esta carpeta viene de NeonCode 1.11.3, portado tal cual
// (cada archivo dice de dónde y qué se adaptó). El resumen de cómo funciona el
// conjunto está en docs/tools.md.

const path = require('node:path');
const motor = require('./motor.cjs');
const defs = require('./defs.cjs');
const sesion = require('./sesion.cjs');
const base = require('./base.cjs');
const archivos = require('./fs.cjs');
const comandos = require('./shell.cjs');
const trabajos = require('./jobs.cjs');
const busqueda = require('./search.cjs');
const codigo = require('./code.cjs');
const datos = require('./sqlite.cjs');
const web = require('./web.cjs');
const abrir = require('./abrir.cjs');
const captura = require('./captura.cjs');
const lienzo = require('./canvas.cjs');

let listo = false;

/**
 * Deja las tools listas para usar. Lo que cada familia necesita de la app:
 *   carpeta            dónde guardan lo suyo (el taller de run_code, la base
 *                      propia del agente): la carpeta de datos de la app
 *   trash(ruta)        manda algo a la Papelera (fs_delete)
 *   shell              { openPath, openExternal, showItemInFolder } (os_open)
 *   capturador, pantallas       el desktopCapturer y el screen de Electron (screen_capture)
 *   titulosDeChats()            Map id → título de los chats (la biblioteca del canvas)
 *   avisar(canal, datos)        un aviso a la interfaz que no es de un turno (el agente borró un canvas)
 *   alProducir(run, imagenes)   run_code dejó imágenes: [{ name, dataUrl }]
 *   getKey(nombre)     una llave guardada, o null (web_search con Tavily o Brave)
 *   getSecret(nombre)  el valor de un {{secret:NOMBRE}}, o null (http_request)
 *   webSearch()        { provider, maxResults } de la búsqueda web
 */
function iniciar({ carpeta = null, trash = null, shell = null, capturador = null, pantallas = null, titulosDeChats = null, avisar = null, alProducir = null, getKey = null, getSecret = null, webSearch = null } = {}) {
  archivos.configurar({ trash });
  web.configurar({ getKey, getSecret, webSearch });
  abrir.configurar({ shell });
  captura.configurar({ capturador, pantallas, jobs: trabajos.jobs });
  lienzo.configurar({
    ...(carpeta ? { dbPath: () => path.join(carpeta, 'canvas.db') } : {}),
    ...(titulosDeChats ? { titulosDeChats } : {}),
    ...(avisar ? { broadcast: avisar } : {}),
  });
  codigo.configurar({ alProducir, ...(carpeta ? { workspace: () => path.join(carpeta, 'code-workspace') } : {}) });
  if (carpeta) datos.configurar({ dbPath: () => path.join(carpeta, 'agent.db') });
  motor.configurar({ classifyOsTarget: abrir.classifyOsTarget });
  if (listo) return;
  motor.registrar({
    ...archivos.runners, ...comandos.runners, ...trabajos.runners, ...busqueda.runners,
    ...codigo.runners, ...datos.runners, ...web.runners, ...abrir.runners, ...captura.runners, ...lienzo.runners,
  });
  listo = true;
}

/** Al salir la app: los jobs que queden corriendo se matan (viven fuera de
 *  los turnos, así que frenar un turno no los alcanza) y se cierra la base. */
function cerrar() {
  try { trabajos.cerrarTodo(); } catch { /* ya no hay nada que matar */ }
  try { datos.cerrar(); } catch { /* ya estaba cerrada */ }
  try { lienzo.cerrar(); } catch { /* ya estaba cerrada */ }
}

/** Lo que la interfaz necesita para ofrecer las tools de un agente. */
function catalogo() {
  const hay = new Set(motor.registradas());
  return {
    grupos: defs.GRUPOS.map((g) => ({ id: g.id, nombre: g.nombre, tools: g.tools.filter((n) => hay.has(n)) })).filter((g) => g.tools.length),
    carpeta: base.getCwd(),
  };
}

/** Lo que muestra la tarjeta de confirmación de una llamada: para escribir,
 *  editar o borrar un archivo, o para cambiar o borrar un canvas, qué va a
 *  cambiar. Para el resto, nada. */
async function vistaPrevia(run, name, args) {
  try {
    if (name === 'canvas') return ['edit', 'update', 'delete'].includes(args?.action) ? lienzo.canvasPreview(args) : null;
    return await archivos.preview(run, name, args);
  } catch { return null; }
}

/** Los jobs que siguen vivos, para el system prompt: sobreviven al turno y al
 *  chat, y sin esta lista el modelo de un chat nuevo no sabe que dejó un
 *  servidor corriendo en otro. '' si no hay ninguno. */
function trabajosVivos() {
  try { return trabajos.jobs.vivos().length ? trabajos.jobs.resumen({ soloVivos: true }) : ''; } catch { return ''; }
}

module.exports = {
  iniciar,
  cerrar,
  catalogo,
  vistaPrevia,
  trabajosVivos,
  // la sesión de un turno, con los jobs vivos ya puestos en su system prompt
  crearSesion(opciones) {
    const s = sesion.crear(opciones);
    const sistema = s.sistema;
    // …y los canvas que este chat tiene abiertos: su cuerpo no viaja en la
    // conversación, así que sin esta lista el modelo no sabe que existen
    const canvas = () => { try { return s.nombres.includes('canvas') ? lienzo.canvasBlock(opciones.convoId) : ''; } catch { return ''; } };
    s.sistema = (instrucciones) => sistema(instrucciones, { trabajos: trabajosVivos(), canvas: canvas() });
    return s;
  },
  // el canvas, para los canales que usa su panel
  canvas: lienzo,
  argsDigest: motor.argsDigest,
  plegar: require('./guardas.cjs').foldToolRows,
  getCwd: base.getCwd,
  setCwd: base.setCwd,
};
