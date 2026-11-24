// Test de las tools de archivos de BlackCode (apps/BlackCode/main/tools/fs.cjs y
// diff.cjs), con node pelado y carpetas descartables.
// Uso: node tools/test-blackcode-tools-fs.mjs
//
// Son las aserciones de tres suites de NeonCode 1.11.3 (scripts/test-fs-read.js,
// test-fs-edit.js y test-fs-delete.js), portadas contra los módulos de BlackCode. Allá
// las funciones se sacaban del fuente de main.js con una regex y se les
// inyectaban las dependencias; acá se importan los módulos y listo.
//
// Lo que cada bloque fija:
//
//   fs_read    El listado de un directorio cortaba en 50 entradas EN SILENCIO:
//              el modelo veía 50 nombres y daba la carpeta por completa. Pase lo
//              que pase, la salida dice cuántas entradas HAY y cuántas dejó
//              afuera.
//   fs_edit    TODO O NADA (si un edit no matchea, o matchea en dos lados, el
//              archivo no se toca) y lo que la tarjeta MUESTRA es lo que el
//              disco VA A RECIBIR: el preview y el runner comparten applyEdits.
//   fs_delete  Va a la papelera y nunca a un rm; si la papelera falla NO hay
//              plan B, se reporta y no se toca nada. Y la tarjeta dice qué se
//              pierde antes de aprobar.
//
// Al final van las aserciones propias de la adaptación a BlackCode: la papelera y el
// journal del deshacer inyectados por configurar(), y fs_write, que en NeonCode
// se probaba junto con el journal.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const herramientas = require(path.join(TOOLS, 'fs.cjs'));
const { diffLines } = require(path.join(TOOLS, 'diff.cjs'));
const {
  runners, configurar, preview: writePreview, deletePreview, countTree,
  applyEdits, normalizeEdits, runFsDelete, FS_READ_DIR_ENTRIES,
} = herramientas;

const failures = [];
let aserciones = 0;
let seccionActual = '';
const seccion = (s) => { seccionActual = s; };
const t = (name, got, want) => {
  aserciones++;
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  failures.push(`[${seccionActual}] ${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`);
};
const ok_ = (name, cond, extra) => t(name + (cond || !extra ? '' : ` [${extra}]`), !!cond, true);

// Las carpetas descartables, todas juntas para poder limpiar pase lo que pase.
const temporales = [];
const fresh = (prefijo) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
  temporales.push(dir);
  return dir;
};
const limpiar = () => {
  for (const dir of temporales) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ya no está */ }
  }
};

// El cwd es el de la CORRIDA (ver cwdDe en base.cjs): cada run trae el suyo y
// las rutas relativas se resuelven contra ese, que es lo que en las suites de
// NeonCode hacía el resolvedor inyectado.
const runEn = (cwd) => ({ reqId: 1, cwd, notify() {} });

