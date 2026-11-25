'use strict';

// El pedido al modelo. El renderer manda el pedido armado (proveedor, modelo,
// instrucciones del agente y el chat hasta ahí) y el texto vuelve de a poco
// por el puente:
//
//   rad.invoke('chat:enviar', { id, proveedor, modelo, instrucciones, mensajes })
//   rad.on('chat:evento', ({ id, tipo, … }))
//     tipo 'pensando'            el modelo está pensando, todavía sin texto
//     tipo 'texto'  { texto }    un pedazo más de la respuesta
//     tipo 'fin'    { motivo }   'fin' | 'frenado' | 'largo' | 'rechazo'
//     tipo 'error'  { mensaje }  no hubo respuesta, y por qué
//   rad.invoke('chat:frenar', id)
//
// Con tools (el agente las tiene prendidas y el modelo las acepta) el pedido
// trae además { chat, tools, modo } y aparecen tres eventos:
//     tipo 'tool'      { callId, kind, label }             se pidió una tool
//     tipo 'tool-fin'  { callId, status, ms, out, outCut } cómo terminó
//     tipo 'tool-imagenes' { callId, imagenes }            dejó imágenes: [{ name, dataUrl }], o
//                                                          [{ name, archivo }] las de generate_image
//     tipo 'canvas'    { canvas }                          el agente creó o cambió un canvas
//     tipo 'confirmar' { callId, name, label, args, vista } pide permiso;
//                      se contesta con rad.invoke('chat:confirmar', { callId, permitir, confiar, chat })
//   y 'fin' y 'error' llevan `tools`: lo que corrió en el turno.
//   rad.invoke('chat:tools')    los grupos de tools y la carpeta de trabajo
//
//   rad.invoke('chat:modelos')   los proveedores con sus modelos
//   rad.on('chat:modelos', …)    la lista cambió (llegó la de Venice)
//
// Las tools viven en main/tools (ver su index.cjs).

const fs = require('node:fs');
const path = require('node:path');
const anthropic = require('./anthropic.cjs');
const venice = require('./venice.cjs');
const simulado = require('./simulado.cjs');
const herramientas = require('./tools/index.cjs');

const NOMBRES = { anthropic: 'Anthropic', venice: 'Venice' };
const RESPONDER = { anthropic: anthropic.responder, venice: venice.responder };
// La hora de cada mensaje viaja adelante de su texto (hora.cjs). Se pone acá,
// al salir hacia el proveedor: lo guardado y lo que se ve quedan limpios. Los
// tres pedidos pasan por esto: el del chat, el de un subagente y el de una
// tarea programada. El que le pone nombre a un chat (titulo.cjs), no.
const hora = require('./hora.cjs');
const ROLES = new Set(['user', 'assistant']);
// Las imágenes que adjunta el usuario: data URLs de los cuatro tipos que
// aceptan los modelos. La interfaz deja hasta 4 por mensaje; acá el tope es
// más flojo, por si un chat viejo trae otra cuenta.
const IMAGEN_OK = /^data:image\/(png|jpeg|gif|webp);base64,/;
const IMAGENES_POR_MENSAJE = 8;
const imagenesDe = (m) => (m.rol === 'user' && Array.isArray(m.imagenes)
  ? m.imagenes.filter((u) => typeof u === 'string' && IMAGEN_OK.test(u.slice(0, 40))).slice(0, IMAGENES_POR_MENSAJE)
  : []);

// La lista de Venice se guarda (en un documento del main) para no pedirla en
// cada arranque: se vuelve a pedir si tiene más de unas horas.
const DOC_VENICE = '_venice_modelos';
const VENCE_MS = 6 * 60 * 60 * 1000;
// Las notas de cada modelo se guardan ya escritas. Si cambia cómo se
// escriben (hasta la 0.1.1 iban en castellano), lo guardado se vuelve a pedir.
const FORMATO_VENICE = 4;

// Donde se guarda la carpeta de trabajo de las tools, para el arranque siguiente.
const DOC_TOOLS = '_tools';
// Lo más largo que la tarjeta de confirmación muestra de un argumento.
const ARG_MAX = 1500;
// Cuántas imágenes de una llamada se muestran (y se guardan con el chat).
const IMAGENES_MAX = 4;
const ESPERA_MODELOS_MS = 8000;

function limpiar(pedido) {
  const { id, chat = '', agente = '', proveedor = 'anthropic', modelo, instrucciones, mensajes, tools = [], modo = 'manual', memoria = false, carpeta = '', voz = false } = pedido ?? {};
  if (typeof id !== 'string' || !id) throw new Error('[blackcode] el pedido no trae id');
  if (!RESPONDER[proveedor]) throw new Error(`[blackcode] proveedor desconocido: ${JSON.stringify(proveedor)}`);
  if (typeof modelo !== 'string' || !modelo) throw new Error('[blackcode] el pedido no trae modelo');
  if (!Array.isArray(mensajes) || !mensajes.length) throw new Error('[blackcode] el pedido no trae mensajes');
  // Las filas de tools de los turnos anteriores (rol 'tool') viajan plegadas:
  // un mensaje de la app, justo antes de la respuesta que las siguió, con qué
  // corrió y cómo terminó. Es la evidencia entre turnos: sin ella, la única
  // memoria que el modelo tiene de lo que hizo es su propia prosa.
  const lista = herramientas.plegar(mensajes
    // (un mensaje del usuario puede venir sin texto si trae imágenes)
    .filter((m) => m && (m.rol === 'tool' ? typeof m.tool === 'string' : ROLES.has(m.rol) && typeof m.texto === 'string' && (m.texto.trim() || imagenesDe(m).length)))
    .map((m) => {
      // (`dejo`: las rutas de los archivos que dejó esa llamada; van al registro)
      if (m.rol === 'tool') {
        const saved = (Array.isArray(m.dejo) ? m.dejo : []).filter((p) => typeof p === 'string' && p && p.length <= 400).slice(0, 8);
        // (`detalle`: lo que generate_image dejó anotado para los turnos
        // siguientes. El prompt va ENTERO en vez del recorte de la fila, y lo
        // demás, como datos sueltos.)
        const d = m.detalle && typeof m.detalle === 'object' ? m.detalle : null;
        const corto = (x, n) => (typeof x === 'string' && x ? x.slice(0, n) : '');
        const facts = d ? [
          corto(d.modelo, 80) && `model ${corto(d.modelo, 80)}`,
          corto(d.aspecto, 12),
          corto(d.resolucion, 8),
          Number.isSafeInteger(d.semilla) && `seed ${d.semilla}`,
          // (una edición: de qué imágenes salió)
          Array.isArray(d.entradas) && d.entradas.length ? `edited from ${d.entradas.filter((x) => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 200)).join(', ')}` : '',
          d.visto === true ? 'you looked at it' : 'you did not look at it',
        ].filter(Boolean) : [];
        return { role: 'tool', tool: m.tool, content: corto(d?.prompt, 2000) || String(m.texto ?? ''), status: m.estado, ...(facts.length ? { facts } : {}), ...(saved.length ? { saved } : {}) };
      }
      const images = imagenesDe(m);
      // (`t`: cuándo se mandó. Solo en los del usuario: ver hora.cjs)
      return { role: m.rol, content: m.texto, ...(images.length ? { images } : {}), ...(m.rol === 'user' && hora.sello(m.t) ? { t: m.t } : {}) };
    }))
    .map((m) => ({ rol: m.role, texto: m.content, ...(m.images?.length ? { imagenes: m.images } : {}), ...(m.t ? { t: m.t } : {}) }));
  if (!lista.length || lista[0].rol !== 'user') throw new Error('[blackcode] el chat tiene que empezar con un mensaje del usuario');
  return {
    id,
    chat: String(chat ?? ''),
    // de qué agente es el turno (la tool schedule le deja la tarea a él)
    agente: typeof agente === 'string' ? agente : '',
    proveedor,
    modelo,
    instrucciones: typeof instrucciones === 'string' ? instrucciones.trim() : '',
    mensajes: lista,
    tools: Array.isArray(tools) ? tools.filter((t) => typeof t === 'string') : [],
    modo: modo === 'auto' ? 'auto' : 'manual',
    // ¿este agente ve la memoria de la app? (lo decide la interfaz: su grupo Memory)
    memoria: memoria === true,
    // la carpeta de trabajo de ese chat ('' = la de inicio)
    carpeta: typeof carpeta === 'string' ? carpeta : '',
    // ¿lo último se dijo por el micrófono? (si además se contesta en voz alta, el agente lo sabe)
    voz: voz === true,
  };
}

