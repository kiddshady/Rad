// El micrófono de la PC de BlackCode en modo conversación, con node pelado:
// apps/BlackCode/main/micro.cjs (la conversación) y main/palabra.cjs (el
// detector de la palabra clave, con un Python de mentira).
//
// Lo que se prueba: que sin abrirla no tome frases; que la palabra (o el
// atajo) la abra y calle lo que suena; una frase que se corta al callar y va
// a alFrase sin la palabra clave; que mientras se espera la respuesta no tome
// nada y que «listo» la vuelva a abrir sin palabra; «gracias, zac»
// (y sus variantes) la cierran sin llegarle al agente; los 30 s sin hablar la
// cierran, contando lo que pasó en frases de ruido; el atajo la cierra; un
// Whisper que falla la cierra; apagar el modo la cierra y descarta una
// transcripción que vuelve tarde; y del detector: que arranque con el modelo,
// pase el audio solo listo, avise al oír, diga qué falta, no reintente en
// bucle si no cargó, y sí si se cayó andando.

import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'apps', 'BlackCode', 'main');
const { crear, esCierre, SILENCIO_MS } = require(process.env.BLACKCODE_MICRO || path.join(MAIN, 'micro.cjs'));
const palabraCjs = require(path.join(MAIN, 'palabra.cjs'));
const { tono, silencio } = require(path.join(MAIN, 'eco-simulado.cjs'));

const failures = [];
let hechas = 0;
const ok = (name, cond, extra = '') => { hechas++; if (!cond) failures.push(`${name}${extra ? `  → ${String(extra).slice(0, 300)}` : ''}`); };
const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Un reloj que avanza con el audio: cada tramo de 100 ms adelanta 100 ms.
function banco({ textos = [], fallaWhisper = false } = {}) {
  let t = 1_000_000;
  const frases = [];
  const callados = [];
  const transcritos = [];
  let calientes = 0;
  const m = crear({
    ahora: () => t,
    transcribir: async (pcm) => { transcritos.push(pcm.length); await esperar(1); if (fallaWhisper) throw new Error('CUDA out of memory'); return { texto: textos.shift() ?? '' }; },
    calentar: () => { calientes++; },
    callar: () => { callados.push(t); },
    alFrase: (f) => frases.push(f),
  });
  const dar = (buf) => { for (let i = 0; i < buf.length; i += 3200) { m.dar(buf.subarray(i, i + 3200)); t += Math.round(buf.subarray(i, i + 3200).length / 32); } };
  // hablar: un poco de ruido, voz, y el silencio que cierra la frase
  const hablar = async (ms = 900) => { dar(silencio(300)); dar(tono(ms)); dar(silencio(1200)); await esperar(10); };
  const callarse = async (ms) => { dar(silencio(ms)); await esperar(10); };
  return { m, frases, callados, transcritos, dar, hablar, callarse, calientes: () => calientes, avanzar: (ms) => { t += ms; } };
}

// ---------- esCierre ----------
for (const s of ['gracias zac', 'Gracias, Zac.', 'Gracias Zack!', 'gracias Zach', 'Okay, gracias Zac.', 'Muchas gracias, Zac.', 'gracias sac', 'GRACIAS ZAK']) ok(`esCierre «${s}»`, esCierre(s));
for (const s of ['gracias', 'zac', 'gracias zac, ahora apagá la luz', 'chau zac', 'listo zac', 'gracias mate', 'decile gracias a zac', '', 'gracias zapato']) ok(`no es cierre «${s}»`, !esCierre(s));

