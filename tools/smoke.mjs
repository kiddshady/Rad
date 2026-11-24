// Humo: arranca la vitrina de verdad, mide lo que se ve y sale. Dos pasadas
// sobre la misma carpeta de datos descartable (RAD_DATA), para probar lo que
// sobrevive al cierre:
//   1. el guion completo (fundidos, capas, etc.), escribe una nota y la
//      ventana se mueve a un lugar conocido;
//   2. la vitrina vuelve a abrir: la nota, las visitas y el lugar de la
//      ventana tienen que estar como se dejaron.
// Lo corre una vez por cada piel de packages/skin-*: una piel nueva pasa el
// mismo guion que las demás, y la pasada 2 comprueba además que la vitrina
// se acordó de la piel elegida.
// Deja los informes y las capturas en .smoke/.
// Uso: node tools/smoke.mjs [--skin <id>] [--exe <ruta>]
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

// --exe <ruta>: corre el humo contra la app EMPAQUETADA (dist/win-unpacked)
// en vez de contra el repo. Es lo que agarra lo que anda en dev y se rompe
// instalado: archivos que no entraron al asar, rutas que no lo atraviesan.
const exeArg = process.argv.indexOf('--exe');
const EXE = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
if (EXE && !fs.existsSync(EXE)) {
  console.error(`smoke: no existe ${EXE} (¿falta npm run pack -w rad-showcase?)`);
  process.exit(1);
}
const TAG = EXE ? 'empaquetada-' : '';
const command = EXE ? [EXE, []] : [electron, [path.join(ROOT, 'apps', 'showcase')]];
if (EXE) console.log(`smoke: contra la app empaquetada ${path.relative(ROOT, EXE)}`);

fs.mkdirSync(SMOKE, { recursive: true });

// Cada piel de packages/skin-* pasa el humo entero. --skin <id> corre una sola.
const skinArg = process.argv.indexOf('--skin');
const SKINS = skinArg > 0
  ? [process.argv[skinArg + 1]]
  : fs.readdirSync(path.join(ROOT, 'packages')).filter((d) => d.startsWith('skin-')).map((d) => require(path.join(ROOT, 'packages', d, 'skin.cjs')).id);

function run(skin, pass, data, extraEnv = {}) {
  const out = path.join(SMOKE, `showcase-${TAG}${skin}-${pass}.json`);
  const shot = path.join(SMOKE, `showcase-${TAG}${skin}-${pass}.png`);
  fs.rmSync(out, { force: true });
  const env = { ...process.env, RAD_SMOKE: out, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: SCRIPT, RAD_DATA: data, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!('RAD_SKIN' in extraEnv)) delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(command[0], command[1], { env, stdio: 'inherit' });
    const killer = setTimeout(() => { console.error(`smoke: ${skin}, pasada ${pass}: tiempo agotado, mato el proceso`); child.kill(); }, TIMEOUT_MS);
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

const show = (skin, pass, report) => {
  if (report.ok) {
    console.log(`smoke: ${skin}, pasada ${pass} ok  ventana ${report.size.width}x${report.size.height} en (${report.bounds.x}, ${report.bounds.y}), captura en ${report.shot}`);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  } else {
    console.error(`smoke: ${skin}, pasada ${pass} FALLA`);
    for (const f of report.failures || []) console.error('  ' + f);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.error(`  (dato) ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
};

async function smokeSkin(skin) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-smoke-'));
  try {
    // La primera elige la piel con RAD_SKIN y sale por el cierre normal: lo
    // último que guardó tiene que bajar al disco en before-quit.
    const first = await run(skin, 1, data, { RAD_SKIN: skin, RAD_SMOKE_MOVE: JSON.stringify(MOVE), RAD_SMOKE_QUIT: 'close' });
    show(skin, 1, first);
    if (!first.ok) return false;

    // La segunda, con la mono elegida por la app en vez de la de la piel, con
    // las vistas como pestañas en la titlebar en vez de en el rail, y
    // SIN RAD_SKIN: la vitrina tiene que abrir con la piel que se guardó.
    const second = await run(skin, 2, data, { RAD_SHOWCASE_MONO: 'roboto-mono', RAD_SHOWCASE_NAV: 'titlebar' });
    const b = second.bounds || {};
    if (second.ok && (b.x !== MOVE.x || b.y !== MOVE.y || b.width !== MOVE.width || b.height !== MOVE.height)) {
      second.ok = false;
      second.failures = [`la ventana no volvió a su lugar: ${JSON.stringify(b)}, se había dejado en ${JSON.stringify(MOVE)}`];
    }
    if (second.ok && second.script?.piel !== skin) {
      second.ok = false;
      second.failures = [`la vitrina no se acordó de la piel: abrió con "${second.script?.piel}", se había elegido "${skin}"`];
    }
    show(skin, 2, second);
    return second.ok;
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}

let allOk = true;
for (const skin of SKINS) {
  if (!(await smokeSkin(skin))) { allOk = false; break; }
}
process.exit(allOk ? 0 : 1);
