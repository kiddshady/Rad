// La vitrina: arma el shell del núcleo con una vista por familia de tokens.

// Desde JS el núcleo se importa con la ruta absoluta /@core/…: un nombre
// suelto como '@core/shell.js' necesitaría un import map, que es un script
// inline y la CSP no lo deja pasar.
import { createShell } from '/@core/shell.js';

const icon = (paths) => `<svg viewBox="0 0 16 16" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const fromTemplate = (id) => (el) => {
  el.append(document.getElementById(id).content.cloneNode(true));
};

const views = [
  {
    id: 'planos',
    label: 'Planos',
    icon: icon('<rect x="2.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M5.5 5.5V4A1.5 1.5 0 0 1 7 2.5h5A1.5 1.5 0 0 1 13.5 4v5a1.5 1.5 0 0 1-1.5 1.5h-1.5"/>'),
    mount: fromTemplate('view-planos'),
  },
  {
    id: 'texto',
    label: 'Texto',
    icon: icon('<path d="M3 4h10M3 8h10M3 12h6"/>'),
    mount: fromTemplate('view-texto'),
  },
  {
    id: 'acento',
    label: 'Acento y estado',
    icon: icon('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>'),
    mount: fromTemplate('view-acento'),
  },
  {
    id: 'forma',
    label: 'Forma',
    icon: icon('<rect x="2.5" y="2.5" width="11" height="11" rx="3.5"/>'),
    mount: fromTemplate('view-forma'),
  },
  {
    id: 'movimiento',
    label: 'Movimiento',
    icon: icon('<path d="M2.5 8h8M7.5 4.5 11 8l-3.5 3.5M13.5 4v8"/>'),
    mount(el) {
      fromTemplate('view-movimiento')(el);
      const card = el.querySelector('.sc-motion');
      el.querySelector('[data-demo="toggle"]').addEventListener('click', () => card.classList.toggle('is-open'));
      let i = 0;
      el.querySelector('[data-demo="status"]').addEventListener('click', () => {
        i = (i + 1) % MESSAGES.length;
        shell.status.set('right', MESSAGES[i]);
      });
    },
  },
];

const skin = window.rad?.skin?.name ?? 'sin piel';
const core = window.rad?.core?.version ?? '';
const MESSAGES = [`${skin} · núcleo ${core}`, 'Guardado', '3 cambios sin guardar', 'Sincronizando…'];

const shell = createShell({
  root: document.querySelector('.rad-root'),
  title: 'Rad',
  subtitle: skin.toLowerCase(),
  views,
});

shell.status.set('left', views.find((v) => v.id === shell.router.current).label);
shell.status.set('right', MESSAGES[0]);
shell.router.on('change', ({ label }) => shell.status.set('left', label));
