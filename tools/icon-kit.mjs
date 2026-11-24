// Rad · el kit para hornear íconos de las apps, sin dependencias.
//
// La baldosa estándar de Fran (skill dark-app-aesthetics, §12): a sangre (el
// 100 % del lienzo), sin borde ni canto, esquinas al 19 % del lado, relleno
// plano con el fondo de la app. El dibujo ocupa el 62 % del lienzo (68 % por
// debajo de 64 px) y es EXACTO en todos los tamaños: cada tamaño se dibuja a
// su tamaño, nunca se achica el grande, y nunca se simplifica.
//
// Todo es geometría con distancia con signo, con antialias por la distancia
// y supersampleo 3x3: los bordes salen limpios a 16 px y a 1024.
//
// El .ico lleva los tamaños de 128 para arriba como PNG embebido y los chicos
// como DIB de 32 bits: GDI+ no lee una entrada de 256 en DIB.

import zlib from 'node:zlib';

// ---------- Color ----------

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Lee un token --rad-<name> (#rrggbb) del CSS de una piel. */
export function readToken(css, name) {
  const m = css.match(new RegExp(`--rad-${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`no encontré --rad-${name} como #rrggbb`);
  return hexToRgb(m[1]);
}

// ---------- Distancias con signo (en fracción del lienzo, centro en 0,0) ----------

export const sdCircle = (x, y, r) => Math.hypot(x, y) - r;
export const sdRing = (x, y, r, halfWidth) => Math.abs(Math.hypot(x, y) - r) - halfWidth;
export function sdRoundRect(x, y, half, radius) {
  const qx = Math.abs(x) - half + radius;
  const qy = Math.abs(y) - half + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Un arco de trazo con las puntas redondas. Los ángulos van en grados, en
 * sentido antihorario y con el 0 a la derecha (como en un transportador:
 * 90 es arriba), con from < to. `halfWidth` es medio grosor del trazo.
 */
export function sdArc(x, y, r, from, to, halfWidth) {
  const rad = Math.PI / 180;
  // El lienzo tiene la y hacia abajo: se da vuelta para medir el ángulo.
  let a = Math.atan2(-y, x) / rad;
  a -= Math.floor((a - from) / 360) * 360; // a en [from, from + 360)
  if (a <= to) return Math.abs(Math.hypot(x, y) - r) - halfWidth;
  const end = (deg) => Math.hypot(x - r * Math.cos(deg * rad), y + r * Math.sin(deg * rad));
  return Math.min(end(from), end(to)) - halfWidth;
}

/**
 * Un segmento de trazo con las puntas redondas, de (ax, ay) a (bx, by).
 * Varios que comparten una punta dan una esquina redonda (la unión de sus
 * puntas), como un path con `stroke-linejoin: round`.
 */
export function sdSegment(x, y, ax, ay, bx, by, halfWidth) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - halfWidth;
}

/** Un degradé entre dos colores a lo largo de la recta que va de p0 a p1 (en fracción del lienzo). */
export function gradient(c0, c1, p0, p1) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t = Math.min(1, Math.max(0, ((x - p0[0]) * dx + (y - p0[1]) * dy) / len2));
    return [0, 1, 2].map((i) => c0[i] + (c1[i] - c0[i]) * t);
  };
}

/**
 * Como gradient, con varias paradas: `stops` es [[posición de 0 a 1, [r,g,b]], …]
 * en orden. Es el `linearGradient` de SVG con sus `stop`.
 */
export function gradientStops(stops, p0, p1) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t = Math.min(1, Math.max(0, ((x - p0[0]) * dx + (y - p0[1]) * dy) / len2));
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    return [0, 1, 2].map((n) => c0[n] + (c1[n] - c0[n]) * k);
  };
}

// ---------- Rasterizado ----------

/**
 * Dibuja un ícono de `size` px: la baldosa de color `tile` y encima el glifo.
 * `glyph(scale)` devuelve sus capas de abajo hacia arriba:
 * { color: [r,g,b], sd: (x, y) => distancia }, con x e y en fracción del
 * lienzo y (0,0) en el centro. `scale` es el tamaño del dibujo (0.62, o 0.68
 * por debajo de 64 px) para que el glifo lo use; la baldosa va al 100 %.
 */
export function rasterize(size, tile, glyph) {
  const scale = drawingScale(size);
  return toBytes(size, sample(size, [tileLayer(tile), ...glyph(scale)]));
}

const drawingScale = (size) => (size < 64 ? 0.68 : 0.62);
const tileLayer = (tile) => ({ color: tile, sd: (x, y) => sdRoundRect(x, y, 0.5, 0.19) });

/**
 * Compone las capas (de abajo hacia arriba) y devuelve el lienzo en coma
 * flotante, RGBA premultiplicado con el alfa de 0 a 1. El color de una capa
 * es [r,g,b] o una función (x, y) => [r,g,b] (un degradé).
 */
