// Test de la voz de ElevenLabs de BlackCode (main/elevenlabs.cjs): comprobar la
// llave, traer las voces y los modelos, y decir un texto por tramos, contra un
// ElevenLabs de mentira en 127.0.0.1. Con node pelado: sin red y sin gastar
// créditos.
// Uso: node tools/test-blackcode-elevenlabs.mjs

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await pausa(5); } return Boolean(cond()); }

// ---------- El ElevenLabs de mentira ----------
const pedidos = [];
const VOCES = Array.from({ length: 3 }, (_, i) => ({ voice_id: `voz${i}`, name: ['Zac', 'Cintia', 'Rachel'][i], category: i < 2 ? 'cloned' : 'premade' }));
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['xi-api-key'];
  let cuerpo = '';
  for await (const c of req) cuerpo += c;
  pedidos.push({ metodo: req.method, ruta: url.pathname, query: Object.fromEntries(url.searchParams), key, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
  const error = (status, codigo, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: { status: codigo, message } })); };
  if (key === 'llave-mala') return error(401, 'invalid_api_key', 'Invalid API key');
  if (url.pathname === '/v2/voices') {
    if (key === 'llave-sin-voces') return error(401, 'missing_permissions', 'The API key you used is missing the permission voices_read to execute this operation.');
    if (key === 'llave-rota') return error(500, 'internal', 'boom');
    // de a dos por página, para probar que sigue el token
    const tam = Number(url.searchParams.get('page_size')) === 1 ? 1 : 2;
    const desde = Number(url.searchParams.get('next_page_token') ?? 0);
    const pagina = VOCES.slice(desde, desde + tam);
    const hay = desde + tam < VOCES.length;
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ voices: pagina, has_more: hay, next_page_token: hay ? String(desde + tam) : null }));
  }
  if (url.pathname === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify([
      { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', can_do_text_to_speech: true },
      { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', can_do_text_to_speech: true },
      { model_id: 'eleven_multilingual_sts_v2', name: 'Speech to speech', can_do_text_to_speech: false },
      { model_id: 'eleven_secreto', name: 'Alpha', can_do_text_to_speech: true, requires_alpha_access: true },
    ]));
  }
  const tts = /^\/v1\/text-to-speech\/([^/]+)\/stream$/.exec(url.pathname);
  if (tts && req.method === 'POST') {
    if (key === 'sin-creditos') return error(401, 'quota_exceeded', 'This request exceeds your quota.');
    if (tts[1] === 'borrada') return error(404, 'voice_not_found', 'A voice with that id was not found.');
    if (url.searchParams.get('output_format') !== 'pcm_24000') return error(400, 'bad_format', 'wrong format');
    // 0,5 s de audio (24000 bytes) en pedazos impares, para probar que no parte una muestra
    res.writeHead(200, { 'content-type': 'audio/pcm' });
    const lenta = tts[1] === 'lenta';
    const total = Buffer.alloc(24000);
    for (let i = 0; i < total.length; i += 2) total.writeInt16LE(i % 512, i);
    for (let i = 0; i < total.length; i += 4801) {
      if (res.destroyed) return;
      res.write(total.subarray(i, i + 4801));
      await pausa(lenta ? 120 : 2);
    }
    return res.end();
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${servidor.address().port}/`;
const once = require(path.join(APP, 'main', 'elevenlabs.cjs'));

// ---------- La llave ----------
{
  ok('llave: la que sirve, la acepta', (await once.comprobar('llave-buena')).fase === 'aceptada');
  ok('llave: lo pregunta con un pedido que no gasta (la primera voz)', pedidos.at(-1).ruta === '/v2/voices' && pedidos.at(-1).query.page_size === '1' && pedidos.at(-1).key === 'llave-buena');
  const mala = await once.comprobar('llave-mala');
  ok('llave: la inválida, la rechaza', mala.fase === 'rechazada' && mala.motivo === 'invalida' && mala.detalle === 'Invalid API key', JSON.stringify(mala));
  const sin = await once.comprobar('llave-sin-voces');
  ok('llave: sin permiso para leer las voces, la rechaza por eso', sin.fase === 'rechazada' && sin.motivo === 'sin-voces' && /voices_read/.test(sin.detalle), JSON.stringify(sin));
  ok('llave: si ElevenLabs falla, no es un rechazo', (await once.comprobar('llave-rota')).fase === 'sin-comprobar');
  ok('llave: sin conexión, no es un rechazo', (await once.comprobar('x', { fetch: async () => { throw new TypeError('fetch failed'); } })).motivo === 'conexion');
}

// ---------- Las voces y los modelos ----------
{
  const c = await once.catalogo('llave-buena');
  ok('catálogo: trae todas las voces, página tras página', c.voces.map((v) => v.nombre).join() === 'Zac,Cintia,Rachel' && c.voces[0].id === 'voz0' && c.voces[0].categoria === 'cloned', JSON.stringify(c.voces));
  ok('catálogo: solo los modelos que hablan y que se pueden usar', c.modelos.map((m) => m.id).join() === 'eleven_flash_v2_5,eleven_multilingual_v2', JSON.stringify(c.modelos));
  let error = '';
  try { await once.catalogo('llave-mala'); } catch (e) { error = e.message; }
  ok('catálogo: con una llave mala, lo dice', /rejected the key/.test(error), error);
}

// ---------- Decir ----------
{
  let config = { voz: 'voz0', modelo: 'eleven_flash_v2_5', idioma: 'es' };
  let key = 'llave-buena';
  const audios = [];
  const fines = [];
  const h = once.crear({ llave: () => key, config: () => config, alAudio: (a) => audios.push(a), alFin: (f) => fines.push(f) });
  ok('decir: de fábrica está apagada y sin error', h.estado().estado === 'off' && h.estado().error === '' && h.estado().hablando === false);
  ok('decir: un texto vacío no pide nada', h.decir('   ') === null);
  const antes = pedidos.length;
  // (dos frases largas: las cortitas van juntas en un solo pedido, ver habla.enFrases)
  const t = h.decir('Hola Fran, ¿cómo andás? Hoy estuve probando voces nuevas para contestarte en voz alta. Esta es la segunda frase, que va en otro pedido porque las dos juntas son largas.');
  ok('decir: devuelve el turno y se sabe que habla', typeof t === 'string' && h.estado().hablando === true);
  await hasta(() => fines.length === 1);
  const mios = pedidos.slice(antes);
  ok('decir: una frase por pedido, en orden', mios.length === 2 && mios[0].cuerpo.text.startsWith('Hola Fran') && mios[1].cuerpo.text.startsWith('Esta es la segunda'), JSON.stringify(mios.map((p) => p.cuerpo?.text)));
  ok('decir: pide PCM a 24 kHz, con la voz, el modelo y la llave', mios.every((p) => p.ruta === '/v1/text-to-speech/voz0/stream' && p.query.output_format === 'pcm_24000' && p.cuerpo.model_id === 'eleven_flash_v2_5' && p.key === 'llave-buena'));
  ok('decir: le dice el idioma, y lo que va antes y después para que suene de corrido', mios[0].cuerpo.language_code === 'es' && mios[0].cuerpo.next_text === mios[1].cuerpo.text && mios[1].cuerpo.previous_text === mios[0].cuerpo.text && !('previous_text' in mios[0].cuerpo));
  const bytes = audios.filter((a) => a.turno === t).reduce((s, a) => s + a.pcm.length, 0);
  ok('decir: llega todo el audio, sin perder bytes', bytes === 48000, `${bytes}`);
  ok('decir: ningún tramo parte una muestra, y van a 24 kHz', audios.every((a) => a.pcm.length % 2 === 0 && a.sr === 24000));
  ok('decir: los tramos se juntan (no uno por pedazo) y se numeran de corrido', audios.length >= 4 && audios.length < 12 && audios.every((a, i) => a.n === i), audios.map((a) => a.pcm.length).join());
  ok('decir: al terminar avisa, sin error, y deja de hablar', fines[0].turno === t && fines[0].callado === false && !fines[0].error && h.estado().hablando === false && h.estado().estado === 'idle');

  // multilingual v2 no acepta language_code
  config = { ...config, modelo: 'eleven_multilingual_v2' };
  const n0 = pedidos.length;
  h.decir('Una sola.');
  await hasta(() => fines.length === 2);
  ok('decir: con Multilingual v2 no manda el idioma', pedidos[n0].cuerpo.model_id === 'eleven_multilingual_v2' && !('language_code' in pedidos[n0].cuerpo));
  config = { ...config, modelo: 'eleven_flash_v2_5', idioma: 'auto' };
  const n1 = pedidos.length;
  h.decir('Otra.');
  await hasta(() => fines.length === 3);
  ok('decir: con «Detect it» tampoco', !('language_code' in pedidos[n1].cuerpo));

  // callar a mitad
  config = { ...config, voz: 'lenta', idioma: 'es' };
  const a0 = audios.length;
  const n2 = pedidos.length;
  const t2 = h.decir('Esta frase llega despacio, de a poquito, para que haya tiempo de callarla a la mitad. Y esta otra no se tendría que pedir nunca, porque la callaron antes.');
  await hasta(() => audios.length > a0);
  ok('callar: dice que había algo', h.callar() === true && h.estado().hablando === false);
  await hasta(() => fines.length === 4);
  await pausa(300);
  ok('callar: el turno se cierra callado, sin error', fines[3].turno === t2 && fines[3].callado === true && !fines[3].error, JSON.stringify(fines[3]));
  ok('callar: lo que faltaba no se pide', pedidos.length === n2 + 1, `${pedidos.length - n2} pedidos`);
  ok('callar: lo que llega después no suena', audios.slice(a0).every((a) => a.turno === t2) && audios.length - a0 < 5);
  ok('callar: sin nada que callar no hace nada', h.callar() === false);

  // los errores, en una frase
  config = { ...config, voz: 'borrada' };
  h.decir('Hola.');
  await hasta(() => fines.length === 5);
  ok('error: una voz que ya no está, lo dice', /no longer exists/.test(fines[4].error) && h.estado().estado === 'error' && /no longer exists/.test(h.estado().error), fines[4].error);
  config = { ...config, voz: 'voz0' };
  key = 'sin-creditos';
  h.decir('Hola.');
  await hasta(() => fines.length === 6);
  ok('error: sin créditos, lo dice', /out of ElevenLabs credits/.test(fines[5].error), fines[5].error);
  key = 'llave-mala';
  h.decir('Hola.');
  await hasta(() => fines.length === 7);
  ok('error: con la llave rechazada, dice dónde cambiarla', /Providers/.test(fines[6].error), fines[6].error);
  const sinRed = once.crear({ llave: () => 'x', config: () => ({ voz: 'v' }), fetch: async () => { throw new TypeError('fetch failed'); }, alFin: (f) => fines.push(f) });
  sinRed.decir('Hola.');
  await hasta(() => fines.length === 8);
  ok('error: sin conexión, lo dice así', fines[7].error === 'There is no connection to ElevenLabs.', fines[7].error);

  // lo que falta para poder hablar
  key = null;
  ok('falta: sin llave, no pide nada y dice dónde ponerla', h.decir('Hola.') === null && /Settings › Providers/.test(h.estado().error));
  key = 'llave-buena';
  config = { ...config, voz: '' };
  ok('falta: sin voz elegida, lo dice', h.decir('Hola.') === null && h.estado().error === 'No ElevenLabs voice chosen yet.');
  h.apagar();
  ok('apagar: limpia el error de antes', h.estado().estado === 'off' && h.estado().error === '');
}

// ---------- En modo simulado no sale a internet ----------
{
  const antes = process.env.ELEVENLABS_BASE_URL;
  delete process.env.ELEVENLABS_BASE_URL;
  process.env.BLACKCODE_PROVEEDOR = 'simulado';
  let pidio = false;
  const f = async () => { pidio = true; throw new Error('no'); };
  const h = once.crear({ llave: () => 'x', config: () => ({ voz: 'v' }), fetch: f });
  ok('simulado: no dice nada sin un servidor de mentira', h.decir('Hola.') === null && /simulated/.test(h.estado().error));
  let error = '';
  try { await once.catalogo('x', { fetch: f }); } catch (e) { error = e.message; }
  ok('simulado: no pide las voces', /simulated/.test(error) && !pidio);
  ok('simulado: la llave no se comprueba contra internet', (await once.comprobar('x', { fetch: f })).fase === 'aceptada' && !pidio);
  delete process.env.BLACKCODE_PROVEEDOR;
  process.env.ELEVENLABS_BASE_URL = antes;
}

servidor.close();
if (failures.length) {
  console.error(`elevenlabs: ${failures.length} de ${hechas} fallaron:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`elevenlabs: ${hechas} pruebas, todas bien`);
process.exit(0);
