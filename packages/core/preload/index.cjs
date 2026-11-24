'use strict';

// El puente: lo único del main que ve el renderer, bajo window.rad.
// Corre en sandbox, así que solo puede requerir electron.

const { contextBridge, ipcRenderer } = require('electron');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--rad-${name}=`));
  if (!hit) return null;
  try { return JSON.parse(decodeURIComponent(hit.slice(name.length + 7))); } catch { return null; }
}

const CHANNEL = /^[a-z0-9][\w.:-]{0,63}$/i;
const checked = (channel) => {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) throw new Error(`[rad] canal inválido: ${JSON.stringify(channel)}`);
  return `app:${channel}`;
};

contextBridge.exposeInMainWorld('rad', {
  platform: process.platform,
  skin: arg('skin'),
  core: arg('core'),
  app: arg('app'),
  fonts: arg('fonts') ?? {},
  // El idioma de los textos que pone el núcleo: rad.start({ lang }).
  lang: arg('lang') ?? 'es',

  // El puente de la app: solo canales app:*, nunca los internos rad:*.
  invoke: (channel, ...args) => ipcRenderer.invoke(checked(channel), ...args),
  on: (channel, fn) => {
    const name = checked(channel);
    const listener = (_event, payload) => fn(payload);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
  openExternal: (url) => ipcRenderer.invoke('rad:open-external', url),

  updates: {
    state: () => ipcRenderer.invoke('rad:update:state'),
    check: () => ipcRenderer.invoke('rad:update:check'),
    download: () => ipcRenderer.invoke('rad:update:download'),
    install: () => ipcRenderer.invoke('rad:update:install'),
    on: (fn) => {
      const listener = (_event, payload) => fn(payload);
      ipcRenderer.on('rad:update', listener);
      return () => ipcRenderer.removeListener('rad:update', listener);
    },
  },

  store: {
    read: (name) => ipcRenderer.invoke('rad:store:read', name),
    write: (name, value) => ipcRenderer.send('rad:store:write', name, value),
    remove: (name) => ipcRenderer.invoke('rad:store:remove', name),
  },

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
