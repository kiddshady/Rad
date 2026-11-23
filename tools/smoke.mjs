// Humo: arranca la vitrina de verdad, mide lo que se ve y sale. Dos pasadas
// sobre la misma carpeta de datos descartable (RAD_DATA), para probar lo que
// sobrevive al cierre:
//   1. el guion completo (fundidos, capas, etc.), escribe una nota y la
//      ventana se mueve a un lugar conocido;
//   2. la vitrina vuelve a abrir: la nota, las visitas y el lugar de la
//      ventana tienen que estar como se dejaron.
// Deja los informes y las capturas en .smoke/.
// Uso: node tools/smoke.mjs
//
// Lo que NO puede medir: el flash del compositor al arrancar. No sale en
// ninguna captura; se juzga a ojo, en vivo y en frío.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron'); // en node pelado devuelve la ruta del ejecutable
const SMOKE = path.join(ROOT, '.smoke');
const SCRIPT = path.join(ROOT, 'tools', 'smoke-showcase.js');
const TIMEOUT_MS = 60000;
const MOVE = { x: 140, y: 110, width: 1000, height: 700 };

fs.mkdirSync(SMOKE, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-smoke-'));

function run(pass, extraEnv = {}) {
  const out = path.join(SMOKE, `showcase-${pass}.json`);
  const shot = path.join(SMOKE, pass === 1 ? 'showcase.png' : `showcase-${pass}.png`);
  fs.rmSync(out, { force: true });
  const env = { ...process.env, RAD_SMOKE: out, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: SCRIPT, RAD_DATA: data, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(ROOT, 'apps', 'showcase')], { env, stdio: 'inherit' });
    const killer = setTimeout(() => { console.error(`smoke: pasada ${pass}: tiempo agotado, mato el proceso`); child.kill(); }, TIMEOUT_MS);
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
    console.log(`smoke: pasada ${pass} ok  ventana ${report.size.width}x${report.size.height} en (${report.bounds.x}, ${report.bounds.y}), captura en ${report.shot}`);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  } else {
    console.error(`smoke: pasada ${pass} FALLA`);
    for (const f of report.failures || []) console.error('  ' + f);
  }
};

// La primera sale por el cierre normal: lo último que guardó tiene que bajar
// al disco en before-quit.
const first = await run(1, { RAD_SMOKE_MOVE: JSON.stringify(MOVE), RAD_SMOKE_QUIT: 'close' });
show(1, first);
if (!first.ok) process.exit(1);

// La segunda, además, con la mono elegida por la app en vez de la de la piel.
const second = await run(2, { RAD_SHOWCASE_MONO: 'roboto-mono' });
const b = second.bounds || {};
if (second.ok && (b.x !== MOVE.x || b.y !== MOVE.y || b.width !== MOVE.width || b.height !== MOVE.height)) {
  second.ok = false;
  second.failures = [`la ventana no volvió a su lugar: ${JSON.stringify(b)}, se había dejado en ${JSON.stringify(MOVE)}`];
}
show(2, second);

fs.rmSync(data, { recursive: true, force: true });
process.exit(second.ok ? 0 : 1);
