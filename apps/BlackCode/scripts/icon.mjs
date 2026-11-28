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
// Escribe build/icon.png (1024) y build/icon.ico (16 a 256), y el ícono de la
// bandeja del sistema (build/tray.ico y build/tray-dark.ico; ver más abajo).
// Para volver a hornearlo: npm run icon -w blackcode.
//   --sueltos       además deja cada tamaño suelto en build/
//   --hoja <dir>    no toca build/: deja en <dir> cada variante de color a
//                   varios tamaños, para elegir mirándolas en chico

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, rasterizeGlow, rasterizeBare, gradient, gradientStops, sdSegment, sdCircle, encodePNG, encodeICO, ICO_SIZES } from '../../../tools/icon-kit.mjs';

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

// ---------- El ícono de la bandeja del sistema ----------
//
// SIN baldosa (es la excepción a la regla de los íconos de Fran: en la bandeja
// va suelto sobre la barra, como los del sistema), y con el dibujo ENTERO del
// ícono común: el contorno, los rayos, los seis agentes y el núcleo. La primera
// versión (1.0.0) llevaba solo el núcleo y los agentes, porque a 16 px las
// líneas casi no se leen; Fran la vio en su barra y la quiso así igual: «se ve
// feo con los puntos solos… no importa que no se llegue a notar tanto» (1.3.0).
// Ocupa el lienzo entero (no hay baldosa que le pida margen) y va sin
// resplandor: sobre transparente sería un halo borroso. Las líneas conservan
// lo tenue que son en el ícono (el contorno más que los rayos), dejándose ver a
// través en vez de aclararse contra la baldosa.
//
// Son dos archivos porque la barra de Windows puede ser oscura o clara:
// tray.ico (dibujo claro, para la barra oscura) y tray-dark.ico (dibujo
// oscuro, para la clara). La app elige cuál según el tema de Windows. El claro
// lleva el metal del ícono común con el núcleo blanco; el oscuro, una sola
// tinta (el metal claro no se vería sobre una barra clara).
const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64];
// (el metal de arriba hacia abajo, a lo alto del lienzo entero)
const TRAY_CLARO = { tinta: gradientStops(METAL, [0, -0.5], [0, 0.5]), nucleo: liso('#ffffff') };
const TRAY_OSCURO = { tinta: liso('#141414'), nucleo: liso('#141414') };
// Mientras dura una conversación por el micrófono de la PC, el ícono lleva un
// punto rojo de grabación abajo a la derecha (lo eligió Fran en su maqueta,
// Documents\BlackCode-mockups\voz-senales.html, 28/11/2026). El dibujo va
// entero; alrededor del punto, un aro transparente lo separa de la punta que
// pisa, sobre la barra que sea. El rojo es el de peligro de la piel mono, uno
// más hondo para la barra clara.
const REC = { radio: 0.121, aro: 0.166, centro: 0.354 };
const conRec = (v, rojo) => ({ ...v, rec: liso(rojo) });
const TRAY_CLARO_REC = conRec(TRAY_CLARO, '#ef4f58');
const TRAY_OSCURO_REC = conRec(TRAY_OSCURO, '#e03a44');
const trayGlyph = (size, v) => () => {
  const px = 1 / size;
  // Las proporciones del ícono común, llevadas a que el dibujo llene el lienzo;
  // y sus mismos pisos: una línea nunca baja de un píxel, ni un agente de 1,15
  // de radio, ni el núcleo de 2.
  const k0 = 0.5 / (DE_LA_HOJA.radio + DE_LA_HOJA.nodo);
  const nodo = Math.max(DE_LA_HOJA.nodo * k0, PISO_NODO * px);
  const nucleo = Math.max(DE_LA_HOJA.nucleo * k0, PISO_NUCLEO * px);
  const medio = Math.max((DE_LA_HOJA.trazo / 2) * k0, (PISO_TRAZO / 2) * px);
  const radio = 0.5 - nodo - 0.5 * px;         // los agentes llegan al borde del lienzo
  const p = VERTICES.map(([x, y]) => [x * radio / RADIO, y * radio / RADIO]);
  return [
    // el contorno, tenue
    ...p.map((a, i) => { const b = p[(i + 1) % 6]; return { color: v.tinta, alpha: CONTORNO, sd: (x, y) => sdSegment(x, y, a[0], a[1], b[0], b[1], medio) }; }),
    // los rayos: del núcleo a cada agente
    ...p.map((a) => ({ color: v.tinta, alpha: RAYOS, sd: (x, y) => sdSegment(x, y, 0, 0, a[0], a[1], medio) })),
    // los seis agentes
    ...p.map((a) => ({ color: v.tinta, sd: (x, y) => sdCircle(x - a[0], y - a[1], nodo) })),
    // el núcleo
    { color: v.nucleo, sd: (x, y) => sdCircle(x, y, nucleo) },
    // el punto de grabación, con su aro que borra (sin piso: a 16 px ya mide casi 2 de radio)
    ...(v.rec ? [
      { erase: true, sd: (x, y) => sdCircle(x - REC.centro, y - REC.centro, REC.aro) },
      { color: v.rec, sd: (x, y) => sdCircle(x - REC.centro, y - REC.centro, REC.radio) },
    ] : []),
  ];
};
const drawTray = (size, v) => rasterizeBare(size, trayGlyph(size, v));
const MARCA_PX = 368;

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
  fs.writeFileSync(path.join(out, 'tray.ico'), encodeICO(TRAY_SIZES.map((size) => ({ size, rgba: drawTray(size, TRAY_CLARO) }))));
  fs.writeFileSync(path.join(out, 'tray-dark.ico'), encodeICO(TRAY_SIZES.map((size) => ({ size, rgba: drawTray(size, TRAY_OSCURO) }))));
  fs.writeFileSync(path.join(out, 'tray-rec.ico'), encodeICO(TRAY_SIZES.map((size) => ({ size, rgba: drawTray(size, TRAY_CLARO_REC) }))));
  fs.writeFileSync(path.join(out, 'tray-dark-rec.ico'), encodeICO(TRAY_SIZES.map((size) => ({ size, rgba: drawTray(size, TRAY_OSCURO_REC) }))));
  // La marca de la pantalla de inicio: el mismo dibujo sin baldosa de la
  // bandeja (el claro), grande. Se ve a 92 px; va a 368 para que quede nítida
  // con la pantalla al 200 % y más.
  fs.writeFileSync(path.join(APP, 'renderer', 'marca.png'), encodePNG(MARCA_PX, drawTray(MARCA_PX, TRAY_CLARO)));
  // Para mirarlo en chico, al lado de otros: cada tamaño del .ico, suelto.
  if (process.argv.includes('--sueltos')) {
    for (const size of [16, 24, 32, 48, 64, 256]) fs.writeFileSync(path.join(out, `icon-${size}.png`), encodePNG(size, draw(size)));
    for (const size of [16, 24, 32]) fs.writeFileSync(path.join(out, `tray-${size}.png`), encodePNG(size, drawTray(size, TRAY_CLARO)));
    for (const size of [16, 24, 32]) fs.writeFileSync(path.join(out, `tray-rec-${size}.png`), encodePNG(size, drawTray(size, TRAY_CLARO_REC)));
    for (const size of [16, 24, 32]) fs.writeFileSync(path.join(out, `tray-dark-rec-${size}.png`), encodePNG(size, drawTray(size, TRAY_OSCURO_REC)));
  }
  console.log(`ícono: build/icon.png (1024) y build/icon.ico (${ICO_SIZES.join(', ')}), variante ${VARIANTE}; bandeja: build/tray.ico, tray-dark.ico y sus -rec (${TRAY_SIZES.join(', ')})`);
}
