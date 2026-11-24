'use strict';

// Los procesos de fondo de Nix: job_start, job_output y job_kill, y el
// administrador que tienen atrás (la clase Jobs). Arranca un comando de
// PowerShell sin esperarlo, guarda su salida en un buffer rodante con un cursor
// de lectura, sabe mirar el árbol de procesos de cada job y las ventanas que
// abrió, y lo mata con el árbol entero.
//
// Portado de NeonCode 1.11.3, tal cual estaba escrito: jobs.js entero (la clase
// y sus ayudantes) y, de main.js, la foto de procesos, la instancia y los tres
// runners. Los comentarios que explican cada decisión vienen con el código, y
// algunos nombran cosas de aquella app que acá no están o se llaman distinto
// (jobs.js y main.js, que acá son este mismo archivo; execShell, que está en
// shell.cjs; el before-quit; el system prompt; screen_capture, que está en
// captura.cjs). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - Los dos archivos de origen son uno: primero va jobs.js y después el tramo
//     de main.js. Del primero se fueron su 'use strict' y su module.exports,
//     que acá están una sola vez.
//   - `spawn`, `execFile`, `killTree` y `resolveCwd` eran globales del archivo
//     grande. Acá salen de node:child_process y de base.cjs. Se desestructuran
//     (y no `const base = …` como en shell.cjs) porque Jobs.read tiene una
//     variable local que se llama `base`.
//   - La instancia (`agentJobs`) se arma igual que allá: con el `spawn` de
//     Node, el `killTree` de base.cjs y fotoProcesos. configurar({ spawn,
//     killTree, foto }) se los cambia A ESA instancia; `foto: null` la deja sin
//     foto (las lecturas salen sin el árbol, como cuando la foto falla). Un
//     test que ponga un `spawn` falso tiene que poner TAMBIÉN un `killTree`
//     falso y sacar o cambiar la foto: el killTree de base.cjs llama al
//     taskkill real con el pid que le den, y fotoProcesos mira los procesos de
//     verdad.
//   - Los tres nombres de TOOL_RUNNERS (job_start, job_output y job_kill) son
//     `runners`.
//   - cerrarTodo() es nuevo: es el `agentJobs.killAll()` que NeonCode llama en
//     su before-quit, con nombre propio para que la app lo llame al salir.
//   - Ningún texto de los que lee el modelo nombraba a NeonCode, así que no
//     hubo nada que renombrar: los mensajes, los límites y el orden de los
//     chequeos son los mismos, letra por letra.
//
// screen_capture (buscarVentana, rankearVentanas y la captura en sí) está en
// captura.cjs. De acá usa jobs.arbol(id), jobs.arbolDe(pid), jobs.estado(job)
// y jobs.vivos(): por eso la instancia se exporta entera (`jobs`), junto con
// fotoProcesos y descendientes.
//
// El contrato de un runner está en la cabecera de base.cjs.

const { spawn, execFile } = require('node:child_process');
const { resolveCwd, killTree } = require('./base.cjs');

// ── jobs.js ──────────────────────────────────────────────────────────────────
// NeonCode — procesos de fondo del agente: job_start / job_output / job_kill.
//
// execShell es one-shot: espera a que el comando termine y tiene un techo duro
// de 120 s, así que un `npm run dev`, un build largo o un scan no entran — o se
// cortan a los dos minutos o bloquean el turno entero mirando un servidor que
// por diseño no termina nunca. Esto es el otro camino: el proceso arranca, el
// turno sigue, y la salida se lee después, por partes, desde cualquier turno.
//
// Lo que un job NO hace, a propósito:
//   - No muere con el Stop. El Stop corta el TURNO; un servidor que el modelo
//     levantó para probar algo tiene que sobrevivirle, que es la razón de que
//     esto exista. Se mata con job_kill o al cerrar la app (killAll).
//   - No lee stdin. Va con stdin cerrado: un prompt interactivo ("¿continuar?
//     [Y/n]") recibe EOF y sigue o falla, en vez de dejar un proceso colgado
//     esperando una tecla que nadie va a apretar.
//   - No sobrevive a la app. Los ids son de la sesión: después de reiniciar,
//     `j1` no existe y job_output lo dice en vez de inventar un estado.
//
// La salida se guarda en un buffer rodante con un CURSOR de lectura: cada
// job_output devuelve lo que llegó desde la lectura anterior, así el modelo no
// relee mil veces el arranque del servidor para encontrar la línea nueva.
//
// Y la salida no alcanza: una app Electron que no loguea nada deja al modelo
// sin saber si levantó o se colgó antes de abrir la ventana (Neo, 25/10, con
// Chem Engine). Por eso cada lectura de un job vivo trae también su ÁRBOL de
// procesos y las ventanas que abrió, y el kill dice qué pids bajó y si quedó
// alguno vivo. Eso sale de `foto` (una foto de todos los procesos, ver main.js).

