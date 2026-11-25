// Test de la hora de cada mensaje de BlackCode: la que viaja al modelo
// (apps/BlackCode/main/hora.cjs), la que se ve en el chat
// (apps/BlackCode/renderer/hora.js), que el system de un turno con tools ya no
// dependa del reloj, y que el proveedor de mentira lea el pedido sin el sello.
// Con node pelado: no abre la app ni sale a la red.
// Uso: node tools/test-blackcode-hora.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const H = require(path.join(APP, 'main', 'hora.cjs'));
const V = await import(pathToFileURL(path.join(APP, 'renderer', 'hora.js')).href);

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const t = (nombre, tiene, espera) => ok(nombre, JSON.stringify(tiene) === JSON.stringify(espera), `${JSON.stringify(tiene)} (se esperaba ${JSON.stringify(espera)})`);

// (horas locales: el sello se arma con la hora de la máquina, como lo ve el usuario)
const el = (a, m, d, h = 0, mi = 0, s = 0) => new Date(a, m - 1, d, h, mi, s).getTime();
const T1 = el(2026, 11, 25, 10, 47, 12);
const T2 = el(2026, 11, 25, 13, 5, 0);

// ---------- 1. El sello ----------
t('el sello es la fecha y la hora locales, hasta el minuto', H.sello(T1), '2026-11-25 10:47');
t('…con ceros adelante', H.sello(el(2026, 1, 5, 3, 4)), '2026-01-05 03:04');
t('lo que no es una hora no tiene sello', [undefined, null, 0, -5, NaN, Infinity, '1764078432000', {}, 8.64e15 + 1].map(H.sello), ['', '', '', '', '', '', '', '', '']);

// ---------- 2. Los mensajes, como viajan ----------
{
  const antes = [
    { rol: 'user', texto: 'de un chat viejo' },
    { rol: 'assistant', texto: 'una respuesta', t: T1 },
    { rol: 'user', texto: 'holis', t: T1 },
    { rol: 'assistant', texto: 'buenas' },
    { rol: 'user', texto: '', t: T2, imagenes: ['data:image/png;base64,AAAA'] },
    { rol: 'user', texto: 'con una hora rota', t: 'ayer' },
  ];
  const copia = JSON.stringify(antes);
  const sale = H.conHora(antes);
  t('el del usuario con hora la lleva adelante de su texto', sale[2], { rol: 'user', texto: '[2026-11-25 10:47] holis' });
  t('el que no la tiene (un chat de antes) viaja como estaba', sale[0], { rol: 'user', texto: 'de un chat viejo' });
  t('la respuesta del agente no lleva sello, aunque tenga hora (lo imitaría)', sale[1], { rol: 'assistant', texto: 'una respuesta' });
  t('un mensaje que es solo una imagen lleva el sello y nada más', sale[4], { rol: 'user', texto: '[2026-11-25 13:05]', imagenes: ['data:image/png;base64,AAAA'] });
  t('una hora rota no es una hora', sale[5], { rol: 'user', texto: 'con una hora rota' });
  ok('al proveedor no le llega el campo `t` en ningún mensaje', sale.every((m) => !('t' in m)), JSON.stringify(sale));
  ok('no cambia los mensajes que recibe', JSON.stringify(antes) === copia);
  ok('hayHora: alcanza con uno del usuario', H.hayHora(antes) === true && H.hayHora([antes[0], antes[1], antes[3]]) === false && H.hayHora([]) === false && H.hayHora(null) === false);
  t('lo que no es una lista da una lista vacía', H.conHora(undefined), []);
}

// ---------- 3. La nota en las instrucciones ----------
{
  ok('la nota explica el formato y pide no repetirlo', /\[YYYY-MM-DD HH:MM\]/.test(H.NOTA) && /never write it in your own replies/.test(H.NOTA) && /latest one is the current time/.test(H.NOTA));
  t('va al final de las instrucciones', H.conNota('Sos Zac.'), `Sos Zac.\n\n${H.NOTA}`);
  t('sin instrucciones, queda sola', H.conNota(''), H.NOTA);
  t('sinNota la saca y dice que estaba', H.sinNota(`Sos Zac.\n\n${H.NOTA}`), { texto: 'Sos Zac.', nota: true });
  t('…y si no estaba, no toca nada', H.sinNota('Sos Zac.'), { texto: 'Sos Zac.', nota: false });
  ok('la nota es un texto fijo: no lleva ni la fecha ni la hora', !/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/.test(H.NOTA));
}

