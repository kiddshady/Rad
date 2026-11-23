'use strict';

// Punto de entrada del proceso principal.
//
//   const rad = require('@rad/core/main');
//   rad.start({
//     skin: require('@rad/skin-classic'),
//     renderer: path.join(__dirname, 'renderer'),
//     window: { width: 1200, height: 780, title: 'Mi app' },
//   });
//
// Hay que requerirlo antes de app.whenReady(): registra el esquema rad:// en
// el momento de cargarse, y Electron solo lo acepta antes de ready.

const path = require('node:path');
const { app } = require('electron');
const protocol = require('./protocol.cjs');
const { createWindow, wireWindowIpc } = require('./window.cjs');
const smoke = require('./smoke.cjs');
const contract = require('../contract/tokens.cjs');
const pkg = require('../package.json');

const CORE_RENDERER = path.join(__dirname, '..', 'renderer');

let registered = false;
function ensureScheme(extra) {
  if (registered) return;
  protocol.registerScheme(extra);
  registered = true;
}
ensureScheme();

function checkSkin(skin) {
  const need = ['id', 'name', 'base', 'root'];
  const missing = need.filter(k => !skin || !skin[k]);
  if (missing.length) throw new Error(`[rad] la piel no trae: ${missing.join(', ')}`);
  if (!/^#[0-9a-f]{6}$/i.test(skin.base)) throw new Error(`[rad] el base de la piel tiene que ser #rrggbb: ${skin.base}`);
}

function start(options) {
  const { skin, renderer } = options;
  checkSkin(skin);
  if (!renderer) throw new Error('[rad] falta renderer: la carpeta del renderer de la app');

  if (options.appId && process.platform === 'win32') app.setAppUserModelId(options.appId);

  app.on('window-all-closed', () => app.quit());

  return app.whenReady().then(() => {
    protocol.handle({ app: renderer, core: CORE_RENDERER, skin: skin.root });
    wireWindowIpc();
    const win = createWindow(options);
    smoke.attach(win, { skin });
    return win;
  });
}

module.exports = { start, version: pkg.version, contract };
