// La vitrina: arma el shell del núcleo con una vista por familia de tokens.

// Desde JS el núcleo se importa con la ruta absoluta /@core/…: un nombre
// suelto como '@core/shell.js' necesitaría un import map, que es un script
// inline y la CSP no lo deja pasar.
import { createShell } from '/@core/shell.js';
import { menuButton } from '/@core/menu.js';
import { openModal, confirm } from '/@core/modal.js';
import { toast } from '/@core/toast.js';

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
    id: 'capas',
    label: 'Capas',
    icon: icon('<path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5z"/><path d="m2.5 8.5 5.5 3 5.5-3M2.5 11 8 14l5.5-3"/>'),
    mount(el) {
      fromTemplate('view-capas')(el);
      const done = (label) => toast({ text: `Elegiste: ${label}` });
      menuButton(el.querySelector('[data-demo="menu"]'), () => [
        { id: 'dup', label: 'Duplicar', shortcut: 'Ctrl+D', icon: icon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'), onSelect: (i) => done(i.label) },
        { id: 'ren', label: 'Renombrar', shortcut: 'F2', icon: icon('<path d="M10.5 2.5l3 3-8 8h-3v-3z"/>'), onSelect: (i) => done(i.label) },
        { id: 'mov', label: 'Mover a otra carpeta', disabled: true, icon: icon('<path d="M2.5 4.5v8h11v-6.5H8L6.5 4.5z"/>') },
        { separator: true },
        { id: 'del', label: 'Eliminar', shortcut: 'Supr', danger: true, icon: icon('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/>'), onSelect: (i) => done(i.label) },
      ]);
      el.querySelector('[data-demo="modal"]').addEventListener('click', async () => {
        const m = openModal({
          title: 'Un modal',
          body: 'La app de atrás queda inerte, el Tab da vueltas adentro y Escape lo cierra. Al cerrarlo, el foco vuelve al botón que lo abrió.',
          actions: [
            { id: 'cancel', label: 'Cancelar' },
            { id: 'ok', label: 'Entendido', variant: 'primary' },
          ],
        });
        const r = await m.closed;
        toast({ text: r === 'ok' ? 'Lo cerraste con Entendido' : r === 'cancel' ? 'Lo cerraste con Cancelar' : 'Lo cerraste sin elegir' });
      });
      el.querySelector('[data-demo="confirm"]').addEventListener('click', async () => {
        const yes = await confirm({
          title: '¿Eliminar la carpeta?',
          text: 'Se van a borrar 12 archivos. Esto no se puede deshacer.',
          confirmLabel: 'Eliminar',
          danger: true,
        });
        toast({ text: yes ? 'Carpeta eliminada' : 'No se borró nada', kind: yes ? 'danger' : 'info' });
      });
      const texts = { info: 'Hay una versión nueva', success: 'Guardado', warning: 'Quedan 3 cambios sin guardar', danger: 'No se pudo conectar' };
      el.querySelectorAll('[data-demo="toast"]').forEach((b) => {
        b.addEventListener('click', () => toast({ text: texts[b.dataset.kind], kind: b.dataset.kind }));
      });
      el.querySelector('[data-demo="undo"]').addEventListener('click', () => {
        toast({ text: 'Se archivó la nota', action: { label: 'Deshacer', onClick: () => toast({ text: 'Volvió a su lugar', kind: 'success' }) } });
      });
      el.querySelector('[data-demo="burst"]').addEventListener('click', () => {
        const kinds = ['info', 'success', 'warning', 'danger', 'info'];
        kinds.forEach((k, i) => setTimeout(() => toast({ text: `Toast número ${i + 1}`, kind: k }), i * 180));
      });
    },
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
