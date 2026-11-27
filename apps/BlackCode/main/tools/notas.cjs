'use strict';

// Las tools del notepad de BlackCode: `notepad`, con la que el modelo lee las
// notas que el usuario guarda en el panel Notepad, y `notepad_write`, con la
// que crea una, la edita, la mueve de carpeta, la borra o la restaura cuando él
// se lo pide. Acá están los dos runners, sus ayudantes (el título de una nota,
// la carpeta por nombre) y los cuerpos de los handlers IPC del panel. La base
// está en notes-store.cjs.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están o están en otro módulo
// (el panel y su notesChangedOutside, la isla, los turnos headless, el celu,
// `remember`, chat_search, Umbra, Neo; READ_ROUND_TOOLS e IDEMPOTENT_TOOLS
// están en motor.cjs). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - LA BASE SE ABRE SOLA. Allá `notesInit()` corría en el arranque de la app
//     con `path.join(dataDir, 'notes.db')`. Acá la ruta la da
//     configurar({ dbPath }), una función que devuelve la ruta absoluta, y
//     notesInit() corre en el primer uso: donde el original preguntaba
//     `notesReady`, acá pregunta `notesLista()`, que la abre si todavía no se
//     intentó. Es UN intento por ruta, como allá era uno por arranque: si
//     falla, las tools contestan «the notepad is unavailable» hasta que
//     cerrar() o configurar({ dbPath }) lo rearmen. Sin configurar queda en la
//     carpeta temporal del sistema, que alcanza para un test y para nada más:
//     la app TIENE que pasar la suya.
//   - `notesStore` no es el módulo notes-store.cjs a secas sino el mismo store
//     con esa apertura adelante de cada función (sin init ni close, que acá
//     son configurar y cerrar). Es lo que se exporta como `store`: así el
//     panel, que lista las notas antes de que el modelo haya usado la tool,
//     encuentra la base abierta, que es lo que allá garantizaba el notesInit()
//     del arranque.
//   - cerrar() es nuevo: allá notes.db quedaba abierta hasta que moría el
//     proceso. El uso siguiente la reabre.
//   - `broadcast(canal, datos)` era la función global que le habla a todas las
//     ventanas. Acá llega por configurar({ broadcast }); sin configurar no
//     hace nada, y si tira no voltea la operación que avisaba.
//   - `applyEdits` y `normalizeEdits` salen de fs.cjs, `diffLines` de diff.cjs
//     y `unwrapOuterFence` de canvas.cjs, en vez de ser vecinos del mismo
//     archivo. Son los mismos: el edit de una nota usa el motor de fs_edit.
//   - Los handlers IPC no vinieron (son de la app). Vino el cuerpo de cada
//     uno, con su try y su valor de fallback, como una función de `ipc` que
//     recibe lo que mandaba el renderer, sin el evento. Qué canal es cada una
//     está en la tabla de más abajo.
//   - El filtro de `activeToolNames`, que sacaba las dos tools del turno si la
//     base no había abierto (`!notesReady`), no vino: es de quien arma la lista
//     de tools. Para eso queda lista(), que contesta lo mismo que `notesReady`.
//   - Los dos nombres de TOOL_RUNNERS (notepad y notepad_write) son `runners`.
//
// En los textos que lee el modelo «NeonCode» pasa a ser «BlackCode»; en lo que se
// portó no hubo ninguno que cambiar.
//
// El contrato de un runner está en la cabecera de base.cjs.

const os = require('node:os');
const path = require('node:path');

const almacen = require('./notes-store.cjs'); // la base se abre en notesInit()
const { applyEdits, normalizeEdits } = require('./fs.cjs');
const { diffLines } = require('./diff.cjs');
const { unwrapOuterFence } = require('./canvas.cjs');

