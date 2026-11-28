// Test de la voz de BlackCode: el corte de la frase (main/corte.cjs), lo que
// Whisper inventa y el manejo de su proceso (main/escucha.cjs), y la
// conversación con el Atom Echo (main/eco.cjs) contra un Echo de mentira
// (main/eco-simulado.cjs). Con node pelado: sin Echo, sin Python, sin red.
// Uso: node tools/test-blackcode-voz.mjs

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const corte = require(process.env.BLACKCODE_CORTE || path.join(APP, 'main', 'corte.cjs'));
const escucha = require(process.env.BLACKCODE_ESCUCHA || path.join(APP, 'main', 'escucha.cjs'));
const eco = require(process.env.BLACKCODE_ECO || path.join(APP, 'main', 'eco.cjs'));
const habla = require(path.join(APP, 'main', 'habla.cjs'));
const sim = require(path.join(APP, 'main', 'eco-simulado.cjs'));
const { tono, silencio } = sim;

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// (los plazos de la app no sostienen el proceso —en Electron no hace falta—: acá lo sostiene esto)
setInterval(() => {}, 1000);
async function hasta(cond, ms = 2000) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await pausa(5); } return Boolean(cond()); }

// ---------- El corte de la frase ----------
{
  // de a tramos como los del Echo (1024 bytes); devuelve por qué cerró y cuánto audio había recibido
  const pasar = (pcm, opciones = {}, tramo = 1024) => {
    const c = corte.crear(opciones);
    let que = null;
    for (let i = 0; i < pcm.length && !que; i += tramo) que = c.dar(pcm.subarray(i, i + tramo));
    return { que, ms: c.ms(), c };
  };
  const frase = Buffer.concat([silencio(200), tono(1500), silencio(2000)]);
  const r = pasar(frase);
  ok('corte: una frase termina cuando calla', r.que === 'fin', String(r.que));
  ok('corte: cierra a los 900 ms de silencio, no antes ni mucho después', r.ms >= 200 + 1500 + 900 && r.ms <= 200 + 1500 + 900 + 60, `${r.ms} ms`);
  ok('corte: oyó voz', r.c.hablo() === true);
  ok('corte: el silencio que cierra se puede cambiar', pasar(frase, { silencioMs: 400 }).ms < r.ms - 400);

  const nada = pasar(silencio(6000));
  ok('corte: si nadie habla, cierra vacío', nada.que === 'vacio' && nada.c.hablo() === false, `${nada.que}`);
  ok('corte: espera 4 s a que empiece a hablar', nada.ms >= 4000 && nada.ms <= 4040, `${nada.ms} ms`);

  const largo = pasar(Buffer.concat([silencio(200), tono(20000)]));
  ok('corte: una frase que no para se corta en el tope', largo.que === 'tope' && largo.ms >= 15000 && largo.ms <= 15040, `${largo.que} ${largo.ms}`);

  ok('corte: una pausa de medio segundo no corta la frase', pasar(Buffer.concat([silencio(200), tono(800), silencio(500), tono(800), silencio(2000)])).ms >= 200 + 800 + 500 + 800 + 900);
  ok('corte: un clic no es voz', pasar(Buffer.concat([silencio(200), tono(40), silencio(5000)])).que === 'vacio');
  // (bajo, pero bien por encima de un fondo casi mudo: lo frena el volumen mínimo, no el piso)
  ok('corte: lo que suena bajo no es voz', pasar(Buffer.concat([silencio(200, 15), tono(1500, 300), silencio(5000, 15)])).que === 'vacio');
  // con ruido de fondo fuerte, la voz tiene que superarlo de verdad
  const ruidoso = pasar(Buffer.concat([silencio(300, 250), tono(1500), silencio(2000, 250)]));
  ok('corte: con ruido de fondo, la voz fuerte se oye y la frase termina', ruidoso.que === 'fin', `${ruidoso.que}`);
  ok('corte: con ruido de fondo, una voz apenas más fuerte que el ruido no cuenta', pasar(Buffer.concat([silencio(300, 400), tono(1500, 700), silencio(4000, 400)])).que === 'vacio');
  // el resultado no depende de cómo venga partido el audio
  ok('corte: da lo mismo con tramos de cualquier tamaño', [1, 3, 320, 777, 4096].every((t) => { const x = pasar(frase, {}, t); return x.que === 'fin' && Math.abs(x.ms - r.ms) <= 20; }));
  const c = corte.crear();
  c.dar(frase.subarray(0, 5000));
  c.dar(frase.subarray(5000, 9000));
  ok('corte: guarda el audio tal como llegó', c.pcm().equals(frase.subarray(0, 9000)));
  const cerrado = corte.crear();
  cerrado.dar(frase);
  ok('corte: una vez cerrado, sigue cerrado', cerrado.dar(tono(500)) === 'fin');
  ok('corte: un tramo vacío no rompe nada', corte.crear().dar(Buffer.alloc(0)) === null && corte.crear().dar(null) === null);
}

// ---------- Lo que Whisper inventa ----------
{
  const s = (t, lp = -0.3, ns = 0.01, cr = 1) => ({ t, lp, ns, cr });
  ok('texto: una frase normal pasa', escucha.textoDe([s('Apagá las luces.')]) === 'Apagá las luces.');
  ok('texto: varios segmentos se unen', escucha.textoDe([s('Apagá las luces'), s('y poné música.')]) === 'Apagá las luces y poné música.');
  ok('texto: «Gracias.» sola es un invento', escucha.textoDe([s('Gracias.')]) === '' && escucha.textoDe([s('¡Muchas gracias!')]) === '' && escucha.textoDe([s('Gracias por ver el video.')]) === '');
  ok('texto: los subtítulos de Amara son un invento', escucha.textoDe([s('Subtítulos realizados por la comunidad de Amara.org')]) === '');
  ok('texto: «Thank you.» sola es un invento', escucha.textoDe([s('Thank you.')]) === '' && escucha.textoDe([s('Thanks for watching!')]) === '');
  ok('texto: «gracias» adentro de una frase se queda', escucha.textoDe([s('Gracias, ahora apagá las luces.')]) === 'Gracias, ahora apagá las luces.');
  ok('texto: un segmento sin voz y sin confianza se descarta', escucha.textoDe([s('Bla bla', -1.4, 0.9)]) === '' && escucha.textoDe([s('Prendé la luz', -0.2, 0.9)]) === 'Prendé la luz');
  ok('texto: un bucle se descarta', escucha.textoDe([s('la la la la la la la la', -0.2, 0, 3.1)]) === '');
  ok('texto: sin segmentos no hay texto', escucha.textoDe([]) === '' && escucha.textoDe(null) === '' && escucha.textoDe([s('   ')]) === '');
  ok('texto: solo puntos no es texto', escucha.textoDe([s('...')]) === '');
}