const MAX_RUNNING = 8;          // jobs vivos a la vez
const MAX_KEPT = 20;            // terminados que se recuerdan para leerles el final
const BUF_CHARS = 200000;       // lo que se guarda de cada job (la cola)
const READ_CHARS = 10000;       // lo que devuelve una lectura, como execShell
const WAIT_MAX_S = 60;          // techo de `wait` en una lectura

// Los dev servers pintan con colores aunque no haya TTY (chalk, vite, next…).
// Para el modelo son ruido: bytes que cuestan tokens y no dicen nada.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

// Los ids llevan la marca de la sesión: "j1-k3f". Pelados ("j1"), el contador
// volvía a empezar con cada arranque de la app, y un id viejo que quedó en el
// historial del chat podía apuntar a OTRO job vivo, que es peor que un error
// (Neo lo cruzó en la segunda vuelta: pidió "j4" de memoria y el job era "j1").
// Tres caracteres alcanzan: el id tiene que no repetirse entre arranques, no
// ser secreto.
const marcaSesion = () => Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
const ID_RE = /^j(\d+)(?:-([0-9a-z]+))?$/i;

function duracion(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// `until` lo escribe el modelo: se intenta como regex (para "ready|error") y si
// no compila se busca literal. Nunca tira — un patrón mal escrito no puede
// tumbar la lectura.
function patron(until) {
  if (until == null || String(until) === '') return null;
  try { return new RegExp(String(until), 'i'); } catch { /* literal */ }
  const lit = String(until).toLowerCase();
  return { test: (s) => String(s).toLowerCase().includes(lit) };
}

// El pid del job es el powershell que lo envuelve; lo que importa (node,
// electron, la ventana) son sus descendientes. Un ppid puede apuntar a un pid
// reciclado, así que un hijo cuenta solo si nació después que su padre.
function descendientes(procs, raiz) {
  const porPadre = new Map();
  for (const p of procs) {
    if (p.pid === p.ppid) continue; // el System Idle Process es su propio padre
    if (!porPadre.has(p.ppid)) porPadre.set(p.ppid, []);
    porPadre.get(p.ppid).push(p);
  }
  const r = procs.find((p) => p.pid === raiz);
  if (!r) return [];
  const out = [r];
  const visto = new Set([raiz]);
  for (let i = 0; i < out.length; i++) {
    for (const h of porPadre.get(out[i].pid) || []) {
      if (visto.has(h.pid) || (h.t && out[i].t && h.t < out[i].t)) continue;
      visto.add(h.pid);
      out.push(h);
    }
  }
  return out;
}

// "powershell.exe, node.exe ×2, electron.exe ×4": el árbol en una línea
function contarNombres(procs) {
  const n = new Map();
  for (const p of procs) n.set(p.name, (n.get(p.name) || 0) + 1);
  return [...n].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(', ');
}

const listaPids = (procs, max = 12) => procs.slice(0, max).map((p) => `${p.name} ${p.pid}`).join(', ')
  + (procs.length > max ? `, … (${procs.length - max} more)` : '');

class Jobs {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn     child_process.spawn (inyectable en los tests)
   * @param {Function} deps.killTree  baja el árbol entero de un hijo
   * @param {Function} [deps.foto]    async () => { procs: [{pid, ppid, name, t}], ventanas: [{pid, hwnd, title}] }
   * @param {string}   [deps.sesion]  la marca de los ids de esta sesión ('' = ids pelados)
   */
  constructor({ spawn, killTree, foto = null, now = () => Date.now(), sesion = marcaSesion() }) {
    this.spawn = spawn;
    this.killTree = killTree;
    this.foto = foto;
    this.now = now;
    this.sesion = sesion;
    this.jobs = new Map();
    this.seq = 0;
  }

  vivos() { return [...this.jobs.values()].filter((j) => !j.fin); }

  /** El job de ese id, o un error que le dice al modelo cuáles hay. */
  buscar(id) {
    const pedido = String(id || '').trim();
    const job = this.jobs.get(pedido);
    if (job) return job;
    const m = ID_RE.exec(pedido);
    const viejo = m && (m[2] || '') !== this.sesion
      ? ' That id is from an earlier run of the app: jobs do not survive a restart.' : '';
    const hay = this.resumen();
    throw new Error(`no background job '${id}'.${viejo} ${hay ? `Jobs in this session:\n${hay}` : 'No jobs exist in this session (they do not survive an app restart).'}`);
  }

  /** Arranca un job. Devuelve el job o tira con un mensaje para el modelo. */
  start({ command, cwd, name }) {
    const cmd = String(command || '').trim();
    if (!cmd) throw new Error('command is required');
    if (this.vivos().length >= MAX_RUNNING) {
      throw new Error(`there are already ${MAX_RUNNING} background jobs running — stop one with job_kill first`);
    }
    const id = this.sesion ? `j${++this.seq}-${this.sesion}` : `j${++this.seq}`;
    const child = this.spawn('powershell.exe',
      ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd}`],
      { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = {
      id, command: cmd, cwd, name: String(name || '').trim() || null,
      pid: child.pid, child, t0: this.now(),
      buf: '', total: 0, leido: 0,
      fin: null, // { code, t, killed } cuando terminó
      espera: new Set(), // lecturas con `wait` colgadas de este job
    };
    const push = (d) => {
      const s = String(d).replace(ANSI, '');
      if (!s) return;
      job.total += s.length;
      job.buf = (job.buf + s).slice(-BUF_CHARS);
      for (const w of job.espera) w();
    };
    child.stdout?.on('data', push);
    // stderr va al MISMO buffer y en orden de llegada: un servidor que loguea
    // los errores por stderr los tiene que mostrar donde pasaron, no al final
    child.stderr?.on('data', push);
    const cerrar = (code) => {
      if (job.fin) return;
      job.fin = { code, t: this.now(), killed: !!job.matando };
      for (const w of job.espera) w();
      this.podar();
    };
    child.on('close', (code) => cerrar(code));
    child.on('error', (e) => { push(`\n[could not start powershell.exe — ${e.message}]\n`); cerrar(null); });
    this.jobs.set(id, job);
    return job;
  }

  // Los terminados se recuerdan para poder leerles el final, pero no para
  // siempre: se van los más viejos.
  podar() {
    const muertos = [...this.jobs.values()].filter((j) => j.fin).sort((a, b) => a.fin.t - b.fin.t);
    while (muertos.length > MAX_KEPT) this.jobs.delete(muertos.shift().id);
  }

  /**
   * El árbol vivo de un pid y las ventanas que tiene abiertas. null si no hay
   * con qué mirarlo (sin `foto`, o la foto falló): quien lo usa sigue sin él.
   */
  async arbolDe(pid) {
    if (!this.foto) return null;
    let f;
    try { f = await this.foto(); } catch { return null; }
    if (!f?.procs?.length) return null;
    const procs = descendientes(f.procs, Number(pid));
    const pids = new Set(procs.map((p) => p.pid));
    const nombre = new Map(procs.map((p) => [p.pid, p.name]));
    const ventanas = (f.ventanas || []).filter((w) => pids.has(w.pid))
      .map((w) => ({ ...w, name: nombre.get(w.pid) }));
    return { procs, ventanas };
  }

  /** El job y, si sigue vivo, su árbol; tira con un mensaje para el modelo si no hay job. */
  async arbol(id) {
    const job = this.buscar(id);
    return { job, arbol: job.fin ? null : await this.arbolDe(job.pid) };
  }

  lineaArbol(a) {
    if (!a?.procs.length) return '';
    const vs = a.ventanas.filter((w) => w.title);
    const ventanas = vs.length
      ? `windows: ${vs.slice(0, 6).map((w) => `"${w.title}" (${w.name} pid ${w.pid})`).join(', ')}`
      : 'no visible window';
    return `[process tree: ${a.procs.length} alive (${contarNombres(a.procs)}) · ${ventanas}]`;
  }

  estado(job) {
    const nombre = job.name ? ` (${job.name})` : '';
    if (!job.fin) return `job ${job.id}${nombre} · running · pid ${job.pid} · ${duracion(this.now() - job.t0)}`;
    const como = job.fin.killed ? 'stopped by job_kill'
      : job.fin.code === 0 ? 'exited with code 0'
        : job.fin.code == null ? 'ended' : `exited with code ${job.fin.code}`;
    return `job ${job.id}${nombre} · ${como} after ${duracion(job.fin.t - job.t0)}`;
  }

  /** La salida nueva desde la lectura anterior (o la cola entera con all). */
  texto(job, all) {
    const desdeBuf = job.total - job.buf.length; // offset absoluto del buf[0]
    let desde = all ? desdeBuf : Math.max(job.leido, desdeBuf);
    let aviso = '';
    if (!all && job.leido < desdeBuf) {
      aviso = `…[${desdeBuf - job.leido} chars scrolled out before they were read]…\n`;
    }
    let s = job.buf.slice(desde - desdeBuf);
    job.leido = job.total;
    if (s.length > READ_CHARS) {
      // cabeza y cola, como execShell: el final es donde vive el error
      s = `${s.slice(0, 3000)}\n\n…[${s.length - READ_CHARS} chars omitted]…\n\n${s.slice(-(READ_CHARS - 3000))}`;
    }
    return aviso + s;
  }

  /**
   * Lee un job. Con `wait` espera hasta que termine, hasta que `until` aparezca
   * en la salida nueva o hasta que se cumpla el tiempo — lo que pase primero.
   * El `signal` es el del turno: un Stop corta la ESPERA, nunca el job.
   */
  async read(id, { wait, until, all } = {}, signal) {
    const job = this.buscar(id);
    const seg = Math.min(Math.max(Number(wait) || 0, 0), WAIT_MAX_S);
    const re = patron(until);
    let vio = false;
    if (seg > 0 && !job.fin) {
      const base = job.leido;
      const listo = () => {
        if (job.fin) return true;
        if (re && re.test(job.buf.slice(Math.max(0, base - (job.total - job.buf.length))))) { vio = true; return true; }
        return false;
      };
      if (!listo()) {
        await new Promise((resolve) => {
          let timer = null;
          const salir = () => {
            clearTimeout(timer);
            job.espera.delete(chequeo);
            signal?.removeEventListener?.('abort', salir);
            resolve();
          };
          const chequeo = () => { if (listo()) salir(); };
          timer = setTimeout(salir, seg * 1000);
          job.espera.add(chequeo);
          signal?.addEventListener?.('abort', salir, { once: true });
          if (signal?.aborted) salir();
        });
      }
    }
    let cab = `[${this.estado(job)}]`;
    if (seg > 0 && re) cab += vio ? `\n[matched "${until}"]` : (job.fin ? '' : `\n["${until}" did not appear within ${seg}s]`);
    if (!job.fin) {
      const linea = this.lineaArbol(await this.arbolDe(job.pid));
      if (linea) cab += `\n${linea}`;
    }
    const cuerpo = this.texto(job, all);
    return `${cab}\n${cuerpo.trim() ? cuerpo : (all ? '(no output yet)' : '(no new output since the last read)')}`;
  }

  /**
   * Mata un job y espera (poco) a que cierre, para devolver su estado real. Con
   * `foto`, además, dice qué procesos bajó y avisa si alguno del árbol quedó
   * vivo: un Electron huérfano no se ve en la salida del job.
   */
  async kill(id) {
    const job = this.buscar(id);
    if (job.fin) return `[${this.estado(job)}] — it had already finished, nothing to stop.`;
    // la foto va ANTES: muerto el powershell, el árbol ya no se puede armar
    const antes = await this.arbolDe(job.pid);
    job.matando = true;
    this.killTree(job.child);
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3000);
      job.espera.add(() => { if (job.fin) { clearTimeout(t); resolve(); } });
    });
    // un hijo que no cerró en 3 s igual se da por muerto: el árbol se mató, lo
    // que queda es un pipe heredado por un nieto (ver execShell)
    if (!job.fin) job.fin = { code: null, t: this.now(), killed: true };
    let pids = '';
    if (antes?.procs.length) {
      // el mismo pid con la misma hora de creación: es ese proceso y no uno
      // nuevo que heredó el número
      const quedan = async () => {
        let f = null;
        try { f = await this.foto(); } catch { /* sin foto no se puede afirmar nada */ }
        if (!f?.procs?.length) return null;
        return antes.procs.filter((p) => f.procs.some((q) => q.pid === p.pid && q.t === p.t));
      };
      let vivos = await quedan();
      // taskkill /F no es instantáneo con un árbol grande: una segunda mirada
      if (vivos?.length) { await new Promise((r) => setTimeout(r, 1000)); vivos = await quedan(); }
      const n = antes.procs.length;
      pids = `\nKilled ${n} process${n === 1 ? '' : 'es'}: ${listaPids(antes.procs)}.`;
      if (vivos == null) pids += ' (could not check afterwards whether they are all gone)';
      else if (vivos.length) {
        pids += `\nWARNING: still alive after the kill: ${listaPids(vivos)}. Stop them with shell_exec: Stop-Process -Id ${vivos.map((p) => p.pid).join(',')} -Force`;
      } else pids += ' None of them is still running.';
    }
    const cola = this.texto(job, false);
    return `[${this.estado(job)} — process tree killed]${pids}${cola.trim() ? `\nLast output:\n${cola}` : ''}`;
  }

  /** Una línea por job, para job_output sin id y para el system prompt. */
  resumen({ soloVivos = false } = {}) {
    const rows = [...this.jobs.values()].filter((j) => !soloVivos || !j.fin);
    if (!rows.length) return '';
    return rows.map((j) => `- ${this.estado(j)} · \`${j.command.length > 80 ? j.command.slice(0, 79) + '…' : j.command}\` in ${j.cwd}`).join('\n');
  }

  killAll() {
    for (const j of this.vivos()) { j.matando = true; try { this.killTree(j.child); } catch { /* ya murió */ } }
  }
}

