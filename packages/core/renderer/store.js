// Rad · documentos guardados, desde el renderer.
//
//   import { openDoc } from '/@core/store.js';
//   const ajustes = await openDoc('ajustes', { densidad: 'normal' });
//   ajustes.get().densidad;
//   ajustes.patch({ densidad: 'compacta' });   // guarda solo
//   ajustes.update((a) => { a.vistas++; return a; });
//   ajustes.on((valor) => { … });
//
// Cada cambio viaja al main enseguida (el main lo tiene en memoria al
// instante) y el main lo baja al disco agrupando los que llegan seguidos.
// Al cerrar la app, lo pendiente se guarda antes de salir.
//
// Si el documento guardado y los valores por defecto son objetos, se mezclan:
// una clave nueva en los defaults aparece aunque el archivo sea viejo.

//
//   import { removeDoc } from '/@core/store.js';
//   await removeDoc('chat-a1b2');               // borra el archivo y su .bak
//
// Un documento borrado no avisa a quien lo tenía abierto: el que borra es el
// que sabe que ya nadie lo usa.

/** Borra un documento guardado. La promesa se cumple cuando ya no está. */
export function removeDoc(name) {
  return window.rad?.store?.remove(name) ?? Promise.resolve();
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : structuredClone(v));

export async function openDoc(name, defaults = {}) {
  const store = window.rad?.store;
  const stored = store ? await store.read(name) : undefined;
  let value = stored === undefined
    ? clone(defaults)
    : isPlain(defaults) && isPlain(stored) ? { ...clone(defaults), ...stored } : stored;
  const subs = new Set();

  const set = (next) => {
    value = next;
    store?.write(name, value);
    for (const fn of subs) fn(value);
    return value;
  };

  return {
    name,
    get: () => value,
    set,
    patch: (part) => set({ ...value, ...part }),
    update: (fn) => set(fn(clone(value))),
    on: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}
