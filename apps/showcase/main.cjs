'use strict';

const path = require('node:path');
const rad = require('@rad/core/main');

// Un ejemplo del puente: el renderer lo pide con rad.invoke('sistema:info').
rad.handle('sistema:info', () => ({
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  datos: rad.store.dir,
}));

rad.start({
  skin: require('@rad/skin-classic'),
  renderer: path.join(__dirname, 'renderer'),
  appId: 'com.umbrovex.rad.showcase',
  // En Windows la ventana lleva el mismo .ico que el ejecutable: con el PNG,
  // la barra de tareas muestra el de 256 achicado y no el dibujado a su tamaño.
  window: {
    width: 1100,
    height: 760,
    title: 'Rad · vitrina',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  },
  // La vitrina usa la mono de la piel. RAD_SHOWCASE_MONO=roboto-mono la
  // cambia (el humo lo usa para probar la elección de fuentes).
  fonts: { mono: process.env.RAD_SHOWCASE_MONO || null },
});
