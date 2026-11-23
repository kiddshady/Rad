// Los datos de Daimon: agentes, chats y mensajes, y el ida y vuelta con el
// modelo. Las vistas no tocan el store ni el puente: piden acá y escuchan.
//
// Qué se guarda (con el store del núcleo):
//   agentes     { lista: [{ id, nombre, proveedor, modelo, instrucciones, creado }] }
//   chats       { lista: [{ id, agente, titulo, auto, cuenta, creado, tocado }] }
//   chat-<id>   { mensajes: [{ id, rol, texto, estado?, nota?, modelo? }] }
//   ui          { agente, chats: { <agente>: <chat> } }   lo último que se miraba
// Un documento por chat: abrir la app no lee todas las conversaciones, y
// guardar un mensaje no reescribe las demás.
//
// estado de un mensaje del agente: 'escribiendo' (está llegando), 'ok',
// 'frenado', 'cortado' (la app se cerró a mitad), 'largo', 'rechazo', 'error'.

import { openDoc, removeDoc } from '/@core/store.js';

const nuevoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const GUARDAR_CADA_MS = 1500;
const TITULO_MAX = 46;

let agentes;
let chats;
let ui;
let catalogo = { proveedores: [] }; // los proveedores con sus modelos
const hilos = new Map();      // id del chat -> promesa de su documento
const respuestas = new Map(); // id del chat -> { pedido, mensaje, doc, pensando, guardado }
const porPedido = new Map();  // id del pedido -> id del chat

// ---------- Avisos ----------
// 'agentes', 'chats', 'seleccion', 'modelos' (cambió la lista de un
// proveedor), 'mensajes' { chat }, 'texto' { chat, mensaje } (llegó un pedazo)
// y 'respuesta' { chat } (empezó, piensa o terminó).
const oyentes = new Map();
export function on(tipo, fn) {
  if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
  oyentes.get(tipo).add(fn);
  return () => oyentes.get(tipo).delete(fn);
}
const avisar = (tipo, detalle = {}) => { for (const fn of oyentes.get(tipo) ?? []) fn(detalle); };

// ---------- Arranque ----------
export async function abrir() {
  [agentes, chats, ui, catalogo] = await Promise.all([
    openDoc('agentes', { lista: [] }),
    openDoc('chats', { lista: [] }),
    openDoc('ui', { agente: null, chats: {} }),
    window.rad.invoke('chat:modelos'),
  ]);
  // La primera vez hay un agente para empezar a escribir sin armar nada.
  if (!agentes.get().lista.length) crearAgente({ nombre: 'Daimon', proveedor: PROVEEDOR_INICIAL, modelo: modeloInicial(PROVEEDOR_INICIAL), instrucciones: '' });
  window.rad.on('chat:evento', alLlegar);
  // La lista de modelos de Venice llega después, cuando el main la trae.
  window.rad.on('chat:modelos', (nuevo) => { catalogo = nuevo; avisar('modelos'); });
}

// ---------- Proveedores y modelos ----------
export const PROVEEDOR_INICIAL = 'anthropic';
export const proveedores = () => catalogo.proveedores;
const proveedor = (id) => catalogo.proveedores.find((p) => p.id === id);
export const nombreProveedor = (id) => proveedor(id)?.nombre ?? id;
export const modelosDe = (id) => proveedor(id)?.modelos ?? [];
export const modeloInicial = (id) => proveedor(id)?.inicial ?? '';
export const nombreModelo = (prov, id) => modelosDe(prov).find((m) => m.id === id)?.nombre ?? id;
/** Con qué habla un agente, para mostrar: «Claude Opus 5.5», «Venice · Grok 4.7». */
export function modeloDe(a) {
  const nombre = nombreModelo(a.proveedor, a.modelo);
  return a.proveedor === PROVEEDOR_INICIAL ? nombre : `${nombreProveedor(a.proveedor)} · ${nombre}`;
}

// ---------- Agentes ----------
export const listaAgentes = () => agentes.get().lista;
export const agente = (id) => listaAgentes().find((a) => a.id === id) ?? null;
export const agenteActual = () => agente(ui.get().agente) ?? listaAgentes()[0];

export function crearAgente({ nombre, proveedor: prov, modelo, instrucciones }) {
  const nuevo = { id: nuevoId(), nombre: nombre.trim(), proveedor: prov, modelo, instrucciones: instrucciones.trim(), creado: Date.now() };
  agentes.update((v) => { v.lista.push(nuevo); return v; });
  avisar('agentes');
  return nuevo;
}

