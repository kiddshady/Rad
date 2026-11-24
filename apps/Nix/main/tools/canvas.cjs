'use strict';

// La tool `canvas` de Nix: los documentos y archivos de código que el modelo
// escribe y que se abren en un panel al lado del chat. Acá están el runner
// (create, read, edit, update, delete y list), el bloque del system prompt que
// le dice al modelo qué canvas hay abiertos, el diff de la tarjeta de
// confirmación y lo que los handlers IPC de la app necesitan ya resuelto (la
// biblioteca entera, guardar la edición del usuario, el nombre del archivo al
// exportar). La base está en canvas-store.cjs.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están o están en otro módulo
// (el renderer, los turnos headless, fs_edit, fs_write, Umbra, saveUserEdit).
// Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - LA BASE SE ABRE SOLA. Allá `canvasInit()` corría en el arranque de la app
//     con `path.join(dataDir, 'canvas.db')`. Acá la ruta la da
//     configurar({ dbPath }), una función que devuelve la ruta absoluta, y
//     canvasInit() corre en el primer uso: donde el original preguntaba
//     `canvasReady`, acá pregunta `canvasLista()`, que la abre si todavía no se
//     intentó. Es UN intento por ruta, como allá era uno por arranque: si
//     falla, la tool contesta «the canvas store is unavailable» hasta que
//     cerrar() o configurar({ dbPath }) lo rearmen. Sin configurar queda en la
//     carpeta temporal del sistema, que alcanza para un test y para nada más:
//     la app TIENE que pasar la suya.
//   - `canvasStore` no es el módulo canvas-store.cjs a secas sino el mismo
//     store con esa apertura adelante de cada función (sin init ni close, que
//     acá son configurar y cerrar). Es lo que se exporta como `store`: así un
//     handler IPC que lista los canvas de un chat antes de que el modelo haya
//     usado la tool encuentra la base abierta, que es lo que allá garantizaba
//     el canvasInit() del arranque.
//   - cerrar() es nuevo: allá canvas.db quedaba abierta hasta que moría el
//     proceso. El uso siguiente la reabre.
//   - `titulosDeChats()` leía los JSON de los chats de `chatsDir`. Acá llega
//     por configurar({ titulosDeChats }): una función que devuelve un Map
//     id → título (o una promesa de uno). Sin configurar, o si falla, es un
//     Map vacío, y el `list` con scope "all" dice «Untitled» donde iría el
//     título.
//   - `broadcast(canal, datos)` era la función global que le habla a todas las
//     ventanas. Acá llega por configurar({ broadcast }); sin configurar no
//     hace nada.
//   - `applyEdits` y `normalizeEdits` salen de fs.cjs y `diffLines` de
//     diff.cjs, en vez de ser vecinos del mismo archivo. Son los mismos: el
//     edit de un canvas usa el motor de fs_edit.
//   - Los handlers IPC no vinieron (son de la app). De tres de ellos vino el
//     cuerpo, como función: listarTodos() es el de `canvas:listAll`, guardar()
//     el de `canvas:save` y nombreDeExport() la parte pura de `canvas:export`
//     (la extensión y el saneo del nombre; el diálogo y la escritura quedan
//     del lado de la app). Los demás son una llamada directa a `store`.
//   - El nombre de TOOL_RUNNERS (canvas) es `runners`.
//
// En los textos que lee el modelo «NeonCode» pasa a ser «Nix»; en lo que se
// portó no hubo ninguno que cambiar.
//
// El contrato de un runner está en la cabecera de base.cjs.

const os = require('node:os');
const path = require('node:path');

const almacen = require('./canvas-store.cjs'); // la base se abre en canvasInit()
const { applyEdits, normalizeEdits } = require('./fs.cjs');
const { diffLines } = require('./diff.cjs');

// ---------------------------------------------------------------------------
// Lo que este módulo necesita de la app. Llega por configurar(), nunca por un
// global (ver el contrato en base.cjs).
//
//   dbPath()            la ruta absoluta de canvas.db (su carpeta tiene que
//                       existir). Cambiarla cierra la que estuviera abierta: si
//                       no, la tool seguiría escribiendo en el archivo anterior.
//   titulosDeChats()    un Map id → título de los chats, o una promesa de uno.
//   broadcast(canal, datos)   avisa a todas las ventanas, haya o no un turno
//                       mirando (ver el delete de runCanvas).
//
// Cada llamada cambia solo las llaves que trae. Pasar null en titulosDeChats o
// en broadcast los desenchufa.
// ---------------------------------------------------------------------------
let rutaCanvasDb = () => path.join(os.tmpdir(), 'nix-canvas.db');

