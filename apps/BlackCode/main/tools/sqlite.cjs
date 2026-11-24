'use strict';

// Las tools de SQLite de BlackCode: db_query, la base PROPIA del agente, y
// sqlite_query, SQL contra un archivo de base que ya existe en el disco.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están (DANGER_TOOLS, el sandbox de
// las corridas desatendidas, el gate interactivo, dataDir). Se dejan como
// estaban.
//
// Lo que se adaptó, y nada más:
//   - EL DRIVER. NeonCode usaba better-sqlite3, un módulo nativo que hay que
//     recompilar para cada versión de Electron. Acá es node:sqlite
//     (DatabaseSync), que viene con Node. Los runners no se enteran: siguen
//     llamando a `new Database(…)`, `prepare`, `stmt.reader`, `all`, `run`,
//     `exec`, `pragma` y `close`, y la clase Database de más abajo les da eso
//     mismo sobre node:sqlite, con los mismos errores para lo que ellos miran.
//     Lo que el adaptador iguala y lo que no pudo igualar está en su cabecera.
//   - `require('better-sqlite3')` se cargaba recién al usar la tool; el
//     `require('node:sqlite')` también (en el constructor de Database), así un
//     Node que no lo traiga da un «error: …» en la tool y no rompe el arranque.
//   - La base del agente estaba en `path.join(dataDir, 'agent.db')`, con
//     `dataDir` global del archivo grande. Acá la ruta la da
//     configurar({ dbPath }), una función que devuelve la ruta absoluta. Sin
//     configurar queda en la carpeta temporal del sistema, que alcanza para un
//     test y para nada más: la app TIENE que pasar la suya.
//   - cerrar() es nuevo: allá la base del agente quedaba abierta hasta que
//     moría el proceso y nadie la cerraba. La llamada siguiente la reabre.
//   - `resolverEn` sale de base.cjs en vez de ser vecino del mismo archivo.
//   - Los dos nombres de TOOL_RUNNERS (db_query y sqlite_query) son `runners`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolverEn } = require('./base.cjs');

let rutaAgentDb = () => path.join(os.tmpdir(), 'blackcode-agent.db');

/** Lo que este módulo necesita de afuera: `dbPath()`, que devuelve la ruta
 *  absoluta de la base del agente (su carpeta tiene que existir). Cambiarla
 *  cierra la que estuviera abierta: si no, db_query seguiría escribiendo en el
 *  archivo anterior. */
function configurar(deps = {}) {
  if (typeof deps.dbPath === 'function') {
    cerrar();
    rutaAgentDb = deps.dbPath;
  }
}

