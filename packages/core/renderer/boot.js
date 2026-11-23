// Rad · arranque del renderer.
//
// Hace entrar la raíz de la app (.rad-root) recién cuando la ventana está en su
// lugar. La ventana nace fuera de pantalla para esconder el flash del
// compositor; si el contenido entrara antes, la animación correría donde nadie
// la ve y aparecería de golpe.

import { wireAll } from './scroll.js';
import { ms, SAFETY_MS } from './motion.js';
import { whenReleased } from './ready.js';
// Los tooltips se activan solos: cualquier elemento con data-rad-tip los tiene.
import './tooltip.js';

const FALLBACK_MS = 2000;
const FONTS_MAX_MS = 1500;

let revealed = false;
let revealing = false;
// Entra cuando la ventana está en su lugar Y la app soltó sus hold().
async function reveal() {
  if (revealing) return;
  revealing = true;
  await whenReleased();
  // Las fuentes propias (font-display: block) tienen que estar antes de
  // entrar: si llegaran después, el texto cambiaría de forma ya a la vista.
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, FONTS_MAX_MS))]);
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
  const bridge = window.rad?.window;
  if (!bridge) return reveal();
  // Primero se escucha y después se pregunta: si el aviso llega entre las dos
  // cosas, no se pierde.
  bridge.onPlaced(reveal);
  if (await bridge.isPlaced()) reveal();
  setTimeout(reveal, FALLBACK_MS);
}

boot();
