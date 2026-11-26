// El celular (BlackCode Mobile), del lado de la interfaz.
//
// El puente HTTP vive en el proceso principal (main/movil.cjs), pero los chats y
// los turnos son de la interfaz (datos.js): así que cada pedido del celu llega
// acá (`movil:pedido`) y se contesta con el estado VIVO, el mismo que ve la
// ventana, también el de una respuesta que se está escribiendo. Es el camino que
// ya usa la voz del Atom Echo: lo del celu entra al chat como si se tipeara acá.
//
// Y al revés: lo que pasa en los chats (texto que llega, tools, permisos, fin de
// turno) se le manda al principal para los celus conectados, solo cuando hay
// alguno. El texto viaja como pedazos con su posición (`desde`), no entero cada
// vez: si al celu no le cierra la posición, vuelve a pedir el chat.
//
// Las imágenes nunca viajan adentro de un chat: van como referencia, y las
// bytes salen por /api/image/<chat>/<mensaje>/<n>.

import * as datos from './datos.js';

const POR_PAGINA = 80;
const ARGS_MAX = 600; // lo que se muestra de lo que pide una tool en la tarjeta de permiso

let clientes = 0;

class Fallo extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const refs = (chatId, m, cuantas) => Array.from({ length: cuantas }, (_, n) => `/api/image/${encodeURIComponent(chatId)}/${encodeURIComponent(m.id)}/${n}`);

/** Un mensaje como viaja al celu. */
function alCelu(chatId, m) {
  const imagenes = Array.isArray(m.imagenes) ? refs(chatId, m, m.imagenes.length) : [];
  if (m.rol === 'tool') {
    return { id: m.id, rol: 'tool', tool: m.tool, texto: m.texto ?? '', estado: m.estado, ms: m.ms ?? null, sub: Boolean(m.sub), imagenes };
  }
  if (m.rol === 'user') {
    return { id: m.id, rol: 'user', texto: m.texto, t: m.t ?? null, voz: m.voz === true, imagenes, archivos: (m.archivos ?? []).map((a) => a.name) };
  }
  return { id: m.id, rol: 'assistant', texto: m.texto, estado: m.estado ?? 'ok', nota: m.nota ?? '', t: m.t ?? null, tools: Array.isArray(m.tools) ? m.tools.length : 0 };
}

function tarjeta(chatId) {
  const c = datos.confirmacion(chatId);
  if (!c) return null;
  let args = '';
  try { args = JSON.stringify(c.args ?? {}, null, 1); } catch { /* algo circular: no se muestra */ }
  return { callId: c.callId, name: c.name, label: c.label ?? '', args: args.length > ARGS_MAX ? `${args.slice(0, ARGS_MAX)}…` : args, sub: c.sub ?? null };
}

const nombreDe = (id) => datos.agente(id)?.nombre ?? '';

const PEDIDOS = {
  estado() {
    const agentes = datos.listaAgentes();
    return {
      usuario: datos.nombreUsuario(),
      agentes: agentes.map((a) => ({ id: a.id, nombre: a.nombre, proveedor: a.proveedor, modelo: datos.nombreModelo(a.proveedor, a.modelo), ve: datos.modeloVe(a.proveedor, a.modelo) })),
      chats: agentes.flatMap((a) => datos.chatsDe(a.id)).sort((x, y) => y.tocado - x.tocado).map((c) => ({
        id: c.id, agente: c.agente, titulo: c.titulo, fijado: c.fijado === true, canal: c.voz === true, tocado: c.tocado, cuenta: c.cuenta ?? 0, respondiendo: datos.respondiendo(c.id),
      })),
    };
  },

  async chat({ chat: id, antes }) {
    const c = datos.chat(id);
    if (!c) throw new Fallo(404, 'That chat does not exist anymore.');
    const todos = (await datos.hilo(id)).get().mensajes;
    const hasta = Number.isInteger(Number(antes)) && antes !== null && antes !== '' ? Math.max(0, Math.min(todos.length, Number(antes))) : todos.length;
    const desde = Math.max(0, hasta - POR_PAGINA);
    return {
      chat: { id: c.id, agente: c.agente, agenteNombre: nombreDe(c.agente), titulo: c.titulo, canal: c.voz === true },
      total: todos.length,
      desde,
      mensajes: todos.slice(desde, hasta).map((m) => alCelu(id, m)),
      respondiendo: datos.respondiendo(id),
      pensando: datos.pensando(id),
      confirmacion: tarjeta(id),
    };
  },

  crear({ agente }) {
    if (!datos.agente(agente)) throw new Fallo(404, 'That agent does not exist.');
    return { id: datos.crearChat(agente, { elegir: false }).id };
  },

  async enviar({ chat: id, texto, imagenes }) {
    const c = datos.chat(id);
    if (!c) throw new Fallo(404, 'That chat does not exist anymore.');
    if (datos.respondiendo(id)) throw new Fallo(409, `${nombreDe(c.agente)} is still answering in this chat.`);
    const a = datos.agente(c.agente);
    if (imagenes?.length && !datos.modeloVe(a.proveedor, a.modelo)) throw new Fallo(400, `${a.nombre}'s model cannot see images.`);
    const ok = await datos.enviar(id, texto ?? '', imagenes?.length ? { imagenes, archivos: [] } : null);
    if (!ok) throw new Fallo(409, 'The message could not be sent.');
    return { ok: true };
  },

  frenar({ chat: id }) { datos.frenar(id); return { ok: true }; },

  confirmar({ chat: id, permitir, confiar }) {
    if (!datos.confirmacion(id)) throw new Fallo(409, 'Nothing is waiting for permission in this chat.');
    datos.confirmar(id, permitir === true, confiar === true);
    return { ok: true };
  },

  async imagen({ chat: id, msg, n }) {
    if (!datos.chat(id)) throw new Fallo(404, 'no such chat');
    const m = (await datos.hilo(id)).get().mensajes.find((x) => x.id === msg);
    const im = m?.imagenes?.[n];
    if (typeof im === 'string') return { dataUrl: im };
    if (im?.dataUrl) return { dataUrl: im.dataUrl };
    if (im?.archivo) return { archivo: im.archivo };
    throw new Fallo(404, 'no such image');
  },
};

