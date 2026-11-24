// Capturas de BlackCode, escena por escena, para mirarlo sin abrirlo.
//
//   node tools/shots-blackcode.mjs              todas las escenas
//   node tools/shots-blackcode.mjs chat ajustes solo esas
//
// Cada escena abre BlackCode en modo humo (sin foco, con datos descartables y
// el proveedor simulado: no toca la red ni gasta un token), lo llena con
// datos de mentira, corre su guion adentro de la página y saca la foto.
// Quedan en .smoke/shots/blackcode-<escena>.png. No reemplaza al humo: acá no
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
const blackcode = datos.agenteActual();
datos.editarAgente(blackcode.id, { nombre: 'BlackCode', proveedor: 'anthropic', modelo: blackcode.modelo, instrucciones: 'You are my coworker: direct, no beating around the bush, and you tell me when I am getting something wrong.' });
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
    await charla(blackcode, 'Study plan for the Biochemistry final', 'Put together a study plan for me.');
    await charla(blackcode, 'Names for the app', 'Give me some name ideas.');
    const c = await charla(blackcode, 'How an answer arrives', 'Can you show me what an answer looks like as it arrives?');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(700);
    document.querySelector('.dm-hilo:not([data-rad-leaving])').scrollTop = 0;
    await sleep(500);`,
  respondiendo: `
    const c = await charla(blackcode, 'How an answer arrives', 'Can you show me what an answer looks like as it arrives?');
    await sleep(1500);`,
  agentes: `
    await charla(galeno, 'Ibuprofen and paracetamol', 'Can they be alternated?');
    await charla(blackcode, 'Study plan for the Biochemistry final', 'Put together a study plan for me.');
    await charla(blackcode, 'Names for the app', 'Give me some name ideas.');
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
    await llave.guardar('anthropic', 'sk-ant-api03-captura-de-blackcode-no-es-una-llave-0000');
    await llave.guardar('venice', 'venice-captura-de-blackcode-no-es-una-llave-1111');
    await go('ajustes');
    await sleep(1400);`,
  'llave-rechazada': `
    await llave.guardar('anthropic', 'sk-ant-api03-captura-sin-workspace-no-es-una-llave-0000');
    await go('ajustes');
    await sleep(1400);`,
  'llave-comprobando': `
    await go('ajustes');
    llave.guardar('anthropic', 'sk-ant-api03-captura-de-blackcode-no-es-una-llave-0000');
    await sleep(330);`,
  about: `
    await go('ajustes');
    const act = await import('/actualizacion.js');
    act.recibir({ state: 'available', version: '0.4.0' });
    view('ajustes').querySelector('[data-tarjeta="acerca"]').scrollIntoView({ block: 'center' });
    await sleep(900);`,
  tools: `
    datos.ponerModoTools('auto');
    const t = datos.crearAgente({ nombre: 'Toolsmith', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: 'You keep my notes in order.', tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_delete', 'code_search', 'shell_exec', 'cmd_exec'] });
    const c = datos.crearChat(t.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'fs_write', args: { path: 'notes.md', content: '# Notes\\n\\n- one\\n- two\\n' } }]) + ' ;; ' + JSON.stringify([{ name: 'fs_read', args: { paths: ['notes.md'] } }, { name: 'shell_exec', args: { command: 'Get-Date -Format yyyy' } }, { name: 'fs_read', args: { paths: ['missing.txt'] } }]));
    await quietos();
    datos.renombrarChat(c.id, 'Notes in order');
    await sleep(600);
    [...document.querySelectorAll('.dm-tool')].find((n) => n.dataset.tool === 'fs_read').querySelector('.dm-tool-cabeza').click();
    await sleep(700);`,
  permiso: `
    datos.ponerModoTools('auto');
    const t = datos.crearAgente({ nombre: 'Toolsmith', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: '', tools: ['fs_read', 'fs_write', 'fs_edit'] });
    const c = datos.crearChat(t.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'fs_write', args: { path: 'notes.md', content: '# Notes\\n\\n- one\\n- two\\n- three\\n' } }]));
    await quietos();
    datos.ponerModoTools('manual');
    datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'fs_edit', args: { path: 'notes.md', edits: [{ old: '- two', new: '- two, and a half' }] } }]));
    await sleep(1600);`,
  'agente-tools': `
    const t = datos.crearAgente({ nombre: 'Toolsmith', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: 'You keep my notes in order.', tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_delete', 'code_search'] });
    await go('agentes');
    [...view('agentes').querySelectorAll('[data-accion="editar"]')].at(-1).click();
    await sleep(900);`,
  // Las tools de la segunda etapa. La pantalla que se captura es la de mentira
  // del proveedor simulado (un degradé), no el escritorio.
  captura: `
    datos.ponerModoTools('auto');
    const t = datos.crearAgente({ nombre: 'Toolsmith', proveedor: 'anthropic', modelo: 'claude-sonnet-5-5', instrucciones: '', tools: ['run_code', 'db_query', 'screen_capture'] });
    const c = datos.crearChat(t.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'run_code', args: { language: 'node', code: 'console.log(6 * 7)' } }, { name: 'db_query', args: { sql: 'SELECT 42 AS answer' } }, { name: 'screen_capture', args: {} }]));
    await quietos();
    datos.renombrarChat(c.id, 'A look at the screen');
    await sleep(1200);
    const hilo = document.querySelector('.dm-hilo:not([data-rad-leaving])');
    hilo.scrollTop = hilo.scrollHeight;
    await sleep(600);`,
  // El botón de tools de la conversación, con su menú abierto.
  'menu-tools': `
    const c = await charla(blackcode, 'Names for the app', 'Give me some name ideas.');
    await quietos();
    datos.elegirChat(c.id);
    datos.ponerTools(blackcode.id, ['fs_read', 'fs_write', 'fs_edit', 'fs_delete', 'code_search', 'run_code']);
    await sleep(700);
    document.querySelector('[data-accion="tools"]').click();
    await sleep(900);`,
  // Fórmulas en LaTeX, en bloque, en línea y de química.
  formulas: `
    const c = await charla(blackcode, 'Thermite', 'MATH please');
    await quietos();
    datos.elegirChat(c.id);
    await sleep(1500);`,
  // El canvas: un documento abierto al lado de la conversación, y uno de código.
  canvas: `
    datos.ponerModoTools('auto');
    const c = datos.crearChat(blackcode.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'canvas', args: { action: 'create', title: 'sum.js', kind: 'code', language: 'js', content: "// Michaelis–Menten\\nexport function rate(vmax, km, s) {\\n  return (vmax * s) / (km + s);\\n}\\n\\nfor (const s of [0.5, 1, 2, 5, 10]) {\\n  console.log(s, rate(100, 2, s).toFixed(1));\\n}" } }, { name: 'canvas', args: { action: 'create', title: 'Study plan', kind: 'document', content: "# Study plan: Biochemistry final\\n\\nThree weeks, two units per day.\\n\\n## Week 1\\n\\n- Glycolysis and its regulation\\n- Krebs cycle: $\\\\ce{Acetyl-CoA + 3NAD+ -> 2CO2 + 3NADH}$\\n- Oxidative phosphorylation\\n\\n## Week 2\\n\\n| Day | Topic | Hours |\\n|---|---|---|\\n| Mon | Lipids | 3 |\\n| Tue | Amino acids | 4 |\\n\\n> Review the enzymes list every night." } }]));
    await quietos();
    datos.renombrarChat(c.id, 'Plan for the final');
    await sleep(1500);`,
  'canvas-codigo': `
    datos.ponerModoTools('auto');
    const c = datos.crearChat(blackcode.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'canvas', args: { action: 'create', title: 'Study plan', kind: 'document', content: '# Plan' } }, { name: 'canvas', args: { action: 'create', title: 'rate.js', kind: 'code', language: 'js', content: "// Michaelis–Menten\\nexport function rate(vmax, km, s) {\\n  return (vmax * s) / (km + s);\\n}\\n\\nfor (const s of [0.5, 1, 2, 5, 10]) {\\n  console.log(s, rate(100, 2, s).toFixed(1));\\n}" } }]));
    await quietos();
    datos.renombrarChat(c.id, 'Enzyme kinetics');
    await sleep(1500);`,
  'canvas-biblioteca': `
    datos.ponerModoTools('auto');
    const c = datos.crearChat(blackcode.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'canvas', args: { action: 'create', title: 'Study plan', kind: 'document', content: '# Plan' } }, { name: 'canvas', args: { action: 'create', title: 'rate.js', kind: 'code', language: 'js', content: 'x' } }, { name: 'canvas', args: { action: 'create', title: 'Old notes', kind: 'document', content: 'old' } }]));
    await quietos();
    datos.renombrarChat(c.id, 'Enzyme kinetics');
    await sleep(900);
    document.querySelector('[data-accion="canvas-biblioteca"]').click();
    await sleep(1200);`,
  // El navegador. La página es una capa nativa que la captura de la ventana
  // no trae: se le pide su foto y se la pone en el hueco (es lo que se ve).
  navegador: `
    datos.ponerModoTools('auto');
    const c = datos.crearChat(blackcode.id);
    await datos.enviar(c.id, 'TOOLS: ' + JSON.stringify([{ name: 'browser_navigate', args: { url: 'https://example.com' } }, { name: 'browser_read', args: {} }]));
    await quietos();
    datos.renombrarChat(c.id, 'A page to read');
    await sleep(1800);
    const foto = await window.rad.invoke('browser:freeze');
    const hueco = document.querySelector('.dm-nav-hueco');
    if (foto) { hueco.querySelector('.dm-nav-foto').src = foto; hueco.setAttribute('data-foto', ''); }
    await sleep(500);`,
  // Las notas: carpetas, una fijada y una abierta, dibujada.
  notas: `
    const crear = (content, folderId = null) => window.rad.invoke('notas:crear', { content, folderId });
    const fac = await window.rad.invoke('notas:carpeta-crear', 'University');
    const casa = await window.rad.invoke('notas:carpeta-crear', 'Home');
    const plan = await crear('# Biochemistry final\\n\\nUnits to review before the oral exam.\\n\\n- Glycolysis and its regulation\\n- Krebs cycle: $\\\\ce{Acetyl-CoA + 3NAD+ -> 2CO2 + 3NADH}$\\n- Oxidative phosphorylation\\n\\n## Books\\n\\n| Book | Chapters |\\n|---|---|\\n| Lehninger | 14 to 19 |\\n| Stryer | 16 to 18 |\\n\\n> Ask about the lab report on Monday.', fac.id);
    await crear('Medicinal chemistry: questions for the tutor\\n\\nSAR of benzodiazepines.', fac.id);
    await crear('# Shopping\\n\\n- yerba\\n- bread', casa.id);
    await crear('Ideas for the app\\n\\nA notepad the agent can read.');
    await window.rad.invoke('notas:fijar', { id: plan.id, pinned: true });
    await go('notas');
    await sleep(700);
    [...view('notas').querySelectorAll('.dm-notas-nota')].find((n) => n.textContent.includes('Biochemistry')).click();
    await sleep(1500);`,
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-blackcode-shots-'));

function shoot(scene) {
  const data = path.join(tmp, scene);
  const script = path.join(tmp, `${scene}.js`);
  const report = path.join(tmp, `${scene}.json`);
  const shot = path.join(OUT, `blackcode-${scene}.png`);
  fs.writeFileSync(script, `${PRELUDE}\n${SCENES[scene]}\nreturn { failures: [], data: {} };`);
  const env = { ...process.env, RAD_SMOKE: report, RAD_SMOKE_SHOT: shot, RAD_SMOKE_SCRIPT: script, RAD_DATA: data, BLACKCODE_PROVEEDOR: 'simulado' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(ROOT, 'apps', 'BlackCode')], { env, stdio: 'inherit' });
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
