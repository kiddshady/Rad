// Test de la terminal del panel de BlackCode (apps/BlackCode/main/terminal.cjs)
// con node pelado. Uso: node tools/test-blackcode-terminal.mjs
//
// Lo que se prueba es lo que se rompe en silencio (viene de
// scripts/test-terminal.js de NeonCode 1.11.3):
//   1. Arrancar la shell EQUIVOCADA. El profile del usuario es el de
//      PowerShell 7: si esto lanza powershell.exe (5.1), la terminal abre
//      igual, se ve igual, y el profile simplemente no está.
//   2. Pasarle -NoProfile, -NonInteractive o -Command. Mismo síntoma.
//   3. El reinicio: el aviso de que terminó la shell VIEJA llega cuando la
//      nueva ya está andando, y no puede llevársela puesta.
// Y lo que es de BlackCode: que ninguna tool del agente llegue a este módulo,
// y que xterm viaje adaptado a la CSP en vez de aflojarla.
//
// La shell de las pruebas en vivo es cmd.exe, nunca la del usuario: su profile
// no se carga acá.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const { Terminal, resolveShell, SHELL_ARGS, PS7, wire } = require(path.join(APP, 'main', 'terminal.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

// Un PTY de mentira: anota lo que le piden y deja disparar sus avisos a mano.
function ptyDeMentira() {
  const lanzados = [];
  return {
    lanzados,
    spawn(file, args, opciones) {
      const p = {
        file, args, opciones, escrito: [], medidas: [], muerto: false,
        onData(fn) { p.alDato = fn; },
        onExit(fn) { p.alSalir = fn; },
        write(d) { p.escrito.push(d); },
        resize(c, r) { p.medidas.push([c, r]); },
        kill() { p.muerto = true; },
      };
      lanzados.push(p);
      return p;
    },
  };
}

// ---------- 1. la shell elegida ----------
if (WIN) {
  const con = (rutas) => (p) => rutas.includes(p);
  const a = resolveShell({ PATH: '' }, con([PS7[0]]));
  ok('elige pwsh 7 cuando está instalado', a.kind === 'pwsh' && a.file === PS7[0], JSON.stringify(a));
  const otro = path.join('D:\\herramientas', 'pwsh.exe');
  const b = resolveShell({ PATH: `C:\\nada;D:\\herramientas` }, con([otro]));
  ok('si no está en Archivos de programa, lo busca en el PATH', b.kind === 'pwsh' && b.file === otro, JSON.stringify(b));
  const c = resolveShell({ PATH: 'C:\\nada' }, () => false);
  ok('sin PowerShell 7 cae a powershell.exe', c.kind === 'powershell' && c.file === 'powershell.exe', JSON.stringify(c));
  ok('PS7 se busca antes que el PATH', resolveShell({ PATH: 'D:\\herramientas' }, con([PS7[0], otro])).file === PS7[0]);
  ok('una carpeta ilegible del PATH no lo tumba', resolveShell({ PATH: 'C:\\x' }, () => { throw new Error('sin permiso'); }).kind === 'powershell');
  for (const s of [a, b, c]) ok(`los argumentos de ${s.kind} son los de la casa`, s.args === SHELL_ARGS);
}
// ---------- 2. los argumentos ----------
ok('NO pasa -NoProfile (si no, el profile no carga)', !SHELL_ARGS.includes('-NoProfile'), SHELL_ARGS.join(' '));
ok('NO pasa -NonInteractive (mataría los prompts)', !SHELL_ARGS.includes('-NonInteractive'), SHELL_ARGS.join(' '));
ok('NO pasa -Command (la volvería de una sola vez)', !SHELL_ARGS.includes('-Command'), SHELL_ARGS.join(' '));
ok('pasa -NoLogo', SHELL_ARGS.includes('-NoLogo'), SHELL_ARGS.join(' '));

