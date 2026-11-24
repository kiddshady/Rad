// El ícono de BlackCode, horneado desde el código: el «Cubo».
//
// Un hexágono con sus tres aristas de adentro: un cubo visto de punta. Fran
// lo eligió el 24/11/2026, cuando la app pasó a llamarse BlackCode; es la
// candidata 12 de la hoja en que se eligió el ícono anterior
// (S:\mockups\daimon\icono.html; hasta la 0.12.0 fue la 17, el «Radar»).
// El oficio es el del ícono de NTX, tal cual: baldosa negra con su degradé,
// tinta blanca de punta redonda, y el resplandor en dos pasadas. Los números
// salen de esa hoja (un lienzo de 64) y del master de NTX
// (S:\tools\NTX\build\icon.svg).
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
import { hexToRgb, rasterizeGlow, gradient, sdSegment, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La baldosa de NTX: un degradé vertical, de arriba hacia abajo.
const TILE = gradient(hexToRgb('#1a1a1a'), hexToRgb('#0a0a0a'), [0, -0.5], [0, 0.5]);
// La tinta: blanca, con un aliento de gris hacia abajo a la derecha.
const INK = [hexToRgb('#ffffff'), hexToRgb('#dcdce0')];

// Las medidas, en el lienzo de 64 de la hoja de candidatas (el centro es 32, 32).
const U = 1 / 64;
const STROKE = 4.4; // grosor del trazo, el de NTX
// Los seis vértices del hexágono, desde arriba y en el sentido del reloj…
const HEX = [[32, 13], [48.45, 22.5], [48.45, 41.5], [32, 51], [15.55, 41.5], [15.55, 22.5]];
// …y las tres aristas de adentro: del centro a los dos vértices de arriba a
// los costados y al de abajo.
const CENTRO = [32, 32];
const ADENTRO = [HEX[5], HEX[1], HEX[3]];
const ARISTAS = [
  ...HEX.map((p, i) => [p, HEX[(i + 1) % HEX.length]]),
  ...ADENTRO.map((p) => [CENTRO, p]),
];
// El resplandor de NTX: una pasada ancha y difusa, y otra ceñida encima.
const GLOW = [{ sigma: 3.86, opacity: 0.42 }, { sigma: 2, opacity: 0.72 }];

// `s` es el diámetro del dibujo (0.62 del lienzo, o 0.68 por debajo de 64
// px): las medidas de arriba son para 0.62, y todo se escala junto.
const unit = (s) => (U * s) / 0.62;

const glyph = (s) => {
  const u = unit(s);
  const ink = gradient(INK[0], INK[1], [-18 * u, -18 * u], [18 * u, 16 * u]);
  const half = (STROKE / 2) * u;
  const en = ([px, py]) => [(px - 32) * u, (py - 32) * u];
  return ARISTAS.map(([a, b]) => {
    const [ax, ay] = en(a);
    const [bx, by] = en(b);
    return { color: ink, sd: (x, y) => sdSegment(x, y, ax, ay, bx, by, half) };
  });
};
const glow = (s) => GLOW.map((g) => ({ sigma: g.sigma * unit(s), opacity: g.opacity }));

const draw = (size) => rasterizeGlow(size, TILE, glyph, glow);

const out = path.join(APP, 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, draw(1024)));
fs.writeFileSync(path.join(out, 'icon.ico'), encodeICO(ICO_SIZES.map((size) => ({ size, rgba: draw(size) }))));
// Para mirarlo en chico, al lado de otros: cada tamaño del .ico, suelto.
if (process.argv.includes('--sueltos')) {
  for (const size of [16, 24, 32, 48, 64, 256]) fs.writeFileSync(path.join(out, `icon-${size}.png`), encodePNG(size, draw(size)));
}
console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')})`);