// ---------- El proceso de Whisper ----------
// Un Python de mentira: anota lo que le escriben y contesta lo que el test le diga.
function pythonDeMentira() {
  const lanzados = [];
  const lanzar = (comando, args) => {
    const p = new EventEmitter();
    p.comando = comando;
    p.args = args;
    p.pedidos = [];
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.decir = (obj) => p.stdout.write(`${JSON.stringify(obj)}\n`);
    p.stdin = new Writable({ write(chunk, _enc, cb) { for (const l of chunk.toString().split('\n').filter(Boolean)) { const op = JSON.parse(l); p.pedidos.push(op); p.alPedido?.(op); } cb(); } });
    p.kill = () => { p.matado = true; p.emit('exit', null); };
    p.salir = (codigo = 0) => p.emit('exit', codigo);
    lanzados.push(p);
    return p;
  };
  return { lanzar, lanzados };
}
{
  const py = pythonDeMentira();
  const estados = [];
  const e = escucha.crear({ script: 'motor.py', python: () => 'C:/py/python.exe', lanzar: py.lanzar, alCambiar: (s) => estados.push(s.estado) });
  ok('escucha: no levanta nada hasta que hace falta', py.lanzados.length === 0 && e.estado().estado === 'off' && e.vivo() === false);
  e.calentar();
  const p = py.lanzados[0];
  ok('escucha: levanta el Python del usuario con el motor', py.lanzados.length === 1 && p.comando === 'C:/py/python.exe' && p.args.includes('motor.py') && p.args.includes('utf8'));
  await hasta(() => p.pedidos.length === 1);
  ok('escucha: calentar pide cargar el modelo', p.pedidos[0]?.op === 'cargar' && p.pedidos[0].modelo === 'large-v3-turbo');
  p.decir({ ev: 'arranco' });
  p.decir({ ev: 'listo', dispositivo: 'cuda', gpu: 'RTX de mentira' });
  p.decir({ ev: 'cargando', modelo: 'large-v3-turbo', dispositivo: 'cuda' });
  p.decir({ ev: 'cargado', modelo: 'large-v3-turbo', dispositivo: 'cuda', tardo: 1 });
  await hasta(() => e.estado().estado === 'ready');
  ok('escucha: cuenta en qué anda (arrancando, cargando, lista)', estados.join() === 'starting,idle,loading,ready' && e.estado().gpu === 'RTX de mentira', estados.join());
  e.calentar();
  ok('escucha: calentar dos veces no levanta dos procesos', py.lanzados.length === 1);

  const pcm = tono(300);
  p.alPedido = (op) => { if (op.op === 'transcribir') setImmediate(() => p.decir({ ev: 'hecho', id: op.id, dur: 0.3, tardo: 0.4, idioma: 'es', segs: [{ t: 'Apagá las luces.', lp: -0.2, ns: 0, cr: 1 }] })); };
  const r = await e.transcribir(pcm, { idioma: 'es', prompt: 'Zac.' });
  const pedido = p.pedidos.find((x) => x.op === 'transcribir');
  ok('escucha: transcribe y devuelve el texto', r.texto === 'Apagá las luces.' && r.tardo === 0.4);
  ok('escucha: el audio viaja en base64, con el idioma y la pista', Buffer.from(pedido.pcm, 'base64').equals(pcm) && pedido.idioma === 'es' && pedido.prompt === 'Zac.');
  p.alPedido = (op) => { if (op.op === 'transcribir') setImmediate(() => p.decir({ ev: 'hecho', id: op.id, segs: [{ t: 'Gracias.', lp: -0.2, ns: 0, cr: 1 }] })); };
  ok('escucha: lo que Whisper inventó sale como texto vacío', (await e.transcribir(pcm)).texto === '');
  p.alPedido = (op) => { if (op.op === 'transcribir') setImmediate(() => p.decir({ ev: 'error', id: op.id, msg: 'RuntimeError: CUDA out of memory' })); };
  ok('escucha: un error de Whisper rechaza con su mensaje', await e.transcribir(pcm).then(() => false, (err) => /CUDA out of memory/.test(err.message)));
  // dos pedidos a la vez: cada respuesta vuelve al suyo
  p.alPedido = null;
  const a = e.transcribir(pcm);
  const b = e.transcribir(pcm);
  await hasta(() => p.pedidos.filter((x) => x.op === 'transcribir').length === 5);
  const [ida, idb] = p.pedidos.filter((x) => x.op === 'transcribir').slice(-2).map((x) => x.id);
  p.decir({ ev: 'hecho', id: idb, segs: [{ t: 'segunda', lp: 0, ns: 0, cr: 1 }] });
  p.decir({ ev: 'hecho', id: ida, segs: [{ t: 'primera', lp: 0, ns: 0, cr: 1 }] });
  ok('escucha: cada respuesta vuelve a su pedido', (await a).texto === 'primera' && (await b).texto === 'segunda' && ida !== idb);
  p.stdout.write('esto no es JSON\n');
  p.decir({ ev: 'hecho', id: 'no-existe', segs: [] });
  await pausa(10);
  ok('escucha: una línea rara no la rompe', e.estado().estado === 'ready');

  // el proceso se muere con un pedido en el aire
  const colgado = e.transcribir(pcm);
  await pausa(5);
  p.stderr.write("Traceback (most recent call last):\nModuleNotFoundError: No module named 'whisper'\n");
  await pausa(5);
  p.salir(1);
  ok('escucha: si el proceso se muere, el pedido en el aire se rechaza', await colgado.then(() => false, () => true));
  ok('escucha: dice qué le falta a Python', e.estado().estado === 'error' && /“whisper”/.test(e.estado().error) && e.vivo() === false, e.estado().error);
  // …y la próxima frase lo vuelve a levantar
  e.calentar();
  ok('escucha: después de caerse, se levanta de nuevo', py.lanzados.length === 2 && e.estado().estado === 'starting');
  e.apagar();
  await hasta(() => py.lanzados[1].pedidos.some((x) => x.op === 'salir'));
  ok('escucha: apagar le pide salir', py.lanzados[1].pedidos.some((x) => x.op === 'salir'));
  py.lanzados[1].salir(0);
  ok('escucha: salir porque se lo pidieron no es un error', e.estado().estado === 'off' && e.estado().error === '');
}
{
  // se apaga sola tras un rato sin uso, y un pedido lento vence
  const py = pythonDeMentira();
  const e = escucha.crear({ script: 'm.py', lanzar: py.lanzar, ociosoMs: 40, plazoMs: 60 });
  e.calentar();
  await hasta(() => py.lanzados[0]?.pedidos.some((x) => x.op === 'salir'), 600);
  ok('escucha: se apaga sola tras un rato sin uso', py.lanzados[0].pedidos.some((x) => x.op === 'salir'));
  py.lanzados[0].salir(0);
  // …salvo que haya que mantenerlo (el Echo conectado): ahí sigue, y cuando
  // deja de haber que mantenerlo se apaga en el rato siguiente
  let mantener = true;
  const fija = escucha.crear({ script: 'm.py', lanzar: py.lanzar, ociosoMs: 40, plazoMs: 60, mantener: () => mantener });
  fija.calentar();
  await new Promise((r) => setTimeout(r, 250));
  ok('escucha: con el Echo conectado no se apaga sola', !py.lanzados[1].pedidos.some((x) => x.op === 'salir') && fija.vivo());
  mantener = false;
  await hasta(() => py.lanzados[1].pedidos.some((x) => x.op === 'salir'), 600);
  ok('escucha: al dejar de mantenerla, se apaga en el rato siguiente', py.lanzados[1].pedidos.some((x) => x.op === 'salir'));
  py.lanzados[1].salir(0);
  const lento = escucha.crear({ script: 'm.py', lanzar: py.lanzar, ociosoMs: 5000, plazoMs: 40 });
  ok('escucha: un pedido que no vuelve vence', await lento.transcribir(tono(100)).then(() => false, (err) => /too long/.test(err.message)));
  lento.apagar();
  // no hay Python
  const sin = escucha.crear({ script: 'm.py', lanzar: () => { const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new Writable({ write(_c, _e, cb) { cb(); } }); setImmediate(() => p.emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }))); return p; } });
  ok('escucha: sin Python, lo dice', await sin.transcribir(tono(100)).then(() => false, () => true) && sin.estado().estado === 'error' && sin.estado().error === 'Python was not found.', sin.estado().error);
  sin.apagar();
  ok('escucha: al soltarla, el error viejo se limpia', sin.estado().estado === 'off' && sin.estado().error === '');
}
{
  // probar: ¿este Python tiene Whisper?
  const proceso = (sale, error = '', codigo = 0) => () => { const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.kill = () => {}; setImmediate(() => { if (sale) p.stdout.write(sale); if (error) p.stderr.write(error); setImmediate(() => p.emit('exit', codigo)); }); return p; };
  const bien = await escucha.probar({ lanzar: proceso('{"ok": true, "cuda": true, "gpu": "RTX", "modelo": true}\n') });
  ok('probar: Python con Whisper y placa', bien.ok === true && bien.cuda === true && bien.gpu === 'RTX' && bien.modelo === true);
  const falta = await escucha.probar({ lanzar: proceso('', "ModuleNotFoundError: No module named 'whisper'\n", 1) });
  ok('probar: dice qué paquete falta', falta.ok === false && /“whisper”/.test(falta.error), falta.error);
  const sin = await escucha.probar({ lanzar: () => { const p = new EventEmitter(); setImmediate(() => p.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }))); return p; } });
  ok('probar: sin Python, lo dice', sin.ok === false && sin.error === 'Python was not found.');
}

