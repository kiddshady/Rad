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

// ---------- Rasterizado ----------

/**
 * Dibuja un ícono de `size` px: la baldosa de color `tile` y encima el glifo.
 * `glyph(scale)` devuelve sus capas de abajo hacia arriba:
 * { color: [r,g,b], sd: (x, y) => distancia }, con x e y en fracción del
 * lienzo y (0,0) en el centro. `scale` es el tamaño del dibujo (0.62, o 0.68
 * por debajo de 64 px) para que el glifo lo use; la baldosa va al 100 %.
 */
export function rasterize(size, tile, glyph) {
  const scale = size < 64 ? 0.68 : 0.62;
  const stack = [{ color: tile, sd: (x, y) => sdRoundRect(x, y, 0.5, 0.19) }, ...glyph(scale)];
  const rgba = Buffer.alloc(size * size * 4);
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
            const col = layer.color;
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
      // r,g,b vienen premultiplicados por a: se desmultiplican al guardar.
      const alpha = a / n;
      rgba[o] = alpha ? Math.round(r / n / alpha) : 0;
      rgba[o + 1] = alpha ? Math.round(g / n / alpha) : 0;
      rgba[o + 2] = alpha ? Math.round(b / n / alpha) : 0;
      rgba[o + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
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
