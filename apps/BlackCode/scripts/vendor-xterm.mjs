// Copia xterm.js al renderer (renderer/vendor/xterm): el módulo, el addon que
// lo ajusta al tamaño de su caja y su hoja de estilos. Es la terminal del
// panel (renderer/terminal.js). El renderer no tiene bundler y su CSP solo
// deja cargar lo que sirve la propia app, así que tiene que vivir adentro.
//
// NO es una copia tal cual: el módulo se adapta a la CSP de BlackCode
// (style-src 'self', sin 'unsafe-inline'), que xterm no cumple de fábrica.
// Son dos cambios, y los dos reemplazan un estilo EN LÍNEA por el mismo
// estilo puesto desde el código (CSSOM), que la CSP sí deja:
//
//   1. xterm arma parte de su estilo (los colores del tema, las medidas de las
//      celdas, su barra de scroll) en elementos <style> que llena a mano. Un
//      <style> en línea queda bloqueado: sin él no hay ni cursor. Acá pasan a
//      ser <dm-estilo>, un elemento propio que vuelca ese mismo texto en una
//      hoja construida (terminal.js lo define).
//   2. Un color de 24 bits lo pone con setAttribute('style', …), que también
//      queda bloqueado (y llena la consola de errores). Pasa a ser
//      style.setProperty.
//
// La alternativa era aflojar la CSP de toda la app, como hacía NeonCode. Con
// una shell de verdad del otro lado del puente, no.
//
// Cada reemplazo busca el texto EXACTO del build minificado y cuenta cuántas
// veces está: si xterm cambia, esto falla acá, con el motivo, y no en la app.
// La versión sale de node_modules (devDependencies, fijadas exactas). Lo
// copiado se commitea: correr esto solo al cambiar de versión.
// Uso: node apps/BlackCode/scripts/vendor-xterm.mjs   (o npm run xterm -w daimon)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.dirname(require.resolve('@xterm/xterm/package.json'));
const fit = path.dirname(require.resolve('@xterm/addon-fit/package.json'));
const out = path.join(APP, 'renderer', 'vendor', 'xterm');
const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;

function cambiar(fuente, que, por, veces, motivo) {
  const hay = fuente.split(que).length - 1;
  if (hay !== veces) throw new Error(`xterm ${version(pkg)}: esperaba ${veces} de «${que}» y hay ${hay} (${motivo}). El build cambió: revisar la adaptación a la CSP.`);
  return fuente.split(que).join(por);
}
const sinMapa = (fuente) => fuente.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');

let modulo = sinMapa(fs.readFileSync(path.join(pkg, 'lib', 'xterm.mjs'), 'utf8'));
modulo = cambiar(modulo, 'createElement("style")', 'createElement("dm-estilo")', 3, 'los <style> que xterm llena a mano');
modulo = cambiar(modulo,
  '_addStyle(t,e){t.setAttribute("style",`${t.getAttribute("style")||""}${e};`)}',
  '_addStyle(t,e){let i=e.indexOf(":");t.style.setProperty(e.slice(0,i),e.slice(i+1))}',
  1, 'el color de 24 bits de una celda');
for (const queda of ['setAttribute("style"', 'createElement("style")', '.innerHTML=', 'insertAdjacentHTML']) {
  if (modulo.includes(queda)) throw new Error(`xterm ${version(pkg)}: quedó «${queda}» en el módulo: revisar la adaptación a la CSP.`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'xterm.mjs'), modulo);
fs.writeFileSync(path.join(out, 'addon-fit.mjs'), sinMapa(fs.readFileSync(path.join(fit, 'lib', 'addon-fit.mjs'), 'utf8')));
fs.copyFileSync(path.join(pkg, 'css', 'xterm.css'), path.join(out, 'xterm.css'));
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'VERSION'), `@xterm/xterm ${version(pkg)}\n@xterm/addon-fit ${version(fit)}\n`);

console.log(`xterm ${version(pkg)} y addon-fit ${version(fit)} copiados a ${path.relative(process.cwd(), out)}, adaptados a la CSP`);
