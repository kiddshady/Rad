'use strict';

// Punto de entrada del proceso principal.
//
//   const rad = require('@rad/core/main');
//   rad.handle('notas:listar', async () => { … });   // lo que el renderer pide
//   rad.start({
//     skin: require('@rad/skin-classic'),
//     renderer: path.join(__dirname, 'renderer'),
//     window: { width: 1200, height: 780, title: 'Mi app' },
//   });
//   rad.send('notas:cambiaron', datos);               // avisarle al renderer
//   rad.store.read('ajustes');                        // el mismo store del renderer
//
// Hay que requerirlo antes de app.whenReady(): registra el esquema rad:// en
// el momento de cargarse, y Electron solo lo acepta antes de ready.

const path = require('node:path');
const { app, ipcMain, BrowserWindow } = require('electron');
const protocol = require('./protocol.cjs');
const { createWindow, wireWindowIpc } = require('./window.cjs');
const { Store } = require('./store.cjs');
const smoke = require('./smoke.cjs');
const contract = require('../contract/tokens.cjs');
const pkg = require('../package.json');

const CORE_RENDERER = path.join(__dirname, '..', 'renderer');

// Las fuentes compartidas: cualquier piel o app las pide en /@fonts/.
function fontsRoot() {
  try {
    return path.dirname(require.resolve('@rad/fonts/package.json'));
  } catch {
    return null;
  }
}

// La elección de fuentes de la app: rad.start({ fonts: { mono: 'roboto-mono' } }).
// Cada id sale del catálogo de @rad/fonts; un id que no existe o que no sirve
// para ese rol frena el arranque con la lista de los que hay, en vez de caer
// callado a la fuente de la piel.
const FONT_ROLES = ['ui', 'display', 'mono'];
function resolveFonts(choice = {}) {
  const picked = {};
  const entries = Object.entries(choice).filter(([, id]) => id);
  if (!entries.length) return picked;
  let catalog;
  try {
    catalog = require('@rad/fonts/catalog.json');
  } catch {
    throw new Error('[rad] se pidieron fuentes pero no está @rad/fonts');
  }
  for (const [role, id] of entries) {
    if (!FONT_ROLES.includes(role)) throw new Error(`[rad] rol de fuente desconocido: ${role} (hay: ${FONT_ROLES.join(', ')})`);
    const font = catalog[id];
    const valid = Object.entries(catalog).filter(([, f]) => f.roles.includes(role)).map(([k]) => k);
    if (!font || !font.roles.includes(role)) throw new Error(`[rad] la fuente "${id}" no sirve para ${role} (hay: ${valid.join(', ')})`);
    picked[role] = { family: font.family, css: font.css ?? null };
  }
  return picked;
}

const CHANNEL = /^[a-z0-9][\w.:-]{0,63}$/i;

// RAD_DATA cambia dónde viven los datos (y el perfil de Chromium): los tests
// corren con una carpeta descartable y no tocan la app real ni chocan con su
// bloqueo de instancia única.
if (process.env.RAD_DATA) {
  app.setPath('userData', path.join(process.env.RAD_DATA, 'userData'));
}

// En el humo la ventana tiene que seguir pintando aunque otra la tape: si
// Windows la da por ocluida, Chromium deja de dar cuadros y las animaciones
// se quedan quietas (el guion mediría una app congelada).
if (process.env.RAD_SMOKE) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

protocol.registerScheme();

let store = null;
function getStore() {
  if (!store) {
    const dir = process.env.RAD_DATA ? path.join(process.env.RAD_DATA, 'data') : path.join(app.getPath('userData'), 'data');
    store = new Store(dir, { log: (m) => console.warn(`[rad:store] ${m}`) });
  }
  return store;
}

function checkSkin(skin) {
  const need = ['id', 'name', 'base', 'root'];
  const missing = need.filter((k) => !skin || !skin[k]);
  if (missing.length) throw new Error(`[rad] la piel no trae: ${missing.join(', ')}`);
  if (!/^#[0-9a-f]{6}$/i.test(skin.base)) throw new Error(`[rad] el base de la piel tiene que ser #rrggbb: ${skin.base}`);
}

function checkChannel(channel) {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) throw new Error(`[rad] canal inválido: ${JSON.stringify(channel)}`);
}

/** Lo que el renderer pide con rad.invoke(canal, ...args). fn recibe los
    argumentos y, al final, { window } con la ventana que pidió. */
function handle(channel, fn) {
  checkChannel(channel);
  ipcMain.handle(`app:${channel}`, (event, ...args) => fn(...args, { window: BrowserWindow.fromWebContents(event.sender) }));
}

/** Le avisa algo a todas las ventanas: lo escuchan con rad.on(canal, fn). */
function send(channel, payload) {
  checkChannel(channel);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`app:${channel}`, payload);
  }
}

// El store desde el renderer. Los documentos con _ son del núcleo (el lugar
// de la ventana): el renderer no los toca.
function wireStoreIpc() {
  const userName = (name) => {
    if (typeof name !== 'string' || name.startsWith('_')) throw new Error(`[rad] documento reservado o inválido: ${JSON.stringify(name)}`);
    return name;
  };
  ipcMain.handle('rad:store:read', (_e, name) => getStore().read(userName(name)));
  ipcMain.on('rad:store:write', (_e, name, value) => {
    try {
      getStore().write(userName(name), value).catch(() => {});
    } catch (err) {
      console.warn(`[rad:store] ${err.message}`);
    }
  });
}

// Al salir, lo pendiente baja al disco antes de que el proceso termine.
function wireQuit() {
  let flushed = false;
  app.on('before-quit', (event) => {
    if (flushed || !store) return;
    event.preventDefault();
    store.flushAll().finally(() => {
      flushed = true;
      app.quit();
    });
  });
}

function start(options) {
  const { skin, renderer } = options;
  checkSkin(skin);
  const fonts = resolveFonts(options.fonts);
  if (!renderer) throw new Error('[rad] falta renderer: la carpeta del renderer de la app');

  // Una sola instancia: dos procesos escribiendo los mismos documentos se
  // pisan. La segunda le pasa el foco a la primera y se va.
  if (options.singleInstance !== false && !app.requestSingleInstanceLock()) {
    app.quit();
    return Promise.resolve(null);
  }

  if (options.appId && process.platform === 'win32') app.setAppUserModelId(options.appId);

  app.on('window-all-closed', () => app.quit());
  wireQuit();

  return app.whenReady().then(() => {
    protocol.handle({ app: renderer, core: CORE_RENDERER, skin: skin.root, fonts: fontsRoot() });
    wireWindowIpc();
    wireStoreIpc();
    const appInfo = { name: options.window?.title ?? app.getName(), version: app.getVersion() };
    const win = createWindow({ ...options, store: getStore(), appInfo, fonts });
    app.on('second-instance', () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    smoke.attach(win, { skin, store: getStore() });
    return win;
  });
}

module.exports = {
  start,
  handle,
  send,
  get store() { return getStore(); },
  version: pkg.version,
  contract,
};
