'use strict';

// La terminal del panel: una shell de verdad, con PTY, para que la maneje el
// usuario tecleando. De NeonCode 1.11.3 (terminal.js), con sus razones.
//
// NO CONFUNDIR con shell_exec y cmd_exec (main/tools/shell.cjs). Aquellas son
// las tools del modelo: de una sola vez, por pipes, con tiempo límite, y
// pasando por la tarjeta de permiso y las guardas. Esto es lo contrario en
// todo: una sesión viva, sin límite de tiempo, sin confirmación y con todos
// los permisos del usuario. Se banca porque **no hay ninguna tool registrada
// contra este módulo**. Si algún día se le expone al modelo, hay que rediseñar
// el permiso antes.
//
// Pero el modelo no es la única forma de llegar, y conviene tenerlo escrito:
// el puente valida que el pedido venga de la ventana de la app, no que lo
// haya tecleado una persona. Cualquier cosa que ejecute código en esa página
// llega a `term:input`, y de ahí a una shell con todos los permisos, sin
// tarjeta, sin guardas y sin sandbox: es el único camino de la app que no
// tiene ninguna de las tres. Lo que sostiene eso es que en la página no corre
// nada que no sea de la app: su CSP no deja scripts ni estilos en línea, el
// markdown se arma nodo por nodo (nunca con innerHTML de lo que escribe un
// modelo), y la página del navegador es otra capa, sin puente. Al tocar
// cualquiera de esas tres cosas, acordarse de que del otro lado hay una shell.
// (Por eso xterm viaja adaptado a la CSP en vez de aflojarla: ver
// scripts/vendor-xterm.mjs.)
//
// Por qué un PTY y no spawn con pipes: sin PTY no hay prompt vivo, ni colores,
// ni Ctrl+C, ni programas interactivos; sería un visor de salida, no una
// terminal. En Windows el PTY es ConPTY y hay que llegar por un módulo nativo.
//
// Por qué @lydell/node-pty y no el node-pty oficial: el oficial exige node-gyp
// y recompilar contra el ABI de Electron. Este trae binarios precompilados
// N-API, que es ABI-estable: el mismo .node sirve en node y en Electron.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// pwsh 7 primero, y no por gusto: el profile del usuario es el de PowerShell 7.
// En Windows PowerShell 5.1 (powershell.exe) no hay profile, así que arrancar
// ahí daría una shell pelada y parecería que «el profile no carga».
// powershell.exe queda de red de seguridad para una máquina sin PS7.
const PS7 = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
];

function resolveShell(env = process.env, existe = fs.existsSync) {
  if (process.platform !== 'win32') return { file: env.SHELL || '/bin/sh', kind: 'sh', args: [] };
  for (const p of PS7) {
    try { if (existe(p)) return { file: p, kind: 'pwsh', args: SHELL_ARGS }; } catch { /* sigue */ }
  }
  // pwsh instalado en otro lado: que lo resuelva el PATH
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'pwsh.exe');
    try { if (existe(p)) return { file: p, kind: 'pwsh', args: SHELL_ARGS }; } catch { /* sigue */ }
  }
  return { file: 'powershell.exe', kind: 'powershell', args: SHELL_ARGS };
}

// -NoLogo y nada más. Lo importante es lo que NO está:
//   -NoProfile       lo cargaría pelado, que es justo lo que no se quiere
//   -NonInteractive  mataría los prompts (Read-Host, confirmaciones)
//   -Command         la volvería de una sola vez en lugar de un REPL
const SHELL_ARGS = ['-NoLogo'];

class Terminal {
  // `onData` y `onExit` reenvían al renderer. `getCwd` es una función y no un
  // texto a propósito: la carpeta de trabajo que comparte con las tools se
  // mueve mientras la app corre, y al reiniciar la shell se quiere la de ese
  // momento. `elegir` devuelve la shell ({ file, kind, args }); `pty` es el
  // módulo nativo (los tests ponen el suyo).
  constructor({ onData, onExit, getCwd, elegir, pty } = {}) {
    this.onData = onData || (() => {});
    this.onExit = onExit || (() => {});
    this.getCwd = getCwd || (() => process.cwd());
    this.elegir = elegir || resolveShell;
    this.modulo = pty || null;
    this.pty = null;
    this.shell = null;
  }

  get alive() { return Boolean(this.pty); }

