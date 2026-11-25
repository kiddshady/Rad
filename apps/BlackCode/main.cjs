'use strict';

// BlackCode (antes Nix, y antes Daimon): un chat con IA y varios agentes. Cada agente tiene su nombre, su
// modelo y sus instrucciones, y sus propios chats.
//
// El reparto: el renderer es dueño de los agentes y los chats (los guarda con
// el store del núcleo); acá vive lo que el renderer no tiene que ver ni poder
// hacer solo: las llaves de las APIs (cifradas) y la llamada al modelo, que
// puede ir a Anthropic o a Venice según el agente.

const path = require('node:path');
const { app } = require('electron');

// Scrollbars flotantes en las páginas del navegador, como en Prism (y como
// Edge en Windows 11): un hilo que va ENCIMA de la página, aparece al mover la
// rueda y se ensancha al pararse arriba. La clásica de Chromium reserva un
// carril de 17 px con sus flechas pegado al borde de la capa, y las esquinas
// redondeadas de la capa se lo comían. Las de la app no cambian: el núcleo las
// dibuja con ::-webkit-scrollbar, y una scrollbar con estilo nunca es flotante.
//
// Desde Electron 44 (Chromium 152) eso se decide ANTES de que corra este
// archivo: un appendSwitch('enable-features') llega tarde y no hace nada. Tiene
// que venir en la línea de comandos de verdad. Los scripts (start, el humo, las
// capturas) lo pasan; la app instalada, si arrancó sin él (el acceso directo,
// el instalador, una actualización), se relanza UNA vez con él antes de abrir
// nada: unos 0,2 s. El flag va primero, y lo que el usuario haya pasado,
// después. La marca en el entorno es el seguro contra un relanzamiento en
// cadena. (El humo de la app empaquetada corre su segunda pasada sin el flag:
// es la prueba de que el relanzamiento anda.)
const FLOTANTES = '--enable-features=OverlayScrollbar';
const conFlotantes = process.argv.some((a) => a.startsWith('--enable-features=') && a.slice('--enable-features='.length).split(',').includes('OverlayScrollbar'));
if (app.isPackaged && !conFlotantes && !process.env.BLACKCODE_RELANZADA) {
  process.env.BLACKCODE_RELANZADA = '1';
  app.relaunch({ args: [FLOTANTES, ...process.argv.slice(1)] });
  app.exit(0);
} else {
  arrancar();
}

function arrancar() {
  // La marca del relanzamiento no se hereda: lo que esta app lance (el
  // instalador de una actualización, que después la vuelve a abrir SIN el flag)
  // tiene que poder relanzarse otra vez.
  delete process.env.BLACKCODE_RELANZADA;
  const rad = require('@rad/core/main');
  const llave = require('./main/llave.cjs');
  const chat = require('./main/chat.cjs');

  // La app cambió de nombre dos veces: «Daimon» hasta la 0.4.0 y «Nix» hasta la
  // 0.9.0. Sus datos quedaron en una carpeta con cada nombre. Se adoptan la
  // primera vez, antes de leer nada y antes de app ready: con los agentes y los
  // chats viaja la clave con que se cifraron las llaves de las APIs, así no hay
  // que pegarlas de nuevo. De Nix vienen además lo que guardaron las tools (los
  // canvas, la base del agente, los favoritos del navegador) y el perfil del
  // navegador, con sus inicios de sesión. No viajan los cachés ni el entorno de
  // Python de run_code (lleva rutas absolutas adentro: se arma de nuevo solo).
  const NO_VIAJA = new Set(['.venv', 'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Service Worker']);
  rad.adoptData('Nix', { also: ['tools', 'Partitions'], skip: (ruta) => NO_VIAJA.has(path.basename(ruta)) }) || rad.adoptData('Daimon');

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
      title: 'BlackCode',
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
}
