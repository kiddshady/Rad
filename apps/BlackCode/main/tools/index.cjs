'use strict';

// Las tools de BlackCode, armadas: registra cada familia en el motor y les pasa lo
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
const navegador = require('./navegador.cjs');
const notas = require('./notas.cjs');
const delegar = require('./delegar.cjs');
const memoria = require('./memoria.cjs');
const skills = require('./skills.cjs');
const imagenes = require('./imagenes.cjs');

let listo = false;
let mcpApp = null; // los servidores MCP de la app (main/mcp.cjs), o null

// Las tools de MCP no están escritas en defs.cjs ni tienen un runner propio:
// cada vez que un servidor conecta, se cae o se quita, se reemplazan todas.
function sincronizarMcp() {
  const specs = mcpApp ? mcpApp.specs() : [];
  defs.ponerDinamicas(specs.map((s) => ({ name: s.name, description: s.description, parameters: s.parameters })));
  motor.reemplazar('mcp_', Object.fromEntries(specs.map((s) => [s.name, (run, a) => mcpApp.correr(s.name, run, a)])));
}

/**
 * Deja las tools listas para usar. Lo que cada familia necesita de la app:
 *   carpeta            dónde guardan lo suyo (el taller de run_code, la base
 *                      propia del agente): la carpeta de datos de la app
 *   trash(ruta)        manda algo a la Papelera (fs_delete)
 *   shell              { openPath, openExternal, showItemInFolder } (os_open)
 *   capturador, pantallas       el desktopCapturer y el screen de Electron (screen_capture)
 *   ventana()                   la ventana principal, o null (el navegador pinta su página encima)
 *   modeloVe(run)               ¿el modelo de esa corrida acepta imágenes? (la foto de browser_read)
 *   abrirAfuera(url)            abre una dirección en el navegador del sistema
 *   titulosDeChats()            Map id → título de los chats (la biblioteca del canvas)
 *   avisar(canal, datos)        un aviso a la interfaz que no es de un turno (el agente borró un canvas)
 *   alProducir(run, imagenes)   run_code dejó imágenes: [{ name, dataUrl }]
 *   getKey(nombre)     una llave guardada, o null (web_search con Tavily o Brave)
 *   getSecret(nombre)  el valor de un {{secret:NOMBRE}}, o null (http_request)
 *   webSearch()        { provider, maxResults } de la búsqueda web
 *   subagentes         { destino(run), responder(pedido, opciones) }: con qué
 *                      modelo corre un hijo de `delegate` y cómo se lo llama
 *   memoria            la memoria de la app (main/memoria.cjs): remember y recall
 *   skills             las skills de la app (main/skills.cjs): skill y create_skill
 *   mcp                los servidores MCP (main/mcp.cjs): sus tools, sus grupos y su runner
 *   imagenes           { getKey(), ajustes(), deMentira }: la llave de Venice, lo
 *                      elegido en Settings y si es el humo (generate_image)
 */
function iniciar({ carpeta = null, trash = null, shell = null, capturador = null, pantallas = null, titulosDeChats = null, avisar = null, ventana = null, modeloVe = null, abrirAfuera = null, alProducir = null, getKey = null, getSecret = null, webSearch = null, subagentes = null, memoria: memoriaApp = null, skills: skillsApp = null, imagenes: imagenesApp = null, mcp: mcpDeLaApp = null } = {}) {
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
  navegador.configurar({
    ...(carpeta ? { carpeta } : {}),
    ...(ventana ? { ventana } : {}),
    ...(avisar ? { avisar } : {}),
    ...(modeloVe ? { modeloVe } : {}),
    ...(abrirAfuera ? { abrirAfuera } : {}),
  });
  notas.configurar({
    ...(carpeta ? { dbPath: () => path.join(carpeta, 'notes.db') } : {}),
    ...(avisar ? { broadcast: avisar } : {}),
  });
  if (memoriaApp) memoria.configurar({ memoria: memoriaApp });
  if (skillsApp) skills.configurar({ skills: skillsApp });
  if (mcpDeLaApp && mcpDeLaApp !== mcpApp) {
    mcpApp = mcpDeLaApp;
    mcpApp.on('cambio', sincronizarMcp);
    sincronizarMcp();
  }
  if (imagenesApp) imagenes.configurar({ ...imagenesApp, ...(carpeta ? { carpeta } : {}), ...(modeloVe ? { modeloVe } : {}) });
  motor.configurar({ classifyOsTarget: abrir.classifyOsTarget });
  // el hijo de `delegate` es una sesión como la de cualquier turno
  delegar.configurar({ crearSesion: (opciones) => module.exports.crearSesion(opciones), ...(subagentes ?? {}) });
  if (listo) return;
  motor.registrar({
    ...archivos.runners, ...comandos.runners, ...trabajos.runners, ...busqueda.runners,
    ...codigo.runners, ...datos.runners, ...web.runners, ...abrir.runners, ...captura.runners, ...lienzo.runners, ...navegador.runners, ...notas.runners, ...delegar.runners, ...memoria.runners, ...imagenes.runners, ...skills.runners,
  });
  listo = true;
}

/** Al salir la app: los jobs que queden corriendo se matan (viven fuera de
 *  los turnos, así que frenar un turno no los alcanza) y se cierra la base. */
