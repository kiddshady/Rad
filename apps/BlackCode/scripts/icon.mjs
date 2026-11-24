// El ícono de BlackCode, horneado desde el código: el «Cubo».
//
// Un hexágono con sus tres aristas de adentro: un cubo visto de punta. Fran
// lo eligió el 24/11/2026, cuando la app pasó a llamarse BlackCode; es la
// candidata 12 de la hoja en que se eligió el ícono anterior
// (S:\mockups\daimon\icono.html; hasta la 0.12.0 fue la 17, el «Radar»).
// El oficio es el del ícono de NTX: baldosa negra con su degradé, trazo de
// punta redonda y el resplandor en dos pasadas. Las medidas salen de esa hoja
// (un lienzo de 64) y del master de NTX (S:\tools\NTX\build\icon.svg).
//
// Desde la 0.12.3 la tinta no es blanca: es el degradé metálico del hexágono
// de UmbroSys (S:\tools\UmbroSys\tools\icono.cjs), gris arriba y casi blanco
// abajo, y el resplandor bajó a menos de la mitad. Fran lo pidió así para que
// combine con la piel mono de Rad.
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
import { hexToRgb, rasterizeGlow, gradient, gradientStops, sdSegment, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La baldosa de NTX: un degradé vertical, de arriba hacia abajo.
const TILE = gradient(hexToRgb('#1a1a1a'), hexToRgb('#0a0a0a'), [0, -0.5], [0, 0.5]);
// La tinta: el metal de UmbroSys, de arriba hacia abajo, con sus tres paradas.
const INK = [[0, hexToRgb('#7d7d7d')], [0.52, hexToRgb('#bdbdbd')], [1, hexToRgb('#f5f5f5')]];

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
// El resplandor: una pasada ancha y difusa, y otra ceñida encima, como en
// NTX pero a menos de la mitad (el de NTX es 3.86 al 42 % y 2 al 72 %).
const GLOW = [{ sigma: 2.2, opacity: 0.3 }, { sigma: 0.9, opacity: 0.6 }];

// `s` es el diámetro del dibujo (0.62 del lienzo, o 0.68 por debajo de 64
// px): las medidas de arriba son para 0.62, y todo se escala junto.
const unit = (s) => (U * s) / 0.62;

const glyph = (s) => {
  const u = unit(s);
  // De la punta de arriba del hexágono a la de abajo (13 y 51 en el lienzo de 64).
  const ink = gradientStops(INK, [0, -19 * u], [0, 19 * u]);
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
