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
import { montarNavegador } from './navegador.js';
import { montarTerminal } from './terminal.js';
import { openMenu } from '/@core/menu.js';
import { toast } from '/@core/toast.js';
import { crearAdjuntos, adjuntosDe, ACEPTA } from './adjuntos.js';
import { ponerHora } from './hora.js';

// Los items que no son un chat ni un mensaje: el lugar vacío de cada lista.
const VACIO = '_vacio';
// Cuánto se puede estar lejos del fondo y seguir «pegado» a lo que llega.
const PEGADO_PX = 48;
// Cuánto hay que haber subido para que aparezca el botón de ir al final, y
// cuánto se le da al scroll suave para llegar (después llega de una).
const LEJOS_PX = 140;
const BAJADA_MS = 700;

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
  cortado: 'Left unfinished: BlackCode was closed while the answer was arriving.',
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
  const lista = h('div', 'dm-chats rad-scroll', { 'data-rad-line': 'bottom' });
  wireScroll(lista);
  // Adentro: los chats de siempre y, al fondo de todo, el grupo de los canales
  // (lo que entró solo: lo dicho al Atom Echo). El grupo se pliega, y no ocupa
  // lugar mientras no hay ninguno.
  // Arriba de todo, los chats fijados, en su grupo «Pinned»; los demás quedan
  // debajo, con el rótulo «Recent». Los dos se pliegan. Sin ninguno fijado no
  // hay ni grupo ni rótulos: la lista es la de siempre.
  const hacerGrupo = (nombre, accion) => {
    const cabeza = h('button', 'dm-canales-cabeza', { type: 'button', 'aria-expanded': 'true', 'data-accion': accion }, icono('chevron', 'dm-canales-chev'), h('span', 'dm-canales-nombre', {}, nombre));
    const suLista = h('div', 'dm-chats-lista', { role: 'list' });
    const caja = h('div', 'dm-canales-caja', { 'data-abierto': '' }, h('div', 'dm-canales-in dm-grupo-llano', {}, suLista));
    const rotulo = h('div', 'dm-grupo-rotulo', {}, h('div', 'dm-grupo-rotulo-in', {}, h('div', 'dm-canales-fila', {}, cabeza)));
    cabeza.addEventListener('click', () => datos.ponerGrupoAbierto(accion, !datos.grupoAbierto(accion)));
    return { cabeza, lista: suLista, caja, rotulo };
  };
  const fij = hacerGrupo('Pinned', 'fijados');
  const rec = hacerGrupo('Recent', 'recientes');
  const fijados = h('section', 'dm-canales dm-grupo-arriba', { 'data-grupo': 'fijados', 'data-vacio': '', 'aria-label': 'Pinned' }, h('div', 'dm-canales-todo', {}, fij.rotulo, fij.caja));
  fijados.inert = true;
  rec.rotulo.setAttribute('data-vacio', '');
  rec.rotulo.inert = true;
  const recientes = h('section', 'dm-grupo', { 'data-grupo': 'recientes', 'aria-label': 'Chats' }, rec.rotulo, rec.caja);
  const comunes = rec.lista;
  const delCanal = h('div', 'dm-chats-lista', { role: 'list' });
  const canalesCabeza = h('button', 'dm-canales-cabeza', { type: 'button', 'aria-expanded': 'true', 'data-accion': 'canales', 'data-rad-tip': 'What you said to the Atom Echo, and the answers' },
    icono('chevron', 'dm-canales-chev'), icono('canal'), h('span', 'dm-canales-nombre', {}, 'Channels'));
  const canalesBorrar = h('button', 'rad-iconbutton dm-canales-borrar', { type: 'button', 'aria-label': 'Delete all channel chats', 'data-rad-tip': 'Delete all', 'data-accion': 'canales-borrar' }, icono('tacho'));
  const canalesCaja = h('div', 'dm-canales-caja', { 'data-abierto': '' }, h('div', 'dm-canales-in', {}, delCanal));
  const canales = h('section', 'dm-canales', { 'data-grupo': 'canales', 'data-vacio': '', 'aria-label': 'Channels' }, h('div', 'dm-canales-todo', {}, h('div', 'dm-canales-fila', {}, canalesCabeza, canalesBorrar), canalesCaja));
  canales.inert = true;
  lista.append(fijados, recientes, canales);
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
      // «Todas» son las de siempre: un grupo opcional (Images, que gasta plata
      // en cada llamada) no se prende de rebote. Si ya estaba prendido, sigue.
      { id: 'todas', label: 'Turn all on', onSelect: () => datos.ponerTools(a.id, [...grupos.flatMap((g) => (g.opcional ? g.tools.filter((t) => tiene.has(t)) : g.tools)), ...[...tiene].filter(datos.esMarcaMcp)]) },
      { id: 'ninguna', label: 'Turn all off', onSelect: () => datos.ponerTools(a.id, []) },
    ];
  }, { align: 'end' });
  const celda = h('div', 'dm-hilo-celda');
  // Ir al final de la conversación: un botón redondo que flota sobre el borde
  // de abajo, y aparece solo cuando uno subió a leer (es el de NeonCode). Va en
  // un marco al lado de la celda y no adentro: la celda releva conversaciones
  // y trata a cada hijo suyo como una.
  const bFinal = h('button', 'dm-al-final', { type: 'button', 'data-accion': 'al-final', 'aria-label': 'Jump to latest', 'data-rad-tip': 'Jump to latest', 'data-rad-tip-side': 'top', tabindex: '-1', 'aria-hidden': 'true' }, icono('chevron'));

  const irAjustes = h('button', 'rad-button', { type: 'button', 'data-accion': 'ir-ajustes' }, 'Go to Settings');
  irAjustes.addEventListener('click', () => router.go('ajustes'));
  const aviso = h('div', 'dm-aviso', { role: 'status' },
    h('div', 'dm-aviso-in', {}, h('div', 'dm-aviso-caja', {},
      icono('llave'), h('span', 'dm-aviso-texto rad-swap'), irAjustes)));

  const area = h('textarea', 'rad-input dm-area', { rows: '1', spellcheck: 'false', 'aria-label': 'Message', placeholder: 'Write a message' });
  const boton = h('button', 'rad-iconbutton dm-enviar', { type: 'submit', 'data-modo': 'enviar', 'data-rad-tip-side': 'top' },
    h('span', 'dm-enviar-iconos', {}, icono('enviar', 'dm-ic-enviar'), icono('frenar', 'dm-ic-frenar')));
  // Los adjuntos del mensaje que se está escribiendo: arriba del texto, con
  // el botón + a la izquierda. También entran pegando o soltando archivos.
  const adjuntos = crearAdjuntos({ alCambiar: () => ponerRedactor() });
  const mas = h('button', 'rad-iconbutton dm-mas', { type: 'button', 'data-accion': 'adjuntar', 'aria-label': 'Attach files or photos', 'data-rad-tip': 'Attach files or photos', 'data-rad-tip-key': 'Ctrl+U', 'data-rad-tip-side': 'top' }, icono('mas'));
  const selectorArchivos = h('input', 'dm-selector', { type: 'file', multiple: true, accept: ACEPTA, tabindex: '-1', 'aria-hidden': 'true' });
  const sinOjos = h('p', 'dm-redactor-nota rad-swap', { role: 'status' });
  const redactor = h('form', 'dm-redactor', {}, adjuntos.tira, sinOjos, h('div', 'dm-redactor-fila', {}, mas, area, boton), selectorArchivos);
  // La escena: la conversación y, a su derecha, el panel que esté abierto (el
  // canvas, el navegador o la terminal). El panel empuja a la conversación; no
  // la tapa (salvo el navegador cuando se lo estira).
  const escena = h('div', 'dm-escena');
  // El hueco de la escena es uno solo: abrir un panel cierra el otro.
  const turnos = {
    pedir(quien) {
      if (quien !== 'canvas') lienzo.cerrar({ rescatar: true });
      if (quien !== 'browser') nav.cerrar();
      if (quien !== 'terminal') consola.cerrar();
    },
  };
  const lienzo = montarCanvas({ escena, turnos });
  const nav = montarNavegador({ escena, turnos, router });
  // (la terminal abre en la carpeta del chat que se está viendo)
  const consola = montarTerminal({ escena, turnos, router, carpeta: () => { const c = datos.chatActual(); return c ? datos.carpetaDe(c.id) : datos.carpetaInicio(); } });
  const conv = h('section', 'dm-conv', {},
    h('header', 'dm-conv-cabeza', { 'data-rad-chrome': '' }, titulo, sub, nav.boton, consola.boton, lienzo.botonBiblioteca, botonTools),
    lienzo.barra, h('div', 'dm-hilo-marco', {}, celda, bFinal), aviso, h('div', 'dm-redactor-caja', {}, redactor));
  escena.append(conv, lienzo.panel, nav.panel, consola.panel);

  el.append(lado, escena);

  // ---------- La carpeta de trabajo ----------
  // Cada chat tiene la suya: donde corren los comandos de su agente y contra
  // qué se resuelven sus rutas relativas. Un chat nuevo arranca en la carpeta
  // de inicio (Settings) y después recuerda la propia: si el agente se mueve
  // con `cd`, se mueve ese chat y ningún otro. Va a la vista, debajo del campo
  // para escribir, porque sin eso no hay forma de saber dónde está parado un
  // agente (antes era una sola para toda la app y no se mostraba).
  const carpetaTexto = h('span', 'dm-carpeta-texto rad-mono rad-swap');
  const botonCarpeta = h('button', 'dm-carpeta', { type: 'button', 'data-accion': 'carpeta', 'data-rad-tip-side': 'top' }, icono('carpeta'), carpetaTexto);
  const filaCarpeta = h('div', 'dm-carpeta-fila', {}, botonCarpeta);
  redactor.parentElement.append(filaCarpeta);
  // Una ruta que no entra se acorta por el MEDIO: lo que importa es dónde
  // termina (los puntos suspensivos de CSS se comerían justo eso). Queda la
  // unidad y, desde el final, todas las carpetas que entren.
  const acortar = (ruta, max) => {
    if (ruta.length <= max) return ruta;
    const partes = ruta.split(/[\\/]/).filter(Boolean);
    let cola = partes.at(-1);
    for (let i = partes.length - 2; i > 0; i--) {
      const mas = `${partes[i]}\\${cola}`;
      if (partes[0].length + 3 + mas.length > max) break;
      cola = mas;
    }
    return `${partes[0]}\\…\\${cola}`;
  };
  // Cuántas letras entran en el renglón (es monoespaciada: se mide una).
  const lienzoLetra = document.createElement('canvas').getContext('2d');
  const entran = () => {
    const estilo = getComputedStyle(carpetaTexto);
    lienzoLetra.font = `${estilo.fontSize} ${estilo.fontFamily}`;
    const letra = lienzoLetra.measureText('0').width || 7;
    // (el ícono, su separación y el relleno del botón: unos 48 px)
    return Math.max(18, Math.floor((filaCarpeta.clientWidth - 48) / letra) - 1);
  };
  const carpetaActual = () => { const c = datos.chatActual(); return c ? datos.carpetaDe(c.id) : datos.carpetaInicio(); };
  const escribirCarpeta = () => swapText(carpetaTexto, acortar(carpetaActual(), entran()));
  // (al cambiar el ancho de la ventana, o al abrirse un panel, entra más o menos)
  new ResizeObserver(escribirCarpeta).observe(filaCarpeta);
  let turnoCarpeta = 0;
  const ponerCarpeta = async () => {
    const ruta = carpetaActual();
    escribirCarpeta();
    botonCarpeta.setAttribute('aria-label', `Working folder of this chat: ${ruta}`);
    botonCarpeta.dataset.ruta = ruta;
    // ¿sigue existiendo? Si no, se dice: el próximo mensaje va a usar la de inicio.
    const mio = ++turnoCarpeta;
    const existe = await window.rad.invoke('chat:carpeta-existe', ruta).catch(() => true);
    if (mio !== turnoCarpeta) return;
    botonCarpeta.toggleAttribute('data-falta', !existe);
    botonCarpeta.setAttribute('data-rad-tip', existe ? 'Working folder of this chat' : 'This folder is gone: the next message will use the home folder');
  };
  // Con menuButton y no con un click que abre: el botón es un toggle. Tocarlo
  // con el menú abierto lo cierra; a mano, el mousedown sobre el botón ya lo
  // cerraba (es un clic «afuera» del menú) y el click que venía atrás lo volvía
  // a abrir: cerraba y abría de un salto (Fran lo vio, 25/11/2026).
  menuButton(botonCarpeta, () => {
    const ruta = carpetaActual();
    const c = datos.chatActual();
    const ocupado = Boolean(c && datos.respondiendo(c.id));
    const elChat = () => datos.chatActual() ?? datos.crearChat(datos.agenteActual().id);
    return [
      { id: 'elegir', label: ocupado ? 'Choose another folder (after this answer)' : 'Choose another folder…', icon: icono('carpeta').innerHTML, disabled: ocupado, onSelect: async () => {
        const elegida = await window.rad.invoke('chat:elegir-carpeta', ruta).catch(() => null);
        if (elegida) datos.ponerCarpeta(elChat().id, elegida);
      } },
      { id: 'abrir', label: 'Open in File Explorer', icon: icono('externo').innerHTML, onSelect: async () => {
        const r = await window.rad.invoke('chat:abrir-carpeta', ruta).catch(() => null);
        if (!r?.ok) toast({ text: 'That folder is gone.', kind: 'danger' });
      } },
      { id: 'copiar', label: 'Copy path', icon: icono('copiar').innerHTML, onSelect: () => navigator.clipboard.writeText(ruta).then(() => toast({ text: 'Copied' }), () => toast({ text: 'Could not copy', kind: 'danger' })) },
      { separator: true },
      { id: 'inicio', label: 'Back to the home folder', icon: icono('volver').innerHTML, disabled: ocupado || ruta === datos.carpetaInicio(), onSelect: () => datos.ponerCarpeta(elChat().id, datos.carpetaInicio()) },
    ];
  }, { side: 'top' });
  datos.on('chats', ponerCarpeta);
  datos.on('seleccion', ponerCarpeta);
  datos.on('ajustes', ponerCarpeta);
  ponerCarpeta();

  // ---------- La lista de chats ----------
  const acciones = (id) => {
    const c = datos.chat(id);
    return c && [
      // (un chat de canal no se fija: ya tiene su grupo)
      ...(c.voz === true ? [] : [{ id: 'fijar', label: c.fijado === true ? 'Unpin' : 'Pin', icon: icono('pin').innerHTML, onSelect: () => datos.fijarChat(c.id, c.fijado !== true) }]),
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
    // (un chat de canal lleva debajo cuándo fue: se arman solos, y así se los distingue)
    const abrir = h('button', 'dm-fila-abrir', { type: 'button' }, h('span', 'dm-fila-textos', {}, h('span', 'dm-fila-titulo rad-swap'), ...(c.voz === true ? [h('span', 'dm-fila-fecha rad-swap')] : [])), h('span', 'dm-fila-punto', { 'aria-hidden': 'true' }, h('i')));
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
    nodo.toggleAttribute('data-voz', c.voz === true);
    const fecha = nodo.querySelector('.dm-fila-fecha');
    if (fecha) swapText(fecha, cuando(c.tocado));
  };
  // (día y hora del último mensaje, como los escribe el sistema: «25/11 · 15:50»)
  const cuando = (ms) => { const d = new Date(ms); return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`; };
  const dibujarLista = () => {
    const suyos = datos.chatsDe(datos.agenteActual().id);
    const deCanal = suyos.filter((c) => c.voz === true);
    const losDemas = suyos.filter((c) => c.voz !== true);
    const losFijados = losDemas.filter((c) => c.fijado === true);
    const losRecientes = losDemas.filter((c) => c.fijado !== true);
    reconcile(fij.lista, losFijados, { key: (c) => c.id, create: fila, update: ponerFila });
    // (el lugar vacío solo si no hay NINGÚN chat: con fijados o canales, esta lista queda sin nada)
    reconcile(comunes, losRecientes.length ? losRecientes : (losFijados.length || deCanal.length ? [] : [{ id: VACIO }]), { key: (c) => c.id, create: fila, update: ponerFila });
    fijados.toggleAttribute('data-vacio', !losFijados.length);
    fijados.inert = !losFijados.length;
    const fijadosAbiertos = datos.grupoAbierto('fijados');
    fij.cabeza.setAttribute('aria-expanded', String(fijadosAbiertos));
    fij.caja.toggleAttribute('data-abierto', fijadosAbiertos);
    fij.caja.inert = !fijadosAbiertos;
    // «Recent» solo lleva rótulo si hay fijados de los que distinguirse. Sin
    // rótulo no hay con qué desplegarla, así que va abierta aunque se la
    // hubiera dejado plegada: si no, los chats quedarían escondidos sin forma
    // de volver a verlos.
    rec.rotulo.toggleAttribute('data-vacio', !losFijados.length);
    rec.rotulo.inert = !losFijados.length;
    const recientesAbiertos = !losFijados.length || datos.grupoAbierto('recientes');
    rec.cabeza.setAttribute('aria-expanded', String(recientesAbiertos));
    rec.caja.toggleAttribute('data-abierto', recientesAbiertos);
    rec.caja.inert = !recientesAbiertos;
    reconcile(delCanal, deCanal, { key: (c) => c.id, create: fila, update: ponerFila });
    canales.toggleAttribute('data-vacio', !deCanal.length);
    canales.inert = !deCanal.length;
    const abierto = datos.canalesAbiertos();
    canalesCabeza.setAttribute('aria-expanded', String(abierto));
    canalesCaja.toggleAttribute('data-abierto', abierto);
    canalesCaja.inert = !abierto;
  };
  canalesCabeza.addEventListener('click', () => datos.ponerCanalesAbiertos(!datos.canalesAbiertos()));
  // El tacho del grupo borra todos los chats de canal de este agente (pregunta antes).
  canalesBorrar.addEventListener('click', async () => {
    const a = datos.agenteActual();
    const suyos = datos.chatsDe(a.id).filter((c) => c.voz === true);
    if (!suyos.length) return;
    const si = await confirm({
      title: suyos.length === 1 ? 'Delete the channel chat?' : `Delete the ${suyos.length} channel chats?`,
      text: `What you said to the Atom Echo for ${a.nombre}, and its answers. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!si) return;
    for (const c of suyos) await datos.borrarChat(c.id);
  });
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
    // lo que adjuntó: va arriba del texto (el orden lo pone el CSS)
    const suyos = m.rol === 'user' ? adjuntosDe(m) : null;
    if (suyos) nodo.append(suyos);
    // Debajo de la burbuja: la marca de que se dijo y no se tipeó (es lo que
    // Whisper entendió, y conviene verlo) y la hora en que se mandó.
    if (m.rol === 'user') {
      const meta = h('div', 'dm-msg-meta');
      if (m.voz) meta.append(h('span', 'dm-msg-voz', {}, icono('canal'), 'Said to the Atom Echo'));
      meta.append(h('span', 'dm-msg-hora'));
      nodo.append(meta);
    }
    if (m.rol === 'assistant') {
      nodo.append(h('div', 'dm-msg-pie', {}, h('div', 'dm-msg-pie-in', {},
        h('span', 'dm-pulso', { 'aria-hidden': 'true' }, h('i')), h('span', 'dm-msg-nota rad-swap'))));
      // Debajo de la respuesta, en un renglón: la hora en que terminó y el
      // contador de tools del turno (siempre que el turno las tuvo, también
      // cuando no corrió ninguna: es un dato, no una acusación). Cada uno se
      // despliega por su lado.
      nodo.append(h('div', 'dm-msg-abajo', {},
        h('div', 'dm-msg-cuando', {}, h('div', 'dm-msg-cuando-in', {}, h('span', 'dm-msg-hora'))),
        h('div', 'dm-msg-cuenta', {}, h('div', 'dm-msg-cuenta-in', {}, h('span', 'dm-msg-cuenta-texto rad-swap')))));
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
      // (un mensaje de antes de que se guardara la hora, y que tampoco se dijo: sin renglón)
      const hay = ponerHora(nodo.querySelector('.dm-msg-hora'), m.t);
      nodo.querySelector('.dm-msg-meta').toggleAttribute('data-vacia', !hay && !m.voz);
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
    // la hora, cuando la respuesta terminó (mientras llega no hay ninguna que decir)
    const hayHora = ponerHora(nodo.querySelector('.dm-msg-hora'), estado === 'escribiendo' ? 0 : m.t);
    nodo.querySelector('.dm-msg-cuando').toggleAttribute('data-abierto', hayHora);
    // un tramo de texto que quedó vacío (el agente llamó tools sin escribir
    // nada antes) no ocupa lugar
    nodo.toggleAttribute('data-vacio', !m.texto && estado !== 'escribiendo' && estado !== 'error');
  };

  const alFondo = () => { if (hilo) hilo.scroller.scrollTop = hilo.scroller.scrollHeight; };
  // El botón de ir al final se muestra cuando abajo quedó bastante sin ver.
  // El umbral es más ancho que el de «pegado»: no titila por unos píxeles.
  const lejosDelFinal = (s) => s.scrollHeight - s.clientHeight - s.scrollTop;
  const ponerAlFinal = () => {
    const ver = Boolean(hilo) && lejosDelFinal(hilo.scroller) > LEJOS_PX;
    if (ver === bFinal.hasAttribute('data-visible')) return;
    bFinal.toggleAttribute('data-visible', ver);
    // escondido no se toca ni se enfoca
    if (ver) { bFinal.removeAttribute('aria-hidden'); bFinal.removeAttribute('tabindex'); } else { bFinal.setAttribute('aria-hidden', 'true'); bFinal.setAttribute('tabindex', '-1'); if (document.activeElement === bFinal) area.focus(); }
  };
  bFinal.addEventListener('click', () => {
    if (!hilo) return;
    const este = hilo;
    const s = este.scroller;
    // Vuelve a quedar pegado desde YA: lo que llegue mientras baja lo sigue.
    este.pegado = true;
    este.bajando = performance.now();
    s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
    // Con la ventana tapada no hay cuadros y el scroll suave no avanza: pasado
    // el plazo, llega igual.
    setTimeout(() => {
      if (este.bajando) { este.bajando = 0; if (este.pegado) s.scrollTop = s.scrollHeight; }
      ponerAlFinal();
    }, BAJADA_MS);
  });
  const dibujarMensajes = () => {
    if (!hilo) return;
    const lista2 = hilo.doc?.get().mensajes ?? [];
    reconcile(hilo.col, lista2.length ? lista2 : [{ id: VACIO }], { key: (m) => m.id, create: mensaje, update: ponerMensaje });
    if (hilo.pegado && !hilo.bajando) alFondo();
    ponerAlFinal();
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
      const cerca = lejosDelFinal(scroller) <= PEGADO_PX;
      // Mientras baja por el botón sigue pegado aunque todavía esté lejos; al
      // llegar (o si el usuario sube con la rueda a mitad de camino) termina.
      if (este.bajando) { if (cerca) este.bajando = 0; } else este.pegado = cerca;
      if (este === hilo) ponerAlFinal();
    }, { passive: true });
    // (la rueda o una tecla a mitad de la bajada: manda el usuario)
    const soltar = () => { if (este.bajando) { este.bajando = 0; este.pegado = lejosDelFinal(scroller) <= PEGADO_PX; } };
    scroller.addEventListener('wheel', soltar, { passive: true });
    scroller.addEventListener('keydown', soltar);
    // Pegado al final también cuando el contenido cambia de alto sin que nadie
    // scrollee. Los mensajes fuera de la vista tienen un alto estimado (no se
    // maquetan): al abrir un chat largo, «el final» se corre a medida que los
    // de abajo toman su alto de verdad, y sin esto quedaba parado más arriba.
    new ResizeObserver(() => { if (este.pegado && !este.bajando) scroller.scrollTop = scroller.scrollHeight; if (este === hilo) ponerAlFinal(); }).observe(col);
    dibujarMensajes();
    relevar(celda, scroller);
    alFondo();
    ponerAlFinal();
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
    boton.disabled = !ocupado && !area.value.trim() && !adjuntos.hay();
    setBusy(redactor, ocupado);
    // Con imágenes adjuntas y un modelo que no ve, se dice antes de mandar.
    const a = datos.agenteActual();
    const ciego = adjuntos.cuantas().imagenes > 0 && !datos.modeloVe(a.proveedor, a.modelo);
    swapText(sinOjos, ciego ? 'This model can’t see images: they will stay in the chat, but it won’t get them.' : '');
    redactor.toggleAttribute('data-con-nota', ciego);
  };

  // ---------- Adjuntar ----------
  const sumar = async (archivos) => {
    for (const f of archivos) {
      try { await adjuntos.agregar(f); } catch (err) { toast({ text: err.message, kind: 'danger' }); }
    }
    area.focus();
  };
  selectorArchivos.addEventListener('change', () => { const lista = [...selectorArchivos.files]; selectorArchivos.value = ''; sumar(lista); });
  // El +: abre el selector de archivos. Con el navegador abierto ofrece además
  // adjuntar una captura de la página que se está viendo.
  mas.addEventListener('click', () => {
    if (!nav.abierto()) { selectorArchivos.click(); return; }
    openMenu({
      anchor: mas,
      side: 'top',
      items: [
        { id: 'archivos', label: 'Add files or photos', icon: icono('mas').innerHTML, onSelect: () => selectorArchivos.click() },
        { id: 'pagina', label: 'Capture the browser page', icon: icono('globo').innerHTML, onSelect: async () => {
          const png = await window.rad.invoke('browser:capture').catch(() => null);
          if (!png) { toast({ text: 'There is no page to capture.', kind: 'danger' }); return; }
          try { adjuntos.agregarImagen(png, 'page.png'); } catch (err) { toast({ text: err.message, kind: 'danger' }); }
        } },
      ],
    });
  });
  // Pegar: una imagen del portapapeles (una captura) o archivos copiados.
  area.addEventListener('paste', (e) => {
    const lista = [...(e.clipboardData?.files ?? [])];
    if (!lista.length) return; // texto: el pegado de siempre
    e.preventDefault();
    sumar(lista);
  });
  // Soltar archivos sobre la conversación. El resaltado va en el redactor.
  const traeArchivos = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  conv.addEventListener('dragover', (e) => { if (!traeArchivos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; redactor.setAttribute('data-soltar', ''); });
  conv.addEventListener('dragleave', (e) => { if (!conv.contains(e.relatedTarget)) redactor.removeAttribute('data-soltar'); });
  conv.addEventListener('drop', (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    redactor.removeAttribute('data-soltar');
    sumar([...e.dataTransfer.files]);
  });
  // Un archivo soltado fuera de la conversación no hace nada (sin esto, el
  // navegador de adentro intentaría abrirlo).
  for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => { if (traeArchivos(e)) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'u' && router.current === 'chat') { e.preventDefault(); selectorArchivos.click(); }
  });

  async function mandar() {
    const texto = area.value;
    if (!texto.trim() && !adjuntos.hay()) return;
    let c = datos.chatActual();
    // mientras contesta no se manda: lo adjuntado queda en el redactor
    if (c && datos.respondiendo(c.id)) return;
    if (!c) c = datos.crearChat(datos.agenteActual().id);
    area.value = '';
    ajustarAlto();
    if (hilo) hilo.pegado = true;
    await datos.enviar(c.id, texto, adjuntos.tomar());
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
  datos.on('tools', ponerCabeza);
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