/** Contesta un pedido del puente: { ok, datos } o { ok: false, status, error }.
 *  (Exportado para el humo, que lo prueba sin un celu.) */
export async function atender(p) {
  const fn = PEDIDOS[p?.que];
  try {
    if (!fn) throw new Fallo(400, `unknown request: ${p?.que}`);
    return { ok: true, datos: await fn(p) };
  } catch (err) {
    return { ok: false, status: err?.status ?? 500, error: String(err?.message ?? err) };
  }
}
window.rad.on('movil:pedido', async (p) => {
  window.rad.invoke('movil:respuesta', { id: p?.id, ...(await atender(p)) });
});

// ---------- Lo que pasa en los chats, para los celus ----------
const mandar = (ev) => { if (clientes > 0) window.rad.invoke('movil:evento', ev).catch(() => {}); };

// El texto que llega, juntado en tandas cortas: un evento por pedacito de
// texto serían cientos por respuesta. Se recuerda hasta dónde se mandó cada
// mensaje y se manda lo que falta.
const enviado = new Map(); // id del mensaje -> { chat, n: cuántos caracteres ya salieron }
const porMandar = new Map(); // id del mensaje -> { chat, mensaje }
let tanda = null;
function soltarTexto() {
  clearTimeout(tanda);
  tanda = null;
  for (const [id, { chat, mensaje }] of porMandar) {
    const desde = enviado.get(id)?.n ?? 0;
    if (mensaje.texto.length > desde) mandar({ tipo: 'texto', chat, id, desde, texto: mensaje.texto.slice(desde) });
    enviado.set(id, { chat, n: mensaje.texto.length });
  }
  porMandar.clear();
}

let chatsPendiente = null;
datos.on('chats', () => { clearTimeout(chatsPendiente); chatsPendiente = setTimeout(() => mandar({ tipo: 'chats' }), 250); });
datos.on('mensajes', ({ chat } = {}) => { if (chat) { soltarTexto(); mandar({ tipo: 'mensajes', chat }); } });
datos.on('respuesta', ({ chat } = {}) => { if (chat) mandar({ tipo: 'respuesta', chat, respondiendo: datos.respondiendo(chat), pensando: datos.pensando(chat) }); });
datos.on('texto', ({ chat, mensaje } = {}) => {
  if (!chat || !mensaje || clientes === 0) return;
  porMandar.set(mensaje.id, { chat, mensaje });
  tanda ??= setTimeout(soltarTexto, 70);
});
datos.on('confirmar', ({ chat } = {}) => { if (chat) mandar({ tipo: 'confirmar', chat, confirmacion: tarjeta(chat) }); });
datos.on('turno', ({ chat, estado, texto } = {}) => {
  if (!chat) return;
  soltarTexto();
  const c = datos.chat(chat);
  mandar({ tipo: 'turno', chat, estado, titulo: c?.titulo ?? '', agente: nombreDe(c?.agente), resumen: String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) });
  // los mensajes de ese chat ya no van a crecer
  for (const [id, e] of enviado) if (e.chat === chat) enviado.delete(id);
});

export async function montarMovil() {
  window.rad.on('movil:clientes', (n) => { clientes = Number(n) || 0; });
  clientes = Number(await window.rad.invoke('movil:clientes').catch(() => 0)) || 0;
}
