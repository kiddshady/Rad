// Test de los procesos de fondo de Nix (apps/Nix/main/tools/jobs.cjs), con node
// pelado. Uso: node tools/test-nix-tools-jobs.mjs
//
// Son las comprobaciones del test de NeonCode de donde se portó el código
// (scripts/test-jobs.js), menos las de screen_capture y las de cómo viaja una
// imagen en el loop del chat, más las que hacen falta para saber que el port
// quedó cableado igual. Tres bancos:
//
//   - la clase Jobs con un `spawn` FALSO: el hijo es un EventEmitter que emite
//     lo que el test quiera. Es el banco del test original, tal cual;
//   - los tres runners sobre la instancia viva del módulo, también con el
//     `spawn` falso (y con un `killTree` falso y sin foto: los de verdad
//     llaman a taskkill y miran los procesos reales);
//   - procesos de VERDAD: un bucle corto de PowerShell como job, leerlo,
//     matarlo y confirmar que el proceso ya no está.
//
// Lo que este archivo tiene que fijar:
//   - que cada lectura traiga SOLO lo nuevo, y que abra con el estado del job;
//   - que `wait` + `until` corten apenas aparece el patrón, y que un Stop corte
//     la ESPERA pero nunca el job;
//   - que job_kill diga qué bajó y avise si quedó algo vivo;
//   - que un id de otro arranque de la app no encuentre un job nuevo;
//   - y que al terminar no quede ningún proceso corriendo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn as spawnReal, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'Nix', 'main', 'tools');
const base = require(path.join(TOOLS, 'base.cjs'));
const motor = require(path.join(TOOLS, 'motor.cjs'));
const J = require(path.join(TOOLS, 'jobs.cjs'));
const { Jobs, MAX_RUNNING, patron } = J;

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nix-tools-jobs-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
for (const d of [HOME, PROJ]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(HOME, 'un-archivo.txt'), 'no soy una carpeta\n');

