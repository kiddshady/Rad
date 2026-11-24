// Test de screen_capture de Nix (apps/Nix/main/tools/captura.cjs), con node
// pelado. Uso: node tools/test-nix-tools-captura.mjs
//
// No fotografía nada: el capturador, las pantallas, los jobs y la consulta a
// Windows por el tamaño de una ventana son de mentira, y las «imágenes» son
// objetos que anotan lo que se les hizo (recortar, reescalar). El «JPEG» que
// devuelven es esa anotación en JSON, así que la prueba lee del data URL qué
// imagen salió.
//
// Lo que este archivo tiene que fijar:
//   - qué ventana gana cuando varias coinciden con el título pedido;
//   - que una captura grande se reescale al lado largo que el modelo procesa,
//     y que una `region` se recorte en píxeles NATIVOS (el zoom trae detalle);
//   - que la ventana de un job se encuentre por su árbol y no por el título,
//     y que `wait` reintente hasta que aparezca;
//   - que la imagen quede para el modelo (run._capturas) y salga al chat;
//   - y cada error con su texto, que es lo que el modelo lee para corregirse.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captura = require(path.join(ROOT, 'apps', 'Nix', 'main', 'tools', 'captura.cjs'));

const failures = [];
let hechas = 0;
const check = (cond, msg) => { hechas++; if (!cond) failures.push(msg); };

// ---------- Lo de mentira ----------
class Imagen {
  constructor(width, height, ops = []) { this.width = width; this.height = height; this.ops = ops; }
  getSize() { return { width: this.width, height: this.height }; }
  isEmpty() { return !(this.width > 0 && this.height > 0); }
  crop(r) { return new Imagen(r.width, r.height, [...this.ops, { crop: r, de: [this.width, this.height] }]); }
  resize({ width, height }) { return new Imagen(width, height, [...this.ops, { resize: [width, height] }]); }
  toJPEG(q) { return Buffer.from(JSON.stringify({ w: this.width, h: this.height, q, ops: this.ops })); }
}
const leer = (dataUrl) => JSON.parse(Buffer.from(String(dataUrl).split(',')[1], 'base64').toString('utf8'));

const MONITORES = [
  { id: 10, size: { width: 3840, height: 2160 }, scaleFactor: 1 },
  { id: 11, size: { width: 1280, height: 720 }, scaleFactor: 1.5 },
];
const pantallas = { getPrimaryDisplay: () => MONITORES[0], getAllDisplays: () => [MONITORES[1], MONITORES[0]] };

let VENTANAS = [];
const pedidos = []; // cada getSources que se hizo
const capturador = {
  async getSources({ types, thumbnailSize }) {
    pedidos.push({ types, thumbnailSize });
    if (types.includes('screen')) {
      return MONITORES.map((m) => ({ id: `screen:${m.id}:0`, display_id: String(m.id), name: `Screen ${m.id}`, thumbnail: new Imagen(thumbnailSize.width, thumbnailSize.height) }));
    }
    return VENTANAS.map((v) => ({ id: `window:${v.hwnd}:0`, name: v.name, thumbnail: v.vacia ? new Imagen(0, 0) : new Imagen(thumbnailSize.width, thumbnailSize.height) }));
  },
};

// El tamaño real de una ventana, que captura.cjs le pregunta a Windows.
const RECTS = { 111: '100 100 420 260', 222: '0 0 1000 700', 333: '-32000 -32000 160 28' };
const execFile = (cmd, args, opts, cb) => {
  const hwnd = /\[IntPtr\](\d+)/.exec(args.at(-1))?.[1];
  if (RECTS[hwnd]) cb(null, RECTS[hwnd] + '\r\n');
  else cb(new Error('sin ventana'), '');
};

let arbolVacio = 0; // cuántas veces más el árbol del job no tiene ventana todavía
const jobs = {
  async arbol(id) {
    if (id === 'j1-abc') {
      const ventanas = arbolVacio-- > 0 ? [] : [{ pid: 7, hwnd: 222, name: 'electron.exe' }];
      return { job: { id, fin: null }, arbol: { procs: [{ pid: 5 }, { pid: 7 }], ventanas } };
    }
    if (id === 'j2-fin') return { job: { id, fin: { code: 0 } }, arbol: null };
    if (id === 'j3-sin') return { job: { id, fin: null }, arbol: null };
    throw new Error(`there is no background job "${id}"`);
  },
  async arbolDe(pid) {
    return pid === 7 ? { procs: [{ pid: 7 }], ventanas: [{ pid: 7, hwnd: 222, name: 'electron.exe' }] } : { procs: [], ventanas: [] };
  },
  estado: (job) => `exited with code ${job.fin.code}`,
  vivos: () => (jobs.hayVivos ? [{ id: 'j1-abc' }] : []),
  hayVivos: false,
};

