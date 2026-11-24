// Los dos loops de tools de BlackCode (el de Anthropic y el de Venice) contra un
// servidor local que hace de las dos APIs: qué pide cada ronda, cómo vuelven
// los resultados, dónde va el registro del turno y cuándo se corta. Las tools
// que corren son las de verdad (fs_read, fs_write), sobre una carpeta
// descartable; screen_capture captura una pantalla de mentira. Sin red y sin
// gastar un token.
// Uso: node tools/test-blackcode-tools-loop.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NIX = path.join(ROOT, 'apps', 'BlackCode', 'main');

const failures = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

// ---------- El servidor de mentira ----------
const seen = [];
let guion = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ url: req.url, body });
    const paso = guion.shift();
    if (!paso) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"sin guion"}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    paso(res, body);
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.VENICE_BASE_URL = `http://127.0.0.1:${server.address().port}`;

// Una respuesta de Anthropic, evento por evento. Los argumentos de una tool
// llegan en dos pedazos, como en la API de verdad.
const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const deAnthropic = (bloques, stop = 'end_turn') => (res, body) => {
  sse(res, 'message_start', { message: { id: 'msg_x', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  bloques.forEach((b, index) => {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { index, content_block: { type: 'text', text: '' } });
      sse(res, 'content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      sse(res, 'content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const json = b.raw ?? JSON.stringify(b.input);
      const medio = Math.ceil(json.length / 2);
      sse(res, 'content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, medio) } });
      sse(res, 'content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(medio) } });
    }
    sse(res, 'content_block_stop', { index });
  });
  sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(res, 'message_stop', {});
};
// Una respuesta de Venice: pedazos con el formato de OpenAI.
const deVenice = (deltas, finish = 'stop') => (res) => {
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
  res.write('data: [DONE]\n\n');
};

// ---------- Las tools de verdad, en una carpeta descartable ----------
const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-loop-'));
fs.writeFileSync(path.join(taller, 'a.txt'), 'contenido de a\n');
const herramientas = require(path.join(NIX, 'tools', 'index.cjs'));
const guardas = require(path.join(NIX, 'tools', 'guardas.cjs'));
// La pantalla de mentira de screen_capture: una imagen de 800×600 cuyo «JPEG»
// es un texto, para reconocerlo en lo que viaja.
const FOTO = Buffer.from('jpeg-de-mentira');
const monitor = { id: 1, size: { width: 800, height: 600 }, scaleFactor: 1 };
const foto = { getSize: () => ({ width: 800, height: 600 }), isEmpty: () => false, crop: () => foto, toJPEG: () => FOTO };
herramientas.iniciar({
  trash: async () => {},
  pantallas: { getPrimaryDisplay: () => monitor, getAllDisplays: () => [monitor] },
  capturador: { getSources: async () => [{ id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: foto }] },
});
herramientas.setCwd(taller);
const anthropic = require(path.join(NIX, 'anthropic.cjs'));
const venice = require(path.join(NIX, 'venice.cjs'));

const nuevaSesion = (extra = {}) => herramientas.crearSesion({
  reqId: `r${Math.random().toString(36).slice(2, 8)}`, convoId: 'c1', ac: new AbortController(),
  tools: ['fs_read', 'fs_write'], confirma: false, ...extra,
});
const correr = async (prov, pedido, sesion, pasos) => {
  seen.length = 0;
  guion = pasos;
  const textos = [];
  let fin = null;
  let err = null;
  try {
    fin = await prov.responder(pedido, { key: 'llave-de-mentira', signal: sesion.run.ac.signal, onTexto: (t) => textos.push(t), onPensando: () => {}, sesion });
  } catch (e) { err = e; }
  return { fin, err, texto: textos.join(''), pedidos: seen.map((s) => s.body) };
};
const textoDe = (content) => (typeof content === 'string' ? content : content.map((b) => b.text ?? b.content ?? '').join('\n'));

try {
  // ===================== Anthropic =====================
  // 1. Dos rondas: pide leer un archivo, se lo devuelven, contesta.
  {
    const s = nuevaSesion();
    const r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: 'Sos BlackCode.', mensajes: [{ rol: 'user', texto: 'Leé a.txt' }] }, s, [
      deAnthropic([{ type: 'text', text: 'Leyendo.' }, { type: 'tool_use', id: 'toolu_1', name: 'fs_read', input: { paths: ['a.txt'] } }], 'tool_use'),
      deAnthropic([{ type: 'text', text: 'Dice: contenido de a.' }]),
    ]);
    check(!r.err && r.fin?.motivo === 'fin', `anthropic, dos rondas: terminó con ${JSON.stringify(r.fin)} ${r.err?.message ?? ''}`);
    check(r.texto === 'Leyendo.Dice: contenido de a.', `anthropic: el texto que salió fue «${r.texto}»`);
    check(r.pedidos.length === 2, `anthropic: hizo ${r.pedidos.length} pedidos`);
    const [p1, p2] = r.pedidos;
    check(p1.tools?.map((t) => t.name).join() === 'fs_read,fs_write' && p1.tools.every((t) => t.eager_input_streaming === true && t.input_schema), 'anthropic: las tools no viajaron con su schema y el streaming de argumentos');
    check(p1.system?.startsWith('Sos BlackCode.') && p1.system.includes('HOW TOOLS ACTUALLY WORK') && p1.system.includes('Current working directory'), 'anthropic: el system no lleva las instrucciones, el entorno y el protocolo');
    check(!p1.system.includes('DECLINED'), 'anthropic: en modo automático el protocolo habla de tarjetas de permiso');
    check(textoDe(p1.messages.at(-1).content).includes('No tool has run yet in this turn'), 'anthropic: la primera ronda no lleva el recordatorio de arranque al final');
    check(!('tool_choice' in p1), 'anthropic: una ronda normal lleva tool_choice');
    const asistente = p2.messages.at(-2);
    const usuario = p2.messages.at(-1);
    check(asistente.role === 'assistant' && asistente.content.some((b) => b.type === 'tool_use' && b.id === 'toolu_1') && asistente.content.some((b) => b.type === 'text'), 'anthropic: la respuesta del modelo no volvió entera en la ronda siguiente');
    const resultado = usuario.content.find((b) => b.type === 'tool_result');
    check(usuario.role === 'user' && resultado?.tool_use_id === 'toolu_1' && resultado.content.includes('contenido de a') && !resultado.is_error, `anthropic: el resultado de la tool volvió como ${JSON.stringify(resultado)?.slice(0, 160)}`);
    const registro = usuario.content.at(-1);
    check(registro.type === 'text' && registro.text.includes('1. fs_read(a.txt) -> ok') && usuario.content.indexOf(registro) > usuario.content.indexOf(resultado), 'anthropic: el registro del turno no va después de los resultados');
    check(s.resumen().map((x) => `${x.name}:${x.status}`).join() === 'fs_read:ok', `anthropic: el registro de la sesión dice ${JSON.stringify(s.resumen())}`);
    check(r.fin.uso.entrada === 20 && r.fin.uso.salida === 10, `anthropic: el uso de las dos rondas no se sumó: ${JSON.stringify(r.fin.uso)}`);
  }

  // 2. Una tool que falla vuelve marcada como error, y el registro de la ronda
  //    siguiente trae solo el paso nuevo, con su número real.
  {
    const s = nuevaSesion();
    const r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deAnthropic([{ type: 'tool_use', id: 't1', name: 'fs_read', input: { paths: ['a.txt'] } }], 'tool_use'),
      deAnthropic([{ type: 'tool_use', id: 't2', name: 'fs_write', input: { path: 'b.txt' } }], 'tool_use'),
      deAnthropic([{ type: 'text', text: 'listo' }]),
    ]);
    const p3 = r.pedidos[2];
    const res2 = p3.messages.at(-1).content.find((b) => b.type === 'tool_result');
    check(res2.is_error === true && res2.content.includes('bad arguments') && res2.content.includes('content'), `anthropic: unos argumentos incompletos volvieron como ${JSON.stringify(res2).slice(0, 180)}`);
    check(!fs.existsSync(path.join(taller, 'b.txt')), 'anthropic: una llamada con argumentos incompletos escribió el archivo');
    const reg2 = p3.messages.at(-1).content.at(-1).text;
    check(reg2.includes('2. fs_write') && !reg2.includes('1. fs_read') && reg2.includes('Steps 1-1 are in the earlier records above'), `anthropic: el segundo registro no trae solo el paso nuevo: ${reg2.slice(0, 260)}`);
    // el registro de la ronda 1 QUEDÓ en la conversación (no es efímero)
    check(textoDe(p3.messages.at(-3).content).includes('1. fs_read(a.txt) -> ok'), 'anthropic: el registro de la primera ronda desapareció de la conversación');
    check(s.resumen().map((x) => x.status).join() === 'ok,error', `anthropic: estados ${s.resumen().map((x) => x.status).join()}`);
  }

  // 3. La última ronda: las tools siguen declaradas pero no se pueden pedir,
  //    va el aviso de cierre y el corte queda anotado.
  {
    const s = nuevaSesion();
    let vueltas = 0;
    s.esFinal = () => vueltas++ >= 1;
    const r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deAnthropic([{ type: 'tool_use', id: 't1', name: 'fs_read', input: { paths: ['a.txt'] } }], 'tool_use'),
      deAnthropic([{ type: 'text', text: 'Hasta acá llegué.' }]),
    ]);
    const p2 = r.pedidos[1];
    check(p2.tool_choice?.type === 'none' && p2.tools?.length === 2, `anthropic, última ronda: tool_choice ${JSON.stringify(p2.tool_choice)}`);
    const cola = textoDe(p2.messages.at(-1).content);
    check(cola.includes('this is your LAST message') && !cola.includes('emit the NEXT tool call'), 'anthropic, última ronda: lleva el registro de «seguí» junto con el aviso de cierre');
    check(s.run.stopped === 'maxrounds' && r.fin?.motivo === 'fin', 'anthropic: el corte por presupuesto no quedó anotado');
  }

  // 4. Un rechazo del modelo, o un corte por largo con una llamada a medias:
  //    no se corre nada.
  {
    let s = nuevaSesion();
    let r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deAnthropic([{ type: 'tool_use', id: 't1', name: 'fs_write', input: { path: 'no.txt', content: 'x' } }], 'refusal'),
    ]);
    check(r.fin?.motivo === 'rechazo' && !s.resumen().length && !fs.existsSync(path.join(taller, 'no.txt')), 'anthropic: con un refusal corrió la tool igual');
    s = nuevaSesion();
    r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deAnthropic([{ type: 'tool_use', id: 't1', name: 'fs_write', input: { path: 'no.txt', content: 'x' } }], 'max_tokens'),
    ]);
    check(r.fin?.motivo === 'largo' && !s.resumen().length && !fs.existsSync(path.join(taller, 'no.txt')), 'anthropic: cortado por largo, corrió una llamada con los argumentos a medias');
  }

  // 5. El registro de un turno anterior viaja como un mensaje de la app
  //    pegado al del usuario: dos `user` seguidos se funden.
  {
    const s = nuevaSesion();
    const plegado = guardas.foldToolRows([
      { role: 'user', content: 'hacé algo' },
      { role: 'tool', tool: 'fs_write', content: 'b.txt', status: 'ok' },
      { role: 'assistant', content: 'hecho' },
      { role: 'user', content: 'y ahora?' },
    ]).map((m) => ({ rol: m.role, texto: m.content }));
    const r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: plegado }, s, [deAnthropic([{ type: 'text', text: 'nada más' }])]);
    const roles = r.pedidos[0].messages.map((m) => m.role).join();
    check(roles === 'user,assistant,user', `anthropic: los mensajes viajaron como ${roles}`);
    check(textoDe(r.pedidos[0].messages[0].content).includes('hacé algo') && textoDe(r.pedidos[0].messages[0].content).includes('<tools_ran>') && textoDe(r.pedidos[0].messages[0].content).includes('fs_write(b.txt) -> ok'), 'anthropic: el registro del turno anterior no viajó');
    check(r.pedidos[0].messages[1].content === 'hecho', 'anthropic: el registro se metió adentro de lo que escribió el modelo');
  }

  // 6. Sin tools, todo como antes: un pedido, sin tools ni protocolo.
  {
    seen.length = 0;
    guion = [deAnthropic([{ type: 'text', text: 'hola' }])];
    const fin = await anthropic.responder({ modelo: 'claude-opus-5-5', instrucciones: 'Sos BlackCode.', mensajes: [{ rol: 'user', texto: 'hola' }] }, { key: 'k', signal: new AbortController().signal, onTexto: () => {}, onPensando: () => {} });
    check(fin.motivo === 'fin' && !('tools' in seen[0].body) && seen[0].body.system === 'Sos BlackCode.', 'anthropic sin tools: el pedido cambió');
  }

  // ===================== Venice =====================
  // 7. Dos rondas con dos llamadas en la misma: una buena y una con los
  //    argumentos rotos. Las dos comparten el índice, como avisa Venice.
  {
    const s = nuevaSesion();
    const r = await correr(venice, { modelo: 'alfa-2', instrucciones: 'Sos BlackCode.', mensajes: [{ rol: 'user', texto: 'Leé a.txt' }] }, s, [
      deVenice([
        { reasoning_content: 'pienso' },
        { content: 'Leyendo.' },
        { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'fs_read', arguments: '{"paths":' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '["a.txt"]}' } }] },
        { tool_calls: [{ index: 0, id: 'call_b', type: 'function', function: { name: 'fs_write', arguments: '{"path": "roto' } }] },
      ], 'tool_calls'),
      deVenice([{ content: 'Listo.' }]),
    ]);
    check(!r.err && r.fin?.motivo === 'fin' && r.texto === 'Leyendo.Listo.', `venice, dos rondas: ${JSON.stringify(r.fin)} «${r.texto}» ${r.err?.message ?? ''}`);
    const [p1, p2] = r.pedidos;
    check(p1.tools?.map((t) => t.function.name).join() === 'fs_read,fs_write' && p1.tools[0].type === 'function', 'venice: las tools no viajaron en el formato de OpenAI');
    check(p1.messages[0].role === 'system' && p1.messages[0].content.includes('HOW TOOLS ACTUALLY WORK'), 'venice: el system no lleva el protocolo');
    check(p1.messages.at(-1).role === 'user' && p1.messages.at(-1).content.includes('No tool has run yet'), 'venice: la primera ronda no lleva el recordatorio de arranque');
    check(p1.venice_parameters?.include_venice_system_prompt === false, 'venice: se perdió include_venice_system_prompt');
    const roles = p2.messages.map((m) => m.role).join();
    check(roles === 'system,user,assistant,tool,tool,user', `venice: la segunda ronda viajó como ${roles}`);
    const asistente = p2.messages[2];
    check(asistente.tool_calls?.length === 2 && asistente.tool_calls.map((c) => c.id).join() === 'call_a,call_b', `venice: dos llamadas con el mismo índice se mezclaron: ${JSON.stringify(asistente.tool_calls)?.slice(0, 200)}`);
    check(asistente.tool_calls[0].function.arguments === '{"paths":["a.txt"]}' && asistente.tool_calls[1].function.arguments === '{}', 'venice: los argumentos no se armaron de los pedazos, o los rotos no se normalizaron');
    check(asistente.reasoning_content === 'pienso' && asistente.content === 'Leyendo.', 'venice: lo que pensó el modelo no volvió con su mensaje');
    check(p2.messages[3].tool_call_id === 'call_a' && p2.messages[3].content.includes('contenido de a'), 'venice: el resultado de la primera llamada no volvió');
    check(p2.messages[4].tool_call_id === 'call_b' && p2.messages[4].content.includes('not valid JSON') && p2.messages[4].content.includes('"path": "roto'), `venice: los argumentos rotos volvieron como ${p2.messages[4].content.slice(0, 120)}`);
    check(p2.messages.at(-1).content.includes('1. fs_read(a.txt) -> ok') && p2.messages.at(-1).content.includes('2. fs_write() -> error'), 'venice: el registro del turno no va al final de la segunda ronda');
    check(s.resumen().map((x) => x.status).join() === 'ok,error', `venice: estados ${s.resumen().map((x) => x.status).join()}`);
    check(!fs.existsSync(path.join(taller, 'roto')), 'venice: unos argumentos rotos escribieron un archivo');
  }

  // 8. El registro es efímero: en la tercera ronda no queda el de la segunda.
  {
    const s = nuevaSesion();
    const leer = (id) => deVenice([{ tool_calls: [{ index: 0, id, type: 'function', function: { name: 'fs_read', arguments: '{"paths":["a.txt"]}' } }] }], 'tool_calls');
    const r = await correr(venice, { modelo: 'alfa-2', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [leer('c1'), leer('c2'), deVenice([{ content: 'fin' }])]);
    const registros = r.pedidos[2].messages.filter((m) => m.role === 'user' && m.content.includes('ACTUALLY executed'));
    check(registros.length === 1 && registros[0].content.includes('2. fs_read'), `venice: en la tercera ronda hay ${registros.length} registros del turno`);
  }

  // 9. Una llamada escrita como texto se rescata y se corre.
  {
    const s = nuevaSesion();
    const r = await correr(venice, { modelo: 'alfa-2', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deVenice([{ content: 'Voy a leer.\n```tool\n{"name":"fs_read","arguments":{"paths":["a.txt"]}}\n```' }]),
      deVenice([{ content: 'Leído.' }]),
    ]);
    check(s.resumen().map((x) => `${x.name}:${x.status}`).join() === 'fs_read:ok' && r.pedidos.length === 2, `venice: la llamada escrita como texto no se rescató (${JSON.stringify(s.resumen())})`);
    // una palabra suelta no es una llamada
    const s2 = nuevaSesion();
    const r2 = await correr(venice, { modelo: 'alfa-2', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s2, [deVenice([{ content: 'La tool fs_read sirve para leer.' }])]);
    check(!s2.resumen().length && r2.pedidos.length === 1, 'venice: una frase que nombra una tool se tomó por una llamada');
  }

  // 10. La última ronda sale sin tools y con su aviso.
  {
    const s = nuevaSesion();
    let vueltas = 0;
    s.esFinal = () => vueltas++ >= 1;
    const r = await correr(venice, { modelo: 'alfa-2', instrucciones: '', mensajes: [{ rol: 'user', texto: 'x' }] }, s, [
      deVenice([{ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{"paths":["a.txt"]}' } }] }], 'tool_calls'),
      deVenice([{ content: 'Hasta acá.' }]),
    ]);
    check(!('tools' in r.pedidos[1]) && r.pedidos[1].messages.at(-1).content.includes('this is your LAST message') && s.run.stopped === 'maxrounds', 'venice: la última ronda no salió sin tools y con su aviso');
  }

  // ===================== La sesión =====================
  // 11. El presupuesto: leer no se cobra, pero tiene un tope.
  {
    let s = nuevaSesion();
    for (let i = 0; i < 14; i++) s.cerrarRonda(['fs_write']);
    check(!s.esFinal(), 'presupuesto: se acabó antes de las 15 rondas con escrituras');
    s.cerrarRonda(['fs_read', 'fs_write']);
    check(s.esFinal(), 'presupuesto: 15 rondas con escrituras no lo agotaron');
    s = nuevaSesion();
    for (let i = 0; i < 44; i++) s.cerrarRonda(['fs_read']);
    check(!s.esFinal(), 'presupuesto: las rondas de solo lectura se cobraron');
    s.cerrarRonda(['fs_read']);
    check(s.esFinal(), 'presupuesto: las rondas de lectura no tienen tope');
  }

  // 12. La confirmación: en modo manual cada llamada espera la respuesta, un
  //     «no» deja su paso como rechazado y no corre nada.
  {
    const vistos = [];
    const s = nuevaSesion({ confirma: true, confirm: async (name, args, callId) => { vistos.push(`${name}:${callId.split(':').pop()}`); return name !== 'fs_write'; } });
    const r1 = await s.correr('fs_read', { paths: ['a.txt'] });
    const r2 = await s.correr('fs_write', { path: 'c.txt', content: 'x' });
    check(vistos.join() === 'fs_read:1,fs_write:2', `confirmación: se preguntó por ${vistos.join()}`);
    check(!r1.error && r2.error && r2.out === 'the user declined to run this tool' && !fs.existsSync(path.join(taller, 'c.txt')), 'confirmación: una llamada rechazada corrió igual');
    check(s.resumen().map((x) => x.status).join() === 'ok,declined' && s.sistema('').includes('can be DECLINED'), 'confirmación: el rechazo no quedó en el registro, o el protocolo no avisa de las tarjetas');
  }

  // 13. Anthropic: la captura de screen_capture viaja ADENTRO del tool_result
  //     de esa llamada, como bloque de imagen; el de una tool sin imagen sigue
  //     siendo texto.
  {
    const s = nuevaSesion({ tools: ['fs_read', 'screen_capture'] });
    const r = await correr(anthropic, { modelo: 'claude-opus-5-5', instrucciones: '', mensajes: [{ rol: 'user', texto: 'mirá' }] }, s, [
      deAnthropic([{ type: 'tool_use', id: 't1', name: 'screen_capture', input: {} }, { type: 'tool_use', id: 't2', name: 'fs_read', input: { paths: ['a.txt'] } }], 'tool_use'),
      deAnthropic([{ type: 'text', text: 'visto' }]),
    ]);
    check(!r.err && r.fin?.motivo === 'fin', `anthropic, captura: ${JSON.stringify(r.fin)} ${r.err?.message ?? ''}`);
    const resultados = r.pedidos[1].messages.at(-1).content.filter((b) => b.type === 'tool_result');
    const [c, l] = resultados;
    check(Array.isArray(c.content) && c.content[0].type === 'text' && c.content[0].text.startsWith('captured display 1 of 1: 800×600 px'), `anthropic, captura: el resultado volvió como ${JSON.stringify(c).slice(0, 200)}`);
    const img = c.content?.[1];
    check(c.content.length === 2 && img?.type === 'image' && img.source?.type === 'base64' && img.source.media_type === 'image/jpeg' && img.source.data === FOTO.toString('base64'), `anthropic, captura: la imagen viajó como ${JSON.stringify(img)?.slice(0, 160)}`);
    check(typeof l.content === 'string' && l.content.includes('contenido de a'), 'anthropic, captura: el resultado de una tool sin imagen dejó de ser texto');
    check(!c.is_error && s.resumen().map((x) => `${x.name}:${x.status}`).join() === 'screen_capture:ok,fs_read:ok', `anthropic, captura: ${JSON.stringify(s.resumen())}`);
    check(s.run._capturas == null, 'anthropic, captura: la imagen quedó colgada en la corrida para la llamada siguiente');
  }

  // 14. Venice: un mensaje `tool` no puede llevar imágenes, así que las de la
  //     ronda van en UN `user` detrás de todos los resultados, en orden.
  {
    const s = nuevaSesion({ tools: ['fs_read', 'screen_capture'] });
    const llamada = (index, id, name, args) => ({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const r = await correr(venice, { modelo: 'alfa-2', instrucciones: '', mensajes: [{ rol: 'user', texto: 'mirá' }] }, s, [
      deVenice([llamada(0, 'c1', 'screen_capture', {}), llamada(1, 'c2', 'fs_read', { paths: ['a.txt'] }), llamada(2, 'c3', 'screen_capture', { region: { x: 0, y: 0, width: 100, height: 100 } })], 'tool_calls'),
      deVenice([llamada(0, 'c4', 'fs_read', { paths: ['a.txt'] })], 'tool_calls'),
      deVenice([{ content: 'visto' }]),
    ]);
    check(!r.err && r.fin?.motivo === 'fin', `venice, captura: ${JSON.stringify(r.fin)} ${r.err?.message ?? ''}`);
    const p2 = r.pedidos[1];
    const roles = p2.messages.map((m) => m.role).join();
    check(roles === 'system,user,assistant,tool,tool,tool,user,user', `venice, captura: la segunda ronda viajó como ${roles}`);
    check(p2.messages.slice(3, 6).every((m) => typeof m.content === 'string') && p2.messages[3].content.startsWith('captured display 1 of 1'), 'venice, captura: un resultado de tool dejó de ser texto');
    const fotos = p2.messages[6];
    check(Array.isArray(fotos.content) && fotos.content.length === 3 && fotos.content[0].type === 'text' && fotos.content[0].text.startsWith('[The app attaches the 2 screenshots taken by screen_capture above, in call order.'), `venice, captura: el mensaje de las imágenes es ${JSON.stringify(fotos.content)?.slice(0, 200)}`);
    check(fotos.content.slice(1).every((b) => b.type === 'image_url' && b.image_url.url === `data:image/jpeg;base64,${FOTO.toString('base64')}`), 'venice, captura: las imágenes no viajaron como image_url');
    check(typeof p2.messages[7].content === 'string' && p2.messages[7].content.includes('1. screen_capture(screen) -> ok'), 'venice, captura: el registro del turno no va último, después de las imágenes');
    // en la ronda siguiente las imágenes siguen en su lugar y no se repiten
    const p3 = r.pedidos[2];
    check(p3.messages.filter((m) => Array.isArray(m.content)).length === 1 && p3.messages.map((m) => m.role).join() === 'system,user,assistant,tool,tool,tool,user,assistant,tool,user', `venice, captura: la tercera ronda viajó como ${p3.messages.map((m) => m.role).join()}`);
  }
} finally {
  server.close();
  fs.rmSync(taller, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`test-blackcode-tools-loop: ${failures.length} falla(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-loop: ok (${checks} comprobaciones: los dos loops, el registro del turno, la última ronda, el rescate, el presupuesto, la confirmación y las imágenes de una tool)`);
