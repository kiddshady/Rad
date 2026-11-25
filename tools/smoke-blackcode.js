// Guion del humo de BlackCode. Corre adentro de la página (con await), contra el
// proveedor simulado, y mide lo que se ve. Devuelve { failures, data }.

const failures = [];
const data = {};
const fail = (msg) => failures.push(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Un cuadro, con tope: si la ventana deja de pintar, el guion no se cuelga.
const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });
const op = (el) => parseFloat(getComputedStyle(el).opacity);
const r2 = (n) => Math.round(n * 100) / 100;
const dur = (name) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--rad-dur-${name}`).trim();
  return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
};
const until = async (cond, ms = 9000) => {
  for (const t0 = performance.now(); performance.now() - t0 < ms;) {
    if (cond()) return true;
    await frame();
  }
  return false;
};
// Lo que tarda en asentarse un relevo o una fila que entra o se va.
const settle = () => sleep(dur('base') + dur('fast') + 180);

const view = (id) => document.querySelector(`.rad-view[data-view="${id}"]`);
const go = async (id) => { document.querySelector(`.rad-tab[data-view="${id}"]`).click(); await sleep(dur('base') + 220); };
const alive = (list) => [...list].filter((el) => !el.closest('[data-rad-leaving]'));
// El texto vivo de una celda de relevo: durante un relevo tiene las dos frases.
const shown = (cell) => cell?.querySelector(':scope > :not(.rad-swap-out)')?.textContent ?? '';
const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const modal = () => alive(document.querySelectorAll('.rad-overlays .rad-modal')).find((m) => m.dataset.state === 'open');
const primary = () => modal()?.querySelector('.rad-button[data-variant="primary"], .rad-button[data-variant="danger"]');
const menus = () => [...document.querySelectorAll('.rad-overlays .rad-menu')].filter((m) => m.dataset.state === 'open' && !m.hasAttribute('data-rad-leaving'));
const pick = async (label) => {
  const item = [...(menus()[0]?.querySelectorAll('.rad-menu-item') ?? [])].find((i) => i.textContent.includes(label));
  if (!item) { fail(`el menú no trae «${label}»`); return false; }
  item.click();
  await settle();
  return true;
};
const closed = async () => { await until(() => !document.querySelector('.rad-modal-layer'), 2000); await sleep(60); };

const chatView = view('chat');
const cards = () => alive(view('agentes').querySelectorAll('.dm-tarjeta'));
const rows = () => alive(chatView.querySelectorAll('.dm-fila'));
const threads = () => [...chatView.querySelectorAll('.dm-hilo-celda > .dm-hilo')];
const thread = () => threads().find((t) => !t.hasAttribute('data-rad-leaving'));
const msgs = () => alive(thread()?.querySelectorAll('.dm-msg') ?? []);
const area = chatView.querySelector('.dm-area');
const send = chatView.querySelector('.dm-enviar');
const composer = chatView.querySelector('.dm-redactor');
const statusRight = () => shown(document.querySelector('.rad-status-right'));

const LLAVE = 'sk-ant-api03-humo-de-blackcode-no-es-una-llave-0000';
const INSTRUCCIONES = 'Answer like a pharmacist on call: short and clear.';
const LLAVE_VENICE = 'venice-humo-de-blackcode-no-es-una-llave-1111';
const PREGUNTA = 'Hi, what should I take for a headache?';
const MODELO_LARGO = 'DeepSeek V4.1 Flash 1017 Uncensored';

if (window.rad.skin.id !== 'mono') fail(`BlackCode abrió con la piel ${window.rad.skin.id}, no con mono`);

// Las scrollbars de las páginas del navegador son flotantes (van encima del
// contenido, sin carril): Chromium lo decide al arrancar, por un flag de la
// línea de comandos, y vale para toda scrollbar SIN estilo. Las de la app
// llevan el del núcleo; adentro de un shadow root ese estilo no llega, así que
// ahí se ve la de Chromium tal cual. (La segunda pasada del .exe arranca sin
// el flag: acá se ve que la app se relanzó sola con él.)
{
  const sonda = document.createElement('div');
  Object.assign(sonda.style, { position: 'fixed', left: '-400px', top: '0', width: '120px', height: '120px' });
  const caja = document.createElement('div');
  Object.assign(caja.style, { width: '100px', height: '100px', overflow: 'scroll' });
  const alto = document.createElement('div');
  Object.assign(alto.style, { width: '300px', height: '300px' });
  caja.append(alto);
  sonda.attachShadow({ mode: 'open' }).append(caja);
  document.body.append(sonda);
  const carril = caja.offsetWidth - caja.clientWidth;
  sonda.remove();
  data.scrollbars = carril === 0 ? 'flotantes (sin carril)' : `clásicas, con un carril de ${carril} px`;
  if (carril !== 0) fail(`las scrollbars de las páginas no son flotantes: una sin estilo reserva ${carril} px (¿falta --enable-features=OverlayScrollbar al lanzar?)`);
}

// ---------- Segunda pasada: lo de la primera sigue ahí ----------
const marker = await window.rad.store.read('smoke');
if (marker?.pass === 1) {
  const agentes = (await window.rad.store.read('agentes'))?.lista ?? [];
  if (agentes.map((a) => a.nombre).join() !== 'BlackCode,Galen on call,Oracle') fail(`los agentes guardados son: ${agentes.map((a) => a.nombre).join()}`);
  // Vuelve a abrir donde se dejó: el agente y su chat.
  if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'Galen on call') fail(`abrió con el agente «${shown(chatView.querySelector('.dm-agente-nombre'))}», se había dejado Galeno`);
  const fila = rows();
  if (fila.length !== 1 || shown(fila[0].querySelector('.dm-fila-titulo')) !== 'Headache') fail(`los chats que volvieron: ${fila.map((f) => shown(f.querySelector('.dm-fila-titulo'))).join(' | ')}`);
  if (fila[0]?.getAttribute('aria-current') !== 'true') fail('el chat que estaba abierto no volvió abierto');
  await until(() => msgs().length === 4, 3000);
  const m = msgs();
  if (m.length !== 4) fail(`volvieron ${m.length} mensajes, se habían dejado 4`);
  else {
    if (m.map((x) => x.dataset.rol).join() !== 'user,assistant,user,assistant') fail('los mensajes volvieron en otro orden');
    if (m[0].textContent !== PREGUNTA) fail(`el primer mensaje volvió como «${m[0].textContent}»`);
    if (m[1].dataset.estado !== 'frenado' || shown(m[1].querySelector('.dm-msg-nota')) !== 'Stopped.') fail('la respuesta frenada no volvió marcada como frenada');
    if (m[1].querySelector('.dm-msg-cuerpo').textContent.length !== marker.frenado) fail(`la respuesta frenada volvió con ${m[1].querySelector('.dm-msg-cuerpo').textContent.length} caracteres, tenía ${marker.frenado}`);
    if (m[3].dataset.estado !== 'ok' || !m[3].querySelector('.dm-codigo code')?.textContent.includes('const greet')) fail('la respuesta completa no volvió con su bloque de código');
    // Lo que ya estaba al abrir no entra animado.
    if (m.some((x) => op(x) !== 1 || x.getAnimations().length)) fail('los mensajes guardados entraron animados al abrir');
  }
  const llave = await window.rad.invoke('llave:estado');
  if (llave.anthropic?.estado !== 'lista' || !llave.anthropic.pista?.endsWith('0000')) fail(`la llave de Anthropic no volvió: ${JSON.stringify(llave.anthropic)}`);
  if (llave.venice?.estado !== 'lista' || !llave.venice.pista?.endsWith('1111')) fail(`la llave de Venice no volvió: ${JSON.stringify(llave.venice)}`);
  // El agente de Venice volvió con su proveedor y su modelo.
  const oraculo = agentes.find((a) => a.nombre === 'Oracle');
  if (oraculo?.proveedor !== 'venice' || oraculo?.modelo !== 'deepseek-v4-1-flash-1017-uncensored') fail(`el agente de Venice volvió como ${JSON.stringify(oraculo)}`);
  await go('ajustes');
  const estadoLlave = view('ajustes').querySelector('[data-proveedor="anthropic"] .dm-estado');
  await until(() => estadoLlave.dataset.comprobacion === 'aceptada', 3000);
  if (estadoLlave.dataset.comprobacion !== 'aceptada' || estadoLlave.dataset.tono !== 'success') fail(`al reabrir, la llave de Anthropic figura como ${estadoLlave.dataset.comprobacion}`);
  await go('chat');
  // Lo último de la pasada 1 se escribió justo antes de cerrar.
  if ((await window.rad.store.read('ultimo'))?.ok !== true) fail('lo que se guardó justo antes de cerrar se perdió');
  // El historial del navegador también volvió (se lee sin abrir el navegador).
  {
    const h = await window.rad.invoke('browser:hist-list');
    if (!Array.isArray(h) || h.length !== 1 || h[0].url !== SMOKE_URL || h[0].title !== 'Smoke page') fail('al reabrir, el historial del navegador volvió como ' + JSON.stringify((h ?? []).map?.((e) => [e.url, e.title])));
  }

  // Borrar un agente se lleva sus chats, y el último que queda ya no se puede borrar.
  await go('agentes');
  const galeno = cards().find((c) => shown(c.querySelector('.dm-tarjeta-nombre')) === 'Galen on call');
  if (shown(galeno?.querySelector('.dm-tarjeta-cuenta')) !== '1 chat') fail(`la tarjeta de Galeno dice «${shown(galeno?.querySelector('.dm-tarjeta-cuenta'))}»`);
  galeno.querySelector('[data-accion="eliminar"]').click();
  await frame();
  if (!modal()) fail('eliminar un agente no pidió confirmación');
  else {
    primary().click();
    await closed();
    await settle();
  }
  if (cards().length !== 2) fail(`después de eliminar a Galeno quedan ${cards().length} tarjetas`);
  if (await window.rad.store.read(`chat-${marker.chat}`) !== undefined) fail('el documento del chat del agente borrado sigue ahí');
  if (await window.rad.store.read(`chat-${marker.chatVenice}`) === undefined) fail('borrar un agente se llevó el chat de otro');
  cards().find((c) => shown(c.querySelector('.dm-tarjeta-nombre')) === 'Oracle').querySelector('[data-accion="eliminar"]').click();
  await frame();
  primary()?.click();
  await closed();
  await settle();
  if (cards().length !== 1) fail(`después de eliminar a los dos agentes quedan ${cards().length} tarjetas`);
  if (cards()[0]?.querySelector('[data-accion="eliminar"]').getAttribute('aria-disabled') !== 'true') fail('el último agente se puede borrar');
  if (((await window.rad.store.read('chats'))?.lista ?? []).length) fail('los chats del agente borrado quedaron en el índice');
  if (await window.rad.store.read(`chat-${marker.chatVenice}`) !== undefined) fail('el documento del chat del agente de Venice sigue ahí');
  await go('chat');
  if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'BlackCode') fail('después de borrar el agente abierto no quedó elegido el otro');
  data.persistencia = `3 agentes (uno de Venice), el chat con 4 mensajes (la frenada con ${marker.frenado} caracteres), llaves: Anthropic ${llave.anthropic?.estado}, Venice ${llave.venice?.estado}`;
  window.rad.store.write('smoke', { pass: 2 });
  return { failures, data };
}

// ---------- Primera pasada ----------

// 0. Arranque: un agente para empezar, la vista de chat, sin chats, y sin el
// aviso de la llave (el proveedor es el simulado).
if (!document.querySelector('.rad-root').classList.contains('is-settled')) fail('la raíz no quedó asentada');
if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'BlackCode') fail(`el agente inicial es «${shown(chatView.querySelector('.dm-agente-nombre'))}»`);
if (rows().length) fail('arrancó con chats');
if (chatView.querySelector('.dm-aviso').hasAttribute('data-abierto')) fail('con el proveedor simulado aparece el aviso de la llave');
if (!send.disabled) fail('el botón de enviar está habilitado con el campo vacío');

// 0b. La interfaz está en inglés: lo de BlackCode y lo que pone el núcleo (los
// botones de la ventana, los de un confirm). Lo que escribe el guion va en
// inglés y sin acentos, así que cualquier acento o palabra castellana que
// aparezca a la vista o en un rótulo es de la interfaz.
const CASTELLANO = /[áéíóúñ¿¡«»]|\b(llaves?|agentes?|ajustes|guardar|eliminar|nuevo|modelos?|proveedor|enviar|frenar|cancelar|cerrar)\b/i;
const enIngles = (donde) => {
  const textos = [document.body.innerText];
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [data-rad-tip]')) {
    textos.push(el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '', el.getAttribute('data-rad-tip') ?? '');
  }
  const malo = textos.flatMap((t) => t.split('\n')).find((t) => CASTELLANO.test(t));
  if (malo) fail(`${donde}: quedó texto en castellano en la interfaz: «${malo.trim().slice(0, 90)}»`);
};
if (window.rad.lang !== 'en' || document.documentElement.lang !== 'en') fail(`BlackCode no arrancó en inglés: rad.lang "${window.rad.lang}", html lang "${document.documentElement.lang}"`);
const ventana = [...document.querySelectorAll('.rad-winbtn')].map((b) => b.getAttribute('aria-label')).join(', ');
if (ventana !== 'Minimize, Maximize, Close') fail(`los botones de la ventana dicen: ${ventana}`);
const riel = [...document.querySelectorAll('.rad-tab')].map((b) => b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('data-rad-tip')).join(', ');
if (riel !== 'Chat, Notes, Memory, Skills, Agents, Settings') fail(`las vistas se llaman: ${riel}`);
enIngles('al arrancar');
// Las vistas van como pestañas en la titlebar, sin rail y sin el nombre de
// la app: lo primero de la barra son las pestañas, alineadas con la hoja, y
// el escenario ocupa todo el ancho.
{
  const tabs = [...document.querySelectorAll('.rad-titlebar > .rad-tabs > .rad-tab')];
  const stage = document.querySelector('.rad-stage').getBoundingClientRect();
  if (document.querySelector('.rad-rail') || tabs.length !== 6) fail(`las vistas no están en la titlebar (${tabs.length} pestañas, rail: ${Boolean(document.querySelector('.rad-rail'))})`);
  if (document.querySelector('.rad-titlebar-title') || /BlackCode/.test(document.querySelector('.rad-titlebar').textContent)) fail('la titlebar sigue mostrando el nombre de la app');
  if (tabs.length && Math.abs(tabs[0].getBoundingClientRect().left - stage.left) > 1) fail(`la primera pestaña empieza en ${r2(tabs[0].getBoundingClientRect().left)} y la hoja en ${r2(stage.left)}`);
  if (stage.width < window.innerWidth - 24) fail(`sin rail, la hoja mide ${r2(stage.width)} en una ventana de ${window.innerWidth}`);
  const activa = tabs.find((t) => t.getAttribute('aria-current') === 'page');
  if (activa?.dataset.view !== 'chat' || activa.querySelector('.rad-tab-label').getBoundingClientRect().width < 12) fail('la pestaña de Chat no arranca activa y con su rótulo a la vista');
  data.titlebar = `${tabs.length} pestañas desde ${r2(tabs[0]?.getBoundingClientRect().left)} px, hoja de ${r2(stage.width)} px`;
}
data.idioma = `${window.rad.lang}: ${ventana} · ${riel}`;

// 0c. La fuente de código es Roboto Mono (viaja con Rad), cargada de verdad:
// no la Cascadia de la piel ni la mono de reserva.
{
  await document.fonts.ready;
  const pila = getComputedStyle(document.documentElement).getPropertyValue('--rad-font-mono').trim();
  const caras = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Roboto Mono');
  if (!/^'?"?Roboto Mono/.test(pila)) fail(`la fuente mono de BlackCode es ${pila}`);
  if (!caras.some((f) => f.status === 'loaded')) fail(`Roboto Mono no cargó: ${caras.map((f) => f.status).join(', ') || 'no está declarada'}`);
  const ancho = (familia) => { const c = document.createElement('canvas').getContext('2d'); c.font = `13px ${familia}`; return c.measureText('0O1lI{}=>').width; };
  if (Math.abs(ancho("'Roboto Mono'") - ancho("'Cascadia Mono'")) < 0.5 && Math.abs(ancho("'Roboto Mono'") - ancho('monospace')) < 0.5) fail('Roboto Mono mide igual que las otras mono: no se está usando');
  data.mono = pila;
}

// 1. Crear un agente: el formulario no deja guardarlo sin nombre; con nombre,
// modelo e instrucciones, su tarjeta entra fundiéndose.
await go('agentes');
if (cards().length !== 1) fail(`la vista de agentes arrancó con ${cards().length} tarjetas`);
if (cards()[0].querySelector('[data-accion="eliminar"]').getAttribute('aria-disabled') !== 'true') fail('el único agente se puede borrar');
view('agentes').querySelector('[data-accion="nuevo-agente"]').click();
await frame();
if (!modal()) fail('el formulario del agente no abrió');
else {
  const nombre = modal().querySelector('[data-campo="nombre"]');
  if (document.activeElement !== nombre) fail('el foco no fue al nombre del agente');
  primary().click();
  await sleep(dur('base') + 120);
  if (!modal() || !nombre.closest('.rad-field').hasAttribute('data-invalid')) fail('el formulario dejó guardar un agente sin nombre');
  type(nombre, 'Galen');
  modal().querySelector('[data-campo="modelo"][data-activo]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await frame();
  await pick('Haiku');
  type(modal().querySelector('[data-campo="instrucciones"]'), INSTRUCCIONES);
  primary().click();
  await frame();
  const nueva = cards().at(-1);
  if (cards().length !== 2) fail(`después de crear el agente hay ${cards().length} tarjetas`);
  else if (op(nueva) > 0.9) fail(`la tarjeta del agente nuevo apareció de golpe (opacidad ${r2(op(nueva))})`);
  await closed();
  await settle();
  if (op(nueva) !== 1) fail('la tarjeta del agente nuevo no terminó de entrar');
  if (shown(nueva.querySelector('.dm-tarjeta-nombre')) !== 'Galen' || shown(nueva.querySelector('.dm-tarjeta-modelo')) !== 'Claude Haiku 5.5') fail(`la tarjeta nueva dice «${shown(nueva.querySelector('.dm-tarjeta-nombre'))}» con «${shown(nueva.querySelector('.dm-tarjeta-modelo'))}»`);
  if (cards()[0].querySelector('[data-accion="eliminar"]').getAttribute('aria-disabled') !== 'false') fail('con dos agentes, el primero sigue sin poder borrarse');

  // Editarlo: la tarjeta es la misma, con el nombre nuevo.
  nueva.querySelector('[data-accion="editar"]').click();
  await frame();
  const nombre2 = modal()?.querySelector('[data-campo="nombre"]');
  if (nombre2?.value !== 'Galen') fail('el formulario de edición no trajo el nombre');
  else {
    type(nombre2, 'Galen on call');
    key(nombre2, 'Enter');
    await closed();
    await settle();
    if (cards().at(-1) !== nueva || shown(nueva.querySelector('.dm-tarjeta-nombre')) !== 'Galen on call') fail('editar el agente no actualizó su tarjeta (o la rehízo)');
  }
  const guardados = (await window.rad.store.read('agentes'))?.lista ?? [];
  const g = guardados.find((a) => a.nombre === 'Galen on call');
  if (!g || g.modelo !== 'claude-haiku-5-5' || g.instrucciones !== INSTRUCCIONES) fail(`el agente se guardó como ${JSON.stringify(g)}`);
  data.agente = `${g?.nombre} · ${g?.modelo} · ${g?.instrucciones.length} caracteres de instrucciones`;

  // 2. Abrir sus chats: pasa a la vista de chat con ese agente elegido.
  nueva.querySelector('[data-accion="abrir"]').click();
  await sleep(dur('base') + 260);
}
if (view('chat').dataset.state !== 'active') fail('abrir los chats de un agente no llevó a la vista de chat');
if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'Galen on call') fail('el selector no muestra el agente elegido');
// El selector dice solo el nombre: el modelo va en la cabecera y en la barra
// de estado, no debajo del nombre.
{
  const selector = chatView.querySelector('.dm-agente');
  if (selector.textContent.trim() !== 'Galen on call') fail(`el selector de agente dice «${selector.textContent.trim()}»: tiene que decir solo el nombre`);
  const alto = selector.getBoundingClientRect().height;
  const nuevoChat = chatView.querySelector('[data-accion="nuevo-chat"]').getBoundingClientRect().height;
  if (Math.abs(alto - nuevoChat) > 1) fail(`el selector de agente mide ${r2(alto)} de alto y el botón de abajo ${r2(nuevoChat)}`);
  if (!shown(chatView.querySelector('.dm-conv-sub')).includes('Claude Haiku 5.5') || !statusRight().includes('Claude Haiku 5.5')) fail('el modelo del agente no figura ni en la cabecera ni en la barra de estado');
}

// 3. Crear un chat: aparece su fila, elegida. Con el chat todavía vacío,
// «Nuevo chat» no apila otro.
chatView.querySelector('[data-accion="nuevo-chat"]').click();
await settle();
if (rows().length !== 1 || rows()[0].getAttribute('aria-current') !== 'true') fail(`después de «Nuevo chat» hay ${rows().length} filas (o la nueva no quedó elegida)`);
chatView.querySelector('[data-accion="nuevo-chat"]').click();
await settle();
if (rows().length !== 1) fail('«Nuevo chat» apiló otro con el anterior todavía vacío');
const chatId = rows()[0]?.dataset.radKey;

// 4. Mandar un mensaje. Shift+Enter no manda; Enter sí. La respuesta llega
// de a poco: se mide el largo del texto cuadro por cuadro.
type(area, PREGUNTA);
if (send.disabled) fail('con texto en el campo, el botón de enviar sigue deshabilitado');
key(area, 'Enter', { shiftKey: true });
await frame();
if (msgs().length) fail('Shift+Enter mandó el mensaje');
key(area, 'Enter');
await until(() => msgs().length === 2, 2000);
const [mine, theirs] = msgs();
if (!mine || !theirs) fail(`después de mandar hay ${msgs().length} mensajes`);
else {
  if (mine.dataset.rol !== 'user' || mine.textContent !== PREGUNTA) fail(`el mensaje del usuario salió como «${mine.textContent}»`);
  if (area.value !== '') fail('el campo no se vació al mandar');
  const body = theirs.querySelector('.dm-msg-cuerpo');
  if (theirs.dataset.estado !== 'escribiendo' || !theirs.querySelector('.dm-msg-pie').hasAttribute('data-abierto')) fail('la respuesta no arrancó marcada como en curso');
  if (shown(theirs.querySelector('.dm-msg-nota')) !== 'Thinking') fail(`antes del primer texto la nota dice «${shown(theirs.querySelector('.dm-msg-nota'))}»`);

  const sizes = [];
  let firstBlock = null;
  await until(() => {
    const n = body.textContent.length;
    if (n !== sizes.at(-1)) sizes.push(n);
    // El primer bloque, apenas hay un segundo: desde ahí ya está completo.
    if (!firstBlock && body.children.length >= 2) firstBlock = body.firstElementChild;
    return n > 260;
  }, 6000);
  if (send.dataset.modo !== 'frenar' || send.getAttribute('aria-label') !== 'Stop') fail('mientras llega la respuesta el botón no pasó a Frenar');
  if (composer.getAttribute('aria-busy') !== 'true' || !composer.querySelector('.rad-busy')) fail('el campo no muestra que está trabajando (anillo de carga)');
  if (rows()[0] && !rows()[0].hasAttribute('data-respondiendo')) fail('la fila del chat no marca que está contestando');
  await sleep(dur('fast') + dur('base') + 60);
  if (statusRight() !== 'Answering…') fail(`la barra de estado dice «${statusRight()}» mientras llega la respuesta`);
  if (shown(theirs.querySelector('.dm-msg-nota')) !== 'Writing') fail(`con texto llegando la nota dice «${shown(theirs.querySelector('.dm-msg-nota'))}»`);

  // 5. Frenarla a mitad de camino: deja de crecer, queda lo que había
  // llegado, y todo vuelve a su lugar.
  send.click();
  await until(() => theirs.dataset.estado === 'frenado', 1500);
  const stopped = body.textContent.length;
  sizes.push(stopped);
  await sleep(450);
  if (theirs.dataset.estado !== 'frenado') fail(`después de frenar la respuesta quedó en estado ${theirs.dataset.estado}`);
  if (body.textContent.length !== stopped) fail(`la respuesta siguió creciendo después de frenar: ${stopped} → ${body.textContent.length}`);
  for (let i = 1; i < sizes.length; i++) if (sizes[i] < sizes[i - 1]) { fail('el texto de la respuesta se achicó mientras llegaba'); break; }
  if (sizes.length < 8) fail(`la respuesta llegó en ${sizes.length} pasos: no se la vio llegar de a poco`);
  if (sizes[0] > 60) fail(`el primer texto que se vio ya tenía ${sizes[0]} caracteres`);
  if (body.firstElementChild !== firstBlock) fail('el primer bloque de la respuesta se rehízo mientras llegaba el resto');
  if (shown(theirs.querySelector('.dm-msg-nota')) !== 'Stopped.') fail(`la respuesta frenada dice «${shown(theirs.querySelector('.dm-msg-nota'))}»`);
  if (send.dataset.modo !== 'enviar') fail('después de frenar el botón no volvió a Enviar');
  await sleep(dur('slow') + 260);
  if (composer.querySelector('.rad-busy') || composer.hasAttribute('aria-busy')) fail('el anillo de carga quedó después de frenar');
  if (op(rows()[0].querySelector('.dm-fila-punto')) !== 0) fail(`el punto de «contestando» de la fila sigue a la vista con el chat quieto (opacidad ${r2(op(rows()[0].querySelector('.dm-fila-punto')))})`);
  if (shown(rows()[0]?.querySelector('.dm-fila-titulo')) !== PREGUNTA) fail(`el chat no tomó el título del primer mensaje: «${shown(rows()[0]?.querySelector('.dm-fila-titulo'))}»`);
  // El título no entra en la fila: se corta con puntos suspensivos, no se
  // mete debajo del botón de acciones.
  {
    const titulo = rows()[0].querySelector('.dm-fila-titulo > :not(.rad-swap-out)');
    const mas = rows()[0].querySelector('.dm-fila-mas').getBoundingClientRect();
    const t = titulo.getBoundingClientRect();
    if (!(titulo.scrollWidth > titulo.clientWidth)) fail(`el título de la fila ya no es más largo que la fila (${titulo.scrollWidth} en ${titulo.clientWidth}): la prueba no prueba nada`);
    if (t.right > mas.left + 0.5) fail(`el título de la fila llega hasta ${r2(t.right)} y se mete debajo del botón de acciones, que empieza en ${r2(mas.left)}`);
  }
  data.llegada = `${sizes.length} pasos: ${sizes.filter((_, i) => i % 4 === 0).join(' → ')} · frenada en ${stopped}`;
  data.frenado = stopped;

  // 6. Otro mensaje, hasta el final: el markdown queda armado, el pedido
  // viajó entero (modelo, instrucciones, los tres mensajes) y el texto se
  // puede seleccionar.
  // El mensaje trae HTML: el simulado lo repite en su respuesta, y tiene que
  // salir como texto, no como etiquetas.
  type(area, 'Go on. <b>fake bold</b> <img src="x" onerror="window.__colado = 1">');
  key(area, 'Enter');
  await until(() => msgs().length === 4 && msgs()[3].dataset.estado === 'ok', 9000);
  const full = msgs()[3];
  if (!full || full.dataset.estado !== 'ok') fail(`la segunda respuesta no terminó (estado ${full?.dataset.estado})`);
  else {
    const md = full.querySelector('.dm-msg-cuerpo');
    const has = (sel) => md.querySelector(sel);
    if (has('.dm-titulo')?.textContent !== 'Simulated answer') fail('la respuesta no trae su título');
    if (thread().querySelector('img, b') || window.__colado) fail('el HTML de un mensaje se interpretó en vez de mostrarse como texto');
    if (!md.textContent.includes('<b>fake bold</b>') || !msgs()[2].textContent.includes('<b>fake bold</b>')) fail('el HTML de un mensaje no quedó a la vista como texto');
    if (has('strong')?.textContent !== 'not') fail('la negrita no se armó');
    if (md.querySelectorAll('ul > li').length !== 4) fail(`la lista tiene ${md.querySelectorAll('ul > li').length} items`);
    if (!has('.dm-codigo code')?.textContent.includes("console.log(greet('BlackCode'));")) fail('el bloque de código no llegó entero');
    if (has('.dm-codigo-lang')?.textContent !== 'js') fail('el bloque de código no dice su lenguaje');
    if (md.querySelectorAll('.dm-tabla tbody tr').length !== 2 || has('.dm-tabla em')?.textContent !== 'works') fail('la tabla no se armó');
    if (/[*`#|]/.test(md.textContent.replace(has('.dm-codigo code').textContent, ''))) fail('quedaron marcas de markdown sin interpretar a la vista');
    if (has('li code')?.textContent !== 'claude-haiku-5-5') fail(`el modelo que viajó es ${has('li code')?.textContent}`);
    if (!md.textContent.includes(`instructions: ${INSTRUCCIONES.length} characters`)) fail('las instrucciones del agente no viajaron con el pedido');
    if (!md.textContent.includes('provider: anthropic')) fail('el pedido de un agente de Anthropic no viajó a Anthropic');
    if (!md.textContent.includes('messages in the request: 3')) fail('el pedido no llevó el chat entero (pregunta, respuesta frenada y el mensaje nuevo)');
    await sleep(dur('base') + 120);
    if (full.querySelector('.dm-msg-pie').getBoundingClientRect().height > 1) fail('el pie de una respuesta que terminó bien no se plegó');
    // Seleccionar de verdad: lo que es chrome (el botón de copiar) no entra.
    const sel = getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(thread());
    sel.addRange(range);
    const picked = sel.toString();
    sel.removeAllRanges();
    if (!picked.includes(PREGUNTA) || !picked.includes('Simulated answer') || !picked.includes('const greet')) fail('el texto de los mensajes no se puede seleccionar');
    if (picked.includes('Copy')) fail('la selección se lleva el botón de copiar');
    const t = thread();
    if (t.scrollHeight - t.clientHeight - t.scrollTop > 2) fail(`la conversación no quedó al fondo: faltan ${Math.round(t.scrollHeight - t.clientHeight - t.scrollTop)} px`);
    data.markdown = `título, negrita, ${md.querySelectorAll('ul > li').length} items, código ${has('.dm-codigo-lang').textContent}, tabla de ${md.querySelectorAll('.dm-tabla tbody tr').length} filas`;
  }
}

