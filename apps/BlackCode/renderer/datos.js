// Los datos de BlackCode: agentes, chats y mensajes, y el ida y vuelta con el
// modelo. Las vistas no tocan el store ni el puente: piden acá y escuchan.
//
// Qué se guarda (con el store del núcleo):
//   agentes     { lista: [{ id, nombre, proveedor, modelo, instrucciones, creado }] }
//   chats       { lista: [{ id, agente, titulo, auto, cuenta, creado, tocado, carpeta? }] }
//               (carpeta: la carpeta de trabajo de ese chat; sin ella, la de inicio)
//   chat-<id>   { mensajes: [{ id, rol, texto, estado?, nota?, modelo?, tools?, agotado? }] }
//               y, entre los mensajes, las filas de tools: { id, rol: 'tool', tool,
//               texto (qué tocó), estado, ms?, salida?, cortada?, imagenes? }
//               (imagenes: [{ name, dataUrl }] las de una captura o de run_code;
//               [{ name, archivo }] las de generate_image, que quedan en disco)
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
import { paraElModelo } from './adjuntos.js';

const nuevoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const GUARDAR_CADA_MS = 1500;
const TITULO_MAX = 46;
const TITULO_NUEVO = 'New chat';

let agentes, busqueda, delegados, imagenesDoc, titulosDoc, perfilDoc;
let chats;
let ui;
let catalogo = { proveedores: [] }; // los proveedores con sus modelos
let herramientas = { grupos: [], carpeta: '' }; // las tools que hay, por grupo
let fondoDoc; // { bandeja }: ¿cerrar la ventana deja la app en la bandeja del sistema?
let servidoresMcp = { disponible: true, servidores: [] }; // los servidores MCP, con su estado y sin sus secretos
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
  [perfilDoc, titulosDoc, imagenesDoc, delegados, busqueda, agentes, chats, ui, catalogo, herramientas] = await Promise.all([
    openDoc('perfil', { nombre: '' }),
    openDoc('titulos', { activo: true }),
    openDoc('imagenes', { modelo: '', filtro: true }),
    openDoc('subagentes', { proveedor: null, modelo: '' }),
    openDoc('busqueda', { proveedor: 'duckduckgo' }),
    openDoc('agentes', { lista: [] }),
    openDoc('chats', { lista: [] }),
    openDoc('ui', { agente: null, chats: {} }),
    window.rad.invoke('chat:modelos'),
    window.rad.invoke('chat:tools'),
  ]);
  // La app arranca siempre en la pantalla de inicio (1.6.0, pedido de Fran):
  // sin ningún chat elegido, de ningún agente. El agente sí se recuerda. De
  // ahí en más, en la sesión, cada agente recuerda el chat que se le abrió.
  if (Object.keys(ui.get().chats ?? {}).length) ui.update((v) => { v.chats = {}; return v; });
  // Los borradores que quedaron de la sesión anterior (y los «New chat» vacíos
  // de antes de que existieran) se van: ya no hay ninguno abierto.
  await Promise.all(chats.get().lista.filter(esBorrador).map((c) => descartarBorrador(c.id)));
  fondoDoc = await openDoc('fondo', { bandeja: true });
  {
    const v = await window.rad.invoke('voz:estado').catch(() => null);
    if (v && typeof v === 'object') vozEstado = v;
  }
  {
    const m = await window.rad.invoke('mcp:lista').catch(() => null);
    if (m && Array.isArray(m.servidores)) { servidoresMcp = m; podarMcp(); }
  }
  // Hasta la 0.1.1 la interfaz estaba en castellano: un chat todavía sin
  // nombre propio se había guardado como «Chat nuevo».
  if (chats.get().lista.some((c) => c.auto && c.titulo === 'Chat nuevo')) {
    chats.update((v) => { for (const c of v.lista) if (c.auto && c.titulo === 'Chat nuevo') c.titulo = TITULO_NUEVO; return v; });
  }
  // La app sumó tools desde la última vez: el agente que las tenía todas las
  // sigue teniendo todas.
  {
    const todas = todasLasTools();
    const conocidas = Array.isArray(ui.get().toolsConocidas) ? ui.get().toolsConocidas : TOOLS_HASTA_0_7_4;
    const lista = sumarToolsNuevas(agentes.get().lista, conocidas, todas);
    if (lista) agentes.update((v) => { v.lista = lista; return v; });
    if (lista || !Array.isArray(ui.get().toolsConocidas) || conocidas.length !== todas.length) ui.patch({ toolsConocidas: todas });
  }
  // La primera vez hay un agente para empezar a escribir sin armar nada.
  if (!agentes.get().lista.length) crearAgente({ nombre: 'BlackCode', proveedor: PROVEEDOR_INICIAL, modelo: modeloInicial(PROVEEDOR_INICIAL), instrucciones: '', tools: todasLasTools() });
  window.rad.on('chat:evento', alLlegar);
  // La lista de modelos de Venice llega después, cuando el main la trae.
  window.rad.on('chat:modelos', (nuevo) => { catalogo = nuevo; avisar('modelos'); });
  // Los servidores MCP conectan, se caen y se quitan con la app abierta: llega
  // su estado y, detrás, el catálogo de tools con un grupo por servidor.
  window.rad.on('mcp:estado', (lista) => {
    if (!Array.isArray(lista)) return;
    servidoresMcp = { ...servidoresMcp, servidores: lista };
    podarMcp();
    avisar('mcp');
  });
  window.rad.on('chat:tools', (nuevo) => { if (Array.isArray(nuevo?.grupos)) { herramientas = nuevo; avisar('tools'); } });
  // El Atom Echo conecta, escucha, transcribe: su estado llega solo.
  window.rad.on('voz:evento', (v) => { if (v && typeof v === 'object') { vozEstado = v; avisar('voz'); } });
}

