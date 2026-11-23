'use strict';

// El puente: lo único del main que ve el renderer, bajo window.rad.
// Corre en sandbox, así que solo puede requerir electron.

const { contextBridge, ipcRenderer } = require('electron');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--rad-${name}=`));
  if (!hit) return null;
  try { return JSON.parse(decodeURIComponent(hit.slice(name.length + 7))); } catch { return null; }
}

contextBridge.exposeInMainWorld('rad', {
  platform: process.platform,
  skin: arg('skin'),
  core: arg('core'),
  window: {
    minimize: () => ipcRenderer.send('rad:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('rad:window', 'toggle-maximize'),
    close: () => ipcRenderer.send('rad:window', 'close'),
    isPlaced: () => ipcRenderer.invoke('rad:window:is-placed'),
    isMaximized: () => ipcRenderer.invoke('rad:window:is-maximized'),
    onMaximizedChange: (fn) => {
      const listener = (_event, maximized) => fn(Boolean(maximized));
      ipcRenderer.on('rad:window:maximized', listener);
      return () => ipcRenderer.removeListener('rad:window:maximized', listener);
    },
    onPlaced: (fn) => {
      const listener = () => fn();
      ipcRenderer.once('rad:placed', listener);
      return () => ipcRenderer.removeListener('rad:placed', listener);
    },
  },
});
