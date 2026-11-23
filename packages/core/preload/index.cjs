'use strict';

// El puente: lo único del main que ve el renderer, bajo window.rad.
// Corre en sandbox, así que solo puede requerir electron.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rad', {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('rad:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('rad:window', 'toggle-maximize'),
    close: () => ipcRenderer.send('rad:window', 'close'),
    isPlaced: () => ipcRenderer.invoke('rad:window:is-placed'),
    onPlaced: (fn) => {
      const listener = () => fn();
      ipcRenderer.once('rad:placed', listener);
      return () => ipcRenderer.removeListener('rad:placed', listener);
    },
  },
});