// ── main.js ──────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// job_start / job_output / job_kill — procesos de fondo (ver jobs.js). Mismo
// powershell, mismo cwd persistente y mismo killTree que execShell; lo que
// cambia es que el turno no espera al proceso.
// ---------------------------------------------------------------------------

// Una foto de TODOS los procesos (pid, padre, nombre, hora de creación) y de
// sus ventanas principales: con eso los jobs saben qué abrió su árbol (ver
// jobs.js) y screen_capture encuentra la ventana de un job sin adivinar por el
// título. Una llamada a powershell, ~0,7 s. Si falla o pasa de 8 s, los jobs
// siguen sin el árbol: jobs.js lo tolera.
const FOTO_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  '$p=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ i=[int]$_.ProcessId; p=[int]$_.ParentProcessId; n=$_.Name; t=$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) } })',
  '$w=@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [pscustomobject]@{ i=$_.Id; h=[int64]$_.MainWindowHandle; s=$_.MainWindowTitle } })',
  '@{ p=$p; w=$w } | ConvertTo-Json -Depth 3 -Compress',
].join('; ');

function fotoProcesos() {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', FOTO_PS],
      { windowsHide: true, timeout: 8000, maxBuffer: 8 << 20, encoding: 'utf8' }, (err, out) => {
        if (err) return reject(err);
        try {
          const j = JSON.parse(out);
          const lista = (x) => (Array.isArray(x) ? x : x ? [x] : []);
          resolve({
            procs: lista(j.p).map((x) => ({ pid: x.i, ppid: x.p, name: x.n, t: x.t })),
            ventanas: lista(j.w).map((x) => ({ pid: x.i, hwnd: x.h, title: x.s })),
          });
        } catch (e) { reject(e); }
      });
  });
}

