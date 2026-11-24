'use strict';

// Las tools de Nix, armadas: registra cada familia en el motor y les pasa lo
// que necesitan de la app. El chat (main/chat.cjs) solo conoce esto.
//
// Casi todo lo de esta carpeta viene de NeonCode 1.11.3, portado tal cual
// (cada archivo dice de dónde y qué se adaptó). El resumen de cómo funciona el
// conjunto está en docs/tools.md.

const motor = require('./motor.cjs');
const defs = require('./defs.cjs');
const sesion = require('./sesion.cjs');
const base = require('./base.cjs');
const archivos = require('./fs.cjs');
const comandos = require('./shell.cjs');
const busqueda = require('./search.cjs');
const web = require('./web.cjs');

let listo = false;

/**
 * Deja las tools listas para usar. Lo que cada familia necesita de la app:
 *   trash(ruta)        manda algo a la Papelera (fs_delete)
 *   getKey(nombre)     una llave guardada, o null (web_search con Tavily o Brave)
 *   getSecret(nombre)  el valor de un {{secret:NOMBRE}}, o null (http_request)
 *   webSearch()        { provider, maxResults } de la búsqueda web
 */
function iniciar({ trash = null, getKey = null, getSecret = null, webSearch = null } = {}) {
  archivos.configurar({ trash });
  web.configurar({ getKey, getSecret, webSearch });
  if (listo) return;
  motor.registrar({ ...archivos.runners, ...comandos.runners, ...busqueda.runners, ...web.runners });
  listo = true;
}

/** Lo que la interfaz necesita para ofrecer las tools de un agente. */
function catalogo() {
  const hay = new Set(motor.registradas());
  return {
    grupos: defs.GRUPOS.map((g) => ({ id: g.id, nombre: g.nombre, tools: g.tools.filter((n) => hay.has(n)) })),
    carpeta: base.getCwd(),
  };
}

/** Lo que muestra la tarjeta de confirmación de una llamada: para escribir,
 *  editar o borrar un archivo, qué va a cambiar. Para el resto, nada. */
async function vistaPrevia(run, name, args) {
  try { return await archivos.preview(run, name, args); } catch { return null; }
}

module.exports = {
  iniciar,
  catalogo,
  vistaPrevia,
  crearSesion: sesion.crear,
  argsDigest: motor.argsDigest,
  plegar: require('./guardas.cjs').foldToolRows,
  getCwd: base.getCwd,
  setCwd: base.setCwd,
};
