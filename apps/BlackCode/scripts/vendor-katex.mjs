// Copia KaTeX al renderer (renderer/vendor/katex). El renderer no tiene
// bundler y su CSP solo deja cargar lo que sirve la propia app, así que lo que
// usa de KaTeX tiene que vivir adentro de renderer/: el módulo, la extensión
// de química (mhchem), la hoja de estilos y las fuentes en woff2 (las otras
// dos variantes de cada fuente no se piden nunca: Chromium toma la primera).
//
// La versión sale de node_modules (devDependency `katex`, fijada exacta). Lo
// copiado se commitea: correr esto solo al cambiar de versión.
// Uso: node apps/BlackCode/scripts/vendor-katex.mjs   (o npm run katex -w daimon)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.dirname(require.resolve('katex/package.json'));
const dist = path.join(pkg, 'dist');
const out = path.join(APP, 'renderer', 'vendor', 'katex');
const { version } = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'contrib'), { recursive: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const copiar = (de, a = de) => fs.copyFileSync(path.join(dist, de), path.join(out, a));
copiar('katex.mjs');
copiar('katex.min.css');
copiar(path.join('contrib', 'mhchem.mjs'));
let fuentes = 0;
for (const f of fs.readdirSync(path.join(dist, 'fonts'))) {
  if (f.endsWith('.woff2')) { copiar(path.join('fonts', f)); fuentes++; }
}
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'VERSION'), `${version}\n`);

// La extensión de química importa al módulo principal por su ruta relativa:
// tiene que ser la misma dirección con la que lo carga la app, o habría dos
// KaTeX y las macros de \ce quedarían en el que nadie usa.
const mhchem = fs.readFileSync(path.join(out, 'contrib', 'mhchem.mjs'), 'utf8');
if (!/from\s+['"]\.\.\/katex\.mjs['"]/.test(mhchem)) throw new Error('mhchem.mjs ya no importa ../katex.mjs: revisar cómo se carga');

console.log(`katex ${version} copiado a ${path.relative(process.cwd(), out)}: módulo, mhchem, estilos y ${fuentes} fuentes`);