// ---------- 4. El pedido entero ----------
{
  const pedido = { id: 'p1', modelo: 'm', instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'holis', t: T1 }] };
  const sale = H.paraElProveedor(pedido);
  t('con un mensaje con hora: el sello y la nota', { i: sale.instrucciones, m: sale.mensajes }, { i: `Sos Zac.\n\n${H.NOTA}`, m: [{ rol: 'user', texto: '[2026-11-25 10:47] holis' }] });
  ok('lo demás del pedido pasa igual', sale.id === 'p1' && sale.modelo === 'm');
  ok('y el pedido que se le dio no cambia', pedido.instrucciones === 'Sos Zac.' && pedido.mensajes[0].t === T1 && pedido.mensajes[0].texto === 'holis');
  const viejo = H.paraElProveedor({ instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'holis' }] });
  t('sin ninguna hora, ni sello ni nota (no se le explica un formato que no va a ver)', viejo, { instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'holis' }] });
  // Lo que el caché del proveedor necesita: lo que ya se mandó no cambia cuando
  // pasa el tiempo. Dos pedidos del mismo chat, con una hora de diferencia:
  const uno = H.paraElProveedor({ instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'a', t: T1 }] });
  const dos = H.paraElProveedor({ instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'a', t: T1 }, { rol: 'assistant', texto: 'b' }, { rol: 'user', texto: 'c', t: T2 }] });
  ok('el segundo pedido de un chat empieza igual que el primero (lo ya enviado no cambia)', dos.instrucciones === uno.instrucciones && JSON.stringify(dos.mensajes[0]) === JSON.stringify(uno.mensajes[0]));
}

// ---------- 5. Sacar el sello ----------
t('selloDe lee el sello con el que empieza un texto', [H.selloDe('[2026-11-25 10:47] holis'), H.selloDe('[2026-11-25 10:47]'), H.selloDe('holis [2026-11-25 10:47]'), H.selloDe('[hoy] holis'), H.selloDe(undefined)], ['2026-11-25 10:47', '2026-11-25 10:47', '', '', '']);
t('sinSello lo saca, y solo del principio', [H.sinSello('[2026-11-25 10:47] TOOLS: []'), H.sinSello('[2026-11-25 10:47]'), H.sinSello('a [2026-11-25 10:47] b'), H.sinSello('sin sello')], ['TOOLS: []', '', 'a [2026-11-25 10:47] b', 'sin sello']);
t('ida y vuelta', H.sinSello(H.conHora([{ rol: 'user', texto: '[una nota mía] hola', t: T1 }])[0].texto), '[una nota mía] hola');

// ---------- 6. La hora que se ve ----------
{
  const ahora = el(2026, 11, 25, 18, 0);
  t('de hoy: solo la hora', V.horaCorta(T1, ahora), '10:47');
  t('de ayer: el día y la hora', V.horaCorta(el(2026, 11, 24, 23, 58), ahora), '24/11 23:58');
  t('un minuto antes y un minuto después de la medianoche', [V.horaCorta(el(2026, 11, 24, 23, 59), el(2026, 11, 25, 0, 1)), V.horaCorta(el(2026, 11, 25, 0, 0), el(2026, 11, 25, 0, 1))], ['24/11 23:59', '00:00']);
  t('el mismo día de otro mes no es hoy', V.horaCorta(el(2026, 10, 25, 9, 5), ahora), '25/10 09:05');
  t('de otro año: con el año', V.horaCorta(el(2025, 11, 25, 10, 47), ahora), '25/11/2025 10:47');
  t('un mensaje sin hora no muestra nada', [undefined, null, 0, NaN, '10:47'].map((x) => V.horaCorta(x, ahora)), ['', '', '', '', '']);
  t('la fecha entera, para el tooltip', V.horaLarga(T1), 'Wednesday 25 November 2026, 10:47:12');
  t('…y nada si no hay hora', V.horaLarga(undefined), '');
  // ponerHora, con un elemento de mentira
  const nodo = () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
  const a = nodo();
  ok('ponerHora escribe la hora y deja la fecha en el tooltip propio (data-rad-tip, no title)', V.ponerHora(a, Date.now()) === true && /^\d{2}:\d{2}$/.test(a.textContent) && typeof a.attrs['data-rad-tip'] === 'string' && !('title' in a.attrs), JSON.stringify(a));
  ok('…y sin hora lo deja vacío y sin tooltip', V.ponerHora(a, undefined) === false && a.textContent === '' && !('data-rad-tip' in a.attrs));
}

