// Los datos de Nix: agentes, chats y mensajes, y el ida y vuelta con el
// modelo. Las vistas no tocan el store ni el puente: piden acá y escuchan.
//
// Qué se guarda (con el store del núcleo):
//   agentes     { lista: [{ id, nombre, proveedor, modelo, instrucciones, creado }] }
//   chats       { lista: [{ id, agente, titulo, auto, cuenta, creado, tocado }] }
//   chat-<id>   { mensajes: [{ id, rol, texto, estado?, nota?, modelo?, tools?, agotado? }] }
//               y, entre los mensajes, las filas de tools: { id, rol: 'tool', tool,
//               texto (qué tocó), estado, ms?, salida?, cortada?, imagenes? }
//   ui          { agente, chats: { <agente>: <chat> } }   lo último que se miraba
// Un documento por chat: abrir la app no lee todas las conversaciones, y
// guardar un mensaje no reescribe las demás.
//
// estado de un mensaje del agente: 'escribiendo' (está llegando), 'ok',
// 'frenado', 'cortado' (la app se cerró a mitad), 'largo', 'rechazo', 'error'.
// estado de una fila de tool: 'run' (corriendo), 'ok', 'error', 'declined'
// (el usuario dijo que no), 'aborted' (Stop) o 'blocked' (la app la cortó por
// repetirse en bucle).
//
// Un turno con tools queda como una tira: lo que el agente escribió antes de
// llamar, las filas de las tools, y lo que escribió después. Cada tramo de
// texto es su propio mensaje; el último lleva `tools`, el resumen de lo que
// corrió en el turno entero (de ahí sale el contador que se ve debajo).

import { openDoc, removeDoc } from '/@core/store.js';

const nuevoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const GUARDAR_CADA_MS = 1500;
const TITULO_MAX = 46;
const TITULO_NUEVO = 'New chat';

let agentes;
let chats;
let ui;
let catalogo = { proveedores: [] }; // los proveedores con sus modelos
let herramientas = { grupos: [], carpeta: '' }; // las tools que hay, por grupo
const hilos = new Map();      // id del chat -> promesa de su documento
const respuestas = new Map(); // id del chat -> { pedido, mensaje, doc, pensando, guardado }
const porPedido = new Map();  // id del pedido -> id del chat

// ---------- Avisos ----------
// 'agentes', 'chats', 'seleccion', 'modelos' (cambió la lista de un
// proveedor), 'mensajes' { chat }, 'texto' { chat, mensaje } (llegó un pedazo),
// 'respuesta' { chat } (empezó, piensa o terminó), 'confirmar' { chat } (una
// tool pide permiso, o dejó de pedirlo) y 'ajustes'.
const oyentes = new Map();
export function on(tipo, fn) {
  if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
  oyentes.get(tipo).add(fn);
  return () => oyentes.get(tipo).delete(fn);
}
const avisar = (tipo, detalle = {}) => { for (const fn of oyentes.get(tipo) ?? []) fn(detalle); };

