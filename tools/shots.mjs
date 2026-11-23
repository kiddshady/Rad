// Capturas de la vitrina con una piel, escena por escena: para diseñar una
// piel mirándola de verdad en vez de imaginarla.
//
//   node tools/shots.mjs glass              todas las escenas
//   node tools/shots.mjs glass menu modal   solo esas
//
// Cada escena abre la vitrina (en modo humo: sin foco, datos descartables),
// corre su guion adentro de la página y saca la foto. Quedan en
// .smoke/shots/<piel>-<escena>.png. No reemplaza al humo: acá no se mide
// nada, solo se mira.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const OUT = path.join(ROOT, '.smoke', 'shots');

// Lo que comparten los guiones.
const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (id) => { document.querySelector('.rad-rail-item[data-view="' + id + '"]').click(); await sleep(500); };
const view = (id) => document.querySelector('.rad-view[data-view="' + id + '"]');
const over = (el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
`;

const SCENES = {
  planos: '',
  texto: `await go('texto');`,
  acento: `await go('acento');`,
  capas: `await go('capas');`,
  menu: `await go('capas'); view('capas').querySelector('[data-demo="menu"]').click(); await sleep(500);`,
  modal: `await go('capas'); view('capas').querySelector('[data-demo="confirm"]').click(); await sleep(700);`,
  toasts: `await go('capas');
    for (const k of ['info', 'success', 'warning', 'danger']) { view('capas').querySelector('[data-demo="toast"][data-kind="' + k + '"]').click(); await sleep(120); }
    await sleep(300);
    over(view('capas').querySelector('.rad-iconbutton'));
    await sleep(1000);`,
  controles: `await go('controles');
    const c = view('controles');
    c.querySelector('[data-demo="vencidos"]').closest('label').click();
    c.querySelector('[data-demo="sonido"]').closest('label').click();
    c.querySelector('[data-demo="correo"]').focus();
    await sleep(500);`,
  select: `await go('controles');
    const c = view('controles');
    c.querySelector('[data-demo="form"]').requestSubmit();
    await sleep(500);
    c.querySelector('.rad-select').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await sleep(600);`,
  movimiento: `await go('movimiento'); view('movimiento').querySelector('[data-demo="toggle"]').click(); await sleep(600);`,
  pieles: `await go('pieles'); await sleep(300);`,
  cargando: `await go('movimiento');
    const m = view('movimiento');
    m.querySelector('[data-demo="busy-hold"]').closest('label').click();
    m.querySelector('[data-demo="ask"]').scrollIntoView({ block: 'center' });
    await sleep(900);`,
};

const [skin, ...picked] = process.argv.slice(2);
if (!skin) {
  console.error(`uso: node tools/shots.mjs <piel> [escena...]\nescenas: ${Object.keys(SCENES).join(', ')}`);
  process.exit(1);
}
const scenes = picked.length ? picked : Object.keys(SCENES);
const unknown = scenes.filter((s) => !(s in SCENES));
if (unknown.length) {
  console.error(`escena desconocida: ${unknown.join(', ')} (hay: ${Object.keys(SCENES).join(', ')})`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-shots-'));

function shoot(scene) {
  const data = path.join(tmp, scene);
  const script = path.join(tmp, `${scene}.js`);
  const report = path.join(tmp, `${scene}.json`);
  const shot = path.join(OUT, `${skin}-${scene}.png`);
  fs.writeFileSync(script, `${PRELUDE}\n${SCENES[scene]}\nreturn { failures: [], data: {} };`);
  const env = { ...process.env, RAD_SKIN: skin, RAD_SMOKE: report, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: script, RAD_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(ROOT, 'apps', 'showcase')], { env, stdio: 'inherit' });
    const killer = setTimeout(() => child.kill(), 30000);
    child.on('exit', () => {
      clearTimeout(killer);
      let failures = ['no dejó informe'];
      try { failures = JSON.parse(fs.readFileSync(report, 'utf8')).failures ?? []; } catch { /* queda el aviso */ }
      resolve({ scene, shot, failures });
    });
  });
}

// De a tres: cada una tiene su carpeta de datos, así que no chocan por la
// instancia única.
const queue = [...scenes];
const results = [];
await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
  while (queue.length) results.push(await shoot(queue.shift()));
}));

for (const r of results.sort((a, b) => scenes.indexOf(a.scene) - scenes.indexOf(b.scene))) {
  console.log(`${r.failures.length ? 'aviso' : 'ok   '}  ${path.relative(ROOT, r.shot)}`);
  for (const f of r.failures) console.log(`       ${f}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