// ---------- 3. arrancar ----------
const shellFija = () => ({ file: 'la-shell', kind: 'pwsh', args: ['-NoLogo'] });
{
  const pty = ptyDeMentira();
  let pedido = 0;
  const t = new Terminal({ pty, elegir: shellFija, getCwd: () => { pedido++; return ROOT; } });
  ok('la carpeta se pide al arrancar, no al construir', pedido === 0 && !t.alive && t.info() === null);
  const info = t.start({ cols: 100, rows: 30 });
  ok('arrancar consulta la carpeta compartida', pedido === 1, `la pidió ${pedido} veces`);
  ok('la sesión dice qué shell y dónde', info.shell === 'pwsh' && info.file === 'la-shell' && info.cwd === ROOT, JSON.stringify(info));
  const p = pty.lanzados[0];
  ok('lanza esa shell con sus argumentos', p.file === 'la-shell' && p.args.join(' ') === '-NoLogo');
  ok('con el tamaño del panel', p.opciones.cols === 100 && p.opciones.rows === 30 && p.opciones.cwd === ROOT);
  ok('y avisa que hay color', p.opciones.env.TERM === 'xterm-256color' && p.opciones.env.COLORTERM === 'truecolor' && p.opciones.env.FORCE_COLOR === '1' && p.opciones.name === 'xterm-256color');
  ok('hereda el entorno del usuario', p.opciones.env.PATH === process.env.PATH || p.opciones.env.Path === process.env.Path);
  ok('arrancar dos veces no lanza dos shells', t.start({ cols: 80, rows: 24 }).file === 'la-shell' && pty.lanzados.length === 1);
  t.kill();
}
{
  const pty = ptyDeMentira();
  const t = new Terminal({ pty, elegir: shellFija, getCwd: () => path.join(ROOT, 'no-existe-esta-carpeta') });
  ok('una carpeta que ya no existe: arranca en la del usuario', t.start().cwd === os.homedir(), String(t.info()?.cwd));
  const t2 = new Terminal({ pty, elegir: shellFija, getCwd: () => null });
  ok('sin carpeta: arranca en la del usuario', t2.start().cwd === os.homedir());
  ok('sin medidas: 80 por 24', pty.lanzados[1].opciones.cols === 80 && pty.lanzados[1].opciones.rows === 24);
  const t3 = new Terminal({ pty, elegir: shellFija, getCwd: () => ROOT });
  t3.start({ cols: 0, rows: 0 });
  ok('nunca lanza con 0 filas o columnas (ConPTY se cae)', pty.lanzados[2].opciones.cols === 2 && pty.lanzados[2].opciones.rows === 1);
}

// ---------- 4. lo que va y lo que viene ----------
{
  const pty = ptyDeMentira();
  const datos = [];
  const salidas = [];
  const t = new Terminal({ pty, elegir: shellFija, getCwd: () => ROOT, onData: (d) => datos.push(d), onExit: (d) => salidas.push(d) });
  t.write('antes de arrancar');
  t.resize(10, 10);
  ok('escribir o medir sin shell no hace nada (ni se cae)', pty.lanzados.length === 0);
  t.start();
  const p = pty.lanzados[0];
  t.write('dir\r');
  t.write(42);
  t.write(null);
  ok('lo tecleado va a la shell, y solo si es texto', p.escrito.length === 1 && p.escrito[0] === 'dir\r');
  t.resize(120, 40);
  t.resize(0, 0);
  ok('medir llega a la shell, nunca con 0', JSON.stringify(p.medidas) === '[[120,40],[2,1]]', JSON.stringify(p.medidas));
  p.resize = () => { throw new Error('ya se fue'); };
  t.resize(90, 20);
  ok('medir una shell que se fue no tumba nada', true);
  p.alDato('hola');
  ok('lo que escribe la shell sale por onData', datos.join('') === 'hola');

  // el reinicio: el aviso de la vieja llega tarde
  t.restart({ cols: 90, rows: 20 });
  const nueva = pty.lanzados[1];
  ok('reiniciar mata la vieja y lanza otra', p.muerto && pty.lanzados.length === 2 && t.alive);
  p.alSalir({ exitCode: 1 });
  p.alDato('un resto de la vieja');
  ok('el final de la shell VIEJA no se lleva puesta a la nueva', t.alive && t.info()?.file === 'la-shell' && salidas.length === 0, JSON.stringify(salidas));
  ok('ni sus restos se escriben en la nueva', datos.join('') === 'hola');
  nueva.alDato(' mundo');
  ok('la nueva sí escribe', datos.join('') === 'hola mundo');

  // matar a mano no avisa; que termine sola, sí
  nueva.alSalir({ exitCode: 3 });
  ok('si la shell termina sola, avisa con su código', !t.alive && t.info() === null && salidas.length === 1 && salidas[0].code === 3, JSON.stringify(salidas));
  t.start();
  const tercera = pty.lanzados[2];
  t.kill();
  tercera.alSalir({ exitCode: 0 });
  ok('matarla a mano no avisa que terminó', tercera.muerto && !t.alive && salidas.length === 1);
  t.kill();
  ok('matar dos veces no hace nada', true);
}

