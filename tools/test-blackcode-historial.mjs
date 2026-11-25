// Test del historial del navegador de BlackCode
// (apps/BlackCode/main/tools/historial.cjs), con node pelado y archivos de
// verdad en una carpeta temporal.
// Uso: node tools/test-blackcode-historial.mjs
//
// También mira dos cosas de afuera del módulo: que el motor del navegador
// avise de cada visita, y que NINGUNA tool lea el historial (es del usuario:
// los títulos son texto que escribe la página).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const { crear, TOPE, TITULO_MAX, esWeb } = require(path.join(APP, 'main', 'tools', 'historial.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-historial-'));
let n = 0;
// Un historial sobre un archivo propio, con un reloj que avanza de a uno y una
// escritura que cuenta las veces.
function nuevo({ espera = 5, contenido = undefined } = {}) {
  const archivo = path.join(dir, `h-${++n}.json`);
  if (contenido !== undefined) fs.writeFileSync(archivo, contenido);
  const caja = { archivo, escrituras: 0, reloj: 1000, falla: false };
  const escribir = async (f, obj) => { if (caja.falla) throw new Error('disco lleno'); caja.escrituras++; fs.writeFileSync(f, JSON.stringify(obj)); };
  const h = crear({ archivo, escribir, ahora: () => caja.reloj++, espera });
  return { h, caja, enDisco: () => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')).historial; } catch { return null; } } };
}
const urls = (h) => h.lista().map((e) => e.url).join(' ');

try {
  // ---------- 1. qué es una página ----------
  ok('http y https son páginas', esWeb('https://umaza.edu.ar/x') && esWeb('http://127.0.0.1:8080/'));
  ok('lo demás no', !esWeb('about:blank') && !esWeb('chrome-error://chromewebdata/') && !esWeb('data:text/html,hola') && !esWeb('file:///C:/x.html') && !esWeb('javascript:alert(1)') && !esWeb('https://') && !esWeb('') && !esWeb(null) && !esWeb({ url: 'https://a.com' }));

  // ---------- 2. anotar ----------
  {
    const { h, caja } = nuevo();
    ok('arranca vacío', h.lista().length === 0);
    ok('una página entra', h.anotar({ url: 'https://a.com/', title: 'A' }) === true && h.lista().length === 1);
    h.anotar({ url: 'https://b.com/', title: 'B' });
    h.anotar({ url: 'https://c.com/' });
    ok('la más reciente va primero', urls(h) === 'https://c.com/ https://b.com/ https://a.com/', urls(h));
    ok('cada una con su hora y su cuenta', h.lista()[2].at === 1000 && h.lista()[0].at === 1002 && h.lista().every((e) => e.veces === 1), JSON.stringify(h.lista()));
    ok('sin título queda vacío (la interfaz muestra el sitio)', h.lista()[0].title === '');
    // volver a una página la sube, no la repite
    h.anotar({ url: 'https://a.com/' });
    ok('volver a una página la sube en vez de repetirla', urls(h) === 'https://a.com/ https://c.com/ https://b.com/' && h.lista().length === 3, urls(h));
    ok('…le suma una vez y le cambia la hora', h.lista()[0].veces === 2 && h.lista()[0].at === 1003);
    ok('…y conserva el título que tenía si la visita no trae uno', h.lista()[0].title === 'A');
    h.anotar({ url: 'https://a.com/', title: 'A, renamed' });
    ok('una visita con título nuevo lo cambia', h.lista()[0].title === 'A, renamed' && h.lista()[0].veces === 3);
    // lo que no es una página no entra
    const antes = h.lista().length;
    for (const u of ['about:blank', 'chrome-error://chromewebdata/', 'data:text/html,x', 'file:///C:/Users/x/secreto.html', '', null, undefined, 42]) h.anotar({ url: u, title: 'no' });
    h.anotar();
    ok('about:blank, páginas de error, data: y archivos locales no entran', h.lista().length === antes, urls(h));
    ok('dos direcciones que difieren en algo son dos entradas', (h.anotar({ url: 'https://a.com/?q=1' }), h.anotar({ url: 'https://a.com/#x' }), h.lista().length === antes + 2));
    // el título se limpia y se acota
    h.anotar({ url: 'https://largo.com/', title: `  uno\n\tdos   ${'x'.repeat(400)}` });
    ok('el título va en un renglón y con tope', h.lista()[0].title.startsWith('uno dos x') && h.lista()[0].title.length === TITULO_MAX, String(h.lista()[0].title.length));
    ok('la lista que se entrega es una copia', (h.lista()[0].title = 'pisado', h.lista()[0].title !== 'pisado') && (h.lista().length = 0, h.lista().length > 0));
    void caja;
  }

  // ---------- 3. el título llega después ----------
  {
    const { h } = nuevo();
    h.anotar({ url: 'https://a.com/', title: '' });
    ok('el título que llega después se anota', h.titular({ url: 'https://a.com/', title: 'Portada' }) === true && h.lista()[0].title === 'Portada');
    ok('…sin contar otra visita ni cambiar la hora', h.lista()[0].veces === 1 && h.lista()[0].at === 1000);
    ok('el mismo título otra vez no cambia nada', h.titular({ url: 'https://a.com/', title: 'Portada' }) === false);
    ok('un título vacío no borra el que había', h.titular({ url: 'https://a.com/', title: '   ' }) === false && h.lista()[0].title === 'Portada');
    ok('el título de una página que no está en el historial no la agrega', h.titular({ url: 'https://otra.com/', title: 'Otra' }) === false && h.lista().length === 1);
    ok('ni el de algo que no es una página', h.titular({ url: 'about:blank', title: 'x' }) === false && h.titular() === false);
  }

  // ---------- 4. lo que la app reabre sola ----------
  {
    const { h } = nuevo();
    h.anotar({ url: 'https://a.com/', title: 'A' });
    h.anotar({ url: 'https://b.com/', title: 'B' });
    h.restauradas(['https://a.com/', 'https://nueva.com/', '', null, 'about:blank']);
    ok('reabrir una pestaña de la última vez no la sube', h.anotar({ url: 'https://a.com/' }) === false && urls(h) === 'https://b.com/ https://a.com/' && h.lista()[1].veces === 1, urls(h));
    ok('…pero la segunda vez ya es una visita', h.anotar({ url: 'https://a.com/' }) === true && urls(h) === 'https://a.com/ https://b.com/' && h.lista()[0].veces === 2);
    ok('una reabierta que NO estaba en el historial entra', h.anotar({ url: 'https://nueva.com/' }) === true && h.lista()[0].url === 'https://nueva.com/');
    h.restauradas(['https://b.com/']);
    ok('una reabierta trae su título si cambió', h.anotar({ url: 'https://b.com/', title: 'B, new title' }) === true && h.lista().find((e) => e.url === 'https://b.com/').title === 'B, new title' && h.lista()[0].url === 'https://nueva.com/');
    h.restauradas('no es una lista');
    ok('restauradas con cualquier cosa no rompe', h.anotar({ url: 'https://c.com/' }) === true);
  }

  // ---------- 5. quitar y vaciar ----------
  {
    const { h } = nuevo();
    for (const u of ['https://a.com/', 'https://b.com/', 'https://c.com/']) h.anotar({ url: u });
    ok('quitar saca esa y deja las otras', h.quitar('https://b.com/') === true && urls(h) === 'https://c.com/ https://a.com/');
    ok('quitar una que no está no hace nada', h.quitar('https://b.com/') === false && h.quitar() === false && h.lista().length === 2);
    ok('vaciar las saca todas', h.vaciar() === true && h.lista().length === 0);
    ok('vaciar vacío no hace nada', h.vaciar() === false);
    ok('después de vaciar se puede seguir anotando', h.anotar({ url: 'https://a.com/' }) === true && h.lista()[0].veces === 1);
  }

  // ---------- 6. el tope ----------
  {
    const { h } = nuevo({ espera: 100000 });
    for (let i = 0; i < TOPE + 25; i++) h.anotar({ url: `https://sitio.com/p/${i}` });
    ok('pasado el tope se caen las más viejas', h.lista().length === TOPE && h.lista()[0].url === `https://sitio.com/p/${TOPE + 24}` && h.lista().at(-1).url === 'https://sitio.com/p/25', `${h.lista().length} · ${h.lista().at(-1).url}`);
  }

  // ---------- 7. el disco ----------
  {
    const { h, caja, enDisco } = nuevo({ espera: 30 });
    h.anotar({ url: 'https://a.com/', title: 'A' });
    h.titular({ url: 'https://a.com/', title: 'A2' });
    h.anotar({ url: 'https://b.com/' });
    ok('no escribe con cada cambio: espera un rato', caja.escrituras === 0 && enDisco() === null);
    await sleep(90);
    ok('…y baja todo junto, una vez', caja.escrituras === 1 && enDisco()?.length === 2 && enDisco()[1].title === 'A2', `${caja.escrituras} escrituras`);
    await sleep(60);
    ok('sin cambios no vuelve a escribir', caja.escrituras === 1);
    // al cerrar la app, lo pendiente baja ya
    h.anotar({ url: 'https://c.com/' });
    h.volcar();
    ok('volcar baja lo pendiente en el acto', enDisco()?.length === 3 && enDisco()[0].url === 'https://c.com/');
    await sleep(60);
    ok('…y no deja una escritura de más para después', caja.escrituras === 1);
    h.volcar();
    ok('volcar sin nada pendiente no hace nada', enDisco()?.length === 3);
    // otro historial sobre el mismo archivo lo lee como quedó
    const otro = crear({ archivo: caja.archivo, escribir: async () => {}, ahora: () => 5 });
    ok('al reabrir la app está como quedó', otro.lista().map((e) => e.url).join(' ') === 'https://c.com/ https://b.com/ https://a.com/' && otro.lista()[2].title === 'A2' && otro.lista()[2].veces === 1);
    // una escritura que falla se reintenta con el cambio siguiente
    caja.falla = true;
    h.quitar('https://c.com/');
    await sleep(70);
    caja.falla = false;
    h.anotar({ url: 'https://d.com/' });
    await sleep(70);
    ok('una escritura que falla no pierde lo anotado: baja con el cambio siguiente', enDisco()?.map((e) => e.url).join(' ') === 'https://d.com/ https://b.com/ https://a.com/', JSON.stringify(enDisco()?.map((e) => e.url)));
  }
  {
    // lo que hay en el disco se revisa al leer
    const sucio = JSON.stringify({ historial: [
      { url: 'https://bien.com/', title: 'Bien', at: 9, veces: 4 },
      { url: 'about:blank', title: 'no' },
      { url: 'file:///C:/x.html' },
      null, 'texto', 7,
      { url: 'https://sin-datos.com/' },
      { url: 'https://raro.com/', title: { no: 'texto' }, at: 'ayer', veces: -3 },
    ] });
    const { h } = nuevo({ contenido: sucio });
    const l = h.lista();
    ok('del disco solo entran las páginas', l.map((e) => e.url).join(' ') === 'https://bien.com/ https://sin-datos.com/ https://raro.com/', l.map((e) => e.url).join(' '));
    ok('…con sus campos en regla', l[0].veces === 4 && l[0].at === 9 && l[1].title === '' && l[1].veces === 1 && l[1].at === 0 && typeof l[2].title === 'string' && l[2].veces === 1 && l[2].at === 0, JSON.stringify(l));
  }
  {
    // un archivo ROTO se aparta y se arranca de cero; no se pisa sin más
    const { h, caja, enDisco } = nuevo({ contenido: '{ "historial": [ {"url": "https://a.com/"', espera: 5 });
    ok('un archivo roto arranca vacío', h.lista().length === 0 && h.trabado === false);
    const apartado = fs.readdirSync(dir).find((f) => f.startsWith(path.basename(caja.archivo) + '.corrupto-'));
    ok('…y el roto queda apartado, no borrado', Boolean(apartado) && fs.readFileSync(path.join(dir, apartado), 'utf8').includes('https://a.com/'), String(apartado));
    h.anotar({ url: 'https://nueva.com/' });
    await sleep(40);
    ok('…y después se escribe normalmente', enDisco()?.length === 1);
  }
  {
    // un archivo que no se pudo LEER (acá: es una carpeta) no se pisa
    const archivo = path.join(dir, 'es-una-carpeta.json');
    fs.mkdirSync(archivo);
    let escrituras = 0;
    const h = crear({ archivo, escribir: async () => { escrituras++; }, espera: 5 });
    ok('un archivo que no se puede leer arranca vacío y trabado', h.lista().length === 0 && h.trabado === true);
    h.anotar({ url: 'https://a.com/' });
    await sleep(40);
    h.volcar();
    ok('…y no se escribe encima en esta sesión', escrituras === 0 && fs.statSync(archivo).isDirectory());
    ok('…aunque en memoria sigue andando', h.lista().length === 1);
  }

  // ---------- 8. cómo está enchufado ----------
  {
    const motor = fs.readFileSync(path.join(APP, 'main', 'tools', 'browser', 'agent-browser.cjs'), 'utf8');
    ok('el motor avisa de cada página que carga', /wc\.on\('did-navigate', \(_e, url\) => visita\(/.test(motor));
    ok('…de los cambios de dirección de una SPA, solo en el marco principal', /wc\.on\('did-navigate-in-page', \(_e, url, principal\) => \{ if \(principal\) visita\(/.test(motor));
    ok('…y del título cuando llega, si lo puso la página (no el provisorio de Chromium)', /wc\.on\('page-title-updated', \(_e, titulo, explicito\) => \{ if \(explicito\) visita\(\{ url: wc\.getURL\(\), title: titulo, soloTitulo: true \}\); \}\)/.test(motor));
    ok('un error del que escucha no tumba al motor', /const visita = \(v\) => \{ try \{ this\.onVisita\(v\); \} catch/.test(motor));
    const nav = fs.readFileSync(path.join(APP, 'main', 'tools', 'navegador.cjs'), 'utf8');
    ok('el navegador anota visitas y títulos por separado', nav.includes('onVisita: (v) => { if (v.soloTitulo) historial.titular(v); else historial.anotar(v); }'));
    ok('lo pendiente baja al cerrar la app', /volcarPestanas\(\);\s*historial\.volcar\(\);\s*agentBrowser\.destroy\(\);/.test(nav));
    ok('las pestañas que reabre la app se avisan antes de abrirlas', /if \(!agentBrowser\.alive\) historial\.restauradas\(restaurar\?\.urls\);\s*return agentBrowser\.attach\(/.test(nav));
    // Ninguna tool lee el historial: solo los cuatro canales de su ventana.
    const usos = nav.split('\n').filter((l) => /\bhistorial\.(lista|quitar|vaciar|anotar|titular)\(/.test(l) && !l.trim().startsWith('//'));
    const permitidos = usos.every((l) => /^\s*(histList|histRemove|histClear):/.test(l) || l.includes('onVisita:'));
    ok('el historial solo se toca desde su ventana y desde el motor, nunca desde una tool', usos.length === 4 && permitidos, usos.map((l) => l.trim().slice(0, 60)).join(' | '));
    const tools = fs.readdirSync(path.join(APP, 'main', 'tools')).filter((f) => f.endsWith('.cjs') && f !== 'historial.cjs' && f !== 'navegador.cjs');
    ok('ningún otro módulo de tools lo carga', tools.every((f) => !fs.readFileSync(path.join(APP, 'main', 'tools', f), 'utf8').includes('historial.cjs')), tools.filter((f) => fs.readFileSync(path.join(APP, 'main', 'tools', f), 'utf8').includes('historial.cjs')).join());
    const defs = fs.readFileSync(path.join(APP, 'main', 'tools', 'defs.cjs'), 'utf8');
    ok('ninguna tool se ofrece para leerlo', !/history/i.test(defs.replace(/chat history|conversation history|version history|history of (the|this) (chat|conversation)/gi, '')), (/[^\n]*history[^\n]*/i.exec(defs.replace(/chat history|conversation history|version history|history of (the|this) (chat|conversation)/gi, '')) ?? [''])[0].trim().slice(0, 120));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`test-blackcode-historial: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-historial: ok (${hechas} comprobaciones: qué es una página, anotar y subir, el título que llega después, lo que la app reabre sola, quitar y vaciar, el tope, el disco con su espera, un archivo roto o trabado, y que ninguna tool lo lea)`);
process.exit(0);
