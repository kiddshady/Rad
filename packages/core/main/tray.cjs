'use strict';

// La bandeja del sistema: rad.start({ tray: { icon, tooltip, keep } }).
//
// Con una bandeja, cerrar la ventana no cierra la app: la esconde. La app sigue
// viva en la bandeja (con lo que tenga corriendo: un servidor, una tarea
// programada) y vuelve con un clic en su ícono. Se sale de verdad desde el menú
// del ícono, o por cualquier camino que pase por app.quit().
//
//   icon     la ruta del ícono, o una función que la devuelve (para cambiarlo
//            según el tema de la barra: después, rad.tray.refresh())
//   tooltip  lo que dice al pararse arriba (de fábrica, el nombre de la app)
//   keep     () => boolean: ¿cerrar la ventana la esconde? De fábrica, sí.
//            Con false, cerrar la ventana cierra la app, como sin bandeja.
//
// Lo que no es obvio:
//   - «Salir» se decide con una marca (`saliendo`) que prende before-quit. Sin
//     ella, el close que la app misma dispara al salir se frenaría igual, y la
//     app no se podría cerrar nunca.
//   - El actualizador NO pasa por before-quit antes de cerrar las ventanas
//     (quitAndInstall las cierra primero): tiene que llamar a allowQuit() antes.
//   - Windows cerrando la sesión tampoco avisa con before-quit: la ventana
//     recibe session-end.
//   - En el humo no se crea el ícono (no hay por qué llenarle la bandeja al
//     usuario con cada corrida), pero esconder y volver a mostrar sí andan,
//     para poder probarlo. La ventana vuelve sin tomar el foco.
//   - El menú del ícono es el del sistema: ahí no hay nada que vestir.

const TEXTOS = { es: { open: 'Abrir', quit: 'Salir' }, en: { open: 'Open', quit: 'Quit' } };

let actual = null;
let saliendo = false;

/** Lo llama quien va a cerrar la app por un camino que cierra las ventanas
 *  ANTES de avisar con before-quit (el actualizador). */
function allowQuit() { saliendo = true; }

/**
 * Le pone bandeja a la ventana `win`. Devuelve lo que la app puede hacer con
 * ella: { show(), hide(), quit(), visible(), refresh(), iconOk() }.
 * `electron` se puede pasar para probarlo sin Electron.
 */
function attach(win, { icon, tooltip = '', lang = 'es', name = '', keep = () => true, headless = false } = {}, electron = require('electron')) {
  const { app, Tray, Menu, nativeImage } = electron;
  const t = TEXTOS[lang] ?? TEXTOS.es;
  const imagen = () => nativeImage.createFromPath(String((typeof icon === 'function' ? icon() : icon) ?? ''));

  app.on('before-quit', allowQuit);
  win.on('session-end', allowQuit);
  win.on('close', (event) => {
    if (saliendo || keep() === false) return;
    event.preventDefault();
    win.hide();
  });

  const show = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (headless) { win.showInactive(); return; }
    win.show();
    win.focus();
  };
  const quit = () => { allowQuit(); app.quit(); };

  let tray = null;
  if (!headless) {
    tray = new Tray(imagen());
    tray.setToolTip(tooltip || name);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `${t.open} ${name}`.trim(), click: show },
      { type: 'separator' },
      { label: t.quit, click: quit },
    ]));
    tray.on('click', show);
    // (sin esto, al salir el ícono queda en la bandeja hasta pasarle el mouse)
    app.on('will-quit', () => { try { tray.destroy(); } catch { /* ya no está */ } });
  }

  actual = {
    show,
    hide: () => { if (!win.isDestroyed()) win.hide(); },
    quit,
    visible: () => !win.isDestroyed() && win.isVisible(),
    /** Vuelve a leer el ícono (cambió el tema de la barra). */
    refresh: () => { if (tray && !tray.isDestroyed()) tray.setImage(imagen()); },
    /** ¿El ícono existe y se puede leer? (En la app empaquetada depende de que viaje en `files`.) */
    iconOk: () => !imagen().isEmpty(),
    headless,
  };
  return actual;
}

module.exports = {
  attach,
  allowQuit,
  get current() { return actual; },
  /** (para las pruebas) */
  _reset() { actual = null; saliendo = false; },
};
