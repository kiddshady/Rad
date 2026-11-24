'use strict';

// Las tools de shell de Nix: shell_exec (PowerShell) y cmd_exec (cmd.exe), las
// dos sobre el mismo execShell, y runProc, el spawn genérico con los mismos
// límites que usan las tools que lanzan otros procesos (code_search lo usa para
// su worker).
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y algunos
// nombran partes de aquel archivo que acá no están (el gate de confirmación,
// `inflight`, runTool, runCode, splitMessage). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - resolveCwd, boundedSink, SHELL_MAX_CHARS y SHELL_MAX_TIMEOUT salen de
//     base.cjs en vez de ser vecinos del mismo archivo.
//   - `spawn` y `killTree` eran globales del archivo grande. Acá arrancan con
//     los de verdad (node:child_process y base.cjs) y configurar({ spawn,
//     killTree }) los cambia. Un test que ponga un `spawn` falso tiene que
//     poner TAMBIÉN un `killTree` falso: el de base.cjs llama al taskkill real
//     con el pid que le den.
//   - Los dos nombres de TOOL_RUNNERS (shell_exec y cmd_exec) son `runners`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const base = require('./base.cjs');

const { resolveCwd, boundedSink, SHELL_MAX_CHARS, SHELL_MAX_TIMEOUT } = base;

let spawn = require('node:child_process').spawn;
let killTree = base.killTree;

/** Lo que este módulo necesita de afuera. Todo es opcional: sin llamarla
 *  quedan el `spawn` de Node y el `killTree` de base.cjs. */
function configurar(deps = {}) {
  if (typeof deps.spawn === 'function') spawn = deps.spawn;
  if (typeof deps.killTree === 'function') killTree = deps.killTree;
}