// 6b. Fórmulas en LaTeX. Se pinta un texto de prueba con el mismo pintor de
// los mensajes, adentro de la conversación, y se mira lo que quedó dibujado.
{
  const { pintar } = await import('/markdown.js');
  const formulas = await import('/formula.js');
  const violaciones = [];
  const alViolar = (e) => violaciones.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || ''));
  document.addEventListener('securitypolicyviolation', alViolar);
  const caja = document.createElement('div');
  caja.className = 'dm-msg-cuerpo dm-md';
  thread().append(caja);
  const B = String.fromCharCode(92); // la barra invertida
  const TEXTO = [
    'Block:',
    '',
    '$$',
    B + 'mathrm{Fe_2O_3 + 2' + B + ',Al ' + B + 'longrightarrow 2' + B + ',Fe + Al_2O_3} ' + B + 'qquad ' + B + 'Delta H^' + B + 'circ ' + B + 'approx -851.5' + B + ' ' + B + 'mathrm{kJ/mol}',
    '$$',
    '',
    'Inline: $' + B + 'mathrm{Fe_2O_3 + 2Al ' + B + 'rightarrow 2Fe + Al_2O_3}$ and ' + B + '(x^2 + y^2 = z^2' + B + ') here.',
    '',
    'Chemistry: $' + B + 'ce{Fe2O3 + 2Al -> 2Fe + Al2O3}$',
    '',
    'On its own line:',
    '',
    B + '[ E = mc^2 ' + B + ']',
    '',
    'Money: it costs $5 and then $10, not math. And code: ' + String.fromCharCode(96) + '$x$' + String.fromCharCode(96) + ' stays code.',
    '',
    '- in a list: $a_1 + a_2$',
    '',
    'Broken: $' + B + 'frac{1}{$',
    '',
    '$$',
    'x = ' + B + 'frac{1}{2}',
  ].join('\n');
  pintar(caja, TEXTO);
  // Antes de que KaTeX llegue (o en el mismo cuadro, si ya estaba) la fórmula
  // existe con su texto: nunca queda un hueco.
  const todas = () => [...caja.querySelectorAll('.dm-formula')];
  if (todas().length !== 6) fail('fórmulas: se reconocieron ' + todas().length + ' de 6 (' + todas().map((f) => f.dataset.tex.slice(0, 14)).join(' | ') + ')');
  if (todas().some((f) => !f.textContent.trim())) fail('fórmulas: una nació vacía');
  await formulas.lista();
  await until(() => todas().every((f) => f.dataset.estado !== 'pendiente'), 5000);
  await document.fonts.ready;
  await sleep(dur('base') + 120);
  const estados = todas().map((f) => f.dataset.estado).join();
  if (estados !== 'lista,lista,lista,lista,lista,lista') fail('fórmulas: quedaron ' + estados);
  const bloque = caja.querySelector('.dm-formula-bloque .dm-formula');
  if (!bloque || bloque.dataset.display !== 'bloque' || !bloque.querySelector('.katex-display')) fail('fórmulas: el bloque $$ no se dibujó como bloque');
  if (caja.querySelectorAll('.dm-formula-bloque').length !== 2) fail('fórmulas: se esperaban dos bloques ($$ y la de una línea), hay ' + caja.querySelectorAll('.dm-formula-bloque').length);
  // KaTeX pone sus medidas por estilos: si la CSP se los comiera, los
  // subíndices quedarían a la altura del renglón.
  const sub = bloque?.querySelector('.msupsub .vlist span[style]') ?? bloque?.querySelector('.vlist > span');
  if (!sub || !sub.style.top) fail('fórmulas: los estilos de KaTeX no llegaron al DOM (¿los frenó la CSP?)');
  const base = bloque?.querySelector('.katex-html .mord');
  if (!base || !getComputedStyle(base).fontFamily.includes('KaTeX')) fail('fórmulas: no usan las fuentes de KaTeX: ' + (base ? getComputedStyle(base).fontFamily : 'sin nodo'));
  if (!document.fonts.check('16px KaTeX_Main')) fail('fórmulas: la fuente KaTeX_Main no cargó');
  // la química de mhchem: Fe2O3 sale con sus subíndices, no con el texto \ce
  const quimica = todas().find((f) => f.dataset.tex.startsWith(B + 'ce'));
  if (!quimica || quimica.querySelector('.katex-error') || !quimica.querySelector('.msupsub') || quimica.querySelector('.katex-html').textContent.includes('ce{')) fail('fórmulas: \\ce de mhchem no se dibujó');
  // lo que NO es una fórmula
  const plata = [...caja.querySelectorAll('p')].find((p) => p.textContent.startsWith('Money'));
  if (!plata || plata.querySelector('.dm-formula') || !plata.textContent.includes('$5 and then $10') || plata.querySelector('code')?.textContent !== '$x$') fail('fórmulas: tomó plata o código por una fórmula: «' + plata?.textContent + '»');
  const rota = [...caja.querySelectorAll('p')].find((p) => p.textContent.startsWith('Broken'));
  if (!rota || rota.querySelector('.dm-formula')) fail('fórmulas: una fórmula sin cerrar se dibujó');
  // una fórmula en bloque que todavía está llegando se ve como texto
  const abierta = caja.querySelector('.dm-formula-abierta');
  if (!abierta || !abierta.textContent.includes('frac{1}{2}')) fail('fórmulas: un bloque sin cerrar no muestra su texto');
  // …y al llegar el cierre se dibuja, sin rehacer las de arriba
  const primera = todas()[0];
  pintar(caja, TEXTO + '\n$$');
  await sleep(60);
  if (caja.querySelector('.dm-formula-abierta') || caja.querySelectorAll('.dm-formula-bloque').length !== 3) fail('fórmulas: el bloque no se dibujó al cerrarse');
  if (todas()[0] !== primera) fail('fórmulas: al llegar más texto se rehicieron las que ya estaban');
  // no ensancha la conversación, y nada que frenó la CSP rompió el dibujo
  if (thread().scrollWidth > Math.round(thread().getBoundingClientRect().width) + 1) fail('fórmulas: una fórmula ensanchó la conversación');
  const alto = Math.round(bloque.getBoundingClientRect().height);
  if (alto < 18 || alto > 90) fail('fórmulas: el bloque mide ' + alto + ' px de alto');
  document.removeEventListener('securitypolicyviolation', alViolar);
  const graves = violaciones.filter((v) => !v.startsWith('style-src-attr'));
  if (graves.length) fail('fórmulas: la CSP frenó ' + graves.join('; '));
  data.formulas = todas().length + ' dibujadas, bloque de ' + alto + ' px, fuente ' + getComputedStyle(base).fontFamily.split(',')[0] + ' peso ' + getComputedStyle(base).fontWeight + ' de ' + getComputedStyle(base).fontSize + (violaciones.length ? ', ' + violaciones.length + ' estilos en atributo descartados por la CSP' : '');
  caja.remove();
}

// 7. Un segundo chat. La conversación anterior se va y recién después entra
// la nueva: nunca las dos a la vista.
chatView.querySelector('[data-accion="nuevo-chat"]').click();
const relay = [];
for (const t0 = performance.now(); performance.now() - t0 < dur('fast') + dur('base') + 160;) {
  await frame();
  const out = threads().find((t) => t.hasAttribute('data-rad-leaving'));
  const live = thread();
  relay.push({ out: out ? op(out) : 0, live: live ? op(live) : 0 });
}
const both = Math.max(...relay.map((f) => Math.min(f.out, f.live)));
if (both > 0.08) fail(`al cambiar de chat se vieron las dos conversaciones a la vez (las dos por encima de ${r2(both)})`);
if (threads().length !== 1) fail(`después de cambiar de chat quedaron ${threads().length} conversaciones en el DOM`);
if (rows().length !== 2 || rows()[0].getAttribute('aria-current') !== 'true') fail('el chat nuevo no quedó primero y elegido');
if (msgs().length || !thread()?.querySelector('.dm-vacio')) fail('el chat nuevo no abrió vacío');
data.relevo = relay.filter((_, i) => i % 2 === 0).map((f) => `${r2(f.out)}/${r2(f.live)}`).join(' ');

// 8. Borrarlo mientras contesta, desde su menú contextual: pide confirmar,
// la fila se va, el documento se borra y vuelve a abrirse el otro chat.
const doomed = rows()[0];
const doomedId = doomed.dataset.radKey;
type(area, 'This chat is going to be deleted.');
key(area, 'Enter');
await until(() => msgs().length === 2 && msgs()[1].querySelector('.dm-msg-cuerpo').textContent.length > 40, 4000);
const box = doomed.getBoundingClientRect();
doomed.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: Math.round(box.left + 30), clientY: Math.round(box.top + 12) }));
await frame();
if (!menus().length) fail('el click derecho sobre un chat no abrió su menú');
else {
  await pick('Delete');
  if (!modal()) fail('eliminar un chat no pidió confirmación');
  else {
    const botones = [...modal().querySelectorAll('.rad-button')].map((b) => b.textContent).join(', ');
    if (botones !== 'Cancel, Delete') fail(`el confirm de eliminar un chat ofrece: ${botones}`);
    enIngles('con el confirm abierto');
    if (!rows().includes(doomed)) fail('el chat se borró antes de confirmar');
    primary().click();
    await frame();
    if (!doomed.isConnected) fail('la fila del chat borrado salió del DOM de golpe');
    await closed();
    await settle();
  }
}
if (doomed.isConnected || rows().length !== 1) fail(`después de borrar el chat quedan ${rows().length} filas`);
if (await window.rad.store.read(`chat-${doomedId}`) !== undefined) fail('el documento del chat borrado sigue en el store');
if (rows()[0]?.getAttribute('aria-current') !== 'true' || msgs().length !== 4) fail(`después de borrar no volvió a abrirse el otro chat (${msgs().length} mensajes a la vista)`);
await sleep(dur('fast') + dur('base') + 400);
if (statusRight() === 'Answering…' || composer.querySelector('.rad-busy')) fail('borrar un chat que estaba contestando dejó la app «respondiendo»');
data.chatBorrado = doomedId;

// 9. Renombrar el que queda, desde su botón de acciones.
rows()[0].querySelector('.dm-fila-mas').click();
await frame();
await pick('Rename');
const campo = modal()?.querySelector('.rad-input');
if (!campo) fail('renombrar no abrió su formulario');
else {
  if (campo.value !== PREGUNTA) fail(`el formulario de renombrar trajo «${campo.value}»`);
  type(campo, 'Headache');
  key(campo, 'Enter');
  await closed();
  await settle();
  if (shown(rows()[0].querySelector('.dm-fila-titulo')) !== 'Headache') fail(`la fila quedó como «${shown(rows()[0].querySelector('.dm-fila-titulo'))}»`);
  if (shown(chatView.querySelector('.dm-conv-titulo')) !== 'Headache') fail('el título de la conversación no tomó el nombre nuevo');
}

// 10. La llave de Anthropic. Que esté guardada no quiere decir que sirva:
// BlackCode le pregunta a la API (acá a la simulada, que contesta según el texto
// de la llave) y dice lo que la API contestó, no lo que parece por cómo
// empieza. Y la que guarda no queda a la vista ni al alcance del renderer.
await go('ajustes');
const aj = view('ajustes').querySelector('[data-proveedor="anthropic"]');
const estado = aj.querySelector('.dm-estado');
const llaveIn = aj.querySelector('[data-campo="llave"]');
const guardar = aj.querySelector('[data-accion="guardar-llave"]');
const dice = () => shown(estado.querySelector('.dm-estado-texto'));
const anillo = () => [...aj.querySelectorAll(':scope > .rad-busy')].find((r) => !r.hasAttribute('data-rad-leaving') && r.dataset.state !== 'closing');
const detalle = aj.querySelector('.dm-estado-detalle');
// Mira un rato si en algún momento se puso a comprobar.
const seComprobo = async (ms) => {
  let visto = false;
  await until(() => { visto ||= estado.dataset.comprobacion === 'comprobando'; return false; }, ms);
  return visto;
};
// Guarda una llave y sigue la comprobación hasta que la API contesta.
// Devuelve lo que se vio mientras tanto.
const guardarLlave = async (valor) => {
  type(llaveIn, valor);
  guardar.click();
  const visto = { comprobando: false, anillo: false, verde: false };
  await until(() => estado.dataset.comprobacion === 'comprobando', 2500);
  if (estado.dataset.comprobacion === 'comprobando') {
    visto.comprobando = true;
    await frame();
    visto.anillo = Boolean(anillo());
    visto.verde = estado.dataset.tono === 'success';
  }
  await until(() => estado.dataset.comprobacion !== 'comprobando', 4000);
  await settle();
  return visto;
};

enIngles('en Ajustes');
if (estado.dataset.llave !== 'falta') fail(`sin llave, Ajustes dice ${estado.dataset.llave}`);
if (!aj.querySelector('[data-accion="quitar-llave"]').disabled) fail('sin llave, se ofrece quitarla');
type(llaveIn, 'hola');
guardar.click();
await sleep(dur('base') + 200);
if (!llaveIn.closest('.rad-field').hasAttribute('data-invalid') || estado.dataset.llave !== 'falta') fail('Ajustes aceptó algo que no es una llave');

// Una que la API acepta. Mientras pregunta no la da por buena: lo dice, y la
// tarjeta trabaja (el anillo de carga).
const primera = await guardarLlave(LLAVE);
if (!primera.comprobando || !primera.anillo) fail(`al guardar la llave no se vio que la estuviera comprobando (${JSON.stringify(primera)})`);
if (primera.verde) fail('dio la llave por buena antes de que la API contestara');
if (estado.dataset.comprobacion !== 'aceptada' || estado.dataset.tono !== 'success') fail(`una llave que la API acepta figura como ${estado.dataset.comprobacion} (${estado.dataset.tono})`);
if (!dice().startsWith('Anthropic accepts it') || !dice().endsWith('sk-ant-api…0000')) fail(`el estado de la llave dice «${dice()}»`);
if (llaveIn.value !== '') fail('el campo de la llave no se vació al guardar');
await sleep(dur('slow') + 260);
if (aj.querySelector(':scope > .rad-busy') || aj.hasAttribute('aria-busy')) fail('el anillo de carga quedó en la tarjeta después de comprobar');
if (detalle.getBoundingClientRect().height > 1) fail('con la llave aceptada quedó abierto el renglón de lo que dijo la API');

// La que le pasó a Fran: una llave «de usuario» (por cómo empieza) que la API
// acepta. Sirve, y BlackCode no puede decir otra cosa.
await guardarLlave('sk-ant-usr01-humo-de-blackcode-no-es-una-llave-0000');
if (estado.dataset.comprobacion !== 'aceptada' || estado.dataset.tono !== 'success' || /user key|rejects/.test(dice())) fail(`una llave de usuario que la API acepta figura como «${dice()}»`);

// Una que no está atada a un workspace: la API la rechaza, y se ve el motivo
// de verdad, con lo que dijo la API.
await guardarLlave('sk-ant-api03-humo-sin-workspace-no-es-una-llave-0000');
if (estado.dataset.comprobacion !== 'rechazada' || estado.dataset.motivo !== 'sin-workspace' || estado.dataset.tono !== 'danger') fail(`una llave sin workspace figura como ${estado.dataset.comprobacion} / ${estado.dataset.motivo} (${estado.dataset.tono})`);
if (!dice().includes('not scoped to a workspace')) fail(`de una llave sin workspace dice «${dice()}»`);
await sleep(dur('base') + 120);
if (detalle.getBoundingClientRect().height < 10 || !shown(detalle.querySelector('.dm-estado-detalle-texto')).includes('anthropic-workspace-id')) fail('no se ve lo que dijo la API al rechazar la llave');
enIngles('con una llave rechazada');
data.llaveRechazada = dice();

// Sin conexión no se sabe nada: no es un rechazo. Se puede volver a
// comprobar con su botón, y al volver a Ajustes se pregunta de nuevo sola.
await guardarLlave('sk-ant-api03-humo-sin-conexion-no-es-una-llave-0000');
if (estado.dataset.comprobacion !== 'sin-comprobar' || estado.dataset.tono !== 'warning' || !dice().includes('could not be checked')) fail(`sin conexión, la llave figura como ${estado.dataset.comprobacion} (${estado.dataset.tono}): «${dice()}»`);
await sleep(dur('base') + 120);
if (detalle.getBoundingClientRect().height > 1) fail('el renglón de lo que dijo la API quedó abierto sin nada que mostrar');
aj.querySelector('[data-accion="comprobar-llave"]').click();
if (!await seComprobo(700)) fail('«Comprobar de nuevo» no volvió a preguntar');
await until(() => estado.dataset.comprobacion !== 'comprobando', 3000);
await go('chat');
document.querySelector('.rad-tab[data-view="ajustes"]').click();
if (!await seComprobo(700)) fail('al volver a Ajustes no reintentó una comprobación que había quedado sin hacer');
await until(() => estado.dataset.comprobacion !== 'comprobando', 3000);

// Queda la buena. Lo que la API ya contestó no se vuelve a preguntar cada
// vez que se abre Ajustes.
await guardarLlave(LLAVE);
if (estado.dataset.comprobacion !== 'aceptada') fail(`la última llave figura como ${estado.dataset.comprobacion}`);
await go('chat');
document.querySelector('.rad-tab[data-view="ajustes"]').click();
if (await seComprobo(700)) fail('al volver a Ajustes volvió a preguntar por una llave que la API ya había aceptado');
if (estado.dataset.comprobacion !== 'aceptada') fail('al volver a Ajustes se perdió lo que había contestado la API');

if (/no-es-una-llave/.test(document.documentElement.outerHTML)) fail('una llave quedó escrita en la página');
let reservado = false;
try { await window.rad.store.read('_llave'); } catch { reservado = true; }
if (!reservado) fail('el renderer pudo leer el documento de la llave');
data.llave = dice();

// 11. Venice. Su llave va aparte de la de Anthropic. Un agente con ese
// proveedor elige entre los modelos de Venice (el select de modelos releva
// al de Anthropic), y su pedido viaja a ese proveedor con ese modelo.
const ve = view('ajustes').querySelector('[data-proveedor="venice"]');
const veEstado = ve.querySelector('.dm-estado');
if (veEstado.dataset.llave !== 'falta') fail('guardar la llave de Anthropic tocó la de Venice');
type(ve.querySelector('[data-campo="llave"]'), LLAVE_VENICE);
ve.querySelector('[data-accion="guardar-llave"]').click();
await until(() => veEstado.dataset.llave === 'lista', 3000);
await settle();
if (veEstado.dataset.llave !== 'lista' || !shown(veEstado.querySelector('.dm-estado-texto')).endsWith('…1111')) fail(`la llave de Venice figura como ${veEstado.dataset.llave}: «${shown(veEstado.querySelector('.dm-estado-texto'))}»`);
if (estado.dataset.llave !== 'lista') fail('guardar la llave de Venice pisó la de Anthropic');
if (document.documentElement.outerHTML.includes(LLAVE_VENICE)) fail('la llave de Venice quedó escrita en la página');
if (ve.querySelector('[data-accion="comprobar-llave"]') || veEstado.dataset.comprobacion !== 'sin-pedir') fail('la llave de Venice, que no tiene cómo comprobarse, figura como comprobada');

await go('agentes');
view('agentes').querySelector('[data-accion="nuevo-agente"]').click();
await frame();
let chatVenice = null;
if (!modal()) fail('el formulario del agente no abrió la segunda vez');
else {
  const form = modal();
  const activo = () => form.querySelector('[data-campo="modelo"][data-activo]');
  type(form.querySelector('[data-campo="nombre"]'), 'Oracle');
  if (activo()?.dataset.proveedor !== 'anthropic') fail('el formulario de un agente nuevo no arranca con Anthropic');
  form.querySelector('[data-campo="proveedor"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await frame();
  await pick('Venice');
  const viejo = form.querySelector('[data-campo="modelo"][data-proveedor="anthropic"]');
  if (form.querySelectorAll('[data-campo="modelo"][data-activo]').length !== 1 || activo()?.dataset.proveedor !== 'venice') fail('elegir Venice no relevó el select de modelos');
  if (op(viejo) !== 0 || !viejo.inert) fail(`el select de modelos de Anthropic quedó a la vista (opacidad ${r2(op(viejo))})`);
  if (shown(activo().querySelector('.rad-select-value')) !== 'Grok 4.7') fail(`el modelo que Venice ofrece primero es «${shown(activo().querySelector('.rad-select-value'))}»`);
  activo().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await frame();
  const ofrece = [...(menus()[0]?.querySelectorAll('.rad-menu-label') ?? [])].map((l) => l.textContent);
  if (ofrece.includes('Claude Haiku 5.5') || !ofrece.includes('Kimi K3')) fail(`el select de modelos de Venice ofrece: ${ofrece.join(', ')}`);
  await pick(MODELO_LARGO);
  // El caso de Fran: «DeepSeek V4.1 Flash 1017 Uncensored» no entraba en el
  // select y tapaba el chevron. En el formulario tiene que verse entero (los
  // modelos de Venice se distinguen por el final), con el chevron en su lugar.
  {
    const boton = activo();
    const vivo = boton.querySelector('.rad-select-value > :not(.rad-swap-out)');
    const b = boton.getBoundingClientRect();
    const t = vivo.getBoundingClientRect();
    const chev = boton.querySelector('.rad-select-chevron').getBoundingClientRect();
    if (vivo.textContent !== MODELO_LARGO) fail(`el select de modelos muestra «${vivo.textContent}»`);
    if (vivo.scrollWidth > vivo.clientWidth) fail(`el nombre largo del modelo se corta en el formulario: mide ${vivo.scrollWidth} en una caja de ${vivo.clientWidth}`);
    if (t.right > chev.left + 0.5) fail(`el nombre del modelo llega hasta ${r2(t.right)} y tapa el chevron, que empieza en ${r2(chev.left)}`);
    if (chev.width < 8 || chev.right > b.right + 0.5) fail(`el chevron del select de modelos quedó fuera del botón: ${r2(chev.left)}–${r2(chev.right)} en un botón hasta ${r2(b.right)}`);
    enIngles('en el formulario del agente');
    data.modeloLargo = `texto ${r2(t.left)}–${r2(t.right)}, chevron ${r2(chev.left)}–${r2(chev.right)}, botón hasta ${r2(b.right)}`;
  }
  primary().click();
  await closed();
  await settle();
  const oraculo = cards().at(-1);
  if (cards().length !== 3 || shown(oraculo.querySelector('.dm-tarjeta-modelo')) !== `Venice · ${MODELO_LARGO}`) fail(`la tarjeta del agente de Venice dice «${shown(oraculo?.querySelector('.dm-tarjeta-modelo'))}»`);
  oraculo.querySelector('[data-accion="abrir"]').click();
  await sleep(dur('base') + 260);
  type(area, 'Who are you?');
  key(area, 'Enter');
  await until(() => msgs().length === 2 && msgs()[1].dataset.estado === 'ok', 9000);
  const dijo = msgs()[1]?.querySelector('.dm-msg-cuerpo').textContent ?? '';
  if (!dijo.includes('provider: venice') || !dijo.includes('deepseek-v4-1-flash-1017-uncensored')) fail('el pedido del agente de Venice no viajó a Venice con su modelo');
  chatVenice = rows()[0]?.dataset.radKey;
  // Con ese agente abierto, nada del lado se sale de su columna (antes, el
  // modelo iba debajo del nombre y se salía del selector) y la cabecera de la
  // conversación tampoco se sale de la suya.
  {
    const dentro = (caja, sel) => {
      const borde = caja.getBoundingClientRect().right;
      for (const el of caja.querySelectorAll(sel)) {
        if (!el.firstChild || el.closest('.rad-swap-out')) continue;
        const rango = document.createRange();
        rango.selectNodeContents(el);
        const fin = Math.max(el.getBoundingClientRect().right, el.scrollWidth > el.clientWidth ? 0 : rango.getBoundingClientRect().right);
        if (fin > borde + 0.5) return `«${el.textContent.trim().slice(0, 40)}» llega hasta ${r2(fin)}, y la caja termina en ${r2(borde)}`;
      }
      return null;
    };
    const selector = chatView.querySelector('.dm-agente');
    const seSale = dentro(selector, '.dm-agente-nombre > *') ?? dentro(chatView.querySelector('.dm-lado'), '.dm-agente *, .dm-fila-titulo > *') ?? dentro(chatView.querySelector('.dm-conv-cabeza'), '.dm-conv-titulo > *, .dm-conv-sub > *');
    if (seSale) fail(`un texto se sale de su caja: ${seSale}`);
    if (selector.textContent.trim() !== 'Oracle') fail(`el selector de agente dice «${selector.textContent.trim()}»`);
    if (!statusRight().includes(MODELO_LARGO)) fail(`la barra de estado no dice el modelo del agente: «${statusRight()}»`);
    enIngles('en el chat');
  }
  data.venice = `${shown(oraculo.querySelector('.dm-tarjeta-modelo'))}; ofrece ${ofrece.join(', ')}`;

  // De vuelta a Galeno, desde el selector de agentes.
  chatView.querySelector('[data-accion="agente"]').click();
  await frame();
  await pick('Galen on call');
  await until(() => msgs().length === 4, 2500);
  if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'Galen on call' || msgs().length !== 4) fail(`cambiar de agente desde el selector no trajo su chat (${msgs().length} mensajes a la vista)`);
}

