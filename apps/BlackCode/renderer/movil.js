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
      agentes: agentes.map((a) => ({
        id: a.id, nombre: a.nombre, proveedor: a.proveedor, modelo: datos.nombreModelo(a.proveedor, a.modelo), ve: datos.modeloVe(a.proveedor, a.modelo),
        // (para la lista de Agents del celu: con qué habla y qué grupos de tools usa de verdad)
        conQue: datos.modeloDe(a), grupos: datos.modeloConTools(a.proveedor, a.modelo) ? datos.gruposDe(a) : [],
      })),
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

  /** Borra un chat (1.13.3, pedido de Fran: en el celu no había cómo). Lo mismo que el tacho de la PC. */
  async borrar({ chat: id }) {
    if (!datos.chat(id)) throw new Fallo(404, 'That chat does not exist anymore.');
    await datos.borrarChat(id);
    return { ok: true };
  },

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

  // ---------- Los canvas (en el celu, solo para leer) ----------
  // Los de un agente: los suyos y los huérfanos de antes sin dueño conocido,
  // que son de todos (Fran, 1.8.2). Los de la papelera no.
  async canvases({ agente }) {
    if (!datos.agente(agente)) throw new Fallo(404, 'That agent does not exist.');
    const todos = await window.rad.invoke('canvas:todos');
    return (Array.isArray(todos) ? todos : [])
      .filter((c) => !c.trashed && deEseAgente(c, agente))
      .map((c) => ({ id: c.id, titulo: c.title, tipo: c.kind, lenguaje: c.language ?? null, version: c.version, tocado: fechaDe(c.updated_at), chat: c.conversationTitle ?? null }));
  },
  async canvas({ canvas: id, agente }) {
    const c = await window.rad.invoke('canvas:abrir', String(id ?? ''));
    if (!c || !deEseAgente(c, agente)) throw new Fallo(404, 'That canvas does not exist anymore.');
    return { id: c.id, titulo: c.title, tipo: c.kind, lenguaje: c.language ?? null, version: c.version, tocado: fechaDe(c.updated_at), contenido: c.content ?? '' };
  },

  // ---------- Las tareas programadas y su bandeja ----------
  // Las de todos los agentes, como la pestaña Tasks. De cada resultado va el
  // principio: el texto entero sale por `resultado`, que además lo marca leído.
  async tareas() {
    const e = await window.rad.invoke('tareas:leer');
    return {
      corriendo: e.corriendo ?? null,
      sinLeer: e.sinLeer ?? 0,
      tareas: (e.tareas ?? []).map((t) => ({ id: t.id, titulo: t.titulo, agente: nombreDe(t.agente) || 'Deleted agent', cuando: t.cuando, activa: t.activa === true, actua: t.actuar === true, proxima: t.proxima ?? null, ultima: t.ultima ?? null, corriendo: t.corriendo === true })),
      resultados: (e.resultados ?? []).map((r) => ({ id: r.id, titulo: r.titulo, agente: r.agenteNombre || nombreDe(r.agente), ts: r.ts, leida: r.leida === true, error: Boolean(r.error), resumen: limpio(r.error ? `Failed: ${r.error}` : r.salida).slice(0, 240) })),
    };
  },
  async resultado({ resultado: id }) {
    const r = ((await window.rad.invoke('tareas:leer')).resultados ?? []).find((x) => x.id === id);
    if (!r) throw new Fallo(404, 'That result is not in the tray anymore.');
    if (!r.leida) await window.rad.invoke('tareas:leida', r.id);
    return { id: r.id, titulo: r.titulo, agente: r.agenteNombre || nombreDe(r.agente), ts: r.ts, ms: r.ms ?? null, salida: r.salida ?? '', error: r.error ?? null, cortada: r.cortada ?? null, pasos: (r.pasos ?? []).map((x) => ({ name: x.name, label: x.label ?? '', status: x.status })) };
  },
  async tareaActivar({ tarea: id, activa }) {
    const r = await window.rad.invoke('tareas:activar', { id, activa: activa === true });
    if (r && r.ok === false) throw new Fallo(400, r.error ?? 'Could not change the task.');
    return { ok: true };
  },
  async tareaCorrer({ tarea: id }) {
    const r = await window.rad.invoke('tareas:correr', id);
    if (!r?.ok) throw new Fallo(409, r?.error ?? 'The task could not start.');
    return { ok: true };
  },

  // ---------- Las notas (1.14.0) ----------
  // Las del usuario, las mismas de la vista Notes: leer, escribir, fijar,
  // mover a una carpeta que ya existe y borrar (para siempre, como el tacho de
  // la PC). Las carpetas se crean, renombran y borran en la PC (Fran). Van los
  // mismos canales que usa la vista, y después de cada cambio se avisa (ver
  // notasTocadas): la vista de la PC se pone al día y los celus vuelven a pedir.
  async notas() {
    const [n, c] = await Promise.all([window.rad.invoke('notas:lista'), window.rad.invoke('notas:carpetas')]);
    return {
      notas: (Array.isArray(n) ? n : []).map((x) => ({ id: x.id, contenido: x.content ?? '', carpeta: x.folder_id ?? null, fijada: Boolean(x.pinned), tocada: fechaDe(x.updated_at) })),
      carpetas: (Array.isArray(c) ? c : []).map((x) => ({ id: x.id, nombre: x.name })),
    };
  },
  async notaCrear({ contenido, carpeta }) {
    const texto = textoDeNota(contenido);
    const folderId = await carpetaQueExiste(carpeta);
    const fila = await window.rad.invoke('notas:crear', { content: texto, folderId });
    if (!fila?.id) throw new Fallo(500, 'The note could not be saved.');
    notasTocadas();
    return { id: fila.id };
  },
  async notaGuardar({ nota, contenido }) {
    const texto = textoDeNota(contenido);
    await notaQueExiste(nota);
    if (!(await window.rad.invoke('notas:guardar', { id: nota, content: texto }))) throw new Fallo(500, 'The note could not be saved.');
    notasTocadas();
    return { ok: true };
  },
  async notaFijar({ nota, fijada }) {
    await notaQueExiste(nota);
    if (!(await window.rad.invoke('notas:fijar', { id: nota, pinned: fijada === true }))) throw new Fallo(500, 'Could not pin the note.');
    notasTocadas();
    return { ok: true };
  },
  async notaMover({ nota, carpeta }) {
    await notaQueExiste(nota);
    const folderId = await carpetaQueExiste(carpeta);
    if (!(await window.rad.invoke('notas:mover', { id: nota, folderId }))) throw new Fallo(500, 'Could not move the note.');
    notasTocadas();
    return { ok: true };
  },
  async notaBorrar({ nota }) {
    await notaQueExiste(nota);
    if (!(await window.rad.invoke('notas:borrar', nota))) throw new Fallo(500, 'Could not delete the note.');
    notasTocadas();
    return { ok: true };
  },

  // ---------- Los agentes (1.19.0) ----------
  // Fran: «que sea el lugar donde pueda modificar a mis agentes… si estoy
  // lejos de la UCX igual pueda cambiarles el modelo, ajustar qué tools usan,
  // modificar el system prompt… e incluso crear un agente nuevo». Lo mismo que
  // el formulario de la PC (agentes.js), con las mismas funciones de datos.js:
  // el que guarda es la interfaz, y la vista Agents de la PC se pone al día sola.
  /** Lo que hace falta para el formulario: proveedores con sus modelos y los grupos de tools. */
  agentesCatalogo() {
    return {
      inicial: datos.PROVEEDOR_INICIAL,
      proveedores: datos.proveedores().map((p) => ({
        id: p.id, nombre: p.nombre, inicial: p.inicial ?? '',
        modelos: (p.modelos ?? []).map((m) => ({ id: m.id, nombre: m.nombre, nota: m.nota ?? '', tools: datos.modeloConTools(p.id, m.id), ve: datos.modeloVe(p.id, m.id) })),
      })),
      grupos: datos.gruposTools().map((g) => ({ id: g.id, nombre: g.nombre, tools: g.tools, opcional: g.opcional === true, detalle: g.mcp ? datos.detalleMcp(g) : g.tools.join(', ') })),
      // (un agente nuevo nace con estas prendidas, como en la PC)
      nuevas: datos.todasLasTools(),
    };
  },
  agente({ agente: id }) {
    const a = datos.agente(id);
    if (!a) throw new Fallo(404, 'That agent does not exist anymore.');
    const lista = datos.listaAgentes();
    const lugar = lista.findIndex((x) => x.id === id);
    return {
      id: a.id, nombre: a.nombre, proveedor: a.proveedor, modelo: a.modelo, instrucciones: a.instrucciones ?? '', tools: datos.toolsDe(a),
      chats: datos.chatsDe(a.id).length, primero: lugar === 0, ultimo: lugar === lista.length - 1, unico: lista.length <= 1,
    };
  },
  /** Crea un agente (sin `agente`) o guarda uno que existe. */
  agenteGuardar({ agente: id, nombre, proveedor, modelo, instrucciones, tools }) {
    const antes = id ? datos.agente(id) : null;
    if (id && !antes) throw new Fallo(404, 'That agent does not exist anymore.');
    const v = valoresDeAgente({ nombre, proveedor, modelo, instrucciones, tools }, antes);
    if (antes) { datos.editarAgente(antes.id, v); return { id: antes.id }; }
    return { id: datos.crearAgente(v).id };
  },
  agenteMover({ agente: id, hacia }) {
    if (!datos.agente(id)) throw new Fallo(404, 'That agent does not exist anymore.');
    if (!datos.moverAgente(id, Number(hacia) < 0 ? -1 : 1)) throw new Fallo(409, 'It is already at that end of the list.');
    return { ok: true };
  },
  async agenteBorrar({ agente: id }) {
    if (!datos.agente(id)) throw new Fallo(404, 'That agent does not exist anymore.');
    if (datos.listaAgentes().length <= 1) throw new Fallo(409, 'At least one agent has to remain.');
    if (!(await datos.borrarAgente(id))) throw new Fallo(500, 'The agent could not be deleted.');
    return { ok: true };
  },

  // ---------- La memoria de cada agente (1.19.0) ----------
  // Los mismos canales que la vista Memory de la PC, siempre con el agente:
  // cada uno tiene la suya y ninguna se cruza (1.18.0).
  async memoria({ agente }) {
    agenteQueExiste(agente);
    const e = await window.rad.invoke('memoria:leer', { agente });
    if (!e) throw new Fallo(404, 'That agent does not exist anymore.');
    return e;
  },
  async memoriaCore({ agente, texto, base }) {
    agenteQueExiste(agente);
    const final = await window.rad.invoke('memoria:core', { agente, texto: String(texto ?? ''), base: typeof base === 'string' ? base : null });
    if (typeof final !== 'string') throw new Fallo(500, 'It could not be saved.');
    return { core: final };
  },
  async memoriaAgregar({ agente, hecho, detalle }) {
    agenteQueExiste(agente);
    return resultadoDe(await window.rad.invoke('memoria:agregar', { agente, hecho: String(hecho ?? ''), detalle: String(detalle ?? '') }));
  },
  async memoriaEditar({ agente, recuerdo, hecho, detalle }) {
    agenteQueExiste(agente);
    return resultadoDe(await window.rad.invoke('memoria:editar', { agente, id: String(recuerdo ?? ''), hecho: String(hecho ?? ''), detalle: String(detalle ?? '') }));
  },
  async memoriaBorrar({ agente, recuerdo }) {
    agenteQueExiste(agente);
    return resultadoDe(await window.rad.invoke('memoria:borrar', { agente, id: String(recuerdo ?? '') }));
  },

  // ---------- Las skills (1.19.0) ----------
  // Las de todos los agentes, como la vista Skills: escribir, cambiar, apagar,
  // borrar, importar de un .md y decidir sobre lo que proponen los agentes.
  skills() { return window.rad.invoke('skills:leer'); },
  async skillRevisar({ skill }) {
    const r = await window.rad.invoke('skills:revisar', String(skill ?? ''));
    if (!r) throw new Fallo(404, 'That proposal is gone.');
    return r;
  },
  async skillGuardar({ nombre, descripcion, cuerpo, original }) {
    return resultadoDe(await window.rad.invoke('skills:guardar', { nombre: String(nombre ?? ''), descripcion: String(descripcion ?? ''), cuerpo: String(cuerpo ?? ''), original: original ? String(original) : null }));
  },
  async skillActivar({ skill, activa }) { return resultadoDe(await window.rad.invoke('skills:activar', { nombre: String(skill ?? ''), activa: activa === true })); },
  async skillBorrar({ skill }) { return resultadoDe(await window.rad.invoke('skills:borrar', String(skill ?? ''))); },
  async skillAprobar({ skill }) { return resultadoDe(await window.rad.invoke('skills:aprobar', String(skill ?? ''))); },
  async skillDescartar({ skill }) { return resultadoDe(await window.rad.invoke('skills:descartar', String(skill ?? ''))); },
  async skillDeMd({ texto, archivo }) {
    if (typeof texto !== 'string' || texto.length > 200000) throw new Fallo(400, 'That file is too big to be a skill.');
    const campos = await window.rad.invoke('skills:de-md', { texto, archivo: String(archivo ?? '') });
    if (!campos?.cuerpo) throw new Fallo(400, 'That file has no instructions in it.');
    return campos;
  },
};