function execShell(run, { command, cwd, timeout } = {}, kind) {
  const cmd = String(command || '').trim();
  if (!cmd) return Promise.resolve('error: command is required');
  let dir;
  try { dir = resolveCwd(run, cwd); } catch (err) { return Promise.resolve(`error: ${err.message}`); }
  run.notify('tool:activity', { reqId: run.reqId, kind, label: cmd });
  const ms = Math.min(Math.max((Number(timeout) || 30) * 1000, 1000), SHELL_MAX_TIMEOUT);

  return new Promise((resolve) => {
    const child = kind === 'cmd_exec'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `chcp 65001>nul && ${cmd}`], { cwd: dir, windowsHide: true })
      : spawn('powershell.exe',
          ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd}`],
          { cwd: dir, windowsHide: true });

    // El recorte pasó al listener (ver boundedSink), así que acá ya no hay un
    // truncateOut final: el sink es el ÚNICO que corta y es el único que sabe
    // cuánto pasó de largo. Encadenar los dos hacía que el aviso de "chars
    // omitted" contara sobre el texto ya recortado y anunciara treinta mil
    // cuando habían pasado millones — un número inventado, que es justo lo que
    // este archivo evita en el resto de sus mensajes.
    const out = boundedSink(SHELL_MAX_CHARS);
    const err = boundedSink(SHELL_MAX_CHARS);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));

    // Por qué se cortó a la fuerza, o null si terminó solo. Eran la MISMA
    // bandera (`timedOut`) para el reloj y para el Stop, así que apretar Stop a
    // los 2 segundos quedaba registrado como "timed out after 30s": la app
    // afirmaba un hecho que no pasó, y el modelo lo leía como tool_result en la
    // ronda siguiente. Son dos causas distintas y ahora se llaman distinto.
    let fin = null; // 'timeout' | 'abort'
    let cerrado = false;
    let timer = null;
    let gracia = null;

    const soltar = (texto) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      clearTimeout(gracia);
      run.ac.signal.removeEventListener('abort', onAbort);
      resolve(texto);
    };
    const cerrar = (code) => {
      if (cerrado) return;
      let text = out.text();
      const e = err.text();
      if (e.trim()) text += `\n[stderr]\n${e}`;
      if (fin === 'timeout') text += `\n[timed out after ${Math.round(ms / 1000)}s — process tree killed]`;
      else if (fin === 'abort') text += '\n[stopped by the user — process tree killed]';
      else if (code !== 0) text += `\n[exit code ${code}]`;
      text += `\n[cwd: ${dir}]`;
      soltar(text.trim() || '(no output)');
    };

    // Matar el árbol NO cierra la promesa. 'close' no se emite hasta que se
    // cierran todos los stdio del hijo, y un nieto que heredó el pipe de stdout
    // y sobrevivió al taskkill —huérfano porque el powershell padre ya salió, o
    // cualquier cosa que /T no alcance— lo mantiene abierto indefinidamente. El
    // tope de 120s era para el PROCESO, no para la promesa: el await de runTool
    // no volvía nunca, el turno quedaba colgado y su reqId vivo en `inflight`,
    // que es exactamente el desenlace que el gate de más arriba describe como
    // catastrófico (todas las tareas programadas mudas hasta reiniciar la app).
    // El Stop tampoco destrababa: también mataba sin resolver.
    //
    // Las dos formas de cortar a la fuerza terminan acá, y las dos CIERRAN.
    const rematar = (razon) => {
      if (cerrado || fin) return;
      fin = razon;
      killTree(child);
      // Segunda pasada por si la primera no llegó a todo, y ahí se cierra con lo
      // que se haya juntado. Si el 'close' llega antes gana él, que trae el exit
      // code de verdad.
      gracia = setTimeout(() => { killTree(child); cerrar(null); }, 500);
    };

    timer = setTimeout(() => rematar('timeout'), ms);
    const onAbort = () => rematar('abort');
    run.ac.signal.addEventListener('abort', onAbort, { once: true });
    // Un listener puesto sobre una señal YA abortada no dispara nunca: el evento
    // pasó antes de que existiera. Es el mismo caso que el gate de confirmación
    // resuelve arriba, y acá dejaba corriendo un hijo que nadie iba a matar.
    if (run.ac.signal.aborted) onAbort();

    child.on('error', (e) => {
      soltar(`error: could not start ${kind === 'cmd_exec' ? 'cmd.exe' : 'powershell.exe'} — ${e.message}`);
    });
    child.on('close', (code) => cerrar(code));
  });
}

// spawn genérico con los MISMOS límites que el shell: timeout + kill del árbol
// El gemelo de execShell: mismo spawn, mismo kill-tree, mismos tres defectos
// —la promesa que solo cerraba por 'close', el output sin cota y el Stop
// contado como timeout— y por eso mismo el arreglo es el mismo. Lo único propio
// de acá es que la salida vuelve en piezas (el llamador arma el texto) y que
// `maxChars` lo decide quien llama: runCode muestra su salida y le alcanza el
// tope del shell, code_search PARSEA la suya y necesita el JSON entero.
function runProc({ bin, args, cwd, env, timeoutMs, signal, maxChars = SHELL_MAX_CHARS }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd, env, windowsHide: true }); }
    catch (e) { resolve({ ok: false, code: -1, out: '', err: String(e.message || e), timedOut: false, aborted: false, cortado: false }); return; }
    const out = boundedSink(maxChars);
    const err = boundedSink(maxChars);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));

    let fin = null; // 'timeout' | 'abort' — el reloj y el Stop no son lo mismo
    let cerrado = false;
    let timer = null;
    let gracia = null;

    const soltar = (r) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      clearTimeout(gracia);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ...r, timedOut: fin === 'timeout', aborted: fin === 'abort', cortado: out.cortado || err.cortado });
    };
    const cerrar = (code) => soltar({ ok: code === 0, code, out: out.text(), err: err.text() });
    // ídem execShell: matar el árbol no cierra la promesa, y sin esto un nieto
    // con el stdout heredado dejaba el turno colgado para siempre
    const rematar = (razon) => {
      if (cerrado || fin) return;
      fin = razon;
      killTree(child);
      gracia = setTimeout(() => { killTree(child); cerrar(null); }, 500);
    };

    timer = setTimeout(() => rematar('timeout'), timeoutMs);
    const onAbort = () => rematar('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.on('error', (e) => soltar({ ok: false, code: -1, out: out.text(), err: `${err.text()}\n${e.message}` }));
    child.on('close', (code) => cerrar(code));
  });
}

const runners = {
  shell_exec: (run, a) => execShell(run, a, 'shell_exec'),
  cmd_exec: (run, a) => execShell(run, a, 'cmd_exec'),
};

module.exports = { runners, configurar, execShell, runProc };
