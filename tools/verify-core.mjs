// Verifica que el núcleo no sepa nada de estilo.
//
// En packages/core/renderer no puede haber:
//   - colores escritos a mano (hex, rgb(), oklch(), nombres). Excepción: las
//     máscaras (mask-image), donde el color solo aporta el alfa;
//   - duraciones a mano en transition / animation;
//   - sombras, radios, fuentes, tamaños o pesos que no salgan de un token;
//   - padding, margin o gap con píxeles a mano: la densidad es de la piel.
// Uso: node tools/verify-core.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findColorLiteral } from './color.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'packages', 'core', 'renderer');

const MASK_PROPS = new Set(['mask-image', '-webkit-mask-image', 'mask', '-webkit-mask']);
const TIMING_PROPS = new Set(['transition', 'transition-duration', 'transition-delay', 'animation', 'animation-duration', 'animation-delay']);
const TOKEN_PROPS = new Set(['box-shadow', 'border-radius', 'font-family', 'font-size', 'font-weight', 'transition-timing-function', 'animation-timing-function']);
const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-|$)/;
const KEYWORDS = /^(none|inherit|initial|unset|revert|0|0px|normal|transparent|currentcolor)$/i;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank);
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`])\/\/.*$/gm, (m, pre) => pre + blank(m.slice(pre.length)));
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const problems = [];
const report = (file, line, msg) => problems.push(`${path.relative(ROOT, file)}:${line}  ${msg}`);

function checkCss(file) {
  const text = stripCssComments(fs.readFileSync(file, 'utf8'));
  const decl = /([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g;
  let m;
  while ((m = decl.exec(text))) {
    const prop = m[1].toLowerCase();
    const value = m[2].trim();
    const line = lineOf(text, m.index);
    if (prop === 'syntax' || prop === 'inherits' || prop === 'initial-value') continue; // @property

    const color = findColorLiteral(value);
    if (color && !MASK_PROPS.has(prop)) report(file, line, `color a mano en ${prop}: ${color}`);

    if (TIMING_PROPS.has(prop)) {
      const dur = value.match(/(?<![\w-])(?!0m?s\b)\d*\.?\d+m?s\b/);
      if (dur) report(file, line, `duración a mano en ${prop}: ${dur[0]}`);
    }

    if (TOKEN_PROPS.has(prop) && !value.includes('var(') && !KEYWORDS.test(value)) {
      report(file, line, `${prop} tiene que salir de un token: ${value}`);
    }

    if (SPACE_PROPS.test(prop)) {
      const px = value.replace(/var\([^)]*\)/g, '').match(/(?<![\w-])[1-9]\d*(\.\d+)?px/);
      if (px) report(file, line, `${prop} con píxeles a mano (${px[0]}): el espaciado es de la piel`);
    }
  }
}

function checkJs(file) {
  const text = stripJsComments(fs.readFileSync(file, 'utf8'));
  const strings = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = strings.exec(text))) {
    const color = findColorLiteral(m[2]);
    if (color) report(file, lineOf(text, m.index), `color a mano en un string: ${color}`);
  }
}

const files = walk(DIR);
for (const f of files) {
  if (f.endsWith('.css')) checkCss(f);
  else if (f.endsWith('.js') || f.endsWith('.mjs')) checkJs(f);
}

if (problems.length) {
  console.error(`verify-core: ${problems.length} problema(s)\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`verify-core: ok (${files.length} archivos, el núcleo no tiene estilo propio)`);
