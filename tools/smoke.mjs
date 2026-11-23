// Humo: arranca la vitrina de verdad, espera a que la ventana esté en su
// lugar con el contenido entrado, mide lo que se ve y sale.
// Deja el informe y una captura en .smoke/.
// Uso: node tools/smoke.mjs
//
// Lo que NO puede medir: el flash del compositor al arrancar. No sale en
// ninguna captura; se juzga a ojo, en vivo y en frío.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron'); // en node pelado devuelve la ruta del ejecutable
const OUT = path.join(ROOT, '.smoke', 'showcase.json');
const SHOT = path.join(ROOT, '.smoke', 'showcase.png');
const TIMEOUT_MS = 30000;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(OUT, { force: true });

const env = { ...process.env, RAD_SMOKE: OUT, RAD_SMOKE_SHOT: SHOT };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(ROOT, 'apps', 'showcase')], { env, stdio: 'inherit' });
const killer = setTimeout(() => { console.error('smoke: tiempo agotado, mato el proceso'); child.kill(); }, TIMEOUT_MS);

child.on('exit', (code) => {
  clearTimeout(killer);
  if (!fs.existsSync(OUT)) {
    console.error(`smoke: FALLA, la app salió (código ${code}) sin dejar informe`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (report.ok && code === 0) {
    console.log(`smoke: ok  ventana ${report.size.width}x${report.size.height} en (${report.bounds.x}, ${report.bounds.y}), captura en ${path.relative(ROOT, SHOT)}`);
    process.exit(0);
  }
  console.error(`smoke: FALLA (código ${code})`);
  for (const f of report.failures || []) console.error('  ' + f);
  process.exit(1);
});
