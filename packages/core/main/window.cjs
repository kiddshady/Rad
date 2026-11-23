'use strict';

// La ventana principal, sin flash blanco en Windows 11, y que se acuerda de
// dónde estaba.
//
// Hay dos flashes distintos:
//   A) el del contenido: lo mata backgroundColor = el "base" de la piel, que
//      es igual a --rad-surface-0 (el verificador de pieles lo exige);
//   B) el del compositor DWM en el primer show(): no se puede evitar, así que
//      se provoca fuera de pantalla. La ventana nace en -20000, se muestra ahí
//      y a los 200 ms se muda a su lugar. 200 es el número probado: con 120 el
//      flash vuelve a veces.
// Ojo: el B no sale en las grabaciones de pantalla. Se juzga en vivo.
//
// El lugar y el tamaño se guardan en el documento _window del store (los
// nombres con _ son del núcleo). Si el monitor donde estaba ya no existe, o
// la ventana quedaría sin titlebar a la vista, se centra en el principal.

const { BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('node:path');
const { ORIGIN } = require('./protocol.cjs');

const MOVE_DELAY_MS = 200;
const SAVE_DEBOUNCE_MS = 400;
const STATE_DOC = '_window';
// Lo mínimo de la ventana que tiene que caer adentro de un monitor para
// darla por visible: un pedazo de la titlebar de donde agarrarla.
const MIN_VISIBLE = { width: 160, height: 32 };

function centered(width, height) {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(width, wa.width);
  const h = Math.min(height, wa.height);
  return { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h };
}

function visibleSomewhere(b) {
  // La franja de la titlebar tiene que cruzarse con el área útil de algún
  // monitor: lo bastante ancha y al menos la mitad de alta.
  return screen.getAllDisplays().some(({ workArea: wa }) => {
    const w = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const h = Math.min(b.y + MIN_VISIBLE.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return w >= MIN_VISIBLE.width && h >= MIN_VISIBLE.height / 2;
  });
}

function initialBounds(saved, width, height, minWidth, minHeight) {
  const ok = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)
    && saved.width >= minWidth && saved.height >= minHeight;
  if (ok && visibleSomewhere(saved)) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  return centered(ok ? saved.width : width, ok ? saved.height : height);
}

const isExternal = (url) => /^(https?:|mailto:)/i.test(url);

function createWindow({ skin, window: opts = {}, entry = 'index.html', store, appInfo }) {
  const minWidth = opts.minWidth ?? 720;
  const minHeight = opts.minHeight ?? 480;
  const remember = opts.remember !== false && store;
  const saved = remember ? store.read(STATE_DOC) : null;
  const target = initialBounds(saved, opts.width ?? 1200, opts.height ?? 780, minWidth, minHeight);

  const win = new BrowserWindow({
    x: -20000,
    y: -20000,
    width: target.width,
    height: target.height,
    minWidth,
    minHeight,
    title: opts.title ?? 'Rad',
    icon: opts.icon,
    frame: false,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: skin.base,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      // El preload corre en sandbox y no puede leer archivos: lo que tiene
      // que saber de la piel, del núcleo y de la app le llega por argumentos.
      additionalArguments: [
        `--rad-skin=${encodeURIComponent(JSON.stringify({ id: skin.id, name: skin.name }))}`,
        `--rad-core=${encodeURIComponent(JSON.stringify({ version: require('../package.json').version }))}`,
        `--rad-app=${encodeURIComponent(JSON.stringify(appInfo ?? {}))}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // "placed" = la ventana ya está en su lugar y se ve. El renderer espera esto
  // para hacer entrar el contenido: si entrara antes, la animación correría
  // fuera de pantalla y nadie la vería.
  let placed = false;
  win.rad = { isPlaced: () => placed };

  // En el humo la ventana no toma el foco ni recibe el mouse real: el que
  // esté usando la PC no le mete eventos al guion (un blur cierra menús y
  // tooltips, y el mouse encima dispara los suyos).
  const smoke = Boolean(process.env.RAD_SMOKE);
  if (smoke) win.setIgnoreMouseEvents(true);

  win.once('ready-to-show', () => {
    if (smoke) win.showInactive();
    else win.show();
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height });
      if (saved?.maximized) win.maximize();
      placed = true;
      win.webContents.send('rad:placed');
      win.emit('rad:placed');
    }, MOVE_DELAY_MS);
  });

  // Guardar el lugar. Solo después de "placed": mientras está fuera de
  // pantalla, sus coordenadas son las de -20000. Se guarda el tamaño normal
  // (getNormalBounds) aunque esté maximizada, para volver a él al restaurar.
  if (remember) {
    let timer = null;
    const save = () => {
      if (!placed || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      store.write(STATE_DOC, { ...win.getNormalBounds(), maximized: win.isMaximized() }).catch(() => {});
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(save, SAVE_DEBOUNCE_MS); };
    win.on('resize', later);
    win.on('move', later);
    win.on('maximize', save);
    win.on('unmaximize', save);
    win.on('close', () => { clearTimeout(timer); save(); });
  }

  // La titlebar cambia el ícono de maximizar por el de restaurar.
  const sendMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('rad:window:maximized', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // Nada sale de rad://app. Un link a la web (http, https, mailto) se abre en
  // el navegador del sistema; cualquier otra navegación se frena.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN + '/')) return;
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`${ORIGIN}/${entry}`);
  return win;
}

// Los controles de ventana que usa la titlebar propia.
function wireWindowIpc() {
  const from = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle('rad:window:is-placed', (event) => from(event)?.rad?.isPlaced() ?? false);
  ipcMain.handle('rad:window:is-maximized', (event) => from(event)?.isMaximized() ?? false);
  ipcMain.on('rad:window', (event, action) => {
    const win = from(event);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
  ipcMain.handle('rad:open-external', (_event, url) => {
    if (typeof url !== 'string' || !isExternal(url)) throw new Error('[rad] solo se abren links http, https o mailto');
    return shell.openExternal(url);
  });
}

module.exports = { createWindow, wireWindowIpc, MOVE_DELAY_MS, STATE_DOC };
