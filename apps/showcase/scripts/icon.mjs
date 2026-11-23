// El ícono de la vitrina, horneado desde el código.
//
// La marca de Rad: un núcleo y, alrededor, un anillo, la piel. El anillo va
// en el acento y el núcleo en la tinta primaria, sobre la baldosa del fondo
// de la piel. Los colores salen de los tokens de classic: si cambian, se
// vuelve a correr esto (npm run icon -w rad-showcase).
//
// Escribe build/icon.png (1024) y build/icon.ico (16 a 256). La hoja de
// control contra los íconos de las otras apps la arma tools/icon-sheet.py.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, rasterize, sdCircle, sdRing, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIN_CSS = fs.readFileSync(path.join(APP, '..', '..', 'packages', 'skin-classic', 'tokens.css'), 'utf8');

const TILE = readToken(SKIN_CSS, 'surface-0');
const RING = readToken(SKIN_CSS, 'accent');
const CORE = readToken(SKIN_CSS, 'text-1');

// En fracción del lienzo; `s` es el diámetro del dibujo (0.62 o 0.68).
// Trazo gordo (~7 % del lienzo): a 32 px tiene que seguir leyéndose.
const glyph = (s) => {
  const stroke = 0.115 * s;
  const ringR = s / 2 - stroke / 2;
  const coreR = 0.2 * s;
  return [
    { color: RING, sd: (x, y) => sdRing(x, y, ringR, stroke / 2) },
    { color: CORE, sd: (x, y) => sdCircle(x, y, coreR) },
  ];
};

const out = path.join(APP, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, rasterize(1024, TILE, glyph)));
fs.writeFileSync(path.join(out, 'icon.ico'), encodeICO(ICO_SIZES.map((size) => ({ size, rgba: rasterize(size, TILE, glyph) }))));
console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')})`);