// ---------- La voz ----------
// Darle una orden a un agente hablándole al Atom Echo. La config y la llave
// del Echo las guarda el proceso principal (voz.cjs): acá llega el estado,
// sin la llave (solo si está puesta).
let vozEstado = { activa: false, host: '', puerto: 0, agente: '', idioma: 'es', actua: false, python: '', hayLlave: false, cifrado: true, eco: { conexion: 'off', error: '', dispositivo: null, fase: 'idle', ultima: null }, whisper: { estado: 'off', error: '' }, habla: { activa: false, python: '', modelo: '', muestra: '', estado: 'off', error: '', hablando: false }, modelosHabla: [] };
export const voz = () => vozEstado;
export async function refrescarVoz() {
  const v = await window.rad.invoke('voz:estado').catch(() => null);
  if (v && typeof v === 'object') { vozEstado = v; avisar('voz'); }
}
export async function guardarVoz(cambio) {
  const r = await window.rad.invoke('voz:guardar', cambio).catch(() => ({ ok: false, error: 'It could not be saved.' }));
  await refrescarVoz();
  return r;
}
export async function ponerLlaveVoz(texto) {
  const r = await window.rad.invoke('voz:llave', texto).catch(() => ({ ok: false, error: 'It could not be saved.' }));
  await refrescarVoz();
  return r;
}
/** El agente que recibe lo que se dice: el elegido en Settings o, si no hay
 *  o ya no existe, el primero de la lista. */
export const agenteDeVoz = (id = vozEstado.agente) => agente(id) ?? listaAgentes()[0];
// Lo dicho va a un chat de voz de ese agente. Si el último mensaje de voz fue
// hace más que esto, se abre uno nuevo: el contexto no crece para siempre.
export const VOZ_CHAT_MS = 30 * 60000;
/** El chat adonde va la próxima frase dicha a ese agente (lo crea si hace falta, sin cambiar lo que hay en pantalla). */
export function chatDeVoz(agenteId, ahora = Date.now()) {
  const vigente = chats.get().lista.filter((c) => c.agente === agenteId && c.voz === true && ahora - c.tocado < VOZ_CHAT_MS).sort((a, b) => b.tocado - a.tocado)[0];
  if (vigente) return vigente;
  const nuevo = { id: nuevoId(), agente: agenteId, titulo: TITULO_NUEVO, auto: true, voz: true, cuenta: 0, creado: ahora, tocado: ahora, carpeta: carpetaInicio() };
  chats.update((v) => { v.lista.push(nuevo); return v; });
  avisar('chats');
  return nuevo;
}
/** ¿Es un chat de canal? Lo que entra solo, sin tipearlo en la PC: lo dicho al
 *  Atom Echo (`voz`) y lo que llega de Telegram (`canal: 'telegram'`). Van en
 *  el grupo Channels. */
export const deCanal = (c) => c?.voz === true || c?.canal === 'telegram';
/** El chat de Telegram de ese agente: el último que se abrió para Telegram,
 *  que sigue hasta que llega un /new (`nuevo`). Lo crea si hace falta, sin
 *  cambiar lo que hay en pantalla. */
