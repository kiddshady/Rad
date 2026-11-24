// Rad · los textos que el núcleo pone por su cuenta.
//
// Son pocos (los botones de la ventana, los botones por defecto de un
// confirm, el aviso de actualización), pero una app en inglés no puede
// mostrarlos en castellano. El idioma lo elige la app al arrancar:
//
//   rad.start({ lang: 'en' })      // 'es' si no se dice nada
//
// y cada pieza del núcleo lee de acá:  import { t } from './strings.js';
// Lo que una app escribe (títulos, rótulos, mensajes) es de la app: esto no
// es un sistema de traducciones, es el idioma de lo que el núcleo trae hecho.

const TEXTS = {
  es: {
    minimize: 'Minimizar',
    maximize: 'Maximizar',
    restore: 'Restaurar',
    close: 'Cerrar',
    views: 'Vistas',
    accept: 'Aceptar',
    cancel: 'Cancelar',
    choose: 'Elegí una opción',
    theApp: 'La app',
    updateAvailable: (name, version) => `Hay una versión nueva de ${name}: ${version}`,
    download: 'Descargar',
    downloading: 'Descargando la actualización…',
    updateReady: (version) => `La versión ${version} está lista`,
    restart: 'Reiniciar',
    updateFailed: 'No se pudo bajar la actualización',
  },
  en: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    views: 'Views',
    accept: 'OK',
    cancel: 'Cancel',
    choose: 'Choose an option',
    theApp: 'The app',
    updateAvailable: (name, version) => `A new version of ${name} is available: ${version}`,
    download: 'Download',
    downloading: 'Downloading the update…',
    updateReady: (version) => `Version ${version} is ready`,
    restart: 'Restart',
    updateFailed: 'The update could not be downloaded',
  },
};

/** El idioma del núcleo en esta app: 'es' o 'en'. */
export const lang = Object.hasOwn(TEXTS, window.rad?.lang) ? window.rad.lang : 'es';
/** Los textos del núcleo en ese idioma. */
export const t = TEXTS[lang];
