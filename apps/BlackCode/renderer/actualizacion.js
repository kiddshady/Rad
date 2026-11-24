// Las actualizaciones, vistas desde el renderer: en qué anda el updater del
// núcleo, para la tarjeta «About» de Ajustes.
//
// El núcleo ya busca solo (a los segundos de abrir y cada seis horas) y
// avisa con un toast si hay una versión nueva (wireUpdates). Esto es lo
// otro: buscar cuando Fran lo pide, con un botón, y decirle qué se encontró
// también cuando no hay nada («estás al día» no llega por ningún evento).
//
// fase: 'quieta'      nadie buscó todavía
//       'buscando'
//       'al-dia'
//       'disponible'  { version }   hay una más nueva, sin bajar
//       'bajando'     { porciento }
//       'lista'       { version }   bajada: se instala al reiniciar
//       'error'       { paso: 'buscar' | 'bajar', mensaje }
//       'sin-soporte' { motivo }    no es la app instalada, o es la portable

const api = window.rad?.updates;
// Lo mínimo que se ve «buscando»: fuera de la app instalada la respuesta es
// inmediata, y un texto que cambia dos veces en un cuadro es un parpadeo.
const MINIMO_MS = 600;

let estado = { fase: 'quieta' };
const subs = new Set();
const poner = (nuevo) => { estado = nuevo; for (const fn of subs) fn(estado); };

export const actual = () => estado;
export const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };

/**
 * Un evento del updater del núcleo (rad.updates.on). Exportada porque el
 * humo la usa para recorrer los estados sin publicar una versión de verdad.
 */
export function recibir(u) {
  if (!u) return;
  // Mientras se busca a mano, lo que encontró lo dice la respuesta de buscar.
  if (estado.fase === 'buscando' && (u.state === 'available' || u.state === 'error')) return;
  if (u.state === 'available') poner({ fase: 'disponible', version: u.version });
  else if (u.state === 'downloading') poner({ fase: 'bajando', porciento: Math.round(u.percent ?? 0) });
  else if (u.state === 'ready') poner({ fase: 'lista', version: u.version });
  else if (u.state === 'portable') poner({ fase: 'sin-soporte', motivo: 'portable' });
  // Un error de la búsqueda que el núcleo hace sola no se muestra (el
  // criterio es no molestar si no hay nada que hacer); el de una descarga, sí.
  else if (u.state === 'error' && estado.fase === 'bajando') poner({ fase: 'error', paso: 'bajar', mensaje: u.message ?? '' });
}

/** Busca ahora si hay una versión nueva. */
export async function buscar() {
  if (estado.fase === 'buscando' || estado.fase === 'bajando') return;
  poner({ fase: 'buscando' });
  let r;
  try {
    [r] = await Promise.all([api ? api.check() : { supported: false, reason: 'dev' }, new Promise((ok) => setTimeout(ok, MINIMO_MS))]);
  } catch (err) {
    r = { supported: true, error: String(err?.message ?? err) };
  }
  if (estado.fase !== 'buscando') return;
  if (!r?.supported) poner({ fase: 'sin-soporte', motivo: r?.reason ?? 'dev' });
  else if (r.error != null) poner({ fase: 'error', paso: 'buscar', mensaje: r.error });
  else if (r.available) poner({ fase: 'disponible', version: r.version });
  else poner({ fase: 'al-dia' });
}

/** Baja la versión que se encontró. El avance llega por eventos. */
export function descargar() {
  if (estado.fase !== 'disponible' || !api) return;
  poner({ fase: 'bajando', porciento: 0 });
  api.download().catch((err) => {
    if (estado.fase === 'bajando') poner({ fase: 'error', paso: 'bajar', mensaje: String(err?.message ?? err).split('\n')[0] });
  });
}

/** Cierra la app, instala lo bajado y la vuelve a abrir. */
export function instalar() {
  if (estado.fase === 'lista') api?.install();
}

if (api) {
  api.on(recibir);
  api.state().then(recibir);
}
