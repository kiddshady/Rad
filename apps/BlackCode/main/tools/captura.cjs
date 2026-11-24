'use strict';

// La tool de pantalla de BlackCode: screen_capture, que saca una foto de un monitor
// o de una ventana (por título, por el job que la abrió o por pid) y se la
// muestra al modelo. La misma imagen sale al chat: el usuario ve exactamente
// lo que vio el modelo.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están o están en otro módulo
// (ejecutarBatch, los puentes, run.artifacts). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - `desktopCapturer` y `screen` eran los de Electron, importados arriba
//     del archivo grande, y `agentJobs` un vecino. Acá los da
//     configurar({ capturador, pantallas, jobs }): la app pasa los de
//     Electron y los jobs de jobs.cjs; las pruebas, unos de mentira. Sin
//     capturador o sin pantallas, screen_capture devuelve un «error: …» y no
//     saca nada.
//   - `execFile` (para preguntarle a Windows el tamaño real de una ventana)
//     también se puede reemplazar por configurar({ execFile }).
//   - argsDigest sale de motor.cjs.
//   - La foto queda en `run._capturas`, como allá. Quien la recoge es la
//     sesión (sesion.cjs → correr), que la devuelve con el resultado de esa
//     llamada, y cada proveedor la adjunta a su manera (anthropic.cjs adentro
//     del tool_result; venice.cjs en un `user` detrás de los resultados).
//   - El nombre de TOOL_RUNNERS (screen_capture) es `runners`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const { argsDigest } = require('./motor.cjs');

let desktopCapturer = null;
let screen = null;
let agentJobs = null;
let execFile = require('node:child_process').execFile;

const SIN_PANTALLA = 'error: screen_capture is not available in this session (BlackCode has no screen capturer configured) — nothing was captured';

/** Lo que este módulo necesita de afuera: `capturador` (el desktopCapturer
 *  de Electron: getSources), `pantallas` (su `screen`: getPrimaryDisplay y
 *  getAllDisplays) y `jobs` (el registro de jobs.cjs, para encontrar la
 *  ventana de un job). */
function configurar({ capturador, pantallas, jobs, execFile: ef } = {}) {
  if (capturador !== undefined) desktopCapturer = capturador;
  if (pantallas !== undefined) screen = pantallas;
  if (jobs !== undefined) agentJobs = jobs;
  if (ef !== undefined) execFile = ef;
}

// ---------------------------------------------------------------------------
// screen_capture — los ojos del modelo sobre la pantalla del usuario.
//
// La imagen NO viaja en el texto del resultado (que sigue siendo string en los
// dos adapters, como todo el resto): el runner la deja en `run._capturas` y el
// batch de la ronda la pega a ESA llamada — adentro del tool_result del lado
// Anthropic, en un user aparte del lado OpenAI (ver ejecutarBatch). Y la misma
// imagen sale al chat como artifact: el usuario ve exactamente lo que vio el
// modelo, que es lo mínimo cuando lo que se mira es su pantalla.
//
// A los puentes NO va (no se suma a run.artifacts como hace run_code): mandar
// una foto del escritorio a un canal de Telegram es otra decisión, y no la
// toma una tool.
// ---------------------------------------------------------------------------

// El lado largo con el que Anthropic procesa una imagen sin reescalarla. Más
// grande no se ve mejor, solo cuesta más; para leer letra chica está `region`.
const CAPTURA_LADO = 1568;
const escalaCaptura = (w, h) => Math.min(1, CAPTURA_LADO / Math.max(w, h));