// ---------- la conversación ----------
{
  const b = banco({ textos: ['apagá la luz'] });
  b.m.activar(true);
  await b.hablar();
  ok('sin abrirla no toma frases', b.frases.length === 0 && b.transcritos.length === 0, JSON.stringify(b.m.estado()));
  b.m.oida();
  ok('la palabra la abre', b.m.estado().conversacion === true && b.m.estado().fase === 'listening');
  ok('…y calla lo que suena', b.callados.length === 1);
  ok('…y calienta Whisper', b.calientes() === 1);
  await b.hablar();
  ok('una frase que se corta al callar va a alFrase', b.frases.length === 1 && b.frases[0].texto === 'apagá la luz', JSON.stringify(b.frases));
  ok('…y queda esperando la respuesta', b.m.estado().fase === 'waiting' && b.m.estado().conversacion);
  await b.hablar();
  ok('esperando la respuesta no toma nada', b.frases.length === 1 && b.transcritos.length === 1);
  b.m.listo();
  ok('«listo» la vuelve a abrir sin palabra clave', b.m.estado().fase === 'listening' && b.callados.length === 1);
}
{
  // la frase se abre MIENTRAS se sigue hablando («okay zac, qué hora es»): el
  // piso del cuarto viene de antes, no de la voz (con la webcam de verdad, sin
  // esto lo dicho de corrido se perdía)
  const b = banco({ textos: ['qué hora es'] });
  b.m.activar(true);
  b.dar(silencio(1500));
  b.dar(tono(800));      // «okay zac»
  b.m.oida();
  b.dar(tono(900));      // «qué hora es», de corrido
  b.dar(silencio(1200));
  await esperar(10);
  ok('lo dicho de corrido tras la palabra clave entra', b.frases.length === 1 && b.frases[0].texto === 'qué hora es', JSON.stringify(b.m.estado()));
}
{
  // el detector avisa ~400 ms tarde, ya por la mitad de lo que se pide: la
  // frase arranca con lo último que se oyó, no se pierde nada
  const b = banco({ textos: ['Okey Zac. ¿Qué hora es?'] });
  b.m.activar(true);
  b.dar(silencio(1000));
  b.dar(tono(500));      // «okey zac»
  b.dar(silencio(100));
  b.dar(tono(300));      // «¿qué ho…»
  b.m.oida();            // …recién acá avisa el detector
  b.dar(tono(200));      // «…ra es?»
  b.dar(silencio(1200));
  await esperar(10);
  ok('la frase arranca con lo de antes de que avise el detector', b.frases.length === 1 && b.frases[0].texto === 'Qué hora es?' && b.transcritos[0] >= 32000 * 0.9, JSON.stringify({ f: b.frases, t: b.transcritos }));
  // el atajo no: lo de antes de tocarlo no era para el agente
  const c = banco({ textos: ['algo'] });
  c.m.activar(true);
  c.dar(tono(800));
  c.dar(silencio(300));
  c.m.atajo();
  await c.callarse(1500);
  ok('el atajo no arrastra lo que se oyó antes', c.transcritos.length === 0 && c.m.estado().fase === 'listening');
}
{
  // la cola de «zac» y una pausa antes de pedir algo no cierran la frase vacía
  const b = banco({ textos: ['apagá la luz', 'sí'] });
  b.m.activar(true);
  b.dar(silencio(1500));
  b.m.oida();
  b.dar(tono(200));      // la cola de la palabra
  b.dar(silencio(1300)); // la pausa
  await esperar(10);
  ok('un pedacito de voz y una pausa tras la palabra no cierran la frase', b.transcritos.length === 0 && b.m.estado().fase === 'listening', JSON.stringify(b.m.estado()));
  b.dar(tono(900));
  b.dar(silencio(1200));
  await esperar(10);
  ok('…y lo que se pide después entra', b.frases.length === 1 && b.frases[0].texto === 'apagá la luz');
  b.m.listo();
  b.dar(silencio(500));
  b.dar(tono(250));      // «sí», cortito
  b.dar(silencio(1200));
  await esperar(10);
  ok('después de una respuesta, un «sí» cortito sí entra', b.frases.length === 2 && b.frases[1].texto === 'sí', JSON.stringify(b.m.estado()));
}
{
  const b = banco({ textos: ['Okay Zac, qué hora es', 'y mañana?', 'Gracias, Zac.'] });
  b.m.activar(true);
  b.m.oida();
  await b.hablar();
  ok('la palabra clave que Whisper alcanzó a oír se saca', b.frases[0]?.texto === 'qué hora es', b.frases[0]?.texto);
  b.m.listo();
  await b.hablar();
  ok('la segunda frase, sin palabra', b.frases[1]?.texto === 'y mañana?');
  b.m.listo();
  await b.hablar();
  ok('«gracias, zac» la cierra', b.m.estado().conversacion === false && b.m.estado().cierre === 'phrase', JSON.stringify(b.m.estado()));
  ok('…sin llegarle al agente', b.frases.length === 2);
  await b.hablar();
  ok('cerrada, no toma frases', b.transcritos.length === 3);
}
{
  // los 30 s: sin hablar desde que se abrió
  const b = banco();
  b.m.activar(true);
  b.m.oida();
  await b.callarse(SILENCIO_MS - 1000);
  ok('antes de los 30 s sigue abierta', b.m.estado().conversacion === true && b.m.estado().fase === 'listening');
  await b.callarse(1200);
  ok('a los 30 s sin hablar se cierra', b.m.estado().conversacion === false && b.m.estado().cierre === 'silence', JSON.stringify(b.m.estado()));
  ok('…sin transcribir nada', b.transcritos.length === 0);
}
{
  // ruido que Whisper no entiende: sigue escuchando, pero el reloj de los 30 s sigue corriendo
  const b = banco({ textos: ['', ''] });
  b.m.activar(true);
  b.m.oida();
  await b.hablar(600);
  ok('ruido sin texto: sigue escuchando', b.m.estado().conversacion && b.m.estado().fase === 'listening' && b.frases.length === 0);
  await b.callarse(SILENCIO_MS - 2000);
  ok('…y el ruido no reinicia los 30 s', b.m.estado().conversacion === false && b.m.estado().cierre === 'silence', JSON.stringify(b.m.estado()));
}
{
  // después de una respuesta, los 30 s cuentan desde «listo»
  const b = banco({ textos: ['hola'] });
  b.m.activar(true);
  b.m.oida();
  await b.hablar();
  b.avanzar(60000); // la respuesta tardó un minuto
  b.m.listo();
  ok('una respuesta larga no cierra la conversación', b.m.estado().conversacion && b.m.estado().fase === 'listening');
}
{
  const b = banco({ textos: ['algo'] });
  b.m.activar(true);
  b.m.atajo();
  ok('el atajo la abre', b.m.estado().conversacion && b.m.estado().fase === 'listening' && b.callados.length === 1);
  b.m.atajo();
  ok('el atajo otra vez la cierra', !b.m.estado().conversacion && b.m.estado().cierre === 'shortcut');
  await b.hablar();
  ok('cerrada por el atajo no toma frases', b.transcritos.length === 0);
}
{
  const b = banco({ fallaWhisper: true });
  b.m.activar(true);
  b.m.oida();
  await b.hablar();
  ok('Whisper que falla la cierra y lo dice', !b.m.estado().conversacion && b.m.estado().cierre === 'error' && /CUDA/.test(b.m.estado().ultima?.error ?? ''), JSON.stringify(b.m.estado()));
}
{
  // apagar el modo a mitad de una transcripción: lo que vuelve tarde se descarta
  let soltar;
  const frases = [];
  const m = crear({ ahora: () => 0, transcribir: () => new Promise((r) => { soltar = r; }), alFrase: (f) => frases.push(f) });
  m.activar(true);
  m.oida();
  m.dar(silencio(300)); m.dar(tono(900)); m.dar(silencio(1200));
  ok('transcribiendo', m.estado().fase === 'transcribing');
  m.activar(false);
  soltar({ texto: 'tarde' });
  await esperar(5);
  ok('apagar la cierra y descarta lo que vuelve tarde', frases.length === 0 && !m.estado().conversacion && !m.estado().activo && m.estado().cierre === 'off');
  m.oida();
  ok('apagado, la palabra no abre nada', !m.estado().conversacion);
}

