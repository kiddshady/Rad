'use strict';

// El store del notepad de BlackCode: las notas del usuario, con sus carpetas, que
// el modelo lee con la tool `notepad` y escribe con `notepad_write`. Guarda en
// una base SQLite propia (notes.db) y no sabe nada de las tools ni de la
// interfaz: eso está en notas.cjs.
//
// Portado de NeonCode 1.11.3 (notes-store.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquella app que acá no están o se llaman distinto (main,
// whenReady, agent.db, docs.db, canvas-store.js, Umbra, el panel, la API
// móvil). Se dejan como estaban. Donde dicen «main», acá es notas.cjs.
//
// Lo que se adaptó, y nada más:
//   - EL DRIVER. Allá era better-sqlite3, un módulo nativo que hay que
//     recompilar para cada versión de Electron. Acá es la clase Database de
//     sqlite.cjs, el adaptador que da esa misma API (prepare, all, get, run,
//     exec, pragma, transaction, close) sobre node:sqlite. Lo que el adaptador
//     iguala y lo que no pudo igualar está en su cabecera. Se sigue cargando
//     recién en init(), como allá.
//   - close() es nuevo: allá notes.db quedaba abierta hasta que moría el
//     proceso y nadie la cerraba. Hace falta para cambiar de base y para soltar
//     el archivo al salir. El init() siguiente la vuelve a abrir.
//   - `require('crypto')` es `require('node:crypto')`.
//
// La cabecera del original, tal cual:
//
// NeonCode — notepad: las notas del usuario, con carpetas (port de Umbra
// core/notepad-store.js).
//
// Divergencias deliberadas respecto de Umbra, todas por la misma razón: acá el
// notepad es del USUARIO, no un scratchpad compartido con el agente.
//   - SIN columna `owner`: allá separaba las notas por agente (memoria de dos
//     vías). NeonCode es un solo agente, mismo criterio que canvas-store.js.
//   - SIN columna `source`: en Umbra distinguía 'agent' de 'user'. Acá el modelo
//     escribe desde la 1.9.0 (notepad_write), pero SOLO cuando el usuario se lo
//     pide, así que lo que escribe es del usuario igual: la libreta no separa.
//   - SIN la carpeta "Mobile": era el buzón de Umbra Mobile (una carpeta
//     sintética, sin fila en la tabla, que el companion leía). No hay companion.
//   - Base PROPIA (`notes.db`), no `agent.db`: ahí el modelo hace DDL libre con
//     db_query y un DROP TABLE suyo se llevaría puesto lo que escribiste. Mismo
//     criterio que docs.db para el RAG y canvas.db para el canvas.
//
// La nota NO tiene columna `title`: el título es la primera línea del cuerpo, y
// el resumen de la tarjeta son las que siguen. Es lo que hace que escribir sea
// escribir y nada más — no hay un campo aparte que llenar ni que mantener en
// sincronía con el texto.

const crypto = require('node:crypto');

const newId = () => crypto.randomUUID();

const COLS = 'id, content, pinned, folder_id, created_at, updated_at';

let db = null;

