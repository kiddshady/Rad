// Publica una app de Rad en su repo de releases.
//
//   node tools/release.mjs apps/showcase --title "lo nuevo" --notes notas.md
//
// 1. Compila el instalador LOCAL (--publish never). No se usa el publish de
//    electron-builder: en la 26 a veces crea dos borradores gemelos para el
//    mismo tag y reparte los archivos entre los dos.
// 2. Verifica el trío local: el latest.yml apunta al .exe que hay y su
//    sha512 coincide.
// 3. Crea el release con gh y sube el trío (.exe, .blockmap, latest.yml).
// 4. Baja el trío DE GITHUB y lo vuelve a verificar: verificar contra la
//    copia local ya dejó pasar un release roto (sha512 checksum mismatch en
//    la app instalada).
//
// Un repo de releases por app: electron-updater toma la versión del tag
// (vX.Y.Z), así que dos apps no pueden compartir uno.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const appDir = path.resolve(process.argv[2] || '');
const pkgFile = path.join(appDir, 'package.json');
if (!fs.existsSync(pkgFile)) {
  console.error('uso: node tools/release.mjs apps/<app> --title "<lo nuevo>" --notes <archivo.md | texto>');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const { owner, repo } = pkg.build?.publish ?? {};
if (!owner || !repo) {
  console.error(`${pkg.name}: falta build.publish (owner y repo) en el package.json`);
  process.exit(1);
}
const version = pkg.version;
const tag = `v${version}`;
const product = pkg.build.productName || pkg.productName || pkg.name;
const title = arg('title') ? `${product} ${version} — ${arg('title')}` : `${product} ${version}`;
const notesArg = arg('notes') || '';
const notes = notesArg && fs.existsSync(notesArg) ? fs.readFileSync(notesArg, 'utf8') : notesArg;
// Sin shell: gh es un .exe de verdad, y con shell los argumentos con
// espacios (el título) se parten. npx sí la necesita (es un .cmd).
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

const sha512 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
function checkTrio(dir, label) {
  const yml = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  const file = yml.match(/^path:\s*(.+)$/m)?.[1].trim();
  const hash = yml.match(/^sha512:\s*(.+)$/m)?.[1].trim();
  const version2 = yml.match(/^version:\s*(.+)$/m)?.[1].trim();
  if (version2 !== version) throw new Error(`${label}: latest.yml dice ${version2}, el package.json ${version}`);
  const exe = path.join(dir, file);
  if (!fs.existsSync(exe)) throw new Error(`${label}: latest.yml apunta a ${file}, que no está`);
  if (sha512(exe) !== hash) throw new Error(`${label}: el sha512 de ${file} no coincide con latest.yml`);
  if (!fs.existsSync(`${exe}.blockmap`)) throw new Error(`${label}: falta ${file}.blockmap`);
  return file;
}

// ¿Ya existe ese release?
try {
  sh('gh', ['release', 'view', tag, '-R', `${owner}/${repo}`, '--json', 'tagName']);
  console.error(`${owner}/${repo} ya tiene ${tag}: subí la versión del package.json`);
  process.exit(1);
} catch { /* no existe: seguimos */ }

console.log(`compilando ${product} ${version}…`);
fs.rmSync(path.join(appDir, 'dist'), { recursive: true, force: true });
execFileSync('npx', ['electron-builder', '--win', '--publish', 'never'], { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });

const dist = path.join(appDir, 'dist');
const exeName = checkTrio(dist, 'local');
const files = [exeName, `${exeName}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));
console.log(`trío local ok: ${exeName}`);

const notesFile = path.join(os.tmpdir(), `rad-notes-${process.pid}.md`);
fs.writeFileSync(notesFile, notes || title);
sh('gh', ['release', 'create', tag, '-R', `${owner}/${repo}`, '--title', title, '--notes-file', notesFile, ...files], { stdio: 'inherit' });
fs.rmSync(notesFile, { force: true });

const check = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-release-'));
sh('gh', ['release', 'download', tag, '-R', `${owner}/${repo}`, '-D', check], { stdio: 'inherit' });
checkTrio(check, 'remoto');
fs.rmSync(check, { recursive: true, force: true });
console.log(`publicado y verificado contra GitHub: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
