// Rad · "esperame antes de entrar".
//
// La raíz entra (con su fundido) cuando la ventana está en su lugar. Si la
// app arma su interfaz después de algo asincrónico (leer sus datos), podría
// llegar tarde: la raíz entraría vacía y la interfaz aparecería de golpe
// encima. Con hold(), la app le pide al arranque que espere:
//
//   import { hold } from '/@core/ready.js';
//   const release = hold();
//   const datos = await openDoc('ajustes');
//   armarInterfaz(datos);
//   release();
//
// Hay un tope: si algo nunca suelta, se entra igual (mejor tarde que nunca).

const MAX_HOLD_MS = 3000;
let holds = 0;
const waiters = [];

export function hold() {
  holds++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    holds--;
    if (holds === 0) waiters.splice(0).forEach((fn) => fn());
  };
  setTimeout(release, MAX_HOLD_MS);
  return release;
}

export function whenReleased() {
  return holds === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve));
}