// ---------- 5. los canales ----------
{
  const canales = new Map();
  const enviados = [];
  const alSalir = [];
  const rad = { handle: (c, fn) => canales.set(c, fn), send: (c, d) => enviados.push([c, d]) };
  const app = { on: (ev, fn) => { if (ev === 'before-quit') alSalir.push(fn); } };
  const pty = ptyDeMentira();
  const ventana = { window: {} }; // lo que el núcleo agrega al final de cada pedido
  const t = wire(rad, { getCwd: () => ROOT, pty, app, deMentira: true });
  ok('atiende los cuatro canales del panel, y ninguno más', [...canales.keys()].sort().join() === 'term:input,term:resize,term:restart,term:start');
  const r = canales.get('term:start')({ cols: 90, rows: 25 }, ventana);
  ok('term:start contesta ok con la shell', r.ok === true && r.shell === 'cmd' && r.cwd === ROOT, JSON.stringify(r));
  ok('en el humo la shell no es la del usuario', pty.lanzados[0].file === (WIN ? 'cmd.exe' : '/bin/sh') && pty.lanzados[0].args.length === 0);
  ok('sin tamaño (llega solo la ventana) no se cae', canales.get('term:start')(ventana).ok === true && pty.lanzados.length === 1);
  canales.get('term:input')('ls\r', ventana);
  canales.get('term:input')({ no: 'texto' }, ventana);
  ok('term:input pasa solo texto', pty.lanzados[0].escrito.join('|') === 'ls\r|');
  canales.get('term:resize')({ cols: 70, rows: 18 }, ventana);
  ok('term:resize mide la shell', JSON.stringify(pty.lanzados[0].medidas) === '[[70,18]]');
  pty.lanzados[0].alDato('salida');
  ok('lo que sale va al renderer por term:data', JSON.stringify(enviados) === '[["term:data","salida"]]');
  const r2 = canales.get('term:restart')({ cols: 80, rows: 24 }, ventana);
  ok('term:restart lanza otra', r2.ok === true && pty.lanzados.length === 2 && pty.lanzados[0].muerto);
  pty.lanzados[1].alSalir({ exitCode: 7 });
  ok('y el final va por term:exit', JSON.stringify(enviados.at(-1)) === '["term:exit",{"code":7}]');
  canales.get('term:start')({}, ventana);
  ok('al salir de la app, la shell se mata', alSalir.length === 1 && (alSalir[0](), pty.lanzados.at(-1).muerto && !t.alive));

  // un binario nativo roto: se dice, no se cae la app
  const rotos = new Map();
  wire({ handle: (c, fn) => rotos.set(c, fn), send() {} }, { getCwd: () => ROOT, app, pty: { spawn() { throw new Error('no carga conpty.node'); } } });
  const mal = rotos.get('term:start')({ cols: 80, rows: 24 }, ventana);
  ok('si el PTY no carga, contesta el error en vez de tirar', mal.ok === false && /conpty/.test(mal.error), JSON.stringify(mal));
  ok('y reiniciar tampoco tira', rotos.get('term:restart')({}, ventana).ok === false);
}