// ---------------------------------------------------------------------------
// El adaptador: lo que los runners usaban de better-sqlite3, sobre node:sqlite.
// Cada diferencia de abajo se midió con los dos drivers lado a lado
// (better-sqlite3 12.11.1 contra node:sqlite en Node 22.22 y en el Node 24.22
// de Electron 44), no se escribió de memoria.
//
// Lo que iguala:
//  - Varias sentencias. better-sqlite3 se niega a preparar un texto con más de
//    una («The supplied SQL string contains more than one statement») y de ese
//    mensaje dependen los dos runners para pasar a exec(). node:sqlite prepara
//    la PRIMERA y descarta el resto sin avisar: sin esto, un script de tres
//    CREATE crearía una tabla y contestaría que salió todo bien. `sourceSQL`
//    devuelve el texto de la sentencia que SQLite compiló, así que lo que sobra
//    es la cola, y la cola se mira con la misma regla que allá: espacios,
//    `;` y comentarios no cuentan como otra sentencia.
//  - Ninguna sentencia (un comentario solo, un `;`): el mismo RangeError de
//    allá. Node 24 tira otro mensaje y Node 22 devuelve una sentencia muerta.
//  - `stmt.reader`: allá es «tiene al menos una columna», acá lo mismo con
//    columns().
//  - `run().changes`. Allá es 0 si la sentencia no cambió ninguna fila;
//    node:sqlite devuelve sqlite3_changes() a secas, que después de un CREATE
//    TABLE sigue siendo el número del INSERT anterior («OK — 3 changes» de un
//    CREATE). Se compara total_changes() antes y después, que es como lo
//    resuelve better-sqlite3.
//  - Enteros. Allá todo INTEGER vuelve como Number, aunque pierda precisión
//    pasado 2^53; node:sqlite TIRA con uno así. Se leen como BigInt y se pasan
//    a Number, que da el mismo redondeo.
//  - BLOB. Allá es un Buffer, que en JSON sale {"type":"Buffer","data":[…]};
//    acá un Uint8Array, que saldría {"0":1,"1":2}. Se envuelve en Buffer.
//  - Parámetros. Los mismos tipos que allá (número, string, bigint, buffer,
//    null; undefined es null; un array se desarma en sus valores; un objeto son
//    parámetros con nombre) con el mismo TypeError para el resto: Node 24 liga
//    un booleano como 1 y Node 22 lo rechaza con otro texto. Y los mismos
//    errores cuando sobran o faltan valores o falta un nombre: node:sqlite liga
//    NULL en los que faltan y sigue, o sea que un INSERT con dos `?` y un solo
//    valor guardaría un NULL sin decir nada.
//  - La apertura: `fileMustExist` (node:sqlite crea el archivo si no está),
//    el error por carpeta inexistente, los 5 s de busy_timeout por defecto, el
//    modo defensivo y que cerrar dos veces no tire.
//  - `stmt.get()`: la primera fila, o undefined si no hay ninguna, con los
//    mismos enteros y BLOB que all(). Los runners de este archivo no lo usan:
//    lo usa el store del canvas (canvas-store.cjs), que abre su base con esta
//    misma clase Database.
//  - `db.transaction(fn)`: devuelve una función que corre `fn` entre un BEGIN
//    y un COMMIT, le pasa sus argumentos y devuelve lo que `fn` devuelva; si
//    `fn` tira, hace ROLLBACK y vuelve a tirar el mismo error. Llamada con una
//    transacción ya abierta usa un SAVEPOINT, así la de adentro se deshace sola
//    sin llevarse la de afuera. Una `fn` que devuelve una promesa es un
//    TypeError, como allá: la transacción se cerraría antes de que termine.
//    Tampoco la usan los runners de este archivo: la usa el store de las notas
//    (notes-store.cjs), para mudar una nota a la papelera y de vuelta.
//
// Lo que NO iguala:
//  - Las variantes `.deferred`, `.immediate` y `.exclusive` de la función que
//    devuelve transaction(): acá el BEGIN es siempre el común (diferido), que
//    es también el que usaba allá la función llamada a secas.
//  - Es otro SQLite, compilado distinto. El de better-sqlite3 traía
//    UPDATE/DELETE … LIMIT, soundex() y STAT4, y un LIKE que no matchea BLOBs;
//    el de Node no. FTS5, JSON, RTREE, funciones matemáticas y de ventana están
//    en los dos. El texto de un error de SQL lo escribe SQLite y puede variar
//    con la versión.
//  - `synchronous` en una base WAL: allá NORMAL, acá FULL (más lento al
//    escribir, más seguro). El caché por defecto es de 2 MB y no de 16.
//  - El modo defensivo (no deja tocar sqlite_master ni las tablas sombra) lo
//    prendía better-sqlite3 12 y acá se pide al abrir, pero el Node 22 con el
//    que corren los tests no conoce la opción y la ignora. En el Node 24 de
//    Electron queda prendido, como allá.
//  - Los parámetros numerados (`?1`, `?2`). Allá contaban como parámetros con
//    nombre y pasarles valores sueltos daba «Too many parameter values were
//    provided»; acá los valores sueltos los ligan por posición.
//  - Los valores que faltan no se detectan si la sentencia es un EXPLAIN con
//    un comentario adelante. Y cuando una llamada tiene dos errores de
//    parámetros a la vez puede salir el otro de los dos mensajes.
//  - `fileMustExist` es una comprobación y después la apertura, no una sola
//    operación: si el archivo desaparece justo en el medio, se crea vacío.
// ---------------------------------------------------------------------------

const SQLITE_RANGE = 25; // un índice de parámetro fuera de rango, al ligar

/** ¿Queda otra sentencia en lo que sobró después de la primera? La misma regla
 *  de better-sqlite3: espacios, `;` y comentarios no son una sentencia. */