function wire(rad, { llave }) {
  const activos = new Map(); // id del pedido -> AbortController

  // ---------- Las tools ----------
  const { shell } = require('electron');
  // Con el proveedor de mentira (el humo, las capturas) las tools no tocan
  // nada de verdad: trabajan en una carpeta adentro de los datos descartables
  // y lo que «borran» va a una papelera que es otra carpeta ahí mismo.
  // Tampoco abren nada: os_open anota lo que habría abierto.
  const taller = llave.SIMULADO && process.env.RAD_DATA ? path.join(process.env.RAD_DATA, 'workspace') : null;
  // La memoria: lo que la app recuerda del usuario de un chat a otro. Vive en
  // un documento que la interfaz no puede leer (empieza con _): el único que
  // lo escribe es este proceso, y la vista Memory pide cada cambio por su canal.
  const DOC_MEMORIA = '_memoria';
  const memoria = require('./memoria.cjs').crear({
    leer: () => rad.store.read(DOC_MEMORIA),
    escribir: (doc) => { rad.store.write(DOC_MEMORIA, doc).catch(() => {}); },
    alCambiar: () => rad.send('memoria:evento', {}),
  });
  // Las skills: procedimientos que el usuario les deja a sus agentes. Como la
  // memoria, en un documento que la interfaz no lee. Cuando un agente propone
  // una, la interfaz se entera para avisarle al usuario que hay algo que revisar.
  const DOC_SKILLS = '_skills';
  const skills = require('./skills.cjs').crear({
    leer: () => rad.store.read(DOC_SKILLS),
    escribir: (doc) => { rad.store.write(DOC_SKILLS, doc).catch(() => {}); },
    alCambiar: (aviso) => rad.send('skills:evento', { propuesta: aviso?.propuesta ?? null }),
  });
  const paraLaMemoria = { memoria, skills };
  // El canvas: los títulos de los chats (para su biblioteca) salen del
  // documento que guarda la interfaz, y cuando el agente borra uno se avisa
  // fuera del turno (el panel puede estar mirando otro chat).
  const paraElCanvas = {
    titulosDeChats: () => new Map((rad.store.read('chats')?.lista ?? []).map((c) => [c.id, c.titulo])),
    avisar: (canal, datos) => {
      if (canal === 'canvas:deleted') rad.send('canvas:evento', { tipo: 'borrado', convoId: datos?.convoId ?? null, canvas: datos?.canvas ?? null });
      // el agente cambió o borró una nota: el panel de notas se pone al día
      else if (canal === 'notes:changed') rad.send('notas:evento', { tipo: 'cambio' });
      else if (canal === 'notes:deleted') rad.send('notas:evento', { tipo: 'borrada', id: datos?.id ?? null, title: datos?.title ?? '' });
      // lo del navegador va con su mismo nombre: browser:state, :open, :atajo
      else if (String(canal).startsWith('browser:')) rad.send(canal, datos);
    },
  };
  // web_search: con qué busca lo elige el usuario en Settings (el documento
  // `busqueda`), y la llave es la del buscador elegido. DuckDuckGo no pide.
  const CON_LLAVE = new Set(['tavily', 'brave']);
  const buscador = () => { const p = rad.store.read('busqueda')?.proveedor; return CON_LLAVE.has(p) ? p : 'duckduckgo'; };
  const paraLaBusqueda = {
    webSearch: () => ({ provider: buscador(), maxResults: 5 }),
    getKey: (nombre) => (nombre === 'websearch' && CON_LLAVE.has(buscador()) ? llave.leer(rad.store, buscador()) : null),
  };
  // Los subagentes (la tool delegate): con qué modelo corre un hijo y cómo se
  // lo llama. De fábrica, el mismo del agente; en Settings se puede elegir
  // otro (el documento `subagentes`: { proveedor, modelo }).
  const destinoDeSubagentes = (run) => {
    const sa = rad.store.read('subagentes') ?? {};
    const elegido = RESPONDER[sa.proveedor] ? sa.proveedor : null;
    const proveedor = elegido ?? run.proveedor;
    const p = proveedores().proveedores.find((x) => x.id === proveedor);
    const modelo = elegido ? (String(sa.modelo ?? '').trim() || p?.inicial || '') : run.modelo;
    const m = p?.modelos.find((x) => x.id === modelo);
    const nombre = NOMBRES[proveedor] ?? String(proveedor ?? '');
    let error = null;
    if (!RESPONDER[proveedor]) error = 'the subagent provider is not set (Settings → Subagents)';
    else if (!modelo) error = `no model chosen for ${nombre}, the subagent provider (Settings → Subagents)`;
    else if (elegido && !m) error = `the subagent model '${modelo}' is not in ${nombre}'s list any more (Settings → Subagents)`;
    else if (m?.tools === false) error = `the subagent model '${modelo}' cannot use tools: pick another one (Settings → Subagents)`;
    else if (!llave.SIMULADO && !llave.leer(rad.store, proveedor)) error = `no API key set for ${nombre}, the subagent provider`;
    return { proveedor, modelo, nombre, mismo: !elegido, ve: proveedor === 'anthropic' || m?.vision === true, error };
  };
  const paraLosSubagentes = {
    subagentes: {
      destino: destinoDeSubagentes,
      // (el encargo de un subagente lleva la hora en que se le dio: es lo único que sabe del día)
      responder: (crudo, opciones) => {
        const viaja = hora.paraElProveedor({ ...crudo, mensajes: crudo.mensajes.map((m) => (m.rol === 'user' ? { ...m, t: Date.now() } : m)) });
        return llave.SIMULADO
          ? simulado.responder(viaja, opciones)
          : RESPONDER[viaja.proveedor](viaja, { ...opciones, key: llave.leer(rad.store, viaja.proveedor) });
      },
    },
  };
  // El navegador pinta su página encima de la ventana principal: hay que
  // saber cuál es (las ventanas de login que abre una página también son
  // ventanas) y dormirle la capa cuando la ventana no se ve.
  const electron = require('electron');
  // las páginas eligen su tema oscuro
  try { electron.nativeTheme.themeSource = 'dark'; } catch { /* sin nativeTheme: seguimos */ }
  let principal = null;
  const adoptar = (w) => {
    if (principal || !w || w.isDestroyed()) return;
    principal = w;
    for (const ev of ['minimize', 'hide']) w.on(ev, () => { try { herramientas.navegador.dormir(); } catch { /* sin navegador abierto */ } });
    for (const ev of ['restore', 'show']) w.on(ev, () => { try { herramientas.navegador.despertar(); } catch { /* sin navegador abierto */ } });
    w.on('closed', () => { principal = null; });
  };
  adoptar(electron.BrowserWindow.getAllWindows()[0]);
  electron.app.on('browser-window-created', (_e, w) => adoptar(w));
  const paraElNavegador = {
    ventana: () => (principal && !principal.isDestroyed() ? principal : null),
    // la corrida sabe si su modelo ve (lo anota el pedido, más abajo)
    modeloVe: (run) => run?.ve === true,
  };
  // ---------- Los servidores MCP ----------
  // Su configuración va en un documento reservado (`_mcp`: la interfaz no lo
  // puede leer) y sus secretos —variables de entorno y encabezados, que suelen
  // ser llaves— cifrados con safeStorage, como las llaves de las APIs. A la
  // interfaz le llega el estado sin esos valores. Ver main/mcp.cjs.
  const DOC_MCP = '_mcp';
  let avisarMcp = () => {}; // se arma más abajo, con el catálogo de tools
  const { safeStorage } = require('electron');
  // (el mismo cifrado guarda la llave del Atom Echo: ver voz.cjs)
  const cifrar = (texto) => { try { return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texto).toString('base64') : null; } catch { return null; } };
  const descifrar = (blob) => { try { return safeStorage.decryptString(Buffer.from(String(blob), 'base64')); } catch { return null; } };
  const mcp = require('./mcp.cjs').crear({
    leer: () => rad.store.read(DOC_MCP),
    escribir: (doc) => rad.store.write(DOC_MCP, doc),
    cifrar,
    descifrar,
    alCambiar: () => avisarMcp(),
  });
  const paraMcp = { mcp };
  // ---------- Las tareas programadas ----------
  // Un pedido que un agente corre solo, a una hora o cada tanto; el resultado
  // queda en una bandeja (la pestaña Tasks). Las tareas y sus resultados van
  // en documentos reservados: el único que los escribe es este proceso. Ver
  // main/tareas.cjs; cómo corre cada una, en correrTarea, más abajo.
  const losAgentes = () => (Array.isArray(rad.store.read('agentes')?.lista) ? rad.store.read('agentes').lista : []);
  let corrimiento = 0; // (el humo adelanta el reloj de las tareas; en la app es 0)
  let ultimoAviso = null; // el último aviso de Windows que se mandó (o se habría mandado, en el humo)
  const tareas = require('./tareas.cjs').crear({
    leer: () => rad.store.read('_tareas'),
    escribir: (doc) => rad.store.write('_tareas', doc),
    leerBandeja: () => rad.store.read('_tareas_bandeja'),
    escribirBandeja: (doc) => rad.store.write('_tareas_bandeja', doc),
    correr: (tarea, o) => correrTarea(tarea, o),
    // una tarea no compite con un turno de chat en curso
    ocupado: () => activos.size > 0,
    existeAgente: (id) => losAgentes().some((a) => a.id === id),
    ahora: () => Date.now() + corrimiento,
    alCambiar: (que) => rad.send('tareas:evento', { que }),
    // Terminó una corrida: un aviso de Windows, que al tocarlo trae la app a la pestaña Tasks.
    alTerminar: (r) => {
      // (el resultado es markdown: en el aviso va sin sus marcas)
      const cuerpo = (r.error ? `It failed: ${r.error}` : r.salida || 'It finished with no text.').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 220);
      ultimoAviso = { id: r.id, titulo: `BlackCode · ${r.titulo}`, cuerpo };
      if (taller) return; // (en el humo no se le manda un aviso de verdad al usuario)
      const { Notification } = require('electron');
      if (!Notification.isSupported()) return;
      const aviso = new Notification({ title: ultimoAviso.titulo, body: cuerpo, silent: false });
      aviso.on('click', () => { rad.tray?.show(); rad.send('tareas:abrir', { id: r.id }); });
      aviso.show();
    },
  });
  const paraLasTareas = { tareas: { tareas, agentes: losAgentes, alBorrar: (t) => rad.send('tareas:borrada', { id: t.id, titulo: t.titulo }) } };
  // ---------- La voz ----------
  // Darle una orden a un agente hablándole al Atom Echo: BlackCode se
  // conecta al Echo, transcribe la frase en esta máquina y se la pasa a la
  // interfaz, que la manda a un chat. Apagada de fábrica. Ver main/voz.cjs.
  // En el humo no hay ni Echo ni Whisper: los dos son de mentira, y el
  // guion los maneja por `voz:simular`.
  const ecoDeMentira = taller ? require('./eco-simulado.cjs').paraElHumo() : null;
  const voz = require('./voz.cjs').wire(rad, { taller, cifrar, descifrar, agentes: losAgentes, simulada: ecoDeMentira });
  if (taller) rad.handle('voz:simular', (que) => ({ ...ecoDeMentira.simular(que && typeof que === 'object' ? que : {}), llaveDeMentira: ecoDeMentira.llave }));
  // generate_image: la llave de Venice (la misma de los agentes de Venice), lo
  // que el usuario eligió en Settings (el modelo y el filtro de contenido
  // adulto) y, en el humo, sin red.
  const paraLasImagenes = { imagenes: { getKey: () => llave.leer(rad.store, 'venice'), ajustes: () => rad.store.read('imagenes') ?? {}, deMentira: Boolean(taller) } };
  // run_code dejó imágenes: van a la fila de esa llamada, en el chat.
  const alProducir = (run, imagenes) => run.notify('tool:artifact', { images: imagenes });
  if (taller) {
    fs.mkdirSync(path.join(taller, '.trash'), { recursive: true });
    const abiertos = path.join(taller, '.opened.log');
    const anotar = (que) => fs.promises.appendFile(abiertos, `${que}\n`);
    herramientas.iniciar({
      carpeta: taller,
      reservada: rad.store.dir,
      alProducir,
      ...paraElCanvas,
      ...paraElNavegador,
      ...paraLaBusqueda,
      ...paraLosSubagentes, ...paraLaMemoria, ...paraLasImagenes, ...paraMcp, ...paraLasTareas,
      abrirAfuera: (u) => anotar(`url ${u}`),
      trash: (ruta) => fs.promises.rename(ruta, path.join(taller, '.trash', `${Date.now()}-${path.basename(ruta)}`)),
      // y no miran la pantalla de nadie: capturan una de mentira
      ...simulado.pantallaDeMentira(),
      shell: {
        openPath: async (p) => { await anotar(`open ${p}`); return ''; },
        openExternal: (u) => anotar(`url ${u}`),
        showItemInFolder: (p) => { anotar(`reveal ${p}`); },
      },
    });
    herramientas.setCwd(taller);
  } else {
    // Lo que las tools guardan (el taller de run_code, la base del agente)
    // va al lado de los documentos de la app, en su propia carpeta.
    const carpeta = path.join(path.dirname(rad.store.dir), 'tools');
    fs.mkdirSync(carpeta, { recursive: true });
    const { desktopCapturer, screen } = require('electron');
    herramientas.iniciar({ carpeta, reservada: rad.store.dir, alProducir, trash: (ruta) => shell.trashItem(ruta), shell, capturador: desktopCapturer, pantallas: screen, ...paraElCanvas, ...paraElNavegador, ...paraLaBusqueda, ...paraLosSubagentes, ...paraLaMemoria, ...paraLasImagenes, ...paraMcp, ...paraLasTareas, abrirAfuera: (u) => shell.openExternal(u) });
    herramientas.setCwd(rad.store.read(DOC_TOOLS)?.carpeta);
  }
  // Al salir, lo que quedó corriendo en segundo plano se mata.
  require('electron').app.on('before-quit', () => herramientas.cerrar());
  // Los servidores MCP activos se conectan al abrir la app, de a uno y sin
  // frenar nada (un local puede tardar: npx baja el paquete la primera vez).
  // Al salir se cierran: los locales son procesos hijos.
  mcp.conectarActivos().catch(() => {});
  require('electron').app.on('before-quit', () => { mcp.cerrar().catch(() => {}); });
  // El latido de las tareas programadas: cada 30 s, y una vez a los 3 s de
  // abrir (lo que tocaba con la app cerrada corre ahí, una vez).
  tareas.arrancar();
  require('electron').app.on('before-quit', () => { tareas.parar(); tareas.frenar(); });
  // La terminal del panel: una shell del USUARIO, que abre donde están
  // trabajando las tools. Ninguna tool llega a ella (ver terminal.cjs). En el
  // humo es una shell sin el profile de nadie.
  // ---------- La carpeta de trabajo ----------
  // Cada chat tiene la suya (la guarda la interfaz, con el chat) y viaja en
  // cada pedido. Lo que se guarda acá es la de INICIO: donde arranca un chat
  // nuevo. Hasta la 0.16.0 había una sola carpeta para toda la app, que se
  // movía con el `cd` de cualquier agente y no se veía en ningún lado: un
  // agente terminaba parado donde lo había dejado otro. Esa última carpeta
  // global es la de inicio con la que arranca quien actualiza.
  const esCarpeta = (d) => { try { return typeof d === 'string' && Boolean(d) && fs.statSync(d).isDirectory(); } catch { return false; } };
  let carpetaInicio = herramientas.getCwd();
  require('./terminal.cjs').wire(rad, { getCwd: () => carpetaInicio, deMentira: Boolean(taller) });
  rad.handle('chat:carpeta-inicio', (dir) => {
    if (typeof dir !== 'string') return { ok: true, carpeta: carpetaInicio };
    if (!esCarpeta(dir)) return { ok: false, error: 'That folder does not exist.' };
    carpetaInicio = path.resolve(dir);
    herramientas.setCwd(carpetaInicio);
    if (!taller) rad.store.write(DOC_TOOLS, { carpeta: carpetaInicio }).catch(() => {});
    return { ok: true, carpeta: carpetaInicio };
  });
  rad.handle('chat:carpeta-existe', (dir) => esCarpeta(dir));
  // Elegir una carpeta: el diálogo del sistema. En el humo no se abre ningún
  // diálogo: «elige» una carpeta de la corrida.
  rad.handle('chat:elegir-carpeta', async (desde, ctx) => {
    if (taller) { const d = path.join(taller, 'picked'); fs.mkdirSync(d, { recursive: true }); return d; }
    const { dialog } = require('electron');
    const ventana = ctx?.window ?? desde?.window ?? null;
    const opciones = { title: 'Choose a folder', defaultPath: esCarpeta(desde) ? desde : carpetaInicio, properties: ['openDirectory'] };
    const r = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  rad.handle('chat:abrir-carpeta', async (dir) => {
    if (!esCarpeta(dir)) return { ok: false };
    if (!taller) await shell.openPath(dir);
    return { ok: true };
  });
  const pendientes = new Map(); // callId -> resolver de la tarjeta que espera
  // Los chats donde el usuario tildó «no preguntar más». En memoria: al
  // reabrir la app, vuelve a preguntar.
  const confiados = new Set();
  const recortar = (args) => Object.fromEntries(Object.entries(args || {}).map(([k, v]) => {
    const t = typeof v === 'string' ? v : JSON.stringify(v);
    return [k, t.length > ARG_MAX ? `${t.slice(0, ARG_MAX)}… (${t.length - ARG_MAX} more characters)` : t];
  }));

  // (la carpeta del catálogo es la de inicio, no la última por donde anduvo un agente)
  const catalogoTools = () => ({ ...herramientas.catalogo(), carpeta: carpetaInicio });
  rad.handle('chat:tools', catalogoTools);
  // Un servidor MCP conectó, se cayó, se quitó o cambió: a la interfaz le llega
  // su estado (sin secretos) y el catálogo de tools, que trae un grupo por servidor.
  avisarMcp = () => { rad.send('mcp:estado', mcp.lista()); rad.send('chat:tools', catalogoTools()); };
  // El nombre de un chat, puesto por un modelo (ver titulo.cjs). Es un pedido
  // suelto, sin tools ni sesión, al mismo `responder` de un turno. La
  // interfaz lo pide una vez, con el primer mensaje, si el usuario lo tiene
  // prendido en Settings.
  const titular = require('./titulo.cjs').crear({
    responder: (proveedor, pedido, opciones) => RESPONDER[proveedor](pedido, opciones),
    getKey: (proveedor) => (RESPONDER[proveedor] ? llave.leer(rad.store, proveedor) : null),
    deMentira: llave.SIMULADO,
  });
  rad.handle('chat:titular', (que) => titular(que && typeof que === 'object' ? que : {}));

  // ---------- Las notas ----------
  // Los canales de su vista. Los cuerpos son los de NeonCode (notas.cjs): cada
  // uno ataja sus errores y contesta un valor que la vista puede leer.
  {
    const n = herramientas.notas.ipc;
    rad.handle('notas:lista', () => n.list());
    rad.handle('notas:crear', (que) => n.create(que ?? {}));
    rad.handle('notas:guardar', (que) => n.update(que ?? {}));
    rad.handle('notas:borrar', (id) => n.remove(id));
    rad.handle('notas:fijar', (que) => n.pin(que ?? {}));
    rad.handle('notas:mover', (que) => n.setFolder(que ?? {}));
    rad.handle('notas:restaurar', (id) => n.restore(id));
    rad.handle('notas:carpetas', () => n.foldersList());
    rad.handle('notas:carpeta-crear', (nombre) => n.foldersCreate(nombre));
    rad.handle('notas:carpeta-renombrar', (que) => n.foldersRename(que ?? {}));
    rad.handle('notas:carpeta-borrar', (id) => n.foldersDelete(id));
  }

  // ---------- La memoria ----------
  // Los canales de su vista. La lista se cambia de a una entrada; el Core es
  // un texto y viaja con la `base` con la que se abrió (ver memoria.cjs).
  rad.handle('memoria:leer', () => memoria.estado());
  rad.handle('memoria:core', (que) => memoria.ponerCore(que?.texto, que?.base));
  rad.handle('memoria:agregar', (que) => memoria.agregar({ hecho: que?.hecho, detalle: que?.detalle, de: 'user' }));
  rad.handle('memoria:editar', (que) => memoria.editar(String(que?.id ?? ''), { hecho: que?.hecho, detalle: que?.detalle }));
  rad.handle('memoria:borrar', (id) => memoria.borrar(String(id ?? '')));

  // ---------- Las skills ----------
  // Los canales de su vista. Aprobar y descartar una propuesta son del
  // usuario: no hay tool que llegue a esos dos.
  rad.handle('skills:leer', () => skills.estado());
  rad.handle('skills:guardar', (que) => skills.guardar({ nombre: que?.nombre, descripcion: que?.descripcion, cuerpo: que?.cuerpo, original: que?.original ?? null }));
  rad.handle('skills:activar', (que) => skills.activar(String(que?.nombre ?? ''), que?.activa === true));
  rad.handle('skills:borrar', (nombre) => skills.borrar(String(nombre ?? '')));
  rad.handle('skills:revisar', (nombre) => skills.revisar(String(nombre ?? '')));
  rad.handle('skills:aprobar', (nombre) => skills.aprobar(String(nombre ?? '')));
  rad.handle('skills:descartar', (nombre) => skills.descartar(String(nombre ?? '')));
  rad.handle('skills:de-md', (que) => require('./skills.cjs').deMd(que?.texto, que?.archivo));

  // ---------- El navegador ----------
  // Los canales de su panel. Los cuerpos son los de NeonCode (navegador.cjs).
  {
    const nav = herramientas.navegador.ipc;
    const canales = {
      attach: 'attach', bounds: 'bounds', panel: 'panel', visible: 'visible', state: 'state', navigate: 'navigate',
      'tab-new': 'tabNew', 'tab-go': 'tabGo', 'tab-close': 'tabClose',
      back: 'back', forward: 'forward', reload: 'reload', stop: 'stop',
      capture: 'capture', freeze: 'freeze', external: 'external',
      'fav-list': 'favList', 'fav-toggle': 'favToggle', 'fav-remove': 'favRemove', 'fav-open': 'favOpen',
      'hist-list': 'histList', 'hist-remove': 'histRemove', 'hist-clear': 'histClear', 'hist-open': 'histOpen',
    };
    for (const [canal, fn] of Object.entries(canales)) rad.handle(`browser:${canal}`, async (arg) => (await nav[fn](arg)) ?? null);
  }

  // ---------- Los servidores MCP, para Settings ----------
  rad.handle('mcp:lista', () => ({ disponible: mcp.disponible(), servidores: mcp.lista() }));
  rad.handle('mcp:guardar', (entrada) => mcp.guardar(entrada && typeof entrada === 'object' ? entrada : {}));
  rad.handle('mcp:quitar', (id) => mcp.quitar(String(id ?? '')));
  rad.handle('mcp:ajustar', (que) => mcp.ajustar(String(que?.id ?? ''), que && typeof que === 'object' ? que : {}));
  rad.handle('mcp:reconectar', async (id) => { await mcp.reconectar(String(id ?? '')); return { ok: true }; });
  rad.handle('mcp:pegar', (crudo) => mcp.pegar(typeof crudo === 'string' ? crudo.slice(0, 200000) : ''));

  // ---------- Las imágenes generadas ----------
  // Lo que generate_image guarda son archivos; la interfaz los pide por su
  // ruta, y solo se le dan los de esa carpeta (imagenes.esMia).
  {
    const img = herramientas.imagenes;
    const esta = (archivo) => img.esMia(archivo) && fs.existsSync(path.resolve(archivo));
    rad.handle('imagenes:modelos', async (fresco) => {
      const corto = ({ id, nombre, precio }) => ({ id, nombre, precio });
      try {
        const modelos = (await img.modelos({ fresco: fresco === true })).map(corto);
        // (los que editan son otra lista; si esa falla, generar sigue andando)
        const edicion = await img.modelosEdicion({ fresco: fresco === true }).then((l) => l.map(corto), () => []);
        return { ok: true, modelos, edicion };
      } catch (err) { return { ok: false, error: String(err?.message || err) }; }
    });
    rad.handle('imagenes:ver', (archivo) => img.leer(archivo));
    // En el humo no se abre nada del sistema: se contesta como si.
    rad.handle('imagenes:abrir', async (archivo) => { if (!esta(archivo)) return { ok: false }; if (!taller) await shell.openPath(path.resolve(archivo)); return { ok: true }; });
    rad.handle('imagenes:mostrar', (archivo) => { if (!esta(archivo)) return { ok: false }; if (!taller) shell.showItemInFolder(path.resolve(archivo)); return { ok: true }; });
    rad.handle('imagenes:guardar-como', async (archivo, ctx) => {
      if (!esta(archivo)) return { ok: false, error: 'That image file is gone.' };
      let destino;
      if (taller) {
        destino = path.join(taller, 'exports', path.basename(archivo));
        fs.mkdirSync(path.dirname(destino), { recursive: true });
      } else {
        const { dialog, app } = require('electron');
        const opciones = { title: 'Save image', defaultPath: path.join(app.getPath('pictures'), path.basename(archivo)) };
        const r = ctx?.window ? await dialog.showSaveDialog(ctx.window, opciones) : await dialog.showSaveDialog(opciones);
        if (r.canceled || !r.filePath) return { ok: false, cancelado: true };
        destino = r.filePath;
      }
      try { fs.copyFileSync(path.resolve(archivo), destino); return { ok: true, destino }; } catch (err) { return { ok: false, error: String(err?.message || err) }; }
    });
  }

  // ---------- El canvas ----------
  // Lo que usa su panel. A diferencia de la tool, estos canales no están
  // acotados a un chat: la biblioteca muestra los de todos.
  const lienzo = herramientas.canvas;
  rad.handle('canvas:lista', (chat) => (chat ? lienzo.store.listByConversation(String(chat)) : []));
  rad.handle('canvas:todos', () => lienzo.listarTodos());
  rad.handle('canvas:abrir', (id) => lienzo.store.get(String(id ?? '')) ?? null);
  rad.handle('canvas:guardar', (cambio) => lienzo.guardar(cambio ?? {}) ?? null);
  rad.handle('canvas:borrar', (que) => lienzo.store.remove(String(que?.id ?? ''), que?.convoId ?? null));
  rad.handle('canvas:restaurar', (id) => lienzo.store.restore(String(id ?? '')) ?? null);
  // Se borró un chat: sus canvas quedan sueltos, en la biblioteca.
  rad.handle('canvas:huerfanos', (chats) => { for (const c of Array.isArray(chats) ? chats : []) lienzo.store.orphanConversation(String(c)); return { ok: true }; });
  rad.handle('canvas:exportar', async (c) => {
    let nombre = lienzo.nombreDeExport({ title: c?.title, kind: c?.kind, language: c?.language });
    // un canvas que ya se llama «sum.js» no sale como «sum.js.js»
    const ext = path.extname(nombre);
    if (ext && nombre.slice(0, -ext.length).toLowerCase().endsWith(ext.toLowerCase())) nombre = nombre.slice(0, -ext.length);
    try {
      let destino;
      if (taller) {
        // en el humo no se abre un diálogo: va a una carpeta de la corrida
        destino = path.join(taller, 'exports', nombre);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
      } else {
        const { dialog, BrowserWindow } = require('electron');
        const ventana = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const r = await dialog.showSaveDialog(ventana, { title: 'Export canvas', defaultPath: nombre });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        destino = r.filePath;
      }
      await fs.promises.writeFile(destino, String(c?.content ?? ''), 'utf8');
      return { ok: true, path: destino };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
  rad.handle('chat:confirmar', (respuesta) => {
    const { callId, permitir, confiar, chat } = respuesta ?? {};
    const resolver = pendientes.get(callId);
    if (!resolver) return { ok: false };
    if (permitir === true && confiar === true && chat) confiados.add(String(chat));
    resolver(permitir === true);
    return { ok: true };
  });

  // ---------- Los modelos ----------
  const veniceGuardado = () => (llave.SIMULADO ? simulado.VENICE : rad.store.read(DOC_VENICE) ?? { lista: [], inicial: '' });
  const proveedores = () => {
    const v = veniceGuardado();
    return {
      proveedores: [
        { id: 'anthropic', nombre: NOMBRES.anthropic, modelos: anthropic.MODELOS, inicial: anthropic.MODELO_INICIAL },
        { id: 'venice', nombre: NOMBRES.venice, modelos: v.lista ?? [], inicial: v.inicial ?? '' },
      ],
    };
  };

  // Trae la lista de Venice y avisa. Solo si hay una llave de Venice: sin
  // ella nadie va a usar esos modelos, y la app no llama a nadie por las dudas.
  let trayendo = false;
  async function traerVenice({ forzar = false } = {}) {
    if (llave.SIMULADO || trayendo) return;
    const key = llave.leer(rad.store, 'venice');
    if (!key) return;
    const guardado = rad.store.read(DOC_VENICE);
    if (!forzar && guardado?.lista?.length && guardado.formato === FORMATO_VENICE && Date.now() - (guardado.cuando ?? 0) < VENCE_MS) return;
    trayendo = true;
    try {
      const nuevo = await venice.modelos({ key, signal: AbortSignal.timeout(ESPERA_MODELOS_MS) });
      if (nuevo.lista.length) {
        await rad.store.write(DOC_VENICE, { ...nuevo, formato: FORMATO_VENICE, cuando: Date.now() });
        rad.send('chat:modelos', proveedores());
      }
    } catch (err) {
      console.warn(`[blackcode] no se pudo traer la lista de modelos de Venice: ${err.message}`);
    } finally {
      trayendo = false;
    }
  }

  rad.handle('chat:modelos', () => {
    traerVenice(); // en segundo plano: el arranque no espera a la red
    return proveedores();
  });

  // ---------- El pedido ----------
  rad.handle('chat:enviar', (crudo) => {
    const pedido = limpiar(crudo);
    // Un turno que se dijo y que se va a contestar en voz alta: el agente lo
    // sabe, así contesta para ser oído (corto, sin markdown).
    if (pedido.voz && voz.hablaActiva()) pedido.instrucciones = [pedido.instrucciones, require('./voz.cjs').VOICE_NOTE].filter(Boolean).join('\n\n');
    const avisar = (tipo, extra = {}) => rad.send('chat:evento', { id: pedido.id, tipo, ...extra });
    const control = new AbortController();
    activos.set(pedido.id, control);

    // Las tools, si el agente las tiene prendidas y el modelo las acepta (un
    // modelo de Venice que no las soporta conversa como siempre).
    const elModelo = proveedores().proveedores.find((p) => p.id === pedido.proveedor)?.modelos.find((m) => m.id === pedido.modelo);
    // Un modelo que no ve no recibe las imágenes adjuntas: el proveedor
    // rebotaría el pedido entero. Quedan en el chat, y el modelo se entera de
    // que estaban (así no contesta como si no le hubieran mandado nada).
    const ve = pedido.proveedor === 'anthropic' || elModelo?.vision === true;
    // Las imágenes que el usuario adjuntó en este chat, en orden. Un agente
    // con generate_image las puede editar, y para eso cada una tiene un
    // número: se lo dice una nota al pie del mensaje que la trajo (así no
    // las cuenta a ojo). No se copian a ningún lado: la tool las toma de
    // acá (run.adjuntas), y sirve también con un modelo que no ve.
    const adjuntas = pedido.mensajes.flatMap((m) => (m.rol === 'user' && Array.isArray(m.imagenes) ? m.imagenes : []));
    if (adjuntas.length && pedido.tools.includes('generate_image') && elModelo?.tools !== false) {
      let n = 0;
      pedido.mensajes = pedido.mensajes.map((m) => {
        if (m.rol !== 'user' || !m.imagenes?.length) return m;
        const marcas = m.imagenes.map(() => `attachment:${++n}`);
        const nota = `[For generate_image, the image${marcas.length === 1 ? '' : 's'} attached to this message ${marcas.length === 1 ? 'is' : 'are'} ${marcas.join(', ')}.]`;
        return { ...m, texto: m.texto.trim() ? `${m.texto}\n\n${nota}` : nota };
      });
    }
    if (!ve) {
      pedido.mensajes = pedido.mensajes.map((m) => {
        if (!m.imagenes?.length) return m;
        const n = m.imagenes.length;
        const nota = `[${n} image${n === 1 ? ' was' : 's were'} attached to this message, but this model cannot see images.]`;
        return { rol: m.rol, texto: m.texto.trim() ? `${m.texto}\n\n${nota}` : nota };
      });
    }
    let sesion = null;
    if (pedido.tools.length && elModelo?.tools !== false) {
      sesion = herramientas.crearSesion({
        reqId: pedido.id,
        convoId: pedido.chat,
        ac: control,
        // la carpeta de ESTE chat; si ya no existe, la de inicio
        cwd: esCarpeta(pedido.carpeta) ? pedido.carpeta : carpetaInicio,
        // un modelo sin ojos no puede usar una captura: la imagen le llegaría
        // igual y el proveedor rebotaría el pedido entero. Los de Anthropic ven
        // todos; uno de Venice, solo si Venice lo declara (ante la duda, no:
        // no ofrecerla a uno que ve solo le quita una tool)
        tools: pedido.proveedor === 'anthropic' || elModelo?.vision === true ? pedido.tools : pedido.tools.filter((n) => n !== 'screen_capture'),
        // (las tools de un servidor MCP con «preguntar» piden permiso también en automático)
        // …y agendar o borrar una tarea pide permiso SIEMPRE: ni el modo automático ni «no preguntar más en este chat» lo saltean
        confirma: (name, args) => (name === 'schedule' && herramientas.agendaPide(args)) || ((pedido.modo !== 'auto' || mcp.pregunta(name)) && !confiados.has(pedido.chat)),
        // los runners avisan sin saber su callId: se lo pone la corrida
        notify(canal, datos) {
          const callId = datos.callId ?? this._callId;
          // (`sub`: la corrió un subagente, y cuelga de esa fila de delegate)
          if (canal === 'tool:activity') avisar('tool', { callId, kind: datos.kind, label: datos.label, ...(datos.sub ? { sub: datos.sub, subN: datos.subN || 0 } : {}) });
          else if (canal === 'tool:result') avisar('tool-fin', { callId, status: datos.status, ms: datos.ms, out: datos.out, outCut: datos.outCut });
          else if (canal === 'canvas:opened') avisar('canvas', { canvas: datos.canvas });
          else if (canal === 'tool:artifact') avisar('tool-imagenes', { callId, imagenes: (datos.images || []).slice(0, IMAGENES_MAX), ...(datos.detalle && typeof datos.detalle === 'object' ? { detalle: datos.detalle } : {}) });
        },
        // La tarjeta: se le manda a la interfaz qué se va a correr (y, si es
        // un archivo, qué cambia) y se espera la respuesta. Un Stop la cierra.
        // (`quien`: { sub } si la pide un subagente, para que la tarjeta lo diga)
        async confirm(name, args, callId, quien = null) {
          if (control.signal.aborted) return 'abort';
          const vista = await herramientas.vistaPrevia(sesion.run, name, args);
          return new Promise((resolve) => {
            const alFrenar = () => { pendientes.delete(callId); resolve('abort'); };
            control.signal.addEventListener('abort', alFrenar, { once: true });
            pendientes.set(callId, (permitir) => {
              control.signal.removeEventListener('abort', alFrenar);
              pendientes.delete(callId);
              resolve(permitir);
            });
            avisar('confirmar', { callId, name, label: String(name).startsWith('mcp_') ? '' : herramientas.argsDigest(name, args), args: recortar(args), vista, ...(quien?.sub ? { sub: quien.sub } : {}) });
          });
        },
      });
      // ¿este modelo acepta imágenes? Lo usa la foto de browser_read
      sesion.run.ve = ve;
      // las imágenes adjuntas del chat, para editarlas (generate_image con input_images)
      sesion.run.adjuntas = adjuntas;
      // de qué agente es este turno: una tarea que agende queda a su nombre
      sesion.run.agente = pedido.agente;
      // lo que un subagente hereda de esta corrida, y con qué modelo va a
      // hablar (se lo dice la guía de delegate)
      Object.assign(sesion.run, { proveedor: pedido.proveedor, modelo: pedido.modelo, instrucciones: pedido.instrucciones });
      if (sesion.nombres.includes('delegate')) {
        const d = destinoDeSubagentes(sesion.run);
        sesion.run.etiquetaSubagente = d.mismo ? 'the same model as you' : `running on ${d.modelo || '(no model chosen)'} via ${d.nombre}`;
      }
      if (!sesion.activa) sesion = null;
    }
    // La memoria, si el agente la tiene prendida: su Core y su lista van en el
    // system. Se arma UNA vez, al empezar el turno (lo que el agente anote en
    // este turno ya lo sabe: lo acaba de escribir). Con tools, la lleva la
    // corrida; sin tools (un modelo que no las acepta), va con las instrucciones.
    if (pedido.memoria) {
      const bloque = memoria.bloque({ recall: sesion?.nombres.includes('recall') === true, remember: sesion?.nombres.includes('remember') === true });
      if (sesion) sesion.run.memoria = bloque;
      else if (bloque) pedido.instrucciones = [pedido.instrucciones, bloque].filter(Boolean).join('\n\n');
    }
    // Las skills: su índice va en el system del agente que puede cargarlas (la
    // tool `skill`). Sin tools no hay cómo leer el cuerpo de una, así que no va.
    if (sesion?.nombres.includes('skill')) sesion.run.skills = skills.bloque();
    // (con dónde quedó parado el agente: la interfaz lo guarda con el chat)
    const corrio = () => (sesion ? { tools: sesion.resumen(), agotado: sesion.run.stopped === 'maxrounds', ...(typeof sesion.run.cwd === 'string' ? { carpeta: sesion.run.cwd } : {}) } : {});

    const opciones = {
      signal: control.signal,
      onPensando: () => avisar('pensando'),
      onTexto: (texto) => avisar('texto', { texto }),
      sesion,
    };
    let trabajo;
    // (recién acá: las instrucciones ya tienen todo lo que el turno les sumó)
    const viaja = hora.paraElProveedor(pedido);
    if (llave.SIMULADO) {
      trabajo = simulado.responder(viaja, opciones);
    } else {
      const key = llave.leer(rad.store, pedido.proveedor);
      trabajo = key
        ? RESPONDER[pedido.proveedor](viaja, { ...opciones, key })
        : Promise.reject(new Error(`The ${NOMBRES[pedido.proveedor]} key is missing. Paste it in Settings and try again.`));
    }

    // No se espera acá: el invoke vuelve enseguida y lo demás llega por eventos.
    trabajo
      .then((fin) => avisar('fin', { ...fin, ...corrio() }), (err) => avisar('error', { mensaje: err.message, ...corrio() }))
      .finally(() => { activos.delete(pedido.id); });
    return { ok: true };
  });

  // ---------- Una tarea programada, corriendo ----------
  // El mismo camino que un turno de chat, sin nadie mirando: el agente de la
  // tarea (su modelo, sus instrucciones, su memoria y sus skills), un solo
  // mensaje con el pedido, y nada que pida permiso: lo que no puede correr solo
  // no está entre sus tools (motor.cjs). Se corta si el proveedor se queda
  // mudo: sin ese reloj, una respuesta que nunca cierra dejaría colgadas TODAS
  // las tareas hasta reiniciar la app (le pasó a NeonCode). Es de inactividad
  // y no de duración: una búsqueda larga es legítima.
  const TAREA_MUDA_MS = 5 * 60 * 1000;
  async function correrTarea(tarea, { signal }) {
    const agente = (rad.store.read('agentes')?.lista ?? []).find((a) => a.id === tarea.agente);
    if (!agente) return { error: 'The agent of this task no longer exists.' };
    const nombre = String(agente.nombre ?? '');
    if (!RESPONDER[agente.proveedor]) return { agente: nombre, error: 'The provider of that agent is not available.' };
    const elModelo = proveedores().proveedores.find((p) => p.id === agente.proveedor)?.modelos.find((m) => m.id === agente.modelo);
    const ve = agente.proveedor === 'anthropic' || elModelo?.vision === true;
    const control = new AbortController();
    const alFrenar = () => control.abort();
    if (signal.aborted) control.abort(); else signal.addEventListener('abort', alFrenar, { once: true });
    let reloj = null;
    let muda = false;
    const toque = () => { clearTimeout(reloj); reloj = setTimeout(() => { muda = true; control.abort(); }, TAREA_MUDA_MS); };
    const id = 'task-' + tarea.id + '-' + Date.now().toString(36);
    const actuar = tarea.actuar === true;
    const pedido = { id, chat: '', proveedor: agente.proveedor, modelo: agente.modelo, instrucciones: String(agente.instrucciones ?? '').trim(), mensajes: [{ rol: 'user', texto: tarea.prompt, t: Date.now() }], tools: [], modo: 'auto' };
    // Las tools del agente, sin las de un servidor MCP que pregunta antes de
    // cada llamada (acá no hay quién conteste).
    const suyas = mcp.expandir(Array.isArray(agente.tools) ? agente.tools.filter((t) => typeof t === 'string') : []).filter((n) => !mcp.pregunta(n));
    let sesion = null;
    if (suyas.length && elModelo?.tools !== false) {
      sesion = herramientas.crearSesion({
        reqId: id,
        convoId: '',
        ac: control,
        cwd: carpetaInicio,
        tools: ve ? suyas : suyas.filter((n) => n !== 'screen_capture'),
        tarea: { actuar },
        confirma: false,
        // (sin interfaz que mostrar filas: cada aviso cuenta como señal de vida)
        notify() { toque(); },
      });
      sesion.run.ve = ve;
      Object.assign(sesion.run, { proveedor: agente.proveedor, modelo: agente.modelo, instrucciones: pedido.instrucciones });
      if (!sesion.activa) sesion = null;
    }
    const tiene = (t) => Array.isArray(agente.tools) && agente.tools.includes(t);
    if (tiene('remember') || tiene('recall')) {
      const bloque = memoria.bloque({ recall: sesion?.nombres.includes('recall') === true, remember: sesion?.nombres.includes('remember') === true });
      if (sesion) sesion.run.memoria = bloque;
      else if (bloque) pedido.instrucciones = [pedido.instrucciones, bloque].filter(Boolean).join('\n\n');
    }
    if (sesion?.nombres.includes('skill')) sesion.run.skills = skills.bloque();
    // (sin tools, lo que la corrida sabe de sí misma va con las instrucciones)
    if (!sesion) pedido.instrucciones = [pedido.instrucciones, herramientas.notaDeTarea].filter(Boolean).join('\n\n');

    let texto = '';
    let error = null;
    const opciones = { signal: control.signal, onPensando: toque, onTexto: (t) => { texto += t; toque(); }, sesion };
    toque();
    try {
      // (la corrida sabe a qué hora arrancó: la hora va adelante de su encargo)
      const viaja = hora.paraElProveedor(pedido);
      if (llave.SIMULADO) await simulado.responder(viaja, opciones);
      else {
        const key = llave.leer(rad.store, agente.proveedor);
        if (!key) throw new Error('The ' + NOMBRES[agente.proveedor] + ' key is missing. Paste it in Settings.');
        await RESPONDER[agente.proveedor](viaja, { ...opciones, key });
      }
    } catch (err) {
      // (el corte lo declara la app: no se disfraza de error del proveedor)
      if (!muda && !signal.aborted) error = String(err?.message ?? err);
    } finally {
      clearTimeout(reloj);
      signal.removeEventListener('abort', alFrenar);
    }
    if (muda) error = 'It was cut after ' + (TAREA_MUDA_MS / 60000) + ' minutes with no activity from the provider.';
    return {
      agente: nombre,
      salida: texto.trim(),
      // sin interfaz que muestre filas, esto es el único registro de lo que una corrida desatendida ejecutó
      pasos: sesion ? sesion.resumen().map(({ name, args, status }) => ({ name, label: herramientas.argsDigest(name, args), status })) : [],
      error,
      cortada: muda ? 'idle' : signal.aborted ? 'stopped' : sesion?.run.stopped === 'maxrounds' ? 'maxrounds' : null,
    };
  }

  // ---------- Las tareas, para la pestaña Tasks ----------
  const estadoTareas = () => ({ tareas: tareas.lista(), resultados: tareas.resultados(), sinLeer: tareas.sinLeer(), corriendo: tareas.corriendo(), aviso: ultimoAviso });
  rad.handle('tareas:leer', estadoTareas);
  rad.handle('tareas:guardar', (e) => (e?.id ? tareas.cambiar(String(e.id), e) : tareas.agregar({ ...e, de: 'user' })).then((r) => (r.ok ? { ok: true, id: r.tarea.id } : r)));
  rad.handle('tareas:activar', (que) => tareas.activar(String(que?.id ?? ''), que?.activa === true));
  rad.handle('tareas:quitar', (id) => tareas.quitar(String(id ?? '')).then((r) => ({ ok: r.ok })));
  rad.handle('tareas:restaurar', (id) => tareas.restaurar(String(id ?? '')));
  rad.handle('tareas:correr', (id) => { const r = tareas.correrAhora(String(id ?? '')); r.trabajo?.catch(() => {}); return { ok: r.ok, ...(r.error ? { error: r.error } : {}) }; });
  rad.handle('tareas:frenar', () => tareas.frenar());
  rad.handle('tareas:leida', (id) => tareas.marcarLeida(String(id ?? '')));
  rad.handle('tareas:leidas', () => tareas.marcarTodas());
  rad.handle('tareas:quitar-resultado', (id) => tareas.quitarResultado(String(id ?? '')));
  rad.handle('tareas:vaciar', () => tareas.vaciarBandeja());
  rad.handle('tareas:sin-agente', (id) => tareas.alBorrarAgente(String(id ?? '')).then(() => ({ ok: true })));
  // (solo en el humo: corre el reloj de las tareas hacia adelante y late una vez)
  if (taller) rad.handle('tareas:adelantar', async (minutos) => { corrimiento += (Number(minutos) || 0) * 60000; return { corrieron: await tareas.tic() }; });

  // ---------- La bandeja del sistema, para Settings ----------
  rad.handle('bandeja:estado', () => ({ hay: Boolean(rad.tray), visible: rad.tray?.visible() ?? true, icono: rad.tray?.iconOk() ?? false }));
  rad.handle('bandeja:mostrar', () => { rad.tray?.show(); return { ok: Boolean(rad.tray) }; });

  rad.handle('chat:frenar', (id) => {
    activos.get(id)?.abort();
    return { ok: true };
  });

  return {
    // Cambió una llave: si es la de Venice, su lista de modelos se pide ya.
    alCambiarLlave: (proveedor) => { if (proveedor === 'venice') traerVenice({ forzar: true }); },
  };
}

module.exports = { wire };