// ---------- 6. en vivo: un PTY de verdad ----------
if (WIN) {
  let salida = '';
  const fin = [];
  const t = new Terminal({ elegir: () => ({ file: 'cmd.exe', kind: 'cmd', args: [] }), getCwd: () => ROOT, onData: (d) => { salida += d; }, onExit: (d) => fin.push(d) });
  let info = null;
  try { info = t.start({ cols: 100, rows: 30 }); } catch (err) { failures.push(`[en vivo] el PTY no cargó: ${err.message}`); }
  if (info) {
    ok('[en vivo] el módulo nativo carga y lanza una shell', t.alive && info.shell === 'cmd');
    for (let i = 0; i < 100 && !/>\s*$/.test(salida.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')); i++) await sleep(50);
    t.write('echo %OS%-marca\r');
    for (let i = 0; i < 100 && !salida.includes('Windows_NT-marca'); i++) await sleep(50);
    ok('[en vivo] lo tecleado corre y la salida vuelve', salida.includes('Windows_NT-marca'), JSON.stringify(salida.slice(-160)));
    ok('[en vivo] arranca en la carpeta pedida', salida.toLowerCase().includes(ROOT.toLowerCase()), JSON.stringify(salida.slice(0, 300)));
    t.resize(60, 20);
    t.write('exit\r');
    for (let i = 0; i < 100 && !fin.length; i++) await sleep(50);
    ok('[en vivo] salir de la shell avisa con su código', fin.length === 1 && fin[0].code === 0 && !t.alive, JSON.stringify(fin));
    t.kill();
  }
}

// ---------- 7. nadie más llega a la shell ----------
{
  const tools = path.join(APP, 'main', 'tools');
  const fuentes = fs.readdirSync(tools, { recursive: true }).filter((f) => /\.cjs$/.test(String(f))).map((f) => [String(f), fs.readFileSync(path.join(tools, String(f)), 'utf8')]);
  ok('hay tools que mirar', fuentes.length > 15, String(fuentes.length));
  const llegan = fuentes.filter(([, s]) => /terminal\.cjs|['"`]term:|node-pty/.test(s)).map(([f]) => f);
  ok('ninguna tool del agente toca la terminal del panel', llegan.length === 0, llegan.join(', '));
  const quien = fs.readdirSync(path.join(APP, 'main')).filter((f) => f.endsWith('.cjs')).filter((f) => /terminal\.cjs/.test(fs.readFileSync(path.join(APP, 'main', f), 'utf8')));
  ok('solo chat.cjs la cablea', quien.join() === 'chat.cjs', quien.join());
}

// ---------- 8. xterm viaja adaptado a la CSP, y la CSP no se aflojó ----------
{
  const html = fs.readFileSync(path.join(APP, 'renderer', 'index.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  ok('la CSP no deja estilos ni scripts en línea', /style-src 'self'(;|$)/.test(csp) && /script-src 'self'(;|$)/.test(csp) && !csp.includes('unsafe'), csp);
  const vendor = path.join(APP, 'renderer', 'vendor', 'xterm');
  const modulo = fs.readFileSync(path.join(vendor, 'xterm.mjs'), 'utf8');
  ok('el xterm copiado no crea <style>', !modulo.includes('createElement("style")') && modulo.split('createElement("dm-estilo")').length === 4);
  ok('ni pone estilos por atributo', !modulo.includes('setAttribute("style"') && modulo.includes('t.style.setProperty(e.slice(0,i),e.slice(i+1))'));
  ok('ni arma HTML con texto', !modulo.includes('.innerHTML=') && !modulo.includes('insertAdjacentHTML'));
  const versiones = fs.readFileSync(path.join(vendor, 'VERSION'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok('la versión copiada es la fijada en el package.json', versiones.includes(`@xterm/xterm ${pkg.devDependencies['@xterm/xterm']}`) && versiones.includes(`@xterm/addon-fit ${pkg.devDependencies['@xterm/addon-fit']}`), versiones.trim());
  ok('viaja con su licencia', fs.existsSync(path.join(vendor, 'LICENSE')));
  const panel = fs.readFileSync(path.join(APP, 'renderer', 'terminal.js'), 'utf8');
  ok('el panel define <dm-estilo>', panel.includes("customElements.define('dm-estilo'"));
  ok('el cursor es un bloque, del blanco de la app', /cursorStyle: 'block'/.test(panel) && /cursor: blanco/.test(panel) && /const blanco = t\('text-1'/.test(panel));
  ok('el PTY se desempaqueta del asar (sus .exe y .dll se lanzan desde el disco)', pkg.build.asarUnpack.includes('node_modules/@lydell/**/*') && typeof pkg.dependencies['@lydell/node-pty'] === 'string');
}

if (failures.length) {
  console.error(`test-blackcode-terminal: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-terminal: ok (${hechas} comprobaciones: la shell elegida y sus argumentos, arrancar, lo que va y viene, el reinicio que no se lleva puesta a la nueva, los canales, un PTY de verdad con cmd, que ninguna tool llegue a la shell, y xterm adaptado a la CSP)`);
process.exit(0);