// 11b. Tools. Un agente con las tools de archivos y de comandos prendidas. El
// proveedor de mentira pide las llamadas que el mensaje le dicta (un renglón
// «TOOLS: […]») por el motor de verdad, sobre una carpeta descartable: lo que
// se mide es el despachador, la tarjeta de permiso, las filas con su estado y
// el contador. Es el circuito entero menos el modelo.
{
  const tools = () => alive(thread()?.querySelectorAll('.dm-tool') ?? []);
  const fila = (name, n = -1) => tools().filter((t) => t.dataset.tool === name).at(n);
  const permiso = () => alive(document.querySelectorAll('.rad-overlays .rad-modal[data-permiso]')).find((m) => m.dataset.state === 'open');
  const ultimo = () => msgs().at(-1);
  const cuenta = () => shown(ultimo()?.querySelector('.dm-msg-cuenta-texto'));
  const pedir = async (llamadas) => { type(area, `TOOLS: ${llamadas.map((r) => JSON.stringify(r)).join(' ;; ')}`); key(area, 'Enter'); };
  const terminado = (n) => until(() => msgs().length === n && ultimo().dataset.estado === 'ok', 20000);

  await go('agentes');
  view('agentes').querySelector('[data-accion="nuevo-agente"]').click();
  await frame();
  const form = modal();
  type(form.querySelector('[data-campo="nombre"]'), 'Toolsmith');
  const interruptores = [...form.querySelectorAll('[data-campo="tools"] input[role="switch"]')];
  if (interruptores.map((i) => i.dataset.grupo).join() !== 'files,commands,code,data,web,browser,desktop,screen,canvas,notes,subagents,memory,skills' || !interruptores.every((i) => i.checked)) fail(`el formulario ofrece las tools: ${interruptores.map((i) => `${i.dataset.grupo}=${i.checked}`).join(', ')}`);
  // un agente nuevo nace con todas prendidas: se le apaga la web
  for (const i of interruptores) if (i.dataset.grupo === 'web') i.click();
  enIngles('en el formulario con tools');
  primary().click();
  await closed();
  await settle();
  const herrero = cards().at(-1);
  if (shown(herrero.querySelector('.dm-tarjeta-tools')) !== 'Tools: Files, Commands, Code, Databases, Browser, Desktop, Screen, Canvas, Notes, Subagents, Memory, Skills') fail(`la tarjeta del agente dice «${shown(herrero.querySelector('.dm-tarjeta-tools'))}»`);
  if (shown(cards()[0].querySelector('.dm-tarjeta-tools')) !== 'Tools: Files, Commands, Code, Databases, Web, Browser, Desktop, Screen, Canvas, Notes, Subagents, Memory, Skills') fail(`el agente de fábrica no nació con todas las tools: «${shown(cards()[0].querySelector('.dm-tarjeta-tools'))}»`);
  herrero.querySelector('[data-accion="abrir"]').click();
  await sleep(dur('base') + 260);
  await until(() => statusRight().includes('Toolsmith'), 3000);
  // todas (32) menos las tres de la web
  if (!statusRight().endsWith('· 29 tools')) fail(`la barra de estado no dice cuántas tools tiene el agente: «${statusRight()}»`);

  // Escribir un archivo. En modo manual (el de fábrica) primero pide permiso:
  // la tarjeta dice qué va a correr y qué va a cambiar, y hasta que no se
  // contesta no hay fila ni archivo.
  await pedir([[{ name: 'fs_write', args: { path: 'note.txt', content: 'one\ntwo\n' } }]]);
  await until(() => permiso(), 5000);
  const p1 = permiso();
  if (!p1) fail('una tool en modo manual no pidió permiso');
  else {
    if (!p1.textContent.includes('Allow fs_write?') || !p1.textContent.includes('A new file, 2 lines.')) fail(`la tarjeta de permiso dice: ${p1.textContent.slice(0, 160)}`);
    if (tools().length) fail('la tool dejó su fila antes de que se contestara la tarjeta');
    enIngles('con la tarjeta de permiso');
    primary().click();
    await closed();
  }
  await terminado(3);
  if (fila('fs_write')?.dataset.estado !== 'ok') fail(`la fila de fs_write quedó en «${fila('fs_write')?.dataset.estado}»`);
  if (shown(fila('fs_write')?.querySelector('.dm-tool-que')) !== 'note.txt' || shown(fila('fs_write')?.querySelector('.dm-tool-estado')) !== 'done') fail('la fila no dice qué archivo tocó ni que terminó');
  if (cuenta() !== '1 tool · 1 done') fail(`el contador dice «${cuenta()}»`);
  const dijo = ultimo().querySelector('.dm-msg-cuerpo').textContent;
  if (!dijo.includes('record seen: yes') || !dijo.includes('protocol: yes')) fail('la app no le puso al modelo el registro del turno o el protocolo de tools');
  // La tira en orden: lo que dijo antes, la fila, y lo que dijo después.
  const orden = [...thread().querySelectorAll('.dm-col > :not([data-rad-leaving])')].map((n) => (n.classList.contains('dm-tool') ? 'tool' : n.dataset.rol)).join(',');
  if (orden !== 'user,assistant,tool,assistant') fail(`el turno quedó en este orden: ${orden}`);

  // Rechazar: la tarjeta muestra el diff, y al decir que no queda la fila
  // como rechazada y el archivo sin tocar.
  await pedir([[{ name: 'fs_edit', args: { path: 'note.txt', edits: [{ old: 'two', new: 'DECLINED' }] } }]]);
  await until(() => permiso(), 5000);
  const p2 = permiso();
  const renglones = [...(p2?.querySelectorAll('.dm-diff-renglon') ?? [])].map((r) => `${r.dataset.t}:${r.querySelector('.dm-diff-texto').textContent}`);
  if (!renglones.includes('menos:two') || !renglones.includes('mas:DECLINED')) fail(`la tarjeta de fs_edit no muestra el cambio: ${renglones.join(' | ')}`);
  [...p2.querySelectorAll('.rad-button')].find((b) => b.textContent === 'Decline').click();
  await closed();
  await terminado(6);
  if (fila('fs_edit')?.dataset.estado !== 'declined' || cuenta() !== '1 tool · 1 declined') fail(`una tool rechazada quedó como «${fila('fs_edit')?.dataset.estado}», contador «${cuenta()}»`);

  // Dos rondas, y «no preguntar más en este chat»: la primera tarjeta se
  // aprueba tildando eso, y las llamadas que siguen corren sin preguntar.
  await pedir([
    [{ name: 'fs_read', args: { paths: ['note.txt'] } }],
    [
      { name: 'fs_edit', args: { path: 'note.txt', edits: [{ old: 'two', new: '2' }] } },
      { name: 'shell_exec', args: { command: 'Write-Output blackcode-smoke' } },
      // corre en un proceso aparte (el worker de búsqueda): en la app
      // empaquetada es lo primero que se rompe si el archivo no viajó
      { name: 'code_search', args: { mode: 'content', pattern: 'one', path: '.' } },
    ],
  ]);
  await until(() => permiso(), 5000);
  permiso().querySelector('.rad-check input').click();
  primary().click();
  await closed();
  let otraTarjeta = false;
  await until(() => { otraTarjeta ||= Boolean(permiso()); return ultimo()?.dataset.estado === 'ok' && msgs().length === 10; }, 30000);
  if (otraTarjeta) fail('después de «no preguntar más en este chat» volvió a pedir permiso');
  if (cuenta() !== '4 tools · 4 done') fail(`con cuatro llamadas en dos rondas el contador dice «${cuenta()}»`);
  if (!fila('code_search')?.querySelector('.dm-tool-pre').textContent.includes('note.txt')) fail(`code_search no encontró el archivo: ${fila('code_search')?.querySelector('.dm-tool-pre').textContent.slice(0, 120)}`);
  // Lo que devolvió cada una se lee abriendo su fila. El fs_read vio el
  // archivo SIN la edición rechazada.
  const leida = fila('fs_read');
  leida.querySelector('.dm-tool-cabeza').click();
  await sleep(dur('base') + 160);
  if (!leida.hasAttribute('data-abierto') || leida.querySelector('.dm-tool-salida').getBoundingClientRect().height < 20) fail('la fila de una tool no se abre para mostrar lo que devolvió');
  const vio = leida.querySelector('.dm-tool-pre').textContent;
  if (!vio.includes('two') || vio.includes('DECLINED')) fail(`fs_read devolvió: ${vio.slice(0, 120)}`);
  if (!fila('shell_exec')?.querySelector('.dm-tool-pre').textContent.includes('blackcode-smoke')) fail('shell_exec no devolvió la salida del comando');
  // Nada de la tira se sale de la columna.
  const col = thread().querySelector('.dm-col').getBoundingClientRect();
  const afuera = tools().find((t) => t.getBoundingClientRect().right > col.right + 0.5);
  if (afuera) fail(`la fila de ${afuera.dataset.tool} se sale de la columna`);

  // Las de la segunda etapa, en dos rondas y sin tarjeta (el chat ya es de
  // confianza): correr código, la base propia del agente, abrir un archivo y
  // un job en segundo plano que se lee y se mata con el id que devolvió.
  await pedir([
    [
      { name: 'run_code', args: { language: 'node', code: "require('fs').writeFileSync('out.txt', 'hi'); console.log(6 * 7);" } },
      { name: 'db_query', args: { sql: 'CREATE TABLE IF NOT EXISTS humo (n INTEGER)' } },
      { name: 'db_query', args: { sql: 'INSERT INTO humo VALUES (?)', params: [4242] } },
      { name: 'db_query', args: { sql: 'SELECT n FROM humo' } },
      { name: 'os_open', args: { target: 'note.txt' } },
      { name: 'job_start', args: { command: "Write-Output job-listo; Start-Sleep 60", name: 'dormilon' } },
    ],
    [
      { name: 'job_output', args: { id: '$JOB', wait: 15, until: 'job-listo' } },
      { name: 'job_kill', args: { id: '$JOB' } },
      // la pantalla que captura el humo es de mentira: un degradé de 1920×1080
      { name: 'screen_capture', args: {} },
      { name: 'screen_capture', args: { region: { x: 0, y: 0, width: 400, height: 300 } } },
    ],
  ]);
  await until(() => ultimo()?.dataset.estado === 'ok' && msgs().length === 13, 60000);
  if (cuenta() !== '10 tools · 10 done') fail(`las tools de la segunda etapa: el contador dice «${cuenta()}»`);
  const salio = (name, n = -1) => fila(name, n)?.querySelector('.dm-tool-pre').textContent ?? '';
  if (!salio('run_code').includes('42') || !salio('run_code').includes('out.txt')) fail(`run_code devolvió: ${salio('run_code').slice(0, 160)}`);
  if (!salio('db_query').includes('4242')) fail(`db_query no devolvió la fila que guardó: ${salio('db_query').slice(0, 120)}`);
  if (fila('os_open')?.dataset.estado !== 'ok') fail(`os_open quedó en «${fila('os_open')?.dataset.estado}»: ${salio('os_open').slice(0, 120)}`);
  if (!salio('job_output').includes('job-listo')) fail(`job_output no leyó lo que imprimió el job: ${salio('job_output').slice(0, 160)}`);
  if (!/kill/i.test(salio('job_kill'))) fail(`job_kill devolvió: ${salio('job_kill').slice(0, 160)}`);

  // La captura queda a la vista en su fila, sin abrirla: es lo que vio el modelo.
  const fotoDe = (n) => fila('screen_capture', n)?.querySelector('.dm-tool-imagen');
  await until(() => fotoDe(-2)?.naturalWidth > 0 && fotoDe(-1)?.naturalWidth > 0, 4000);
  const [entera, zona] = [fotoDe(-2), fotoDe(-1)];
  if (entera?.naturalWidth !== 1568 || entera?.naturalHeight !== 882) fail(`la captura entera se ve de ${entera?.naturalWidth}×${entera?.naturalHeight}: se esperaba 1568×882`);
  if (zona?.naturalWidth !== 490 || zona?.naturalHeight !== 368) fail(`la región capturada se ve de ${zona?.naturalWidth}×${zona?.naturalHeight}: se esperaba 490×368 (recortada en píxeles reales)`);
  if (!(entera?.getBoundingClientRect().height > 40) || op(entera) < 0.99) fail('la captura no está a la vista en su fila');
  if (!salio('screen_capture').includes('captured a region of display 1 of 1')) fail(`screen_capture devolvió: ${salio('screen_capture').slice(0, 160)}`);
  data.capturas = `entera ${entera?.naturalWidth}×${entera?.naturalHeight}, región ${zona?.naturalWidth}×${zona?.naturalHeight}, a ${Math.round(entera?.getBoundingClientRect().width ?? 0)} px de ancho en la fila`;

  // Cada fila lleva el ícono de su tool (los de NeonCode), y las de una misma
  // familia lo comparten.
  {
    const ic = (name) => fila(name)?.querySelector('.dm-tool-icono')?.dataset.icono ?? '(genérico)';
    const esperados = { fs_write: 'edit', fs_read: 'folder', shell_exec: 'terminal', job_start: 'terminal', run_code: 'code', db_query: 'db', os_open: 'external', screen_capture: 'eye' };
    const mal = Object.entries(esperados).filter(([t, i]) => fila(t) && ic(t) !== i).map(([t, i]) => `${t}: ${ic(t)} (se esperaba ${i})`);
    if (mal.length) fail(`íconos de las tools: ${mal.join('; ')}`);
    const dibujo = fila('run_code')?.querySelector('.dm-tool-icono svg path');
    if (!dibujo || dibujo.getBoundingClientRect().width < 6) fail('el ícono de una tool no se dibuja');
    data.iconos = Object.keys(esperados).filter((t) => fila(t)).map((t) => `${t}=${ic(t)}`).join(' ');
  }

  // Argumentos incompletos, y una tool que este agente no tiene: ninguna
  // corre, las dos dejan su fila como fallida, y no hay tarjeta que contestar.
  await pedir([[{ name: 'fs_write', args: { path: 'x.txt' } }, { name: 'fetch', args: { url: 'https://example.com' } }]]);
  await terminado(16);
  if (fila('fs_write')?.dataset.estado !== 'error' || fila('fetch')?.dataset.estado !== 'error' || cuenta() !== '2 tools · 2 failed') fail(`argumentos incompletos y una tool apagada: ${fila('fs_write')?.dataset.estado}, ${fila('fetch')?.dataset.estado}, «${cuenta()}»`);
  if (!fila('fetch').querySelector('.dm-tool-pre').textContent.includes('not available in this run')) fail('una tool que el agente no tiene prendida no fue rechazada por eso');

  // Sin el renglón TOOLS el agente conversa, y el contador lo dice igual.
  type(area, 'Just say hi.');
  key(area, 'Enter');
  await terminado(18);
  if (cuenta() !== 'no tools') fail(`un turno con tools prendidas que no usó ninguna dice «${cuenta()}»`);
  enIngles('en un chat con tools');

  // Modo automático: Settings lo dice, y una escritura corre sin tarjeta.
  await go('ajustes');
  const tarjetaTools = view('ajustes').querySelector('[data-tarjeta="tools"]');
  const preguntar = tarjetaTools.querySelector('[data-campo="preguntar"]');
  if (!preguntar.checked) fail('de fábrica las tools no piden permiso');
  preguntar.click();
  await settle();
  if (tarjetaTools.dataset.modo !== 'auto' || !shown(tarjetaTools.querySelector('.dm-tarjeta-instr.rad-swap')).includes('without asking')) fail('Settings no dice que las tools corren sin preguntar');
  enIngles('en Settings con tools');
  await go('chat');
  chatView.querySelector('[data-accion="nuevo-chat"]').click();
  await settle();
  await pedir([[{ name: 'fs_write', args: { path: 'auto.txt', content: 'auto\n' } }]]);
  let tarjetaEnAuto = false;
  await until(() => { tarjetaEnAuto ||= Boolean(permiso()); return msgs().length === 3 && ultimo().dataset.estado === 'ok'; }, 15000);
  if (tarjetaEnAuto || cuenta() !== '1 tool · 1 done') fail(`en modo automático: tarjeta ${tarjetaEnAuto}, contador «${cuenta()}»`);
  await go('ajustes');
  preguntar.click();
  await settle();
  if (tarjetaTools.dataset.modo !== 'manual') fail('el modo manual no volvió');
  // Las tools también se prenden desde la conversación: el botón de la
  // cabecera dice cuántas lleva el agente y su menú las cambia por grupo.
  {
    await go('chat');
    const boton = chatView.querySelector('[data-accion="tools"]');
    const dice = () => shown(boton.querySelector('.dm-conv-tools-texto'));
    const antes = dice();
    const abrir = async () => { boton.click(); await until(() => menus().length > 0, 2000); await sleep(dur('base') + 60); };
    await abrir();
    const filasMenu = [...menus()[0].querySelectorAll('.rad-menu-item')].map((i) => i.textContent.trim());
    if (filasMenu.join() !== 'Files,Commands,Code,Databases,Web,Browser,Desktop,Screen,Canvas,Notes,Subagents,Memory,Skills,Turn all on,Turn all off') fail(`el menú de tools trae: ${filasMenu.join()}`);
    await pick('Turn all off');
    if (dice() !== 'Tools: off' || boton.hasAttribute('data-prendidas') || !statusRight().endsWith('· no tools')) fail(`apagar todas desde la conversación: el botón dice «${dice()}» y la barra «${statusRight()}»`);
    await abrir();
    await pick('Turn all on');
    if (dice() !== '32 tools' || !boton.hasAttribute('data-prendidas') || !statusRight().endsWith('· 32 tools')) fail(`prender todas desde la conversación: el botón dice «${dice()}» y la barra «${statusRight()}»`);
    await abrir();
    const marcadas = [...menus()[0].querySelectorAll('.rad-menu-item[aria-checked="true"]')].length;
    if (marcadas !== 13) fail(`con todas prendidas el menú marca ${marcadas} grupos de 13`);
    await pick('Web');
    if (dice() !== '29 tools') fail(`apagar un grupo desde la conversación dejó «${dice()}»`);
    // y las recibe el modelo: el pedido siguiente corre una de esas tools
    // (en modo manual, que es como quedó: pide permiso y se le da)
    await pedir([[{ name: 'fs_read', args: { paths: ['note.txt'] } }]]);
    await until(() => permiso(), 5000);
    primary()?.click();
    await until(() => !composer.querySelector('.rad-busy') && ultimo()?.dataset.estado === 'ok' && cuenta() === '1 tool · 1 done', 20000);
    if (cuenta() !== '1 tool · 1 done') fail(`después de prender las tools desde la conversación, el contador dice «${cuenta()}»`);
    data.toolsEnElChat = `${antes} → Tools: off → 32 tools → 29 tools`;
  }

  // 11c. El canvas: el agente deja un documento en el panel de al lado, lo
  // corrige por fragmentos, el usuario lo edita a mano, y nadie le pisa el
  // borrador a nadie. Con el motor y el store de verdad.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const escena = chatView.querySelector('.dm-escena');
    const panel = chatView.querySelector('.dm-canvas');
    const barra = chatView.querySelector('.dm-canvas-barra');
    const tarjetasC = () => alive(barra.querySelectorAll('.dm-canvas-tarjeta'));
    const tituloC = () => shown(panel.querySelector('.dm-canvas-titulo'));
    const subC = () => shown(panel.querySelector('.dm-canvas-sub'));
    const abiertoC = () => panel.hasAttribute('data-abierto');
    const boton = (a) => panel.querySelector('[data-accion="canvas-' + a + '"]');
    const area = () => panel.querySelector('.dm-canvas-area');
    const avisos = () => [...document.querySelectorAll('.rad-toast')].filter((n) => !n.hasAttribute('data-rad-leaving'));
    const quieto = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const corre = async (args) => { await pedir([[{ name: 'canvas', args }]]); await quieto(); };

    const anchoSin = Math.round(thread().getBoundingClientRect().width);
    if (abiertoC() || escena.hasAttribute('data-panel') || barra.hasAttribute('data-con-tarjetas')) fail('canvas: un chat sin canvas arranca con el panel o la barra a la vista');
    await corre({ action: 'create', title: 'Study plan', kind: 'document', content: '# Plan\n\n- one\n- two\n\nEnergy: $E = mc^2$' });
    if (!abiertoC() || tituloC() !== 'Study plan' || subC() !== 'document') fail('canvas: al crearlo el agente, el panel quedó ' + (abiertoC() ? 'abierto' : 'cerrado') + ' con «' + tituloC() + '» / «' + subC() + '»');
    const doc = () => panel.querySelector('.dm-canvas-doc');
    if (doc()?.querySelector('.dm-titulo')?.textContent !== 'Plan' || doc()?.querySelectorAll('li').length !== 2 || !doc()?.querySelector('.dm-formula')) fail('canvas: el documento no se pintó como markdown (título, lista y fórmula)');
    if (tarjetasC().length !== 1 || !tarjetasC()[0].hasAttribute('data-activa') || !barra.hasAttribute('data-con-tarjetas')) fail('canvas: la barra no muestra la tarjeta del canvas abierto: ' + tarjetasC().length + ' tarjetas, activa ' + tarjetasC()[0]?.hasAttribute('data-activa') + ', barra ' + barra.hasAttribute('data-con-tarjetas') + ', todas ' + barra.querySelectorAll('.dm-canvas-tarjeta').length);
    if (fila('canvas')?.querySelector('.dm-tool-icono')?.dataset.icono !== 'grid') fail('canvas: su fila no lleva el ícono del canvas');
    // el panel empuja a la conversación, no la tapa
    const pr = panel.getBoundingClientRect();
    const tr = thread().getBoundingClientRect();
    if (!(Math.round(thread().getBoundingClientRect().width) < anchoSin - 250) || pr.left < tr.right - 1 || pr.right > escena.getBoundingClientRect().right + 1) fail('canvas: el panel tapa la conversación (hilo ' + Math.round(tr.left) + '–' + Math.round(tr.right) + ', panel ' + Math.round(pr.left) + '–' + Math.round(pr.right) + ')');
    const anchoCon = Math.round(thread().getBoundingClientRect().width);
    const idC = tarjetasC()[0].dataset.radKey;

    // El agente lo corrige por fragmentos: sube la versión y cambia solo eso.
    await corre({ action: 'edit', id: idC, edits: [{ old: '- two', new: '- two and a half' }] });
    if (subC() !== 'document · v2' || doc()?.querySelectorAll('li')[1]?.textContent !== 'two and a half') fail('canvas: la edición del agente dejó «' + subC() + '» y «' + doc()?.querySelectorAll('li')[1]?.textContent + '»');

    // El usuario lo edita a mano y guarda.
    boton('editar').click();
    await settle();
    if (!panel.hasAttribute('data-editando') || !area()?.value.includes('two and a half')) fail('canvas: Edit no abrió el texto del canvas');
    type(area(), area().value + '\n- three');
    boton('guardar').click();
    await until(() => !panel.hasAttribute('data-editando'), 3000);
    await settle();
    if (subC() !== 'document · v3' || doc()?.querySelectorAll('li').length !== 3) fail('canvas: guardar la edición del usuario dejó «' + subC() + '» con ' + doc()?.querySelectorAll('li').length + ' items');

    // El usuario está editando y el agente reescribe ESE canvas: el borrador
    // no se pisa, y se avisa.
    boton('editar').click();
    await settle();
    type(area(), 'MY DRAFT');
    await corre({ action: 'update', id: idC, content: 'Replaced by the agent.' });
    if (!panel.hasAttribute('data-editando') || area()?.value !== 'MY DRAFT') fail('canvas: el agente le pisó el borrador al usuario (quedó «' + area()?.value + '»)');
    if (!avisos().some((n) => n.textContent.includes('while you were editing'))) fail('canvas: no se avisó que el agente cambió el canvas que se estaba editando');
    // Cancelar con cambios pregunta; descartar muestra lo del agente.
    boton('cancelar').click();
    await until(() => modal(), 2000);
    if (!modal()?.textContent.includes('Discard')) fail('canvas: salir de editar con cambios no pregunta');
    primary().click();
    await closed();
    await settle();
    if (panel.hasAttribute('data-editando') || !doc()?.textContent.includes('Replaced by the agent.')) fail('canvas: después de descartar no se ve la versión del agente');

    // Cerrar suelta el hueco; abrir desde la tarjeta lo vuelve a reservar de UN
    // paso: lo que se mueve es el panel, no el ancho de la conversación.
    boton('cerrar').click();
    await until(() => !escena.hasAttribute('data-panel'), 2000);
    if (abiertoC() || Math.round(thread().getBoundingClientRect().width) !== anchoSin) fail('canvas: cerrar no devolvió el ancho a la conversación (' + Math.round(thread().getBoundingClientRect().width) + ' de ' + anchoSin + ')');
    const anchos = new Set();
    const viajes = new Set();
    let opMin = 1;
    tarjetasC()[0].click();
    for (const t0 = performance.now(); performance.now() - t0 < dur('base') + 260;) {
      anchos.add(Math.round(thread().getBoundingClientRect().width));
      viajes.add(getComputedStyle(panel).transform);
      if (abiertoC()) opMin = Math.min(opMin, op(panel));
      await frame();
    }
    if (anchos.size > 2 || !anchos.has(anchoCon)) fail('canvas: al abrirse, la conversación pasó por ' + anchos.size + ' anchos (' + [...anchos].join(', ') + '): el hueco se anima en vez de reservarse de un paso');
    if (viajes.size < 3 || opMin > 0.9 || op(panel) < 0.99) fail('canvas: el panel no entra moviéndose (' + viajes.size + ' posiciones, opacidad mínima ' + r2(opMin) + ', final ' + r2(op(panel)) + ')');

    // Un canvas de código: con su lenguaje y sus números de línea.
    await corre({ action: 'create', title: 'sum.js', kind: 'code', language: 'js', content: 'const a = 1;\nconst b = 2;\nconsole.log(a + b);' });
    if (tituloC() !== 'sum.js' || subC() !== 'js' || panel.querySelector('.dm-canvas-numeros')?.textContent !== '1\n2\n3' || !panel.querySelector('.dm-canvas-codigo code')?.textContent.includes('console.log(a + b);')) fail('canvas: el de código no muestra su lenguaje, sus números o su texto');
    if (tarjetasC().length !== 2) fail('canvas: la barra tiene ' + tarjetasC().length + ' tarjetas, se esperaban 2');

    // Exportar (en el humo va a una carpeta de la corrida, sin diálogo).
    boton('exportar').click();
    await until(() => avisos().some((n) => n.textContent.startsWith('Saved to')), 3000);
    const guardado = avisos().find((n) => n.textContent.startsWith('Saved to'))?.textContent ?? '';
    if (!guardado.endsWith('sum.js')) fail('canvas: exportar dijo «' + guardado + '»');

    // El agente borra el primero: va a la papelera, y el aviso lo trae de vuelta.
    await corre({ action: 'delete', id: idC });
    if (tarjetasC().length !== 1) fail('canvas: después de que el agente borró uno, la barra tiene ' + tarjetasC().length);
    const aviso = avisos().find((n) => n.textContent.includes('The agent deleted'));
    if (!aviso?.querySelector('.rad-toast-action')) fail('canvas: el borrado del agente no ofrece restaurar');
    aviso?.querySelector('.rad-toast-action')?.click();
    await until(() => tarjetasC().length === 2, 3000);
    if (tarjetasC().length !== 2) fail('canvas: Restore no trajo el canvas de vuelta');

    // La biblioteca: todos, con buscador.
    chatView.querySelector('[data-accion="canvas-biblioteca"]').click();
    await until(() => modal(), 2000);
    await settle();
    const filasB = () => alive(modal().querySelectorAll('.dm-biblio-fila'));
    if (filasB().length !== 2) fail('canvas: la biblioteca muestra ' + filasB().length + ' canvas, se esperaban 2');
    type(modal().querySelector('input[type="search"]'), 'study');
    await settle();
    if (filasB().length !== 1 || !filasB()[0].textContent.includes('Study plan')) fail('canvas: buscar «study» en la biblioteca dejó ' + filasB().length + ' filas');
    enIngles('en la biblioteca del canvas');
    modal().querySelector('.rad-button').click();
    await closed();

    // Los esfumados del canvas. Debajo del título no hay línea (la cabecera va
    // sobre la misma hoja): lo que sube se esfuma, y solo cuando hay algo
    // recortado de ese lado. La tira de tarjetas hace lo mismo de costado.
    {
      const px = (el, nombre) => parseFloat(getComputedStyle(el).getPropertyValue(nombre)) || 0;
      const largo = Array.from({ length: 60 }, (_, i) => 'Paragraph number ' + i + ' of a long document, so that the canvas has to scroll.').join('\n\n');
      await pedir([[
        { name: 'canvas', args: { action: 'create', title: 'A long document to scroll', kind: 'document', content: largo } },
        { name: 'canvas', args: { action: 'create', title: 'Another one with a long title', kind: 'document', content: 'x' } },
        { name: 'canvas', args: { action: 'create', title: 'And a third one, also long', kind: 'document', content: 'x' } },
        { name: 'canvas', args: { action: 'create', title: 'The fourth canvas of this chat', kind: 'document', content: largo } },
      ]]);
      await quieto();
      const cuerpoC = panel.querySelector('.dm-canvas-cuerpo');
      if (cuerpoC.hasAttribute('data-rad-line') || !cuerpoC.classList.contains('rad-scroll')) fail('canvas: el cuerpo sigue marcando una línea arriba, o no es un scroll con esfumado');
      if (cuerpoC.scrollHeight < cuerpoC.clientHeight + 400) fail('canvas: el documento largo no hace scroll');
      if (!cuerpoC.classList.contains('at-top') || px(cuerpoC, '--rad-fade-top') !== 0) fail('canvas: en reposo, arriba, ya hay esfumado debajo del título (' + px(cuerpoC, '--rad-fade-top') + ' px)');
      if (!(px(cuerpoC, '--rad-fade-bottom') > 8)) fail('canvas: con texto recortado abajo no hay esfumado abajo');
      const pasosArriba = new Set();
      cuerpoC.scrollTop = 300;
      for (const t0 = performance.now(); performance.now() - t0 < dur('base') + 200;) { pasosArriba.add(Math.round(px(cuerpoC, '--rad-fade-top'))); await frame(); }
      const fadeArriba = px(cuerpoC, '--rad-fade-top');
      if (!(fadeArriba > 8) || cuerpoC.classList.contains('at-top')) fail('canvas: con el texto subido, debajo del título se corta al aire (esfumado de ' + fadeArriba + ' px)');
      if (pasosArriba.size < 3) fail('canvas: el esfumado de arriba aparece de golpe (' + [...pasosArriba].join(', ') + ')');
      if (!getComputedStyle(cuerpoC).maskImage.includes('linear-gradient')) fail('canvas: el cuerpo no tiene la máscara del esfumado');

      // la tira: seis tarjetas no entran al lado del panel
      const tira = barra.querySelector('.dm-canvas-tarjetas');
      await sleep(dur('slow') + 500); // (la tira se corrió sola hasta la tarjeta del que quedó abierto)
      if (tarjetasC().length !== 6 || !(tira.scrollWidth > tira.clientWidth + 40)) fail('canvas: la tira tiene ' + tarjetasC().length + ' tarjetas y ' + (tira.scrollWidth - tira.clientWidth) + ' px de más: no hay qué recortar');
      // el canvas que quedó abierto es el último: su tarjeta se trajo a la vista
      const activaR = tarjetasC().find((t) => t.hasAttribute('data-activa'))?.getBoundingClientRect();
      const tiraR = tira.getBoundingClientRect();
      if (!activaR || activaR.right > tiraR.right + 1 || activaR.left < tiraR.left - 1) fail('canvas: la tarjeta del canvas abierto quedó fuera de la vista de la tira');
      if (tira.classList.contains('at-start') || !(px(tira, '--rad-fade-start') > 8)) fail('canvas: la tira, corrida, se corta al aire contra el panel izquierdo (esfumado de ' + px(tira, '--rad-fade-start') + ' px)');
      if (!getComputedStyle(tira).maskImage.includes('to right')) fail('canvas: la tira no tiene la máscara de costado');
      // la rueda la mueve, y al llegar a cada punta ese lado deja de esfumarse
      const rueda = (dy) => { const e = new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }); tira.dispatchEvent(e); return e.defaultPrevented; };
      const antesX = tira.scrollLeft;
      const frenada = rueda(-90);
      await frame();
      if (!frenada || !(tira.scrollLeft < antesX)) fail('canvas: la rueda no mueve la tira de tarjetas (' + antesX + ' → ' + tira.scrollLeft + ', frenada ' + frenada + ')');
      for (let i = 0; i < 30 && tira.scrollLeft > 0; i++) { rueda(-400); await frame(); }
      await sleep(dur('base') + 120);
      if (!tira.classList.contains('at-start') || px(tira, '--rad-fade-start') !== 0 || !(px(tira, '--rad-fade-end') > 8)) fail('canvas: con la tira al principio, el esfumado quedó en ' + px(tira, '--rad-fade-start') + ' / ' + px(tira, '--rad-fade-end') + ' px');
      for (let i = 0; i < 30 && tira.scrollLeft < tira.scrollWidth - tira.clientWidth - 1; i++) { rueda(400); await frame(); }
      await sleep(dur('base') + 120);
      if (!tira.classList.contains('at-end') || px(tira, '--rad-fade-end') !== 0 || !(px(tira, '--rad-fade-start') > 8)) fail('canvas: con la tira al final, el esfumado quedó en ' + px(tira, '--rad-fade-start') + ' / ' + px(tira, '--rad-fade-end') + ' px');
      data.canvasEsfumados = 'debajo del título ' + Math.round(fadeArriba) + ' px en ' + pasosArriba.size + ' pasos; la tira, ' + Math.round(px(tira, '--rad-fade-start')) + ' px del lado que recorta, y la mueve la rueda';
    }

    // Cambiar de chat cierra el panel y vacía la barra: son de aquel chat.
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await until(() => !abiertoC() && !barra.hasAttribute('data-con-tarjetas'), 3000);
    if (abiertoC() || barra.hasAttribute('data-con-tarjetas')) fail('canvas: al cambiar de chat el panel o la barra siguieron a la vista');
    datosM.ponerModoTools('manual');
    data.canvas = 'creado, editado por el agente y a mano (v3), borrador protegido, ' + anchos.size + ' anchos y ' + viajes.size + ' posiciones al abrirse, código, exportado, papelera y biblioteca';

    // Quien tenía todas las tools recibe las nuevas; quien eligió algunas, no.
    const antes = ['a', 'b'];
    const lista = [{ id: '1', tools: ['a', 'b'] }, { id: '2', tools: ['a'] }, { id: '3', tools: [] }];
    const nueva = datosM.sumarToolsNuevas(lista, antes, ['a', 'b', 'c']);
    if (!nueva || nueva[0].tools.join() !== 'a,b,c' || nueva[1].tools.join() !== 'a' || nueva[2].tools.length) fail('tools nuevas: ' + JSON.stringify(nueva));
    if (datosM.sumarToolsNuevas(lista, ['a', 'b', 'c'], ['a', 'b', 'c']) !== null) fail('tools nuevas: sin tools nuevas igual cambió algo');
  }

  // 11d. El navegador: el agente abre una página (servida en esta máquina),
  // la lee, escribe en un campo, hace clic y sigue un link; el panel se abre
  // solo, muestra lo que pasa y comparte el hueco con el canvas.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const escena = chatView.querySelector('.dm-escena');
    const nav = chatView.querySelector('.dm-nav');
    const botonNav = chatView.querySelector('[data-accion="navegador"]');
    const hueco = nav.querySelector('.dm-nav-hueco');
    const estadoNav = () => window.rad.invoke('browser:state');
    const lee = (name, n = -1) => fila(name, n)?.querySelector('.dm-tool-pre').textContent ?? '';
    const quieto = async () => { await sleep(200); for (let i = 0; i < 600 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const corre = async (...llamadas) => { await pedir([llamadas]); await quieto(); };
    // (el canvas del chat anterior termina de soltar el hueco)
    await until(() => !escena.hasAttribute('data-panel'), 2000);
    if (nav.hasAttribute('data-abierto') || escena.hasAttribute('data-panel')) fail('navegador: arranca abierto');

    // El agente navega: el panel se abre solo, porque sus tools lo necesitan a la vista.
    await corre({ name: 'browser_navigate', args: { url: SMOKE_URL } }, { name: 'browser_read', args: {} });
    if (!nav.hasAttribute('data-abierto') || escena.getAttribute('data-panel') !== 'browser' || botonNav.getAttribute('aria-pressed') !== 'true') fail('navegador: la tool no abrió el panel');
    if (!lee('browser_navigate').startsWith('Opened ' + SMOKE_URL) || !lee('browser_navigate').includes('Smoke page')) fail('navegador: browser_navigate devolvió: ' + lee('browser_navigate').slice(0, 160));
    const leido = lee('browser_read');
    if (!leido.includes('Smoke page') || !leido.includes('nothing yet') || !leido.includes('--- page text ---')) fail('navegador: browser_read no trae el texto de la página: ' + leido.slice(0, 200));
    const ref = (nombre) => new RegExp('\\[(ref_\\d+)\\][^\\n]*"' + nombre + '"').exec(leido)?.[1];
    const [rCampo, rBoton, rLink] = [ref('Your name'), ref('Greet'), ref('Second page')];
    if (!rCampo || !rBoton || !rLink) fail('navegador: browser_read no numeró el campo, el botón y el link: ' + [rCampo, rBoton, rLink].join(', ') + ' en ' + leido.slice(0, 400));
    if (fila('browser_read')?.querySelector('.dm-tool-icono')?.dataset.icono !== 'globe') fail('navegador: sus filas no llevan el ícono del navegador');
    // la barra y la pestaña dicen dónde está
    await until(() => nav.querySelector('.dm-nav-url').value.includes('127.0.0.1'), 3000);
    const tabsN = () => alive(nav.querySelectorAll('.dm-nav-tab'));
    if (!nav.querySelector('.dm-nav-url').value.includes('127.0.0.1') || tabsN().length !== 1 || !tabsN()[0].textContent.includes('Smoke page')) fail('navegador: la barra dice «' + nav.querySelector('.dm-nav-url').value + '» y la pestaña «' + tabsN()[0]?.textContent + '»');
    // el hueco está adentro del panel, al lado de la conversación, y con tamaño
    const hr = hueco.getBoundingClientRect();
    if (hr.width < 250 || hr.height < 250 || hr.left < thread().getBoundingClientRect().right - 1) fail('navegador: el hueco de la página mide ' + Math.round(hr.width) + '×' + Math.round(hr.height) + ' o pisa la conversación');

    // Escribe, hace clic y vuelve a leer: la página cambió.
    await corre({ name: 'browser_type', args: { ref: rCampo, text: 'Fran' } }, { name: 'browser_click', args: { ref: rBoton } }, { name: 'browser_read', args: {} });
    if (!lee('browser_read').includes('clicked: Fran')) fail('navegador: después de escribir y hacer clic la página dice: ' + (/clicked[^\n]*|nothing yet/.exec(lee('browser_read'))?.[0] ?? '(nada)') + ' · type: ' + lee('browser_type').slice(0, 80) + ' · click: ' + lee('browser_click').slice(0, 80));
    // lo que se teclea no queda en la fila: pasan contraseñas por ahí
    if (shown(fila('browser_type')?.querySelector('.dm-tool-que')).includes('Fran')) fail('navegador: la fila de browser_type muestra lo que se tecleó');

    // Sigue un link: la tool dice que navegó, y la barra y la pestaña lo siguen.
    await corre({ name: 'browser_click', args: { ref: rLink } }, { name: 'browser_read', args: {} });
    if (!lee('browser_read').includes('You are on the second page.')) fail('navegador: el clic en el link no llevó a la segunda página: ' + lee('browser_click').slice(0, 160));
    await until(() => tabsN()[0]?.textContent.includes('Second page'), 3000);
    const st = await estadoNav();
    if (!String(st?.url).endsWith('/second') || !st.canGoBack || !tabsN()[0]?.textContent.includes('Second page')) fail('navegador: el estado quedó en ' + st?.url + ' (atrás: ' + st?.canGoBack + '), pestaña «' + tabsN()[0]?.textContent + '»');

    // El usuario lo usa a mano: es la misma pestaña. Atrás, y una pestaña nueva.
    nav.querySelector('[data-accion="nav-atras"]').click();
    for (let i = 0; i < 60 && !String((await estadoNav())?.url).endsWith('/'); i++) await sleep(50);
    if (String((await estadoNav())?.url) !== SMOKE_URL) fail('navegador: Atrás no volvió a la primera página: ' + (await estadoNav())?.url);
    nav.querySelector('[data-accion="nav-nueva"]').click();
    await until(() => tabsN().length === 2 && tabsN()[1].getAttribute('aria-selected') === 'true' && hueco.hasAttribute('data-vacio'), 4000);
    if (tabsN().length !== 2 || tabsN()[1].getAttribute('aria-selected') !== 'true') fail('navegador: la pestaña nueva no quedó abierta y activa (' + tabsN().length + ' pestañas)');
    if (!hueco.hasAttribute('data-vacio')) fail('navegador: una pestaña en blanco no muestra su texto de ayuda');
    tabsN()[1].querySelector('.dm-nav-tab-x').click();
    await until(() => tabsN().length === 1, 3000);
    if (tabsN().length !== 1) fail('navegador: cerrar la pestaña dejó ' + tabsN().length);

    // Eclipse: la página es una capa nativa que tapa todo. Cuando la app pone
    // algo encima (un modal) la capa se apaga y queda una foto en su lugar.
    await sleep(dur('base') + 200);
    chatView.querySelector('[data-accion="canvas-biblioteca"]').click();
    await until(() => modal(), 2000);
    await until(() => hueco.hasAttribute('data-foto'), 3000);
    const fotoN = hueco.querySelector('.dm-nav-foto');
    if (!hueco.hasAttribute('data-foto') || !fotoN.src.startsWith('data:image/jpeg') || !(fotoN.naturalWidth > 100)) fail('navegador: con un modal encima no quedó la foto de la página (' + (fotoN.src || '').slice(0, 30) + ', ' + fotoN.naturalWidth + ' px)');
    modal().querySelector('.rad-button').click();
    await closed();
    await until(() => !hueco.hasAttribute('data-foto'), 3000);
    if (hueco.hasAttribute('data-foto')) fail('navegador: al cerrarse el modal la foto siguió tapando la página');

    // Estirarlo: la manija del borde izquierdo lo agranda por ENCIMA de la
    // conversación (no la empuja), entre el ancho de la casa y un techo que
    // deja un pedazo de chat a la vista. El ancho dura la sesión.
    {
      const manija = nav.querySelector('.dm-nav-manija');
      const anchoN = () => nav.getBoundingClientRect().width;
      // cómo se pinta el panel (su fondo y si tiene algo detrás), y cuánto se le recorta a la conversación
      const pinta = () => { const cs = getComputedStyle(nav); const b = getComputedStyle(nav, '::before'); return [cs.backgroundColor, cs.backgroundImage, b.content, b.backgroundColor].join(' | '); };
      const corte = () => parseFloat(escena.style.getPropertyValue('--dm-conv-corte')) || 0;
      const conv = chatView.querySelector('.dm-conv');
      const debajo = (x, y) => { nav.style.pointerEvents = 'none'; const el = document.elementFromPoint(x, y); nav.style.pointerEvents = ''; return el; };
      const puntero = (tipo, x) => manija.dispatchEvent(new PointerEvent(tipo, { pointerId: 7, button: 0, buttons: tipo === 'pointerup' ? 0 : 1, clientX: x, clientY: 300, bubbles: true, cancelable: true }));
      const casa = anchoN();
      const hiloAntes = Math.round(thread().getBoundingClientRect().width);
      const eR = escena.getBoundingClientRect();
      if (!manija || manija.getAttribute('role') !== 'separator' || nav.hasAttribute('data-estirado') || corte() !== 0) fail('navegador: la manija no está, o el panel arranca estirado (recorte ' + corte() + ')');
      const pintaCasa = pinta();
      const x0 = manija.getBoundingClientRect().left + 4;
      puntero('pointerdown', x0);
      if (!document.documentElement.classList.contains('dm-estirando')) fail('navegador: agarrar la manija no marca el arrastre');
      const pasos = new Set();
      for (let i = 1; i <= 8; i++) { puntero('pointermove', x0 - i * 25); await frame(); pasos.add(Math.round(anchoN())); }
      await frame();
      if (Math.abs(anchoN() - (casa + 200)) > 2 || pasos.size < 5) fail('navegador: arrastrar 200 px a la izquierda dejó el panel en ' + Math.round(anchoN()) + ' (la casa mide ' + Math.round(casa) + '), en ' + pasos.size + ' pasos');
      if (Math.round(thread().getBoundingClientRect().width) !== hiloAntes) fail('navegador: estirarlo le cambió el ancho a la conversación (' + hiloAntes + ' → ' + Math.round(thread().getBoundingClientRect().width) + '): la empuja en vez de taparla');
      if (hueco.getBoundingClientRect().width < casa + 150) fail('navegador: el hueco de la página no creció con el panel (' + Math.round(hueco.getBoundingClientRect().width) + ' px)');
      // hasta el techo: queda chat a la vista
      puntero('pointermove', x0 - 5000);
      await frame(); await frame();
      const asoma = nav.getBoundingClientRect().left - eR.left;
      if (Math.abs(asoma - 120) > 2) fail('navegador: en el tope quedan ' + Math.round(asoma) + ' px de conversación a la vista, se esperaban 120');
      puntero('pointerup', x0 - 5000);
      await sleep(dur('base') + 120);
      if (document.documentElement.classList.contains('dm-estirando') || !nav.hasAttribute('data-estirado')) fail('navegador: soltar la manija no terminó el arrastre, o el panel no quedó marcado como estirado');
      // Estirado es el MISMO vidrio que en el ancho de la casa: no cambia de
      // color (Fran lo vio pasar de gris a casi negro: tenía un fondo que
      // tapaba). Lo que cambia es la conversación, que se recorta donde el
      // panel la pisa; si no, se vería a través.
      if (pinta() !== pintaCasa) fail('navegador: al estirarlo el panel cambió de fondo: ' + pinta() + ' (en el ancho de la casa: ' + pintaCasa + ')');
      {
        const r = nav.getBoundingClientRect();
        if (Math.abs(corte() - (eR.right - r.left)) > 1 || !getComputedStyle(conv).clipPath.includes(Math.round(corte()) + 'px')) fail('navegador: la conversación se recorta ' + corte() + ' px y el panel la pisa ' + Math.round(eR.right - r.left) + ' (clip-path: ' + getComputedStyle(conv).clipPath + ')');
        const abajo = debajo(r.left + 60, r.top + r.height / 2);
        if (conv.contains(abajo)) fail('navegador: debajo del panel estirado sigue pintada la conversación (' + (abajo.className || abajo.tagName) + '): se ve a través del vidrio');
        const alLado = document.elementFromPoint(r.left - 30, r.top + r.height / 2);
        if (!conv.contains(alLado)) fail('navegador: el recorte se comió también la conversación que queda a la vista (' + (alLado?.className || alLado?.tagName) + ')');
      }
      // lo que hay debajo es conversación, y lo que se toca es el panel
      const nr = nav.getBoundingClientRect();
      const tocado = document.elementFromPoint(nr.left + 40, nr.top + 20);
      if (!nav.contains(tocado)) fail('navegador: estirado, en su borde izquierdo se toca ' + (tocado?.className || tocado?.tagName) + ' y no el panel');
      if (!(thread().getBoundingClientRect().right > nr.left + 100)) fail('navegador: el panel estirado no quedó por encima de la conversación');
      // con las flechas, desde el teclado
      const tope = anchoN();
      manija.focus();
      key(manija, 'ArrowRight');
      await frame();
      if (Math.abs(anchoN() - (tope - 32)) > 2) fail('navegador: la flecha derecha sobre la manija no lo achicó un paso (' + Math.round(tope) + ' → ' + Math.round(anchoN()) + ')');
      // cerrar y volver a abrir lo conserva
      const guardado = anchoN();
      botonNav.click();
      await until(() => !escena.hasAttribute('data-panel'), 3000);
      if (corte() !== 0) fail('navegador: cerrado, la conversación sigue recortada (' + corte() + ' px)');
      botonNav.click();
      await until(() => nav.hasAttribute('data-abierto'), 3000);
      await sleep(dur('base') + 160);
      if (Math.abs(corte() - (eR.right - nav.getBoundingClientRect().left)) > 1) fail('navegador: al reabrirlo estirado, la conversación no se volvió a recortar (' + corte() + ' px)');
      if (Math.abs(anchoN() - guardado) > 2) fail('navegador: al reabrirlo perdió el ancho arrastrado (' + Math.round(guardado) + ' → ' + Math.round(anchoN()) + ')');
      // doble clic: vuelve al ancho de la casa, y vuelve andando
      const vuelta = new Set();
      manija.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      for (const t0 = performance.now(); performance.now() - t0 < dur('base') + 260;) { vuelta.add(Math.round(anchoN())); await frame(); }
      await sleep(dur('base') + 120);
      if (Math.abs(anchoN() - casa) > 1 || nav.hasAttribute('data-estirado') || nav.style.getPropertyValue('--dm-nav-w') || corte() !== 0 || pinta() !== pintaCasa) fail('navegador: el doble clic no lo devolvió al ancho de la casa (' + Math.round(anchoN()) + ' de ' + Math.round(casa) + ', recorte ' + corte() + ')');
      if (vuelta.size < 4) fail('navegador: volver al ancho de la casa fue de golpe (' + [...vuelta].join(', ') + ')');
      // y nunca se achica por debajo de la casa
      key(manija, 'ArrowRight');
      await frame();
      if (Math.abs(anchoN() - casa) > 1) fail('navegador: la manija lo achicó por debajo del ancho de la casa (' + Math.round(anchoN()) + ')');
      manija.blur();
      data.navegadorEstirado = 'de ' + Math.round(casa) + ' a ' + Math.round(tope) + ' px en ' + pasos.size + ' pasos, deja ' + Math.round(asoma) + ' px de chat a la vista, mismo vidrio, recorta sin empujar, y vuelve en ' + vuelta.size + ' pasos';
    }

    // La estrella: en una página que ya es un marcador se RELLENA, y nada más.
    // El botón no queda «apretado» (sin el fondo ni el reborde que la piel le
    // pone a un aria-pressed): se ve igual que su vecino.
    {
      const estrella = nav.querySelector('[data-accion="nav-estrella"]');
      const vecino = nav.querySelector('[data-accion="nav-favoritos"]');
      const dibujo = estrella.querySelector('svg');
      const alfa = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m ? m[1].split(/[ ,/]+/).filter(Boolean) : []; return p.length > 3 ? parseFloat(p[3]) : (c === 'transparent' ? 0 : 1); };
      if (estrella.getAttribute('aria-pressed') !== 'false' || alfa(getComputedStyle(dibujo).fill) !== 0) fail('navegador: la estrella arranca rellena en una página sin marcador (' + getComputedStyle(dibujo).fill + ')');
      estrella.click();
      await until(() => estrella.getAttribute('aria-pressed') === 'true', 3000);
      await sleep(dur('fast') + 160);
      const ce = getComputedStyle(estrella);
      if (estrella.getAttribute('aria-pressed') !== 'true' || getComputedStyle(dibujo).fill !== ce.color || alfa(ce.color) !== 1) fail('navegador: con la página guardada la estrella no se rellena (relleno ' + getComputedStyle(dibujo).fill + ', color ' + ce.color + ')');
      if (ce.boxShadow !== 'none' || ce.backgroundColor !== getComputedStyle(vecino).backgroundColor) fail('navegador: con la página guardada el botón de la estrella queda remarcado (fondo ' + ce.backgroundColor + ', sombra ' + ce.boxShadow + '): alcanza con la estrella rellena');
      if ((await window.rad.invoke('browser:fav-list')).length !== 1) fail('navegador: la estrella no guardó el marcador');
      estrella.click();
      await until(() => estrella.getAttribute('aria-pressed') === 'false', 3000);
      await sleep(dur('fast') + 160);
      if (alfa(getComputedStyle(dibujo).fill) !== 0 || (await window.rad.invoke('browser:fav-list')).length !== 0) fail('navegador: sacar el marcador no vació la estrella');
    }

    // Una tool que está corriendo: el ícono se pone blanco y se queda QUIETO
    // (lo que late es la lucecita de «Thinking»).
    {
      const f = fila('browser_navigate');
      const ic = f.querySelector('.dm-tool-icono');
      const era = f.dataset.estado;
      f.dataset.estado = 'run';
      await frame();
      const cs = getComputedStyle(ic);
      if (cs.animationName !== 'none' || ic.getAnimations().some((a) => a.effect?.getComputedTiming().iterations === Infinity)) fail('tools: el ícono de una tool que corre late (' + cs.animationName + '): tiene que quedarse quieto');
      f.dataset.estado = era;
      await frame();
    }
    // Los íconos que vinieron de NeonCode: la grilla del canvas y el chip de la memoria.
    if (chatView.querySelector('[data-accion="canvas-biblioteca"] svg')?.querySelectorAll('rect').length !== 4) fail('el botón de los canvas no lleva la grilla de cuatro cuadrados');
    if (!(document.querySelector('.rad-tab[data-view="memoria"] svg path')?.getAttribute('d') ?? '').includes('M6.75 6.75h2.5v2.5h-2.5z')) fail('el ícono de Memory no es el chip con el cuadrado adentro');

    // El historial: por dónde se anduvo, para volver. Una entrada por
    // dirección (volver a una página la sube), con las que abrió el agente.
    {
      const hist = () => window.rad.invoke('browser:hist-list');
      // (como until, pero la condición pregunta al proceso principal)
      const hasta = async (cond, ms = 3000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (await cond()) return true; await sleep(50); } return false; };
      const abiertos = () => alive(document.querySelectorAll('.rad-overlays .rad-modal')).filter((m) => m.dataset.state === 'open');
      const ventanaH = () => abiertos().find((m) => m.querySelector('.dm-hist'));
      const filasH = () => alive(ventanaH()?.querySelectorAll('.dm-biblio-fila') ?? []);
      const nombresH = () => filasH().map((f) => f.querySelector('.dm-biblio-nombre').textContent).join(' | ');
      const diasH = () => alive(ventanaH()?.querySelectorAll('.dm-hist-dia') ?? []).map((d) => d.textContent).join(' | ');
      const botonH = (texto) => [...(ventanaH()?.querySelectorAll('.rad-modal-actions .rad-button') ?? [])].find((b) => b.textContent === texto);
      const vacioH = () => shown(ventanaH()?.querySelector('.dm-biblio-vacio'));
      const abrirH = async (n) => { nav.querySelector('[data-accion="nav-historial"]').click(); await until(() => ventanaH() && filasH().length === n, 3000); await settle(); };
      // lo que quedó de lo de arriba: la primera página (dos veces: ida y vuelta) y la segunda
      await hasta(async () => (await hist())[0]?.title === 'Smoke page', 3000);
      const h0 = await hist();
      if (h0.map((e) => e.url).join(' ') !== SMOKE_URL + ' ' + SMOKE_URL + 'second' || h0[0].title !== 'Smoke page' || h0[1].title !== 'Second page' || h0[0].veces !== 2 || h0[1].veces !== 1) fail('historial: después de navegar quedó ' + JSON.stringify(h0.map((e) => [e.url, e.title, e.veces])));
      await abrirH(2);
      if (nombresH() !== 'Smoke page | Second page' || diasH() !== 'Today') fail('historial: la ventana muestra «' + nombresH() + '» bajo «' + diasH() + '»');
      const detalleH = filasH()[0]?.querySelector('.dm-biblio-detalle').textContent ?? '';
      if (!/^\d\d:\d\d · http:\/\/127\.0\.0\.1:\d+\/$/.test(detalleH)) fail('historial: el renglón de una página dice «' + detalleH + '»');
      enIngles('en el historial');
      await until(() => hueco.hasAttribute('data-foto'), 3000);
      if (!hueco.hasAttribute('data-foto')) fail('historial: su ventana cae sobre la página y no la eclipsó');
      // abrir una: va a la pestaña activa, y la ventana se cierra
      filasH()[1]?.querySelector('.dm-biblio-abrir').click();
      await closed();
      for (let i = 0; i < 80 && !String((await estadoNav())?.url).endsWith('/second'); i++) await sleep(50);
      if (!String((await estadoNav())?.url).endsWith('/second') || abiertos().length) fail('historial: elegir una página no la abrió en la pestaña (' + (await estadoNav())?.url + ') o dejó la ventana abierta');
      await hasta(async () => (await hist())[0]?.url.endsWith('/second'), 3000);
      // …y esa visita la subió
      await abrirH(2);
      if (nombresH() !== 'Second page | Smoke page') fail('historial: volver a una página no la subió: «' + nombresH() + '»');
      // buscar, por título o por dirección
      const buscarH = ventanaH()?.querySelector('input[type="search"]') ?? document.createElement('input');
      type(buscarH, 'SECOND');
      await settle();
      if (nombresH() !== 'Second page' || diasH() !== 'Today') fail('historial: buscar «second» dejó «' + nombresH() + '»');
      type(buscarH, 'zzz');
      await settle();
      if (filasH().length || diasH() || vacioH() !== 'Nothing matches.') fail('historial: una búsqueda sin resultados muestra «' + nombresH() + '» / «' + vacioH() + '»');
      type(buscarH, '');
      await settle();
      // sacar una
      filasH()[1]?.querySelector('[data-accion="hist-quitar"]').click();
      await until(() => filasH().length === 1, 3000);
      if (nombresH() !== 'Second page' || (await hist()).length !== 1) fail('historial: sacar una página dejó «' + nombresH() + '» (' + (await hist()).length + ' guardadas)');
      // vaciarlo pregunta primero; decir que no, no borra nada
      botonH('Clear history')?.click();
      await until(() => abiertos().length === 2, 3000);
      const pregunta = abiertos().length === 2 ? abiertos().at(-1) : null;
      if (!pregunta?.textContent.includes('Clear the history?') || !pregunta.textContent.includes('1 page will be forgotten')) fail('historial: vaciar no pregunta antes: ' + (pregunta?.textContent ?? '').slice(0, 120));
      [...(pregunta?.querySelectorAll('.rad-button') ?? [])].find((b) => b.textContent === 'Cancel')?.click();
      await until(() => abiertos().length === 1, 3000);
      await settle();
      if (filasH().length !== 1 || (await hist()).length !== 1) fail('historial: cancelar la pregunta borró igual');
      botonH('Clear history')?.click();
      await until(() => abiertos().length === 2, 3000);
      [...(abiertos().length === 2 ? abiertos().at(-1).querySelectorAll('.rad-button') : [])].find((b) => b.dataset.variant === 'danger')?.click();
      await until(() => abiertos().length === 1 && filasH().length === 0, 3000);
      await settle();
      if (filasH().length || (await hist()).length || !vacioH().startsWith('No history yet') || !botonH('Clear history')?.disabled) fail('historial: vaciarlo dejó ' + filasH().length + ' filas, «' + vacioH() + '»');
      botonH('Close')?.click();
      await closed();
      await until(() => !hueco.hasAttribute('data-foto'), 3000);
      // Queda una página anotada, para que la pasada 2 la encuentre al reabrir.
      await corre({ name: 'browser_navigate', args: { url: SMOKE_URL } });
      await hasta(async () => (await hist())[0]?.title === 'Smoke page', 3000);
      const hf = await hist();
      if (hf.length !== 1 || hf[0].url !== SMOKE_URL || hf[0].title !== 'Smoke page') fail('historial: después de vaciarlo y abrir una página quedó ' + JSON.stringify(hf.map((e) => [e.url, e.title])));
      data.historial = 'dos páginas con su título, volver sube, abrir desde la ventana, buscar, sacar una, vaciar con pregunta';
    }

    // El hueco es uno solo: abrir un canvas cierra el navegador, y al revés.
    await corre({ name: 'canvas', args: { action: 'create', title: 'Beside the browser', kind: 'document', content: 'x' } });
    if (nav.hasAttribute('data-abierto') || escena.getAttribute('data-panel') !== 'canvas' || !chatView.querySelector('.dm-canvas').hasAttribute('data-abierto')) fail('navegador: abrir un canvas no cerró el navegador');
    botonNav.click();
    await until(() => nav.hasAttribute('data-abierto') && !chatView.querySelector('.dm-canvas').hasAttribute('data-abierto'), 3000);
    await sleep(dur('base') + 120);
    if (escena.getAttribute('data-panel') !== 'browser' || chatView.querySelector('.dm-canvas').hasAttribute('data-abierto')) fail('navegador: abrir el navegador no cerró el canvas (panel: ' + escena.getAttribute('data-panel') + ')');
    enIngles('con el navegador abierto');
    botonNav.click();
    await until(() => !escena.hasAttribute('data-panel'), 3000);
    if (nav.hasAttribute('data-abierto') || escena.hasAttribute('data-panel')) fail('navegador: su botón no lo cerró');
    datosM.ponerModoTools('manual');
    data.navegador = 'el agente abrió ' + SMOKE_URL + ', leyó, escribió, hizo clic y siguió un link; atrás, pestañas, eclipse con foto de ' + fotoN.naturalWidth + ' px, y turno con el canvas';
  }

  // 11e. Las notas: el usuario escribe una y se guarda sola; el agente las lee,
  // crea otra en una carpeta, corrige la abierta y borra; nadie le pisa el
  // borrador a nadie. Con el store y las tools de verdad.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    await go('notas');
    const v = view('notas');
    const hoja = v.querySelector('.dm-notas-hoja');
    const notasL = () => alive(v.querySelectorAll('.dm-notas-nota'));
    const titulos = () => notasL().map((n) => n.querySelector('.dm-notas-nota-titulo').textContent);
    const carpetasL = () => alive(v.querySelectorAll('.dm-notas-carpeta')).map((n) => n.querySelector('.dm-notas-carpeta-nombre').textContent);
    const areaN = () => v.querySelector('.dm-notas-area');
    const docN = () => v.querySelector('.dm-notas-doc');
    const guardadoN = () => shown(v.querySelector('.dm-notas-guardado'));
    const boton = (a) => v.querySelector('[data-accion="' + a + '"]');
    const avisos = () => [...document.querySelectorAll('.rad-toast')].filter((n) => !n.hasAttribute('data-rad-leaving'));
    const lee = (name, n = -1) => fila(name, n)?.querySelector('.dm-tool-pre').textContent ?? '';
    const quieto = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const corre = async (...llamadas) => { await pedir([llamadas]); await quieto(); };
    if (notasL().length || hoja.hasAttribute('data-con-nota')) fail('notas: la libreta no arranca vacía');

    // El usuario escribe una nota: se guarda sola y aparece en la lista con su
    // primera línea de título.
    boton('nota-nueva').click();
    await settle();
    if (!areaN()) fail('notas: «New note» no abrió el editor');
    type(areaN(), '# Shopping\n\n- yerba\n- bread');
    if (guardadoN() === 'Saved') fail('notas: dice «Saved» apenas se escribe, antes de guardar');
    await until(() => guardadoN() === 'Saved' && notasL().length === 1, 5000);
    if (titulos().join() !== 'Shopping' || !notasL()[0].textContent.includes('yerba bread')) fail('notas: la nota guardada figura como «' + notasL()[0]?.textContent + '»');
    if (notasL()[0]?.getAttribute('aria-current') !== 'true') fail('notas: la nota abierta no queda marcada en la lista');
    boton('nota-editar').click();
    await until(() => !hoja.hasAttribute('data-editando'), 3000);
    await settle();
    if (docN()?.querySelector('.dm-titulo')?.textContent !== 'Shopping' || docN()?.querySelectorAll('li').length !== 2) fail('notas: al terminar de editar no se ve dibujada');

    // El agente la lee con su tool…
    await corre({ name: 'notepad', args: {} });
    const leido = lee('notepad');
    const idNota = /\(id: ([0-9a-f-]{36})/.exec(leido)?.[1];
    if (!leido.includes('Shopping') || !leido.includes('- yerba') || !idNota) fail('notas: la tool notepad devolvió: ' + leido.slice(0, 200));
    if (fila('notepad')?.querySelector('.dm-tool-icono')?.dataset.icono !== 'notepad') fail('notas: la fila de la tool no lleva su ícono');
    // …escribe otra, en una carpeta que no existía: aparece sola en la lista.
    await corre({ name: 'notepad_write', args: { action: 'create', content: '# Ideas\n\nfrom the agent', folder: 'Work' } });
    await until(() => titulos().includes('Ideas'), 4000);
    if (!titulos().includes('Ideas') || carpetasL().join() !== 'Work,Unfiled') fail('notas: lo que creó el agente no apareció en la lista (notas: ' + titulos().join() + '; carpetas: ' + carpetasL().join() + ')');
    // …y corrige la que está abierta: se vuelve a leer.
    await corre({ name: 'notepad_write', args: { action: 'edit', id: idNota, edits: [{ old: '- bread', new: '- bread and butter' }] } });
    await until(() => docN()?.textContent.includes('bread and butter'), 4000);
    if (!docN()?.textContent.includes('bread and butter')) fail('notas: la corrección del agente no llegó a la nota abierta: ' + lee('notepad_write').slice(0, 160));

    // El usuario está escribiendo y el agente reescribe esa nota: el borrador
    // no se pisa. (Se sigue tecleando mientras el agente trabaja: cada tecla
    // posterga el guardado, así que la nota sigue sin guardar cuando llega.)
    boton('nota-editar').click();
    await settle();
    const mio = areaN().value + '\n- mine';
    type(areaN(), mio);
    let tecleando = true;
    (async () => { while (tecleando) { if (areaN()) areaN().dispatchEvent(new Event('input', { bubbles: true })); await sleep(150); } })();
    await corre({ name: 'notepad_write', args: { action: 'update', id: idNota, content: '# Shopping\n\nrewritten by the agent' } });
    await until(() => avisos().some((n) => n.textContent.includes('changed elsewhere')), 3000);
    const quedo = areaN()?.value;
    tecleando = false;
    if (quedo !== mio) fail('notas: el agente le pisó el borrador al usuario (quedó «' + String(quedo).slice(0, 80) + '»)');
    if (!avisos().some((n) => n.textContent.includes('changed elsewhere'))) fail('notas: no se avisó que la nota cambió afuera mientras se editaba');
    // al dejar de escribir se guarda la versión del usuario
    await until(() => guardadoN() === 'Saved', 5000);
    boton('nota-editar').click();
    await until(() => !hoja.hasAttribute('data-editando'), 3000);
    await corre({ name: 'notepad', args: { query: 'shopping' } });
    if (!lee('notepad').includes('- mine') || lee('notepad').includes('rewritten by the agent')) fail('notas: después de guardar no quedó la versión del usuario: ' + lee('notepad').slice(0, 200));

    // El agente borra la suya: va a la papelera, y el aviso la trae de vuelta.
    const idIdeas = /--- Ideas \(id: ([0-9a-f-]{36})/.exec((await (async () => { await corre({ name: 'notepad', args: { query: 'ideas' } }); return lee('notepad'); })()))?.[1];
    await corre({ name: 'notepad_write', args: { action: 'delete', id: idIdeas } });
    await until(() => !titulos().includes('Ideas'), 4000);
    const aviso = avisos().find((n) => n.textContent.includes('The agent deleted'));
    if (titulos().includes('Ideas') || !aviso?.querySelector('.rad-toast-action')) fail('notas: el borrado del agente no sacó la nota de la lista o no ofrece restaurarla');
    aviso?.querySelector('.rad-toast-action')?.click();
    await until(() => titulos().includes('Ideas'), 4000);
    if (!titulos().includes('Ideas')) fail('notas: Restore no trajo la nota de vuelta');

    // Fijar, buscar, mover y plegar.
    boton('nota-fijar').click();
    await until(() => notasL().some((n) => n.hasAttribute('data-fijada')), 3000);
    if (!notasL().find((n) => n.textContent.includes('Shopping'))?.hasAttribute('data-fijada')) fail('notas: fijar no marcó la nota');
    {
      // El pin de una nota fijada se rellena y nada más: el botón no queda
      // «apretado» (igual que la estrella de los marcadores).
      const pin = boton('nota-fijar');
      const vecino = [...pin.parentElement.querySelectorAll('.rad-iconbutton')].find((b) => b !== pin && !b.hasAttribute('aria-pressed'));
      await until(() => pin.getAttribute('aria-pressed') === 'true', 2000);
      await sleep(dur('fast') + 160);
      const cp = getComputedStyle(pin);
      if (pin.getAttribute('aria-pressed') !== 'true' || getComputedStyle(pin.querySelector('svg')).fill !== cp.color) fail('notas: el pin de una nota fijada no se rellena (relleno ' + getComputedStyle(pin.querySelector('svg')).fill + ', color ' + cp.color + ')');
      if (!vecino || cp.boxShadow !== 'none' || cp.backgroundColor !== getComputedStyle(vecino).backgroundColor) fail('notas: con la nota fijada el botón del pin queda remarcado (fondo ' + cp.backgroundColor + ', sombra ' + cp.boxShadow + '): alcanza con el pin relleno');
    }
    const buscarN = v.querySelector('input[type="search"]');
    type(buscarN, 'agent');
    await settle();
    if (titulos().join() !== 'Ideas') fail('notas: buscar «agent» dejó: ' + titulos().join());
    type(buscarN, '');
    await settle();
    boton('nota-mover').click();
    await until(() => menus().length > 0, 2000);
    await pick('Work');
    await until(() => shown(v.querySelector('.dm-notas-donde')) === 'Work', 3000);
    if (shown(v.querySelector('.dm-notas-donde')) !== 'Work' || carpetasL().join() !== 'Work') fail('notas: mover la nota a una carpeta dejó «' + shown(v.querySelector('.dm-notas-donde')) + '» y las carpetas ' + carpetasL().join());
    // fijada arriba, después por título
    if (titulos().join() !== 'Shopping,Ideas') fail('notas: el orden en la carpeta es ' + titulos().join() + ' (la fijada va primero)');
    v.querySelector('.dm-notas-carpeta-cabeza').click();
    await settle();
    if (notasL().length !== 0) fail('notas: plegar la carpeta no escondió sus notas');
    v.querySelector('.dm-notas-carpeta-cabeza').click();
    await settle();
    enIngles('en las notas');

    // Borrar desde acá es para siempre, y pregunta.
    boton('nota-borrar').click();
    await until(() => modal(), 2000);
    if (!modal()?.textContent.includes('no trash here')) fail('notas: borrar no avisa que es para siempre');
    primary().click();
    await closed();
    await until(() => titulos().join() === 'Ideas', 3000);
    if (titulos().join() !== 'Ideas' || hoja.hasAttribute('data-con-nota')) fail('notas: después de borrar quedó: ' + titulos().join());
    await corre({ name: 'notepad', args: { query: 'shopping' } });
    if (!lee('notepad').startsWith('No notes matching')) fail('notas: la nota borrada por el usuario sigue en la libreta: ' + lee('notepad').slice(0, 120));
    datosM.ponerModoTools('manual');
    data.notas = 'escrita y guardada sola, leída y corregida por el agente, borrador protegido, papelera y restore, fijar, buscar, mover, plegar y borrar';
    await go('chat');
  }

  // 11f. Adjuntos: soltar y pegar archivos en el redactor, lo que se acepta y
  // lo que no, el tope, quitar, el visor, y que al mandar lleguen al proveedor.
  {
    const datosM = await import('/datos.js');
    await go('chat');
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await settle();
    const conv = chatView.querySelector('.dm-conv');
    const tira = chatView.querySelector('.dm-adjuntos-tira');
    const items = () => alive(tira.querySelectorAll('.dm-adjunto'));
    const fotos = () => items().filter((n) => n.dataset.clase === 'imagen');
    const avisos = () => [...document.querySelectorAll('.rad-toast')].filter((n) => !n.hasAttribute('data-rad-leaving'));
    const enviar = chatView.querySelector('.dm-enviar');
    const mas = chatView.querySelector('[data-accion="adjuntar"]');
    const quieto = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    // archivos de mentira: una captura grande, un markdown y un PDF
    const lienzoP = document.createElement('canvas');
    lienzoP.width = 2400;
    lienzoP.height = 1200;
    const ctx = lienzoP.getContext('2d');
    ctx.fillStyle = '#204080';
    ctx.fillRect(0, 0, 2400, 1200);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(200, 200, 800, 300);
    const foto = async (nombre) => new File([await new Promise((r) => lienzoP.toBlob(r, 'image/png'))], nombre, { type: 'image/png' });
    const apunte = new File(['# Notes\nline two\n'], 'notes.md', { type: 'text/markdown' });
    const pdf = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3])], 'paper.pdf', { type: 'application/pdf' });
    const carga = (archivos) => { const dt = new DataTransfer(); for (const f of archivos) dt.items.add(f); return dt; };
    const soltar = (archivos) => {
      const dt = carga(archivos);
      conv.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      const marcado = composer.hasAttribute('data-soltar');
      conv.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return marcado;
    };

    if (tira.hasAttribute('data-con-adjuntos') || !enviar.disabled) fail('adjuntos: un redactor vacío arranca con adjuntos o con el botón de mandar prendido');
    if (!mas || mas.getBoundingClientRect().right > area.getBoundingClientRect().left + 1) fail('adjuntos: el botón + no está a la izquierda del texto');
    // Soltar una imagen y un archivo de texto.
    const marcado = soltar([await foto('screenshot.png'), apunte]);
    await until(() => items().length === 2, 4000);
    if (!marcado || composer.hasAttribute('data-soltar')) fail('adjuntos: el redactor no se marca mientras se arrastra, o queda marcado después de soltar');
    if (items().length !== 2 || !tira.hasAttribute('data-con-adjuntos')) fail('adjuntos: después de soltar dos archivos hay ' + items().length + ' en la tira');
    const mini = fotos()[0]?.querySelector('img');
    await until(() => mini?.naturalWidth > 0, 3000);
    // la imagen se achica: 2400×1200 queda en 1568×784
    if (mini?.naturalWidth !== 1568 || mini?.naturalHeight !== 784) fail('adjuntos: la imagen quedó de ' + mini?.naturalWidth + '×' + mini?.naturalHeight + ', se esperaba 1568×784');
    const chip = items().find((n) => n.dataset.clase === 'texto');
    if (!chip?.textContent.includes('notes.md') || !chip.textContent.includes('17 B')) fail('adjuntos: el archivo de texto figura como «' + chip?.textContent + '»');
    if (enviar.disabled) fail('adjuntos: con adjuntos y sin texto no se puede mandar');
    // (la tira se despliega: se mide cuando terminó)
    await until(() => tira.getBoundingClientRect().height > 60, 2000);
    await settle();
    if (tira.getBoundingClientRect().height < 60 || tira.getBoundingClientRect().bottom > area.getBoundingClientRect().top + 2) fail('adjuntos: la tira no va arriba del texto (mide ' + Math.round(tira.getBoundingClientRect().height) + ' px, termina en ' + Math.round(tira.getBoundingClientRect().bottom) + ' y el texto empieza en ' + Math.round(area.getBoundingClientRect().top) + ')');
    // Lo que no se puede adjuntar se rechaza, y se dice.
    soltar([pdf]);
    await until(() => avisos().some((n) => n.textContent.includes('paper.pdf')), 3000);
    if (items().length !== 2 || !avisos().some((n) => n.textContent.includes('paper.pdf') && n.textContent.includes('can’t be attached'))) fail('adjuntos: un PDF no se rechazó con su aviso');
    // Pegar una imagen (una captura del portapapeles).
    area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: carga([await foto('pasted.png')]), bubbles: true, cancelable: true }));
    await until(() => fotos().length === 2, 4000);
    if (fotos().length !== 2) fail('adjuntos: pegar una imagen no la sumó');
    // El tope: cuatro imágenes por mensaje.
    soltar([await foto('c.png'), await foto('d.png'), await foto('e.png')]);
    await until(() => avisos().some((n) => n.textContent.includes('Up to 4 images')), 5000);
    if (fotos().length !== 4) fail('adjuntos: con el tope de 4 imágenes quedaron ' + fotos().length);
    // Quitar es por identidad: sale la que se toca, no la que quedó en su lugar.
    const segunda = fotos()[1];
    segunda.querySelector('.dm-adjunto-x').click();
    segunda.querySelector('.dm-adjunto-x').click();
    await until(() => fotos().length === 3, 3000);
    if (fotos().length !== 3 || fotos().includes(segunda)) fail('adjuntos: dos clics en la × de una imagen dejaron ' + fotos().length + ' (tenían que quedar 3)');
    for (const n of fotos().slice(1)) n.querySelector('.dm-adjunto-x').click();
    await until(() => fotos().length === 1, 3000);
    // El visor: un clic en la miniatura la muestra entera; Esc la cierra.
    fotos()[0].querySelector('.dm-adjunto-ver').click();
    await until(() => document.querySelector('.dm-visor[data-abierto]'), 2000);
    if (!document.querySelector('.dm-visor[data-abierto] .dm-visor-imagen')) fail('adjuntos: la miniatura no abre el visor');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.dm-visor'), 2000);
    if (document.querySelector('.dm-visor')) fail('adjuntos: Esc no cerró el visor');
    enIngles('con adjuntos en el redactor');

    // Mandar: el mensaje guarda sus adjuntos, la tira queda vacía, y al
    // proveedor le llegan la imagen y el archivo (antepuesto al texto).
    type(area, 'What is in this?');
    key(area, 'Enter');
    await quieto();
    const mio = msgs().filter((m) => m.dataset.rol === 'user').at(-1);
    if (items().length || tira.hasAttribute('data-con-adjuntos')) fail('adjuntos: después de mandar la tira no quedó vacía');
    if (mio?.querySelectorAll('.dm-adjunto-imagen img').length !== 1 || !mio.querySelector('.dm-adjunto-archivo')?.textContent.includes('notes.md')) fail('adjuntos: el mensaje enviado no muestra su imagen y su archivo');
    if (mio?.querySelector('.dm-msg-cuerpo').textContent !== 'What is in this?') fail('adjuntos: la burbuja del mensaje dice «' + mio?.querySelector('.dm-msg-cuerpo').textContent + '»');
    const caja = mio?.querySelector('.dm-adjunto-imagen');
    const dib = caja?.querySelector('img');
    await until(() => dib?.naturalWidth > 0, 2000);
    if (caja && Math.abs(caja.getBoundingClientRect().width - dib.getBoundingClientRect().width) > 1) fail('adjuntos: en el mensaje, la caja de la imagen mide ' + Math.round(caja.getBoundingClientRect().width) + ' px y la imagen ' + Math.round(dib.getBoundingClientRect().width));
    const img = mio?.querySelector('.dm-adjunto-imagen');
    if (!img || img.getBoundingClientRect().bottom > mio.querySelector('.dm-msg-cuerpo').getBoundingClientRect().top + 1) fail('adjuntos: en el mensaje, la imagen no va arriba del texto');
    const eco = ultimo().textContent;
    if (!eco.includes('images in the last message: 1')) fail('adjuntos: al proveedor no le llegó la imagen');
    if (!eco.includes('<file name="notes.md">') || !eco.includes('line two') || !eco.includes('What is in this?')) fail('adjuntos: al proveedor no le llegó el archivo antepuesto al texto: ' + eco.slice(0, 200));

    // Un mensaje que es solo una imagen, sin texto.
    soltar([await foto('alone.png')]);
    await until(() => fotos().length === 1, 4000);
    key(area, 'Enter');
    await quieto();
    const solo = msgs().filter((m) => m.dataset.rol === 'user').at(-1);
    if (solo?.querySelectorAll('.dm-adjunto-imagen').length !== 1 || solo.querySelector('.dm-msg-cuerpo').getBoundingClientRect().height > 1) fail('adjuntos: un mensaje que es solo una imagen no se mandó, o muestra una burbuja vacía');
    if (!ultimo().textContent.includes('images in the last message: 1')) fail('adjuntos: la imagen sola no le llegó al proveedor');

    // Un modelo que no ve: se avisa antes de mandar, y la imagen no viaja.
    const anterior = datosM.agenteActual();
    const ciego = datosM.listaAgentes().find((a) => !datosM.modeloVe(a.proveedor, a.modelo));
    if (!ciego) fail('adjuntos: el humo no tiene un agente con un modelo que no ve');
    else {
      datosM.elegirAgente(ciego.id);
      await settle();
      chatView.querySelector('[data-accion="nuevo-chat"]').click();
      await settle();
      soltar([await foto('blind.png')]);
      await until(() => fotos().length === 1, 4000);
      const nota = chatView.querySelector('.dm-redactor-nota');
      if (!composer.hasAttribute('data-con-nota') || !shown(nota).includes('can’t see images')) fail('adjuntos: con un modelo que no ve no se avisa antes de mandar («' + shown(nota) + '»)');
      type(area, 'hello');
      key(area, 'Enter');
      await quieto();
      const eco2 = ultimo().textContent;
      if (eco2.includes('images in the last message') || !eco2.includes('this model cannot see images')) fail('adjuntos: a un modelo que no ve le viajó la imagen, o no se le dijo que estaba: ' + eco2.slice(0, 200));
      if (composer.hasAttribute('data-con-nota')) fail('adjuntos: el aviso de que el modelo no ve quedó puesto después de mandar');
      datosM.elegirAgente(anterior.id);
      await settle();
    }
    data.adjuntos = 'soltar y pegar, imagen achicada a ' + mini?.naturalWidth + '×' + mini?.naturalHeight + ', PDF rechazado, tope de 4, quitar, visor, mandar con archivo, imagen sola y modelo que no ve';
  }

  // 11g. La búsqueda en la web: Settings elige con qué busca web_search y guarda
  // la llave de cada buscador. Sin tocar la red: un buscador con llave pero sin
  // su llave falla antes de salir, y eso alcanza para ver que lo elegido llega
  // a la tool.
  {
    const datosM = await import('/datos.js');
    await go('ajustes');
    const tb = view('ajustes').querySelector('[data-tarjeta="busqueda"]');
    const selB = tb.querySelector('[data-campo="buscador"]');
    const dice = () => shown(tb.querySelector(':scope > .dm-estado .dm-estado-texto'));
    const tono = () => tb.querySelector(':scope > .dm-estado').dataset.tono;
    const elegir = async (nombre) => { selB.click(); await until(() => menus().length > 0, 2000); await pick(nombre); await settle(); };
    tb.scrollIntoView({ block: 'center' });
    if (datosM.buscador() !== 'duckduckgo' || !selB.textContent.includes('DuckDuckGo') || tono() !== 'success' || !dice().includes('DuckDuckGo')) fail('búsqueda: de fábrica no es DuckDuckGo sin llave («' + selB.textContent + '» / «' + dice() + '»)');
    const sub = [...tb.querySelectorAll('.dm-subtarjeta')].map((n) => n.dataset.proveedor).join();
    if (sub !== 'tavily,brave') fail('búsqueda: la tarjeta ofrece las llaves de: ' + sub);
    // Elegir Brave sin haberle cargado la llave: se avisa…
    await elegir('Brave');
    if (datosM.buscador() !== 'brave' || tono() !== 'warning' || !dice().includes('no Brave key')) fail('búsqueda: elegir Brave sin llave dejó «' + dice() + '» (' + tono() + ')');
    // …y la tool lo sabe: falla diciendo qué falta, sin salir a la red.
    const actual = datosM.agenteActual();
    datosM.ponerTools(actual.id, datosM.todasLasTools());
    datosM.ponerModoTools('auto');
    await go('chat');
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await settle();
    await pedir([[{ name: 'web_search', args: { query: 'anything' } }]]);
    await sleep(200);
    for (let i = 0; i < 300 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50);
    await settle();
    const salioB = fila('web_search')?.querySelector('.dm-tool-pre').textContent ?? '';
    if (salioB !== 'error: web search needs a Brave API key (Settings)') fail('búsqueda: con Brave elegido y sin llave, web_search devolvió: ' + salioB.slice(0, 160));
    datosM.ponerModoTools('manual');
    // Cargarle la llave a Tavily y elegirlo: queda cifrada, y el aviso se va.
    await go('ajustes');
    const tav = tb.querySelector('.dm-subtarjeta[data-proveedor="tavily"]');
    type(tav.querySelector('[data-campo="llave"]'), 'tvly-humo-de-blackcode-no-es-una-llave-2222');
    tav.querySelector('[data-accion="guardar-llave"]').click();
    await until(() => tav.querySelector('.dm-estado').dataset.llave === 'lista', 4000);
    if (tav.querySelector('.dm-estado').dataset.llave !== 'lista' || !shown(tav.querySelector('.dm-estado-texto')).includes('2222')) fail('búsqueda: la llave de Tavily no quedó guardada («' + shown(tav.querySelector('.dm-estado-texto')) + '»)');
    if (tav.textContent.includes('tvly-humo')) fail('búsqueda: la llave de Tavily quedó a la vista');
    await elegir('Tavily');
    if (datosM.buscador() !== 'tavily' || tono() !== 'success' || dice() !== 'Agents search with Tavily.') fail('búsqueda: con la llave cargada, elegir Tavily dejó «' + dice() + '» (' + tono() + ')');
    enIngles('en la tarjeta de la búsqueda');
    data.busqueda = 'DuckDuckGo de fábrica; Brave sin llave avisa y la tool falla sin salir a la red; Tavily con su llave cifrada';
    await go('chat');
  }

  // 11h. Subagentes: la tool delegate. El proveedor de mentira hace de padre y
  // de hijo: el padre pide `delegate` y cada hijo sigue el guion que trae su
  // brief (o conversa). Corre todo lo de verdad: la sesión del hijo, sus tools,
  // sus filas colgadas de la de delegate, y la tarjeta que dice quién pide.
  {
    const datosM = await import('/datos.js');
    const llaveM = await import('/llave.js');
    const actual = datosM.agenteActual();
    datosM.ponerTools(actual.id, datosM.todasLasTools());
    datosM.ponerModoTools('auto');
    await go('chat');
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await settle();
    const listo = async () => {
      await sleep(200);
      for (let i = 0; i < 600 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50);
      await settle();
    };
    const guionHijo = (llamadas) => 'TOOLS: ' + JSON.stringify(llamadas);
    // las filas de subagente que quedaron debajo de la última de delegate
    const hijas = () => { const todas = tools(); return todas.slice(todas.lastIndexOf(fila('delegate')) + 1).filter((t) => t.dataset.sub); };
    const informe = () => fila('delegate')?.querySelector('.dm-tool-pre').textContent ?? '';

    // Dos a la vez, con acceso completo: uno escribe y lee, el otro conversa.
    await pedir([[{ name: 'delegate', args: { tasks: [guionHijo([{ name: 'fs_write', args: { path: 'sub-note.txt', content: 'from a subagent\n' } }, { name: 'fs_read', args: { paths: ['sub-note.txt'] } }]), 'Say what you are.'], access: 'full' } }]]);
    await listo();
    const del = fila('delegate');
    if (!del || del.dataset.estado !== 'ok') fail('subagentes: la fila de delegate quedó en «' + del?.dataset.estado + '»');
    if (!/ · 2 tasks · full access$/.test(shown(del?.querySelector('.dm-tool-que')) ?? '')) fail('subagentes: la fila de delegate dice «' + shown(del?.querySelector('.dm-tool-que')) + '»');
    if (del?.querySelector('.dm-tool-icono')?.dataset.icono !== 'delegate') fail('subagentes: la fila de delegate no lleva su ícono');
    const deDos = hijas().map((t) => t.dataset.tool + ':' + t.dataset.subn + ':' + t.dataset.estado).join();
    if (deDos !== 'fs_write:1:ok,fs_read:1:ok') fail('subagentes: las filas del hijo son: ' + deDos);
    const h1 = hijas()[0];
    if (h1) {
      const corrida = h1.getBoundingClientRect().left - del.getBoundingClientRect().left;
      const riel = getComputedStyle(h1, '::before');
      const numero = getComputedStyle(h1, '::after');
      if (corrida < 16 || riel.width !== '2px' || numero.content !== '"1"') fail('subagentes: una fila del hijo no cuelga de la de delegate (corrida ' + corrida + ' px, riel ' + riel.width + ', número ' + numero.content + ')');
      if (!hijas()[1].querySelector('.dm-tool-pre').textContent.includes('from a subagent')) fail('subagentes: el hijo no leyó lo que escribió');
      data.subagenteCorrido = Math.round(corrida) + ' px';
    }
    if (!/## Subagent 1 of 2 \([^,]+, fs_write, fs_read, \d+ s/.test(informe()) || !informe().includes('## Subagent 2 of 2') || !informe().includes('messages in the request: 1')) fail('subagentes: el informe que vuelve al agente dice: ' + informe().slice(0, 240));
    if (cuenta() !== '1 tool · 1 done') fail('subagentes: el contador del turno dice «' + cuenta() + '» (las tools del hijo no son del agente)');
    // la fila de delegate se abre para leer el informe
    del.querySelector('.dm-tool-cabeza').click();
    await sleep(dur('base') + 120);
    if (!del.hasAttribute('data-abierto')) fail('subagentes: la fila de delegate no se abre para leer el informe');
    del.querySelector('.dm-tool-cabeza').click();
    // lo que corrió un subagente no vuelve al modelo como si lo hubiera corrido el agente
    const viaja = datosM.historialDe([
      { id: 'u', rol: 'user', texto: 'a' },
      { id: 'r:1', rol: 'tool', tool: 'delegate', texto: 'm · x', estado: 'ok' },
      { id: 'r:1.1:1', rol: 'tool', tool: 'fs_read', texto: 'f', estado: 'ok', sub: 'r:1', subN: 1 },
      { id: 'a', rol: 'assistant', texto: 'b', estado: 'ok' },
    ]).map((m) => m.tool ?? m.rol).join();
    if (viaja !== 'user,delegate,assistant') fail('subagentes: al modelo le viajaría ' + viaja);

    // Uno solo, y de lectura (lo de fábrica): no puede escribir, y su fila no lleva número.
    await pedir([[{ name: 'delegate', args: { task: guionHijo([{ name: 'fs_write', args: { path: 'sub-no.txt', content: 'x' } }]) } }]]);
    await listo();
    const sola = hijas()[0];
    if (hijas().length !== 1 || sola.dataset.estado !== 'error' || sola.dataset.subn !== undefined || !sola.querySelector('.dm-tool-pre').textContent.includes("tool 'fs_write' is not available in this run")) fail('subagentes: un hijo de lectura con fs_write dejó: ' + hijas().map((t) => t.dataset.tool + ':' + t.dataset.estado + ':' + t.dataset.subn).join());
    if (fila('delegate').dataset.estado !== 'ok' || !informe().includes('fs_write (1 did not succeed)')) fail('subagentes: el informe no cuenta la tool que no corrió: ' + informe().slice(0, 160));

    // En manual: primero la tarjeta de delegate, que es del agente, y después la
    // de la tool del hijo, que dice que la pide un subagente.
    datosM.ponerModoTools('manual');
    await pedir([[{ name: 'delegate', args: { task: guionHijo([{ name: 'fs_write', args: { path: 'sub-asked.txt', content: 'asked\n' } }]), access: 'full' } }]]);
    await until(() => permiso()?.textContent.includes('Allow delegate?'), 6000);
    if (!permiso()?.querySelector('.dm-permiso-que')?.textContent.startsWith('The agent wants to run delegate')) fail('subagentes: la tarjeta de delegate dice: ' + permiso()?.textContent.slice(0, 120));
    primary().click();
    await closed();
    await until(() => permiso()?.textContent.includes('Allow fs_write?'), 6000);
    const deHijo = permiso()?.querySelector('.dm-permiso-que');
    if (!deHijo?.textContent.startsWith('A subagent wants to run fs_write') || deHijo.dataset.sub !== 'true') fail('subagentes: la tarjeta de una tool del hijo dice: ' + permiso()?.textContent.slice(0, 160));
    enIngles('con la tarjeta de un subagente');
    primary().click();
    await closed();
    await listo();
    if (hijas().map((t) => t.dataset.tool + ':' + t.dataset.estado).join() !== 'fs_write:ok') fail('subagentes: con las dos tarjetas aceptadas el hijo dejó: ' + hijas().map((t) => t.dataset.tool + ':' + t.dataset.estado).join());
    datosM.ponerModoTools('auto');

    // Settings: con qué modelo corren. De fábrica, el del agente.
    await go('ajustes');
    const ts = view('ajustes').querySelector('[data-tarjeta="subagentes"]');
    ts.scrollIntoView({ block: 'center' });
    const selP = ts.querySelector('[data-campo="sub-proveedor"]');
    const diceS = () => shown(ts.querySelector(':scope > .dm-estado .dm-estado-texto'));
    const tonoS = () => ts.querySelector(':scope > .dm-estado').dataset.tono;
    const activoS = () => ts.querySelector('.dm-modelos > [data-activo]');
    const elegirS = async (boton, nombre) => { boton.click(); await until(() => menus().length > 0, 2000); await pick(nombre); await settle(); };
    if (datosM.subagentes().proveedor !== null || !selP.textContent.includes('Same as the agent') || activoS()?.dataset.proveedor !== 'mismo' || !activoS().disabled || tonoS() !== 'success' || !diceS().includes('same model as the agent')) fail('subagentes: de fábrica la tarjeta dice «' + selP.textContent + '» / «' + diceS() + '» y el modelo activo es ' + activoS()?.dataset.proveedor);
    await elegirS(selP, 'Venice');
    const conLlave = llaveM.de('venice').estado === 'lista';
    if (datosM.subagentes().proveedor !== 'venice' || datosM.subagentes().modelo !== 'grok-4-7' || activoS()?.dataset.proveedor !== 'venice' || !activoS().textContent.includes('Grok 4.7')) fail('subagentes: elegir Venice dejó ' + JSON.stringify(datosM.subagentes()) + ' y a la vista «' + activoS()?.textContent + '»');
    await elegirS(activoS(), 'Kimi K3');
    if (datosM.subagentes().modelo !== 'kimi-k3') fail('subagentes: elegir el modelo dejó ' + JSON.stringify(datosM.subagentes()));
    if (conLlave ? (tonoS() !== 'success' || diceS() !== 'Subagents run on Kimi K3.') : (tonoS() !== 'warning' || !diceS().includes('no Venice key'))) fail('subagentes: con Venice y Kimi K3 la tarjeta dice «' + diceS() + '» (' + tonoS() + ', llave ' + llaveM.de('venice').estado + ')');
    // un modelo que no usa tools no sirve para un subagente: se avisa
    await elegirS(activoS(), 'Venice Uncensored 1.2');
    if (conLlave && (tonoS() !== 'warning' || !diceS().includes('cannot use tools'))) fail('subagentes: un modelo sin tools no avisa: «' + diceS() + '»');
    await elegirS(activoS(), 'Kimi K3');
    enIngles('en la tarjeta de subagentes');
    // …y el hijo corre con eso
    await go('chat');
    await pedir([[{ name: 'delegate', args: { task: 'Say what you are.' } }]]);
    await listo();
    if (!(shown(fila('delegate').querySelector('.dm-tool-que')) ?? '').startsWith('kimi-k3 · ') || !informe().startsWith('Subagent report (kimi-k3, no tools,') || !informe().includes('provider: venice')) fail('subagentes: con Kimi K3 elegido, delegate dice «' + shown(fila('delegate').querySelector('.dm-tool-que')) + '» / ' + informe().slice(0, 120));
    datosM.ponerModoTools('manual');
    data.subagentes = 'dos a la vez con sus filas colgadas, lectura que no escribe, tarjeta que dice quién pide, y Kimi K3 elegido en Settings';
    await go('chat');
  }

  // 11i. La terminal: un panel con una shell de verdad (en el humo, cmd.exe y
  // no la del usuario). Lo que se teclea corre, el cursor es un bloque del
  // blanco de la app, comparte el hueco con los otros paneles, cerrarla no
  // mata la shell, y la CSP de la app sigue entera (un error de consola, que
  // es como se ve un estilo en línea bloqueado, hace fallar el humo).
  {
    const escena = chatView.querySelector('.dm-escena');
    const term = chatView.querySelector('.dm-term');
    const botonT = chatView.querySelector('[data-accion="terminal"]');
    const nav = chatView.querySelector('.dm-nav');
    const cuerpoT = term.querySelector('.dm-term-cuerpo');
    const cualT = () => shown(term.querySelector('.dm-canvas-sub'));
    const renglones = () => [...cuerpoT.querySelectorAll('.xterm-rows > div')].map((d) => d.textContent.replace(/ /g, ' ').trimEnd()).filter(Boolean);
    const pantalla = () => renglones().join('\n');
    const teclear = (texto) => window.rad.invoke('term:input', texto);
    await until(() => !escena.hasAttribute('data-panel'), 3000);
    if (!botonT || term.hasAttribute('data-abierto') || cuerpoT.querySelector('.xterm')) fail('terminal: arranca abierta, o xterm se cargó sin que nadie la abra');

    botonT.click();
    await until(() => cuerpoT.querySelector('.xterm-rows') && cualT() === 'cmd', 8000);
    await sleep(dur('base') + 200);
    if (!term.hasAttribute('data-abierto') || escena.getAttribute('data-panel') !== 'terminal' || botonT.getAttribute('aria-pressed') !== 'true') fail('terminal: su botón no la abrió');
    if (cualT() !== 'cmd') fail('terminal: en el humo la shell tiene que ser cmd, y dice «' + cualT() + '»');
    await until(() => />$/.test(renglones().at(-1) ?? ''), 6000);
    // (una ruta larga se parte en dos renglones)
    if (!/workspace>$/.test(renglones().slice(-2).join(''))) fail('terminal: la shell no abrió en la carpeta del chat que se ve: «' + renglones().slice(-2).join('') + '»');
    // lo que se teclea corre
    await teclear('echo %OS%-marca\r');
    await until(() => pantalla().includes('Windows_NT-marca'), 6000);
    if (!pantalla().includes('Windows_NT-marca')) fail('terminal: lo tecleado no corrió: ' + pantalla().slice(-200));
    // xterm se ajusta a su caja
    const sr = cuerpoT.querySelector('.xterm-screen').getBoundingClientRect();
    if (sr.width > cuerpoT.clientWidth + 1 || sr.width < cuerpoT.clientWidth * 0.8 || sr.height > cuerpoT.clientHeight + 1 || sr.height < cuerpoT.clientHeight * 0.8) fail('terminal: xterm mide ' + Math.round(sr.width) + '×' + Math.round(sr.height) + ' en una caja de ' + cuerpoT.clientWidth + '×' + cuerpoT.clientHeight);
    // el texto no llega a la barra de scroll (Fran lo vio pegado: xterm se medía contra una caja con padding)
    const filasR = cuerpoT.querySelector('.xterm-rows').getBoundingClientRect();
    const barraR = cuerpoT.querySelector('.xterm-scrollable-element > .scrollbar.vertical')?.getBoundingClientRect();
    const aire = barraR ? Math.round(barraR.left - filasR.right) : null;
    if (aire === null || aire < 6 || barraR.right > cuerpoT.getBoundingClientRect().right + 1) fail('terminal: entre la última columna y la barra de scroll hay ' + aire + ' px (columnas hasta ' + Math.round(filasR.right) + ', barra desde ' + Math.round(barraR?.left) + ')');
    data.terminalAire = aire + ' px entre el texto y la barra';
    if (!getComputedStyle(cuerpoT.querySelector('.xterm-rows')).fontFamily.includes('Roboto Mono')) fail('terminal: no usa la fuente de código de la app: ' + getComputedStyle(cuerpoT.querySelector('.xterm-rows')).fontFamily);
    // Los estilos que xterm arma a mano llegaron por hojas construidas (la CSP
    // no deja pasar un <style> en línea): tres <dm-estilo>, ni un <style>.
    const hojas = [...cuerpoT.querySelectorAll('dm-estilo')];
    if (hojas.length !== 3 || cuerpoT.querySelector('style') || document.adoptedStyleSheets.length < 3 || !hojas.every((n) => getComputedStyle(n).display === 'none')) fail('terminal: xterm dejó ' + hojas.length + ' <dm-estilo> y ' + cuerpoT.querySelectorAll('style').length + ' <style>, con ' + document.adoptedStyleSheets.length + ' hojas construidas');
    // El cursor: un bloque, del blanco de la app, con la letra en el color del
    // fondo. (La ventana del humo no tiene el foco, así que xterm lo muestra en
    // contorno: se le pone la clase del bloque para leer la regla de verdad.)
    cuerpoT.querySelector('.xterm-helper-textarea').dispatchEvent(new FocusEvent('focus'));
    await teclear('\r');
    await until(() => cuerpoT.querySelector('.xterm-cursor'), 4000);
    const cursor = cuerpoT.querySelector('.xterm-cursor');
    const colorDe = (token) => { const s = document.createElement('i'); s.style.color = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; };
    if (!cursor) fail('terminal: no hay cursor');
    else {
      const teniaBloque = cursor.classList.contains('xterm-cursor-block');
      cursor.classList.remove('xterm-cursor-outline', 'xterm-cursor-blink');
      cursor.classList.add('xterm-cursor-block');
      const cs = getComputedStyle(cursor);
      const cr = cursor.getBoundingClientRect();
      if (cs.backgroundColor !== colorDe('--rad-text-1') || cs.color !== colorDe('--rad-surface-0')) fail('terminal: el cursor de bloque es ' + cs.backgroundColor + ' con letra ' + cs.color + ', no el blanco de la app (' + colorDe('--rad-text-1') + ') con el fondo');
      if (cr.width < 5 || cr.height < 12) fail('terminal: el cursor mide ' + Math.round(cr.width) + '×' + Math.round(cr.height) + ': no es un bloque');
      data.terminalCursor = 'bloque de ' + Math.round(cr.width) + '×' + Math.round(cr.height) + ' px, ' + cs.backgroundColor + (teniaBloque ? '' : ' (en contorno sin el foco)');
    }
    // Un color de 24 bits: xterm lo ponía con un atributo style, que la CSP
    // bloquea. (El prompt de cmd lo escribe la shell: $E es el escape.)
    await teclear('prompt $E[38;2;10;200;120mrgb$G$E[0m\r');
    await until(() => renglones().some((r) => r.startsWith('rgb>')), 6000);
    const verde = [...cuerpoT.querySelectorAll('.xterm-rows span')].find((s) => s.textContent.startsWith('rgb>'));
    if (!verde || getComputedStyle(verde).color !== 'rgb(10, 200, 120)') fail('terminal: un color de 24 bits no se pinta: ' + (verde ? getComputedStyle(verde).color : 'sin el prompt de prueba'));
    // (lo que escribe la shell está en el idioma de Windows: se mira la cabecera del panel)
    {
      const cabeza = term.querySelector('header');
      const textos = [cabeza.innerText, ...[...cabeza.querySelectorAll('[aria-label], [data-rad-tip]')].flatMap((n) => [n.getAttribute('aria-label') ?? '', n.getAttribute('data-rad-tip') ?? ''])];
      if (textos.some((t) => CASTELLANO.test(t)) || term.getAttribute('aria-label') !== 'Terminal') fail('terminal: quedó texto en castellano en su cabecera: ' + textos.join(' · '));
    }

    // Con el foco adentro, las teclas son de la shell: no llegan a la app. Las
    // de salir (Ctrl+T, Ctrl+B) sí.
    const llegaron = [];
    const oir = (e) => llegaron.push((e.ctrlKey ? 'ctrl+' : '') + e.key);
    document.addEventListener('keydown', oir);
    const adentro = cuerpoT.querySelector('.xterm-helper-textarea');
    key(adentro, 'u', { ctrlKey: true });
    key(adentro, 'Escape');
    key(adentro, 'f', { ctrlKey: true });
    if (llegaron.length) fail('terminal: con el foco en la shell, a la app le llegaron ' + llegaron.join(', '));
    key(adentro, 't', { ctrlKey: true });
    document.removeEventListener('keydown', oir);
    await until(() => !term.hasAttribute('data-abierto'), 2000);
    if (!llegaron.includes('ctrl+t') || term.hasAttribute('data-abierto')) fail('terminal: Ctrl+T desde adentro de la shell no la cerró (llegaron: ' + llegaron.join(', ') + ')');
    await until(() => !escena.hasAttribute('data-panel'), 3000);

    // Cerrar el panel no mata la shell: al reabrir está lo que quedó.
    key(document.body, 't', { ctrlKey: true });
    await until(() => term.hasAttribute('data-abierto'), 2000);
    await sleep(dur('base') + 200);
    if (!term.hasAttribute('data-abierto') || !pantalla().includes('Windows_NT-marca') || cualT() !== 'cmd') fail('terminal: Ctrl+T no la reabrió con lo que había quedado');
    await teclear('echo sigue-%OS%\r');
    await until(() => pantalla().includes('sigue-Windows_NT'), 6000);
    if (!pantalla().includes('sigue-Windows_NT')) fail('terminal: después de cerrar y reabrir el panel la shell no contesta');

    // El hueco es uno solo: el navegador la cierra, y ella cierra al navegador.
    chatView.querySelector('[data-accion="navegador"]').click();
    await until(() => nav.hasAttribute('data-abierto') && !term.hasAttribute('data-abierto'), 4000);
    await sleep(dur('base') + 160);
    if (term.hasAttribute('data-abierto') || escena.getAttribute('data-panel') !== 'browser') fail('terminal: abrir el navegador no la cerró (panel: ' + escena.getAttribute('data-panel') + ')');
    botonT.click();
    await until(() => term.hasAttribute('data-abierto') && !nav.hasAttribute('data-abierto'), 4000);
    await sleep(dur('base') + 160);
    if (nav.hasAttribute('data-abierto') || escena.getAttribute('data-panel') !== 'terminal') fail('terminal: abrirla no cerró el navegador (panel: ' + escena.getAttribute('data-panel') + ')');

    // Reiniciar: pantalla limpia y una shell nueva.
    term.querySelector('[data-accion="term-reiniciar"]').click();
    await until(() => !pantalla().includes('Windows_NT-marca') && />$/.test(renglones().at(-1) ?? ''), 8000);
    if (pantalla().includes('Windows_NT-marca') || renglones().some((r) => r.startsWith('rgb>'))) fail('terminal: reiniciar no dejó una shell nueva: ' + pantalla().slice(-160));
    // Si la shell termina sola, se dice; y el botón la levanta de nuevo.
    await teclear('exit\r');
    await until(() => pantalla().includes('The shell ended (code 0)'), 6000);
    await settle();
    if (!pantalla().includes('The shell ended (code 0)') || cualT() !== 'ended') fail('terminal: salir de la shell no se avisa: «' + cualT() + '» / ' + pantalla().slice(-120));
    term.querySelector('[data-accion="term-reiniciar"]').click();
    await until(() => cualT() === 'cmd' && />$/.test(renglones().at(-1) ?? ''), 8000);
    if (cualT() !== 'cmd') fail('terminal: después de terminar, el botón no levantó otra shell');
    term.querySelector('[data-accion="term-cerrar"]').click();
    await until(() => !escena.hasAttribute('data-panel'), 3000);
    if (term.hasAttribute('data-abierto') || botonT.getAttribute('aria-pressed') !== 'false') fail('terminal: su botón de cerrar no la cerró');
    data.terminal = 'cmd en la carpeta de las tools, teclear, color de 24 bits, ' + hojas.length + ' hojas construidas, teclas que no salen de la shell, Ctrl+T, turno con el navegador, reiniciar y terminar';
  }

  // 11j. Un chat largo no frena la app. Con cientos de mensajes, cada fila de
  // tool que entraba dejaba la ventana congelada varios segundos: la lista
  // hacía «viajar» a todos los mensajes, midiendo y animando de a uno, porque
  // al corregirse el scroll parecía que se habían movido todos. Se cuentan los
  // viajes de un turno con tools: tienen que ser los de las filas que entran.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const agenteL = datosM.agenteActual();
    const otro = datosM.crearChat(agenteL.id);
    const largo = datosM.crearChat(agenteL.id);
    const docL = await datosM.hilo(largo.id);
    const mensajesL = [];
    for (let i = 0; i < 120; i++) {
      mensajesL.push({ id: 'lu' + i, rol: 'user', texto: 'Question number ' + i + '?' });
      if (i % 3 === 0) mensajesL.push({ id: 'lt' + i, rol: 'tool', tool: 'fs_read', texto: 'notes-' + i + '.md', estado: 'ok', ms: 12, salida: 'line\n'.repeat(20) });
      mensajesL.push({ id: 'la' + i, rol: 'assistant', texto: '## Section ' + i + '\n\nA paragraph long enough to wrap over a couple of lines in the column, with **bold** and `code`.\n\n- one\n- two\n\n```js\nconst x = ' + i + ';\n```', estado: 'ok', modelo: agenteL.modelo, tools: [] });
    }
    docL.set({ mensajes: mensajesL });
    datosM.elegirChat(otro.id);
    await settle();
    datosM.elegirChat(largo.id);
    await until(() => (thread()?.querySelector('.dm-col')?.childElementCount ?? 0) >= mensajesL.length, 8000);
    await settle();
    const col = thread().querySelector('.dm-col');
    if (col.childElementCount < mensajesL.length) fail('chat largo: se pintaron ' + col.childElementCount + ' de ' + mensajesL.length + ' mensajes');
    // lo que no está a la vista no se maqueta ni se pinta
    if (getComputedStyle(col.firstElementChild).contentVisibility !== 'auto') fail('chat largo: los mensajes fuera de la vista se maquetan igual (content-visibility: ' + getComputedStyle(col.firstElementChild).contentVisibility + ')');
    if (thread().scrollHeight - thread().clientHeight - thread().scrollTop > 4) fail('chat largo: no abrió parado en el final');
    const animar = Element.prototype.animate;
    let viajes = 0;
    Element.prototype.animate = function contar(cuadros, ...resto) {
      if (this.parentElement === col && String(cuadros?.[0]?.transform ?? '').startsWith('translate(')) viajes++;
      return animar.call(this, cuadros, ...resto);
    };
    const guardadoAlPedir = [];
    const ronda = [{ name: 'fs_read', args: { paths: ['no-such-a.md'] } }];
    const t0L = performance.now();
    await pedir([ronda, ronda, ronda]);
    // Apenas entra la primera fila, el disco todavía no la tiene: el chat se
    // guarda entero a lo sumo cada segundo y medio, no con cada tool.
    await until(() => alive(col.querySelectorAll('.dm-tool')).some((t) => t.dataset.tool === 'fs_read' && !t.dataset.radKey.startsWith('lt')), 5000);
    guardadoAlPedir.push(((await window.rad.store.read('chat-' + largo.id))?.mensajes ?? []).filter((m) => m.rol === 'tool' && !String(m.id).startsWith('lt')).length);
    await until(() => !composer.querySelector('.rad-busy') && msgs().at(-1)?.dataset.estado === 'ok', 20000);
    const tardo = Math.round(performance.now() - t0L);
    Element.prototype.animate = animar;
    await settle();
    const alFinal = ((await window.rad.store.read('chat-' + largo.id))?.mensajes ?? []).filter((m) => m.rol === 'tool' && !String(m.id).startsWith('lt'));
    if (viajes > 40) fail('chat largo: en un turno con tres tools viajaron ' + viajes + ' mensajes de ' + mensajesL.length + ': la lista está animando a todos');
    if (guardadoAlPedir[0] !== 0) fail('chat largo: el chat entero se guardó apenas entró una fila de tool (' + guardadoAlPedir[0] + ' en el disco)');
    if (alFinal.length !== 3 || alFinal.some((m) => m.estado === 'run')) fail('chat largo: al terminar el turno el disco tiene ' + alFinal.length + ' filas de tool nuevas, se esperaban 3 terminadas');
    if (thread().scrollHeight - thread().clientHeight - thread().scrollTop > 4) fail('chat largo: después del turno no quedó parado en el final');
    datosM.ponerModoTools('manual');
    await datosM.borrarChat(largo.id);
    await datosM.borrarChat(otro.id);
    await settle();
    data.chatLargo = mensajesL.length + ' mensajes: un turno con tres tools en ' + tardo + ' ms, ' + viajes + ' viajes';
  }

  // 11k. Lo mismo, visto en el núcleo. Las tres cosas que hacen que una lista
  // larga no congele la ventana cuando se pone al día (reconcile):
  //   - un cambio de scroll no es un movimiento: el viaje se mide contra el
  //     contenedor, no contra la ventana;
  //   - se mide todo ANTES de animar (intercalado es una maquetación por item);
  //   - lo que está fuera de la ventana no viaja.
  {
    const { reconcile } = await import('/@core/list.js');
    const caja = document.createElement('div');
    Object.assign(caja.style, { position: 'fixed', left: '0', top: '60px', width: '240px', height: '200px', overflow: 'auto', overflowAnchor: 'none', opacity: '0.01', pointerEvents: 'none' });
    const lista = document.createElement('div');
    caja.append(lista);
    document.body.append(caja);
    const clave = (it) => it.id;
    const crear = (it) => { const d = document.createElement('div'); d.style.height = '20px'; d.textContent = it.id; return d; };
    let todos = Array.from({ length: 200 }, (_, i) => ({ id: 'k' + i }));
    reconcile(lista, todos, { key: clave, create: crear });
    const deViaje = (cuadros) => String(cuadros?.[0]?.transform ?? '').startsWith('translate(');
    const viajan = () => [...lista.children].filter((el) => el.getAnimations().some((a) => deViaje(a.effect.getKeyframes())));

    // El scroll cambia mientras la lista se pone al día (es lo que hace el
    // navegador al insertarse una fila): nadie se movió, nadie viaja.
    caja.scrollTop = 1000;
    await frame();
    let corrido = false;
    todos = [...todos, { id: 'nuevo' }];
    reconcile(lista, todos, { key: clave, create: crear, update: () => { if (!corrido) { corrido = true; caja.scrollTop = 900; } } });
    if (!corrido || viajan().length) fail('listas: con un cambio de scroll durante la puesta al día viajaron ' + viajan().length + ' items que no se habían movido');

    // Uno entra arriba de todo: los 200 se corren, pero se mide todo antes de
    // animar y viajan solo los que caen en la ventana.
    for (const el of lista.children) for (const a of el.getAnimations()) a.cancel();
    caja.scrollTop = 0;
    await frame();
    const orden = [];
    const medir = Element.prototype.getBoundingClientRect;
    const animar = Element.prototype.animate;
    Element.prototype.getBoundingClientRect = function contarMedida() { if (this.parentElement === lista) orden.push('m'); return medir.call(this); };
    Element.prototype.animate = function contarViaje(cuadros, ...resto) { if (this.parentElement === lista && deViaje(cuadros)) orden.push('a'); return animar.call(this, cuadros, ...resto); };
    try {
      todos = [{ id: 'arriba' }, ...todos];
      reconcile(lista, todos, { key: clave, create: crear });
    } finally {
      Element.prototype.getBoundingClientRect = medir;
      Element.prototype.animate = animar;
    }
    const primera = orden.indexOf('a');
    const viajes = orden.filter((x) => x === 'a').length;
    if (primera < 0) fail('listas: al entrar un item arriba, los que se corrieron a la vista no viajaron');
    else if (orden.slice(primera).includes('m')) fail('listas: se volvió a medir después de empezar a animar (' + orden.slice(primera).filter((x) => x === 'm').length + ' mediciones intercaladas): una maquetación por item');
    if (viajes > 80) fail('listas: al entrar un item arriba de 200 viajaron ' + viajes + ': también los que están fuera de la ventana');
    caja.remove();
    data.listasLargas = '200 items: 0 viajes por un cambio de scroll, ' + viajes + ' al entrar uno arriba, medidos antes de animar';
  }

  // 11l. La memoria: lo que la app recuerda del usuario de un chat a otro. El
  // texto fijo («About you») y la lista se editan en su vista; el agente anota
  // con `remember` y lee con `recall`; y lo que hay llega al system del agente
  // que tiene prendido su grupo Memory, también si su modelo no acepta tools.
  // El proveedor de mentira dice qué memoria le llegó.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const mem = () => window.rad.invoke('memoria:leer');
    const filasM = () => alive(view('memoria').querySelectorAll('.dm-memoria-fila'));
    const hechos = () => filasM().map((f) => f.querySelector('.dm-memoria-hecho').textContent);
    const listo2 = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const eco = () => ultimo()?.textContent ?? '';
    if ((await mem()).entradas.length || (await mem()).core) fail('memoria: no arranca vacía');
    // el renderer no puede leer el documento de la memoria: solo por sus canales
    let leyo = false;
    try { await window.rad.store.read('_memoria'); leyo = true; } catch { /* es lo esperado */ }
    if (leyo) fail('memoria: la interfaz pudo leer el documento reservado de la memoria');

    // La vista: vacía, y lo dice.
    await go('memoria');
    const vista = view('memoria');
    const areaCore = vista.querySelector('[data-campo="core"]');
    const cuentaCore = () => shown(vista.querySelector('[data-tarjeta="core"] .dm-memoria-cuenta'));
    const guardadoM = () => shown(vista.querySelector('.dm-memoria-guardado'));
    if (!vista.querySelector('.dm-memoria-vacia')?.textContent.includes('Nothing remembered yet') || filasM().length) fail('memoria: la vista vacía no lo dice');
    enIngles('en la vista Memory');

    // «About you» se guarda solo, y dice que guardó.
    type(areaCore, 'I am the smoke user.\nAnswer briefly.');
    if (!cuentaCore().startsWith('36 of 4000 characters')) fail('memoria: el contador del texto fijo dice «' + cuentaCore() + '»');
    await until(() => guardadoM() === 'Saved', 4000);
    if (guardadoM() !== 'Saved' || (await mem()).core !== 'I am the smoke user.\nAnswer briefly.') fail('memoria: el texto fijo no se guardó solo («' + guardadoM() + '», en el main: ' + JSON.stringify((await mem()).core) + ')');

    // Agregar a mano: una línea, con su detalle.
    vista.querySelector('[data-accion="memoria-nueva"]').click();
    await until(() => modal(), 2000);
    primary().click();
    await frame();
    if (!modal()?.querySelector('.rad-field[data-invalid]')) fail('memoria: se puede guardar un recuerdo vacío');
    type(modal().querySelector('[data-campo="hecho"]'), 'Has a cat named Miso');
    type(modal().querySelector('[data-campo="detalle"]'), 'Miso is three years old and hates the vacuum cleaner.');
    primary().click();
    await closed();
    await until(() => filasM().length === 1, 3000);
    if (hechos().join() !== 'Has a cat named Miso' || !filasM()[0].hasAttribute('data-con-detalle') || !filasM()[0].textContent.includes('added by you')) fail('memoria: el recuerdo agregado a mano no aparece bien: ' + filasM()[0]?.textContent);

    // El agente anota y lee, por el motor de verdad.
    await go('chat');
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await settle();
    await pedir([[{ name: 'remember', args: { fact: 'Uses PowerShell 7' } }, { name: 'remember', args: { fact: 'uses powershell 7.' } }, { name: 'recall', args: { id: 'm1' } }, { name: 'recall', args: { query: 'powershell' } }, { name: 'remember', args: { fact: 'Never forgets this', core: true } }]]);
    await listo2();
    const sale = (name, n) => fila(name, n)?.querySelector('.dm-tool-pre').textContent ?? '';
    if (sale('remember', 0) !== 'saved to memory as m2') fail('memoria: remember devolvió «' + sale('remember', 0) + '»');
    if (sale('remember', 1) !== 'already in memory as m2 — nothing saved') fail('memoria: anotar lo mismo dos veces devolvió «' + sale('remember', 1) + '»');
    if (!sale('recall', 0).startsWith('m1 — Has a cat named Miso') || !sale('recall', 0).includes('hates the vacuum cleaner')) fail('memoria: recall por id no trajo el detalle: ' + sale('recall', 0).slice(0, 120));
    if (!sale('recall', 1).includes('(m2) Uses PowerShell 7')) fail('memoria: recall con query no encontró lo anotado: ' + sale('recall', 1).slice(0, 120));
    if (sale('remember', 2) !== 'saved to core memory (always in context)') fail('memoria: remember con core devolvió «' + sale('remember', 2) + '»');
    if (fila('remember')?.querySelector('.dm-tool-icono')?.dataset.icono !== 'memory' || shown(fila('remember', 0)?.querySelector('.dm-tool-que')) !== 'Uses PowerShell 7') fail('memoria: la fila de remember no lleva su ícono o no dice qué anotó');
    const estadoM = await mem();
    if (estadoM.entradas.map((e) => e.id + ':' + e.de).join() !== 'm1:user,m2:agent' || estadoM.core !== 'I am the smoke user.\nAnswer briefly.\n- Never forgets this\n') fail('memoria: después del turno quedó ' + JSON.stringify(estadoM.entradas.map((e) => e.id + ':' + e.de)) + ' y el Core ' + JSON.stringify(estadoM.core));

    // En el turno siguiente la memoria está en el system: el Core y las dos líneas.
    type(area, 'What do you know about me?');
    key(area, 'Enter');
    await listo2();
    if (!eco().includes('memory: core yes, 2 entries')) fail('memoria: al modelo no le llegó la memoria en el turno siguiente: ' + (/memory:[^\n]*/.exec(eco())?.[0] ?? '(sin renglón de memoria)'));

    // La vista se puso al día sola con lo que anotó el agente, y el texto fijo
    // trae su línea (el usuario no lo estaba editando).
    await go('memoria');
    await until(() => filasM().length === 2, 3000);
    if (hechos().join(' | ') !== 'Uses PowerShell 7 | Has a cat named Miso' || !filasM()[0].textContent.includes('noted by an agent')) fail('memoria: la lista no muestra lo que anotó el agente, lo más nuevo arriba: ' + hechos().join(' | '));
    if (areaCore.value !== 'I am the smoke user.\nAnswer briefly.\n- Never forgets this\n') fail('memoria: el texto fijo no trae la línea que agregó el agente: ' + JSON.stringify(areaCore.value));
    // El usuario edita el texto mientras un agente le agrega otra línea: no se pisan.
    type(areaCore, 'I am the smoke user, edited.\n- Never forgets this\n');
    await window.rad.invoke('memoria:core', { texto: (await mem()).core + '- Added behind your back\n', base: (await mem()).core });
    await until(() => guardadoM() === 'Saved', 4000);
    await settle();
    const coreFinal = (await mem()).core;
    if (coreFinal !== 'I am the smoke user, edited.\n- Never forgets this\n- Added behind your back\n' || areaCore.value !== coreFinal) fail('memoria: editar el texto mientras otro le agregaba una línea perdió algo: ' + JSON.stringify(coreFinal) + ' / a la vista ' + JSON.stringify(areaCore.value));

    // Buscar, cambiar y borrar.
    type(vista.querySelector('[data-campo="buscar"]'), 'miso');
    await settle();
    if (hechos().join() !== 'Has a cat named Miso') fail('memoria: buscar «miso» dejó ' + hechos().join(' | '));
    type(vista.querySelector('[data-campo="buscar"]'), 'vacuum');
    await settle();
    if (hechos().join() !== 'Has a cat named Miso') fail('memoria: la búsqueda no mira el detalle');
    type(vista.querySelector('[data-campo="buscar"]'), '');
    await settle();
    filasM()[1].querySelector('[data-accion="memoria-editar"]').click();
    await until(() => modal(), 2000);
    if (modal().querySelector('[data-campo="hecho"]').value !== 'Has a cat named Miso' || !modal().querySelector('[data-campo="detalle"]').value.includes('vacuum')) fail('memoria: el formulario no trae el recuerdo que se va a cambiar');
    type(modal().querySelector('[data-campo="hecho"]'), 'Has a cat named Miso and a dog named Udon');
    primary().click();
    await closed();
    await until(() => hechos().includes('Has a cat named Miso and a dog named Udon'), 3000);
    if (!hechos().includes('Has a cat named Miso and a dog named Udon')) fail('memoria: cambiar un recuerdo no se ve en la lista');
    filasM()[0].querySelector('[data-accion="memoria-borrar"]').click();
    await until(() => modal(), 2000);
    if (!modal().textContent.includes('Uses PowerShell 7')) fail('memoria: borrar no dice qué va a borrar');
    primary().click();
    await closed();
    await until(() => filasM().length === 1, 3000);
    if ((await mem()).entradas.map((e) => e.id).join() !== 'm1') fail('memoria: borrar dejó ' + JSON.stringify((await mem()).entradas.map((e) => e.id)));
    const pieLista = shown(vista.querySelector('[data-tarjeta="recuerdos"] .dm-memoria-cuenta'));
    if (!/^1 entry · \d+ of 8000 characters in context/.test(pieLista)) fail('memoria: el pie de la lista dice «' + pieLista + '»');

    // Con el grupo Memory apagado, el agente no la ve: ni en el system ni como tools.
    await go('chat');
    const agenteM = datosM.agenteActual();
    const susTools = datosM.toolsDe(agenteM);
    datosM.ponerTools(agenteM.id, susTools.filter((t) => t !== 'remember' && t !== 'recall'));
    await settle();
    type(area, 'And now?');
    key(area, 'Enter');
    await listo2();
    if (eco().includes('memory:')) fail('memoria: con el grupo Memory apagado igual le llegó la memoria: ' + /memory:[^\n]*/.exec(eco())?.[0]);
    datosM.ponerTools(agenteM.id, susTools);
    await settle();
    // Un modelo que no acepta tools también la ve, si tiene el grupo prendido.
    const sinTools = datosM.crearAgente({ nombre: 'No tools model', proveedor: 'venice', modelo: 'venice-uncensored-1-2', instrucciones: 'Short.', tools: datosM.todasLasTools() });
    const chatST = datosM.crearChat(sinTools.id);
    await settle();
    await datosM.enviar(chatST.id, 'Who am I?');
    await listo2();
    if (!eco().includes('memory: core yes, 1 entry')) fail('memoria: a un modelo sin tools no le llegó la memoria: ' + (/memory:[^\n]*|The Venice key[^\n]*/.exec(eco())?.[0] ?? eco().slice(0, 120)));
    await datosM.borrarAgente(sinTools.id);
    datosM.elegirAgente(agenteM.id);
    await settle();

    // Queda como estaba: vacía (las pruebas que siguen cuentan los renglones de
    // la respuesta de mentira, y la pasada 2 no espera memoria).
    await window.rad.invoke('memoria:borrar', 'm1');
    await window.rad.invoke('memoria:core', { texto: '', base: (await mem()).core });
    await go('memoria');
    await until(() => filasM().length === 0 && areaCore.value === '', 3000);
    if (filasM().length || areaCore.value !== '' || !vista.querySelector('.dm-memoria-vacia')) fail('memoria: vaciarla no dejó la vista vacía');
    await go('chat');
    datosM.ponerModoTools('manual');
    data.memoria = 'texto fijo guardado solo, agregar a mano con detalle, remember (y repetido), recall por id y por palabras, core, la memoria en el system del turno siguiente, la carrera del texto fijo, buscar, cambiar, borrar, grupo apagado y modelo sin tools';
  }

  // 11m. Las skills: procedimientos que el usuario les deja a sus agentes. El
  // usuario las escribe e importa en su vista; el agente ve el índice en el
  // system y carga la que le sirve con `skill`; y lo que el agente escribe con
  // `create_skill` es una PROPUESTA que no se puede usar hasta que el usuario la
  // aprueba. El proveedor de mentira dice cuántas skills le llegaron en el índice.
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const sk = async () => (await window.rad.invoke('skills:leer')).skills;
    const filasS = () => alive(view('skills').querySelectorAll('.dm-skill-fila'));
    const filaS = (nombre) => filasS().find((f) => f.querySelector('.dm-skill-nombre').textContent === nombre);
    const nombresS = () => filasS().map((f) => f.querySelector('.dm-skill-nombre').textContent).join();
    const pieS = (nombre) => filaS(nombre)?.querySelector('.dm-memoria-de').textContent ?? '';
    const boton2 = (texto) => [...(modal()?.querySelectorAll('.rad-button') ?? [])].find((b) => b.textContent === texto);
    const listo3 = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const eco = () => ultimo()?.textContent ?? '';
    const sale = (name, n) => fila(name, n)?.querySelector('.dm-tool-pre').textContent ?? '';
    const avisosS = () => [...document.querySelectorAll('.rad-toast')].filter((n) => !n.hasAttribute('data-rad-leaving'));
    const pregunta = async (texto) => { type(area, texto); key(area, 'Enter'); await listo3(); };
    if ((await sk()).length) fail('skills: no arranca vacía');
    let leyo = false;
    try { await window.rad.store.read('_skills'); leyo = true; } catch { /* es lo esperado */ }
    if (leyo) fail('skills: la interfaz pudo leer el documento reservado de las skills');

    // La vista, vacía; y el formulario no deja guardar cualquier cosa.
    await go('skills');
    const vista = view('skills');
    if (!vista.querySelector('.dm-memoria-vacia')?.textContent.includes('No skills yet') || filasS().length) fail('skills: la vista vacía no lo dice');
    enIngles('en la vista Skills');
    vista.querySelector('[data-accion="skill-nueva"]').click();
    await until(() => modal(), 2000);
    const campoS = (c) => modal().querySelector('[data-campo="' + c + '"]');
    type(campoS('nombre'), 'Bad Name');
    type(campoS('descripcion'), 'Use it when I ask for a summary');
    type(campoS('cuerpo'), '# Brief\n\nThree bullets, no more.');
    boton2('Save').click();
    await until(() => modal()?.querySelector('.rad-field[data-invalid]'), 2000);
    if (!modal()?.querySelector('.rad-field[data-invalid] [data-campo="nombre"]') || (await sk()).length) fail('skills: un nombre inválido no marca su campo, o se guardó igual');
    type(campoS('nombre'), 'brief');
    boton2('Save').click();
    await closed();
    await until(() => filasS().length === 1, 3000);
    if (nombresS() !== 'brief' || pieS('brief') !== 'written by you' || !filaS('brief').querySelector('[data-accion="skill-activa"]').checked || filaS('brief').hasAttribute('data-pendiente')) fail('skills: la skill escrita a mano no quedó en uso: ' + nombresS() + ' / ' + pieS('brief'));

    // El agente la ve en su índice y la carga.
    await go('chat');
    chatView.querySelector('[data-accion="nuevo-chat"]').click();
    await settle();
    await pregunta('Which skills do you have?');
    if (!eco().includes('skills in the list: 1')) fail('skills: al modelo no le llegó el índice: ' + (/skills in the list[^\n]*/.exec(eco())?.[0] ?? '(sin renglón de skills)'));
    await pedir([[{ name: 'skill', args: { name: 'brief' } }, { name: 'skill', args: {} }, { name: 'skill', args: { name: 'nope' } }]]);
    await listo3();
    if (sale('skill', 0) !== 'Skill "brief" — a procedure the user wrote or approved. Follow it for this task:\n\n# Brief\n\nThree bullets, no more.') fail('skills: cargar una skill devolvió: ' + sale('skill', 0).slice(0, 140));
    if (sale('skill', 1) !== 'Skills (1):\n- brief: Use it when I ask for a summary') fail('skills: listar devolvió: ' + sale('skill', 1));
    if (sale('skill', 2) !== 'error: there is no skill named "nope". The skills are: brief.' || fila('skill', 2).dataset.estado !== 'error') fail('skills: pedir una que no existe devolvió: ' + sale('skill', 2));
    if (fila('skill', 0)?.querySelector('.dm-tool-icono')?.dataset.icono !== 'sparkle' || shown(fila('skill', 0)?.querySelector('.dm-tool-que')) !== 'brief') fail('skills: la fila de skill no lleva su ícono o no dice cuál cargó');

    // El agente propone una: NO queda en uso, y el usuario se entera.
    await pedir([[{ name: 'create_skill', args: { name: 'weekly-report', description: 'Use it for the weekly report', body: '1. Read the notes.\n2. Three bullets.' } }, { name: 'skill', args: { name: 'weekly-report' } }]]);
    await listo3();
    if (!sale('create_skill', -1).startsWith('Proposed the skill "weekly-report". It is NOT in use yet')) fail('skills: create_skill devolvió: ' + sale('create_skill', -1).slice(0, 120));
    if (!sale('skill', -1).startsWith('error: the skill "weekly-report" is a proposal waiting for the user')) fail('skills: una propuesta se pudo cargar antes de aprobarla: ' + sale('skill', -1).slice(0, 120));
    const avisoS = avisosS().find((n) => n.textContent.includes('An agent proposed a skill: “weekly-report”'));
    if (!avisoS?.querySelector('.rad-toast-action')) fail('skills: no se avisó de la propuesta, o el aviso no ofrece revisarla');
    // El aviso lleva a la vista y abre la revisión.
    avisoS?.querySelector('.rad-toast-action')?.click();
    await until(() => modal()?.dataset.skill === 'weekly-report', 4000);
    if (document.querySelector('.rad-tab[aria-current="page"]')?.dataset.view !== 'skills' || modal()?.dataset.skill !== 'weekly-report') fail('skills: el aviso no llevó a revisar la propuesta');
    if (!modal()?.textContent.includes('No agent can use it until you approve it') || modal()?.querySelector('.dm-skill-propuesta')?.textContent !== '1. Read the notes.\n2. Three bullets.' || modal()?.querySelector('.dm-diff')) fail('skills: la revisión de una skill nueva no muestra lo propuesto (o muestra un diff sin tener con qué comparar)');
    boton2('Not now')?.click();
    await closed();
    await settle();
    if (!filaS('weekly-report')?.hasAttribute('data-pendiente') || filasS()[0] !== filaS('weekly-report') || !pieS('weekly-report').startsWith('proposed by an agent') || filaS('weekly-report').querySelector('.rad-switch').hidden !== true) fail('skills: «Not now» no dejó la propuesta esperando, arriba de todo: ' + nombresS() + ' / ' + pieS('weekly-report'));
    // Mientras espera, no está en el índice del agente.
    await go('chat');
    await pregunta('And now?');
    if (!eco().includes('skills in the list: 1')) fail('skills: una propuesta sin aprobar entró al índice: ' + /skills in the list[^\n]*/.exec(eco())?.[0]);
    await go('skills');
    // Aprobarla la pone en uso.
    filaS('weekly-report').querySelector('[data-accion="skill-revisar"]').click();
    await until(() => modal()?.dataset.skill === 'weekly-report', 3000);
    boton2('Approve').click();
    await closed();
    await until(() => filaS('weekly-report') && !filaS('weekly-report').hasAttribute('data-pendiente'), 3000);
    if (pieS('weekly-report') !== 'written by an agent' || (await sk()).find((x) => x.nombre === 'weekly-report')?.cuerpo !== '1. Read the notes.\n2. Three bullets.') fail('skills: aprobar no dejó la skill en uso: ' + pieS('weekly-report'));
    await go('chat');
    await pregunta('And after approving?');
    if (!eco().includes('skills in the list: 2')) fail('skills: la skill aprobada no entró al índice: ' + /skills in the list[^\n]*/.exec(eco())?.[0]);

    // El agente propone un CAMBIO a una del usuario: la vigente sigue en uso, se
    // ve qué cambia, y descartarlo la deja como estaba.
    await pedir([[{ name: 'create_skill', args: { name: 'brief', description: 'Use it when I ask for a summary', body: '# Brief\n\nFive bullets, no more.' } }, { name: 'skill', args: { name: 'brief' } }]]);
    await listo3();
    if (!sale('create_skill', -1).startsWith('Proposed a change to the skill "brief". The current version stays in use') || !sale('skill', -1).endsWith('Three bullets, no more.')) fail('skills: proponer un cambio pisó la versión vigente: ' + sale('create_skill', -1).slice(0, 90) + ' / ' + sale('skill', -1).slice(-40));
    await go('skills');
    await until(() => filaS('brief')?.hasAttribute('data-pendiente'), 3000);
    if (!pieS('brief').includes('an agent proposed a change') || filaS('brief').querySelector('.rad-switch').hidden) fail('skills: una skill con un cambio propuesto no lo dice, o perdió su interruptor: ' + pieS('brief'));
    filaS('brief').querySelector('[data-accion="skill-revisar"]').click();
    await until(() => modal()?.dataset.skill === 'brief', 3000);
    const renglonesD = [...(modal()?.querySelectorAll('.dm-diff-renglon') ?? [])];
    if (!renglonesD.some((r) => r.dataset.t === 'menos' && r.textContent.includes('Three bullets')) || !renglonesD.some((r) => r.dataset.t === 'mas' && r.textContent.includes('Five bullets'))) fail('skills: la revisión de un cambio no muestra qué cambia');
    if (!modal()?.textContent.includes('The current version stays in use until you approve it')) fail('skills: la revisión de un cambio no dice que la vigente sigue en uso');
    boton2('Discard').click();
    await closed();
    await until(() => filaS('brief') && !filaS('brief').hasAttribute('data-pendiente'), 3000);
    { const b = (await sk()).find((x) => x.nombre === 'brief'); if (b.cuerpo !== '# Brief\n\nThree bullets, no more.' || b.propuesta) fail('skills: descartar un cambio no dejó la skill como estaba'); }

    // Apagada: sale del índice y no se carga.
    filaS('brief').querySelector('[data-accion="skill-activa"]').click();
    await until(() => filaS('brief')?.hasAttribute('data-apagada'), 3000);
    if (!pieS('brief').includes('turned off')) fail('skills: apagar una skill no se ve en la lista: ' + pieS('brief'));
    await go('chat');
    await pedir([[{ name: 'skill', args: { name: 'brief' } }]]);
    await listo3();
    if (!sale('skill', -1).startsWith('error: the skill "brief" is turned off')) fail('skills: una skill apagada se pudo cargar: ' + sale('skill', -1).slice(0, 100));
    await pregunta('How many now?');
    if (!eco().includes('skills in the list: 1')) fail('skills: una skill apagada sigue en el índice: ' + /skills in the list[^\n]*/.exec(eco())?.[0]);

    // Con el grupo Skills apagado, el agente no ve el índice.
    const agenteS = datosM.agenteActual();
    const susToolsS = datosM.toolsDe(agenteS);
    datosM.ponerTools(agenteS.id, susToolsS.filter((t) => t !== 'skill' && t !== 'create_skill'));
    await settle();
    await pregunta('And without the group?');
    if (eco().includes('skills in the list')) fail('skills: con el grupo Skills apagado igual le llegó el índice');
    datosM.ponerTools(agenteS.id, susToolsS);
    await settle();

    // Importar un .md (el formato de las skills de Claude Code): abre el
    // formulario lleno, sin guardar nada hasta que el usuario lo mire.
    await go('skills');
    await vista._importarTexto('---\nname: Lab Report\ndescription: Use it for lab reports\n---\n\n# Lab\n\nSteps.', 'SKILL.md');
    await until(() => modal(), 2000);
    if (campoS('nombre').value !== 'lab-report' || campoS('descripcion').value !== 'Use it for lab reports' || campoS('cuerpo').value !== '# Lab\n\nSteps.' || (await sk()).some((x) => x.nombre === 'lab-report')) fail('skills: importar un .md no llenó el formulario (o guardó sin preguntar): ' + campoS('nombre').value + ' / ' + campoS('descripcion').value);
    boton2('Save').click();
    await closed();
    await until(() => filaS('lab-report'), 3000);
    if (nombresS() !== 'brief,lab-report,weekly-report') fail('skills: después de importar la lista es ' + nombresS());
    // Cambiar y borrar.
    filaS('lab-report').querySelector('[data-accion="skill-editar"]').click();
    await until(() => modal(), 2000);
    if (campoS('cuerpo').value !== '# Lab\n\nSteps.') fail('skills: el formulario no trae la skill que se va a cambiar');
    type(campoS('descripcion'), 'Use it for every lab report');
    boton2('Save').click();
    await closed();
    await until(() => filaS('lab-report')?.querySelector('.dm-skill-descripcion').textContent === 'Use it for every lab report', 3000);
    if (filaS('lab-report')?.querySelector('.dm-skill-descripcion').textContent !== 'Use it for every lab report') fail('skills: cambiar una skill no se ve en la lista');
    filaS('lab-report').querySelector('[data-accion="skill-borrar"]').click();
    await until(() => modal(), 2000);
    if (!modal().textContent.includes('lab-report')) fail('skills: borrar no dice qué va a borrar');
    primary().click();
    await closed();
    await until(() => !filaS('lab-report'), 3000);
    const pieLista = shown(vista.querySelector('[data-tarjeta="skills"] .dm-memoria-cuenta'));
    if (!/^1 of 2 in use · the list takes \d+ of 4000 characters of context$/.test(pieLista)) fail('skills: el pie de la lista dice «' + pieLista + '»');

    // Queda como estaba: sin skills.
    for (const s of await sk()) await window.rad.invoke('skills:borrar', s.nombre);
    await until(() => filasS().length === 0, 3000);
    if (filasS().length || !vista.querySelector('.dm-memoria-vacia')) fail('skills: borrarlas todas no dejó la vista vacía');
    for (const a of avisosS()) a.querySelector('.rad-toast-close, [aria-label="Close"], [aria-label="Dismiss"]')?.click();
    await go('chat');
    datosM.ponerModoTools('manual');
    data.skills = 'escribir a mano, el índice en el system, cargar y listar, proponer (no queda en uso), el aviso que lleva a revisar, aprobar, un cambio con su diff, descartar, apagar, grupo apagado, importar un .md, cambiar y borrar';
  }

  // 11n. La carpeta de trabajo: cada chat la suya. Un chat nuevo arranca en la
  // carpeta de inicio (Settings); si su agente se mueve, se mueve ese chat y
  // ningún otro; se ve debajo del campo para escribir y se cambia desde ahí; y
  // la terminal abre donde está el chat que se ve. Lo que corre de verdad es
  // un comando que dice dónde está parado. (En el humo, «elegir una carpeta»
  // no abre el diálogo del sistema: devuelve una de la corrida.)
  {
    const datosM = await import('/datos.js');
    datosM.ponerModoTools('auto');
    const botonC = chatView.querySelector('[data-accion="carpeta"]');
    const ruta = () => botonC?.dataset.ruta ?? '';
    const dice = () => shown(botonC?.querySelector('.dm-carpeta-texto'));
    const listoC = async () => { await sleep(200); for (let i = 0; i < 400 && (composer.querySelector('.rad-busy') || ultimo()?.dataset.estado !== 'ok'); i++) await sleep(50); await settle(); };
    const salida = () => fila('shell_exec', -1)?.querySelector('.dm-tool-pre').textContent ?? '';
    const donde = async () => { await pedir([[{ name: 'shell_exec', args: { command: '(Get-Location).Path' } }]]); await listoC(); return salida(); };
    const menuC = async () => { botonC.click(); await until(() => menus().length === 1, 2000); await sleep(dur('base') + 80); return menus()[0]; };
    const avisosC = () => [...document.querySelectorAll('.rad-toast')].filter((n) => !n.hasAttribute('data-rad-leaving'));
    const nuevoChat = async () => { chatView.querySelector('[data-accion="nuevo-chat"]').click(); await settle(); return datosM.chatActual().id; };
    const inicio = datosM.carpetaInicio();
    if (!/workspace$/.test(inicio)) fail('carpeta: la de inicio, en el humo, no es la de la corrida: ' + inicio);
    if (!botonC) fail('carpeta: el chat no muestra dónde está parado');

    // Un chat nuevo nace en la de inicio, y se ve.
    const chatA = await nuevoChat();
    await until(() => ruta() === inicio, 2000);
    if (ruta() !== inicio || datosM.chat(chatA).carpeta !== inicio) fail('carpeta: un chat nuevo no nace en la carpeta de inicio: ' + ruta());
    if (!(dice() === inicio || (/^[A-Za-z]:\\…\\/.test(dice()) && dice().endsWith('workspace'))) || !botonC.getAttribute('aria-label').endsWith(inicio)) fail('carpeta: el botón dice «' + dice() + '»');
    {
      const b = botonC.getBoundingClientRect();
      const campo = composer.getBoundingClientRect();
      if (b.width < 40 || b.top < campo.bottom - 1 || b.left < campo.left - 1 || b.right > campo.right + 1 || b.bottom > innerHeight) fail('carpeta: el botón no queda debajo del campo, alineado con él: ' + [b.left, b.top, b.right, b.bottom].map(Math.round).join() + ' / campo ' + [campo.left, campo.top, campo.right, campo.bottom].map(Math.round).join());
    }
    const colorSano = getComputedStyle(botonC).color;

    // El agente se mueve: se mueve ESTE chat, y su turno siguiente arranca ahí.
    await pedir([[{ name: 'shell_exec', args: { command: 'New-Item -ItemType Directory sub-a | Out-Null' } }], [{ name: 'shell_exec', args: { command: '(Get-Location).Path', cwd: 'sub-a' } }]]);
    await listoC();
    await until(() => ruta().endsWith('workspace\\sub-a'), 3000);
    if (!ruta().endsWith('workspace\\sub-a') || datosM.chat(chatA).carpeta !== ruta()) fail('carpeta: el cd del agente no movió su chat: ' + ruta());
    const enA = await donde();
    if (!enA.includes('workspace\\sub-a')) fail('carpeta: el turno siguiente del chat no arrancó donde había quedado: ' + enA.slice(-90));

    // Otro chat, nuevo: en la de inicio, no donde quedó el primero.
    const chatB = await nuevoChat();
    await until(() => ruta() === inicio, 2000);
    if (chatB === chatA || ruta() !== inicio) fail('carpeta: un chat nuevo arrancó donde había quedado otro: ' + ruta());
    const enB = await donde();
    if (enB.includes('sub-a') || !enB.includes('workspace')) fail('carpeta: los comandos de un chat corrieron en la carpeta de otro: ' + enB.slice(-90));
    // …y el primero sigue en la suya.
    datosM.elegirChat(chatA);
    await until(() => ruta().endsWith('workspace\\sub-a'), 3000);
    await settle();
    if (!ruta().endsWith('workspace\\sub-a')) fail('carpeta: al volver a un chat, el botón no muestra SU carpeta: ' + ruta());
    const otraVezA = await donde();
    if (!otraVezA.includes('workspace\\sub-a')) fail('carpeta: un chat perdió su carpeta por usar otro: ' + otraVezA.slice(-90));

    // El menú: abre hacia arriba, y elegir otra carpeta mueve solo este chat.
    {
      const m = await menuC();
      const rotulos = [...(m?.querySelectorAll('.rad-menu-item') ?? [])].map((i) => i.textContent.trim()).join('|');
      if (rotulos !== 'Choose another folder…|Open in File Explorer|Copy path|Back to the home folder') fail('carpeta: el menú trae ' + rotulos);
      if (m && m.getBoundingClientRect().bottom > botonC.getBoundingClientRect().top + 1) fail('carpeta: el menú no abre hacia arriba');
      enIngles('en el menú de la carpeta');
      await pick('Choose another folder');
    }
    await until(() => ruta().endsWith('workspace\\picked'), 3000);
    if (!ruta().endsWith('workspace\\picked') || datosM.chat(chatA).carpeta !== ruta()) fail('carpeta: elegir otra carpeta no movió el chat: ' + ruta());
    if (datosM.chat(chatB).carpeta !== inicio) fail('carpeta: elegir la carpeta de un chat movió la de otro');
    const enElegida = await donde();
    if (!enElegida.includes('workspace\\picked')) fail('carpeta: los comandos no corren en la carpeta elegida: ' + enElegida.slice(-90));
    // Abrirla en el Explorador (en el humo no abre nada): sin queja.
    await menuC();
    await pick('Open in File Explorer');
    if (avisosC().some((n) => n.textContent.includes('That folder is gone'))) fail('carpeta: abrir una carpeta que existe dice que no está');
    // Volver a la de inicio; y ya en ella, esa opción se apaga.
    await menuC();
    await pick('Back to the home folder');
    await until(() => ruta() === inicio, 3000);
    if (ruta() !== inicio || datosM.chat(chatA).carpeta !== inicio) fail('carpeta: «Back to the home folder» dejó el chat en ' + ruta());
    {
      const m = await menuC();
      const volver = [...(m?.querySelectorAll('.rad-menu-item') ?? [])].find((i) => i.textContent.includes('Back to the home folder'));
      if (volver?.getAttribute('aria-disabled') !== 'true') fail('carpeta: en la carpeta de inicio, «volver a la de inicio» no está apagado');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await until(() => menus().length === 0, 2000);
      await settle();
    }

    // Una carpeta que ya no existe: se avisa, y el mensaje siguiente usa la de
    // inicio. (De paso, una ruta larga se acorta por el medio.)
    const fantasma = inicio + '\\a-folder-with-quite-a-long-name-for-the-smoke\\and-one-more-level-just-to-be-sure-that-it-does-not-fit\\deleted-since';
    datosM.ponerCarpeta(chatA, fantasma);
    await until(() => botonC.hasAttribute('data-falta'), 3000);
    await settle();
    if (!botonC.hasAttribute('data-falta') || !botonC.getAttribute('data-rad-tip').includes('is gone') || getComputedStyle(botonC).color === colorSano) fail('carpeta: una carpeta que ya no existe no se avisa en el botón');
    if (!/^[A-Za-z]:\\…\\/.test(dice()) || !dice().endsWith('deleted-since') || dice().length >= fantasma.length || !botonC.getAttribute('aria-label').endsWith(fantasma)) fail('carpeta: una ruta larga no se acorta por el medio: «' + dice() + '»');
    {
      // …y lo acortado entra en su renglón, sin pasarse del campo
      const t = botonC.querySelector('.dm-carpeta-texto');
      if (t.scrollWidth > t.clientWidth + 1 || botonC.getBoundingClientRect().right > composer.getBoundingClientRect().right + 1) fail('carpeta: la ruta acortada igual no entra en su renglón (' + t.scrollWidth + ' en ' + t.clientWidth + ' px): «' + dice() + '»');
    }
    await menuC();
    await pick('Open in File Explorer');
    await until(() => avisosC().some((n) => n.textContent.includes('That folder is gone')), 3000);
    if (!avisosC().some((n) => n.textContent.includes('That folder is gone'))) fail('carpeta: abrir una carpeta que ya no existe no dice nada');
    const sinCarpeta = await donde();
    if (sinCarpeta.includes('deleted-since') || !sinCarpeta.includes('workspace')) fail('carpeta: con la carpeta borrada, el turno no corrió en la de inicio: ' + sinCarpeta.slice(-90));
    await until(() => ruta() === inicio && !botonC.hasAttribute('data-falta'), 3000);
    if (ruta() !== inicio || botonC.hasAttribute('data-falta')) fail('carpeta: después de ese turno el chat no quedó en una carpeta que existe: ' + ruta());

    // La terminal abre donde está el chat que se ve (reiniciarla la lleva ahí).
    {
      const escena = chatView.querySelector('.dm-escena');
      const term = chatView.querySelector('.dm-term');
      const cuerpoT = term.querySelector('.dm-term-cuerpo');
      const renglonesT = () => [...cuerpoT.querySelectorAll('.xterm-rows > div')].map((d) => d.textContent.replace(/ /g, ' ').trimEnd()).filter(Boolean);
      const reiniciar = async (cola) => { term.querySelector('[data-accion="term-reiniciar"]').click(); await until(() => cola.test(renglonesT().slice(-2).join('')), 9000); return renglonesT().slice(-2).join(''); };
      datosM.ponerCarpeta(chatA, inicio + '\\sub-a');
      await until(() => ruta().endsWith('sub-a'), 2000);
      chatView.querySelector('[data-accion="terminal"]').click();
      await until(() => term.hasAttribute('data-abierto') && cuerpoT.querySelector('.xterm-rows') && />$/.test(renglonesT().at(-1) ?? ''), 9000);
      await sleep(dur('base') + 200);
      const enSub = await reiniciar(/sub-a>$/);
      if (!/sub-a>$/.test(enSub)) fail('carpeta: la terminal no abrió en la carpeta del chat que se ve: «' + enSub + '»');
      datosM.elegirChat(chatB);
      await until(() => ruta() === inicio, 3000);
      await settle();
      const enInicio = await reiniciar(/workspace>$/);
      if (!/workspace>$/.test(enInicio)) fail('carpeta: con otro chat a la vista, la terminal abrió en «' + enInicio + '»');
      term.querySelector('[data-accion="term-cerrar"]').click();
      await until(() => !escena.hasAttribute('data-panel'), 3000);
      await settle();
    }

    // Settings: la carpeta de inicio. Cambiarla vale para los chats NUEVOS, y
    // para el que todavía no arrancó (está vacío y seguía en la de inicio).
    const chatVacio = await nuevoChat();
    if (datosM.chat(chatVacio).carpeta !== inicio) fail('carpeta: el chat vacío no nació en la de inicio');
    await go('ajustes');
    const tarjetaC = view('ajustes').querySelector('[data-tarjeta="carpeta"]');
    const inicioDice = () => shown(tarjetaC?.querySelector('.dm-carpeta-inicio'));
    if (inicioDice() !== inicio) fail('carpeta: Settings no muestra la carpeta de inicio: «' + inicioDice() + '»');
    enIngles('en Settings, con la carpeta de inicio');
    tarjetaC?.querySelector('[data-accion="carpeta-inicio"]').click();
    await until(() => inicioDice().endsWith('workspace\\picked'), 3000);
    await settle();
    if (!inicioDice().endsWith('workspace\\picked') || datosM.carpetaInicio() !== inicioDice()) fail('carpeta: cambiar la de inicio en Settings dejó «' + inicioDice() + '» / ' + datosM.carpetaInicio());
    const mala = await window.rad.invoke('chat:carpeta-inicio', inicio + '\\nope-nope');
    if (mala?.ok !== false || !datosM.carpetaInicio().endsWith('picked')) fail('carpeta: una carpeta de inicio que no existe se aceptó');
    await go('chat');
    await until(() => ruta().endsWith('workspace\\picked'), 2000);
    if (!datosM.chat(chatVacio).carpeta.endsWith('workspace\\picked') || !ruta().endsWith('workspace\\picked')) fail('carpeta: un chat que todavía no arrancó no siguió a la carpeta de inicio nueva: ' + datosM.chat(chatVacio).carpeta);
    const chatC = await nuevoChat();
    await until(() => ruta().endsWith('workspace\\picked'), 2000);
    if (!ruta().endsWith('workspace\\picked') || datosM.chat(chatC).carpeta !== ruta()) fail('carpeta: un chat nuevo no arranca en la carpeta de inicio nueva: ' + ruta());
    if (datosM.chat(chatB).carpeta !== inicio || datosM.chat(chatA).carpeta !== inicio + '\\sub-a') fail('carpeta: cambiar la de inicio movió chats que ya tenían la suya');
    const enC = await donde();
    if (!enC.includes('workspace\\picked')) fail('carpeta: el chat nuevo no corre en la carpeta de inicio nueva: ' + enC.slice(-90));

    // Queda como estaba.
    await datosM.ponerCarpetaInicio(inicio);
    await until(() => datosM.carpetaInicio() === inicio, 2000);
    for (const a of avisosC()) a.querySelector('.rad-toast-close, [aria-label="Close"], [aria-label="Dismiss"]')?.click();
    datosM.ponerModoTools('manual');
    data.carpeta = 'un chat nuevo en la de inicio, el cd mueve solo su chat, cada chat vuelve a la suya, elegir otra, volver a la de inicio, una que ya no existe, la terminal donde está el chat, y la de inicio en Settings';
  }

  // Cambiarle las tools a un agente que YA existía, desde su formulario.
  {
    await go('agentes');
    const primera = () => cards()[0];
    const tarjeta = () => shown(primera().querySelector('.dm-tarjeta-tools'));
    const sw = (g) => modal().querySelector('[data-campo="tools"] input[data-grupo="' + g + '"]');
    const editar = async () => { primera().querySelector('[data-accion="editar"]').click(); await frame(); await sleep(dur('base') + 200); };
    const guardar = async () => { primary().click(); await closed(); await settle(); };
    await editar();
    if (!sw('files')?.checked || !sw('screen')?.checked) fail('el formulario de un agente con todas las tools no las muestra prendidas');
    for (const g of ['commands', 'code', 'data', 'web', 'browser', 'desktop', 'canvas', 'notes', 'subagents', 'memory', 'skills']) sw(g).click();
    await guardar();
    if (tarjeta() !== 'Tools: Files, Screen') fail(`apagarle grupos a un agente desde su formulario dejó la tarjeta en «${tarjeta()}»`);
    await editar();
    if (!sw('files').checked || !sw('screen').checked || sw('commands').checked) fail('el formulario no recuerda las tools que quedaron prendidas');
    sw('files').click();
    sw('screen').click();
    await guardar();
    if (tarjeta() !== 'No tools') fail(`un agente sin tools no dice que no las tiene: «${tarjeta()}»`);
    await editar();
    sw('files').click();
    await guardar();
    data.toolsAlEditar = tarjeta();
    if (tarjeta() !== 'Tools: Files') fail(`volver a prenderle un grupo dejó la tarjeta en «${tarjeta()}»`);
  }

  data.tools = `Toolsmith: ${tools().length} filas en el último chat; permiso, rechazo, dos rondas, confianza por chat, código, base propia, un job, dos capturas, argumentos malos y modo automático`;

  // El agente de prueba se va, con sus chats, y vuelve a quedar Galen abierto
  // (la pasada 2 espera encontrar lo de antes).
  await go('agentes');
  cards().find((c) => shown(c.querySelector('.dm-tarjeta-nombre')) === 'Toolsmith').querySelector('[data-accion="eliminar"]').click();
  await frame();
  primary().click();
  await closed();
  await settle();
  if (cards().length !== 3) fail(`después de borrar al agente con tools quedan ${cards().length} tarjetas`);
  await go('chat');
  chatView.querySelector('[data-accion="agente"]').click();
  await frame();
  await pick('Galen on call');
  await until(() => msgs().length === 4, 2500);
}

