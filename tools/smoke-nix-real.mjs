// Humo de Nix en modo REAL: sin el proveedor de mentira. La app corre el
// camino que usa de verdad (la llave guardada, el loop de cada proveedor, las
// tools sobre el disco), pero las dos APIs son un servidor local: no toca la
// red ni gasta un token.
//
// Existe porque el humo de siempre (tools/smoke-nix.mjs) corre con
// NIX_PROVEEDOR=simulado, y eso deja sin ejercer justo lo que une la interfaz
// con un proveedor de verdad: qué tools viajan en el pedido, con qué system,
// y cómo vuelve su resultado.
//
// Qué mira, con un agente de Anthropic y otro de Venice que tienen todas las
// tools prendidas:
//   - que el pedido lleve las tools del agente, en el formato de cada API;
//   - que el system lleve el protocolo de tools;
//   - que una llamada del modelo corra (escribe un archivo en la carpeta
//     descartable) y su resultado vuelva en la ronda siguiente;
//   - que la fila y el contador aparezcan en la conversación.
// Uso: node tools/smoke-nix-real.mjs [--exe <ruta>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const SMOKE = path.join(ROOT, '.smoke');
const TIMEOUT_MS = Number(process.env.RAD_SMOKE_TIMEOUT) || 90000;

const exeArg = process.argv.indexOf('--exe');
const EXE = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
if (EXE && !fs.existsSync(EXE)) {
  console.error(`smoke real: no existe ${EXE} (¿falta npm run pack:nix?)`);
  process.exit(1);
}
const TAG = EXE ? 'empaquetada-' : '';
const command = EXE ? [EXE, []] : [electron, [path.join(ROOT, 'apps', 'Nix')]];

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-nix-real-'));
const destino = (prov) => path.join(data, `escrito-por-${prov}.txt`);

