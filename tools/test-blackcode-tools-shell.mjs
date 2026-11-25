// Test de las tools de shell y de búsqueda de BlackCode
// (apps/BlackCode/main/tools/shell.cjs, search.cjs y code-search-worker.cjs), con
// node pelado. Uso: node tools/test-blackcode-tools-shell.mjs
//
// Son las comprobaciones de los dos tests de NeonCode de donde se portó el
// código (scripts/test-shell.js y scripts/test-code-search.js), más las que
// hacen falta para saber que el port quedó cableado igual. Tres bancos:
//
//   - un `spawn` FALSO: el hijo es un EventEmitter que emite lo que el test
//     quiera, incluida la posibilidad de NO emitir 'close' nunca, que es el
//     caso que dejaba el turno colgado para siempre;
//   - procesos de VERDAD, con comandos inofensivos (un echo, un sleep para el
//     timeout) adentro de una carpeta descartable;
//   - el worker de code_search de verdad, sobre un árbol descartable.
//
// Lo que este archivo tiene que fijar:
//   - que la promesa SIEMPRE cierre, aunque 'close' no llegue jamás;
//   - que un Stop del usuario no se registre como un timeout (la app no puede
//     afirmar un hecho que no pasó);
//   - que la salida se acote MIENTRAS llega, no después;
//   - que el cwd sea de la corrida y persista de un turno al otro;
//   - y que code_search no conteste "No matches" de algo que no miró.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn as spawnReal, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const base = require(path.join(TOOLS, 'base.cjs'));
const shell = require(path.join(TOOLS, 'shell.cjs'));
const search = require(path.join(TOOLS, 'search.cjs'));
const WORKER = path.join(TOOLS, 'code-search-worker.cjs');

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-shell-'));
const HOME = path.join(TMP, 'home');
const PROJ_A = path.join(TMP, 'proj-a');
const PROJ_B = path.join(TMP, 'proj-b');
const SUB = path.join(HOME, 'sub');
const ARBOL = path.join(TMP, 'arbol');
for (const d of [HOME, PROJ_A, PROJ_B, SUB, ARBOL]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(SUB, 'marca.txt'), 'estoy-en-sub\n');
fs.writeFileSync(path.join(HOME, 'un-archivo.txt'), 'no soy una carpeta\n');

// ── el banco falso: un `spawn` falso y un hijo que hace lo que el test pida ──

function hacerChild() {
  const c = new EventEmitter();
  c.pid = 4242;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  return c;
}

let ultimo = null;   // el último hijo "real" que se spawneó
let kills = [];      // cada taskkill que se disparó
let llamadas = [];   // cada spawn que no fue un taskkill: { bin, args, opts }