const nuevoRun = () => {
  const avisos = [];
  return { reqId: 'r1', ac: new AbortController(), avisos, notify: (canal, datos) => avisos.push({ canal, ...datos }) };
};
const sc = (run, args) => captura.runners.screen_capture(run, args);

// ---------- 0. Sin configurar ----------
{
  const run = nuevoRun();
  const out = await sc(run, {});
  check(out.startsWith('error: screen_capture is not available') && !run._capturas && !run.avisos.length, `sin configurar: devolvió «${out}» y avisó ${run.avisos.length} veces`);
}
captura.configurar({ capturador, pantallas, jobs, execFile });

// ---------- 1. Qué ventana gana ----------
{
  const f = (names) => names.map((name, i) => ({ id: `window:${i}:0`, name }));
  const orden = (names, q) => captura.rankearVentanas(f(names), q).map((s) => s.name).join(' | ');
  const todas = ['Astro - Explorador de archivos', 'My Astro', 'Astro Notes Extra', 'Astro', 'Astro Notes', 'Chem Engine'];
  check(orden(todas, 'astro') === 'Astro | Astro Notes | Astro Notes Extra | My Astro | Astro - Explorador de archivos', `ranking de «astro»: ${orden(todas, 'astro')}`);
  check(orden(todas, 'ChemEngine') === 'Chem Engine', `el título se compara sin espacios: ${orden(todas, 'ChemEngine')}`);
  check(orden(todas, ' chem-engine ') === 'Chem Engine', `…ni guiones: ${orden(todas, ' chem-engine ')}`);
  check(orden(todas, 'explorador') === 'Astro - Explorador de archivos', `pedir el Explorador lo encuentra: ${orden(todas, 'explorador')}`);
  check(orden(todas, '') === '' && orden(todas, 'nada-de-esto') === '', 'un título vacío o que no está devuelve ventanas');
  check(orden(['Files - File Explorer', 'Files'], 'files') === 'Files | Files - File Explorer', `el Explorador en inglés también va último: ${orden(['Files - File Explorer', 'Files'], 'files')}`);
}

// ---------- 2. Un monitor ----------
{
  pedidos.length = 0;
  const run = nuevoRun();
  const out = await sc(run, {});
  check(out === 'captured display 1 of 2: 1568×882 px (native 3840×2160). A region you pass later uses this image\'s pixel coordinates. The image is attached.', `monitor principal: «${out}»`);
  check(pedidos.length === 1 && pedidos[0].types.join() === 'screen' && pedidos[0].thumbnailSize.width === 3840 && pedidos[0].thumbnailSize.height === 2160, `monitor principal: se pidió ${JSON.stringify(pedidos)}`);
  check(run._capturas?.length === 1 && run._capturas[0].startsWith('data:image/jpeg;base64,'), 'monitor principal: la imagen no quedó para el modelo');
  const img = leer(run._capturas[0]);
  check(img.w === 1568 && img.h === 882 && img.q === 85 && img.ops.length === 1 && img.ops[0].resize?.join() === '1568,882', `monitor principal: la imagen que salió es ${JSON.stringify(img)}`);
  const actividad = run.avisos.find((a) => a.canal === 'tool:activity');
  const artefacto = run.avisos.find((a) => a.canal === 'tool:artifact');
  check(actividad?.kind === 'screen_capture' && actividad.label === 'screen', `monitor principal: la fila dice «${actividad?.label}»`);
  check(artefacto?.images?.length === 1 && artefacto.images[0].name === 'screen_capture.jpg' && artefacto.images[0].dataUrl === run._capturas[0], 'monitor principal: al chat no salió la misma imagen que ve el modelo');

  // el segundo: su tamaño en píxeles reales es el lógico por su escala
  pedidos.length = 0;
  const run2 = nuevoRun();
  const out2 = await sc(run2, { display: 2 });
  check(out2.startsWith('captured display 2 of 2: 1568×882 px (native 1920×1080)'), `segundo monitor: «${out2}»`);
  check(pedidos[0].thumbnailSize.width === 1920 && pedidos[0].thumbnailSize.height === 1080, `segundo monitor: se pidió a ${JSON.stringify(pedidos[0].thumbnailSize)}`);
  check(run2.avisos.find((a) => a.canal === 'tool:activity')?.label === 'display 2', 'segundo monitor: la fila no lo nombra');

  const run3 = nuevoRun();
  const out3 = await sc(run3, { display: 3 });
  check(out3 === 'error: there is no display 3 — this machine has 2' && !run3._capturas, `un monitor que no existe: «${out3}»`);
}

