// El ícono de BlackCode, horneado desde el código: la «Red hexagonal».
//
// Seis agentes en los vértices de un hexágono, todos conectados al núcleo.
// Fran la eligió el 24/11/2026 entre las variantes que armó con otro agente
// (la C1 de S:\mockups\daimon\variantes-hex-red.html; el original quedó
// además publicado como artifact). Las medidas salen de esa hoja (un lienzo de
// 64, con el hexágono de radio 22): el contorno fino y tenue, los rayos un
// poco más presentes, los seis nodos y el núcleo, que es lo más grande.
//
// Hasta la 0.14.1 fue el «Cubo» (un hexágono con sus tres aristas de adentro)
// y antes el «Radar». El oficio sigue siendo el de entonces, que es el del
// ícono de NTX: baldosa negra con su degradé y el resplandor en dos pasadas.
//
// Sobre la baldosa estándar (a sangre, sin borde, esquinas al 19 %). El
// dibujo es EXACTO en todos los tamaños: el mismo, con su resplandor, de 16 a
// 1024, cada uno dibujado a su tamaño. Lo único que cambia en chico es que
// ningún trazo baja de un píxel ni un nodo de dos: no es otro dibujo, es que
// más fino que eso no se pinta.
//
// Escribe build/icon.png (1024) y build/icon.ico (16 a 256). Para volver a
// hornearlo: npm run icon -w daimon.
//   --sueltos       además deja cada tamaño suelto en build/
//   --hoja <dir>    no toca build/: deja en <dir> cada variante de color a
//                   varios tamaños, para elegir mirándolas en chico

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, rasterizeGlow, gradient, gradientStops, sdSegment, sdCircle, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La baldosa de NTX: un degradé vertical, de arriba hacia abajo.
const NEGRA = gradient(hexToRgb('#1a1a1a'), hexToRgb('#0a0a0a'), [0, -0.5], [0, 0.5]);
// El metal de UmbroSys, de arriba hacia abajo, con sus tres paradas.
const METAL = [[0, hexToRgb('#7d7d7d')], [0.52, hexToRgb('#bdbdbd')], [1, hexToRgb('#f5f5f5')]];
const liso = (hex) => { const c = hexToRgb(hex); return () => c; };

// Cómo se pinta. `tinta(u)` es el color de las líneas y los nodos; `nucleo`,
// el del punto del centro; `resplandor`, las pasadas de luz (sigma en unidades
// del lienzo de 64).
const VARIANTES = {
  // El metal con el que ya venía el ícono (combina con la piel mono) y el
  // núcleo en blanco, que es lo que más luz tiene.
  metal: {
    baldosa: NEGRA,
    tinta: (u) => gradientStops(METAL, [0, -20 * u], [0, 20 * u]),
    nucleo: liso('#ffffff'),
    resplandor: [{ sigma: 2.2, opacity: 0.3 }, { sigma: 0.9, opacity: 0.6 }],
  },
  // El mismo metal con el núcleo violeta de la hoja de variantes.
  violeta: {
    baldosa: NEGRA,
    tinta: (u) => gradientStops(METAL, [0, -20 * u], [0, 20 * u]),
    nucleo: liso('#a78bfa'),
    resplandor: [{ sigma: 2.2, opacity: 0.3 }, { sigma: 0.9, opacity: 0.6 }],
  },
  // Tal cual la hoja de variantes: su baldosa, su tinta y su violeta, sin luz.
  hoja: {
    baldosa: liso('#15171f'),
    tinta: () => liso('#ece9f5'),
    nucleo: liso('#a78bfa'),
    resplandor: [],
  },
};
const VARIANTE = 'metal';

