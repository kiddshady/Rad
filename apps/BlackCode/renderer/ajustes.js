// La vista de ajustes: una llave por proveedor, y de qué está hecha la app.

import { confirm } from '/@core/modal.js';
import { createSelect, setFieldError, wireControls } from '/@core/controls.js';
import { swapText } from '/@core/motion.js';
import { toast } from '/@core/toast.js';
import { setBusy } from '/@core/busy.js';
import * as llave from './llave.js';
import * as actualizacion from './actualizacion.js';
import * as datosApp from './datos.js';
import { h } from './piezas.js';

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

export function montarAjustes(el, { router }) {

  el.append(h('div', 'dm-pagina', {},
    h('header', 'dm-pagina-cabeza', {}, h('div', '', {}, h('h1', '', {}, 'Settings'), h('p', '', {}, 'What BlackCode needs to talk to the models.'))),
    ...PROVEEDORES.map((p) => tarjetaLlave(p)),
    tarjetaBusqueda(),
    tarjetaTools(),
    tarjetaAcerca()));

  // Al abrir Ajustes se le pregunta a la API por cada llave guardada. Lo que
  // ya contestó (la acepta o la rechaza) no se vuelve a preguntar; lo que no
  // se pudo comprobar, sí.
  const comprobarTodas = () => { for (const p of PROVEEDORES) llave.comprobar(p.id); };
  comprobarTodas();
  router.on('change', ({ id }) => { if (id === 'ajustes') comprobarTodas(); });
}