function hayMasSentencias(cola) {
  let i = 0;
  while (i < cola.length) {
    const c = cola[i];
    if (c === ' ' || c === ';' || (c >= '\t' && c <= '\r')) { i += 1; continue; }
    if (c === '/' && cola[i + 1] === '*') {
      const fin = cola.indexOf('*/', i + 2);
      if (fin === -1) return false;
      i = fin + 2;
    } else if (c === '-' && cola[i + 1] === '-') {
      const fin = cola.indexOf('\n', i + 2);
      if (fin === -1) return false;
      i = fin + 1;
    } else {
      return true;
    }
  }
  return false;
}

const NO_LIGABLE = 'SQLite3 can only bind numbers, strings, bigints, buffers, and null';

function valorLigable(v) {
  if (v == null) return null; // undefined también: better-sqlite3 lo liga como NULL
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || ArrayBuffer.isView(v)) return v;
  throw new TypeError(NO_LIGABLE);
}

/** Separa los argumentos de all()/run() como better-sqlite3: un array se
 *  desarma en sus valores, un objeto son parámetros con nombre (uno solo) y lo
 *  demás es un valor suelto. */
function separarParams(args) {
  const sueltos = [];
  let conNombre = null;
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a) sueltos.push(valorLigable(v));
    } else if (a !== null && typeof a === 'object' && !ArrayBuffer.isView(a)) {
      if (conNombre) throw new TypeError('You cannot specify named parameters in two different objects');
      conNombre = {};
      for (const [k, v] of Object.entries(a)) conNombre[k] = valorLigable(v);
    } else {
      sueltos.push(valorLigable(a));
    }
  }
  return { sueltos, conNombre };
}

/** El error de node:sqlite por ligar un índice que la sentencia no tiene, con
 *  el texto de better-sqlite3. Se tira al ligar, antes de ejecutar nada. */
function traducir(err) {
  if (err?.errcode === SQLITE_RANGE) return new RangeError('Too many parameter values were provided');
  return err;
}

/** Deja una fila como la devolvía better-sqlite3: los enteros como Number y
 *  los BLOB como Buffer. La cambia en el lugar y la devuelve. */
function comoAlla(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === 'bigint') row[k] = Number(v);
    else if (v instanceof Uint8Array) row[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  return row;
}

class Sentencia {
  constructor(base, stmt, fuente) {
    this.base = base;
    this.stmt = stmt;
    this.fuente = fuente;
  }

  get reader() { return this.stmt.columns().length >= 1; }

  /** Valida los argumentos como better-sqlite3 y los deja como los quiere
   *  node:sqlite. Todo lo que tira, lo tira ANTES de ejecutar la sentencia. */
  ligar(args) {
    const { sueltos, conNombre } = separarParams(args);
    const n = sueltos.length;
    // un parámetro siempre se escribe con uno de estos cuatro caracteres: sin
    // ninguno y sin valores no hay nada que comprobar
    if (!n && !conNombre && !/[?:@$]/.test(this.fuente)) return sueltos;

    const nombres = this.base.nombres(this.fuente);
    if (conNombre) {
      for (const nombre of nombres) {
        if (!Object.hasOwn(conNombre, nombre)) throw new RangeError(`Missing named parameter "${nombre}"`);
      }
    } else if (nombres.length) {
      // valores sueltos no ligan parámetros con nombre, ni allá ni acá
      if (this.base.caben(this.fuente, n) === false) throw new RangeError('Too many parameter values were provided');
      throw new TypeError('Missing named parameters');
    }
    if (this.base.caben(this.fuente, n + 1) === true) {
      throw new RangeError('Too few parameter values were provided');
    }
    if (!conNombre) return sueltos;
    // node:sqlite quiere el objeto primero, y tira por una clave que la
    // sentencia no usa; better-sqlite3 la ignoraba
    this.stmt.setAllowUnknownNamedParameters(true);
    return [conNombre, ...sueltos];
  }

  all(...args) {
    const p = this.ligar(args);
    this.stmt.setReadBigInts(true);
    let rows;
    try { rows = this.stmt.all(...p); } catch (err) { throw traducir(err); }
    for (const row of rows) comoAlla(row);
    return rows;
  }

