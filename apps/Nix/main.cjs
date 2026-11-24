'use strict';

// Nix: un chat con IA y varios agentes. Cada agente tiene su nombre, su
// modelo y sus instrucciones, y sus propios chats.
//
// El reparto: el renderer es dueño de los agentes y los chats (los guarda con
// el store del núcleo); acá vive lo que el renderer no tiene que ver ni poder
// hacer solo: las llaves de las APIs (cifradas) y la llamada al modelo, que
// puede ir a Anthropic o a Venice según el agente.

const path = require('node:path');
const rad = require('@rad/core/main');
const llave = require('./main/llave.cjs');
const chat = require('./main/chat.cjs');

// Hasta la 0.4.0 la app se llamaba «Daimon» y sus datos quedaron en una
// carpeta con ese nombre. Se adoptan la primera vez, antes de leer nada y
// antes de app ready: con los agentes y los chats viaja la clave con que se
// cifraron las llaves de las APIs, así no hay que pegarlas de nuevo.
rad.adoptData('Daimon');

let pedidos = null;
llave.wire(rad, { alCambiar: (proveedor) => pedidos?.alCambiarLlave(proveedor) });
pedidos = chat.wire(rad, { llave });

rad.start({
  skin: require('@rad/skin-mono'),
  renderer: path.join(__dirname, 'renderer'),
  // El appId y el repo de releases siguen siendo los de «daimon», el nombre
  // con que nació la app: es por donde la instalada encuentra su actualización.
  appId: 'com.umbrovex.daimon',
  // En Windows la ventana lleva el mismo .ico que el ejecutable: con el PNG,
  // la barra de tareas muestra el de 256 achicado y no el dibujado a su tamaño.
  window: {
    width: 1240,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    title: 'Nix',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  },
  // La interfaz está en inglés: los textos que pone el núcleo, también.
  lang: 'en',
  // El código y los datos, en Roboto Mono (viaja con Rad).
  fonts: { mono: 'roboto-mono' },
  // Se actualiza desde kiddshady/daimon-releases (build.publish del
  // package.json). Solo la app instalada: abierta desde el repo no busca nada.
  updates: true,
});