// ---------------------------------------------------------------------------
// Lo que este módulo necesita de la app. Llega por configurar(), nunca por un
// global (ver el contrato en base.cjs).
//
//   dbPath()            la ruta absoluta de notes.db (su carpeta tiene que
//                       existir). Cambiarla cierra la que estuviera abierta: si
//                       no, las tools seguirían escribiendo en el archivo
//                       anterior.
//   broadcast(canal, datos)   avisa a todas las ventanas, haya o no un turno
//                       mirando: 'notes:changed', sin datos, cada vez que una
//                       nota cambió por fuera del panel, y 'notes:deleted' con
//                       { id, title } cuando el modelo mandó una a la papelera
//                       (ver runNotepadWrite).
//
// Cada llamada cambia solo las llaves que trae. Pasar null en broadcast lo
// desenchufa.
// ---------------------------------------------------------------------------
let rutaNotesDb = () => path.join(os.tmpdir(), 'blackcode-notes.db');

const SIN_BROADCAST = () => {};

let broadcast = SIN_BROADCAST;

function configurar(deps = {}) {
  if (typeof deps.dbPath === 'function') {
    cerrar();
    rutaNotesDb = deps.dbPath;
  }
  if ('broadcast' in deps) {
    const avisar = deps.broadcast;
    // un aviso que falla no puede voltear la tool con la nota ya escrita o ya
    // en la papelera
    broadcast = typeof avisar !== 'function' ? SIN_BROADCAST : (canal, datos) => {
      try { avisar(canal, datos); } catch { /* el panel se entera al volver a listar */ }
    };
  }
}

// ---------------------------------------------------------------------------
// Notepad: las notas del usuario. Base propia (notes.db) por lo mismo que el
// canvas — el modelo hace DDL libre sobre agent.db con db_query.
//
// Hasta la 1.8 el modelo solo LEÍA la libreta. Desde la 1.9.0 escribe, edita y
// borra con `notepad_write` (pedido de Fran, 3/11/2026), pero la libreta sigue
// siendo del usuario: la tool dice que se escribe solo cuando él lo pide, y lo
// que borra el modelo va a una papelera de notes.db con aviso para restaurar.
// ---------------------------------------------------------------------------

let notesProbada = false; // [BlackCode] ya se intentó abrir la base de esta ruta
let notesReady = false;

function notesInit() {
  try {
    almacen.init(rutaNotesDb());
    notesReady = true;
  } catch (err) {
    console.warn('[notes] no se pudo abrir notes.db:', err?.message || err);
  }
}

// [BlackCode] Lo que allá era mirar `notesReady` después del notesInit() del
// arranque: acá el primero que pregunta la abre. Si no se pudo, lo que haya
// quedado a medio abrir se cierra (el init del store deja la conexión puesta
// aunque falle más abajo) y no se vuelve a intentar hasta cerrar() o
// configurar({ dbPath }).
function notesLista() {
  if (!notesProbada) {
    notesProbada = true;
    notesInit();
    if (!notesReady) almacen.close();
  }
  return notesReady;
}

/** Cierra la base si estaba abierta (al salir de la app, o antes de mover o
 *  borrar su archivo). El próximo uso la vuelve a abrir. */
function cerrar() {
  notesReady = false;
  notesProbada = false;
  almacen.close();
}

// [BlackCode] El store como lo ve el resto de este archivo y como se exporta: cada
// función se asegura primero de que la base esté abierta. Con la base caída
// tiran «notes store not initialized», que es lo que tira el store cerrado.
const notesStore = {};
for (const [nombre, valor] of Object.entries(almacen)) {
  if (nombre === 'init' || nombre === 'close') continue;
  notesStore[nombre] = typeof valor !== 'function' ? valor : (...args) => {
    notesLista();
    return valor(...args);
  };
}

// ---------------------------------------------------------------------------
// Las tools del notepad: `notepad` LEE y `notepad_write` escribe.
//
// Son dos y no una con `action` (como el canvas) por las listas que van por
// nombre: READ_ROUND_TOOLS (la ronda de lectura es gratis) e IDEMPOTENT_TOOLS
// (el thrash breaker). Una tool cuya naturaleza depende de un argumento no
// puede entrar en ninguna, y leer la libreta tiene que seguir siendo lectura.
//
// Hasta la 1.8 solo existía la de lectura, a propósito: la libreta era del
// usuario y nada de lo que apareciera ahí podía no haberlo puesto él. Fran pidió
// que Neo también escriba, edite y borre (1.9.0). Lo que queda de aquella idea
// está en la descripción: se escribe cuando el usuario lo pide, no para tomar
// apuntes propios (para eso está `remember`).
//
// El `query` opcional no está en Umbra, se agrega acá por el mismo motivo que lo
// tiene `chat_search`: el notepad crece sin techo y volcarlo entero en el
// contexto en cada llamada es caro y, encima, mete adentro del prompt notas que
// no tenían nada que ver con lo que se preguntó.
// ---------------------------------------------------------------------------