// ═══════════════════════════════════════════════════════════════════════════
// fs_read: el listado de directorios (test-fs-read.js)
// ═══════════════════════════════════════════════════════════════════════════
async function probarRead() {
  const DIR_CAP = FS_READ_DIR_ENTRIES;
  const TMP = fresh('blackcode-fsread-');
  const mk = (rel, body) => {
    const p = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (body === undefined) fs.mkdirSync(p, { recursive: true });
    else fs.writeFileSync(p, body);
    return p;
  };

  mk('chico');                       // carpeta con pocas entradas
  ['b.txt', 'a.txt', 'C.txt'].forEach((n) => mk(`chico/${n}`, 'hola'));
  mk('chico/zeta');
  mk('chico/Alfa');

  mk('vacio');

  mk('grande');                      // carpeta que SÍ pasa el tope
  const GRANDE = DIR_CAP + 37;
  for (let i = 0; i < GRANDE; i++) mk(`grande/f${String(i).padStart(4, '0')}.txt`, 'x');

  mk('justo');                       // carpeta exactamente en el tope
  for (let i = 0; i < DIR_CAP; i++) mk(`justo/f${String(i).padStart(4, '0')}.txt`, 'x');

  const run = runEn(TMP);
  const read = runners.fs_read;

  seccion('fs_read: el conteo real se dice SIEMPRE');
  let out = await read(run, { paths: ['chico'] });
  t('una carpeta de 5 dice que tiene 5', /\[directory — 5 entries\]/.test(out), true);
  ok_('y no habla de nada oculto', !/more not shown/.test(out), out.slice(0, 120));

  out = await read(run, { paths: ['vacio'] });
  t('la carpeta vacía dice 0 entries', /\[directory — 0 entries\]/.test(out), true);
  ok_('  y se marca (empty)', /\(empty\)/.test(out));

  const uno = mk('uno');
  mk('uno/solo.txt', 'x');
  out = await read(run, { paths: [uno] });
  t('singular: 1 entry, no "1 entries"', /\[directory — 1 entry\]/.test(out), true);

  seccion('fs_read: el truncado se ANUNCIA (el defecto que motivó esto)');
  out = await read(run, { paths: ['grande'] });
  t(`dice el total real (${GRANDE}), no lo que mostró`,
    new RegExp(`\\[directory — ${GRANDE} entries\\]`).test(out), true);
  t('nombra cuántas dejó afuera', /…\[37 more not shown/.test(out), true);
  ok_('  y sugiere cómo acotar', /code_search|shell_exec/.test(out));

  const nombres = out.split('\n').filter((l) => /^f\d{4}\.txt$/.test(l));
  t('mostró exactamente el tope', nombres.length, DIR_CAP);

  out = await read(run, { paths: ['justo'] });
  t('justo en el tope no miente diciendo que sobra', /more not shown/.test(out), false);
  t('  y el total sigue estando', new RegExp(`\\[directory — ${DIR_CAP} entries\\]`).test(out), true);

  seccion('fs_read: el orden del corte es predecible');
  out = await read(run, { paths: ['chico'] });
  const filas = out.split('\n').filter((l) => /^(Alfa|zeta|a\.txt|b\.txt|C\.txt)\/?$/.test(l));
  t('carpetas primero, después archivos, alfabético sin importar mayúsculas',
    filas, ['Alfa/', 'zeta/', 'a.txt', 'b.txt', 'C.txt']);

  seccion('fs_read: lo que ya andaba sigue andando');
  out = await read(run, { paths: ['chico/a.txt'] });
  t('un archivo devuelve su contenido', /== .*a\.txt ==\nhola/.test(out), true);

  out = await read(run, { paths: ['no-existe-nada'] });
  t('una ruta inexistente da error y no rompe', /error:/.test(out), true);

  out = await read(run, { paths: ['chico', 'chico/a.txt'] });
  ok_('mezcla carpeta y archivo en una sola llamada',
    /\[directory — 5 entries\]/.test(out) && /hola/.test(out));

  seccion('fs_read: el listado gasta presupuesto');
  // Antes NADA contaba los listados (solo sumaban los archivos leídos), así que
  // diez carpetas grandes llenaban el contexto sin tope ninguno. Van ocho —
  // cada bloque ronda los 2.1k y el presupuesto son 12k, así que corta a mitad
  // de camino y no en la última.
  out = await read(run, { paths: Array(8).fill('grande') });
  ok_('varias carpetas grandes cortan por presupuesto', /total read budget reached/.test(out));
  const bloques = (out.match(/\[directory — /g) || []).length;
  ok_(`  y corta ANTES de listarlas todas (listó ${bloques} de 8)`, bloques < 8, String(bloques));
}

// ═══════════════════════════════════════════════════════════════════════════
// fs_edit y el diff de la tarjeta (test-fs-edit.js)
// ═══════════════════════════════════════════════════════════════════════════
async function probarEdit() {
  const TMP = fresh('blackcode-fsedit-');
  const run = runEn(TMP);
  const edit = runners.fs_edit;
  // La tarjeta resuelve contra el MISMO cwd que el runner: el de la corrida.
  const preview = (name, args) => writePreview(run, name, args);
  const mk = (rel, body) => {
    const p = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };
  const leer = (rel) => fs.readFileSync(path.join(TMP, rel), 'utf8');

  const CODIGO = [
    'function saludar(nombre) {',
    '  const saludo = "hola";',
    '  console.log(saludo, nombre);',
    '  return saludo;',
    '}',
    '',
  ].join('\n');

  // ═══ el diff ═══════════════════════════════════════════════════════════════
  seccion('diff: el contexto es lo que hace legible un cambio');
  let d = diffLines('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nD\ne\nf\ng');
  t('un cambio de una línea da un hunk', d.hunks.length, 1);
  t('  con sus dos líneas cambiadas', [d.added, d.removed], [1, 1]);
  t('  y contexto de los dos lados', d.hunks[0].lines.filter((l) => l.t === ' ').length, 6);
  t('  numeradas contra el archivo, no contra el hunk',
    d.hunks[0].lines.map((l) => l.t === '-' ? l.oldNo : l.newNo), [1, 2, 3, 4, 4, 5, 6, 7]);

  const largo = Array.from({ length: 200 }, (_, i) => `linea ${i}`);
  const tocado = largo.slice();
  tocado[10] = 'X';
  tocado[150] = 'Y';
  d = diffLines(largo.join('\n'), tocado.join('\n'));
  t('dos cambios lejanos NO se juntan en un hunk', d.hunks.length, 2);
  ok_('  y lo que está lejos de todo cambio no viaja',
    d.hunks.reduce((n, h) => n + h.lines.length, 0) < 20);

  seccion('diff: el archivo grande reescrito (donde el DP no entra)');
  // 7000×7000 son 49M de celdas: sin anclas esto daba 7000 borrados y 7000
  // agregados por UNA línea distinta — cierto e inútil.
  const gordo = Array.from({ length: 7000 }, (_, i) => `const x${i} = ${i};`);
  const gordo2 = gordo.slice();
  gordo2[0] = 'const x0 = 999;';
  const t0 = Date.now();
  d = diffLines(gordo.join('\n'), gordo2.join('\n'));
  const ms = Date.now() - t0;
  t('7000 líneas, una tocada → un solo cambio', [d.added, d.removed], [1, 1]);
  ok_(`  y no tarda (${ms}ms)`, ms < 2000, `${ms}ms`);

  seccion('diff: lo que se ve raro pero no cambió');
  t('CRLF contra LF no es un cambio', diffLines('a\r\nb\r\n', 'a\nb\n').changed, false);
  t('un archivo idéntico no tiene hunks', diffLines(CODIGO, CODIGO).hunks.length, 0);
  d = diffLines('a\nb\n', 'a\nb');
  t('perder el newline final SÍ es un cambio', d.changed, true);
  ok_('  y se avisa aparte, porque no se ve en ninguna línea', d.newlineChange);

  d = diffLines(largo.join('\n'), largo.map((s) => s.toUpperCase()).join('\n'), { maxLines: 20 });
  t('un diff enorme se corta para la tarjeta', d.hunks.reduce((n, h) => n + h.lines.length, 0) <= 20, true);
  ok_('  y dice cuántas líneas dejó afuera', d.truncated > 0, String(d.truncated));
  t('  pero el conteo total NO miente', [d.added, d.removed], [200, 200]);

  // ═══ applyEdits: la semántica ══════════════════════════════════════════════
  seccion('applyEdits: todo o nada (la propiedad que sostiene la tool)');
  let r = applyEdits(CODIGO, [{ old: '"hola"', new: '"buenas"' }], false);
  t('un reemplazo simple anda', r.ok && r.text.includes('const saludo = "buenas";'), true);

  r = applyEdits(CODIGO, [{ old: 'no-esta-en-ningun-lado', new: 'x' }], false);
  t('lo que no está falla', r.ok, false);
  ok_('  y dice cuál edit fue', /edit 1 of 1/.test(r.error), r.error);
  ok_('  y que no se escribió nada', /nothing was written/.test(r.error));

  r = applyEdits(CODIGO, [{ old: 'saludo', new: 'x' }], false);
  t('lo ambiguo falla en vez de elegir por su cuenta', r.ok, false);
  ok_('  y dice cuántas veces aparece', /appears 3 times/.test(r.error), r.error);
  ok_('  y cómo salir', /unique|replace_all/.test(r.error));

  r = applyEdits(CODIGO, [
    { old: '"hola"', new: '"buenas"' },
    { old: 'no-esta', new: 'x' },
  ], false);
  t('si el SEGUNDO falla, el primero tampoco vale', r.ok, false);
  ok_('  (no hay texto parcial que devolver)', r.text === undefined);

  seccion('applyEdits: lo que se rechaza a propósito');
  t('old vacío', applyEdits(CODIGO, [{ old: '', new: 'x' }], false).ok, false);
  t('old === new', applyEdits(CODIGO, [{ old: 'saludo', new: 'saludo' }], false).ok, false);
  t('sin new', applyEdits(CODIGO, [{ old: 'saludo' }], false).ok, false);
  ok_('new vacío SÍ vale: es borrar el fragmento',
    applyEdits(CODIGO, [{ old: '  return saludo;\n', new: '' }], false).ok);

  seccion('applyEdits: varios edits');
  r = applyEdits(CODIGO, [
    { old: '"hola"', new: '"buenas"' },
    { old: 'console.log(saludo, nombre);', new: 'console.info(saludo, nombre);' },
  ], false);
  t('se aplican los dos', r.ok && /"buenas"/.test(r.text) && /console\.info/.test(r.text), true);

  r = applyEdits('aaa', [{ old: 'a', new: 'b' }], true);
  t('replace_all cambia todas', r.text, 'bbb');

  // Encontrado mirando una corrida de verdad: puesto a elegir, el modelo manda
  // replace_all ADENTRO del edit. Como el schema solo lo tenía arriba, quedaba
  // ignorado y la llamada moría con "…or pass replace_all:true" contra un modelo
  // que lo acababa de pasar — un callejón sin salida escrito por nosotros.
  r = applyEdits('aaa', [{ old: 'a', new: 'b', replace_all: true }], false);
  t('replace_all adentro del edit también vale', [r.ok, r.text], [true, 'bbb']);
  r = applyEdits('aaa\nzzz', [{ old: 'a', new: 'b', replace_all: true }, { old: 'z', new: 'y' }], false);
  t('  y es POR edit: el que no lo pide sigue exigiendo unicidad', r.ok, false);
  ok_('  fallando en el segundo, no en el primero', /edit 2 of 2/.test(r.error), r.error);
  r = applyEdits('aaa', [{ old: 'a', new: 'b', replace_all: false }], true);
  t('  y el del edit gana sobre el global', r.ok, false);
  r = applyEdits(CODIGO, [
    { old: '"hola"', new: '"chau"' },
    { old: '"chau"', new: '"adios"' },
  ], false);
  t('el edit 2 ve el resultado del edit 1', r.ok && /"adios"/.test(r.text), true);

  seccion('applyEdits: finales de línea y BOM (Windows)');
  const crlf = CODIGO.replace(/\n/g, '\r\n');
  r = applyEdits(crlf, [{ old: '  const saludo = "hola";\n  console.log', new: '  const saludo = "buenas";\n  console.log' }], false);
  t('un edit con \\n matchea un archivo CRLF', r.ok, true);
  ok_('  y lo que inserta también sale en CRLF', r.ok && !/[^\r]\n/.test(r.text));
  ok_('  sin tocar el resto del archivo', r.ok && r.text.split('\r\n').length === crlf.split('\r\n').length);

  const mezcla = 'uno\r\ndos\ntres\r\n';
  r = applyEdits(mezcla, [{ old: 'dos', new: 'DOS' }], false);
  t('un archivo mezclado no se normaliza por la espalda', r.text, 'uno\r\nDOS\ntres\r\n');

  // el BOM va escrito como escape: suelto en el fuente no se ve y un editor lo
  // puede sacar sin avisar
  r = applyEdits('﻿const a = 1;\n', [{ old: 'const a = 1;', new: 'const a = 2;' }], false);
  t('el BOM sobrevive', r.text, '﻿const a = 2;\n');

  seccion('normalizeEdits: las formas mal armadas que manda un modelo chico');
  t('un edit suelto se acepta como lista de uno', normalizeEdits({ old: 'a', new: 'b' }).length, 1);
  t('una lista pasa igual', normalizeEdits([{ old: 'a', new: 'b' }]).length, 1);
  t('la lista doble-codificada como string se desarma',
    normalizeEdits('[{"old":"a","new":"b"}]'), [{ old: 'a', new: 'b' }]);
  t('  y un edit suelto doble-codificado también',
    normalizeEdits('{"old":"a","new":"b"}'), [{ old: 'a', new: 'b' }]);
  t('un string que no es JSON no se adivina', normalizeEdits('a'), []);
  t('nada es lista vacía', normalizeEdits(undefined), []);

  // ═══ el runner contra disco de verdad ══════════════════════════════════════
  seccion('runFsEdit: contra archivos de verdad');
  mk('a.js', CODIGO);
  let out = await edit(run, { path: 'a.js', edits: [{ old: '"hola"', new: '"buenas"' }] });
  ok_('escribe', /^edited /.test(out), out);
  t('  el archivo quedó cambiado', leer('a.js').includes('"buenas"'), true);
  ok_('  y el resultado dice las cuentas que vio el usuario', /\+1 -1 lines/.test(out), out);
  ok_('  y cuántos edits aplicó', /1 edit applied/.test(out), out);

  mk('b.js', CODIGO);
  out = await edit(run, { path: 'b.js', edits: [{ old: 'nada-de-esto', new: 'x' }] });
  ok_('un edit que no matchea da error', /^error:/.test(out), out);
  t('  y el archivo quedó INTACTO', leer('b.js'), CODIGO);

  mk('c.js', CODIGO);
  out = await edit(run, {
    path: 'c.js',
    edits: [{ old: '"hola"', new: '"buenas"' }, { old: 'nada-de-esto', new: 'x' }],
  });
  ok_('si el segundo falla, no se escribe el primero', /^error:/.test(out), out);
  t('  el archivo sigue como estaba', leer('c.js'), CODIGO);

  out = await edit(run, { path: 'no-existe.js', edits: [{ old: 'a', new: 'b' }] });
  ok_('un archivo que no existe falla', /^error:/.test(out), out);
  ok_('  y manda a fs_write, que es la tool que crea', /fs_write/.test(out), out);

  out = await edit(run, { path: 'a.js', edits: [] });
  ok_('sin edits falla y no escribe', /^error:/.test(out), out);
  out = await edit(run, { path: '', edits: [{ old: 'a', new: 'b' }] });
  ok_('sin path falla', /^error: path/.test(out), out);

  mk('d.js', 'x\nx\nx\n');
  out = await edit(run, { path: 'd.js', edits: [{ old: 'x', new: 'y' }], replace_all: true });
  t('replace_all llega hasta el runner', leer('d.js'), 'y\ny\ny\n');

  // ═══ el preview: lo que la tarjeta promete ═════════════════════════════════
  seccion('writePreview: la tarjeta no puede mentir');
  mk('e.js', CODIGO);
  let p = await preview('fs_edit', { path: 'e.js', edits: [{ old: '"hola"', new: '"buenas"' }] });
  t('un fs_edit válido muestra diff', p.mode, 'diff');
  t('  con las cuentas del cambio', [p.added, p.removed], [1, 1]);
  t('  y la ruta absoluta, no la relativa', p.target, path.join(TMP, 'e.js'));
  t('  sin haber escrito nada todavía', leer('e.js'), CODIGO);

  // La garantía que junta las dos mitades: lo que la tarjeta dibuja sale de la
  // MISMA función que después escribe.
  const despues = applyEdits(CODIGO, [{ old: '"hola"', new: '"buenas"' }], false).text;
  const dReal = diffLines(CODIGO, despues);
  t('el diff de la tarjeta es el del disco', [p.added, p.removed], [dReal.added, dReal.removed]);
  await edit(run, { path: 'e.js', edits: [{ old: '"hola"', new: '"buenas"' }] });
  t('  y el archivo terminó exactamente así', leer('e.js'), despues);

  p = await preview('fs_edit', { path: 'e.js', edits: [{ old: 'saludo', new: 'x' }] });
  t('un edit ambiguo se ve ANTES de aprobar', p.mode, 'fail');
  ok_('  con el motivo', /appears/.test(p.error), p.error);

  p = await preview('fs_edit', { path: 'ni-idea.js', edits: [{ old: 'a', new: 'b' }] });
  t('editar lo que no existe se avisa en la tarjeta', p.mode, 'missing');

  p = await preview('fs_write', { path: 'nuevo.js', content: 'a\nb\n' });
  t('un fs_write a un archivo nuevo se declara nuevo', p.mode, 'new');
  t('  y dice cuántas líneas', p.lines, 2);
  t('  sin crear nada', fs.existsSync(path.join(TMP, 'nuevo.js')), false);

  p = await preview('fs_write', { path: 'e.js', content: despues.replace('"buenas"', '"chau"') });
  t('un fs_write que PISA algo existente muestra el diff', p.mode, 'diff');
  ok_('  que es lo que la tarjeta nunca decía', p.added === 1 && p.removed === 1);

  p = await preview('fs_write', { path: 'e.js', content: despues });
  t('pisar con lo mismo se declara sin cambios', [p.mode, p.changed], ['diff', false]);

  p = await preview('fs_write', { path: 'e.js', content: 'x', append: true });
  t('un append no es un diff: no cambia nada de lo que ya está', p.mode, 'append');

  // La tarjeta miraba `append === true` y el runner truthiness, así que un
  // `append` que no fuera el booleano exacto —y un modelo chico manda 1, "yes",
  // "true"— mostraba un diff de REEMPLAZO TOTAL y después agregaba al final: el
  // usuario aprobaba borrar el archivo y lo que pasaba era otra cosa.
  for (const valor of [1, 'yes', 'true']) {
    p = await preview('fs_write', { path: 'e.js', content: 'x', append: valor });
    t(`append: ${JSON.stringify(valor)} se ve como append, no como reemplazo`, p.mode, 'append');
  }
  p = await preview('fs_write', { path: 'e.js', content: 'x', append: false });
  t('append: false sigue siendo un reemplazo', p.mode, 'diff');
  p = await preview('fs_write', { path: 'ni-existe.js', content: 'x\ny\n', append: true });
  t('pero un append a un archivo que no existe LO CREA, y se dice', p.mode, 'new');

  fs.writeFileSync(path.join(TMP, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  p = await preview('fs_write', { path: 'bin.dat', content: 'texto' });
  t('un archivo binario no finge un diff', p.mode, 'binary');

  t('una tool que no escribe no tiene preview', await preview('shell_exec', { command: 'dir' }), null);
  t('sin path tampoco', await preview('fs_write', { content: 'x' }), null);
}

// ═══════════════════════════════════════════════════════════════════════════
// fs_delete: la papelera y lo que la tarjeta muestra (test-fs-delete.js)
// ═══════════════════════════════════════════════════════════════════════════
async function probarDelete() {
  const tmp = fresh('blackcode-del-');
  const run = () => ({ reqId: 'r1', cwd: tmp, notify() {} });

  // La papelera va falsa a propósito: el test NO puede depender de la papelera
  // real del que lo corre, y lo que se prueba es a quién se llama y con qué.
  let pedido = null;
  const papeleraOk = async (p) => { pedido = p; };
  const papeleraRota = async () => { throw new Error('no such volume'); };
  const runnerCon = (trash) => { configurar({ trash }); return runners.fs_delete; };

  // ── el invariante que no puede volver a romperse ──────────────────────────
  // Sobre el fuente del runner, como en NeonCode: acá sale de toString().
  seccion('fs_delete: el runner no borra de verdad');
  const runnerSrc = runFsDelete.toString();
  ok_('no llama a fsp.rm', !/fsp\.rm\(/.test(runnerSrc), runnerSrc);
  ok_('no llama a fsp.unlink', !/fsp\.unlink\(/.test(runnerSrc), runnerSrc);
  ok_('manda a la papelera', /await trashItem\(abs\)/.test(runnerSrc));
  // Si la papelera falla, el catch NO puede tener un plan B que borre.
  const catchSrc = runnerSrc.slice(runnerSrc.indexOf('} catch'));
  ok_('el catch no tiene fallback destructivo', !/rm\(|unlink\(|rmdir\(/.test(catchSrc), catchSrc);

  // ── countTree ─────────────────────────────────────────────────────────────
  seccion('countTree: qué se lleva puesto');
  const arbol = path.join(tmp, 'arbol');
  await fsp.mkdir(path.join(arbol, 'sub', 'hondo'), { recursive: true });
  await fsp.writeFile(path.join(arbol, 'a.txt'), 'aaaa');           // 4 bytes
  await fsp.writeFile(path.join(arbol, 'sub', 'b.txt'), 'bb');      // 2
  await fsp.writeFile(path.join(arbol, 'sub', 'hondo', 'c.txt'), 'cccccc'); // 6
  const c1 = await countTree(arbol, 5000);
  t('cuenta los archivos de todo el árbol', c1.files, 3);
  t('cuenta los subdirectorios', c1.dirs, 2);
  t('suma los bytes', c1.bytes, 12);
  t('un árbol chico no queda parcial', c1.partial, false);

  const c2 = await countTree(arbol, 2);
  ok_('con presupuesto corto se marca parcial', c2.partial === true);
  ok_('y no cuenta de más', c2.files + c2.dirs <= 3, `${c2.files + c2.dirs}`);

  const vacio = path.join(tmp, 'vacio');
  await fsp.mkdir(vacio);
  t('carpeta vacía', [(await countTree(vacio, 5000)).files], [0]);

  // ── deletePreview ─────────────────────────────────────────────────────────
  seccion('fs_delete: la tarjeta dice qué se pierde');
  const preview = (a) => deletePreview(run(), a);

  const unArchivo = path.join(tmp, 'solo.txt');
  await fsp.writeFile(unArchivo, 'hola mundo'); // 10 bytes
  const pFile = await preview({ path: unArchivo });
  t('un archivo se presenta como delfile', pFile.mode, 'delfile');
  t('con su tamaño', pFile.bytes, 10);

  const pDir = await preview({ path: arbol, force: true });
  t('una carpeta con force se presenta como deldir', pDir.mode, 'deldir');
  t('y trae la cuenta del árbol', [pDir.files, pDir.dirs, pDir.bytes], [3, 2, 12]);

  // Sin force el runner devuelve error sin tocar nada: la tarjeta tiene que
  // decirlo ANTES, igual que un fs_edit que no matchea.
  const pSinForce = await preview({ path: arbol });
  t('una carpeta sin force avisa que va a fallar', pSinForce.mode, 'fail');
  ok_('y explica por qué', /force=true/.test(pSinForce.error || ''), pSinForce.error);

  const pNada = await preview({ path: path.join(tmp, 'no-existe') });
  t('un path inexistente se presenta como nothing', pNada.mode, 'nothing');

  t('sin path no hay tarjeta que armar', await preview({}), null);
  t('path vacío tampoco', await preview({ path: '   ' }), null);

  // La ruta que se muestra es la ABSOLUTA resuelta, no la que escribió el
  // modelo: aprobar un 'solo.txt' relativo es aprobar sin saber dónde.
  const pRel = await preview({ path: 'solo.txt' });
  t('la ruta relativa se resuelve contra el cwd', pRel.target, unArchivo);

  // La entrada pública del módulo llega al mismo lugar: preview() despacha el
  // borrado a deletePreview.
  const pPublica = await writePreview(run(), 'fs_delete', { path: 'solo.txt' });
  t('preview(run, "fs_delete", …) da la misma tarjeta', pPublica, pRel);

  // ── el runner ─────────────────────────────────────────────────────────────
  seccion('fs_delete: el runner');
  const r1 = await runnerCon(papeleraOk)(run(), { path: unArchivo });
  t('manda el archivo a la papelera', pedido, unArchivo);
  ok_('y lo dice en el resultado', /Recycle Bin/.test(r1), r1);
  ok_('  y que se puede restaurar', /restore/.test(r1), r1);
  ok_('el archivo sigue en disco (la papelera es falsa acá)', fs.existsSync(unArchivo));

  pedido = null;
  const r2 = await runnerCon(papeleraOk)(run(), { path: arbol });
  ok_('una carpeta sin force no se toca', pedido === null, String(pedido));
  ok_('y el error explica el force', /force=true/.test(r2), r2);

  pedido = null;
  const r3 = await runnerCon(papeleraOk)(run(), { path: arbol, force: true });
  t('con force sí va a la papelera', pedido, arbol);
  ok_('el resultado la nombra como directorio', /directory/.test(r3), r3);

  // El caso que justifica no tener fallback: la papelera falla y NADA se borra.
  const r4 = await runnerCon(papeleraRota)(run(), { path: unArchivo });
  ok_('si la papelera falla se reporta', /^error:/.test(r4), r4);
  ok_('y se aclara que no se borró nada', /nothing was deleted/.test(r4), r4);
  ok_('el archivo sigue estando', fs.existsSync(unArchivo));

  const r5 = await runnerCon(papeleraOk)(run(), { path: '' });
  ok_('sin path es error', /^error: path is required/.test(r5), r5);

  pedido = null;
  const r6 = await runnerCon(papeleraOk)(run(), { path: path.join(tmp, 'fantasma') });
  ok_('un path inexistente no llega a la papelera', pedido === null, String(pedido));
  ok_('y devuelve error', /^error:/.test(r6), r6);

  // ── propio de BlackCode: sin papelera configurada ───────────────────────────────
  // Tiene que terminar igual que una papelera que falla, nunca en un borrado.
  seccion('fs_delete: sin papelera configurada (adaptación de BlackCode)');
  configurar({ trash: null });
  const r7 = await runners.fs_delete(run(), { path: unArchivo });
  ok_('sin papelera el borrado falla', /^error:/.test(r7), r7);
  ok_('  diciendo que no se borró nada', /nothing was deleted/.test(r7), r7);
  ok_('  y el archivo sigue estando', fs.existsSync(unArchivo));
  const r8 = await runners.fs_delete(run(), { path: arbol, force: true });
  ok_('una carpeta con force tampoco se toca', /^error:.*nothing was deleted/.test(r8) && fs.existsSync(path.join(arbol, 'a.txt')), r8);
  const r9 = await runners.fs_delete(run(), { path: arbol });
  ok_('y el orden de los chequeos no cambia: primero el force', /force=true/.test(r9), r9);
}

// ═══════════════════════════════════════════════════════════════════════════
// Propio de BlackCode: fs_write y el journal del deshacer inyectado
// ═══════════════════════════════════════════════════════════════════════════
async function probarWriteYUndo() {
  const TMP = fresh('blackcode-fswrite-');
  const run = runEn(TMP);
  const write = runners.fs_write;
  const leer = (rel) => fs.readFileSync(path.join(TMP, rel), 'utf8');

  seccion('fs_write: lo básico');
  configurar({ undo: null, trash: null });
  let out = await write(run, { path: 'sub/nuevo.txt', content: 'hola\n' });
  ok_('crea el archivo y sus carpetas', /^wrote 5 bytes to /.test(out), out);
  t('  con el contenido pedido', leer('sub/nuevo.txt'), 'hola\n');
  ok_('  y nombra la ruta absoluta', out.endsWith(path.join(TMP, 'sub', 'nuevo.txt')), out);

  out = await write(run, { path: 'sub/nuevo.txt', content: 'otra cosa' });
  t('escribir REEMPLAZA el archivo entero', leer('sub/nuevo.txt'), 'otra cosa');
  ok_('  y no deja temporales al lado',
    fs.readdirSync(path.join(TMP, 'sub')).every((f) => !f.endsWith('.tmp')));

  out = await write(run, { path: 'sub/nuevo.txt', content: '!', append: true });
  ok_('append agrega al final', /^appended 1 bytes to /.test(out), out);
  t('  sin pisar lo que había', leer('sub/nuevo.txt'), 'otra cosa!');

  // La misma lectura de `append` que la tarjeta (esAppend): un 1 o un "yes"
  // agregan, que es lo que la tarjeta le mostró al usuario.
  out = await write(run, { path: 'sub/nuevo.txt', content: '?', append: 'yes' });
  t('append: "yes" agrega, igual que en la tarjeta', leer('sub/nuevo.txt'), 'otra cosa!?');

  out = await write(run, { path: '   ', content: 'x' });
  ok_('sin path es error', /^error: path is required/.test(out), out);

  out = await write(run, { path: 'sub', content: 'x' });
  ok_('escribir sobre una carpeta es un error, no una excepción', /^error:/.test(out), out);

  seccion('el journal del deshacer: inyectado y mudo por defecto');
  // Sin journal las tools andan igual (es lo que corrió todo lo de arriba).
  // Con uno enchufado, cada mutación prepara ANTES y confirma DESPUÉS.
  const pasos = [];
  const journal = {
    async preparar(abs) {
      const existed = fs.existsSync(abs);
      const before = existed && fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null;
      pasos.push(['preparar', path.basename(abs), before ? before.toString('utf8') : null]);
      return { abs, existed, before, tooBig: false };
    },
    confirmar(pend, datos) {
      pasos.push(['confirmar', datos.tool, path.basename(pend.abs),
        datos.afterBytes ? datos.afterBytes.toString('utf8') : null, datos.run === run]);
    },
  };
  let pedido = null;
  configurar({ undo: journal, trash: async (p) => { pedido = p; } });

  await write(run, { path: 'j.txt', content: 'uno' });
  t('fs_write prepara con lo que había y confirma con lo que quedó', pasos,
    [['preparar', 'j.txt', null], ['confirmar', 'fs_write', 'j.txt', 'uno', true]]);

  pasos.length = 0;
  await write(run, { path: 'j.txt', content: '+dos', append: true });
  t('un append confirma con el contenido RESULTANTE', pasos,
    [['preparar', 'j.txt', 'uno'], ['confirmar', 'fs_write', 'j.txt', 'uno+dos', true]]);

  pasos.length = 0;
  await runners.fs_edit(run, { path: 'j.txt', edits: [{ old: 'uno', new: 'UNO' }] });
  t('fs_edit también', pasos,
    [['preparar', 'j.txt', 'uno+dos'], ['confirmar', 'fs_edit', 'j.txt', 'UNO+dos', true]]);

  pasos.length = 0;
  await runners.fs_edit(run, { path: 'j.txt', edits: [{ old: 'no-esta', new: 'x' }] });
  t('un edit que falla no deja rastro en el journal', pasos, []);

  pasos.length = 0;
  await runners.fs_delete(run, { path: 'j.txt' });
  t('fs_delete prepara, manda a la papelera y confirma sin bytes', pasos,
    [['preparar', 'j.txt', 'UNO+dos'], ['confirmar', 'fs_delete', 'j.txt', null, true]]);
  t('  con la papelera inyectada', pedido, path.join(TMP, 'j.txt'));

  pasos.length = 0;
  configurar({ trash: async () => { throw new Error('no such volume'); } });
  await runners.fs_delete(run, { path: 'j.txt' });
  t('si la papelera falla no se confirma nada', pasos, [['preparar', 'j.txt', 'UNO+dos']]);

  // Un journal caído NUNCA frena la tool.
  configurar({
    undo: {
      async preparar() { throw new Error('undo.db cerrada'); },
      confirmar() { throw new Error('undo.db cerrada'); },
    },
  });
  out = await write(run, { path: 'k.txt', content: 'igual se escribe' });
  ok_('un journal que tira en preparar no frena la escritura', /^wrote /.test(out), out);
  t('  y el archivo quedó', leer('k.txt'), 'igual se escribe');

  // preparar anda y confirmar tira: tampoco. El aviso va a la consola (como en
  // NeonCode), que acá se calla para no ensuciar la salida del test.
  configurar({ undo: { async preparar(abs) { return { abs }; }, confirmar() { throw new Error('undo.db cerrada'); } } });
  const warn = console.warn;
  let avisos = 0;
  console.warn = () => { avisos++; };
  try {
    out = await write(run, { path: 'k.txt', content: 'otra vez' });
  } finally {
    console.warn = warn;
  }
  ok_('un journal que tira en confirmar tampoco', /^wrote /.test(out), out);
  t('  y lo avisa por consola, una vez', avisos, 1);

  configurar({ undo: null, trash: null });
}

try {
  await probarRead();
  await probarEdit();
  await probarDelete();
  await probarWriteYUndo();
} catch (e) {
  failures.push(`explotó en «${seccionActual}»: ${e?.stack || e}`);
} finally {
  limpiar();
}

if (failures.length) {
  console.error(`test-blackcode-tools-fs: ${failures.length} falla(s) de ${aserciones} aserciones`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-fs: ok (${aserciones} aserciones: diff, fs_read, fs_edit, fs_write, fs_delete, tarjeta, papelera y journal inyectados)`);
