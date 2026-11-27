// Typo lab: BlackCode de verdad con un panel encima para probar fuentes.
//
// Arranca la app (electron sobre apps/BlackCode) con una carpeta de datos
// descartable sembrada acá (agentes y chats de mentira, en inglés y en
// castellano, con markdown de todo tipo) y el proveedor simulado: no toca la
// red ni los datos reales. Por CDP le suma a la página un panel flotante
// (panel.js + panel.css) que cambia en vivo los tokens tipográficos del
// contrato de Rad: las tres familias, los cinco tamaños y los dos pesos.
// Ningún archivo de BlackCode se toca.
//
// Lo elegido se guarda en tools/typo-lab/guardado.json (fuera de git) y
// vuelve la próxima vez. «Copy CSS» deja en el portapapeles el bloque de
// tokens que cambiaron, listo para la piel o para la app.
//
// Uso:  npm run typolab      (o node tools/typo-lab/index.mjs)
//   PUERTO   el de depuración (por defecto 9232)
//   ANCHO/ALTO   el tamaño de la ventana (por defecto 1400×900)
// Cerrar la ventana de BlackCode termina todo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '..', '..');
const electron = require('electron');
const PUERTO = Number(process.env.PUERTO ?? 9232);
const GUARDADO = path.join(AQUI, 'guardado.json');

