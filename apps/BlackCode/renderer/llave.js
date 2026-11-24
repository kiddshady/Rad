// El estado de las llaves de las APIs (una por proveedor), visto desde el
// renderer. La llave en claro nunca llega acá: solo si está, si se puede leer
// y una pista para reconocerla. Las guarda, cifradas, el proceso principal
// (main/llave.cjs).
//
// Aparte está la comprobación: si la API acepta la llave. Eso se le pregunta
// a la API (no se adivina por cómo empieza la llave) al guardarla y al abrir
// Ajustes, y lo que contestó queda acá para no volver a preguntarlo en cada
// pintada.

let actual = { simulado: false };
const subs = new Set();
const avisar = () => { for (const fn of subs) fn(actual); };
const poner = (nuevo) => { actual = nuevo; avisar(); return actual; };

export const simulado = () => Boolean(actual.simulado);
/** El estado de la llave de un proveedor: { estado, pista?, seComprueba }. */
export const de = (proveedor) => actual[proveedor] ?? { estado: 'falta' };
export const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
/** ¿Hace falta pegar la llave de ese proveedor para que un agente conteste? */
export const falta = (proveedor) => !actual.simulado && de(proveedor).estado !== 'lista';

export async function refrescar() {
  return poner(await window.rad.invoke('llave:estado'));
}

// ---------- La comprobación ----------
// fase: 'sin-pedir' | 'comprobando' | 'aceptada' | 'rechazada' (con motivo y
// detalle) | 'sin-comprobar' (no se pudo saber: no es un rechazo).
const comprobaciones = new Map();
const turnos = new Map();
export const comprobacion = (proveedor) => comprobaciones.get(proveedor) ?? { fase: 'sin-pedir' };

/**
 * Le pide al main que compruebe la llave guardada. Si ya hay una respuesta
 * definitiva (la acepta o la rechaza) no vuelve a pedirla, salvo con forzar.
 */
export async function comprobar(proveedor, { forzar = false } = {}) {
  const e = de(proveedor);
  if (e.estado !== 'lista' || !e.seComprueba) {
    if (comprobaciones.delete(proveedor)) avisar();
    return;
  }
  const fase = comprobacion(proveedor).fase;
  if (fase === 'comprobando') return;
  if (!forzar && (fase === 'aceptada' || fase === 'rechazada')) return;
  const turno = (turnos.get(proveedor) ?? 0) + 1;
  turnos.set(proveedor, turno);
  comprobaciones.set(proveedor, { fase: 'comprobando' });
  avisar();
  let r;
  try {
    r = await window.rad.invoke('llave:comprobar', proveedor, { forzar });
  } catch {
    r = { fase: 'sin-comprobar', motivo: 'servicio' };
  }
  if (turnos.get(proveedor) !== turno) return; // llegó tarde: ya hay otra llave
  comprobaciones.set(proveedor, r);
  avisar();
}

/** Devuelve { ok, error? }. Si anduvo, el estado ya quedó al día y la llave
    nueva se está comprobando. */
export async function guardar(proveedor, valor) {
  const r = await window.rad.invoke('llave:guardar', proveedor, valor);
  if (!r.ok) return r;
  // Es otra llave: lo que se sabía de la anterior no vale.
  turnos.set(proveedor, (turnos.get(proveedor) ?? 0) + 1);
  comprobaciones.delete(proveedor);
  actual = r.estado; // sin avisar todavía: el aviso sale ya con «comprobando»
  if (de(proveedor).seComprueba) comprobar(proveedor, { forzar: true });
  else avisar();
  return r;
}

export async function borrar(proveedor) {
  const r = await window.rad.invoke('llave:borrar', proveedor);
  turnos.set(proveedor, (turnos.get(proveedor) ?? 0) + 1);
  comprobaciones.delete(proveedor);
  poner(r.estado);
}