  // Idempotente: si ya hay una shell viva devuelve la que hay. El panel lo
  // llama cada vez que se abre, y abrir dos veces no tiene que duplicar nada.
  start({ cols = 80, rows = 24 } = {}) {
    if (this.pty) return this.info();

    // El require va acá adentro y no arriba del archivo para que un binario
    // nativo roto no se lleve puesto el arranque de la app entera: sin
    // terminal se puede seguir usando BlackCode, y el error se ve en el panel.
    const pty = this.modulo || require('@lydell/node-pty');
    const shell = this.elegir();
    let cwd = this.getCwd();
    try { if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir(); } catch { cwd = os.homedir(); }

    this.pty = pty.spawn(shell.file, shell.args ?? [], {
      name: 'xterm-256color',
      cols: Math.max(2, cols | 0),
      rows: Math.max(1, rows | 0),
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        // Que los programas que miran esto sepan que hay color. pwsh 7 ya emite
        // ANSI sobre ConPTY, pero varias CLIs de node se fijan en estas dos.
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
      },
    });
    this.shell = { file: shell.file, kind: shell.kind, cwd };

    // `mine` y la guarda de abajo NO están de más. El onExit de un pty llega
    // asincrónico y bastante después de matarlo, así que en un restart el
    // evento de la shell VIEJA aterriza cuando la nueva ya está andando: sin
    // la guarda le pone this.pty en null a la sesión recién nacida y le manda
    // al renderer un «terminó» sobre una shell que está viva.
    const mine = this.pty;
    this.pty.onData((d) => { if (this.pty === mine) this.onData(d); });
    this.pty.onExit(({ exitCode }) => {
      if (this.pty !== mine) return; // shell ya reemplazada o matada a mano
      this.pty = null;
      this.shell = null;
      this.onExit({ code: exitCode });
    });
    return this.info();
  }

  info() {
    return this.shell ? { shell: this.shell.kind, file: this.shell.file, cwd: this.shell.cwd } : null;
  }

  write(data) {
    if (this.pty && typeof data === 'string') this.pty.write(data);
  }

  resize(cols, rows) {
    if (!this.pty) return;
    // ConPTY se cae con 0 filas o columnas; el renderer manda medidas mientras
    // el panel todavía se está abriendo y ahí el alto puede ser 0.
    try { this.pty.resize(Math.max(2, cols | 0), Math.max(1, rows | 0)); } catch { /* la shell ya se fue */ }
  }

  // kill() no dispara onExit hacia el renderer: el que mata ya sabe que mató,
  // y en restart() el evento llegaría después de haber levantado la shell
  // nueva, pintando «terminó» sobre una sesión recién nacida.
  kill() {
    if (!this.pty) return;
    const p = this.pty;
    this.pty = null;
    this.shell = null;
    try { p.kill(); } catch { /* ya estaba muerta */ }
  }

  restart(size) {
    this.kill();
    return this.start(size);
  }
}

/**
 * Los canales del panel.
 *   getCwd     la carpeta de trabajo de ese momento (la de las tools)
 *   deMentira  el humo: una shell sin el profile de nadie (cmd.exe)
 *   pty, app   para los tests: el módulo nativo y la app de Electron
 * La shell arranca PEREZOSA, recién en el primer `term:start` (la primera vez
 * que se abre el panel): el profile del usuario pesa, y no hay por qué pagarlo
 * en el arranque de la app si la terminal no se abre nunca. Cerrar el panel no
 * la mata; se muere con la app o con el botón de reiniciar.
 */
function wire(rad, { getCwd, deMentira = false, pty = null, app = null } = {}) {
  const terminal = new Terminal({
    onData: (d) => rad.send('term:data', d),
    onExit: (d) => rad.send('term:exit', d),
    getCwd,
    pty,
    elegir: deMentira ? () => ({ file: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', kind: 'cmd', args: [] }) : resolveShell,
  });
  // (el último argumento de un canal es siempre { window }: por eso el tamaño se pide con `?.`)
  const intentar = (hacer) => {
    try { return { ok: true, ...hacer() }; } catch (err) {
      // el binario nativo puede faltar en una instalación rota: el panel lo
      // muestra en vez de dejar un rectángulo negro sin explicación
      return { ok: false, error: String(err?.message || err) };
    }
  };
  rad.handle('term:start', (size) => intentar(() => terminal.start({ cols: size?.cols, rows: size?.rows })));
  rad.handle('term:restart', (size) => intentar(() => terminal.restart({ cols: size?.cols, rows: size?.rows })));
  rad.handle('term:input', (data) => { terminal.write(typeof data === 'string' ? data : ''); });
  rad.handle('term:resize', (size) => { terminal.resize(size?.cols, size?.rows); });
  (app ?? require('electron').app).on('before-quit', () => terminal.kill());
  return terminal;
}

module.exports = { Terminal, resolveShell, SHELL_ARGS, PS7, wire };
