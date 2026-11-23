// Guion del humo de la vitrina. Corre adentro de la página (con await) y mide
// el shell y el router cuadro por cuadro. Devuelve { failures, data }.

const failures = [];
const data = {};
const fail = (msg) => failures.push(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Un cuadro, con tope: si la ventana deja de pintar, el guion no se cuelga.
const frame = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });
const view = (id) => document.querySelector(`.rad-view[data-view="${id}"]`);
const item = (id) => document.querySelector(`.rad-rail-item[data-view="${id}"]`);
const op = (el) => parseFloat(getComputedStyle(el).opacity);
const z = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
const visible = () => [...document.querySelectorAll('.rad-view')].filter((v) => v.dataset.state !== 'hidden').map((v) => v.dataset.view);
const r2 = (n) => Math.round(n * 100) / 100;
// Las duraciones son de la piel: lo que tenga que esperar a que algo termine
// espera lo que diga ella, no un número pensado para classic.
const dur = (name) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--rad-dur-${name}`).trim();
  return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
};

const root = document.querySelector('.rad-root');
const NOTA = 'Escrita en la pasada 1 del humo.';

// Segunda pasada (tools/smoke.mjs abre la vitrina otra vez sobre los mismos
// datos): lo de la primera tiene que seguir ahí.
const marker = await window.rad.store.read('smoke');
if (marker?.pass === 1) {
  const visitas = await window.rad.store.read('visitas');
  if (visitas?.veces !== 2) fail(`las visitas dicen ${visitas?.veces}, se esperaba 2`);
  const nota = await window.rad.store.read('nota');
  if (nota?.texto !== NOTA) fail(`la nota guardada dice "${nota?.texto}"`);
  item('datos').click();
  await sleep(400);
  const area = view('datos').querySelector('#sc-nota');
  if (area.value !== NOTA) fail(`el campo de la nota muestra "${area.value}"`);
  if (!/2 veces/.test(view('datos').querySelector('[data-demo="visitas"]').textContent)) fail('la vista no muestra las 2 visitas');
  // Lo último de la pasada 1 se escribió justo antes de cerrar, dentro del
  // debounce: solo llega si el cierre normal bajó lo pendiente.
  const last = await window.rad.store.read('ultimo');
  if (last?.ok !== true) fail('lo que se guardó justo antes de cerrar se perdió (before-quit no bajó lo pendiente)');
  // Esta pasada corre con fonts: { mono: 'roboto-mono' }: la elegida va
  // adelante y la de la piel queda de reserva.
  const mono2 = getComputedStyle(document.documentElement).getPropertyValue('--rad-font-mono').trim();
  if (!mono2.startsWith("'Roboto Mono', 'Cascadia Mono'")) fail(`con la mono elegida, --rad-font-mono es: ${mono2}`);
  const code2 = document.querySelector('.rad-titlebar-sub');
  if (!getComputedStyle(code2).fontFamily.startsWith('"Roboto Mono"')) fail(`la titlebar no usa la mono elegida: ${getComputedStyle(code2).fontFamily}`);
  if (![...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Roboto Mono' && f.status === 'loaded')) fail('la mono elegida no estaba cargada al entrar');
  data.monoElegida = mono2;
  // Esta pasada arranca sin RAD_SKIN: la piel es la que se eligió en la 1.
  data.piel = window.rad.skin.id;
  window.rad.store.write('smoke', { pass: 2 });
  // Para la captura de esta pasada: las dos fuentes mono, lado a lado.
  item('texto').click();
  await sleep(350);
  view('texto').querySelector('.sc-monos').scrollIntoView({ block: 'center' });
  await sleep(400);
  data.persistencia = `visitas ${visitas?.veces}, nota "${nota?.texto}", último guardado ${last?.ok ? 'llegó' : 'perdido'}`;
  return { failures, data };
}

// Sin elección de la app, la mono es la de la piel (classic: Cascadia).
const mono1 = getComputedStyle(document.documentElement).getPropertyValue('--rad-font-mono').trim();
if (!mono1.startsWith("'Cascadia Mono'")) fail(`sin elección, --rad-font-mono es: ${mono1}`);

// 0. Arranque: la raíz entró y se apagó su animación; una sola vista visible.
if (!root.classList.contains('is-settled')) fail('la raíz no quedó asentada (falta is-settled)');
if (getComputedStyle(root).animationName !== 'none') fail(`la raíz sigue con animación: ${getComputedStyle(root).animationName}`);
if (visible().join() !== 'planos') fail(`al arrancar se ven: ${visible().join()}`);
// Una vista tiene que tapar: el fundido deja a la que se va encima de la
// nueva, y si su fondo es translúcido (una piel de vidrio que pintó el
// escenario con un velo suelto) se ven los dos contenidos encimados.
const viewBg = getComputedStyle(view('planos')).backgroundColor;
const viewAlpha = viewBg.startsWith('rgba') ? parseFloat(viewBg.split(',')[3]) : viewBg === 'transparent' ? 0 : 1;
if (viewAlpha < 1) fail(`la vista no tapa (fondo ${viewBg}): el fundido entre vistas dejaría ver dos contenidos a la vez`);

// 0b. Los botones de ventana: el botón entero llega al canto (la esquina de
// arriba a la derecha sigue siendo cerrar) y lo que se pinta es una pastilla
// más chica adentro, separada de los bordes.
{
  const close = document.querySelector('.rad-winbtn-close');
  const box = close.getBoundingClientRect();
  const plate = getComputedStyle(close, '::before');
  const plateH = parseFloat(plate.height);
  const air = parseFloat(plate.right);
  const top = parseFloat(plate.top);
  if (Math.abs(window.innerWidth - box.right) > 0.5 || box.top > 0.5) fail(`el botón de cerrar no llega a la esquina: termina en ${r2(box.right)} de ${window.innerWidth}, arriba ${r2(box.top)}`);
  if (document.elementFromPoint(window.innerWidth - 1, 1)?.closest('.rad-winbtn') !== close) fail('la esquina de arriba a la derecha no es el botón de cerrar');
  if (!(plateH > 12 && plateH < box.height - 4)) fail(`la pastilla del botón de ventana mide ${plateH} de alto y el botón ${box.height}: tiene que ser más chica`);
  if (!(air >= 3 && top >= 3)) fail(`la pastilla del botón de ventana no tiene aire: ${air} al costado, ${top} arriba`);
  if (Math.abs(top * 2 + plateH - box.height) > 1) fail(`la pastilla del botón de ventana no está centrada: ${top} arriba, alto ${plateH}, botón ${box.height}`);
  if (parseFloat(plate.borderTopLeftRadius) > 0 && getComputedStyle(close).backgroundColor !== 'rgba(0, 0, 0, 0)') fail('el botón de ventana entero tiene fondo: lo que se pinta es la pastilla');
  data.botonesDeVentana = `botón ${Math.round(box.width)}x${Math.round(box.height)}, pastilla ${Math.round(parseFloat(plate.width))}x${Math.round(plateH)} con ${air} px de aire`;
}

// 1. Fundido planos -> texto, muestreado cuadro por cuadro.
item('texto').click();
const fade = [];
for (const t0 = performance.now(); performance.now() - t0 < 420;) {
  await frame();
  const n = view('texto');
  const o = view('planos');
  fade.push({ nueva: op(n), vieja: op(o), estado: o.dataset.state, encima: z(o) > z(n) });
}
if (fade.some((s) => s.nueva !== 1)) fail('la vista nueva no estuvo entera desde el primer cuadro');
if (fade.some((s) => s.estado === 'leaving' && !s.encima)) fail('la vista que se va no quedó encima de la nueva');
// Solo mientras se va: ya oculta, su opacidad vuelve a 1 sin verse.
const leaving = fade.filter((s) => s.estado === 'leaving');
for (let i = 1; i < leaving.length; i++) {
  if (leaving[i].vieja > leaving[i - 1].vieja + 0.001) { fail('la opacidad de la vieja subió durante el fundido'); break; }
}
if (leaving.length < 3) fail(`el fundido duró ${leaving.length} cuadros: casi no se vio`);
if (fade.some((s) => s.estado === 'hidden' && s.vieja === 1 && fade.indexOf(s) > 0 && fade[fade.indexOf(s) - 1].estado === 'leaving' && fade[fade.indexOf(s) - 1].vieja > 0.15)) {
  fail('la vieja se ocultó de golpe sin haber llegado casi a 0');
}
if (fade.at(-1).estado !== 'hidden') fail(`la vieja terminó en estado ${fade.at(-1).estado}, no hidden`);
data.fundido = fade.filter((s) => s.estado === 'leaving').map((s) => r2(s.vieja)).join(' → ');

// 2. Ida y vuelta rápida: texto -> acento y, a los 60 ms, de vuelta a texto.
item('acento').click();
await sleep(60);
const before = op(view('texto'));
item('texto').click();
const back = [];
for (const t0 = performance.now(); performance.now() - t0 < 360;) {
  await frame();
  back.push(op(view('texto')));
}
for (let i = 1; i < back.length; i++) {
  if (back[i] < back[i - 1] - 0.001) { fail('la vista que vuelve bajó en vez de subir'); break; }
}
if (back[0] < before - 0.05) fail(`la vista que vuelve saltó de ${r2(before)} a ${r2(back[0])}`);
await sleep(80);
if (visible().join() !== 'texto') fail(`después de volver se ven: ${visible().join()}`);
data.vuelta = `desde ${r2(before)}: ${back.filter((_, i) => i % 3 === 0).map(r2).join(' → ')}`;

// 3. Dos cambios seguidos: la segunda que se va queda DEBAJO de la primera.
item('forma').click();
await sleep(40);
item('movimiento').click();
await frame();
const zt = z(view('texto'));
const zf = z(view('forma'));
const zm = z(view('movimiento'));
if (!(zt > zf && zf > zm)) fail(`el apilado de los que se van está mal: texto ${zt}, forma ${zf}, movimiento ${zm}`);
await sleep(400);
if (visible().join() !== 'movimiento') fail(`después de la cadena se ven: ${visible().join()}`);

// 4. La statusbar y el indicador del rail se pusieron al día.
await sleep(300);
const live = document.querySelector('.rad-status-left > :not(.rad-swap-out)');
if (live?.textContent !== 'Movimiento') fail(`la statusbar dice "${live?.textContent}", no "Movimiento"`);
if (document.querySelectorAll('.rad-status-left > *').length !== 1) fail('quedaron restos de relevos viejos en la statusbar');
const ind = document.querySelector('.rad-rail-indicator');
const ty = new DOMMatrix(getComputedStyle(ind).transform).m42;
if (Math.abs(ty - item('movimiento').offsetTop) > 0.5) fail(`el indicador quedó en ${ty}, el item está en ${item('movimiento').offsetTop}`);

// 4b. El relevo del mensaje de la statusbar (lado derecho), cuadro por
// cuadro: lo viejo termina de irse antes de que asome lo nuevo (nunca las dos
// frases encimadas), y lo nuevo no salta de costado cuando lo viejo sale del
// DOM (el lado derecho está alineado a la derecha).
const right = document.querySelector('.rad-status-right');
const statusBtn = view('movimiento').querySelector('[data-demo="status"]');
const relay = async () => {
  statusBtn.click();
  const frames = [];
  for (const t0 = performance.now(); performance.now() - t0 < 520;) {
    await frame();
    const kids = [...right.children];
    const out = kids.find((k) => k.classList.contains('rad-swap-out'));
    const live = kids.find((k) => !k.classList.contains('rad-swap-out'));
    // El borde del TEXTO (un Range), no de la caja: la caja del ítem se
    // estira al ancho de la celda y no muestra dónde quedó pintada la frase.
    let edge = 0;
    if (live) { const r = document.createRange(); r.selectNodeContents(live); edge = r.getBoundingClientRect().right; }
    frames.push({ out: out ? op(out) : 0, live: live ? op(live) : 0, edge });
  }
  return frames;
};
for (let round = 1; round <= 2; round++) {
  const frames = await relay();
  const both = Math.max(...frames.map((f) => Math.min(f.out, f.live)));
  if (both > 0.08) fail(`relevo ${round} de la statusbar: lo viejo y lo nuevo se ven a la vez (los dos por encima de ${r2(both)})`);
  const shown = frames.filter((f) => f.live > 0.02);
  const jump = Math.max(0, ...shown.slice(1).map((f, i) => Math.abs(f.edge - shown[i].edge)));
  if (jump > 0.5) fail(`relevo ${round} de la statusbar: el texto nuevo saltó ${r2(jump)} px de costado`);
  if (round === 1) data.statusbar = frames.filter((_, i) => i % 2 === 0).map((f) => `${r2(f.out)}/${r2(f.live)}@${Math.round(f.edge)}`).join(' ');
  await sleep(200);
}

// 4c. El anillo de carga: entra fundiéndose, la luz avanza a la velocidad de
// su vuelta, todos los trazos comparten la cabeza, dos anillos van en fase,
// uno que vuelve a prenderse releva al que se iba sin salto, y al apagarse
// no queda nada.
{
  const { setBusy, isBusy } = await import('/@core/busy.js');
  const mov = view('movimiento');
  const card = mov.querySelector('[data-demo="busy-card"]');
  const bar = mov.querySelector('[data-demo="ask"]');
  const rings = (el) => [...el.querySelectorAll(':scope > .rad-busy')];
  const alive = (el) => rings(el).find((r) => !r.hasAttribute('data-rad-leaving') && r.dataset.state !== 'closing');
  const lineRects = (ring) => [...ring.querySelectorAll('.rad-busy-line rect')];
  const mod1 = (n) => ((n % 1) + 1) % 1;
  // Dónde va la cabeza de un trazo, en vueltas (0..1): su largo menos su corrimiento.
  const posOf = (rect) => {
    const cs = getComputedStyle(rect);
    return mod1(parseFloat(cs.getPropertyValue('--rad-a-len')) - parseFloat(cs.strokeDashoffset.replace('calc(', '')));
  };
  const pos = (ring) => posOf(lineRects(ring).at(-1));
  const near = (a, b, tol) => Math.min(mod1(a - b), mod1(b - a)) <= tol;

  setBusy(card, true);
  await frame();
  const ring = alive(card);
  if (!ring) fail('el anillo de carga no apareció');
  else {
    if (card.getAttribute('aria-busy') !== 'true' || !isBusy(card)) fail('lo que carga no quedó marcado (aria-busy / isBusy)');
    if (op(ring) > 0.9) fail(`el anillo apareció de golpe (opacidad ${r2(op(ring))} en el primer cuadro)`);
    const lap = parseFloat(getComputedStyle(lineRects(ring)[0]).animationDuration) * 1000;
    const heads = lineRects(ring).map(posOf);
    if (heads.some((h) => !near(h, heads[0], 0.004))) fail(`los trazos del anillo no comparten la cabeza: ${heads.map(r2).join(', ')}`);
    const t0 = performance.now();
    const p0 = pos(ring);
    await sleep(240);
    const moved = mod1(pos(ring) - p0);
    const expected = (performance.now() - t0) / lap;
    if (!(moved > 0.01)) fail(`la luz del anillo no avanza (se movió ${r2(moved)} de vuelta en 240 ms)`);
    else if (Math.abs(moved - expected) > 0.02) fail(`la luz avanzó ${r2(moved)} de vuelta, por su vuelta de ${Math.round(lap)} ms tocaba ${r2(expected)}`);

    // Otro elemento que empieza a cargar más tarde gira con el primero.
    setBusy(bar, true);
    await frame();
    const second = alive(bar);
    if (!second) fail('el segundo anillo no apareció');
    else {
      if (!near(pos(second), pos(ring), 0.012)) fail(`dos anillos no van en fase: ${r2(pos(ring))} y ${r2(pos(second))}`);
      // Una píldora no puede salir elipse: el redondeo tiene tope en medio alto.
      const rx = parseFloat(getComputedStyle(lineRects(second)[0]).rx);
      if (!(rx > 4 && rx <= bar.offsetHeight / 2 + 0.5)) fail(`el contorno de la barra redondeada tiene rx ${rx}, y la barra mide ${bar.offsetHeight} de alto`);
    }

    await sleep(dur('slow') + 80);
    if (!ring.classList.contains('is-settled') || op(ring) !== 1) fail('el anillo no terminó de entrar');

    // Se apaga y, antes de que termine de irse, vuelve a prenderse.
    setBusy(card, false);
    await frame();
    if (!ring.isConnected) fail('el anillo se fue de golpe (salió del DOM sin fundirse)');
    if (card.hasAttribute('aria-busy')) fail('quedó aria-busy después de apagar');
    setBusy(card, true);
    await frame();
    const again = alive(card);
    if (!again || again === ring) fail('volver a prender no trajo un anillo nuevo');
    else if (ring.isConnected && !near(pos(again), pos(ring), 0.012)) fail(`el anillo que releva no va en fase con el que se va: ${r2(pos(ring))} y ${r2(pos(again))}`);
    await sleep(dur('slow') + 200);
    if (rings(card).length !== 1) fail(`después del relevo quedaron ${rings(card).length} anillos`);
    data.anillo = `vuelta ${Math.round(lap)} ms, avanzó ${r2(moved)} (tocaba ${r2(expected)}), cabeza en ${r2(heads[0])}`;
  }
  setBusy(card, false);
  setBusy(bar, false);
  await sleep(dur('slow') + 200);
  if (mov.querySelector('.rad-busy')) fail('quedó un anillo de carga en el DOM después de apagar');
  if (card.classList.contains('rad-busy-host') || bar.classList.contains('rad-busy-host')) fail('quedó la clase rad-busy-host después de apagar');
}

// 5. Cada vista conserva su scroll.
item('texto').click();
await sleep(300);
view('texto').scrollTop = 160;
const kept = view('texto').scrollTop;
item('planos').click();
await sleep(300);
item('texto').click();
await sleep(300);
if (kept > 0 && view('texto').scrollTop !== kept) fail(`el scroll de texto volvió en ${view('texto').scrollTop}, se había dejado en ${kept}`);
data.scroll = `dejado en ${kept}, vuelto en ${view('texto').scrollTop}`;

// Roboto Mono viaja con Rad: tiene que estar cargada de verdad, no caer a
// la fuente de reserva.
await document.fonts.ready;
const roboto = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Roboto Mono');
if (!roboto.some((f) => f.status === 'loaded')) fail(`Roboto Mono no cargó: ${roboto.map((f) => f.status).join(', ') || 'no está declarada'}`);
const sample = view('texto').querySelector('.sc-mono-roboto');
const w = (family) => { const c = document.createElement('canvas').getContext('2d'); c.font = `13px ${family}`; return c.measureText('0O1lI{}=>').width; };
if (Math.abs(w("'Roboto Mono'") - w('monospace')) < 0.5) fail('Roboto Mono mide igual que la mono de reserva: no se está usando');
data.robotoMono = `${roboto.filter((f) => f.status === 'loaded').length} caras cargadas, muestra en ${getComputedStyle(sample).fontFamily}`;

// ---------- Capas ----------
item('capas').click();
await sleep(350);
const capas = view('capas');
const overlays = () => document.querySelector('.rad-overlays');
const openMenus = () => [...document.querySelectorAll('.rad-overlays .rad-menu')].filter((m) => m.dataset.state === 'open' && !m.hasAttribute('data-rad-leaving'));
const activeLabel = (m) => m.querySelector('.rad-menu-item.is-active .rad-menu-label')?.textContent;
const keyOn = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

// 6. Menú con el teclado: abre con el primero activo, salta el deshabilitado,
// da la vuelta, y Escape lo cierra devolviendo el foco.
const menuBtn = capas.querySelector('[data-demo="menu"]');
menuBtn.focus();
menuBtn.click(); // detail 0, como Enter
await frame();
let menu = openMenus()[0];
if (!menu) fail('el menú no abrió');
else {
  if (menuBtn.getAttribute('aria-expanded') !== 'true') fail('el botón no dice aria-expanded=true');
  if (document.activeElement !== menu) fail('el foco no quedó en el menú');
  const path = [activeLabel(menu)];
  for (let i = 0; i < 3; i++) { keyOn(menu, 'ArrowDown'); path.push(activeLabel(menu)); }
  if (path.join(' > ') !== 'Duplicar > Renombrar > Eliminar > Duplicar') fail(`el recorrido del menú fue: ${path.join(' > ')}`);
  data.menu = path.join(' > ');
  await sleep(250);
  keyOn(menu, 'Escape');
  const out = [];
  for (const t0 = performance.now(); performance.now() - t0 < 140;) { await frame(); out.push(op(menu)); }
  for (let i = 1; i < out.length; i++) if (out[i] > out[i - 1] + 0.001) { fail('la salida del menú subió de opacidad'); break; }
  await sleep(250);
  if (menu.isConnected) fail('el menú quedó en el DOM después de salir');
  if (document.activeElement !== menuBtn) fail('el foco no volvió al botón del menú');
  if (menuBtn.getAttribute('aria-expanded') !== 'false') fail('el botón quedó con aria-expanded=true');
}

// 7. La trampa del ancla: el pointerdown sobre el botón cierra, y el click
// que sigue no lo vuelve a abrir.
menuBtn.click();
await sleep(250);
menuBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
menuBtn.click();
await sleep(300);
if (openMenus().length) fail('el click sobre el ancla volvió a abrir el menú');

// 8. Cerrar a mitad de la entrada: da vuelta la entrada desde donde iba.
menuBtn.click();
await frame();
menu = openMenus()[0];
await frame();
const mid = op(menu);
keyOn(menu, 'Escape');
const rev = [];
for (const t0 = performance.now(); performance.now() - t0 < 160;) { await frame(); if (menu.isConnected) rev.push(op(menu)); }
if (rev.some((o) => o > mid + 0.02)) fail(`al cerrar a mitad de la entrada la opacidad saltó de ${r2(mid)} a ${r2(Math.max(...rev))}`);
await sleep(250);
if (menu.isConnected) fail('el menú cerrado a mitad de la entrada quedó en el DOM');
data.menuReverso = `desde ${r2(mid)}: ${rev.map(r2).join(' → ')}`;

// 9. Modal: inerte atrás, foco adentro, el Tab da la vuelta, Escape cierra y
// el foco vuelve.
const modalBtn = capas.querySelector('[data-demo="modal"]');
modalBtn.focus();
modalBtn.click();
await frame();
const modal = document.querySelector('.rad-overlays .rad-modal');
if (!modal) fail('el modal no abrió');
else {
  if (!root.inert) fail('la app de atrás no quedó inert con el modal abierto');
  const btns = [...modal.querySelectorAll('.rad-button')];
  if (document.activeElement !== btns.at(-1)) fail('el foco no fue a la acción primaria del modal');
  keyOn(document.activeElement, 'Tab');
  if (document.activeElement !== btns[0]) fail('el Tab no dio la vuelta dentro del modal');
  keyOn(document.activeElement, 'Tab', { shiftKey: true });
  if (document.activeElement !== btns.at(-1)) fail('el Shift+Tab no dio la vuelta dentro del modal');
  await sleep(dur('slow') + 90);
  keyOn(document.activeElement, 'Escape');
  // Ya entró del todo: sale con su salida propia (se achica), no con el
  // atajo de "venía entrando".
  await frame();
  if (modal.dataset.state !== 'closing') fail(`el modal no salió con su salida propia (estado ${modal.dataset.state}${modal.hasAttribute('data-rad-leaving') ? ', atajo de entrada' : ''})`);
  await sleep(400);
  if (document.querySelector('.rad-modal-layer')) fail('el modal quedó en el DOM después de cerrar');
  if (root.inert) fail('la app quedó inert después de cerrar el modal');
  if (document.activeElement !== modalBtn) fail('el foco no volvió al botón que abrió el modal');
}

// 10. Toasts: se apilan, uno del medio se va y los demás se acomodan; nunca
// más de cuatro.
const alive = () => [...document.querySelectorAll('.rad-toast')].filter((t) => !t.hasAttribute('data-rad-leaving') && t.dataset.state !== 'closing');
alive().forEach((t) => t._radClose?.());
await sleep(450);
for (const kind of ['info', 'success', 'warning']) {
  capas.querySelector(`[data-demo="toast"][data-kind="${kind}"]`).click();
  await sleep(60);
}
await sleep(450);
const three = alive();
if (three.length !== 3) fail(`había ${three.length} toasts, se esperaban 3`);
else {
  const top0 = three[0].getBoundingClientRect().top;
  const goneBefore = three[1].getBoundingClientRect().top;
  three[1].querySelector('.rad-toast-close').click();
  // Mismo cuadro y el siguiente: el que se va no puede moverse en vertical
  // (sale de costado). Si salta, la pila se achicó y se lo llevó.
  const goneNow = three[1].getBoundingClientRect().top;
  await frame();
  const goneNext = three[1].getBoundingClientRect().top;
  if (Math.abs(goneNow - goneBefore) > 1 || Math.abs(goneNext - goneBefore) > 1) {
    fail(`el toast que se va saltó en vertical: ${Math.round(goneBefore)} → ${Math.round(goneNow)} → ${Math.round(goneNext)}`);
  }
  if (getComputedStyle(three[1]).position !== 'absolute') fail('el toast que se va no salió del flujo');
  await sleep(450);
  if (three[1].isConnected) fail('el toast cerrado quedó en el DOM');
  const top1 = three[0].getBoundingClientRect().top;
  if (!(top1 > top0)) fail('el toast de arriba no bajó a ocupar el lugar');
  data.toasts = `el de arriba bajó ${Math.round(top1 - top0)} px`;
}
// El último que queda: al irse, la pila queda vacía y no se lo puede llevar.
alive().forEach((t) => t._radClose?.());
await sleep(450);
capas.querySelector('[data-demo="toast"][data-kind="info"]').click();
await sleep(450);
const solo = alive()[0];
const soloBefore = solo.getBoundingClientRect().top;
solo._radClose();
await frame();
const soloNext = solo.getBoundingClientRect().top;
if (Math.abs(soloNext - soloBefore) > 1) fail(`el último toast saltó en vertical al irse: ${Math.round(soloBefore)} → ${Math.round(soloNext)}`);
await sleep(450);

capas.querySelector('[data-demo="burst"]').click();
await sleep(1400);
if (alive().length > 4) fail(`quedaron ${alive().length} toasts, el tope es 4`);
alive().forEach((t) => t._radClose?.());
await sleep(450);
if (document.querySelector('.rad-toast')) fail('quedaron toasts en el DOM');

// 11. Tooltip: espera la primera vez, sale enseguida la siguiente.
const tips = capas.querySelectorAll('.rad-iconbutton');
const tipEl = () => [...document.querySelectorAll('.rad-tooltip')].find((t) => t.dataset.state === 'open' && !t.hasAttribute('data-rad-leaving'));
tips[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
await sleep(200);
if (tipEl()) fail('el tooltip apareció sin esperar');
await sleep(450);
const tip = tipEl();
if (!tip) fail('el tooltip no apareció');
else if (tip.textContent !== 'GuardarCtrl+S') fail(`el tooltip dice "${tip.textContent}"`);
tips[0].dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: tips[1] }));
tips[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
await frame();
if (tipEl()?.textContent !== 'BuscarCtrl+F') fail('el segundo tooltip no salió enseguida');
tips[1].dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
await sleep(300);
if (document.querySelector('.rad-tooltip')) fail('el tooltip quedó en el DOM');

// 11b. Recorrer rápido (Fran con Tab, nov 2026): cada tooltip se cierra
// cuando todavía está entrando. Ninguno puede quedar pegado.
const tipsNow = () => [...document.querySelectorAll('.rad-tooltip')];
tips[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
await sleep(650); // el primero, con su espera
for (const gap of [0, 16, 40, 80, 120, 200]) {
  for (const t of [tips[1], tips[2], tips[0]]) {
    t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); // sale enseguida (tibio)
    if (gap) await sleep(gap); else await frame();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); // la tecla lo cierra
  }
}
await sleep(900);
const stuck = tipsNow();
if (stuck.length) fail(`quedaron ${stuck.length} tooltips pegados: ${stuck.map((t) => `"${t.textContent}" (${t.dataset.state}${t.classList.contains('is-settled') ? ', asentado' : ''}${t.hasAttribute('data-rad-leaving') ? ', saliendo' : ''}, opacidad ${r2(op(t))})`).join('; ')}`);
stuck.forEach((t) => t.remove());
if ([...overlays().children].some((c) => c.matches('.rad-menu, .rad-modal-layer, .rad-tooltip'))) fail('quedaron capas abiertas al terminar');

// ---------- Datos ----------
// 12. El puente contesta, la nota se guarda y los nombres del núcleo están
// cerrados para el renderer.
item('datos').click();
await sleep(400);
const datos = view('datos');
const facts = datos.querySelectorAll('[data-demo="info"] dd');
if (facts.length !== 5) fail(`el puente no contestó: ${facts.length} datos`);
else data.puente = [...facts].slice(0, 4).map((d) => d.textContent).join(' · ');
const area = datos.querySelector('#sc-nota');
area.value = NOTA;
area.dispatchEvent(new Event('input', { bubbles: true }));
let reserved = false;
try { await window.rad.store.read('_window'); } catch { reserved = true; }
if (!reserved) fail('el renderer pudo leer un documento reservado del núcleo');
let badChannel = false;
try { await window.rad.invoke('../rad:window', 'close'); } catch { badChannel = true; }
if (!badChannel) fail('el puente aceptó un canal inválido');
window.rad.store.write('smoke', { pass: 1 });

// ---------- Pieles ----------
// 12b. El selector lista las pieles, marca una sola como activa (la que
// dice el puente) y guarda la elegida. En el humo no reabre: la pasada 2
// arranca sin RAD_SKIN y tiene que salir con esta misma.
item('pieles').click();
await sleep(500);
const cards = [...view('pieles').querySelectorAll('.sc-skin')];
const activeCards = cards.filter((c) => c.hasAttribute('data-active'));
if (cards.length < 2) fail(`el selector muestra ${cards.length} pieles, se esperaban al menos 2`);
if (activeCards.length !== 1 || activeCards[0].dataset.skin !== window.rad.skin.id) fail(`la piel activa del selector es "${activeCards.map((c) => c.dataset.skin).join()}", el puente dice "${window.rad.skin.id}"`);
if (activeCards[0]?.querySelector('.rad-button')) fail('la piel en uso ofrece el botón de usarla');
if (cards.some((c) => !c.hasAttribute('data-active') && !c.querySelector('.rad-button'))) fail('una piel que no está en uso no tiene su botón');
if (document.querySelector('.rad-titlebar-sub > :not(.rad-swap-out)')?.textContent !== window.rad.skin.name.toLowerCase()) fail('la titlebar no dice el nombre de la piel');
const elegida = await window.rad.invoke('pieles:usar', window.rad.skin.id);
if (elegida?.reabre !== false) fail('en el humo, elegir una piel no tiene que reabrir la vitrina');
let badSkin = false;
try { await window.rad.invoke('pieles:usar', 'no-existe'); } catch { badSkin = true; }
if (!badSkin) fail('el selector aceptó una piel que no existe');
data.pieles = `${cards.map((c) => c.dataset.skin).join(', ')}; en uso: ${window.rad.skin.id}`;
item('capas').click();
await sleep(400);

// ---------- Controles ----------
item('controles').click();
await sleep(400);
const ctl = view('controles');
const after = (el) => getComputedStyle(el, '::after');
const labelOf = (sel) => ctl.querySelector(sel).closest('label');

// 12c. El respiro de la scrollbar: la pista de un scroll redondeado se separa
// de las puntas lo que diga su --rad-a-scroll-inset, y eso no se hereda a lo
// de adentro (la vista de glass lo tiene, sus tarjetas no).
const notas = ctl.querySelector('textarea.rad-input');
const inset = (el) => getComputedStyle(el).getPropertyValue('--rad-a-scroll-inset').trim();
const track = (el) => getComputedStyle(el, '::-webkit-scrollbar-track');
// El respiro es para las esquinas redondeadas: una piel a filo no lo necesita.
const notasRadius = parseFloat(getComputedStyle(notas).borderTopRightRadius) || 0;
if (notasRadius > 0 && parseFloat(inset(notas)) <= 0) fail(`el textarea es redondeado (${notasRadius}px) y no declara respiro para su scrollbar`);
for (const el of [notas, ctl]) {
  const t = track(el);
  if (t.marginTop !== inset(el) || t.marginBottom !== inset(el)) fail(`la pista de ${el === ctl ? 'la vista' : 'el textarea'} tiene margen ${t.marginTop}/${t.marginBottom}, su respiro dice ${inset(el)}`);
}
if (inset(notas.closest('.rad-field')) !== '0px' || inset(ctl.firstElementChild) !== '0px') fail('el respiro de la scrollbar se heredó a un elemento que no lo declara');
data.scrollbar = `respiro: vista ${inset(ctl)}, textarea ${inset(notas)}`;

// 13. Check: el click en la etiqueta lo marca y el tilde se dibuja entero.
const vencidos = ctl.querySelector('[data-demo="vencidos"]');
labelOf('[data-demo="vencidos"]').click();
await sleep(320);
if (!vencidos.checked) fail('el check no se marcó con el click en su etiqueta');
const tick = vencidos.nextElementSibling.querySelector('svg');
if (!tick) fail('el check no tiene su tilde dibujado');
else if (parseFloat(getComputedStyle(tick).strokeDashoffset) > 0.01) fail(`el tilde quedó a medio dibujar: ${getComputedStyle(tick).strokeDashoffset}`);
const nativeBox = getComputedStyle(vencidos);
if (nativeBox.opacity !== '0' || parseFloat(nativeBox.width) > 1) fail('el checkbox nativo se ve');

// 14. Switch: el pulgar viaja.
const sonido = ctl.querySelector('[data-demo="sonido"]');
const thumbX = () => new DOMMatrix(after(sonido.nextElementSibling).transform === 'none' ? undefined : after(sonido.nextElementSibling).transform).m41;
const x0 = thumbX();
labelOf('[data-demo="sonido"]').click();
await frame();
const xMid = thumbX();
await sleep(320);
const x1 = thumbX();
if (!sonido.checked) fail('el switch no se prendió');
if (!(x1 > x0 + 4)) fail(`el pulgar del switch no viajó: ${x0} → ${x1}`);
data.switch = `pulgar ${Math.round(x0)} → ${Math.round(xMid)} → ${Math.round(x1)} px`;

// 15. Radio: uno solo por grupo, y el punto crece.
labelOf('[data-demo="orden-nombre"]').click();
await sleep(320);
if (!ctl.querySelector('[data-demo="orden-nombre"]').checked || ctl.querySelector('[data-demo="orden-fecha"]').checked) fail('el grupo de radios no quedó con uno solo');
const dot = new DOMMatrix(after(ctl.querySelector('[data-demo="orden-nombre"]').nextElementSibling).transform);
if (Math.abs(dot.a - 1) > 0.01) fail(`el punto del radio no creció entero: escala ${dot.a}`);

// 16. Deshabilitado: no cambia.
const disabledCheck = [...ctl.querySelectorAll('.rad-check input')].find((i) => i.disabled);
disabledCheck.closest('label').click();
if (disabledCheck.checked) fail('un check deshabilitado se marcó');

// 17. Select con el teclado: abre con el elegido activo, calza con el
// botón, saltea el deshabilitado, Enter elige y el foco vuelve.
const sel = ctl._radSelect;
sel.el.focus();
keyOn(sel.el, 'ArrowDown');
await frame();
let selMenu = openMenus()[0];
if (!selMenu) fail('el select no abrió con la flecha');
else {
  if (activeLabel(selMenu) !== 'Mañana') fail(`el select abrió con "${activeLabel(selMenu)}" activo, no el elegido`);
  if (selMenu.offsetWidth < sel.el.offsetWidth) fail(`el menú del select (${selMenu.offsetWidth}) es más angosto que el botón (${sel.el.offsetWidth})`);
  const path = [activeLabel(selMenu)];
  for (let i = 0; i < 3; i++) { keyOn(selMenu, 'ArrowDown'); path.push(activeLabel(selMenu)); }
  if (path.join(' > ') !== 'Mañana > Tarde > Noche > Mañana') fail(`el recorrido del select fue: ${path.join(' > ')}`);
  keyOn(selMenu, 'ArrowDown');
  keyOn(selMenu, 'Enter');
  await sleep(dur('fast') + dur('base') + 150);
  if (sel.value !== 'tarde') fail(`el select quedó en ${sel.value}, no en tarde`);
  const shown = sel.el.querySelector('.rad-select-value > :not(.rad-swap-out)')?.textContent;
  if (shown !== 'Tarde') fail(`el botón del select muestra "${shown}"`);
  if (sel.el.querySelectorAll('.rad-select-value > *').length !== 1) fail('quedaron restos del relevo en el botón del select');
  if (document.activeElement !== sel.el) fail('el foco no volvió al select');
  if (sel.el.getAttribute('aria-expanded') !== 'false') fail('el select quedó con aria-expanded=true');
  data.select = path.join(' > ') + ' → Tarde';
}
// La trampa del ancla también en el select.
sel.el.click();
await sleep(250);
sel.el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
sel.el.click();
await sleep(300);
if (openMenus().length) fail('el click sobre el select volvió a abrir su menú');

// 18. Error de campo: se despliega, y se pliega al corregir.
const nombreIn = ctl.querySelector('[data-demo="nombre"]');
const nombreField = nombreIn.closest('.rad-field');
const errSlot = () => nombreField.querySelector('.rad-field-error');
const h0 = errSlot().getBoundingClientRect().height;
ctl.querySelector('[data-demo="form"]').requestSubmit();
await frame();
const hMid = errSlot().getBoundingClientRect().height;
await sleep(350);
const h1 = errSlot().getBoundingClientRect().height;
if (!nombreField.hasAttribute('data-invalid') || nombreIn.getAttribute('aria-invalid') !== 'true') fail('el campo vacío no quedó marcado con error');
if (!(h0 < 1 && h1 > 10)) fail(`el renglón del error no se desplegó: ${h0} → ${h1}`);
if (hMid >= h1) fail('el renglón del error apareció entero de golpe');
const errText = errSlot().querySelector('.rad-field-error-text > :not(.rad-swap-out)')?.textContent;
if (errText !== 'Falta el nombre.') fail(`el error dice "${errText}"`);
nombreIn.value = 'Fran';
nombreIn.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(350);
if (nombreField.hasAttribute('data-invalid') || errSlot().getBoundingClientRect().height > 1) fail('el error no se plegó al corregir el campo');
data.error = `renglón ${Math.round(h0)} → ${Math.round(hMid)} → ${Math.round(h1)} px, y de vuelta a 0`;

// Para la captura: el formulario con un error y el select abierto.
await sleep(300);
nombreIn.value = '';
ctl.querySelector('[data-demo="form"]').requestSubmit();
await sleep(400);
sel.el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
await sleep(500);

// Lo último: un guardado que todavía está en el debounce cuando la app cierra.
window.rad.store.write('ultimo', { ok: true });

return { failures, data };
