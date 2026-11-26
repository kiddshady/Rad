'use strict';

// El atajo global: Ctrl+Alt+B muestra o esconde BlackCode desde donde sea. Lo
// pidió Fran el 26/11/2026, primero para traerla y enseguida como toggle:
//   - si está al frente y con el foco, la esconde (en la bandeja; o la
//     minimiza si la bandeja está apagada, para no dejarla invisible y fuera
//     de la barra de tareas: eso lo decide quien pasa `esconder`);
//   - si está escondida, minimizada o detrás de otra ventana, la trae al
//     frente (lo mismo que el clic en el ícono de la bandeja).
//
// Es global (anda en todo Windows), así que lo registra el sistema y otro
// programa puede tenerlo tomado: en ese caso `register` devuelve false y
// BlackCode sigue igual, sin atajo. Settings solo lo menciona si quedó
// registrado.
//
// Sin Electron adentro: `globalShortcut` y la ventana (`alFrente`, `mostrar`,
// `esconder`) se pasan, así se prueba con node pelado
// (tools/test-blackcode-atajo.mjs). En el humo no se registra
// (`registrar: false`): el humo corre mientras Fran usa la PC y no le puede
// robar el atajo.

const ACELERADOR = 'Control+Alt+B';

function crear({ globalShortcut, ventana, registrar = true }) {
  let registrado = false;
  /** Lo que hace el atajo. */
  const alternar = () => {
    if (ventana.alFrente()) ventana.esconder();
    else ventana.mostrar();
  };
  return {
    /** Lo registra. Devuelve si quedó registrado. */
    prender() {
      if (!registrar || registrado) return registrado;
      try { registrado = globalShortcut.register(ACELERADOR, alternar) === true; } catch { registrado = false; }
      return registrado;
    },
    /** Lo suelta (al cerrar la app). */
    apagar() {
      if (!registrado) return;
      try { globalShortcut.unregister(ACELERADOR); } catch { /* ya no estaba */ }
      registrado = false;
    },
    estado: () => ({ acelerador: ACELERADOR, registrado }),
    alternar,
  };
}

module.exports = { crear, ACELERADOR };