// ---------- La palabra clave al principio de la frase ----------
{
  const q = eco.sinPalabraClave;
  ok('palabra clave: se saca del principio', q('Okay Zac, apagá las luces.', 'okay zac') === 'apagá las luces.');
  ok('palabra clave: como la escriba Whisper', ['Ok, Zac. Apagá la luz', 'OK Zack apagá la luz', 'Okey, sac, apagá la luz', 'Oquei Zak: apagá la luz'].every((t) => q(t, 'okay zac').toLowerCase() === 'apagá la luz'), ['Ok, Zac. Apagá la luz', 'OK Zack apagá la luz', 'Okey, sac, apagá la luz', 'Oquei Zak: apagá la luz'].map((t) => q(t, 'okay zac')).join(' | '));
  ok('palabra clave: el nombre solo se queda (es hablarle)', q('Zac, apagá las luces.', 'okay zac') === 'Zac, apagá las luces.');
  ok('palabra clave: en el medio se queda', q('Decile okay zac a Sam', 'okay zac') === 'Decile okay zac a Sam');
  ok('palabra clave: una frase que no la trae queda igual', q('  Apagá   las luces. ', 'okay zac') === 'Apagá las luces.');
  ok('palabra clave: si es todo lo que se dijo, no queda nada', q('Okay, Zac.', 'okay zac') === '');
  ok('palabra clave: sin palabra clave conocida no se toca', q('Okay Zac, hola', '') === 'Okay Zac, hola' && q('', 'okay zac') === '');
  ok('palabra clave: otra parecida no se saca', q('Okay Sam, hola', 'okay zac') === 'Okay Sam, hola');
}

