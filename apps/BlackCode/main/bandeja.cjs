'use strict';

// El ícono de la bandeja del sistema: cuál va según la barra de Windows.
//
// La bandeja la pone el núcleo (rad.start({ tray })); acá solo se elige el
// ícono. Es un dibujo de un solo color y sin baldosa (lo hornea
// scripts/icon.mjs): claro para la barra oscura (tray.ico) y oscuro para la
// clara (tray-dark.ico). La barra NO sigue el tema de las apps: Windows tiene
// dos ajustes (el de las apps y el suyo), y el de la barra está en el
// registro, en SystemUsesLightTheme. nativeTheme mira el de las apps, así que
// se lee el registro. Si no se puede leer, se supone la barra oscura, que es
// la de fábrica de Windows 11.

const path = require('node:path');
const { execFile } = require('node:child_process');

const CLAVE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

/** Lo que imprime `reg query … /v SystemUsesLightTheme` → ¿la barra es clara? null si no se entiende. */
function temaDe(salida) {
  const m = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(salida ?? ''));
  return m ? parseInt(m[1], 16) === 1 : null;
}

/** ¿La barra de Windows es clara? Nunca tira: ante la duda, no. */
function barraClara({ correr = execFile, plataforma = process.platform } = {}) {
  if (plataforma !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      correr('reg', ['query', CLAVE, '/v', 'SystemUsesLightTheme'], { timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? false : temaDe(stdout) === true));
    } catch { resolve(false); }
  });
}

/**
 * El ícono de la bandeja de la app.
 *   dir          la carpeta `build` de la app
 *   alCambiar()  el ícono cambió (hay que pedirle al núcleo que lo relea)
 * Devuelve { icono(), mirar(), clara(), grabando(si) }.
 *
 * Mientras dura una conversación por el micrófono de la PC, el ícono lleva un
 * punto rojo de grabación (tray-rec.ico / tray-dark-rec.ico, de
 * scripts/icon.mjs): con BlackCode escondida en la bandeja, así se sabe que
 * está escuchando. Lo eligió Fran el 28/11/2026.
 */
function crear({ dir, alCambiar = () => {}, correr, plataforma } = {}) {
  let clara = false;
  let rec = false;
  const icono = () => path.join(dir, `${clara ? 'tray-dark' : 'tray'}${rec ? '-rec' : ''}.ico`);
  async function mirar() {
    const ahora = await barraClara({ correr, plataforma });
    if (ahora === clara) return false;
    clara = ahora;
    try { alCambiar(); } catch { /* quien escucha no tumba esto */ }
    return true;
  }
  /** La conversación se abrió o se cerró. Devuelve si cambió el ícono. */
  function grabando(si) {
    const ahora = si === true;
    if (ahora === rec) return false;
    rec = ahora;
    try { alCambiar(); } catch { /* quien escucha no tumba esto */ }
    return true;
  }
  return { icono, mirar, clara: () => clara, grabando };
}

module.exports = { crear, temaDe, barraClara };
