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
  window: { width: 1100, height: 760, title: 'Rad · vitrina' },
});
