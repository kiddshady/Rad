// El ícono de Daimon, horneado desde el código: el «Radar».
//
// Dos aros cortados en lados opuestos y un punto en el centro: una presencia
// detectada. Lo eligió Fran el 23/11/2026 entre diecisiete candidatas
// (S:\mockups\daimon\icono.html, la número 17), con el oficio del ícono de
// NTX tal cual: baldosa negra con su degradé, tinta blanca de punta redonda,
// y el resplandor en dos pasadas. Los números salen de esa hoja (un lienzo
// de 64) y del master de NTX (S:\tools\NTX\build\icon.svg).
//
// Sobre la baldosa estándar (a sangre, sin borde, esquinas al 19 %). El
// dibujo es EXACTO en todos los tamaños: el mismo, con su resplandor, de 16
// a 1024, cada uno dibujado a su tamaño.
//
// Escribe build/icon.png (1024) y build/icon.ico (16 a 256). Para volver a
// hornearlo: npm run icon -w daimon.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, rasterizeGlow, gradient, sdArc, sdCircle, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La baldosa de NTX: un degradé vertical, de arriba hacia abajo.
const TILE = gradient(hexToRgb('#1a1a1a'), hexToRgb('#0a0a0a'), [0, -0.5], [0, 0.5]);
// La tinta: blanca, con un aliento de gris hacia abajo a la derecha.
const INK = [hexToRgb('#ffffff'), hexToRgb('#dcdce0')];

// Las medidas, en el lienzo de 64 de la hoja de candidatas.
const U = 1 / 64;
const OUTER = 18;      // radio del aro de afuera
const INNER = 10;      // radio del aro de adentro
const STROKE = 4.4;    // grosor del trazo, el de NTX
const CORE = 3.4;      // radio del punto
const GAP = 60;        // lo que le falta a cada aro, en grados
// El resplandor de NTX: una pasada ancha y difusa, y otra ceñida encima.
const GLOW = [{ sigma: 3.86, opacity: 0.42 }, { sigma: 2, opacity: 0.72 }];

// `s` es el diámetro del dibujo (0.62 del lienzo, o 0.68 por debajo de 64
// px): las medidas de arriba son para 0.62, y todo se escala junto.
const unit = (s) => (U * s) / 0.62;

const glyph = (s) => {
  const u = unit(s);
  const ink = gradient(INK[0], INK[1], [-18 * u, -18 * u], [18 * u, 16 * u]);
  const half = (STROKE / 2) * u;
  // El hueco del aro de afuera mira arriba a la derecha (45°); el del de
  // adentro, al lado opuesto (225°).
  return [
    { color: ink, sd: (x, y) => sdArc(x, y, OUTER * u, 45 + GAP / 2, 405 - GAP / 2, half) },
    { color: ink, sd: (x, y) => sdArc(x, y, INNER * u, 225 + GAP / 2, 585 - GAP / 2, half) },
    { color: ink, sd: (x, y) => sdCircle(x, y, CORE * u) },
  ];
};
const glow = (s) => GLOW.map((g) => ({ sigma: g.sigma * unit(s), opacity: g.opacity }));

const draw = (size) => rasterizeGlow(size, TILE, glyph, glow);

const out = path.join(APP, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, draw(1024)));
fs.writeFileSync(path.join(out, 'icon.ico'), encodeICO(ICO_SIZES.map((size) => ({ size, rgba: draw(size) }))));
console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')})`);
