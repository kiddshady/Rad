// El worker de code_search de BlackCode: el proceso hijo que search.cjs lanza para
// recorrer el árbol. No es un módulo: se corre, no se importa.
//
// Portado de NeonCode 1.11.3 (code-search-worker.js), tal cual estaba escrito,
// con su cabecera original acá abajo. Lo único que se adaptó es el nombre del
// archivo (.cjs).

// NeonCode — worker de code_search. Corre como proceso HIJO (electron con
// ELECTRON_RUN_AS_NODE=1), así un regex con backtracking catastrófico no congela
// el main process: se lo mata por timeout. argv[2] = JSON de opciones; imprime
// JSON a stdout. Puro Node, sin ripgrep (no se garantiza en la máquina).

const fs = require('fs');
const path = require('path');

const opts = JSON.parse(process.argv[2] || '{}');
const root = opts.root;
const mode = opts.mode === 'files' ? 'files' : 'content';
const caseIns = !opts.case_sensitive;
const MAX_RESULTS = Math.min(Math.max(Number(opts.max_results) || 100, 1), 1000);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_LEN = 500;
const SKIP = new Set([
  'node_modules', '.git', 'dist', '.next', '.cache', 'build', '.venv',
  '__pycache__', 'coverage', '.mypy_cache', '.pytest_cache', '.ipynb_checkpoints',
]);

function globToRe(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/\\\\]*';
    } else if (c === '?') re += '.';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(re + '$', caseIns ? 'i' : '');
}
const globRe = opts.glob ? globToRe(opts.glob) : null;

let matcher = null;
if (mode === 'content') {
  const flags = caseIns ? 'i' : '';
  const src = opts.regex ? String(opts.pattern) : String(opts.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  matcher = new RegExp(src, flags);
}

function isBinary(buf) { const n = Math.min(buf.length, 8192); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; }
// `path` puede apuntar a UN archivo. Antes el walk le hacía readdirSync, que
// tira ENOTDIR, el catch se lo tragaba y la respuesta era "No matches" aunque el
// texto estuviera adentro: la tool fabricaba un "no existe". Con un archivo, las
// rutas de los resultados salen relativas a su carpeta, así llevan el nombre.
let rootIsFile = false;
try { rootIsFile = fs.statSync(root).isFile(); } catch { /* el main ya chequeó que exista */ }
const base = rootIsFile ? path.dirname(root) : root;
const rel = (p) => path.relative(base, p).replace(/\\/g, '/');

const results = [];
let filesWalked = 0;

// Un archivo solo: lo mismo para el walk que para un `path` que es un archivo.
// El glob no filtra un archivo pedido por nombre: si te piden ESE archivo, se mira.
function visit(full, name, { pedido = false } = {}) {
  filesWalked++;
  const r = rel(full);
  if (!pedido && globRe && !globRe.test(r) && !globRe.test(name)) return;
  if (mode === 'files') { results.push(r); return; }
  let st;
  try { st = fs.statSync(full); } catch { return; }
  if (st.size > MAX_FILE_BYTES) return;
  let buf;
  try { buf = fs.readFileSync(full); } catch { return; }
  if (isBinary(buf)) return;
  const lines = buf.toString('utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (results.length >= MAX_RESULTS) break;
    if (matcher.test(lines[i])) {
      let text = lines[i].trim();
      if (text.length > MAX_LINE_LEN) text = text.slice(0, MAX_LINE_LEN) + '…';
      results.push(`${r}:${i + 1}: ${text}`);
    }
  }
}

const EXCLUIDA = typeof opts.exclude === 'string' && opts.exclude ? opts.exclude.toLowerCase() : null;
function excluida(full) {
  if (!EXCLUIDA) return false;
  let real = full;
  try { real = fs.realpathSync.native(full); } catch { /* como vino */ }
  return real.toLowerCase() === EXCLUIDA;
}

function walk(dir) {
  if (results.length >= MAX_RESULTS || filesWalked >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (results.length >= MAX_RESULTS || filesWalked >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    // (`exclude`: una carpeta que no se recorre —la de los documentos de la app—, venga de donde venga la búsqueda)
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.') && !excluida(full)) walk(full); continue; }
    if (!e.isFile()) continue;
    visit(full, e.name);
  }
}

try {
  if (rootIsFile) visit(root, path.basename(root), { pedido: true });
  else walk(root);
  // `walkCapped` no es lo mismo que `truncated`: truncated es "encontré de más y
  // corté la lista", walkCapped es "dejé de mirar". Sin ese dato, cero resultados
  // con el árbol a medio caminar se lee igual que cero resultados de verdad, y el
  // modelo da por inexistente lo que nunca se buscó.
  process.stdout.write(JSON.stringify({
    ok: true,
    mode,
    results,
    truncated: results.length >= MAX_RESULTS,
    walkCapped: filesWalked >= MAX_FILES,
    filesWalked,
    maxFiles: MAX_FILES,
  }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
}