// ---------- el detector de la palabra (palabra.cjs) con un Python de mentira ----------
function pythonFalso({ carga = true, error = null } = {}) {
  const lanzados = [];
  const lanzar = (cmd, args) => {
    const p = new EventEmitter();
    p.stdin = new PassThrough();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.recibido = 0;
    p.stdin.on('data', (d) => { p.recibido += d.length; if (p.alRecibir) p.alRecibir(d); });
    p.kill = () => p.emit('exit', null);
    p.stdin.on('finish', () => setImmediate(() => p.emit('exit', 0)));
    lanzados.push({ cmd, args, p });
    setImmediate(() => {
      if (error) { p.stdout.write(`${JSON.stringify({ ev: 'error', msg: error })}\n`); setImmediate(() => p.emit('exit', 1)); return; }
      if (carga) p.stdout.write(`${JSON.stringify({ ev: 'listo', palabra: 'okay zac' })}\n`);
    });
    return p;
  };
  return { lanzar, lanzados };
}
{
  const py = pythonFalso();
  const oidas = [];
  const d = palabraCjs.crear({ python: () => 'C:\\py\\python.exe', script: 'palabra_motor.py', modelo: () => 'C:\\ww\\okay_zac.json', lanzar: py.lanzar, alOir: (x) => oidas.push(x) });
  d.dar(Buffer.alloc(100));
  ok('apagado no lanza nada', py.lanzados.length === 0);
  d.prender();
  ok('prendido lanza el motor con el modelo', py.lanzados.length === 1 && py.lanzados[0].cmd === 'C:\\py\\python.exe' && py.lanzados[0].args.at(-1) === 'C:\\ww\\okay_zac.json');
  d.dar(Buffer.alloc(320));
  ok('antes de cargar no le pasa audio', py.lanzados[0].p.recibido === 0);
  await esperar(5);
  ok('cargado dice la palabra', d.estado().estado === 'ready' && d.estado().palabra === 'okay zac');
  d.dar(Buffer.alloc(320));
  await esperar(1);
  ok('cargado le pasa el audio', py.lanzados[0].p.recibido === 320);
  py.lanzados[0].p.stdout.write(`${JSON.stringify({ ev: 'oida', p: 0.99 })}\n`);
  await esperar(1);
  ok('al oír avisa', oidas.length === 1 && oidas[0].p === 0.99);
  d.prender();
  ok('prender dos veces no lanza otro', py.lanzados.length === 1);
  d.apagar();
  await esperar(5);
  ok('apagar lo suelta', d.estado().estado === 'off');
}
{
  const py = pythonFalso({ error: "ModuleNotFoundError: No module named 'pymicro_wakeword'" });
  const d = palabraCjs.crear({ script: 'x.py', modelo: () => 'm.json', lanzar: py.lanzar, reintentoMs: 5 });
  d.prender();
  await esperar(40);
  ok('sin el paquete dice cuál falta', d.estado().estado === 'error' && /pymicro_wakeword/.test(d.estado().error), d.estado().error);
  ok('…y no reintenta en bucle', py.lanzados.length === 1, py.lanzados.length);
}
{
  const py = pythonFalso();
  const d = palabraCjs.crear({ script: 'x.py', modelo: () => '', lanzar: py.lanzar });
  d.prender();
  ok('sin modelo elegido lo dice y no lanza nada', d.estado().estado === 'error' && /model/i.test(d.estado().error) && py.lanzados.length === 0);
}
{
  const py = pythonFalso();
  const d = palabraCjs.crear({ script: 'x.py', modelo: () => 'm.json', lanzar: py.lanzar, reintentoMs: 5 });
  d.prender();
  await esperar(5);
  py.lanzados[0].p.emit('exit', 3);
  await esperar(30);
  ok('si se cae andando, vuelve a arrancar', py.lanzados.length === 2 && d.estado().estado === 'ready', `${py.lanzados.length} ${d.estado().estado}`);
  d.apagar();
}

if (failures.length) {
  console.error(`test-blackcode-micro: ${failures.length} de ${hechas} fallaron`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`test-blackcode-micro: ok (${hechas} comprobaciones: la frase de cierre, abrir con la palabra o el atajo, una frase sin la palabra clave, nada mientras se espera la respuesta, volver a escuchar sin palabra, cerrar con «gracias, zac», con 30 s sin hablar (también con ruido), con el atajo y con Whisper caído, apagar con una transcripción en vuelo, y el detector con un Python de mentira)`);
