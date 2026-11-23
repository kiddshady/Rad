// Rad · el aviso de actualización, listo para usar.
//
//   import { wireUpdates } from '/@core/updates.js';
//   wireUpdates();
//
// Solo aparece si hay algo que hacer (nunca un "estás al día"):
//   1. hay una versión nueva  -> toast con "Descargar" (no baja nada solo);
//   2. descargando            -> toast que se queda hasta que termina;
//   3. lista                  -> toast con "Reiniciar": instala en silencio y
//                                vuelve a abrir. Si no lo tocás, entra sola al
//                                cerrar la app.
// Los toasts de este aviso no se van solos: es algo que hay que decidir.

import { toast } from './toast.js';

export function wireUpdates({ name = window.rad?.app?.name ?? 'La app' } = {}) {
  const api = window.rad?.updates;
  if (!api) return;
  let current = null;
  let shownFor = null;

  const replace = (opts) => {
    current?.close();
    current = toast({ duration: 0, ...opts });
  };

  const handle = (u) => {
    if (!u) return;
    if (u.state === 'available' && shownFor !== `a:${u.version}`) {
      shownFor = `a:${u.version}`;
      replace({
        text: `Hay una versión nueva de ${name}: ${u.version}`,
        action: { label: 'Descargar', onClick: () => api.download() },
      });
      return;
    }
    if (u.state === 'downloading' && shownFor?.startsWith('a:')) {
      shownFor = 'd';
      replace({ text: 'Descargando la actualización…' });
      return;
    }
    if (u.state === 'ready' && shownFor !== `r:${u.version}`) {
      shownFor = `r:${u.version}`;
      replace({
        text: `La versión ${u.version} está lista`,
        kind: 'success',
        action: { label: 'Reiniciar', onClick: () => api.install() },
      });
      return;
    }
    if (u.state === 'error' && shownFor === 'd') {
      shownFor = null;
      replace({ text: 'No se pudo bajar la actualización', kind: 'danger' });
    }
  };

  api.on(handle);
  api.state().then(handle);
}