// ---------- La conversación con el Echo ----------
// Un mundo de mentira: el Echo, la config y una «transcripción» que el test maneja.
function mundo({ config = {}, llave = 'LLAVE-BUENA', opciones = {} } = {}) {
  const { echo, lib } = sim.crear({ llave });
  const w = { echo, config: { activa: true, host: 'atom.local', llave, ...config }, frases: [], estados: [], calentadas: 0, transcripciones: [], dice: 'Apagá las luces.', resuelve: async (h) => `ip-de-${h}` };
  w.E = eco.crear({
    cargar: async () => (w.sinLibreria ? Promise.reject(new Error('no está')) : lib),
    config: () => w.config,
    calentar: () => { w.calentadas++; },
    transcribir: async (pcm, que) => { w.transcripciones.push({ bytes: pcm.length, que }); if (w.dice instanceof Error) throw w.dice; if (typeof w.dice === 'function') return w.dice(pcm); return { texto: w.dice }; },
    alFrase: (f) => w.frases.push(f),
    alCambiar: (s) => w.estados.push(s),
    esperas: [20, 40],
    revisarMs: 60,
    resolver: (h) => w.resuelve(h),
    ...opciones,
  });
  w.conectado = () => hasta(() => w.E.estado().conexion === 'connected');
  return w;
}
{
  const w = mundo();
  ok('eco: nace apagado', w.E.estado().conexion === 'off' && w.echo.clientes.length === 0);
  await w.E.arrancar();
  ok('eco: conecta', await w.conectado());
  const cl = w.echo.clientes[0];
  ok('eco: va a la dirección que resolvió, con la llave y su nombre', cl.opciones.host === 'ip-de-atom.local' && cl.opciones.psk === 'LLAVE-BUENA' && cl.opciones.clientId === 'blackcode');
  ok('eco: se suscribe como asistente de voz, con el audio por la API', w.echo.suscripto === 1);
  ok('eco: sabe con quién habla', w.E.estado().dispositivo?.nombre === 'fake-atom' && w.E.estado().dispositivo.version === '2026.4.5');
  ok('eco: todavía no pidió nada', w.echo.eventos.length === 0 && w.calentadas === 0 && w.E.estado().fase === 'idle');

  // una frase entera
  w.echo.pedir({ palabra: 'okay zac' });
  await hasta(() => w.E.estado().fase === 'listening');
  ok('eco: acepta el pedido y abre la corrida', w.echo.nombres().join() === 'RESPUESTA,RUN_START,STT_START', w.echo.nombres().join());
  ok('eco: el modelo empieza a cargar apenas oye la palabra clave', w.calentadas === 1);
  ok('eco: acepta con el audio por la API (sin puerto, sin error)', JSON.stringify(w.echo.eventos[0].datos) === '{}');
  w.dice = 'Okay Zac, apagá las luces.';
  w.echo.hablar({ vozMs: 1500 });
  await hasta(() => w.frases.length === 1);
  ok('eco: la frase llega, sin la palabra clave', w.frases[0]?.texto === 'apagá las luces.', JSON.stringify(w.frases));
  ok('eco: le avisa al Echo que deje de mandar, le dice el texto y cierra', w.echo.nombres().join() === 'RESPUESTA,RUN_START,STT_START,STT_VAD_END,STT_END,RUN_END', w.echo.nombres().join());
  ok('eco: el texto viaja en el evento', JSON.stringify(w.echo.eventos[4]?.datos) === JSON.stringify([{ name: 'text', value: 'apagá las luces.' }]));
  ok('eco: transcribe el audio que llegó hasta el corte', w.transcripciones.length === 1 && w.transcripciones[0]?.bytes > 32000 * 2.5 && w.transcripciones[0].bytes < 32000 * 3.0 && w.transcripciones[0].que.palabra === 'okay zac', String(w.transcripciones[0]?.bytes));
  ok('eco: vuelve a esperar y recuerda lo último', w.E.estado().fase === 'idle' && w.E.estado().ultima?.texto === 'apagá las luces.');
  ok('eco: pasó por «escuchando» y «transcribiendo»', ['listening', 'transcribing', 'idle'].every((f) => w.estados.some((s) => s.fase === f)));
  // el audio que llega después de cerrar no reabre nada
  w.echo.limpiar();
  w.echo.audio(tono(500));
  await pausa(20);
  ok('eco: el audio suelto, sin pedido, se ignora', w.echo.eventos.length === 0 && w.frases.length === 1);

  // nadie habla
  w.echo.pedir();
  w.echo.audio(silencio(4600));
  await hasta(() => w.echo.nombres().includes('RUN_END'));
  const err = w.echo.eventos.find((e) => e.tipo === 'ERROR');
  ok('eco: si nadie habla, lo dice como «no entendí» (sin rojo) y cierra', w.echo.nombres().join() === 'RESPUESTA,RUN_START,STT_START,STT_VAD_END,ERROR,RUN_END' && err?.datos[0].name === 'code' && err?.datos[0].value === 'stt-no-text-recognized', w.echo.nombres().join());
  ok('eco: sin voz no se transcribe ni se manda nada', w.transcripciones.length === 1 && w.frases.length === 1 && w.E.estado().ultima?.texto === '' && w.E.estado().fase === 'idle');

  // Whisper no entendió nada (o inventó, y se filtró)
  w.echo.limpiar();
  w.dice = '';
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.echo.nombres().includes('RUN_END'));
  ok('eco: si Whisper no saca texto, no hay frase', w.frases.length === 1 && w.echo.eventos.find((e) => e.tipo === 'ERROR')?.datos[0].value === 'stt-no-text-recognized' && !w.echo.nombres().includes('STT_END'));
  // solo la palabra clave
  w.echo.limpiar();
  w.dice = 'Okay, Zac.';
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.echo.nombres().includes('RUN_END'));
  ok('eco: la palabra clave sola no es una orden', w.frases.length === 1 && !w.echo.nombres().includes('STT_END'));

  // Whisper no anda
  w.echo.limpiar();
  w.dice = new Error('Python was not found.');
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.echo.nombres().includes('RUN_END'));
  const roto = w.echo.eventos.find((e) => e.tipo === 'ERROR');
  ok('eco: si Whisper falla, el Echo se entera con un error de verdad (rojo)', roto?.datos[0].value === 'stt-provider-unavailable' && w.frases.length === 1 && w.E.estado().ultima?.error === 'Python was not found.' && w.E.estado().fase === 'idle', JSON.stringify(roto));

  // un pedido nuevo pisa al que estaba a medias
  w.echo.limpiar();
  w.dice = 'la segunda';
  w.echo.pedir();
  w.echo.audio(Buffer.concat([silencio(200), tono(600)])); // a medias: todavía habla
  await pausa(10);
  w.echo.pedir();
  w.echo.hablar({ vozMs: 800 });
  await hasta(() => w.frases.length === 2);
  ok('eco: un pedido nuevo pisa al que estaba a medias', w.frases[1]?.texto === 'la segunda' && w.echo.nombres().filter((n) => n === 'STT_END').length === 1 && w.transcripciones.at(-1)?.bytes < 32000 * 2.4, `${w.frases.length} ${w.transcripciones.at(-1)?.bytes}`);

  // el Echo corta por su cuenta (soltaron el botón, se le acabó el tiempo)
  w.echo.limpiar();
  w.dice = 'hasta acá';
  w.echo.pedir();
  w.echo.audio(Buffer.concat([silencio(200), tono(700)]));
  await pausa(10);
  w.echo.pedir({ start: false });
  await hasta(() => w.frases.length === 3);
  ok('eco: si el Echo corta, se transcribe lo que había', w.frases[2]?.texto === 'hasta acá');
  w.echo.limpiar();
  w.dice = 'último tramo';
  w.echo.pedir();
  w.echo.audio(Buffer.concat([silencio(200), tono(700)]), { end: true });
  await hasta(() => w.frases.length === 4);
  ok('eco: el tramo marcado como último cierra la frase', w.frases[3]?.texto === 'último tramo');

  // se corta la conexión con una frase a medias
  w.echo.limpiar();
  w.echo.pedir();
  w.echo.audio(Buffer.concat([silencio(200), tono(600)]));
  await pausa(10);
  w.echo.cortar();
  await hasta(() => w.E.estado().conexion === 'connecting');
  ok('eco: si se corta la conexión, la frase a medias se pierde', w.E.estado().fase === 'idle' && w.frases.length === 4);
  w.echo.volver();
  ok('eco: cuando vuelve, sigue conectado', await w.conectado());
  // (el audio que llegue ahora no es de ninguna frase: la de antes se perdió con el corte)
  w.dice = 'fantasma';
  w.echo.audio(Buffer.concat([tono(600), silencio(1300)]));
  await pausa(40);
  ok('eco: tras un corte, el audio suelto no revive la frase a medias', w.frases.length === 4 && w.E.estado().fase === 'idle', JSON.stringify(w.frases.at(-1)));
  w.dice = 'después del corte';
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.frases.length === 5);
  ok('eco: después de un corte sigue atendiendo, sin conectar otra vez', w.frases[4]?.texto === 'después del corte' && w.echo.clientes.length === 1);
  // …y si no vuelve solo, se empieza de cero
  w.echo.cortar();
  await hasta(() => w.echo.clientes.length === 2, 800);
  ok('eco: si la conexión no vuelve sola, conecta de nuevo', w.echo.clientes.length === 2 && await w.conectado());

  // se apaga con una transcripción en el aire: no sale nada
  let soltar;
  w.dice = () => new Promise((r) => { soltar = r; });
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.E.estado().fase === 'transcribing');
  w.E.parar();
  soltar?.({ texto: 'llegó tarde' });
  await pausa(20);
  ok('eco: apagar con una transcripción en el aire no manda nada', w.frases.length === 5 && w.E.estado().conexion === 'off' && w.E.estado().fase === 'idle');
  ok('eco: al apagar se desuscribe y desconecta', w.echo.suscripto === null && w.echo.clientes.every((c) => c.conectado === false));
  w.echo.pedir();
  w.echo.hablar();
  await pausa(30);
  ok('eco: apagado, no atiende', w.frases.length === 5);
}
{
  // apagada en la config: ni se conecta
  const w = mundo({ config: { activa: false } });
  await w.E.arrancar();
  await pausa(20);
  ok('eco: con la escucha apagada no se conecta', w.echo.clientes.length === 0 && w.E.estado().conexion === 'off');
  // se prende, se apaga
  w.config.activa = true;
  await w.E.arrancar();
  ok('eco: al prenderla, conecta', await w.conectado());
  w.config.activa = false;
  await w.E.arrancar();
  ok('eco: al apagarla, desconecta', w.E.estado().conexion === 'off' && w.echo.clientes[0].conectado === false && w.echo.desconexiones === 1);
}
{
  // sin dirección
  const w = mundo({ config: { host: '  ' } });
  await w.E.arrancar();
  ok('eco: sin dirección, lo dice y no intenta', w.E.estado().conexion === 'error' && w.E.estado().error === 'No address set.' && w.echo.clientes.length === 0);
  // una llave guardada que Windows ya no descifra
  const rota = mundo({ config: { llave: null, ilegible: true } });
  await rota.E.arrancar();
  ok('eco: con la llave guardada ilegible, pide pegarla de nuevo y no intenta', rota.E.estado().conexion === 'error' && /can no longer be read/.test(rota.E.estado().error) && rota.echo.clientes.length === 0, rota.E.estado().error);
}
{
  // la llave está mal: no se arregla reintentando
  const w = mundo({ config: { llave: 'OTRA-LLAVE' } });
  await w.E.arrancar();
  await hasta(() => w.E.estado().conexion === 'error');
  ok('eco: con la llave equivocada, lo dice', w.E.estado().error === 'The key is wrong.', w.E.estado().error);
  await pausa(120);
  ok('eco: …y no reintenta sola', w.echo.clientes.length === 1 && w.E.estado().conexion === 'error');
  // el usuario la corrige
  w.config.llave = 'LLAVE-BUENA';
  await w.E.arrancar();
  ok('eco: con la llave corregida, conecta', await w.conectado());
  w.E.parar();
  const sin = mundo({ config: { llave: '' } });
  await sin.E.arrancar();
  await hasta(() => sin.E.estado().conexion === 'error');
  ok('eco: sin llave en un Echo que la pide, lo dice', sin.E.estado().error === 'This device needs its key.' && sin.echo.clientes[0].opciones.psk === null, sin.E.estado().error);
}
{
  // el Echo está apagado: se reintenta, espaciando, hasta que aparece
  const w = mundo();
  w.echo.falla = Object.assign(new Error('Connection to x failed: connection refused.'), { name: 'ConnectionRefusedError', code: 'ECONNREFUSED' });
  await w.E.arrancar();
  await hasta(() => w.E.estado().error !== '');
  ok('eco: si no llega, lo dice y sigue intentando', w.E.estado().conexion === 'connecting' && w.E.estado().error === 'Could not reach atom.local.', w.E.estado().error);
  await hasta(() => w.echo.clientes.length >= 3, 800);
  ok('eco: reintenta', w.echo.clientes.length >= 3);
  w.echo.falla = null;
  ok('eco: cuando el Echo aparece, conecta', await w.conectado());
  const n = w.echo.clientes.length;
  await pausa(120);
  ok('eco: una vez conectado, deja de reintentar', w.echo.clientes.length === n);
  w.E.parar();
}
{
  // el nombre no se resuelve: se reintenta; si ya se lo había visto, se usa la dirección de la última vez
  const w = mundo();
  let n = 0;
  w.resuelve = async () => { n++; throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); };
  await w.E.arrancar();
  await hasta(() => w.E.estado().error !== '');
  ok('eco: si el nombre no aparece en la red, lo dice', w.E.estado().error === 'Could not find atom.local on the network.' && w.echo.clientes.length === 0, w.E.estado().error);
  w.resuelve = async () => '10.0.0.7';
  ok('eco: cuando aparece, conecta', await w.conectado() && w.echo.clientes.at(-1).opciones.host === '10.0.0.7' && n >= 1);
  w.resuelve = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); };
  await w.E.arrancar();
  ok('eco: si el nombre falla pero ya se lo había encontrado, va a la última dirección', await w.conectado() && w.echo.clientes.at(-1).opciones.host === '10.0.0.7');
  w.E.parar();
  ok('eco: una IP no se resuelve', (await eco.buscar('192.168.1.20')) === '192.168.1.20');
}
{
  // un dispositivo de ESPHome sin asistente de voz
  const w = mundo();
  w.echo.capacidades = { supported: false };
  await w.E.arrancar();
  await hasta(() => w.E.estado().conexion === 'error');
  ok('eco: un dispositivo sin asistente de voz se rechaza', /no voice assistant/.test(w.E.estado().error) && w.echo.suscripto === null && w.echo.clientes[0].conectado === false, w.E.estado().error);
}
{
  // esta versión de la app no trae la librería
  const w = mundo();
  w.sinLibreria = true;
  await w.E.arrancar();
  ok('eco: sin la librería, lo dice', w.E.estado().conexion === 'error' && /not installed/.test(w.E.estado().error));
}
{
  // arrancar dos veces seguidas no deja dos conexiones atendiendo
  const w = mundo();
  w.E.arrancar();
  await w.E.arrancar();
  await w.conectado();
  w.dice = 'una sola vez';
  w.echo.pedir();
  w.echo.hablar();
  await hasta(() => w.frases.length >= 1);
  await pausa(30);
  ok('eco: arrancar dos veces no duplica la frase', w.frases.length === 1 && w.echo.clientes.filter((c) => c.conectado).length === 1, `${w.frases.length} frases, ${w.echo.clientes.filter((c) => c.conectado).length} conectados`);
  w.E.parar();
}
{
  // el audio no llega nunca: la corrida no queda abierta para siempre
  const w = mundo({ opciones: { opcionesCorte: { esperaMs: 30 } } });
  await w.E.arrancar();
  await w.conectado();
  w.echo.pedir();
  await hasta(() => w.echo.nombres().includes('RUN_END'), 4000);
  ok('eco: si el audio no llega nunca, cierra igual', w.echo.nombres().includes('RUN_END') && w.E.estado().fase === 'idle' && w.frases.length === 0, w.echo.nombres().join());
  w.E.parar();
}