const SIN_TITULOS = async () => new Map();
const SIN_BROADCAST = () => {};

let titulosDeChats = SIN_TITULOS;
let broadcast = SIN_BROADCAST;

function configurar(deps = {}) {
  if (typeof deps.dbPath === 'function') {
    cerrar();
    rutaCanvasDb = deps.dbPath;
  }
  if ('titulosDeChats' in deps) {
    const dar = deps.titulosDeChats;
    // el original no tiraba nunca y siempre daba un Map: quien lo usa cuenta con eso
    titulosDeChats = typeof dar !== 'function' ? SIN_TITULOS : async () => {
      try {
        const titulos = await dar();
        return titulos instanceof Map ? titulos : new Map();
      } catch {
        return new Map();
      }
    };
  }
  if ('broadcast' in deps) {
    const avisar = deps.broadcast;
    // un aviso que falla no puede voltear la tool con el canvas ya en la papelera
    broadcast = typeof avisar !== 'function' ? SIN_BROADCAST : (canal, datos) => {
      try { avisar(canal, datos); } catch { /* la ventana se entera al volver a listar */ }
    };
  }
}

// ---------------------------------------------------------------------------
// Canvas — documentos / código que el modelo abre en el panel de al lado.
//
// Lo que hay que entender antes de tocar esto: el cuerpo del canvas NO viaja en
// el historial del chat. Eso es la gracia (no repite el documento en cada turno)
// y también la trampa: el modelo NO tiene copia de lo que escribió. Por eso la
// tool tiene "read" y "list" — sin ellas sería de una sola escritura y el modelo
// terminaría creando un canvas nuevo cada vez que quiere corregir una coma.
// Y por eso además el system prompt lleva el bloque <open_canvases>: si no, ni
// se entera de que existen.
// ---------------------------------------------------------------------------

let canvasProbada = false; // [Nix] ya se intentó abrir la base de esta ruta
let canvasReady = false;

function canvasInit() {
  try {
    almacen.init(rutaCanvasDb());
    canvasReady = true;
  } catch (err) {
    console.warn('[canvas] no se pudo abrir canvas.db:', err?.message || err);
  }
}

// [Nix] Lo que allá era mirar `canvasReady` después del canvasInit() del
// arranque: acá el primero que pregunta la abre. Si no se pudo, lo que haya
// quedado a medio abrir se cierra (el init del store deja la conexión puesta
// aunque falle más abajo) y no se vuelve a intentar hasta cerrar() o
// configurar({ dbPath }).
function canvasLista() {
  if (!canvasProbada) {
    canvasProbada = true;
    canvasInit();
    if (!canvasReady) almacen.close();
  }
  return canvasReady;
}

/** Cierra la base si estaba abierta (al salir de la app, o antes de mover o
 *  borrar su archivo). El próximo uso la vuelve a abrir. */
function cerrar() {
  canvasReady = false;
  canvasProbada = false;
  almacen.close();
}

// [Nix] El store como lo ve el resto de este archivo y como se exporta: cada
// función se asegura primero de que la base esté abierta. Con la base caída
// tiran «canvas store not initialized», que es lo que tira el store cerrado.
const canvasStore = {};
for (const [nombre, valor] of Object.entries(almacen)) {
  if (nombre === 'init' || nombre === 'close') continue;
  canvasStore[nombre] = typeof valor !== 'function' ? valor : (...args) => {
    canvasLista();
    return valor(...args);
  };
}