export function editarAgente(id, { nombre, proveedor: prov, modelo, instrucciones }) {
  agentes.update((v) => {
    const a = v.lista.find((x) => x.id === id);
    if (a) Object.assign(a, { nombre: nombre.trim(), proveedor: prov, modelo, instrucciones: instrucciones.trim() });
    return v;
  });
  avisar('agentes');
}

/** Borra un agente con todos sus chats. El último no se borra. */
export async function borrarAgente(id) {
  if (listaAgentes().length <= 1 || !agente(id)) return false;
  const suyos = chats.get().lista.filter((c) => c.agente === id);
  for (const c of suyos) soltarChat(c.id);
  chats.update((v) => { v.lista = v.lista.filter((c) => c.agente !== id); return v; });
  agentes.update((v) => { v.lista = v.lista.filter((a) => a.id !== id); return v; });
  ui.update((v) => {
    if (v.agente === id) v.agente = null;
    delete v.chats[id];
    return v;
  });
  avisar('agentes');
  avisar('chats');
  avisar('seleccion');
  await Promise.all(suyos.map((c) => removeDoc(`chat-${c.id}`)));
  return true;
}

export function elegirAgente(id) {
  if (!agente(id) || agenteActual().id === id) return;
  ui.patch({ agente: id });
  avisar('seleccion');
}

// ---------- Chats ----------
export const chat = (id) => chats.get().lista.find((c) => c.id === id) ?? null;
/** Los chats de un agente, el último que se tocó primero. */
export const chatsDe = (agenteId) => chats.get().lista.filter((c) => c.agente === agenteId).sort((a, b) => b.tocado - a.tocado);
export function chatActual() {
  const a = agenteActual();
  const c = chat(ui.get().chats[a.id]);
  return c && c.agente === a.id ? c : null;
}

export function crearChat(agenteId) {
  const ahora = Date.now();
  const nuevo = { id: nuevoId(), agente: agenteId, titulo: 'Chat nuevo', auto: true, cuenta: 0, creado: ahora, tocado: ahora };
  chats.update((v) => { v.lista.push(nuevo); return v; });
  avisar('chats');
  elegirChat(nuevo.id);
  return nuevo;
}

export function elegirChat(id) {
  const c = chat(id);
  if (!c) return;
  const v = ui.get();
  if (v.agente === c.agente && v.chats[c.agente] === id) return;
  ui.update((u) => { u.agente = c.agente; u.chats[c.agente] = id; return u; });
  avisar('seleccion');
}

export function renombrarChat(id, titulo) {
  const limpio = titulo.trim();
  if (!limpio || !chat(id)) return;
  chats.update((v) => { Object.assign(v.lista.find((c) => c.id === id), { titulo: limpio, auto: false }); return v; });
  avisar('chats');
}

// Deja de escuchar la respuesta que estuviera llegando y la frena.
function soltarChat(id) {
  const r = respuestas.get(id);
  if (r) {
    window.rad.invoke('chat:frenar', r.pedido);
    porPedido.delete(r.pedido);
    respuestas.delete(id);
  }
  hilos.delete(id);
}

export async function borrarChat(id) {
  const c = chat(id);
  if (!c) return;
  soltarChat(id);
  chats.update((v) => { v.lista = v.lista.filter((x) => x.id !== id); return v; });
  // Si era el que estaba abierto, pasa a estarlo el más reciente que quede.
  ui.update((v) => {
    if (v.chats[c.agente] !== id) return v;
    const otro = chatsDe(c.agente)[0];
    if (otro) v.chats[c.agente] = otro.id;
    else delete v.chats[c.agente];
    return v;
  });
  avisar('chats');
  avisar('seleccion');
  avisar('respuesta', { chat: id });
  await removeDoc(`chat-${id}`);
}

// ---------- Mensajes ----------
/** El documento de un chat. Lo que quedó «escribiendo» de una sesión
    anterior se marca como cortado: esa respuesta ya no va a llegar. */
export function hilo(chatId) {
  if (!hilos.has(chatId)) {
    hilos.set(chatId, openDoc(`chat-${chatId}`, { mensajes: [] }).then((doc) => {
      const v = doc.get();
      let tocado = false;
      for (const m of v.mensajes) {
        if (m.estado === 'escribiendo') { m.estado = 'cortado'; tocado = true; }
      }
      if (tocado) doc.set(v);
      return doc;
    }));
  }
  return hilos.get(chatId);
}