// (lo que contesta el proceso principal: { ok, … } o { ok: false, error })
function resultadoDe(r) {
  if (r?.ok) return r;
  const error = String(r?.error ?? 'unknown error');
  // «not found» y parecidos son un 404; un dato que no sirve, un 400
  throw new Fallo(/not found|gone|nothing to|no such agent/.test(error) ? 404 : 400, `${error.charAt(0).toUpperCase()}${error.slice(1).replace(/\.$/, '')}.`);
}
function agenteQueExiste(id) {
  if (!id || !datos.agente(id)) throw new Fallo(404, 'That agent does not exist anymore.');
}

/** Lo que manda el celu para un agente, revisado como el formulario de la PC.
 *  `antes`: el agente que se edita (su modelo puede no estar más en la lista
 *  del proveedor, y sus marcas de servidores MCP apagados se conservan). */
function valoresDeAgente({ nombre, proveedor, modelo, instrucciones, tools }, antes = null) {
  const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio) throw new Fallo(400, 'Give it a name.');
  if (limpio.length > 40) throw new Fallo(400, 'The name goes up to 40 characters.');
  const prov = datos.proveedores().find((p) => p.id === proveedor);
  if (!prov) throw new Fallo(400, 'That provider does not exist.');
  const mod = String(modelo ?? '');
  const suyo = antes && antes.proveedor === prov.id && antes.modelo === mod;
  if (!mod || (!suyo && !(prov.modelos ?? []).some((m) => m.id === mod))) {
    throw new Fallo(400, (prov.modelos ?? []).length ? `That model is not in ${prov.nombre}’s list.` : `There are no ${prov.nombre} models to choose from yet.`);
  }
  // (solo las tools que existen; las marcas de un servidor MCP apagado no tienen grupo, pero se conservan)
  const validas = new Set(datos.gruposTools().flatMap((g) => g.tools));
  const pedidas = Array.isArray(tools) ? tools.filter((t) => typeof t === 'string' && validas.has(t)) : [];
  const sinFila = antes ? datos.toolsDe(antes).filter((t) => datos.esMarcaMcp(t) && !validas.has(t)) : [];
  return { nombre: limpio, proveedor: prov.id, modelo: mod, instrucciones: String(instrucciones ?? ''), tools: [...new Set([...pedidas, ...sinFila])] };
}