// ---------- El habla: un texto para oír ----------
{
  const o = habla.paraOir;
  ok('oír: el markdown no se lee', o('**Listo**, _Fran_: `luces` apagadas.') === 'Listo, Fran: luces apagadas.');
  ok('oír: el código se saltea', o('Hice esto:\n```js\nconst x = 1;\n```\nY anduvo.') === 'Hice esto: Y anduvo.', o('Hice esto:\n```js\nconst x = 1;\n```\nY anduvo.'));
  ok('oír: de un link queda su texto, y una dirección suelta se dice «link» (no se deletrea ni deja la frase colgando)', o('Mirá [la nota](https://a.b/c) o https://x.y/z ahora.') === 'Mirá la nota o link ahora.' && o('Más detalles en https://ejemplo.com/luces') === 'Más detalles en link');
  ok('oír: una tabla se saltea', !o('Antes.\n| a | b |\n|---|---|\n| 1 | 2 |\nDespués.').includes('|') && o('Antes.\n| a | b |\n|---|---|\n| 1 | 2 |\nDespués.').includes('Después.'));
  ok('oír: títulos, listas y citas quedan como frases', o('# Título\n- uno\n- dos\n> cita') === 'Título. uno. dos. cita');
  ok('oír: sin emojis', o('Listo 😀🚀') === 'Listo');
  ok('oír: nada es nada', o('') === '' && o(null) === '' && o('```\nsolo código\n```') === '');
  const f = habla.enFrases;
  ok('frases: una frase corta va sola', JSON.stringify(f('Listo Fran, luces apagadas.')) === '["Listo Fran, luces apagadas."]');
  ok('frases: las cortitas van juntas', f('Hola. Listo. Ya está.').length === 1);
  const largas = f('Esta es una primera oración bastante larga que habla de muchas cosas a la vez y no termina nunca jamás, de verdad. Y esta es la segunda oración, también larga, que sigue hablando de otras cosas distintas a las anteriores sin parar. Y la tercera cierra.');
  ok('frases: las largas van de a una', largas.length >= 2 && largas.every((x) => x.length <= 240), JSON.stringify(largas.map((x) => x.length)));
  const eterna = f(`${'palabra '.repeat(80)}fin.`);
  ok('frases: una frase eterna se parte', eterna.length >= 3 && eterna.every((x) => x.length <= 241), JSON.stringify(eterna.map((x) => x.length)));
  const mucho = f(Array.from({ length: 40 }, (_, i) => `Esta es la oración número ${i + 1} de una respuesta que es para leer.`).join(' '));
  ok('frases: lo que pasa del tope no se dice', mucho.join(' ').length <= habla.TOPE + 240 && mucho.join(' ').length >= 400 && !mucho.join(' ').includes('número 40'), String(mucho.join(' ').length));
  ok('frases: sin texto no hay frases', f('').length === 0 && f('```\nx\n```').length === 0);
}

