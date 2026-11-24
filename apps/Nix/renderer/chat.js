// La vista de chat: a la izquierda el agente y sus chats, a la derecha la
// conversación y el campo para escribir.

import { menuButton, contextMenu } from '/@core/menu.js';
import { reconcile } from '/@core/list.js';
import { openModal, confirm } from '/@core/modal.js';
import { setBusy } from '/@core/busy.js';
import { wireScroll } from '/@core/scroll.js';
import { wireControls, setFieldError } from '/@core/controls.js';
import { swapText, ms, token, opacityNow, cancelAll, whenDone, SAFETY_MS } from '/@core/motion.js';
import * as datos from './datos.js';
import * as llave from './llave.js';
import { pintar } from './markdown.js';
import { abrirAgente } from './agentes.js';
import { filaTool, ponerTool, cuentaTools, abrirPermiso } from './tools.js';
import { h, icono } from './piezas.js';
import { montarCanvas } from './canvas.js';

// Los items que no son un chat ni un mensaje: el lugar vacío de cada lista.
const VACIO = '_vacio';
// Cuánto se puede estar lejos del fondo y seguir «pegado» a lo que llega.
const PEGADO_PX = 48;

/**
 * Relevo de una superficie de texto: lo viejo se esfuma y recién entonces
 * entra lo nuevo, las dos en la misma celda. No es el fundido con calco de
 * una vista entera: la conversación es texto sobre la misma hoja, sin fondo
 * propio que tape, así que entre una y otra se ve la hoja, no un hueco.
 */
function relevar(celda, nuevo) {
  const viejo = celda.querySelector(':scope > :not([data-rad-leaving])');
  if (!viejo) { celda.append(nuevo); return; }
  const from = opacityNow(viejo);
  cancelAll(viejo);
  viejo.setAttribute('data-rad-leaving', '');
  viejo.inert = true;
  const fuera = ms('dur-fast') * from;
  const out = viejo.animate([{ opacity: from }, { opacity: 0 }], { duration: fuera, easing: token('ease-in-out'), fill: 'forwards' });
  let ya = false;
  const quitar = () => { if (!ya) { ya = true; viejo.remove(); } };
  out.finished.then(quitar, quitar);
  setTimeout(quitar, fuera + SAFETY_MS);

  celda.append(nuevo);
  const dentro = ms('dur-base');
  const enter = nuevo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dentro, delay: fuera, easing: token('ease-out'), fill: 'backwards' });
  whenDone(enter, fuera + dentro + SAFETY_MS, () => enter.finish());
}

const NOTAS = {
  frenado: 'Stopped.',
  cortado: 'Left unfinished: Nix was closed while the answer was arriving.',
  largo: 'Cut off here: it reached the maximum length of an answer.',
  rechazo: 'The model declined to answer this.',
};

