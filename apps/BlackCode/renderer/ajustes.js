// La vista de ajustes: una llave por proveedor, y de qué está hecha la app.

import { openModal, confirm } from '/@core/modal.js';
import { reconcile } from '/@core/list.js';
import { createSelect, setFieldError, wireControls } from '/@core/controls.js';
import { swapText } from '/@core/motion.js';
import { toast } from '/@core/toast.js';
import { setBusy } from '/@core/busy.js';
import * as llave from './llave.js';
import * as actualizacion from './actualizacion.js';
import * as datosApp from './datos.js';
import { h, icono } from './piezas.js';

const PROVEEDORES = [
  {
    id: 'anthropic',
    nombre: 'Anthropic',
    texto: 'For agents that use Anthropic models. Create the key in the Console, under API keys, and pick the workspace it will work in.',
    ejemplo: 'sk-ant-…',
    sitio: 'https://console.anthropic.com/settings/keys',
    rotulo: 'Open the Anthropic Console',
  },
  {
    id: 'venice',
    nombre: 'Venice',
    texto: 'For agents that use Venice models. When you save the key, BlackCode loads the current list of models.',
    ejemplo: 'Your Venice API key',
    sitio: 'https://venice.ai/settings/api',
    rotulo: 'Open the Venice API settings',
  },
];

// Con qué busca web_search. DuckDuckGo no pide llave; los otros dos son APIs
// de búsqueda y la suya se guarda acá, cifrada como las de los modelos.
const BUSCADORES = [
  { id: 'duckduckgo', nombre: 'DuckDuckGo' },
  {
    id: 'tavily',
    nombre: 'Tavily',
    conLlave: true,
    texto: 'A search API made for AI agents: it returns the relevant text of each page, not just a title and a summary.',
    ejemplo: 'tvly-…',
    sitio: 'https://tavily.com',
    rotulo: 'Get a Tavily key',
    alQuitar: 'Web searches will fail while Tavily is selected, until you paste another one.',
  },
  {
    id: 'brave',
    nombre: 'Brave',
    conLlave: true,
    texto: 'Brave’s search API, with its own index: titles, summaries and links.',
    ejemplo: 'Your Brave Search API key',
    sitio: 'https://brave.com/search/api/',
    rotulo: 'Get a Brave Search API key',
    alQuitar: 'Web searches will fail while Brave is selected, until you paste another one.',
  },
];

// Por qué la API rechazó una llave, en una frase.
const RECHAZOS = {
  invalida: 'it is invalid, disabled or expired. Create a new one and paste it.',
  'sin-workspace': 'it is not scoped to a workspace. Create a new one and pick the workspace it will work in.',
  'sin-permiso': 'it does not have permission to use the API.',
};

// Qué decir de una llave, y de qué color va el punto. `e` es lo guardado y
// `c` lo que contestó la API cuando se le preguntó por ella. Que esté
// guardada no dice que sirva: el verde es solo para la que la API aceptó
// (o para la de un proveedor que no tiene cómo comprobarse).
function describir(p, e, c) {
  if (e.estado === 'ilegible') return { tono: 'danger', texto: 'A key is saved but it can no longer be read. Paste it again.' };
  if (e.estado !== 'lista') return { tono: 'idle', texto: 'No key saved.' };
  if (!e.seComprueba) return { tono: 'success', texto: `Saved and encrypted on this PC: ${e.pista}` };
  if (c.fase === 'comprobando') return { tono: 'idle', texto: `Saved (${e.pista}). Asking ${p.nombre} whether it accepts it…` };
  if (c.fase === 'aceptada') return { tono: 'success', texto: `${p.nombre} accepts it. Saved and encrypted on this PC: ${e.pista}` };
  if (c.fase === 'rechazada') {
    return { tono: 'danger', texto: `${p.nombre} rejects it (${e.pista}): ${RECHAZOS[c.motivo] ?? 'it did not say why.'}`, detalle: c.detalle };
  }
  if (c.fase === 'sin-comprobar') {
    const porque = c.motivo === 'conexion' ? `there is no connection to ${p.nombre}` : `${p.nombre} did not answer properly`;
    return { tono: 'warning', texto: `Saved (${e.pista}), but it could not be checked: ${porque}. That does not mean it is wrong.`, detalle: c.detalle };
  }
  return { tono: 'idle', texto: `Saved and encrypted on this PC: ${e.pista}` };
}