// ---------- El habla: el proceso de la voz ----------
{
  const py = pythonDeMentira();
  const audios = [];
  const fines = [];
  const c = { modelo: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', muestra: 'C:/voz/zac.mp3', idioma: 'es' };
  let exe = 'C:/env/python.exe';
  const h = habla.crear({ python: () => exe, script: 'habla.py', lanzar: py.lanzar, config: () => c, existe: (p) => p !== 'C:/voz/no-esta.wav', alAudio: (a) => audios.push(a), alFin: (x) => fines.push(x) });
  ok('habla: no levanta nada hasta que hace falta', py.lanzados.length === 0 && h.estado().estado === 'off' && h.estado().hablando === false);
  ok('habla: sin nada que decir no dice', h.decir('') === null && h.decir('```\ncódigo\n```') === null && py.lanzados.length === 0);
  const t1 = h.decir('Listo Fran, luces apagadas.');
  const p = py.lanzados[0];
  await hasta(() => p?.pedidos.length === 2);
  ok('habla: levanta el Python de la voz con su motor', py.lanzados.length === 1 && p.comando === 'C:/env/python.exe' && p.args.includes('habla.py'));
  ok('habla: primero carga el modelo con la muestra, después dice', p.pedidos[0]?.op === 'cargar' && p.pedidos[0].modelo === c.modelo && p.pedidos[0].referencia === 'C:/voz/zac.mp3' && p.pedidos[1]?.op === 'decir' && p.pedidos[1].texto === 'Listo Fran, luces apagadas.' && p.pedidos[1].id === `${t1}.0`, JSON.stringify(p.pedidos));
  ok('habla: el idioma viaja como lo espera el modelo', p.pedidos[1].idioma === 'Spanish');
  ok('habla: mientras dice, está hablando', h.estado().hablando === true);
  p.decir({ ev: 'listo', gpu: 'RTX de mentira' });
  p.decir({ ev: 'cargando', modelo: c.modelo });
  p.decir({ ev: 'cargado', modelo: c.modelo, tardo: 1 });
  const pcm = tono(100);
  p.decir({ ev: 'audio', id: `${t1}.0`, n: 0, sr: 24000, pcm: pcm.toString('base64') });
  p.decir({ ev: 'audio', id: `${t1}.0`, n: 1, sr: 24000, pcm: pcm.toString('base64') });
  p.decir({ ev: 'fin', id: `${t1}.0`, dur: 0.2, tardo: 0.1, primero: 0.05, callado: false });
  await hasta(() => fines.length === 1);
  ok('habla: el audio sale por tramos, en orden, como llegó', audios.length === 2 && audios[0].turno === t1 && audios[0].n === 0 && audios[1].n === 1 && audios[0].sr === 24000 && audios[0].pcm.equals(pcm));
  ok('habla: avisa cuando terminó de decir', fines[0].turno === t1 && fines[0].callado === false && !fines[0].error && h.estado().hablando === false && h.estado().estado === 'ready');

  // una respuesta de varias frases: una por pedido, y el modelo no se vuelve a cargar
  const t2 = h.decir('Esta es una primera oración bastante larga que habla de muchas cosas a la vez y no termina nunca jamás, de verdad. Y esta es la segunda oración, también larga, que sigue hablando de otras cosas distintas a las anteriores sin parar.');
  await hasta(() => p.pedidos.length === 4);
  ok('habla: cada frase va en su pedido, y el modelo se carga una sola vez', p.pedidos.filter((x) => x.op === 'cargar').length === 1 && p.pedidos[2].id === `${t2}.0` && p.pedidos[3].id === `${t2}.1`);
  p.decir({ ev: 'audio', id: `${t2}.0`, n: 0, sr: 24000, pcm: pcm.toString('base64') });
  p.decir({ ev: 'fin', id: `${t2}.0`, callado: false });
  p.decir({ ev: 'audio', id: `${t2}.1`, n: 0, sr: 24000, pcm: pcm.toString('base64') });
  await hasta(() => audios.length === 4);
  ok('habla: los tramos de un turno se numeran de corrido, frase tras frase', audios[2].turno === t2 && audios[2].n === 0 && audios[3].n === 1 && fines.length === 1);
  // callar a mitad: se le avisa al motor por cada frase que faltaba, y lo que siga llegando no suena
  ok('habla: callar dice que había algo', h.callar() === true && h.estado().hablando === false);
  await hasta(() => p.pedidos.some((x) => x.op === 'callar'));
  ok('habla: al callar, el motor deja de generar lo que faltaba', p.pedidos.filter((x) => x.op === 'callar').map((x) => x.id).join() === `${t2}.1`, JSON.stringify(p.pedidos.filter((x) => x.op === 'callar')));
  p.decir({ ev: 'audio', id: `${t2}.1`, n: 1, sr: 24000, pcm: pcm.toString('base64') });
  p.decir({ ev: 'fin', id: `${t2}.1`, callado: true });
  await hasta(() => fines.length === 2);
  ok('habla: lo que llega después de callar no suena', audios.length === 4 && fines[1].turno === t2 && fines[1].callado === true);
  ok('habla: callar sin nada que callar no hace nada', h.callar() === false);

  // cambia la muestra: el modelo se prepara de nuevo
  c.muestra = 'C:/voz/otra.wav';
  h.decir('Otra voz.');
  await hasta(() => p.pedidos.filter((x) => x.op === 'cargar').length === 2);
  ok('habla: con otra muestra, se prepara de nuevo', p.pedidos.filter((x) => x.op === 'cargar')[1]?.referencia === 'C:/voz/otra.wav');
  // el motor falla con esa frase
  const idError = p.pedidos.at(-1).id;
  p.decir({ ev: 'error', id: idError, msg: 'RuntimeError: CUDA out of memory' });
  await hasta(() => fines.length === 3);
  ok('habla: si el motor falla, se sabe por qué', /CUDA out of memory/.test(fines[2].error) && h.estado().estado === 'error' && /CUDA out of memory/.test(h.estado().error));
  // el proceso se muere a mitad de una frase
  const t4 = h.decir('Me voy a cortar.');
  await pausa(10);
  p.stderr.write("ModuleNotFoundError: No module named 'faster_qwen3_tts'\n");
  await pausa(5);
  p.salir(1);
  await hasta(() => fines.length === 4);
  ok('habla: si el proceso se muere, el turno se cierra y dice qué falta', fines[3].turno === t4 && /“faster_qwen3_tts”/.test(h.estado().error) && h.vivo() === false, h.estado().error);
  // …y la próxima frase lo levanta de nuevo, cargando el modelo otra vez
  h.decir('De vuelta.');
  await hasta(() => py.lanzados[1]?.pedidos.length === 2);
  ok('habla: después de caerse, se levanta y carga de nuevo', py.lanzados.length === 2 && py.lanzados[1].pedidos[0].op === 'cargar');
  h.apagar();
  await hasta(() => py.lanzados[1].pedidos.some((x) => x.op === 'salir'));
  py.lanzados[1].salir(0);
  ok('habla: apagar le pide salir, y no es un error', h.estado().estado === 'off' && h.estado().error === '');

  // lo que falta para poder hablar
  exe = '';
  ok('habla: sin Python, lo dice', h.decir('Hola.') === null && h.estado().error === 'No Python set for the voice.');
  exe = 'C:/env/python.exe';
  c.muestra = '';
  ok('habla: sin muestra, lo dice', h.decir('Hola.') === null && h.estado().error === 'No voice sample set.' && py.lanzados.length === 2);
  c.muestra = 'C:/voz/no-esta.wav';
  ok('habla: con una muestra que no está, lo dice', h.decir('Hola.') === null && h.estado().error === 'The voice sample was not found.' && py.lanzados.length === 2);
  // el usuario elige otra muestra: la app suelta el proceso, y el cartel de antes no se queda pegado
  h.apagar();
  ok('habla: al soltarla, el error viejo se limpia', h.estado().estado === 'off' && h.estado().error === '');
  // se apaga sola
  const corto = habla.crear({ python: () => 'py', script: 'h.py', lanzar: py.lanzar, config: () => ({ muestra: 'C:/voz/zac.mp3' }), existe: () => true, ociosoMs: 40 });
  corto.calentar();
  await hasta(() => py.lanzados.at(-1).pedidos.some((x) => x.op === 'salir'), 600);
  ok('habla: calentar carga el modelo sin decir nada, y se apaga sola tras un rato', py.lanzados.at(-1).pedidos[0].op === 'cargar' && py.lanzados.at(-1).pedidos.some((x) => x.op === 'salir') && !py.lanzados.at(-1).pedidos.some((x) => x.op === 'decir'));
  // probar: ¿ese Python tiene la voz?
  const proceso = (sale, error = '', codigo = 0) => () => { const q = new EventEmitter(); q.stdout = new PassThrough(); q.stderr = new PassThrough(); q.kill = () => {}; setImmediate(() => { if (sale) q.stdout.write(sale); if (error) q.stderr.write(error); setImmediate(() => q.emit('exit', codigo)); }); return q; };
  ok('probar la voz: un Python que la tiene', (await habla.probar({ python: 'py', lanzar: proceso('{"ok": true, "cuda": true, "gpu": "RTX"}\n') })).gpu === 'RTX');
  ok('probar la voz: dice qué paquete falta', /“faster_qwen3_tts”/.test((await habla.probar({ python: 'py', lanzar: proceso('', "ModuleNotFoundError: No module named 'faster_qwen3_tts'\n", 1) })).error));
  ok('probar la voz: sin Python elegido, lo dice', (await habla.probar({ python: '' })).error === 'No Python set for the voice.');
}

// ---------- El cifrado que Electron no trae ----------
{
  // Acá (node) ChaCha20-Poly1305 existe: sirve para comprobar que el propio da lo mismo, de ida y de vuelta.
  const chacha = require(path.join(APP, 'main', 'chacha.cjs'));
  const crypto = require('node:crypto');
  const { chacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  ok('cifrado: node lo trae, y el vector de la RFC 8439 pasa', chacha.nativo() === true && (await chacha.instalar()) === 'nativo' && chacha.probar() === true);
  const clave = Buffer.alloc(32, 7);
  const nonce = Buffer.from('000000000102030405060708', 'hex');
  const aad = Buffer.from('cabecera');
  const claro = Buffer.from('okay zac, apagá las luces');
  const mio = chacha.cifrador(chacha20poly1305, clave, nonce);
  mio.setAAD(aad, { plaintextLength: claro.length });
  const cifradoMio = Buffer.concat([mio.update(claro.subarray(0, 5)), mio.update(claro.subarray(5)), mio.final()]);
  const suyo = crypto.createCipheriv('chacha20-poly1305', clave, nonce, { authTagLength: 16 });
  suyo.setAAD(aad);
  const cifradoSuyo = Buffer.concat([suyo.update(claro), suyo.final()]);
  ok('cifrado: el propio cifra igual que el de node, con la misma marca', cifradoMio.equals(cifradoSuyo) && mio.getAuthTag().equals(suyo.getAuthTag()) && cifradoMio.length === claro.length);
  const abrir = (datos, marca, conAad = aad) => { const d = chacha.descifrador(chacha20poly1305, clave, nonce); d.setAAD(conAad); d.setAuthTag(marca); return Buffer.concat([d.update(datos), d.final()]); };
  ok('cifrado: el propio descifra lo que cifró node', abrir(cifradoSuyo, suyo.getAuthTag()).equals(claro));
  const tocado = Buffer.from(cifradoSuyo); tocado[2] ^= 1;
  const tira = (fn) => { try { fn(); return false; } catch { return true; } };
  ok('cifrado: un dato tocado, otra marca u otra cabecera no pasan', tira(() => abrir(tocado, suyo.getAuthTag())) && tira(() => abrir(cifradoSuyo, Buffer.alloc(16, 1))) && tira(() => abrir(cifradoSuyo, suyo.getAuthTag(), Buffer.from('otra'))) && tira(() => abrir(cifradoSuyo, Buffer.alloc(4))));
  const vacio = chacha.cifrador(chacha20poly1305, clave, nonce); vacio.setAAD(aad);
  const nada = vacio.final();
  const suyoVacio = crypto.createCipheriv('chacha20-poly1305', clave, nonce, { authTagLength: 16 }); suyoVacio.setAAD(aad); suyoVacio.final();
  ok('cifrado: sin datos también da la marca correcta (el saludo de Noise empieza así)', nada.length === 0 && vacio.getAuthTag().equals(suyoVacio.getAuthTag()));
  const fuenteV = fs.readFileSync(path.join(APP, 'main', 'voz.cjs'), 'utf8');
  ok('el cifrado se instala antes de cargar la librería del Echo', fuenteV.includes("async () => { await require('./chacha.cjs').instalar(); return import('esphome-client'); }"));
  const fuenteC = fs.readFileSync(path.join(APP, 'main', 'chacha.cjs'), 'utf8');
  ok('solo ese algoritmo va al propio, y lo importado como módulo ES ve el cambio', fuenteC.includes('if (!esEl(algo)) return cifrar.call(this, algo, clave, nonce, ...resto);') && fuenteC.includes("require('node:module').syncBuiltinESMExports();") && fuenteC.includes("if (nativo()) return 'nativo';"));
  const paqueteC = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok('la app lleva @noble/ciphers', typeof paqueteC.dependencies['@noble/ciphers'] === 'string');
}

// ---------- La llave y el cableado ----------
{
  // voz.cjs pide electron al cablear, no al cargarse
  const voz = require(path.join(APP, 'main', 'voz.cjs'));
  const buena = Buffer.alloc(32, 5).toString('base64');
  ok('llave: 32 bytes en base64 es una llave', voz.esLlave(buena) && voz.esLlave(`  ${buena}\n`));
  ok('llave: otra cosa no', !voz.esLlave('hola') && !voz.esLlave('') && !voz.esLlave(null) && !voz.esLlave(Buffer.alloc(16, 5).toString('base64')) && !voz.esLlave(`${buena}=`) && !voz.esLlave(buena.replace(/.$/, '!')));
  ok('la config de la voz es un documento reservado (la interfaz no lo lee)', voz.DOC.startsWith('_'));
  const fuente = fs.readFileSync(path.join(APP, 'main', 'voz.cjs'), 'utf8');
  ok('la llave se guarda cifrada y no viaja a la interfaz', fuente.includes('const blob = cifrar(String(texto).trim());') && fuente.includes('d.llave = blob;') && fuente.includes('const { hayLlave, ...c } = config();') && !/rad\.send\([^)]*llave/.test(fuente));
  ok('si Windows no puede cifrar, la llave no se guarda', fuente.includes("if (!blob) return { ok: false, error: 'Windows could not encrypt the key, so it was not saved.' };"));
  ok('la frase le llega a la interfaz con el agente y el permiso', fuente.includes("rad.send('voz:frase', { n: ++cuenta, texto: f.texto, agente: c.agente, actua: c.actua, tardo: f.ms });"));
  ok('al abrir la app conecta recién cuando safeStorage puede descifrar', fuente.includes('electron.app.whenReady().then(() => { eco.arrancar(); aplicarMicro(); });') && !/\n  eco\.arrancar\(\);\n/.test(fuente));
  ok('con el micrófono de la PC elegido, el Echo no conecta (cada hardware excluye al otro)', fuente.includes("activa: c.activa && c.fuente === 'eco', host: c.host"));
  ok('una llave que no se pudo descifrar se avisa como ilegible', fuente.includes('ilegible: c.hayLlave && !llave'));
  ok('cambiar el Python o la muestra suelta el proceso (y con él, el error que hubiera)', fuente.includes("!== (d.python ?? '')) { d.python = c.python.trim().slice(0, 400); escucha.apagar(); }") && fuente.includes('{ callar(); habla.apagar(); }'));
  ok('al salir se desconecta y se apagan Whisper, la voz, el detector de la palabra y el atajo', fuente.includes("electron.app.on('before-quit', () => { eco.parar(); escucha.apagar(); habla.apagar(); palabra.apagar(); micro.activar(false); ponerAtajo(false); });"));
  ok('la palabra clave calla al agente si estaba hablando, y el modelo de voz empieza a cargar ahí', fuente.includes('calentar: () => { callar(); if (config().habla.activa) { try { habla.calentar(); }'));
  ok('la respuesta hablada viene apagada y solo habla si está prendida (o es la prueba de Settings)', fuente.includes('activa: d.habla?.activa === true,') && fuente.includes("if (!c.habla.activa && !prueba) return { ok: false, error: 'Spoken answers are off.' };"));
  ok('el motor viaja fuera del asar', fuente.includes("path.join(process.resourcesPath, 'motor', 'escucha_motor.py')"));
  const chat = fs.readFileSync(path.join(APP, 'main', 'chat.cjs'), 'utf8');
  ok('la voz se cablea con el cifrado de la app, y de mentira en el humo', chat.includes("require('./voz.cjs').wire(rad, { taller, cifrar, descifrar, agentes: losAgentes, simulada: ecoDeMentira, llaveElevenlabs: () => llave.leer(rad.store, 'elevenlabs'), alConversacion });") && chat.includes('function wire(rad, { llave, alConversacion })') && chat.includes("const ecoDeMentira = taller ? require('./eco-simulado.cjs').paraElHumo() : null;"));
  ok('una llave de ElevenLabs nueva hace que se vuelvan a pedir las voces de la cuenta', chat.includes("if (proveedor === 'elevenlabs') voz.alCambiarLlave();"));
  const paquete = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok('el paquete lleva la librería del Echo y los motores de Whisper y de la voz', typeof paquete.dependencies['esphome-client'] === 'string' && JSON.stringify(paquete.build.extraResources) === JSON.stringify([{ from: 'motor', to: 'motor', filter: ['*.py'] }]) && fs.existsSync(path.join(APP, 'motor', 'escucha_motor.py')) && fs.existsSync(path.join(APP, 'motor', 'habla_motor.py')));
  const interfaz = fs.readFileSync(path.join(APP, 'renderer', 'voz.js'), 'utf8');
  ok('el agente sabe que lo van a oír solo si el turno se dijo y se contesta en voz alta', chat.includes("if (pedido.voz && voz.hablaActiva()) pedido.instrucciones = [pedido.instrucciones, require('./voz.cjs').VOICE_NOTE].filter(Boolean).join('\\n\\n');") && chat.includes('voz: voz === true,') && /read aloud/.test(voz.VOICE_NOTE) && /no markdown/.test(voz.VOICE_NOTE));
  ok('solo se dice en voz alta la respuesta de un turno de voz que terminó bien', interfaz.includes("const decirla = datos.voz().habla?.activa && t.estado === 'ok' && t.texto.trim();") && interfaz.includes("decirla ? window.rad.invoke('voz:decir', { texto: t.texto })") && interfaz.indexOf("window.rad.invoke('voz:decir', { texto: t.texto })") > interfaz.indexOf('if (t.voz) {'));
  ok('en una conversación por el micrófono, vuelve a escuchar cuando la respuesta terminó de sonar', interfaz.includes('habla.cuandoTermine(r.turno)') && interfaz.includes(".then(listoParaEscuchar)"));
  const motorHabla = fs.readFileSync(path.join(APP, 'motor', 'habla_motor.py'), 'utf8');
  ok('el motor de la voz no lee stdin en un hilo (en Windows eso cuelga la carga del modelo) ni guarda el audio', !/^import threading|^import queue/m.test(motorHabla) && motorHabla.includes('PeekNamedPipe') && !/open\(|tempfile|sf\.write/.test(motorHabla) && motorHabla.includes('xvec_only=True'));
  ok('un turno de voz va en manual salvo que el usuario lo prenda', interfaz.includes("{ voz: true, modo: f.actua ? 'auto' : 'manual' }"));
  const motorPy = fs.readFileSync(path.join(APP, 'motor', 'escucha_motor.py'), 'utf8');
  ok('el motor no escribe el audio en el disco', !/open\(|\.write\(|tempfile|wav/.test(motorPy.replace(/sys\.stdout\.write\(/g, '')));
}

if (failures.length) {
  console.error(`test-blackcode-voz: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-voz: ok (${hechas} comprobaciones: el corte de la frase, lo que Whisper inventa, el proceso de Whisper, la palabra clave, la conversación con el Echo —frases, silencios, errores, cortes y reconexiones—, el texto para oír, el proceso de la voz, la llave y el cableado)`);
process.exit(0);
