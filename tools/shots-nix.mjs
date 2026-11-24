// Capturas de Nix, escena por escena, para mirarlo sin abrirlo.
//
//   node tools/shots-nix.mjs              todas las escenas
//   node tools/shots-nix.mjs chat ajustes solo esas
//
// Cada escena abre Nix en modo humo (sin foco, con datos descartables y
// el proveedor simulado: no toca la red ni gasta un token), lo llena con
// datos de mentira, corre su guion adentro de la página y saca la foto.
// Quedan en .smoke/shots/nix-<escena>.png. No reemplaza al humo: acá no
// se mide nada, solo se mira.

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

// Lo que comparten los guiones. Los módulos de la app se importan con la
// misma dirección que usa ella: es la misma instancia, así que lo que se
// crea acá aparece en la interfaz como si se hubiera hecho a mano.
const PRELUDE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (id) => { document.querySelector('.rad-tab[data-view="' + id + '"]').click(); await sleep(600); };
const view = (id) => document.querySelector('.rad-view[data-view="' + id + '"]');
const datos = await import('/datos.js');
const llave = await import('/llave.js');
const nix = datos.agenteActual();
datos.editarAgente(nix.id, { nombre: 'Nix', proveedor: 'anthropic', modelo: nix.modelo, instrucciones: 'You are my coworker: direct, no beating around the bush, and you tell me when I am getting something wrong.' });
const galeno = datos.crearAgente({ nombre: 'Galen', proveedor: 'anthropic', modelo: 'claude-haiku-5-5', instrucciones: 'You are a pharmacist on call. Answer short and clear, and say when it is time to see a doctor.' });
const tutor = datos.crearAgente({ nombre: 'Medicinal Chemistry tutor', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: 'You quiz me on Medicinal Chemistry: one question at a time, above my level, and you correct me on my own answer.' });
const oraculo = datos.crearAgente({ nombre: 'Oracle', proveedor: 'venice', modelo: 'deepseek-v4-1-flash-1017-uncensored', instrucciones: 'You answer with no filter and no lectures. If you do not know something, you say so.' });
const charla = async (agente, titulo, texto) => {
  const c = datos.crearChat(agente.id);
  await datos.enviar(c.id, texto);
  datos.renombrarChat(c.id, titulo);
  return c;
};
const quietos = async () => { for (let i = 0; i < 200 && datos.algunoRespondiendo(); i++) await sleep(60); await sleep(500); };
`;

const SCENES = {
  chat: `
    await charla(galeno, 'Ibuprofen and paracetamol', 'Can they be alternated?');
    await charla(nix, 'Study plan for the Biochemistry final', 'Put together a study plan for me.');
    await charla(nix, 'Names for the app', 'Give me some name ideas.');
    const c = await charla(nix, 'How an answer arrives', 'Can you show me what an answer looks like as it arrives?');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(700);
    document.querySelector('.dm-hilo:not([data-rad-leaving])').scrollTop = 0;
    await sleep(500);`,
  respondiendo: `
    const c = await charla(nix, 'How an answer arrives', 'Can you show me what an answer looks like as it arrives?');
    await sleep(1500);`,
  agentes: `
    await charla(galeno, 'Ibuprofen and paracetamol', 'Can they be alternated?');
    await charla(nix, 'Study plan for the Biochemistry final', 'Put together a study plan for me.');
    await charla(nix, 'Names for the app', 'Give me some name ideas.');
    await quietos();
    await go('agentes');`,
  agente: `
    await go('agentes');
    [...view('agentes').querySelectorAll('[data-accion="editar"]')].at(-1).click();
    await sleep(900);`,
  venice: `
    const c = await charla(oraculo, 'Straight to the point', 'Which model are you?');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(700);
    document.querySelector('.dm-hilo:not([data-rad-leaving])').scrollTop = 0;
    await sleep(500);`,
  ajustes: `
    await llave.guardar('anthropic', 'sk-ant-api03-captura-de-nix-no-es-una-llave-0000');
    await llave.guardar('venice', 'venice-captura-de-nix-no-es-una-llave-1111');
    await go('ajustes');
    await sleep(1400);`,
  'llave-rechazada': `
    await llave.guardar('anthropic', 'sk-ant-api03-captura-sin-workspace-no-es-una-llave-0000');
    await go('ajustes');
    await sleep(1400);`,
  'llave-comprobando': `
    await go('ajustes');
    llave.guardar('anthropic', 'sk-ant-api03-captura-de-nix-no-es-una-llave-0000');
    await sleep(330);`,
  about: `
    await go('ajustes');
    const act = await import('/actualizacion.js');
    act.recibir({ state: 'available', version: '0.4.0' });
    view('ajustes').querySelector('[data-tarjeta="acerca"]').scrollIntoView({ block: 'center' });
    await sleep(900);`,
  'sin-llave': `
    await go('ajustes');
    await sleep(400);`,
};

const picked = process.argv.slice(2);
const scenes = picked.length ? picked : Object.keys(SCENES);
const unknown = scenes.filter((s) => !(s in SCENES));
if (unknown.length) {
  console.error(`escena desconocida: ${unknown.join(', ')} (hay: ${Object.keys(SCENES).join(', ')})`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-nix-shots-'));

function shoot(scene) {
  const data = path.join(tmp, scene);
  const script = path.join(tmp, `${scene}.js`);
  const report = path.join(tmp, `${scene}.json`);
  const shot = path.join(OUT, `nix-${scene}.png`);
  fs.writeFileSync(script, `${PRELUDE}\n${SCENES[scene]}\nreturn { failures: [], data: {} };`);
  const env = { ...process.env, RAD_SMOKE: report, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: script, RAD_DATA: data, NIX_PROVEEDOR: 'simulado' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(ROOT, 'apps', 'Nix')], { env, stdio: 'inherit' });
    const killer = setTimeout(() => child.kill(), 40000);
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