const agentJobs = new Jobs({ spawn, killTree, foto: fotoProcesos });

/** Lo que este módulo necesita de afuera. Todo es opcional: sin llamarla
 *  quedan el `spawn` de Node, el `killTree` de base.cjs y fotoProcesos. Se le
 *  cambian a la instancia que ya existe (los jobs que estén corriendo siguen
 *  siendo los mismos); `foto: null` la deja sin foto. */
function configurar(deps = {}) {
  if (typeof deps.spawn === 'function') agentJobs.spawn = deps.spawn;
  if (typeof deps.killTree === 'function') agentJobs.killTree = deps.killTree;
  if (typeof deps.foto === 'function' || deps.foto === null) agentJobs.foto = deps.foto;
}

async function runJobStart(run, { command, cwd, name } = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return 'error: command is required';
  let dir;
  try { dir = resolveCwd(run, cwd); } catch (err) { return `error: ${err.message}`; }
  run.notify('tool:activity', { reqId: run.reqId, kind: 'job_start', label: cmd });
  let job;
  try { job = agentJobs.start({ command: cmd, cwd: dir, name }); } catch (err) { return `error: ${err.message}`; }
  // Un vistazo al arranque antes de contestar: un comando mal escrito muere en
  // el primer segundo, y decir "started" sobre algo que ya está muerto es
  // exactamente lo que el registro de la app no puede afirmar.
  const vistazo = await agentJobs.read(job.id, { wait: 1.5 }, run.ac?.signal);
  if (job.fin && job.fin.code !== 0) return `error: background job ${job.id} exited right away\n${vistazo}`;
  return `started background job ${job.id} (pid ${job.pid}) in ${dir}. Read it with job_output {"id":"${job.id}"}; stop it with job_kill.\n${vistazo}`;
}