// Con `sub`, en vez de una tarjeta entera es un bloque para ir adentro de
// otra (las llaves de los buscadores, en la tarjeta de la búsqueda).
function tarjetaLlave(p, { sub = false } = {}) {
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);
  // Lo que dijo la API, tal cual, debajo de la frase: se despliega si hay.
  const detalle = h('span', 'dm-estado-detalle-texto rad-swap');
  const cajaDetalle = h('div', 'dm-estado-detalle', {}, h('div', 'dm-estado-detalle-in', {}, detalle));

  const campo = h('input', 'rad-input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: p.ejemplo, 'data-campo': 'llave' });
  const caja = h('label', 'rad-field', {},
    h('span', 'rad-field-label', {}, 'Paste a key'),
    campo,
    h('span', 'rad-field-hint', {}, 'It is never shown and never leaves this PC: it is stored encrypted with Windows protection.'));
  const guardar = h('button', 'rad-button', { type: 'submit', 'data-variant': 'primary', 'data-accion': 'guardar-llave' }, 'Save');
  const quitar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'quitar-llave' }, 'Remove key');
  const probar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'comprobar-llave' }, 'Check again');
  const sitio = h('button', 'dm-link', { type: 'button' }, p.rotulo);
  sitio.addEventListener('click', () => window.rad.openExternal(p.sitio));
  const acciones = h('div', 'dm-llave-acciones', {}, quitar, guardar);
  const form = h('form', 'dm-llave', {}, caja, acciones);
  wireControls(form);
  const tarjeta = h(sub ? 'div' : 'section', sub ? 'dm-subtarjeta' : 'dm-tarjeta', { 'data-proveedor': p.id },
    h(sub ? 'h3' : 'h2', sub ? 'dm-subtarjeta-nombre' : 'dm-tarjeta-nombre', {}, `${p.nombre} key`),
    h('p', 'dm-tarjeta-instr', {}, p.texto),
    estado, cajaDetalle, form, sitio);

  const poner = () => {
    const e = llave.de(p.id);
    const c = llave.comprobacion(p.id);
    const d = describir(p, e, c);
    estado.dataset.tono = d.tono;
    estado.dataset.llave = e.estado;
    estado.dataset.comprobacion = c.fase;
    estado.dataset.motivo = c.motivo ?? '';
    swapText(texto, d.texto);
    if (d.detalle) swapText(detalle, `${p.nombre} said: “${d.detalle}”`);
    cajaDetalle.toggleAttribute('data-abierto', Boolean(d.detalle));
    quitar.disabled = e.estado === 'falta';
    // Comprobar de nuevo: solo donde hay con qué, y mientras no esté en eso.
    if (e.seComprueba && !probar.isConnected) acciones.prepend(probar);
    probar.disabled = e.estado !== 'lista' || c.fase === 'comprobando';
    // La tarjeta trabaja mientras le pregunta a la API.
    setBusy(tarjeta, c.fase === 'comprobando');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!campo.value.trim()) { setFieldError(caja, 'Paste the key here.'); campo.focus(); return; }
    const r = await llave.guardar(p.id, campo.value);
    if (!r.ok) { setFieldError(caja, r.error); campo.focus(); return; }
    setFieldError(caja, null);
    campo.value = '';
    toast({ text: `${p.nombre} key saved`, kind: 'success' });
  });
  campo.addEventListener('input', () => { if (caja.hasAttribute('data-invalid')) setFieldError(caja, null); });
  probar.addEventListener('click', () => llave.comprobar(p.id, { forzar: true }));
  quitar.addEventListener('click', async () => {
    const si = await confirm({
      title: `Remove the ${p.nombre} key?`,
      text: p.alQuitar ?? 'Agents that use it won’t be able to answer until you paste another one.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!si) return;
    await llave.borrar(p.id);
    toast({ text: `${p.nombre} key removed` });
  });

  poner();
  llave.on(poner);
  return tarjeta;
}

// Qué decir de las actualizaciones, y qué hace el botón en cada momento.
const SIN_SOPORTE = {
  dev: 'Updates only work in the installed app.',
  portable: 'The portable version can’t update itself.',
};
function describirActualizacion(e) {
  const buscar = 'Check for updates';
  if (e.fase === 'buscando') return { texto: 'Checking for updates…', boton: buscar };
  if (e.fase === 'al-dia') return { texto: `You’re on the latest version (${window.rad.app?.version ?? ''}).`, boton: buscar };
  if (e.fase === 'disponible') return { texto: `Version ${e.version} is available.`, boton: 'Download', primario: true };
  if (e.fase === 'bajando') return { texto: 'Downloading the update…', boton: 'Downloading…' };
  if (e.fase === 'lista') return { texto: `Version ${e.version} is ready to install.`, boton: 'Restart and install', primario: true };
  if (e.fase === 'error') {
    const que = e.paso === 'bajar' ? 'The download failed' : 'Could not check for updates';
    return { texto: e.mensaje ? `${que}: ${e.mensaje}` : `${que}.`, boton: buscar };
  }
  if (e.fase === 'sin-soporte') return { texto: SIN_SOPORTE[e.motivo] ?? 'Updates are turned off in this build.', boton: buscar };
  return { texto: 'Check whether a newer version is out.', boton: buscar };
}

// «About»: de qué está hecha la app, y el botón para buscar una versión
// nueva ahora (el núcleo ya busca solo; esto es para no esperarlo). Es un
// solo botón que va cambiando de oficio: buscar, bajar, reiniciar.
function tarjetaAcerca() {
  const datos = h('dl', 'dm-datos');
  const fila = (k, v) => datos.append(h('dt', '', {}, k), h('dd', 'rad-mono', {}, v));
  fila('BlackCode', window.rad.app?.version ?? '');
  fila('Rad core', window.rad.core?.version ?? '');
  fila('Skin', window.rad.skin?.name ?? '');
  fila('Providers', llave.simulado() ? 'Simulated (uses no API)' : PROVEEDORES.map((p) => p.nombre).join(' and '));

  const rotulo = h('span', 'rad-swap');
  const boton = h('button', 'rad-button', { type: 'button', 'data-accion': 'actualizar' }, rotulo);
  const texto = h('span', 'dm-act-texto rad-swap');
  // El porcentaje cambia varias veces por segundo: se escribe en su lugar,
  // sin relevo (un relevo por cada número sería un parpadeo).
  const pct = h('span', 'dm-act-pct rad-mono', { 'aria-hidden': 'true' });
  const estado = h('p', 'dm-act-estado', { role: 'status' }, texto, pct);
  const act = h('div', 'dm-act', {}, boton, estado);
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'acerca' }, h('h2', 'dm-tarjeta-nombre', {}, 'About'), datos, act);

  const poner = () => {
    const e = actualizacion.actual();
    const d = describirActualizacion(e);
    act.dataset.fase = e.fase;
    swapText(texto, d.texto);
    swapText(rotulo, d.boton);
    if (e.fase === 'bajando') pct.textContent = `${e.porciento}%`;
    const ocupado = e.fase === 'buscando' || e.fase === 'bajando';
    boton.disabled = ocupado;
    if (d.primario) boton.setAttribute('data-variant', 'primary');
    else boton.removeAttribute('data-variant');
    // La tarjeta trabaja mientras busca o baja.
    setBusy(tarjeta, ocupado);
  };
  boton.addEventListener('click', () => {
    const { fase } = actualizacion.actual();
    if (fase === 'disponible') actualizacion.descargar();
    else if (fase === 'lista') actualizacion.instalar();
    else actualizacion.buscar();
  });
  poner();
  actualizacion.on(poner);
  return tarjeta;
}