function sample(size, stack) {
  const out = new Float32Array(size * size * 4);
  const SS = 3;
  const px = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (i + (sx + 0.5) / SS) / size - 0.5;
          const y = (j + (sy + 0.5) / SS) / size - 0.5;
          // Cobertura de cada capa por su distancia: medio píxel de rampa.
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const layer of stack) {
            const cov = Math.min(1, Math.max(0, 0.5 - layer.sd(x, y) / (px / SS)));
            if (!cov) continue;
            const col = typeof layer.color === 'function' ? layer.color(x, y) : layer.color;
            cr = col[0] * cov + cr * (1 - cov);
            cg = col[1] * cov + cg * (1 - cov);
            cb = col[2] * cov + cb * (1 - cov);
            ca = cov + ca * (1 - cov);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = SS * SS;
      const o = (j * size + i) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

// r,g,b vienen premultiplicados por a: se desmultiplican al guardar.
function toBytes(size, buf) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let o = 0; o < buf.length; o += 4) {
    const alpha = buf[o + 3];
    rgba[o] = alpha ? Math.round(buf[o] / alpha) : 0;
    rgba[o + 1] = alpha ? Math.round(buf[o + 1] / alpha) : 0;
    rgba[o + 2] = alpha ? Math.round(buf[o + 2] / alpha) : 0;
    rgba[o + 3] = Math.round(alpha * 255);
  }
  return rgba;
}

// ---------- Resplandor ----------

// Un desenfoque gaussiano en una dirección, con un núcleo de verdad.
function blurAxis(src, size, sigma, horizontal) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); kernel.push(w); sum += w; }
  const dst = new Float32Array(src.length);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      for (let k = -radius; k <= radius; k++) {
        const ii = horizontal ? i + k : i;
        const jj = horizontal ? j : j + k;
        if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue; // afuera no hay nada
        const w = kernel[k + radius] / sum;
        const s = (jj * size + ii) * 4;
        dst[o] += src[s] * w;
        dst[o + 1] += src[s + 1] * w;
        dst[o + 2] += src[s + 2] * w;
        dst[o + 3] += src[s + 3] * w;
      }
    }
  }
  return dst;
}

// Un promedio móvil en una dirección: tres seguidos se acercan a un gaussiano
// y cuestan lo mismo con cualquier radio (para el ícono de 1024, donde el
// núcleo de verdad tendría cientos de píxeles).
function boxAxis(src, size, r, horizontal) {
  const dst = new Float32Array(src.length);
  const w = 2 * r + 1;
  const step = horizontal ? 4 : size * 4;
  for (let line = 0; line < size; line++) {
    const base = horizontal ? line * size * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let k = 0; k <= r && k < size; k++) acc += src[base + k * step + c];
      for (let p = 0; p < size; p++) {
        dst[base + p * step + c] = acc / w;
        const add = p + r + 1;
        const drop = p - r;
        if (add < size) acc += src[base + add * step + c];
        if (drop >= 0) acc -= src[base + drop * step + c];
      }
    }
  }
  return dst;
}

/** Desenfoque gaussiano de un lienzo premultiplicado, con sigma en píxeles. */
function blur(buf, size, sigma) {
  if (sigma < 4) return blurAxis(blurAxis(buf, size, sigma, true), size, sigma, false);
  // Los tres anchos de caja que mejor aproximan ese sigma.
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const m = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  let out = buf;
  for (let n = 0; n < 3; n++) {
    const r = ((n < m ? lower : lower + 2) - 1) / 2;
    out = boxAxis(boxAxis(out, size, r, true), size, r, false);
  }
  return out;
}

/**
 * Como rasterize, con el dibujo encendido: detrás del glifo van una o más
 * copias suyas desenfocadas (el halo primero y la forma nítida encima, así
 * el resplandor no lava el trazo). Es lo que hace el ícono de NTX con dos
 * feGaussianBlur.
 *
 * `glow(scale)` devuelve las pasadas, de la más ancha a la más ceñida:
 * { sigma, opacity }, con sigma en fracción del lienzo. El resplandor no se
 * sale de la baldosa. Como todo lo demás, cada tamaño se dibuja a su tamaño:
 * el halo de 16 px no es el de 1024 achicado.
 */
export function rasterizeGlow(size, tile, glyph, glow) {
  const scale = drawingScale(size);
  const base = sample(size, [tileLayer(tile)]);
  const ink = sample(size, glyph(scale));
  const out = Float32Array.from(base);
  const over = (top, opacity, clip) => {
    for (let o = 0; o < out.length; o += 4) {
      const k = opacity * (clip ? base[o + 3] : 1);
      const a = top[o + 3] * k;
      out[o] = top[o] * k + out[o] * (1 - a);
      out[o + 1] = top[o + 1] * k + out[o + 1] * (1 - a);
      out[o + 2] = top[o + 2] * k + out[o + 2] * (1 - a);
      out[o + 3] = a + out[o + 3] * (1 - a);
    }
  };
  for (const pass of glow(scale)) over(blur(ink, size, pass.sigma * size), pass.opacity, true);
  over(ink, 1, false);
  return toBytes(size, out);
}

// ---------- PNG ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // sin filtro
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO ----------

function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // color + máscara
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((size - 1 - y) * size + x) * 4; // de abajo para arriba
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  const rowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(rowBytes * size); // todo 0: manda el alfa
  return Buffer.concat([header, pixels, mask]);
}

/** images: [{ size, rgba }] */
export function encodeICO(images) {
  const entries = images.map(({ size, rgba }) => ({ size, data: size >= 128 ? encodePNG(size, rgba) : dib(size, rgba) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)]);
}

export const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