// ---------- Las dos APIs, de mentira ----------
const vistos = []; // { api, url, body }
const sse = (res, type, d) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
function deAnthropic(res, body) {
  const ronda = body.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')) ? 2 : 1;
  const bloques = ronda === 1
    ? [{ type: 'text', text: 'Writing it. ' }, { type: 'tool_use', id: 'toolu_real_1', name: 'fs_write', input: { path: destino('anthropic'), content: 'hecho por anthropic\n' } }]
    : [{ type: 'text', text: 'Done: the file is written.' }];
  sse(res, 'message_start', { message: { id: 'msg_real', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  bloques.forEach((b, index) => {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { index, content_block: { type: 'text', text: '' } });
      sse(res, 'content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      sse(res, 'content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      sse(res, 'content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    sse(res, 'content_block_stop', { index });
  });
  sse(res, 'message_delta', { delta: { stop_reason: ronda === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(res, 'message_stop', {});
}
function deVenice(res, body) {
  const ronda = body.messages.some((m) => m.role === 'tool') ? 2 : 1;
  const deltas = ronda === 1
    ? [{ content: 'Writing it. ' }, { tool_calls: [{ index: 0, id: 'call_real_1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: destino('venice'), content: 'hecho por venice\n' }) } }] }]
    : [{ content: 'Done: the file is written.' }];
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: ronda === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
  res.write('data: [DONE]\n\n');
}
const MODELOS_VENICE = {
  data: [
    { id: 'mock-con-tools', type: 'text', model_spec: { name: 'Mock With Tools', privacy: 'private', availableContextTokens: 128000, capabilities: { supportsFunctionCalling: true, supportsVision: false }, traits: ['default'] } },
    { id: 'mock-sin-tools', type: 'text', model_spec: { name: 'Mock Without Tools', privacy: 'private', availableContextTokens: 32000, capabilities: { supportsFunctionCalling: false }, traits: [] } },
  ],
};
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const url = req.url ?? '';
    const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && url.startsWith('/venice/models')) return json(MODELOS_VENICE);
    if (req.method === 'GET' && url.startsWith('/v1/models')) return json({ data: [], has_more: false, first_id: null, last_id: null });
    const body = raw ? JSON.parse(raw) : null;
    const api = url.startsWith('/venice/') ? 'venice' : 'anthropic';
    vistos.push({ api, url, body });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    (api === 'venice' ? deVenice : deAnthropic)(res, body);
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PUERTO = server.address().port;

// ---------- El guion, que corre adentro de la página ----------
const GUION = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const datos = await import('/datos.js');
const llave = await import('/llave.js');
if (llave.simulado()) failures.push('la app arrancó con el proveedor de mentira');
// las llaves son de mentira: las recibe el servidor local
await llave.guardar('anthropic', 'sk-ant-api03-humo-real-no-es-una-llave-0000');
await llave.guardar('venice', 'venice-humo-real-no-es-una-llave-1111');
// la lista de modelos de Venice llega sola después de guardar su llave
for (let i = 0; i < 100 && !datos.modelosDe('venice').some((m) => m.id === 'mock-con-tools'); i++) await sleep(100);
if (!datos.modelosDe('venice').some((m) => m.id === 'mock-con-tools')) failures.push('la lista de modelos de Venice no llegó: ' + JSON.stringify(datos.modelosDe('venice').map((m) => m.id)));

const todas = datos.gruposTools().flatMap((g) => g.tools);
datos.ponerModoTools('auto');
const out = { tools: todas.length };
for (const [prov, modelo] of [['anthropic', datos.modeloInicial('anthropic')], ['venice', 'mock-con-tools']]) {
  const a = datos.crearAgente({ nombre: 'Real ' + prov, proveedor: prov, modelo, instrucciones: 'You are the smoke agent.', tools: todas });
  datos.elegirAgente(a.id);
  const c = datos.crearChat(a.id);
  datos.elegirChat(c.id);
  await datos.enviar(c.id, 'Do you have tools? Write the file.');
  for (let i = 0; i < 300 && datos.respondiendo(c.id); i++) await sleep(100);
  if (datos.respondiendo(c.id)) failures.push(prov + ': la respuesta no terminó');
  await sleep(700);
  const hilo = document.querySelector('.dm-hilo:not([data-rad-leaving])');
  const filas = [...(hilo?.querySelectorAll('.dm-tool') ?? [])].map((f) => f.dataset.tool + ':' + f.dataset.estado);
  const msgs = [...(hilo?.querySelectorAll('.dm-msg') ?? [])];
  const ultimo = msgs.at(-1);
  out[prov] = { filas, estado: ultimo?.dataset.estado, texto: ultimo?.querySelector('.dm-msg-texto, .dm-texto')?.textContent?.slice(0, 80) ?? ultimo?.textContent?.slice(0, 120), cuenta: ultimo?.querySelector('.dm-msg-cuenta-texto')?.textContent ?? '' };
  if (filas.join() !== 'fs_write:ok') failures.push(prov + ': las filas de tools son [' + filas.join() + '], se esperaba fs_write:ok');
  if (ultimo?.dataset.estado !== 'ok') failures.push(prov + ': la respuesta terminó en «' + ultimo?.dataset.estado + '»: ' + (ultimo?.textContent ?? '').slice(0, 200));
  if (!out[prov].cuenta.includes('1 tool')) failures.push(prov + ': el contador dice «' + out[prov].cuenta + '»');
}
return { failures, data: out };
`;

// ---------- La corrida ----------
fs.mkdirSync(SMOKE, { recursive: true });
const out = path.join(SMOKE, `nix-real-${TAG}1.json`);
const shot = path.join(SMOKE, `nix-real-${TAG}1.png`);
const script = path.join(data, 'guion-real.js');
fs.writeFileSync(script, GUION);
fs.rmSync(out, { force: true });
const env = {
  ...process.env,
  RAD_SMOKE: out,
  RAD_SMOKE_SHOT: shot,
  RAD_SMOKE_SCRIPT: script,
  RAD_SMOKE_QUIT: 'close',
  RAD_DATA: data,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${PUERTO}`,
  VENICE_BASE_URL: `http://127.0.0.1:${PUERTO}/venice`,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.RAD_SKIN;
delete env.NIX_PROVEEDOR;

const report = await new Promise((resolve) => {
  const child = spawn(command[0], command[1], { env, stdio: 'inherit' });
  const killer = setTimeout(() => { console.error('smoke real: tiempo agotado, mato el proceso'); child.kill(); }, TIMEOUT_MS);
  child.on('exit', (code) => {
    clearTimeout(killer);
    if (!fs.existsSync(out)) return resolve({ ok: false, failures: [`la app salió (código ${code}) sin dejar informe`] });
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    r.ok = r.ok && code === 0;
    resolve(r);
  });
});
server.close();

// ---------- Lo que la página no ve: qué viajó y qué quedó en el disco ----------
const failures = [...(report.failures ?? [])];
const total = report.script?.tools ?? 0;
const textoDe = (content) => (typeof content === 'string' ? content : (content ?? []).map((b) => b.text ?? '').join('\n'));
for (const api of ['anthropic', 'venice']) {
  const pedidos = vistos.filter((v) => v.api === api).map((v) => v.body);
  if (pedidos.length !== 2) { failures.push(`${api}: llegaron ${pedidos.length} pedidos al servidor, se esperaban 2 (la llamada y su resultado)`); continue; }
  const [p1, p2] = pedidos;
  const nombres = (p1.tools ?? []).map((t) => t.name ?? t.function?.name);
  // un modelo de Venice que no declara visión no recibe screen_capture
  const esperadas = api === 'venice' ? total - 1 : total;
  if (nombres.length !== esperadas || !nombres.includes('fs_write')) failures.push(`${api}: el pedido llevó ${nombres.length} tools (${nombres.join(', ') || 'ninguna'}); el agente tiene ${total} prendidas y se esperaban ${esperadas}`);
  if (api === 'venice' && nombres.includes('screen_capture')) failures.push('venice: se le ofreció screen_capture a un modelo que no declara visión');
  const system = api === 'anthropic' ? textoDe(p1.system) : textoDe(p1.messages?.[0]?.content);
  if (!system.startsWith('You are the smoke agent.') || !system.includes('HOW TOOLS ACTUALLY WORK')) failures.push(`${api}: el system no lleva las instrucciones del agente y el protocolo de tools: ${system.slice(0, 120)}`);
  const volvio = api === 'anthropic'
    ? p2.messages.at(-1).content?.find?.((b) => b.type === 'tool_result')
    : p2.messages.find((m) => m.role === 'tool');
  const textoVuelta = volvio ? textoDe(volvio.content) : '';
  if (!volvio || /^error/i.test(textoVuelta)) failures.push(`${api}: el resultado de la tool no volvió bien en la segunda ronda: ${textoVuelta.slice(0, 160) || '(nada)'}`);
  let escrito = null;
  try { escrito = fs.readFileSync(destino(api), 'utf8'); } catch { /* no lo escribió */ }
  if (escrito !== `hecho por ${api}\n`) failures.push(`${api}: la tool no escribió su archivo (quedó ${JSON.stringify(escrito)})`);
}
// las llaves de mentira no quedan en claro en el disco
for (const f of fs.readdirSync(path.join(data, 'data'))) {
  if (fs.readFileSync(path.join(data, 'data', f), 'utf8').includes('no-es-una-llave')) failures.push(`una llave quedó en claro en ${f}`);
}

if (process.env.RAD_SMOKE_KEEP) console.log(`smoke real: los datos quedaron en ${data}`);
else fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

if (failures.length) {
  console.error('smoke: nix en modo real FALLA');
  for (const f of failures) console.error('  ' + f);
  if (report.script) console.error('  (dato) ' + JSON.stringify(report.script));
  process.exit(1);
}
const s = report.script ?? {};
console.log(`smoke: nix en modo real ok  ${total} tools prendidas; Anthropic y Venice las reciben, corren fs_write y leen su resultado`);
console.log(`  anthropic: ${s.anthropic?.filas.join()} · ${s.anthropic?.cuenta}`);
console.log(`  venice: ${s.venice?.filas.join()} · ${s.venice?.cuenta}`);
process.exit(0);
