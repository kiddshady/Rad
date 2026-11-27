'use strict';

// El store del canvas de BlackCode: los documentos y archivos de código que el
// modelo escribe con la tool `canvas` y que se abren en un panel al lado del
// chat. Guarda en una base SQLite propia (canvas.db) y no sabe nada de la tool
// ni de la interfaz: eso está en canvas.cjs.
//
// Portado de NeonCode 1.11.3 (canvas-store.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquella app que acá no están o se llaman distinto (main.js,
// whenReady, agent.db, docs.db, Umbra). Se dejan como estaban. Donde dicen
// «main.js», acá es canvas.cjs.
//
// Lo que se adaptó, y nada más:
//   - EL DRIVER. Allá era better-sqlite3, un módulo nativo que hay que
//     recompilar para cada versión de Electron. Acá es la clase Database de
//     sqlite.cjs, el adaptador que da esa misma API (prepare, all, get, run,
//     exec, pragma, close) sobre node:sqlite. Lo que el adaptador iguala y lo
//     que no pudo igualar está en su cabecera. Se sigue cargando recién en
//     init(), como allá.
//   - close() es nuevo: allá canvas.db quedaba abierta hasta que moría el
//     proceso y nadie la cerraba. Hace falta para cambiar de base y para soltar
//     el archivo al salir. El init() siguiente la vuelve a abrir.
//   - `require('crypto')` es `require('node:crypto')`.
//
// La cabecera del original, tal cual:
//
// NeonCode — canvas: documentos y archivos de código que el modelo escribe y se
// abren en un panel al lado del chat (port de Umbra core/canvas-store.js).
//
// La idea de fondo, que es lo que hace que valga la pena: el CUERPO NO VIVE EN EL
// MENSAJE. La tool le devuelve al modelo apenas un acuse ("creado, id tal"), así
// no repite el documento entero en la respuesta ni se lo come el historial en cada
// turno. La contracara es que el modelo tampoco tiene copia de lo que escribió,
// y por eso la tool necesita sí o sí las acciones "read" y "list" (ver main.js).
//
// Divergencias deliberadas respecto de Umbra:
//   - SIN columna `owner`: allá servía para la memoria de dos vías entre agentes.
//     NeonCode es un solo agente, así que el scope que queda es la conversación.
//   - Base PROPIA (`canvas.db`), no `agent.db`: ahí el modelo hace DDL libre con
//     db_query y un DROP TABLE suyo se llevaría puesto todo lo que escribió acá.
//     Mismo criterio que docs.db para el RAG.
//   - `listAll` no joinea el título del chat: en Umbra las conversaciones viven en
//     la misma sqlite, acá son JSON sueltos. Ese dato lo pega main.js.

const crypto = require('node:crypto');

const newId = () => crypto.randomUUID();

const COLS = 'id, conversation_id, agent_id, title, kind, language, content, version, created_at, updated_at';
const LIST_COLS = 'id, conversation_id, agent_id, title, kind, language, version, created_at, updated_at';

let db = null;

