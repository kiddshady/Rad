// Test de las tools de SQLite de BlackCode (apps/BlackCode/main/tools/sqlite.cjs), con
// node pelado. Uso: node tools/test-blackcode-tools-sqlite.mjs
//
// Corre igual con el node de Electron, que es donde van a vivir de verdad:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tools/test-blackcode-tools-sqlite.mjs
// Con node 22 aparece un aviso de que node:sqlite es experimental; en el de
// Electron 44 (Node 24) no.
//
// NeonCode no tenía un test de db_query ni de sqlite_query, así que esto no
// porta comprobaciones: fija lo que el modelo lee de cada una, que es lo que
// tenía que quedar igual al cambiar better-sqlite3 por node:sqlite. Todo pasa
// en una carpeta descartable; las únicas bases que se abren son las que el test
// crea ahí.
//
// Lo que este archivo tiene que fijar:
//   - que un script de varias sentencias corra ENTERO (node:sqlite a secas
//     ejecuta la primera y calla el resto);
//   - que un CREATE no informe los cambios del INSERT anterior;
//   - que un valor que falta sea un error y no un NULL guardado en silencio;
//   - que sqlite_query no cree nunca un archivo y que `readonly` no escriba;
//   - los topes de filas y de caracteres de cada tool;
//   - y que una ruta relativa se resuelva contra el cwd de la corrida.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const sqlite = require(path.join(TOOLS, 'sqlite.cjs'));

const failures = [];
let hechas = 0;
let seccionActual = '';
const seccion = (s) => { seccionActual = s; };
const ok_ = (name, cond, extra = '') => {
  hechas++;
  if (!cond) failures.push(`[${seccionActual}] ${name}${extra === '' || extra == null ? '' : `  → ${extra}`}`);
};
const t = (name, got, want) => {
  hechas++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`[${seccionActual}] ${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`);
  }
};

// ── la carpeta descartable ───────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-sqlite-'));
const DATOS = path.join(TMP, 'datos');       // donde vive la base del agente
const PROJ_A = path.join(TMP, 'proj-a');
const PROJ_B = path.join(TMP, 'proj-b');
for (const d of [DATOS, PROJ_A, PROJ_B, path.join(PROJ_A, 'sub')]) fs.mkdirSync(d, { recursive: true });
const AGENT_DB = path.join(DATOS, 'agent.db');

const hacerRun = (cwd = TMP, reqId = 'r1') => {
  const run = { reqId, ac: new AbortController(), convoId: 'c1', cwd, steps: [], avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};

const dbq = (args, run = hacerRun()) => sqlite.runners.db_query(run, args);
const sq = (args, run = hacerRun()) => sqlite.runners.sqlite_query(run, args);
/** Las filas de una respuesta «N rows:\n[…]». */
const filas = (texto) => JSON.parse(String(texto).slice(String(texto).indexOf('\n') + 1));

/** Una base de arranque, hecha con node:sqlite a secas (no con la tool). */
function crearBase(file, nombres) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(file);
  d.exec('CREATE TABLE gente(id INTEGER PRIMARY KEY, nombre TEXT, edad INTEGER)');
  const ins = d.prepare('INSERT INTO gente(nombre, edad) VALUES (?, ?)');
  nombres.forEach((n, i) => ins.run(n, 20 + i));
  d.close();
}