// ---------- Las fuentes instaladas ----------
// GDI lista cada peso y cada ancho como una familia aparte («Bahnschrift
// Light», «Cascadia Mono SemiBold», a veces cortados a 31 letras): se quedan
// solo las familias base, y el peso se elige con los pesos del panel.
const ESTILOS = ['thin', 'hairline', 'extralight', 'ultralight', 'light', 'semilight', 'demilight', 'book', 'regular', 'normal', 'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy', 'condensed', 'semicondensed', 'extracondensed', 'expanded', 'semiexpanded', 'narrow', 'wide', 'italic', 'oblique', 'variable', 'semibol', 'semilig', 'semib', 'semil', 'semiconden', 'semiconde'];
const esEstilo = (palabra) => ESTILOS.some((e) => e === palabra || (palabra.length >= 4 && e.startsWith(palabra)));
function familias() {
  let crudas = [];
  try {
    crudas = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object Name'], { encoding: 'utf8' })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.log('No se pudo leer la lista de fuentes del sistema:', e.message);
  }
  const todas = new Set([...crudas, 'Roboto Mono']);
  // Las de Segoe UI Variable son tres familias de verdad (Text, Display, Small): quedan.
  const base = (n) => {
    const p = n.split(' ');
    for (let i = 1; i < p.length; i++) {
      const resto = p.slice(i);
      const cabeza = p.slice(0, i).join(' ');
      if (resto.every((w) => esEstilo(w.toLowerCase())) && todas.has(cabeza)) return cabeza;
    }
    return n;
  };
  // fuera las de íconos y símbolos: no se leen como texto
  const SIMBOLOS = /icons|assets|emoji|symbol|webdings|wingdings|marlett|holomdl2|^@/i;
  return [...new Set([...todas].map(base))].filter((n) => !SIMBOLOS.test(n)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

// ---------- Los datos de mentira ----------
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-typolab-'));
const dataDir = path.join(carpeta, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const doc = (nombre, valor) => fs.writeFileSync(path.join(dataDir, `${nombre}.json`), JSON.stringify(valor, null, 2));
const ahora = Date.now();
let n = 0;
const id = () => `m${(++n).toString(36)}x${ahora.toString(36)}`;
const agentes = ['Zac', 'Bruma', 'Ceibo'].map((nombre, i) => ({ id: `ag${i}`, nombre, proveedor: 'anthropic', modelo: 'claude-opus-5-5', instrucciones: '', tools: [], creado: ahora - 9e8 }));
doc('agentes', { lista: agentes });
// cerrar la ventana termina la app (sin bandeja): así el lab sabe cuándo irse
doc('fondo', { bandeja: false });

const EN = [
  ['Explain the Michaelis–Menten curve', [
    'Can you explain the Michaelis–Menten curve with numbers? I keep mixing up Km and Vmax.',
    '## The short version\n\nThe curve describes how fast an enzyme works as you add **more substrate**. At low concentrations the rate grows almost linearly; at high ones it flattens out at *Vmax*, because every active site is busy.\n\n$$v = \\frac{V_{max}\\,[S]}{K_m + [S]}$$\n\n### What each one means\n\n- **Vmax**: the ceiling. All the enzyme is saturated.\n- **Km**: the substrate concentration at which `v = Vmax / 2`. A small Km means high affinity.\n- **kcat**: turnovers per second, `kcat = Vmax / [E]t`.\n\n| [S] (mM) | v (µmol/min) | % of Vmax |\n|---:|---:|---:|\n| 0.5 | 20.0 | 20 % |\n| 2.0 | 50.0 | 50 % |\n| 8.0 | 80.0 | 80 % |\n| 50 | 96.2 | 96 % |\n\n> With Km = 2 mM, doubling [S] from 2 to 4 mM only takes you from 50 % to 67 %.\n\nNumbers to check the font: 0123456789, 1Il|, O0o, rn vs m, 3.14159, −12 °C.',
  ]],
  ['Refactor the parser', [
    'The parser in `src/parse.js` is slow on long files. Ideas?',
    'Two things stand out. First, the regex is rebuilt on every line; hoist it. Second, you concatenate strings inside the loop.\n\n```js\nconst LINEA = /^(\\s*)([-*+]|\\d+\\.)\\s+(.*)$/;\n\nexport function parse(texto) {\n  const partes = [];\n  for (const linea of texto.split(/\\r?\\n/)) {\n    const m = LINEA.exec(linea);\n    if (m) partes.push({ nivel: m[1].length / 2, texto: m[3] });\n  }\n  return partes; // {} [] () <> != === => && || ?? ?. ...\n}\n```\n\nPath of the config: `C:\\Users\\you\\AppData\\Roaming\\BlackCode\\data\\ui.json`. With that change the 40 000-line file went from **1.8 s** to **0.21 s**.',
  ]],
];
const ES = [
  ['Repaso de Farmacología', [
    '¿Me hacés un repaso corto de los betabloqueantes? Rindo el jueves.',
    '## Betabloqueantes, lo esencial\n\nBloquean los receptores **β-adrenérgicos**. Los cardioselectivos (atenolol, metoprolol, bisoprolol) prefieren los β₁ del corazón; los no selectivos (propranolol) tocan también los β₂ de los bronquios.\n\n1. Bajan la frecuencia y la contractilidad: menos consumo de O₂.\n2. Sirven en hipertensión, angina, arritmias e insuficiencia cardíaca estable.\n3. Ojo en el asma: un no selectivo puede dar broncoespasmo.\n\n> ¿Por qué no se suspenden de golpe? Por el rebote: taquicardia y riesgo de isquemia.\n\nAcentos y signos para mirar la fuente: áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ «» — · … ±×÷ µ ≤ ≥ → ⇌.',
  ]],
];
const PARRAFO = 'This is a paragraph of an answer, long enough to wrap across a few lines at the usual window width, with some **bold**, some *italics* and a bit of `inline code` so the markdown renderer has work to do.';
const chats = [];
const conversar = (pares) => pares.map((texto, i) => (i % 2 === 0
  ? { id: id(), rol: 'user', texto, t: ahora - (pares.length - i) * 6e4 }
  : { id: id(), rol: 'assistant', texto, estado: 'ok', modelo: 'claude-opus-5-5', t: ahora - (pares.length - i) * 6e4 + 3e4 }));
[...EN, ...ES].forEach(([titulo, pares], i) => {
  const c = { id: `c${i}`, agente: 'ag0', titulo, auto: false, cuenta: pares.length, creado: ahora - i * 36e5, tocado: ahora - i * 36e5, carpeta: '' };
  chats.push(c);
  doc(`chat-${c.id}`, { mensajes: conversar(pares) });
});
const TEMAS = ['Plan for the week', 'Notes on enzymes', 'Trip ideas', 'Release checklist', 'Benchmark results', 'Reading list', 'Bug in the router', 'Recipe tweaks', 'Shopping list', 'Ideas para la monografía', 'Lista del súper', 'Horarios de cursado'];
for (let i = 0; i < 24; i++) {
  const c = { id: `r${i}`, agente: 'ag0', titulo: TEMAS[i % TEMAS.length], auto: false, cuenta: 2, creado: ahora - (i + 4) * 5e6, tocado: ahora - (i + 4) * 5e6, carpeta: '' };
  chats.push(c);
  doc(`chat-${c.id}`, { mensajes: conversar([`A short question about ${c.titulo.toLowerCase()}.`, PARRAFO]) });
}
doc('chats', { lista: chats });
doc('ui', { agente: 'ag0', chats: { ag0: 'c0' } });

// ---------- La app ----------
const proc = spawn(electron, ['--enable-features=OverlayScrollbar', `--remote-debugging-port=${PUERTO}`, path.join(ROOT, 'apps', 'BlackCode')], {
  env: { ...process.env, RAD_DATA: carpeta, BLACKCODE_PROVEEDOR: 'simulado', ELECTRON_ENABLE_LOGGING: '' },
  stdio: 'ignore',
});
const limpiar = () => { try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch {} };
proc.on('exit', () => { setTimeout(() => { limpiar(); process.exit(0); }, 300); });
process.on('SIGINT', () => proc.kill());

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
const cdp = (method, params = {}) => new Promise((resolve) => { const i = ++k; pend.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluar = async (expression) => {
  const m = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description ?? m;
};

// Lo que el panel le pide a node: guardar y copiar.
function copiar(texto) {
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'], { stdio: ['pipe', 'ignore', 'ignore'] });
  p.stdin.end(texto, 'utf8');
}
const leerGuardado = () => { try { return JSON.parse(fs.readFileSync(GUARDADO, 'utf8')); } catch { return null; } };

const LISTA = familias();
// El panel se lee en cada inyección: con Ctrl+R en la ventana entra el panel recién editado.
async function inyectar() {
  for (let i = 0; i < 80; i++) { if (await evaluar("!!document.querySelector('.rad-root .rad-tabs')")) break; await w(250); }
  await w(300);
  const PANEL_JS = fs.readFileSync(path.join(AQUI, 'panel.js'), 'utf8');
  const PANEL_CSS = fs.readFileSync(path.join(AQUI, 'panel.css'), 'utf8');
  const r = await evaluar(`(${PANEL_JS})(${JSON.stringify({ familias: LISTA, css: PANEL_CSS, guardado: leerGuardado() })})`);
  if (r !== true) console.log('El panel no entró:', r);
}

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) { pend.get(m.id)?.(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.bindingCalled' && m.params.name === 'typoLab') {
    let pedido;
    try { pedido = JSON.parse(m.params.payload); } catch { return; }
    if (pedido.que === 'guardar') fs.writeFileSync(GUARDADO, JSON.stringify(pedido.estado, null, 2));
    if (pedido.que === 'copiar') copiar(pedido.texto);
  }
  // Ctrl+R (o lo que recargue la página) se lleva el panel: vuelve.
  if (m.method === 'Page.loadEventFired') inyectar();
});
await cdp('Runtime.enable');
await cdp('Page.enable');
await cdp('Runtime.addBinding', { name: 'typoLab' });
const ANCHO = Number(process.env.ANCHO ?? 1400), ALTO = Number(process.env.ALTO ?? 900);
await evaluar(`window.resizeTo(${ANCHO}, ${ALTO})`);
await inyectar();
// arranca en la pantalla de inicio: se abre el chat de las enzimas
await evaluar("[...document.querySelectorAll('.dm-fila')].find((f) => f.dataset.radKey === 'c0')?.querySelector('.dm-fila-abrir').click()");
console.log(`Typo lab abierto (${LISTA.length} familias). Cerrá la ventana de BlackCode para terminar.`);