// Las tools: si cada llamada pide permiso. Qué tools tiene cada agente se
// elige en el agente; acá va lo que vale para todos.
// La búsqueda en la web: con qué busca la tool web_search, y la llave de cada
// buscador que la pide. Se pueden cargar las dos y cambiar de uno a otro.
function tarjetaBusqueda() {
  const select = createSelect({
    options: BUSCADORES.map((b) => ({ value: b.id, label: b.conLlave ? b.nombre : `${b.nombre} (no key needed)` })),
    value: datosApp.buscador(),
    onChange: (v) => datosApp.ponerBuscador(v),
  });
  select.el.setAttribute('aria-labelledby', 'dm-buscador-rotulo');
  select.el.dataset.campo = 'buscador';
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'busqueda' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Web search'),
    h('p', 'dm-tarjeta-instr', {}, 'What agents search the web with (the web_search tool). DuckDuckGo needs no key. Tavily and Brave are search APIs: save a key for the ones you have and pick which one to use.'),
    h('div', 'rad-field dm-buscador', {}, h('span', 'rad-field-label', { id: 'dm-buscador-rotulo' }, 'Search with'), select.el),
    estado,
    ...BUSCADORES.filter((b) => b.conLlave).map((b) => tarjetaLlave(b, { sub: true })));
  wireControls(tarjeta);
  const poner = () => {
    const id = datosApp.buscador();
    if (select.value !== id) select.value = id;
    const b = BUSCADORES.find((x) => x.id === id);
    tarjeta.dataset.buscador = id;
    if (!b.conLlave) {
      estado.dataset.tono = 'success';
      swapText(texto, 'Agents search with DuckDuckGo. It reads its results page, so it may ask for a human check if they search a lot.');
    } else if (llave.de(id).estado === 'lista') {
      estado.dataset.tono = 'success';
      swapText(texto, `Agents search with ${b.nombre}.`);
    } else {
      estado.dataset.tono = 'warning';
      swapText(texto, `There is no ${b.nombre} key saved: web searches will fail until you add one below, or pick another.`);
    }
  };
  poner();
  datosApp.on('ajustes', poner);
  llave.on(poner);
  return tarjeta;
}