// 12. About: el botón para buscar una actualización. Abierta desde el repo
// no hay updater, y lo dice; en la app instalada le pregunta a GitHub. Los
// demás estados (hay una versión, bajando, lista) se recorren dándole al
// módulo los eventos que mandaría el núcleo: no se publica nada para probar.
await go('ajustes');
{
  const act = await import('/actualizacion.js');
  const about = view('ajustes').querySelector('[data-tarjeta="acerca"]');
  const caja = about.querySelector('.dm-act');
  const boton = about.querySelector('[data-accion="actualizar"]');
  const rotulo = () => shown(boton.querySelector('.rad-swap'));
  const texto = () => shown(caja.querySelector('.dm-act-texto'));
  const ancho = () => r2(boton.getBoundingClientRect().width);
  const anillo = () => [...about.querySelectorAll(':scope > .rad-busy')].find((r) => !r.hasAttribute('data-rad-leaving') && r.dataset.state !== 'closing');
  about.scrollIntoView({ block: 'center' });
  await sleep(150);
  const anchos = [ancho()];
  if (caja.dataset.fase !== 'quieta' || rotulo() !== 'Check for updates' || boton.disabled) fail(`About arranca con el botón en «${rotulo()}» (fase ${caja.dataset.fase})`);

  boton.click();
  await frame();
  if (caja.dataset.fase !== 'buscando' || !boton.disabled || texto() === '') fail(`al tocar el botón no se puso a buscar: fase ${caja.dataset.fase}`);
  await frame();
  if (!anillo() || about.getAttribute('aria-busy') !== 'true') fail('mientras busca una actualización la tarjeta no muestra que trabaja (anillo de carga)');
  const t0 = performance.now();
  await until(() => caja.dataset.fase !== 'buscando', 15000);
  const tardo = performance.now() - t0;
  await settle();
  const fase = caja.dataset.fase;
  data.actualizacion = fase;
  if (fase === 'buscando') fail('la búsqueda de una actualización no terminó');
  if (tardo < 300) fail(`«buscando» duró ${Math.round(tardo)} ms: se ve como un parpadeo`);
  if (fase === 'sin-soporte' && !texto().includes('installed app')) fail(`sin updater, About dice «${texto()}»`);
  if (boton.disabled || (fase !== 'disponible' && rotulo() !== 'Check for updates')) fail(`después de buscar el botón quedó en «${rotulo()}» (deshabilitado: ${boton.disabled})`);
  anchos.push(ancho());
  data.actualizacionDice = texto();
  await sleep(dur('slow') + 260);
  if (about.querySelector(':scope > .rad-busy') || about.hasAttribute('aria-busy')) fail('el anillo de carga quedó en About después de buscar');

  // Hay una versión nueva: el botón pasa a bajar.
  act.recibir({ state: 'available', version: '9.9.9' });
  await settle();
  if (caja.dataset.fase !== 'disponible' || rotulo() !== 'Download' || boton.dataset.variant !== 'primary' || !texto().includes('9.9.9')) fail(`con una versión nueva About dice «${texto()}» y el botón «${rotulo()}»`);
  anchos.push(ancho());
  // Bajando: el porcentaje se escribe en su lugar, y la tarjeta trabaja.
  act.recibir({ state: 'downloading', percent: 41.6 });
  await settle();
  const pct = caja.querySelector('.dm-act-pct');
  if (caja.dataset.fase !== 'bajando' || !boton.disabled || pct.textContent !== '42%' || op(pct) !== 1) fail(`bajando, About muestra «${pct.textContent}» (opacidad ${r2(op(pct))}) con el botón ${boton.disabled ? 'apagado' : 'prendido'}`);
  if (!anillo()) fail('mientras baja la actualización la tarjeta no muestra que trabaja');
  const vivo = caja.querySelector('.dm-act-texto > :not(.rad-swap-out)');
  act.recibir({ state: 'downloading', percent: 77.2 });
  await frame();
  if (pct.textContent !== '77%' || caja.querySelector('.dm-act-texto > :not(.rad-swap-out)') !== vivo || caja.querySelectorAll('.dm-act-texto > *').length !== 1) fail('cada avance de la descarga releva el texto en vez de cambiar solo el número');
  anchos.push(ancho());
  // Lista: el botón pasa a reiniciar. (No se toca: instalaría de verdad.)
  act.recibir({ state: 'ready', version: '9.9.9' });
  await settle();
  if (caja.dataset.fase !== 'lista' || rotulo() !== 'Restart and install' || boton.disabled || op(pct) !== 0) fail(`con la versión bajada el botón dice «${rotulo()}»`);
  anchos.push(ancho());
  if (new Set(anchos).size !== 1) fail(`el botón de About cambia de ancho con el rótulo: ${anchos.join(' → ')}`);
  const b = boton.getBoundingClientRect();
  const etiqueta = boton.querySelector('.rad-swap > :not(.rad-swap-out)').getBoundingClientRect();
  if (etiqueta.left < b.left || etiqueta.right > b.right) fail('el rótulo más largo del botón de About no entra en el botón');
  enIngles('en About');
  data.botonAbout = `${anchos[0]} px en los cinco estados`;
}

// Para la captura y para la pasada 2: de vuelta en el chat.
await go('chat');
window.rad.store.write('smoke', { pass: 1, chat: chatId, chatVenice, frenado: data.frenado });
// Lo último: un guardado que todavía está en el debounce cuando la app cierra.
window.rad.store.write('ultimo', { ok: true });

return { failures, data };