// Igual que las tarjetas del panel: el título es la primera línea con el markdown
// sacado, no un campo aparte.
function noteHeadline(content) {
  const first = String(content || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return first
    .replace(/^#{1,6}\s+/, '').replace(/^>\s+/, '').replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '').replace(/^\[[ xX]\]\s+/, '')
    .replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .trim() || 'Untitled';
}

async function runNotepad(run, { query, limit } = {}) {
  if (!notesLista()) return 'error: the notepad is unavailable';
  const n = Math.max(1, Math.min(50, Number(limit) || 20));
  let notes;
  let folders;
  try {
    notes = notesStore.list();
    folders = notesStore.listFolders();
  } catch { return 'error: the notepad could not be read'; }
  if (!notes.length) return 'The notepad is empty.';

  // Búsqueda por palabras sueltas y sin orden, como chat_search: el modelo no
  // sabe con qué palabras exactas escribió el usuario.
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  let hits = terms.length
    ? notes.filter((x) => { const c = x.content.toLowerCase(); return terms.every((t) => c.includes(t)); })
    : notes;
  if (!hits.length) return `No notes matching "${terms.join(' ')}".`;

  // Sin query es un browse por recencia: las más nuevas son las que importan.
  // Con query se respeta el orden del store (fijadas arriba) — ahí el criterio ya
  // lo puso el usuario al fijarlas.
  //
  // El reverse va POR GRUPO y no sobre la lista entera. `list()` devuelve fijadas
  // primero y después por created_at ascendente; darla vuelta completa mandaba
  // las fijadas AL FONDO, y el slice de abajo se las comía — o sea que el browse
  // sin query descartaba justo las notas que el usuario marcó como importantes,
  // mientras el encabezado seguía diciendo que eran "las N más recientes".
  if (!terms.length) {
    const fijadas = hits.filter((x) => x.pinned);
    const resto = hits.filter((x) => !x.pinned);
    hits = [...fijadas.reverse(), ...resto.reverse()];
  }
  const total = hits.length;
  hits = hits.slice(0, n);

  const fname = new Map(folders.map((f) => [f.id, f.name]));
  run.notify('tool:activity', { reqId: run.reqId, kind: 'notepad', label: query || 'read' });

  const body = hits.map((x) => {
    const where = x.folder_id ? ` · folder: ${fname.get(x.folder_id) || 'Folder'}` : '';
    const pin = x.pinned ? ' · pinned' : '';
    return `--- ${noteHeadline(x.content)} (id: ${x.id} · ${(x.updated_at || x.created_at || '').slice(0, 10)}${where}${pin})\n${x.content}`;
  }).join('\n\n');

  const head = terms.length
    ? `${total} note${total === 1 ? '' : 's'} matching "${terms.join(' ')}"${total > hits.length ? `, showing ${hits.length}` : ''}:`
    : `The user's notepad — ${total} note${total === 1 ? '' : 's'}${total > hits.length ? `, showing the ${hits.length} most recent` : ''}:`;
  const out = `${head}\n\n${body}`;
  return out.length > 12000 ? out.slice(0, 12000) + '\n…[truncated]' : out;
}

// La carpeta por NOMBRE, que es como la dice el usuario ("anotalo en Facu"). Sin
// distinguir mayúsculas; si no existe se crea, porque "anotá esto en una carpeta
// X" es un pedido normal y fallar ahí costaría una ronda para nada. '' = suelta.
function carpetaDeNota(nombre) {
  const want = String(nombre ?? '').trim();
  if (!want) return { id: null, name: '', nueva: false };
  const hit = notesStore.listFolders().find((f) => f.name.trim().toLowerCase() === want.toLowerCase());
  if (hit) return { id: hit.id, name: hit.name, nueva: false };
  const f = notesStore.createFolder(want);
  return { id: f.id, name: f.name, nueva: true };
}

// La escritura. Cada cambio sale por broadcast('notes:changed') y no por
// run.notify: los turnos headless (tareas, el celu) tiran sus notify, y el panel
// tiene que ponerse al día igual. El panel ya sabe qué hacer si la nota cambiada
// es la que el usuario tiene abierta (notesChangedOutside): si no tocó nada la
// recarga, y si tiene texto sin guardar no pisa ninguna de las dos y avisa.
//
// Como en el canvas, el get y el update van SIN await en el medio: sqlite es
// sincrónico y el main es un hilo, así que un guardado del panel no se cuela.
async function runNotepadWrite(run, { action, id, content, edits, replace_all: replaceAll, folder } = {}) {
  if (!notesLista()) return 'error: the notepad is unavailable';
  const act = String(action || '').trim();
  const avisar = (label) => {
    // la acción adelante: con un solo ícono para las seis, "Compras" no dice si
    // la nota nació, cambió o se fue a la papelera
    run.notify('tool:activity', { reqId: run.reqId, kind: 'notepad_write', label: `${act} · ${label}` });
    broadcast('notes:changed');
  };
  const dondeQuedo = (c) => (c.id ? ` in folder "${c.name}"${c.nueva ? ' (new folder)' : ''}` : ' (no folder)');

  try {
    if (act === 'create') {
      const body = unwrapOuterFence(String(content || '')).trim();
      if (!body) return 'error: content is required to create a note';
      const c = carpetaDeNota(folder);
      const n = notesStore.create({ content: body, folderId: c.id });
      if (!n) return 'error: the note could not be created';
      avisar(noteHeadline(n.content));
      return `Note "${noteHeadline(n.content)}" created${dondeQuedo(c)} (id: ${n.id}). The user sees it in the Notepad panel; do not paste it back into your reply.`;
    }

    if (act === 'restore') {
      if (!id) return 'error: id is required to restore a note';
      const n = notesStore.restore(id);
      if (!n) return `error: no deleted note with id ${id} (the trash keeps them ${notesStore.TRASH_DIAS} days)`;
      avisar(noteHeadline(n.content));
      return `Note "${noteHeadline(n.content)}" restored to the notepad.`;
    }

    if (!id) return `error: id is required to ${act || 'change'} a note — call notepad first to see the ids`;
    const existing = notesStore.get(id);
    if (!existing && ['edit', 'update', 'move', 'delete'].includes(act)) return `error: note not found: ${id}`;

    if (act === 'edit') {
      const list = normalizeEdits(edits);
      if (!list.length) return 'error: edits is required to edit a note — pass at least one { old, new }';
      const r = applyEdits(existing.content, list, replaceAll === true);
      if (!r.ok) return `error: ${r.error.replace(/the file/g, 'the note')}`; // la nota queda intacta
      if (!r.text.trim()) return 'error: that would leave the note empty — use action "delete" to remove a note';
      notesStore.update(existing.id, r.text);
      const d = diffLines(existing.content, r.text, { context: 0, maxLines: 0 });
      avisar(noteHeadline(r.text));
      return `Note "${noteHeadline(r.text)}" edited — ${list.length} edit${list.length === 1 ? '' : 's'} applied, +${d.added} -${d.removed} lines.`;
    }

    if (act === 'update') {
      const body = unwrapOuterFence(String(content || '')).trim();
      if (!body) return 'error: content is required to update a note — to remove it use action "delete"';
      notesStore.update(existing.id, body);
      avisar(noteHeadline(body));
      return `Note "${noteHeadline(body)}" rewritten.`;
    }

    if (act === 'move') {
      const c = carpetaDeNota(folder);
      notesStore.setFolder(existing.id, c.id);
      avisar(noteHeadline(existing.content));
      return `Note "${noteHeadline(existing.content)}" moved${dondeQuedo(c)}.`;
    }

    if (act === 'delete') {
      const n = notesStore.trash(existing.id);
      if (!n) return `error: note not found: ${id}`;
      const titulo = noteHeadline(n.content);
      avisar(titulo);
      // el aviso con Restore, igual que el canvas y las tareas: en modo auto
      // nadie aprobó este borrado
      broadcast('notes:deleted', { id: n.id, title: titulo });
      return `Note "${titulo}" deleted. It stays in the trash for ${notesStore.TRASH_DIAS} days: the user can restore it from the app, and you can with action "restore" and id ${n.id}.`;
    }
  } catch (err) {
    return `error: the notepad could not be written: ${err?.message || err}`;
  }

  return `error: unknown action: ${act || '(none)'} — use create, edit, update, move, delete or restore`;
}

// ---- IPC de la isla Notepad ----
// Todo va envuelto en try: si notes.db no abrió (disco lleno, permisos, la base
// tomada por otra instancia), la isla tiene que quedar vacía y no explotar — el
// resto de la app no depende de esto para nada.
// [BlackCode] Los handlers son de la app. Acá queda, como función, el cuerpo de cada
// uno: recibe lo que mandaba el renderer, sin el evento. Qué canal era cada una:
//
//   list           notes:list
//   create         notes:create         { content, folderId }
//   update         notes:update         { id, content }
//   remove         notes:delete         id — el borrado del USUARIO, permanente
//                                       (la papelera es solo para lo que borra
//                                       el modelo)
//   pin            notes:pin            { id, pinned }
//   setFolder      notes:set-folder     { id, folderId }
//   restore        notes:restore        id — saca de la papelera lo que borró
//                                       el modelo, y avisa 'notes:changed'
//   clear          notes:clear
//   foldersList    note-folders:list
//   foldersCreate  note-folders:create  name
//   foldersRename  note-folders:rename  { id, name }
//   foldersDelete  note-folders:delete  id — [BlackCode] con sus notas adentro
const ipc = {
  list: () => { try { return notesStore.list(); } catch { return []; } },
  create: ({ content, folderId } = {}) => {
    try { return notesStore.create({ content, folderId }); } catch { return null; }
  },
  update: ({ id, content } = {}) => {
    try { return notesStore.update(id, content); } catch { return false; }
  },
  remove: (id) => { try { return notesStore.remove(id); } catch { return false; } },
  pin: ({ id, pinned } = {}) => {
    try { return notesStore.setPinned(id, pinned); } catch { return false; }
  },
  setFolder: ({ id, folderId } = {}) => {
    try { return notesStore.setFolder(id, folderId); } catch { return false; }
  },
  // el Restore del aviso cuando el modelo borró una nota (notepad_write "delete")
  restore: (id) => {
    try { const n = notesStore.restore(id); if (n) broadcast('notes:changed'); return n; } catch { return null; }
  },
  clear: () => { try { return notesStore.clear(); } catch { return false; } },
  foldersList: () => { try { return notesStore.listFolders(); } catch { return []; } },
  foldersCreate: (name) => {
    try { return notesStore.createFolder(name); } catch { return null; }
  },
  foldersRename: ({ id, name } = {}) => {
    try { return notesStore.renameFolder(id, name); } catch { return false; }
  },
  // [BlackCode] la carpeta se va CON sus notas (27/11/2026, pedido de Fran):
  // el usuario ya lo confirmó en la vista, y es para siempre
  foldersDelete: (id) => {
    try { return notesStore.deleteFolder(id, { conNotas: true }); } catch { return false; }
  },
};

/** ¿La base de las notas está disponible? Lo que allá era `notesReady`: con
 *  esto se decide si `notepad` y `notepad_write` se le ofrecen al modelo. Como
 *  todo lo demás, el primero que pregunta la abre. */
function lista() {
  return notesLista();
}

const runners = {
  notepad: (run, a) => runNotepad(run, a),
  notepad_write: (run, a) => runNotepadWrite(run, a),
};

module.exports = {
  runners, configurar, cerrar,
  /** El store, para quien necesite más que `ipc`: se abre solo en el primer uso. */
  store: notesStore,
  ipc, lista,
  noteHeadline, carpetaDeNota,
};