export function chatDeTelegram(agenteId, { nuevo = false, ahora = Date.now() } = {}) {
  const vigente = nuevo ? null : chats.get().lista.filter((c) => c.agente === agenteId && c.canal === 'telegram').sort((a, b) => (b.creado ?? 0) - (a.creado ?? 0))[0];
  if (vigente) return vigente;
  const chatNuevo = { id: nuevoId(), agente: agenteId, titulo: TITULO_NUEVO, auto: true, canal: 'telegram', cuenta: 0, creado: ahora, tocado: ahora, carpeta: carpetaInicio() };
  chats.update((v) => { v.lista.push(chatNuevo); return v; });
  avisar('chats');
  return chatNuevo;
}
/** Fija un chat arriba de la lista (o lo suelta). Un chat de canal no se fija: tiene su grupo. */
export function fijarChat(id, si) {
  const c = chat(id);
  if (!c || deCanal(c)) return;
  chats.update((v) => { const x = v.lista.find((y) => y.id === id); if (si === true) x.fijado = true; else delete x.fijado; return v; });
  avisar('chats');
}
/** Los grupos «Pinned» y «Recent» de la lista de chats, ¿están desplegados? (se recuerda) */
export const grupoAbierto = (cual) => ui.get().grupos?.[cual] !== false;
export function ponerGrupoAbierto(cual, si) {
  ui.patch({ grupos: { ...(ui.get().grupos ?? {}), [cual]: si === true } });
  avisar('chats');
}
/** La pestaña de Settings que quedó a la vista la última vez (se recuerda). */
export const pestanaAjustes = () => (typeof ui.get().ajustes === 'string' ? ui.get().ajustes : '');
export function ponerPestanaAjustes(id) {
  if (ui.get().ajustes !== id) ui.patch({ ajustes: String(id) });
}
/** El grupo «Channels» de la lista de chats, ¿está desplegado? (se recuerda) */
export const canalesAbiertos = () => ui.get().canales !== false;
export function ponerCanalesAbiertos(si) {
  ui.patch({ canales: si === true });
  avisar('chats');
}
/** ¿El turno que corre en ese chat vino por voz? */
export const turnoDeVoz = (chatId) => respuestas.get(chatId)?.voz === true;

// ---------- Los servidores MCP ----------
// Un agente no guarda las tools de un servidor (cambian con él): guarda una
// marca, `mcp:<id del servidor>`, y el proceso principal la cambia por las
// tools que ese servidor ofrece en el momento del pedido.
export const MARCA_MCP = 'mcp:';
export const esMarcaMcp = (t) => typeof t === 'string' && t.startsWith(MARCA_MCP);
/** { disponible, servidores: [{ id, nombre, tipo, comando, args, url, env, headers, preguntar, activo, estado, tools, cortadas, error }] } */
export const mcp = () => servidoresMcp;
/** Lo que dice un grupo de un servidor MCP debajo de su nombre. */
export const detalleMcp = (g) => (g.mcp.estado === 'connected' ? `${g.mcp.cuenta} tool${g.mcp.cuenta === 1 ? '' : 's'} from this server`
  : g.mcp.estado === 'connecting' ? 'connecting' : 'not connected: it adds no tools until it connects');
// Un servidor que se quitó se lleva su marca de los agentes que lo tenían.
// (Uno APAGADO no: al prenderlo vuelve a los mismos agentes.)
function podarMcp() {
  const vivos = new Set(servidoresMcp.servidores.map((s) => `${MARCA_MCP}${s.id}`));
  if (!agentes.get().lista.some((a) => toolsDe(a).some((t) => esMarcaMcp(t) && !vivos.has(t)))) return;
  agentes.update((v) => { for (const a of v.lista) if (Array.isArray(a.tools)) a.tools = a.tools.filter((t) => !esMarcaMcp(t) || vivos.has(t)); return v; });
  avisar('agentes');
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
/** Todas las tools con que nace un agente. Nace con todas prendidas (Fran lo
 *  pidió el 24/11/2026: apagadas de fábrica, no las encontraba), menos las de
 *  un grupo OPCIONAL: generar imágenes gasta plata en cada llamada, así que se
 *  prende a mano en el agente que la vaya a usar. Tampoco se les suma sola a
 *  los agentes que ya existen (sumarToolsNuevas parte de esta misma lista). */
export const todasLasTools = () => herramientas.grupos.filter((g) => !g.opcional).flatMap((g) => g.tools);
// Las tools que había antes de que la app anotara cuáles conoce (0.7.4).
const TOOLS_HASTA_0_7_4 = ['fs_read', 'fs_write', 'fs_edit', 'fs_delete', 'code_search', 'shell_exec', 'cmd_exec', 'job_start', 'job_output', 'job_kill',
  'run_code', 'db_query', 'sqlite_query', 'fetch', 'web_search', 'http_request', 'os_open', 'screen_capture'];
/**
 * Cuando la app suma tools, el agente que tenía TODAS las de antes recibe las
 * nuevas: quien eligió «todo» sigue teniendo todo, sin volver a prenderlo. El
 * que tenía algunas apagadas no cambia (las eligió así).
 * Devuelve la lista de agentes nueva, o null si no hay nada que cambiar.
 */
export function sumarToolsNuevas(lista, conocidas, todas) {
  const nuevas = todas.filter((t) => !conocidas.includes(t));
  const deAntes = conocidas.filter((t) => todas.includes(t));
  if (!nuevas.length || !deAntes.length) return null;
  let cambio = false;
  const out = lista.map((a) => {
    const suyas = toolsDe(a);
    if (!deAntes.every((t) => suyas.includes(t))) return a;
    cambio = true;
    return { ...a, tools: [...new Set([...suyas, ...nuevas])] };
  });
  return cambio ? out : null;
}
// ---------- El nombre de los chats ----------
// ---------- El nombre del usuario (1.9.0) ----------
// Lo que dice el chat arriba de sus mensajes y lo que lleva la exportación a
// .md. Es SOLO de la interfaz: no viaja en ningún pedido a un agente (Fran lo
// pidió así: «no para decírselo a los agentes»). Vacío, «You».
const NOMBRE_MAX = 40;
export const nombreUsuario = () => String(perfilDoc?.get().nombre ?? '').trim() || 'You';
export const nombreGuardado = () => String(perfilDoc?.get().nombre ?? '').trim();
export function ponerNombreUsuario(nombre) {
  const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, NOMBRE_MAX);
  if (limpio === nombreGuardado()) return;
  perfilDoc.patch({ nombre: limpio });
  avisar('perfil');
}