// El `killTree` falso va SIEMPRE con el `spawn` falso: el de base.cjs llama al
// taskkill de verdad con el pid que le den, y el pid de un hijo falso es un
// número cualquiera.
function banco() {
  ultimo = null;
  kills = [];
  llamadas = [];
  const spawnFake = (bin, args, opts) => {
    if (bin === 'taskkill') { kills.push(String(args[1])); return hacerChild(); }
    llamadas.push({ bin, args, opts });
    ultimo = hacerChild();
    return ultimo;
  };
  const killTreeFake = (child) => {
    try { spawnFake('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ya murió */ }
  };
  shell.configurar({ spawn: spawnFake, killTree: killTreeFake });
  base.setCwd(HOME);
  return {
    execShell: (run, args, kind) => shell.runners[kind](run, args),
    runProc: shell.runProc,
    cwdDe: base.cwdDe,
    resolveCwd: base.resolveCwd,
  };
}

/** Vuelve a los procesos de verdad. */
function deVerdad() {
  shell.configurar({ spawn: spawnReal, killTree: base.killTree });
  base.setCwd(HOME);
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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const sinColgar = async (p, ms, qué) => {
  try { return await conTecho(p, ms, qué); } catch (e) { return `NO RESOLVIÓ (${e.message})`; }
};
const vive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

try {
  // ═══ El cableado: qué se lanza con cada nombre ═════════════════════════════
  seccion('cableado de shell_exec y cmd_exec');

  t('shell.cjs exporta lo que dice', Object.keys(shell).sort(), ['configurar', 'execShell', 'runProc', 'runners']);
  t('y sus runners son los dos del shell', Object.keys(shell.runners).sort(), ['cmd_exec', 'shell_exec']);

  {
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: '  Get-Date  ' }, 'shell_exec');
    await esperar(20);
    t('shell_exec lanza powershell.exe', llamadas[0]?.bin, 'powershell.exe');
    t('con sus banderas y la salida en UTF-8', llamadas[0]?.args,
      ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Date']);
    t('en el cwd de la corrida y sin ventana', llamadas[0]?.opts, { cwd: HOME, windowsHide: true });
    t('avisa a la interfaz antes de ejecutar', run.avisos,
      [['tool:activity', { reqId: 'r1', kind: 'shell_exec', label: 'Get-Date' }]]);
    ultimo.emit('close', 0);
    t('sin salida y con exit 0 queda solo el pie', await conTecho(p, 1000, 'shell_exec falso'), `[cwd: ${HOME}]`);
  }

  {
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'dir' }, 'cmd_exec');
    await esperar(20);
    t('cmd_exec lanza cmd.exe', llamadas[0]?.bin, 'cmd.exe');
    t('con la página de códigos en UTF-8', llamadas[0]?.args, ['/d', '/s', '/c', 'chcp 65001>nul && dir']);
    t('y avisa con su propio nombre', run.avisos[0]?.[1]?.kind, 'cmd_exec');
    ultimo.emit('error', new Error('spawn cmd.exe ENOENT'));
    t('si no arranca, lo dice con el nombre del shell', await conTecho(p, 1000, 'cmd_exec que no arranca'),
      'error: could not start cmd.exe — spawn cmd.exe ENOENT');
  }

  {
    const S = banco();
    const run = hacerRun();
    t('sin comando no lanza nada', await S.execShell(run, { command: '   ' }, 'shell_exec'), 'error: command is required');
    t('ni con los argumentos vacíos', await S.execShell(run, undefined, 'cmd_exec'), 'error: command is required');
    const fantasma = path.join(HOME, 'no-existe');
    t('un cwd que no existe falla antes de lanzar', await S.execShell(run, { command: 'dir', cwd: fantasma }, 'shell_exec'),
      `error: cwd does not exist: ${fantasma}`);
    const archivo = path.join(HOME, 'un-archivo.txt');
    t('y uno que es un archivo también', await S.execShell(run, { command: 'dir', cwd: archivo }, 'shell_exec'),
      `error: cwd is not a directory: ${archivo}`);
    t('ninguno de los cuatro llegó al spawn', llamadas.length, 0);
    t('ni avisó a la interfaz', run.avisos.length, 0);
    t('y el cwd quedó donde estaba', S.cwdDe(run), HOME);
  }

  // ═══ La promesa cierra siempre ════════════════════════════════════════════
  seccion('cerrar la promesa: el turno no puede quedar colgado');

  {
    // El caso del hallazgo: un nieto heredó el pipe de stdout y sobrevivió al
    // taskkill, así que 'close' NO se emite nunca. Antes de esto, el await de
    // runTool no volvía jamás y el reqId quedaba vivo en `inflight` — con el
    // scheduler mudo hasta reiniciar la app.
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'lanza-un-nieto', timeout: 1 }, 'shell_exec');
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('alcancé a escribir esto\n'));
    // …y acá NO emitimos 'close'. Nunca.
    const txt = await sinColgar(p, 4000, 'execShell con timeout y sin close');
    ok_('el timeout cierra aunque "close" no llegue nunca', /timed out after 1s/.test(txt), txt);
    ok_('y devuelve lo que el proceso alcanzó a escribir', /alcancé a escribir esto/.test(txt), txt);
    ok_('mató el árbol en las dos pasadas', kills.length >= 2, `kills=${kills.length}`);
    t('y le apuntó al pid del hijo', kills[0], '4242');
  }

  {
    // Idem por el otro lado: el Stop tampoco destrababa, porque onAbort también
    // mataba sin resolver.
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'npm run dev' }, 'shell_exec');
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('escuchando en :3000\n'));
    run.ac.abort();
    const txt = await sinColgar(p, 3000, 'execShell abortado y sin close');
    ok_('el Stop cierra aunque "close" no llegue nunca', /process tree killed/.test(txt), txt);
  }

  {
    // Si 'close' SÍ llega, gana él: trae el exit code de verdad.
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'exit 3' }, 'shell_exec');
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('salida normal\n'));
    ultimo.emit('close', 3);
    const txt = await conTecho(p, 1000, 'close normal');
    ok_('un close normal reporta su exit code', /\[exit code 3\]/.test(txt), txt);
    ok_('y no inventa un timeout', !/timed out/.test(txt), txt);
    ok_('el cwd sigue en el pie', /\[cwd: /.test(txt), txt);
    t('no mató a nadie', kills.length, 0);
  }

  // ═══ Quién cortó: el reloj o el usuario ═══════════════════════════════════
  seccion('el Stop no es un timeout (la app no fabrica hechos)');

  {
    // El hallazgo: las dos causas escribían la MISMA bandera, así que apretar
    // Stop a los 2 segundos quedaba registrado —para el usuario Y para el
    // modelo, que lo lee como tool_result— como "el comando agotó sus 30s".
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'npm run dev' }, 'shell_exec');
    await esperar(20);
    run.ac.abort();
    ultimo.emit('close', null);
    const txt = await conTecho(p, 1000, 'abort con close');
    ok_('un Stop NO dice "timed out"', !/timed out/.test(txt), txt);
    ok_('un Stop dice que lo paró el usuario', /stopped by the user/.test(txt), txt);
    ok_('y no lo cuenta como exit code', !/exit code/.test(txt), txt);
  }

  {
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'algo lento', timeout: 1 }, 'shell_exec');
    await esperar(20);
    const txt = await sinColgar(p, 4000, 'timeout puro');
    ok_('un timeout SÍ dice "timed out", con su duración', /timed out after 1s/.test(txt), txt);
    ok_('y no se lo atribuye al usuario', !/stopped by the user/.test(txt), txt);
  }

  {
    // Una señal YA abortada cuando arranca la tool: el listener puesto sobre
    // ella no dispara nunca (el evento pasó antes de existir), y el hijo quedaba
    // corriendo sin nadie que lo matara. Es el mismo caso que el gate de
    // confirmación resuelve con su chequeo de `signal.aborted`.
    const S = banco();
    const run = hacerRun();
    run.ac.abort();
    const p = S.execShell(run, { command: 'no debería sobrevivir' }, 'shell_exec');
    const txt = await sinColgar(p, 3000, 'señal ya abortada');
    ok_('una señal ya abortada igual mata el hijo', kills.length >= 1, `kills=${kills.length}`);
    ok_('y cierra la promesa', /stopped by the user/.test(txt), txt);
  }

  {
    // Los topes del reloj: 30 s si no se pide nada, y nunca más de 2 minutos.
    // Se miran sin esperarlos: se espía el setTimeout mientras arranca la tool
    // y el hijo falso cierra enseguida.
    const pedidos = [];
    const setTimeoutReal = globalThis.setTimeout;
    const S = banco();
    globalThis.setTimeout = (fn, ms, ...resto) => { pedidos.push(ms); return setTimeoutReal(fn, ms, ...resto); };
    let ps;
    try {
      ps = [undefined, 500, 0.2, 'abc'].map((timeout) => {
        const run = hacerRun();
        const p = S.execShell(run, { command: 'x', timeout }, 'shell_exec');
        ultimo.emit('close', 0);
        return p;
      });
    } finally { globalThis.setTimeout = setTimeoutReal; }
    await Promise.all(ps);
    t('sin timeout son 30 s, el techo son 2 min, el piso 1 s y lo que no es un número son 30 s',
      pedidos, [30000, base.SHELL_MAX_TIMEOUT, 1000, 30000]);
  }

  // ═══ La cota de memoria ═══════════════════════════════════════════════════
  seccion('acotar mientras llega, no al final');

  {
    // El hallazgo: `out += d` sin techo de bytes. El único límite era el reloj
    // (hasta 120s), y el recorte llegaba recién en el 'close' — con la memoria
    // ya gastada. Un `Get-ChildItem C:\ -Recurse` apilaba cientos de MB para
    // quedarse al final con 8000 caracteres.
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'Get-ChildItem C:\\ -Recurse' }, 'shell_exec');
    await esperar(20);
    const linea = 'C:\\Windows\\System32\\algun-archivo-con-nombre-largo.dll\n';
    for (let i = 0; i < 20000; i++) ultimo.stdout.emit('data', Buffer.from(linea));
    ultimo.emit('close', 0);
    const txt = await conTecho(p, 2000, 'salida enorme');
    const pasaron = linea.length * 20000;
    ok_(`pasaron ${pasaron} chars y quedaron ${txt.length}`, txt.length < 11000, `largo=${txt.length}`);
    ok_('la cabeza es el principio de verdad', txt.startsWith('C:\\Windows\\System32\\algun'), txt.slice(0, 40));
    ok_('la cola sobrevive (ahí vive el error de un build)', /algun-archivo-con-nombre-largo\.dll/.test(txt.slice(-200)));
    const m = txt.match(/…\[(\d+) chars omitted\]…/);
    ok_('anuncia el recorte', !!m, txt.slice(0, 200));
    // Lo que se anuncia tiene que ser lo que PASÓ, no lo que sobrevivió al
    // recorte anterior: encadenar dos truncados hacía que el número dijera
    // treinta mil cuando habían pasado un millón.
    ok_('y el número es el total real, no el del texto ya recortado',
      m && Number(m[1]) > pasaron * 0.9, m ? `dijo ${m[1]} de ${pasaron}` : 'sin marca');
    t('el tope es el del shell', base.SHELL_MAX_CHARS, 10000);
  }

  {
    // Una salida chica tiene que volver INTACTA: la cota no puede cobrarle nada
    // al caso normal, que es el 99% de las llamadas.
    const S = banco();
    const run = hacerRun();
    const p = S.execShell(run, { command: 'echo hola' }, 'shell_exec');
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('hola\n'));
    ultimo.stderr.emit('data', Buffer.from('un warning\n'));
    ultimo.emit('close', 0);
    const txt = await conTecho(p, 1000, 'salida chica');
    ok_('la salida chica vuelve entera', /^hola/.test(txt), txt);
    ok_('con su stderr', /\[stderr\]\nun warning/.test(txt), txt);
    ok_('y sin ninguna marca de recorte', !/omitted/.test(txt), txt);
    t('el texto completo, con el pie', txt, `hola\n\n[stderr]\nun warning\n\n[cwd: ${HOME}]`);
  }

  // ═══ El gemelo ════════════════════════════════════════════════════════════
  seccion('runProc: el mismo arreglo del otro lado');

  {
    // runProc era una copia de execShell con los MISMOS tres defectos. Este
    // bloque existe para que no puedan volver a divergir.
    const S = banco();
    const ac = new AbortController();
    const p = S.runProc({ bin: 'python', args: ['x.py'], timeoutMs: 1000, signal: ac.signal });
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('trabajando\n'));
    ac.abort();
    let r = null;
    try { r = await conTecho(p, 3000, 'runProc abortado y sin close'); }
    catch (e) { r = { error: e.message }; }
    ok_('cierra aunque "close" no llegue', !!r && !r.error, r && r.error);
    t('un Stop no se cuenta como timeout', r && r.timedOut, false);
    t('se cuenta como abort', r && r.aborted, true);
    ok_('y trae lo que alcanzó a escribir', /trabajando/.test((r && r.out) || ''), r && r.out);
  }

  {
    const S = banco();
    const p = S.runProc({ bin: 'python', args: ['x.py'], timeoutMs: 1000 });
    await esperar(20);
    let r = null;
    try { r = await conTecho(p, 4000, 'runProc timeout'); }
    catch (e) { r = { error: e.message }; }
    t('un timeout sí se cuenta como timeout', r && r.timedOut, true);
    t('y no como abort', r && r.aborted, false);
    t('no queda como ok', r && r.ok, false);
  }

  {
    // El tope se pasa por llamador, como el maxLen de splitMessage: code_search
    // PARSEA su salida, así que un recorte no la acorta — la rompe.
    const S = banco();
    const p = S.runProc({ bin: 'node', args: ['worker.js'], timeoutMs: 1000, maxChars: 200 });
    await esperar(20);
    ultimo.stdout.emit('data', Buffer.from('x'.repeat(5000)));
    ultimo.emit('close', 0);
    const r = await conTecho(p, 1000, 'runProc acotado');
    ok_('respeta el maxChars del llamador', r.out.length < 300, `largo=${r.out.length}`);
    t('y avisa que cortó', r.cortado, true);
  }

  {
    const S = banco();
    const p = S.runProc({ bin: 'node', args: ['worker.js'], cwd: HOME, env: { X: '1' }, timeoutMs: 1000, maxChars: 200 });
    await esperar(20);
    t('pasa bin, args, cwd y env al spawn, sin ventana', llamadas[0],
      { bin: 'node', args: ['worker.js'], opts: { cwd: HOME, env: { X: '1' }, windowsHide: true } });
    ultimo.stdout.emit('data', Buffer.from('{"ok":true}'));
    ultimo.emit('close', 0);
    const r = await conTecho(p, 1000, 'runProc chico');
    t('una salida que entra no se marca cortada', r.cortado, false);
    t('y vuelve tal cual (code_search la parsea)', r.out, '{"ok":true}');
    t('con su exit code', r.ok, true);
  }

  {
    // Un spawn que TIRA (no un 'error' diferido): la promesa igual resuelve.
    banco();
    shell.configurar({ spawn: () => { throw new Error('no se pudo lanzar'); } });
    const r = await conTecho(shell.runProc({ bin: 'x', args: [], timeoutMs: 1000 }), 1000, 'spawn que tira');
    t('un spawn que tira vuelve como falla, no como excepción', r,
      { ok: false, code: -1, out: '', err: 'no se pudo lanzar', timedOut: false, aborted: false, cortado: false });
  }

  // ═══ El cwd es de la corrida ══════════════════════════════════════════════
  seccion('el cwd vive en el run, no en el módulo');

  {
    // Era UNA variable de módulo compartida por diez tools, y nada serializa las
    // corridas: dos chats contestan a la vez. El chat A dejaba el cwd en
    // C:\proj-a, el B lo movía mientras A esperaba al proveedor, y la ronda
    // siguiente de A resolvía sus rutas relativas contra el proyecto de B.
    const S = banco();
    const rA = hacerRun('a');
    const rB = hacerRun('b');
    t('sin cwd propio, la corrida arranca del global', S.cwdDe(rA), HOME);
    t('resolveCwd le devuelve el absoluto', S.resolveCwd(rA, PROJ_A), PROJ_A);
    t('y se lo guarda a ESA corrida', S.cwdDe(rA), PROJ_A);
    S.resolveCwd(rB, PROJ_B);
    t('mover el de B no toca el de A', S.cwdDe(rA), PROJ_A);
    t('y B tiene el suyo', S.cwdDe(rB), PROJ_B);
    t('un cwd vacío no mueve nada', S.resolveCwd(rA, '   '), PROJ_A);
    // El global sigue existiendo para que el `cd` persista de un turno al otro:
    // una corrida NUEVA arranca donde quedó la anterior.
    const rC = hacerRun('c');
    t('un turno nuevo hereda el último cwd', S.cwdDe(rC), PROJ_B);
  }

  {
    // Lo mismo por el camino real: shell_exec con `cwd`.
    const S = banco();
    const rA = hacerRun('a');
    const rB = hacerRun('b');
    const pA = S.execShell(rA, { command: 'npm test', cwd: PROJ_A }, 'shell_exec');
    await esperar(20); ultimo.emit('close', 0);
    await conTecho(pA, 1000, 'shell con cwd');
    t('el hijo se lanza en el cwd pedido', llamadas[0]?.opts?.cwd, PROJ_A);
    const pB = S.execShell(rB, { command: 'dir', cwd: PROJ_B }, 'shell_exec');
    await esperar(20); ultimo.emit('close', 0);
    const txtB = await conTecho(pB, 1000, 'shell del otro chat');
    ok_('cada corrida reporta su propio cwd', txtB.endsWith(`[cwd: ${PROJ_B}]`), txtB.slice(-80));
    t('y el chat A sigue en el suyo', S.cwdDe(rA), PROJ_A);
    // una ruta relativa se resuelve contra el cwd de ESA corrida, no el global
    const pA2 = S.execShell(rA, { command: 'dir', cwd: '..' }, 'cmd_exec');
    await esperar(20); ultimo.emit('close', 0);
    const txtA2 = await conTecho(pA2, 1000, 'cwd relativo');
    ok_('un cwd relativo sale del de la corrida', txtA2.endsWith(`[cwd: ${TMP}]`), txtA2.slice(-80));
  }

  // ═══ Procesos de verdad ════════════════════════════════════════════════════
  seccion('procesos de verdad: PowerShell y cmd');
  deVerdad();

  {
    const run = hacerRun();
    const txt = await sinColgar(shell.runners.shell_exec(run, { command: "Write-Output 'hola ñandú'" }), 60000, 'echo en PowerShell');
    ok_('shell_exec corre el comando en PowerShell', /^hola ñandú\r?\n/.test(txt), txt);
    ok_('con el cwd en el pie', txt.endsWith(`[cwd: ${HOME}]`), txt);
    ok_('y sin marca de exit code', !/exit code|timed out|stopped/.test(txt), txt);
  }

  {
    // Solo ASCII y sin comillas, a propósito: el código portado de NeonCode
    // tiene dos defectos en cmd_exec que este test no fija como buenos. Un
    // `echo` con eñes sale en la página de códigos OEM (el `chcp 65001` de la
    // misma línea no alcanza a los comandos internos de ese cmd), y las
    // comillas dobles del comando llegan a cmd.exe como \" porque el spawn no
    // usa windowsVerbatimArguments.
    const run = hacerRun();
    const txt = await sinColgar(shell.runners.cmd_exec(run, { command: 'echo hola' }), 60000, 'echo en cmd');
    ok_('cmd_exec corre el comando en cmd.exe', /^hola\r?\n/.test(txt), txt);
    ok_('con el cwd en el pie', txt.endsWith(`[cwd: ${HOME}]`), txt);
  }

  {
    const run = hacerRun();
    const a = await sinColgar(shell.runners.shell_exec(run, { command: 'exit 3' }), 60000, 'exit 3 en PowerShell');
    t('el exit code de PowerShell llega al texto', a, `[exit code 3]\n[cwd: ${HOME}]`);
    const b = await sinColgar(shell.runners.cmd_exec(run, { command: 'exit /b 4' }), 60000, 'exit 4 en cmd');
    t('y el de cmd también', b, `[exit code 4]\n[cwd: ${HOME}]`);
  }

  {
    // El cwd persiste: un turno lo mueve y el SIGUIENTE (otra corrida) arranca ahí.
    const r1 = hacerRun('t1');
    const a = await sinColgar(shell.runners.shell_exec(r1, { command: 'Get-Content marca.txt', cwd: 'sub' }), 60000, 'cwd relativo de verdad');
    ok_('el comando corre en el cwd pedido', /^estoy-en-sub/.test(a), a);
    ok_('y el pie lo dice', a.endsWith(`[cwd: ${SUB}]`), a);
    const r2 = hacerRun('t2');
    const b = await sinColgar(shell.runners.cmd_exec(r2, { command: 'type marca.txt' }), 60000, 'cwd heredado');
    ok_('el turno siguiente arranca donde quedó el anterior', /^estoy-en-sub/.test(b) && b.endsWith(`[cwd: ${SUB}]`), b);
    t('y base.getCwd() lo sabe', base.getCwd(), SUB);
    base.setCwd(HOME);
  }

  {
    // El reloj, con un proceso de verdad: un sleep de 30 s con 1 s de tope.
    const run = hacerRun();
    const t0 = Date.now();
    const txt = await sinColgar(shell.runners.shell_exec(run, { command: 'Start-Sleep -Seconds 30', timeout: 1 }), 20000, 'timeout de verdad');
    const tardó = Date.now() - t0;
    ok_('el timeout corta un proceso de verdad', /\[timed out after 1s — process tree killed\]/.test(txt), txt);
    ok_('y lo corta a tiempo, no a los 30 s', tardó < 10000, `tardó ${tardó}ms`);
  }

  {
    // El Stop, con un árbol de verdad: cmd.exe → powershell.exe. El nieto
    // imprime su pid y se duerme; después del Stop no puede seguir vivo.
    const run = hacerRun();
    let llegó = null;
    const primerDato = new Promise((res) => { llegó = res; });
    shell.configurar({
      spawn: (...a) => {
        const c = spawnReal(...a);
        if (a[0] === 'cmd.exe') c.stdout.once('data', () => llegó());
        return c;
      },
    });
    const p = shell.runners.cmd_exec(run, { command: 'powershell -NoProfile -Command $PID; Start-Sleep -Seconds 30' });
    await Promise.race([primerDato, esperar(15000)]);
    const t0 = Date.now();
    run.ac.abort();
    const txt = await sinColgar(p, 20000, 'Stop de verdad');
    const tardó = Date.now() - t0;
    shell.configurar({ spawn: spawnReal });
    ok_('el Stop corta un proceso de verdad', /\[stopped by the user — process tree killed\]/.test(txt), txt);
    ok_('no lo cuenta como timeout ni como exit code', !/timed out|exit code/.test(txt), txt);
    ok_('y vuelve enseguida', tardó < 5000, `tardó ${tardó}ms`);
    const nieto = Number((txt.match(/^(\d+)\s/) || [])[1]);
    ok_('el nieto llegó a decir su pid', Number.isInteger(nieto) && nieto > 0, txt);
    if (nieto > 0) {
      let muerto = false;
      for (let i = 0; i < 30 && !muerto; i++) { muerto = !vive(nieto); if (!muerto) await esperar(100); }
      ok_('y el Stop se llevó el árbol entero, nieto incluido', muerto, `el pid ${nieto} sigue vivo`);
    }
  }

  {
    const r = await conTecho(shell.runProc({ bin: process.execPath, args: ['-e', 'console.log(1+1); console.error("ojo")'], timeoutMs: 20000 }), 30000, 'runProc de verdad');
    t('runProc corre un proceso de verdad y trae las dos salidas',
      { ok: r.ok, code: r.code, out: r.out.trim(), err: r.err.trim(), timedOut: r.timedOut, aborted: r.aborted, cortado: r.cortado },
      { ok: true, code: 0, out: '2', err: 'ojo', timedOut: false, aborted: false, cortado: false });
    const no = await conTecho(shell.runProc({ bin: path.join(HOME, 'no-existe.exe'), args: [], timeoutMs: 5000 }), 10000, 'runProc sin binario');
    t('un binario que no existe es una falla, no un cuelgue', { ok: no.ok, code: no.code, timedOut: no.timedOut }, { ok: false, code: -1, timedOut: false });
  }

  // ═══ code_search: el worker de verdad ══════════════════════════════════════
  // Lo que se cuida (1.11.3): `path` apuntando a UN archivo. El walk le hacía
  // readdirSync, que tira ENOTDIR; el catch se lo tragaba y la tool contestaba
  // "No matches" con el texto adentro del archivo. Es la peor clase de error para
  // un agente: le hace afirmar que algo no existe.
  seccion('code_search: el worker, corrido como proceso');

  const dir = ARBOL;
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;\nfunction aguja() {}\n');
  fs.writeFileSync(path.join(dir, 'sub', 'b.md'), '# aguja en otro lado\n');
  // lo que el worker NO mira: carpetas de dependencias, carpetas ocultas y binarios
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'c.js'), 'aguja en una dependencia\n');
  fs.mkdirSync(path.join(dir, '.oculta'));
  fs.writeFileSync(path.join(dir, '.oculta', 'd.js'), 'aguja en una carpeta oculta\n');
  fs.writeFileSync(path.join(dir, 'e.bin'), Buffer.from([0x61, 0x67, 0x75, 0x6a, 0x61, 0x00, 0x01, 0x02]));

  const buscar = (opts) => {
    const r = spawnSync(process.execPath, [WORKER, JSON.stringify(opts)], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    return JSON.parse(r.stdout);
  };

  {
    // path que es un archivo
    let r = buscar({ root: path.join(dir, 'a.js'), mode: 'content', pattern: 'aguja' });
    t('encuentra el texto adentro del archivo', r.results, ['a.js:2: function aguja() {}']);
    t('  y miró un archivo', r.filesWalked, 1);
    r = buscar({ root: path.join(dir, 'a.js'), mode: 'content', pattern: 'aguja', glob: '*.md' });
    t('un glob que no lo nombra no lo descarta (lo pediste por nombre)', r.results.length, 1);
    r = buscar({ root: path.join(dir, 'a.js'), mode: 'content', pattern: 'no-esta' });
    t('lo que no está, no está', r.results, []);
    r = buscar({ root: path.join(dir, 'a.js'), mode: 'files', glob: '*' });
    t('modo files con un archivo lo lista', r.results, ['a.js']);

    // lo que ya andaba
    r = buscar({ root: dir, mode: 'content', pattern: 'aguja' });
    t('una carpeta se recorre entera', r.results.sort(), ['a.js:2: function aguja() {}', 'sub/b.md:1: # aguja en otro lado']);
    t('  sin entrar a node_modules ni a las carpetas ocultas', r.filesWalked, 3);
    t('  y sin decir que cortó', [r.truncated, r.walkCapped, r.maxFiles], [false, false, 5000]);
    r = buscar({ root: dir, mode: 'content', pattern: 'aguja', glob: '*.md' });
    t('  y el glob filtra', r.results, ['sub/b.md:1: # aguja en otro lado']);
    // una carpeta excluida no se recorre, venga de donde venga la búsqueda (la de los documentos de la app)
    r = buscar({ root: dir, mode: 'content', pattern: 'aguja', exclude: fs.realpathSync.native(path.join(dir, 'sub')).toLowerCase() });
    t('  y una carpeta excluida no se recorre', r.results, ['a.js:2: function aguja() {}']);
  }

  // ═══ code_search: el runner ════════════════════════════════════════════════
  seccion('code_search: el runner');

  t('search.cjs exporta lo que dice', Object.keys(search).sort(), ['CODE_SEARCH_MAX_CHARS', 'configurar', 'pistaLiteral', 'runCodeSearch', 'runners']);
  t('y su runner es code_search', Object.keys(search.runners), ['code_search']);
  ok_('el worker está al lado de search.cjs', fs.existsSync(WORKER));

  const cs = (run, args) => conTecho(search.runners.code_search(run, args), 60000, `code_search ${JSON.stringify(args)}`);
  const lineas = (txt) => txt.split('\n').slice(1).sort();

  {
    const run = hacerRun();
    t('sin pattern, el modo content no arranca', await cs(run, {}), 'error: pattern is required for content mode');
    t('sin glob, el modo files tampoco', await cs(run, { mode: 'files', pattern: 'x' }), 'error: glob is required for files mode');
    const fantasma = path.join(dir, 'no-existe');
    t('una ruta que no existe se dice', await cs(run, { pattern: 'x', path: fantasma }), `error: path does not exist: ${fantasma}`);
    t('y ninguno avisó a la interfaz', run.avisos.length, 0);
  }

  {
    const run = hacerRun();
    const txt = await cs(run, { pattern: 'aguja', path: dir });
    t('modo content: el encabezado cuenta los resultados', txt.split('\n')[0], `2 results under ${dir}:`);
    t('  y abajo van como archivo:línea: texto', lineas(txt), ['a.js:2: function aguja() {}', 'sub/b.md:1: # aguja en otro lado']);
    t('  avisa a la interfaz con el patrón', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'code_search', label: 'aguja' }]]);
    t('uno solo va en singular', await cs(run, { pattern: 'aguja', path: dir, glob: '*.md' }),
      `1 result under ${dir}:\nsub/b.md:1: # aguja en otro lado`);
    t('modo files: lista por nombre', await cs(run, { mode: 'files', glob: '*.js', path: dir }), `1 result under ${dir}:\na.js`);
    t('  y avisa con el glob', run.avisos[2]?.[1]?.label, '*.js');
    t('un `path` que es un archivo se busca adentro', await cs(run, { pattern: 'aguja', path: path.join(dir, 'a.js') }),
      `1 result under ${path.join(dir, 'a.js')}:\na.js:2: function aguja() {}`);
    t('lo que no está, se dice sin adornos', await cs(run, { pattern: 'no-esta', path: dir }), `No matches for "no-esta" under ${dir}`);
    t('en modo files también', await cs(run, { mode: 'files', glob: '*.py', path: dir }), `No matches for *.py under ${dir}`);
    t('por defecto no distingue mayúsculas', (await cs(run, { pattern: 'AGUJA', path: dir })).split('\n')[0], `2 results under ${dir}:`);
    t('con case_sensitive sí', await cs(run, { pattern: 'AGUJA', path: dir, case_sensitive: true }), `No matches for "AGUJA" under ${dir}`);
    t('el patrón es literal salvo que se pida regex', await cs(run, { pattern: 'agu.a', path: dir }), `No matches for "agu.a" under ${dir}`);
    t('y con regex=true es una expresión regular', (await cs(run, { pattern: 'agu.a', path: dir, regex: true })).split('\n')[0], `2 results under ${dir}:`);
    // Cero resultados en modo literal con un patrón que tiene pinta de regex: un
    // agente buscó `encargo|Encargos`, no encontró nada y concluyó que la
    // palabra no estaba. El resultado tiene que advertirle que se buscó tal cual.
    {
      const sinNada = await cs(run, { pattern: 'aguja|alfiler', path: dir });
      ok_('«a|b» en modo literal no encuentra nada, y avisa que se buscó tal cual', sinNada.startsWith(`No matches for "aguja|alfiler" under ${dir}`) && /LITERAL/.test(sinNada) && /regex=true/.test(sinNada) && /does not show the words are absent/.test(sinNada), sinNada);
      t('…y con regex=true los encuentra, sin aviso', (await cs(run, { pattern: 'aguja|alfiler', path: dir, regex: true })).split('\n')[0], `2 results under ${dir}:`);
      t('una regex que no encuentra nada no lleva el aviso', await cs(run, { pattern: 'alfiler|dedal', path: dir, regex: true }), `No matches for "alfiler|dedal" under ${dir}`);
      ok_('si en modo literal SÍ encuentra (una barra de verdad), no hay aviso', (() => { fs.writeFileSync(path.join(dir, 'tabla.md'), '| a|b | c |\n'); return true; })() && !/LITERAL/.test(await cs(run, { pattern: 'a|b', path: dir })) && (await cs(run, { pattern: 'a|b', path: dir })).includes('tabla.md:1'));
      fs.rmSync(path.join(dir, 'tabla.md'));
      const p = search.pistaLiteral;
      ok_('la pista salta con lo que casi nunca es literal', ['a|b', 'foo.*bar', 'x.+', '[a-z]+', '[^0-9]', '(ab)+', '^import'].every((x) => p('content', x, false) !== ''), ['a|b', 'foo.*bar', 'x.+', '[a-z]+', '[^0-9]', '(ab)+', '^import'].filter((x) => p('content', x, false) === '').join(' '));
      ok_('…y no con búsquedas comunes', ['aguja', 'a.b', 'aguja()', 'arr[0]', 'C:\\docs\\src', 'precio $', 'x == y', 'foo(bar)', '¿qué?', 'v1.2.3'].every((x) => p('content', x, false) === ''), ['aguja', 'a.b', 'aguja()', 'arr[0]', 'C:\\docs\\src', 'precio $', 'x == y', 'foo(bar)', '¿qué?', 'v1.2.3'].filter((x) => p('content', x, false) !== '').join(' '));
      ok_('…ni si ya era regex, ni en modo files', p('content', 'a|b', true) === '' && p('files', 'a|b', false) === '');
    }
    t('max_results corta la lista y lo dice', (await cs(run, { pattern: 'aguja', path: dir, max_results: 1 })).split('\n')[0],
      `1 result (truncated at limit) under ${dir}:`);
    const roto = await cs(run, { pattern: '(', path: dir, regex: true });
    ok_('una regex inválida vuelve como error, no como "No matches"', /^error: search failed — /.test(roto) && /Invalid regular expression/.test(roto), roto.slice(0, 200));
  }

  {
    // `path` relativo: contra el cwd de la corrida, el mismo que mueve el shell.
    const run = hacerRun();
    base.resolveCwd(run, dir);
    t('sin `path` busca en el cwd de la corrida', (await cs(run, { pattern: 'aguja' })).split('\n')[0], `2 results under ${dir}:`);
    t('y un `path` relativo sale de ahí', await cs(run, { pattern: 'aguja', path: 'sub' }),
      `1 result under ${path.join(dir, 'sub')}:\nb.md:1: # aguja en otro lado`);
    base.setCwd(HOME);
  }

  {
    // El Stop: no es una falla de la búsqueda.
    const run = hacerRun();
    run.ac.abort();
    t('una búsqueda cortada por el usuario dice eso', await cs(run, { pattern: 'aguja', path: dir }), 'error: search stopped');
  }

  {
    // Lo que el runner hace con cada respuesta de runProc, sin lanzar nada.
    let pedido = null;
    let respuesta = null;
    search.configurar({ runProc: async (o) => { pedido = o; return respuesta; } });
    const run = hacerRun();
    const responde = (r) => { respuesta = { ok: true, code: 0, out: '', err: '', timedOut: false, aborted: false, cortado: false, ...r }; };
    const json = (d) => JSON.stringify({ ok: true, mode: 'content', results: [], truncated: false, walkCapped: false, filesWalked: 0, maxFiles: 5000, ...d });
    try {
      responde({ out: json({}) });
      await cs(run, { pattern: 'x', path: dir, max_results: 7 });
      t('lanza el worker con el binario de la app como Node', [pedido.bin, pedido.args[0], pedido.env.ELECTRON_RUN_AS_NODE], [process.execPath, WORKER, '1']);
      t('le pasa las opciones como JSON', JSON.parse(pedido.args[1]),
        { root: dir, mode: 'content', pattern: 'x', regex: false, case_sensitive: false, max_results: 7 });
      t('con 15 s de reloj y el techo de lectura propio', [pedido.timeoutMs, pedido.maxChars, search.CODE_SEARCH_MAX_CHARS], [15000, 2097152, 2097152]);
      ok_('y la señal de la corrida, para que el Stop lo mate', pedido.signal === run.ac.signal);

      responde({ ok: false, code: null, timedOut: true });
      t('un timeout se dice como timeout', await cs(run, { pattern: 'x', path: dir }), 'error: search timed out (pattern too broad or tree too large)');
      responde({ out: '{"ok":true,"resul', cortado: true });
      t('una respuesta que no entró no es una falla del worker', await cs(run, { pattern: 'x', path: dir }),
        'error: search returned too much to read back — narrow it with `path`, `glob` or a smaller `max_results`');
      responde({ ok: false, code: 1, out: '', err: 'se rompió el worker' });
      t('una salida que no es JSON es una falla, con su stderr', await cs(run, { pattern: 'x', path: dir }), 'error: search failed — se rompió el worker');
      responde({ ok: false, code: 1, out: '' });
      t('y sin stderr, sin adornos', await cs(run, { pattern: 'x', path: dir }), 'error: search failed');
      responde({ out: JSON.stringify({ ok: false, error: 'boom' }) });
      t('un error que el worker reporta llega tal cual', await cs(run, { pattern: 'x', path: dir }), 'error: boom');

      // El walk se corta a los 5000 archivos: cero resultados con el árbol a
      // medio caminar NO es "No matches".
      responde({ out: json({ walkCapped: true, filesWalked: 5000 }) });
      t('cero resultados con el walk cortado avisa que no terminó de mirar', await cs(run, { pattern: 'x', path: dir }),
        `No matches for "x" in the first 5000 files under ${dir} — the walk stopped at its 5000-file cap, so the tree was NOT fully searched. This is not proof the pattern is absent: narrow it with \`path\` or \`glob\` and search again.`);
      responde({ out: json({ results: ['a.js:1: x'], walkCapped: true, filesWalked: 5000 }) });
      t('con resultados y el walk cortado, lo dice en el encabezado', await cs(run, { pattern: 'x', path: dir }),
        `1 result (walk stopped at the first 5000 files) under ${dir}:\na.js:1: x`);
      responde({ out: json({ results: ['a.js:1: x', 'b.js:2: x'], truncated: true, walkCapped: true, filesWalked: 5000 }) });
      t('y las dos notas juntas', (await cs(run, { pattern: 'x', path: dir })).split('\n')[0],
        `2 results (truncated at limit; walk stopped at the first 5000 files) under ${dir}:`);

      // Lo que ve el modelo sigue teniendo el tope del shell.
      const muchas = Array.from({ length: 1000 }, (_, i) => `archivo-${i}.js:${i}: ${'x'.repeat(100)}`);
      responde({ out: json({ results: muchas, truncated: true }) });
      const largo = await cs(run, { pattern: 'x', path: dir });
      ok_('una lista enorme se recorta para el modelo', largo.length < 8100 && /chars omitted/.test(largo), `largo=${largo.length}`);
      ok_('  y conserva el encabezado', largo.startsWith(`1000 results (truncated at limit) under ${dir}:`), largo.slice(0, 80));
    } finally {
      search.configurar({ runProc: shell.runProc });
    }
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  deVerdad();
  base.setCwd(os.homedir());
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (failures.length) {
  console.error(`test-blackcode-tools-shell: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-shell: ok (${hechas} comprobaciones: cableado, cierre de la promesa, Stop y timeout, cota de la salida, runProc, cwd por corrida, procesos de verdad, code_search)`);
process.exit(0);