// ---------- Arranque ----------
export async function abrir() {
  [agentes, chats, ui, catalogo, herramientas] = await Promise.all([
    openDoc('agentes', { lista: [] }),
    openDoc('chats', { lista: [] }),
    openDoc('ui', { agente: null, chats: {} }),
    window.rad.invoke('chat:modelos'),
    window.rad.invoke('chat:tools'),
  ]);
  // Hasta la 0.1.1 la interfaz estaba en castellano: un chat todavía sin
  // nombre propio se había guardado como «Chat nuevo».
  if (chats.get().lista.some((c) => c.auto && c.titulo === 'Chat nuevo')) {
    chats.update((v) => { for (const c of v.lista) if (c.auto && c.titulo === 'Chat nuevo') c.titulo = TITULO_NUEVO; return v; });
  }
  // La primera vez hay un agente para empezar a escribir sin armar nada.
  if (!agentes.get().lista.length) crearAgente({ nombre: 'Nix', proveedor: PROVEEDOR_INICIAL, modelo: modeloInicial(PROVEEDOR_INICIAL), instrucciones: '' });
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

// ---------- Tools ----------
/** Los grupos de tools que se le pueden prender a un agente: [{ id, nombre, tools }]. */
export const gruposTools = () => herramientas.grupos;
/** ¿El modelo acepta tools? Los de Anthropic, todos; los de Venice lo dice su lista. */
export const modeloConTools = (prov, id) => modelosDe(prov).find((m) => m.id === id)?.tools !== false;
/** Las tools que un agente tiene prendidas (nombres). */
export const toolsDe = (a) => (Array.isArray(a?.tools) ? a.tools : []);
/** Los grupos que un agente tiene prendidos enteros o en parte, por nombre. */
export const gruposDe = (a) => herramientas.grupos.filter((g) => g.tools.some((t) => toolsDe(a).includes(t))).map((g) => g.nombre);
/** 'manual' pregunta antes de cada llamada; 'auto' no pregunta nunca. */
export const modoTools = () => (ui.get().modoTools === 'auto' ? 'auto' : 'manual');
export function ponerModoTools(modo) {
  ui.patch({ modoTools: modo === 'auto' ? 'auto' : 'manual' });
  avisar('ajustes');
}

// ---------- Agentes ----------
export const listaAgentes = () => agentes.get().lista;
export const agente = (id) => listaAgentes().find((a) => a.id === id) ?? null;
export const agenteActual = () => agente(ui.get().agente) ?? listaAgentes()[0];

export function crearAgente({ nombre, proveedor: prov, modelo, instrucciones, tools = [] }) {
  const nuevo = { id: nuevoId(), nombre: nombre.trim(), proveedor: prov, modelo, instrucciones: instrucciones.trim(), tools: [...tools], creado: Date.now() };
  agentes.update((v) => { v.lista.push(nuevo); return v; });
  avisar('agentes');
  return nuevo;
}

export function editarAgente(id, { nombre, proveedor: prov, modelo, instrucciones, tools }) {
  agentes.update((v) => {
    const a = v.lista.find((x) => x.id === id);
    if (a) Object.assign(a, { nombre: nombre.trim(), proveedor: prov, modelo, instrucciones: instrucciones.trim(), ...(tools ? { tools: [...tools] } : {}) });
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
  const nuevo = { id: nuevoId(), agente: agenteId, titulo: TITULO_NUEVO, auto: true, cuenta: 0, creado: ahora, tocado: ahora };
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
        // una tool que quedó «corriendo»: la app se cerró y no se sabe cómo terminó
        if (m.rol === 'tool' && m.estado === 'run') { m.estado = 'aborted'; tocado = true; }
      }
      if (tocado) doc.set(v);
      return doc;
    }));
  }
  return hilos.get(chatId);
}

export const respondiendo = (chatId) => respuestas.has(chatId);
/** La tool que está pidiendo permiso en ese chat, o null: { callId, name, label, args, vista }. */
export const confirmacion = (chatId) => respuestas.get(chatId)?.confirmacion ?? null;
/** La respuesta a la tarjeta. `confiar`: no preguntar más en este chat. */
export function confirmar(chatId, permitir, confiar = false) {
  const r = respuestas.get(chatId);
  if (!r?.confirmacion) return;
  const { callId } = r.confirmacion;
  r.confirmacion = null;
  window.rad.invoke('chat:confirmar', { callId, permitir: permitir === true, confiar: confiar === true, chat: chatId });
  avisar('confirmar', { chat: chatId });
}
export const pensando = (chatId) => respuestas.get(chatId)?.pensando ?? false;
export const algunoRespondiendo = () => respuestas.size > 0;

const titular = (texto) => {
  const linea = texto.split('\n').find((l) => l.trim())?.trim().replace(/\s+/g, ' ') ?? TITULO_NUEVO;
  return linea.length > TITULO_MAX ? `${linea.slice(0, TITULO_MAX).trimEnd()}…` : linea;
};