try {
  // ── el cableado ────────────────────────────────────────────────────────────
  seccion('cableado');
  t('lo que exporta', Object.keys(sqlite).sort(), ['cerrar', 'configurar', 'runners']);
  t('los runners', Object.keys(sqlite.runners).sort(), ['db_query', 'sqlite_query']);
  ok_('configurar y cerrar son funciones', typeof sqlite.configurar === 'function' && typeof sqlite.cerrar === 'function');
  sqlite.cerrar();
  ok_('cerrar sin nada abierto no tira', true);
  sqlite.configurar({ dbPath: () => AGENT_DB });

  // ── db_query: la base propia del agente ────────────────────────────────────
  seccion('db_query');
  t('sin sql', await dbq({}), 'error: sql is required');
  t('sql en blanco', await dbq({ sql: '  \n ' }), 'error: sql is required');
  t('sin argumentos', await sqlite.runners.db_query(hacerRun()), 'error: sql is required');
  ok_('la base no se abre hasta el primer SQL', !fs.existsSync(AGENT_DB));

  {
    const run = hacerRun();
    t('crear una tabla', await dbq({ sql: 'CREATE TABLE notas(\n  id INTEGER PRIMARY KEY,\n  texto TEXT,\n  n INTEGER\n)' }, run), 'OK — 0 changes');
    t('avisa a la interfaz antes de ejecutar', run.avisos, [['tool:activity', {
      reqId: 'r1', kind: 'db_query', label: 'CREATE TABLE notas( id INTEGER PRIMARY KEY, texto TEXT, n IN',
    }]]);
    ok_('  y la etiqueta no pasa de 60', run.avisos[0][1].label.length === 60);
  }
  ok_('el archivo quedó donde dijo configurar', fs.existsSync(AGENT_DB));
  t('está en WAL', await dbq({ sql: 'PRAGMA journal_mode' }), '1 row:\n[{"journal_mode":"wal"}]');
  t('con busy_timeout de 3 s', await dbq({ sql: 'PRAGMA busy_timeout' }), '1 row:\n[{"timeout":3000}]');
  t('con las claves foráneas prendidas', await dbq({ sql: 'PRAGMA foreign_keys' }), '1 row:\n[{"foreign_keys":1}]');

  t('insertar con params', await dbq({ sql: 'INSERT INTO notas(texto, n) VALUES (?, ?)', params: ['hola', 5] }), 'OK — 1 change, last insert id 1');
  t('insertar otra', await dbq({ sql: 'INSERT INTO notas(texto, n) VALUES (?, ?)', params: ['chau', 2.5] }), 'OK — 1 change, last insert id 2');
  t('un SELECT devuelve las filas en JSON', await dbq({ sql: 'SELECT * FROM notas ORDER BY id' }),
    '2 rows:\n[{"id":1,"texto":"hola","n":5},{"id":2,"texto":"chau","n":2.5}]');
  t('un SELECT con params', await dbq({ sql: 'SELECT texto FROM notas WHERE n > ?', params: [3] }), '1 row:\n[{"texto":"hola"}]');
  t('un SELECT sin filas', await dbq({ sql: 'SELECT * FROM notas WHERE id = 999' }), '0 rows:\n[]');
  t('params que no es un array se ignora', await dbq({ sql: 'SELECT count(*) c FROM notas', params: 'nada' }), '1 row:\n[{"c":2}]');
  t('RETURNING devuelve filas', await dbq({ sql: 'INSERT INTO notas(texto) VALUES (?) RETURNING id, texto', params: ['ret'] }), '1 row:\n[{"id":3,"texto":"ret"}]');

  // node:sqlite devuelve sqlite3_changes() a secas: sin el arreglo del
  // adaptador este CREATE diría «1 change», que es el INSERT de recién
  t('un CREATE no informa los cambios del INSERT anterior', await dbq({ sql: 'CREATE TABLE otra(a)' }), 'OK — 0 changes, last insert id 3');
  t('un UPDATE de varias filas', await dbq({ sql: 'UPDATE notas SET n = 1' }), 'OK — 3 changes, last insert id 3');
  t('un UPDATE que no toca nada', await dbq({ sql: 'UPDATE notas SET n = 0 WHERE id = 999' }), 'OK — 0 changes, last insert id 3');
  t('un DELETE', await dbq({ sql: 'DELETE FROM notas WHERE id = 3' }), 'OK — 1 change, last insert id 3');

  seccion('db_query: varias sentencias');
  t('un script DDL de varias sentencias', await dbq({ sql: 'CREATE TABLE a1(x);\nCREATE TABLE a2(x);\nINSERT INTO a1 VALUES (1), (2);' }), 'OK (multi-statement script executed)');
  // el caso que node:sqlite a secas rompía en silencio: preparaba la primera y nada más
  t('  corrieron TODAS, no solo la primera', await dbq({ sql: "SELECT name FROM sqlite_master WHERE name IN ('a1', 'a2') ORDER BY name" }), '2 rows:\n[{"name":"a1"},{"name":"a2"}]');
  t('  incluido el INSERT del final', await dbq({ sql: 'SELECT count(*) c FROM a1' }), '1 row:\n[{"c":2}]');
  t('varias sentencias no devuelven filas', await dbq({ sql: 'SELECT 1 AS a; SELECT 2 AS b' }), 'OK (multi-statement script executed)');
  t('un `;` y un comentario al final no son otra sentencia', await dbq({ sql: 'SELECT 1 AS a ; -- fin\n /* nada */ ;; ' }), '1 row:\n[{"a":1}]');
  t('un `;` adentro de un string tampoco', await dbq({ sql: "SELECT 'a; b' AS s" }), '1 row:\n[{"s":"a; b"}]');
  // (el «last insert id» es el de la conexión: el INSERT del script de recién)
  t('un trigger con `;` adentro es UNA sentencia', await dbq({ sql: 'CREATE TRIGGER tr AFTER INSERT ON a1 BEGIN INSERT INTO a2 VALUES (new.x); END' }), 'OK — 0 changes, last insert id 2');
  {
    const r = await dbq({ sql: 'CREATE TABLE b1(x); SELEC 1; CREATE TABLE b2(x)' });
    ok_('un script que falla por la mitad devuelve el error', /^error: .*syntax error/.test(r), r);
    t('  y lo anterior al error quedó hecho', await dbq({ sql: "SELECT name FROM sqlite_master WHERE name LIKE 'b_'" }), '1 row:\n[{"name":"b1"}]');
  }

  seccion('db_query: errores');
  {
    const r = await dbq({ sql: 'SELEC 1' });
    ok_('una sentencia mal escrita', /^error: near "SELEC": syntax error/.test(r), r);
    t('una tabla que no existe', await dbq({ sql: 'SELECT * FROM no_existe' }), 'error: no such table: no_existe');
    t('una clave repetida', await dbq({ sql: "INSERT INTO notas(id, texto) VALUES (1, 'otra')" }), 'error: UNIQUE constraint failed: notas.id');
    t('solo un comentario', await dbq({ sql: '-- nada que hacer' }), 'error: The supplied SQL string contains no statements');
    t('solo un `;`', await dbq({ sql: ';' }), 'error: The supplied SQL string contains no statements');
  }
  // node:sqlite ligaba NULL en el valor que falta y seguía
  t('un valor que falta es un error', await dbq({ sql: 'INSERT INTO notas(texto, n) VALUES (?, ?)', params: ['falta uno'] }), 'error: Too few parameter values were provided');
  t('ningún valor para un `?`', await dbq({ sql: 'INSERT INTO notas(texto) VALUES (?)' }), 'error: Too few parameter values were provided');
  t('un valor de más', await dbq({ sql: 'INSERT INTO notas(texto) VALUES (?)', params: ['uno', 'sobra'] }), 'error: Too many parameter values were provided');
  t('un valor para una sentencia sin `?`', await dbq({ sql: 'SELECT 1 AS a', params: [1] }), 'error: Too many parameter values were provided');
  t('un booleano no se liga', await dbq({ sql: 'INSERT INTO notas(texto) VALUES (?)', params: [true] }), 'error: SQLite3 can only bind numbers, strings, bigints, buffers, and null');
  t('  y nada de eso llegó a insertar', await dbq({ sql: 'SELECT count(*) c FROM notas' }), '1 row:\n[{"c":2}]');
  t('null sí se liga', await dbq({ sql: 'SELECT ? AS v', params: [null] }), '1 row:\n[{"v":null}]');
  t('un `?` adentro de un string no cuenta', await dbq({ sql: "SELECT 'a?b' AS s, '10:30' AS h, ? AS v", params: [7] }), '1 row:\n[{"s":"a?b","h":"10:30","v":7}]');
  t('parámetros con nombre, desde un objeto', await dbq({ sql: 'SELECT :a AS v, @b AS w', params: [{ a: 1, b: 'dos', de_mas: 3 }] }), '1 row:\n[{"v":1,"w":"dos"}]');
  t('  al que le falta un nombre', await dbq({ sql: 'SELECT :a AS v, :b AS w', params: [{ a: 1 }] }), 'error: Missing named parameter "b"');
  t('  y sin objeto', await dbq({ sql: 'SELECT :a AS v' }), 'error: Missing named parameters');

  seccion('db_query: tipos');
  t('un entero más grande que 2^53 vuelve como número', await dbq({ sql: 'SELECT 9007199254740993 AS grande, -5 AS chico' }), '1 row:\n[{"grande":9007199254740992,"chico":-5}]');
  t('un BLOB sale como un Buffer', await dbq({ sql: "SELECT x'0102ff' AS b" }), '1 row:\n[{"b":{"type":"Buffer","data":[1,2,255]}}]');
  t('real, texto y NULL', await dbq({ sql: "SELECT 1.5 AS r, 'ñandú' AS s, NULL AS n" }), '1 row:\n[{"r":1.5,"s":"ñandú","n":null}]');
  t('un número se liga como real y la columna lo vuelve entero', await dbq({ sql: 'SELECT typeof(?) AS suelto, (SELECT typeof(n) FROM notas WHERE id = 1) AS guardado', params: [5] }), '1 row:\n[{"suelto":"real","guardado":"integer"}]');

  seccion('db_query: topes');
  {
    const r = await dbq({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 250) SELECT x FROM c' });
    ok_('más de 200 filas: avisa cuántas eran', r.startsWith('250 rows (showing first 200):\n'), r.slice(0, 60));
    const f = filas(r);
    ok_('  y manda las primeras 200', f.length === 200 && f[0].x === 1 && f[199].x === 200, `n=${f.length}`);
    const justo = await dbq({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 200) SELECT x FROM c' });
    ok_('200 justas no llevan aviso', justo.startsWith('200 rows:\n') && filas(justo).length === 200, justo.slice(0, 40));
  }
  {
    const r = await dbq({ sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 150) SELECT x, printf('%0100d', x) AS relleno FROM c" });
    const cuerpo = r.slice(r.indexOf('\n') + 1);
    ok_('más de 8000 caracteres: se corta', r.startsWith('150 rows:\n') && cuerpo.endsWith('…[truncated]'), r.slice(0, 40));
    ok_('  en 8000 justos', cuerpo.length === 8000 + '…[truncated]'.length, `largo=${cuerpo.length}`);
  }

  seccion('db_query: persistencia');
  t('lo escrito en una llamada está en la siguiente', await dbq({ sql: 'SELECT texto FROM notas ORDER BY id' }, hacerRun(PROJ_A, 'r2')), '2 rows:\n[{"texto":"hola"},{"texto":"chau"}]');
  sqlite.cerrar();
  sqlite.cerrar();
  ok_('cerrar dos veces no tira', true);
  {
    // con la base cerrada el archivo se puede mover; abierta, Windows no deja
    const movida = `${AGENT_DB}.movida`;
    let pudo = true;
    try { fs.renameSync(AGENT_DB, movida); fs.renameSync(movida, AGENT_DB); } catch { pudo = false; }
    ok_('cerrar() suelta el archivo', pudo);
  }
  t('después de cerrar, la llamada siguiente la reabre con todo', await dbq({ sql: 'SELECT count(*) c FROM notas' }), '1 row:\n[{"c":2}]');
  t('  y sigue en WAL', await dbq({ sql: 'PRAGMA journal_mode' }), '1 row:\n[{"journal_mode":"wal"}]');
  {
    const OTRA = path.join(DATOS, 'otra-agent.db');
    sqlite.configurar({ dbPath: () => OTRA });
    t('configurar otra ruta cambia de base', await dbq({ sql: 'SELECT count(*) c FROM sqlite_master' }), '1 row:\n[{"c":0}]');
    ok_('  y la crea ahí', fs.existsSync(OTRA));
    sqlite.configurar({ dbPath: () => path.join(TMP, 'no-existe', 'agent.db') });
    t('una carpeta que no existe es un error, no una carpeta nueva', await dbq({ sql: 'SELECT 1' }), 'error: Cannot open database because the directory does not exist');
    ok_('  y no la crea', !fs.existsSync(path.join(TMP, 'no-existe')));
    sqlite.configurar({ dbPath: () => AGENT_DB });
    t('y de vuelta a la primera', await dbq({ sql: 'SELECT count(*) c FROM notas' }), '1 row:\n[{"c":2}]');
    sqlite.configurar({});
    t('configurar sin dbPath no cambia nada', await dbq({ sql: 'SELECT count(*) c FROM notas' }), '1 row:\n[{"c":2}]');
  }

  // ── sqlite_query: una base cualquiera del disco ────────────────────────────
  seccion('sqlite_query');
  const BASE_A = path.join(PROJ_A, 'datos.db');
  crearBase(BASE_A, ['Ana', 'Beto', 'Caro']);
  crearBase(path.join(PROJ_B, 'datos.db'), ['Zoe']);
  crearBase(path.join(PROJ_A, 'sub', 'otra.db'), ['Sub1', 'Sub2']);
  const runA = () => hacerRun(PROJ_A);
  const runB = () => hacerRun(PROJ_B);

  t('sin db', sq({ sql: 'SELECT 1' }), 'error: db (database file path) is required');
  t('sin sql', sq({ db: BASE_A }), 'error: sql is required');
  t('sin nada: primero se queja de db', sq({}), 'error: db (database file path) is required');
  t('sin argumentos', sqlite.runners.sqlite_query(hacerRun()), 'error: db (database file path) is required');

  {
    const run = runA();
    t('un SELECT sobre un archivo que existe', await sq({ db: BASE_A, sql: 'SELECT * FROM gente ORDER BY id' }, run),
      '3 rows:\n[{"id":1,"nombre":"Ana","edad":20},{"id":2,"nombre":"Beto","edad":21},{"id":3,"nombre":"Caro","edad":22}]');
    t('avisa a la interfaz con el archivo y el SQL', run.avisos, [['tool:activity', {
      reqId: 'r1', kind: 'sqlite_query', label: 'datos.db · SELECT * FROM gente ORDER BY id',
    }]]);
    const largo = runA();
    await sq({ db: BASE_A, sql: `SELECT nombre,\n   edad FROM gente WHERE nombre IN ('Ana', 'Beto', 'Caro') ORDER BY id` }, largo);
    t('  con el SQL en una línea y cortado en 44', largo.avisos[0][1].label, 'datos.db · SELECT nombre, edad FROM gente WHERE nombre ');
  }
  t('con params', await sq({ db: BASE_A, sql: 'SELECT nombre FROM gente WHERE edad > ? AND nombre <> ?', params: [20, 'Caro'] }, runA()), '1 row:\n[{"nombre":"Beto"}]');
  t('un param suelto, sin array', await sq({ db: BASE_A, sql: 'SELECT nombre FROM gente WHERE edad = ?', params: 22 }, runA()), '1 row:\n[{"nombre":"Caro"}]');
  t('params con nombre', await sq({ db: BASE_A, sql: 'SELECT nombre FROM gente WHERE nombre = :n', params: { n: 'Ana' } }, runA()), '1 row:\n[{"nombre":"Ana"}]');
  t('un PRAGMA que devuelve filas', filas(await sq({ db: BASE_A, sql: 'PRAGMA table_info(gente)' }, runA())).map((c) => c.name), ['id', 'nombre', 'edad']);
  t('espera 5 s una base ocupada, como antes', await sq({ db: BASE_A, sql: 'PRAGMA busy_timeout' }, runA()), '1 row:\n[{"timeout":5000}]');

  seccion('sqlite_query: rutas');
  t('una ruta relativa va contra el cwd de la corrida', await sq({ db: 'datos.db', sql: 'SELECT nombre FROM gente ORDER BY id' }, runA()), '3 rows:\n[{"nombre":"Ana"},{"nombre":"Beto"},{"nombre":"Caro"}]');
  t('  y otra corrida, con otro cwd, ve la suya', await sq({ db: 'datos.db', sql: 'SELECT nombre FROM gente ORDER BY id' }, runB()), '1 row:\n[{"nombre":"Zoe"}]');
  t('una relativa con subcarpeta', await sq({ db: 'sub/otra.db', sql: 'SELECT count(*) c FROM gente' }, runA()), '1 row:\n[{"c":2}]');
  t('una con `..`', await sq({ db: '../proj-b/datos.db', sql: 'SELECT count(*) c FROM gente' }, runA()), '1 row:\n[{"c":1}]');
  t('espacios alrededor de la ruta', await sq({ db: '  datos.db  ', sql: 'SELECT count(*) c FROM gente' }, runA()), '1 row:\n[{"c":3}]');
  t('una absoluta no depende del cwd', await sq({ db: BASE_A, sql: 'SELECT count(*) c FROM gente' }, runB()), '1 row:\n[{"c":3}]');

  seccion('sqlite_query: no crea archivos');
  {
    const FALTA = path.join(PROJ_A, 'no-esta.db');
    t('un archivo que no existe', await sq({ db: 'no-esta.db', sql: 'SELECT 1' }, runA()), `error: database not found: ${FALTA}`);
    t('  ni para crear una tabla', await sq({ db: 'no-esta.db', sql: 'CREATE TABLE x(a)' }, runA()), `error: database not found: ${FALTA}`);
    t('  ni en readonly', await sq({ db: FALTA, sql: 'SELECT 1', readonly: true }, runA()), `error: database not found: ${FALTA}`);
    ok_('  y no quedó creado', !fs.existsSync(FALTA));
    {
      const run = runA();
      await sq({ db: 'no-esta.db', sql: 'SELECT 1' }, run);
      t('  avisó igual, antes de mirar el disco', run.avisos.map((a) => a[1].label), ['no-esta.db · SELECT 1']);
    }
    t('una carpeta no es una base', await sq({ db: 'sub', sql: 'SELECT 1' }, runA()), 'error: failed to open database: unable to open database file');
    fs.writeFileSync(path.join(PROJ_A, 'basura.db'), 'esto no es una base, ni cerca '.repeat(60));
    t('un archivo que no es SQLite', await sq({ db: 'basura.db', sql: 'SELECT 1' }, runA()), 'error: SQL error: file is not a database');
    t('  y queda como estaba', fs.readFileSync(path.join(PROJ_A, 'basura.db'), 'utf8').length, 30 * 60);
    t('lo que hay en la carpeta', fs.readdirSync(PROJ_A).sort(), ['basura.db', 'datos.db', 'sub']);
  }

  seccion('sqlite_query: readonly');
  t('readonly deja leer', await sq({ db: 'datos.db', sql: 'SELECT count(*) c FROM gente', readonly: true }, runA()), '1 row:\n[{"c":3}]');
  t('readonly rechaza un INSERT', await sq({ db: 'datos.db', sql: "INSERT INTO gente(nombre, edad) VALUES ('Dani', 50)", readonly: true }, runA()), 'error: SQL error: attempt to write a readonly database');
  t('  un UPDATE', await sq({ db: 'datos.db', sql: 'UPDATE gente SET edad = 0', readonly: true }, runA()), 'error: SQL error: attempt to write a readonly database');
  t('  un CREATE', await sq({ db: 'datos.db', sql: 'CREATE TABLE ro(a)', readonly: true }, runA()), 'error: SQL error: attempt to write a readonly database');
  t('  y un script de varias', await sq({ db: 'datos.db', sql: 'CREATE TABLE ro1(a); CREATE TABLE ro2(a)', readonly: true }, runA()), 'error: SQL error: attempt to write a readonly database');
  t('  la base quedó igual', await sq({ db: 'datos.db', sql: 'SELECT (SELECT count(*) FROM gente) AS filas, (SELECT sum(edad) FROM gente) AS edades, (SELECT count(*) FROM sqlite_master) AS tablas' }, runA()), '1 row:\n[{"filas":3,"edades":63,"tablas":1}]');

  seccion('sqlite_query: escribir');
  t('un INSERT', await sq({ db: 'datos.db', sql: 'INSERT INTO gente(nombre, edad) VALUES (?, ?)', params: ['Dani', 50] }, runA()), 'OK — 1 row changed, last insert id 4');
  t('un UPDATE de varias filas (conexión nueva: sin last insert id)', await sq({ db: 'datos.db', sql: 'UPDATE gente SET edad = edad + 1' }, runA()), 'OK — 4 rows changed');
  t('un UPDATE que no toca nada', await sq({ db: 'datos.db', sql: 'UPDATE gente SET edad = 0 WHERE id = 999' }, runA()), 'OK — 0 rows changed');
  t('un CREATE', await sq({ db: 'datos.db', sql: 'CREATE TABLE t2(a)' }, runA()), 'OK — 0 rows changed');
  t('lo escrito está en la llamada siguiente', await sq({ db: 'datos.db', sql: 'SELECT nombre, edad FROM gente WHERE id = 4' }, runA()), '1 row:\n[{"nombre":"Dani","edad":51}]');
  t('un script de varias sentencias, sin params', await sq({ db: 'datos.db', sql: 'CREATE TABLE s1(a); CREATE TABLE s2(a); INSERT INTO s1 VALUES (1);' }, runA()), 'OK (multi-statement script executed, no rows returned)');
  t('  corrieron todas', await sq({ db: 'datos.db', sql: "SELECT (SELECT count(*) FROM sqlite_master WHERE name IN ('s1', 's2')) AS tablas, (SELECT count(*) FROM s1) AS filas" }, runA()), '1 row:\n[{"tablas":2,"filas":1}]');
  t('varias sentencias CON params no corren', await sq({ db: 'datos.db', sql: 'CREATE TABLE s3(a); INSERT INTO s3 VALUES (?);', params: [1] }, runA()), 'error: SQL error: The supplied SQL string contains more than one statement');
  t('  ni la primera', await sq({ db: 'datos.db', sql: "SELECT count(*) c FROM sqlite_master WHERE name = 's3'" }, runA()), '1 row:\n[{"c":0}]');
  {
    // cada llamada abre y CIERRA: después de una, el archivo se puede mover
    const movida = `${BASE_A}.movida`;
    let pudo = true;
    try { fs.renameSync(BASE_A, movida); fs.renameSync(movida, BASE_A); } catch { pudo = false; }
    ok_('no deja el archivo tomado', pudo);
  }

  seccion('sqlite_query: errores');
  {
    const r = await sq({ db: 'datos.db', sql: 'SELEC 1' }, runA());
    ok_('una sentencia mal escrita', /^error: SQL error: near "SELEC": syntax error/.test(r), r);
  }
  t('una tabla que no existe', await sq({ db: 'datos.db', sql: 'SELECT * FROM nope' }, runA()), 'error: SQL error: no such table: nope');
  t('solo un comentario', await sq({ db: 'datos.db', sql: '-- nada' }, runA()), 'error: SQL error: The supplied SQL string contains no statements');
  t('un valor que falta', await sq({ db: 'datos.db', sql: 'INSERT INTO gente(nombre, edad) VALUES (?, ?)', params: ['falta'] }, runA()), 'error: SQL error: Too few parameter values were provided');
  t('un valor de más', await sq({ db: 'datos.db', sql: 'INSERT INTO gente(nombre) VALUES (?)', params: ['a', 'b'] }, runA()), 'error: SQL error: Too many parameter values were provided');
  t('un booleano', await sq({ db: 'datos.db', sql: 'INSERT INTO gente(nombre) VALUES (?)', params: true }, runA()), 'error: SQL error: SQLite3 can only bind numbers, strings, bigints, buffers, and null');
  t('nada de eso insertó', await sq({ db: 'datos.db', sql: 'SELECT count(*) c FROM gente' }, runA()), '1 row:\n[{"c":4}]');
  t('un EXPLAIN también cuenta sus params', await sq({ db: 'datos.db', sql: 'EXPLAIN QUERY PLAN SELECT * FROM gente WHERE id = ?' }, runA()), 'error: SQL error: Too few parameter values were provided');

  seccion('sqlite_query: tipos');
  t('un entero grande guardado vuelve como número', await (async () => {
    await sq({ db: 'datos.db', sql: "INSERT INTO gente(id, nombre) VALUES (9007199254740993, 'grande')" }, runA());
    return sq({ db: 'datos.db', sql: "SELECT id FROM gente WHERE nombre = 'grande'" }, runA());
  })(), '1 row:\n[{"id":9007199254740992}]');
  t('  y el last insert id también', await sq({ db: 'datos.db', sql: "INSERT INTO gente(nombre) VALUES ('uno más')" }, runA()), 'OK — 1 row changed, last insert id 9007199254740994');
  t('un BLOB sale como un Buffer', await sq({ db: 'datos.db', sql: "SELECT x'00ff' AS b" }, runA()), '1 row:\n[{"b":{"type":"Buffer","data":[0,255]}}]');

  seccion('sqlite_query: topes');
  {
    const r = await sq({ db: 'datos.db', sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 201) SELECT x FROM c' }, runA());
    ok_('más de 200 filas: avisa cuántas eran', r.startsWith('201 rows (showing first 200):\n'), r.slice(0, 60));
    ok_('  y manda las primeras 200', filas(r).length === 200 && filas(r)[199].x === 200);
    const justo = await sq({ db: 'datos.db', sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 200) SELECT x FROM c' }, runA());
    ok_('200 justas no llevan aviso', justo.startsWith('200 rows:\n') && filas(justo).length === 200, justo.slice(0, 40));
  }
  {
    const r = await sq({ db: 'datos.db', sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 190) SELECT x, printf('%0100d', x) AS relleno FROM c" }, runA());
    const cuerpo = r.slice(r.indexOf('\n') + 1);
    ok_('más de 12000 caracteres: se corta', r.startsWith('190 rows:\n') && cuerpo.endsWith('…[truncated]'), r.slice(0, 40));
    ok_('  en 12000 justos', cuerpo.length === 12000 + '…[truncated]'.length, `largo=${cuerpo.length}`);
    const entra = await sq({ db: 'datos.db', sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 90) SELECT x, printf('%0100d', x) AS relleno FROM c" }, runA());
    ok_('lo que entra va entero (acá el tope es más alto que el de db_query)', !entra.includes('[truncated]') && filas(entra).length === 90 && entra.length > 8000, `largo=${entra.length}`);
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  try { sqlite.cerrar(); } catch { /* ya estaba cerrada */ }
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (fs.existsSync(TMP)) failures.push('[limpieza] la carpeta temporal no se pudo borrar: quedó una base abierta');

if (failures.length) {
  console.error(`test-blackcode-tools-sqlite: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-sqlite: ok (${hechas} comprobaciones: cableado, db_query con params, varias sentencias, errores, tipos, topes y persistencia; sqlite_query sobre un archivo, rutas contra el cwd de la corrida, que no crea archivos, readonly, escritura, errores, tipos y topes)`);
process.exit(0);