// Las ventanas cuyo título contiene lo pedido, la MEJOR primero. Antes ganaba la
// primera que listara Windows, y "Astro" agarraba igual de bien la app que el
// Explorador parado en S:\tools\Astro ("Astro - Explorador de archivos"): acertó
// de casualidad. El orden: título exacto, después el que EMPIEZA con lo pedido
// (a igual prefijo gana el título más corto), y al final el que solo lo
// contiene. Dentro de cada grupo se respeta el orden de Windows.
//
// La comparación ignora espacios, guiones, puntos y guiones bajos: Neo pidió
// "ChemEngine" (el nombre de la carpeta) y la ventana se llama "Chem Engine", así
// que no la encontraba y se llevaba el Explorador. Y una carpeta del Explorador
// va SIEMPRE después de cualquier otra ventana, salvo que se la pida a ella:
// casi siempre se llama igual que la app que tiene adentro.
function rankearVentanas(fuentes, quiere) {
  const plano = (x) => String(x || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
  const q = plano(quiere);
  if (!q) return [];
  const explorador = /\s[-–—]\s(explorador de archivos|file explorer)$/i;
  const pideExplorador = /explor/i.test(String(quiere));
  const nivel = (x) => (x.n === q ? 0 : x.n.startsWith(q) ? 1 : 2) + (x.e ? 3 : 0);
  return fuentes
    .map((s, i) => ({ s, i, n: plano(s.name), e: !pideExplorador && explorador.test(String(s.name || '').trim()) }))
    .filter((x) => x.n.includes(q))
    .sort((a, b) => nivel(a) - nivel(b) || (nivel(a) % 3 === 1 ? a.n.length - b.n.length : 0) || a.i - b.i)
    .map((x) => x.s);
}

// La ventana a capturar: por título, o la del árbol de un job / de un pid. El
// job es lo que pidió Neo: el pid de job_start es el powershell que envuelve a
// npm, y la ventana es de un electron nieto con otro pid; desde el título no hay
// forma de saber cuál es la suya. Devuelve { src, que } o { error, fatal } —
// fatal es lo que no se arregla esperando (el job no existe o ya terminó).
const CAPTURA_ESPERA_MAX = 30;
async function buscarVentana({ quiere, job, pid }) {
  // sin miniaturas: acá solo se elige; la foto la saca capturarVentana
  const fuentes = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  if (job || pid) {
    let arbol;
    let de;
    if (job) {
      let r;
      try { r = await agentJobs.arbol(job); } catch (err) { return { fatal: true, error: err.message }; }
      if (r.job.fin) return { fatal: true, error: `job ${r.job.id} is not running: ${agentJobs.estado(r.job)}` };
      arbol = r.arbol;
      de = `job ${r.job.id}`;
    } else {
      arbol = await agentJobs.arbolDe(pid);
      de = `pid ${pid}`;
      if (arbol && !arbol.procs.length) return { fatal: true, error: `there is no running process with pid ${pid}` };
    }
    if (!arbol) return { fatal: true, error: 'could not read the process list to find its windows — pass `window` with the title instead' };
    // el id de una fuente de desktopCapturer es "window:<hwnd>:0"
    const hwnd = (src) => String(src.id).split(':')[1];
    let cands = arbol.ventanas
      .map((w) => ({ w, src: fuentes.find((f) => hwnd(f) === String(w.hwnd)) }))
      .filter((x) => x.src);
    if (quiere) {
      const orden = rankearVentanas(cands.map((x) => x.src), quiere);
      cands = orden.map((f) => cands.find((x) => x.src === f));
    } else {
      cands.sort((x, y) => Number(!x.src.name) - Number(!y.src.name)); // con título primero
    }
    if (!cands.length) {
      return { error: `${de} is running (${arbol.procs.length} process${arbol.procs.length === 1 ? '' : 'es'}) but has no visible window${quiere ? ` whose title matches "${quiere}"` : ''}` };
    }
    const [x, ...otras] = cands;
    return {
      src: x.src,
      que: `window "${x.src.name}" (${x.w.name} pid ${x.w.pid}, from ${de})`
        + (otras.length ? ` (its tree also has: ${otras.slice(0, 5).map((o) => `"${o.src.name}" pid ${o.w.pid}`).join(', ')})` : ''),
    };
  }
  const hits = rankearVentanas(fuentes, quiere);
  if (!hits.length) {
    const titulos = fuentes.map((f) => f.name).filter(Boolean).slice(0, 25);
    const pista = agentJobs.vivos().length ? '\nIf it is an app you started with job_start, pass `job` with its id instead of a title.' : '';
    return { error: `no open window title matches "${quiere}". Open windows:\n${titulos.map((t) => `- ${t}`).join('\n') || '(none)'}${pista}` };
  }
  return {
    src: hits[0],
    que: `window "${hits[0].name}"`
      + (hits.length > 1 ? ` (also matched: ${hits.slice(1, 6).map((f) => `"${f.name}"`).join(', ')})` : ''),
  };
}

// desktopCapturer no devuelve una ventana a su tamaño: la AGRANDA hasta llenar
// el thumbnailSize que se le pide. Con 3840×2160 fijo, una ventana de 420×260
// volvía como 3490×2160, borrosa, el resultado la llamaba "native" y el zoom con
// `region` ampliaba la misma imagen en vez de traer detalle. Así que se le
// pregunta el tamaño real a UI Automation (~0,4 s) y se captura a ese tamaño.
function rectVentana(hwnd) {
  if (!/^\d+$/.test(String(hwnd))) return Promise.resolve(null);
  const ps = 'Add-Type -AssemblyName UIAutomationClient; '
    + `$r=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${hwnd}).Current.BoundingRectangle; `
    + "'{0} {1} {2} {3}' -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 6000, encoding: 'utf8' }, (err, out) => {
        const [x, y, width, height] = String(out || '').trim().split(/\s+/).map(Number);
        // una minimizada se reporta en -32000: ese tamaño no es el suyo
        resolve(!err && width > 0 && height > 0 && x > -30000 && y > -30000 ? { width, height } : null);
      });
  });
}

async function capturarVentana(src) {
  const tam = await rectVentana(String(src.id).split(':')[1]);
  const fuentes = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: tam || { width: 1920, height: 1080 } });
  const f = fuentes.find((x) => x.id === src.id);
  return { img: f?.thumbnail || null, nativa: !!tam };
}