export const respondiendo = (chatId) => respuestas.has(chatId);
export const pensando = (chatId) => respuestas.get(chatId)?.pensando ?? false;
export const algunoRespondiendo = () => respuestas.size > 0;

const titular = (texto) => {
  const linea = texto.split('\n').find((l) => l.trim())?.trim().replace(/\s+/g, ' ') ?? 'Chat nuevo';
  return linea.length > TITULO_MAX ? `${linea.slice(0, TITULO_MAX).trimEnd()}…` : linea;
};

// Lo que vuelve a viajar al modelo: lo que tiene texto y no fue un error ni
// una respuesta que el modelo declinó (esa se descarta entera).
const viaja = (m) => m.texto.trim() && m.estado !== 'error' && m.estado !== 'rechazo';

/** Manda un mensaje y abre la respuesta. Devuelve si lo mandó. */
export async function enviar(chatId, texto) {
  const limpio = texto.trim();
  const c = chat(chatId);
  if (!c || !limpio || respuestas.has(chatId)) return false;
  const a = agente(c.agente);
  const doc = await hilo(chatId);
  if (respuestas.has(chatId) || !chat(chatId)) return false;

  // Se cambia el valor vivo del documento (no una copia): la respuesta se va
  // escribiendo sobre este mismo objeto mientras llega.
  const valor = doc.get();
  const mio = { id: nuevoId(), rol: 'user', texto: limpio };
  const suyo = { id: nuevoId(), rol: 'assistant', texto: '', estado: 'escribiendo', modelo: a.modelo };
  const historial = [...valor.mensajes.filter(viaja), mio].map(({ rol, texto: t }) => ({ rol, texto: t }));
  const primero = valor.mensajes.length === 0;
  valor.mensajes.push(mio, suyo);
  doc.set(valor);

  chats.update((v) => {
    const x = v.lista.find((y) => y.id === chatId);
    x.tocado = Date.now();
    x.cuenta = valor.mensajes.length;
    if (x.auto && primero) x.titulo = titular(limpio);
    return v;
  });

  const pedido = nuevoId();
  respuestas.set(chatId, { pedido, mensaje: suyo, doc, pensando: false, guardado: Date.now() });
  porPedido.set(pedido, chatId);
  avisar('chats');
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });

  try {
    await window.rad.invoke('chat:enviar', { id: pedido, proveedor: a.proveedor, modelo: a.modelo, instrucciones: a.instrucciones, mensajes: historial });
  } catch {
    terminar(chatId, 'error', 'No se pudo mandar el pedido.');
  }
  return true;
}

export function frenar(chatId) {
  const r = respuestas.get(chatId);
  if (r) window.rad.invoke('chat:frenar', r.pedido);
}

const ESTADO = { fin: 'ok', frenado: 'frenado', largo: 'largo', rechazo: 'rechazo' };

function alLlegar(ev) {
  const chatId = porPedido.get(ev.id);
  const r = chatId && respuestas.get(chatId);
  if (!r || r.pedido !== ev.id) return;
  if (ev.tipo === 'pensando') {
    r.pensando = true;
    avisar('respuesta', { chat: chatId });
  } else if (ev.tipo === 'texto') {
    const antes = r.pensando;
    r.pensando = false;
    r.mensaje.texto += ev.texto;
    if (antes) avisar('respuesta', { chat: chatId });
    avisar('texto', { chat: chatId, mensaje: r.mensaje });
    // Cada tanto baja al disco: si la app se cierra, queda lo que había llegado.
    if (Date.now() - r.guardado > GUARDAR_CADA_MS) {
      r.guardado = Date.now();
      r.doc.set(r.doc.get());
    }
  } else if (ev.tipo === 'fin') {
    terminar(chatId, ESTADO[ev.motivo] ?? 'ok');
  } else if (ev.tipo === 'error') {
    terminar(chatId, 'error', ev.mensaje);
  }
}

function terminar(chatId, estado, nota) {
  const r = respuestas.get(chatId);
  if (!r) return;
  r.mensaje.estado = estado;
  if (nota) r.mensaje.nota = nota;
  r.doc.set(r.doc.get());
  porPedido.delete(r.pedido);
  respuestas.delete(chatId);
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });
}
