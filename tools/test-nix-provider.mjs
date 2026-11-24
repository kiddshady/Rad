// Test del proveedor de Anthropic de Nix (apps/Nix/main/anthropic.cjs),
// con node pelado y SIN tocar la API: levanta un servidor local que habla el
// mismo protocolo (eventos SSE de /v1/messages) y le apunta el SDK. No gasta
// un token; lo que prueba es el uso que Nix hace del SDK: qué manda, cómo
// lee el streaming, cómo frena y qué dice cuando algo falla.
// Uso: node tools/test-nix-provider.mjs

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// No es una llave: es un texto con su forma.
const KEY = 'sk-ant-api03-prueba-del-proveedor-no-es-una-llave';
const TROZOS = ['Hola', ', soy ', 'una respuesta ', 'de mentira', '.'];

// Lo que el servidor hace con el próximo pedido, y lo que recibió.
let mode = 'ok';
const seen = [];

const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

// Venice habla el protocolo de OpenAI: pedazos con choices[0].delta y un
// [DONE] al final.
const VENICE_MODELOS = {
  object: 'list',
  type: 'text',
  data: [
    { id: 'zeta-9', type: 'text', model_spec: { name: 'Zeta 9', privacy: 'anonymized', availableContextTokens: 1000000, traits: [] } },
    { id: 'alfa-2', type: 'text', model_spec: { name: 'Alfa 2', privacy: 'private', availableContextTokens: 128000, traits: ['most_intelligent'] } },
    { id: 'alfa-10', type: 'text', model_spec: { name: 'Alfa 10', privacy: 'private', availableContextTokens: 256000, traits: [] } },
    { id: 'apagado', type: 'text', model_spec: { name: 'Apagado', privacy: 'private', offline: true } },
    { id: 'pintor', type: 'image', model_spec: { name: 'Pintor', privacy: 'private' } },
  ],
};
async function venice(req, res, json) {
  if (req.url.startsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(VENICE_MODELOS));
    return;
  }
  const fallo = { 401: 'Authentication failed', 402: 'Insufficient balance', 400: 'Invalid model' }[mode];
  if (fallo) {
    res.writeHead(Number(mode), { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: fallo }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const pedazo = (delta, finish = null) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: json.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.write(pedazo({ role: 'assistant', content: '' }));
  res.write(pedazo({ reasoning_content: 'a ver…' }));
  res.write(pedazo({ reasoning_content: ' ya está' }));
  for (const t of TROZOS) {
    if (res.destroyed) return;
    // Cada evento sale partido en dos escrituras, como puede llegar por la red.
    const entero = pedazo({ content: t });
    res.write(entero.slice(0, 17));
    await sleep(mode === 'lento' ? 150 : 3);
    res.write(entero.slice(17));
  }
  if (mode === 'roto') {
    res.write(`data: ${JSON.stringify({ error: 'se cayó el modelo' })}\n\n`);
    res.end();
    return;
  }
  res.write(pedazo({}, mode === 'largo' ? 'length' : mode === 'rechazo' ? 'content_filter' : 'stop'));
  res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

// GET /v1/models: el pedido gratis con el que se comprueba una llave.
const SIN_WORKSPACE = 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.';
function modelosDeAnthropic(res) {
  const fallos = {
    401: ['authentication_error', 'invalid x-api-key'],
    400: ['invalid_request_error', SIN_WORKSPACE],
    403: ['permission_error', 'Your API key does not have permission to use the specified resource.'],
    500: ['api_error', 'Internal server error'],
  };
  const fallo = fallos[mode];
  if (fallo) {
    res.writeHead(Number(mode), { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: fallo[0], message: fallo[1] } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const json = JSON.parse(body || '{}');
    seen.push({ url: req.url, headers: req.headers, body: json });
    if (req.url.startsWith('/v1/models')) { modelosDeAnthropic(res); return; }
    if (!req.url.startsWith('/v1/messages')) { venice(req, res, json); return; }
    if (mode === '401') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      return;
    }
    if (mode === '400') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'API key is not scoped to a workspace' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const usage = { input_tokens: 12, output_tokens: 0 };
    sse(res, 'message_start', { message: { id: 'msg_prueba', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    // Primero piensa (con el texto vacío, como llega por defecto) y después escribe.
    sse(res, 'content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    sse(res, 'content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'firma' } });
    sse(res, 'content_block_stop', { index: 0 });
    sse(res, 'content_block_start', { index: 1, content_block: { type: 'text', text: '' } });
    for (const t of TROZOS) {
      if (res.destroyed) return;
      sse(res, 'content_block_delta', { index: 1, delta: { type: 'text_delta', text: t } });
      await sleep(mode === 'lento' ? 150 : 5);
    }
    sse(res, 'content_block_stop', { index: 1 });
    const stop = mode === 'rechazo' ? 'refusal' : mode === 'largo' ? 'max_tokens' : 'end_turn';
    sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 9 } });
    sse(res, 'message_stop', {});
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// El SDK toma la dirección del entorno: hay que ponerla antes de cargarlo.
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.VENICE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { responder, comprobar, MODELOS, MODELO_INICIAL } = require(path.join(ROOT, 'apps', 'Nix', 'main', 'anthropic.cjs'));
const deVenice = require(path.join(ROOT, 'apps', 'Nix', 'main', 'venice.cjs'));
const KEY_VENICE = 'venice-prueba-del-proveedor-no-es-una-llave';

const pedido = (modelo, extra = {}) => ({
  modelo,
  instrucciones: 'Sos de prueba.',
  mensajes: [{ rol: 'user', texto: 'hola' }, { rol: 'assistant', texto: 'buenas' }, { rol: 'user', texto: 'seguí' }],
  ...extra,
});
const correr = async (p, { abortAfter, con = responder, key = KEY } = {}) => {
  const control = new AbortController();
  const textos = [];
  let pensando = 0;
  if (abortAfter) setTimeout(() => control.abort(), abortAfter);
  try {
    const fin = await con(p, { key, signal: control.signal, onTexto: (t) => textos.push(t), onPensando: () => { pensando++; } });
    return { fin, textos, pensando };
  } catch (err) {
    return { err, textos, pensando };
  }
};

// 1. Un pedido normal a Opus 5.5: el texto llega en orden y de a pedazos, se
//    avisa que está pensando, y el pedido lleva lo que tiene que llevar (y
//    nada de lo que estos modelos rechazan).
{
  mode = 'ok';
  const r = await correr(pedido('claude-opus-5-5'));
  const req = seen.at(-1);
  check(!r.err, `normal: falló: ${r.err?.message}`);
  check(r.textos.join('|') === TROZOS.join('|'), `normal: el texto llegó como ${JSON.stringify(r.textos)}`);
  check(r.pensando === 1, `normal: avisó que piensa ${r.pensando} veces`);
  check(r.fin?.motivo === 'fin' && r.fin?.modelo === 'claude-opus-5-5', `normal: terminó con ${JSON.stringify(r.fin)}`);
  check(r.fin?.uso?.entrada === 12 && r.fin?.uso?.salida === 9, `normal: el uso dice ${JSON.stringify(r.fin?.uso)}`);
  const b = req.body;
  check(b.model === 'claude-opus-5-5' && b.stream === true, 'normal: el pedido no es un streaming a ese modelo');
  check(b.system === 'Sos de prueba.', `normal: las instrucciones viajaron como ${JSON.stringify(b.system)}`);
  check(JSON.stringify(b.messages) === JSON.stringify([{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }, { role: 'user', content: 'seguí' }]), `normal: los mensajes viajaron como ${JSON.stringify(b.messages)}`);
  check(b.output_config?.effort === 'medium', `normal: el esfuerzo viajó como ${JSON.stringify(b.output_config)}`);
  check(b.max_tokens >= 16000, `normal: max_tokens es ${b.max_tokens}`);
  check(b.fallbacks === 'default' && String(req.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'), `normal: sin respaldo ante un rechazo (fallbacks ${JSON.stringify(b.fallbacks)}, beta ${req.headers['anthropic-beta']})`);
  check(b.cache_control?.type === 'ephemeral', 'normal: el pedido no pide caché');
  for (const no of ['temperature', 'top_p', 'top_k', 'thinking', 'tools', 'tool_choice', 'betas']) check(!(no in b), `normal: el cuerpo del pedido lleva ${no}`);
  // Según la versión del SDK, la llave va en x-api-key o en Authorization.
  check(req.headers['x-api-key'] === KEY || req.headers.authorization === `Bearer ${KEY}`, 'normal: la llave no viajó en la cabecera de autenticación');
  check(!req.url.includes(KEY) && !JSON.stringify(b).includes(KEY), 'normal: la llave viajó en la dirección o en el cuerpo');
}

// 2. Haiku 5.5 no tiene respaldo: no lo pide. Y sin instrucciones no manda system.
{
  mode = 'ok';
  const r = await correr(pedido('claude-haiku-5-5', { instrucciones: '' }));
  const req = seen.at(-1);
  check(!r.err && r.fin?.motivo === 'fin', `haiku: ${r.err?.message ?? JSON.stringify(r.fin)}`);
  check(!('fallbacks' in req.body) && !String(req.headers['anthropic-beta'] ?? '').includes('fallback'), 'haiku: pidió un respaldo que ese modelo no tiene');
  check(!('system' in req.body), 'haiku: mandó un system vacío');
}

// 3. Cada modelo de la lista lleva su esfuerzo, y el inicial está en la lista.
{
  check(MODELOS.some((m) => m.id === MODELO_INICIAL), 'modelos: el inicial no está en la lista');
  mode = 'ok';
  for (const m of MODELOS) {
    await correr(pedido(m.id));
    check(seen.at(-1).body.output_config?.effort === m.esfuerzo, `modelos: ${m.id} viajó con esfuerzo ${seen.at(-1).body.output_config?.effort}, no ${m.esfuerzo}`);
  }
}

// 4. Frenar a mitad de camino: termina como «frenado», con lo que había
//    llegado, y no como un error.
{
  mode = 'lento';
  const r = await correr(pedido('claude-opus-5-5'), { abortAfter: 240 });
  check(!r.err, `frenar: salió como error: ${r.err?.message}`);
  check(r.fin?.motivo === 'frenado', `frenar: terminó con ${JSON.stringify(r.fin)}`);
  check(r.textos.length >= 1 && r.textos.length < TROZOS.length, `frenar: llegaron ${r.textos.length} de ${TROZOS.length} pedazos`);
}

// 5. Un rechazo y un corte por largo no se dan por una respuesta completa.
{
  mode = 'rechazo';
  check((await correr(pedido('claude-opus-5-5'))).fin?.motivo === 'rechazo', 'rechazo: no se marcó como rechazo');
  mode = 'largo';
  check((await correr(pedido('claude-opus-5-5'))).fin?.motivo === 'largo', 'largo: no se marcó como cortado por largo');
}

// 6. Los errores, en una frase que se entienda y sin la llave adentro.
{
  mode = '401';
  const a = await correr(pedido('claude-opus-5-5'));
  check(a.err?.message.startsWith('The key is invalid'), `401: el error dice «${a.err?.message}»`);
  mode = '400';
  const b = await correr(pedido('claude-opus-5-5'));
  check(b.err?.message.startsWith('The API rejected the request') && b.err.message.includes('not scoped to a workspace'), `400: el error dice «${b.err?.message}»`);
  check(![a.err?.message, b.err?.message].some((m) => m?.includes(KEY)), 'errores: el mensaje trae la llave');
}

// 6b. Comprobar una llave: se le pregunta a la API con un pedido que no gasta
//     nada (listar un modelo), y lo que decide es lo que la API contesta, no
//     cómo empieza la llave. Una llave «de usuario» que la API acepta, sirve.
{
  mode = 'ok';
  const antes = seen.length;
  for (const key of [KEY, 'sk-ant-usr01-prueba-del-proveedor-no-es-una-llave', 'cualquier-cosa-que-la-api-acepte-0000']) {
    const r = await comprobar(key);
    check(r.fase === 'aceptada', `comprobar: una llave que la API acepta (${key.slice(0, 10)}…) salió ${JSON.stringify(r)}`);
  }
  const pedidos = seen.slice(antes);
  check(pedidos.every((p) => p.url.startsWith('/v1/models') && p.url.includes('limit=1')), `comprobar: pidió ${pedidos.map((p) => p.url).join(', ')}`);
  check(!seen.slice(antes).some((p) => p.url.startsWith('/v1/messages')), 'comprobar: mandó un mensaje (eso gasta créditos)');

  mode = '401';
  const a = await comprobar(KEY);
  check(a.fase === 'rechazada' && a.motivo === 'invalida', `comprobar 401: ${JSON.stringify(a)}`);
  mode = '400';
  const b = await comprobar(KEY);
  check(b.fase === 'rechazada' && b.motivo === 'sin-workspace' && b.detalle === SIN_WORKSPACE, `comprobar 400: ${JSON.stringify(b)}`);
  mode = '403';
  const c = await comprobar(KEY);
  check(c.fase === 'rechazada' && c.motivo === 'sin-permiso', `comprobar 403: ${JSON.stringify(c)}`);
  // Que la API ande mal no es un rechazo de la llave, y no se reintenta solo.
  mode = '500';
  const veces = seen.length;
  const d = await comprobar(KEY);
  check(d.fase === 'sin-comprobar' && d.motivo === 'servicio', `comprobar 500: ${JSON.stringify(d)}`);
  check(seen.length - veces === 1, `comprobar 500: hizo ${seen.length - veces} pedidos`);
  check(![a, b, c, d].some((x) => JSON.stringify(x).includes(KEY)), 'comprobar: el resultado trae la llave');
}

// ---------- Venice ----------
const aVenice ={ con: deVenice.responder, key: KEY_VENICE };

// 7. Un pedido normal a Venice: el texto llega en orden aunque los eventos
//    vengan partidos, lo que el modelo piensa no se mezcla con la respuesta,
//    y el pedido apaga el system prompt de Venice.
{
  mode = 'ok';
  const r = await correr(pedido('alfa-2'), aVenice);
  const req = seen.at(-1);
  check(!r.err, `venice: falló: ${r.err?.message}`);
  check(r.textos.join('|') === TROZOS.join('|'), `venice: el texto llegó como ${JSON.stringify(r.textos)}`);
  check(r.pensando === 1, `venice: avisó que piensa ${r.pensando} veces`);
  check(r.fin?.motivo === 'fin' && r.fin?.uso?.entrada === 21 && r.fin?.uso?.salida === 8, `venice: terminó con ${JSON.stringify(r.fin)}`);
  const b = req.body;
  check(req.url === '/chat/completions' && b.model === 'alfa-2' && b.stream === true, `venice: el pedido fue a ${req.url} con ${b.model}`);
  check(JSON.stringify(b.messages) === JSON.stringify([{ role: 'system', content: 'Sos de prueba.' }, { role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }, { role: 'user', content: 'seguí' }]), `venice: los mensajes viajaron como ${JSON.stringify(b.messages)}`);
  check(b.venice_parameters?.include_venice_system_prompt === false, 'venice: no apagó el system prompt de Venice');
  check(b.venice_parameters?.strip_thinking_response === true, 'venice: no pidió sacar las etiquetas de pensamiento del texto');
  check(b.stream_options?.include_usage === true, 'venice: no pidió el uso');
  check(req.headers.authorization === `Bearer ${KEY_VENICE}`, 'venice: la llave no viajó en Authorization');
  check(!JSON.stringify(b).includes(KEY_VENICE) && !req.url.includes(KEY_VENICE), 'venice: la llave viajó en la dirección o en el cuerpo');
}

// 8. Sin instrucciones no manda un system vacío.
{
  mode = 'ok';
  await correr(pedido('alfa-2', { instrucciones: '' }), aVenice);
  check(seen.at(-1).body.messages[0].role === 'user', 'venice: mandó un system vacío');
}

// 9. Frenar, el corte por largo y el filtro de contenido.
{
  mode = 'lento';
  const r = await correr(pedido('alfa-2'), { ...aVenice, abortAfter: 260 });
  check(!r.err && r.fin?.motivo === 'frenado', `venice, frenar: ${r.err?.message ?? JSON.stringify(r.fin)}`);
  check(r.textos.length >= 1 && r.textos.length < TROZOS.length, `venice, frenar: llegaron ${r.textos.length} de ${TROZOS.length} pedazos`);
  mode = 'largo';
  check((await correr(pedido('alfa-2'), aVenice)).fin?.motivo === 'largo', 'venice: el corte por largo no se marcó');
  mode = 'rechazo';
  check((await correr(pedido('alfa-2'), aVenice)).fin?.motivo === 'rechazo', 'venice: el filtro de contenido no se marcó como rechazo');
}

// 10. Los errores de Venice, en una frase, y el que llega a mitad del stream.
{
  mode = '401';
  const a = await correr(pedido('alfa-2'), aVenice);
  check(a.err?.message.startsWith('The Venice key is invalid'), `venice 401: «${a.err?.message}»`);
  mode = '402';
  const b = await correr(pedido('alfa-2'), aVenice);
  check(b.err?.message === 'The Venice account has no balance left.', `venice 402: «${b.err?.message}»`);
  mode = '400';
  const c = await correr(pedido('alfa-2'), aVenice);
  check(c.err?.message === 'Venice rejected the request: Invalid model', `venice 400: «${c.err?.message}»`);
  mode = 'roto';
  const d = await correr(pedido('alfa-2'), aVenice);
  check(d.err?.message === 'Venice cut the answer short: se cayó el modelo' && d.textos.length === TROZOS.length, `venice, error a mitad: «${d.err?.message}» con ${d.textos.length} pedazos`);
  check(![a, b, c, d].some((x) => x.err?.message.includes(KEY_VENICE)), 'venice: un mensaje de error trae la llave');
}

// 11. La lista de modelos: solo los de texto que están en línea, por nombre
//     (Alfa 2 antes que Alfa 10), y el primero que se ofrece es el que Venice
//     marca como el más capaz.
{
  const m = await deVenice.modelos({ key: KEY_VENICE });
  check(m.lista.map((x) => x.id).join() === 'alfa-2,alfa-10,zeta-9', `venice, modelos: ${m.lista.map((x) => x.id).join()}`);
  check(m.inicial === 'alfa-2', `venice, modelos: el inicial es ${m.inicial}`);
  check(m.lista[0].nota === 'private, no retention · 128k context' && m.lista[2].nota === 'anonymized · 1M context', `venice, modelos: las notas son «${m.lista[0].nota}» y «${m.lista[2].nota}»`);
  check(seen.at(-1).url === '/models?type=text', `venice, modelos: pidió ${seen.at(-1).url}`);
}

// 12. Sin red, cada uno dice que no se pudo conectar.
{
  server.close();
  server.closeAllConnections();
  const c = await correr(pedido('claude-haiku-5-5'));
  check(c.err?.message.startsWith('Could not connect to Anthropic'), `sin red: el error dice «${c.err?.message}»`);
  const v = await correr(pedido('alfa-2'), aVenice);
  check(v.err?.message.startsWith('Could not connect to Venice'), `venice, sin red: el error dice «${v.err?.message}»`);
  // Sin conexión, de una llave no se sabe nada: no es un rechazo.
  const k = await comprobar(KEY);
  check(k.fase === 'sin-comprobar' && k.motivo === 'conexion', `comprobar sin red: ${JSON.stringify(k)}`);
}

if (failures.length) {
  console.error(`test-nix-provider: ${failures.length} falla(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('test-nix-provider: ok (Anthropic y Venice: pedido, streaming, modelos, frenar, rechazo, largo, errores, comprobar la llave)');
