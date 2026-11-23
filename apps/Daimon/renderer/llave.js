// El estado de las llaves de las APIs (una por proveedor), visto desde el
// renderer. La llave en claro nunca llega acá: solo si está, si se puede leer
// y una pista para reconocerla. Las guarda, cifradas, el proceso principal
// (main/llave.cjs).

let actual = { simulado: false };
const subs = new Set();
const poner = (nuevo) => {
  actual = nuevo;
  for (const fn of subs) fn(actual);
  return actual;
};

export const simulado = () => Boolean(actual.simulado);
/** El estado de la llave de un proveedor: { estado, pista?, tipo? }. */
export const de = (proveedor) => actual[proveedor] ?? { estado: 'falta' };
export const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
/** ¿Hace falta pegar la llave de ese proveedor para que un agente conteste? */
export const falta = (proveedor) => !actual.simulado && de(proveedor).estado !== 'lista';

export async function refrescar() {
  return poner(await window.rad.invoke('llave:estado'));
}

/** Devuelve { ok, error? }. Si anduvo, el estado ya quedó al día. */
export async function guardar(proveedor, valor) {
  const r = await window.rad.invoke('llave:guardar', proveedor, valor);
  if (r.ok) poner(r.estado);
  return r;
}

export async function borrar(proveedor) {
  const r = await window.rad.invoke('llave:borrar', proveedor);
  poner(r.estado);
}
