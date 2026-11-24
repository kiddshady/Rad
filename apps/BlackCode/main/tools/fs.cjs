'use strict';

// Las tools de archivos de BlackCode: fs_read, fs_write, fs_edit y fs_delete, y el
// preview que la tarjeta de confirmación muestra ANTES de aprobar una
// escritura, un edit o un borrado (el diff, o la cuenta de lo que se pierde).
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y los mensajes,
// los topes y el orden de los chequeos son los mismos. El contrato de una tool
// está en base.cjs.
//
// LO QUE SE ADAPTÓ, y nada más:
//
//   - Lo que en el archivo grande eran globales ahora se importa: el cwd de la
//     corrida y la escritura atómica salen de base.cjs (resolverEn,
//     atomicWriteText) y el diff de diff.cjs (diffLines, splitLines).
//   - El journal del deshacer NO vino. Los runners siguen llamando a
//     undoPreparar / undoConfirmar en los mismos lugares, pero las dos pasan
//     por un journal inyectable — configurar({ undo }) — que por defecto no
//     existe: sin él no hacen nada. Enchufarlo después no toca los runners.
//   - fs_delete usaba shell.trashItem de Electron. Acá la papelera llega
//     inyectada — configurar({ trash }), una función (rutaAbsoluta) => Promise —
//     para que el módulo no dependa de Electron. Sin una configurada falla como
//     fallaba el original cuando la Papelera no está disponible: se reporta y
//     no se borra nada. No hay, ni puede haber, un plan B con rm.
//   - writePreview perdió las ramas de canvas y de schedule: BlackCode todavía no
//     tiene esas tools. Las de archivos están enteras.
//
// En los textos que lee el modelo «NeonCode» pasa a ser «BlackCode»; en lo que se
// portó no hubo ninguno que cambiar.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { resolverEn, atomicWriteText } = require('./base.cjs');
const { diffLines, splitLines } = require('./diff.cjs'); // puro: qué cambia una escritura, para la tarjeta y para el ledger

// ---------------------------------------------------------------------------
// Lo que este módulo necesita de la app. Llega por configurar(), nunca por un
// global (ver el contrato en base.cjs).
//
//   trash(abs) -> Promise   manda un archivo o una carpeta a la Papelera. En la
//                           app es (p) => shell.trashItem(p); en los tests, un
//                           fake.
//   undo                    el journal del deshacer, con preparar(abs) y
//                           confirmar(pend, datos). Todavía no existe en BlackCode.
//
// Cada llamada cambia solo las llaves que trae: configurar({ trash }) no le
// saca el journal a nadie. Pasar null desenchufa.
// ---------------------------------------------------------------------------
let trash = null;
let undoJournal = null;

function configurar(deps = {}) {
  if ('trash' in deps) trash = typeof deps.trash === 'function' ? deps.trash : null;
  if ('undo' in deps) undoJournal = deps.undo || null;
}

// Sin papelera configurada esto tira, y el catch de runFsDelete lo convierte en
// «error: … — nothing was deleted»: el mismo final que una Papelera que falla.
async function trashItem(abs) {
  if (!trash) throw new Error('the Recycle Bin is not available');
  await trash(abs);
}

/** Fase 1 del journal, envuelta: un journal caído NUNCA frena la tool. */
async function undoPreparar(abs) {
  if (!undoJournal) return null;
  try { return await undoJournal.preparar(abs); } catch { return null; }
}

/** Fase 2: la fila nace recién con la mutación ya hecha. Mismo criterio. */
function undoConfirmar(pend, datos) {
  if (!pend || !undoJournal) return;
  try { undoJournal.confirmar(pend, datos); } catch (err) { console.warn('[undo] confirmar:', err?.message || err); }
}

// ---------------------------------------------------------------------------
// Filesystem: lectura multi-archivo con budget, escritura atómica, borrado con
// guarda para directorios. Paths relativos → cwd persistente (el mismo que ve
// el shell), nunca el dir de instalación.
// ---------------------------------------------------------------------------