// ---------- 3. Una región: se recorta en píxeles nativos ----------
{
  const run = nuevoRun();
  const out = await sc(run, { region: { x: 784, y: 441, width: 392, height: 220 } });
  const img = leer(run._capturas[0]);
  const corte = img.ops[0]?.crop;
  // la captura completa que vio el modelo es 1568×882 de una de 3840×2160: ×2,449
  check(corte && corte.x === 1920 && corte.y === 1080 && corte.width === 960 && corte.height === 539 && img.ops.length === 1, `región: el recorte fue ${JSON.stringify(img.ops)}`);
  check(out === 'captured a region of display 1 of 2 at native resolution: 960×539 px (the full capture is 1568×882). The image is attached.', `región: «${out}»`);
  check(run.avisos.find((a) => a.canal === 'tool:activity')?.label === 'screen · region', 'región: la fila no dice que es una región');

  // una región más grande que el tope se recorta nativa y después se reescala
  const runG = nuevoRun();
  await sc(runG, { region: { x: 0, y: 0, width: 1568, height: 441 } });
  const g = leer(runG._capturas[0]);
  check(g.ops[0].crop.width === 3840 && g.ops[0].crop.height === 1080 && g.ops[1]?.resize?.join() === '1568,441', `región grande: ${JSON.stringify(g.ops)}`);

  // una que se sale del borde se recorta hasta el borde
  const runB = nuevoRun();
  await sc(runB, { region: { x: 1500, y: 800, width: 500, height: 500 } });
  const b = leer(runB._capturas[0]).ops[0].crop;
  check(b.x + b.width === 3840 && b.y + b.height === 2160, `región contra el borde: ${JSON.stringify(b)}`);

  const runF = nuevoRun();
  const outF = await sc(runF, { region: { x: 5000, y: 0, width: 10, height: 10 } });
  check(outF === 'error: that region falls outside the capture — the full capture of display 1 of 2 is 1568×882' && !runF._capturas, `región afuera: «${outF}»`);
}

// ---------- 4. Una ventana por su título ----------
VENTANAS = [
  { hwnd: 112, name: 'Nix - Explorador de archivos' },
  { hwnd: 111, name: 'Nix' },
  { hwnd: 333, name: 'Minimizada' },
  { hwnd: 444, name: 'Vacia', vacia: true },
  { hwnd: 222, name: 'My App' },
];
{
  pedidos.length = 0;
  const run = nuevoRun();
  const out = await sc(run, { window: 'nix' });
  check(out === 'captured window "Nix" (also matched: "Nix - Explorador de archivos"): 420×260 px (native 420×260). A region you pass later uses this image\'s pixel coordinates. The image is attached.', `ventana: «${out}»`);
  check(pedidos.length === 2 && pedidos[0].thumbnailSize.width === 0 && pedidos[1].thumbnailSize.width === 420 && pedidos[1].thumbnailSize.height === 260, `ventana: se eligió sin miniaturas y se capturó a su tamaño real: ${JSON.stringify(pedidos.map((p) => p.thumbnailSize))}`);
  check(leer(run._capturas[0]).ops.length === 0, 'ventana chica: se reescaló sin hacer falta');
  check(run.avisos.find((a) => a.canal === 'tool:activity')?.label === 'window "nix"', 'ventana: la fila no dice cuál');

  // sin tamaño real (Windows no lo dio): se captura a un tamaño fijo y se avisa
  const run2 = nuevoRun();
  const out2 = await sc(run2, { window: 'explorador' });
  check(out2.includes('captured window "Nix - Explorador de archivos": 1568×882 px (the window\'s real size could not be read, so it may be scaled)'), `ventana sin tamaño: «${out2}»`);

  // una minimizada se reporta en -32000: ese tamaño no es el suyo
  const run3 = nuevoRun();
  const out3 = await sc(run3, { window: 'minimizada' });
  check(out3.includes("real size could not be read"), `ventana minimizada: «${out3}»`);

  const run4 = nuevoRun();
  const out4 = await sc(run4, { window: 'vacia' });
  check(out4 === 'error: window "Vacia" gave an empty image — it is probably minimized' && !run4._capturas, `ventana vacía: «${out4}»`);

  const run5 = nuevoRun();
  const out5 = await sc(run5, { window: 'no-existe' });
  check(out5.startsWith('error: no open window title matches "no-existe". Open windows:\n- Nix - Explorador de archivos\n- Nix\n') && !out5.includes('job_start'), `ventana que no está: «${out5}»`);
  jobs.hayVivos = true;
  const out6 = await sc(nuevoRun(), { window: 'no-existe' });
  check(out6.endsWith('If it is an app you started with job_start, pass `job` with its id instead of a title.'), 'ventana que no está, con jobs vivos: falta la pista del job');
  jobs.hayVivos = false;
}