// Si el modelo envolvió TODO el cuerpo en una sola fence ```…``` (manía
// comunísima), la saca: si no, el documento entero se renderiza como un bloque
// de código. Solo dispara cuando el cuerpo ENTERO es exactamente una fence —
// exige que haya justo dos marcadores — así un documento normal con código
// adentro no se toca jamás.
function unwrapOuterFence(s) {
  const t = String(s || '').trim();
  if (!t.startsWith('```') || (t.match(/```/g) || []).length !== 2) return s;
  const m = t.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : s;
}

// sin el cuerpo: el aviso de borrado no necesita el documento para viajar
const lightCanvasRow = ({ content, ...rest }) => rest;

const canvasDescriptor = (c) =>
  `"${c.title}" (id: ${c.id}, ${c.kind}${c.language ? '/' + c.language : ''}, version ${c.version})`;

// Bloque del system prompt: qué canvas hay abiertos en ESTE chat. Solo metadata,
// nunca cuerpos — es barato y es lo único que el modelo necesita para pedir un
// "read" por id.
function canvasBlock(convoId) {
  if (!canvasLista() || !convoId) return '';
  try {
    const list = canvasStore.listByConversation(convoId);
    if (!list.length) return '';
    return [
      '',
      '## Open canvases',
      'Canvases already open in this conversation\'s side panel. To revise one, call `canvas` with action "read" and its id to get the current content, then action "update" with that id and the full new content. Do NOT create a new canvas for content that already lives in one of these.',
      ...list.map((c) => `- ${canvasDescriptor(c)}`),
    ].join('\n');
  } catch {
    return '';
  }
}

async function runCanvas(run, { action, id, title, kind = 'document', language, content, edits, replace_all: replaceAll, scope } = {}) {
  if (!canvasLista()) return 'error: the canvas store is unavailable';
  const convoId = run.convoId || null;

  // La biblioteca entera: todos los canvas de todos los chats, también los de
  // chats borrados. Existe para poder borrarlos (y ordenarlos) desde cualquier
  // chat; sin esto el modelo solo veía los del chat abierto, que en un chat
  // nuevo son cero. Solo metadata, igual que el list del chat.
  if (action === 'list' && scope === 'all') {
    const items = canvasStore.listAll();
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: 'library' });
    if (!items.length) return 'The canvas library is empty.';
    const titles = await titulosDeChats();
    const where = (c) => (!c.conversation_id ? 'its chat was deleted'
      : c.conversation_id === convoId ? 'this chat'
        : `chat "${titles.get(c.conversation_id) || 'Untitled'}"`);
    return `All canvases in the library (${items.length}):\n`
      + items.map((c) => `- ${canvasDescriptor(c)} — ${where(c)}, updated ${c.updated_at} UTC`).join('\n')
      + '\nAny of these ids can be deleted with action "delete". "read", "edit" and "update" only work on canvases of this chat.';
  }

  if (action === 'list') {
    const items = canvasStore.listByConversation(convoId);
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: 'list' });
    if (!items.length) return 'No canvases are open in this conversation yet. To see the whole canvas library, list with scope "all".';
    return `Canvases open in this conversation:\n${items.map((c) => '- ' + canvasDescriptor(c)).join('\n')}\n`
      + 'Use action "read" with an id to get a canvas\'s full content before revising it.';
  }

  if (action === 'read') {
    if (!id) return 'error: id is required to read a canvas';
    const c = canvasStore.get(id);
    // acotado a la conversación: un id inventado o traspapelado no lee otro chat
    if (!c || (convoId && c.conversation_id && c.conversation_id !== convoId)) return `error: canvas not found: ${id}`;
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: c.title });
    return `Canvas ${canvasDescriptor(c)}. Current content follows — to revise it, call canvas action "edit" `
      + 'with the same id and a list of exact { old, new } replacements copied from this text. '
      + `Do not send the whole document back:\n\n${c.content}`;
  }

  // La edición parcial. Antes no existía —"update reemplaza todo"— y el motivo
  // escrito era que un modelo que edita solo un pedazo termina inventando el
  // resto. Eso valía para un parche que la app tuviera que INTERPRETAR; con
  // reemplazo exacto no hay nada que inventar: el fragmento está tal cual o la
  // llamada falla entera. Lo que sí inventaba el modelo era el resto del
  // documento cuando lo obligábamos a reescribirlo completo para cambiar un
  // párrafo, que es el defecto que esto viene a sacar.
  //
  // El get + el update van SIN await en el medio a propósito: el store es
  // sqlite sincrónico y el main es un solo hilo, así que nadie puede colarse
  // entre leer y escribir. Un await ahí abriría la puerta a que el usuario
  // guarde su propia edición desde el panel en el hueco, y la escritura del
  // modelo se la comería.
  if (action === 'edit') {
    if (!id) return 'error: id is required to edit a canvas';
    const list = normalizeEdits(edits);
    if (!list.length) return 'error: edits is required to edit a canvas — pass at least one { old, new }';
    const existing = canvasStore.get(id);
    if (!existing || (convoId && existing.conversation_id && existing.conversation_id !== convoId)) {
      return `error: canvas not found: ${id}`;
    }
    // Los fragmentos NO pasan por unwrapOuterFence, al revés que `content`: acá
    // un ``` de más no es un envoltorio que el modelo agregó de puro hábito,
    // puede ser el bloque de código que el documento realmente tiene adentro.
    // Y si el modelo igual envuelve el `old`, no matchea y se entera enseguida
    // — mucho mejor que recortarle el fragmento en silencio.
    const r = applyEdits(existing.content, list, replaceAll === true);
    if (!r.ok) return `error: ${r.error}`; // el canvas queda intacto
    const c = canvasStore.update(id, { content: r.text, title });
    if (!c) return `error: canvas not found: ${id}`;
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: c.title });
    run.notify('canvas:opened', { reqId: run.reqId, convoId, canvas: c });
    const d = diffLines(existing.content, r.text, { context: 0, maxLines: 0 });
    return `Canvas "${c.title}" edited to version ${c.version} — ${list.length} edit${list.length === 1 ? '' : 's'} applied, `
      + `+${d.added} -${d.removed} lines. The user now sees the new version in the canvas panel.`;
  }

  // Borrar va a la papelera y no a la nada (ver `trash` en canvas-store.js): en
  // modo auto nadie aprueba esta llamada, y el renderer ofrece restaurarlo.
  //
  // A diferencia de read/edit, NO se acota al chat: el pedido real es "borrá los
  // canvas de la biblioteca" desde un chat cualquiera, y con el acotamiento eso
  // era imposible. Lo que el acotamiento evitaba era un id inventado pegándole a
  // otro documento; acá eso no pasa: los ids son UUID que solo salen de un list
  // (no se adivinan), y lo borrado vuelve desde la papelera.
  if (action === 'delete') {
    if (!id) return 'error: id is required to delete a canvas';
    const c = canvasStore.trash(id, null);
    if (!c) return `error: canvas not found: ${id}`;
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: c.title });
    // por broadcast y no por run.notify: los turnos headless (tareas, puentes, el
    // teléfono) tiran sus notify, y la ventana tiene que enterarse igual — para
    // sacarlo de la barra y la biblioteca, y para ofrecer el Restore
    broadcast('canvas:deleted', { convoId, canvas: lightCanvasRow(c) });
    return `Canvas "${c.title}" deleted. It is in the trash for ${canvasStore.TRASH_DIAS} days and the user can restore it from the app.`;
  }

  const body = unwrapOuterFence(String(content || ''));

  if (action === 'create') {
    if (!body.trim()) return 'error: content is required to create a canvas';
    const c = canvasStore.create({ conversationId: convoId, title, kind, language, content: body });
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: c.title });
    run.notify('canvas:opened', { reqId: run.reqId, convoId, canvas: c });
    return `Canvas "${c.title}" created (id: ${c.id}, version ${c.version}). It is now open in the user's canvas `
      + 'panel — reference it briefly; do NOT paste its full content into your reply.';
  }

  if (action === 'update') {
    if (!id) return 'error: id is required to update a canvas';
    if (!body.trim()) return 'error: content is required to update a canvas';
    const existing = canvasStore.get(id);
    if (!existing || (convoId && existing.conversation_id && existing.conversation_id !== convoId)) {
      return `error: canvas not found: ${id}`;
    }
    const c = canvasStore.update(id, { content: body, title, language });
    if (!c) return `error: canvas not found: ${id}`;
    run.notify('tool:activity', { reqId: run.reqId, kind: 'canvas', label: c.title });
    run.notify('canvas:opened', { reqId: run.reqId, convoId, canvas: c });
    return `Canvas "${c.title}" updated to version ${c.version}. The user now sees the new version in the canvas panel.`;
  }

  return `error: unknown action: ${action}`;
}

