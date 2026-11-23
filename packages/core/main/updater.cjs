'use strict';

// Rad · actualizaciones, con electron-updater sobre los releases de GitHub.
//
// No hace falta servidor: electron-builder sube un latest.yml a cada release
// y electron-updater lo lee. La config (dónde están los releases) sale del
// bloque "publish" del build de la app, que electron-builder convierte en
// resources/app-update.yml. Sin ese archivo, el updater tira ENOENT.
//
// Criterio de Fran:
//   - no baja nada solo (el instalador pesa ~100 MB): avisa que hay una
//     versión y la app pregunta;
//   - no avisa "estás al día": solo dice algo si hay algo que hacer;
//   - instala en silencio y vuelve a abrir la app (quitAndInstall(true, true));
//   - si nunca tocás "reiniciar", entra sola al cerrar.
// La versión portable no se puede actualizar (es un .exe suelto): lo dice.
//
// Estados que viajan al renderer por 'rad:update':
//   { state: 'available', version, releaseName, size }
//   { state: 'downloading', percent }
//   { state: 'ready', version, releaseName }
//   { state: 'error', message }
//   { state: 'portable' }

const { app, ipcMain, BrowserWindow } = require('electron');

const FIRST_CHECK_MS = 4000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let updater = null;
let last = null;

function broadcast(payload) {
  last = payload;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('rad:update', payload);
  }
}

function setup({ enabled = true } = {}) {
  ipcMain.handle('rad:update:state', () => last);
  ipcMain.handle('rad:update:check', () => check());
  ipcMain.handle('rad:update:download', async () => {
    if (!updater) return false;
    await updater.downloadUpdate();
    return true;
  });
  ipcMain.handle('rad:update:install', () => {
    if (!updater || last?.state !== 'ready') return false;
    updater.quitAndInstall(true, !process.env.RAD_SMOKE);
    return true;
  });

  if (!enabled || !app.isPackaged) return null;
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    broadcast({ state: 'portable' });
    return null;
  }

  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    console.warn(`[rad:update] sin electron-updater: ${err.message}`);
    return null;
  }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;

  updater.on('update-available', (info) => broadcast({
    state: 'available',
    version: info.version,
    releaseName: info.releaseName || null,
    size: info.files?.[0]?.size ?? null,
  }));
  updater.on('download-progress', (p) => broadcast({ state: 'downloading', percent: p.percent }));
  updater.on('update-downloaded', (info) => broadcast({ state: 'ready', version: info.version, releaseName: info.releaseName || null }));
  updater.on('error', (err) => broadcast({ state: 'error', message: String(err?.message || err).split('\n')[0] }));

  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, EVERY_MS);
  return updater;
}

async function check() {
  if (!updater) return null;
  try {
    const r = await updater.checkForUpdates();
    return r?.updateInfo?.version ?? null;
  } catch {
    return null; // el error ya viajó por el evento 'error'
  }
}

module.exports = { setup, check };
