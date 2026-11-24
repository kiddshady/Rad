'use strict';

// La tool de escritorio de BlackCode: os_open, que abre un archivo, una carpeta o
// una URL http(s) como lo haría el usuario (con su programa por defecto, o en
// el navegador), o con reveal:true lo señala en el Explorador sin abrirlo.
// Solo abre los tipos de una lista de permitidos: lo que Windows ejecuta, o
// sigue hasta algo que ejecuta, se rechaza.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están o están en otro módulo
// (toolNeedsConfirm, esAppend, fs_write). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - resolverEn sale de base.cjs en vez de ser un vecino del mismo archivo.
//   - `shell` era el de Electron, importado arriba del archivo grande. Acá lo
//     da configurar({ shell }): un objeto con openPath, openExternal y
//     showItemInFolder (la app pasa el `shell` de Electron). Sin configurar, o
//     con un objeto al que le falta alguno de los tres, os_open devuelve un
//     «error: …» y no abre nada; es su primer chequeo, antes de mirar los
//     argumentos y de avisar a la interfaz.
//   - classifyOsTarget se exporta: el despachador la necesita para saber si el
//     `target` es una ruta, que hay que resolver, o una URL, que no.
//   - El nombre de TOOL_RUNNERS (os_open) es `runners`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const fs = require('node:fs');
const path = require('node:path');

const { resolverEn } = require('./base.cjs');

let shell = null;

const SIN_SHELL = 'error: os_open is not available in this session (BlackCode has no desktop shell configured) — nothing was opened';

const esShell = (s) => !!s && ['openPath', 'openExternal', 'showItemInFolder'].every((m) => typeof s[m] === 'function');

/** Lo que este módulo necesita de afuera: `shell`, un objeto con openPath,
 *  openExternal y showItemInFolder. Uno al que le falte alguno de los tres (o
 *  null) deja la tool sin con qué abrir. */
function configurar(deps = {}) {
  if (deps.shell !== undefined) shell = esShell(deps.shell) ? deps.shell : null;
}

// ---------------------------------------------------------------------------
// os_open — abre un archivo/carpeta/URL como lo haría el usuario, o lo revela en
// el explorador. Rechaza ejecutables (shell.openPath los CORRE). La confirmación
// es la global de toolNeedsConfirm: en manual pregunta por esto como por todo, y
// en auto por nada. No hay excepción por reveal.
// ---------------------------------------------------------------------------

// Se conserva solo para poder dar el mensaje de error preciso ("esto EJECUTA")
// en vez del genérico. El gate real es la allowlist de abajo.
const EXECUTABLE_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp', '.msc', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.reg', '.lnk', '.cpl',
  '.py', '.pyw', '.pyc', '.rb', '.pl', '.php', '.lua', '.sh', '.bash', '.bin', '.appimage',
  // no ejecutan por sí mismas: ShellExecute resuelve a dónde APUNTAN, y ahí puede
  // haber un .exe. Un `.url` con `URL=file:///…/payload.exe` se escribe con
  // fs_write mostrando una tarjeta de dos líneas de texto inofensivo.
  '.url', '.scf', '.inf', '.chm', '.wsc', '.appx', '.msix', '.mjs', '.cjs', '.desktop',
]);

// LO QUE os_open ACEPTA ABRIR. Es una allowlist a propósito. La lista de lo que
// Windows ejecuta o *sigue* no se puede terminar de enumerar —arriba ya hubo que
// sumarle seis tipos— y una blacklist incompleta falla siempre del lado
// peligroso y en silencio. Al revés falla del lado aburrido: un tipo que falta
// se puede seguir mirando con reveal:true, y agregarlo es una línea.
const OPENABLE_EXTS = new Set([
  // documentos
  '.pdf', '.txt', '.md', '.markdown', '.rtf', '.csv', '.tsv', '.log', '.epub',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  // imágenes
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff', '.avif', '.heic',
  // audio y video
  '.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.wma',
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.m4v', '.mpg', '.mpeg',
  // datos y marcado
  '.json', '.jsonl', '.yaml', '.yml', '.xml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  // código que Windows NO ejecuta por doble clic (los que sí están arriba)
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.java', '.kt', '.go', '.rs', '.swift',
  '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.sql', '.r', '.scala', '.dart', '.zig',
  '.ex', '.exs', '.erl', '.hs', '.clj', '.lisp', '.f90', '.pas', '.asm', '.diff', '.patch',
  // archivos comprimidos: los abre el archivador, no el shell
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz',
  // tipografías
  '.ttf', '.otf', '.woff', '.woff2',
]);

function classifyOsTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) return { kind: 'invalid', reason: 'target is required' };
  if (raw.length >= 2 && raw[1] === ':' && /^[a-z]$/i.test(raw[0])) return { kind: 'path' }; // C:\...
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http' || s === 'https') return { kind: 'url', url: raw };
    return { kind: 'invalid', reason: `only http(s) URLs and local paths are allowed (got "${s}:")` };
  }
  return { kind: 'path' };
}

async function runOsOpen(run, { target, reveal } = {}) {
  // [BlackCode] Sin con qué abrir no hay nada que hacer, y se dice antes de mirar
  // los argumentos: esta tool no tiene otro efecto que ese.
  if (!shell) return SIN_SHELL;
  // UNA sola lectura de `reveal`, igual que esAppend con `append`. La rama de URL
  // lo leía truthy y la de path con `=== true`: un reveal:"true" —que es como lo
  // serializa un modelo chico— no revelaba, seguía de largo y terminaba en
  // shell.openPath, o sea LANZANDO el archivo que reveal existe para no lanzar.
  const revelar = !!reveal;
  const cls = classifyOsTarget(target);
  if (cls.kind === 'invalid') return `error: ${cls.reason}`;
  run.notify('tool:activity', { reqId: run.reqId, kind: 'os_open', label: String(target) });
  if (cls.kind === 'url') {
    if (revelar) return 'error: reveal only applies to local files, not URLs';
    try { await shell.openExternal(cls.url); return `Opened ${cls.url} in the browser.`; }
    catch (e) { return `error: could not open URL — ${e.message}`; }
  }
  const abs = resolverEn(run, target);
  if (!fs.existsSync(abs)) return `error: path not found: ${abs}`;
  if (revelar) {
    try { shell.showItemInFolder(abs); return `Revealed ${abs} in Explorer.`; }
    catch (e) { return `error: ${e.message}`; }
  }
  // una carpeta se abre en el explorador y no tiene extensión que mirar
  let esDir = false;
  try { esDir = fs.statSync(abs).isDirectory(); } catch { /* ya se chequeó que existe */ }
  const ext = path.extname(abs).toLowerCase();
  if (!esDir && !OPENABLE_EXTS.has(ext)) {
    return EXECUTABLE_EXTS.has(ext)
      ? `error: ${ext} would execute (or resolve to something that does) — refusing to launch it. Pass reveal:true to show it in Explorer instead.`
      : `error: ${ext || 'a file with no extension'} is not a type os_open will open. Pass reveal:true to show it in Explorer instead.`;
  }
  try {
    const errMsg = await shell.openPath(abs); // devuelve '' si OK, o el error
    return errMsg ? `error: ${errMsg}` : `Opened ${abs} in its default app.`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

const runners = {
  os_open: (run, a) => runOsOpen(run, a),
};

module.exports = {
  runners, configurar, runOsOpen, classifyOsTarget, OPENABLE_EXTS, EXECUTABLE_EXTS,
};
