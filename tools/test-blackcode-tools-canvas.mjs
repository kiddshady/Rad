// Test de la tool `canvas` de BlackCode (apps/BlackCode/main/tools/canvas.cjs) y de su
// store (canvas-store.cjs), con node pelado. Uso: node tools/test-blackcode-tools-canvas.mjs
//
// Corre igual con el node de Electron, que es donde van a vivir de verdad:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tools/test-blackcode-tools-canvas.mjs
// Con node 22 aparece un aviso de que node:sqlite es experimental; en el de
// Electron 44 (Node 24) no.
//
// Son las comprobaciones de scripts/test-canvas.js de NeonCode 1.11.3, en el
// mismo orden y con los mismos nombres. Allá el store se probaba de verdad y la
// lógica de la tool se sacaba del TEXTO de main.js con expresiones regulares
// (no tenía exports); acá todo se importa del módulo, así que lo que se prueba
// es lo que la app va a cargar. El saneo del nombre al exportar se probaba sin
// la extensión; acá nombreDeExport devuelve el nombre entero.
//
// Lo que se suma, porque es lo que cambió al portar:
//   - que la base se abra sola en el primer uso, también desde `store` (lo que
//     usan los handlers IPC), y no antes;
//   - cerrar(), cambiar de base con configurar({ dbPath }) y una base que no
//     se puede abrir: un solo intento, nada a medio abrir y ninguna carpeta
//     creada;
//   - una base vieja sin la columna de la papelera, y la purga al abrir;
//   - listarTodos, guardar y nombreDeExport (los cuerpos de tres handlers);
//   - titulosDeChats y broadcast inyectados, sin configurar y fallando;
//   - los avisos a la interfaz (tool:activity y canvas:opened);
//   - y el get() que hubo que sumarle al adaptador de sqlite.cjs.
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
const canvas = require(path.join(TOOLS, 'canvas.cjs'));
const almacen = require(path.join(TOOLS, 'canvas-store.cjs')); // el store a secas, sin la apertura adelante
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
const tira = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message || e); } };

// ── la carpeta descartable ───────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-canvas-'));
const DATOS = path.join(TMP, 'datos'); // donde vive canvas.db
fs.mkdirSync(DATOS, { recursive: true });
const DB = path.join(DATOS, 'canvas.db');

