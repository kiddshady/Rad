// Capturas de Daimon, escena por escena, para mirarlo sin abrirlo.
//
//   node tools/shots-daimon.mjs              todas las escenas
//   node tools/shots-daimon.mjs chat ajustes solo esas
//
// Cada escena abre Daimon en modo humo (sin foco, con datos descartables y
// el proveedor simulado: no toca la red ni gasta un token), lo llena con
// datos de mentira, corre su guion adentro de la página y saca la foto.
// Quedan en .smoke/shots/daimon-<escena>.png. No reemplaza al humo: acá no
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
const go = async (id) => { document.querySelector('.rad-rail-item[data-view="' + id + '"]').click(); await sleep(600); };
const view = (id) => document.querySelector('.rad-view[data-view="' + id + '"]');
const datos = await import('/datos.js');
const llave = await import('/llave.js');
const daimon = datos.agenteActual();
datos.editarAgente(daimon.id, { nombre: 'Daimon', proveedor: 'anthropic', modelo: daimon.modelo, instrucciones: 'Sos mi compañero de trabajo: directo, sin vueltas, y me avisás cuando me estoy equivocando.' });
const galeno = datos.crearAgente({ nombre: 'Galeno', proveedor: 'anthropic', modelo: 'claude-haiku-5-5', instrucciones: 'Sos un farmacéutico de guardia. Respondé corto y claro, y decí cuándo hay que ir al médico.' });
const tutor = datos.crearAgente({ nombre: 'Tutor de Medicinal', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: 'Me tomás examen de Química Medicinal: una pregunta por vez, por encima de mi nivel, y corregís sobre mi respuesta.' });
const oraculo = datos.crearAgente({ nombre: 'Oráculo', proveedor: 'venice', modelo: 'grok-4-7', instrucciones: 'Contestás sin filtro y sin sermones. Si no sabés algo, lo decís.' });
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
    await charla(galeno, 'Ibuprofeno y paracetamol', '¿Se pueden alternar?');
    await charla(daimon, 'Plan para el final de Biológica', 'Armame un plan de estudio.');
    await charla(daimon, 'Nombres para la app', 'Tirame ideas de nombres.');
    const c = await charla(daimon, 'Cómo llega una respuesta', '¿Me mostrás cómo se ve una respuesta que llega de a poco?');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(700);
    document.querySelector('.dm-hilo:not([data-rad-leaving])').scrollTop = 0;
    await sleep(500);`,
  respondiendo: `
    const c = await charla(daimon, 'Cómo llega una respuesta', '¿Me mostrás cómo se ve una respuesta que llega de a poco?');
    await sleep(1500);`,
  agentes: `
    await charla(galeno, 'Ibuprofeno y paracetamol', '¿Se pueden alternar?');
    await charla(daimon, 'Plan para el final de Biológica', 'Armame un plan de estudio.');
    await charla(daimon, 'Nombres para la app', 'Tirame ideas de nombres.');
    await quietos();
    await go('agentes');`,
  agente: `
    await go('agentes');
    [...view('agentes').querySelectorAll('[data-accion="editar"]')].at(-1).click();
    await sleep(900);`,
  venice: `
    const c = await charla(oraculo, 'Sin vueltas', '¿Qué modelo sos?');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(700);
    document.querySelector('.dm-hilo:not([data-rad-leaving])').scrollTop = 0;
    await sleep(500);`,
  ajustes: `
    await llave.guardar('anthropic', 'sk-ant-api03-captura-de-daimon-no-es-una-llave-0000');
    await llave.guardar('venice', 'venice-captura-de-daimon-no-es-una-llave-1111');
    await go('ajustes');
    await sleep(400);`,
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-daimon-shots-'));

function shoot(scene) {
  const data = path.join(tmp, scene);
  const script = path.join(tmp, `${scene}.js`);
  const report = path.join(tmp, `${scene}.json`);
  const shot = path.join(OUT, `daimon-${scene}.png`);
  fs.writeFileSync(script, `${PRELUDE}\n${SCENES[scene]}\nreturn { failures: [], data: {} };`);
  const env = { ...process.env, RAD_SMOKE: report, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: script, RAD_DATA: data, DAIMON_PROVEEDOR: 'simulado' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(ROOT, 'apps', 'Daimon')], { env, stdio: 'inherit' });
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
