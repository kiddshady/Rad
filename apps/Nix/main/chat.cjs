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
//     tipo 'tool-imagenes' { callId, imagenes }            dejó imágenes: [{ name, dataUrl }]
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
const ROLES = new Set(['user', 'assistant']);

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
  const { id, chat = '', proveedor = 'anthropic', modelo, instrucciones, mensajes, tools = [], modo = 'manual' } = pedido ?? {};
  if (typeof id !== 'string' || !id) throw new Error('[nix] el pedido no trae id');
  if (!RESPONDER[proveedor]) throw new Error(`[nix] proveedor desconocido: ${JSON.stringify(proveedor)}`);
  if (typeof modelo !== 'string' || !modelo) throw new Error('[nix] el pedido no trae modelo');
  if (!Array.isArray(mensajes) || !mensajes.length) throw new Error('[nix] el pedido no trae mensajes');
  // Las filas de tools de los turnos anteriores (rol 'tool') viajan plegadas:
  // un mensaje de la app, justo antes de la respuesta que las siguió, con qué
  // corrió y cómo terminó. Es la evidencia entre turnos: sin ella, la única
  // memoria que el modelo tiene de lo que hizo es su propia prosa.
  const lista = herramientas.plegar(mensajes
    .filter((m) => m && (m.rol === 'tool' ? typeof m.tool === 'string' : ROLES.has(m.rol) && typeof m.texto === 'string' && m.texto.trim()))
    .map((m) => (m.rol === 'tool'
      ? { role: 'tool', tool: m.tool, content: String(m.texto ?? ''), status: m.estado }
      : { role: m.rol, content: m.texto })))
    .map((m) => ({ rol: m.role, texto: m.content }));
  if (!lista.length || lista[0].rol !== 'user') throw new Error('[nix] el chat tiene que empezar con un mensaje del usuario');
  return {
    id,
    chat: String(chat ?? ''),
    proveedor,
    modelo,
    instrucciones: typeof instrucciones === 'string' ? instrucciones.trim() : '',
    mensajes: lista,
    tools: Array.isArray(tools) ? tools.filter((t) => typeof t === 'string') : [],
    modo: modo === 'auto' ? 'auto' : 'manual',
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
  // El canvas: los títulos de los chats (para su biblioteca) salen del
  // documento que guarda la interfaz, y cuando el agente borra uno se avisa
  // fuera del turno (el panel puede estar mirando otro chat).
  const paraElCanvas = {
    titulosDeChats: () => new Map((rad.store.read('chats')?.lista ?? []).map((c) => [c.id, c.titulo])),
    avisar: (canal, datos) => { if (canal === 'canvas:deleted') rad.send('canvas:evento', { tipo: 'borrado', convoId: datos?.convoId ?? null, canvas: datos?.canvas ?? null }); },
  };
  // run_code dejó imágenes: van a la fila de esa llamada, en el chat.
  const alProducir = (run, imagenes) => run.notify('tool:artifact', { images: imagenes });
  if (taller) {
    fs.mkdirSync(path.join(taller, '.trash'), { recursive: true });
    const abiertos = path.join(taller, '.opened.log');
    const anotar = (que) => fs.promises.appendFile(abiertos, `${que}\n`);
    herramientas.iniciar({
      carpeta: taller,
      alProducir,
      ...paraElCanvas,
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
    herramientas.iniciar({ carpeta, alProducir, trash: (ruta) => shell.trashItem(ruta), shell, capturador: desktopCapturer, pantallas: screen, ...paraElCanvas });
    herramientas.setCwd(rad.store.read(DOC_TOOLS)?.carpeta);
  }
  // Al salir, lo que quedó corriendo en segundo plano se mata.
  require('electron').app.on('before-quit', () => herramientas.cerrar());
  const guardarCarpeta = () => {
    const carpeta = herramientas.getCwd();
    if (!taller && rad.store.read(DOC_TOOLS)?.carpeta !== carpeta) rad.store.write(DOC_TOOLS, { carpeta }).catch(() => {});
  };
  const pendientes = new Map(); // callId -> resolver de la tarjeta que espera
  // Los chats donde el usuario tildó «no preguntar más». En memoria: al
  // reabrir la app, vuelve a preguntar.
  const confiados = new Set();
  const recortar = (args) => Object.fromEntries(Object.entries(args || {}).map(([k, v]) => {
    const t = typeof v === 'string' ? v : JSON.stringify(v);
    return [k, t.length > ARG_MAX ? `${t.slice(0, ARG_MAX)}… (${t.length - ARG_MAX} more characters)` : t];
  }));

  rad.handle('chat:tools', () => herramientas.catalogo());

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
      console.warn(`[nix] no se pudo traer la lista de modelos de Venice: ${err.message}`);
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
    const avisar = (tipo, extra = {}) => rad.send('chat:evento', { id: pedido.id, tipo, ...extra });
    const control = new AbortController();
    activos.set(pedido.id, control);

    // Las tools, si el agente las tiene prendidas y el modelo las acepta (un
    // modelo de Venice que no las soporta conversa como siempre).
    const elModelo = proveedores().proveedores.find((p) => p.id === pedido.proveedor)?.modelos.find((m) => m.id === pedido.modelo);
    let sesion = null;
    if (pedido.tools.length && elModelo?.tools !== false) {
      sesion = herramientas.crearSesion({
        reqId: pedido.id,
        convoId: pedido.chat,
        ac: control,
        // un modelo sin ojos no puede usar una captura: la imagen le llegaría
        // igual y el proveedor rebotaría el pedido entero. Los de Anthropic ven
        // todos; uno de Venice, solo si Venice lo declara (ante la duda, no:
        // no ofrecerla a uno que ve solo le quita una tool)
        tools: pedido.proveedor === 'anthropic' || elModelo?.vision === true ? pedido.tools : pedido.tools.filter((n) => n !== 'screen_capture'),
        confirma: () => pedido.modo !== 'auto' && !confiados.has(pedido.chat),
        // los runners avisan sin saber su callId: se lo pone la corrida
        notify(canal, datos) {
          const callId = datos.callId ?? this._callId;
          if (canal === 'tool:activity') avisar('tool', { callId, kind: datos.kind, label: datos.label });
          else if (canal === 'tool:result') avisar('tool-fin', { callId, status: datos.status, ms: datos.ms, out: datos.out, outCut: datos.outCut });
          else if (canal === 'canvas:opened') avisar('canvas', { canvas: datos.canvas });
          else if (canal === 'tool:artifact') avisar('tool-imagenes', { callId, imagenes: (datos.images || []).slice(0, IMAGENES_MAX) });
        },
        // La tarjeta: se le manda a la interfaz qué se va a correr (y, si es
        // un archivo, qué cambia) y se espera la respuesta. Un Stop la cierra.
        async confirm(name, args, callId) {
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
            avisar('confirmar', { callId, name, label: herramientas.argsDigest(name, args), args: recortar(args), vista });
          });
        },
      });
      if (!sesion.activa) sesion = null;
    }
    const corrio = () => (sesion ? { tools: sesion.resumen(), agotado: sesion.run.stopped === 'maxrounds' } : {});

    const opciones = {
      signal: control.signal,
      onPensando: () => avisar('pensando'),
      onTexto: (texto) => avisar('texto', { texto }),
      sesion,
    };
    let trabajo;
    if (llave.SIMULADO) {
      trabajo = simulado.responder(pedido, opciones);
    } else {
      const key = llave.leer(rad.store, pedido.proveedor);
      trabajo = key
        ? RESPONDER[pedido.proveedor](pedido, { ...opciones, key })
        : Promise.reject(new Error(`The ${NOMBRES[pedido.proveedor]} key is missing. Paste it in Settings and try again.`));
    }

    // No se espera acá: el invoke vuelve enseguida y lo demás llega por eventos.
    trabajo
      .then((fin) => avisar('fin', { ...fin, ...corrio() }), (err) => avisar('error', { mensaje: err.message, ...corrio() }))
      .finally(() => { activos.delete(pedido.id); if (sesion) guardarCarpeta(); });
    return { ok: true };
  });

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