const FS_READ_MAX_FILES = 10;
const FS_READ_FILE_CHARS = 4000;
const FS_READ_TOTAL_CHARS = 12000;
// Cuántos nombres entran en el listado de un directorio. Era 50 y cortaba EN
// SILENCIO: C:\ tiene 65 entradas, así que el modelo veía 50 y daba la carpeta
// por completa. 200 entra cómodo en cualquier carpeta de trabajo (C:\ y C:\tools
// caben enteras) y lo que igual se pase ahora se anuncia — ver runFsRead.
const FS_READ_DIR_ENTRIES = 200;

async function runFsRead(run, { paths } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).slice(0, FS_READ_MAX_FILES);
  if (!list.length) return 'error: paths is required';
  const first = path.basename(String(list[0]));
  run.notify('tool:activity', {
    reqId: run.reqId, kind: 'fs_read',
    label: list.length > 1 ? `${first} +${list.length - 1} more` : first,
  });
  const parts = [];
  let total = 0;
  for (const p of list) {
    const abs = resolverEn(run, p);
    try {
      const st = await fsp.stat(abs);
      if (st.isDirectory()) {
        const all = await fsp.readdir(abs, { withFileTypes: true });
        // Carpetas primero y alfabético: el corte de abajo tiene que ser
        // PREDECIBLE. Con el orden que devuelve el filesystem, "las primeras
        // 200" no significa nada y dos listados de la misma carpeta pueden no
        // coincidir. Ordenado, el modelo al menos sabe por dónde quedó.
        const sorted = all
          .map((e) => ({ name: e.name + (e.isDirectory() ? '/' : ''), dir: e.isDirectory() }))
          .sort((a, b) => (Number(b.dir) - Number(a.dir))
            || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        const shown = sorted.slice(0, FS_READ_DIR_ENTRIES);
        const rest = sorted.length - shown.length;
        // El total REAL siempre, aunque no se trunque, y el sobrante nombrado
        // cuando se trunca. Antes esto cortaba mudo en 50: una respuesta
        // incompleta presentada como completa, que es peor que un error —
        // el modelo no tenía cómo saber que le faltaba nada.
        const head = `[directory — ${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'}]`;
        const tail = rest ? `\n…[${rest} more not shown — narrow it down with code_search or shell_exec]` : '';
        const block = `== ${abs} ==\n${head}\n${shown.map((e) => e.name).join('\n') || '(empty)'}${tail}`;
        parts.push(block);
        // el listado también gasta presupuesto: diez carpetas grandes llenaban
        // el contexto sin que nada las contara (solo sumaban los archivos)
        total += block.length;
        if (total > FS_READ_TOTAL_CHARS) { parts.push('…[total read budget reached — ask for fewer paths]'); break; }
        continue;
      }
      let txt = await fsp.readFile(abs, 'utf8');
      if (txt.length > FS_READ_FILE_CHARS) {
        txt = `${txt.slice(0, FS_READ_FILE_CHARS)}\n…[truncated ${txt.length - FS_READ_FILE_CHARS} chars]`;
      }
      parts.push(`== ${abs} ==\n${txt}`);
      total += txt.length;
      if (total > FS_READ_TOTAL_CHARS) { parts.push('…[total read budget reached — ask for fewer files]'); break; }
    } catch (err) {
      parts.push(`== ${abs} ==\nerror: ${err.message}`);
    }
  }
  return parts.join('\n\n');
}

// UNA sola lectura de `append`, para la tarjeta y para el runner. La tarjeta
// miraba `=== true` y el runner truthiness, así que un `append: "yes"` —o un 1,
// que es como lo manda un modelo chico— mostraba un diff de reemplazo total y
// después agregaba al final: el usuario aprobaba una cosa y en el disco pasaba
// otra, que es justo lo que el preview existe para que no ocurra.
const esAppend = (a) => !!(a && a.append);

