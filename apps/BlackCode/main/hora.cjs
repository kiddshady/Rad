'use strict';
// La hora de cada mensaje, para el modelo.
//
// Cada mensaje del usuario guarda cuándo se mandó (`t`, en milisegundos). Al
// armar el pedido se le pone esa hora adelante, `[2026-11-25 10:47] hola`, y
// una línea fija en las instrucciones explica el formato. El texto guardado y
// el que se ve en el chat quedan limpios: el sello se agrega acá, al viajar.
//
// Así el modelo sabe cuánto pasó entre un mensaje y otro (antes creía que toda
// la conversación ocurría «ahora»), y el último mensaje dice qué hora es.
//
// Por eso mismo la hora ya NO va en el system: cambiaba cada minuto, y como el
// system es el principio del pedido, el caché del proveedor no podía reusar
// nada de lo que venía después —el chat entero— casi nunca. Con el sello en
// cada mensaje, lo ya enviado no cambia más.
//
// Las respuestas del agente no llevan sello: lo imitaría en lo que escribe.

const p2 = (n) => String(n).padStart(2, '0');

/** `2026-11-25 10:47`, en la hora local de la máquina. '' si no es una hora. */
function sello(ms) {
  const d = new Date(ms);
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const NOTA = 'Each message from the user starts with the local time it was sent, as [YYYY-MM-DD HH:MM]. The time on the latest one is the current time. Use these times to reason about how much time passed between messages (the user may come back hours or days later). The prefix is added by the app: never write it in your own replies. Messages without one are older and their time is unknown.';
const PREFIJO = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] ?/;

/** Los mensajes, con la hora adelante en los del usuario que la tienen. No
 *  cambia los que recibe, y no deja el campo `t` (el proveedor no lo conoce). */
function conHora(mensajes) {
  return (Array.isArray(mensajes) ? mensajes : []).map((m) => {
    if (!m || typeof m !== 'object') return m;
    const { t, ...resto } = m;
    const s = m.rol === 'user' ? sello(t) : '';
    if (!s) return resto;
    const texto = String(resto.texto ?? '');
    return { ...resto, texto: texto ? `[${s}] ${texto}` : `[${s}]` };
  });
}

/** ¿Algún mensaje viaja con su hora? (si no, la nota sobra) */
const hayHora = (mensajes) => (Array.isArray(mensajes) ? mensajes : []).some((m) => m?.rol === 'user' && sello(m.t));

/** Las instrucciones con la nota del formato al final (texto fijo: no rompe el caché). */
const conNota = (instrucciones) => [String(instrucciones ?? '').trim(), NOTA].filter(Boolean).join('\n\n');

/** Las instrucciones sin la nota, y si la traían (la nota va siempre al final). */
function sinNota(instrucciones) {
  const s = String(instrucciones ?? '');
  return s.endsWith(NOTA) ? { texto: s.slice(0, -NOTA.length).trimEnd(), nota: true } : { texto: s, nota: false };
}

/** El pedido como sale hacia el proveedor: la hora adelante de cada mensaje del
 *  usuario que la tiene y, si alguno la tiene, la nota en las instrucciones.
 *  No cambia el pedido que recibe. */
function paraElProveedor(pedido) {
  const mensajes = conHora(pedido.mensajes);
  return hayHora(pedido.mensajes) ? { ...pedido, instrucciones: conNota(pedido.instrucciones), mensajes } : { ...pedido, mensajes };
}

/** Saca el sello del principio de un texto (el proveedor de mentira lo usa para leer el pedido tal como se tipeó). */
const sinSello = (texto) => String(texto ?? '').replace(PREFIJO, '');
/** El sello con el que empieza un texto, o ''. */
const selloDe = (texto) => PREFIJO.exec(String(texto ?? ''))?.[0].trim().slice(1, -1) ?? '';

module.exports = { sello, conHora, hayHora, conNota, sinNota, paraElProveedor, sinSello, selloDe, NOTA };