// Abre canvas.db y crea el schema. Idempotente: main la llama en whenReady.
function init(dbPath) {
  if (db) return db;
  const { Database } = require('./sqlite.cjs'); // [BlackCode] el adaptador sobre node:sqlite, no better-sqlite3
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT,                     -- chat donde nació; NULL = huérfano
      title           TEXT NOT NULL DEFAULT 'Untitled',
      kind            TEXT DEFAULT 'document',  -- 'document' (markdown) | 'code'
      language        TEXT,                     -- lenguaje cuando kind='code'
      content         TEXT NOT NULL DEFAULT '',
      version         INTEGER DEFAULT 1,        -- sube en cada reescritura, del modelo o del usuario
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_conv ON canvases(conversation_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_canvas_updated ON canvases(updated_at);
  `);
  // La papelera (ver `trash`). Columna agregada a una tabla que ya existía en las
  // bases de los usuarios, así que va por ALTER y no en el CREATE: el CREATE de
  // arriba no corre sobre una tabla que ya está.
  const cols = db.prepare('PRAGMA table_info(canvases)').all().map((c) => c.name);
  if (!cols.includes('deleted_at')) db.exec('ALTER TABLE canvases ADD COLUMN deleted_at TEXT');
  // [BlackCode 1.8.2] De qué agente es: lo guarda la tool al crearlo y queda
  // aunque se borre su chat (ver orphanConversation). Los de antes nacieron sin
  // él: el dueño de esos sale de su chat, y uno huérfano sin dueño es de todos
  // (ver esSuyo en canvas.cjs).
  if (!cols.includes('agent_id')) db.exec('ALTER TABLE canvases ADD COLUMN agent_id TEXT');
  purgeTrash();
  return db;
}

// Lo que está en la papelera no existe para nadie salvo `restore`: ni la tool, ni
// el panel, ni la biblioteca.
const VIVO = 'deleted_at IS NULL';
const TRASH_DIAS = 7;

const ready = () => {
  if (!db) throw new Error('canvas store not initialized');
  return db;
};

function create({ conversationId = null, agentId = null, title = 'Untitled', kind = 'document', language = null, content = '' } = {}) {
  const id = newId();
  const safeTitle = String(title || 'Untitled').trim() || 'Untitled';
  const safeKind = kind === 'code' ? 'code' : 'document';
  ready().prepare(
    `INSERT INTO canvases (id, conversation_id, agent_id, title, kind, language, content, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, conversationId || null, agentId || null, safeTitle, safeKind, language || null, String(content || ''));
  return get(id);
}

/** El canvas entero, con contenido. Uno en la papelera no aparece. */
function get(id) {
  if (!id) return null;
  return ready().prepare(`SELECT ${COLS} FROM canvases WHERE id = ? AND ${VIVO}`).get(String(id)) || null;
}

/** Reescribe el contenido (y opcionalmente título/lenguaje), subiendo la versión.
 *  `update` REEMPLAZA todo el cuerpo. Acá decía que el parche parcial no existía
 *  a propósito, porque "un modelo que edita solo un pedazo termina inventando el
 *  resto" — y eso valía para un parche que la app tuviera que INTERPRETAR. Con
 *  reemplazo exacto no hay nada que interpretar: el fragmento está tal cual o la
 *  llamada falla entera. Lo que sí se inventaba era el resto del documento cuando
 *  el modelo tenía que reescribirlo completo para cambiar un párrafo.
 *  El parche vive en la tool (`canvas` action "edit", main.js) y no acá: el store
 *  sigue recibiendo el cuerpo ya resuelto, que es lo único que sabe guardar. */
function update(id, { content, title, language } = {}) {
  const existing = get(id);
  if (!existing) return null;
  const newTitle = (title && String(title).trim()) || existing.title;
  const newLang = language !== undefined && language !== null ? language : existing.language;
  const newContent = content !== undefined ? String(content) : existing.content;
  ready().prepare(
    `UPDATE canvases SET content = ?, title = ?, language = ?, version = version + 1, updated_at = datetime('now')
     WHERE id = ? AND ${VIVO}`
  ).run(newContent, newTitle, newLang, String(id));
  return get(id);
}

/** Lista liviana (sin contenido) de los canvas de una conversación, el más fresco primero. */
function listByConversation(conversationId, limit = 50) {
  if (!conversationId) return [];
  return ready().prepare(
    `SELECT ${LIST_COLS} FROM canvases WHERE conversation_id = ? AND ${VIVO} ORDER BY updated_at DESC LIMIT ?`
  ).all(String(conversationId), limit);
}

/** Lista liviana de TODOS los canvas (la biblioteca global). Sin contenido. */
function listAll(limit = 300) {
  return ready().prepare(
    `SELECT ${LIST_COLS} FROM canvases WHERE ${VIVO} ORDER BY updated_at DESC LIMIT ?`
  ).all(limit);
}

/** Borra un canvas. Con conversationId acota el borrado a ese chat (defensa en
 *  profundidad: un id traspapelado no puede borrar en otra conversación). */
function remove(id, conversationId) {
  if (!id) return false;
  const r = conversationId
    ? ready().prepare('DELETE FROM canvases WHERE id = ? AND conversation_id = ?').run(String(id), String(conversationId))
    : ready().prepare('DELETE FROM canvases WHERE id = ?').run(String(id));
  return r.changes > 0;
}

/**
 * El borrado del MODELO: a la papelera, no a la nada.
 *
 * `remove` es el del usuario, que borra con doble click mirando el canvas. El
 * modelo borra con una tool call, y en modo auto nadie la aprueba: un pedido mal
 * entendido ("borrá el viejo") se llevaba el documento equivocado sin vuelta. Por
 * eso acá solo se marca, y la app ofrece restaurarlo. Vive `TRASH_DIAS` y después
 * lo purga `init`.
 *
 * Mismo acotamiento por conversación que `remove`. Devuelve el canvas tal como
 * estaba (con contenido), o null si no había uno vivo con ese id.
 */
function trash(id, conversationId) {
  const c = get(id);
  if (!c || (conversationId && c.conversation_id !== String(conversationId))) return null;
  ready().prepare("UPDATE canvases SET deleted_at = datetime('now') WHERE id = ?").run(String(id));
  return c;
}

/** Saca un canvas de la papelera. Devuelve el canvas vivo, o null si ya no estaba. */
function restore(id) {
  if (!id) return null;
  const r = ready().prepare(`UPDATE canvases SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(String(id));
  return r.changes > 0 ? get(id) : null;
}

/** Lo que está en la papelera, el último borrado primero. Liviano, como listAll,
 *  más `deleted_at`: la biblioteca lo muestra para restaurarlo pasado el aviso. */
function listTrash(limit = 100) {
  return ready().prepare(
    `SELECT ${LIST_COLS}, deleted_at FROM canvases WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`
  ).all(limit);
}

/** Borra de verdad lo que lleva más de `TRASH_DIAS` en la papelera. */
function purgeTrash(dias = TRASH_DIAS) {
  return ready().prepare(
    "DELETE FROM canvases WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)"
  ).run(`-${Number(dias) || TRASH_DIAS} days`).changes;
}

/** Al borrar un chat sus canvas NO se borran: quedan huérfanos (conversation_id
 *  NULL) y siguen alcanzables desde la biblioteca. Es a propósito — un canvas es
 *  un documento que el usuario puede querer conservar, y borrar un chat no pasa
 *  por la papelera (esa es solo para lo que borra el modelo, ver `trash`). */
// [BlackCode 1.8.2] `agentId`: el agente del chat que se borra. Queda anotado
// en los canvas que no lo tenían (los de antes), así siguen siendo de él: Fran
// eligió que un canvas de un chat borrado siga siendo de su agente.
function orphanConversation(conversationId, agentId = null) {
  if (!conversationId) return 0;
  return ready().prepare(
    'UPDATE canvases SET agent_id = COALESCE(agent_id, ?), conversation_id = NULL WHERE conversation_id = ?'
  ).run(agentId || null, String(conversationId)).changes;
}

// [BlackCode 1.18.1] Se borró un agente: sus canvas se van con él, de verdad
// (sin papelera: ya no queda nadie que los pueda ver ni restaurar). Son suyos
// los que anotó al nacer (`agent_id`) y los de antes de la 1.8.2, que no lo
// anotaban, si su chat es de él (`conversationIds`, sus chats). Los de la
// papelera también. Uno huérfano viejo, sin agente ni chat, no es de nadie
// conocido y se queda. Devuelve cuántos se borraron.
function removeByAgent(agentId, conversationIds = []) {
  if (!agentId) return 0;
  const chats = (Array.isArray(conversationIds) ? conversationIds : []).filter(Boolean).map(String);
  const enSusChats = chats.length ? ` OR (agent_id IS NULL AND conversation_id IN (${chats.map(() => '?').join(', ')}))` : '';
  return ready().prepare(`DELETE FROM canvases WHERE agent_id = ?${enSusChats}`).run(String(agentId), ...chats).changes;
}

// [BlackCode] Cierra la base: al salir de la app, o antes de abrir otra ruta. Allá no
// existía (canvas.db quedaba abierta hasta que moría el proceso). No tira si
// ya estaba cerrada, y el init() siguiente la vuelve a abrir.
function close() {
  if (!db) return;
  const abierta = db;
  db = null;
  try { abierta.close(); } catch { /* nada que hacer si ya se cerró */ }
}

module.exports = {
  init, close, create, get, update, listByConversation, listAll,
  remove, trash, restore, listTrash, purgeTrash, orphanConversation, removeByAgent,
  TRASH_DIAS,
};