async function runFsWrite(run, args = {}) {
  const { path: p, content } = args;
  if (!p || !String(p).trim()) return 'error: path is required';
  const abs = resolverEn(run, p);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'fs_write', label: path.basename(abs) });
  try {
    const text = String(content ?? '');
    const append = esAppend(args);
    // el journal del deshacer: los bytes previos ANTES de mutar, la fila recién
    // DESPUÉS de mutar con éxito — una tool que falla no deja rastro
    const undoPend = await undoPreparar(abs);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    if (append) await fsp.appendFile(abs, text, 'utf8');
    else await atomicWriteText(abs, text); // overwrite fallido no trunca el original
    const buf = Buffer.from(text, 'utf8');
    undoConfirmar(undoPend, {
      run,
      tool: 'fs_write',
      // el hash de después es sobre el CONTENIDO RESULTANTE del archivo: para un
      // append, previo + agregado (si el previo era gigante no hay hash honesto
      // que dar, y esa op ya quedó como no revertible de todos modos)
      afterBytes: !append ? buf
        : !undoPend?.existed ? buf
          : undoPend.tooBig ? null
            : Buffer.concat([undoPend.before, buf]),
    });
    return `${append ? 'appended' : 'wrote'} ${Buffer.byteLength(text)} bytes to ${abs}`;
  } catch (err) {
    return `error: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// fs_edit — reemplazo exacto de fragmentos. El corazón está acá y no en el
// runner a propósito: es una función PURA sobre texto, así la usan las dos
// puntas —el runner que escribe y el preview que le muestra el diff al usuario
// antes de aprobar— sin que ninguna adivine lo que va a hacer la otra. Si la
// tarjeta dijera una cosa y el disco otra, el diff sería peor que no mostrarlo.
//
// El final de línea se resuelve POR EDIT y nunca sobre el archivo entero: si el
// `old` con \n no aparece, se prueba la variante con \r\n (y entonces el `new`
// también sale en CRLF). Normalizar el archivo completo habría sido más corto y
// habría reescrito en silencio líneas que el edit ni nombra — justo la clase de
// cambio invisible que esta tool existe para no hacer. El BOM viaja intacto por
// el mismo motivo: nadie lo toca, está antes del primer match.
function countHits(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function applyEdits(text, edits, replaceAll) {
  let out = String(text ?? '');
  for (let k = 0; k < edits.length; k++) {
    const e = edits[k] || {};
    // `replace_all` vale arriba (para toda la llamada) Y adentro de cada edit,
    // ganando el del edit. No es tolerancia gratis: puesto a elegir solo, el
    // modelo lo mandó adentro del edit —que además es lo más expresivo, porque
    // uno puede querer reemplazar todo y el otro no—. Como el schema solo lo
    // declaraba arriba quedaba ignorado, y la llamada moría con "…or pass
    // replace_all:true" contra un modelo que lo acababa de pasar: un callejón
    // sin salida escrito por nosotros.
    //
    // Va inline y no en un helper aparte por lo mismo que argsDigest: esta
    // función se extrae sola del fuente en DOS suites, y cada dependencia nueva
    // hay que acordarse de sumarla en las dos.
    const todas = typeof e.replace_all === 'boolean' ? e.replace_all : replaceAll === true;
    const donde = `edit ${k + 1} of ${edits.length}`;
    const viejo = typeof e.old === 'string' ? e.old : null;
    const nuevo = typeof e.new === 'string' ? e.new : null;
    if (viejo === null || nuevo === null) return { ok: false, error: `${donde}: both 'old' and 'new' are required strings` };
    if (!viejo) return { ok: false, error: `${donde}: 'old' is empty — there is no way to know where to insert` };
    if (viejo === nuevo) return { ok: false, error: `${donde}: 'old' and 'new' are identical — nothing to change` };

    // Las DOS formas se cuentan SIEMPRE, no la CRLF solo cuando la LF no
    // aparece. Con el fallback condicional, un archivo de finales mezclados
    // —cualquiera que haya pasado por un editor y un git mal configurado— tenía
    // la forma LF presente, así que el fallback no se disparaba nunca:
    // `replace_all` cambiaba solo las ocurrencias LF y devolvía éxito, y la
    // guarda de unicidad tampoco veía las CRLF, así que un `old` que aparecía
    // dos veces pasaba como único. Las dos formas son disjuntas (después de la
    // 'a' hay un \r o hay un \n, no las dos), así que se suman sin doble conteo.
    const viejoCrlf = viejo.includes('\n') ? viejo.replace(/\r?\n/g, '\r\n') : null;
    const nuevoCrlf = viejoCrlf ? nuevo.replace(/\r?\n/g, '\r\n') : null;
    const hitsLf = countHits(out, viejo);
    const hitsCrlf = (viejoCrlf && viejoCrlf !== viejo) ? countHits(out, viejoCrlf) : 0;
    const needle = hitsLf ? viejo : viejoCrlf;
    const repl = hitsLf ? nuevo : nuevoCrlf;
    const hits = hitsLf + hitsCrlf;
    if (!hits) {
      return {
        ok: false,
        error: `${donde}: 'old' was not found in the file — nothing was written. `
          + 'Read the file again and copy the snippet exactly as it is, including indentation.',
      };
    }
    if (hits > 1 && !todas) {
      return {
        ok: false,
        error: `${donde}: 'old' appears ${hits} times — nothing was written. `
          + 'Add the surrounding lines until the snippet is unique, or pass replace_all:true to change all of them.',
      };
    }
    if (todas) {
      // las dos formas, o `replace_all` deja atrás justo las que no miró
      if (hitsLf) out = out.split(viejo).join(nuevo);
      if (hitsCrlf) out = out.split(viejoCrlf).join(nuevoCrlf);
    } else {
      const i = out.indexOf(needle);
      out = out.slice(0, i) + repl + out.slice(i + needle.length);
    }
  }
  return { ok: true, text: out };
}

// Normaliza lo que mandó el modelo a una lista de edits. Se aceptan dos formas
// mal armadas porque son las DOS que manda un modelo chico, y rechazarlas cuesta
// una ronda entera para algo que se entiende perfecto: un edit suelto sin array,
// y la lista doble-codificada como string (el argumento ya viene de un JSON.parse,
// así que un JSON adentro del JSON es un error de armado, no un dato).
// Lo que NO se adivina es el contenido: si el string no parsea, es lista vacía.
function normalizeEdits(edits) {
  if (Array.isArray(edits)) return edits;
  if (typeof edits === 'string' && edits.trim()) {
    try { return normalizeEdits(JSON.parse(edits)); } catch { return []; }
  }
  if (edits && typeof edits === 'object') return [edits];
  return [];
}

// ---------------------------------------------------------------------------
// El preview de la tarjeta: QUÉ cambia en disco, resuelto acá.
//
// La tarjeta mostraba los argumentos crudos, así que pisar un archivo que ya
// existía se aprobaba leyendo el contenido nuevo — sin una sola señal de qué
// había antes, ni siquiera de que el archivo existía. Eso no es un OK
// informado, y el README promete lo contrario.
//
// Se calcula en el main y no en el renderer por una razón de fondo: el archivo
// viejo no tiene por qué cruzar el puente. Lo que viaja son hunks, que es lo
// único que se pinta.
//
// Es un PREVIEW, no una promesa: entre la tarjeta y la escritura el archivo
// puede cambiar, y quien manda es el runner, que relee y reaplica. Por eso un
// fs_edit que acá falla igual se deja aprobar — el error se muestra, y el
// runner dirá la verdad final.
const PREVIEW_MAX_CHARS = 2_000_000; // tope de PANTALLA, no de la tool: el runner no mira esto

// El borrado se aprobaba a ciegas. La tarjeta mostraba `path` crudo y nada más:
// ni si era un archivo o una carpeta, ni cuánto se llevaba puesto. Es el MISMO
// agujero que el diff vino a tapar para fs_write —aprobabas mirando lo que iba a
// quedar, nunca lo que se iba a perder— y había quedado abierto justo en la
// única tool cuya pérdida ningún diff puede reconstruir después.
//
// Un `fs_delete C:\tools\miapp\src` con force se lleva el árbol entero, y la
// tarjeta no decía que ahí adentro había 47 archivos.
const DELETE_SCAN_MAX = 5000; // techo de nodos: un node_modules no puede colgar la tarjeta

/** Cuenta el árbol para la tarjeta, con presupuesto. No sigue symlinks:
 *  `withFileTypes` los reporta como link y no como directorio, así que un enlace
 *  a otra carpeta se cuenta como una entrada y no se recorre — contar el destino
 *  diría que se pierde algo que el borrado no toca. */
async function countTree(dir, budget) {
  let files = 0; let dirs = 0; let bytes = 0; let partial = false;
  const walk = async (d) => {
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files + dirs >= budget) { partial = true; return; }
      const full = path.join(d, e.name);
      if (e.isDirectory()) { dirs++; await walk(full); continue; }
      files++;
      try { bytes += (await fsp.lstat(full)).size; } catch { /* desapareció entre el readdir y el stat */ }
    }
  };
  await walk(dir);
  return { files, dirs, bytes, partial };
}

async function deletePreview(run, a) {
  if (!a.path || !String(a.path).trim()) return null;
  let abs;
  try { abs = resolverEn(run, a.path); } catch { return null; }
  let st;
  // lstat y no stat: lo que se borra es el enlace, no lo que apunta
  try { st = await fsp.lstat(abs); } catch { return { target: abs, mode: 'nothing' }; }
  if (!st.isDirectory()) return { target: abs, mode: 'delfile', bytes: st.size };
  // Mismo trato que un fs_edit que no matchea: si la llamada va a fallar, la
  // tarjeta lo dice ANTES en vez de pedir un OK a algo que no va a pasar.
  if (a.force !== true) {
    return { target: abs, mode: 'fail', error: 'This is a folder, and the call did not pass force=true — it will fail without deleting anything.' };
  }
  return { target: abs, mode: 'deldir', ...await countTree(abs, DELETE_SCAN_MAX) };
}

// El `run` no es decorativo: la tarjeta tiene que resolver la ruta contra el
// MISMO cwd que va a usar el runner, y ese cwd es el de la corrida — no el
// global, que otro chat puede mover mientras esta tarjeta está esperando.
async function writePreview(run, name, args) {
  const a = args || {};
  if (name === 'fs_delete') return deletePreview(run, a);
  if (name !== 'fs_write' && name !== 'fs_edit') return null;
  if (!a.path || !String(a.path).trim()) return null;
  let abs;
  try { abs = resolverEn(run, a.path); } catch { return null; }

  let antes = null;
  try { antes = await fsp.readFile(abs, 'utf8'); } catch { antes = null; } // no existe o no se puede leer

  if (name === 'fs_write') {
    // Un archivo nuevo no tiene contra qué difear, pero que sea NUEVO es
    // justamente lo que la tarjeta nunca decía: se dice. Va ANTES del append
    // porque un append sobre algo que no existe también lo crea, y anunciarlo
    // como "no cambia nada de lo que ya está" sería falso.
    if (antes === null) return { target: abs, mode: 'new', lines: splitLines(a.content).lines.length };
    if (esAppend(a)) return { target: abs, mode: 'append' };
  } else if (antes === null) {
    return { target: abs, mode: 'missing' };
  }

  if (antes.includes('\0')) return { target: abs, mode: 'binary' };
  if (antes.length > PREVIEW_MAX_CHARS) return { target: abs, mode: 'toobig' };

  let despues;
  if (name === 'fs_write') {
    despues = String(a.content ?? '');
  } else {
    const r = applyEdits(antes, normalizeEdits(a.edits), a.replace_all === true);
    // Un edit que no matchea se ve ANTES de aprobarlo: la tarjeta dice cuál
    // falló y por qué, en vez de pedir un OK a algo que no va a pasar.
    if (!r.ok) return { target: abs, mode: 'fail', error: r.error };
    despues = r.text;
  }
  return { target: abs, mode: 'diff', ...diffLines(antes, despues) };
}

async function runFsEdit(run, { path: p, edits, replace_all: replaceAll } = {}) {
  if (!p || !String(p).trim()) return 'error: path is required';
  const abs = resolverEn(run, p);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'fs_edit', label: path.basename(abs) });
  const list = normalizeEdits(edits);
  if (!list.length) return "error: edits is required — pass at least one { old, new }";
  let antes;
  try {
    antes = await fsp.readFile(abs, 'utf8');
  } catch (err) {
    return `error: ${err.message}`
      + (err.code === 'ENOENT' ? ' — fs_edit only changes files that already exist; use fs_write to create one' : '');
  }
  const r = applyEdits(antes, list, replaceAll === true);
  if (!r.ok) return `error: ${r.error}`; // el archivo queda intacto: no se escribió nada
  // el journal lee sus PROPIOS bytes (crudos, no el utf8 de arriba): el revert
  // restaura exacto, BOM y finales de línea incluidos
  const undoPend = await undoPreparar(abs);
  try {
    await atomicWriteText(abs, r.text); // overwrite fallido no trunca el original
  } catch (err) {
    return `error: ${err.message}`;
  }
  undoConfirmar(undoPend, { run, tool: 'fs_edit', afterBytes: Buffer.from(r.text, 'utf8') });
  // Las mismas cuentas que vio el usuario en la tarjeta. Viajan al modelo como
  // evidencia de lo que pasó de verdad, que es de lo que vive todo el registro.
  const d = diffLines(antes, r.text, { context: 0, maxLines: 0 });
  return `edited ${abs} — ${list.length} edit${list.length === 1 ? '' : 's'} applied, +${d.added} -${d.removed} lines`;
}

// PAPELERA Y NO `rm`. Era `fsp.rm({ recursive: true, force: true })` y
// `fsp.unlink`: borrado real, irreversible, sobre carpetas que muchas veces no
// están en git. Toda la app está construida sobre la idea de que una acción
// destructiva se ve antes de pasar (el diff, la tarjeta, el ledger), y ésta era
// la única que además no se podía deshacer DESPUÉS.
//
// `shell.trashItem` manda a la Papelera de Windows, de donde el usuario restaura
// sin nosotros. Si falla NO se cae a `rm`: un fallback destructivo convertiría
// justo el caso raro —una unidad de red, un volumen sin papelera— en el único
// que borra para siempre, y en silencio. Se reporta y no se toca nada.
async function runFsDelete(run, { path: p, force } = {}) {
  if (!p || !String(p).trim()) return 'error: path is required';
  const abs = resolverEn(run, p);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'fs_delete', label: path.basename(abs) });
  try {
    const st = await fsp.lstat(abs); // el enlace se borra como enlace
    if (st.isDirectory() && force !== true) {
      return `error: ${abs} is a directory — pass force=true to move it and everything inside to the Recycle Bin`;
    }
    // solo archivos: para un directorio `preparar` devuelve null y la red sigue
    // siendo la Papelera sola, que ya es adonde va
    const undoPend = await undoPreparar(abs);
    await trashItem(abs);
    undoConfirmar(undoPend, { run, tool: 'fs_delete', afterBytes: null });
    // El resultado dice lo que PASÓ y no lo que se pidió: el modelo tiene que
    // poder contarle al usuario que el archivo es recuperable.
    return `moved ${st.isDirectory() ? 'directory ' : ''}${abs} to the Recycle Bin — the user can restore it from there`;
  } catch (err) {
    return `error: ${err.message} — nothing was deleted`;
  }
}

module.exports = {
  runners: { fs_read: runFsRead, fs_write: runFsWrite, fs_edit: runFsEdit, fs_delete: runFsDelete },
  configurar,
  /** Lo que muestra la tarjeta de confirmación de fs_write, fs_edit y
   *  fs_delete. null para cualquier otra tool. */
  preview: writePreview,
  writePreview, deletePreview, countTree,
  runFsRead, runFsWrite, runFsEdit, runFsDelete,
  applyEdits, normalizeEdits, countHits, esAppend,
  FS_READ_MAX_FILES, FS_READ_FILE_CHARS, FS_READ_TOTAL_CHARS, FS_READ_DIR_ENTRIES,
  PREVIEW_MAX_CHARS, DELETE_SCAN_MAX,
};
