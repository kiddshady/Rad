// Test de las tools `notepad` y `notepad_write` de BlackCode
// (apps/BlackCode/main/tools/notas.cjs) y de su store (notes-store.cjs), con node
// pelado. Uso: node tools/test-blackcode-tools-notas.mjs
//
// Corre igual con el node de Electron, que es donde van a vivir de verdad:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tools/test-blackcode-tools-notas.mjs
// Con node 22 aparece un aviso de que node:sqlite es experimental; en el de
// Electron 44 (Node 24) no.
//
// Son las comprobaciones de scripts/test-notepad.js de NeonCode 1.11.3, en el
// mismo orden y con los mismos nombres. Allá el store se probaba de verdad y la
// lógica de las tools se sacaba del TEXTO de main.js con expresiones regulares
// (no tenía exports); acá todo se importa del módulo, así que lo que se prueba
// es lo que la app va a cargar. Tres grupos cambiaron de forma por eso:
//   - «la tool: la búsqueda» miraba el fuente de runNotepad (que dijera
//     `Math.min(50,`, `terms.every`, `reverse()`, `12000`). Acá se llama a la
//     tool y se mira lo que contesta.
//   - «las dos viajan siempre (si la base abrió)» miraba el fuente de
//     activeToolNames. Ese filtro no vino con las tools (es de quien arma la
//     lista del turno): acá se prueba lista(), que es con lo que se decide.
//   - Las del esquema («sus parámetros son solo query y limit», «las seis
//     acciones»…) miraban TOOL_DEFS en el texto de main.js. Acá las
//     definiciones van en defs.cjs, que es de otra entrega: se comprueban si
//     defs.cjs ya las trae, y si no la última línea dice que quedaron
//     pendientes. READ_ROUND_TOOLS e IDEMPOTENT_TOOLS sí están (en motor.cjs).
//
// Lo que NO vino, porque eran expresiones regulares sobre la interfaz de
// NeonCode (preload.js y renderer/js/panels/notes.js), que acá no existe:
//   - «el preload y el aviso»: «el preload expone el CRUD del usuario», «y el
//     restore del aviso», «main atiende notes:restore» (acá es ipc.restore, que
//     se prueba de verdad más abajo) y «el panel ofrece restaurar»;
//   - «el resaltado de drag no queda pegado»: «la limpieza quita el borde de
//     la lista», «la limpieza quita carpetas resaltadas», «dragend limpia un
//     arrastre cancelado» y «abrir y cerrar también limpian el estado visual»;
//   - «Unfiled agrupa las notas sin carpeta»: «Unfiled es un grupo virtual, no
//     una carpeta persistida», «las notas sueltas ya no se pintan como tarjetas
//     de primer nivel», «el render agrega Unfiled después de las carpetas
//     reales», «Unfiled contiene exactamente las notas con folder_id null»,
//     «plegar Unfiled también lo excluye del rango de multiselección» y «la
//     miga de pan nombra Unfiled en vez de Notepad»;
//   - «el panel ofrece restaurar»: «el aviso restaura por id»;
//   - y «está en TOOL_RUNNERS y le pasa los args», que miraba la fila de la
//     tabla en el texto: acá la tabla es `runners`, y todo notepad_write se
//     llama por ella.
//
// Lo que se suma, porque es lo que cambió al portar:
//   - los exports, y que la base se abra sola en el primer uso (de `store`, de
//     una tool, de `ipc` o de lista()) y no antes;
//   - lo que cada tool le avisa a la interfaz (tool:activity por run.notify,
//     notes:changed y notes:deleted por broadcast) y lo que NO avisa cuando
//     falla;
//   - el formato de lo que devuelve `notepad`, y carpetaDeNota suelta;
//   - las doce funciones de `ipc` (los cuerpos de los handlers), con la base
//     abierta y con la base caída;
//   - broadcast inyectado, sin configurar y fallando;
//   - cerrar(), cambiar de base con configurar({ dbPath }), una base que no se
//     puede abrir (un solo intento, nada a medio abrir, ninguna carpeta
//     creada) y la purga de la papelera al abrir;
//   - que mandar a la papelera, restaurar y borrar una carpeta sean todo o
//     nada, que es para lo que el store usa db.transaction;
//   - y el transaction() que hubo que sumarle al adaptador de sqlite.cjs.
//
// Todo pasa en una carpeta descartable, que se borra al final.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const notas = require(path.join(TOOLS, 'notas.cjs'));
const almacen = require(path.join(TOOLS, 'notes-store.cjs')); // el store a secas, sin la apertura adelante
const sqlite = require(path.join(TOOLS, 'sqlite.cjs'));
const motor = require(path.join(TOOLS, 'motor.cjs'));
const guardas = require(path.join(TOOLS, 'guardas.cjs'));
const defs = require(path.join(TOOLS, 'defs.cjs'));

const failures = [];
const pendientes = [];
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
const tira = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message || e); } };

// ── la carpeta descartable ───────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-notas-'));
const DATOS = path.join(TMP, 'datos'); // donde vive notes.db
fs.mkdirSync(DATOS, { recursive: true });
const DB = path.join(DATOS, 'notes.db');

