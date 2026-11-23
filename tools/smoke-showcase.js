// Guion del humo de la vitrina. Corre adentro de la página (con await) y mide
// el shell y el router cuadro por cuadro. Devuelve { failures, data }.

const failures = [];
const data = {};
const fail = (msg) => failures.push(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
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

// Para la captura: la primera vista, quieta.
item('planos').click();
await sleep(400);

return { failures, data };