/** ¿El nombre de un chat nuevo lo escribe un modelo? (Settings; prendido de fábrica.) */
export const titulosConModelo = () => titulosDoc.get().activo !== false;
export function ponerTitulosConModelo(si) {
  titulosDoc.patch({ activo: si === true });
  avisar('ajustes');
}
// El chat ya tiene su nombre de siempre (el comienzo del primer mensaje); un
// modelo lee ese mensaje y contesta con un título sobre el tema, que lo
// releva cuando llega. Si falla, o tarda, queda el de siempre. Y si mientras
// tanto el usuario lo renombró, manda él.
async function nombrar(chatId, que) {
  const antes = chat(chatId);
  const a = antes && agente(antes.agente);
  if (!a || !antes.auto) return;
  const provisorio = antes.titulo;
  const r = await window.rad.invoke('chat:titular', { proveedor: a.proveedor, modelo: a.modelo, ...que }).catch(() => null);
  const c = chat(chatId);
  if (!r?.ok || typeof r.titulo !== 'string' || !r.titulo || !c || !c.auto || c.titulo !== provisorio) return;
  chats.update((v) => { const x = v.lista.find((y) => y.id === chatId); if (x) x.titulo = r.titulo; return v; });
  avisar('chats');
}

// ---------- Las imágenes (generate_image) ----------
/** Lo elegido en Settings: con qué modelo de Venice se generan ('' = el que
 *  Venice marque como predeterminado) y si va su filtro de contenido adulto.
 *  Lo lee el proceso principal del mismo documento. */
// (modeloEdicion: con cuál se EDITA una imagen que ya existe; son otros modelos que los de generar)
export const ajustesImagenes = () => ({ modelo: String(imagenesDoc.get().modelo ?? ''), modeloEdicion: String(imagenesDoc.get().modeloEdicion ?? ''), filtro: imagenesDoc.get().filtro !== false });
export function ponerImagenes(cambio) {
  const ahora = ajustesImagenes();
  imagenesDoc.patch({ modelo: typeof cambio?.modelo === 'string' ? cambio.modelo : ahora.modelo, modeloEdicion: typeof cambio?.modeloEdicion === 'string' ? cambio.modeloEdicion : ahora.modeloEdicion, filtro: typeof cambio?.filtro === 'boolean' ? cambio.filtro : ahora.filtro });
  avisar('ajustes');
}
/** ¿Ese agente ve la memoria de la app? Es su grupo Memory: prendido, además
 *  de poder anotar y leer, la tiene en su contexto. */
export const conMemoria = (a) => toolsDe(a).some((t) => t === 'remember' || t === 'recall');
/** Cuántas tools viajan de verdad en un pedido de ese agente: las que tiene
 *  prendidas, o ninguna si su modelo no las acepta. */
export const toolsQueViajan = (a) => (a && modeloConTools(a.proveedor, a.modelo)
  // (la marca de un servidor MCP vale por las tools que ese servidor ofrece ahora)
  ? toolsDe(a).reduce((n, t) => n + (esMarcaMcp(t) ? (herramientas.grupos.find((g) => g.id === t)?.mcp?.cuenta ?? 0) : 1), 0) : 0);
/** Cambia las tools de un agente sin tocar nada más (el menú de la conversación). */
export function ponerTools(id, tools) {
  // (la marca de un servidor MCP apagado no tiene grupo, pero se conserva)
  const validas = new Set([...herramientas.grupos.flatMap((g) => g.tools), ...servidoresMcp.servidores.map((s) => `${MARCA_MCP}${s.id}`)]);
  agentes.update((v) => {
    const a = v.lista.find((x) => x.id === id);
    if (a) a.tools = [...new Set(tools)].filter((t) => validas.has(t));
    return v;
  });
  avisar('agentes');
}

/** Con qué busca web_search: 'duckduckgo' (sin llave), 'tavily' o 'brave'. Lo
 *  lee el proceso principal de este mismo documento. */
/** ¿Cerrar la ventana deja la app viva en la bandeja del sistema? (Lo lee el
 *  proceso principal de este mismo documento, cada vez que se cierra la ventana.) */
export const enBandeja = () => fondoDoc.get().bandeja !== false;
export function ponerEnBandeja(si) {
  fondoDoc.patch({ bandeja: si === true });
  avisar('ajustes');
}

export const BUSCADORES = ['duckduckgo', 'tavily', 'brave'];
export const buscador = () => (BUSCADORES.includes(busqueda.get().proveedor) ? busqueda.get().proveedor : 'duckduckgo');
export function ponerBuscador(id) {
  busqueda.patch({ proveedor: BUSCADORES.includes(id) ? id : 'duckduckgo' });
  avisar('ajustes');
}