async function runJobOutput(run, { id, wait, until, all } = {}) {
  run.notify('tool:activity', { reqId: run.reqId, kind: 'job_output', label: id ? String(id) : 'all jobs' });
  if (!id) return agentJobs.resumen() || 'No background jobs in this session.';
  try { return await agentJobs.read(id, { wait, until, all }, run.ac?.signal); } catch (err) { return `error: ${err.message}`; }
}

async function runJobKill(run, { id } = {}) {
  run.notify('tool:activity', { reqId: run.reqId, kind: 'job_kill', label: String(id || '') });
  try { return await agentJobs.kill(id); } catch (err) { return `error: ${err.message}`; }
}

/** Baja todos los jobs que sigan vivos, con su árbol. Es lo que la app llama al
 *  salir: los jobs viven a propósito fuera del turno, así que cortar los turnos
 *  no los alcanza. No espera a que cierren (el taskkill ya quedó lanzado). */
function cerrarTodo() {
  agentJobs.killAll();
}

const runners = {
  job_start: (run, a) => runJobStart(run, a),
  job_output: (run, a) => runJobOutput(run, a),
  job_kill: (run, a) => runJobKill(run, a),
};

module.exports = {
  runners, configurar, Jobs, jobs: agentJobs, cerrarTodo,
  fotoProcesos, MAX_RUNNING, READ_CHARS, WAIT_MAX_S, patron, duracion, descendientes, ID_RE,
};
