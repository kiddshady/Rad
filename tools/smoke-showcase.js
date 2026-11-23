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

// 0. Arranque: la raíz entró y se apagó su animación; una sola vista visible.
const root = document.querySelector('.rad-root');
if (!root.classList.contains('is-settled')) fail('la raíz no quedó asentada (falta is-settled)');
if (getComputedStyle(root).animationName !== 'none') fail(`la raíz sigue con animación: ${getComputedStyle(root).animationName}`);
if (visible().join() !== 'planos') fail(`al arrancar se ven: ${visible().join()}`);

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
  await sleep(350);
  keyOn(document.activeElement, 'Escape');
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
const tips = capas.querySelectorAll('.sc-iconbtn');
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
if ([...overlays().children].some((c) => c.matches('.rad-menu, .rad-modal-layer, .rad-tooltip'))) fail('quedaron capas abiertas al terminar');

// Para la captura: un menú abierto y un toast.
capas.querySelector('[data-demo="toast"][data-kind="success"]').click();
menuBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
await sleep(500);

return { failures, data };