// Los subagentes: con qué modelo corre lo que un agente le pasa a la tool
// delegate. De fábrica, el mismo del agente; se puede elegir uno más barato o
// más rápido para todos. Cada proveedor tiene su select de modelos, los dos en
// la misma celda (como en el formulario de un agente), y «el mismo» tiene uno
// apagado que lo dice.
const MISMO = 'mismo';
function tarjetaSubagentes() {
  const celda = h('div', 'dm-modelos');
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);
  const guardar = (proveedor) => {
    const s = selects.get(proveedor);
    datosApp.ponerSubagentes(proveedor === MISMO ? { proveedor: null, modelo: '' } : { proveedor, modelo: s?.select.value ?? '' });
  };
  const proveedor = createSelect({
    options: [{ value: MISMO, label: 'Same as the agent' }, ...datosApp.proveedores().map((p) => ({ value: p.id, label: p.nombre }))],
    value: datosApp.subagentes().proveedor ?? MISMO,
    onChange: (v) => guardar(v),
  });
  proveedor.el.setAttribute('aria-labelledby', 'dm-sub-proveedor');
  proveedor.el.dataset.campo = 'sub-proveedor';

  // Los selects de modelos se arman de nuevo cuando llega la lista de Venice.
  const selects = new Map();
  const armar = () => {
    for (const { select } of selects.values()) select.close();
    selects.clear();
    const mismo = createSelect({ options: [], placeholder: 'The agent’s own model' });
    mismo.el.disabled = true;
    mismo.el.dataset.proveedor = MISMO;
    selects.set(MISMO, { select: mismo, modelos: [] });
    const guardado = datosApp.subagentes();
    for (const p of datosApp.proveedores()) {
      const suyo = guardado.proveedor === p.id && guardado.modelo ? guardado.modelo : null;
      // un modelo que salió de la lista del proveedor se deja a la vista, con su id
      const modelos = suyo && !p.modelos.some((m) => m.id === suyo) ? [{ id: suyo, nombre: suyo }, ...p.modelos] : p.modelos;
      const select = createSelect({
        options: modelos.map((m) => ({ value: m.id, label: m.nombre })),
        value: suyo ?? p.inicial,
        placeholder: 'No models yet',
        onChange: () => guardar(p.id),
      });
      select.el.dataset.proveedor = p.id;
      select.el.disabled = !modelos.length;
      selects.set(p.id, { select, modelos });
    }
    for (const { select } of selects.values()) {
      select.el.setAttribute('aria-labelledby', 'dm-sub-modelo');
      select.el.dataset.campo = 'sub-modelo';
    }
    celda.replaceChildren(...[...selects.values()].map((s) => s.select.el));
  };

  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'subagentes' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Subagents'),
    h('p', 'dm-tarjeta-instr', {}, 'An agent with the delegate tool can hand part of its work to subagents: copies of itself that start with an empty context, work on their own and send back only a report. Up to four run at once. They can only read unless the agent asks for full access, and they cannot start subagents of their own.'),
    h('div', 'dm-subagentes', {},
      h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: 'dm-sub-proveedor' }, 'Run them on'), proveedor.el),
      h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: 'dm-sub-modelo' }, 'Model'), celda)),
    estado);
  wireControls(tarjeta);

  const poner = () => {
    const { proveedor: prov, modelo } = datosApp.subagentes();
    const actual = prov ?? MISMO;
    if (proveedor.value !== actual) proveedor.value = actual;
    for (const [id, { select }] of selects) {
      const activo = id === actual;
      select.el.toggleAttribute('data-activo', activo);
      select.el.inert = !activo;
      if (!activo) select.close();
    }
    tarjeta.dataset.subagentes = actual;
    if (!prov) {
      estado.dataset.tono = 'success';
      swapText(texto, 'Subagents run on the same model as the agent that starts them.');
      return;
    }
    const s = selects.get(prov);
    const elegido = modelo || s?.select.value || '';
    if (s && elegido && s.select.value !== elegido) s.select.value = elegido;
    const m = s?.modelos.find((x) => x.id === elegido);
    const nombre = datosApp.nombreProveedor(prov);
    if (llave.de(prov).estado !== 'lista') {
      estado.dataset.tono = 'warning';
      swapText(texto, `There is no ${nombre} key saved: delegate will fail until you add one above, or pick another.`);
    } else if (!elegido) {
      estado.dataset.tono = 'warning';
      swapText(texto, `${nombre} has no models to choose from yet.`);
    } else if (m?.tools === false) {
      estado.dataset.tono = 'warning';
      swapText(texto, `${m.nombre} cannot use tools, so a subagent could not do any work with it. Pick another model.`);
    } else {
      estado.dataset.tono = 'success';
      swapText(texto, `Subagents run on ${m?.nombre ?? elegido}.`);
    }
  };
  armar();
  poner();
  datosApp.on('ajustes', poner);
  datosApp.on('modelos', () => { armar(); poner(); });
  llave.on(poner);
  return tarjeta;
}

function tarjetaTools() {
  const input = h('input', '', { type: 'checkbox', role: 'switch', id: 'dm-tools-preguntar', 'data-campo': 'preguntar' });
  const nota = h('p', 'dm-tarjeta-instr rad-swap');
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'tools' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Tools'),
    h('p', 'dm-tarjeta-instr', {}, 'An agent with tools can read and write files, run commands and use the web on this PC. Which tools each agent has is set on the agent.'),
    h('label', 'rad-switch', {}, input, h('span', 'rad-switch-track'), 'Ask before each tool call'),
    nota);
  wireControls(tarjeta);
  const poner = () => {
    const manual = datosApp.modoTools() === 'manual';
    input.checked = manual;
    swapText(nota, manual
      ? 'Every call shows you what it is about to do and waits for your answer.'
      : 'Calls run without asking. There is no folder limit and no command filter: an agent can change anything your Windows user can.');
    nota.toggleAttribute('data-vacio', false);
    tarjeta.dataset.modo = manual ? 'manual' : 'auto';
  };
  input.addEventListener('change', () => datosApp.ponerModoTools(input.checked ? 'manual' : 'auto'));
  poner();
  datosApp.on('ajustes', poner);
  return tarjeta;
}

// El nombre de los chats: lo escribe un modelo, o es el comienzo del primer
// mensaje. Es un pedido chico más por chat nuevo, así que se puede apagar.
function tarjetaTitulos() {
  const input = h('input', '', { type: 'checkbox', role: 'switch', id: 'dm-titulos', 'data-campo': 'titulos' });
  const nota = h('p', 'dm-tarjeta-instr rad-swap');
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'titulos' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Chat names'),
    h('p', 'dm-tarjeta-instr', {}, 'A new chat gets its name from its first message. A model can write that name: it reads the first message and the names of the files attached to it, and answers with a short title.'),
    h('label', 'rad-switch', {}, input, h('span', 'rad-switch-track'), 'Let a model name new chats'),
    nota);
  wireControls(tarjeta);
  const poner = () => {
    const si = datosApp.titulosConModelo();
    input.checked = si;
    swapText(nota, si
      ? 'One small extra request for each new chat: Claude Haiku for Anthropic agents, the agent’s own model for Venice agents. A chat you rename yourself keeps your name.'
      : 'A new chat is named with the beginning of its first message.');
  };
  input.addEventListener('change', () => datosApp.ponerTitulosConModelo(input.checked));
  poner();
  datosApp.on('ajustes', poner);
  return tarjeta;
}