// Abre notes.db y crea el schema. Idempotente: main la llama en whenReady.
function init(dbPath) {
  if (db) return db;
  const { Database } = require('./sqlite.cjs'); // [BlackCode] el adaptador sobre node:sqlite, no better-sqlite3
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT 'New folder',
      position   INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL DEFAULT '',
      pinned     INTEGER DEFAULT 0,
      folder_id  TEXT,                    -- → note_folders.id; NULL = suelta
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
    -- La papelera de lo que borra el MODELO (notepad_write, action "delete").
    -- Tabla aparte y no una columna deleted_at en notes: así ninguna consulta
    -- de las que ya existen (list, count, el panel, la API móvil) tiene que
    -- aprender a saltearse las borradas, y una que se olvide no las resucita.
    CREATE TABLE IF NOT EXISTS notes_trash (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL DEFAULT '',
      pinned     INTEGER DEFAULT 0,
      folder_id  TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT DEFAULT (datetime('now'))
    );
  `);
  purgeTrash();
  return db;
}

// Cuántos días se guarda una nota que borró el modelo. Los mismos que el canvas:
// en modo auto nadie aprueba el borrado, y una nota no se reescribe con una frase.
const TRASH_DIAS = 7;

const ready = () => {
  if (!db) throw new Error('notes store not initialized');
  return db;
};

/** Todas las notas, cronológicas y con las fijadas arriba. Con `folderId` acota a
 *  una carpeta: null devuelve solo las sueltas, undefined (omitirlo) devuelve
 *  todo — el panel lee así y agrupa por carpeta del lado del renderer.
 *
 *  El tope tiene que quedarse con las NUEVAS. Aplicado a un orden ascendente se
 *  quedaba con las VIEJAS, así que pasadas `limit` notas todo lo escrito después
 *  desaparecía del panel (bug real de Umbra, corregido allá y portado acá). Se
 *  toman las últimas N por recencia y recién ahí se reordena ascendente, para
 *  que quien llame siga leyéndolas en orden. */
function list(limit = 500, folderId = undefined) {
  const args = [];
  let where = '1=1';
  if (folderId !== undefined) {
    if (folderId === null) where = 'folder_id IS NULL';
    else { where = 'folder_id = ?'; args.push(folderId); }
  }
  args.push(limit);
  return ready().prepare(
    `SELECT ${COLS} FROM (
       SELECT ${COLS}, rowid AS _rid FROM notes WHERE ${where}
        ORDER BY pinned DESC, created_at DESC, _rid DESC LIMIT ?
     ) ORDER BY pinned DESC, created_at ASC, _rid ASC`
  ).all(...args);
}

function get(id) {
  if (!id) return null;
  return ready().prepare(`SELECT ${COLS} FROM notes WHERE id = ?`).get(String(id)) || null;
}

/** Crea una nota. Devuelve null con el cuerpo vacío: una nota sin texto no es
 *  nada que el usuario pueda encontrar después, y el panel guarda solo. */
function create({ content, folderId = null } = {}) {
  const body = String(content || '').trim();
  if (!body) return null;
  const id = newId();
  ready().prepare('INSERT INTO notes (id, content, folder_id) VALUES (?, ?, ?)')
    .run(id, body, folderId || null);
  return get(id);
}

/** Reescribe el cuerpo. Vacío NO borra la nota: para eso está la papelera del
 *  panel. Borrar el texto y salir tiene que poder deshacerse volviendo a escribir. */
function update(id, content) {
  const body = String(content || '').trim();
  if (!id || !body) return false;
  ready().prepare("UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?")
    .run(body, String(id));
  return true;
}

function remove(id) {
  if (!id) return false;
  return ready().prepare('DELETE FROM notes WHERE id = ?').run(String(id)).changes > 0;
}

/** Manda una nota a la papelera: la fila se MUDA a notes_trash en una
 *  transacción (nunca queda en las dos ni en ninguna). Devuelve la nota como
 *  estaba, o null si no existe. Es el borrado del modelo; el del panel sigue
 *  siendo `remove`, que el usuario confirma. */
function trash(id) {
  if (!id) return null;
  const d = ready();
  const n = get(id);
  if (!n) return null;
  d.transaction(() => {
    d.prepare(`INSERT OR REPLACE INTO notes_trash (${COLS}) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(n.id, n.content, n.pinned, n.folder_id, n.created_at, n.updated_at);
    d.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
  })();
  return n;
}

/** La saca de la papelera con su id, sus fechas y su pin. Si su carpeta ya no
 *  existe vuelve suelta: apuntar a una carpeta borrada la escondería del panel. */
