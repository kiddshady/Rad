// Guion del humo de Nix. Corre adentro de la página (con await), contra el
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

const LLAVE = 'sk-ant-api03-humo-de-nix-no-es-una-llave-0000';
const INSTRUCCIONES = 'Answer like a pharmacist on call: short and clear.';
const LLAVE_VENICE = 'venice-humo-de-nix-no-es-una-llave-1111';
const PREGUNTA = 'Hi, what should I take for a headache?';
const MODELO_LARGO = 'DeepSeek V4.1 Flash 1017 Uncensored';

if (window.rad.skin.id !== 'mono') fail(`Nix abrió con la piel ${window.rad.skin.id}, no con mono`);

// ---------- Segunda pasada: lo de la primera sigue ahí ----------
const marker = await window.rad.store.read('smoke');
if (marker?.pass === 1) {
  const agentes = (await window.rad.store.read('agentes'))?.lista ?? [];
  if (agentes.map((a) => a.nombre).join() !== 'Nix,Galen on call,Oracle') fail(`los agentes guardados son: ${agentes.map((a) => a.nombre).join()}`);
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
  if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'Nix') fail('después de borrar el agente abierto no quedó elegido el otro');
  data.persistencia = `3 agentes (uno de Venice), el chat con 4 mensajes (la frenada con ${marker.frenado} caracteres), llaves: Anthropic ${llave.anthropic?.estado}, Venice ${llave.venice?.estado}`;
  window.rad.store.write('smoke', { pass: 2 });
  return { failures, data };
}

// ---------- Primera pasada ----------

// 0. Arranque: un agente para empezar, la vista de chat, sin chats, y sin el
// aviso de la llave (el proveedor es el simulado).
if (!document.querySelector('.rad-root').classList.contains('is-settled')) fail('la raíz no quedó asentada');
if (shown(chatView.querySelector('.dm-agente-nombre')) !== 'Nix') fail(`el agente inicial es «${shown(chatView.querySelector('.dm-agente-nombre'))}»`);
if (rows().length) fail('arrancó con chats');
if (chatView.querySelector('.dm-aviso').hasAttribute('data-abierto')) fail('con el proveedor simulado aparece el aviso de la llave');
if (!send.disabled) fail('el botón de enviar está habilitado con el campo vacío');

// 0b. La interfaz está en inglés: lo de Nix y lo que pone el núcleo (los
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
if (window.rad.lang !== 'en' || document.documentElement.lang !== 'en') fail(`Nix no arrancó en inglés: rad.lang "${window.rad.lang}", html lang "${document.documentElement.lang}"`);
const ventana = [...document.querySelectorAll('.rad-winbtn')].map((b) => b.getAttribute('aria-label')).join(', ');
if (ventana !== 'Minimize, Maximize, Close') fail(`los botones de la ventana dicen: ${ventana}`);
const riel = [...document.querySelectorAll('.rad-tab')].map((b) => b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('data-rad-tip')).join(', ');
if (riel !== 'Chat, Agents, Settings') fail(`las vistas se llaman: ${riel}`);
enIngles('al arrancar');
// Las vistas van como pestañas en la titlebar, sin rail y sin el nombre de
// la app: lo primero de la barra son las pestañas, alineadas con la hoja, y
// el escenario ocupa todo el ancho.
{
  const tabs = [...document.querySelectorAll('.rad-titlebar > .rad-tabs > .rad-tab')];
  const stage = document.querySelector('.rad-stage').getBoundingClientRect();
  if (document.querySelector('.rad-rail') || tabs.length !== 3) fail(`las vistas no están en la titlebar (${tabs.length} pestañas, rail: ${Boolean(document.querySelector('.rad-rail'))})`);
  if (document.querySelector('.rad-titlebar-title') || /Nix/.test(document.querySelector('.rad-titlebar').textContent)) fail('la titlebar sigue mostrando el nombre de la app');
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
  if (!/^'?"?Roboto Mono/.test(pila)) fail(`la fuente mono de Nix es ${pila}`);
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
    if (!has('.dm-codigo code')?.textContent.includes("console.log(greet('Nix'));")) fail('el bloque de código no llegó entero');
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
// Nix le pregunta a la API (acá a la simulada, que contesta según el texto
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
// acepta. Sirve, y Nix no puede decir otra cosa.
await guardarLlave('sk-ant-usr01-humo-de-nix-no-es-una-llave-0000');
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
  if (interruptores.map((i) => i.dataset.grupo).join() !== 'files,commands,web' || interruptores.some((i) => i.checked)) fail(`el formulario ofrece las tools: ${interruptores.map((i) => `${i.dataset.grupo}=${i.checked}`).join(', ')}`);
  for (const i of interruptores.slice(0, 2)) i.click(); // archivos y comandos; la web queda apagada
  enIngles('en el formulario con tools');
  primary().click();
  await closed();
  await settle();
  const herrero = cards().at(-1);
  if (shown(herrero.querySelector('.dm-tarjeta-tools')) !== 'Tools: Files, Commands') fail(`la tarjeta del agente dice «${shown(herrero.querySelector('.dm-tarjeta-tools'))}»`);
  if (shown(cards()[0].querySelector('.dm-tarjeta-tools')) !== 'No tools') fail('un agente sin tools no dice que no las tiene');
  herrero.querySelector('[data-accion="abrir"]').click();
  await sleep(dur('base') + 260);

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
      { name: 'shell_exec', args: { command: 'Write-Output nix-smoke' } },
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
  if (!fila('shell_exec')?.querySelector('.dm-tool-pre').textContent.includes('nix-smoke')) fail('shell_exec no devolvió la salida del comando');
  // Nada de la tira se sale de la columna.
  const col = thread().querySelector('.dm-col').getBoundingClientRect();
  const afuera = tools().find((t) => t.getBoundingClientRect().right > col.right + 0.5);
  if (afuera) fail(`la fila de ${afuera.dataset.tool} se sale de la columna`);

  // Argumentos incompletos, y una tool que este agente no tiene: ninguna
  // corre, las dos dejan su fila como fallida, y no hay tarjeta que contestar.
  await pedir([[{ name: 'fs_write', args: { path: 'x.txt' } }, { name: 'fetch', args: { url: 'https://example.com' } }]]);
  await terminado(13);
  if (fila('fs_write')?.dataset.estado !== 'error' || fila('fetch')?.dataset.estado !== 'error' || cuenta() !== '2 tools · 2 failed') fail(`argumentos incompletos y una tool apagada: ${fila('fs_write')?.dataset.estado}, ${fila('fetch')?.dataset.estado}, «${cuenta()}»`);
  if (!fila('fetch').querySelector('.dm-tool-pre').textContent.includes('not available in this run')) fail('una tool que el agente no tiene prendida no fue rechazada por eso');

  // Sin el renglón TOOLS el agente conversa, y el contador lo dice igual.
  type(area, 'Just say hi.');
  key(area, 'Enter');
  await terminado(15);
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
  data.tools = `Toolsmith: ${tools().length} filas en el último chat; permiso, rechazo, dos rondas, confianza por chat, argumentos malos y modo automático`;

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
