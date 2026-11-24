// Test de las tools de código y de escritorio de BlackCode
// (apps/BlackCode/main/tools/code.cjs y abrir.cjs), con node pelado.
// Uso: node tools/test-blackcode-tools-code.mjs
//
// NeonCode, de donde se portó el código, no tiene un test propio de run_code
// ni de os_open: lo que sus suites dicen de estas dos tools (test-guardrails.js)
// son cuatro comprobaciones del despachador, y están acá al principio. El resto
// es lo que hace falta para saber que el port quedó cableado igual. Cuatro
// bancos:
//
//   - un `runProc` FALSO para run_code: cada proceso que la tool quiere lanzar
//     (el `--version` de Python, el venv, pip, el script) queda anotado y
//     contesta lo que el test quiera. Así se prueban el venv y pip SIN instalar
//     nada, y los topes del reloj sin esperarlos;
//   - procesos de VERDAD con Node (el binario que corre este test), adentro de
//     una carpeta descartable;
//   - lo mismo con Python, solo si hay un intérprete en el PATH (si no hay, se
//     saltea y la última línea lo dice);
//   - un `shell` FALSO para os_open, que anota cada llamada. Este archivo no
//     abre nada de verdad: nunca recibe el `shell` de Electron.
//
// Lo que este archivo tiene que fijar:
//   - que run_code corra en su carpeta de trabajo y cuente qué archivos dejó;
//   - que un exit code, un timeout y un Stop se digan cada uno con su nombre;
//   - que el script temporal no quede tirado;
//   - que las imágenes salgan por alProducir y por ningún otro lado;
//   - que os_open no lance nada que ejecute, ni una URL que no sea http(s), y
//     que sin `shell` no abra nada.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const base = require(path.join(TOOLS, 'base.cjs'));
const shell = require(path.join(TOOLS, 'shell.cjs'));
const motor = require(path.join(TOOLS, 'motor.cjs'));
const code = require(path.join(TOOLS, 'code.cjs'));
const abrir = require(path.join(TOOLS, 'abrir.cjs'));

const failures = [];
let hechas = 0;
let seccionActual = '';
const seccion = (s) => { seccionActual = s; };
const ok_ = (name, cond, extra = '') => {
  hechas++;
  if (!cond) failures.push(`[${seccionActual}] ${name}${extra === '' || extra == null ? '' : `  → ${extra}`}`);
};
const t = (name, got, want) => {
  hechas++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`[${seccionActual}] ${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`);
  }
};

// Una promesa suelta que se rechaza (un alProducir asíncrono que falla, por
// ejemplo) no puede pasar callada.
process.on('unhandledRejection', (e) => { failures.push(`[${seccionActual}] promesa rechazada sin nadie que la atienda: ${e?.stack || e}`); });

// ── la carpeta descartable ───────────────────────────────────────────────────

const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-code-')));
const WS = path.join(TMP, 'ws');           // la del banco falso: NO se crea acá, la tiene que crear la tool
const WS_VENV = path.join(TMP, 'ws-venv'); // la del venv de mentira
const WS_NODE = path.join(TMP, 'ws-node'); // la de los procesos de verdad
const WS_PY = path.join(TMP, 'ws-py');
const ESCRITORIO = path.join(TMP, 'escritorio'); // lo que os_open "abre"
fs.mkdirSync(ESCRITORIO);

const scriptsSueltos = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => /^blackcode-run-[0-9a-f]{12}\.(js|py)$/.test(n)));
const sueltosAntes = scriptsSueltos();