/** Con qué corren los subagentes de la tool delegate: { proveedor, modelo }.
 *  proveedor null = el mismo modelo del agente que los lanza. Lo lee el proceso
 *  principal de este mismo documento. */
export function subagentes() {
  const v = delegados.get();
  const proveedor = catalogo.proveedores.some((p) => p.id === v.proveedor) ? v.proveedor : null;
  return { proveedor, modelo: proveedor ? String(v.modelo ?? '') : '' };
}
export function ponerSubagentes({ proveedor = null, modelo = '' } = {}) {
  const valido = catalogo.proveedores.some((p) => p.id === proveedor) ? proveedor : null;
  delegados.set({ proveedor: valido, modelo: valido ? String(modelo ?? '') : '' });
  avisar('ajustes');
}

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

/** Mueve un agente un lugar hacia arriba (-1) o hacia abajo (+1). El orden de
 *  la lista es el de la pestaña Agents y el del menú de agentes del chat. */
export function moverAgente(id, hacia) {
  const i = listaAgentes().findIndex((a) => a.id === id);
  const j = i + (hacia < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= listaAgentes().length) return false;
  agentes.update((v) => { const [a] = v.lista.splice(i, 1); v.lista.splice(j, 0, a); return v; });
  avisar('agentes');
  return true;
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
  // (se lleva lo suyo: sus canvas y su memoria se borran con él)
  window.rad.invoke('agente:enterrar', { agente: id, chats: suyos.map((c) => c.id) }).catch(() => {});
  // (sus tareas programadas se van con él)
  window.rad.invoke('tareas:sin-agente', id).catch(() => {});
  await Promise.all(suyos.map((c) => removeDoc(`chat-${c.id}`)));
  return true;
}

export function elegirAgente(id) {
  if (!agente(id) || agenteActual().id === id) return;
  ui.patch({ agente: id });
  avisar('seleccion');
}

// ---------- Chats ----------
// «New chat» abre un BORRADOR (Fran, 27/11/2026): un chat sin mensajes que
// no figura en ninguna lista hasta que se manda el primero. Si se sale de él
// sin mandar nada, se descarta: no quedan «New chat» vacíos colgando. Los de
// canal (voz, Telegram) no son borradores: nacen para recibir lo que llega.
export const chat = (id) => chats.get().lista.find((c) => c.id === id) ?? null;
const enviando = new Set(); // chats cuyo primer mensaje está saliendo (todavía con cuenta 0)
/** ¿Es un borrador? Un chat de los de siempre que todavía no tiene mensajes. */
export const esBorrador = (c) => Boolean(c) && !deCanal(c) && !(c.cuenta > 0) && !respuestas.has(c.id) && !enviando.has(c.id);
/** Los chats de un agente que se ven, el último que se tocó primero (sin borradores). */
export const chatsDe = (agenteId) => chats.get().lista.filter((c) => c.agente === agenteId && !esBorrador(c)).sort((a, b) => b.tocado - a.tocado);
// Saca un borrador de la lista y del disco. Antes mira su documento: si por
// lo que fuera tiene mensajes (su cuenta quedó vieja), no lo borra: le
// corrige la cuenta y vuelve a la lista.
async function descartarBorrador(id) {
  const c = chat(id);
  if (!esBorrador(c)) return;
  const n = (await hilo(id)).get().mensajes.length;
  if (!esBorrador(chat(id)) || ui.get().chats[c.agente] === id) return; // mientras miraba, se mandó algo o se volvió a él
  if (n) {
    chats.update((v) => { const x = v.lista.find((y) => y.id === id); if (x) x.cuenta = n; return v; });
    avisar('chats');
    return;
  }
  soltarChat(id);
  chats.update((v) => { v.lista = v.lista.filter((x) => x.id !== id); return v; });
  avisar('chats');
  await removeDoc(`chat-${id}`);
}
export function chatActual() {
  const a = agenteActual();
  const c = chat(ui.get().chats[a.id]);
  return c && c.agente === a.id ? c : null;
}

/** `elegir: false`: lo crea sin abrirlo (el celu crea chats sin cambiarle la vista a la PC). */
export function crearChat(agenteId, { elegir = true } = {}) {
  const ahora = Date.now();
  // (nace en la carpeta de inicio, y de ahí en más recuerda la suya)
  const nuevo = { id: nuevoId(), agente: agenteId, titulo: TITULO_NUEVO, auto: true, cuenta: 0, creado: ahora, tocado: ahora, carpeta: carpetaInicio() };
  chats.update((v) => { v.lista.push(nuevo); return v; });
  avisar('chats');
  if (elegir) elegirChat(nuevo.id);
  return nuevo;
}

/** Sigue en un chat lo que dejó una tarea programada: un chat nuevo de ese
 *  agente, con el pedido y el resultado ya adentro. null si el agente ya no está. */