// Generar imágenes (la tool generate_image): con qué modelo de Venice, y su
// filtro de contenido adulto. Usa la llave de Venice de más arriba. La tool
// nace apagada en los agentes porque gasta plata: acá se dice.
function tarjetaImagenes() {
  const PREDET = '__venice__';
  const hueco = h('div', 'rad-field dm-img-modelo', {}, h('span', 'rad-field-label', { id: 'dm-img-rotulo' }, 'Model'));
  // Editar una imagen que ya existe lo hacen otros modelos, con otro precio.
  const pistaE = h('span', 'rad-field-hint', {}, 'Used when an agent changes an image that already exists. These are other models, with their own price.');
  const huecoE = h('div', 'rad-field dm-img-modelo', {}, h('span', 'rad-field-label', { id: 'dm-img-rotulo-e' }, 'Model for editing'), pistaE);
  const texto = h('span', 'dm-estado-texto rad-swap');
  const estado = h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), texto);
  const filtro = h('input', '', { type: 'checkbox', role: 'switch', id: 'dm-img-filtro', 'data-campo': 'img-filtro' });
  const nota = h('p', 'dm-tarjeta-instr rad-swap');
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'imagenes' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Image generation'),
    h('p', 'dm-tarjeta-instr', {}, 'An agent with the Images tool makes and edits images with Venice, using the Venice key above, and shows them in the chat. Every image is paid from your Venice balance, so the tool is off on every agent until you turn it on for that agent.'),
    hueco, huecoE, estado,
    h('label', 'rad-switch', {}, filtro, h('span', 'rad-switch-track'), 'Blur adult content'),
    nota);
  wireControls(tarjeta);
  let select = null;
  let selectE = null;
  let lista = [];
  let listaE = [];
  let turno = 0;
  const precio = (m) => (typeof m.precio === 'number' ? ` · $${m.precio.toFixed(2)} per image` : '');
  const armar = () => {
    select?.close();
    select?.el.remove();
    const guardado = datosApp.ajustesImagenes().modelo;
    // un modelo que salió de la lista de Venice se deja a la vista, con su id
    const modelos = guardado && !lista.some((m) => m.id === guardado) ? [{ id: guardado, nombre: guardado }, ...lista] : lista;
    select = createSelect({
      options: [{ value: PREDET, label: 'Venice’s default' }, ...modelos.map((m) => ({ value: m.id, label: `${m.nombre}${precio(m)}` }))],
      value: guardado || PREDET,
      onChange: (v) => datosApp.ponerImagenes({ modelo: v === PREDET ? '' : v }),
    });
    select.el.setAttribute('aria-labelledby', 'dm-img-rotulo');
    select.el.dataset.campo = 'img-modelo';
    select.el.disabled = !lista.length;
    hueco.append(select.el);
    selectE?.close();
    selectE?.el.remove();
    const guardadoE = datosApp.ajustesImagenes().modeloEdicion;
    const modelosE = guardadoE && !listaE.some((m) => m.id === guardadoE) ? [{ id: guardadoE, nombre: guardadoE }, ...listaE] : listaE;
    selectE = createSelect({
      options: [{ value: PREDET, label: 'Venice’s default' }, ...modelosE.map((m) => ({ value: m.id, label: `${m.nombre}${typeof m.precio === 'number' ? ` · $${m.precio.toFixed(2)} per edit` : ''}` }))],
      value: guardadoE || PREDET,
      onChange: (v) => datosApp.ponerImagenes({ modeloEdicion: v === PREDET ? '' : v }),
    });
    selectE.el.setAttribute('aria-labelledby', 'dm-img-rotulo-e');
    selectE.el.dataset.campo = 'img-modelo-edicion';
    selectE.el.disabled = !listaE.length;
    huecoE.insertBefore(selectE.el, pistaE);
  };
  const cargar = async () => {
    const mio = ++turno;
    const r = await window.rad.invoke('imagenes:modelos', true).catch(() => null);
    if (mio !== turno) return;
    lista = r?.ok ? r.modelos : [];
    listaE = r?.ok && Array.isArray(r.edicion) ? r.edicion : [];
    armar();
    tarjeta.dataset.modelos = String(lista.length);
    tarjeta.dataset.edicion = String(listaE.length);
    if (r?.ok && lista.length) { estado.dataset.tono = 'success'; swapText(texto, `Venice offers ${lista.length} image model${lista.length === 1 ? '' : 's'} with your key.`); }
    else if (llave.de('venice').estado !== 'lista') { estado.dataset.tono = 'warning'; swapText(texto, 'There is no Venice key saved: add one above to generate images.'); }
    else { estado.dataset.tono = 'danger'; swapText(texto, `Could not load the image models: ${r?.error ?? 'Venice lists none for this key'}.`); }
  };
  const poner = () => {
    const a = datosApp.ajustesImagenes();
    filtro.checked = a.filtro;
    swapText(nota, a.filtro
      ? 'Venice blurs an image when it classes it as adult content.'
      : 'Images come back as generated, without Venice’s adult content blur. Venice’s own terms still apply.');
    if (select && select.value !== (a.modelo || PREDET)) select.value = a.modelo || PREDET;
    if (selectE && selectE.value !== (a.modeloEdicion || PREDET)) selectE.value = a.modeloEdicion || PREDET;
  };
  // (el agente no puede tocar este filtro: no es un parámetro de la tool)
  filtro.addEventListener('change', () => datosApp.ponerImagenes({ filtro: filtro.checked }));
  armar();
  poner();
  cargar();
  datosApp.on('ajustes', poner);
  llave.on(cargar);
  return tarjeta;
}