// ── el banco: spawn falso ────────────────────────────────────────────────────
// El del test original: cada banco trae SU instancia de Jobs, con ids pelados
// ("j1"). Los pids falsos son impares, que en Windows no existen.
function banco() {
  const hijos = [];
  const muertos = [];
  let pid = 100;
  const spawn = (bin, args, opts) => {
    const c = new EventEmitter();
    c.pid = ++pid;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.bin = bin; c.args = args; c.opts = opts;
    hijos.push(c);
    return c;
  };
  const killTree = (c) => { muertos.push(c.pid); setTimeout(() => c.emit('close', 1), 5); };
  return { jobs: new Jobs({ spawn, killTree, sesion: '' }), hijos, muertos, spawn, killTree };
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// El mismo banco, enchufado a la instancia VIVA del módulo (la de los runners).
// Va con su `killTree` falso y sin foto: los de verdad no pueden tocar un hijo
// que es un EventEmitter.
function bancoVivo() {
  const b = banco();
  J.configurar({ spawn: b.spawn, killTree: b.killTree, foto: null });
  base.setCwd(HOME);
  return b;
}

const hacerRun = (reqId = 'r1') => {
  const run = { ac: new AbortController(), reqId, avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};

// Una promesa que NO puede colgar el test: si el código bajo prueba no resuelve,
// esto falla con un mensaje en vez de dejar la suite corriendo para siempre.
const conTecho = (p, ms, qué) => {
  let reloj = null;
  return Promise.race([
    p,
    new Promise((_, rej) => { reloj = setTimeout(() => rej(new Error(`${qué}: no resolvió en ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(reloj));
};
const sinColgar = async (p, ms, qué) => {
  try { return await conTecho(p, ms, qué); } catch (e) { return `NO RESOLVIÓ (${e.message})`; }
};
const vive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const esperarMuerto = async (pid, ms = 8000) => {
  for (let i = 0; i < ms / 100; i++) { if (!vive(pid)) return true; await tick(100); }
  return !vive(pid);
};

let modoReal = false;      // true mientras la instancia viva lanza procesos de verdad
const pidsReales = [];     // cada proceso de verdad que este test arrancó

try {
  // ═══ El cableado del módulo ════════════════════════════════════════════════
  seccion('cableado de jobs.cjs');

  t('jobs.cjs exporta lo que dice', Object.keys(J).sort(),
    ['ID_RE', 'Jobs', 'MAX_RUNNING', 'READ_CHARS', 'WAIT_MAX_S', 'cerrarTodo', 'configurar', 'descendientes', 'duracion', 'fotoProcesos', 'jobs', 'patron', 'runners']);
  t('y sus runners son los tres de los jobs', Object.keys(J.runners).sort(), ['job_kill', 'job_output', 'job_start']);
  ok_('la instancia viva es un Jobs', J.jobs instanceof Jobs);
  ok_('que arranca con el spawn de Node', J.jobs.spawn === spawnReal);
  ok_('  el killTree de base.cjs', J.jobs.killTree === base.killTree);
  ok_('  y la foto de procesos de verdad', J.jobs.foto === J.fotoProcesos);
  ok_('con una marca de sesión de tres caracteres', /^[0-9a-z]{3}$/.test(J.jobs.sesion), J.jobs.sesion);
  t('los límites son los de NeonCode', [J.MAX_RUNNING, J.READ_CHARS, J.WAIT_MAX_S], [8, 10000, 60]);
  {
    J.configurar();
    J.configurar({ spawn: 'no soy una función', killTree: 5, foto: 'tampoco' });
    ok_('configurar ignora lo que no es una función', J.jobs.spawn === spawnReal && J.jobs.killTree === base.killTree && J.jobs.foto === J.fotoProcesos);
    J.configurar({ foto: null });
    t('salvo `foto: null`, que la saca', J.jobs.foto, null);
  }

  // ═══ Lo del test original, sobre la clase ══════════════════════════════════
  seccion('jobs · arranque y cursor de lectura');
  {
    const b = banco();
    const j = b.jobs.start({ command: 'npm run dev', cwd: 'C:\\proj' });
    t('el id es de la sesión', j.id, 'j1');
    const c = b.hijos[0];
    ok_('corre en powershell con el cwd pedido', c.bin === 'powershell.exe' && c.opts.cwd === 'C:\\proj');
    t('  sin stdin: un prompt interactivo recibe EOF y no cuelga', c.opts.stdio[0], 'ignore');
    c.stdout.emit('data', 'arrancando\n');
    c.stderr.emit('data', '\x1b[32mwarn\x1b[0m algo\n');
    const r1 = await b.jobs.read('j1');
    ok_('la primera lectura trae stdout y stderr en orden', /arrancando\n.*warn algo/s.test(r1), r1);
    ok_('  sin los códigos de color', !/\x1b/.test(r1));
    ok_('  y abre con el estado, no con la salida (un "error:" del proceso no tiñe la tool)', /^\[job j1 · running · pid \d+/.test(r1), r1);
    const r2 = await b.jobs.read('j1');
    ok_('la segunda, sin nada nuevo, lo dice', /no new output since the last read/.test(r2), r2);
    c.stdout.emit('data', 'listening on :5173\n');
    const r3 = await b.jobs.read('j1');
    ok_('la tercera trae SOLO lo nuevo', /listening/.test(r3) && !/arrancando/.test(r3), r3);
    const r4 = await b.jobs.read('j1', { all: true });
    ok_('all:true trae todo otra vez', /arrancando/.test(r4) && /listening/.test(r4), r4);
  }

  seccion('jobs · esperar');
  {
    const b = banco();
    b.jobs.start({ command: 'vite', cwd: 'C:\\p' });
    const c = b.hijos[0];
    setTimeout(() => c.stdout.emit('data', 'compilando...\n'), 20);
    setTimeout(() => c.stdout.emit('data', '  ➜  Local: http://localhost:5173 ready\n'), 40);
    const t0 = Date.now();
    const r = await b.jobs.read('j1', { wait: 5, until: 'ready|error' });
    ok_('until corta apenas aparece el patrón (no espera los 5 s)', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
    ok_('  y lo dice', /matched "ready\|error"/.test(r), r);
    ok_('  con la salida que llegó mientras', /compilando/.test(r) && /localhost:5173/.test(r), r);
  }
  {
    const b = banco();
    b.jobs.start({ command: 'npm test', cwd: 'C:\\p' });
    const c = b.hijos[0];
    setTimeout(() => { c.stdout.emit('data', '3 failing\n'); c.emit('close', 1); }, 20);
    const r = await b.jobs.read('j1', { wait: 5 });
    ok_('wait sin until espera a que termine', /exited with code 1/.test(r), r);
    ok_('  y trae la salida final', /3 failing/.test(r), r);
  }
  {
    const b = banco();
    b.jobs.start({ command: 'server', cwd: 'C:\\p' });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const t0 = Date.now();
    const r = await b.jobs.read('j1', { wait: 30, until: 'nunca' }, ac.signal);
    ok_('un Stop corta la ESPERA', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
    ok_('  pero NO el job: sigue vivo', /running/.test(r) && !b.muertos.length, r);
  }
  {
    const b = banco();
    b.jobs.start({ command: 'x', cwd: 'C:\\p' });
    const t0 = Date.now();
    const r = await b.jobs.read('j1', { wait: 0.05, until: 'ready' });
    ok_('si el patrón no llega, vuelve al cumplirse el tiempo y lo dice', /did not appear within/.test(r) && Date.now() - t0 < 1000, r);
  }
  t('until que no compila como regex se busca literal', patron('[ready').test('server [ready now'), true);

  seccion('jobs · parar, listar, límites');
  {
    const b = banco();
    b.jobs.start({ command: 'server', cwd: 'C:\\p', name: 'api' });
    b.hijos[0].stdout.emit('data', 'GET / 200\n');
    const r = await b.jobs.kill('j1');
    ok_('job_kill baja el árbol', b.muertos.length === 1);
    ok_('  y devuelve el estado real y la última salida', /stopped by job_kill/.test(r) && /GET \/ 200/.test(r), r);
    const r2 = await b.jobs.kill('j1');
    ok_('matar uno terminado no hace nada y lo dice', /already finished/.test(r2) && b.muertos.length === 1, r2);
    ok_('el resumen lista los terminados también', /j1 \(api\) · stopped/.test(b.jobs.resumen()), b.jobs.resumen());
    t('  pero el de "solo vivos" (el del system prompt) no', b.jobs.resumen({ soloVivos: true }), '');
  }
  {
    const b = banco();
    for (let i = 0; i < MAX_RUNNING; i++) b.jobs.start({ command: `c${i}`, cwd: 'C:\\p' });
    let msg = '';
    try { b.jobs.start({ command: 'uno más', cwd: 'C:\\p' }); } catch (e) { msg = e.message; }
    ok_(`no más de ${MAX_RUNNING} vivos a la vez`, /already \d+ background jobs running/.test(msg), msg);
    b.jobs.killAll();
    t('killAll (el before-quit) los baja a todos', b.muertos.length, MAX_RUNNING);
  }
  {
    const b = banco();
    let msg = '';
    try { await b.jobs.read('j7'); } catch (e) { msg = e.message; }
    ok_('un id que no existe dice que los jobs no sobreviven al reinicio', /no background job 'j7'.*do not survive an app restart/.test(msg), msg);
  }
  {
    const b = banco();
    b.jobs.start({ command: 'ruidoso', cwd: 'C:\\p' });
    b.hijos[0].stdout.emit('data', 'x'.repeat(250000));
    const r = await b.jobs.read('j1');
    ok_('lo que se fue del buffer antes de leerlo se anuncia', /scrolled out before they were read/.test(r));
    ok_('  y una lectura no pasa de ~10k caracteres', r.length < 11000, String(r.length));
  }
  {
    // Esto no estaba en el test original: los terminados se recuerdan, pero no
    // para siempre (MAX_KEPT = 20), y se van los más viejos.
    let reloj = 0;
    const hijos = [];
    const spawn = () => { const c = new EventEmitter(); c.pid = 101 + hijos.length * 2; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); hijos.push(c); return c; };
    const jobs = new Jobs({ spawn, killTree: () => {}, sesion: '', now: () => ++reloj });
    for (let i = 0; i < 25; i++) { jobs.start({ command: `c${i}`, cwd: 'C:\\p' }); hijos[i].emit('close', 0); }
    t('de 25 terminados se recuerdan los últimos 20', [...jobs.jobs.keys()], Array.from({ length: 20 }, (_, i) => `j${i + 6}`));
  }

  seccion('jobs · ids que no se repiten entre arranques');
  {
    const mk = () => new Jobs({ spawn: banco().jobs.spawn, killTree: () => {} });
    const a = mk();
    const ja = a.start({ command: 'x', cwd: 'C:\\p' });
    ok_('el id lleva la marca de la sesión', /^j1-[0-9a-z]{3}$/.test(ja.id), ja.id);
    // dos arranques de la app con la misma marca: 1 en 46656; se prueban varios
    const marcas = new Set(Array.from({ length: 20 }, () => mk().sesion));
    ok_('  y otro arranque tiene otra', marcas.size > 15, [...marcas].join(','));
    // La del original era 'zzz' a secas; si justo `a` sacó esa marca (1 en
    // 46656) el id viejo ERA el del job nuevo, así que acá se elige otra.
    const otra = a.sesion === 'zzz' ? 'yyy' : 'zzz';
    const b = new Jobs({ spawn: banco().jobs.spawn, killTree: () => {}, sesion: otra });
    b.start({ command: 'y', cwd: 'C:\\p' });
    let msg = '';
    try { await b.read(ja.id); } catch (e) { msg = e.message; }
    ok_('el id de un arranque anterior NO encuentra el job nuevo, y dice por qué',
      /earlier run of the app/.test(msg) && msg.includes(`Jobs in this session:\n- job j1-${otra}`), msg);
    msg = '';
    try { await b.read(`j4-${otra}`); } catch (e) { msg = e.message; }
    ok_('  un id de esta sesión que no existe no se confunde con uno viejo', !/earlier run/.test(msg) && msg.includes(`j1-${otra}`), msg);
    msg = '';
    try { await b.read('j1'); } catch (e) { msg = e.message; }
    ok_('  y uno pelado de antes de la 1.2.1 también se reconoce como viejo', /earlier run of the app/.test(msg), msg);
  }

  seccion('jobs · el árbol de procesos y sus ventanas');
  {
    // la foto: el powershell del job (101) → node (500) → electron (600, con
    // ventana) y su gpu (601); 700 dice ser hijo de 101 pero nació antes que él
    // (pid reciclado), y 800 es de otro árbol
    let vivos = null; // null = todos; si no, los pids que siguen vivos
    const procs = [
      { pid: 101, ppid: 4, name: 'powershell.exe', t: 10 },
      { pid: 500, ppid: 101, name: 'node.exe', t: 11 },
      { pid: 600, ppid: 500, name: 'electron.exe', t: 12 },
      { pid: 601, ppid: 600, name: 'electron.exe', t: 13 },
      { pid: 700, ppid: 101, name: 'viejo.exe', t: 5 },
      { pid: 800, ppid: 4, name: 'explorer.exe', t: 1 },
    ];
    let fotos = 0;
    const foto = async () => {
      fotos++;
      return {
        procs: vivos ? procs.filter((p) => vivos.includes(p.pid)) : procs,
        ventanas: [{ pid: 600, hwnd: 1234, title: 'Chem Engine' }, { pid: 800, hwnd: 99, title: 'ChemEngine - Explorador de archivos' }],
      };
    };
    const hijos = [];
    const spawn = () => { const c = new EventEmitter(); c.pid = 101; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); hijos.push(c); return c; };
    // el kill se lleva todo menos el electron
    const killTree = (c) => { vivos = [4, 600, 800]; setTimeout(() => c.emit('close', 1), 5); };
    const jobs = new Jobs({ spawn, killTree, foto, sesion: '' });
    jobs.start({ command: 'npm run dev', cwd: 'C:\\p' });
    t('descendientes: el árbol entero, sin el pid reciclado ni los ajenos',
      J.descendientes(procs, 101).map((p) => p.pid), [101, 500, 600, 601]);
    const r = await jobs.read('j1');
    ok_('una lectura de un job callado igual dice qué ventanas abrió (el caso Chem Engine)',
      /\[process tree: 4 alive \(powershell\.exe, node\.exe, electron\.exe ×2\) · windows: "Chem Engine" \(electron\.exe pid 600\)\]/.test(r), r);
    ok_('  y no se lleva la del Explorador, que es de otro árbol', !/Explorador/.test(r), r);
    const { arbol } = await jobs.arbol('j1');
    t('arbol(id) da las ventanas del job para screen_capture', arbol.ventanas.map((w) => w.hwnd), [1234]);
    // Lo que el port de screen_capture va a pedirle a este módulo (no estaba en
    // el test original): arbolDe(pid) para un pid suelto, y un árbol vacío —no
    // null— cuando ese pid no existe.
    t('  arbolDe(pid) arma el árbol de cualquier pid, con el nombre del proceso en cada ventana',
      (await jobs.arbolDe(500)).ventanas, [{ pid: 600, hwnd: 1234, title: 'Chem Engine', name: 'electron.exe' }]);
    t('  y para un pid que no existe da un árbol vacío, no null', await jobs.arbolDe(999), { procs: [], ventanas: [] });

    const k = await jobs.kill('j1');
    ok_('job_kill dice qué pids bajó', /Killed 4 processes: powershell\.exe 101, node\.exe 500, electron\.exe 600, electron\.exe 601\./.test(k), k);
    ok_('  y avisa del huérfano, con cómo matarlo', /WARNING: still alive after the kill: electron\.exe 600\. .*Stop-Process -Id 600 -Force/.test(k), k);
    const tras = fotos;
    const r2 = await jobs.read('j1');
    ok_('un job terminado no saca otra foto (no hay árbol que mirar)', fotos === tras && !/process tree/.test(r2), r2);
    const terminado = await jobs.arbol('j1');
    ok_('  y arbol(id) de uno terminado trae el job sin árbol', terminado.arbol === null && !!terminado.job.fin && fotos === tras);
  }
  {
    const procs = [{ pid: 101, ppid: 4, name: 'powershell.exe', t: 10 }];
    let n = 0;
    const foto = async () => (n++ === 0 ? { procs, ventanas: [] } : { procs: [{ pid: 800, ppid: 4, name: 'explorer.exe', t: 1 }], ventanas: [] });
    const spawn = () => { const c = new EventEmitter(); c.pid = 101; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); return c; };
    const jobs = new Jobs({ spawn, killTree: (c) => setTimeout(() => c.emit('close', 1), 5), foto, sesion: '' });
    jobs.start({ command: 'x', cwd: 'C:\\p' });
    const k = await jobs.kill('j1');
    ok_('si no quedó nadie, lo confirma', /Killed 1 process: powershell\.exe 101\. None of them is still running\./.test(k), k);
  }
  {
    const spawn = () => { const c = new EventEmitter(); c.pid = 101; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); return c; };
    const jobs = new Jobs({ spawn, killTree: (c) => setTimeout(() => c.emit('close', 1), 5), foto: async () => { throw new Error('timeout'); }, sesion: '' });
    jobs.start({ command: 'x', cwd: 'C:\\p' });
    const r = await jobs.read('j1');
    ok_('si la foto falla, la lectura sigue como antes', /^\[job j1 · running/.test(r) && !/process tree/.test(r), r);
    const k = await jobs.kill('j1');
    ok_('  y el kill también', /stopped by job_kill after \d+s — process tree killed\]$/.test(k.split('\n')[0]) && !/Killed/.test(k), k);
  }

  seccion('chips');
  {
    // En NeonCode argsDigest se sacaba del texto de main.js; acá es del motor.
    const { argsDigest } = motor;
    t('job_start muestra el comando', argsDigest('job_start', { command: 'npm run dev' }), 'npm run dev');
    t('  y el nombre si lo tiene', argsDigest('job_start', { command: 'npm run dev', name: 'vite' }), 'vite · npm run dev');
    t('job_output sin id', argsDigest('job_output', {}), 'all jobs');
    t('job_output con until', argsDigest('job_output', { id: 'j2', until: 'ready' }), 'j2 · until ready');
  }

  // ═══ Los runners, sobre la instancia viva y con el spawn falso ═════════════
  seccion('runners · job_start');
  const S = J.jobs.sesion;
  {
    const b = bancoVivo();
    const run = hacerRun();
    t('job_output sin id y sin jobs lo dice', await J.runners.job_output(run, {}), 'No background jobs in this session.');
    t('  y avisa a la interfaz que los mira todos', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'job_output', label: 'all jobs' }]]);
    t('  con los argumentos vacíos también', await J.runners.job_output(run), 'No background jobs in this session.');
  }
  {
    const b = bancoVivo();
    const run = hacerRun();
    t('sin comando no arranca nada', await J.runners.job_start(run, { command: '   ' }), 'error: command is required');
    t('ni con los argumentos vacíos', await J.runners.job_start(run), 'error: command is required');
    const fantasma = path.join(HOME, 'no-existe');
    t('un cwd que no existe falla antes de lanzar', await J.runners.job_start(run, { command: 'dir', cwd: fantasma }), `error: cwd does not exist: ${fantasma}`);
    const archivo = path.join(HOME, 'un-archivo.txt');
    t('y uno que es un archivo también', await J.runners.job_start(run, { command: 'dir', cwd: archivo }), `error: cwd is not a directory: ${archivo}`);
    t('ninguno de los cuatro llegó al spawn', b.hijos.length, 0);
    t('ni avisó a la interfaz', run.avisos.length, 0);
    t('ni gastó un id', J.jobs.seq, 0);
    t('y el cwd quedó donde estaba', base.cwdDe(run), HOME);
  }

  let idVite = null;
  {
    const b = bancoVivo();
    const run = hacerRun();
    const t0 = Date.now();
    const p = J.runners.job_start(run, { command: '  npm run dev  ', cwd: PROJ, name: 'vite' });
    await tick(20);
    const c = b.hijos[0];
    t('job_start lanza powershell.exe', c?.bin, 'powershell.exe');
    t('con sus banderas y la salida en UTF-8', c?.args,
      ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; npm run dev']);
    t('en el cwd pedido, sin ventana y sin stdin', c?.opts, { cwd: PROJ, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    t('avisa a la interfaz antes de lanzar', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'job_start', label: 'npm run dev' }]]);
    c.stdout.emit('data', Buffer.from('arrancando\n'));
    const txt = await sinColgar(p, 5000, 'job_start con un hijo que sigue vivo');
    const tardó = Date.now() - t0;
    idVite = `j1-${S}`;
    ok_('el id lleva el número y la marca de la sesión', txt.includes(`started background job ${idVite} `), txt);
    ok_('el resultado dice el pid, el cwd y cómo leerlo y pararlo',
      txt.startsWith(`started background job ${idVite} (pid 101) in ${PROJ}. Read it with job_output {"id":"${idVite}"}; stop it with job_kill.\n`), txt);
    ok_('  y abajo va el vistazo: el estado y lo que alcanzó a escribir',
      new RegExp(`\\n\\[job ${idVite} \\(vite\\) · running · pid 101 · \\d+s\\]\\narrancando\\n$`).test(txt), txt);
    ok_('el vistazo espera un segundo y medio a ver si se cae', tardó >= 1400 && tardó < 4000, `tardó ${tardó}ms`);
    t('el cwd del job queda como el de la corrida', base.cwdDe(run), PROJ);
    t('  y como el del turno siguiente', base.getCwd(), PROJ);
    t('no mató a nadie', b.muertos, []);

    seccion('runners · job_output y job_kill');
    const r2 = hacerRun('r2');
    const nada = await J.runners.job_output(r2, { id: idVite });
    ok_('job_output no repite lo que ya mostró el vistazo', /^\[job \S+ \(vite\) · running · pid 101 · \d+s\]\n\(no new output since the last read\)$/.test(nada), nada);
    t('  y avisa con el id', r2.avisos, [['tool:activity', { reqId: 'r2', kind: 'job_output', label: idVite }]]);
    c.stderr.emit('data', Buffer.from('listening on :5173\n'));
    const nuevo = await J.runners.job_output(r2, { id: idVite });
    ok_('la siguiente trae SOLO lo nuevo', /listening on :5173/.test(nuevo) && !/arrancando/.test(nuevo), nuevo);
    const todo = await J.runners.job_output(r2, { id: idVite, all: true });
    ok_('con all:true vuelve todo', /arrancando\nlistening on :5173/.test(todo), todo);

    setTimeout(() => c.stdout.emit('data', Buffer.from('ready in 300 ms\n')), 20);
    let t1 = Date.now();
    const visto = await sinColgar(J.runners.job_output(r2, { id: idVite, wait: 30, until: 'ready|error' }), 5000, 'job_output con until');
    ok_('wait + until cortan apenas aparece el patrón', Date.now() - t1 < 1000 && /\n\[matched "ready\|error"\]\nready in 300 ms\n$/.test(visto), visto);

    const r3 = hacerRun('r3');
    setTimeout(() => r3.ac.abort(), 20);
    t1 = Date.now();
    const cortado = await sinColgar(J.runners.job_output(r3, { id: idVite, wait: 30, until: 'nunca' }), 5000, 'job_output con Stop');
    ok_('un Stop del turno corta la espera', Date.now() - t1 < 1000, `${Date.now() - t1}ms`);
    ok_('  pero el job sigue vivo', /running/.test(cortado) && b.muertos.length === 0 && J.jobs.vivos().length === 1, cortado);
    const yaCortado = await sinColgar(J.runners.job_output(r3, { id: idVite, wait: 30 }), 5000, 'job_output con la señal ya abortada');
    ok_('  y una señal ya abortada no espera nada', /running/.test(yaCortado), yaCortado);

    const lista = await J.runners.job_output(r2, {});
    ok_('job_output sin id lista los jobs, con su comando y su carpeta',
      new RegExp(`^- job ${idVite} \\(vite\\) · running · pid 101 · \\d+s · \`npm run dev\` in `).test(lista) && lista.endsWith(` in ${PROJ}`), lista);

    const noHay = await J.runners.job_output(r2, { id: 'j99' });
    ok_('un id que no existe vuelve como error, con los que sí hay',
      noHay.startsWith(`error: no background job 'j99'. That id is from an earlier run of the app: jobs do not survive a restart. Jobs in this session:\n- job ${idVite} (vite) · running`), noHay);
    const sinId = await J.runners.job_kill(r2, {});
    ok_('job_kill sin id también es un error, no una excepción', sinId.startsWith('error: no background job '), sinId);
    t('  y avisa con la etiqueta vacía', r2.avisos[r2.avisos.length - 1], ['tool:activity', { reqId: 'r2', kind: 'job_kill', label: '' }]);
    t('  sin matar a nadie', b.muertos, []);

    const r4 = hacerRun('r4');
    const k = await sinColgar(J.runners.job_kill(r4, { id: idVite }), 6000, 'job_kill');
    ok_('job_kill baja el árbol y lo dice', new RegExp(`^\\[job ${idVite} \\(vite\\) · stopped by job_kill after \\d+s — process tree killed\\]$`).test(k), k);
    t('  le apuntó al pid del hijo', b.muertos, [101]);
    t('  y avisa con el id', r4.avisos, [['tool:activity', { reqId: 'r4', kind: 'job_kill', label: idVite }]]);
    ok_('sin foto no afirma qué procesos bajó', !/Killed|WARNING/.test(k), k);
    const otraVez = await J.runners.job_kill(r4, { id: idVite });
    ok_('matar uno terminado no hace nada y lo dice', /already finished, nothing to stop\.$/.test(otraVez) && b.muertos.length === 1, otraVez);
    t('ya no cuenta como vivo', J.jobs.vivos().length, 0);
    ok_('pero job_output sin id lo sigue listando', /stopped by job_kill/.test(await J.runners.job_output(r4, {})));
  }

  seccion('runners · lo que arranca y se cae');
  {
    const b = bancoVivo();
    const run = hacerRun();
    const t0 = Date.now();
    const p = J.runners.job_start(run, { command: 'npm rnu dev' });
    await tick(20);
    b.hijos[0].stderr.emit('data', Buffer.from('npm error: unknown command\n'));
    b.hijos[0].emit('close', 1);
    const txt = await sinColgar(p, 5000, 'job_start que muere enseguida');
    const id = `j2-${S}`;
    t('un comando que muere en el arranque no se anuncia como "started"', txt,
      `error: background job ${id} exited right away\n[job ${id} · exited with code 1 after 0s]\nnpm error: unknown command\n`);
    ok_('  y no espera el segundo y medio', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
    t('  sin cwd explícito corre en el de la corrida', b.hijos[0].opts.cwd, HOME);
  }
  {
    const b = bancoVivo();
    const run = hacerRun();
    const p = J.runners.job_start(run, { command: 'echo listo' });
    await tick(20);
    b.hijos[0].stdout.emit('data', Buffer.from('listo\n'));
    b.hijos[0].emit('close', 0);
    const txt = await sinColgar(p, 5000, 'job_start que termina bien enseguida');
    const id = `j3-${S}`;
    ok_('uno que termina enseguida con exit 0 sí arrancó, y lo dice con su final',
      txt.startsWith(`started background job ${id} (pid 101) in ${HOME}.`) && txt.endsWith(`\n[job ${id} · exited with code 0 after 0s]\nlisto\n`), txt);
  }
  {
    const b = bancoVivo();
    const run = hacerRun();
    const p = J.runners.job_start(run, { command: 'x' });
    await tick(20);
    b.hijos[0].emit('error', new Error('spawn powershell.exe ENOENT'));
    const txt = await sinColgar(p, 5000, 'job_start sin powershell');
    const id = `j4-${S}`;
    t('si powershell no arranca, es un error y dice por qué', txt,
      `error: background job ${id} exited right away\n[job ${id} · ended after 0s]\n\n[could not start powershell.exe — spawn powershell.exe ENOENT]\n`);
  }
  {
    bancoVivo();
    J.configurar({ spawn: () => { throw new Error('no se pudo lanzar'); } });
    const run = hacerRun();
    t('un spawn que tira vuelve como error, no como excepción', await sinColgar(J.runners.job_start(run, { command: 'x' }), 5000, 'spawn que tira'), 'error: no se pudo lanzar');
    t('  y no deja un job a medias', J.jobs.vivos().length, 0);
  }

  seccion('runners · el límite y cerrarTodo');
  {
    const b = bancoVivo();
    for (let i = 0; i < MAX_RUNNING; i++) J.jobs.start({ command: `c${i}`, cwd: HOME });
    const run = hacerRun();
    t(`con ${MAX_RUNNING} vivos, job_start dice que hay que parar uno`, await J.runners.job_start(run, { command: 'uno más' }),
      `error: there are already ${MAX_RUNNING} background jobs running — stop one with job_kill first`);
    t('  sin lanzar el noveno', b.hijos.length, MAX_RUNNING);
    t('  aunque ya avisó a la interfaz, como en NeonCode', run.avisos.length, 1);
    t('cerrarTodo no devuelve nada', J.cerrarTodo(), undefined);
    t('  y le baja el árbol a cada uno', b.muertos, b.hijos.map((c) => c.pid));
    await tick(40);
    t('  no queda ninguno vivo', J.jobs.vivos().length, 0);
    t('  ni en el resumen de vivos (el del system prompt)', J.jobs.resumen({ soloVivos: true }), '');
    ok_('  y quedan registrados como parados, no como caídos', J.jobs.resumen().split('\n').slice(-MAX_RUNNING).every((l) => /stopped by job_kill/.test(l)), J.jobs.resumen());
    J.cerrarTodo();
    t('cerrarTodo sin nada vivo no mata a nadie', b.muertos.length, MAX_RUNNING);
  }

  // ═══ Procesos de verdad ════════════════════════════════════════════════════
  seccion('procesos de verdad');
  // Antes de enchufar el taskkill de verdad no puede quedar NINGÚN job falso
  // vivo: cerrarTodo le pasaría su pid inventado al taskkill real.
  if (J.jobs.vivos().length) throw new Error(`quedaron ${J.jobs.vivos().length} jobs falsos vivos: no se pasa a los procesos de verdad`);
  J.configurar({ spawn: spawnReal, killTree: base.killTree, foto: J.fotoProcesos });
  base.setCwd(HOME);
  modoReal = true;

  {
    // La foto de verdad: una llamada a PowerShell que lista los procesos.
    const f = await conTecho(J.fotoProcesos(), 20000, 'fotoProcesos');
    const yo = f.procs.find((p) => p.pid === process.pid);
    ok_('fotoProcesos lista los procesos de verdad, este incluido', f.procs.length > 5 && !!yo, `procs=${f.procs.length}`);
    ok_('  con su nombre, su padre y su hora de creación', !!yo && /^node(\.exe)?$/i.test(yo.name) && Number.isInteger(yo.ppid) && yo.t > 0, JSON.stringify(yo));
    ok_('  y las ventanas vienen como { pid, hwnd, title }',
      Array.isArray(f.ventanas) && f.ventanas.every((w) => Number.isInteger(w.pid) && Number.isInteger(w.hwnd) && typeof w.title === 'string'), `ventanas=${f.ventanas.length}`);
  }

  {
    // Un bucle corto como job: se arranca, se lee, se mata y se confirma que el
    // proceso ya no está. Solo, se termina a los dos minutos.
    const run = hacerRun('real');
    const cmd = "1..600 | ForEach-Object { Write-Output ('tic ' + $_); Start-Sleep -Milliseconds 200 }";
    const txt = await sinColgar(J.runners.job_start(run, { command: cmd, cwd: PROJ, name: 'reloj' }), 60000, 'job_start de verdad');
    const m = /^started background job (j\d+-[0-9a-z]{3}) \(pid (\d+)\) in /.exec(txt);
    ok_('job_start arranca un proceso de verdad', !!m && txt.includes(` in ${PROJ}. Read it with job_output`), txt);
    const id = m?.[1];
    const pid = Number(m?.[2]);
    if (pid > 0) pidsReales.push(pid);
    ok_('  y el proceso está corriendo', pid > 0 && vive(pid), `pid ${pid}`);

    if (id) {
      const r = await sinColgar(J.runners.job_output(run, { id, wait: 30, until: 'tic \\d+' }), 60000, 'job_output de verdad');
      ok_('job_output lee lo que el proceso va escribiendo', /\ntic \d+\r?\n/.test(r), r);
      ok_('  abre con el estado', new RegExp(`^\\[job ${id} \\(reloj\\) · running · pid ${pid} · \\d+s\\]`).test(r), r);
      ok_('  dice que vio el patrón', /\[matched "tic \\d\+"\]/.test(r), r);
      ok_('  y trae el árbol de procesos de verdad, con el powershell del job', /\n\[process tree: \d+ alive \(powershell\.exe.*\) · (windows: .*|no visible window)\]\n/.test(r), r.split('\n').slice(0, 4).join(' | '));

      const { job, arbol } = await conTecho(J.jobs.arbol(id), 20000, 'arbol de verdad');
      ok_('jobs.arbol(id) da el árbol vivo: la raíz es el pid del job', job.pid === pid && arbol?.procs?.[0]?.pid === pid && /^powershell\.exe$/i.test(arbol.procs[0].name), JSON.stringify(arbol?.procs));

      const antes = await J.runners.job_output(run, { id });
      await tick(700);
      const después = await J.runners.job_output(run, { id });
      const nums = (s) => (s.match(/^tic (\d+)/gm) || []).map((x) => Number(x.slice(4)));
      ok_('dos lecturas seguidas no se pisan: la segunda sigue donde quedó la primera',
        nums(después).length > 0 && (nums(antes).length === 0 || Math.min(...nums(después)) > Math.max(...nums(antes))), `${nums(antes)} / ${nums(después)}`);

      const k = await sinColgar(J.runners.job_kill(run, { id }), 60000, 'job_kill de verdad');
      ok_('job_kill lo para y lo dice', new RegExp(`^\\[job ${id} \\(reloj\\) · stopped by job_kill after \\d+s — process tree killed\\]`).test(k), k);
      ok_('  dice qué procesos bajó, el powershell del job primero', new RegExp(`\\nKilled \\d+ process(es)?: powershell\\.exe ${pid}[,.]`).test(k), k);
      ok_('  y que ninguno quedó vivo', / None of them is still running\./.test(k) && !/WARNING/.test(k), k);
      ok_('el proceso ya no está', await esperarMuerto(pid), `el pid ${pid} sigue vivo`);
      const fin = await J.runners.job_output(run, { id });
      ok_('  y job_output lo da por parado, sin árbol', /stopped by job_kill/.test(fin) && !/process tree:/.test(fin), fin);
    }
  }

  {
    // Uno que termina solo: `wait` sin `until` vuelve cuando el proceso sale.
    const run = hacerRun('real2');
    const job = J.jobs.start({ command: "Write-Output 'listo ñandú'; exit 3", cwd: HOME });
    pidsReales.push(job.pid);
    const r = await sinColgar(J.runners.job_output(run, { id: job.id, wait: 60 }), 70000, 'esperar a uno que termina solo');
    ok_('un job que termina solo dice con qué código salió', new RegExp(`^\\[job ${job.id} · exited with code 3 after \\d+s\\]\\n`).test(r), r);
    ok_('  y trae su salida, en UTF-8', /listo ñandú/.test(r), r);
    ok_('  el proceso ya no está', await esperarMuerto(job.pid), `el pid ${job.pid} sigue vivo`);
  }

  {
    // cerrarTodo, que es lo que la app llama al salir: dos jobs dormidos.
    const a = J.jobs.start({ command: 'Start-Sleep -Seconds 90', cwd: HOME });
    const b = J.jobs.start({ command: 'Start-Sleep -Seconds 90', cwd: HOME });
    pidsReales.push(a.pid, b.pid);
    await tick(1500);
    ok_('dos jobs de verdad corriendo', vive(a.pid) && vive(b.pid) && J.jobs.vivos().length === 2, `vivos=${J.jobs.vivos().length}`);
    J.cerrarTodo();
    const muertoA = await esperarMuerto(a.pid);
    const muertoB = await esperarMuerto(b.pid);
    ok_('cerrarTodo se lleva a los dos', muertoA && muertoB, `a=${!muertoA ? 'vivo' : 'muerto'} b=${!muertoB ? 'vivo' : 'muerto'}`);
    for (let i = 0; i < 50 && J.jobs.vivos().length; i++) await tick(100);
    t('  y la instancia los da por terminados', J.jobs.vivos().length, 0);
    ok_('  como parados por la app, no como caídos', a.fin?.killed === true && b.fin?.killed === true, JSON.stringify([a.fin, b.fin]));
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  // Nada puede quedar corriendo. Lo de verdad se baja por pid, con el taskkill
  // del sistema y esperándolo; a un job falso nunca se le pasa el taskkill real.
  const pids = new Set(pidsReales);
  if (modoReal) for (const j of J.jobs.vivos()) pids.add(j.pid);
  for (const pid of pids) {
    if (Number.isInteger(pid) && pid > 0 && vive(pid)) {
      try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }); } catch { /* ya murió */ }
    }
  }
  const quedaron = [...pids].filter((pid) => Number.isInteger(pid) && pid > 0 && vive(pid));
  hechas++;
  if (quedaron.length) failures.push(`[limpieza] quedaron procesos corriendo: ${quedaron.join(', ')}`);
  base.setCwd(os.homedir());
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (failures.length) {
  console.error(`test-nix-tools-jobs: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-nix-tools-jobs: ok (${hechas} comprobaciones: cableado, cursor de lectura, esperas, parar y listar, ids por sesión, árbol y ventanas, chips, runners, límite y cerrarTodo, procesos de verdad)`);
process.exit(0);