function cerrar() {
  try { trabajos.cerrarTodo(); } catch { /* ya no hay nada que matar */ }
  try { datos.cerrar(); } catch { /* ya estaba cerrada */ }
  try { lienzo.cerrar(); } catch { /* ya estaba cerrada */ }
  try { navegador.cerrar(); } catch { /* nunca se abrió */ }
  try { notas.cerrar(); } catch { /* ya estaba cerrada */ }
}

/** Lo que la interfaz necesita para ofrecer las tools de un agente. */
function catalogo() {
  const hay = new Set(motor.registradas());
  return {
    // (`opcional`: no entra en «todas las tools» de un agente; ver defs.cjs)
    grupos: defs.GRUPOS.map((g) => ({ id: g.id, nombre: g.nombre, tools: g.tools.filter((n) => hay.has(n)), ...(g.opcional ? { opcional: true } : {}) })).filter((g) => g.tools.length)
      // …y un grupo por servidor MCP activo: opcional, con una marca en vez de la lista de sus tools
      .concat(mcpApp ? mcpApp.grupos() : []),
    carpeta: base.getCwd(),
  };
}

/** Lo que muestra la tarjeta de confirmación de una llamada: para escribir,
 *  editar o borrar un archivo, o para cambiar o borrar un canvas, qué va a
 *  cambiar. Para el resto, nada. */
async function vistaPrevia(run, name, args) {
  try {
    if (name === 'canvas') return ['edit', 'update', 'delete'].includes(args?.action) ? lienzo.canvasPreview(args) : null;
    // generar una imagen sale plata: la tarjeta dice con qué modelo y cuánto
    if (name === 'generate_image') return await imagenes.vista(args);
    // una tool de un servidor MCP: de cuál es (es código de terceros)
    if (typeof name === 'string' && name.startsWith('mcp_')) return mcpApp ? mcpApp.vista(name) : null;
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
    // Un agente guarda `mcp:<servidor>`, no las tools de ese servidor: acá se
    // cambia cada marca por las que el servidor ofrece hoy.
    if (mcpApp && Array.isArray(opciones?.tools)) opciones = { ...opciones, tools: mcpApp.expandir(opciones.tools) };
    // Si la base de las notas no abrió, sus dos tools no se ofrecen: el modelo
    // las pediría y fallarían siempre. (Se decide acá, antes del turno: que la
    // lista de tools cambie a mitad de un turno lo rompe.)
    const sinNotas = Array.isArray(opciones?.tools) && opciones.tools.some((n) => n === 'notepad' || n === 'notepad_write') && !notas.lista();
    // (lo mismo con la memoria, si la app no la configuró)
    const fuera = new Set([...(sinNotas ? ['notepad', 'notepad_write'] : []), ...(memoria.lista() ? [] : ['remember', 'recall']), ...(skills.lista() ? [] : ['skill', 'create_skill']), ...(imagenes.lista() ? [] : ['generate_image'])]);
    const s = sesion.crear(fuera.size && Array.isArray(opciones?.tools) ? { ...opciones, tools: opciones.tools.filter((n) => !fuera.has(n)) } : opciones);
    const sistema = s.sistema;
    // …y los canvas que este chat tiene abiertos: su cuerpo no viaja en la
    // conversación, así que sin esta lista el modelo no sabe que existen
    const canvas = () => { try { return s.nombres.includes('canvas') ? lienzo.canvasBlock(opciones.convoId) : ''; } catch { return ''; } };
    // …y el navegador: los favoritos del usuario por nombre («abrí mi Moodle»
    // anda sin que el modelo sepa la dirección) y la pestaña que tiene abierta
    // (textos de NeonCode)
    const delNavegador = () => {
      if (!s.nombres.includes('browser_navigate')) return '';
      try {
        const lineas = [];
        const fv = navegador.favoritosLista();
        if (fv.length) {
          const nombres = fv.slice(0, 30).map((f) => JSON.stringify(navegador.nombreFavorito(f).slice(0, 40)));
          lineas.push(`The user's browser bookmarks (pass a name as browser_navigate's url to open it): ${nombres.join(', ')}${fv.length > 30 ? `, and ${fv.length - 30} more` : ''}.`);
        }
        const migaja = navegador.migaja();
        if (migaja) lineas.push(migaja);
        return lineas.join('\n');
      } catch { return ''; }
    };
    // …y lo que la app recuerda del usuario: el texto lo deja en la corrida
    // quien arma el turno (chat.cjs), una vez, al empezar
    s.sistema = (instrucciones) => sistema(instrucciones, { trabajos: trabajosVivos(), canvas: canvas(), navegador: delNavegador(), memoria: typeof s.run.memoria === 'string' ? s.run.memoria : '', skills: typeof s.run.skills === 'string' ? s.run.skills : '' });
    return s;
  },
  // el canvas y el navegador, para los canales que usan sus paneles
  canvas: lienzo,
  navegador,
  notas,
  // las imágenes generadas: sus modelos (Settings) y leer un archivo para mostrarlo
  imagenes,
  argsDigest: motor.argsDigest,
  plegar: require('./guardas.cjs').foldToolRows,
  getCwd: base.getCwd,
  setCwd: base.setCwd,
};
