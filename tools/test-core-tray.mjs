// Test de la bandeja del sistema del núcleo (packages/core/main/tray.cjs), con
// node pelado y un Electron de mentira: no abre ventanas ni pone ningún ícono.
// Uso: node tools/test-core-tray.mjs

import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = require(process.env.RAD_TRAY || path.join(ROOT, 'packages', 'core', 'main', 'tray.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };

// Un Electron de mentira: anota lo que se le hace.
function mundo() {
  const app = new EventEmitter();
  app.salidas = 0;
  // (como el de verdad: quit avisa con before-quit y después cierra las ventanas)
  app.quit = () => { app.salidas++; app.emit('before-quit', { preventDefault() {} }); for (const w of ventanas) w.close(); app.emit('will-quit'); };
  const ventanas = [];
  const bandejas = [];
  class Tray extends EventEmitter {
    constructor(imagen) { super(); this.imagen = imagen; this.destruida = false; bandejas.push(this); }
    setToolTip(t) { this.tooltip = t; }
    setContextMenu(m) { this.menu = m; }
    setImage(i) { this.imagen = i; }
    isDestroyed() { return this.destruida; }
    destroy() { this.destruida = true; }
  }
  const Menu = { buildFromTemplate: (items) => items };
  const nativeImage = { createFromPath: (ruta) => ({ ruta, isEmpty: () => !ruta || ruta.includes('falta') }) };
  function ventana() {
    const w = new EventEmitter();
    Object.assign(w, {
      visible: true, minimizada: false, destruida: false, foco: 0, sinFoco: 0,
      hide() { this.visible = false; },
      show() { this.visible = true; },
      showInactive() { this.visible = true; this.sinFoco++; },
      focus() { this.foco++; },
      restore() { this.minimizada = false; },
      isVisible() { return this.visible; },
      isMinimized() { return this.minimizada; },
      isDestroyed() { return this.destruida; },
      // (como la de verdad: avisa, y si nadie lo frena, se destruye)
      close() { if (this.destruida) return; let frenado = false; this.emit('close', { preventDefault: () => { frenado = true; } }); if (!frenado) { this.destruida = true; this.visible = false; } },
    });
    ventanas.push(w);
    return w;
  }
  return { electron: { app, Tray, Menu, nativeImage }, app, ventana, bandejas };
}

// ---------- 1. cerrar la ventana la esconde ----------
{
  T._reset();
  const m = mundo();
  const w = m.ventana();
  ok('sin pedirla no hay bandeja', T.current === null);
  const b = T.attach(w, { icon: 'C:/app/tray.ico', name: 'Mi App', lang: 'en' }, m.electron);
  ok('la bandeja queda a mano', T.current === b && m.bandejas.length === 1);
  const tray = m.bandejas[0];
  ok('el ícono es el pedido, y dice el nombre de la app', tray.imagen.ruta === 'C:/app/tray.ico' && tray.tooltip === 'Mi App' && b.iconOk() === true);
  ok('el menú trae abrir y salir, en el idioma de la app', tray.menu.map((i) => i.label ?? i.type).join('|') === 'Open Mi App|separator|Quit', JSON.stringify(tray.menu.map((i) => i.label ?? i.type)));
  w.close();
  ok('cerrar la ventana la esconde: no la destruye ni cierra la app', !w.destruida && !w.visible && b.visible() === false && m.app.salidas === 0);
  tray.emit('click');
  ok('un clic en el ícono la trae de vuelta, con el foco', w.visible && w.foco === 1 && b.visible() === true);
  w.minimizada = true;
  w.hide();
  tray.menu[0].click();
  ok('…y «Open» también, aunque estuviera minimizada', w.visible && !w.minimizada && w.foco === 2);
  b.hide();
  ok('la app la puede esconder y mostrar', !w.visible && (b.show(), w.visible));
  // salir de verdad
  tray.menu[2].click();
  ok('«Quit» cierra la app de verdad', m.app.salidas === 1 && w.destruida);
  ok('…y se lleva el ícono', tray.destruida === true);
  ok('con la ventana destruida no explota', (b.show(), b.hide(), b.visible() === false));
}

// ---------- 2. los caminos que salen ----------
{
  T._reset();
  const m = mundo();
  const w = m.ventana();
  T.attach(w, { icon: 'x.ico', name: 'App' }, m.electron);
  ok('en castellano, el menú también', m.bandejas[0].menu.map((i) => i.label ?? '-').join('|') === 'Abrir App|-|Salir');
  m.app.quit();
  ok('app.quit() (el menú de la app, el humo) cierra aunque haya bandeja', w.destruida);

  T._reset();
  const m2 = mundo();
  const w2 = m2.ventana();
  T.attach(w2, { icon: 'x.ico', name: 'App' }, m2.electron);
  T.allowQuit();
  w2.close();
  ok('después de allowQuit (el actualizador) la ventana se cierra', w2.destruida);

  T._reset();
  const m3 = mundo();
  const w3 = m3.ventana();
  T.attach(w3, { icon: 'x.ico', name: 'App' }, m3.electron);
  w3.emit('session-end');
  w3.close();
  ok('cuando Windows cierra la sesión no se resiste', w3.destruida);
}

// ---------- 3. keep: el usuario puede preferir que cerrar cierre ----------
{
  T._reset();
  const m = mundo();
  const w = m.ventana();
  let quedarse = false;
  const b = T.attach(w, { icon: 'x.ico', name: 'App', keep: () => quedarse }, m.electron);
  w.close();
  ok('con keep en false, cerrar la ventana la cierra', w.destruida && b.visible() === false);
  const w2 = m.ventana();
  T._reset();
  quedarse = true;
  T.attach(w2, { icon: 'x.ico', name: 'App', keep: () => quedarse }, m.electron);
  w2.close();
  ok('…y se pregunta cada vez (se cambia sin reiniciar)', !w2.destruida && !w2.visible);
  quedarse = false;
  w2.close();
  ok('…en los dos sentidos', w2.destruida);
}

// ---------- 4. el ícono ----------
{
  T._reset();
  const m = mundo();
  const w = m.ventana();
  let cual = 'claro.ico';
  const b = T.attach(w, { icon: () => cual, name: 'App' }, m.electron);
  ok('el ícono puede ser una función', m.bandejas[0].imagen.ruta === 'claro.ico');
  cual = 'oscuro.ico';
  b.refresh();
  ok('refresh lo vuelve a leer (cambió el tema de la barra)', m.bandejas[0].imagen.ruta === 'oscuro.ico');
  cual = 'falta.ico';
  ok('iconOk avisa de un ícono que no está', b.iconOk() === false);
}

// ---------- 5. en el humo: sin ícono, pero esconder y mostrar andan ----------
{
  T._reset();
  const m = mundo();
  const w = m.ventana();
  const b = T.attach(w, { icon: 'x.ico', name: 'App', headless: true }, m.electron);
  ok('en el humo no se pone ningún ícono en la bandeja', m.bandejas.length === 0 && b.headless === true);
  w.close();
  ok('…pero cerrar la ventana la esconde igual', !w.destruida && !w.visible);
  b.show();
  ok('…y vuelve sin robar el foco', w.visible && w.foco === 0 && w.sinFoco === 1);
  b.refresh();
  m.app.quit();
  ok('…y la app sale cuando el humo termina', w.destruida);
}

// ---------- 6. el cableado ----------
{
  const fs = require('node:fs');
  const indice = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'main', 'index.cjs'), 'utf8');
  ok('rad.start({ tray }) la arma, y rad.tray la devuelve', indice.includes('options.tray ? tray.attach(win,') && indice.includes('get tray() { return tray.current; }'));
  ok('abrir la app de nuevo la saca de la bandeja', /if \(bandeja\) \{ bandeja\.show\(\); return; \}/.test(indice));
  ok('sin bandeja, cerrar la última ventana sigue cerrando la app', indice.includes("app.on('window-all-closed', () => app.quit());"));
  const act = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'main', 'updater.cjs'), 'utf8');
  ok('el actualizador avisa antes de instalar', /allowQuit\(\);\s*\n\s*updater\.quitAndInstall/.test(act));
}

if (failures.length) {
  console.error(`test-core-tray: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-core-tray: ok (${hechas} comprobaciones: cerrar esconde, el ícono y su menú, los caminos que salen de verdad, keep, el ícono que cambia, el humo y el cableado)`);
process.exit(0);