// ---------- 5. La ventana de un job, o de un pid ----------
{
  const run = nuevoRun();
  const out = await sc(run, { job: 'j1-abc' });
  check(out.startsWith('captured window "My App" (electron.exe pid 7, from job j1-abc): 1000×700 px (native 1000×700)'), `job: «${out}»`);
  check(run.avisos.find((a) => a.canal === 'tool:activity')?.label === 'job j1-abc', 'job: la fila no lo nombra');

  const outT = await sc(nuevoRun(), { job: 'j1-abc', window: 'otra' });
  check(outT === 'error: job j1-abc is running (2 processes) but has no visible window whose title matches "otra" yet — pass `wait` (seconds) to wait for it to open', `job con un título que no es suyo: «${outT}»`);

  const outF = await sc(nuevoRun(), { job: 'j2-fin', wait: 5 });
  check(outF === 'error: job j2-fin is not running: exited with code 0', `job terminado: «${outF}» (no tiene que esperar)`);
  const outN = await sc(nuevoRun(), { job: 'j9-zzz' });
  check(outN === 'error: there is no background job "j9-zzz"', `job que no existe: «${outN}»`);
  const outS = await sc(nuevoRun(), { job: 'j3-sin' });
  check(outS.startsWith('error: could not read the process list to find its windows'), `job sin árbol: «${outS}»`);

  // `wait`: la ventana aparece al segundo intento
  arbolVacio = 1;
  const t0 = Date.now();
  const outW = await sc(nuevoRun(), { job: 'j1-abc', wait: 5 });
  const tardo = Date.now() - t0;
  check(outW.startsWith('captured window "My App"') && tardo >= 600 && tardo < 3000, `wait: «${outW.slice(0, 60)}» en ${tardo} ms`);
  // …y si no aparece, lo dice con lo que esperó
  arbolVacio = 99;
  const outE = await sc(nuevoRun(), { job: 'j1-abc', wait: 1 });
  check(outE === 'error: job j1-abc is running (2 processes) but has no visible window (waited 1s)', `wait vencido: «${outE}»`);
  // un Stop corta la espera
  const runStop = nuevoRun();
  setTimeout(() => runStop.ac.abort(), 150);
  const t1 = Date.now();
  await sc(runStop, { job: 'j1-abc', wait: 20 });
  check(Date.now() - t1 < 2500, `wait: un Stop no cortó la espera (${Date.now() - t1} ms)`);
  arbolVacio = 0;

  const outP = await sc(nuevoRun(), { pid: 7 });
  check(outP.startsWith('captured window "My App" (electron.exe pid 7, from pid 7)'), `pid: «${outP}»`);
  const outP2 = await sc(nuevoRun(), { pid: 999 });
  check(outP2 === 'error: there is no running process with pid 999', `pid que no existe: «${outP2}»`);
}

// ---------- 6. El tope del lado largo ----------
check(captura.CAPTURA_LADO === 1568 && captura.escalaCaptura(800, 600) === 1 && captura.escalaCaptura(3136, 100) === 0.5, 'el tope del lado largo cambió');

if (failures.length) {
  console.error(`test-nix-tools-captura: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-nix-tools-captura: ok (${hechas} comprobaciones: sin configurar, qué ventana gana, monitores, regiones en píxeles nativos, ventanas por título, por job y por pid, la espera y cada error)`);
process.exit(0);