// lenguaje → extensión para "export to file"
const LANG_EXT = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py', ruby: 'rb', go: 'go', rust: 'rs', java: 'java',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', php: 'php',
  bash: 'sh', sh: 'sh', shell: 'sh', powershell: 'ps1', ps1: 'ps1',
  sql: 'sql', json: 'json', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md',
  html: 'html', markup: 'html', xml: 'xml', css: 'css', lua: 'lua',
};

// ---- IPC del canvas ----
// La lista de un chat y la global; `open` trae el cuerpo entero. La diferencia
// con la tool es a propósito: acá el usuario navega SUS datos, así que la
// biblioteca abre por id sin exigir conversación (la tool sí la exige, porque
// del otro lado hay un modelo que puede inventarse un id).
// [Nix] Los handlers son de la app. Acá quedan, como funciones, los cuerpos de
// los tres que hacían algo más que llamar al store: listarTodos (canvas:listAll),
// guardar (canvas:save) y nombreDeExport (canvas:export).

// El título de cada chat, por id. No sale de un JOIN como en Umbra (los chats son
// JSON sueltos): se lee el directorio una sola vez para toda una lista. Lo usan
// la biblioteca del panel y el `list` con scope "all" de la tool.
// [Nix] La función llega por configurar({ titulosDeChats }): ver arriba.