const hacerRun = (reqId = 'r1') => {
  const run = { ac: new AbortController(), reqId, avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};

// Una promesa que NO puede colgar el test: si el código bajo prueba no resuelve,
// esto falla con un mensaje en vez de dejar la suite corriendo para siempre.
const conTecho = (p, ms, qué) => {
  let reloj = null;
  return Promise.race([
    p,
    new Promise((_, rej) => { reloj = setTimeout(() => rej(new Error(`${qué}: no resolvió en ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(reloj));
};
const sinColgar = async (p, ms, qué) => {
  try { return await conTecho(p, ms, qué); } catch (e) { return `NO RESOLVIÓ (${e.message})`; }
};
const correr = (run, args, ms = 60000) => sinColgar(code.runners.run_code(run, args), ms, `run_code ${String(JSON.stringify(args)).slice(0, 80)}`);

// ── el banco falso de run_code ───────────────────────────────────────────────

const R = (r = {}) => ({ ok: true, code: 0, out: '', err: '', timedOut: false, aborted: false, cortado: false, ...r });
let pedidos = [];   // cada runProc que la tool pidió
/** Pone un runProc falso. `guion(o)` devuelve lo que cambia de una respuesta
 *  buena y vacía. Ponerlo olvida el Python que se había encontrado. */
const falso = (guion = () => ({})) => {
  pedidos = [];
  code.configurar({ runProc: async (o) => { pedidos.push(o); return R(await guion(o)); } });
};
const esVersion = (o) => o.args[0] === '--version';
const sinVersion = () => pedidos.filter((o) => !esVersion(o));
/** Un guion donde `py` existe y el resto lo decide `resto(o)`. */
const conPy = (resto = () => ({})) => (o) => (esVersion(o) ? (o.bin === 'py' ? { out: 'Python 3.13.1\n' } : { ok: false, code: -1 }) : resto(o));

let pythonDeVerdad = null;
let pythonSalteado = false;

try {
  // ═══ Lo que NeonCode ya comprobaba de estas dos tools ══════════════════════
  // Son del despachador (test-guardrails.js, M1 y el congelado de rutas), y se
  // traen porque dependen de cómo se llaman las cosas de estos dos módulos.
  seccion('lo que traía NeonCode');

  t('os_open lee target, que es como se llama su parámetro',
    motor.argsDigest('os_open', { target: 'C:\\tools\\BlackCode\\README.md' }), 'README.md');
  ok_('un exit code != 0 de run_code es una falla', motor.failedOut('Traceback…\n[exit code 1]', 'run_code'));
  // el target de os_open puede ser una URL: resolverla como ruta la rompería.
  // El despachador decide con classifyOsTarget cuál de las dos es.
  t('una URL NO es una ruta', abrir.classifyOsTarget('https://ollama.com/v1'), { kind: 'url', url: 'https://ollama.com/v1' });
  t('pero un path de os_open sí', abrir.classifyOsTarget('notas.md'), { kind: 'path' });

  // ═══ El cableado ═══════════════════════════════════════════════════════════
  seccion('cableado de run_code');

  t('code.cjs exporta lo que dice', Object.keys(code).sort(),
    ['IMG_MIME', 'configurar', 'humanSize', 'resolvePython', 'runCode', 'runners', 'snapshotWs', 'workspaceDir']);
  t('y su runner es run_code', Object.keys(code.runners), ['run_code']);

  {
    // Sin configurar, la carpeta de trabajo cae en la temporal del sistema. Se
    // mira ANTES de configurar nada, y solo se borra si la creó este test y
    // quedó vacía: si ya estaba, es de otro.
    const esperada = path.join(os.tmpdir(), 'blackcode-code-workspace');
    const estaba = fs.existsSync(esperada);
    const d = code.workspaceDir();
    t('sin configurar, la carpeta de trabajo está en la temporal del sistema', d, esperada);
    ok_('y la crea', fs.statSync(d).isDirectory());
    if (!estaba) { try { fs.rmdirSync(d); } catch { /* no quedó vacía: no es mía */ } }
  }

  code.configurar({ workspace: () => WS });
  t('con workspace() configurado, es la que diga', code.workspaceDir(), WS);
  ok_('y también la crea', fs.statSync(WS).isDirectory());

  {
    const run = hacerRun();
    falso();
    t('sin código no corre nada', await correr(run, { language: 'node' }), 'error: code is required');
    t('ni con el código en blanco', await correr(run, { language: 'python', code: '   \n ' }), 'error: code is required');
    t('ni con los argumentos vacíos', await correr(run, undefined), 'error: code is required');
    t('ninguno de los tres lanzó un proceso', pedidos.length, 0);
    t('ni avisó a la interfaz', run.avisos.length, 0);
  }

  // ═══ Python, con procesos de mentira ═══════════════════════════════════════
  seccion('run_code: Python con runProc falso');

  {
    falso(() => ({ ok: false, code: -1, err: 'spawn ENOENT' }));
    const run = hacerRun();
    t('sin intérprete lo dice, con lo que probó', await correr(run, { language: 'python', code: 'print(1)' }),
      'error: no Python interpreter found (tried py, python, python3). Install Python, or use language "node".');
    t('probó los tres, en ese orden', pedidos.map((o) => [o.bin, o.args, o.timeoutMs]),
      [['py', ['--version'], 5000], ['python', ['--version'], 5000], ['python3', ['--version'], 5000]]);
    t('avisa a la interfaz con el lenguaje', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'run_code', label: 'python' }]]);
  }

  {
    // `py` no está y `python` contesta su versión por stderr con un exit raro:
    // alcanza con que diga "Python N".
    let alCorrer = null;
    falso((o) => {
      if (esVersion(o)) return o.bin === 'python' ? { ok: false, code: 1, err: 'Python 3.13.1' } : { ok: false, code: -1 };
      const script = o.args[1];
      alCorrer = { existe: fs.existsSync(script), texto: fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : null };
      return { out: 'hola\n' };
    });
    const run = hacerRun();
    const txt = await correr(run, { language: 'python', code: 'print("hola")' });
    t('con Python y sin pip corre el intérprete del sistema', txt, 'hola');
    const o = sinVersion()[0];
    t('lo lanza sin buffer, con el script como argumento', [o.bin, o.args[0], o.args.length], ['python', '-u', 2]);
    t('en la carpeta de trabajo y con 30 s de reloj', [o.cwd, o.timeoutMs], [WS, 30000]);
    ok_('con la señal de la corrida, para que el Stop lo mate', o.signal === run.ac.signal);
    ok_('y con el entorno de la app', o.env && o.env.PATH === process.env.PATH);
    ok_('el script va a la temporal del sistema, con nombre propio y al azar',
      path.dirname(o.args[1]) === os.tmpdir() && /^blackcode-run-[0-9a-f]{12}\.py$/.test(path.basename(o.args[1])), o.args[1]);
    t('mientras corre, el script existe y es el código pedido', alCorrer, { existe: true, texto: 'print("hola")' });
    ok_('y cuando termina se borra', !fs.existsSync(o.args[1]));
    ok_('sin pip no se crea ningún venv', !fs.existsSync(path.join(WS, '.venv')));

    // el intérprete encontrado se recuerda: la segunda vez no vuelve a preguntar
    const antes = pedidos.length;
    await correr(hacerRun(), { code: 'print(2)' });
    t('la segunda corrida no vuelve a buscar el intérprete', pedidos.slice(antes).map((p) => p.args[0]), ['-u']);
    const run3 = hacerRun();
    await correr(run3, { language: 'ruby', code: 'puts 1' });
    t('un lenguaje que no es "node" se toma como python', [run3.avisos[0][1].label, pedidos.at(-1).bin], ['python', 'python']);
  }

  {
    // Lo que se arma con cada respuesta del proceso.
    let respuesta = {};
    falso(conPy(() => respuesta));
    const run = hacerRun();
    const py = (extra = {}) => correr(run, { language: 'python', code: 'x', ...extra });
    respuesta = { out: 'a\n', err: 'un warning\n' };
    t('stdout y después stderr, con su marca', await py(), 'a\n\n[stderr]\nun warning');
    respuesta = { ok: false, code: 3 };
    t('un exit code != 0 se dice', await py(), '[exit code 3]');
    respuesta = { ok: false, code: null, timedOut: true, out: 'parcial\n' };
    t('un timeout se dice con su duración y conserva lo que salió', await py({ timeout: 2 }), 'parcial\n\n[timed out after 2s — process tree killed]');
    respuesta = { ok: false, code: null, aborted: true, out: 'parcial\n' };
    const parado = await py();
    t('un Stop se dice como Stop', parado, 'parcial\n\n[stopped by the user — process tree killed]');
    ok_('y no como timeout ni como exit code', !/timed out|exit code/.test(parado), parado);
    respuesta = {};
    t('sin salida, lo dice', await py(), '(no output)');
    respuesta = { err: '   \n' };
    t('un stderr en blanco no agrega su marca', await py(), '(no output)');
  }

  {
    // Un runProc que TIRA: el runner devuelve el error como texto y limpia.
    let script = null;
    falso(conPy((o) => { script = o.args[1]; throw new Error('boom'); }));
    t('si lanzar el proceso tira, vuelve como «error: …»', await correr(hacerRun(), { language: 'python', code: 'x' }), 'error: boom');
    ok_('y el script temporal igual se borra', script && !fs.existsSync(script), script);
  }

  // ═══ El venv y pip, sin instalar nada ══════════════════════════════════════
  seccion('run_code: venv y pip (de mentira)');

  {
    code.configurar({ workspace: () => WS_VENV });
    const venvPy = path.join(WS_VENV, '.venv', 'Scripts', 'python.exe');
    let pip = { ok: true };
    let creaVenv = true;
    falso(conPy((o) => {
      if (o.args[1] === 'venv') {
        if (creaVenv) { fs.mkdirSync(path.dirname(venvPy), { recursive: true }); fs.writeFileSync(venvPy, ''); }
        return {};
      }
      if (o.args[1] === 'pip') return pip;
      return { out: 'listo\n' };
    }));

    // el venv no se puede crear: no se corre nada
    creaVenv = false;
    const run0 = hacerRun();
    t('si el venv no aparece, lo dice y no sigue', await correr(run0, { language: 'python', code: 'x', pip: ['matplotlib'] }),
      'error: could not create the Python virtualenv in the workspace');
    t('  y no llegó a pip ni al script', sinVersion().map((o) => o.args[1]), ['venv']);

    creaVenv = true;
    pedidos = [];
    const run = hacerRun();
    const txt = await correr(run, { language: 'python', code: 'x', pip: ['matplotlib', 'pandas'] });
    const [v, p, s] = sinVersion();
    t('con pip, primero crea el venv con el Python del sistema',
      [v.bin, v.args, v.cwd, v.timeoutMs], ['py', ['-m', 'venv', '--system-site-packages', '.venv'], WS_VENV, 120000]);
    t('después instala con el pip del venv',
      [p.bin, p.args, p.cwd, p.timeoutMs],
      [venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'matplotlib', 'pandas'], WS_VENV, 180000]);
    t('y corre el script con el Python del venv', [s.bin, s.args[0], sinVersion().length], [venvPy, '-u', 3]);
    ok_('los tres con la señal de la corrida', [v, p, s].every((o) => o.signal === run.ac.signal));
    t('y cuenta qué instaló antes de la salida', txt, '[installed: matplotlib, pandas]\n\nlisto');

    // el venv ya está: sin pip no se instala nada, pero se usa
    pedidos = [];
    t('con el venv ya creado y sin pip, corre igual', await correr(hacerRun(), { language: 'python', code: 'x' }), 'listo');
    t('  con el Python del venv y sin volver a crearlo ni instalar', sinVersion().map((o) => [o.bin, o.args[0]]), [[venvPy, '-u']]);
    pedidos = [];
    await correr(hacerRun(), { language: 'python', code: 'x', pip: [] });
    await correr(hacerRun(), { language: 'python', code: 'x', pip: 'matplotlib' });
    t('una lista vacía o un `pip` que no es una lista no instalan nada', sinVersion().map((o) => o.args[0]), ['-u', '-u']);
    pedidos = [];
    await correr(hacerRun(), { language: 'python', code: 'x', pip: [123] });
    t('los nombres van como texto', sinVersion()[0].args.at(-1), '123');

    // pip falla: se dice y el script corre igual
    pip = { ok: false, code: 1, err: 'ERROR: No matching distribution found for nope' };
    pedidos = [];
    t('si pip falla lo cuenta y corre igual', await correr(hacerRun(), { language: 'python', code: 'x', pip: ['nope'] }),
      '[pip install had issues:\nERROR: No matching distribution found for nope]\n\nlisto');
    pip = { ok: false, code: 1, out: 'salió por stdout' };
    ok_('  y sin stderr muestra el stdout de pip',
      (await correr(hacerRun(), { language: 'python', code: 'x', pip: ['nope'] })).startsWith('[pip install had issues:\nsalió por stdout]'));
    code.configurar({ workspace: () => WS });
  }

  // ═══ Node, con procesos de mentira ═════════════════════════════════════════
  seccion('run_code: Node con runProc falso');

  {
    const teníaRAN = process.env.ELECTRON_RUN_AS_NODE;
    falso();
    const run = hacerRun();
    await correr(run, { language: 'node', code: 'console.log(1)' });
    const o = pedidos[0];
    t('Node no busca ningún intérprete: usa el binario de la app', [pedidos.length, o.bin], [1, process.execPath]);
    t('como Node (ELECTRON_RUN_AS_NODE) y con el script solo', [o.env.ELECTRON_RUN_AS_NODE, o.args.length, path.extname(o.args[0])], ['1', 1, '.js']);
    t('sin tocar el entorno de este proceso', process.env.ELECTRON_RUN_AS_NODE, teníaRAN);
    t('avisa a la interfaz con el lenguaje', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'run_code', label: 'node' }]]);

    // Los topes del reloj: 30 s si no se pide nada, y nunca más de 2 minutos.
    pedidos = [];
    for (const timeout of [undefined, 500, 0.2, 'abc']) await correr(hacerRun(), { language: 'node', code: 'x', timeout });
    t('sin timeout son 30 s, el techo son 2 min, el piso 1 s y lo que no es un número son 30 s',
      pedidos.map((p) => p.timeoutMs), [30000, 120000, 1000, 30000]);
  }

  // ═══ Qué archivos dejó la corrida ══════════════════════════════════════════
  seccion('run_code: los archivos que dejó');

  t('humanSize', [0, 1023, 1024, 1536, 1048576, 5 * 1048576 + 1].map(code.humanSize), ['0 B', '1023 B', '1.0 KB', '1.5 KB', '1.0 MB', '5.0 MB']);

  {
    fs.writeFileSync(path.join(WS, 'quieto.txt'), 'no me tocan');
    fs.writeFileSync(path.join(WS, 'viejo.txt'), 'antes');
    const hace10s = new Date(Date.now() - 10000);
    fs.utimesSync(path.join(WS, 'viejo.txt'), hace10s, hace10s);
    fs.utimesSync(path.join(WS, 'quieto.txt'), hace10s, hace10s);
    t('snapshotWs mira solo archivos del primer nivel', Object.keys(code.snapshotWs(WS)).sort(), ['quieto.txt', 'viejo.txt']);
    t('y de una carpeta que no existe no trae nada', code.snapshotWs(path.join(TMP, 'no-existe')), {});

    falso((o) => {
      fs.writeFileSync(path.join(o.cwd, 'nuevo.csv'), 'a,b\n');
      fs.writeFileSync(path.join(o.cwd, 'viejo.txt'), 'después, y más largo');
      fs.mkdirSync(path.join(o.cwd, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(o.cwd, 'sub', 'adentro.txt'), 'x');
      fs.writeFileSync(path.join(o.cwd, 'kilos.bin'), Buffer.alloc(2048));
      return { out: 'hecho\n' };
    });
    const txt = await correr(hacerRun(), { language: 'node', code: 'x' });
    const [cabeza, lista] = txt.split('\n\nFiles written to the workspace:\n');
    t('la salida va primero', cabeza, 'hecho');
    t('y abajo los archivos nuevos o reescritos, con ruta absoluta y tamaño', (lista || '').split('\n').sort(),
      [`- ${path.join(WS, 'kilos.bin')} (2.0 KB)`, `- ${path.join(WS, 'nuevo.csv')} (4 B)`, `- ${path.join(WS, 'viejo.txt')} (${Buffer.byteLength('después, y más largo')} B)`]);
    ok_('lo que no se tocó no figura', !/quieto\.txt/.test(txt), txt);
    ok_('ni lo que quedó adentro de una subcarpeta', !/adentro\.txt/.test(txt), txt);

    falso(() => ({ out: 'nada nuevo\n' }));
    t('si no dejó nada, no hay lista', await correr(hacerRun(), { language: 'node', code: 'x' }), 'nada nuevo');

    falso((o) => { for (let i = 0; i < 23; i++) fs.writeFileSync(path.join(o.cwd, `lote-${String(i).padStart(2, '0')}.txt`), 'x'); return {}; });
    const muchos = await correr(hacerRun(), { language: 'node', code: 'x' });
    t('lista hasta 20 y cuenta el resto', [muchos.split('\n').filter((l) => l.startsWith('- ')).length, muchos.split('\n').at(-1)], [20, '…and 3 more']);
    ok_('y sin salida igual dice «(no output)» arriba', muchos.startsWith('(no output)\n\nFiles written to the workspace:\n'), muchos.slice(0, 60));
  }

  // ═══ Las imágenes ══════════════════════════════════════════════════════════
  // NeonCode las mandaba a la ventana (run.notify 'tool:artifact') y las sumaba
  // a run.artifacts. Acá salen por alProducir y por ningún otro lado.
  seccion('run_code: las imágenes salen por alProducir');

  {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
    const dibujar = (o) => {
      fs.writeFileSync(path.join(o.cwd, 'grafico.png'), png);
      fs.writeFileSync(path.join(o.cwd, 'vector.SVG'), svg);
      fs.writeFileSync(path.join(o.cwd, 'enorme.png'), Buffer.alloc(3 * 1024 * 1024 + 1));
      fs.writeFileSync(path.join(o.cwd, 'tabla.csv'), 'a,b\n');
      return { out: 'dibujé\n' };
    };

    // sin configurar: no pasa nada más que el texto
    falso(dibujar);
    const run0 = hacerRun();
    const txt0 = await correr(run0, { language: 'node', code: 'x' });
    ok_('sin alProducir, la corrida igual lista las imágenes como archivos', /grafico\.png \(\d+ B\)/.test(txt0) && /enorme\.png \(3\.0 MB\)/.test(txt0), txt0);
    t('no avisa nada más a la interfaz', run0.avisos.map((a) => a[0]), ['tool:activity']);
    ok_('ni le cuelga nada a la corrida', !('artifacts' in run0));

    const vistas = [];
    code.configurar({ alProducir: (run, imgs) => { vistas.push({ run, imgs }); } });
    falso(dibujar);
    const run = hacerRun();
    const txt = await correr(run, { language: 'node', code: 'x' });
    t('con alProducir, se lo llama una vez', vistas.length, 1);
    ok_('con la corrida', vistas[0]?.run === run);
    const imgs = [...(vistas[0]?.imgs || [])].sort((a, b) => a.name.localeCompare(b.name));
    t('y con las imágenes de hasta 3 MB, por nombre', imgs.map((i) => i.name), ['grafico.png', 'vector.SVG']);
    t('cada una como data URL con su tipo', imgs.map((i) => i.dataUrl),
      [`data:image/png;base64,${png.toString('base64')}`, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]);
    t('el texto para el modelo es el mismo que sin alProducir', txt, txt0);
    ok_('y sigue sin tocar la corrida ni avisar por su cuenta', !('artifacts' in run) && run.avisos.length === 1);

    vistas.length = 0;
    falso((o) => { fs.writeFileSync(path.join(o.cwd, 'solo.csv'), 'x'); return {}; });
    await correr(hacerRun(), { language: 'node', code: 'x' });
    t('sin imágenes no se llama a alProducir', vistas.length, 0);

    // alProducir es de afuera: si falla, la corrida ya pasó y su resultado vale
    falso(dibujar);
    code.configurar({ alProducir: () => { throw new Error('la ventana se cerró'); } });
    ok_('si alProducir tira, el resultado de la corrida no se pierde', (await correr(hacerRun(), { language: 'node', code: 'x' })).startsWith('dibujé\n\nFiles written'));
    code.configurar({ alProducir: async () => { throw new Error('la ventana se cerró'); } });
    ok_('y si es asíncrono y se rechaza, tampoco', (await correr(hacerRun(), { language: 'node', code: 'x' })).startsWith('dibujé\n\nFiles written'));
    await new Promise((r) => setTimeout(r, 20)); // que un rechazo suelto llegue a notarse
    code.configurar({ alProducir: () => {} });
  }

  // ═══ Node de verdad ════════════════════════════════════════════════════════
  seccion('run_code: Node de verdad');
  code.configurar({ runProc: shell.runProc, workspace: () => WS_NODE });

  {
    const run = hacerRun();
    const txt = await correr(run, {
      language: 'node',
      code: [
        "const fs = require('fs');",
        "console.log('hola ñandú');",
        "console.log('cwd=' + process.cwd());",
        "console.log('yo=' + __filename);",
        "console.log('ran=' + process.env.ELECTRON_RUN_AS_NODE);",
        "fs.writeFileSync('salida.csv', 'a,b\\n1,2\\n');",
      ].join('\n'),
    });
    const dato = (k) => (txt.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1];
    ok_('corre el fragmento y trae su stdout, en UTF-8', txt.startsWith('hola ñandú\n'), txt);
    t('en la carpeta de trabajo', dato('cwd'), WS_NODE);
    t('con ELECTRON_RUN_AS_NODE puesto', dato('ran'), '1');
    ok_('desde un script en la temporal del sistema', path.dirname(dato('yo') || '') === os.tmpdir() && /^blackcode-run-[0-9a-f]{12}\.js$/.test(path.basename(dato('yo') || '')), dato('yo'));
    ok_('que se borra al terminar', dato('yo') && !fs.existsSync(dato('yo')));
    ok_('y reporta el archivo que escribió, con ruta absoluta y tamaño',
      txt.endsWith(`\n\nFiles written to the workspace:\n- ${path.join(WS_NODE, 'salida.csv')} (8 B)`), txt);
    t('el archivo quedó en la carpeta de trabajo', fs.readFileSync(path.join(WS_NODE, 'salida.csv'), 'utf8'), 'a,b\n1,2\n');
    ok_('una corrida que anduvo no cuenta como falla', !motor.failedOut(txt, 'run_code'), txt);

    // la carpeta de trabajo persiste: la corrida siguiente ve lo de la anterior
    const otra = await correr(hacerRun(), { language: 'node', code: "console.log(require('fs').readFileSync('salida.csv', 'utf8').length)" });
    t('la corrida siguiente encuentra lo que dejó la anterior, y no lo reporta como nuevo', otra, '8');
  }

  {
    const txt = await correr(hacerRun(), { language: 'node', code: "console.error('se rompió'); process.exit(3);" });
    t('un exit code != 0 llega al texto, después del stderr', txt, '[stderr]\nse rompió\n\n[exit code 3]');
    ok_('y el despachador lo cuenta como falla', motor.failedOut(txt, 'run_code'));
    const tirado = await correr(hacerRun(), { language: 'node', code: "throw new Error('boom');" });
    ok_('una excepción trae su traza por stderr y exit code 1', /\[stderr\]/.test(tirado) && /Error: boom/.test(tirado) && tirado.endsWith('[exit code 1]'), tirado);
    ok_('  y la traza nombra el script con el nombre de BlackCode', /blackcode-run-[0-9a-f]{12}\.js/.test(tirado) && !/neoncode/i.test(tirado), tirado);
    const roto = await correr(hacerRun(), { language: 'node', code: 'esto no es (javascript' });
    ok_('un error de sintaxis también', /SyntaxError/.test(roto) && roto.endsWith('[exit code 1]'), roto);
    t('sin salida y con exit 0, lo dice', await correr(hacerRun(), { language: 'node', code: '1 + 1;' }), '(no output)');
  }

  {
    // El reloj, con un proceso de verdad: uno que se queda 60 s con 1 s de tope.
    const t0 = Date.now();
    const txt = await correr(hacerRun(), { language: 'node', code: "console.log('arranqué'); setTimeout(() => {}, 60000);", timeout: 1 }, 20000);
    const tardó = Date.now() - t0;
    t('el timeout corta un proceso de verdad y conserva lo que alcanzó a decir', txt, 'arranqué\n\n[timed out after 1s — process tree killed]');
    ok_('lo corta a tiempo, no a los 60 s', tardó < 10000, `tardó ${tardó}ms`);
    ok_('y el despachador lo cuenta como falla', motor.failedOut(txt, 'run_code'));
  }

  {
    // El Stop: no es un timeout ni un exit code.
    const run = hacerRun();
    const p = correr(run, { language: 'node', code: 'setTimeout(() => {}, 60000);' }, 20000);
    setTimeout(() => run.ac.abort(), 1200);
    const t0 = Date.now();
    const txt = await p;
    t('un Stop corta un proceso de verdad y se dice como Stop', txt, '[stopped by the user — process tree killed]');
    ok_('y vuelve enseguida', Date.now() - t0 < 10000);
    const ya = hacerRun();
    ya.ac.abort();
    t('con la señal ya abortada tampoco queda corriendo', await correr(ya, { language: 'node', code: 'setTimeout(() => {}, 60000);' }, 20000),
      '[stopped by the user — process tree killed]');
  }

  {
    // La salida se acota mientras llega (el sink de runProc), con el tope del shell.
    const txt = await correr(hacerRun(), { language: 'node', code: "process.stdout.write('x'.repeat(200000));" });
    const m = txt.match(/…\[(\d+) chars omitted\]…/);
    ok_('una salida enorme vuelve recortada', txt.length < 11000 && !!m, `largo=${txt.length}`);
    t('y el hueco anunciado es el de verdad', m && Number(m[1]), 200000 - base.SHELL_MAX_CHARS);
  }

  {
    // Una imagen de verdad, por el camino entero.
    const vistas = [];
    code.configurar({ alProducir: (_run, imgs) => vistas.push(...imgs) });
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const txt = await correr(hacerRun(), { language: 'node', code: `require('fs').writeFileSync('punto.png', Buffer.from('${b64}', 'base64'));` });
    code.configurar({ alProducir: () => {} });
    t('una imagen escrita por un fragmento de verdad llega a alProducir', vistas, [{ name: 'punto.png', dataUrl: `data:image/png;base64,${b64}` }]);
    ok_('y figura en el texto con su ruta', txt.includes(`- ${path.join(WS_NODE, 'punto.png')} (`), txt);
  }

  // ═══ Python de verdad ══════════════════════════════════════════════════════
  seccion('run_code: Python de verdad');

  for (const bin of ['py', 'python', 'python3']) { // los mismos tres, en el mismo orden que resolvePython
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (!r.error && /python\s+\d/i.test(`${r.stdout || ''}${r.stderr || ''}`)) { pythonDeVerdad = bin; break; }
  }

  if (!pythonDeVerdad) {
    pythonSalteado = true;
  } else {
    code.configurar({ runProc: shell.runProc, workspace: () => WS_PY });
    t('resolvePython encuentra el mismo intérprete', await conTecho(code.resolvePython(), 30000, 'resolvePython'), pythonDeVerdad);

    const txt = await correr(hacerRun(), { language: 'python', code: "import os\nprint('hola')\nprint('cwd=' + os.getcwd())\nopen('datos.csv', 'wb').write(b'a,b\\n')\n" });
    ok_('corre el fragmento y trae su stdout', /^hola\r?\n/.test(txt), txt);
    t('en la carpeta de trabajo', ((txt.match(/^cwd=(.*?)\r?$/m) || [])[1] || '').toLowerCase(), WS_PY.toLowerCase());
    ok_('y reporta el archivo que escribió', txt.endsWith(`\n\nFiles written to the workspace:\n- ${path.join(WS_PY, 'datos.csv')} (4 B)`), txt);
    ok_('sin pip no crea un venv (no instala nada)', !fs.existsSync(path.join(WS_PY, '.venv')));

    const salió = await correr(hacerRun(), { language: 'python', code: "import sys\nprint('antes')\nsys.exit(2)\n" });
    ok_('un exit code != 0 llega al texto', /^antes\r?\n/.test(salió) && salió.endsWith('[exit code 2]'), salió);
    const traza = await correr(hacerRun(), { language: 'python', code: "raise ValueError('boom')\n" });
    ok_('una excepción trae su traceback y exit code 1', /Traceback/.test(traza) && /ValueError: boom/.test(traza) && traza.endsWith('[exit code 1]'), traza);
    ok_('  el traceback nombra el script con el nombre de BlackCode', /blackcode-run-[0-9a-f]{12}\.py/.test(traza) && !/neoncode/i.test(traza), traza);
    ok_('  y el despachador lo cuenta como falla', motor.failedOut(traza, 'run_code'));

    const t0 = Date.now();
    const lento = await correr(hacerRun(), { language: 'python', code: "import time\nprint('listo')\ntime.sleep(60)\n", timeout: 1 }, 20000);
    ok_('el timeout corta un Python de verdad', lento.endsWith('[timed out after 1s — process tree killed]') && Date.now() - t0 < 10000, lento);
    ok_('y lo que imprimió antes sobrevive (corre sin buffer)', /^listo\r?\n/.test(lento), lento);
  }

  // ═══ os_open ═══════════════════════════════════════════════════════════════
  // Todo con un `shell` falso que anota y no abre nada.
  seccion('os_open: cableado');

  t('abrir.cjs exporta lo que dice', Object.keys(abrir).sort(),
    ['EXECUTABLE_EXTS', 'OPENABLE_EXTS', 'classifyOsTarget', 'configurar', 'runOsOpen', 'runners']);
  t('y su runner es os_open', Object.keys(abrir.runners), ['os_open']);

  for (const n of ['notas.md', 'informe.PDF', 'programa.exe', 'atajo.lnk', 'enlace.url', 'script.js', 'modulo.cjs', 'GRITA.EXE', 'raro.xyz', 'sinextension']) {
    fs.writeFileSync(path.join(ESCRITORIO, n), 'x');
  }
  fs.mkdirSync(path.join(ESCRITORIO, 'carpeta'));
  fs.mkdirSync(path.join(ESCRITORIO, 'carpeta.exe')); // una carpeta no tiene extensión que mirar
  const en = (n) => path.join(ESCRITORIO, n);

  let llamadas = [];
  let falla = {}; // qué método del shell falso tiene que fallar, y cómo
  const shellFalso = {
    openPath: async (p) => { llamadas.push(['openPath', p]); if (falla.openPath instanceof Error) throw falla.openPath; return falla.openPath || ''; },
    openExternal: async (u) => { llamadas.push(['openExternal', u]); if (falla.openExternal) throw falla.openExternal; },
    showItemInFolder: (p) => { llamadas.push(['showItemInFolder', p]); if (falla.showItemInFolder) throw falla.showItemInFolder; },
  };
  const hacerRunEn = (cwd = ESCRITORIO) => { const run = hacerRun(); run.cwd = cwd; return run; };
  /** Corre os_open y devuelve [texto, llamadas al shell]. */
  const abre = async (args, run = hacerRunEn()) => {
    llamadas = [];
    const txt = await conTecho(abrir.runners.os_open(run, args), 5000, `os_open ${JSON.stringify(args)}`);
    return [txt, llamadas];
  };

  {
    // Sin `shell`: un error y nada más. Es como arranca el módulo.
    const run = hacerRunEn();
    const txt = await conTecho(abrir.runners.os_open(run, { target: en('notas.md') }), 5000, 'os_open sin shell');
    ok_('sin shell configurado devuelve un «error: …»', /^error: /.test(txt) && /os_open/.test(txt), txt);
    ok_('que nombra a BlackCode y no a NeonCode', /BlackCode/.test(txt) && !/neoncode/i.test(txt), txt);
    t('y no avisa a la interfaz', run.avisos.length, 0);
    ok_('lo mismo para una URL', /^error: /.test(await abrir.runners.os_open(hacerRunEn(), { target: 'https://example.com' })));
    ok_('y el despachador lo cuenta como falla', motor.failedOut(txt, 'os_open'));

    // un shell al que le falta un método no sirve: es lo mismo que no tenerlo
    abrir.configurar({ shell: { openPath: shellFalso.openPath, openExternal: shellFalso.openExternal } });
    const [medio, hizo] = await abre({ target: en('notas.md') });
    ok_('un shell al que le falta un método es lo mismo que ninguno', /^error: /.test(medio) && hizo.length === 0, medio);
  }

  seccion('os_open: clasificar el target');
  {
    const k = (x) => abrir.classifyOsTarget(x);
    t('una ruta con letra de unidad', [k('C:\\x\\y.pdf'), k('c:relativa.txt'), k('D:/z')], [{ kind: 'path' }, { kind: 'path' }, { kind: 'path' }]);
    t('una relativa, con o sin barras', [k('notas.md'), k('sub/notas.md'), k('..\\x'), k('.')], Array(4).fill({ kind: 'path' }));
    t('http y https son URLs, sin importar las mayúsculas y sin los blancos de las puntas',
      [k('http://a.b/c'), k('HTTPS://A.B'), k('  https://a.b/c?d=1  ')],
      [{ kind: 'url', url: 'http://a.b/c' }, { kind: 'url', url: 'HTTPS://A.B' }, { kind: 'url', url: 'https://a.b/c?d=1' }]);
    t('cualquier otro esquema se rechaza, diciendo cuál',
      ['file:///C:/x.exe', 'javascript:alert(1)', 'ms-settings:display', 'mailto:a@b.c', 'FTP://x', 'vbscript:x', 'data:text/html,x'].map((x) => k(x).reason),
      ['file', 'javascript', 'ms-settings', 'mailto', 'ftp', 'vbscript', 'data'].map((s) => `only http(s) URLs and local paths are allowed (got "${s}:")`));
    t('y vacío o ausente también', [k(''), k('   '), k(undefined), k(null)], Array(4).fill({ kind: 'invalid', reason: 'target is required' }));

    const abribles = [...abrir.OPENABLE_EXTS];
    const ejecutan = [...abrir.EXECUTABLE_EXTS];
    t('ninguna extensión está en las dos listas', abribles.filter((e) => abrir.EXECUTABLE_EXTS.has(e)), []);
    ok_('todas en minúscula y con su punto', [...abribles, ...ejecutan].every((e) => /^\.[a-z0-9]+$/.test(e)));
    ok_('lo que ejecuta no está entre lo que se abre',
      ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.mjs', '.cjs', '.jar', '.msi', '.lnk', '.url', '.hta', '.scr', '.reg', '.py'].every((e) => !abrir.OPENABLE_EXTS.has(e) && abrir.EXECUTABLE_EXTS.has(e)));
  }

  seccion('os_open: con un shell falso');
  abrir.configurar({ shell: shellFalso });

  {
    const run = hacerRunEn();
    t('un archivo se abre con su programa, resuelto contra el cwd de la corrida', await abre({ target: 'notas.md' }, run),
      [`Opened ${en('notas.md')} in its default app.`, [['openPath', en('notas.md')]]]);
    t('y avisa a la interfaz con el target como vino', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'os_open', label: 'notas.md' }]]);
    t('una ruta absoluta va tal cual', await abre({ target: en('notas.md') }, hacerRunEn(TMP)),
      [`Opened ${en('notas.md')} in its default app.`, [['openPath', en('notas.md')]]]);
    t('la extensión se mira sin importar las mayúsculas', await abre({ target: 'informe.PDF' }),
      [`Opened ${en('informe.PDF')} in its default app.`, [['openPath', en('informe.PDF')]]]);
    t('una carpeta se abre', await abre({ target: 'carpeta' }), [`Opened ${en('carpeta')} in its default app.`, [['openPath', en('carpeta')]]]);
    t('aunque su nombre termine como un ejecutable', (await abre({ target: 'carpeta.exe' }))[1], [['openPath', en('carpeta.exe')]]);
    t('y el cwd mismo también', (await abre({ target: '.' }))[1], [['openPath', ESCRITORIO]]);
  }

  {
    t('reveal:true lo señala en el Explorador y no lo abre', await abre({ target: 'notas.md', reveal: true }),
      [`Revealed ${en('notas.md')} in Explorer.`, [['showItemInFolder', en('notas.md')]]]);
    // un reveal:"true" —como lo serializa un modelo chico— TIENE que revelar:
    // leído con === true seguía de largo y lanzaba el archivo
    t('reveal:"true" también revela', (await abre({ target: 'notas.md', reveal: 'true' }))[1], [['showItemInFolder', en('notas.md')]]);
    t('un ejecutable se puede señalar', await abre({ target: 'programa.exe', reveal: true }),
      [`Revealed ${en('programa.exe')} in Explorer.`, [['showItemInFolder', en('programa.exe')]]]);
    t('reveal:false abre', (await abre({ target: 'notas.md', reveal: false }))[1], [['openPath', en('notas.md')]]);
  }

  {
    const run = hacerRunEn();
    t('una URL https va al navegador', await abre({ target: 'https://example.com/a?b=1' }, run),
      ['Opened https://example.com/a?b=1 in the browser.', [['openExternal', 'https://example.com/a?b=1']]]);
    t('y avisa a la interfaz', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'os_open', label: 'https://example.com/a?b=1' }]]);
    t('una http también, sin los blancos de las puntas', await abre({ target: '  http://example.com  ' }),
      ['Opened http://example.com in the browser.', [['openExternal', 'http://example.com']]]);
    t('reveal no vale para una URL', await abre({ target: 'https://example.com', reveal: true }),
      ['error: reveal only applies to local files, not URLs', []]);
  }

  {
    // Lo que NO se abre. En ningún caso se llama al shell.
    const ejecuta = (ext) => `error: ${ext} would execute (or resolve to something that does) — refusing to launch it. Pass reveal:true to show it in Explorer instead.`;
    t('un .exe se rechaza, diciendo por qué y qué hacer', await abre({ target: 'programa.exe' }), [ejecuta('.exe'), []]);
    t('en mayúsculas también', await abre({ target: 'GRITA.EXE' }), [ejecuta('.exe'), []]);
    t('un acceso directo, que lleva a un ejecutable', await abre({ target: 'atajo.lnk' }), [ejecuta('.lnk'), []]);
    t('un .url, ídem', await abre({ target: 'enlace.url' }), [ejecuta('.url'), []]);
    t('un .js, que Windows corre con su Script Host', await abre({ target: 'script.js' }), [ejecuta('.js'), []]);
    t('y un .cjs', await abre({ target: 'modulo.cjs' }), [ejecuta('.cjs'), []]);
    t('un tipo que no está en la lista tampoco se abre', await abre({ target: 'raro.xyz' }),
      ['error: .xyz is not a type os_open will open. Pass reveal:true to show it in Explorer instead.', []]);
    t('ni un archivo sin extensión', await abre({ target: 'sinextension' }),
      ['error: a file with no extension is not a type os_open will open. Pass reveal:true to show it in Explorer instead.', []]);

    const run = hacerRunEn();
    t('un esquema que no es http(s) se rechaza', await abre({ target: 'file:///C:/Windows/System32/calc.exe' }, run),
      ['error: only http(s) URLs and local paths are allowed (got "file:")', []]);
    t('  sin avisar a la interfaz', run.avisos.length, 0);
    t('javascript: también', await abre({ target: 'javascript:alert(1)' }), ['error: only http(s) URLs and local paths are allowed (got "javascript:")', []]);
    t('y un protocolo de Windows', await abre({ target: 'ms-settings:display' }), ['error: only http(s) URLs and local paths are allowed (got "ms-settings:")', []]);

    t('una ruta que no existe se dice, con el absoluto', await abre({ target: 'no-existe.pdf' }), [`error: path not found: ${en('no-existe.pdf')}`, []]);
    t('con reveal también', await abre({ target: 'no-existe.pdf', reveal: true }), [`error: path not found: ${en('no-existe.pdf')}`, []]);
    t('sin target no hay nada que abrir', await abre({}), ['error: target is required', []]);
    t('ni con los argumentos vacíos', await abre(undefined), ['error: target is required', []]);
  }

  {
    // Cuando el que falla es el sistema.
    falla = { openPath: 'No application is associated with the specified file.' };
    t('si el sistema no lo puede abrir, vuelve su mensaje', await abre({ target: 'notas.md' }),
      ['error: No application is associated with the specified file.', [['openPath', en('notas.md')]]]);
    falla = { openPath: new Error('se cayó el shell') };
    t('si openPath tira, también', (await abre({ target: 'notas.md' }))[0], 'error: se cayó el shell');
    falla = { openExternal: new Error('sin navegador') };
    t('si la URL no se puede abrir, lo dice', (await abre({ target: 'https://example.com' }))[0], 'error: could not open URL — sin navegador');
    falla = { showItemInFolder: new Error('sin explorador') };
    t('y si no se puede señalar', (await abre({ target: 'notas.md', reveal: true }))[0], 'error: sin explorador');
    falla = {};
  }

  {
    // Sacarle el shell lo deja otra vez sin abrir nada.
    abrir.configurar({ shell: null });
    const [txt, hizo] = await abre({ target: 'notas.md' });
    ok_('configurar({ shell: null }) lo deja sin con qué abrir', /^error: /.test(txt) && hizo.length === 0, txt);
    abrir.configurar({});
    ok_('y configurar sin `shell` no cambia nada', /^error: /.test((await abre({ target: 'notas.md' }))[0]));
  }

  seccion('limpieza');
  t('no quedó ningún script temporal tirado', [...scriptsSueltos()].filter((n) => !sueltosAntes.has(n)), []);
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  code.configurar({ runProc: shell.runProc, alProducir: () => {}, workspace: () => path.join(os.tmpdir(), 'blackcode-code-workspace') });
  abrir.configurar({ shell: null });
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (failures.length) {
  console.error(`test-blackcode-tools-code: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
const python = pythonSalteado
  ? 'Python de verdad SALTEADO: no hay py, python ni python3 en el PATH'
  : `Python de verdad con «${pythonDeVerdad}»`;
console.log(`test-blackcode-tools-code: ok (${hechas} comprobaciones: run_code con procesos falsos, venv y pip sin instalar nada, archivos e imágenes, Node de verdad, os_open con un shell falso; ${python})`);
process.exit(0);
