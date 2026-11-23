// Rad · arranque del renderer.
//
// Hace entrar la raíz de la app (.rad-root) recién cuando la ventana está en su
// lugar. La ventana nace fuera de pantalla para esconder el flash del
// compositor; si el contenido entrara antes, la animación correría donde nadie
// la ve y aparecería de golpe.

import { wireAll } from './scroll.js';
import { ms, SAFETY_MS } from './motion.js';
import { whenReleased } from './ready.js';
import { wireControls } from './controls.js';
// Los tooltips se activan solos: cualquier elemento con data-rad-tip los tiene.
import './tooltip.js';

const FALLBACK_MS = 2000;
const FONTS_MAX_MS = 1500;
const capped = (promise) => Promise.race([promise, new Promise((r) => setTimeout(r, FONTS_MAX_MS))]);

// Las fuentes que eligió la app (rad.start({ fonts })). Cada una va adelante
// de la pila de la piel, que queda de reserva. Se aplica antes de entrar,
// con la raíz todavía invisible: el cambio no se ve.
function loadCss(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => { console.error(`[rad] no se pudo cargar ${href}`); resolve(); };
    document.head.append(link);
  });
}

async function applyFonts() {
  const chosen = Object.entries(window.rad?.fonts ?? {});
  if (!chosen.length) return;
  await Promise.all(chosen.filter(([, f]) => f.css).map(([, f]) => loadCss(`/@fonts/${f.css}`)));
  const root = document.documentElement;
  for (const [role, font] of chosen) {
    const name = `--rad-font-${role}`;
    const skinStack = getComputedStyle(root).getPropertyValue(name).trim();
    root.style.setProperty(name, skinStack ? `'${font.family}', ${skinStack}` : `'${font.family}'`);
  }
  // La carga explícita: document.fonts.ready no espera a una fuente que
  // todavía nadie pidió.
  await capped(Promise.all(chosen.map(([, f]) => document.fonts.load(`1em '${f.family}'`).catch(() => {}))));
}
const fontsApplied = applyFonts();

let revealed = false;
let revealing = false;
// Entra cuando la ventana está en su lugar Y la app soltó sus hold().
async function reveal() {
  if (revealing) return;
  revealing = true;
  await whenReleased();
  // Las fuentes propias (font-display: block) tienen que estar antes de
  // entrar: si llegaran después, el texto cambiaría de forma ya a la vista.
  await fontsApplied;
  await capped(document.fonts.ready);
  if (revealed) return;
  revealed = true;
  document.documentElement.setAttribute('data-rad-ready', '');
  // Cuando la entrada termina, se apaga (ver core.css). Escucha solo la de la
  // raíz: las de los hijos también burbujean hasta acá.
  const root = document.querySelector('.rad-root');
  if (!root) return;
  const settle = () => root.classList.add('is-settled');
  root.addEventListener('animationend', (e) => { if (e.target === root) settle(); });
  setTimeout(settle, ms('dur-slow') + SAFETY_MS);
}

async function boot() {
  wireAll(document);
  wireControls(document);
  const bridge = window.rad?.window;
  if (!bridge) return reveal();
  // Primero se escucha y después se pregunta: si el aviso llega entre las dos
  // cosas, no se pierde.
  bridge.onPlaced(reveal);
  if (await bridge.isPlaced()) reveal();
  setTimeout(reveal, FALLBACK_MS);
}

boot();