function restore(id) {
  if (!id) return null;
  const d = ready();
  const n = d.prepare(`SELECT ${COLS} FROM notes_trash WHERE id = ?`).get(String(id));
  if (!n) return null;
  const carpeta = n.folder_id
    && d.prepare('SELECT 1 FROM note_folders WHERE id = ?').get(n.folder_id) ? n.folder_id : null;
  d.transaction(() => {
    d.prepare(`INSERT OR REPLACE INTO notes (${COLS}) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(n.id, n.content, n.pinned, carpeta, n.created_at, n.updated_at);
    d.prepare('DELETE FROM notes_trash WHERE id = ?').run(n.id);
  })();
  return get(n.id);
}

/** Lo que lleva más de TRASH_DIAS en la papelera se va de verdad. Corre al abrir. */
function purgeTrash(dias = TRASH_DIAS) {
  const d = Number.isFinite(Number(dias)) ? Number(dias) : TRASH_DIAS;
  ready().prepare("DELETE FROM notes_trash WHERE deleted_at < datetime('now', ?)").run(`${-d} days`);
}

function setPinned(id, pinned) {
  if (!id) return false;
  ready().prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, String(id));
  return true;
}

/** Archiva una nota en una carpeta (o null para sacarla). NO toca updated_at:
 *  mover una nota no debería reordenar su recencia — moverla no es editarla. */
function setFolder(id, folderId) {
  if (!id) return false;
  ready().prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(folderId || null, String(id));
  return true;
}

/** Vacía el notepad entero. Las carpetas quedan: borrar las notas no es borrar
 *  la organización que el usuario armó para ellas. */
function clear() {
  ready().prepare('DELETE FROM notes').run();
  return true;
}

function count() {
  return ready().prepare('SELECT COUNT(*) AS n FROM notes').get().n;
}

// --- carpetas ----------------------------------------------------------------
function listFolders() {
  return ready().prepare(
    'SELECT id, name, position, created_at FROM note_folders ORDER BY position ASC, created_at ASC'
  ).all();
}

function createFolder(name = 'New folder') {
  const id = newId();
  const safe = String(name || '').trim() || 'New folder';
  const pos = (ready().prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM note_folders').get() || {}).p || 0;
  ready().prepare('INSERT INTO note_folders (id, name, position) VALUES (?, ?, ?)').run(id, safe, pos);
  return ready().prepare('SELECT id, name, position FROM note_folders WHERE id = ?').get(id);
}

function renameFolder(id, name) {
  if (!id) return false;
  const safe = String(name || '').trim() || 'Folder';
  ready().prepare("UPDATE note_folders SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(safe, String(id));
  return true;
}

/** Borra una carpeta; sus notas quedan SUELTAS (folder_id → NULL), no se
 *  destruyen. En una transacción para que un fallo no deje notas apuntando a una
 *  carpeta que ya no existe. */
// [BlackCode] `conNotas`: las notas de adentro se borran con la carpeta, para
// siempre como el borrado del usuario (sin papelera). Es lo que hace la vista
// Notes desde el 27/11/2026, pedido de Fran; sin la opción sigue como allá.
function deleteFolder(id, { conNotas = false } = {}) {
  if (!id) return false;
  const d = ready();
  d.transaction(() => {
    if (conNotas) d.prepare('DELETE FROM notes WHERE folder_id = ?').run(String(id));
    else d.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(String(id));
    d.prepare('DELETE FROM note_folders WHERE id = ?').run(String(id));
  })();
  return true;
}

// [BlackCode] Cierra la base: al salir de la app, o antes de abrir otra ruta. Allá no
// existía (notes.db quedaba abierta hasta que moría el proceso). No tira si
// ya estaba cerrada, y el init() siguiente la vuelve a abrir.
function close() {
  if (!db) return;
  const abierta = db;
  db = null;
  try { abierta.close(); } catch { /* nada que hacer si ya se cerró */ }
}

module.exports = {
  init, close, list, get, create, update, remove, setPinned, setFolder, clear, count,
  listFolders, createFolder, renameFolder, deleteFolder,
  trash, restore, purgeTrash, TRASH_DIAS,
};