  get(...args) {
    const p = this.ligar(args);
    this.stmt.setReadBigInts(true);
    let row;
    try { row = this.stmt.get(...p); } catch (err) { throw traducir(err); }
    return row === undefined ? undefined : comoAlla(row);
  }

  run(...args) {
    const p = this.ligar(args);
    const antes = this.base.totalChanges();
    let info;
    try { info = this.stmt.run(...p); } catch (err) { throw traducir(err); }
    return {
      changes: this.base.totalChanges() === antes ? 0 : info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  }
}

class Database {
  constructor(filename, { readonly = false, fileMustExist = false, timeout = 5000 } = {}) {
    const { DatabaseSync } = require('node:sqlite');
    if (!fs.existsSync(path.dirname(filename))) {
      throw new TypeError('Cannot open database because the directory does not exist');
    }
    // node:sqlite no tiene un «no la crees»: abierta para escribir, crea el
    // archivo que falte. Solo de lectura no crea nunca, eso lo frena SQLite.
    if (fileMustExist && !fs.existsSync(filename)) throw new Error('unable to open database file');
    this.db = new DatabaseSync(filename, { readOnly: !!readonly, timeout, defensive: true });
    this.cuenta = null;
  }

  prepare(sql) {
    const vacia = () => new RangeError('The supplied SQL string contains no statements');
    let stmt;
    try {
      stmt = this.db.prepare(sql);
    } catch (err) {
      if (err?.code === 'ERR_INVALID_ARG_VALUE') throw vacia(); // Node 24
      throw err;
    }
    let fuente;
    try { fuente = stmt.sourceSQL; } catch { throw vacia(); } // Node 22: preparó una sentencia muerta
    if (hayMasSentencias(sql.slice(fuente.length))) {
      throw new RangeError('The supplied SQL string contains more than one statement');
    }
    return new Sentencia(this, stmt, fuente);
  }

  exec(sql) { this.db.exec(sql); return this; }

  pragma(fuente) { this.db.exec(`PRAGMA ${fuente}`); }

  /** Como en better-sqlite3: no corre nada todavía, devuelve la función que
   *  corre `fn` adentro de una transacción. Todo o nada: si `fn` tira, lo que
   *  haya escrito se deshace y el error sigue viaje. */
  transaction(fn) {
    if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');
    const db = this.db;
    return function sqliteTransaction(...args) {
      // con una ya abierta no se puede otro BEGIN: un SAVEPOINT, que se deshace
      // solo sin tocar la de afuera
      const anidada = db.isTransaction;
      db.exec(anidada ? 'SAVEPOINT blackcode_tx' : 'BEGIN');
      try {
        const result = fn.apply(this, args);
        if (result && typeof result.then === 'function') {
          throw new TypeError('Transaction function cannot return a promise');
        }
        db.exec(anidada ? 'RELEASE blackcode_tx' : 'COMMIT');
        return result;
      } catch (err) {
        // SQLite ya pudo haberla deshecho por su cuenta (un error de los que
        // abortan la transacción entera): ahí no queda nada que deshacer
        if (db.isTransaction) {
          db.exec(anidada ? 'ROLLBACK TO blackcode_tx' : 'ROLLBACK');
          if (anidada) db.exec('RELEASE blackcode_tx');
        }
        throw err;
      }
    };
  }

  close() {
    if (this.db.isOpen) this.db.close();
    return this;
  }

  totalChanges() {
    if (!this.cuenta) this.cuenta = this.db.prepare('SELECT total_changes() AS n');
    return this.cuenta.get().n;
  }

  // node:sqlite no dice cuántos parámetros tiene una sentencia ni cómo se
  // llaman, y better-sqlite3 tiraba por las dos cosas. Lo que sí hace es tirar
  // al ligar un valor de más o un nombre que no existe, así que se le pregunta
  // a SQLite ligando de prueba. La prueba va sobre `EXPLAIN <sentencia>`, que
  // tiene los mismos parámetros y al ejecutarse solo lista su programa: la
  // sentencia de verdad no corre ni una vez de más.
  sonda(fuente) {
    // una que ya es un EXPLAIN es su propia sonda: no admite otro adelante, y
    // ejecutarla tampoco corre nada
    const sql = /^\s*EXPLAIN\b/i.test(fuente) ? fuente : `EXPLAIN ${fuente}`;
    try { return this.db.prepare(sql); } catch { return null; }
  }