export async function chatDeTarea({ agente: agenteId, titulo, prompt, salida, ts = 0, ms = 0 }) {
  const a = agente(agenteId);
  if (!a) return null;
  const c = crearChat(agenteId);
  const doc = await hilo(c.id);
  const v = doc.get();
  // (las horas son las de la corrida, no las de ahora: cuándo arrancó y cuándo terminó)
  const fin = typeof ts === 'number' && ts > 0 ? ts : 0;
  const desde = fin && typeof ms === 'number' && ms >= 0 ? fin - ms : fin;
  v.mensajes.push({ id: nuevoId(), rol: 'user', texto: String(prompt ?? ''), ...(desde ? { t: desde } : {}) }, { id: nuevoId(), rol: 'assistant', texto: String(salida ?? ''), estado: 'ok', modelo: a.modelo, ...(fin ? { t: fin } : {}) });
  doc.set(v);
  chats.update((x) => { Object.assign(x.lista.find((y) => y.id === c.id), { titulo: titular(String(titulo || prompt || '')), auto: false, cuenta: 2, tocado: Date.now() }); return x; });
  avisar('chats');
  avisar('mensajes', { chat: c.id });
  return c;
}

export function elegirChat(id) {
  const c = chat(id);
  if (!c) return;
  const v = ui.get();
  if (v.agente === c.agente && v.chats[c.agente] === id) return;
  const antes = v.chats[c.agente];
  ui.update((u) => { u.agente = c.agente; u.chats[c.agente] = id; return u; });
  avisar('seleccion');
  // (se dejó un borrador de ese agente sin mandar nada: se va. El de otro
  // agente queda, sin verse en la lista: al volver a ese agente, sigue ahí)
  if (antes && antes !== id) descartarBorrador(antes);
}

export function renombrarChat(id, titulo) {
  const limpio = titulo.trim();
  if (!limpio || !chat(id)) return;
  chats.update((v) => { Object.assign(v.lista.find((c) => c.id === id), { titulo: limpio, auto: false }); return v; });
  avisar('chats');
}

// ---------- La carpeta de trabajo ----------
/** La carpeta donde arranca un chat nuevo (se cambia en Settings). */
export const carpetaInicio = () => herramientas.carpeta || '';
export async function ponerCarpetaInicio(dir) {
  const antes = carpetaInicio();
  const r = await window.rad.invoke('chat:carpeta-inicio', dir);
  if (r?.ok) {
    herramientas = { ...herramientas, carpeta: r.carpeta };
    // Un chat que todavía no arrancó (vacío, y en la de inicio de antes) la
    // sigue: si no, el chat en blanco que ya estaba abierto queda en la vieja.
    // Los que tienen mensajes, o una carpeta elegida, no se mueven.
    if (antes !== r.carpeta && chats.get().lista.some((c) => !c.cuenta && c.carpeta === antes)) {
      chats.update((v) => { for (const c of v.lista) if (!c.cuenta && c.carpeta === antes) c.carpeta = r.carpeta; return v; });
      avisar('chats');
    }
    avisar('ajustes');
  }
  return r;
}
/** La carpeta de trabajo de un chat: la suya, o la de inicio si todavía no
 *  tiene (los chats de antes de la 0.17.0). */
export const carpetaDe = (chatId) => chat(chatId)?.carpeta || carpetaInicio();
export function ponerCarpeta(chatId, dir) {
  if (!chat(chatId) || typeof dir !== 'string' || !dir || chat(chatId).carpeta === dir) return;
  chats.update((v) => { v.lista.find((c) => c.id === chatId).carpeta = dir; return v; });
  avisar('chats');
}

