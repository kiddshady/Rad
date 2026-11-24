'use strict';

// La tool de código de Nix: run_code, que corre un fragmento de Python o de
// Node y devuelve lo que escribió en stdout y en stderr más la lista de los
// archivos que dejó. El fragmento corre en una carpeta de trabajo que se
// mantiene de una llamada a la otra (para los gráficos y los CSV), con un
// entorno virtual de Python y pip a pedido. Para Node usa el binario de la
// propia app como Node (process.execPath + ELECTRON_RUN_AS_NODE; con node
// pelado la variable no molesta y anda igual).
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están o están en otro módulo
// (execShell, truncateOut, code_search, bridgeRunTurn, pushFeed). Se dejan
// como estaban.
//
// Lo que se adaptó, y nada más:
//   - runProc era un vecino del mismo archivo. Acá arranca con el de shell.cjs
//     y configurar({ runProc }) lo cambia (para un test). Cambiarlo olvida el
//     intérprete de Python encontrado con el anterior.
//   - La carpeta de trabajo era <datos de la app>/code-workspace, armada con
//     un global del archivo grande (dataDir). Acá la da
//     configurar({ workspace }): una función que devuelve la ruta absoluta
//     (la app la apunta adentro de su carpeta de datos). Sin configurar es
//     una carpeta en la temporal del sistema, para que los tests anden.
//   - Las imágenes que deja el fragmento. NeonCode las mandaba a la ventana
//     con run.notify('tool:artifact', { reqId, images }) y las sumaba a
//     run.artifacts para los puentes. Acá las dos cosas son UNA llamada a
//     alProducir(run, imgs), que sin configurar no hace nada; `imgs` es la
//     misma lista de { name, dataUrl } que se armaba allá (solo imágenes de
//     hasta 3 MB). Si alProducir tira, el resultado de la corrida no se
//     pierde. El texto que lee el modelo no cambia: los archivos escritos se
//     listan igual, con su ruta y su tamaño.
//   - El script temporal se llama nix-run-… (era neoncode-run-…): su ruta sale
//     en los tracebacks, que son texto que lee el modelo.
//   - El nombre de TOOL_RUNNERS (run_code) es `runners`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let runProc = require('./shell.cjs').runProc;
let workspace = () => path.join(os.tmpdir(), 'nix-code-workspace');
let alProducir = () => { /* nadie a quien mostrárselas */ };

/** Lo que este módulo necesita de afuera. Todo es opcional:
 *    workspace()             la carpeta de trabajo (ruta absoluta); se crea si falta
 *    alProducir(run, imgs)   qué hacer con las imágenes que dejó una corrida
 *    runProc                 el de shell.cjs, para cambiarlo en un test */
function configurar(deps = {}) {
  if (typeof deps.runProc === 'function') { runProc = deps.runProc; _pythonBin = null; }
  if (typeof deps.workspace === 'function') workspace = deps.workspace;
  if (typeof deps.alProducir === 'function') alProducir = deps.alProducir;
}

// ---------------------------------------------------------------------------
// run_code + code_search + workspace persistente (diseño de Umbra). El código
// corre en un workspace que se mantiene entre llamadas (para plots/CSVs), con
// venv+pip on-demand para Python. Node usa el runtime embebido de Electron.
// ---------------------------------------------------------------------------

function workspaceDir() {
  const d = workspace();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

let _pythonBin = null;
async function resolvePython() {
  if (_pythonBin) return _pythonBin;
  for (const bin of ['py', 'python', 'python3']) { // `py` (launcher) es el más confiable en Windows
    const r = await runProc({ bin, args: ['--version'], timeoutMs: 5000 });
    if (r.ok || /python\s+\d/i.test(r.out + r.err)) { _pythonBin = bin; return bin; }
  }
  return null;
}

// snapshot top-level (solo archivos) para difear qué escribió una corrida
function snapshotWs(dir) {
  const m = {};
  try { for (const n of fs.readdirSync(dir)) { try { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) m[n] = st.mtimeMs; } catch { /* */ } } } catch { /* */ }
  return m;
}
function humanSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
};

