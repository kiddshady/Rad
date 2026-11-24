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
import { t } from './strings.js';

export function wireUpdates({ name = window.rad?.app?.name ?? t.theApp } = {}) {
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
        text: t.updateAvailable(name, u.version),
        action: { label: t.download, onClick: () => api.download() },
      });
      return;
    }
    if (u.state === 'downloading' && shownFor?.startsWith('a:')) {
      shownFor = 'd';
      replace({ text: t.downloading });
      return;
    }
    if (u.state === 'ready' && shownFor !== `r:${u.version}`) {
      shownFor = `r:${u.version}`;
      replace({
        text: t.updateReady(u.version),
        kind: 'success',
        action: { label: t.restart, onClick: () => api.install() },
      });
      return;
    }
    if (u.state === 'error' && shownFor === 'd') {
      shownFor = null;
      replace({ text: t.updateFailed, kind: 'danger' });
    }
  };

  api.on(handle);
  api.state().then(handle);
}
