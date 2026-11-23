// El ícono de Daimon, horneado desde el código. ES PROVISORIO: el de verdad
// lo va a diseñar Fran. Este está para que la ventana, la barra de tareas y
// el instalador no salgan con el de Electron.
//
// Una medialuna y un punto de luz adentro: el que acompaña. Sobre la baldosa
// estándar (a sangre, sin borde, esquinas al 19 %), con los colores de la
// piel mono. Si cambian, se vuelve a correr (npm run icon -w daimon).
//
// Escribe build/icon.png (1024) y build/icon.ico (16 a 256): cada tamaño se
// dibuja a su tamaño, ninguno es el grande achicado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, rasterize, sdCircle, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIN_CSS = fs.readFileSync(path.join(APP, '..', '..', 'packages', 'skin-mono', 'tokens.css'), 'utf8');

const TILE = readToken(SKIN_CSS, 'surface-0');
const MOON = readToken(SKIN_CSS, 'text-1');
const LIGHT = readToken(SKIN_CSS, 'accent-strong');

// En fracción del lienzo; `s` es el diámetro del dibujo (0.62 o 0.68). La
// medialuna es un disco al que otro, corrido arriba a la derecha, le saca un
// mordisco; queda gorda (un 30 % del dibujo en lo más ancho) para leerse a 16.
const glyph = (s) => {
  const cx = 0.2 * s;
  const cy = -0.1 * s;
  return [
    { color: MOON, sd: (x, y) => Math.max(sdCircle(x, y, 0.5 * s), -sdCircle(x - cx, y - cy, 0.4 * s)) },
    { color: LIGHT, sd: (x, y) => sdCircle(x - cx, y - cy, 0.14 * s) },
  ];
};

const out = path.join(APP, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, rasterize(1024, TILE, glyph)));
fs.writeFileSync(path.join(out, 'icon.ico'), encodeICO(ICO_SIZES.map((size) => ({ size, rgba: rasterize(size, TILE, glyph) }))));
console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')})`);