async function runCode(run, { language, code, pip, timeout } = {}) {
  const lang = language === 'node' ? 'node' : 'python';
  if (!code || !String(code).trim()) return 'error: code is required';
  const dir = workspaceDir();
  run.notify('tool:activity', { reqId: run.reqId, kind: 'run_code', label: lang });
  const env = { ...process.env };
  const ext = lang === 'node' ? 'js' : 'py';
  const scriptPath = path.join(os.tmpdir(), `nix-run-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  let bin;
  let args;
  let setupNote = '';
  try {
    fs.writeFileSync(scriptPath, String(code), 'utf8');
    if (lang === 'node') {
      bin = process.execPath; env.ELECTRON_RUN_AS_NODE = '1'; args = [scriptPath]; // runtime embebido, sin Node externo
    } else {
      const py = await resolvePython();
      if (!py) return 'error: no Python interpreter found (tried py, python, python3). Install Python, or use language "node".';
      // venv persistente + pip on-demand (cacheado entre llamadas)
      const venvPy = path.join(dir, '.venv', 'Scripts', 'python.exe');
      const wantPip = Array.isArray(pip) && pip.length;
      if (wantPip || fs.existsSync(venvPy)) {
        if (!fs.existsSync(venvPy)) {
          await runProc({ bin: py, args: ['-m', 'venv', '--system-site-packages', '.venv'], cwd: dir, env, timeoutMs: 120000, signal: run.ac.signal });
          if (!fs.existsSync(venvPy)) return 'error: could not create the Python virtualenv in the workspace';
        }
        if (wantPip) {
          const ins = await runProc({ bin: venvPy, args: ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...pip.map(String)], cwd: dir, env, timeoutMs: 180000, signal: run.ac.signal });
          setupNote = ins.ok ? `[installed: ${pip.join(', ')}]\n\n` : `[pip install had issues:\n${ins.err || ins.out}]\n\n`;
        }
        bin = venvPy;
      } else {
        bin = py;
      }
      args = ['-u', scriptPath]; // -u: sin buffer, el output sobrevive a un timeout
    }
    const before = snapshotWs(dir);
    const ms = Math.min(Math.max((Number(timeout) || 30) * 1000, 1000), 120000);
    const r = await runProc({ bin, args, cwd: dir, env, timeoutMs: ms, signal: run.ac.signal });
    const after = snapshotWs(dir);
    const changed = Object.keys(after).filter((n) => before[n] === undefined || after[n] > before[n]);

    let body = setupNote + (r.out || '');
    if (r.err && r.err.trim()) body += `\n[stderr]\n${r.err}`;
    // el Stop del usuario no es un timeout: ver runProc
    if (r.timedOut) body += `\n[timed out after ${Math.round(ms / 1000)}s — process tree killed]`;
    else if (r.aborted) body += '\n[stopped by the user — process tree killed]';
    else if (!r.ok) body += `\n[exit code ${r.code}]`;
    // sin truncateOut: el recorte ya lo hizo el sink de runProc, con el total de
    // verdad. Encadenarlos anunciaba un número inventado — ver execShell.
    body = body.trim() || '(no output)';
    if (changed.length) {
      const list = changed.slice(0, 20).map((n) => {
        let sz = '';
        try { sz = ` (${humanSize(fs.statSync(path.join(dir, n)).size)})`; } catch { /* */ }
        return `- ${path.join(dir, n)}${sz}`;
      });
      body += `\n\nFiles written to the workspace:\n${list.join('\n')}`;
      if (changed.length > 20) body += `\n…and ${changed.length - 20} more`;

      // imágenes generadas → al chat inline (data URLs; el CSP permite img-src data:)
      const imgs = [];
      for (const n of changed) {
        const ext = path.extname(n).toLowerCase();
        if (!IMG_MIME[ext]) continue;
        try {
          const full = path.join(dir, n);
          if (fs.statSync(full).size > 3 * 1024 * 1024) continue; // no inline imágenes gigantes
          imgs.push({ name: n, dataUrl: `data:${IMG_MIME[ext]};base64,${fs.readFileSync(full).toString('base64')}` });
        } catch { /* */ }
      }
      if (imgs.length) {
        // …y al run: un turno de puente o de tarea no tiene renderer que las
        // muestre, pero sí adónde MANDARLAS (bridgeRunTurn y pushFeed las
        // adjuntan al canal — la misma imagen que la app muestra inline)
        //
        // [Nix] Mostrarlas y guardarlas en la corrida es cosa de la app. Allá
        // eran run.notify('tool:artifact', { reqId: run.reqId, images: imgs })
        // y (run.artifacts ??= []).push(...imgs); acá es alProducir, que sin
        // configurar no hace nada. Si tira no se pierde el resultado de la
        // corrida: los archivos ya están escritos y el texto dice dónde.
        try {
          const p = alProducir(run, imgs);
          if (p && typeof p.catch === 'function') p.catch(() => { /* ídem */ });
        } catch { /* mostrar es un extra */ }
      }
    }
    return body;
  } catch (err) {
    return `error: ${String(err?.message || err)}`;
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* */ }
  }
}

const runners = {
  run_code: (run, a) => runCode(run, a),
};

module.exports = {
  runners, configurar, runCode, workspaceDir, resolvePython, snapshotWs, humanSize, IMG_MIME,
};
