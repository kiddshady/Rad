// Humo de Nix: arranca la app de verdad, la usa y mide lo que se ve. Dos
// pasadas sobre la misma carpeta de datos descartable (RAD_DATA):
//   1. el guion completo (tools/smoke-nix.js): crear un agente, crear un
//      chat, mandar un mensaje, ver llegar la respuesta de a poco, frenarla,
//      renombrar y borrar un chat, guardar las llaves, y un agente de Venice;
//   2. Nix vuelve a abrir: los agentes, los chats, los mensajes y la llave
//      tienen que estar como se dejaron.
// Corre contra el proveedor simulado (NIX_PROVEEDOR=simulado): no toca la
// red ni gasta un token. La llave que se guarda es de mentira, y al final se
// revisa el disco: no puede aparecer en claro en ningún archivo.
// Deja los informes y las capturas en .smoke/.
// Uso: node tools/smoke-nix.mjs [--exe <ruta>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const SMOKE = path.join(ROOT, '.smoke');
const SCRIPT = path.join(ROOT, 'tools', 'smoke-nix.js');
// RAD_SMOKE_TIMEOUT (ms) lo estira y RAD_SMOKE_KEEP=1 deja la carpeta de datos
// para mirarla: las dos son para depurar un guion que se cuelga.
const TIMEOUT_MS = Number(process.env.RAD_SMOKE_TIMEOUT) || 240000;
// Todas las llaves que escribe el guion en Ajustes llevan esta marca. No son
// llaves: son textos con su forma, para comprobar que lo que se guarda no
// queda en claro.
const MARCA_DE_LLAVE = 'no-es-una-llave';

const exeArg = process.argv.indexOf('--exe');
const EXE = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
if (EXE && !fs.existsSync(EXE)) {
  console.error(`smoke: no existe ${EXE} (¿falta npm run pack -w nix?)`);
  process.exit(1);
}
const TAG = EXE ? 'empaquetada-' : '';
const command = EXE ? [EXE, []] : [electron, [path.join(ROOT, 'apps', 'Nix')]];

fs.mkdirSync(SMOKE, { recursive: true });

function run(pass, data) {
  const out = path.join(SMOKE, `nix-${TAG}${pass}.json`);
  const shot = path.join(SMOKE, `nix-${TAG}${pass}.png`);
  fs.rmSync(out, { force: true });
  const env = {
    ...process.env,
    RAD_SMOKE: out,
    RAD_SMOKE_SHOT: shot,
    RAD_SMOKE_SCRIPT: SCRIPT,
    RAD_SMOKE_QUIT: 'close', // por el cierre normal: lo pendiente baja en before-quit
    RAD_DATA: data,
    NIX_PROVEEDOR: 'simulado',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(command[0], command[1], { env, stdio: 'inherit' });
    const killer = setTimeout(() => { console.error(`smoke: nix, pasada ${pass}: tiempo agotado, mato el proceso`); child.kill(); }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(killer);
      if (!fs.existsSync(out)) return resolve({ ok: false, failures: [`la app salió (código ${code}) sin dejar informe`] });
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      report.ok = report.ok && code === 0;
      report.shot = path.relative(ROOT, shot);
      resolve(report);
    });
  });
}

const show = (pass, report) => {
  if (report.ok) {
    console.log(`smoke: nix, pasada ${pass} ok  ventana ${report.size.width}x${report.size.height}, captura en ${report.shot}`);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  } else {
    console.error(`smoke: nix, pasada ${pass} FALLA`);
    for (const f of report.failures || []) console.error('  ' + f);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.error(`  (dato) ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
};

// Lo que el guion no puede ver desde la página: el disco.
function checkDisk(data, report) {
  const dir = path.join(data, 'data');
  const failures = [];
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (text.includes(MARCA_DE_LLAVE)) failures.push(`una llave quedó en claro en ${f}`);
  }
  for (const doc of ['_llave.json', '_llave_venice.json']) {
    if (!files.includes(doc)) failures.push(`una llave no se guardó (falta ${doc})`);
  }
  // Las tools del humo trabajaron en <datos>/workspace: lo que quedó en el
  // disco tiene que ser lo que el guion aprobó, y nada de lo que rechazó.
  const taller = path.join(data, 'workspace');
  const leer = (f) => { try { return fs.readFileSync(path.join(taller, f), 'utf8'); } catch { return null; } };
  if (leer('note.txt') !== 'one\n2\n') failures.push(`note.txt quedó como ${JSON.stringify(leer('note.txt'))}: se esperaba la edición aprobada y no la rechazada`);
  if (leer('auto.txt') !== 'auto\n') failures.push(`auto.txt quedó como ${JSON.stringify(leer('auto.txt'))}`);
  if (leer('x.txt') !== null) failures.push('una llamada con argumentos incompletos escribió un archivo');
  // os_open, en el humo, anota lo que habría abierto en vez de abrirlo.
  if (!/^open .*note\.txt$/m.test(leer('.opened.log') ?? '')) failures.push(`os_open no pidió abrir note.txt: ${JSON.stringify(leer('.opened.log'))}`);
  if (!fs.existsSync(path.join(taller, 'agent.db'))) failures.push('la base propia del agente no quedó en el disco');
  if (!fs.existsSync(path.join(taller, 'code-workspace', 'out.txt'))) failures.push('run_code no dejó su archivo en el taller');
  const borrado = report.script?.chatBorrado;
  if (!borrado) failures.push('el guion no dijo qué chat borró');
  else if (files.some((f) => f.startsWith(`chat-${borrado}.`))) failures.push(`el documento del chat borrado sigue en el disco: ${files.filter((f) => f.startsWith(`chat-${borrado}.`)).join(', ')}`);
  return failures;
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-nix-'));
let ok = false;
try {
  const first = await run(1, data);
  if (first.ok) {
    const disk = checkDisk(data, first);
    // Buscar una actualización: abierta desde el repo no hay updater; la
    // empaquetada le pregunta a GitHub de verdad, y cualquiera de las tres
    // respuestas vale (al día, hay una nueva, o no se pudo: sin red, o el
    // repo de releases todavía sin esa versión).
    const fase = first.script?.actualizacion;
    const valen = EXE ? ['al-dia', 'disponible', 'error'] : ['sin-soporte'];
    if (!valen.includes(fase)) disk.push(`buscar una actualización terminó en «${fase}» (${first.script?.actualizacionDice ?? ''}); ${EXE ? 'empaquetada' : 'desde el repo'} se esperaba: ${valen.join(', ')}`);
    if (disk.length) { first.ok = false; first.failures = disk; }
  }
  show(1, first);
  if (first.ok) {
    const second = await run(2, data);
    show(2, second);
    ok = second.ok;
  }
} finally {
  if (process.env.RAD_SMOKE_KEEP) console.log(`smoke: nix, los datos quedaron en ${data}`);
  else fs.rmSync(data, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
