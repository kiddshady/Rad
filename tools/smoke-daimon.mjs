// Humo de Daimon: arranca la app de verdad, la usa y mide lo que se ve. Dos
// pasadas sobre la misma carpeta de datos descartable (RAD_DATA):
//   1. el guion completo (tools/smoke-daimon.js): crear un agente, crear un
//      chat, mandar un mensaje, ver llegar la respuesta de a poco, frenarla,
//      renombrar y borrar un chat, guardar las llaves, y un agente de Venice;
//   2. Daimon vuelve a abrir: los agentes, los chats, los mensajes y la llave
//      tienen que estar como se dejaron.
// Corre contra el proveedor simulado (DAIMON_PROVEEDOR=simulado): no toca la
// red ni gasta un token. La llave que se guarda es de mentira, y al final se
// revisa el disco: no puede aparecer en claro en ningún archivo.
// Deja los informes y las capturas en .smoke/.
// Uso: node tools/smoke-daimon.mjs [--exe <ruta>]

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
const SCRIPT = path.join(ROOT, 'tools', 'smoke-daimon.js');
const TIMEOUT_MS = 90000;
// Las mismas que escribe el guion en Ajustes, una por proveedor. No son
// llaves: son textos con su forma, para comprobar que lo que se guarda no
// queda en claro.
const LLAVES_DE_PRUEBA = ['sk-ant-api03-humo-de-daimon-no-es-una-llave-0000', 'venice-humo-de-daimon-no-es-una-llave-1111'];

const exeArg = process.argv.indexOf('--exe');
const EXE = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
if (EXE && !fs.existsSync(EXE)) {
  console.error(`smoke: no existe ${EXE} (¿falta npm run pack -w daimon?)`);
  process.exit(1);
}
const TAG = EXE ? 'empaquetada-' : '';
const command = EXE ? [EXE, []] : [electron, [path.join(ROOT, 'apps', 'Daimon')]];

fs.mkdirSync(SMOKE, { recursive: true });

function run(pass, data) {
  const out = path.join(SMOKE, `daimon-${TAG}${pass}.json`);
  const shot = path.join(SMOKE, `daimon-${TAG}${pass}.png`);
  fs.rmSync(out, { force: true });
  const env = {
    ...process.env,
    RAD_SMOKE: out,
    RAD_SMOKE_SHOT: shot,
    RAD_SMOKE_SCRIPT: SCRIPT,
    RAD_SMOKE_QUIT: 'close', // por el cierre normal: lo pendiente baja en before-quit
    RAD_DATA: data,
    DAIMON_PROVEEDOR: 'simulado',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(command[0], command[1], { env, stdio: 'inherit' });
    const killer = setTimeout(() => { console.error(`smoke: daimon, pasada ${pass}: tiempo agotado, mato el proceso`); child.kill(); }, TIMEOUT_MS);
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
    console.log(`smoke: daimon, pasada ${pass} ok  ventana ${report.size.width}x${report.size.height}, captura en ${report.shot}`);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  } else {
    console.error(`smoke: daimon, pasada ${pass} FALLA`);
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
    if (LLAVES_DE_PRUEBA.some((k) => text.includes(k))) failures.push(`una llave quedó en claro en ${f}`);
  }
  for (const doc of ['_llave.json', '_llave_venice.json']) {
    if (!files.includes(doc)) failures.push(`una llave no se guardó (falta ${doc})`);
  }
  const borrado = report.script?.chatBorrado;
  if (!borrado) failures.push('el guion no dijo qué chat borró');
  else if (files.some((f) => f.startsWith(`chat-${borrado}.`))) failures.push(`el documento del chat borrado sigue en el disco: ${files.filter((f) => f.startsWith(`chat-${borrado}.`)).join(', ')}`);
  return failures;
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-daimon-'));
let ok = false;
try {
  const first = await run(1, data);
  if (first.ok) {
    const disk = checkDisk(data, first);
    if (disk.length) { first.ok = false; first.failures = disk; }
  }
  show(1, first);
  if (first.ok) {
    const second = await run(2, data);
    show(2, second);
    ok = second.ok;
  }
} finally {
  fs.rmSync(data, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
