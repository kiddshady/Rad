// El atajo global de BlackCode (apps/BlackCode/main/atajo.cjs), con node pelado:
// globalShortcut y ventana de mentira.
//
// Lo que se prueba: que registre Ctrl+Alt+B, que sea un toggle (al frente la
// esconde; escondida, minimizada o detrás de otra ventana la trae), el ida y
// vuelta, que no se registre dos veces, que se suelte al cerrar, que si otro
// programa lo tiene tomado (register da false o tira) quede sin atajo y lo
// diga, que en el humo no se registre, y el cableado en main.cjs.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { crear, ACELERADOR } = require(process.env.BLACKCODE_ATAJO || path.join(ROOT, 'apps', 'BlackCode', 'main', 'atajo.cjs'));

const failures = [];
let hechas = 0;
const ok = (name, cond, extra = '') => { hechas++; if (!cond) failures.push(`${name}${extra ? `  → ${String(extra).slice(0, 300)}` : ''}`); };

function falso({ libre = true, tira = false } = {}) {
  const registrados = new Map();
  const llamadas = [];
  return {
    registrados,
    llamadas,
    register(acc, fn) { llamadas.push(['register', acc]); if (tira) throw new Error('no'); if (!libre) return false; registrados.set(acc, fn); return true; },
    unregister(acc) { llamadas.push(['unregister', acc]); registrados.delete(acc); },
  };
}
// Una ventana de mentira: 'frente' (con el foco), 'detras' (visible, otra app tiene el foco) o 'escondida'.
function ventanaFalsa(inicial = 'escondida') {
  const v = { estado: inicial, acciones: [] };
  v.alFrente = () => v.estado === 'frente';
  v.mostrar = () => { v.acciones.push('mostrar'); v.estado = 'frente'; };
  v.esconder = () => { v.acciones.push('esconder'); v.estado = 'escondida'; };
  return v;
}

ok('el atajo es Ctrl+Alt+B', ACELERADOR === 'Control+Alt+B');

{
  const gs = falso();
  const v = ventanaFalsa('escondida');
  const a = crear({ globalShortcut: gs, ventana: v });
  ok('antes de prenderlo no hay atajo', a.estado().registrado === false && gs.registrados.size === 0);
  ok('al prenderlo queda registrado', a.prender() === true && a.estado().registrado === true && gs.registrados.has('Control+Alt+B'));
  const apretar = gs.registrados.get('Control+Alt+B');
  apretar();
  ok('escondida, el atajo la trae', v.estado === 'frente' && v.acciones.join() === 'mostrar');
  apretar();
  ok('al frente, el atajo la esconde', v.estado === 'escondida' && v.acciones.join() === 'mostrar,esconder');
  apretar();
  ok('y otra vez la trae (ida y vuelta)', v.estado === 'frente' && v.acciones.length === 3);
  v.estado = 'detras';
  apretar();
  ok('detrás de otra ventana, la trae al frente (no la esconde)', v.estado === 'frente' && v.acciones.at(-1) === 'mostrar');
  a.prender();
  ok('prenderlo otra vez no lo registra dos veces', gs.llamadas.filter(([q]) => q === 'register').length === 1);
  a.apagar();
  ok('al cerrar se suelta', a.estado().registrado === false && !gs.registrados.has('Control+Alt+B') && gs.llamadas.at(-1)?.[0] === 'unregister');
  a.apagar();
  ok('soltarlo dos veces no hace nada', gs.llamadas.filter(([q]) => q === 'unregister').length === 1);
}
{
  const a = crear({ globalShortcut: falso({ libre: false }), ventana: ventanaFalsa() });
  ok('si otro programa lo tiene, queda sin atajo y lo dice', a.prender() === false && a.estado().registrado === false);
  const b = crear({ globalShortcut: falso({ tira: true }), ventana: ventanaFalsa() });
  ok('si registrarlo tira, tampoco se cae', b.prender() === false && b.estado().registrado === false);
}
{
  const gs = falso();
  const a = crear({ globalShortcut: gs, ventana: ventanaFalsa(), registrar: false });
  ok('en el humo no se registra', a.prender() === false && gs.llamadas.length === 0);
}

const main = fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'main.cjs'), 'utf8');
ok('main.cjs lo crea con la bandeja y sin registrarlo en el humo', main.includes("require('./main/atajo.cjs').crear(") && main.includes('mostrar: () => rad.tray?.show()') && main.includes('rad.tray?.hide()') && main.includes('registrar: !process.env.RAD_SMOKE'));
ok('con la bandeja apagada, esconder minimiza', /bandeja !== false\) rad\.tray\?\.hide\(\);\s*else BrowserWindow\.getFocusedWindow\(\)\?\.minimize\(\);/.test(main));
ok('main.cjs lo prende al arrancar y lo suelta al cerrar', main.includes('atajo.prender();') && main.includes("app.on('will-quit', () => atajo.apagar());"));

if (failures.length) {
  console.log(`test-blackcode-atajo: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-atajo: ok (${hechas} comprobaciones: Ctrl+Alt+B, el toggle de ida y vuelta, detrás de otra ventana la trae, una sola vez, soltarlo al cerrar, tomado por otro programa, en el humo no, y el cableado con la bandeja apagada)`);
