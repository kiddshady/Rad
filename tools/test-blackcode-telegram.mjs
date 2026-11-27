// Test del puente a Telegram de BlackCode (main/telegram.cjs): el cliente de la
// API de bots contra el Telegram de mentira (main/telegram-simulado.cjs), el
// paso de markdown al HTML de Telegram (main/telegram-formato.cjs) y la
// conversión de audio con ffmpeg (main/ffmpeg.cjs). Con node pelado: sin red,
// y nada le escribe a nadie.
// Uso: node tools/test-blackcode-telegram.mjs

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const telegram = require(path.join(APP, 'main', 'telegram.cjs'));
const formato = require(path.join(APP, 'main', 'telegram-formato.cjs'));
const simulado = require(path.join(APP, 'main', 'telegram-simulado.cjs'));
const ffmpeg = require(path.join(APP, 'main', 'ffmpeg.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await pausa(10); } return Boolean(await cond()); }

// ---------- El formato ----------
{
  const { aHtml, plano, partir } = formato;
  const { htmlValido } = simulado;
  ok('formato: negrita, cursiva, tachado y código', aHtml('**hola** *che* ~~no~~ `a<b`') === '<b>hola</b> <i>che</i> <s>no</s> <code>a&lt;b</code>', aHtml('**hola** *che* ~~no~~ `a<b`'));
  ok('formato: un_nombre_de_archivo no es cursiva', aHtml('mirá mi_archivo_nuevo.txt') === 'mirá mi_archivo_nuevo.txt', aHtml('mirá mi_archivo_nuevo.txt'));
  ok('formato: _cursiva_ entre palabras sí', aHtml('es _muy_ bueno') === 'es <i>muy</i> bueno');
  ok('formato: lo que parece HTML se escapa', aHtml('<script>alert(1)</script> & co') === '&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  ok('formato: enlace', aHtml('[docs](https://ex.com/a?b=1&c="2")') === '<a href="https://ex.com/a?b=1&amp;c=&quot;2&quot;">docs</a>', aHtml('[docs](https://ex.com/a?b=1&c="2")'));
  ok('formato: adentro del código no hay formato', aHtml('`**no**`') === '<code>**no**</code>');
  const bloque = aHtml('antes\n```js\nconst a = 1 < 2;\n**x**\n```\ndespués');
  ok('formato: bloque de código con su lenguaje', bloque === 'antes\n<pre><code class="language-js">const a = 1 &lt; 2;\n**x**</code></pre>\ndespués', bloque);
  ok('formato: un título va en negrita', aHtml('## Resumen') === '<b>Resumen</b>');
  ok('formato: viñetas', aHtml('- uno\n* dos\n  - tres') === '• uno\n• dos\n  • tres', aHtml('- uno\n* dos\n  - tres'));
  const t = aHtml('| a | bb |\n|---|---|\n| ccc | d |');
  ok('formato: una tabla queda alineada en <pre>', t === '<pre>a    bb\nccc  d</pre>', JSON.stringify(t));
  ok('formato: cita', aHtml('> uno\n> dos') === '<blockquote>uno\ndos</blockquote>');
  ok('formato: un bloque sin cerrar no rompe', htmlValido(aHtml('```\nsin cerrar <b>')));
  // todo lo que sale es HTML que Telegram acepta
  const casos = ['**a *b* c**', '*a **b** c*', '[x **y**](https://a.b)', '~~a `b` c~~', '__a__ _b_ ***c***', '# t\n\n> **q** _r_\n\n- [ ] a\n- [x] b', 'x < y && y > z', '****', '* * *', '`', 'a * b * c', '**sin cerrar', '_a_b_'];
  for (const c of casos) ok(`formato: HTML válido para ${JSON.stringify(c)}`, htmlValido(aHtml(c)), aHtml(c));
  ok('formato: plano sin marcas', plano('## T\n**a** [b](https://c.d)') === 'T\na b (https://c.d)', plano('## T\n**a** [b](https://c.d)'));
  // lo largo se parte en mensajes que entran
  const largo = Array.from({ length: 60 }, (_, i) => `Párrafo ${i}: ${'palabra '.repeat(30)}`).join('\n\n');
  const partes = partir(largo);
  ok('formato: lo largo se parte', partes.length > 1, String(partes.length));
  ok('formato: cada pedazo entra en un mensaje', partes.every((p) => p.html.length <= 4096 && htmlValido(p.html)));
  ok('formato: no se pierde ningún párrafo', partes.map((p) => p.html).join('\n\n').split('Párrafo').length - 1 === 60);
  const codigo = `\`\`\`py\n${Array.from({ length: 400 }, (_, i) => `x_${i} = "<${i}>"`).join('\n')}\n\`\`\``;
  const pc = partir(codigo);
  ok('formato: un bloque de código largo va en varios bloques de código', pc.length > 1 && pc.every((p) => p.html.startsWith('<pre><code class="language-py">') && p.html.endsWith('</code></pre>') && p.html.length <= 4096), pc.map((p) => p.html.length).join(','));
  ok('formato: un renglón larguísimo igual se corta', partir('a'.repeat(9000)).every((p) => p.html.length <= 4096));
  ok('formato: vacío no manda nada', partir('').length === 0 && partir('\n\n \n').length === 0);
}

// ---------- El cliente, contra el Telegram de mentira ----------
function armar({ dueno = null, offset = 0 } = {}) {
  const falso = simulado.crear();
  const cfg = { activo: true, token: falso.TOKEN, dueno, offset };
  const mensajes = [];
  const botones = [];
  const candidatos = [];
  const estados = [];
  const offsets = [];
  const tg = telegram.crear({
    fetch: falso.fetch,
    base: falso.base,
    config: () => cfg,
    alMensaje: (m) => mensajes.push(m),
    alBoton: (b) => { botones.push(b); return b.datos === 'viejo' ? 'This was already answered.' : ''; },
    alCandidato: (q) => candidatos.push(q),
    guardarOffset: (n) => { cfg.offset = n; offsets.push(n); },
    alCambiar: (s) => estados.push(s),
    sondeoS: 1,
    reintentoMs: [50, 200],
  });
  return { falso, tg, cfg, mensajes, botones, candidatos, estados, offsets };
}
const enviadosDe = (falso, metodo) => falso.enviados.filter((x) => x.metodo === metodo);

{
  const { falso, tg } = armar();
  const bot = await tg.comprobar(falso.TOKEN);
  ok('comprobar: un token bueno devuelve el bot', bot.usuario === 'zac_smoke_bot' && bot.id === 7000001, JSON.stringify(bot));
  let error = '';
  try { await tg.comprobar('7000001:AAotro-token-que-no-sirve-para-nada-000'); } catch (err) { error = err.message; }
  ok('comprobar: un token malo dice que Telegram lo rechazó', /rejected/.test(error), error);
  ok('comprobar: el token no aparece en el error', !error.includes('AAotro'), error);
  ok('esToken: la forma de un token', telegram.esToken(falso.TOKEN) && !telegram.esToken('hola') && !telegram.esToken('123:abc') && !telegram.esToken(`${falso.TOKEN} x`));
  // La nota del turno: markdown común (Zac escribía la negrita como en Telegram, con un asterisco, y salía cursiva)
  const nota = telegram.TELEGRAM_NOTE;
  ok('nota: pide markdown común, con la negrita de dos asteriscos', /ordinary Markdown/.test(nota) && nota.includes('**double asterisks**') && /do not use Telegram’s own \*single-asterisk\* bold/.test(nota), nota);
  ok('nota: dice que las imágenes de run_code también llegan', /generate_image/.test(nota) && /run_code/.test(nota));
  ok('nota: …y que un asterisco solo es cursiva, como lo convierte el formato', formato.aHtml('*x*') === '<i>x</i>' && formato.aHtml('**x**') === '<b>x</b>');
}

// Sin dueño: el que escribe es un candidato, y se le dice cómo vincular (una vez por minuto).
{
  const { falso, tg, candidatos, mensajes, estados } = armar();
  tg.arrancar();
  ok('arranca: se conecta', await hasta(() => tg.estado().conexion === 'connected'), JSON.stringify(tg.estado()));
  ok('arranca: sabe quién es el bot', tg.estado().bot?.usuario === 'zac_smoke_bot');
  ok('arranca: pone el menú de comandos', await hasta(() => enviadosDe(falso, 'setMyCommands').some((x) => x.params.commands?.map((c) => c.command).join() === 'new,stop,help')));
  await falso.simular({ que: 'mensaje', texto: 'hola' });
  ok('sin dueño: quien escribe queda como candidato', await hasta(() => candidatos.length === 1) && candidatos[0].id === falso.DUENO.id && candidatos[0].usuario === 'fran_smoke' && candidatos[0].nombre === 'Fran Smoke', JSON.stringify(candidatos));
  ok('sin dueño: se le dice cómo vincular', await hasta(() => enviadosDe(falso, 'sendMessage').some((x) => /Settings › Integrations › Telegram/.test(x.params.text) && x.params.chat_id === falso.DUENO.id)));
  await falso.simular({ que: 'mensaje', texto: 'hola de nuevo' });
  await hasta(() => candidatos.length === 2);
  await pausa(100);
  ok('sin dueño: el aviso no se repite enseguida', enviadosDe(falso, 'sendMessage').length === 1, String(enviadosDe(falso, 'sendMessage').length));
  ok('sin dueño: nada llega como mensaje', mensajes.length === 0);
  ok('estado: avisó cada cambio de conexión', estados.some((s) => s.conexion === 'connecting') && estados.some((s) => s.conexion === 'connected'));
  tg.parar();
  ok('parar: queda apagado', tg.estado().conexion === 'off');
}

// Con dueño: solo él pasa; un desconocido y un grupo no reciben nada.
{
  const r = armar({ dueno: { id: 555001 } });
  const { falso, tg, mensajes, candidatos } = r;
  tg.arrancar();
  await hasta(() => tg.estado().conexion === 'connected');
  await falso.simular({ que: 'mensaje', texto: 'soy un extraño', de: 'otro' });
  await falso.simular({ que: 'mensaje', texto: 'en un grupo', grupo: true });
  await falso.simular({ que: 'mensaje', texto: 'hola Zac' });
  ok('dueño: su mensaje llega', await hasta(() => mensajes.length === 1) && mensajes[0].texto === 'hola Zac' && mensajes[0].chat === 555001 && mensajes[0].comando === null, JSON.stringify(mensajes));
  await pausa(150);
  ok('dueño: ni el extraño ni el grupo llegan', mensajes.length === 1 && candidatos.length === 0, JSON.stringify(mensajes.map((m) => m.texto)));
  ok('dueño: al extraño no se le contesta nada', enviadosDe(falso, 'sendMessage').length === 0);
  await falso.simular({ que: 'mensaje', texto: '/new' });
  await falso.simular({ que: 'mensaje', texto: '/stop@zac_smoke_bot' });
  ok('dueño: los comandos', await hasta(() => mensajes.length === 3) && mensajes[1].comando === 'new' && mensajes[2].comando === 'stop', JSON.stringify(mensajes.map((m) => m.comando)));
  await falso.simular({ que: 'foto', datos: Buffer.from('jpg!').toString('base64'), texto: 'mirá esto' });
  ok('dueño: una foto llega con la más grande y su epígrafe', await hasta(() => mensajes.length === 4) && mensajes[3].foto?.id === 'f1' && mensajes[3].texto === 'mirá esto', JSON.stringify(mensajes[3]));
  const bajada = await tg.descargar(mensajes[3].foto.id);
  ok('descargar: trae los bytes y la ruta', bajada.datos.toString() === 'jpg!' && bajada.ruta === 'photos/file_1.jpg');
  let grande = '';
  try { await tg.descargar(mensajes[3].foto.id, 2); } catch (err) { grande = err.message; }
  ok('descargar: respeta el máximo', /too big/.test(grande), grande);
  await falso.simular({ que: 'audio', datos: Buffer.from('OggS....').toString('base64') });
  ok('dueño: un audio llega como nota de voz', await hasta(() => mensajes.length === 5) && mensajes[4].audio?.nota === true && mensajes[4].audio.id === 'f2', JSON.stringify(mensajes[4]));
  await falso.simular({ que: 'documento', datos: Buffer.from('a,b\n1,2').toString('base64'), ruta: 'documents/datos.csv', tipo: 'text/csv' });
  ok('dueño: un archivo llega con su nombre y tipo', await hasta(() => mensajes.length === 6) && mensajes[5].documento?.nombre === 'datos.csv' && mensajes[5].documento.tipo === 'text/csv', JSON.stringify(mensajes[5]));
  await falso.simular({ que: 'sticker' });
  ok('dueño: lo que no se lee llega marcado', await hasta(() => mensajes.length === 7) && mensajes[6].otro === 'sticker');
  // los botones: solo los del dueño, y siempre se contesta el toque
  await falso.simular({ que: 'boton', boton: 'p:1:a', mensaje: 77 });
  await falso.simular({ que: 'boton', boton: 'p:1:d', de: 'otro', mensaje: 77 });
  await falso.simular({ que: 'boton', boton: 'viejo', mensaje: 78 });
  ok('botones: llegan los del dueño', await hasta(() => r.botones.length === 2) && r.botones[0].datos === 'p:1:a' && r.botones[0].mensaje === 77 && r.botones[1].datos === 'viejo', JSON.stringify(r.botones));
  ok('botones: se contestan los tres toques', await hasta(() => enviadosDe(falso, 'answerCallbackQuery').length === 3));
  ok('botones: el aviso de lo ya contestado viaja', enviadosDe(falso, 'answerCallbackQuery').some((x) => x.params.text === 'This was already answered.'));
  // lo leído se recuerda: al volver a arrancar no se repite nada
  ok('offset: se guarda lo leído', r.offsets.length > 0 && r.cfg.offset > 1);
  tg.parar();
  const antes = mensajes.length;
  tg.arrancar();
  await hasta(() => tg.estado().conexion === 'connected');
  await pausa(200);
  ok('offset: al volver a arrancar no se repite nada', mensajes.length === antes, `${mensajes.length} vs ${antes}`);
  tg.parar();
}

// Lo que sale: texto (y su plan B), lo largo, fotos, voz, «escribiendo», editar.
{
  const { falso, tg } = armar({ dueno: { id: 555001 } });
  await tg.mandarTexto(555001, '**hola** _che_');
  const m1 = enviadosDe(falso, 'sendMessage').at(-1);
  ok('mandarTexto: va en HTML', m1?.params.text === '<b>hola</b> <i>che</i>' && m1.params.parse_mode === 'HTML' && m1.params.link_preview_options?.is_disabled === true, JSON.stringify(m1?.params));
  await falso.simular({ que: 'fallar', metodo: 'sendMessage', error_code: 400, description: 'Bad Request: can\'t parse entities' });
  await tg.mandarTexto(555001, '**otra**');
  const m2 = enviadosDe(falso, 'sendMessage').at(-1);
  ok('mandarTexto: si Telegram rechaza el HTML, va en texto plano', m2?.params.text === 'otra' && !m2.params.parse_mode, JSON.stringify(m2?.params));
  await falso.simular({ que: 'fallar', metodo: 'sendMessage', error_code: 500, description: 'Internal' });
  let error = '';
  try { await tg.mandarTexto(555001, 'x'); } catch (err) { error = err.message; }
  ok('mandarTexto: otro error no se esconde', error === 'Internal', error);
  falso.enviados.length = 0;
  const largo = Array.from({ length: 40 }, (_, i) => `**${i}** ${'texto '.repeat(40)}`).join('\n\n');
  const ultimo = await tg.mandarTexto(555001, largo, { botones: [[{ text: 'A', callback_data: 'x' }]] });
  const varios = enviadosDe(falso, 'sendMessage');
  ok('mandarTexto: lo largo va en varios mensajes', varios.length > 1 && varios.every((x) => x.params.text.length <= 4096), String(varios.length));
  ok('mandarTexto: los botones van solo en el último', varios.slice(0, -1).every((x) => !x.params.reply_markup) && varios.at(-1).params.reply_markup?.inline_keyboard?.[0]?.[0]?.text === 'A' && ultimo === varios.at(-1).id);
  await tg.mandarFoto(555001, Buffer.from('\x89PNG....'), { nombre: 'gato.png', tipo: 'image/png' });
  const foto = enviadosDe(falso, 'sendPhoto').at(-1);
  ok('mandarFoto: sube el archivo', foto?.archivo?.campo === 'photo' && foto.archivo.nombre === 'gato.png' && foto.archivo.tipo === 'image/png' && Number(foto.params.chat_id) === 555001, JSON.stringify(foto));
  await falso.simular({ que: 'fallar', metodo: 'sendPhoto', error_code: 400, description: 'Bad Request: PHOTO_INVALID_DIMENSIONS' });
  await tg.mandarFoto(555001, Buffer.from('\x89PNG....'), { nombre: 'larga.png', tipo: 'image/png' });
  ok('mandarFoto: si no la quiere como foto, va como archivo', enviadosDe(falso, 'sendDocument').at(-1)?.archivo?.nombre === 'larga.png');
  await tg.mandarVoz(555001, Buffer.from('OggS....'), { caption: 'hola', dur: 2.4 });
  const voz = enviadosDe(falso, 'sendVoice').at(-1);
  ok('mandarVoz: sube un OGG con su duración', voz?.archivo?.campo === 'voice' && voz.archivo.tipo === 'audio/ogg' && voz.archivo.cabeza === 'OggS' && Number(voz.params.duration) === 2 && voz.params.caption === 'hola', JSON.stringify(voz));
  await tg.accion(555001, 'record_voice');
  ok('accion: «grabando audio…»', enviadosDe(falso, 'sendChatAction').at(-1)?.params.action === 'record_voice');
  await tg.editarHtml(555001, 12, '<b>x</b>\n\n<i>Allowed.</i>');
  const ed = enviadosDe(falso, 'editMessageText').at(-1);
  ok('editarHtml: cambia el mensaje y saca los botones', ed?.params.message_id === 12 && ed.params.parse_mode === 'HTML' && !ed.params.reply_markup);
}

// Las fallas: token rechazado, un webhook que estorba, la red que se corta.
{
  const { falso, tg, cfg } = armar({ dueno: { id: 555001 } });
  cfg.token = '7000001:AAotro-token-que-no-sirve-para-nada-000';
  tg.arrancar();
  ok('fallas: un token rechazado queda en error y no insiste', await hasta(() => tg.estado().conexion === 'error') && /rejected/.test(tg.estado().error), JSON.stringify(tg.estado()));
  const consultas = (await falso.simular()).consultas;
  await pausa(300);
  ok('fallas: …y deja de preguntar', (await falso.simular()).consultas === consultas);
  ok('fallas: el token no aparece en el estado', !JSON.stringify(tg.estado()).includes('AAotro'));
  tg.parar();
}
{
  const { falso, tg } = armar({ dueno: { id: 555001 } });
  await falso.simular({ que: 'webhook' });
  tg.arrancar();
  ok('fallas: un webhook puesto se saca y sigue', await hasta(() => enviadosDe(falso, 'deleteWebhook').length === 1) && await hasta(() => tg.estado().conexion === 'connected'), JSON.stringify(tg.estado()));
  tg.parar();
}
{
  const { falso, tg, mensajes } = armar({ dueno: { id: 555001 } });
  await falso.simular({ que: 'fallar', metodo: 'getUpdates', error_code: 502, description: 'Bad Gateway', veces: 2 });
  tg.arrancar();
  ok('fallas: un error de Telegram se reintenta diciendo qué pasa', await hasta(() => tg.estado().error === 'Bad Gateway'), JSON.stringify(tg.estado()));
  ok('fallas: …y vuelve solo', await hasta(() => tg.estado().conexion === 'connected' && !tg.estado().error), JSON.stringify(tg.estado()));
  await falso.simular({ que: 'mensaje', texto: 'sigo acá' });
  ok('fallas: después del corte, los mensajes llegan', await hasta(() => mensajes.some((m) => m.texto === 'sigo acá')));
  tg.parar();
  // parar corta la espera larga enseguida
  const t0 = Date.now();
  tg.arrancar();
  await hasta(() => tg.estado().conexion === 'connected');
  tg.parar();
  ok('parar: corta la espera larga', tg.estado().conexion === 'off' && Date.now() - t0 < 2000);
}
// sin token, ni arranca
{
  const { tg, cfg } = armar();
  cfg.token = null;
  tg.arrancar();
  ok('sin token: queda apagado', tg.estado().conexion === 'off');
  cfg.token = 'x';
  cfg.activo = false;
  tg.arrancar();
  ok('apagado: queda apagado', tg.estado().conexion === 'off');
}

// ---------- ffmpeg ----------
{
  const sr = 24000;
  const pcm = Buffer.alloc(sr * 2 * 1); // un segundo de tono
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), i);
  let ogg = null;
  let error = '';
  try { ogg = await ffmpeg.aOpus(pcm, sr); } catch (err) { error = err.message; }
  if (/not found/.test(error)) {
    console.log('test-blackcode-telegram: no hay ffmpeg en el PATH, salteo esa parte');
  } else {
    ok('ffmpeg: PCM → OGG/Opus', ogg && ogg.subarray(0, 4).toString('latin1') === 'OggS' && ogg.includes(Buffer.from('OpusHead')), error);
    const vuelta = ogg ? await ffmpeg.aPcm16k(ogg).catch((err) => { error = err.message; return null; }) : null;
    // (un segundo a 16 kHz y 16 bits son 32000 bytes; Opus agrega un poco de relleno)
    ok('ffmpeg: OGG → PCM de 16 kHz', vuelta && Math.abs(vuelta.length - 32000) < 3000, `${vuelta?.length} ${error}`);
    let roto = '';
    try { await ffmpeg.aPcm16k(Buffer.from('esto no es audio')); } catch (err) { roto = err.message; }
    ok('ffmpeg: algo que no es audio da un error que se entiende', /could not convert/.test(roto), roto);
  }
  let falta = '';
  try { await ffmpeg.aOpus(pcm, sr, { comando: 'ffmpeg-que-no-existe-xyz' }); } catch (err) { falta = err.message; }
  ok('ffmpeg: sin ffmpeg, dice que falta', /not found/.test(falta), falta);
}

if (failures.length) {
  console.error(`test-blackcode-telegram: ${failures.length} de ${hechas} fallaron:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`test-blackcode-telegram: ${hechas} pruebas en verde`);
process.exit(0);
