'use strict';

// El preload de las páginas del navegador embebido de BlackCode. Lo registra
// agent-browser.cjs en la partición del panel (registerPreloadScript), no en
// la ventana de la app.
//
// Portado de NeonCode 1.11.3 (browser-chrome-preload.cjs), tal cual estaba
// escrito: de acá para abajo es aquel archivo, con sus comentarios (nombran a
// browser.js, que acá es agent-browser.cjs, y a `window.neon`, el puente de
// aquella app). No se adaptó nada: solo cambió de nombre y de carpeta.
//
// ---------------------------------------------------------------------------
// NeonCode — preload de las páginas del browser compartido: window.chrome.
//
// En Chrome toda página tiene window.chrome con `app`, `csi` y `loadTimes`. En
// Electron está vacío, y eso es lo que mira el login de Google para decir "No
// puedes acceder: este navegador no es seguro". Acá se completa, en el mundo de
// la página y antes de su primer script, con la misma forma que en Chrome.
//
// Es un preload DE SESIÓN (browser.js lo registra en la partición del panel), no
// el de la app: no expone IPC, no nombra a `window.neon`, no hace nada más que
// esto. Copia del de Prism (src/chrome-preload.cjs), que lo probó contra Google.
//
// No toca nada que la página ya tenga: si window.chrome trae algo, se respeta.
//
// Y una segunda cosa, del mismo lado y por el mismo carril: los diálogos de la
// página (alert/confirm/prompt). Un alert() congela el renderer de la página
// hasta que alguien lo conteste, y acá no hay quién: medido en Electron 44, la
// pestaña quedaba muerta —ni lectura ni clicks— hasta recargarla, y el evento
// `-window-dialog` con el que browser.js intentaba descartarlos no llega. Se
// descartan como los descarta Chromium: alert no hace nada, confirm es
// CANCELAR y prompt es null. Cancelar y no aceptar a propósito: un confirm()
// suele ser "¿borrar?" o "¿enviar?", y del otro lado puede estar el modelo
// clickeando; que nada destructivo se confirme solo.

const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const c = window.chrome || {};
    const nav = () => performance.getEntriesByType('navigation')[0] || {};
    const origin = performance.timeOrigin;

    if (!c.app) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails() { return null; },
        getIsInstalled() { return false; },
        installState(cb) { if (typeof cb === 'function') cb('not_installed'); },
        runningState() { return 'cannot_run'; },
      };
    }
    if (!c.csi) {
      c.csi = function csi() {
        const n = nav();
        return { startE: Math.round(origin), onloadT: Math.round(origin + (n.loadEventEnd || 0)), pageT: performance.now(), tran: 15 };
      };
    }
    if (!c.loadTimes) {
      c.loadTimes = function loadTimes() {
        const n = nav();
        const s = (ms) => (origin + (ms || 0)) / 1000;
        const proto = n.nextHopProtocol || 'http/1.1';
        return {
          requestTime: s(n.requestStart),
          startLoadTime: s(n.startTime),
          commitLoadTime: s(n.responseStart),
          finishDocumentLoadTime: s(n.domContentLoadedEventEnd),
          finishLoadTime: s(n.loadEventEnd),
          firstPaintTime: s(performance.getEntriesByName('first-paint')[0]?.startTime),
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: proto === 'h2' || proto === 'h3',
          wasNpnNegotiated: proto === 'h2' || proto === 'h3',
          npnNegotiatedProtocol: proto === 'http/1.1' ? 'unknown' : proto,
          wasAlternateProtocolAvailable: false,
          connectionInfo: proto,
        };
      };
    }
    window.chrome = c;
  },
});

contextBridge.executeInMainWorld({
  func: () => {
    window.alert = function alert() {};
    window.confirm = function confirm() { return false; };
    window.prompt = function prompt() { return null; };
  },
});