  /** ¿La sentencia acepta `n` valores sueltos? true, false, o null si no se
   *  pudo averiguar. */
  caben(fuente, n) {
    const sonda = this.sonda(fuente);
    if (!sonda) return null;
    try {
      sonda.all(...new Array(n).fill(null));
      return true;
    } catch (err) {
      return err?.errcode === SQLITE_RANGE ? false : null;
    }
  }

  /** Los parámetros con nombre de la sentencia (`:a`, `@a`, `$a`), sin el
   *  prefijo. La expresión regular solo propone candidatos —puede caer en un
   *  '10:30' adentro de un string—; el que decide es SQLite, que no deja ligar
   *  un nombre que la sentencia no tiene. */
  nombres(fuente) {
    const candidatos = new Set(fuente.match(/[:@$][\p{L}\p{N}_$]+/gu) || []);
    const son = [];
    if (!candidatos.size) return son;
    const sonda = this.sonda(fuente);
    if (!sonda) return son;
    sonda.setAllowBareNamedParameters(false);
    for (const c of candidatos) {
      try {
        sonda.all({ [c]: null });
        if (!son.includes(c.slice(1))) son.push(c.slice(1));
      } catch { /* no era un parámetro */ }
    }
    return son;
  }
}

// ---------------------------------------------------------------------------
// db_query — la base SQLite PROPIA del agente (agent.db en dataDir). Scratch
// estructurado que persiste entre chats y scheduled runs; no toca nada del
// sistema, y por eso queda fuera de DANGER_TOOLS: una corrida sandboxeada la
// conserva. (El gate interactivo no la distingue: lo gobierna el modo.)
// ---------------------------------------------------------------------------

let agentDb = null;
function getAgentDb() {
  if (!agentDb) {
    agentDb = new Database(rutaAgentDb());
    agentDb.pragma('journal_mode = WAL');
    agentDb.pragma('busy_timeout = 3000');
  }
  return agentDb;
}

/** Cierra la base del agente si estaba abierta (al salir de la app, o antes de
 *  mover o borrar su archivo). El próximo db_query la vuelve a abrir. */
function cerrar() {
  if (!agentDb) return;
  const db = agentDb;
  agentDb = null;
  try { db.close(); } catch { /* nada que hacer si ya se cerró */ }
}

async function runDbQuery(run, { sql, params } = {}) {
  const q = String(sql || '').trim();
  if (!q) return 'error: sql is required';
  run.notify('tool:activity', { reqId: run.reqId, kind: 'db_query', label: q.replace(/\s+/g, ' ').slice(0, 60) });
  try {
    const db = getAgentDb();
    let stmt;
    try {
      stmt = db.prepare(q);
    } catch (e) {
      // scripts DDL de varias sentencias: exec (sin params ni resultados)
      if (/more than one statement/i.test(String(e.message))) {
        db.exec(q);
        return 'OK (multi-statement script executed)';
      }
      throw e;
    }
    const p = Array.isArray(params) ? params : [];
    if (stmt.reader) {
      const rows = stmt.all(...p);
      const shown = rows.slice(0, 200);
      let out = JSON.stringify(shown);
      if (out.length > 8000) out = out.slice(0, 8000) + '…[truncated]';
      return `${rows.length} row${rows.length !== 1 ? 's' : ''}${rows.length > 200 ? ' (showing first 200)' : ''}:\n${out}`;
    }
    const info = stmt.run(...p);
    return `OK — ${info.changes} change${info.changes !== 1 ? 's' : ''}${info.lastInsertRowid ? `, last insert id ${info.lastInsertRowid}` : ''}`;
  } catch (err) {
    return `error: ${String(err?.message || err)}`;
  }
}

// ---------------------------------------------------------------------------
// sqlite_query — SQL contra un archivo .db CUALQUIERA del disco (port de
// core/tools/sqlite-query.js de Umbra).
//
// Lo opuesto de db_query en todo lo que importa: aquélla es la base propia del
// agente; ésta llega a la base de cualquiera — las de la app incluidas — y un
// DROP suyo no se deshace. Va en DANGER_TOOLS, que es lo que el sandbox de las
// corridas desatendidas le quita (el gate interactivo lo decide el modo).
//
// Divergencias contra Umbra, y por qué:
//  - devuelve string en vez de {ok, content, data}: es el contrato de runner de
//    esta app, y `data` no lo consume nadie acá (allá lo leía la timeline de
//    actividad, que es uno de los subsistemas que NeonCode no tiene).
//  - suma el chip `tool:activity`, que allá no existía: acá es cómo el usuario ve
//    lo que se ejecutó sin abrir nada.
// `fileMustExist` se mantiene: crear bases es territorio de fs_write.
// ---------------------------------------------------------------------------

const SQLITE_MAX_ROWS = 200;
const SQLITE_MAX_CHARS = 12000;

function runSqliteQuery(run, { db, sql, params, readonly = false } = {}) {
  const file = String(db || '').trim();
  const q = String(sql || '').trim();
  if (!file) return 'error: db (database file path) is required';
  if (!q) return 'error: sql is required';

  // contra el MISMO cwd que el resto de las tools. `path.resolve(file)` a secas
  // resolvía contra el cwd del proceso de Electron —que en una app instalada es
  // la carpeta del ejecutable, no la del usuario—, así que un `db: "datos.db"`
  // relativo, que es como lo escribe el modelo después de un `cd`, no encontraba
  // nunca el archivo que acababa de ver con fs_read.
  const dbPath = resolverEn(run, file);
  run.notify('tool:activity', {
    reqId: run.reqId, kind: 'sqlite_query',
    label: `${path.basename(dbPath)} · ${q.replace(/\s+/g, ' ').slice(0, 44)}`,
  });
  if (!fs.existsSync(dbPath)) return `error: database not found: ${dbPath}`;

  const bind = Array.isArray(params) ? params : (params == null ? [] : [params]);
  let database;
  try {
    database = new Database(dbPath, { readonly: !!readonly, fileMustExist: true });
  } catch (err) {
    return `error: failed to open database: ${String(err?.message || err)}`;
  }

  try {
    let stmt;
    try {
      stmt = database.prepare(q);
    } catch (err) {
      // better-sqlite3 prepara UNA sola sentencia; un script de varias cae en exec()
      // (sin params ni filas) solo si el caller no mandó binds.
      if (/more than one statement|multiple statements|cannot prepare/i.test(String(err?.message)) && !bind.length) {
        database.exec(q);
        return 'OK (multi-statement script executed, no rows returned)';
      }
      return `error: SQL error: ${String(err?.message || err)}`;
    }

    if (stmt.reader) {
      const rows = stmt.all(...bind);
      const shown = rows.slice(0, SQLITE_MAX_ROWS);
      // BigInt (columnas de enteros grandes) no es serializable a JSON
      let out = JSON.stringify(shown, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
      if (out.length > SQLITE_MAX_CHARS) out = `${out.slice(0, SQLITE_MAX_CHARS)}…[truncated]`;
      const nota = rows.length > shown.length ? ` (showing first ${shown.length})` : '';
      return `${rows.length} row${rows.length !== 1 ? 's' : ''}${nota}:\n${out}`;
    }

    const info = stmt.run(...bind);
    const last = Number(info.lastInsertRowid);
    return `OK — ${info.changes} row${info.changes !== 1 ? 's' : ''} changed${last ? `, last insert id ${last}` : ''}`;
  } catch (err) {
    return `error: SQL error: ${String(err?.message || err)}`;
  } finally {
    try { database.close(); } catch { /* nada que hacer si ya se cerró */ }
  }
}

const runners = {
  db_query: (run, a) => runDbQuery(run, a),
  sqlite_query: (run, a) => runSqliteQuery(run, a),
};

module.exports = { runners, configurar, cerrar };

// El adaptador, para el store del canvas (canvas-store.cjs) y el de las notas
// (notes-store.cjs), que abren cada uno su propia base con él. No enumerable: lo que este módulo ofrece a la app sigue siendo
// lo de arriba, y `const { Database } = require('./sqlite.cjs')` anda igual.
Object.defineProperty(module.exports, 'Database', { value: Database });