const hacerRun = (convoId, reqId = 'r1') => {
  const run = { reqId, ac: new AbortController(), convoId, cwd: TMP, steps: [], avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};
const runCanvas = (run, args) => canvas.runners.canvas(run, args);
const store = canvas.store;

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

// lo que el módulo avisa por consola cuando no puede abrir la base
const avisosConsola = [];
const warnOriginal = console.warn;
console.warn = (...a) => { avisosConsola.push(a.map(String).join(' ')); };

// el borrado avisa por broadcast (llega aunque el turno sea headless): se anota
const broadcasted = [];
// los títulos de chat del list "all" salen de la app; acá, un mapa fijo
const titulosDeChats = async () => new Map([['chat-A', 'Chat A'], ['chat-B', 'Chat B']]);
const broadcast = (ch, p) => broadcasted.push({ ch, p });

try {
  // ── el cableado ────────────────────────────────────────────────────────────
  seccion('cableado');
  t('lo que exporta canvas.cjs', Object.keys(canvas).sort(), [
    'runners', 'configurar', 'cerrar', 'store',
    'canvasBlock', 'canvasPreview', 'unwrapOuterFence', 'lightCanvasRow', 'canvasDescriptor', 'LANG_EXT',
    'listarTodos', 'guardar', 'nombreDeExport',
  ].sort());
  t('los runners', Object.keys(canvas.runners), ['canvas']);
  t('lo que exporta canvas-store.cjs', Object.keys(almacen).sort(), [
    'init', 'close', 'create', 'get', 'update', 'listByConversation', 'listAll',
    'remove', 'trash', 'restore', 'listTrash', 'purgeTrash', 'orphanConversation', 'TRASH_DIAS',
  ].sort());
  t('`store` es el store sin init ni close', Object.keys(store).sort(), [
    'create', 'get', 'update', 'listByConversation', 'listAll',
    'remove', 'trash', 'restore', 'listTrash', 'purgeTrash', 'orphanConversation', 'TRASH_DIAS',
  ].sort());
  t('la papelera dura 7 días', [almacen.TRASH_DIAS, store.TRASH_DIAS], [7, 7]);
  canvas.cerrar();
  ok_('cerrar sin nada abierto no tira', true);
  canvas.configurar({ dbPath: () => DB });
  ok_('la base no se abre al configurar', !fs.existsSync(DB));
  ok_('el store a secas, cerrado, tira', /not initialized/.test(tira(() => almacen.get('x'))));

  // ── store ──────────────────────────────────────────────────────────────────
  seccion('store');
  const c1 = store.create({ conversationId: 'chat-A', title: '  Informe  ', content: '# Hola' });
  ok_('el primer uso de `store` abre la base, sin que nadie haya corrido la tool', fs.existsSync(DB));
  t('  en WAL', crudo(DB, (d) => d.prepare('PRAGMA journal_mode').get().journal_mode), 'wal');
  t('create devuelve el canvas entero', [c1.title, c1.kind, c1.version, c1.content], ['Informe', 'document', 1, '# Hola']);
  t('el título se recorta', c1.title, 'Informe');
  ok_('id es uuid', /^[0-9a-f-]{36}$/.test(c1.id));

  t('kind inválido cae en document', store.create({ conversationId: 'chat-A', kind: 'video' }).kind, 'document');
  t('kind code se respeta', store.create({ conversationId: 'chat-A', kind: 'code', language: 'python' }).kind, 'code');
  t('sin título → Untitled', store.create({ conversationId: 'chat-A' }).title, 'Untitled');

  const c1b = store.update(c1.id, { content: '# Hola v2' });
  t('update sube la versión', [c1b.version, c1b.content], [2, '# Hola v2']);
  t('update sin título conserva el viejo', c1b.title, 'Informe');
  t('update de un id inexistente → null', store.update('no-existe', { content: 'x' }), null);

  // la edición del usuario es update SIN language (saveUserEdit era una copia
  // línea por línea de update y se unificó): el kind/lenguaje queda como lo
  // definió quien lo creó, que era toda la promesa de la función que se fue
  const c1c = store.update(c1.id, { content: 'editado a mano', title: 'Nuevo nombre' });
  t('la edición del usuario sube versión y cambia título', [c1c.version, c1c.title, c1c.content], [3, 'Nuevo nombre', 'editado a mano']);
  t('y NO toca kind ni language', [c1c.kind, c1c.language], [c1.kind, c1.language]);

  const codeC = store.create({ conversationId: 'chat-B', kind: 'code', language: 'sql', content: 'SELECT 1' });
  t('listByConversation solo trae los de ese chat', store.listByConversation('chat-B').map((x) => x.id), [codeC.id]);
  ok_('la lista NO trae el cuerpo', store.listByConversation('chat-B')[0].content === undefined);
  t('listByConversation sin id → vacío', store.listByConversation(null), []);
  t('listAll los trae todos', store.listAll().length, 5);
  // (countByConversation se fue: solo la llamaba este test, y el aviso de "los
  // canvas quedan en la biblioteca" al borrar un chat sale de canvas:list)

  seccion('borrar y huérfanos');
  const tmp = store.create({ conversationId: 'chat-C', content: 'x' });
  t('remove con la conversación correcta borra', store.remove(tmp.id, 'chat-C'), true);
  t('y ya no está', store.get(tmp.id), null);
  const tmp2 = store.create({ conversationId: 'chat-C', content: 'x' });
  t('remove con OTRA conversación no borra', store.remove(tmp2.id, 'chat-Z'), false);
  ok_('sigue estando', !!store.get(tmp2.id));

  t('orphanConversation suelta los del chat', store.orphanConversation('chat-B'), 1);
  t('el canvas sobrevive al borrado del chat', store.get(codeC.id).conversation_id, null);
  ok_('y sigue apareciendo en la biblioteca', store.listAll().some((x) => x.id === codeC.id));

  seccion('unwrapOuterFence (la manía de envolver todo en ```)');
  const unwrap = canvas.unwrapOuterFence;
  t('desenvuelve el cuerpo entero envuelto', unwrap('```markdown\n# Título\ntexto\n```'), '# Título\ntexto');
  t('sin lenguaje también', unwrap('```\nhola\n```'), 'hola');
  t('un doc con código ADENTRO no se toca',
    unwrap('# Doc\n\n```js\nx()\n```\n\nfin'), '# Doc\n\n```js\nx()\n```\n\nfin');
  t('dos bloques y nada más: tampoco se toca',
    unwrap('```js\na()\n```\n```js\nb()\n```'), '```js\na()\n```\n```js\nb()\n```');
  t('texto normal pasa igual', unwrap('hola'), 'hola');
  t('vacío', unwrap(''), '');

  seccion('lightCanvasRow y canvasDescriptor');
  t('lightCanvasRow saca el cuerpo y nada más', canvas.lightCanvasRow({ id: 'i', title: 'T', content: 'cuerpo' }), { id: 'i', title: 'T' });
  t('canvasDescriptor de un documento', canvas.canvasDescriptor({ title: 'T', id: 'i', kind: 'document', language: null, version: 1 }), '"T" (id: i, document, version 1)');
  t('canvasDescriptor de código, con su lenguaje', canvas.canvasDescriptor({ title: 'T', id: 'i', kind: 'code', language: 'js', version: 3 }), '"T" (id: i, code/js, version 3)');

  // ── la tool ────────────────────────────────────────────────────────────────
  seccion('la tool');
  canvas.configurar({ titulosDeChats, broadcast });
  ok_('configurar sin dbPath no cierra la base', !!almacen.get(c1.id));

  const runA = hacerRun('chat-A');
  const runB = hacerRun('chat-B');

  const created = await runCanvas(runA, { action: 'create', title: 'Plan', content: '## Plan\ncosas' });
  ok_('create confirma sin repetir el cuerpo', created.includes('created') && !created.includes('cosas'), created);
  ok_('create le dice que NO pegue el contenido', /do NOT paste/i.test(created));
  const newId = created.match(/id: ([0-9a-f-]{36})/)[1];

  ok_('create avisa al renderer para abrir el panel',
    runA.avisos.some(([ch, p]) => ch === 'canvas:opened' && p.canvas.id === newId));
  t('  primero la actividad, después el panel', runA.avisos.map(([ch]) => ch), ['tool:activity', 'canvas:opened']);
  t('  la actividad lleva el título', runA.avisos[0][1], { reqId: 'r1', kind: 'canvas', label: 'Plan' });
  {
    const p = runA.avisos[1][1];
    t('  y el panel recibe el pedido, el chat y el canvas ENTERO',
      [p.reqId, p.convoId, p.canvas.title, p.canvas.content, p.canvas.version, p.canvas.conversation_id],
      ['r1', 'chat-A', 'Plan', '## Plan\ncosas', 1, 'chat-A']);
  }

  t('create sin contenido falla', await runCanvas(runA, { action: 'create' }), 'error: content is required to create a canvas');

  const read = await runCanvas(runA, { action: 'read', id: newId });
  ok_('read trae el cuerpo entero', read.includes('## Plan\ncosas'), read);
  // read es el único lugar donde el modelo se entera de cómo revisar, así que
  // tiene que mandarlo al parche parcial y no a reescribir el documento entero
  ok_('read manda a editar por fragmentos', /action "edit"/.test(read), read.slice(0, 200));
  ok_('  y le dice explícitamente que no devuelva todo', /not send the whole document/i.test(read));
  t('read sin id falla', await runCanvas(runA, { action: 'read' }), 'error: id is required to read a canvas');

  // el guard que importa: un id de OTRO chat no se lee ni se escribe
  t('read de otra conversación → no encontrado', await runCanvas(runB, { action: 'read', id: newId }), `error: canvas not found: ${newId}`);
  t('update de otra conversación → no encontrado', await runCanvas(runB, { action: 'update', id: newId, content: 'hackeado' }), `error: canvas not found: ${newId}`);
  t('y el contenido quedó intacto', store.get(newId).content, '## Plan\ncosas');
  t('  sin avisarle nada a la interfaz', runB.avisos, []);

  const upd = await runCanvas(runA, { action: 'update', id: newId, content: '## Plan v2' });
  ok_('update confirma la versión nueva', upd.includes('version 2'), upd);
  t('y persistió', store.get(newId).content, '## Plan v2');
  t('update sin id falla', await runCanvas(runA, { action: 'update', content: 'x' }), 'error: id is required to update a canvas');

  const fenced = await runCanvas(runA, { action: 'create', title: 'Envuelto', content: '```md\n# Adentro\n```' });
  const fencedId = fenced.match(/id: ([0-9a-f-]{36})/)[1];
  t('create desenvuelve la fence externa', store.get(fencedId).content, '# Adentro');

  const list = await runCanvas(runA, { action: 'list' });
  ok_('list enumera con ids', list.includes(newId) && list.includes('Plan'), list);
  ok_('list NO trae cuerpos', !list.includes('## Plan v2'));
  const runVacio = hacerRun('chat-vacio');
  const vacio = await runCanvas(runVacio, { action: 'list' });
  ok_('list en un chat sin canvas lo dice', /^No canvases are open in this conversation yet\./.test(vacio), vacio);
  ok_('  y apunta a la biblioteca entera', /scope "all"/.test(vacio), vacio);
  t('  la actividad de un list', runVacio.avisos, [['tool:activity', { reqId: 'r1', kind: 'canvas', label: 'list' }]]);

  // el caso que motivó el scope: desde un chat nuevo, la biblioteca era invisible
  const runBiblio = hacerRun('chat-vacio');
  const biblio = await runCanvas(runBiblio, { action: 'list', scope: 'all' });
  ok_('list "all" desde un chat sin canvas ve la biblioteca', biblio.includes(newId) && biblio.includes(codeC.id), biblio.slice(0, 200));
  ok_('  dice de qué chat es cada uno', /chat "Chat A"/.test(biblio), biblio.slice(0, 300));
  ok_('  y marca los de chats borrados', /its chat was deleted/.test(biblio), biblio.slice(0, 300));
  ok_('  sin cuerpos', !biblio.includes('## Plan v2'));
  t('  la actividad de la biblioteca', runBiblio.avisos, [['tool:activity', { reqId: 'r1', kind: 'canvas', label: 'library' }]]);
  ok_('  desde el chat A, los suyos son «this chat»', /— this chat, updated/.test(await runCanvas(hacerRun('chat-A'), { action: 'list', scope: 'all' })));

  t('acción desconocida', await runCanvas(runA, { action: 'borrar' }), 'error: unknown action: borrar');
  t('sin argumentos', await canvas.runners.canvas(hacerRun('chat-A')), 'error: unknown action: undefined');

  // ── delete: a la papelera, nunca a la nada ────────────────────────────────
  // En modo auto nadie aprueba esta llamada, así que lo que el modelo borra
  // tiene que poder volver. Y el acotamiento por chat es el mismo de read/edit.
  seccion('canvas delete (papelera)');
  const victima = await runCanvas(runA, { action: 'create', title: 'Borrador viejo', content: 'texto que importa' });
  const vId = victima.match(/id: ([0-9a-f-]{36})/)[1];

  t('delete sin id falla', await runCanvas(runA, { action: 'delete' }), 'error: id is required to delete a canvas');
  t('delete de un id que no existe → no encontrado', await runCanvas(runA, { action: 'delete', id: 'no-existe' }), 'error: canvas not found: no-existe');

  // borrar SÍ cruza de chat (a diferencia de read/edit): es el pedido de limpiar
  // la biblioteca desde un chat cualquiera, y lo borrado vuelve de la papelera
  const deOtro = store.create({ conversationId: 'chat-B', title: 'Del chat B', content: 'b' });
  ok_('delete desde OTRA conversación borra igual', /"Del chat B" deleted/.test(await runCanvas(runA, { action: 'delete', id: deOtro.id })));
  t('  y quedó en la papelera, no borrado de verdad', !!store.restore(deOtro.id), true);

  const borrado = await runCanvas(runA, { action: 'delete', id: vId });
  ok_('delete confirma y nombra el canvas', /"Borrador viejo" deleted/.test(borrado), borrado);
  ok_('  y le avisa al modelo que se puede restaurar', /trash/.test(borrado) && /restore/.test(borrado), borrado);
  ok_('  con el plazo de la papelera', /for 7 days/.test(borrado), borrado);
  t('  ya no se lee', store.get(vId), null);
  ok_('  ni aparece en la lista del chat', !store.listByConversation('chat-A').some((x) => x.id === vId));
  ok_('  ni en la biblioteca', !store.listAll().some((x) => x.id === vId));
  ok_('  ni lo ve la tool', !(await runCanvas(runA, { action: 'list' })).includes(vId));
  t('  ni se puede editar', await runCanvas(runA, { action: 'update', id: vId, content: 'x' }), `error: canvas not found: ${vId}`);
  const aviso = broadcasted.find((b) => b.ch === 'canvas:deleted' && b.p.canvas.id === vId);
  ok_('avisa a la ventana por broadcast', aviso && aviso.p.canvas.id === vId && aviso.p.convoId === 'chat-A');
  ok_('  sin mandar el cuerpo', aviso && aviso.p.canvas.content === undefined);
  t('borrarlo dos veces → no encontrado', await runCanvas(runA, { action: 'delete', id: vId }), `error: canvas not found: ${vId}`);

  const vuelto = store.restore(vId);
  t('restore lo devuelve entero', [vuelto && vuelto.title, vuelto && vuelto.content], ['Borrador viejo', 'texto que importa']);
  ok_('  y vuelve a la lista del chat', store.listByConversation('chat-A').some((x) => x.id === vId));
  t('restore de uno que no está en la papelera → null', store.restore(vId), null);

  // la papelera se vacía sola: lo que lleva más de TRASH_DIAS se borra de verdad
  const viejo = store.create({ conversationId: 'chat-A', content: 'de hace mucho' });
  const reciente = store.create({ conversationId: 'chat-A', content: 'de recién' });
  store.trash(viejo.id, 'chat-A');
  store.trash(reciente.id, 'chat-A');
  crudo(DB, (d) => d.prepare("UPDATE canvases SET deleted_at = datetime('now', '-8 days') WHERE id = ?").run(viejo.id));
  t('purgeTrash borra solo lo vencido', store.purgeTrash(), 1);
  t('  el vencido ya no se restaura', store.restore(viejo.id), null);
  ok_('  el reciente sí', !!store.restore(reciente.id));

  // ── edit: el parche parcial ───────────────────────────────────────────────
  // Antes esto no existía y cambiar un párrafo obligaba a reescribir el
  // documento entero. Las garantías son las mismas que las de fs_edit, y por
  // el mismo motivo: el fragmento está tal cual o no pasa nada.
  seccion('canvas edit (parche parcial)');
  const doc = ['# Informe', '', 'Primer párrafo.', '', 'Segundo párrafo.', ''].join('\n');
  const hecho = await runCanvas(runA, { action: 'create', title: 'Informe', content: doc });
  const docId = hecho.match(/id: ([0-9a-f-]{36})/)[1];

  const runEd = hacerRun('chat-A', 'r7');
  const ed = await runCanvas(runEd, {
    action: 'edit', id: docId, edits: [{ old: 'Primer párrafo.', new: 'Primer párrafo, corregido.' }],
  });
  ok_('edit confirma la versión nueva', /version 2/.test(ed), ed);
  ok_('  y dice las cuentas del cambio', /\+1 -1 lines/.test(ed), ed);
  ok_('  y cuántos edits aplicó', /1 edit applied/.test(ed), ed);
  t('  el resto del documento quedó INTACTO',
    store.get(docId).content, doc.replace('Primer párrafo.', 'Primer párrafo, corregido.'));
  ok_('  sin devolver el cuerpo al modelo', !ed.includes('Segundo párrafo'), ed);
  t('  y refresca el panel con la versión nueva',
    runEd.avisos.map(([ch, p]) => [ch, p.reqId, p.canvas ? p.canvas.version : p.label]),
    [['tool:activity', 'r7', 'Informe'], ['canvas:opened', 'r7', 2]]);

  const antesFallo = store.get(docId).content;
  const versionAntes = store.get(docId).version;
  const runFallo = hacerRun('chat-A');
  const fallo = await runCanvas(runFallo, {
    action: 'edit',
    id: docId,
    edits: [{ old: 'Segundo párrafo.', new: 'Segundo, cambiado.' }, { old: 'no-está', new: 'x' }],
  });
  ok_('si un edit no matchea, falla', /^error:/.test(fallo), fallo);
  t('  y el canvas queda EXACTAMENTE como estaba', store.get(docId).content, antesFallo);
  t('  sin gastar una versión', store.get(docId).version, versionAntes);
  t('  ni tocar el panel', runFallo.avisos, []);

  const ambiguo = await runCanvas(runA, { action: 'edit', id: docId, edits: [{ old: 'párrafo', new: 'x' }] });
  ok_('lo ambiguo falla en vez de elegir', /appears \d+ times/.test(ambiguo), ambiguo);
  t('  y tampoco toca nada', store.get(docId).content, antesFallo);
  {
    const todos = await runCanvas(runA, { action: 'edit', id: fencedId, edits: [{ old: 'd', new: 'D' }], replace_all: true });
    ok_('replace_all cambia todas las apariciones', /^Canvas "Envuelto" edited/.test(todos), todos);
    t('  en el canvas', store.get(fencedId).content, '# ADentro');
  }

  t('edit sin id falla', await runCanvas(runA, { action: 'edit', edits: [{ old: 'a', new: 'b' }] }),
    'error: id is required to edit a canvas');
  ok_('edit sin edits falla', /^error: edits is required/.test(
    await runCanvas(runA, { action: 'edit', id: docId })));
  t('edit de otra conversación → no encontrado',
    await runCanvas(runB, { action: 'edit', id: docId, edits: [{ old: 'Informe', new: 'Hackeado' }] }),
    `error: canvas not found: ${docId}`);

  const renom = await runCanvas(runA, {
    action: 'edit', id: docId, title: 'Informe final', edits: [{ old: '# Informe', new: '# Informe final' }],
  });
  ok_('edit puede renombrar de paso', /Informe final/.test(renom), renom);
  t('  y el título persistió', store.get(docId).title, 'Informe final');

  // Un ``` adentro de un fragmento es contenido, no envoltorio: a diferencia de
  // `content`, los edits NO pasan por unwrapOuterFence.
  const conCode = await runCanvas(runA, { action: 'create', title: 'Con código', content: 'antes\n\n```js\nviejo()\n```\n' });
  const codeId = conCode.match(/id: ([0-9a-f-]{36})/)[1];
  await runCanvas(runA, { action: 'edit', id: codeId, edits: [{ old: '```js\nviejo()\n```', new: '```js\nnuevo()\n```' }] });
  t('un edit que ES un bloque de código no se desenvuelve',
    store.get(codeId).content, 'antes\n\n```js\nnuevo()\n```\n');

  // ── el preview de la tarjeta, para el canvas ──────────────────────────────
  seccion('el diff de la tarjeta (canvas)');
  const canvasPreview = canvas.canvasPreview;

  const antesDelPreview = store.get(docId).content;
  let pv = canvasPreview({ action: 'edit', id: docId, edits: [{ old: 'Segundo párrafo.', new: 'Segundo, cambiado.' }] });
  t('un edit válido muestra diff', pv.mode, 'diff');
  t('  con sus cuentas', [pv.added, pv.removed], [1, 1]);
  ok_('  y nombra el canvas por su título, no por el uuid', /Informe final/.test(pv.target), pv.target);
  t('  sin haber tocado el canvas', store.get(docId).content, antesDelPreview);

  pv = canvasPreview({ action: 'edit', id: docId, edits: [{ old: 'párrafo', new: 'x' }] });
  t('un edit ambiguo se ve ANTES de aprobar', pv.mode, 'fail');
  ok_('  con el motivo', /appears/.test(pv.error), pv.error);
  t('  y tampoco toca nada', store.get(docId).content, antesDelPreview);

  pv = canvasPreview({ action: 'update', id: docId, content: 'todo nuevo' });
  t('un update también muestra diff, no el documento crudo', pv.mode, 'diff');
  ok_('  contra lo que el canvas dice hoy', pv.removed > 0);

  // en manual la tarjeta de un delete tiene que mostrar lo que se va, entero
  pv = canvasPreview({ action: 'delete', id: docId });
  t('un delete muestra el documento entero como removido', [pv.mode, pv.added, pv.removed > 0], ['diff', 0, true]);
  t('  y no lo borra por mostrarlo', store.get(docId).content, antesDelPreview);

  t('un canvas que no existe se avisa', canvasPreview({ action: 'edit', id: 'no-existe' }).mode, 'gone');
  t('sin id no hay preview', canvasPreview({ action: 'edit' }), null);

  seccion('el bloque del system prompt');
  const block = canvas.canvasBlock('chat-A');
  ok_('lista los canvas abiertos', block.includes('Open canvases') && block.includes(newId), block.slice(0, 120));
  ok_('sin cuerpos', !block.includes('## Plan v2'));
  t('chat sin canvas → bloque vacío (no gasta prompt)', canvas.canvasBlock('chat-vacio'), '');
  t('sin conversación → vacío', canvas.canvasBlock(null), '');

  seccion('saneo del nombre al exportar');
  const safeName = (title) => canvas.nombreDeExport({ title });
  t('nombre normal', safeName('Mi informe'), 'Mi informe.md');
  // lo que importa no es el string exacto sino la PROPIEDAD: nada de lo que
  // salga puede escaparse del directorio que eligió el usuario en el diálogo
  ['../../etc/passwd', 'C:\\Users\\x\\evil', '..\\..\\win.ini', '/etc/shadow', 'a/b/c'].forEach((mal) => {
    const s = safeName(mal);
    ok_(`sin salida del directorio: ${JSON.stringify(mal)} → ${JSON.stringify(s)}`,
      !/[/\\:]/.test(s) && !s.startsWith('.') && s.length > 0);
  });
  t('sin archivo oculto', safeName('...oculto'), 'oculto.md');
  t('sin punto final', safeName('nombre...'), 'nombre.md');
  t('vacío → canvas', safeName(''), 'canvas.md');
  t('solo basura → canvas', safeName('...'), 'canvas.md');
  ok_('corta a 60', safeName('a'.repeat(200)).length <= 60 + '.md'.length);

  seccion('la extensión al exportar');
  t('un documento es .md, diga lo que diga el lenguaje', canvas.nombreDeExport({ title: 'Doc', kind: 'document', language: 'python' }), 'Doc.md');
  t('código: la extensión de su lenguaje', canvas.nombreDeExport({ title: 'Script', kind: 'code', language: 'Python' }), 'Script.py');
  t('  c++', canvas.nombreDeExport({ title: 'x', kind: 'code', language: 'c++' }), 'x.cpp');
  t('  un lenguaje que no está en la tabla → .txt', canvas.nombreDeExport({ title: 'x', kind: 'code', language: 'cobol' }), 'x.txt');
  t('  sin lenguaje → .txt', canvas.nombreDeExport({ title: 'x', kind: 'code' }), 'x.txt');
  t('sin nada', canvas.nombreDeExport(), 'canvas.md');
  t('LANG_EXT es la tabla', [canvas.LANG_EXT.powershell, canvas.LANG_EXT.markup, canvas.LANG_EXT['c#']], ['ps1', 'html', 'cs']);

  // ── lo que sigue no estaba en el test de NeonCode ─────────────────────────

  // el cuerpo del handler canvas:listAll: la biblioteca del panel
  seccion('listarTodos');
  {
    const enPapelera = store.create({ conversationId: 'chat-B', title: 'A la papelera', content: 'p' });
    const porVencer = store.create({ conversationId: 'chat-A', title: 'Por vencer', content: 'q' });
    await runCanvas(hacerRun('chat-B'), { action: 'delete', id: enPapelera.id });
    await runCanvas(hacerRun('chat-A'), { action: 'delete', id: porVencer.id });
    crudo(DB, (d) => d.prepare("UPDATE canvases SET deleted_at = datetime('now', '-156 hours') WHERE id = ?").run(porVencer.id));

    const todos = await canvas.listarTodos();
    const vivos = todos.filter((c) => !c.trashed);
    const borrados = todos.filter((c) => c.trashed);
    t('trae los vivos y los de la papelera', [vivos.length, borrados.length], [store.listAll().length, 2]);
    ok_('  los de la papelera, al final', todos.slice(vivos.length).every((c) => c.trashed === true));
    ok_('  ninguno con el cuerpo', todos.every((c) => c.content === undefined));
    const de = (id) => todos.find((c) => c.id === id);
    t('cada uno con el título de su chat', de(newId).conversationTitle, 'Chat A');
    t('  null si el chat se borró', de(codeC.id).conversationTitle, null);
    t('  null si el chat no tiene título conocido', de(tmp2.id).conversationTitle, null);
    t('uno recién borrado: le quedan los 7 días', [de(enPapelera.id).trashed, de(enPapelera.id).daysLeft, de(enPapelera.id).conversationTitle], [true, 7, 'Chat B']);
    t('uno de hace seis días y medio: le queda 1', de(porVencer.id).daysLeft, 1);
    ok_('  y trae cuándo se borró', typeof de(porVencer.id).deleted_at === 'string');
    ok_('los vivos no llevan daysLeft', vivos.every((c) => c.daysLeft === undefined && c.deleted_at === undefined));
    ok_('restaurar uno desde ahí lo devuelve a los vivos', !!store.restore(enPapelera.id)
      && (await canvas.listarTodos()).some((c) => c.id === enPapelera.id && !c.trashed));
  }

  // el cuerpo del handler canvas:save: la edición del usuario en el panel
  seccion('guardar');
  {
    const antes = store.get(codeC.id);
    const g = canvas.guardar({ id: codeC.id, content: 'SELECT 2', title: 'Consulta' });
    t('guarda el cuerpo y el título, y sube la versión', [g.content, g.title, g.version], ['SELECT 2', 'Consulta', antes.version + 1]);
    t('  sin tocar kind ni language', [g.kind, g.language], ['code', 'sql']);
    t('  sin título conserva el que tenía', canvas.guardar({ id: codeC.id, content: 'SELECT 3' }).title, 'Consulta');
    t('un id que no existe → null', canvas.guardar({ id: 'no-existe', content: 'x' }), null);
    t('sin id → null', canvas.guardar({ content: 'x' }), null);
    t('sin nada → null', canvas.guardar(), null);
    const p = store.create({ conversationId: 'chat-A', content: 'x' });
    store.trash(p.id);
    t('uno que está en la papelera → null', canvas.guardar({ id: p.id, content: 'y' }), null);
  }

  // titulosDeChats y broadcast llegan por configurar()
  seccion('lo que llega por configurar');
  {
    canvas.configurar({ titulosDeChats: () => new Map([['chat-A', 'Sincrónico']]) });
    ok_('titulosDeChats puede devolver el Map sin promesa', /chat "Sincrónico"/.test(await runCanvas(hacerRun('otro'), { action: 'list', scope: 'all' })));
    canvas.configurar({ titulosDeChats: async () => { throw new Error('no se pudo leer'); } });
    const r = await runCanvas(hacerRun('otro'), { action: 'list', scope: 'all' });
    ok_('si titulosDeChats falla, la lista sale igual', /^All the canvases of your chats/.test(r) && /chat "Untitled"/.test(r), r.slice(0, 200));
    ok_('  y la biblioteca del panel también', (await canvas.listarTodos()).length > 0);
    canvas.configurar({ titulosDeChats: () => ({ 'chat-A': 'no es un Map' }) });
    ok_('algo que no es un Map vale como ninguno', /chat "Untitled"/.test(await runCanvas(hacerRun('otro'), { action: 'list', scope: 'all' })));
    canvas.configurar({ titulosDeChats: null });
    ok_('sin titulosDeChats: «Untitled»', /chat "Untitled"/.test(await runCanvas(hacerRun('otro'), { action: 'list', scope: 'all' })));

    const antes = broadcasted.length;
    canvas.configurar({ broadcast: () => { throw new Error('no hay ventana'); } });
    const a = store.create({ conversationId: 'chat-A', title: 'Aviso roto', content: 'x' });
    ok_('un broadcast que tira no voltea el delete', /"Aviso roto" deleted/.test(await runCanvas(hacerRun('chat-A'), { action: 'delete', id: a.id })));
    canvas.configurar({ broadcast: null });
    const b = store.create({ conversationId: 'chat-A', title: 'Sin aviso', content: 'x' });
    ok_('sin broadcast, el delete anda igual', /"Sin aviso" deleted/.test(await runCanvas(hacerRun('chat-A'), { action: 'delete', id: b.id })));
    t('  y no le llegó nada al de antes', broadcasted.length, antes);
    canvas.configurar({ titulosDeChats, broadcast });
    const c = store.create({ conversationId: 'chat-A', title: 'Con aviso', content: 'x' });
    await runCanvas(hacerRun('chat-A'), { action: 'delete', id: c.id });
    t('cada llave se cambia sola: los dos de vuelta', [broadcasted.length, /chat "Chat A"/.test(await runCanvas(hacerRun('otro'), { action: 'list', scope: 'all' }))], [antes + 1, true]);
  }

  // la base: cerrar, reabrir, cambiar de archivo, y una que no abre
  seccion('la base');
  {
    const cuantos = store.listAll().length;
    canvas.cerrar();
    canvas.cerrar();
    ok_('cerrar dos veces no tira', true);
    ok_('cerrar() suelta el archivo', sePuedeMover(DB));
    ok_('  y el store a secas queda cerrado', /not initialized/.test(tira(() => almacen.get(newId))));
    t('el uso siguiente la reabre con todo', [store.get(newId).content, store.listAll().length], ['## Plan v2', cuantos]);
    canvas.cerrar();
    ok_('la tool también la reabre', (await runCanvas(hacerRun('chat-A'), { action: 'read', id: newId })).includes('## Plan v2'));
    canvas.cerrar();
    ok_('y el bloque del system prompt', canvas.canvasBlock('chat-A').includes(newId));
    canvas.cerrar();
    t('y el preview de la tarjeta', canvas.canvasPreview({ action: 'delete', id: newId }).mode, 'diff');
    canvas.cerrar();
    ok_('y la biblioteca', (await canvas.listarTodos()).some((c) => c.id === newId));
    canvas.configurar({});
    t('configurar sin dbPath no cambia de base', store.listAll().length, cuantos);

    const OTRA = path.join(DATOS, 'otra-canvas.db');
    canvas.configurar({ dbPath: () => OTRA });
    ok_('configurar otra ruta no la abre todavía', !fs.existsSync(OTRA));
    ok_('  y suelta la anterior', sePuedeMover(DB));
    t('  la tool ya trabaja sobre la nueva', await runCanvas(hacerRun('chat-A'), { action: 'list', scope: 'all' }), 'You have no canvases in any of your chats yet.');
    ok_('  que se creó ahí', fs.existsSync(OTRA));
    t('  y no ve nada de la otra', store.get(newId), null);
  }
  {
    const antes = avisosConsola.length;
    canvas.configurar({ dbPath: () => path.join(TMP, 'no-existe', 'canvas.db') });
    t('una carpeta que no existe: la tool lo dice', await runCanvas(hacerRun('chat-A'), { action: 'list' }), 'error: the canvas store is unavailable');
    t('  create tampoco', await runCanvas(hacerRun('chat-A'), { action: 'create', title: 'x', content: 'x' }), 'error: the canvas store is unavailable');
    t('  el bloque del system prompt queda vacío', canvas.canvasBlock('chat-A'), '');
    t('  no hay preview', canvas.canvasPreview({ action: 'edit', id: 'x', edits: [] }), null);
    t('  la biblioteca sale vacía', await canvas.listarTodos(), []);
    t('  guardar da null', canvas.guardar({ id: 'x', content: 'y' }), null);
    ok_('  `store` tira, que es lo que los handlers atajan', /not initialized/.test(tira(() => store.listByConversation('chat-A'))));
    ok_('  y no crea la carpeta', !fs.existsSync(path.join(TMP, 'no-existe')));
    t('  se intentó abrir UNA vez, no una por uso', avisosConsola.length - antes, 1);
    ok_('  y lo dijo por consola', /\[canvas\] no se pudo abrir canvas\.db/.test(avisosConsola[antes] || ''), avisosConsola[antes]);
  }
  {
    const BASURA = path.join(DATOS, 'basura.db');
    fs.writeFileSync(BASURA, 'esto no es una base, ni cerca '.repeat(60));
    const antes = avisosConsola.length;
    canvas.configurar({ dbPath: () => BASURA });
    t('un archivo que no es SQLite: la tool lo dice', await runCanvas(hacerRun('chat-A'), { action: 'list' }), 'error: the canvas store is unavailable');
    t('  avisó una vez', avisosConsola.length - antes, 1);
    ok_('  no quedó nada a medio abrir', sePuedeMover(BASURA));
    ok_('  ni un store que parezca abierto', /not initialized/.test(tira(() => almacen.listAll())));
    t('  y el archivo queda como estaba', fs.readFileSync(BASURA, 'utf8').length, 30 * 60);
  }
  {
    // una base de antes de la papelera: la columna se agrega al abrir
    const VIEJA = path.join(DATOS, 'vieja.db');
    crudo(VIEJA, (d) => {
      d.exec(`CREATE TABLE canvases (
        id TEXT PRIMARY KEY, conversation_id TEXT, title TEXT NOT NULL DEFAULT 'Untitled',
        kind TEXT DEFAULT 'document', language TEXT, content TEXT NOT NULL DEFAULT '',
        version INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
      d.prepare('INSERT INTO canvases (id, conversation_id, title, content, version) VALUES (?, ?, ?, ?, ?)').run('viejo-1', 'chat-A', 'De antes', 'cuerpo viejo', 4);
    });
    canvas.configurar({ dbPath: () => VIEJA });
    t('una base sin la columna de la papelera se lee', [store.get('viejo-1').title, store.get('viejo-1').version], ['De antes', 4]);
    ok_('  la columna se agregó al abrir', crudo(VIEJA, (d) => d.prepare('PRAGMA table_info(canvases)').all().some((c) => c.name === 'deleted_at')));
    ok_('  y la papelera anda', /"De antes" deleted/.test(await runCanvas(hacerRun('chat-A'), { action: 'delete', id: 'viejo-1' })) && store.get('viejo-1') === null);
    // lo vencido se purga al abrir, no hace falta que nadie llame a purgeTrash
    crudo(VIEJA, (d) => d.prepare("UPDATE canvases SET deleted_at = datetime('now', '-8 days') WHERE id = ?").run('viejo-1'));
    t('  vencido pero todavía sin purgar: está en la papelera', store.listTrash().map((c) => c.id), ['viejo-1']);
    canvas.cerrar();
    t('al reabrir, lo vencido de la papelera ya no está', [store.listTrash().length, store.restore('viejo-1')], [0, null]);
    t('  ni en el archivo', crudo(VIEJA, (d) => d.prepare('SELECT count(*) AS n FROM canvases').get().n), 0);
  }
  {
    canvas.configurar({ dbPath: () => DB });
    t('de vuelta a la primera, con todo', store.get(newId).content, '## Plan v2');
  }

  // el get() que se le sumó al adaptador de sqlite.cjs para el store
  seccion('el adaptador: get');
  {
    ok_('Database se puede pedir a sqlite.cjs', typeof sqlite.Database === 'function');
    t('  sin sumarse a lo que el módulo lista', Object.keys(sqlite).sort(), ['cerrar', 'configurar', 'runners']);
    const d = new sqlite.Database(path.join(DATOS, 'adaptador.db'));
    try {
      d.exec('CREATE TABLE t(a INTEGER, b BLOB, c TEXT)');
      d.prepare('INSERT INTO t VALUES (?, ?, ?)').run(9007199254740993n, Buffer.from([1, 2, 255]), 'uno');
      d.prepare('INSERT INTO t VALUES (?, ?, ?)').run(2, null, 'dos');
      t('get devuelve la primera fila, con enteros como número y BLOB como Buffer',
        d.prepare('SELECT * FROM t ORDER BY rowid').get(), { a: 9007199254740992, b: { type: 'Buffer', data: [1, 2, 255] }, c: 'uno' });
      t('get con un parámetro', d.prepare('SELECT c FROM t WHERE a = ?').get(2), { c: 'dos' });
      ok_('get sin filas es undefined', d.prepare('SELECT * FROM t WHERE a = ?').get(999) === undefined);
      t('get con un valor que falta tira, como all()', tira(() => d.prepare('SELECT * FROM t WHERE a = ?').get()), 'Too few parameter values were provided');
      t('  y con uno de más', tira(() => d.prepare('SELECT * FROM t').get(1)), 'Too many parameter values were provided');
      t('all() sigue dando lo mismo', d.prepare('SELECT a, c FROM t ORDER BY rowid').all(), [{ a: 9007199254740992, c: 'uno' }, { a: 2, c: 'dos' }]);
    } finally {
      d.close();
    }
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  console.warn = warnOriginal;
  try { canvas.cerrar(); } catch { /* ya estaba cerrada */ }
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (fs.existsSync(TMP)) failures.push('[limpieza] la carpeta temporal no se pudo borrar: quedó una base abierta');

if (failures.length) {
  console.error(`test-blackcode-tools-canvas: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-canvas: ok (${hechas} comprobaciones: cableado, el store, borrar y huérfanos, unwrapOuterFence, la tool con create, read, update y list, delete a la papelera, edit por fragmentos, el diff de la tarjeta, el bloque del system prompt y el nombre al exportar, que son las de NeonCode; más listarTodos, guardar, lo que llega por configurar, la base que se abre sola, se cierra, se cambia y no abre, y el get del adaptador)`);
process.exit(0);
