// Mide la fluidez de BlackCode de escritorio, con datos de mentira y por CDP,
// con escenarios que se repiten igual cada vez: sirve para comparar un cambio
// contra otro con números y no a ojo. Es la hermana de tools/medir.mjs de
// BlackCodeMobile.
//
// Arranca la app de verdad (electron sobre apps/BlackCode) con una carpeta de
// datos descartable (RAD_DATA) sembrada acá: tres agentes, 80 chats y uno
// largo de 240 mensajes con markdown de todo tipo (código, listas, tablas,
// citas). Corre contra el proveedor simulado: no toca la red ni gasta un token.
// No lee nada de los datos reales.
//
// Uso:  node tools/medir-blackcode.mjs [vueltas=3] [escenario…]
//       escenarios: vista, chat, scroll, buscar, ajustes, respuesta  (sin nombres: todos)
//   CSS="…"      se inyecta antes de medir (una hoja construida: la CSP bloquea un <style>)
//   FLAGS="…"    switches de Chromium de más, separados por espacios
//   ANCHO/ALTO   el tamaño de la ventana (por defecto 1400×900)
//   JSON=1       además, las vueltas crudas
//
// De cada tramo: cuadros por segundo, el p95 y el peor cuadro (ms), cuántos se
// pasan de 1,5 cuadros de la pantalla, la tarea más larga del hilo principal
// (ms, por PerformanceObserver) y a qué cadencia anduvo (Hz).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const PUERTO = Number(process.env.PUERTO ?? 9231);
const args = process.argv.slice(2);
const vueltas = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
const pedidos = args.filter((a) => !/^\d+$/.test(a));
const TODOS = ['vista', 'chat', 'scroll', 'buscar', 'ajustes', 'respuesta'];
const escenarios = pedidos.length ? pedidos : TODOS;