// ---------- 7. El system de un turno con tools no depende del reloj ----------
// (dependía: la hora iba en su primer renglón, y como el system es el principio
// del pedido, el caché del proveedor no podía reusar nada del chat casi nunca)
{
  const herramientas = require(path.join(APP, 'main', 'tools', 'index.cjs'));
  const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-hora-'));
  herramientas.iniciar({ trash: async () => {} });
  herramientas.setCwd(taller);
  const s = herramientas.crearSesion({ reqId: 'r1', convoId: 'c1', ac: new AbortController(), tools: ['fs_read', 'fs_write'], confirma: false });
  const Real = Date;
  const enElMomento = (ms, fn) => {
    globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } };
    try { return fn(); } finally { globalThis.Date = Real; }
  };
  const a = enElMomento(T1, () => s.sistema('Sos Zac.'));
  const b = enElMomento(T2, () => s.sistema('Sos Zac.'));
  ok('el system es el mismo a las 10:47 que a las 13:05', a === b, `difieren desde el carácter ${[...a].findIndex((c, i) => c !== b[i])}`);
  ok('…y ya no trae la hora', !/Current date and time|2026-11-25/.test(a), a.slice(0, 200));
  ok('…pero sigue trayendo el entorno (usuario, carpetas)', /Windows username: /.test(a) && /Current working directory/.test(a));
  fs.rmSync(taller, { recursive: true, force: true });
}

// ---------- 8. El proveedor de mentira lee el pedido sin el sello ----------
{
  const simulado = require(path.join(APP, 'main', 'simulado.cjs'));
  const decir = async (pedido, sesion = null) => {
    let texto = '';
    const fin = await simulado.responder(pedido, { signal: new AbortController().signal, onTexto: (x) => { texto += x; }, onPensando: () => {}, sesion });
    return { texto, fin };
  };
  const pedido = H.paraElProveedor({ proveedor: 'anthropic', modelo: 'm', instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'viejo' }, { rol: 'assistant', texto: 'ok' }, { rol: 'user', texto: 'holis', t: T1 }] });
  const r = await decir(pedido);
  ok('repite el mensaje como se tipeó, sin el sello', r.texto.includes('I got your message: “holis”.'), r.texto.slice(0, 120));
  ok('cuenta las instrucciones sin la nota', r.texto.includes('- instructions: 8 characters'), /- instructions: [^\n]*/.exec(r.texto)?.[0]);
  ok('y dice con qué hora llegó el último, cuántos la traen y si vino la nota', r.texto.includes('- time on the last message: 2026-11-25 10:47 (1 of 2 from the user carry one, note yes)'), /- time[^\n]*/.exec(r.texto)?.[0]);
  const sin = await decir({ proveedor: 'anthropic', modelo: 'm', instrucciones: 'Sos Zac.', mensajes: [{ rol: 'user', texto: 'holis' }] });
  ok('un pedido sin hora no suma ese renglón', !sin.texto.includes('time on the last message') && sin.texto.includes('- instructions: 8 characters'));
  // con tools: el renglón TOOLS: se lee aunque el mensaje empiece con el sello
  const corridas = [];
  const sesion = {
    activa: true, esFinal: () => false, cerrarRonda: () => {}, cola: () => '', sistema: (i) => i,
    correr: async (name, args) => { corridas.push({ name, args }); return { out: 'done', error: false }; },
  };
  const conTools = await decir(H.paraElProveedor({ proveedor: 'anthropic', modelo: 'm', instrucciones: '', mensajes: [{ rol: 'user', texto: 'TOOLS: [{"name":"fs_read","args":{"paths":["a.txt"]}}]', t: T2 }] }), sesion);
  t('el guion de tools corre aunque el mensaje lleve el sello adelante', corridas, [{ name: 'fs_read', args: { paths: ['a.txt'] } }]);
  ok('…y el resumen dice con qué hora llegó', conTools.texto.includes('time on the last message: 2026-11-25 13:05 (1 of 1 from the user carry one, note yes)'), conTools.texto.slice(-160));
}

// ---------- 9. El cableado ----------
{
  const leer = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');
  const chat = leer('main', 'chat.cjs');
  ok('los tres pedidos (el chat, un subagente, una tarea) salen por paraElProveedor', (chat.match(/hora\.paraElProveedor\(/g) ?? []).length === 3);
  ok('…y ninguno le pasa al proveedor el pedido sin pasar por ahí', !/simulado\.responder\(pedido,|RESPONDER\[[^\]]+\]\(pedido,/.test(chat.replace(/responder: \(proveedor, pedido, opciones\) => RESPONDER\[proveedor\]\(pedido, opciones\),/, '')), 'queda una llamada al proveedor con el pedido crudo');
  ok('el que le pone nombre a un chat no lleva hora', !/hora\.cjs|paraElProveedor/.test(leer('main', 'titulo.cjs')));
  const datos = leer('renderer', 'datos.js');
  ok('el mensaje del usuario guarda cuándo se mandó, y la respuesta cuándo terminó', /const mio = \{ id: nuevoId\(\), rol: 'user', texto: limpio, t: Date\.now\(\)/.test(datos) && /r\.mensaje\.t = Date\.now\(\);/.test(datos));
}

if (failures.length) {
  console.error(`test-blackcode-hora: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-hora: ok (${hechas} comprobaciones: el sello, los mensajes como viajan, la nota, el pedido entero y el caché, sacar el sello, la hora que se ve y la medianoche, el system sin reloj, el proveedor de mentira y el cableado)`);
process.exit(0);