const hacerRun = (reqId = 'r1') => {
  const run = { reqId, ac: new AbortController(), convoId: 'chat-A', cwd: TMP, steps: [], avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};
const store = notas.store;
const leer = (a, run = hacerRun()) => notas.runners.notepad(run, a);

/** Una conexión aparte, con node:sqlite a secas (no con el store). */
const crudo = (file, fn) => {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(file);
  try { return fn(d); } finally { d.close(); }
};
/** ¿El archivo está suelto? Abierto, Windows no lo deja mover. */
const sePuedeMover = (file) => {
  const movido = `${file}.movido`;
  try { fs.renameSync(file, movido); fs.renameSync(movido, file); return true; } catch { return false; }
};
/** Los títulos de las notas que trae una respuesta de `notepad`, en orden. */
const titulos = (texto) => [...String(texto).matchAll(/^--- (.*) \(id: [0-9a-f-]{36} · /gm)].map((m) => m[1]);
const idDe = (texto) => (String(texto).match(/id: ([0-9a-f-]{36})/) || [])[1];

// lo que el módulo avisa por consola cuando no puede abrir la base
const avisosConsola = [];
const warnOriginal = console.warn;
console.warn = (...a) => { avisosConsola.push(a.map(String).join(' ')); };

// cada escritura avisa por broadcast (llega aunque el turno sea headless): se anota
const broadcasted = [];
const broadcast = (ch, p) => broadcasted.push({ ch, p });

const EXPORTS_STORE = [
  'init', 'close', 'list', 'get', 'create', 'update', 'remove', 'setPinned', 'setFolder', 'clear', 'count',
  'listFolders', 'createFolder', 'renameFolder', 'deleteFolder',
  'trash', 'restore', 'purgeTrash', 'TRASH_DIAS',
];
const FUNCIONES_IPC = [
  'list', 'create', 'update', 'remove', 'pin', 'setFolder', 'restore', 'clear',
  'foldersList', 'foldersCreate', 'foldersRename', 'foldersDelete',
];

try {
  // ── el cableado ────────────────────────────────────────────────────────────
  seccion('cableado');
  t('lo que exporta notas.cjs', Object.keys(notas).sort(), [
    'runners', 'configurar', 'cerrar', 'store', 'ipc', 'lista', 'noteHeadline', 'carpetaDeNota',
  ].sort());
  t('los runners', Object.keys(notas.runners), ['notepad', 'notepad_write']);
  t('lo que exporta notes-store.cjs', Object.keys(almacen).sort(), [...EXPORTS_STORE].sort());
  t('`store` es el store sin init ni close', Object.keys(store).sort(),
    EXPORTS_STORE.filter((k) => k !== 'init' && k !== 'close').sort());
  t('las funciones de `ipc`, una por canal', Object.keys(notas.ipc), FUNCIONES_IPC);
  ok_('  todas funciones', Object.values(notas.ipc).every((f) => typeof f === 'function'));
  t('la papelera dura 7 días', [almacen.TRASH_DIAS, store.TRASH_DIAS], [7, 7]);
  notas.cerrar();
  ok_('cerrar sin nada abierto no tira', true);
  notas.configurar({ dbPath: () => DB });
  ok_('la base no se abre al configurar', !fs.existsSync(DB));
  ok_('el store a secas, cerrado, tira', /not initialized/.test(tira(() => almacen.get('x'))));

  // ── store ──────────────────────────────────────────────────────────────────
  seccion('store: notas');
  const n1 = store.create({ content: '  # Compras  \nleche\npan  ' });
  ok_('el primer uso de `store` abre la base, sin que nadie haya corrido una tool', fs.existsSync(DB));
  t('  en WAL', crudo(DB, (d) => d.prepare('PRAGMA journal_mode').get().journal_mode), 'wal');
  t('  con sus tres tablas', crudo(DB, (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name)),
    ['note_folders', 'notes', 'notes_trash']);
  t('create devuelve la nota entera', [n1.content, n1.pinned, n1.folder_id], ['# Compras  \nleche\npan', 0, null]);
  ok_('id es uuid', /^[0-9a-f-]{36}$/.test(n1.id));
  t('una nota vacía no se crea', store.create({ content: '   \n  ' }), null);
  t('sin contenido tampoco', store.create({}), null);

  t('update reescribe', store.update(n1.id, 'otra cosa') && store.get(n1.id).content, 'otra cosa');
  // borrar el texto NO borra la nota: para eso está la papelera del panel
  t('update vacío se rechaza', store.update(n1.id, '   '), false);
  t('…y la nota queda intacta', store.get(n1.id).content, 'otra cosa');
  t('update sin id se rechaza', store.update(null, 'x'), false);

  t('setPinned fija', store.setPinned(n1.id, true) && store.get(n1.id).pinned, 1);
  t('setPinned suelta', store.setPinned(n1.id, false) && store.get(n1.id).pinned, 0);

  seccion('store: carpetas');
  const f1 = store.createFolder('  Trabajo  ');
  t('el nombre se recorta', f1.name, 'Trabajo');
  t('sin nombre → New folder', store.createFolder('   ').name, 'New folder');
  const f2 = store.createFolder('Personal');
  t('listFolders devuelve las dos… y la sin nombre', store.listFolders().length, 3);
  t('renameFolder', store.renameFolder(f1.id, 'Laburo') && store.listFolders().find((f) => f.id === f1.id).name, 'Laburo');
  t('rename vacío cae en Folder', store.renameFolder(f2.id, '  ') && store.listFolders().find((f) => f.id === f2.id).name, 'Folder');

  const n2 = store.create({ content: 'nota archivada', folderId: f1.id });
  t('create con carpeta', n2.folder_id, f1.id);
  t('setFolder archiva', store.setFolder(n1.id, f1.id) && store.get(n1.id).folder_id, f1.id);
  t('setFolder null desarchiva', store.setFolder(n1.id, null) && store.get(n1.id).folder_id, null);

  // mover una nota no es editarla: no puede reordenar su recencia
  // (se le atrasa la fecha a mano: recién creada, un updated_at pisado con la
  // hora de ahora daría el mismo segundo y la comprobación no vería nada)
  crudo(DB, (d) => d.prepare("UPDATE notes SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(n2.id));
  const antes = store.get(n2.id).updated_at;
  t('  (la fecha de la nota, atrasada a mano)', antes, '2020-01-01 00:00:00');
  store.setFolder(n2.id, f2.id);
  t('setFolder NO toca updated_at', store.get(n2.id).updated_at, antes);
  store.setFolder(n2.id, f1.id);

  seccion('borrar una carpeta NO borra sus notas');
  t('la nota está adentro', store.get(n2.id).folder_id, f1.id);
  store.deleteFolder(f1.id);
  ok_('la carpeta ya no está', !store.listFolders().some((f) => f.id === f1.id));
  ok_('la nota sigue viva', !!store.get(n2.id));
  t('…y quedó suelta', store.get(n2.id).folder_id, null);

  seccion('[BlackCode] con conNotas, la carpeta se va con sus notas');
  {
    const fC = store.createFolder('Con notas');
    const adentro = store.create({ content: 'adentro', folderId: fC.id });
    const afuera = store.create({ content: 'afuera' });
    t('deleteFolder con conNotas', store.deleteFolder(fC.id, { conNotas: true }), true);
    t('  la carpeta y la de adentro se fueron, la suelta queda', [store.listFolders().some((f) => f.id === fC.id), store.get(adentro.id), !!store.get(afuera.id)], [false, null, true]);
    store.remove(afuera.id);
  }

  seccion('el tope se queda con las NUEVAS, no con las viejas');
  // el bug que Umbra tuvo: con LIMIT sobre un orden ascendente, pasada la cuota
  // todo lo escrito DESPUÉS desaparecía del panel
  const marca = [];
  for (let i = 0; i < 12; i++) marca.push(store.create({ content: `bulk ${i}` }).id);
  const top5 = store.list(5).map((x) => x.content);
  t('devuelve 5', top5.length, 5);
  ok_('son las últimas, no las primeras', top5.includes('bulk 11') && !top5.includes('bulk 0'), JSON.stringify(top5));
  // y salen en orden ascendente para quien las lea de corrido
  t('reordenadas ascendente', top5, ['bulk 7', 'bulk 8', 'bulk 9', 'bulk 10', 'bulk 11']);
  // una fijada entra aunque sea la más vieja, y va arriba
  store.setPinned(marca[0], true);
  t('una fijada vieja entra en el tope, y arriba', store.list(3).map((x) => x.content), ['bulk 0', 'bulk 10', 'bulk 11']);
  store.setPinned(marca[0], false);

  seccion('el filtro por carpeta');
  const f3 = store.createFolder('Filtro');
  const enF3 = store.create({ content: 'adentro', folderId: f3.id });
  t('folderId acota', store.list(50, f3.id).map((x) => x.id), [enF3.id]);
  t('null devuelve solo las sueltas', store.list(500, null).every((x) => x.folder_id === null), true);
  ok_('omitirlo devuelve todo', store.list(500).some((x) => x.folder_id === f3.id));

  seccion('clear vacía las notas pero deja las carpetas');
  const carpetasAntes = store.listFolders().length;
  store.clear();
  t('sin notas', store.count(), 0);
  t('las carpetas quedan', store.listFolders().length, carpetasAntes);

  seccion('la tool de lectura sigue siendo de lectura');
  // Lo que importa no es lo que la descripción diga, sino lo que el ESQUEMA deja
  // llamar. `notepad` entra en READ_ROUND_TOOLS e IDEMPOTENT_TOOLS por NOMBRE: si
  // aceptara escribir, la ronda que borra una nota saldría gratis. Escribir es de
  // notepad_write.
  const defDe = (nombre) => (defs.TOOL_DEFS || []).find((d) => d.name === nombre);
  const defLectura = defDe('notepad');
  const defEscritura = defDe('notepad_write');
  ok_('defs.cjs trae las dos definiciones o ninguna', !!defLectura === !!defEscritura);
  if (defLectura) {
    t('sus parámetros son solo query y limit', Object.keys(defLectura.parameters.properties), ['query', 'limit']);
    ok_('no hay parámetro action', !('action' in defLectura.parameters.properties));
    ok_('deriva la escritura a notepad_write', /notepad_write/.test(defLectura.description));
    ok_('  y ya no nombra a NeonCode', !/NeonCode/.test(defLectura.description), defLectura.description.slice(0, 120));
  } else {
    pendientes.push('el esquema de `notepad` (defs.cjs todavía no la define)');
  }
  ok_('notepad es ronda de lectura; notepad_write no',
    motor.READ_ROUND_TOOLS.has('notepad') && !motor.READ_ROUND_TOOLS.has('notepad_write'));
  ok_('notepad_write no es idempotente', !motor.IDEMPOTENT_TOOLS.has('notepad_write'));
  ok_('  y notepad sí', motor.IDEMPOTENT_TOOLS.has('notepad'));
  t('  una ronda de notepad sola es de lectura; con notepad_write ya no',
    [motor.rondaEsLectura(['notepad']), motor.rondaEsLectura(['notepad', 'notepad_write'])], [true, false]);

  seccion('la tool de escritura: el esquema');
  if (defEscritura) {
    t('las seis acciones', defEscritura.parameters.properties.action.enum,
      ['create', 'edit', 'update', 'move', 'delete', 'restore']);
    ok_('dice que se escribe cuando el usuario lo pide', /only when they ask/.test(defEscritura.description));
    ok_('la primera línea es el título', /first line IS the title/.test(defEscritura.description));
    ok_('el delete avisa de la papelera', /trash/.test(defEscritura.description));
    ok_('  con el plazo del store', defEscritura.description.includes(`trash for ${almacen.TRASH_DIAS} days`));
    t('  solo action es obligatorio', defEscritura.parameters.required, ['action']);
  } else {
    pendientes.push('el esquema de `notepad_write` (defs.cjs todavía no la define)');
  }
  // lo que el chip y el ledger dicen de cada llamada
  t('el resumen de una lectura', [motor.argsDigest('notepad', { query: 'compras' }), motor.argsDigest('notepad', {})],
    ['compras', 'recent notes']);
  t('el resumen de una escritura',
    [motor.argsDigest('notepad_write', { action: 'move', folder: 'Facu' }), motor.argsDigest('notepad_write', { action: 'delete' }), motor.argsDigest('notepad_write', {})],
    ['move · Facu', 'delete', 'write']);
  {
    const guia = guardas.toolGuidance(['notepad', 'notepad_write']);
    ok_('la guía del system prompt explica las dos', /- `notepad`: read the notes/.test(guia) && /- `notepad_write`: create, edit, move or delete/.test(guia));
    ok_('  y ninguna si no están en el turno', !/notepad/.test(guardas.toolGuidance(['fs_read'])));
  }

  seccion('la papelera del store');
  {
    const fT = store.createFolder('Papelera-test');
    const n = store.create({ content: '# Para borrar\nalgo', folderId: fT.id });
    store.setPinned(n.id, true);
    const fila = store.get(n.id);
    const ida = store.trash(n.id);
    t('trash devuelve la nota como estaba', ida.content, '# Para borrar\nalgo');
    t('ya no está en la libreta', store.get(n.id), null);
    t('trash de algo que no existe', store.trash('no-existe'), null);
    const vuelta = store.restore(n.id);
    t('restore la trae con id, pin, carpeta y fechas',
      [vuelta.id, vuelta.pinned, vuelta.folder_id, vuelta.created_at], [fila.id, 1, fT.id, fila.created_at]);
    t('restore dos veces no duplica', store.restore(n.id), null);
    // si su carpeta se borró mientras tanto, vuelve suelta y no a una carpeta fantasma
    store.trash(n.id);
    store.deleteFolder(fT.id);
    t('sin su carpeta vuelve suelta', store.restore(n.id).folder_id, null);
    // la purga: lo recién borrado queda, lo vencido se va
    store.trash(n.id);
    store.purgeTrash(7);
    ok_('lo recién borrado sobrevive la purga', !!store.restore(n.id));
    store.trash(n.id);
    store.purgeTrash(-1); // "más viejo que mañana" = todo
    t('lo vencido se purga', store.restore(n.id), null);
    t('y la libreta no lo cuenta', store.get(n.id), null);
  }

  seccion('la tool: el título de una nota');
  const headline = notas.noteHeadline;
  t('saca el # del título', headline('# Compras\nleche'), 'Compras');
  t('saca la viñeta', headline('- primero\nsegundo'), 'primero');
  t('saca la negrita', headline('**fuerte**'), 'fuerte');
  t('saca el checkbox', headline('[ ] pendiente'), 'pendiente');
  t('saltea las líneas en blanco de arriba', headline('\n\n  real'), 'real');
  t('vacía → Untitled', headline('   '), 'Untitled');
  t('null → Untitled', headline(null), 'Untitled');

  seccion('la tool: la búsqueda');
  notas.configurar({ broadcast });
  ok_('configurar sin dbPath no cierra la base', almacen.count() === 0);
  {
    const runVacia = hacerRun();
    t('avisa que la libreta está vacía', await leer({}, runVacia), 'The notepad is empty.');
    t('  también si se busca algo', await leer({ query: 'leche' }), 'The notepad is empty.');

    const ids = [];
    for (let i = 0; i < 60; i++) ids.push(store.create({ content: `nota ${i}` }).id);
    const todo = await leer({ limit: 999 });
    t('acota el limit a 50', titulos(todo).length, 50);
    ok_('  y dice cuántas hay y cuántas muestra', todo.startsWith("The user's notepad — 60 notes, showing the 50 most recent:\n\n--- nota 59 (id: "), todo.slice(0, 120));
    t('  por defecto son 20', titulos(await leer({})).length, 20);
    t('  un limit que no es un número cae en 20', titulos(await leer({ limit: 'muchas' })).length, 20);
    t('  y el mínimo es 1', titulos(await leer({ limit: -3 })), ['nota 59']);
    t('  sin argumentos', titulos(await notas.runners.notepad(hacerRun())).length, 20);

    t('sin query es browse por recencia', titulos(await leer({ limit: 3 })), ['nota 59', 'nota 58', 'nota 57']);
    // el reverse va por grupo: dando vuelta la lista entera, las fijadas quedaban
    // al fondo y el corte se las comía
    store.setPinned(ids[0], true);
    store.setPinned(ids[7], true);
    t('  con las fijadas arriba, no al fondo', titulos(await leer({ limit: 4 })), ['nota 7', 'nota 0', 'nota 59', 'nota 58']);
    ok_('  y marcadas', /^--- nota 7 \(id: [0-9a-f-]{36} · \d{4}-\d{2}-\d{2} · pinned\)$/m.test(await leer({ limit: 1 })));

    const fL = store.createFolder('Listas');
    const lista1 = store.create({ content: '# Lista del súper\nLeche y PAN', folderId: fL.id });
    store.create({ content: 'leche sola' });
    const runBusca = hacerRun('r9');
    const una = await leer({ query: 'pan  LECHE' }, runBusca);
    t('todas las palabras tienen que estar', titulos(una), ['Lista del súper']);
    ok_('  sin importar el orden ni las mayúsculas, y lo cuenta', una.startsWith('1 note matching "pan leche":\n\n'), una.slice(0, 60));
    t('  cada nota viene con su id, su fecha y su carpeta, y después entera',
      una.split('\n\n')[1].replace(/\d{4}-\d{2}-\d{2}/, 'FECHA'),
      `--- Lista del súper (id: ${lista1.id} · FECHA · folder: Listas)\n# Lista del súper\nLeche y PAN`);
    t('  el chip dice lo que se buscó', runBusca.avisos, [['tool:activity', { reqId: 'r9', kind: 'notepad', label: 'pan  LECHE' }]]);
    ok_('  una sola palabra trae las dos', (await leer({ query: 'leche' })).startsWith('2 notes matching "leche":'));
    t('  lo que no está', await leer({ query: 'yerba mate' }), 'No notes matching "yerba mate".');
    // con query manda el orden del store: las fijadas arriba y después cronológico
    const cinco = await leer({ query: 'nota', limit: 5 });
    ok_('  con query también se acota, y lo dice', cinco.startsWith('60 notes matching "nota", showing 5:'), cinco.slice(0, 60));
    t('  en el orden del store', titulos(cinco), ['nota 0', 'nota 7', 'nota 1', 'nota 2', 'nota 3']);
    {
      const runLee = hacerRun();
      await leer({}, runLee);
      t('  el chip de un browse', runLee.avisos, [['tool:activity', { reqId: 'r1', kind: 'notepad', label: 'read' }]]);
    }

    store.clear();
    for (let i = 0; i < 10; i++) store.create({ content: `larga ${i}\n${'x'.repeat(2000)}` });
    const larga = await leer({});
    t('corta la salida', [larga.length, larga.endsWith('\n…[truncated]')], [12000 + '\n…[truncated]'.length, true]);
    t('leer nunca avisa que algo cambió', [broadcasted.length, runVacia.avisos], [0, []]);
    store.clear();
  }

  seccion('las dos viajan siempre (si la base abrió)');
  // con la libreta vacía `notepad` se escondía; ahora Neo la puede estrenar a mitad
  // de turno, y una tool que aparece entre rondas rompe el thinking de Anthropic
  t('ya no depende de cuántas notas hay', [store.count(), notas.lista()], [0, true]);
  // («se apagan solo sin la base» está más abajo, con la base que no abre)

  // ── notepad_write de verdad: el store real y el runner del módulo ──────────
  // Se llama POR LA TABLA (`runners`), no a runNotepadWrite directo: en la 1.3.1
  // de NeonCode un runner de la tabla tiraba los args y los tests que lo
  // llamaban directo no lo vieron.
  const notified = [];
  const run = { reqId: 'r1', notify: (ch, p) => notified.push({ ch, p }) };
  const w = (a) => notas.runners.notepad_write(run, a);

  seccion('notepad_write: create');
  store.clear();
  broadcasted.length = 0;
  const c1 = await w({ action: 'create', content: '# Compras\n- leche\n- pan', folder: 'Casa' });
  const id1 = idDe(c1);
  ok_('crea y devuelve el id', !!id1 && store.get(id1)?.content === '# Compras\n- leche\n- pan', c1);
  ok_('crea la carpeta que no existía', /new folder/.test(c1) && store.listFolders().some((f) => f.name === 'Casa'), c1);
  const c2 = await w({ action: 'create', content: 'otra', folder: '  casa ' });
  const id2 = idDe(c2);
  t('la carpeta se encuentra sin mayúsculas ni espacios', store.listFolders().filter((f) => /casa/i.test(f.name)).length, 1);
  t('…y la nota cae ahí', store.get(id2).folder_id, store.get(id1).folder_id);
  ok_('sin contenido no crea', /^error: content is required/.test(await w({ action: 'create', content: '  ' })));
  ok_('saca la fence que envuelve todo',
    store.get(idDe(await w({ action: 'create', content: '```md\n# Envuelta\nx\n```' }))).content === '# Envuelta\nx');
  ok_('avisa al panel por broadcast', broadcasted.some((b) => b.ch === 'notes:changed'));
  ok_('el chip dice la acción', notified.some((n) => n.ch === 'tool:activity' && n.p.label === 'create · Compras'),
    JSON.stringify(notified.map((n) => n.p.label)));
  t('  lo que le dice al modelo, entero', c1,
    `Note "Compras" created in folder "Casa" (new folder) (id: ${id1}). The user sees it in the Notepad panel; do not paste it back into your reply.`);
  ok_('  en una carpeta que ya estaba no dice «new folder»', /created in folder "Casa" \(id: /.test(c2), c2);
  ok_('  y sin carpeta lo dice', /created \(no folder\) \(id: /.test(await w({ action: 'create', content: 'suelta' })));
  t('  un aviso por nota creada, ni uno por las que fallaron',
    [broadcasted.map((b) => b.ch), notified.map((n) => n.p.label)],
    [['notes:changed', 'notes:changed', 'notes:changed', 'notes:changed'], ['create · Compras', 'create · otra', 'create · Envuelta', 'create · suelta']]);
  t('  el chip entero', notified[0], { ch: 'tool:activity', p: { reqId: 'r1', kind: 'notepad_write', label: 'create · Compras' } });

  seccion('notepad_write: edit');
  const e1 = await w({ action: 'edit', id: id1, edits: [{ old: '- pan', new: '- pan\n- yerba' }] });
  t('edita un pedazo', store.get(id1).content, '# Compras\n- leche\n- pan\n- yerba');
  ok_('cuenta las líneas', /\+1 -0/.test(e1), e1);
  const e2 = await w({ action: 'edit', id: id1, edits: [{ old: '- leche', new: '- café' }, { old: 'no está', new: 'x' }] });
  ok_('todo o nada: un old que falta no toca la nota', /^error: edit 2 of 2/.test(e2) && store.get(id1).content.includes('- leche'), e2);
  ok_('el error habla de la nota, no de un archivo', /the note/.test(e2) && !/file/.test(e2), e2);
  ok_('edits como string JSON también', !/^error/.test(await w({ action: 'edit', id: id1, edits: JSON.stringify([{ old: '- yerba', new: '- mate' }]) })));
  ok_('no deja una nota vacía', /use action "delete"/.test(await w({ action: 'edit', id: id2, edits: [{ old: 'otra', new: '' }] })));
  t('…y la nota sigue', store.get(id2).content, 'otra');
  ok_('id inventado', /^error: note not found/.test(await w({ action: 'edit', id: 'nada', edits: [{ old: 'a', new: 'b' }] })));
  ok_('sin id pide leer primero', /call notepad first/.test(await w({ action: 'edit', edits: [] })));
  t('  lo que le dice al modelo, entero', e1, 'Note "Compras" edited — 1 edit applied, +1 -0 lines.');
  ok_('  sin edits lo dice', /^error: edits is required to edit a note/.test(await w({ action: 'edit', id: id1 })));
  {
    const ambiguo = await w({ action: 'edit', id: id1, edits: [{ old: '- ', new: '* ' }] });
    ok_('  lo ambiguo falla en vez de elegir', /appears 3 times/.test(ambiguo), ambiguo);
    const todas = await w({ action: 'edit', id: id1, edits: [{ old: '- ', new: '* ' }], replace_all: true });
    t('  y con replace_all las cambia todas', [/^Note "Compras" edited/.test(todas), store.get(id1).content], [true, '# Compras\n* leche\n* pan\n* mate']);
    // el título es la primera línea: si el edit la cambia, el aviso lleva el nuevo
    const renombrada = await w({ action: 'edit', id: id1, edits: [{ old: '# Compras', new: '# Súper' }, { old: '* ', new: '- ', replace_all: true }] });
    ok_('  un edit que cambia la primera línea cambia el título', /^Note "Súper" edited — 2 edits applied/.test(renombrada), renombrada);
    await w({ action: 'edit', id: id1, edits: [{ old: '# Súper', new: '# Compras' }] });
    t('  y la nota quedó como se espera', store.get(id1).content, '# Compras\n- leche\n- pan\n- mate');
  }

  seccion('notepad_write: update y move');
  await w({ action: 'update', id: id2, content: '# Otra\nreescrita' });
  t('update reescribe entera', store.get(id2).content, '# Otra\nreescrita');
  ok_('update vacío no borra', /^error: content is required/.test(await w({ action: 'update', id: id2, content: '' })));
  await w({ action: 'move', id: id2, folder: 'Facu' });
  t('move a una carpeta nueva', store.listFolders().find((f) => f.id === store.get(id2).folder_id)?.name, 'Facu');
  await w({ action: 'move', id: id2, folder: '' });
  t('move con "" la deja suelta', store.get(id2).folder_id, null);
  t('  lo que dice un update', await w({ action: 'update', id: id2, content: '```\n# Otra\nde nuevo\n```' }), 'Note "Otra" rewritten.');
  t('  que también saca la fence', store.get(id2).content, '# Otra\nde nuevo');
  t('  lo que dice un move', await w({ action: 'move', id: id2, folder: 'FACU' }), 'Note "Otra" moved in folder "Facu".');
  t('  y uno que la saca', await w({ action: 'move', id: id2, folder: '  ' }), 'Note "Otra" moved (no folder).');
  ok_('  update y move de un id inventado', /^error: note not found: nada/.test(await w({ action: 'update', id: 'nada', content: 'x' }))
    && /^error: note not found: nada/.test(await w({ action: 'move', id: 'nada', folder: 'Facu' })));
  ok_('  y sin id', /^error: id is required to move a note/.test(await w({ action: 'move', folder: 'Facu' })));

  seccion('notepad_write: delete y restore');
  broadcasted.length = 0;
  notified.length = 0;
  const d1 = await w({ action: 'delete', id: id1 });
  t('delete la saca de la libreta', store.get(id1), null);
  ok_('dice cuántos días y cómo volver', /trash for 7 days/.test(d1) && d1.includes(id1), d1);
  const aviso = broadcasted.find((b) => b.ch === 'notes:deleted');
  t('manda el aviso con id y título', aviso && [aviso.p.id, aviso.p.title], [id1, 'Compras']);
  t('  primero que cambió, después qué se borró, y nada más', broadcasted, [{ ch: 'notes:changed' }, { ch: 'notes:deleted', p: { id: id1, title: 'Compras' } }]);
  t('  el chip del borrado', notified, [{ ch: 'tool:activity', p: { reqId: 'r1', kind: 'notepad_write', label: 'delete · Compras' } }]);
  // el borrado del modelo va a la papelera, nunca a la nada
  t('  quedó en la papelera, no borrada de verdad',
    crudo(DB, (d) => d.prepare('SELECT content FROM notes_trash WHERE id = ?').get(id1)?.content), '# Compras\n- leche\n- pan\n- mate');
  ok_('delete de algo que no existe', /^error: note not found/.test(await w({ action: 'delete', id: id1 })));
  t('  que no avisa nada', [broadcasted.length, notified.length], [2, 1]);
  ok_('  ni la ve ya la tool de lectura', !(await leer({})).includes(id1));
  const r1 = await w({ action: 'restore', id: id1 });
  ok_('restore la trae de vuelta', /restored/.test(r1) && store.get(id1)?.content.startsWith('# Compras'), r1);
  ok_('restore sin nada que restaurar', /^error: no deleted note/.test(await w({ action: 'restore', id: id1 })));
  ok_('acción desconocida', /^error: unknown action: borrar/.test(await w({ action: 'borrar', id: id1 })));
  t('  restore avisa que cambió, y nada más', [broadcasted.map((b) => b.ch), notified.map((n) => n.p.label)],
    [['notes:changed', 'notes:deleted', 'notes:changed'], ['delete · Compras', 'restore · Compras']]);
  ok_('  restore sin id', /^error: id is required to restore a note/.test(await w({ action: 'restore' })));
  ok_('  el error de restore dice cuánto dura la papelera', /the trash keeps them 7 days/.test(await w({ action: 'restore', id: 'nada' })));
  t('  sin acción', await w({ id: id1 }), 'error: unknown action: (none) — use create, edit, update, move, delete or restore');
  t('  sin argumentos', await notas.runners.notepad_write(run), 'error: id is required to change a note — call notepad first to see the ids');

  // ── lo que sigue no estaba en el test de NeonCode ─────────────────────────

  seccion('carpetaDeNota');
  {
    const cuantas = store.listFolders().length;
    t('sin nombre: suelta, y no crea nada', [notas.carpetaDeNota(''), notas.carpetaDeNota(undefined), notas.carpetaDeNota('   ')],
      [{ id: null, name: '', nueva: false }, { id: null, name: '', nueva: false }, { id: null, name: '', nueva: false }]);
    const casa = store.listFolders().find((f) => f.name === 'Casa');
    t('una que existe, con su nombre como está guardado', notas.carpetaDeNota(' CASA '), { id: casa.id, name: 'Casa', nueva: false });
    t('  sin crear ninguna', store.listFolders().length, cuantas);
    const nueva = notas.carpetaDeNota('  Trámites ');
    t('una que no existe se crea, con el nombre recortado', [nueva.name, nueva.nueva, store.listFolders().length], ['Trámites', true, cuantas + 1]);
  }

  // los cuerpos de los handlers IPC del panel
  seccion('ipc');
  {
    const ipc = notas.ipc;
    store.clear();
    broadcasted.length = 0;
    const a = ipc.create({ content: '  # Del panel\ntexto ' });
    t('create devuelve la nota', [a.content, a.pinned, a.folder_id], ['# Del panel\ntexto', 0, null]);
    t('  vacía o sin nada: null', [ipc.create({ content: '  ' }), ipc.create({}), ipc.create()], [null, null, null]);
    const carpeta = ipc.foldersCreate('  Panel ');
    t('foldersCreate devuelve la carpeta', [carpeta.name, typeof carpeta.id, typeof carpeta.position], ['Panel', 'string', 'number']);
    const b = ipc.create({ content: 'en carpeta', folderId: carpeta.id });
    t('create con carpeta', b.folder_id, carpeta.id);
    t('list las trae enteras, en el orden del store', ipc.list().map((n) => [n.id, n.content]), [[a.id, '# Del panel\ntexto'], [b.id, 'en carpeta']]);
    t('update', [ipc.update({ id: a.id, content: '# Del panel\ncambiada' }), store.get(a.id).content], [true, '# Del panel\ncambiada']);
    t('  vacío o sin nada: false, y la nota queda', [ipc.update({ id: a.id, content: ' ' }), ipc.update({ content: 'x' }), ipc.update(), store.get(a.id).content],
      [false, false, false, '# Del panel\ncambiada']);
    t('pin', [ipc.pin({ id: a.id, pinned: true }), store.get(a.id).pinned, ipc.pin({ id: a.id, pinned: false }), store.get(a.id).pinned, ipc.pin()], [true, 1, true, 0, false]);
    t('setFolder', [ipc.setFolder({ id: a.id, folderId: carpeta.id }), store.get(a.id).folder_id, ipc.setFolder({ id: a.id, folderId: null }), store.get(a.id).folder_id, ipc.setFolder()],
      [true, carpeta.id, true, null, false]);
    t('foldersList', ipc.foldersList().some((f) => f.id === carpeta.id && f.name === 'Panel'), true);
    t('foldersRename', [ipc.foldersRename({ id: carpeta.id, name: 'Del panel' }), ipc.foldersList().find((f) => f.id === carpeta.id).name, ipc.foldersRename()], [true, 'Del panel', false]);
    // [BlackCode] desde el 27/11/2026 la carpeta se va CON sus notas (pedido
    // de Fran), para siempre como el borrado del usuario. (b sale antes: la
    // usa lo que sigue.)
    ipc.setFolder({ id: b.id, folderId: null });
    const c = ipc.create({ content: 'se va con la carpeta', folderId: carpeta.id });
    t('foldersDelete se lleva sus notas', [ipc.foldersDelete(carpeta.id), ipc.foldersList().some((f) => f.id === carpeta.id), store.get(c.id), store.get(b.id)?.folder_id, ipc.foldersDelete()],
      [true, false, null, null, false]);
    t('  de verdad: no quedan en la papelera', [store.restore(c.id), crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes_trash WHERE id = ?').get(c.id).n)], [null, 0]);

    // el borrado del panel es el del USUARIO: permanente, sin papelera
    t('remove borra', [ipc.remove(b.id), store.get(b.id)], [true, null]);
    t('  de verdad: no queda en la papelera', [store.restore(b.id), crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes_trash WHERE id = ?').get(b.id).n)], [null, 0]);
    t('  uno que no existe, o sin id: false', [ipc.remove(b.id), ipc.remove()], [false, false]);
    t('nada de lo anterior avisa: el panel ya sabe lo que hizo', broadcasted, []);

    // el Restore del aviso, cuando el que borró fue el modelo
    await w({ action: 'delete', id: a.id });
    broadcasted.length = 0;
    const vuelta = ipc.restore(a.id);
    t('restore devuelve la nota que borró el modelo', [vuelta?.id, vuelta?.content], [a.id, '# Del panel\ncambiada']);
    t('  y avisa que la libreta cambió', broadcasted, [{ ch: 'notes:changed' }]);
    t('  sin nada que restaurar: null, y no avisa', [ipc.restore(a.id), ipc.restore('nada'), ipc.restore(), broadcasted.length], [null, null, null, 1]);

    const carpetas = ipc.foldersList().length;
    t('clear vacía las notas y deja las carpetas', [ipc.clear(), store.count(), ipc.foldersList().length], [true, 0, carpetas]);
    t('  y list queda vacía', ipc.list(), []);
    t('  sin avisar tampoco', broadcasted.length, 1);
  }

  // broadcast llega por configurar()
  seccion('lo que llega por configurar');
  {
    broadcasted.length = 0;
    notas.configurar({ broadcast: () => { throw new Error('no hay ventana'); } });
    const cr = await w({ action: 'create', content: '# Aviso roto\nx' });
    const idRoto = idDe(cr);
    ok_('un broadcast que tira no voltea el create', /^Note "Aviso roto" created/.test(cr) && !!store.get(idRoto), cr);
    ok_('  ni el delete', /^Note "Aviso roto" deleted/.test(await w({ action: 'delete', id: idRoto })) && store.get(idRoto) === null);
    t('  ni el restore del panel', notas.ipc.restore(idRoto)?.id, idRoto);
    t('  y al de antes no le llegó nada', broadcasted.length, 0);
    notas.configurar({ broadcast });
    await w({ action: 'move', id: idRoto, folder: 'Casa' });
    t('de vuelta enchufado, llega', broadcasted, [{ ch: 'notes:changed' }]);
    notas.configurar({ broadcast: null });
    ok_('sin broadcast, las tools andan igual', /^Note "Aviso roto" rewritten/.test(await w({ action: 'update', id: idRoto, content: '# Aviso roto\ny' })));
    t('  y null lo desenchufa: al de antes ya no le llega', broadcasted.length, 1);
    notas.configurar({ broadcast });
    notas.configurar({ broadcast: 'esto no es una función' });
    ok_('algo que no es una función vale como ninguno', /^Note "Aviso roto" moved/.test(await w({ action: 'move', id: idRoto, folder: '' })));
    t('  tampoco llega', broadcasted.length, 1);
    notas.configurar({ broadcast });
    notas.configurar({});
    await w({ action: 'move', id: idRoto, folder: 'Casa' });
    t('configurar sin la llave broadcast no lo desenchufa', broadcasted.length, 2);
  }

  // mandar a la papelera, restaurar y borrar una carpeta son todo o nada
  seccion('todo o nada');
  {
    store.clear();
    const carpeta = store.createFolder('Atómica');
    const n = store.create({ content: '# Intocable\nx', folderId: carpeta.id });
    // un gatillo que no deja borrar de `notes`: el INSERT en la papelera pasa y
    // el DELETE falla, que es el corte que la transacción tiene que deshacer
    crudo(DB, (d) => d.exec("CREATE TRIGGER no_borrar BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT, 'no se puede borrar'); END"));
    ok_('trash que falla a mitad de camino tira', /no se puede borrar/.test(tira(() => store.trash(n.id))));
    t('  la nota sigue en la libreta', store.get(n.id)?.content, '# Intocable\nx');
    t('  y NO quedó además en la papelera', [store.restore(n.id), crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes_trash').get().n)], [null, 0]);
    broadcasted.length = 0;
    const fallo = await w({ action: 'delete', id: n.id });
    ok_('la tool lo cuenta como error, sin tirar', /^error: the notepad could not be written: .*no se puede borrar/.test(fallo), fallo);
    t('  y no avisa que borró nada', broadcasted, []);
    crudo(DB, (d) => d.exec('DROP TRIGGER no_borrar'));

    // al revés: la nota ya está en la papelera y no se puede volver a insertar
    store.trash(n.id);
    crudo(DB, (d) => d.exec("CREATE TRIGGER no_sacar BEFORE DELETE ON notes_trash BEGIN SELECT RAISE(ABORT, 'no se puede sacar'); END"));
    ok_('restore que falla a mitad de camino tira', /no se puede sacar/.test(tira(() => store.restore(n.id))));
    t('  la nota NO volvió a medias a la libreta', [store.get(n.id), store.count()], [null, 0]);
    t('  el restore del panel da null', notas.ipc.restore(n.id), null);
    crudo(DB, (d) => d.exec('DROP TRIGGER no_sacar'));
    t('  y sin el gatillo vuelve entera, a su carpeta', [store.restore(n.id)?.content, store.get(n.id)?.folder_id], ['# Intocable\nx', carpeta.id]);

    crudo(DB, (d) => d.exec("CREATE TRIGGER no_carpeta BEFORE DELETE ON note_folders BEGIN SELECT RAISE(ABORT, 'no se puede la carpeta'); END"));
    ok_('deleteFolder que falla a mitad de camino tira', /no se puede la carpeta/.test(tira(() => store.deleteFolder(carpeta.id))));
    t('  y la nota NO quedó suelta: sigue en su carpeta', store.get(n.id).folder_id, carpeta.id);
    t('  el del panel da false', notas.ipc.foldersDelete(carpeta.id), false);
    t('  y sus notas NO se borraron a medias', store.get(n.id)?.folder_id, carpeta.id);
    crudo(DB, (d) => d.exec('DROP TRIGGER no_carpeta'));
    t('después de los tres fallos la base sigue escribiendo', [store.deleteFolder(carpeta.id), store.get(n.id).folder_id, !!store.create({ content: 'otra más' })], [true, null, true]);
    notas.cerrar();
    t('  y lo escrito llegó al archivo', crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes').get().n), 2);
  }

  // la base: cerrar, reabrir, cambiar de archivo, y una que no abre
  seccion('la base');
  let idFijo;
  {
    store.clear();
    idFijo = store.create({ content: '# Fija\nqueda' }).id;
    const carpetas = store.listFolders().length;
    notas.cerrar();
    notas.cerrar();
    ok_('cerrar dos veces no tira', true);
    ok_('cerrar() suelta el archivo', sePuedeMover(DB));
    ok_('  y el store a secas queda cerrado', /not initialized/.test(tira(() => almacen.get(idFijo))));
    t('el uso siguiente la reabre con todo', [store.get(idFijo).content, store.count(), store.listFolders().length], ['# Fija\nqueda', 1, carpetas]);
    notas.cerrar();
    ok_('la tool de lectura también la reabre', (await leer({})).includes(idFijo));
    notas.cerrar();
    ok_('y la de escritura', /^Note "Fija" rewritten/.test(await w({ action: 'update', id: idFijo, content: '# Fija\nsigue' })));
    notas.cerrar();
    t('y el panel', notas.ipc.list().map((n) => n.id), [idFijo]);
    notas.cerrar();
    t('y lista()', [notas.lista(), tira(() => almacen.count())], [true, '']);
    notas.configurar({});
    t('configurar sin dbPath no cambia de base', store.count(), 1);

    const OTRA = path.join(DATOS, 'otra-notes.db');
    notas.configurar({ dbPath: () => OTRA });
    ok_('configurar otra ruta no la abre todavía', !fs.existsSync(OTRA));
    ok_('  y suelta la anterior', sePuedeMover(DB));
    t('  la tool ya trabaja sobre la nueva', await leer({}), 'The notepad is empty.');
    ok_('  que se creó ahí', fs.existsSync(OTRA));
    t('  y no ve nada de la otra', store.get(idFijo), null);
  }
  {
    const antesAvisos = avisosConsola.length;
    notas.configurar({ dbPath: () => path.join(TMP, 'no-existe', 'notes.db') });
    t('una carpeta que no existe: la tool de lectura lo dice', await leer({}), 'error: the notepad is unavailable');
    t('  y la de escritura', await w({ action: 'create', content: 'x' }), 'error: the notepad is unavailable');
    t('se apagan solo sin la base', notas.lista(), false);
    const ipc = notas.ipc;
    t('  el panel queda vacío en vez de explotar: cada función da su valor de fallback',
      [ipc.list(), ipc.create({ content: 'x' }), ipc.update({ id: 'a', content: 'x' }), ipc.remove('a'), ipc.pin({ id: 'a', pinned: true }),
        ipc.setFolder({ id: 'a', folderId: null }), ipc.restore('a'), ipc.clear(), ipc.foldersList(), ipc.foldersCreate('x'),
        ipc.foldersRename({ id: 'a', name: 'x' }), ipc.foldersDelete('a')],
      [[], null, false, false, false, false, null, false, [], null, false, false]);
    ok_('  `store` tira, que es lo que esas funciones atajan', /not initialized/.test(tira(() => store.list())));
    ok_('  y no crea la carpeta', !fs.existsSync(path.join(TMP, 'no-existe')));
    t('  se intentó abrir UNA vez, no una por uso', avisosConsola.length - antesAvisos, 1);
    ok_('  y lo dijo por consola', /\[notes\] no se pudo abrir notes\.db/.test(avisosConsola[antesAvisos] || ''), avisosConsola[antesAvisos]);
  }
  {
    const BASURA = path.join(DATOS, 'basura.db');
    fs.writeFileSync(BASURA, 'esto no es una base, ni cerca '.repeat(60));
    const antesAvisos = avisosConsola.length;
    notas.configurar({ dbPath: () => BASURA });
    t('un archivo que no es SQLite: la tool lo dice', await leer({}), 'error: the notepad is unavailable');
    t('  avisó una vez', avisosConsola.length - antesAvisos, 1);
    ok_('  no quedó nada a medio abrir', sePuedeMover(BASURA));
    ok_('  ni un store que parezca abierto', /not initialized/.test(tira(() => almacen.list())));
    t('  y el archivo queda como estaba', fs.readFileSync(BASURA, 'utf8').length, 30 * 60);
  }
  {
    notas.configurar({ dbPath: () => DB });
    t('de vuelta a la primera, con todo', [notas.lista(), store.get(idFijo).content], [true, '# Fija\nsigue']);
    // lo vencido de la papelera se purga al abrir, no hace falta que nadie llame a purgeTrash
    const vieja = store.create({ content: 'de hace mucho' });
    const reciente = store.create({ content: 'de recién' });
    store.trash(vieja.id);
    store.trash(reciente.id);
    crudo(DB, (d) => d.prepare("UPDATE notes_trash SET deleted_at = datetime('now', '-8 days') WHERE id = ?").run(vieja.id));
    crudo(DB, (d) => d.prepare("UPDATE notes_trash SET deleted_at = datetime('now', '-6 days') WHERE id = ?").run(reciente.id));
    t('vencida pero todavía sin purgar: sigue en la papelera', crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes_trash').get().n), 2);
    notas.cerrar();
    t('al reabrir, lo vencido ya no está y lo de hace seis días sí', [store.restore(vieja.id), store.restore(reciente.id)?.content], [null, 'de recién']);
    t('  ni en el archivo', crudo(DB, (d) => d.prepare('SELECT count(*) AS n FROM notes_trash').get().n), 0);
  }

  // el transaction() que se le sumó al adaptador de sqlite.cjs para el store
  seccion('el adaptador: transaction');
  {
    ok_('Database se puede pedir a sqlite.cjs', typeof sqlite.Database === 'function');
    t('  sin sumarse a lo que el módulo lista', Object.keys(sqlite).sort(), ['cerrar', 'configurar', 'runners']);
    const d = new sqlite.Database(path.join(DATOS, 'adaptador.db'));
    try {
      d.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT)');
      const cuenta = () => d.prepare('SELECT count(*) AS n FROM t').get().n;
      const poner = d.transaction((a, b) => {
        d.prepare('INSERT INTO t VALUES (?, ?)').run(a, b);
        d.prepare('INSERT INTO t VALUES (?, ?)').run(a + 1, b);
        return `puse ${a} y ${a + 1}`;
      });
      t('transaction() no corre nada: devuelve la función', [typeof poner, cuenta()], ['function', 0]);
      t('al llamarla corre, con sus argumentos, y devuelve lo que devolvió', [poner(1, 'uno'), cuenta()], ['puse 1 y 2', 2]);
      t('  y se puede volver a llamar', [poner(3, 'tres'), cuenta()], ['puse 3 y 4', 4]);
      t('  lo escrito quedó confirmado: lo ve otra conexión',
        crudo(path.join(DATOS, 'adaptador.db'), (c) => c.prepare('SELECT count(*) AS n FROM t').get().n), 4);

      // la segunda fila choca con la clave: la primera tiene que deshacerse
      t('si la función tira, sale el mismo error', /UNIQUE constraint failed/.test(tira(() => poner(0, 'cero'))), true);
      t('  y no queda nada de lo que había escrito', [cuenta(), d.prepare('SELECT a FROM t WHERE a = 0').get()], [4, undefined]);
      const mio = new Error('me arrepentí');
      let atrapado = null;
      try { d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(50, 'x'); throw mio; })(); } catch (e) { atrapado = e; }
      ok_('  un error propio vuelve tal cual, el mismo objeto', atrapado === mio);
      t('  con lo suyo deshecho', cuenta(), 4);
      t('  y la base no queda adentro de una transacción', [tira(() => d.exec('BEGIN')), tira(() => d.exec('COMMIT'))], ['', '']);

      // una adentro de otra: la de adentro se deshace sola
      const afuera = d.transaction(() => {
        d.prepare('INSERT INTO t VALUES (?, ?)').run(60, 'afuera');
        try {
          d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(61, 'adentro'); throw new Error('solo la de adentro'); })();
        } catch { /* la de afuera sigue */ }
        d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(62, 'adentro y queda'); })();
        return 'listo';
      });
      t('anidadas: la de adentro que tira se deshace sola y la de afuera se confirma',
        [afuera(), d.prepare('SELECT a FROM t WHERE a >= 60 ORDER BY a').all().map((r) => r.a)], ['listo', [60, 62]]);
      t('  y si la que tira es la de afuera se va todo',
        [tira(() => d.transaction(() => { d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(70, 'x'); })(); throw new Error('todo'); })()), cuenta()], ['todo', 6]);

      t('lo que no es una función es un TypeError', tira(() => d.transaction('BEGIN')), 'Expected first argument to be a function');
      t('una función que devuelve una promesa también', tira(() => d.transaction(async () => { d.prepare('INSERT INTO t VALUES (?, ?)').run(80, 'x'); })()),
        'Transaction function cannot return a promise');
      t('  y se deshace', cuenta(), 6);
      // un error de los que hacen que SQLite deshaga la transacción entera por su cuenta
      d.exec("CREATE TRIGGER fuera BEFORE INSERT ON t WHEN NEW.b = 'fuera' BEGIN SELECT RAISE(ROLLBACK, 'la deshizo sqlite'); END");
      t('si SQLite ya la deshizo, sale ese error y no otro por deshacer dos veces',
        tira(() => d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(90, 'x'); d.prepare('INSERT INTO t VALUES (?, ?)').run(91, 'fuera'); })()), 'la deshizo sqlite');
      t('  y la siguiente anda', [d.transaction(() => { d.prepare('INSERT INTO t VALUES (?, ?)').run(92, 'x'); return 1; })(), cuenta()], [1, 7]);
      t('run().changes sigue contando bien adentro de una', d.transaction(() => d.prepare('UPDATE t SET b = ? WHERE a >= ?').run('z', 60).changes)(), 3);
    } finally {
      d.close();
    }
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  console.warn = warnOriginal;
  try { notas.cerrar(); } catch { /* ya estaba cerrada */ }
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (fs.existsSync(TMP)) failures.push('[limpieza] la carpeta temporal no se pudo borrar: quedó una base abierta');

if (failures.length) {
  console.error(`test-blackcode-tools-notas: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-notas: ok (${hechas} comprobaciones: cableado, el store con sus notas y carpetas, el tope, el filtro, clear, que la de lectura sea de lectura, la papelera, el título, la búsqueda y notepad_write con create, edit, update, move, delete y restore, que son las de NeonCode; más carpetaDeNota, las doce funciones de ipc, lo que llega por configurar, todo o nada, la base que se abre sola, se cierra, se cambia y no abre, y el transaction del adaptador)`);
if (pendientes.length) console.log(`  pendiente, se comprueba solo cuando esté: ${pendientes.join('; ')}`);
process.exit(0);