// ---------- Los datos de mentira ----------
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-medir-'));
const dataDir = path.join(carpeta, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const doc = (nombre, valor) => fs.writeFileSync(path.join(dataDir, `${nombre}.json`), JSON.stringify(valor, null, 2));
const ahora = Date.now();
let n = 0;
const id = () => `m${(++n).toString(36)}x${ahora.toString(36)}`;
const agentes = ['Atlas', 'Bruma', 'Ceibo'].map((nombre, i) => ({ id: `ag${i}`, nombre, proveedor: 'anthropic', modelo: 'claude-opus-5-5', instrucciones: '', tools: [], creado: ahora - 9e8 }));
doc('agentes', { lista: agentes });
const TEMAS = ['Plan for the week', 'Refactor the parser', 'Notes on enzymes', 'Trip ideas', 'Release checklist', 'Benchmark results', 'Reading list', 'Bug in the router', 'Recipe tweaks', 'Shopping list'];
const chats = [];
for (let i = 0; i < 80; i++) {
  chats.push({ id: `c${i}`, agente: 'ag0', titulo: `${TEMAS[i % TEMAS.length]} ${Math.floor(i / TEMAS.length) + 1}`, auto: false, cuenta: 0, creado: ahora - i * 36e5, tocado: ahora - i * 36e5, carpeta: '' });
}
const PARRAFO = 'This is a paragraph of an answer, long enough to wrap across a few lines at the usual window width, with some **bold**, some *italics* and a bit of `inline code` so the markdown renderer has work to do.';
const CODIGO = '```js\nfunction suma(xs) {\n  let total = 0;\n  for (const x of xs) total += x;\n  return total;\n}\nconsole.log(suma([1, 2, 3, 4, 5]));\n```';
const TABLA = '| Name | Value | Notes |\n|---|---|---|\n| alpha | 1 | first |\n| beta | 2 | second |\n| gamma | 3 | third |';
const LISTA = '- one item\n- another item with more words\n  - a nested one\n- the last one';
const respuesta = (i) => [`## Part ${i}`, PARRAFO, i % 3 === 0 ? CODIGO : LISTA, PARRAFO, i % 4 === 0 ? TABLA : '> A quoted line, for good measure.', PARRAFO].join('\n\n');
const conMensajes = (cuantos) => {
  const mensajes = [];
  for (let i = 0; i < cuantos / 2; i++) {
    mensajes.push({ id: id(), rol: 'user', texto: `Question number ${i}: can you explain this part again, with an example?`, t: ahora - (cuantos - i) * 6e4 });
    mensajes.push({ id: id(), rol: 'assistant', texto: respuesta(i), estado: 'ok', modelo: 'claude-opus-5-5', t: ahora - (cuantos - i) * 6e4 + 3e4 });
  }
  return mensajes;
};
// c0: el largo (240), c1: uno mediano (40), el resto cortos (4)
chats.forEach((c, i) => { const m = conMensajes(i === 0 ? 240 : i === 1 ? 40 : 4); c.cuenta = m.length; doc(`chat-${c.id}`, { mensajes: m }); });
doc('chats', { lista: chats });
doc('ui', { agente: 'ag0', chats: { ag0: 'c1' } });

// ---------- La app ----------
const extra = (process.env.FLAGS ?? '').split(/\s+/).filter(Boolean);
const proc = spawn(electron, ['--enable-features=OverlayScrollbar', `--remote-debugging-port=${PUERTO}`, ...extra, path.join(ROOT, 'apps', 'BlackCode')], {
  env: { ...process.env, RAD_DATA: carpeta, BLACKCODE_PROVEEDOR: 'simulado', ELECTRON_ENABLE_LOGGING: '' },
  stdio: 'ignore',
});
const w = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina = null;
for (let i = 0; i < 80 && !pagina; i++) {
  await w(250);
  try { pagina = (await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json()).find((p) => p.type === 'page' && p.url.startsWith('rad://')); } catch {}
}
if (!pagina) { proc.kill(); console.log('La app no abrió el puerto de depuración.'); process.exit(1); }
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let k = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); pend.get(m.id)?.(m); });
const cdp = (method, params = {}) => new Promise((resolve) => { const i = ++k; pend.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluar = async (expression) => {
  const m = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description ?? m;
};
// la ventana del tamaño pedido (la que recuerde no cuenta: la carpeta es nueva)
const ANCHO = Number(process.env.ANCHO ?? 1400), ALTO = Number(process.env.ALTO ?? 900);
await evaluar(`window.resizeTo(${ANCHO}, ${ALTO})`);
// que termine de arrancar: la vista del chat con su hilo
// (arranca en la pantalla de inicio, sin chat elegido: se abre el mediano)
for (let i = 0; i < 60; i++) { if (await evaluar("!!document.querySelector('.dm-fila')")) break; await w(250); }
await evaluar("[...document.querySelectorAll('.dm-fila')].find((f) => f.dataset.radKey === 'c1')?.querySelector('.dm-fila-abrir').click()");
for (let i = 0; i < 40; i++) { if (await evaluar("document.querySelectorAll('.dm-hilo .dm-col > *').length > 2")) break; await w(250); }
await w(1500);
if (process.env.CSS) await evaluar(`(()=>{const h=new CSSStyleSheet();h.replaceSync(${JSON.stringify(process.env.CSS)});document.adoptedStyleSheets=[...document.adoptedStyleSheets,h];return true})()`);

// Lo que corre adentro de la página: un medidor de cuadros (y de tareas largas) alrededor de una acción.
const PAGINA = String.raw`
(async (cual) => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const dur = (t) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(t)) || 0;
  async function cuadros(accion, ms, hasta) {
    const t = [];
    let p = null, sigue = true, tarea = 0;
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) tarea = Math.max(tarea, e.duration); });
    try { obs.observe({ type: 'longtask' }); } catch {}
    const tic = (x) => { if (p !== null) t.push(x - p); p = x; if (sigue) requestAnimationFrame(tic); };
    await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 500); });
    requestAnimationFrame(tic);
    const t0 = performance.now();
    await accion();
    if (hasta) { const fin = performance.now() + 15000; while (!hasta() && performance.now() < fin) await w(50); }
    await w(ms);
    sigue = false;
    obs.disconnect();
    const o = [...t].sort((a, b) => a - b);
    const med = o[Math.floor(o.length / 2)] || 0;
    const hz = med ? Math.round(1000 / med / 15) * 15 : 0;
    const presupuesto = 1.5 * (1000 / (hz || 60));
    return { fps: Math.round((t.length * 1000) / o.reduce((s, x) => s + x, 0)), p95: +((o[Math.floor(o.length * 0.95)] || 0).toFixed(1)), peor: +((o.at(-1) || 0).toFixed(1)), largos: t.filter((x) => x > presupuesto).length, tarea: Math.round(tarea), hz, ms: Math.round(performance.now() - t0) };
  }
  const base = dur('--rad-dur-base') + 150;
  const lento = dur('--rad-dur-slow') + 150;
  const fila = (cid) => [...document.querySelectorAll('.dm-fila')].find((f) => f.dataset.radKey === cid)?.querySelector('.dm-fila-abrir');
  const hiloListo = (cid) => () => document.querySelector('.dm-hilo')?.isConnected && document.querySelectorAll('.dm-hilo .dm-col > *').length > 2;
  if (cual === 'vista') {
    const a = await cuadros(() => $('.rad-tab[data-view=notas]').click(), base * 2 + 100);
    const b = await cuadros(() => $('.rad-tab[data-view=chat]').click(), base * 2 + 100);
    return { aNotas: a, aChat: b };
  }
  if (cual === 'chat') {
    // abrir el largo (240 mensajes) y volver al mediano
    const a = await cuadros(() => fila('c0').click(), lento, hiloListo('c0'));
    const b = await cuadros(() => fila('c1').click(), lento, hiloListo('c1'));
    return { abrirLargo: a, volver: b };
  }
  if (cual === 'scroll') {
    fila('c0').click();
    await w(1200);
    const s = $('.dm-hilo');
    s.scrollTop = 0;
    await w(500);
    const a = await cuadros(() => s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' }), 1500);
    // la rueda: saltos de 300 px cada 50 ms, como alguien que baja leyendo
    s.scrollTop = 0;
    await w(500);
    const b = await cuadros(async () => { for (let i = 0; i < 30; i++) { s.scrollBy({ top: 300, behavior: 'smooth' }); await w(50); } }, 400);
    fila('c1').click();
    await w(800);
    return { suave: a, rueda: b };
  }
  if (cual === 'buscar') {
    const c = $('.dm-buscar-campo');
    const tipear = async (txt) => { for (const ch of txt) { c.value += ch; c.dispatchEvent(new Event('input', { bubbles: true })); await w(90); } };
    const a = await cuadros(() => tipear('plan'), lento);
    const b = await cuadros(() => { c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); }, lento);
    return { filtrar: a, limpiar: b };
  }
  if (cual === 'ajustes') {
    const a = await cuadros(() => $('.rad-tab[data-view=ajustes]').click(), lento);
    const b = await cuadros(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), lento);
    return { abrir: a, cerrar: b };
  }
  if (cual === 'respuesta') {
    // una respuesta del simulado llegando de a poco en el chat mediano
    const area = $('.dm-area');
    area.value = 'Tell me something long, please.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    const enviando = () => !document.querySelector('.dm-hilo [data-estado=escribiendo], .dm-hilo [data-escribiendo]');
    const a = await cuadros(async () => { area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await w(400); }, 300, enviando);
    return { llegar: a };
  }
  return { error: 'escenario desconocido: ' + cual };
})`;

const resultados = {};
for (const e of escenarios) {
  resultados[e] = [];
  for (let i = 0; i < vueltas; i++) {
    resultados[e].push(await evaluar(`${PAGINA}(${JSON.stringify(e)})`));
    await w(400);
  }
}
ws.close();
proc.kill();
await w(500);
try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch {}

const filas = [];
for (const [e, vs] of Object.entries(resultados)) {
  if (typeof vs[0] !== 'object' || vs[0]?.error) { filas.push(`${e.padEnd(8)} ${JSON.stringify(vs[0]).slice(0, 200)}`); continue; }
  for (const tramo of Object.keys(vs[0])) {
    const xs = vs.map((v) => v[tramo]).filter(Boolean);
    const mediana = (q) => { const o = xs.map((x) => x[q]).sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; };
    const hzs = xs.map((x) => x.hz);
    const mezcla = new Set(hzs).size > 1 ? `  (!) Hz ${hzs.join('/')}` : '';
    filas.push(`${`${e}·${tramo}`.padEnd(18)} ${String(mediana('fps')).padStart(4)} fps  p95 ${String(mediana('p95')).padStart(5)}  peor ${String(mediana('peor')).padStart(6)}  largos ${String(mediana('largos')).padStart(3)}  tarea ${String(mediana('tarea')).padStart(4)} ms  ${String(mediana('ms')).padStart(5)} ms  ${hzs[0]} Hz${mezcla}`);
  }
}
console.log(filas.join('\n'));
if (process.env.JSON) console.log(JSON.stringify(resultados, null, 1));