// Lo que vuelve a viajar al modelo: lo que tiene texto y no fue un error ni
// una respuesta que el modelo declinó (esa se descarta entera), y las filas
// de tools, que el proceso principal pliega en el registro de cada turno.
const viaja = (m) => (m.rol === 'tool' ? m.estado !== 'run' : m.texto.trim() && m.estado !== 'error' && m.estado !== 'rechazo');
const alViaje = (m) => (m.rol === 'tool' ? { rol: 'tool', tool: m.tool, texto: m.texto, estado: m.estado } : { rol: m.rol, texto: m.texto });

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
  const historial = [...valor.mensajes.filter(viaja), mio].map(alViaje);
  // Las tools del agente, si su modelo las acepta.
  const tools = modeloConTools(a.proveedor, a.modelo) ? toolsDe(a) : [];
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
    await window.rad.invoke('chat:enviar', {
      id: pedido, chat: chatId, proveedor: a.proveedor, modelo: a.modelo, instrucciones: a.instrucciones, mensajes: historial,
      tools, modo: modoTools(),
    });
  } catch {
    terminar(chatId, 'error', 'The request could not be sent.');
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
  } else if (ev.tipo === 'tool') {
    alPedirTool(chatId, r, ev);
  } else if (ev.tipo === 'tool-fin') {
    const fila = r.doc.get().mensajes.find((m) => m.rol === 'tool' && m.id === ev.callId);
    if (fila) Object.assign(fila, { estado: ev.status, ms: ev.ms, salida: ev.out ?? '', cortada: ev.outCut === true });
    r.doc.set(r.doc.get());
    avisar('mensajes', { chat: chatId });
  } else if (ev.tipo === 'tool-imagenes') {
    const fila = r.doc.get().mensajes.find((m) => m.rol === 'tool' && m.id === ev.callId);
    if (fila && Array.isArray(ev.imagenes)) fila.imagenes = ev.imagenes.map(({ name, dataUrl }) => ({ name, dataUrl }));
    r.doc.set(r.doc.get());
    avisar('mensajes', { chat: chatId });
  } else if (ev.tipo === 'confirmar') {
    r.confirmacion = { callId: ev.callId, name: ev.name, label: ev.label, args: ev.args ?? {}, vista: ev.vista ?? null };
    avisar('confirmar', { chat: chatId });
  } else if (ev.tipo === 'fin') {
    terminar(chatId, ESTADO[ev.motivo] ?? 'ok', null, ev);
  } else if (ev.tipo === 'error') {
    terminar(chatId, 'error', ev.mensaje, ev);
  }
}

// Se pidió una tool: su fila entra a la conversación, en el lugar donde pasó.
// Si el agente ya había escrito algo en esta ronda, ese texto queda como un
// mensaje terminado, la fila va después y se abre otro mensaje para lo que
// escriba a continuación. Si no escribió nada, la fila va antes del mensaje
// que todavía está esperando texto.
function alPedirTool(chatId, r, ev) {
  const lista = r.doc.get().mensajes;
  const existente = lista.find((m) => m.rol === 'tool' && m.id === ev.callId);
  if (existente) {
    existente.texto = ev.label ?? existente.texto;
  } else {
    const fila = { id: ev.callId, rol: 'tool', tool: ev.kind, texto: ev.label ?? '', estado: 'run' };
    const i = lista.indexOf(r.mensaje);
    if (r.mensaje.texto.trim()) {
      r.mensaje.estado = 'ok';
      r.mensaje = { id: nuevoId(), rol: 'assistant', texto: '', estado: 'escribiendo', modelo: r.mensaje.modelo };
      lista.push(fila, r.mensaje);
    } else {
      lista.splice(i < 0 ? lista.length : i, 0, fila);
    }
  }
  r.pensando = false;
  r.doc.set(r.doc.get());
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });
}

function terminar(chatId, estado, nota, ev = null) {
  const r = respuestas.get(chatId);
  if (!r) return;
  r.mensaje.estado = estado;
  if (nota) r.mensaje.nota = nota;
  // Lo que corrió en el turno: de acá sale el contador de debajo de la
  // respuesta. Solo si el turno tenía tools (si no, no hay nada que contar).
  if (Array.isArray(ev?.tools)) {
    r.mensaje.tools = ev.tools.map(({ name, status }) => ({ name, status }));
    if (ev.agotado) r.mensaje.agotado = true;
  }
  // Una tool que quedó «corriendo» cuando el turno terminó (un error del
  // proveedor a mitad de camino): no terminó.
  for (const m of r.doc.get().mensajes) if (m.rol === 'tool' && m.estado === 'run') m.estado = 'aborted';
  const habiaTarjeta = Boolean(r.confirmacion);
  r.confirmacion = null;
  r.doc.set(r.doc.get());
  porPedido.delete(r.pedido);
  respuestas.delete(chatId);
  chats.update((v) => { const x = v.lista.find((y) => y.id === chatId); if (x) x.cuenta = r.doc.get().mensajes.length; return v; });
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });
  if (habiaTarjeta) avisar('confirmar', { chat: chatId });
}
