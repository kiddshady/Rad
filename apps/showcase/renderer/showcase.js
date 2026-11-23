// La vitrina: arma el shell del núcleo con una vista por familia de tokens.

// Desde JS el núcleo se importa con la ruta absoluta /@core/…: un nombre
// suelto como '@core/shell.js' necesitaría un import map, que es un script
// inline y la CSP no lo deja pasar.
import { createShell } from '/@core/shell.js';
import { menuButton } from '/@core/menu.js';
import { openModal, confirm } from '/@core/modal.js';
import { toast } from '/@core/toast.js';
import { openDoc } from '/@core/store.js';
import { hold } from '/@core/ready.js';
import { createSelect, setFieldError } from '/@core/controls.js';
import { wireUpdates } from '/@core/updates.js';
import { ms, token } from '/@core/motion.js';
import { setBusy } from '/@core/busy.js';

// La interfaz se arma después de leer los datos: el arranque espera.
const release = hold();

// Cada arranque suma una visita: muestra que el documento sobrevive al cierre.
const visitas = await openDoc('visitas', { veces: 0 });
visitas.update((v) => ({ veces: v.veces + 1 }));
const nota = await openDoc('nota', { texto: '' });

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
    id: 'controles',
    label: 'Controles',
    icon: icon('<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>'),
    mount(el) {
      fromTemplate('view-controles')(el);
      const form = el.querySelector('[data-demo="form"]');
      // El texto del botón no se lee con textContent: durante el relevo tiene
      // las dos opciones adentro. Se busca la etiqueta por valor.
      const TURNOS = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche', guardia: 'Guardia de 24 h' };
      const turno = createSelect({
        label: 'Turno',
        options: [
          { value: 'manana', label: 'Mañana' },
          { value: 'tarde', label: 'Tarde' },
          { value: 'noche', label: 'Noche' },
          { value: 'guardia', label: 'Guardia de 24 h', disabled: true },
        ],
        value: 'manana',
        onChange: (v) => toast({ text: `Turno: ${TURNOS[v]}` }),
      });
      turno.el.setAttribute('aria-labelledby', 'sc-turno-label');
      el.querySelector('[data-demo="turno"]').replaceWith(turno.el);
      el._radSelect = turno; // para el humo

      const nombre = el.querySelector('[data-demo="nombre"]');
      const correo = el.querySelector('[data-demo="correo"]');
      const check = () => {
        const errs = [];
        if (!nombre.value.trim()) { setFieldError(nombre.closest('.rad-field'), 'Falta el nombre.'); errs.push('nombre'); }
        else setFieldError(nombre.closest('.rad-field'), null);
        if (correo.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.value)) { setFieldError(correo.closest('.rad-field'), 'Ese correo no parece válido.'); errs.push('correo'); }
        else setFieldError(correo.closest('.rad-field'), null);
        return errs;
      };
      nombre.addEventListener('input', () => { if (nombre.closest('[data-invalid]')) check(); });
      correo.addEventListener('input', () => { if (correo.closest('[data-invalid]')) check(); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const errs = check();
        if (errs.length) toast({ text: 'Revisá los campos marcados', kind: 'warning' });
        else toast({ text: `Guardado: ${nombre.value.trim()}, turno ${TURNOS[turno.value]}`, kind: 'success' });
      });
      form.addEventListener('reset', () => {
        setFieldError(nombre.closest('.rad-field'), null);
        setFieldError(correo.closest('.rad-field'), null);
        turno.set('manana');
      });
      const pin = el.querySelector('[data-demo="pin"]');
      pin.addEventListener('click', () => {
        const on = pin.getAttribute('aria-pressed') !== 'true';
        pin.setAttribute('aria-pressed', String(on));
        pin.setAttribute('data-rad-tip', on ? 'Desfijar' : 'Fijar');
      });
    },
  },
  {
    id: 'datos',
    label: 'Datos',
    icon: icon('<ellipse cx="8" cy="4" rx="5" ry="1.75"/><path d="M3 4v8c0 1 2.2 1.75 5 1.75S13 13 13 12V4M3 8c0 1 2.2 1.75 5 1.75S13 9 13 8"/>'),
    mount(el) {
      fromTemplate('view-datos')(el);
      const area = el.querySelector('#sc-nota');
      area.value = nota.get().texto;
      area.addEventListener('input', () => nota.patch({ texto: area.value }));
      const n = visitas.get().veces;
      el.querySelector('[data-demo="visitas"]').textContent = n === 1
        ? 'Es la primera vez que abrís Rad.'
        : `Abriste Rad ${n} veces.`;
      const facts = el.querySelector('[data-demo="info"]');
      window.rad?.invoke('sistema:info').then((info) => {
        const rows = [['Rad', info.vitrina], ['Electron', info.electron], ['Chromium', info.chromium], ['Node', info.node], ['Datos', info.datos]];
        for (const [k, v] of rows) {
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.className = 'rad-mono';
          dd.textContent = v;
          facts.append(dt, dd);
        }
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

      // Cargando: cada cosa trabaja unos segundos y avisa. El switch deja
      // todo prendido, para mirarlo tranquilo.
      const bar = el.querySelector('[data-demo="ask"]');
      const input = el.querySelector('[data-demo="ask-input"]');
      const busyCard = el.querySelector('[data-demo="busy-card"]');
      const self = el.querySelector('[data-demo="busy-self"]');
      const hold = el.querySelector('[data-demo="busy-hold"]');
      const timers = new Map();
      const work = (target, done) => {
        setBusy(target, true);
        clearTimeout(timers.get(target));
        timers.set(target, setTimeout(() => {
          if (hold.checked) return;
          setBusy(target, false);
          done?.();
        }, 4000));
      };
      const ask = () => {
        if (!input.value.trim()) { input.focus(); return; }
        work(bar, () => toast({ text: 'Respondido', kind: 'success' }));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
      el.querySelector('[data-demo="ask-send"]').addEventListener('click', ask);
      el.querySelector('[data-demo="busy-card-go"]').addEventListener('click', () => work(busyCard));
      self.addEventListener('click', () => work(self, () => toast({ text: 'Guardado', kind: 'success' })));
      hold.addEventListener('change', () => {
        for (const target of [bar, busyCard, self]) {
          clearTimeout(timers.get(target));
          setBusy(target, hold.checked);
        }
      });
    },
  },
  {
    id: 'pieles',
    label: 'Pieles',
    icon: icon('<path d="M8 2.5c2.6 3 4 4.9 4 6.9a4 4 0 0 1-8 0c0-2 1.4-3.9 4-6.9z"/>'),
    mount(el) {
      fromTemplate('view-pieles')(el);
      const list = el.querySelector('[data-demo="pieles"]');
      window.rad?.invoke('pieles:listar').then((skins) => {
        for (const s of skins) list.append(skinCard(s));
      });
    },
  },
];

// Una tarjeta por piel: sus colores, su nombre y cómo usarla.
function skinCard(s) {
  const card = document.createElement('article');
  card.className = 'sc-card sc-skin';
  card.dataset.skin = s.id;
  card.toggleAttribute('data-active', s.active);

  const swatches = document.createElement('div');
  swatches.className = 'sc-skin-swatches';
  swatches.setAttribute('aria-hidden', 'true');
  for (const color of s.preview) {
    const i = document.createElement('i');
    i.style.backgroundColor = color; // por CSSOM: la CSP no deja estilos en atributos
    swatches.append(i);
  }

  const text = document.createElement('div');
  text.className = 'sc-skin-text';
  const name = document.createElement('h2');
  name.textContent = s.name;
  const desc = document.createElement('p');
  desc.textContent = s.description;
  text.append(name, desc);
  card.append(swatches, text);

  if (s.active) {
    const chip = document.createElement('span');
    chip.className = 'sc-chip';
    chip.textContent = 'En uso';
    card.append(chip);
  } else {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'rad-button';
    use.textContent = 'Usar esta piel';
    use.addEventListener('click', async () => {
      const yes = await confirm({
        title: `¿Cambiar a ${s.name}?`,
        text: 'Rad se cierra y vuelve a abrir con esa piel.',
        confirmLabel: 'Cambiar',
      });
      if (!yes) return;
      // La app se va antes de cerrar la ventana: nada desaparece de golpe.
      const dur = ms('dur-base');
      document.querySelector('.rad-root').animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: token('ease-in-out'), fill: 'forwards' });
      await new Promise((r) => setTimeout(r, dur + 60));
      window.rad.invoke('pieles:usar', s.id);
    });
    card.append(use);
  }
  return card;
}

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
wireUpdates({ name: 'Rad' });
release();