// Las medidas de la hoja (hexágono de radio 22 en un lienzo de 64), llevadas
// a que el dibujo ENTERO, con sus nodos, ocupe el 62 % del lienzo.
const DE_LA_HOJA = { radio: 22, nodo: 3.6, nucleo: 6.5, trazo: 2 };
const AFUERA = (64 * 0.62) / 2;                               // hasta dónde llega el dibujo
const K = AFUERA / (DE_LA_HOJA.radio + DE_LA_HOJA.nodo);
const RADIO = DE_LA_HOJA.radio * K;
const NODO = DE_LA_HOJA.nodo * K;
const NUCLEO = DE_LA_HOJA.nucleo * K;
const TRAZO = DE_LA_HOJA.trazo * K;
// Cuánto se ve cada línea contra la baldosa, como en la hoja.
const CONTORNO = 0.45;
const RAYOS = 0.75;
// Los pisos, en píxeles de verdad: lo que en chico ya no se pintaría.
const PISO_TRAZO = 1;    // ancho de una línea
const PISO_NODO = 1.15;  // radio de un nodo
const PISO_NUCLEO = 2;   // radio del núcleo

// Los seis vértices, desde arriba y en el sentido del reloj.
const VERTICES = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 90);
  return [RADIO * Math.cos(a), RADIO * Math.sin(a)];
});

// `s` es el diámetro del dibujo (0.62 del lienzo, o 0.68 por debajo de 64 px):
// las medidas de arriba son para 0.62, y todo se escala junto.
const unit = (s) => s / 0.62 / 64;
// Una tinta al tanto por uno `k` sobre la baldosa (las capas no llevan alfa).
const tenue = (tinta, baldosa, k) => (x, y) => { const t = tinta(x, y); const b = baldosa(x, y); return [0, 1, 2].map((i) => b[i] + (t[i] - b[i]) * k); };

const glyph = (v, size) => (s) => {
  const u = unit(s);
  const px = 1 / size;
  const tinta = v.tinta(u);
  const medio = Math.max((TRAZO / 2) * u, (PISO_TRAZO / 2) * px);
  const nodo = Math.max(NODO * u, PISO_NODO * px);
  const nucleo = Math.max(NUCLEO * u, PISO_NUCLEO * px);
  const p = VERTICES.map(([x, y]) => [x * u, y * u]);
  return [
    // el contorno, tenue
    ...p.map((a, i) => { const b = p[(i + 1) % 6]; return { color: tenue(tinta, v.baldosa, CONTORNO), sd: (x, y) => sdSegment(x, y, a[0], a[1], b[0], b[1], medio) }; }),
    // los rayos: del núcleo a cada agente
    ...p.map((a) => ({ color: tenue(tinta, v.baldosa, RAYOS), sd: (x, y) => sdSegment(x, y, 0, 0, a[0], a[1], medio) })),
    // los seis agentes
    ...p.map((a) => ({ color: tinta, sd: (x, y) => sdCircle(x - a[0], y - a[1], nodo) })),
    // el núcleo
    { color: v.nucleo, sd: (x, y) => sdCircle(x, y, nucleo) },
  ];
};
const glow = (v) => (s) => v.resplandor.map((g) => ({ sigma: g.sigma * unit(s), opacity: g.opacity }));

const draw = (size, nombre = VARIANTE) => { const v = VARIANTES[nombre]; return rasterizeGlow(size, v.baldosa, glyph(v, size), glow(v)); };

const hoja = process.argv.indexOf('--hoja');
if (hoja > 0) {
  const dir = path.resolve(process.argv[hoja + 1]);
  fs.mkdirSync(dir, { recursive: true });
  for (const nombre of Object.keys(VARIANTES)) {
    for (const size of [16, 24, 32, 48, 64, 256]) fs.writeFileSync(path.join(dir, `${nombre}-${size}.png`), encodePNG(size, draw(size, nombre)));
  }
  console.log(`hoja: ${Object.keys(VARIANTES).join(', ')} en ${dir}`);
} else {
  const out = path.join(APP, 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), encodePNG(1024, draw(1024)));
  fs.writeFileSync(path.join(out, 'icon.ico'), encodeICO(ICO_SIZES.map((size) => ({ size, rgba: draw(size) }))));
  // Para mirarlo en chico, al lado de otros: cada tamaño del .ico, suelto.
  if (process.argv.includes('--sueltos')) {
    for (const size of [16, 24, 32, 48, 64, 256]) fs.writeFileSync(path.join(out, `icon-${size}.png`), encodePNG(size, draw(size)));
  }
  console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')}), variante ${VARIANTE}`);
}