// (una nota vacía no existe: borrar el texto no la borra, como en la PC)
function textoDeNota(contenido) {
  const texto = typeof contenido === 'string' ? contenido : '';
  if (!texto.trim()) throw new Fallo(400, 'A note cannot be empty.');
  return texto;
}
// (el store contesta que sí aunque la nota no exista: se pregunta antes)
async function notaQueExiste(id) {
  const lista = await window.rad.invoke('notas:lista');
  if (!id || !(Array.isArray(lista) && lista.some((n) => n.id === id))) throw new Fallo(404, 'That note does not exist anymore.');
}
async function carpetaQueExiste(id) {
  if (id === null || id === undefined || id === '') return null;
  const lista = await window.rad.invoke('notas:carpetas');
  if (!(Array.isArray(lista) && lista.some((c) => c.id === id))) throw new Fallo(404, 'That folder does not exist anymore.');
  return id;
}
// Las notas cambiaron desde el celu: la vista de la PC las vuelve a leer como
// cuando las escribe un agente (notas.js escucha este evento).
const notasTocadas = () => window.dispatchEvent(new CustomEvent('blackcode:notas', { detail: { desde: 'celu' } }));

// (un canvas es del agente que lo creó; los huérfanos sin dueño, de todos)
const deEseAgente = (c, agente) => !c.agent_id || c.agent_id === agente;
// (SQLite guarda «2026-11-26 03:10:00» en UTC)
const fechaDe = (s) => { const t = Date.parse(`${String(s ?? '').replace(' ', 'T')}Z`); return Number.isFinite(t) ? t : null; };
// (el principio de un resultado, sin la marca del markdown, en una línea)
const limpio = (s) => String(s ?? '').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

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

