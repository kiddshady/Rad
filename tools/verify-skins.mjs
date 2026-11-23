// Verifica cada piel de packages/skin-* contra el contrato del núcleo.
//
//   - el manifiesto (skin.cjs) trae id, name, base (#rrggbb) y root;
//   - define TODOS los tokens del contrato y ningún --rad- de más (lo propio
//     de una piel va con --skin-);
//   - el base es igual a --rad-surface-0, que es lo que pinta Electron antes
//     del primer frame;
//   - es oscura: ninguna superficie pasa de la claridad tope;
//   - el texto se lee: contraste mínimo de cada nivel sobre las superficies;
//   - cada valor tiene la forma de su tipo.
// Uso: node tools/verify-skins.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseColor, oklabL, contrast, over } from './color.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = require(path.join(ROOT, 'packages', 'core', 'contract', 'tokens.cjs'));

// Claridad tope de una superficie (L de OKLab). Fran no tolera lo blanco: Rad
// es solo oscuro. 0.32 deja lugar a grafitos y a un vidrio oscuro, no a un gris medio.
const SURFACE_MAX_L = 0.32;

const SHAPES = {
  length: /^(0|-?\d*\.?\d+(px|rem|em|%))$/,
  duration: /^\d*\.?\d+m?s$/,
  easing: /^(linear(\(.+\))?|ease(-in|-out|-in-out)?|cubic-bezier\(.+\)|steps\(.+\))$/,
  weight: /^[1-9]00$/,
  font: /\S/,
  shadow: /\S/,
};

function readCss(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const imports = [...text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s]+)['"]?\s*\)?/g)];
  return imports.map((m) => readCss(path.resolve(path.dirname(file), m[1]), seen)).join('\n') + '\n' + text;
}

function checkSkin(dir) {
  const errors = [];
  const warnings = [];
  const label = path.basename(dir);

  const manifestFile = path.join(dir, 'skin.cjs');
  if (!fs.existsSync(manifestFile)) return { label, errors: ['falta skin.cjs'], warnings };
  const skin = require(manifestFile);
  for (const k of ['id', 'name', 'base', 'root']) if (!skin[k]) errors.push(`el manifiesto no trae ${k}`);
  if (skin.base && !/^#[0-9a-f]{6}$/i.test(skin.base)) errors.push(`base tiene que ser #rrggbb: ${skin.base}`);

  const entry = path.join(dir, 'index.css');
  if (!fs.existsSync(entry)) return { label, errors: [...errors, 'falta index.css'], warnings };

  const css = readCss(entry);
  const defined = new Map();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) defined.set(m[1], m[2].trim());

  const known = new Set(contract.names);
  for (const name of defined.keys()) {
    if (name.startsWith('--rad-') && !known.has(name)) errors.push(`${name} no está en el contrato (lo propio de la piel va con --skin-)`);
  }

  const value = (name) => defined.get(name);
  for (const t of contract.tokens) {
    const v = value(t.name);
    if (v === undefined) { errors.push(`falta ${t.name}`); continue; }
    if (v.includes('var(')) continue; // se resuelve en runtime: lo mide el humo
    if (t.type === 'color') {
      if (!parseColor(v)) warnings.push(`${t.name}: no se pudo medir el color "${v}"`);
    } else if (SHAPES[t.type] && !SHAPES[t.type].test(v)) {
      errors.push(`${t.name} = "${v}" no tiene forma de ${t.type}`);
    }
  }

  const s0raw = value('--rad-surface-0');
  if (skin.base && s0raw && s0raw.toLowerCase() !== skin.base.toLowerCase()) {
    errors.push(`el base del manifiesto (${skin.base}) no es igual a --rad-surface-0 (${s0raw})`);
  }

  const surfaces = contract.tokens.filter((t) => t.surface).map((t) => [t.name, parseColor(value(t.name) || '')]);
  for (const [name, c] of surfaces) {
    if (!c) continue;
    if (c.a < 1) errors.push(`${name} tiene que ser opaca`);
    const L = oklabL(c);
    if (L > SURFACE_MAX_L) errors.push(`${name} es demasiado clara (L ${L.toFixed(3)} > ${SURFACE_MAX_L}): Rad es solo oscuro`);
  }

  const s0 = parseColor(value('--rad-surface-0') || '');
  const s3 = parseColor(value('--rad-surface-3') || '');
  for (const t of contract.tokens.filter((x) => x.contrastMin)) {
    const fg = parseColor(value(t.name) || '');
    if (!fg || !s0 || !s3) continue;
    const onS0 = contrast(over(fg, s0), s0);
    const onS3 = contrast(over(fg, s3), s3);
    if (onS0 < t.contrastMin) errors.push(`${t.name} sobre surface-0: contraste ${onS0.toFixed(2)} < ${t.contrastMin}`);
    else if (onS3 < t.contrastMin) warnings.push(`${t.name} sobre surface-3: contraste ${onS3.toFixed(2)} < ${t.contrastMin}`);
  }

  const accent = parseColor(value('--rad-accent') || '');
  const onAccent = parseColor(value('--rad-on-accent') || '');
  if (accent && onAccent) {
    const c = contrast(over(onAccent, accent), accent);
    if (c < 4.5) errors.push(`--rad-on-accent sobre --rad-accent: contraste ${c.toFixed(2)} < 4.5`);
  }

  return { label, errors, warnings };
}

const skinsDir = path.join(ROOT, 'packages');
const dirs = fs.readdirSync(skinsDir).filter((d) => d.startsWith('skin-')).map((d) => path.join(skinsDir, d));
if (!dirs.length) {
  console.error('verify-skins: no hay ninguna piel en packages/skin-*');
  process.exit(1);
}

let failed = false;
for (const dir of dirs) {
  const { label, errors, warnings } = checkSkin(dir);
  if (errors.length) failed = true;
  console.log(`${errors.length ? 'FALLA' : 'ok   '}  ${label}  (${contract.names.length} tokens del contrato v${contract.version})`);
  for (const e of errors) console.log(`       error   ${e}`);
  for (const w of warnings) console.log(`       aviso   ${w}`);
}
process.exit(failed ? 1 : 0);
