// Parseo y medición de colores para los verificadores.
// Entiende #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() y oklch(). Lo que no
// entiende (var(), color-mix()...) devuelve null: el verificador lo reporta
// como "no se pudo medir" en vez de inventar.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return [r, g, bl].map((v) => clamp01(linearToSrgb(v)));
}

/** @returns {{ r:number, g:number, b:number, a:number } | null}  canales 0..1 */
export function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a };
  }
  m = v.match(/^oklch\(([^)]+)\)$/);
  if (m) {
    const [lp, cp, hp, ap] = m[1].split(/[\s/]+/).filter(Boolean);
    const L = lp.endsWith('%') ? parseFloat(lp) / 100 : parseFloat(lp);
    const [r, g, b] = oklchToSrgb(L, parseFloat(cp), parseFloat(hp) || 0);
    const a = ap === undefined ? 1 : ap.endsWith('%') ? parseFloat(ap) / 100 : parseFloat(ap);
    return { r, g, b, a };
  }
  return null;
}

/** La L de OKLab (0 = negro, 1 = blanco): la claridad percibida. */
export function oklabL({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363031346 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function luminance({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Mezcla un color translúcido sobre un fondo opaco. */
export function over(top, bottom) {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** Contraste WCAG entre dos colores opacos. */
export function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** ¿Hay un color escrito a mano en este texto? Devuelve el primero o null. */
const NAMED = /(?<![\w-])(white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|cyan|magenta|navy|teal)(?![\w-])/i;
const FUNCS = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const HEX = /#[0-9a-f]{3,8}(?![\w-])/i;
export function findColorLiteral(text) {
  for (const re of [HEX, FUNCS, NAMED]) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}