// La carpeta de inicio: donde arranca un chat nuevo. Después cada chat
// recuerda la suya (se ve y se cambia debajo del campo para escribir).
function tarjetaCarpeta() {
  const ruta = h('span', 'dm-carpeta-inicio rad-mono rad-swap');
  const cambiar = h('button', 'rad-button', { type: 'button', 'data-accion': 'carpeta-inicio' }, 'Change…');
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'carpeta' },
    h('h2', 'dm-tarjeta-nombre', {}, 'Working folder'),
    h('p', 'dm-tarjeta-instr', {}, 'Where a new chat starts. After that each chat keeps its own folder: when an agent moves with cd, only that chat moves. The terminal opens where the chat on screen is.'),
    h('div', 'dm-carpeta-inicio-fila', {}, ruta, cambiar));
  const poner = () => swapText(ruta, datosApp.carpetaInicio());
  cambiar.addEventListener('click', async () => {
    const elegida = await window.rad.invoke('chat:elegir-carpeta', datosApp.carpetaInicio()).catch(() => null);
    if (!elegida) return;
    const r = await datosApp.ponerCarpetaInicio(elegida);
    if (!r?.ok) toast({ text: r?.error ?? 'Could not change the folder.', kind: 'danger' });
  });
  poner();
  datosApp.on('ajustes', poner);
  return tarjeta;
}