// Las tareas y los canvas cambian en el proceso principal: se avisa para que
// el celu los pida de nuevo.
window.rad.on('tareas:evento', () => mandar({ tipo: 'tareas' }));
window.rad.on('canvas:evento', () => mandar({ tipo: 'canvas' }));
datos.on('canvas', () => mandar({ tipo: 'canvas' }));
// Las notas: las que escribe un agente (notas:evento) y las que cambian en la
// vista de la PC o desde un celu (blackcode:notas). Juntas en una tanda corta:
// escribiendo en la PC se guarda a cada rato.
let notasPendiente = null;
const avisarNotas = () => { clearTimeout(notasPendiente); notasPendiente = setTimeout(() => mandar({ tipo: 'notas' }), 250); };
window.rad.on('notas:evento', avisarNotas);
window.addEventListener('blackcode:notas', avisarNotas);
// Los agentes (y lo que su formulario ofrece: modelos y tools), la memoria de
// cada uno y las skills: cambian acá, desde un celu o por un agente.
let agentesPendiente = null;
const avisarAgentes = () => { clearTimeout(agentesPendiente); agentesPendiente = setTimeout(() => mandar({ tipo: 'agentes' }), 250); };
datos.on('agentes', avisarAgentes);
datos.on('modelos', avisarAgentes);
datos.on('tools', avisarAgentes);
window.rad.on('memoria:evento', (ev) => mandar({ tipo: 'memoria', agente: ev?.agente ?? null }));
window.rad.on('skills:evento', () => mandar({ tipo: 'skills' }));

export async function montarMovil() {
  window.rad.on('movil:clientes', (n) => { clientes = Number(n) || 0; });
  clientes = Number(await window.rad.invoke('movil:clientes').catch(() => 0)) || 0;
}
