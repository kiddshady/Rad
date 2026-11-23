'use strict';

const path = require('node:path');
const { app } = require('electron');
const rad = require('@rad/core/main');

// Las pieles que la vitrina sabe mostrar. Una piel fija el color con que
// nace la ventana, así que no se cambia en caliente: se elige, se guarda y la
// vitrina vuelve a abrir con ella.
const SKINS = {
  classic: require('@rad/skin-classic'),
  glass: require('@rad/skin-glass'),
  cyberpunk: require('@rad/skin-cyberpunk'),
};
const DEFAULT_SKIN = 'classic';

// RAD_SKIN manda (el humo y las capturas lo usan para no depender de lo
// guardado); si no, la última que se eligió.
const wanted = process.env.RAD_SKIN || rad.store.read('vitrina')?.piel;
const skin = SKINS[wanted] ?? SKINS[DEFAULT_SKIN];
if (process.env.RAD_SKIN && !SKINS[process.env.RAD_SKIN]) {
  throw new Error(`[vitrina] no hay ninguna piel "${process.env.RAD_SKIN}" (hay: ${Object.keys(SKINS).join(', ')})`);
}

// Un ejemplo del puente: el renderer lo pide con rad.invoke('sistema:info').
rad.handle('sistema:info', () => ({
  vitrina: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  datos: rad.store.dir,
}));

rad.handle('pieles:listar', () => Object.values(SKINS).map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description ?? '',
  preview: s.preview ?? [s.base],
  active: s === skin,
})));

// Guarda la piel elegida y reabre la vitrina con ella. En el humo solo
// guarda: la pasada siguiente comprueba que se acordó.
rad.handle('pieles:usar', async (id) => {
  if (!SKINS[id]) throw new Error(`[vitrina] no hay ninguna piel "${id}"`);
  await rad.store.write('vitrina', { piel: id });
  if (process.env.RAD_SMOKE) return { reabre: false };
  // El guardado baja en before-quit; relaunch arranca la nueva cuando esta
  // termina de salir, así que no chocan por la instancia única.
  app.relaunch();
  app.quit();
  return { reabre: true };
});

rad.start({
  skin,
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