export function montarChat(el, { router }) {
  el.classList.add('dm-chat');

  // ---------- El lado: agente y chats ----------
  // El selector dice solo el nombre del agente, como un select: con qué
  // modelo habla ya lo dicen la cabecera de la conversación y la barra de
  // estado. (Con el modelo debajo, un nombre largo de Venice se salía del
  // botón por encima del chevron.)
  const agNombre = h('span', 'dm-agente-nombre rad-swap');
  const selector = h('button', 'dm-agente', { type: 'button', 'data-accion': 'agente' }, agNombre, icono('chevron', 'dm-agente-chevron'));
  menuButton(selector, () => [
    ...datos.listaAgentes().map((a) => ({ id: a.id, label: a.nombre, checked: a.id === datos.agenteActual().id, onSelect: () => datos.elegirAgente(a.id) })),
    { separator: true },
    { id: 'nuevo', label: 'New agent', icon: icono('mas').innerHTML, onSelect: async () => { const a = await abrirAgente(); if (a) datos.elegirAgente(a.id); } },
    { id: 'todos', label: 'Manage agents', icon: icono('agentes').innerHTML, onSelect: () => router.go('agentes') },
  ], { matchAnchorWidth: true });

  const nuevo = h('button', 'rad-button dm-nuevo', { type: 'button', 'data-accion': 'nuevo-chat' }, icono('mas'), 'New chat');
  const lista = h('div', 'dm-chats rad-scroll', { role: 'list', 'data-rad-line': 'bottom' });
  wireScroll(lista);
  const lado = h('aside', 'dm-lado', { 'data-rad-chrome': '' }, selector, nuevo, lista);

  // ---------- La conversación ----------
  const titulo = h('h2', 'dm-conv-titulo rad-swap');
  const sub = h('span', 'dm-conv-sub rad-swap');
  // Las tools del agente, a la vista y a un clic: nacen apagadas, y con el
  // interruptor solo en el formulario del agente no había forma de enterarse,
  // desde el chat, de que el modelo no las tenía.
  const toolsTexto = h('span', 'dm-conv-tools-texto rad-swap');
  const botonTools = h('button', 'rad-button dm-conv-tools', { type: 'button', 'data-variant': 'quiet', 'data-accion': 'tools', 'data-rad-tip': 'What this agent can do on this PC', 'data-rad-tip-side': 'bottom' }, icono('tool'), toolsTexto);
  menuButton(botonTools, () => {
    const a = datos.agenteActual();
    const tiene = new Set(datos.toolsDe(a));
    const grupos = datos.gruposTools();
    return [
      ...(datos.modeloConTools(a.proveedor, a.modelo) ? [] : [{ id: 'sin-soporte', label: 'This model does not accept tools', disabled: true }, { separator: true }]),
      ...grupos.map((g) => {
        const prendido = g.tools.some((t) => tiene.has(t));
        return {
          id: g.id,
          label: g.nombre,
          checked: prendido,
          onSelect: () => datos.ponerTools(a.id, prendido ? [...tiene].filter((t) => !g.tools.includes(t)) : [...tiene, ...g.tools]),
        };
      }),
      { separator: true },
      { id: 'todas', label: 'Turn all on', onSelect: () => datos.ponerTools(a.id, grupos.flatMap((g) => g.tools)) },
      { id: 'ninguna', label: 'Turn all off', onSelect: () => datos.ponerTools(a.id, []) },
    ];
  }, { align: 'end' });
  const celda = h('div', 'dm-hilo-celda');

  const irAjustes = h('button', 'rad-button', { type: 'button', 'data-accion': 'ir-ajustes' }, 'Go to Settings');
  irAjustes.addEventListener('click', () => router.go('ajustes'));
  const aviso = h('div', 'dm-aviso', { role: 'status' },
    h('div', 'dm-aviso-in', {}, h('div', 'dm-aviso-caja', {},
      icono('llave'), h('span', 'dm-aviso-texto rad-swap'), irAjustes)));

  const area = h('textarea', 'rad-input dm-area', { rows: '1', spellcheck: 'false', 'aria-label': 'Message', placeholder: 'Write a message' });
  const boton = h('button', 'rad-iconbutton dm-enviar', { type: 'submit', 'data-modo': 'enviar', 'data-rad-tip-side': 'top' },
    h('span', 'dm-enviar-iconos', {}, icono('enviar', 'dm-ic-enviar'), icono('frenar', 'dm-ic-frenar')));
  const redactor = h('form', 'dm-redactor', {}, area, boton);
  // La escena: la conversación y, a su derecha, el panel que esté abierto
  // (el canvas). El panel empuja a la conversación; no la tapa.
  const escena = h('div', 'dm-escena');
  const lienzo = montarCanvas({ escena });
  const conv = h('section', 'dm-conv', {},
    h('header', 'dm-conv-cabeza', { 'data-rad-chrome': '' }, titulo, sub, lienzo.botonBiblioteca, botonTools),
    lienzo.barra, celda, aviso, h('div', 'dm-redactor-caja', {}, redactor));
  escena.append(conv, lienzo.panel);

  el.append(lado, escena);

  // ---------- La lista de chats ----------
  const acciones = (id) => {
    const c = datos.chat(id);
    return c && [
      { id: 'renombrar', label: 'Rename', icon: icono('lapiz').innerHTML, onSelect: () => renombrar(c) },
      { separator: true },
      { id: 'eliminar', label: 'Delete', danger: true, icon: icono('tacho').innerHTML, onSelect: () => eliminar(c) },
    ];
  };

  function renombrar(c) {
    const campo = h('input', 'rad-input', { type: 'text', maxlength: '80', autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true, 'aria-label': 'Chat name' });
    campo.value = c.titulo;
    const caja = h('label', 'rad-field', {}, campo);
    wireControls(caja);
    const guardar = () => {
      if (!campo.value.trim()) { setFieldError(caja, 'Give it a name.'); campo.focus(); return false; }
      datos.renombrarChat(c.id, campo.value);
      return true;
    };
    const modal = openModal({
      title: 'Rename chat',
      body: caja,
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Save', variant: 'primary', onClick: guardar }],
    });
    campo.select();
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      modal.el.querySelector('.rad-button[data-variant="primary"]').click();
    });
  }

  async function eliminar(c) {
    const si = await confirm({
      title: 'Delete this chat?',
      text: `“${c.titulo}” and all its messages will be deleted. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (si) datos.borrarChat(c.id);
  }

  const fila = (c) => {
    if (c.id === VACIO) return h('p', 'dm-chats-vacio', {}, 'No chats with this agent yet.');
    const abrir = h('button', 'dm-fila-abrir', { type: 'button' }, h('span', 'dm-fila-titulo rad-swap'), h('span', 'dm-fila-punto', { 'aria-hidden': 'true' }, h('i')));
    const mas = h('button', 'rad-iconbutton dm-fila-mas', { type: 'button', 'aria-label': 'Chat actions', 'data-rad-tip': 'Actions' }, icono('puntos'));
    const nodo = h('div', 'dm-fila', { role: 'listitem' }, abrir, mas);
    abrir.addEventListener('click', () => datos.elegirChat(nodo.dataset.radKey));
    menuButton(mas, () => acciones(nodo.dataset.radKey), { align: 'end' });
    ponerFila(nodo, c);
    return nodo;
  };
  const ponerFila = (nodo, c) => {
    if (c.id === VACIO) return;
    swapText(nodo.querySelector('.dm-fila-titulo'), c.titulo);
    const actual = datos.chatActual()?.id === c.id;
    if (actual) nodo.setAttribute('aria-current', 'true');
    else nodo.removeAttribute('aria-current');
    nodo.toggleAttribute('data-respondiendo', datos.respondiendo(c.id));
  };
  const dibujarLista = () => {
    const suyos = datos.chatsDe(datos.agenteActual().id);
    reconcile(lista, suyos.length ? suyos : [{ id: VACIO }], { key: (c) => c.id, create: fila, update: ponerFila });
  };
  contextMenu(lista, (e) => {
    const nodo = e.target.closest('.dm-fila');
    return nodo ? acciones(nodo.dataset.radKey) : null;
  });

  // ---------- Los mensajes ----------
  let hilo = null;   // { clave, chatId, doc, scroller, col, pegado }
  let turno = 0;

  const notaDe = (m, chatId) => {
    if (m.estado === 'escribiendo') return !m.texto || datos.pensando(chatId) ? 'Thinking' : 'Writing';
    if (m.estado === 'error') return m.nota || 'Something went wrong and there was no answer.';
    return NOTAS[m.estado] ?? '';
  };

  const mensaje = (m) => {
    if (m.rol === 'tool') return filaTool(m);
    if (m.id === VACIO) {
      const a = datos.agenteActual();
      return h('div', 'dm-vacio', {}, h('strong', '', {}, a.nombre), h('span', '', {}, 'Write something to get started.'));
    }
    const cuerpo = h('div', m.rol === 'user' ? 'dm-msg-cuerpo' : 'dm-msg-cuerpo dm-md');
    const nodo = h('article', 'dm-msg', { 'data-rol': m.rol }, cuerpo);
    if (m.rol === 'assistant') {
      nodo.append(h('div', 'dm-msg-pie', {}, h('div', 'dm-msg-pie-in', {},
        h('span', 'dm-pulso', { 'aria-hidden': 'true' }, h('i')), h('span', 'dm-msg-nota rad-swap'))));
      // El contador de tools del turno: siempre que el turno las tuvo, también
      // cuando no corrió ninguna. Es un dato, no una acusación.
      nodo.append(h('div', 'dm-msg-cuenta', {}, h('div', 'dm-msg-cuenta-in', {}, h('span', 'dm-msg-cuenta-texto rad-swap'))));
    }
    ponerMensaje(nodo, m);
    return nodo;
  };
  const ponerMensaje = (nodo, m) => {
    if (m.rol === 'tool') { ponerTool(nodo, m); return; }
    if (m.id === VACIO) return;
    const cuerpo = nodo.firstElementChild;
    if (m.rol === 'user') {
      if (cuerpo.textContent !== m.texto) cuerpo.textContent = m.texto;
      return;
    }
    pintar(cuerpo, m.texto);
    const estado = m.estado ?? 'ok';
    nodo.dataset.estado = estado;
    const nota = notaDe(m, hilo?.chatId);
    nodo.querySelector('.dm-msg-pie').toggleAttribute('data-abierto', estado !== 'ok');
    if (nota) swapText(nodo.querySelector('.dm-msg-nota'), nota);
    const cuenta = cuentaTools(m);
    if (cuenta) swapText(nodo.querySelector('.dm-msg-cuenta-texto'), cuenta);
    nodo.querySelector('.dm-msg-cuenta').toggleAttribute('data-abierto', Boolean(cuenta) && estado !== 'escribiendo');
    // un tramo de texto que quedó vacío (el agente llamó tools sin escribir
    // nada antes) no ocupa lugar
    nodo.toggleAttribute('data-vacio', !m.texto && estado !== 'escribiendo' && estado !== 'error');
  };

  const alFondo = () => { if (hilo) hilo.scroller.scrollTop = hilo.scroller.scrollHeight; };
  const dibujarMensajes = () => {
    if (!hilo) return;
    const lista2 = hilo.doc?.get().mensajes ?? [];
    reconcile(hilo.col, lista2.length ? lista2 : [{ id: VACIO }], { key: (m) => m.id, create: mensaje, update: ponerMensaje });
    if (hilo.pegado) alFondo();
  };

  // Abre la conversación del chat elegido. Si ya está abierta, la pone al día.
  async function mostrarHilo() {
    const a = datos.agenteActual();
    const c = datos.chatActual();
    const clave = `${a.id}:${c?.id ?? ''}`;
    if (hilo?.clave === clave) { dibujarMensajes(); return; }
    const mio = ++turno;
    const doc = c ? await datos.hilo(c.id) : null;
    if (mio !== turno) return; // mientras cargaba, se eligió otro
    const col = h('div', 'dm-col');
    const scroller = h('div', 'dm-hilo rad-scroll', {}, col);
    wireScroll(scroller);
    hilo = { clave, chatId: c?.id ?? null, doc, scroller, col, pegado: true };
    const este = hilo;
    scroller.addEventListener('scroll', () => {
      este.pegado = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= PEGADO_PX;
    }, { passive: true });
    dibujarMensajes();
    relevar(celda, scroller);
    alFondo();
  }

  // El texto que llega: un pintado por cuadro, por más pedazos que lleguen.
  let pendiente = null;
  const alTexto = ({ chat, mensaje: m }) => {
    if (!hilo || hilo.chatId !== chat) return;
    if (pendiente) { pendiente.m = m; return; }
    pendiente = { m };
    requestAnimationFrame(() => {
      const { m: ultimo } = pendiente;
      pendiente = null;
      const nodo = hilo?.col.querySelector(`[data-rad-key="${ultimo.id}"]`);
      if (!nodo) return;
      ponerMensaje(nodo, ultimo);
      if (hilo.pegado) alFondo();
    });
  };

  // ---------- El campo para escribir ----------
  const ALTO_MAX = 220;
  const ajustarAlto = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, ALTO_MAX)}px`;
  };
  const ponerRedactor = () => {
    const c = datos.chatActual();
    const ocupado = Boolean(c && datos.respondiendo(c.id));
    boton.dataset.modo = ocupado ? 'frenar' : 'enviar';
    const rotulo = ocupado ? 'Stop' : 'Send';
    boton.setAttribute('aria-label', rotulo);
    boton.setAttribute('data-rad-tip', rotulo);
    boton.disabled = !ocupado && !area.value.trim();
    setBusy(redactor, ocupado);
  };

  async function mandar() {
    const texto = area.value;
    if (!texto.trim()) return;
    let c = datos.chatActual();
    if (c && datos.respondiendo(c.id)) return;
    if (!c) c = datos.crearChat(datos.agenteActual().id);
    area.value = '';
    ajustarAlto();
    if (hilo) hilo.pegado = true;
    await datos.enviar(c.id, texto);
  }

  redactor.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = datos.chatActual();
    if (c && datos.respondiendo(c.id)) datos.frenar(c.id);
    else mandar();
  });
  area.addEventListener('keydown', (e) => {
    // Enter manda; con Shift baja de renglón.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    mandar();
  });
  area.addEventListener('input', () => { ajustarAlto(); ponerRedactor(); });

  nuevo.addEventListener('click', () => {
    // Si el chat abierto todavía está vacío, ese ya es el chat nuevo.
    const c = datos.chatActual();
    if (!c || c.cuenta > 0) datos.crearChat(datos.agenteActual().id);
    area.focus();
  });

  // ---------- Poner todo al día ----------
  const ponerCabeza = () => {
    const a = datos.agenteActual();
    const c = datos.chatActual();
    swapText(agNombre, a.nombre);
    selector.setAttribute('aria-label', `Agent: ${a.nombre}`);
    swapText(titulo, c?.titulo ?? 'New chat');
    swapText(sub, `${a.nombre} · ${datos.modeloDe(a)}`);
    const n = datos.toolsQueViajan(a);
    swapText(toolsTexto, n ? `${n} tool${n === 1 ? '' : 's'}` : datos.modeloConTools(a.proveedor, a.modelo) ? 'Tools: off' : 'Tools: not supported');
    botonTools.toggleAttribute('data-prendidas', n > 0);
  };
  // El aviso es por el agente que está abierto: le falta la llave de SU proveedor.
  const ponerAviso = () => {
    const a = datos.agenteActual();
    const falta = llave.falta(a.proveedor);
    if (falta) swapText(aviso.querySelector('.dm-aviso-texto'), `The ${datos.nombreProveedor(a.proveedor)} key is missing: this agent can’t answer without it.`);
    aviso.toggleAttribute('data-abierto', falta);
  };

  datos.on('agentes', () => { ponerCabeza(); ponerAviso(); dibujarMensajes(); });
  datos.on('modelos', ponerCabeza);
  datos.on('seleccion', () => lienzo.alCambiarDeChat());
  datos.on('chats', () => lienzo.alCambiarDeChat());
  lienzo.alCambiarDeChat();
  datos.on('chats', () => { ponerCabeza(); dibujarLista(); });
  datos.on('seleccion', () => { ponerCabeza(); ponerAviso(); dibujarLista(); mostrarHilo(); ponerRedactor(); });
  datos.on('mensajes', ({ chat }) => { if (hilo?.chatId === chat) dibujarMensajes(); });
  datos.on('texto', alTexto);
  datos.on('respuesta', ({ chat }) => {
    dibujarLista();
    ponerRedactor();
    if (hilo?.chatId === chat) dibujarMensajes();
  });
  llave.on(ponerAviso);

  // La tarjeta de permiso: una tool del chat que se está viendo pide correr.
  let tarjeta = null;
  const ponerTarjeta = () => {
    const c = datos.chatActual();
    const pide = c ? datos.confirmacion(c.id) : null;
    if (tarjeta && tarjeta.callId !== pide?.callId) { tarjeta.cerrar(); tarjeta = null; }
    if (pide && !tarjeta) tarjeta = abrirPermiso(c.id, pide);
  };
  datos.on('confirmar', ponerTarjeta);
  datos.on('seleccion', ponerTarjeta);

  ponerCabeza();
  dibujarLista();
  mostrarHilo();
  ponerRedactor();
  ponerAviso();
}
