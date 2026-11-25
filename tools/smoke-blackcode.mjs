// Humo de BlackCode: arranca la app de verdad, la usa y mide lo que se ve. Dos
// pasadas sobre la misma carpeta de datos descartable (RAD_DATA):
//   1. el guion completo (tools/smoke-blackcode.js): crear un agente, crear un
//      chat, mandar un mensaje, ver llegar la respuesta de a poco, frenarla,
//      renombrar y borrar un chat, guardar las llaves, y un agente de Venice;
//   2. BlackCode vuelve a abrir: los agentes, los chats, los mensajes y la llave
//      tienen que estar como se dejaron.
// Corre contra el proveedor simulado (BLACKCODE_PROVEEDOR=simulado): no toca la
// red ni gasta un token. La llave que se guarda es de mentira, y al final se
// revisa el disco: no puede aparecer en claro en ningún archivo.
// Deja los informes y las capturas en .smoke/.
// Uso: node tools/smoke-blackcode.mjs [--exe <ruta>]

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
const SCRIPT = path.join(ROOT, 'tools', 'smoke-blackcode.js');
// El navegador de BlackCode se prueba contra una página servida en esta máquina:
// el humo no sale a internet.
const PAGINAS = {
  '/': '<!doctype html><html><head><meta charset="utf-8"><title>Smoke page</title></head><body style="background:#fff;font:16px sans-serif;padding:24px">'
    + '<h1>Smoke page</h1><p id="estado">nothing yet</p>'
    + '<input id="campo" aria-label="Your name" placeholder="Your name"> '
    + '<button id="b" onclick="document.getElementById(\'estado\').textContent=\'clicked: \'+document.getElementById(\'campo\').value">Greet</button>'
    + '<p><a href="/second">Second page</a></p></body></html>',
  '/second': '<!doctype html><html><head><meta charset="utf-8"><title>Second page</title></head><body style="background:#fff;font:16px sans-serif;padding:24px"><h1>Second page</h1><p>You are on the second page.</p></body></html>',
};
const servidor = http.createServer((req, res) => {
  const html = PAGINAS[new URL(req.url ?? '/', 'http://x').pathname];
  res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html ?? 'not found');
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const SMOKE_URL = `http://127.0.0.1:${servidor.address().port}/`;
// El guion que corre la app: el de siempre, con la dirección de esa página
// adelante. Con RAD_SMOKE_TRAZA=1 va envuelto en un try/catch que devuelve la
// traza: una excepción del guion dice en qué línea fue.
function armarGuion(carpeta) {
  let fuente = fs.readFileSync(SCRIPT, 'utf8');
  const cabeza = `const SMOKE_URL = ${JSON.stringify(SMOKE_URL)};`;
  if (process.env.RAD_SMOKE_TRAZA) {
    fuente = fuente.replace('const failures = [];', 'var failures = [];');
    fuente = `${cabeza} try {\n${fuente}\n} catch (e) { return { failures: [...failures, 'TRAZA (línea del guion = la del error menos 2): ' + (e.stack || e)], data: {} }; }`;
  } else {
    fuente = `${cabeza}\n${fuente}`;
  }
  const destino = path.join(carpeta, 'guion-humo.js');
  fs.writeFileSync(destino, fuente);
  return destino;
}
// RAD_SMOKE_TIMEOUT (ms) lo estira y RAD_SMOKE_KEEP=1 deja la carpeta de datos
// para mirarla: las dos son para depurar un guion que se cuelga.
// (480 s desde la 0.14.0: con la terminal, la manija y el chat largo la primera pasada ronda los cinco minutos)
const TIMEOUT_MS = Number(process.env.RAD_SMOKE_TIMEOUT) || 480000;
// Todas las llaves que escribe el guion en Ajustes llevan esta marca. No son
// llaves: son textos con su forma, para comprobar que lo que se guarda no
// queda en claro.
const MARCA_DE_LLAVE = 'no-es-una-llave';

const exeArg = process.argv.indexOf('--exe');
const EXE = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
if (EXE && !fs.existsSync(EXE)) {
  console.error(`smoke: no existe ${EXE} (¿falta npm run pack -w blackcode?)`);
  process.exit(1);
}
const TAG = EXE ? 'empaquetada-' : '';
// Las scrollbars flotantes de las páginas se piden en la línea de comandos (ver
// apps/BlackCode/main.cjs). La app empaquetada que arranca SIN el flag se
// relanza sola con él: la segunda pasada del .exe corre así, para probarlo.
// El proceso que lanza el humo termina enseguida y el informe lo deja el
// relanzado, que hereda el entorno.
const FLOTANTES = '--enable-features=OverlayScrollbar';
const command = EXE ? [EXE, [FLOTANTES]] : [electron, [FLOTANTES, path.join(ROOT, 'apps', 'BlackCode')]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SMOKE, { recursive: true });

function run(pass, data) {
  const out = path.join(SMOKE, `blackcode-${TAG}${pass}.json`);
  const shot = path.join(SMOKE, `blackcode-${TAG}${pass}.png`);
  fs.rmSync(out, { force: true });
  const env = {
    ...process.env,
    RAD_SMOKE: out,
    RAD_SMOKE_SHOT: shot,
    RAD_SMOKE_SCRIPT: armarGuion(data),
    RAD_SMOKE_QUIT: 'close', // por el cierre normal: lo pendiente baja en before-quit
    RAD_DATA: data,
    BLACKCODE_PROVEEDOR: 'simulado',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.RAD_SKIN;
  return new Promise((resolve) => {
    const relanza = Boolean(EXE) && pass === 2;
    const child = spawn(command[0], relanza ? [] : command[1], { env, stdio: 'inherit' });
    const killer = setTimeout(() => { console.error(`smoke: blackcode, pasada ${pass}: tiempo agotado, mato el proceso`); child.kill(); }, TIMEOUT_MS);
    child.on('exit', async (code) => {
      clearTimeout(killer);
      // El relanzado no es hijo de este proceso: se espera su informe.
      if (relanza) for (const t0 = Date.now(); !fs.existsSync(out) && Date.now() - t0 < TIMEOUT_MS;) await sleep(500);
      if (!fs.existsSync(out)) return resolve({ ok: false, failures: [`la app salió (código ${code}) sin dejar informe${relanza ? ' (arrancó sin el flag de las scrollbars flotantes: tenía que relanzarse sola con él)' : ''}`] });
      if (relanza) await sleep(400); // que termine de escribirlo
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      report.ok = report.ok && code === 0;
      report.shot = path.relative(ROOT, shot);
      resolve(report);
    });
  });
}

const show = (pass, report) => {
  if (report.ok) {
    console.log(`smoke: blackcode, pasada ${pass} ok  ventana ${report.size.width}x${report.size.height}, captura en ${report.shot}`);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  } else {
    console.error(`smoke: blackcode, pasada ${pass} FALLA`);
    for (const f of report.failures || []) console.error('  ' + f);
    if (report.script) for (const [k, v] of Object.entries(report.script)) console.error(`  (dato) ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
};

// Lo que el guion no puede ver desde la página: el disco.
function checkDisk(data, report) {
  const dir = path.join(data, 'data');
  const failures = [];
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (text.includes(MARCA_DE_LLAVE)) failures.push(`una llave quedó en claro en ${f}`);
  }
  for (const doc of ['_llave.json', '_llave_venice.json', '_llave_tavily.json']) {
    if (!files.includes(doc)) failures.push(`una llave no se guardó (falta ${doc})`);
  }
  // el buscador elegido quedó guardado donde lo lee el proceso principal
  try {
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'busqueda.json'), 'utf8'));
    if (b.proveedor !== 'tavily') failures.push(`el buscador guardado es ${JSON.stringify(b.proveedor)}, no tavily`);
  } catch { failures.push('el buscador elegido no quedó guardado (falta busqueda.json)'); }
  // …y con qué corren los subagentes
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'subagentes.json'), 'utf8'));
    if (s.proveedor !== 'venice' || s.modelo !== 'kimi-k3') failures.push(`el modelo de los subagentes guardado es ${JSON.stringify(s)}, no Venice con kimi-k3`);
  } catch { failures.push('el modelo de los subagentes no quedó guardado (falta subagentes.json)'); }
  // lo que escribieron los subagentes del humo: el de acceso completo sí, el de lectura no
  {
    const en = (f) => { try { return fs.readFileSync(path.join(data, 'workspace', f), 'utf8'); } catch { return null; } };
    if (en('sub-note.txt') !== 'from a subagent\n' || en('sub-asked.txt') !== 'asked\n') failures.push(`lo que escribieron los subagentes: ${JSON.stringify([en('sub-note.txt'), en('sub-asked.txt')])}`);
    if (en('sub-no.txt') !== null) failures.push('un subagente de solo lectura escribió sub-no.txt');
  }
  // Las tools del humo trabajaron en <datos>/workspace: lo que quedó en el
  // disco tiene que ser lo que el guion aprobó, y nada de lo que rechazó.
  const taller = path.join(data, 'workspace');
  const leer = (f) => { try { return fs.readFileSync(path.join(taller, f), 'utf8'); } catch { return null; } };
  if (leer('note.txt') !== 'one\n2\n') failures.push(`note.txt quedó como ${JSON.stringify(leer('note.txt'))}: se esperaba la edición aprobada y no la rechazada`);
  if (leer('auto.txt') !== 'auto\n') failures.push(`auto.txt quedó como ${JSON.stringify(leer('auto.txt'))}`);
  if (leer('x.txt') !== null) failures.push('una llamada con argumentos incompletos escribió un archivo');
  // os_open, en el humo, anota lo que habría abierto en vez de abrirlo.
  if (!/^open .*note\.txt$/m.test(leer('.opened.log') ?? '')) failures.push(`os_open no pidió abrir note.txt: ${JSON.stringify(leer('.opened.log'))}`);
  if (!fs.existsSync(path.join(taller, 'agent.db'))) failures.push('la base propia del agente no quedó en el disco');
  // el canvas: su base, y el archivo que exportó el guion
  if (!fs.existsSync(path.join(taller, 'canvas.db'))) failures.push('la base de los canvas no quedó en el disco');
  if (!fs.existsSync(path.join(taller, 'notes.db'))) failures.push('la base de las notas no quedó en el disco');
  if (leer(path.join('exports', 'sum.js')) !== 'const a = 1;\nconst b = 2;\nconsole.log(a + b);') failures.push(`el canvas exportado quedó como ${JSON.stringify(leer(path.join('exports', 'sum.js')))}`);
  if (!fs.existsSync(path.join(taller, 'code-workspace', 'out.txt'))) failures.push('run_code no dejó su archivo en el taller');
  // generate_image: las imágenes quedaron en archivos (images/<año-mes>/), y la que el guion guardó con «Save as…», en exports
  {
    const dirI = path.join(taller, 'images');
    const guardadas = fs.existsSync(dirI) ? fs.readdirSync(dirI).flatMap((mes) => fs.readdirSync(path.join(dirI, mes)).map((f) => path.join(dirI, mes, f))) : [];
    const esPng = (f) => { const b = fs.readFileSync(f); return b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG'; };
    if (guardadas.length < 11 || !guardadas.every((f) => /image-.*\.png$/.test(f) && esPng(f))) failures.push(`generate_image dejó ${guardadas.length} archivos en images (se esperaban 11 PNG: 2, 4, 4 y 1)`);
    const exportadas = fs.existsSync(path.join(taller, 'exports')) ? fs.readdirSync(path.join(taller, 'exports')).filter((f) => /^image-.*\.png$/.test(f)) : [];
    if (exportadas.length !== 1 || !esPng(path.join(taller, 'exports', exportadas[0]))) failures.push(`«Save as…» de una imagen generada dejó ${exportadas.length} archivos en exports`);
  }
  const borrado = report.script?.chatBorrado;
  if (!borrado) failures.push('el guion no dijo qué chat borró');
  else if (files.some((f) => f.startsWith(`chat-${borrado}.`))) failures.push(`el documento del chat borrado sigue en el disco: ${files.filter((f) => f.startsWith(`chat-${borrado}.`)).join(', ')}`);
  return failures;
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-blackcode-'));
let ok = false;
try {
  const first = await run(1, data);
  if (first.ok) {
    const disk = checkDisk(data, first);
    // Buscar una actualización: abierta desde el repo no hay updater; la
    // empaquetada le pregunta a GitHub de verdad, y cualquiera de las tres
    // respuestas vale (al día, hay una nueva, o no se pudo: sin red, o el
    // repo de releases todavía sin esa versión).
    const fase = first.script?.actualizacion;
    const valen = EXE ? ['al-dia', 'disponible', 'error'] : ['sin-soporte'];
    if (!valen.includes(fase)) disk.push(`buscar una actualización terminó en «${fase}» (${first.script?.actualizacionDice ?? ''}); ${EXE ? 'empaquetada' : 'desde el repo'} se esperaba: ${valen.join(', ')}`);
    if (disk.length) { first.ok = false; first.failures = disk; }
  }
  show(1, first);
  if (first.ok) {
    const second = await run(2, data);
    show(2, second);
    ok = second.ok;
  }
} finally {
  if (process.env.RAD_SMOKE_KEEP) console.log(`smoke: blackcode, los datos quedaron en ${data}`);
  else fs.rmSync(data, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