async function runScreenCapture(run, { window: ventana, display, region, job, pid, wait } = {}) {
  if (typeof desktopCapturer?.getSources !== 'function' || typeof screen?.getPrimaryDisplay !== 'function' || !agentJobs) return SIN_PANTALLA;
  const quiere = String(ventana || '').trim();
  const jobId = String(job ?? '').trim();
  const elPid = !jobId && Number(pid) > 0 ? Math.round(Number(pid)) : null;
  const seg = Math.min(Math.max(Number(wait) || 0, 0), CAPTURA_ESPERA_MAX);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'screen_capture', label: argsDigest('screen_capture', { window: ventana, display, region, job: jobId, pid: elPid }) });
  try {
    let img;
    let que;
    let nativa = true;
    if (quiere || jobId || elPid) {
      // con `wait`, se reintenta hasta que la ventana aparezca: una app Electron
      // tarda unos segundos en abrir después del job_start
      const hasta = Date.now() + seg * 1000;
      let r;
      for (;;) {
        r = await buscarVentana({ quiere, job: jobId, pid: elPid });
        if (r.src || r.fatal || Date.now() >= hasta || run.ac?.signal?.aborted) break;
        await new Promise((res) => setTimeout(res, 700));
      }
      if (!r.src) {
        const espera = r.fatal ? '' : seg ? ` (waited ${seg}s)` : (jobId || elPid ? ' yet — pass `wait` (seconds) to wait for it to open' : '');
        return `error: ${r.error}${espera}`;
      }
      ({ img, nativa } = await capturarVentana(r.src));
      if (!img) return `error: window "${r.src.name}" closed before it could be captured`;
      if (img.isEmpty()) return `error: window "${r.src.name}" gave an empty image — it is probably minimized`;
      que = r.que;
    } else {
      // 1 = la principal, después el resto en el orden en que las da Windows
      const prim = screen.getPrimaryDisplay();
      const orden = [prim, ...screen.getAllDisplays().filter((d) => d.id !== prim.id)];
      const n = Math.round(Number(display) || 1);
      const d = orden[n - 1];
      if (!d) return `error: there is no display ${n} — this machine has ${orden.length}`;
      const fuentes = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) },
      });
      const src = fuentes.find((s) => String(s.display_id) === String(d.id)) || (fuentes.length === 1 ? fuentes[0] : null);
      if (!src || src.thumbnail.isEmpty()) return `error: could not capture display ${n}`;
      img = src.thumbnail;
      que = `display ${n} of ${orden.length}`;
    }

    const nat = img.getSize();
    const s = escalaCaptura(nat.width, nat.height);
    const completa = `${Math.round(nat.width * s)}×${Math.round(nat.height * s)}`;
    let salida = img;
    if (region) {
      // las coordenadas vienen en el espacio de la captura COMPLETA que vio el
      // modelo (reescalada): se llevan a píxeles nativos y se recorta ahí, así el
      // zoom trae resolución de verdad y no la misma imagen ampliada
      const rx = Math.max(0, Math.floor(Number(region.x) / s));
      const ry = Math.max(0, Math.floor(Number(region.y) / s));
      const rw = Math.min(nat.width - rx, Math.ceil(Number(region.width) / s));
      const rh = Math.min(nat.height - ry, Math.ceil(Number(region.height) / s));
      if (!(rw > 0 && rh > 0)) return `error: that region falls outside the capture — the full capture of ${que} is ${completa}`;
      salida = img.crop({ x: rx, y: ry, width: rw, height: rh });
    }
    const z = salida.getSize();
    const s2 = escalaCaptura(z.width, z.height);
    if (s2 < 1) salida = salida.resize({ width: Math.round(z.width * s2), height: Math.round(z.height * s2), quality: 'best' });
    const fin = salida.getSize();
    const dataUrl = `data:image/jpeg;base64,${salida.toJPEG(85).toString('base64')}`;
    (run._capturas ??= []).push(dataUrl);
    run.notify('tool:artifact', { reqId: run.reqId, images: [{ name: 'screen_capture.jpg', dataUrl }] });
    const tamano = nativa ? `native ${nat.width}×${nat.height}` : "the window's real size could not be read, so it may be scaled";
    return region
      ? `captured a region of ${que}${nativa ? ' at native resolution' : ''}: ${fin.width}×${fin.height} px (the full capture is ${completa}). The image is attached.`
      : `captured ${que}: ${fin.width}×${fin.height} px (${tamano}). A region you pass later uses this image's pixel coordinates. The image is attached.`;
  } catch (err) {
    return `error: ${String(err?.message || err)}`;
  }
}

const runners = {
  screen_capture: (run, a) => runScreenCapture(run, a),
};

module.exports = {
  runners, configurar, runScreenCapture, rankearVentanas, buscarVentana, escalaCaptura, CAPTURA_LADO, CAPTURA_ESPERA_MAX,
};