// Los servidores MCP: tools de terceros para los agentes. Un servidor es un
// comando que corre en esta PC (stdio) o una dirección (HTTP). Sus variables
// de entorno y sus encabezados suelen ser llaves: el proceso principal los
// guarda cifrados y acá solo llegan sus NOMBRES. Al cambiar un servidor, un
// valor escrito como GUARDADO quiere decir «el que ya estaba».
const GUARDADO = '<saved>';
const MCP_VACIO = '_vacio';
const renglones = (t) => String(t ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
/** «NOMBRE=valor» por renglón → { out } o { error }. */
function pares(texto, separador) {
  const out = {};
  for (const l of renglones(texto)) {
    const i = l.search(separador);
    if (i <= 0) return { error: `“${l.slice(0, 40)}” is not a name and a value.` };
    const v = l.slice(i + 1).trim();
    out[l.slice(0, i).trim()] = v === GUARDADO ? null : v;
  }
  return { out };
}
function tarjetaMcp() {
  const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
  const lista = h('div', 'dm-mcp-lista', { role: 'list' });
  const bNuevo = h('button', 'rad-button', { type: 'button', 'data-accion': 'mcp-nuevo' }, 'Add server');
  const bPegar = h('button', 'rad-button', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'mcp-pegar' }, 'Paste JSON');
  const tarjeta = h('section', 'dm-tarjeta', { 'data-tarjeta': 'mcp' },
    h('h2', 'dm-tarjeta-nombre', {}, 'MCP servers'),
    h('p', 'dm-tarjeta-instr', {}, 'An MCP server gives your agents more tools. It is someone else’s code, running on this PC or at a remote address: add only the ones you trust. Its tools are off on every agent until you turn its group on for that agent.'),
    lista,
    h('div', 'dm-mcp-acciones', {}, bNuevo, bPegar));

  // ---------- El formulario ----------
  function abrirServidor(s = null) {
    const campo = (rotulo, control, pista) => h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, rotulo), control, pista ? h('span', 'rad-field-hint', {}, pista) : null);
    const area = (attrs) => h('textarea', 'rad-input rad-mono dm-mcp-area', { spellcheck: 'false', autocomplete: 'off', ...attrs });
    const nombre = h('input', 'rad-input', { type: 'text', maxlength: '60', autocomplete: 'off', spellcheck: 'false', 'data-autofocus': !s, 'data-campo': 'mcp-nombre', placeholder: 'filesystem' });
    const comando = h('input', 'rad-input rad-mono', { type: 'text', maxlength: '400', autocomplete: 'off', spellcheck: 'false', 'data-campo': 'mcp-comando', placeholder: 'npx' });
    const args = area({ rows: '3', 'data-campo': 'mcp-args', placeholder: '-y\n@modelcontextprotocol/server-filesystem\nC:\\Users\\me\\Documents' });
    const env = area({ rows: '2', 'data-campo': 'mcp-env', placeholder: 'API_KEY=value' });
    const url = h('input', 'rad-input rad-mono', { type: 'text', maxlength: '2000', autocomplete: 'off', spellcheck: 'false', 'data-campo': 'mcp-url', placeholder: 'https://example.com/mcp' });
    const headers = area({ rows: '2', 'data-campo': 'mcp-headers', placeholder: 'Authorization: Bearer value' });
    const preguntar = h('input', '', { type: 'checkbox', role: 'switch', 'data-campo': 'mcp-preguntar' });
    nombre.value = s?.nombre ?? '';
    comando.value = s?.comando ?? '';
    args.value = (s?.args ?? []).join('\n');
    env.value = (s?.env ?? []).map((k) => `${k}=${GUARDADO}`).join('\n');
    url.value = s?.url ?? '';
    headers.value = (s?.headers ?? []).map((k) => `${k}: ${GUARDADO}`).join('\n');
    preguntar.checked = s ? s.preguntar : true;

    const secreto = 'Stored encrypted and never shown again.' + (s ? ` ${GUARDADO} keeps the value already stored.` : '');
    const campos = {
      nombre: campo('Name', nombre),
      comando: campo('Command', comando, 'The program that starts the server: npx, uvx, node, python or a path.'),
      args: campo('Arguments', args, 'One per line.'),
      env: campo('Environment variables', env, `One per line, NAME=value. ${secreto}`),
      url: campo('Address', url, 'An https address. http only for a server on this PC.'),
      headers: campo('Headers', headers, `One per line, Name: value. ${secreto}`),
    };
    const hueco = h('div', 'rad-field', {}, h('span', 'rad-field-label', { id: 'dm-mcp-tipo-rotulo' }, 'Where it runs'));
    const parteLocal = h('div', 'dm-mcp-parte', {}, h('div', 'dm-mcp-parte-in', {}, campos.comando, campos.args, campos.env));
    const parteRemota = h('div', 'dm-mcp-parte', {}, h('div', 'dm-mcp-parte-in', {}, campos.url, campos.headers));
    const ponerTipo = (t) => {
      parteLocal.toggleAttribute('data-abierto', t === 'local');
      parteRemota.toggleAttribute('data-abierto', t === 'remoto');
      parteLocal.inert = t !== 'local';
      parteRemota.inert = t !== 'remoto';
    };
    const tipo = createSelect({
      options: [{ value: 'local', label: 'On this PC (a command)' }, { value: 'remoto', label: 'At a remote address' }],
      value: s?.tipo ?? 'local',
      onChange: ponerTipo,
    });
    tipo.el.setAttribute('aria-labelledby', 'dm-mcp-tipo-rotulo');
    tipo.el.dataset.campo = 'mcp-tipo';
    hueco.append(tipo.el);
    ponerTipo(s?.tipo ?? 'local');
    const form = h('div', 'dm-mcp-form', {}, campos.nombre, hueco, parteLocal, parteRemota,
      h('label', 'rad-switch', {}, preguntar, h('span', 'rad-switch-track'), h('span', 'dm-tools-grupo', {}, 'Ask before each call', h('small', '', {}, 'Its tools wait for your answer, also when tools run without asking.'))));
    wireControls(form);
    const guardar = async () => {
      for (const c of Object.values(campos)) setFieldError(c, null);
      const local = tipo.value === 'local';
      const secretos = local ? pares(env.value, /=/) : pares(headers.value, /[:=]/);
      if (secretos.error) { setFieldError(local ? campos.env : campos.headers, secretos.error); return false; }
      const r = await pedir('mcp:guardar', {
        id: s?.id, nombre: nombre.value, tipo: tipo.value, preguntar: preguntar.checked, activo: s ? s.activo : true,
        ...(local ? { comando: comando.value, args: renglones(args.value), env: secretos.out } : { url: url.value, headers: secretos.out }),
      }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      if (r?.ok) return true;
      const c = campos[r?.campo] ?? campos.nombre;
      setFieldError(c, r?.error ?? 'Could not save the server.');
      c.querySelector('.rad-input')?.focus();
      return false;
    };
    const modal = openModal({
      title: s ? 'Change MCP server' : 'Add MCP server',
      body: form,
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', close: false, onClick: () => { guardar().then((bien) => { if (bien) modal.close('ok'); }); } }],
    });
    return modal;
  }

  // ---------- Pegar el JSON de las instrucciones de un servidor ----------
  function abrirPegar() {
    const texto = h('textarea', 'rad-input rad-mono dm-mcp-json', { rows: '12', spellcheck: 'false', autocomplete: 'off', 'data-autofocus': true, 'data-campo': 'mcp-json',
      placeholder: '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\me\\\\Documents"]\n    }\n  }\n}' });
    const campoJson = h('label', 'rad-field', {}, h('span', 'rad-field-label', {}, 'Configuration'), texto,
      h('span', 'rad-field-hint', {}, 'The "mcpServers" block from a server’s instructions. What comes in "env" and "headers" is stored encrypted. Each server is added set to ask before each call.'));
    const form = h('div', 'dm-mcp-form', {}, campoJson);
    wireControls(form);
    const agregar = async () => {
      setFieldError(campoJson, null);
      const r = await pedir('mcp:pegar', texto.value).catch((e) => ({ agregados: [], errores: [String(e?.message ?? e)] }));
      if (r.agregados?.length) toast({ text: `Added ${r.agregados.join(', ')}.`, kind: 'success' });
      if (!r.errores?.length) return true;
      setFieldError(campoJson, r.errores.join(' '));
      return false;
    };
    const modal = openModal({
      title: 'Paste MCP servers',
      body: form,
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Add', variant: 'primary', close: false, onClick: () => { agregar().then((bien) => { if (bien) modal.close('ok'); }); } }],
    });
    return modal;
  }

  async function quitar(s) {
    const si = await confirm({ title: 'Remove this server?', text: `“${s.nombre}” will be removed from BlackCode, with its stored variables, and from the agents that use it.`, confirmLabel: 'Remove', danger: true });
    if (si) await pedir('mcp:quitar', s.id);
  }

  // ---------- La lista ----------
  const TONOS = { connected: 'success', connecting: 'warning', error: 'danger' };
  const estadoDe = (s) => {
    if (!s.activo) return 'Turned off';
    if (s.estado === 'connected') return `Connected · ${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}${s.cortadas ? ` (${s.cortadas} more are not offered)` : ''}`;
    if (s.estado === 'connecting') return 'Connecting';
    if (s.estado === 'error') return `Could not connect: ${s.error ?? 'unknown error'}`;
    return 'Not connected';
  };
  const dondeDe = (s) => (s.tipo === 'remoto' ? s.url : [s.comando, ...s.args].join(' '));
  const secretosDe = (s) => {
    const nombres = s.tipo === 'remoto' ? s.headers : s.env;
    return nombres.length ? `${s.tipo === 'remoto' ? 'headers' : 'variables'} stored encrypted: ${nombres.join(', ')}` : '';
  };
  const fila = (s) => {
    if (s.id === MCP_VACIO) { const p = h('p', 'dm-memoria-vacia rad-swap'); swapText(p, s.texto); return p; }
    const yo = () => datosApp.mcp().servidores.find((x) => x.id === nodo.dataset.radKey) ?? datosApp.mcp().servidores.find((x) => x.id === s.id);
    const activo = h('input', '', { type: 'checkbox', role: 'switch', 'data-accion': 'mcp-activo' });
    const preguntar = h('input', '', { type: 'checkbox', role: 'switch', 'data-accion': 'mcp-preguntar' });
    const reconectar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'mcp-reconectar', 'aria-label': 'Reconnect', 'data-rad-tip': 'Reconnect' }, icono('recargar'));
    const editar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'mcp-editar', 'aria-label': 'Change', 'data-rad-tip': 'Change' }, icono('lapiz'));
    const borrar = h('button', 'rad-iconbutton', { type: 'button', 'data-accion': 'mcp-quitar', 'aria-label': 'Remove', 'data-rad-tip': 'Remove' }, icono('tacho'));
    const nodo = h('div', 'dm-mcp-fila', { role: 'listitem' },
      h('div', 'dm-mcp-cabeza', {},
        h('div', 'dm-skill-textos', {}, h('span', 'dm-skill-nombre'), h('span', 'dm-mcp-donde rad-mono')),
        reconectar, editar, borrar),
      h('p', 'dm-estado', { role: 'status' }, h('i', 'dm-estado-punto', { 'aria-hidden': 'true' }), h('span', 'dm-estado-texto rad-swap')),
      h('span', 'dm-mcp-tools rad-mono'),
      h('span', 'dm-memoria-de dm-mcp-secretos'),
      h('div', 'dm-mcp-interruptores', {},
        h('label', 'rad-switch', {}, activo, h('span', 'rad-switch-track'), 'On'),
        h('label', 'rad-switch', {}, preguntar, h('span', 'rad-switch-track'), 'Ask before each call')));
    activo.addEventListener('change', () => { const x = yo(); if (x) pedir('mcp:ajustar', { id: x.id, activo: activo.checked }); });
    preguntar.addEventListener('change', () => { const x = yo(); if (x) pedir('mcp:ajustar', { id: x.id, preguntar: preguntar.checked }); });
    reconectar.addEventListener('click', () => { const x = yo(); if (x) pedir('mcp:reconectar', x.id); });
    editar.addEventListener('click', () => { const x = yo(); if (x) abrirServidor(x); });
    borrar.addEventListener('click', () => { const x = yo(); if (x) quitar(x); });
    wireControls(nodo);
    ponerFila(nodo, s);
    return nodo;
  };
  const texto = (el, t) => { if (el.textContent !== t) el.textContent = t; el.hidden = !t; };
  function ponerFila(nodo, s) {
    if (s.id === MCP_VACIO) { swapText(nodo, s.texto); return; }
    nodo.dataset.servidor = s.nombre;
    nodo.dataset.estado = s.activo ? s.estado : 'off';
    texto(nodo.querySelector('.dm-skill-nombre'), s.nombre);
    texto(nodo.querySelector('.dm-mcp-donde'), dondeDe(s));
    const estado = nodo.querySelector('.dm-estado');
    const tono = s.activo ? (TONOS[s.estado] ?? '') : '';
    if (tono) estado.dataset.tono = tono; else delete estado.dataset.tono;
    swapText(estado.querySelector('.dm-estado-texto'), estadoDe(s));
    texto(nodo.querySelector('.dm-mcp-tools'), s.activo && s.estado === 'connected' ? s.tools.join(', ') : '');
    texto(nodo.querySelector('.dm-mcp-secretos'), secretosDe(s));
    const a = nodo.querySelector('[data-accion="mcp-activo"]');
    if (a.checked !== s.activo) a.checked = s.activo;
    const p = nodo.querySelector('[data-accion="mcp-preguntar"]');
    if (p.checked !== s.preguntar) p.checked = s.preguntar;
    nodo.querySelector('[data-accion="mcp-reconectar"]').hidden = !s.activo || s.estado === 'connecting';
    setBusy(nodo, s.activo && s.estado === 'connecting');
  }
  function pintar() {
    const m = datosApp.mcp();
    const orden = [...m.servidores].sort((a, b) => a.nombre.localeCompare(b.nombre));
    reconcile(lista, orden.length ? orden : [{ id: MCP_VACIO, texto: m.disponible ? 'No servers yet.' : 'This build has no MCP support.' }], { key: (s) => s.id, create: fila, update: ponerFila });
    tarjeta.dataset.servidores = String(orden.length);
    bNuevo.disabled = !m.disponible;
    bPegar.disabled = !m.disponible;
  }
  bNuevo.addEventListener('click', () => abrirServidor());
  bPegar.addEventListener('click', () => abrirPegar());
  pintar();
  datosApp.on('mcp', pintar);
  return tarjeta;
}

export function montarAjustes(el, { router }) {

  el.append(h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {}, h('div', '', {}, h('h1', '', {}, 'Settings'), h('p', '', {}, 'What BlackCode needs to talk to the models.'))),
    ...PROVEEDORES.map((p) => tarjetaLlave(p)),
    tarjetaBusqueda(),
    tarjetaTools(),
    tarjetaCarpeta(),
    tarjetaTitulos(),
    tarjetaImagenes(),
    tarjetaMcp(),
    tarjetaSubagentes(),
    tarjetaAcerca()));

  // Al abrir Ajustes se le pregunta a la API por cada llave guardada. Lo que
  // ya contestó (la acepta o la rechaza) no se vuelve a preguntar; lo que no
  // se pudo comprobar, sí.
  const comprobarTodas = () => { for (const p of PROVEEDORES) llave.comprobar(p.id); };
  comprobarTodas();
  router.on('change', ({ id }) => { if (id === 'ajustes') comprobarTodas(); });
}
