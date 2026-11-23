// Rad · arranque del renderer.
//
// Hace entrar la raíz de la app (.rad-root) recién cuando la ventana está en su
// lugar. La ventana nace fuera de pantalla para esconder el flash del
// compositor; si el contenido entrara antes, la animación correría donde nadie
// la ve y aparecería de golpe.

import { wireAll } from './scroll.js';

const FALLBACK_MS = 2000;

function reveal() {
  document.documentElement.setAttribute('data-rad-ready', '');
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