// Deja de escuchar la respuesta que estuviera llegando y la frena.
function soltarChat(id) {
  const r = respuestas.get(id);
  if (r) {
    window.rad.invoke('chat:frenar', r.pedido);
    // (lo que quedaba por guardar ya no se guarda: recrearía el documento de un chat borrado)
    clearTimeout(r.porGuardar);
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
  // sus canvas no se borran con el chat: quedan sueltos, en la biblioteca, y
  // siguen siendo de su agente (Fran, 1.8.2)
  window.rad.invoke('canvas:huerfanos', { chats: [id], agente: c.agente }).catch(() => {});
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
// Un mensaje del usuario viaja si tiene texto o adjuntos. Sus archivos de
// texto van antepuestos a lo que escribió (paraElModelo); sus imágenes, aparte.
const conAdjuntos = (m) => Boolean(m.imagenes?.length || m.archivos?.length);
// Lo que corrió un subagente tampoco viaja: el agente no lo ejecutó, y plegarlo
// en su registro le haría creer que leyó o editó lo que leyó otro. Lo que sí
// hizo el agente está en la fila de `delegate`, que viaja como cualquiera.
const viaja = (m) => (m.rol === 'tool' ? m.estado !== 'run' && !m.sub : (m.texto.trim() || conAdjuntos(m)) && m.estado !== 'error' && m.estado !== 'rechazo');
const alViaje = (m) => {
  if (m.rol === 'tool') {
    // Los archivos que dejó la llamada (las imágenes generadas): el registro
    // que recibe el modelo en los turnos siguientes dice dónde quedaron.
    const dejo = (Array.isArray(m.imagenes) ? m.imagenes : []).map((im) => im.archivo).filter(Boolean);
    return { rol: 'tool', tool: m.tool, texto: m.texto, estado: m.estado, ...(dejo.length ? { dejo } : {}), ...(m.detalle ? { detalle: m.detalle } : {}) };
  }
  // (`t`: cuándo se mandó. El proceso principal se la pone adelante al texto
  // de los mensajes del usuario, para que el modelo sepa cuánto pasó entre uno
  // y otro. Los de antes de la 1.4.0 no la tienen y viajan como siempre.)
  const cuando = m.rol === 'user' && typeof m.t === 'number' ? { t: m.t } : {};
  if (m.rol !== 'user' || !conAdjuntos(m)) return { rol: m.rol, texto: m.texto, ...cuando };
  return { rol: 'user', texto: paraElModelo(m), ...(m.imagenes?.length ? { imagenes: m.imagenes } : {}), ...cuando };
};
/** Lo que viajaría al modelo de una lista de mensajes (para el humo). */
export const historialDe = (mensajes) => mensajes.filter(viaja).map(alViaje);
/** ¿Ese modelo acepta imágenes? Los de Anthropic, todos; uno de Venice, solo
 *  si Venice lo declara. */
export const modeloVe = (prov, id) => prov === 'anthropic' || modelosDe(prov).find((m) => m.id === id)?.vision === true;

/** Manda un mensaje y abre la respuesta. Devuelve si lo mandó. `adjuntos`
 *  es { imagenes: [dataUrl], archivos: [{ name, size, content }] }: con
 *  adjuntos, el texto puede faltar. */
export async function enviar(chatId, texto, adjuntos = null, { voz: dicho = false, modo = null, telegram = null } = {}) {
  const limpio = texto.trim();
  const imagenes = Array.isArray(adjuntos?.imagenes) ? adjuntos.imagenes : [];
  const archivos = Array.isArray(adjuntos?.archivos) ? adjuntos.archivos : [];
  const c = chat(chatId);
  if (!c || (!limpio && !imagenes.length && !archivos.length) || respuestas.has(chatId)) return false;
  const a = agente(c.agente);
  // (mientras se abre su documento, un borrador que está mandando su primer mensaje ya no se descarta)
  // (hasta que el turno queda anotado en `respuestas`, más abajo)
  enviando.add(chatId);
  let doc;
  try { doc = await hilo(chatId); } catch (err) { enviando.delete(chatId); throw err; }
  if (respuestas.has(chatId) || !chat(chatId)) { enviando.delete(chatId); return false; }

  // Se cambia el valor vivo del documento (no una copia): la respuesta se va
  // escribiendo sobre este mismo objeto mientras llega.
  const valor = doc.get();
  // (`voz`: se dijo, no se tipeó; el chat lo muestra con un micrófono)
  // (`t`: cuándo se mandó. Se guarda con el mensaje: no cambia al reabrir el chat)
  const mio = { id: nuevoId(), rol: 'user', texto: limpio, t: Date.now(), ...(imagenes.length ? { imagenes } : {}), ...(archivos.length ? { archivos } : {}), ...(dicho ? { voz: true } : {}),
    // (`canal`: llegó de Telegram; `audio`, como un audio que pasó por Whisper)
    ...(telegram ? { canal: 'telegram', ...(telegram.audio ? { audio: true } : {}) } : {}) };
  const suyo ={ id: nuevoId(), rol: 'assistant', texto: '', estado: 'escribiendo', modelo: a.modelo };
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
    // un chat que arranca solo con adjuntos se llama como el primero
    if (x.auto && primero) x.titulo = titular(limpio || archivos[0]?.name || (imagenes.length ? 'Image' : ''));
    return v;
  });
  // …y, si está prendido, un modelo le escribe uno mejor mientras llega la respuesta
  if (primero && titulosConModelo()) nombrar(chatId, { texto: limpio, archivos: archivos.map((f) => f.name), imagenes: imagenes.length });

  const pedido = nuevoId();
  respuestas.set(chatId, { pedido, mensaje: suyo, doc, pensando: false, guardado: Date.now(), voz: dicho === true, telegram: Boolean(telegram) });
  enviando.delete(chatId);
  porPedido.set(pedido, chatId);
  avisar('chats');
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });

  try {
    await window.rad.invoke('chat:enviar', {
      id: pedido, chat: chatId, agente: a.id, proveedor: a.proveedor, modelo: a.modelo, instrucciones: a.instrucciones, mensajes: historial,
      // (un turno de voz no hereda el modo de la app: lleva el suyo, ver voz.js)
      tools, modo: modo === 'auto' || modo === 'manual' ? modo : modoTools(),
      // la memoria de la app: la ve el agente que tiene prendido su grupo
      // Memory, también si su modelo no acepta tools
      memoria: conMemoria(a),
      // dónde está parado este chat
      carpeta: carpetaDe(chatId),
      // se dijo por el micrófono (si se contesta en voz alta, el agente lo sabe)
      voz: dicho === true,
      // vino de Telegram ('voz': era un audio y se contesta con otro)
      telegram: telegram ? (telegram.hablar ? 'voz' : 'texto') : '',
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

// Baja al disco la conversación que está llegando: si la app se cierra, queda
// lo que había. A lo sumo una vez cada GUARDAR_CADA_MS, porque guardar cuesta
// lo que PESA el chat entero (viaja al proceso principal y se serializa): un
// chat con cien capturas son 30 MB, y guardarlo en cada pedazo de texto y en
// cada tool frenaba el turno a la mitad. Lo que llega en el medio queda
// anotado y baja cuando toca; `ya` (el fin del turno) no espera.
function bajar(r, ya = false) {
  const guardar = () => {
    clearTimeout(r.porGuardar);
    r.porGuardar = null;
    r.guardado = Date.now();
    r.doc.set(r.doc.get());
  };
  const falta = GUARDAR_CADA_MS - (Date.now() - r.guardado);
  if (ya || falta <= 0) guardar();
  else if (!r.porGuardar) r.porGuardar = setTimeout(guardar, falta);
}

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
    bajar(r);
  } else if (ev.tipo === 'tool') {
    alPedirTool(chatId, r, ev);
  } else if (ev.tipo === 'tool-fin') {
    const fila = r.doc.get().mensajes.find((m) => m.rol === 'tool' && m.id === ev.callId);
    if (fila) Object.assign(fila, { estado: ev.status, ms: ev.ms, salida: ev.out ?? '', cortada: ev.outCut === true });
    bajar(r);
    avisar('mensajes', { chat: chatId });
  } else if (ev.tipo === 'tool-imagenes') {
    const fila = r.doc.get().mensajes.find((m) => m.rol === 'tool' && m.id === ev.callId);
    if (fila && Array.isArray(ev.imagenes)) fila.imagenes = ev.imagenes.map(({ name, dataUrl, archivo }) => (archivo ? { name, archivo } : { name, dataUrl })); // (las de generate_image van por su archivo, no adentro del chat)
    // …y lo que la tool anotó para los turnos siguientes (el prompt entero, el modelo, la semilla)
    if (fila && ev.detalle && typeof ev.detalle === 'object') fila.detalle = ev.detalle;
    bajar(r);
    avisar('mensajes', { chat: chatId });
  } else if (ev.tipo === 'canvas') {
    // el agente creó o cambió un canvas: lo muestra el panel (canvas.js)
    avisar('canvas', { chat: chatId, canvas: ev.canvas });
  } else if (ev.tipo === 'confirmar') {
    // (`sub`: la pide un subagente; un número si hay varios trabajando a la vez)
    r.confirmacion = { callId: ev.callId, name: ev.name, label: ev.label, args: ev.args ?? {}, vista: ev.vista ?? null, sub: ev.sub ?? null };
    avisar('confirmar', { chat: chatId });
  } else if (ev.tipo === 'fin') {
    // dónde quedó parado el agente (si hizo `cd`, este chat se movió con él)
    if (typeof ev.carpeta === 'string') ponerCarpeta(chatId, ev.carpeta);
    terminar(chatId, ESTADO[ev.motivo] ?? 'ok', null, ev);
  } else if (ev.tipo === 'error') {
    if (typeof ev.carpeta === 'string') ponerCarpeta(chatId, ev.carpeta);
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
    // `sub`: la corrió un subagente y cuelga de esa fila de delegate; `subN`
    // dice cuál, cuando son varios a la vez
    const fila = { id: ev.callId, rol: 'tool', tool: ev.kind, texto: ev.label ?? '', estado: 'run', ...(ev.sub ? { sub: ev.sub, ...(ev.subN ? { subN: ev.subN } : {}) } : {}) };
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
  bajar(r);
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });
}

function terminar(chatId, estado, nota, ev = null) {
  const r = respuestas.get(chatId);
  if (!r) return;
  r.mensaje.estado = estado;
  // cuándo terminó la respuesta (los tramos de texto de antes de una tool no la llevan: es una por turno)
  r.mensaje.t = Date.now();
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
  bajar(r, true);
  porPedido.delete(r.pedido);
  respuestas.delete(chatId);
  chats.update((v) => { const x = v.lista.find((y) => y.id === chatId); if (x) x.cuenta = r.doc.get().mensajes.length; return v; });
  avisar('mensajes', { chat: chatId });
  avisar('respuesta', { chat: chatId });
  if (habiaTarjeta) avisar('confirmar', { chat: chatId });
  // (terminó un turno: lo usa la voz, para avisar y para mandar la frase que quedó esperando)
  avisar('turno', { chat: chatId, estado, voz: r.voz === true, telegram: r.telegram === true, texto: r.mensaje.texto, nota: nota ?? '' });
}
