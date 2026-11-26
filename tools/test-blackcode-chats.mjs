// Las tools de los chats de antes (chat_search y chat_read, en
// apps/BlackCode/main/tools/chats.cjs) y el `read` del canvas entre chats del
// mismo agente, con node pelado.
//
// La regla que se prueba antes que nada (Fran, 25/11/2026): cada agente busca
// y lee SOLO en sus propios chats. Zac no ve los de Oracle, ni con un id
// adivinado, ni desde un subagente, ni desde una tarea programada.
//
// Lo demás: buscar con todas las palabras y, si no, con alguna; el id del chat
// y el número del mensaje en cada coincidencia; los alcances (others, current,
// all); la lista de recientes sin consulta; leer alrededor de un mensaje, un
// tramo y por páginas; cómo se ven las tools, las imágenes y los archivos; y
// lo que pasa sin configurar o sin agente.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const chats = require(path.join(TOOLS, 'chats.cjs'));
const canvas = require(path.join(TOOLS, 'canvas.cjs'));
const motor = require(path.join(TOOLS, 'motor.cjs'));
const defs = require(path.join(TOOLS, 'defs.cjs'));

const failures = [];
let hechas = 0;
let seccionActual = '';
const seccion = (s) => { seccionActual = s; };
const ok = (name, cond, extra = '') => { hechas++; if (!cond) failures.push(`[${seccionActual}] ${name}${extra === '' || extra == null ? '' : `  → ${String(extra).slice(0, 400)}`}`); };
const t = (name, got, want) => { hechas++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`[${seccionActual}] ${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-chats-'));
const hacerRun = ({ agente = 'zac', convoId = 'z-hoy' } = {}) => {
  const run = { reqId: 'r1', ac: new AbortController(), convoId, agente, avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};
const buscar = (run, a) => chats.runners.chat_search(run, a);
const leer = (run, a) => chats.runners.chat_read(run, a);

// ── los datos: dos agentes, con palabras en común a propósito ───────────────
const H = (d, h = 12) => new Date(2026, 10, d, h, 0).getTime();
const LISTA = [
  { id: 'z-hoy', agente: 'zac', titulo: 'Hoy', cuenta: 2, creado: H(25), tocado: H(25, 18) },
  { id: 'z-iconos', agente: 'zac', titulo: 'Iconos para canvas', cuenta: 6, creado: H(24), tocado: H(24, 20) },
  { id: 'z-viejo', agente: 'zac', titulo: 'Plan de Biologica', cuenta: 2, creado: H(10), tocado: H(10, 9) },
  { id: 'z-largo', agente: 'zac', titulo: 'Chat largo', cuenta: 60, creado: H(5), tocado: H(5, 9) },
  { id: 'z-codigo', agente: 'zac', titulo: 'Codigo', cuenta: 4, creado: H(23, 10), tocado: H(23, 12) },
  { id: 'o-secreto', agente: 'oracle', titulo: 'Cosas de Oracle', cuenta: 2, creado: H(25), tocado: H(25, 19) },
];
const largo = 'x'.repeat(5000);
const DOCS = {
  'z-hoy': { mensajes: [{ rol: 'user', texto: 'hola zac, te acordas del icono del fantasma?', t: H(25, 18) }, { rol: 'assistant', texto: 'dejame buscar', estado: 'ok' }] },
  'z-iconos': { mensajes: [
    { rol: 'user', texto: 'armame una hoja de comparacion de iconos para el canvas', t: H(24, 19) },
    { rol: 'assistant', texto: 'Listo, la hoja esta en C:\\iconos\\canvas-icons.html', estado: 'ok', t: H(24, 19) },
    { id: 'c1', rol: 'tool', tool: 'fs_write', texto: 'C:\\iconos\\canvas-icons.html', estado: 'ok', salida: 'wrote 12 KB' },
    { rol: 'user', texto: 'me gusta la variante del fantasma pixelado', t: H(24, 20), imagenes: ['data:image/png;base64,AAAA'], archivos: [{ name: 'notas.txt', content: 'secreto que no viaja' }] },
    { rol: 'assistant', texto: 'Anotado: fantasma pixelado.', estado: 'ok' },
    { rol: 'assistant', texto: 'se corto', estado: 'frenado' },
  ] },
  'z-viejo': { mensajes: [{ rol: 'user', texto: 'plan para el final de biologica', t: H(10, 9) }, { rol: 'assistant', texto: 'Tres semanas, dos unidades por dia.', estado: 'ok' }] },
  'z-largo': { mensajes: Array.from({ length: 60 }, (_, i) => ({ rol: i % 2 ? 'assistant' : 'user', texto: i === 30 ? `el dato clave es 4242 ${largo}` : `mensaje ${i + 1} ${'y'.repeat(900)}`, estado: 'ok' })) },
  // (la fila de la tool es MÁS NUEVA que el mensaje: igual tiene que ganar el mensaje)
  'z-codigo': { mensajes: [
    { rol: 'user', texto: 'abri main.js por favor', t: H(23, 10) },
    { rol: 'assistant', texto: 'dale', estado: 'ok' },
    { rol: 'user', texto: 'segui', t: H(23, 12) },
    { id: 'c2', rol: 'tool', tool: 'fs_read', texto: 'C:\\app\\main.js', estado: 'ok', salida: 'contenido enorme del archivo' },
  ] },
  'o-secreto': { mensajes: [{ rol: 'user', texto: 'el fantasma pixelado y el icono del canvas, pero de Oracle', t: H(25, 19) }, { rol: 'assistant', texto: 'respuesta de oracle', estado: 'ok' }] },
};

try {
  seccion('sin configurar');
  t('sin chats, chat_search avisa', await buscar(hacerRun(), { query: 'x' }), 'error: past chats are not available in this app');
  t('…y chat_read también', await leer(hacerRun(), { id: 'z-hoy' }), 'error: past chats are not available in this app');
  ok('lista() dice que no hay', chats.lista() === false);

  chats.configurar({ lista: () => LISTA, leer: (id) => DOCS[id] ?? null });

  seccion('sin agente no se busca en ningún lado');
  ok('una corrida sin agente no busca', (await buscar(hacerRun({ agente: '' }), { query: 'fantasma' })).startsWith('error: this run does not belong to an agent'));
  ok('…ni lee', (await leer(hacerRun({ agente: null }), { id: 'z-iconos' })).startsWith('error: this run does not belong to an agent'));

  seccion('cada agente, sus chats (la regla de Fran)');
  {
    const r = await buscar(hacerRun(), { query: 'fantasma pixelado' });
    ok('Zac encuentra lo suyo', r.includes('[Chat "Iconos para canvas" · id z-iconos]'), r);
    ok('…y NUNCA lo de Oracle, aunque coincida', !r.includes('Oracle') && !r.includes('o-secreto'), r);
    const ro = await buscar(hacerRun({ agente: 'oracle', convoId: 'otro' }), { query: 'fantasma pixelado' });
    ok('Oracle encuentra lo suyo y nada de Zac', ro.includes('o-secreto') && !ro.includes('z-iconos'), ro);
    t('Zac no lee un chat de Oracle con el id adivinado', await leer(hacerRun(), { id: 'o-secreto' }), 'error: none of your chats has the id "o-secreto" — use chat_search to find it');
    t('…y es el mismo error que un id que no existe', await leer(hacerRun(), { id: 'no-existe' }), 'error: none of your chats has the id "no-existe" — use chat_search to find it');
    const browse = await buscar(hacerRun(), {});
    ok('la lista de recientes tampoco muestra los de Oracle', !browse.includes('Oracle'), browse);
  }

  seccion('chat_search');
  {
    const r = await buscar(hacerRun(), { query: 'fantasma pixelado' });
    ok('cada coincidencia dice su número de mensaje', /#4 \[2026-11-24 20:00\] user: me gusta la variante del fantasma pixelado/.test(r), r);
    ok('y cómo seguir leyendo', r.includes('chat_read with the chat id and around'), r);
    ok('una respuesta sin hora toma la del mensaje que respondió', r.includes('#5 [2026-11-24 20:00] assistant: Anotado: fantasma pixelado.'), r);
    ok('adentro de un chat, en el orden en que se dijo', r.indexOf('#4 ') > 0 && r.indexOf('#4 ') < r.indexOf('#5 '), r);
    ok('el chat actual no entra (scope others)', !r.includes('z-hoy'), r);
    const actual = await buscar(hacerRun(), { query: 'fantasma', scope: 'current' });
    ok('scope current busca solo en este chat', actual.includes('z-hoy') && !actual.includes('z-iconos'), actual);
    const todos = await buscar(hacerRun(), { query: 'fantasma', scope: 'all' });
    ok('scope all, en los dos (y sigue sin Oracle)', todos.includes('z-hoy') && todos.includes('z-iconos') && !todos.includes('o-secreto'), todos);
    const ruta = await buscar(hacerRun(), { query: 'canvas-icons.html' });
    ok('encuentra por lo que tocó una tool (su ruta)', ruta.includes('tool fs_write'), ruta);
    // (Zac, 1.8.1: las salidas de las tools llenaban la búsqueda de ruido)
    t('lo que DEVOLVIÓ una tool no se busca', await buscar(hacerRun(), { query: 'enorme' }), 'No messages matching "enorme" in your other chats.');
    const uno = await buscar(hacerRun(), { query: 'main.js', limit: 1 });
    ok('un mensaje le gana a una fila de tool, aunque la tool sea más nueva', uno.includes('#1 [2026-11-23 10:00] user: abri main.js') && !uno.includes('tool fs_read'), uno);
    const dos = await buscar(hacerRun(), { query: 'main.js', limit: 2 });
    ok('…y la tool completa los lugares que sobran', dos.includes('#1 ') && dos.includes('#4 [2026-11-23 12:00] tool fs_read: fs_read C:\\app\\main.js'), dos);
    ok('las fechas van en ISO, como el sello de los mensajes', /\[2026-11-24 20:00\]/.test(r) && !/\d+\/\d+\/26/.test(r), r);
    const alguna = await buscar(hacerRun(), { query: 'biologica zanahoria' });
    ok('si ninguno tiene todas, valen los que tienen alguna, y lo dice', alguna.includes('z-viejo') && alguna.includes('No message has all of'), alguna);
    t('sin nada', await buscar(hacerRun(), { query: 'zanahoria' }), 'No messages matching "zanahoria" in your other chats.');
    const browse = await buscar(hacerRun(), {});
    ok('sin consulta, los chats recientes con su id, el más nuevo primero', browse.indexOf('z-iconos') > 0 && browse.indexOf('z-iconos') < browse.indexOf('z-viejo') && !browse.includes('z-hoy'), browse);
    ok('avisa a la fila con lo que buscó', hacerRun().avisos.length === 0);
    const run = hacerRun();
    await buscar(run, { query: 'fantasma de la ópera' });
    t('la fila dice las palabras (sin las vacías)', run.avisos[0], ['tool:activity', { reqId: 'r1', kind: 'chat_search', label: 'fantasma ópera' }]);
    const corto = await buscar(hacerRun(), { query: 'mensaje', limit: 3 });
    ok('limit acota las coincidencias', (corto.match(/^ {2}#/gm) ?? []).length === 3, corto);
  }

  seccion('chat_read');
  {
    const r = await leer(hacerRun(), { id: 'z-iconos' });
    ok('la cabecera dice el chat, el total y el tramo', r.startsWith('Chat "Iconos para canvas" (id z-iconos) · 6 messages · showing #1–#6'), r.slice(0, 120));
    ok('una tool va en una línea, con su estado', r.includes('#3 tool fs_write (ok): C:\\iconos\\canvas-icons.html') && !r.includes('wrote 12 KB'), r);
    ok('las imágenes y los archivos, como marcas (el contenido no viaja)', r.includes('[1 image] [file: notas.txt]') && !r.includes('secreto que no viaja'), r);
    ok('una respuesta cortada lo dice', r.includes('[frenado]'), r);
    const cerca = await leer(hacerRun(), { id: 'z-largo', around: 31 });
    ok('around: cinco antes y cinco después', cerca.includes('showing #26–#36') || /showing #26–#\d+/.test(cerca), cerca.slice(0, 120));
    ok('…con el mensaje buscado adentro', cerca.includes('el dato clave es 4242'), '');
    const largoEntero = `el dato clave es 4242 ${largo}`.length;
    ok('un mensaje largo se corta y lo dice', cerca.includes(`[message cut: ${largoEntero - 3000} more characters]`), cerca.match(/\[message cut[^\]]*\]/)?.[0]);
    const borde = await leer(hacerRun(), { id: 'z-iconos', around: 2 });
    ok('around cerca del principio no se pasa', borde.includes('showing #1–#6'), borde.slice(0, 120));
    const tramo = await leer(hacerRun(), { id: 'z-iconos', from: 2, to: 3 });
    ok('from/to', tramo.includes('showing #2–#3') && tramo.includes('[3 more messages after this — from: 4]'), tramo);
    const pagina = await leer(hacerRun(), { id: 'z-largo' });
    ok('un chat largo viene por páginas y dice dónde seguir', /\[page full — continue with from: \d+\]/.test(pagina) && pagina.length < 14000, pagina.slice(-120));
    ok('from fuera de rango se acomoda', (await leer(hacerRun(), { id: 'z-iconos', from: 99 })).includes('showing #6–#6'));
    t('sin id', await leer(hacerRun(), {}), 'error: id is required — the chat id from chat_search');
    t('números que no son números', await leer(hacerRun(), { id: 'z-iconos', from: 'dos' }), 'error: from, to and around are message numbers (1 is the first)');
  }

  seccion('cómo está enchufado');
  {
    const grupo = defs.GRUPOS.find((g) => g.id === 'memory');
    ok('van en el grupo Memory', grupo?.tools.includes('chat_search') && grupo.tools.includes('chat_read'), JSON.stringify(grupo));
    ok('las dos son de lectura (no gastan rondas)', motor.READ_ROUND_TOOLS.has('chat_search') && motor.READ_ROUND_TOOLS.has('chat_read'));
    ok('y repetirlas da lo mismo (cuentan para el corte de bucles)', motor.IDEMPOTENT_TOOLS.has('chat_search') && motor.IDEMPOTENT_TOOLS.has('chat_read'));
    t('la fila de chat_read dice el chat y el tramo', motor.argsDigest('chat_read', { id: 'z-largo', around: 31 }), 'z-largo · around #31');
    t('la de chat_search sin consulta', motor.argsDigest('chat_search', {}), 'recent chats');
    const src = fs.readFileSync(path.join(TOOLS, 'delegar.cjs'), 'utf8');
    ok('un subagente busca en los chats de su padre', src.includes('sesion.run.agente = padre.agente;'));
    const chat = fs.readFileSync(path.join(TOOLS, '..', 'chat.cjs'), 'utf8');
    ok('una tarea programada corre a nombre de su agente', chat.includes('Object.assign(sesion.run, { agente: tarea.agente,'));
    ok('el id de un chat se valida antes de leer su documento', chat.includes("/^[\\w-]+$/.test(String(id)) ? rad.store.read(`chat-${id}`) : null"));
  }

  seccion('canvas: read entre chats del mismo agente');
  {
    const DB = path.join(TMP, 'canvas.db');
    canvas.configurar({ dbPath: () => DB, agenteDeChat: chats.agenteDe });
    const crear = async (convoId, title, agente = 'zac') => {
      const r = await canvas.runners.canvas(hacerRun({ convoId, agente }), { action: 'create', title, content: `contenido de ${title}` });
      return /\bid[:= ]+"?([\w-]+)/i.exec(r)?.[1];
    };
    const deZac = await crear('z-iconos', 'Hoja de iconos');
    const deOracle = await crear('o-secreto', 'Lo de Oracle', 'oracle');
    ok('cada canvas guarda de qué agente es al nacer (1.8.2)', canvas.store.get(deZac)?.agent_id === 'zac' && canvas.store.get(deOracle)?.agent_id === 'oracle', JSON.stringify([canvas.store.get(deZac)?.agent_id, canvas.store.get(deOracle)?.agent_id]));
    ok('se crearon los dos canvas', Boolean(deZac && deOracle), `${deZac} ${deOracle}`);
    const propio = await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'read', id: deZac });
    ok('Zac lee el canvas de otro chat suyo', propio.includes('contenido de Hoja de iconos') && propio.includes('from another of your chats'), propio.slice(0, 160));
    t('…pero no lo edita desde acá', await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'edit', id: deZac, edits: [{ old: 'contenido', new: 'otro' }] }), `error: canvas not found: ${deZac}`);
    t('y el de Oracle, nunca', await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'read', id: deOracle }), `error: canvas not found: ${deOracle}`);
    t('ni desde una tarea programada (sin chat)', await canvas.runners.canvas(hacerRun({ convoId: '' }), { action: 'read', id: deOracle }), `error: canvas not found: ${deOracle}`);
    ok('una tarea de Zac sí lee los de Zac', (await canvas.runners.canvas(hacerRun({ convoId: '' }), { action: 'read', id: deZac })).includes('contenido de Hoja de iconos'));
    const enSuChat = await canvas.runners.canvas(hacerRun({ convoId: 'z-iconos' }), { action: 'read', id: deZac });
    ok('en su propio chat se lee como siempre (para editarlo)', enSuChat.includes('to revise it, call canvas action "edit"'), enSuChat.slice(0, 120));

    // La biblioteca y el borrado, también por agente (Fran: «en NeonCode el
    // único agente era Neo; acá pueden existir varios»).
    // Los huérfanos (1.8.2, decisiones de Fran). Uno viejo, de antes de que
    // los canvas guardaran su agente, sin chat: no tiene dueño conocido, es de
    // todos. Uno de antes que todavía tiene su chat: es del agente del chat.
    const viejoSuelto = canvas.store.create({ conversationId: null, title: 'Chistes de gatos', content: 'miau' }).id;
    const viejoConChat = canvas.store.create({ conversationId: 'o-secreto', title: 'Viejo de Oracle', content: 'x' }).id;
    // Uno de una tarea programada de Oracle: sin chat, pero con su agente.
    const deTarea = await crear('', 'De una tarea de Oracle', 'oracle');
    const biblio = await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'list', scope: 'all' });
    ok('el list «all» de Zac trae los suyos y el huérfano viejo', biblio.includes(deZac) && biblio.includes(viejoSuelto) && biblio.startsWith('All the canvases of your chats (2)'), biblio);
    ok('…y no los de Oracle: ni el de su chat, ni uno viejo de su chat, ni el de su tarea', !biblio.includes(deOracle) && !biblio.includes(viejoConChat) && !biblio.includes(deTarea), biblio);
    const deOracleVe = await canvas.runners.canvas(hacerRun({ agente: 'oracle', convoId: 'otro' }), { action: 'list', scope: 'all' });
    ok('Oracle ve los suyos (también el de su tarea) y el huérfano viejo, nada de Zac', deOracleVe.includes(deOracle) && deOracleVe.includes(viejoConChat) && deOracleVe.includes(deTarea) && deOracleVe.includes(viejoSuelto) && !deOracleVe.includes(deZac), deOracleVe);
    ok('el huérfano viejo lo lee cualquiera', (await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'read', id: viejoSuelto })).includes('miau'));
    // Se borra el chat de Zac donde nació su canvas: sigue siendo de Zac.
    canvas.store.orphanConversation('z-iconos', 'zac');
    ok('al borrar su chat, el canvas queda sin chat pero con su agente', canvas.store.get(deZac)?.conversation_id === null && canvas.store.get(deZac)?.agent_id === 'zac');
    const suelto = await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'read', id: deZac });
    ok('…y Zac lo sigue leyendo, «whose chat was deleted»', suelto.includes('contenido de Hoja de iconos') && suelto.includes('whose chat was deleted'), suelto.slice(0, 140));
    t('…y Oracle sigue sin verlo', await canvas.runners.canvas(hacerRun({ agente: 'oracle', convoId: 'otro' }), { action: 'read', id: deZac }), `error: canvas not found: ${deZac}`);
    // Un canvas viejo (sin agente) de un chat que se borra toma el agente del chat.
    canvas.store.orphanConversation('o-secreto', 'oracle');
    ok('un viejo sin agente, al borrarse su chat, queda a nombre del agente del chat', canvas.store.get(viejoConChat)?.agent_id === 'oracle');
    t('…así que no pasa a ser «de todos»', await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'read', id: viejoConChat }), `error: canvas not found: ${viejoConChat}`);
    t('Zac no borra el de Oracle', await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'delete', id: deOracle }), `error: canvas not found: ${deOracle}`);
    ok('…que sigue ahí', Boolean(canvas.store.get(deOracle)));
    t('la tarjeta de permiso no muestra el contenido ajeno', canvas.canvasPreview({ action: 'delete', id: deOracle }, hacerRun({ convoId: 'z-hoy' })), { target: `canvas ${deOracle}`, mode: 'gone' });
    ok('…pero sí el de un chat suyo', canvas.canvasPreview({ action: 'delete', id: deZac }, hacerRun({ convoId: 'z-hoy' }))?.mode === 'diff');
    ok('Zac sí borra uno de otro chat suyo', (await canvas.runners.canvas(hacerRun({ convoId: 'z-hoy' }), { action: 'delete', id: deZac })).startsWith('Canvas "Hoja de iconos" deleted'));
    canvas.cerrar();
  }
} catch (e) {
  failures.push(`excepción: ${e?.stack || e}`);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* la base puede seguir abierta un instante */ }
}

if (failures.length) {
  console.log(`test-blackcode-chats: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-chats: ok (${hechas} comprobaciones: cada agente solo con sus chats —también con un id adivinado, desde un subagente y desde una tarea—, buscar con todas o alguna palabra, alcances, recientes, leer alrededor, tramos y páginas, cómo se ven las tools, imágenes y archivos, el cableado, y el canvas entre chats del mismo agente)`);