async function listarTodos() {
  try {
    const items = canvasStore.listAll();
    const titles = await titulosDeChats();
    // Los de la papelera van al final, marcados: el aviso con Restore dura unos
    // segundos y la papelera días, así que la biblioteca es donde se recuperan.
    // `daysLeft` se calcula acá para que el plazo viva en un solo lugar (el store)
    const borrados = canvasStore.listTrash().map((c) => {
      const edad = (Date.now() - Date.parse(String(c.deleted_at).replace(' ', 'T') + 'Z')) / 86400000;
      return { ...c, trashed: true, daysLeft: Math.max(1, Math.ceil(canvasStore.TRASH_DIAS - (edad || 0))) };
    });
    return [...items, ...borrados]
      .map((c) => ({ ...c, conversationTitle: c.conversation_id ? (titles.get(c.conversation_id) || null) : null }));
  } catch { return []; }
}

// update con {content, title}: nunca lleva language, así que el kind/lenguaje
// del canvas queda como lo definió quien lo creó — lo que `saveUserEdit`
// garantizaba con una copia línea por línea de update, que por eso se fue
function guardar({ id, content, title } = {}) {
  try { return canvasStore.update(id, { content, title }); } catch { return null; }
}

// [Nix] De `canvas:export` vino solo esto: el nombre que se le propone al
// usuario en el diálogo de guardar, con su extensión. El diálogo y la escritura
// del archivo son de la app.
function nombreDeExport({ title, kind, language } = {}) {
  const ext = kind === 'code' ? (LANG_EXT[String(language || '').toLowerCase()] || 'txt') : 'md';
  // el título lo escribió el MODELO: se sanea fuerte antes de tocar el disco
  const base = String(title || 'canvas')
    .replace(/[^\w.\- ]+/g, '_')  // fuera separadores de path y caracteres raros
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')       // sin puntos al principio (archivos ocultos)
    .slice(0, 60)
    .replace(/[.\s]+$/, '') || 'canvas';
  return `${base}.${ext}`;
}

// El canvas comparte tarjeta con los archivos porque comparte el problema: un
// `update` mete el documento entero como argumento, y la tarjeta lo mostraba
// crudo. Que el panel se vea al lado no alcanza — cuando la tarjeta pregunta,
// el cambio todavía no pasó, así que lo que hay para decidir es el diff.
function canvasPreview(a) {
  if (!canvasLista() || !a.id) return null;
  let c;
  try { c = canvasStore.get(a.id); } catch { return null; }
  // 'gone' y no 'missing': el modo de los archivos dice "no existe, crealo con
  // fs_write", que sobre un canvas no significa nada
  if (!c) return { target: `canvas ${a.id}`, mode: 'gone' };
  const antes = String(c.content ?? '');
  const etiqueta = `Canvas “${c.title}”`;
  // borrar: lo que se pierde es el documento entero, y eso es lo que hay que ver
  if (a.action === 'delete') return { target: etiqueta, mode: 'diff', ...diffLines(antes, '') };
  if (a.action === 'edit') {
    const r = applyEdits(antes, normalizeEdits(a.edits), a.replace_all === true);
    if (!r.ok) return { target: etiqueta, mode: 'fail', error: r.error };
    return { target: etiqueta, mode: 'diff', ...diffLines(antes, r.text) };
  }
  return { target: etiqueta, mode: 'diff', ...diffLines(antes, unwrapOuterFence(String(a.content ?? ''))) };
}

const runners = {
  canvas: (run, a) => runCanvas(run, a),
};

module.exports = {
  runners, configurar, cerrar,
  /** El store, para los handlers IPC: se abre solo en el primer uso. */
  store: canvasStore,
  canvasBlock, canvasPreview, unwrapOuterFence, lightCanvasRow, canvasDescriptor, LANG_EXT,
  listarTodos, guardar, nombreDeExport,
};
