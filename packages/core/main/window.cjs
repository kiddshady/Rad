'use strict';

// La ventana principal, sin flash blanco en Windows 11.
//
// Hay dos flashes distintos:
//   A) el del contenido: lo mata backgroundColor = el "base" de la piel, que
//      es igual a --rad-surface-0 (el verificador de pieles lo exige);
//   B) el del compositor DWM en el primer show(): no se puede evitar, así que
//      se provoca fuera de pantalla. La ventana nace en -20000, se muestra ahí
//      y a los 200 ms se muda a su lugar. 200 es el número probado: con 120 el
//      flash vuelve a veces.
// Ojo: el B no sale en las grabaciones de pantalla. Se juzga en vivo.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('node:path');
const { ORIGIN } = require('./protocol.cjs');

const MOVE_DELAY_MS = 200;

function centered(width, height) {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
  };
}

function createWindow({ skin, window: opts = {}, entry = 'index.html' }) {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 780;
  const target = centered(width, height);

  const win = new BrowserWindow({
    x: -20000,
    y: -20000,
    width,
    height,
    minWidth: opts.minWidth ?? 720,
    minHeight: opts.minHeight ?? 480,
    title: opts.title ?? 'Rad',
    icon: opts.icon,
    frame: false,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: skin.base,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      // El preload corre en sandbox y no puede leer archivos: lo que tiene
      // que saber de la piel y del núcleo le llega por argumentos.
      additionalArguments: [
        `--rad-skin=${encodeURIComponent(JSON.stringify({ id: skin.id, name: skin.name }))}`,
        `--rad-core=${encodeURIComponent(JSON.stringify({ version: require('../package.json').version }))}`,
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
      win.setPosition(target.x, target.y);
      placed = true;
      win.webContents.send('rad:placed');
      win.emit('rad:placed');
    }, MOVE_DELAY_MS);
  });

  // La titlebar cambia el ícono de maximizar por el de restaurar.
  const sendMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('rad:window:maximized', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // Nada sale de rad://app: ni navegaciones ni ventanas nuevas.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
}

module.exports = { createWindow, wireWindowIpc, MOVE_DELAY_MS };
