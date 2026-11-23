// Prueba la actualización de punta a punta sobre la vitrina INSTALADA:
//
//   node tools/test-update.mjs --exe "<ruta al Rad Vitrina.exe instalado>" --expect 0.5.1
//
// 1. Abre la versión instalada (vieja) con datos descartables.
// 2. El guion (smoke-update.js) espera el aviso, toca "Descargar", espera
//    "lista" y pide instalar: la app sale por quitAndInstall, en silencio.
// 3. Espera a que el instalador termine y lee la versión del .exe: tiene que
//    ser la esperada.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const EXE = arg('exe');
const EXPECT = arg('expect');
if (!EXE || !EXPECT || !fs.existsSync(EXE)) {
  console.error('uso: node tools/test-update.mjs --exe "<Rad Vitrina.exe instalado>" --expect <versión>');
  process.exit(1);
}

// Windows informa cuatro números (0.5.1.0): se comparan los tres de semver.
const version = () => execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${EXE}').VersionInfo.ProductVersion`], { encoding: 'utf8' })
  .trim().split('.').slice(0, 3).join('.');
const before = version();
console.log(`instalada: ${before}; se espera llegar a ${EXPECT}`);

const out = path.join(ROOT, '.smoke', 'update.json');
fs.rmSync(out, { force: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-update-'));
const env = { ...process.env, RAD_SMOKE: out, RAD_SMOKE_SCRIPT: path.join(ROOT, 'tools', 'smoke-update.js'), RAD_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(EXE, [], { env, stdio: 'inherit' });
const killer = setTimeout(() => { console.error('test-update: tiempo agotado'); child.kill(); }, 300000);
await new Promise((r) => child.on('exit', r));
clearTimeout(killer);

if (!fs.existsSync(out)) { console.error('test-update: FALLA, la app salió sin informe'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(out, 'utf8'));
for (const [k, v] of Object.entries(report.script || {})) console.log(`  ${k}: ${v}`);
if (!report.ok) {
  console.error('test-update: FALLA');
  for (const f of report.failures || []) console.error('  ' + f);
  process.exit(1);
}

// El instalador corre en silencio después de que la app se cerró.
let now = before;
for (let i = 0; i < 90 && now !== EXPECT; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try { now = version(); } catch { /* el instalador tiene el archivo tomado */ }
}
fs.rmSync(data, { recursive: true, force: true });
if (now !== EXPECT) { console.error(`test-update: FALLA, el .exe quedó en ${now}`); process.exit(1); }
console.log(`test-update: ok, ${before} → ${now}`);
