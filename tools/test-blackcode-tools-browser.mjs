// Test del navegador embebido de BlackCode (apps/BlackCode/main/tools/navegador.cjs y
// apps/BlackCode/main/tools/browser/agent-browser.cjs), con node pelado.
// Uso: node tools/test-blackcode-tools-browser.mjs
//
// Son las comprobaciones del test de NeonCode de donde se portó el código
// (scripts/test-browser.js) que miran a browser.js y a los ayudantes de
// main.js, más las que hacen falta para saber que el port quedó cableado
// igual. Dos bancos:
//
//   - la clase AgentBrowser con un electron FALSO metido en require.cache: el
//     banco del test original, tal cual (sus secciones vienen con sus
//     comentarios, y algunos nombran cosas de aquella app). No se abre ninguna
//     ventana, no se navega a ningún lado y no se toca ninguna sesión real;
//   - navegador.cjs sobre su instancia viva, con el mismo electron falso, una
//     ventana de mentira, una interfaz de mentira que abre el panel cuando se
//     lo piden y una carpeta descartable para las pestañas y los favoritos.
//     Donde lo que se mide es el TEXTO que arma un runner, la lectura, el
//     click, el tecleo o la subida se reemplazan por una respuesta fija.
//
// Lo que este archivo tiene que fijar:
//   - que a la pestaña solo entre http(s), y http solo hacia la red de adentro;
//   - que la view nazca sin preload, en sandbox y en su partición aparte;
//   - que un sitio no consiga permisos, descargas ni ventanas sueltas;
//   - que ninguna tool toque la página con el panel cerrado;
//   - que lo tecleado no viaje en el chip;
//   - que un archivo de favoritos ilegible no se pise;
//   - y que al salir queden guardadas las pestañas y cerradas todas las views.
//
// Lo que NO vino del test original, porque mide la interfaz de NeonCode (su
// renderer, su HTML y su CSS) y la de BlackCode es otra:
//   - 7 y 7b: el ancho arrastrado del panel y el browser ancho encima del chat;
//   - 8: la capa que no se prende sin página (aplicarEclipse, zonaBrowser);
//   - 9: los bounds que siguen al hueco cuando la ventana cambia de ancho;
//   - 10: el velo con la foto, del lado del renderer (de esa sección sí vino
//     que freeze es JPEG y capture PNG);
//   - 11: los atajos de salir cruzando la terminal. De 11b y 13b vino lo que
//     hace el handler de la página, pero no la comparación de los predicados
//     con su copia del renderer;
//   - 12: la capa que aparece cuando el panel terminó de entrar;
//   - 13c: la tira de pestañas del renderer, su HTML y su CSS, y los canales
//     en el preload de la app (acá se prueban las funciones de `ipc`);
//   - 14: el techo de la manija y el pie del composer que se pliega;
//   - de 6 y 6b: las definiciones de las tools (allá TOOL_DEFS; acá están en
//     defs.cjs, que no es de este port), DANGER_TOOLS y los toolsets viejos
//     (no existen en BlackCode), y la estrella y la lista de favoritos del HTML.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'apps', 'BlackCode', 'main', 'tools');
const AGENT = path.join(TOOLS, 'browser', 'agent-browser.cjs');
const PRELOAD = path.join(TOOLS, 'browser', 'chrome-preload.cjs');
const NAVEGADOR = path.join(TOOLS, 'navegador.cjs');

const failures = [];
let hechas = 0;
let seccionActual = '';
const seccion = (s) => { seccionActual = s; };
const ok_ = (name, cond, extra = '') => {
  hechas++;
  if (!cond) failures.push(`[${seccionActual}] ${name}${extra === '' || extra == null ? '' : `  → ${extra}`}`);
};
// El nombre que tenía en el test original, para que sus secciones vengan como
// estaban.
const ok = ok_;
const t = (name, got, want) => {
  hechas++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures.push(`[${seccionActual}] ${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`);
  }
};

/* ── El electron falso ────────────────────────────────────────────────────
   Registra todo lo que el módulo le pide, para poder afirmar sobre eso después.
   Los fakes tienen la FORMA real: `navigationHistory` es un objeto con métodos
   (no `canGoBack()` suelto en webContents, que es la API vieja), y `session
   .fromPartition` devuelve siempre el mismo objeto por partición, que es lo que
   hace que el guardia de "no blindar dos veces" tenga sentido. Un fake con la
   forma equivocada deja pasar código que en la app real no anda. */
const sesiones = new Map();
function fakeSession(part) {
  if (sesiones.has(part)) return sesiones.get(part);
  const s = {
    part,
    handlers: {},
    on(ev, fn) { (this.handlers[ev] ??= []).push(fn); return this; },
    // el UA de fábrica de Electron, con lo que hay que sacarle
    getUserAgent: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BlackCode/0.7.4 Chrome/152.0.7977.130 Electron/44.10.1 Safari/537.36',
    setUserAgent(ua) { this.ua = ua; },
    preloads: [],
    registerPreloadScript(o) { this.preloads.push(o); return 'id'; },
    // el cookie store: `changed` con (evento, cookie, causa, borrada) y un set
    // que devuelve promesa, como el de Electron
    cookies: {
      oidos: [],
      puestas: [],
      on(ev, fn) { if (ev === 'changed') this.oidos.push(fn); return this; },
      set(d) { this.puestas.push(d); return Promise.resolve(); },
      flushStore() { return Promise.resolve(); },
    },
    setPermissionRequestHandler(fn) { this.permReq = fn; },
    setPermissionCheckHandler(fn) { this.permCheck = fn; },
    setDevicePermissionHandler(fn) { this.permDev = fn; },
  };
  sesiones.set(part, s);
  return s;
}

const construidas = [];
class FakeWebContentsView {
  constructor(opts) {
    this.opts = opts;
    construidas.push(this);
    this.calls = { visible: [], bounds: [], bg: [], radius: [] };
    const wcHandlers = {};
    this.webContents = {
      handlers: wcHandlers,
      loaded: [],
      inputs: [],
      inserted: [],
      on(ev, fn) { (wcHandlers[ev] ??= []).push(fn); return this; },
      once(ev, fn) { (wcHandlers[ev] ??= []).push(fn); return this; },
      off() { return this; },
      setWindowOpenHandler(fn) { this.openHandler = fn; },
      loadURL(u) { this.loaded.push(u); this.url = u; },
      getURL() { return this.url || ''; },
      getTitle() { return this.title || ''; },
      isLoading() { return !!this.loading; },
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
      sendInputEvent(e) { this.inputs.push(e); },
      insertText(s) { this.inserted.push(s); },
      // El teclado: `_activar` se lo da a la pestaña que pasa al frente cuando
      // el cambio lo pidió el usuario. Se cuenta para poder afirmar sobre eso.
      focos: 0,
      focus() { this.focos++; },
      executeJavaScript: async () => ({}),
      // Vacía por defecto; los casos que quieren una foto de verdad la cambian.
      capturePage: async () => ({ isEmpty: () => true }),
      // Como el real: cerrar destruye, y la destrucción se avisa con 'destroyed'.
      close() {
        if (this.cerrada) return;
        this.cerrada = true;
        (wcHandlers.destroyed || []).forEach((fn) => fn());
      },
      isDestroyed() { return !!this.cerrada; },
    };
    // El árbol de frames. Un WebFrameMain de verdad tiene `frames` (los hijos
    // directos) y su propio `executeJavaScript`, que corre desde el proceso
    // principal — por eso atraviesa el mismo origen, que es toda la razón por la
    // que se lee así y no con `iframe.contentDocument`.
    //
    // El fake del main frame delega en el executeJavaScript del webContents para
    // que los tests puedan cambiar UNA función y afectar a los dos.
    this.webContents.mainFrame = {
      frames: [],
      executeJavaScript: (code, g) => this.webContents.executeJavaScript(code, g),
    };
  }
  setBackgroundColor(c) { this.calls.bg.push(c); }
  setBorderRadius(r) { this.calls.radius.push(r); }
  setBounds(b) { this.calls.bounds.push(b); }
  setVisible(v) { this.calls.visible.push(v); }
}

// El electron que carga agent-browser.cjs es el que se resuelve desde SU
// carpeta, así que la entrada falsa se pone con ese mismo camino.
const electronPath = createRequire(AGENT).resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { WebContentsView: FakeWebContentsView, session: { fromPartition: fakeSession } },
};

const B = require(AGENT);
const { AgentBrowser, urlValida, destinoBarra, PARTITION } = B;
const N = require(NAVEGADOR);
const motor = require(path.join(TOOLS, 'motor.cjs'));

// ── la carpeta descartable ───────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-tools-browser-'));
const CARPETA = path.join(TMP, 'datos');
const SUBIR = path.join(TMP, 'subir');
fs.mkdirSync(SUBIR, { recursive: true });

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const hacerRun = (reqId = 'r1') => {
  const run = { ac: new AbortController(), reqId, convoId: 'c1', avisos: [] };
  run.notify = (canal, datos) => run.avisos.push([canal, datos]);
  return run;
};
// Espera a que un archivo exista y diga lo que tiene que decir, sin colgar.
const esperarArchivo = async (file, sirve, ms = 4000) => {
  const hasta = Date.now() + ms;
  for (;;) {
    let txt = null;
    try { txt = fs.readFileSync(file, 'utf8'); } catch { /* todavía no está */ }
    if (txt !== null) {
      try { if (sirve(txt)) return txt; } catch { /* a medio escribir no puede estar (es atómica), pero por las dudas */ }
    }
    if (Date.now() > hasta) return txt;
    await tick(40);
  }
};

try {
  // ═══ La clase, con el banco del test original ══════════════════════════════

  /* ── 1. Qué se acepta como destino ───────────────────────────────────────── */
  seccion('urlValida: qué puede cargar la pestaña');

  t('https pasa tal cual', urlValida('https://ollama.com/x?a=1'), 'https://ollama.com/x?a=1');
  t('http pasa (con candado rojo en la barra)', urlValida('http://192.168.0.10:8080'), 'http://192.168.0.10:8080');
  t('dominio pelado asume https', urlValida('ollama.com'), 'https://ollama.com');
  t('dominio con path', urlValida('github.com/kiddshady'), 'https://github.com/kiddshady');
  // Un file:// acá sería un SEGUNDO camino al disco del usuario, sin los
  // guardrails de fs_read y con el DOM de un archivo local leyéndose después como
  // si viniera de internet.
  t('file:// NO', urlValida('file:///C:/Users/x/.ssh/id_rsa'), null);
  // El resto son ejecución de otro programa disparada desde adentro del panel: en
  // Windows cualquier app instalada registra su esquema.
  t('javascript: NO', urlValida('javascript:alert(1)'), null);
  t('data: NO', urlValida('data:text/html,<script>x</script>'), null);
  t('mailto: NO', urlValida('mailto:a@b.com'), null);
  t('ms-settings: NO', urlValida('ms-settings:privacy'), null);
  t('texto suelto no es una URL', urlValida('hola mundo'), null);
  t('vacío no es una URL', urlValida('   '), null);

  seccion('barra: búsquedas y direcciones locales');
  for (const [entrada, destino] of [
    ['localhost:3000', 'http://localhost:3000'],
    ['localhost', 'http://localhost'],
    ['LOCALHOST:3000/ruta?x=1#fin', 'http://LOCALHOST:3000/ruta?x=1#fin'],
    ['app.localhost:5173', 'http://app.localhost:5173'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['192.168.1.25:8080/app', 'http://192.168.1.25:8080/app'],
    ['[::1]:3000', 'http://[::1]:3000'],
    ['neon.local:8080', 'http://neon.local:8080'],
    ['https://localhost:3000', 'https://localhost:3000'],
    ['github.com:443/kiddshady', 'https://github.com:443/kiddshady'],
    ['  github.com  ', 'https://github.com'],
  ]) {
    t(`dirección: ${entrada}`, urlValida(entrada), destino);
    t(`barra: ${entrada}`, destinoBarra(entrada), destino);
  }
  // Los dos que parecen destinos y no lo son. Una consulta que arranca con una
  // palabra terminada en dos puntos —pegar un stack trace en la barra es lo más
  // normal del mundo— matchea igual que `javascript:` contra un regex de esquema;
  // lo que las separa es el espacio, que un esquema no tiene. Y "1.5" o "0.29.0"
  // son números que la URL normaliza a un IPv4 que nadie quiso escribir.
  for (const consulta of ['electron', '2026', 'cómo usar electron', 'C++ & JavaScript #ejemplos', 'node.js tutorial',
    'TypeError: x is not a function', 'error: cannot find module', 'git: command not found', 'c++: guía',
    '1.5', '3.14', '0.29.0', '192.168.1.1.1']) {
    t(`busca: ${consulta}`, destinoBarra(`  ${consulta}  `), `https://duckduckgo.com/?q=${encodeURIComponent(consulta)}`);
    t(`la tool no lo convierte en búsqueda: ${consulta}`, urlValida(consulta), null);
  }
  for (const entrada of ['https://', 'https://bad host/', 'localhost:99999', 'javascript:alert(1)', 'file:///C:/test.html', 'data:text/html,test', 'mailto:a@b.com', 'ms-settings:privacy', 'C:\\test.html', '\\\\server\\share', '']) {
    t(`la barra rechaza: ${JSON.stringify(entrada)}`, destinoBarra(entrada), null);
  }

  // El http es para la red de adentro, no para cualquier IP. 8.8.8.8 es tan
  // ruteable como un dominio, y servirlo en texto plano porque "es un número"
  // sería una degradación que nadie pidió y que nadie ve.
  seccion('barra: el esquema lo decide el rango, no el formato');
  for (const [entrada, destino] of [
    ['10.0.0.5:3000', 'http://10.0.0.5:3000'],
    ['172.16.4.9', 'http://172.16.4.9'],
    ['169.254.1.1', 'http://169.254.1.1'],
    ['[fe80::1]:9000', 'http://[fe80::1]:9000'],
    ['[fc00::42]', 'http://[fc00::42]'],
    ['8.8.8.8', 'https://8.8.8.8'],
    ['93.184.216.34/x', 'https://93.184.216.34/x'],
    ['172.32.0.1', 'https://172.32.0.1'],       // el borde de 172.16/12, del lado de afuera
    ['[2606:4700::1111]', 'https://[2606:4700::1111]'], // una IP es destino aunque no tenga forma de dominio
  ]) {
    t(`esquema por rango: ${entrada}`, urlValida(entrada), destino);
    t(`y la barra hace lo mismo: ${entrada}`, destinoBarra(entrada), destino);
  }

  /* ── 2. Con qué se construye la view ─────────────────────────────────────── */
  seccion('la view: aislamiento y sesión');

  const avisos = [];
  const atajos = [];
  const br = new AgentBrowser({ onState: (s) => avisos.push(s), onAtajo: (e) => atajos.push(e) });
  // La ventana tiene la forma real por la misma razón que el resto de los fakes:
  // `isDestroyed` y `webContents.focus` son lo que usa el handler de atajos para
  // devolverle el teclado a la app, y una ventana fake sin ellos deja pasar un
  // TypeError que en la app sí se ve.
  const win = {
    contentView: { addChildView() {}, removeChildView() {} },
    isDestroyed: () => false,
    webContents: { focos: 0, focus() { this.focos++; } },
  };
  br.attach(win);
  const view = construidas[0];
  const wp = view.opts.webPreferences;

  // La razón de ser de todo el diseño: si la página nace con el preload de la app,
  // tiene a mano `window.neon` — o sea el IPC de alto privilegio, y del otro lado
  // de eso hay una shell (ver terminal.js).
  ok('la view NO tiene preload', !('preload' in wp), `webPreferences: ${Object.keys(wp).join(', ')}`);
  ok('sandbox', wp.sandbox === true);
  ok('contextIsolation', wp.contextIsolation === true);
  ok('sin nodeIntegration', wp.nodeIntegration === false);
  ok('sin webviewTag', wp.webviewTag === false);
  ok('webSecurity', wp.webSecurity === true);
  // Con zoom distinto de 1 las coordenadas que calcula el script de click dejan de
  // coincidir con las que espera sendInputEvent, y los clicks caen al lado.
  ok('zoomFactor fijo en 1', wp.zoomFactor === 1);

  // persist: es lo que hace que el login sobreviva al cierre de la app, que es la
  // idea entera. Y APARTE de la sesión por defecto, que es la del renderer.
  ok('la partición es persistente', PARTITION.startsWith('persist:'), PARTITION);
  ok('la partición no es la de la app', PARTITION !== '' && !/^persist:$/.test(PARTITION));

  // Fondo oscuro explícito: sin esto Chromium pinta blanco mientras carga, y en
  // esta app un frame blanco es un fogonazo.
  ok('nace con fondo oscuro', view.calls.bg.length === 1 && /^#0/.test(view.calls.bg[0]), view.calls.bg.join(','));
  // Nace apagada: quien la muestra es el renderer cuando terminó de abrir el panel.
  t('nace invisible', view.calls.visible[0], false);
  t('nace con bounds en cero', view.calls.bounds[0]?.width, 0);

  /* ── 3. Lo que un sitio puede pedir solo ─────────────────────────────────── */
  seccion('la sesión: nada se concede sin que alguien lo pida');

  const ses = sesiones.get(PARTITION);
  let concedido = null;
  ses.permReq({}, 'media', (v) => { concedido = v; });
  t('cámara/micrófono denegados', concedido, false);
  t('el check de permisos también', ses.permCheck(), false);
  t('ningún dispositivo', ses.permDev(), false);

  // Un archivo que aterriza en Descargas sin que nadie lo haya decidido es lo que
  // no queremos de un agente que clickea.
  let frenada = false;
  (ses.handlers['will-download'] || []).forEach((fn) => fn({ preventDefault: () => { frenada = true; } }));
  ok('las descargas se cancelan', frenada);
  // Se presenta como Chrome: sin Electron ni el token de la app, y con la versión
  // recortada como la manda Chrome (la entera la bloquea Cloudflare).
  ok('el UA no dice Electron ni BlackCode', !/Electron|blackcode/i.test(ses.ua || ''), ses.ua);
  ok('…y la versión de Chrome va recortada', /Chrome\/152\.0\.0\.0 /.test(ses.ua || ''), ses.ua);
  ok('…sin romper el resto del string', /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/152\.0\.0\.0 Safari\/537\.36$/.test(ses.ua || ''), ses.ua);
  // El window.chrome del login de Google: un preload DE SESIÓN, no el de la app.
  ok('registra el preload de window.chrome en la sesión', ses.preloads.length === 1 && ses.preloads[0].type === 'frame' && ses.preloads[0].filePath === PRELOAD, JSON.stringify(ses.preloads));

  // Las cookies de sesión se vuelven persistentes (pedido de Fran: que Moodle no
  // desloguee en cada reinicio). Host-only sigue host-only; las con fecha y las
  // borradas no se tocan.
  const dispararCookie = (c, borrada = false) => ses.cookies.oidos.forEach((fn) => fn({}, c, 'explicit', borrada));
  ses.cookies.puestas.length = 0;
  dispararCookie({ name: 'MoodleSession', value: 'abc', domain: 'sied.umaza.edu.ar', hostOnly: true, path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' });
  const puesta = ses.cookies.puestas[0];
  ok('una cookie de sesión se vuelve a guardar con vencimiento', !!puesta && puesta.expirationDate > Date.now() / 1000 + 20 * 86400 && puesta.value === 'abc', JSON.stringify(puesta));
  ok('…con su misma url, path y flags', !!puesta && puesta.url === 'https://sied.umaza.edu.ar/' && puesta.httpOnly === true && puesta.secure === true && puesta.sameSite === 'lax');
  ok('…y host-only sigue sin domain', !!puesta && !('domain' in puesta));
  dispararCookie({ name: 'x', value: '1', domain: '.ejemplo.com', hostOnly: false, path: '/', secure: false, session: true });
  ok('una de dominio conserva su domain', ses.cookies.puestas[1]?.domain === '.ejemplo.com' && ses.cookies.puestas[1]?.url === 'http://ejemplo.com/');
  dispararCookie({ name: 'y', value: '1', domain: 'a.com', path: '/', session: false, expirationDate: 9e9 });
  dispararCookie({ name: 'z', value: '1', domain: 'a.com', path: '/', session: true }, true);
  t('las que ya tienen fecha o se borran no se tocan', ses.cookies.puestas.length, 2);

  /* ── 4. Las dos puertas por las que una página se escapa ──────────────────── */
  seccion('la view: ventanas hijas y esquemas raros');

  const wc = view.webContents;
  // Una ventana hija hereda los webPreferences del padre: sería esto mismo pero
  // suelto, sin barra y fuera de todo lo de arriba. Desde que hay pestañas, el
  // link se abre en una NUEVA (lo que hace cualquier navegador con un _blank), y
  // la nueva nace con el mismo blindaje que la primera — es la misma fábrica.
  const res = wc.openHandler({ url: 'https://example.com/otra', disposition: 'foreground-tab' });
  t('window.open no crea ventana', res.action, 'deny');
  ok('…y el link se abre en una pestaña nueva', construidas.length === 2 && construidas[1].webContents.loaded.includes('https://example.com/otra'),
    construidas.map((v) => v.webContents.loaded.join(',')).join(' | '));
  ok('…que pasa al frente', br.activa.view === construidas[1]);
  ok('…con el mismo aislamiento (sin preload, sandbox)', !('preload' in construidas[1].opts.webPreferences) && construidas[1].opts.webPreferences.sandbox === true);
  // El foco viaja con ella: el click salió de la primera, que quedaría con el
  // teclado estando ya escondida.
  t('…y con el teclado', construidas[1].webContents.focos, 1);
  t('la primera se escondió', construidas[0].calls.visible.at(-1), false);
  t('window.open a un esquema raro no navega a ningún lado', wc.openHandler({ url: 'steam://run/123' }).action, 'deny');
  ok('…y no lo cargó en ninguna', construidas.length === 2 && !construidas.some((v) => v.webContents.loaded.some((u) => u.startsWith('steam:'))));
  // Se cierra la nueva para que el resto del archivo siga hablando de la primera,
  // que es la que tiene los fakes de executeJavaScript enganchados.
  const cierre = br.cerrarTab(br.activa.id);
  ok('cerrar la nueva vuelve a la primera', cierre.ok && br.activa.view === construidas[0], JSON.stringify(cierre));
  ok('…y la view cerrada se cerró de verdad', construidas[1].webContents.cerrada === true);

  const navegar = (url) => {
    let corte = false;
    (wc.handlers['will-navigate'] || []).forEach((fn) => fn({ preventDefault: () => { corte = true; } }, url));
    return corte;
  };
  ok('will-navigate deja pasar https', !navegar('https://ollama.com'));
  ok('will-navigate frena file://', navegar('file:///C:/Windows/System32/'));
  ok('will-navigate frena un protocolo de app', navegar('ms-settings:privacy'));
  const redirigir = (url) => {
    let corte = false;
    (wc.handlers['will-redirect'] || []).forEach((fn) => fn({ preventDefault: () => { corte = true; } }, url));
    return corte;
  };
  ok('will-redirect frena lo mismo (un 302 no es una excepción)', redirigir('mailto:a@b.com'));

  let webviewFrenada = false;
  (wc.handlers['will-attach-webview'] || []).forEach((fn) => fn({ preventDefault: () => { webviewFrenada = true; } }));
  ok('ninguna webview anidada', webviewFrenada);

  /* ── 4b. "Le pegué a otra cosa" ───────────────────────────────────────────
     Lo encontró el banco de pruebas contra un Electron real: con un modal de
     cookies encima del campo, el click de foco no llega, `insertText` escribe en
     la nada y el value queda como estaba — pero `type` devolvía ok pelado y el
     modelo seguía adelante convencido de haber completado el formulario. El aviso
     tiene que viajar en las DOS, no solo en click. */
  seccion('el aviso de que algo estaba encima');

  const puntoTapado = {
    x: 5, y: 5, tapado: true, quien: 'div.banner', editable: true, nombre: 'Campo',
  };
  wc.executeJavaScript = async () => puntoTapado;
  const clickTapado = await br.click('ref_1');
  ok('click avisa que había algo encima', clickTapado.tapado === true && clickTapado.quien === 'div.banner');
  const typeTapado = await br.type('ref_1', 'hola');
  ok('type avisa lo mismo (era el hueco)', typeTapado.tapado === true && typeTapado.quien === 'div.banner');
  // Y un campo que no es campo se rechaza antes de teclear en cualquier lado.
  wc.executeJavaScript = async () => ({ ...puntoTapado, editable: false, tapado: false });
  ok('type sobre algo que no es editable falla', (await br.type('ref_1', 'x')).ok === false);
  wc.executeJavaScript = async () => ({});

  /* ── 4c. Los iframes ──────────────────────────────────────────────────────
     El agujero que reportó el uso real: la lectura corría SOLO en el documento de
     arriba, así que un artifact de claude.ai —que vive adentro de un iframe— se
     leía como la carcasa vacía: el título, dos botones y el link de "Sign in". El
     modelo concluía, razonablemente, que la página no tenía nada. */
  seccion('leer y tocar adentro de un iframe');

  // Un frame hijo, con su propio documento. `dentro` es lo que devuelve el script
  // de lectura corriendo ahí, y el iframe empieza en (100, 60) del padre.
  const hijo = {
    frames: [],
    executeJavaScript: async (code) => {
      if (code.startsWith('Array')) return []; // el hijo no tiene iframes propios
      if (code.includes('data-neon-ref=')) {
        // el script del punto: el elemento está en (20,30) DE SU PROPIO viewport
        return { x: 20, y: 30, tapado: false, quien: '', editable: false, nombre: 'Botón del iframe' };
      }
      return {
        title: 'Dermocosmética TPL 4', url: 'https://artifact.example/x',
        text: 'El estrato córneo de la epidermis es la principal barrera de permeación.',
        cortado: false, elements: ['[ref_3] button "Adentro del iframe"'], total: 1,
      };
    },
  };
  wc.mainFrame.frames = [hijo];
  wc.executeJavaScript = async (code) => {
    if (code.startsWith('Array')) return [{ x: 100, y: 60, w: 500, h: 400 }]; // dónde está el iframe
    if (code.includes('data-neon-ref=')) return { error: 'gone' };             // el ref no es del padre
    return {
      title: 'Carcasa', url: 'https://claude.ai/code/artifact/7db17446',
      text: 'Sign in', cortado: false, elements: ['[ref_1] link "Sign in"', '[ref_2] button "Share"'], total: 2,
    };
  };

  const leido = await br.read();
  ok('la lectura entra al iframe', leido.frames === 1, `frames: ${leido.frames}`);
  ok('junta los elementos de los dos', leido.elements.length === 3, JSON.stringify(leido.elements));
  ok('el texto del iframe viene aparte, no pegado al padre',
    leido.partes.length === 2 && leido.partes[0].frame === false && leido.partes[1].frame === true);
  ok('…y con la dirección del frame, que es otro documento', leido.partes[1].url === 'https://artifact.example/x');
  ok('el título sigue siendo el de la página, no el del frame', leido.title === 'Carcasa');

  // LA TRADUCCIÓN DE COORDENADAS. El elemento dice (20,30) medido contra el
  // viewport del iframe; el iframe empieza en (100,60) de la página. El evento se
  // manda a la pestaña, así que va a (120,90). Sin la suma, el click aterriza a
  // cientos de píxeles de donde tenía que ir — y encima se reporta como exitoso.
  const clickFrame = await br.click('ref_3');
  ok('el click adentro del iframe suma el offset del frame', clickFrame.ok === true);
  const ultimoDown = wc.inputs.filter((e) => e.type === 'mouseDown').pop();
  ok('…y aterriza en (120, 90)', ultimoDown && ultimoDown.x === 120 && ultimoDown.y === 90,
    JSON.stringify(ultimoDown));

  // Un frame sin caja no se lee ni se toca: es un pixel de tracking, y clickear
  // donde no hay nada es peor que decir que no está.
  wc.executeJavaScript = async (code) => {
    if (code.startsWith('Array')) return [{ x: 0, y: 0, w: 0, h: 0 }];
    if (code.includes('data-neon-ref=')) return { error: 'gone' };
    return { title: 'Sola', url: 'https://x/', text: 'nada', cortado: false, elements: [], total: 0 };
  };
  const sinCaja = await br.read();
  ok('un iframe de 0×0 no entra en la lectura', sinCaja.frames === 0);
  ok('y su ref no se puede clickear', (await br.click('ref_3')).ok === false);

  wc.mainFrame.frames = [];
  wc.executeJavaScript = async () => ({});

  /* ── 5. La migaja del system prompt ───────────────────────────────────────── */
  seccion('breadcrumb: qué se le cuenta al modelo sin que pregunte');

  t('sin panel a la vista, no hay migaja', br.breadcrumb(), null);
  // Cuelga del PANEL y no de la capa: la capa se apaga sola cada vez que la app
  // pone algo encima, y la migaja no tiene que parpadear porque el usuario abrió
  // Settings medio segundo.
  br.setVisible(true);
  t('la capa prendida no alcanza: la migaja mira el panel', br.breadcrumb(), null);
  br.panelAbierto = true;
  t('con el panel abierto pero sin página, tampoco', br.breadcrumb(), null);
  wc.url = 'https://ollama.com/library';
  wc.title = 'Library';
  br._emitir();
  t('con página: título y URL', br.breadcrumb(), 'Library — https://ollama.com/library');
  ok('y el mismo cambio avisó al renderer', avisos.length > 0 && avisos.at(-1).url === 'https://ollama.com/library');
  // La migaja es una LÍNEA. Si alguna vez alguien mete el cuerpo de la página acá,
  // son miles de tokens en cada turno, repetidos, sobre un presupuesto que en esta
  // app ya se comen los MCP.
  ok('la migaja es una sola línea', !/\n/.test(br.breadcrumb() || ''));

  /* ── 10 (lo que es de la clase). La foto con la que la capa se tapa ───────── */
  seccion('freeze es JPEG, capture es PNG');

  // JPEG y no PNG, y la diferencia es la que hace que la idea funcione: medido
  // sobre el hueco real (506×765), 2ms contra 30 y 68KB contra 109. Con PNG la foto
  // no entra en un frame y el modal alcanza a abrirse con la página encima.
  const bjs = fs.readFileSync(AGENT, 'utf8');
  const metodo = (nombre) => (bjs.match(new RegExp(`async ${nombre}\\(\\)[\\s\\S]*?\\n  \\}`)) || [''])[0];
  ok('el freeze es JPEG', /toJPEG\(/.test(metodo('freeze')) && !/toPNG\(/.test(metodo('freeze')), metodo('freeze'));
  // …y el de la cámara sigue siendo PNG: esa foto termina en el chat, no atrás de
  // un velo, y ahí sí se le miran los bordes.
  ok('y el de la cámara sigue siendo PNG', /toPNG\(/.test(metodo('capture')) && !/toJPEG\(/.test(metodo('capture')));

  /* ── 11b. …y también cruzan la PÁGINA ─────────────────────────────────────
     El gemelo de lo de arriba, que durante tres versiones no existió. La terminal
     aprendió la regla ("el contenido se queda con todo salvo las teclas que sirven
     para salir de él") y el browser no, porque del lado del browser el mecanismo
     es otro: la página vive en su propio webContents y no hay burbujeo que cortar
     —el keydown no llega NUNCA al document del renderer—, así que el atajo no se
     perdía una pelea, directamente no se jugaba. Adentro de un editor web, Ctrl+B
     era negrita.
     Se prueba sobre el handler de verdad, enganchado por el módulo real: lo que
     importa acá es que la tecla no le llegue al sitio, y eso solo se ve
     disparando el before-input-event. */
  seccion('los atajos de salir cruzan la página');

  const teclear = (key, mods = {}) => {
    let cortada = false;
    const antes = atajos.length;
    const e = { preventDefault: () => { cortada = true; } };
    const input = { type: 'keyDown', key, control: true, meta: false, shift: false, alt: false, ...mods };
    (wc.handlers['before-input-event'] || []).forEach((fn) => fn(e, input));
    return { cortada, aviso: atajos.length > antes ? atajos[atajos.length - 1] : null };
  };

  ok('hay un handler enganchado', (wc.handlers['before-input-event'] || []).length === 1);
  const ctrlB = teclear('b');
  ok('Ctrl+B no le llega a la página', ctrlB.cortada);
  ok('…y sale como aviso al renderer', !!ctrlB.aviso, JSON.stringify(ctrlB.aviso));
  const ctrlT = teclear('t');
  ok('Ctrl+T tampoco', ctrlT.cortada && !!ctrlT.aviso);
  // El Ctrl+F queda afuera del MISMO modo que en la terminal: adentro de una
  // página es el buscador del sitio, y ese es el que el usuario está usando.
  ok('el Ctrl+F sí es de la página', !teclear('f').cortada);
  ok('una tecla suelta también', !teclear('b', { control: false }).cortada);
  ok('y Ctrl+Shift+B no es el atajo', !teclear('b', { shift: true }).cortada);
  // keyUp llega por el mismo evento y con la misma tecla: sin el filtro, el
  // renderer recibía DOS avisos por pulsación y el panel cerraba y volvía a abrir.
  ok('el keyUp no cuenta como segunda pulsación', !teclear('b', { type: 'keyUp' }).cortada);

  // El foco: sin esto el atajo andaba UNA vez. Apagar la capa no le saca el teclado
  // al webContents de la página, así que el Ctrl+B siguiente lo seguía comiendo una
  // view que ya no estaba en pantalla y el panel no volvía a abrir nunca más.
  // Y EXACTAMENTE dos, uno por atajo: el foco se mueve solo cuando la tecla es de
  // la app. Moverlo en cada pulsación sería peor que el bug original — le sacaría
  // el teclado a la página en mitad de una palabra.
  t('el teclado vuelve a la app, y solo con los atajos', win.webContents.focos, 2);

  // La traducción: el `input` de Electron trae control/meta/shift/alt, el DOM trae
  // ctrlKey y compañía. Si esto se rompe, los predicados copiados del renderer
  // dejan de medir lo mismo y el aviso viaja con la tecla equivocada.
  t('el aviso viaja como KeyboardEvent', ctrlB.aviso.ctrlKey, true);
  t('…con la tecla adentro', ctrlB.aviso.key, 'b');
  ok('…y sin los nombres de Electron', !('control' in ctrlB.aviso), Object.keys(ctrlB.aviso).join(','));

  // LOS PREDICADOS SON COPIA LITERAL del renderer, y esa es justamente la costura:
  // la decisión se toma en el main (preventDefault no espera un IPC) pero el que
  // actúa es el renderer. Si las dos listas se separan, la tecla se le saca a la
  // página para que después no haga nada — el peor de los dos mundos.
  const bj = bjs;
  const pred = (src, nombre) => (src.match(new RegExp(`const ${nombre} = \\(e\\) => [^\\n]+`)) || [''])[0].replace(`const ${nombre} = `, '');
  // El del browser es `function` en el renderer y arrow en el main: se compara el
  // cuerpo, que es lo que tiene que coincidir.
  ok('esToggleBrowser también', pred(bj, 'esToggleBrowser').includes("(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')"), pred(bj, 'esToggleBrowser'));
  ok('y la lista de salida es la misma', /const esAtajoDeSalida = \(e\) => esToggleBrowser\(e\) \|\| esToggleTerm\(e\)/.test(bj));

  /* ── 13. Las pestañas ─────────────────────────────────────────────────────
     Hasta cuatro, UNA a la vista. Lo que se prueba es la política y no la
     mecánica: el techo se impone en un solo lugar y le llega a los tres que piden
     pestaña, las de fondo no se dibujan nunca, los bounds les llegan a todas, y
     cerrar la última deja una en blanco en vez de un panel sin pestaña. */
  seccion('pestañas: hasta cuatro, una a la vista');

  const { MAX_TABS } = B;
  t('el techo es cuatro', MAX_TABS, 4);
  t('esta sección arranca con una', br.state().tabs.length, 1);
  const antesTabs = construidas.length;
  br.setBounds({ x: 10, y: 20, width: 500, height: 700 });
  br.setVisible(true);

  const t2 = br.nuevaTab('ollama.com');
  ok('nuevaTab abre y activa', t2.ok && br.activa.id === t2.id, JSON.stringify(t2));
  t('…normalizando la URL como la barra', t2.url, 'https://ollama.com');
  const v2 = construidas[antesTabs];
  // Una de fondo con viewport 0×0 es una página que se cree en un teléfono de cero
  // píxeles, y al pasar al frente se remaqueta entera delante del usuario.
  ok('la nueva nace con los bounds del hueco, no en 0×0', v2.calls.bounds[0]?.width === 500, JSON.stringify(v2.calls.bounds[0]));
  ok('…y a la vista, porque la capa estaba prendida', v2.calls.visible.at(-1) === true);
  ok('la anterior se escondió', construidas[0].calls.visible.at(-1) === false);
  t('sin foco: la pidió el código, no el usuario', v2.webContents.focos, 0);

  const t3 = br.nuevaTab('https://github.com/x', { activar: false });
  ok('una de fondo no pasa al frente', t3.ok && br.activa.id === t2.id);
  ok('…y no se dibuja', construidas[antesTabs + 1].calls.visible.every((v) => v === false));

  const t4 = br.nuevaTab(null, { activar: false });
  ok('la cuarta entra (en blanco, de fondo)', t4.ok && br.state().tabs.length === 4 && br.activa.id === t2.id);
  const t5 = br.nuevaTab('https://example.com');
  ok('la quinta NO, y lo dice', t5.ok === false && t5.lleno === true && /limit/.test(t5.error), JSON.stringify(t5));
  t('…y no construyó ninguna view', construidas.length, antesTabs + 3);
  // El _blank con el cupo lleno navega en la activa, como cuando había una sola:
  // denegar a secas deja links que "no hacen nada".
  const activaLlena = br.wc;
  activaLlena.openHandler({ url: 'https://example.com/lleno', disposition: 'foreground-tab' });
  ok('con el cupo lleno, _blank navega en la activa', activaLlena.loaded.includes('https://example.com/lleno'), activaLlena.loaded.join(','));
  t('…sin abrir otra', construidas.length, antesTabs + 3);

  br.setBounds({ x: 10, y: 20, width: 600, height: 700 });
  ok('setBounds le llega a las cuatro', br.tabs.every((tb) => tb.view.calls.bounds.at(-1).width === 600));
  br.setVisible(false);
  ok('setVisible(false) apaga la activa', br.activa.view.calls.visible.at(-1) === false);
  br.setVisible(true);
  ok('…y setVisible(true) prende SOLO la activa', br.tabs.every((tb) => tb.view.calls.visible.at(-1) === (tb === br.activa)));

  // El estado que pinta la tira: cada pestaña con id, título, url, loading y cuál
  // es la activa. El techo viaja adentro para que la tira no tenga un 4 escrito.
  const st4 = br.state();
  t('el estado lista las cuatro', st4.tabs.length, 4);
  t('…con el techo adentro', st4.maxTabs, 4);
  ok('una sola activa, y es la que dice `activa`', st4.tabs.filter((x) => x.active).length === 1 && st4.activa === t2.id);
  ok('cada una con id distinto', new Set(st4.tabs.map((x) => x.id)).size === 4);
  ok('la URL de la vacía sale vacía, no about:blank', st4.tabs.find((x) => x.id === t4.id).url === '');

  // La migaja: la activa como siempre y las otras por título, en UNA línea. Sin
  // esto "la otra pestaña" del usuario no le decía nada al modelo.
  construidas[antesTabs].webContents.title = 'Ollama';
  construidas[antesTabs + 1].webContents.title = 'GitHub';
  br._emitir();
  const miga = br.breadcrumb();
  // La activa es t2, que el _blank de arriba mandó a example.com/lleno; las otras
  // por título, y la vacía como "blank".
  t('la migaja: la activa primero y las otras por título', miga, 'Ollama — https://example.com/lleno · other tabs: Library, GitHub, blank');
  ok('…y sigue siendo una línea', !/\n/.test(miga));
  // Con la activa en blanco y otras cargadas, la migaja no desaparece: el panel
  // sigue abierto y el modelo tiene que saber que hay pestañas.
  br.activar(t4.id);
  ok('activa en blanco con otras: la migaja lo dice', /^a blank tab · other tabs: /.test(br.breadcrumb()), br.breadcrumb());

  // Cambiar con foco (lo pide el usuario): el teclado se va con la que pasa al
  // frente, porque esconder una view no se lo saca. Sin foco cuando lo pide el
  // modelo (le robaría el cursor al usuario en el composer).
  const r3 = br.activar(t3.id, { foco: true });
  ok('activar cambia la activa', r3.ok && br.activa.id === t3.id);
  t('…y le da el teclado', construidas[antesTabs + 1].webContents.focos, 1);
  ok('…y la anterior se esconde', construidas[antesTabs + 2].calls.visible.at(-1) === false);
  br.activar(t2.id);
  t('activar sin foco no toca el teclado', construidas[antesTabs].webContents.focos, 0);
  br.activar(t4.id, { foco: true });
  t('a una en blanco no se la enfoca ni con foco (ahí lo que se quiere es la barra)', construidas[antesTabs + 2].webContents.focos, 0);

  // Cerrar la activa deja a la vecina de la derecha, y si no hay, la de la
  // izquierda: lo que hace cualquier navegador.
  br.activar(t2.id); // orden de la tira: [1, t2, t3, t4]
  const c2 = br.cerrarTab(t2.id);
  ok('cerrar la activa pasa a la de la derecha', c2.ok && br.activa.id === t3.id, JSON.stringify(c2));
  ok('…y la view se cerró', construidas[antesTabs].webContents.cerrada === true);
  t('quedan tres', br.state().tabs.length, 3);
  br.activar(t4.id); // [1, t3, t4] → cerrar la del final
  br.cerrarTab(t4.id);
  ok('cerrar la última de la fila pasa a la de la izquierda', br.activa.id === t3.id);
  br.cerrarTab(1); // la primera, de fondo → [t3]
  ok('cerrar una de fondo no cambia la activa', br.activa.id === t3.id && br.state().tabs.length === 1);
  ok('…pero sí la cerró', construidas[0].webContents.cerrada === true);

  // La última no se cierra: se reemplaza por una en blanco, con view NUEVA — cerrar
  // tiene que devolver la memoria de la página y dejar el historial limpio, y
  // navegar la vieja a about:blank no hace ninguna de las dos.
  const antesUltima = construidas.length;
  const cu = br.cerrarTab(t3.id);
  ok('cerrar la última deja una en blanco', cu.ok && br.state().tabs.length === 1 && br.state().url === '', JSON.stringify(br.state().tabs));
  ok('…que es una view nueva', construidas.length === antesUltima + 1 && construidas.at(-1).webContents.loaded[0] === 'about:blank');
  ok('…y la vieja se cerró de verdad', construidas[antesTabs + 1].webContents.cerrada === true);
  ok('el panel sigue vivo', br.alive);
  ok('activar un id que no existe falla limpio', br.activar(999).ok === false);
  ok('cerrar un id que no existe falla limpio', br.cerrarTab(999).ok === false);

  /* ── 13b. Las teclas de las pestañas cruzan la página ─────────────────────
     Misma regla que los atajos de salida (11b): la página se queda con todo salvo
     las teclas de la app, y estas tres son de la app. Con una diferencia: el
     teclado NO vuelve al renderer, se queda en el browser — quien lo recibe es la
     pestaña que pasa al frente. */
  seccion('los atajos de pestañas cruzan la página');

  const teclearEn = (w, key, mods = {}) => {
    let cortada = false;
    const antes = atajos.length;
    const e = { preventDefault: () => { cortada = true; } };
    const input = { type: 'keyDown', key, control: true, meta: false, shift: false, alt: false, ...mods };
    (w.handlers['before-input-event'] || []).forEach((h) => h(e, input));
    return { cortada, aviso: atajos.length > antes ? atajos[atajos.length - 1] : null };
  };
  const focosAntes = win.webContents.focos;
  const ctrlTab = teclearEn(br.wc, 'Tab');
  ok('Ctrl+Tab no le llega a la página', ctrlTab.cortada);
  ok('…y sale como aviso al renderer, con la tecla', !!ctrlTab.aviso && ctrlTab.aviso.key === 'Tab' && ctrlTab.aviso.ctrlKey === true, JSON.stringify(ctrlTab.aviso));
  ok('Ctrl+Shift+Tab también', teclearEn(br.wc, 'Tab', { shift: true }).cortada);
  ok('Ctrl+W también', teclearEn(br.wc, 'w').cortada);
  ok('Tab pelado sí es de la página', !teclearEn(br.wc, 'Tab', { control: false }).cortada);
  ok('Ctrl+Alt+Tab no es el atajo', !teclearEn(br.wc, 'Tab', { alt: true }).cortada);
  t('el teclado NO vuelve a la app con los de pestañas', win.webContents.focos, focosAntes);
  // …y con uno de salida sí, para que se vea la diferencia en el mismo lugar.
  ok('Ctrl+T sigue siendo de salida (la terminal), no pestaña nueva', teclearEn(br.wc, 't').cortada);
  t('…y ese sí devuelve el teclado a la app', win.webContents.focos, focosAntes + 1);

  // Los predicados de las pestañas existen de este lado (la copia del renderer
  // es de la interfaz, que no es de este port).
  ['esTabSiguiente', 'esTabAnterior', 'esCerrarTab', 'esAtajoDeTabs'].forEach((n) => {
    ok(`${n} existe`, pred(bj, n).length > 10, pred(bj, n));
  });

  /* ── 6b. Lo que el modelo gana (1.3.0) ────────────────────────────────────── */
  seccion('el modelo: teclas, páginas, selects, sombras y techo de tiempo');

  t('uaComoChrome deja intacto un UA que ya es de Chrome', B.uaComoChrome('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36'), 'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36');
  t('normalizarTecla: exacta', B.normalizarTecla('Escape'), 'Escape');
  t('…sin mayúsculas', B.normalizarTecla('pagedown'), 'PageDown');
  t('…con alias', B.normalizarTecla('Esc'), 'Escape');
  t('…y lo que no está en la lista es null', B.normalizarTecla('F12'), null);
  // Ctrl solo para editar (A/C/X/V/Z y Ctrl+Enter, ronda 4); nunca Alt, ni los
  // Ctrl que son de la app o del navegador (W, T, Tab, B).
  ok('la lista no tiene Alt ni los Ctrl de la app', !B.TECLAS_VALIDAS.some((k) => /alt|ctrl\+(w|t|tab|b)$/i.test(k)));
  ok('…y sí los de edición', ['Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+Enter'].every((k) => B.TECLAS_VALIDAS.includes(k)));

  const brSrc = bjs;
  // Ningún executeJavaScript sin techo: el único directo es el del helper.
  ok('todo executeJavaScript pasa por evalFrame', (brSrc.match(/\.executeJavaScript\(/g) || []).length === 1 && /Promise\.race\(\[frame\.executeJavaScript/.test(brSrc));
  ok('la lectura atraviesa shadow roots', /todosProfundo\(SEL\)/.test(brSrc) && /textoSombra\(raiz\)/.test(brSrc));
  ok('…y el click también los encuentra', /const scriptPunto[\s\S]*?unoProfundo\(/.test(brSrc));
  ok('…con el hit test contra su propio root', /raizEl\.elementFromPoint/.test(brSrc));
  ok('un select se elige con el setter del prototipo, sin mouse', /HTMLSelectElement\.prototype, 'value'\)\.set/.test(brSrc) && /if \(p\.select\) return this\._elegir/.test(brSrc));
  ok('los PDFs se dibujan (plugins)', /plugins: true/.test(brSrc));
  ok('el CDP de la subida se suelta al terminar si lo enganchó ella', /if \(propio\) \{ try \{ dbg\.detach\(\);/.test(brSrc));

  // Una página que se cierra sola (window.close(): el popup de login de Google
  // convertido en pestaña) sale de la lista, y el estado no revienta. Antes
  // quedaba adentro con la view muerta y cada evento tiraba un cartel de error
  // del main (2/11/2026, entrando a claude.ai).
  const brC = new AgentBrowser({});
  brC.attach(win, { restaurar: { urls: ['https://claude.ai/', 'https://accounts.google.com/gsi/transform'], activa: 1 } });
  const idGoogle = brC.state().tabs[1].id;
  brC.activa.view.webContents.close(); // la página se cierra a sí misma
  const stC = brC.state();
  t('la pestaña que se cerró sola sale de la lista', stC.tabs.length, 1);
  ok('…queda al frente la vecina, viva', stC.open === true && stC.tabs[0].active && !stC.tabs.some((x) => x.id === idGoogle));
  let reviento = null;
  try { brC._emitir(); } catch (err) { reviento = err; }
  ok('…y emitir estado después no revienta', reviento === null);
  brC.activa.view.webContents.close();
  t('si se cierra la última, queda una en blanco', brC.state().tabs.length, 1);

  // El popup de un login ("Entrar con Google") es una ventana de verdad, con
  // opener; un _blank sigue siendo una pestaña.
  const oh = brC.activa.view.webContents.openHandler;
  const popup = oh({ url: 'https://accounts.google.com/gsi/select', disposition: 'new-window' });
  ok('window.open con tamaño = ventana de verdad', popup.action === 'allow' && popup.overrideBrowserWindowOptions.webPreferences.sandbox === true && !('preload' in popup.overrideBrowserWindowOptions.webPreferences));
  const blank = oh({ url: 'https://ejemplo.com/', disposition: 'foreground-tab' });
  ok('…y un _blank sigue siendo pestaña', blank.action === 'deny' && brC.state().tabs.length === 2);
  ok('…un popup a un esquema raro tampoco nace', oh({ url: 'ms-settings:privacy', disposition: 'new-window' }).action === 'deny');
  brC.destroy();

  // Las pestañas vuelven donde quedaron (pedido de Fran, 2/11/2026). Cada
  // dirección se revalida: el archivo es del disco, y un file:// no pasa.
  const brR = new AgentBrowser({});
  brR.attach(win, { restaurar: { urls: ['https://moodle.example/', '', 'file:///C:/secreto.txt', 'https://ig.example/', 'https://quinta.example/'], activa: 3 } });
  const stR = brR.state();
  t('restaura hasta el techo de pestañas', stR.tabs.length, 4);
  t('…con la que estaba al frente', stR.tabs.findIndex((x) => x.active), 3);
  ok('…y lo que no es http(s) vuelve en blanco', !/file:/.test(JSON.stringify(stR.tabs.map((x) => x.url))));
  brR.destroy();

  /* ── 7. Cierre ────────────────────────────────────────────────────────────── */
  seccion('destroy');

  br.destroy();
  ok('la pestaña se cierra', wc.cerrada === true);
  ok('…todas: ninguna view queda viva', construidas.every((v) => v.webContents.cerrada === true));
  ok('y el módulo queda sin view', br.alive === false);
  t('sin view, el estado dice que no hay panel', br.state().open, false);
  t('…y sin pestañas', br.state().tabs.length, 0);
  ok('navegar sin panel no explota', br.navigate('https://x.com').ok === false);
  ok('abrir pestaña sin panel tampoco', br.nuevaTab('https://x.com').ok === false);

  // ═══ navegador.cjs: lo que allá vivía en main.js ═══════════════════════════
  seccion('navegador.cjs · cableado');

  t('navegador.cjs exporta lo que dice', Object.keys(N).sort(), [
    'BROWSER_AVISO', 'TECLAS_VALIDAS', 'UPLOAD_MAX_BYTES', 'UPLOAD_MAX_FILES', 'agentBrowser', 'agruparRefs', 'agruparTexto', 'agruparTiradas',
    'anotarPestanas', 'asegurarPanel', 'buscarFavorito', 'cerrar', 'configurar', 'despertar', 'dormir', 'escribirPestanas', 'esperarBrowser',
    'favoritosLista', 'guardarFavoritos', 'ipc', 'leerPestanas', 'lineaTabs', 'migaja', 'nombreFavorito', 'runners', 'volcarPestanas',
  ]);
  t('sus runners son los seis del navegador', Object.keys(N.runners),
    ['browser_navigate', 'browser_read', 'browser_click', 'browser_type', 'browser_press', 'browser_upload']);
  t('ipc tiene una función por canal', Object.keys(N.ipc),
    ['attach', 'bounds', 'panel', 'visible', 'state', 'navigate', 'tabNew', 'tabGo', 'tabClose', 'back', 'forward', 'reload', 'stop',
      'capture', 'freeze', 'external', 'favList', 'favToggle', 'favRemove', 'favOpen',
      // el historial (0.18.0): los cuatro canales de su ventana
      'histList', 'histRemove', 'histClear', 'histOpen']);
  ok('  y todas son funciones', Object.values(N.ipc).every((f) => typeof f === 'function'));
  ok('la instancia es un AgentBrowser', N.agentBrowser instanceof AgentBrowser);
  ok('  que nace sin pestaña: perezosa, hasta el primer attach', N.agentBrowser.alive === false && N.agentBrowser.panelAbierto === false);
  ok('TECLAS_VALIDAS es la lista cerrada de agent-browser.cjs', N.TECLAS_VALIDAS === B.TECLAS_VALIDAS && N.TECLAS_VALIDAS.length === 20);
  t('los techos de una subida son los de NeonCode', [N.UPLOAD_MAX_FILES, N.UPLOAD_MAX_BYTES], [10, 100 * 1024 * 1024]);
  t('la partición es la de BlackCode, no la de NeonCode', PARTITION, 'persist:nix-browser');
  ok('el preload de sesión está al lado de agent-browser.cjs', fs.existsSync(PRELOAD));
  {
    // Sin electron falso y sin configurar: lo que ve quien lo carga desde un test.
    const r = spawnSync(process.execPath,
      ['-e', "const N = require(process.argv[1]); process.stdout.write([Object.keys(N.runners).length, N.migaja().length, N.ipc.attach().open, N.ipc.state().open].join(' '))", NAVEGADOR],
      { encoding: 'utf8', windowsHide: true });
    t('se carga con node pelado, sin Electron y sin configurar', [r.status, r.stdout], [0, '6 0 false false']);
  }
  {
    // El aviso de contenido no confiable va PEGADO a la lectura y no solo en el
    // system prompt: el modelo lo lee en el punto donde decide. (Del original.)
    ok('la lectura avisa que el contenido es DATO', /untrusted DATA/i.test(N.BROWSER_AVISO));
    ok('  y que lo que pida la página no es una orden', /not (a command|instructions)/i.test(N.BROWSER_AVISO), N.BROWSER_AVISO);
  }
  {
    // El instalador: allá el preload se listaba a mano en `files`; acá viaja con
    // toda la carpeta main.
    const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'package.json'), 'utf8')).build.files;
    ok('el preload de window.chrome viaja en el instalador', files.includes('main/**/*'), JSON.stringify(files));
  }

  seccion('chips: lo tecleado no viaja');
  {
    // EL TEST QUE MÁS IMPORTA DEL ORIGINAL. El digest se muestra en el chip, se
    // GUARDA con el chat y vuelve al modelo en el registro de cada ronda. Allá se
    // sacaba del texto de main.js; acá es del motor.
    const { argsDigest } = motor;
    const secreto = 'hunter2-esto-no-puede-viajar';
    const digestType = argsDigest('browser_type', { ref: 'ref_4', text: secreto, submit: true });
    ok('browser_type NO filtra lo tecleado', !digestType.includes(secreto), digestType);
    ok('  pero sí dice en qué campo fue', digestType.includes('ref_4'), digestType);
    t('browser_navigate muestra el host', argsDigest('browser_navigate', { url: 'https://ollama.com/x?token=abc' }), 'ollama.com');
    t('browser_click muestra el ref', argsDigest('browser_click', { ref: 'ref_12' }), 'ref_12');
    t('digest de una pestaña nueva lo dice', argsDigest('browser_navigate', { url: 'https://ollama.com/x?token=abc', new_tab: true }), 'ollama.com · new tab');
    t('digest de un cambio de pestaña muestra el número', argsDigest('browser_navigate', { tab: 2 }), 'tab 2');
    t('digest sin pestaña sigue igual', argsDigest('browser_navigate', { url: 'https://ollama.com/x' }), 'ollama.com');
    // La ronda gratis es para LEER. Navegar cambia lo que el usuario tiene en
    // pantalla.
    ok('browser_read cuenta como lectura', motor.READ_ROUND_TOOLS.has('browser_read'));
    ok('  y las otras cinco no', ['browser_navigate', 'browser_click', 'browser_type', 'browser_press', 'browser_upload'].every((n) => !motor.READ_ROUND_TOOLS.has(n)));
  }

  seccion('lineaTabs y las tiradas que se repiten');
  {
    const { lineaTabs } = N;
    t('con una pestaña no hay línea (sería ruido)', lineaTabs({ tabs: [{ id: 1, active: true }], maxTabs: 4 }), '');
    const linea = lineaTabs({ maxTabs: 4, tabs: [
      { id: 1, title: 'Ollama', url: 'https://ollama.com/library', active: false },
      { id: 2, title: '', url: 'https://github.com/x', active: true },
    ] });
    ok('con dos, las numera por posición y marca la activa', /\[1\] Ollama \(ollama\.com\)/.test(linea) && /\[2\] github\.com ← this one/.test(linea), linea);
    ok('…y dice cuántas entran', /Tabs \(2 of 4\)/.test(linea), linea);
  }
  {
    const { agruparRefs, agruparTexto } = N;
    // El texto también (ronda 3): las secciones vacías se dicen una vez, pero una
    // tabla de notas (con tabs) o una columna de números son datos y no se tocan.
    const textoMoodle = ['Inicio', ...Array.from({ length: 13 }, (_, k) => [`Topic ${15 + k}`, `Colapsar Topic ${15 + k}`]).flat(), 'Fin'].join('\n');
    const tm = agruparTexto(textoMoodle).split('\n');
    t('las 13 secciones del texto quedan en primera + resumen + última', tm.length, 1 + 2 + 1 + 2 + 1);
    ok('…con el resumen de cuántas', tm.includes('… 11 more like this …'), tm.join(' | '));
    const notas = Array.from({ length: 6 }, (_, k) => `Parcial ${k + 1}\t${k + 4},00`).join('\n');
    t('una tabla (con tabs) no se agrupa', agruparTexto(notas), notas);
    const numeros = ['10', '20', '30', '40', '50'].join('\n');
    t('una columna de números tampoco', agruparTexto(numeros), numeros);
    const secciones = [];
    for (let k = 0; k < 6; k++) secciones.push(`[ref_${10 + 2 * k}] link "Topic ${15 + k}"`, `[ref_${11 + 2 * k}] button "Colapsar Topic ${15 + k}"`);
    const agrupadas = agruparRefs(['[ref_9] link "Inicio"', ...secciones, '[ref_22] link "Salir"']);
    t('un bloque de dos que se repite 6 veces queda en primera + resumen + última', agrupadas.length, 1 + 2 + 1 + 2 + 1);
    ok('…el resumen dice cuántas y qué refs abarca', /4 more of the same pattern \(ref_12 to ref_19, in order\)/.test(agrupadas.join('\n')), agrupadas.join(' | '));
    ok('…y lo de alrededor queda intacto', agrupadas[0] === '[ref_9] link "Inicio"' && agrupadas[agrupadas.length - 1] === '[ref_22] link "Salir"');
    const distintos = ['[ref_1] button "Ana"', '[ref_2] button "Beto"', '[ref_3] button "Caro"', '[ref_4] button "Dani"', '[ref_5] button "Eli"'];
    t('nombres distintos no se agrupan', agruparRefs(distintos).length, 5);
    t('tres iguales tampoco (hacen falta cuatro)', agruparRefs(['[ref_1] link "Semana 1"', '[ref_2] link "Semana 2"', '[ref_3] link "Semana 3"']).length, 3);
  }

  // ── la app de mentira ──────────────────────────────────────────────────────
  const ab = N.agentBrowser;
  const win2 = {
    contentView: { addChildView() {}, removeChildView() {} },
    isDestroyed: () => false,
    webContents: { focos: 0, focus() { this.focos++; } },
  };
  let ventanaActual = null;
  let ve = false;
  const afuera = [];
  const avisosApp = [];
  const cuantos = (canal) => avisosApp.filter(([c]) => c === canal).length;
  N.configurar({
    ventana: () => ventanaActual,
    carpeta: CARPETA,
    avisar: (canal, datos) => avisosApp.push([canal, datos]),
    modeloVe: () => ve,
    abrirAfuera: (u) => afuera.push(u),
  });
  // Reemplaza métodos de la instancia por una respuesta fija mientras corre fn.
  const con = async (stubs, fn) => {
    Object.assign(ab, stubs);
    try { return await fn(); } finally { for (const k of Object.keys(stubs)) delete ab[k]; }
  };
  const nav = (args, run = hacerRun()) => N.runners.browser_navigate(run, args);

  seccion('navegador.cjs · sin ventana');
  {
    const eranSin = construidas.length;
    ok('configurar creó la carpeta de los datos', fs.statSync(CARPETA).isDirectory());
    t('attach sin ventana no abre nada', N.ipc.attach(), { open: false });
    const SIN = 'error: there is no window to open the browser panel in (this run has no UI).';
    const pedidos = {
      browser_navigate: { url: 'ollama.com' },
      browser_read: {},
      browser_click: { ref: 'ref_1' },
      browser_type: { ref: 'ref_1', text: 'hola' },
      browser_press: { key: 'Escape' },
      browser_upload: { ref: 'ref_1', paths: ['a.txt'] },
    };
    for (const [nombre, args] of Object.entries(pedidos)) {
      t(`${nombre} sin ventana lo dice y no hace nada`, await N.runners[nombre](hacerRun(), args), SIN);
    }
    t('  sin pedirle a nadie que abra el panel', cuantos('browser:open'), 0);
    ventanaActual = { isDestroyed: () => true };
    t('con la ventana ya destruida, lo mismo', [N.ipc.attach(), await N.runners.browser_read(hacerRun(), {})], [{ open: false }, SIN]);
    ventanaActual = null;
    t('sin panel no hay migaja', N.migaja(), '');
    t('  y el estado dice que no hay panel', [N.ipc.state().open, N.ipc.state().tabs.length], [false, 0]);
    let tiro = null;
    try {
      N.dormir(); N.despertar(); N.ipc.bounds({ x: 1, y: 1, width: 1, height: 1 }); N.ipc.visible(true); N.ipc.panel(false);
      N.ipc.back(); N.ipc.forward(); N.ipc.reload(); N.ipc.stop(); N.ipc.external(); N.cerrar();
    } catch (e) { tiro = e; }
    ok('  y nada de lo demás explota sin pestaña', tiro === null, String(tiro?.stack || tiro));
    t('  ni la captura ni la foto', [await N.ipc.capture(), await N.ipc.freeze()], [null, null]);
    t('  ni abrió nada afuera', afuera, []);
    t('  y no se construyó ninguna view', construidas.length, eranSin);
  }

  seccion('navegador.cjs · el panel se abre antes de tocar la página');
  ventanaActual = win2;
  {
    // LA PROMESA DE LA FEATURE (del original): la pestaña sobrevive al panel, así
    // que lo que se exige no es que exista sino que el panel esté ABIERTO. Acá la
    // interfaz recibe el pedido y no contesta.
    const t0 = Date.now();
    const r = await N.runners.browser_read(hacerRun(), {});
    const dt = Date.now() - t0;
    t('si el panel no abre, la tool lo dice', r, 'error: the browser panel did not open in time');
    ok('  después de esperarlo unos tres segundos', dt >= 2900 && dt < 8000, `${dt}ms`);
    t('  y se lo pidió a la interfaz', avisosApp.filter(([c]) => c === 'browser:open'), [['browser:open', {}]]);
    t('  sin abrir la pestaña por su cuenta', ab.alive, false);
    t('esperarBrowser con el panel cerrado da false', await N.esperarBrowser(80), false);
  }
  // De acá en más la interfaz contesta como el renderer: monta la pestaña, le
  // da su rectángulo, avisa que el panel está abierto y prende la capa.
  N.configurar({
    avisar: (canal, datos) => {
      avisosApp.push([canal, datos]);
      if (canal === 'browser:open') {
        setTimeout(() => {
          N.ipc.attach();
          N.ipc.bounds({ x: 400, y: 50, width: 500, height: 700 });
          N.ipc.panel(true);
          N.ipc.visible(true);
        }, 30);
      }
    },
  });
  const antesN = construidas.length;
  {
    const run = hacerRun();
    const r = await nav({ url: 'ollama.com' }, run);
    t('con la interfaz contestando, navegar abre el panel y carga', r, 'Opened https://ollama.com\nCall browser_read to see the page.');
    t('  avisa a la interfaz qué va a abrir', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'browser_navigate', label: 'ollama.com' }]]);
    t('  construyó UNA view', construidas.length, antesN + 1);
    ok('  el panel quedó abierto y la pestaña viva', ab.alive && ab.panelAbierto && ab.visible);
    ok('  el estado sale por browser:state', avisosApp.some(([c, d]) => c === 'browser:state' && d.open === true && d.tabs.length === 1));
    t('esperarBrowser ahora da true', await N.esperarBrowser(80), true);
    const abiertas = cuantos('browser:open');
    await nav({ url: 'ollama.com' });
    t('con el panel ya abierto no se vuelve a pedir', cuantos('browser:open'), abiertas);
  }
  const vista1 = construidas[antesN];

  seccion('navegador.cjs · browser_navigate');
  {
    t('la url normalizada es la que se cargó', vista1.webContents.loaded.at(-1), 'https://ollama.com');
    t('tab tiene que ser un número de pestaña', await nav({ tab: 0 }), 'error: tab must be a tab number from browser_read (1 to 4), got 0');
    t('  y entero', await nav({ tab: 'dos' }), 'error: tab must be a tab number from browser_read (1 to 4), got "dos"');
    t('sin url y sin tab es error, no una navegación a la nada', await nav({}), 'error: url is required (or tab, to switch to another open tab)');
    t('  con los argumentos vacíos también', await N.runners.browser_navigate(hacerRun()), 'error: url is required (or tab, to switch to another open tab)');
    t('una pestaña nueva necesita url', await nav({ tab: 1, new_tab: true }), 'error: url is required to open a new tab');
    t('una pestaña que no existe lo dice', await nav({ tab: 3 }), 'error: there is no tab 3 — the panel has 1 tab. Call browser_read to see them.');
    t('lo que no es una dirección ni un favorito no navega', await nav({ url: 'hola mundo' }), 'error: not a valid http(s) address');
    t('  y un file:// tampoco', await nav({ url: 'file:///C:/Users/x/.ssh/id_rsa' }), 'error: not a valid http(s) address');
    ok('  nada de eso se cargó', !vista1.webContents.loaded.some((u) => /^file:|hola/.test(u)), vista1.webContents.loaded.join(','));

    const run = hacerRun();
    t('new_tab abre otra y lo dice, con la tira', await nav({ url: 'https://github.com/x', new_tab: true }, run),
      'Opened in a new tab (2 of 4). Opened https://github.com/x\nTabs (2 of 4): [1] ollama.com · [2] github.com ← this one\nCall browser_read to see the page.');
    t('  la primera sigue con su página', vista1.webContents.loaded.at(-1), 'https://ollama.com');
    const run2 = hacerRun();
    t('tab sin url solo cambia de pestaña', await nav({ tab: 1 }, run2),
      'Switched to tab 1. Now on https://ollama.com\nTabs (2 of 4): [1] ollama.com ← this one · [2] github.com\nCall browser_read to see the page.');
    t('  y el chip dice a cuál', run2.avisos[0][1].label, 'tab 1');
    vista1.webContents.title = 'Ollama';
    t('el resultado trae la URL final y el título', await nav({ url: 'https://ollama.com/library' }),
      'Opened https://ollama.com/library — Ollama\nTabs (2 of 4): [1] Ollama (ollama.com) ← this one · [2] github.com\nCall browser_read to see the page.');
    await nav({ url: 'a.example', new_tab: true });
    await nav({ url: 'b.example', new_tab: true });
    t('llega a cuatro', ab.state().tabs.length, 4);
    const cuarta = construidas.at(-1);
    const llena = await nav({ url: 'https://quinta.example/', new_tab: true });
    ok('con el cupo lleno sigue en la activa y lo dice',
      llena.startsWith('The panel already has 4 tabs (the limit), so this opened in the current tab instead. Opened https://quinta.example/\nTabs (4 of 4): '), llena);
    t('  sin construir otra view', [construidas.length, ab.state().tabs.length, cuarta.webContents.loaded.at(-1)], [antesN + 4, 4, 'https://quinta.example/']);
    const cambio = await nav({ url: 'example.org', tab: 2, new_tab: true });
    ok('con tab y url, cambia y navega ahí', cambio.startsWith('Switched to tab 2. Opened https://example.org\n'), cambio);
    t('  la activa es la segunda', ab.state().tabs.findIndex((x) => x.active), 1);
    t('ningún cambio que pidió el modelo se llevó el teclado', construidas.slice(antesN).map((v) => v.webContents.focos), [0, 0, 0, 0]);
    t('  ni cerró ninguna pestaña', construidas.slice(antesN).filter((v) => v.webContents.cerrada).length, 0);
  }

  seccion('navegador.cjs · browser_read');
  {
    const lectura = {
      ok: true, title: 'Aula', url: 'https://aula.example/curso', cortado: false,
      partes: [{ frame: false, text: 'Bienvenidos\nUnidad 1' }, { frame: true, title: 'Visor', url: 'https://visor.example/x', text: 'adentro del visor' }],
      elements: ['*[ref_1] link "Inicio"', '[ref_2] button "Entrar"'],
      scroll: [{ nombre: 'page', y: 0, max: 900 }, { nombre: 'Mensajes', y: 450, max: 900 }, { nombre: 'quieta', y: 0, max: 0 }],
      adjuntos: ['"foto.png"'],
    };
    const leer = (args, r = lectura, run = hacerRun()) => con({ read: async () => r }, () => N.runners.browser_read(run, args));
    const tira = N.lineaTabs(ab.state());
    ok('hay cuatro pestañas, así que la lectura lleva la tira', /^Tabs \(4 of 4\): /.test(tira), tira);

    const run = hacerRun();
    t('la lectura: aviso, página, tira, scroll, adjuntos, elementos y el texto de cada frame aparte', await leer({}, lectura, run), [
      N.BROWSER_AVISO,
      '',
      'Page: Aula',
      'URL: https://aula.example/curso',
      tira,
      'Scroll: page 0 of 900 px (at the top) · "Mensajes" 450 of 900 px (50% down).',
      'Attachments shown on the page: "foto.png".',
      '',
      'Interactive elements (2) — use these refs with browser_click / browser_type / browser_press / browser_upload. Refs marked * are on screen right now.',
      '*[ref_1] link "Inicio"',
      '[ref_2] button "Entrar"',
      '',
      '--- page text ---',
      'Bienvenidos',
      'Unidad 1',
      '',
      '--- embedded frame: Visor — https://visor.example/x ---',
      'adentro del visor',
    ].join('\n'));
    t('  el chip lleva la dirección de la pestaña', run.avisos, [['tool:activity', { reqId: 'r1', kind: 'browser_read', label: 'https://example.org' }]]);
    t('  sin foto si no se pidió', run._capturas, undefined);

    t('una lectura que falla vuelve como error', await leer({}, { ok: false, error: 'boom' }), 'error: could not read the page — boom');
    const vacia = await leer({}, { ok: true, title: '', url: 'https://x.example/', partes: [], elements: [], cortado: true });
    ok('una página sin texto ni elementos lo dice', vacia.includes('Page: (no title)') && vacia.includes('Interactive elements: none visible.')
      && vacia.includes('(the page has no visible text of its own)'), vacia);
    ok('  y si el lector no llegó al final, también', vacia.endsWith('(this page is longer than the reader takes in — the very end is cut off)'), vacia);

    // Una lectura larga se entrega en PÁGINAS, no cortada.
    const largo = 'palabra '.repeat(3750);
    const texto = `--- page text ---\n${largo}`;
    const larga = { ok: true, title: 'Largo', url: 'https://x.example/', partes: [{ frame: false, text: largo }], elements: [] };
    const p1 = await leer({}, larga);
    ok('30 mil caracteres son tres páginas: la primera dice que hay más', p1.includes('Reading page 1 of 3.') && p1.includes(texto.slice(0, B.READ_CHAR_BUDGET))
      && p1.endsWith('\n\n… there is more: call browser_read with page: 2 (of 3) to continue.'), p1.slice(-200));
    const p2 = await leer({ page: 2 }, larga);
    ok('  la segunda sigue donde quedó la primera', p2.includes('Reading page 2 of 3.') && p2.includes(`--- continued ---\n${texto.slice(B.READ_CHAR_BUDGET, 2 * B.READ_CHAR_BUDGET)}`)
      && p2.includes('Interactive elements: none left on this page of the read.') && p2.endsWith('page: 3 (of 3) to continue.'), p2.slice(0, 600));
    const p3 = await leer({ page: 3.9 }, larga);
    ok('  la tercera termina con el final del texto, sin prometer más', p3.endsWith(texto.slice(2 * B.READ_CHAR_BUDGET)) && !p3.includes('there is more'), p3.slice(-120));
    t('  y la cuarta no existe', await leer({ page: 4 }, larga), 'error: this read has 3 pages — ask for page 1 to 3.');
    t('  en una lectura de una sola, pedir la 2 lo dice en singular', await leer({ page: 2 }), 'error: this read has 1 page — ask for page 1.');

    const letras = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0); return s; };
    const muchos = { ok: true, title: 'Muchos', url: 'https://x.example/', partes: [{ frame: false, text: 'corto' }],
      elements: Array.from({ length: 250 }, (_, i) => `[ref_${i + 1}] link "${letras(i)}-${letras(i * 7 + 3)}"`) };
    const e1 = await leer({}, muchos);
    ok('250 elementos también son tres páginas, de a 120', e1.includes('Reading page 1 of 3.')
      && e1.includes('Interactive elements (ref_1 to ref_120, of 250 in all) — use these refs') && e1.includes('\n[ref_120] ') && !e1.includes('\n[ref_121] '), e1.slice(0, 500));
    const e3 = await leer({ page: 3 }, muchos);
    ok('  la última trae los que quedan y dice que no hay más texto', e3.includes('Interactive elements (ref_241 to ref_250, of 250 in all)')
      && e3.endsWith('(no more text on this page of the read)'), e3.slice(-300));

    const secciones = [];
    for (let k = 0; k < 6; k++) secciones.push(`[ref_${10 + 2 * k}] link "Topic ${15 + k}"`, `[ref_${11 + 2 * k}] button "Colapsar Topic ${15 + k}"`);
    const moodle = await leer({}, { ok: true, title: 'Curso', url: 'https://x.example/', partes: [{ frame: false, text: 'corto' }], elements: secciones });
    ok('las tiradas de refs iguales llegan agrupadas a la lectura', moodle.includes('  … 4 more of the same pattern (ref_12 to ref_19, in order) …') && !moodle.includes('[ref_14]'), moodle);
    const mudos = await leer({}, { ok: true, title: 'Mudos', url: 'https://x.example/', partes: [],
      elements: ['a', 'b', 'c', 'd', 'e'].map((x, i) => `[ref_${i + 1}] button (no name: icon ${x})`) });
    ok('cinco elementos sin nombre: avisa que el sitio puede estar escondiendo las etiquetas', mudos.includes('(5 elements here have no readable name'), mudos);

    // wait_for: tres desenlaces que el modelo tiene que poder distinguir.
    const esperas = [];
    const conEspera = (w, args = { wait_for: '  Resultados ' }) => con({ read: async () => lectura, esperarTexto: async (q) => { esperas.push(q); return w; } },
      () => N.runners.browser_read(hacerRun(), args));
    ok('wait_for: apareció', (await conEspera({ encontrado: true, ms: 1234 })).includes('\nwait_for: "Resultados" appeared after 1.2 s.\n'));
    ok('wait_for: no apareció, y se lee igual', (await conEspera({ ms: 10000 }))
      .includes('\nwait_for: TIMED OUT after 10.0 s — "Resultados" did not appear. What follows is what has loaded so far.\n'));
    ok('wait_for: ya estaba, que no prueba nada', (await conEspera({ ya: true, ms: 3000 }))
      .includes('\nwait_for: "Resultados" was ALREADY on the page before waiting and no new one showed up in 3.0 s'));
    t('  lo que se espera llega recortado', esperas, ['Resultados', 'Resultados', 'Resultados']);
    await conEspera({ encontrado: true }, { wait_for: '   ' });
    t('  y un wait_for vacío no espera nada', esperas.length, 3);

    // La foto: solo a un modelo con ojos, por run._capturas y al chat.
    const fotos = [];
    const conFoto = (img, run) => con({ read: async () => lectura, imagen: async () => { fotos.push(1); return img; } },
      () => N.runners.browser_read(run, { screenshot: true }));
    ve = false;
    const ciego = hacerRun();
    ok('a un modelo sin ojos no se le manda la foto', (await conFoto({}, ciego)).endsWith('\n\n(screenshot skipped: this model does not take images)'));
    t('  ni se saca, ni queda en la corrida, ni va al chat', [fotos.length, ciego._capturas, ciego.avisos.length], [0, undefined, 1]);
    ve = true;
    ok('si la foto no sale, lo dice', (await conFoto(null, hacerRun())).endsWith('\n\n(the screenshot could not be taken)'));
    const achicar = [];
    let calidad = null;
    const chica = { getSize: () => ({ width: 1568, height: 500 }), toJPEG: (q) => { calidad = q; return Buffer.from('jpg'); } };
    const grande = { getSize: () => ({ width: 3136, height: 1000 }), resize: (o) => { achicar.push(o); return chica; }, toJPEG: () => Buffer.from('entera') };
    const vidente = hacerRun('r9');
    ok('con ojos, la foto va adjunta y lo dice con su tamaño',
      (await conFoto(grande, vidente)).endsWith('\n\nA screenshot of the tab as it looks right now is attached (1568×500 px).'));
    t('  escalada al lado largo de captura.cjs', achicar, [{ width: 1568, height: 500, quality: 'best' }]);
    t('  en JPEG 85, a run._capturas', [calidad, vidente._capturas], [85, ['data:image/jpeg;base64,anBn']]);
    t('  y al chat, para que el usuario vea lo que vio el modelo', vidente.avisos.at(-1),
      ['tool:artifact', { reqId: 'r9', images: [{ name: 'browser.jpg', dataUrl: 'data:image/jpeg;base64,anBn' }] }]);
    const justa = hacerRun();
    await conFoto({ getSize: () => ({ width: 800, height: 600 }), resize: () => { throw new Error('no hacía falta'); }, toJPEG: () => Buffer.from('jpg') }, justa);
    t('  una que ya entra no se reescala', justa._capturas, ['data:image/jpeg;base64,anBn']);
    ve = false;
  }

  seccion('navegador.cjs · click, tecleo, teclas y subida');
  {
    const RELEER = 'Call browser_read to see the current state — the refs from before are stale.';
    const pedidos = [];
    const run = hacerRun();
    t('click dice a qué le pegó', await con({ click: async (ref) => { pedidos.push(ref); return { ok: true, nombre: 'Aceptar' }; } },
      () => N.runners.browser_click(run, { ref: 'ref_3' })), `Clicked ref_3 ("Aceptar").\n${RELEER}`);
    t('  con el ref que pidió el modelo, y en el chip', [pedidos, run.avisos], [['ref_3'], [['tool:activity', { reqId: 'r1', kind: 'browser_click', label: 'ref_3' }]]]);
    // "Le pegué a otra cosa" es un desenlace distinto de "anduvo". (Del original.)
    t('click avisa si había algo encima', await con({ click: async () => ({ ok: true, tapado: true, quien: 'div.banner' }) }, () => N.runners.browser_click(hacerRun(), { ref: 'ref_3' })),
      `Clicked ref_3.\nWARNING: something else was on top at that point (div.banner), so the click may have hit that instead.\n${RELEER}`);
    t('  y si la página navegó', await con({ click: async () => { ab.wc.url = 'https://otro.example/'; return { ok: true }; } }, () => N.runners.browser_click(hacerRun(), { ref: 'ref_3' })),
      `Clicked ref_3.\nThe page navigated to https://otro.example/\n${RELEER}`);
    t('un click que falla vuelve como error', await con({ click: async () => ({ ok: false, error: 'ref_9 is not on the page any more' }) }, () => N.runners.browser_click(hacerRun(), { ref: 'ref_9' })),
      'error: ref_9 is not on the page any more');

    // El chip de browser_type NO lleva lo tecleado: por acá pasan contraseñas.
    const secreto = 'hunter2-esto-no-puede-viajar';
    const tecleos = [];
    const teclear2 = (args, r, corrida = hacerRun()) => con({ type: async (...a) => { tecleos.push(a); return r; } }, () => N.runners.browser_type(corrida, args));
    t('teclear sin texto es un error', await teclear2({ ref: 'ref_4' }, { ok: true }), 'error: text is required');
    t('  que no llega a la página', tecleos.length, 0);
    const runT = hacerRun();
    t('teclear con submit dice dónde quedó la página', await teclear2({ ref: 'ref_4', text: secreto, submit: true }, { ok: true, nombre: 'Clave' }, runT),
      'Typed into ref_4 ("Clave").\nPressed Enter. The page is now at https://otro.example/\nCall browser_read to see the result.');
    t('  a la página le llega el texto y el Enter', tecleos, [['ref_4', secreto, true]]);
    t('  al chip, solo el campo', runT.avisos, [['tool:activity', { reqId: 'r1', kind: 'browser_type', label: 'ref_4' }]]);
    ok('  y lo tecleado no quedó en ningún aviso', !JSON.stringify(runT.avisos).includes(secreto));
    t('teclear avisa si había algo encima del campo', await teclear2({ ref: 'ref_4', text: 'x' }, { ok: true, tapado: true, quien: 'div.banner' }),
      'Typed into ref_4.\nWARNING: something else was on top of that field (div.banner) — the text may not have gone in. Read the page and check the field before continuing.\nCall browser_read to see the result.');
    t('en un select dice qué opción quedó', await teclear2({ ref: 'ref_5', text: 'arg' }, { ok: true, elegida: 'Argentina', nombre: 'País' }),
      'Selected "Argentina" in ref_5 ("País").\nCall browser_read to see the result.');
    t('un tecleo que falla vuelve como error', await teclear2({ ref: 'ref_5', text: 'x' }, { ok: false, error: 'ref_5 is not a text field' }), 'error: ref_5 is not a text field');

    const DESPUES = 'Call browser_read to see the result — the refs from before may be stale.';
    const teclas = [];
    const apretar = (args, r, corrida = hacerRun()) => con({ press: async (...a) => { teclas.push(a); return r; } }, () => N.runners.browser_press(corrida, args));
    const runP = hacerRun();
    t('una tecla', await apretar({ key: 'Escape' }, { ok: true, tecla: 'Escape' }, runP), `Pressed Escape.\n${DESPUES}`);
    t('  va sin ref a lo que tenga el foco, y el chip dice cuál', [teclas.at(-1), runP.avisos[0][1].label], [['Escape', null], 'Escape']);
    const runS = hacerRun();
    t('un scroll que no movió nada lo dice', await apretar({ key: 'PageDown', ref: 'ref_2' }, { ok: true, tecla: 'PageDown', scroll: true, movio: false, nombre: 'Lista' }, runS),
      `Scrolled (PageDown) on ref_2 ("Lista").\nNothing moved — that area is already at its edge, or it does not scroll.\n${DESPUES}`);
    t('  con el ref, en la llamada y en el chip', [teclas.at(-1), runS.avisos[0][1].label], [['PageDown', 'ref_2'], 'PageDown · ref_2']);
    t('una tecla sobre algo tapado avisa', await apretar({ key: 'Enter', ref: 'ref_2' }, { ok: true, tecla: 'Enter', tapado: true }),
      `Pressed Enter on ref_2.\nWARNING: something else was on top of ref_2.\n${DESPUES}`);
    const f12 = await N.runners.browser_press(hacerRun(), { key: 'F12' });
    ok('una tecla fuera de la lista cerrada la rechaza la clase de verdad', f12.startsWith("error: 'F12' is not a key this tool presses — use one of: Enter, Escape, "), f12);

    // browser_upload saca archivos del disco hacia un sitio: se valida todo ANTES
    // de tocar la página.
    const A = path.join(SUBIR, 'a.txt');
    const BIN = path.join(SUBIR, 'b.bin');
    fs.writeFileSync(A, 'diez bytes');
    fs.writeFileSync(BIN, Buffer.alloc(2 * 1024 * 1024));
    const subidas = [];
    const subir = (args, r, corrida) => {
      const c = corrida || hacerRun();
      c.cwd = SUBIR;
      return con({ subir: async (...a) => { subidas.push(a); return typeof r === 'function' ? r(...a) : r; } }, () => N.runners.browser_upload(c, args));
    };
    t('subir sin archivos es un error', await subir({ ref: 'ref_7' }, { ok: true }), 'error: paths is required — the files to attach');
    t('  y con una lista vacía', await subir({ ref: 'ref_7', paths: ['', '  '] }, { ok: true }), 'error: paths is required — the files to attach');
    t('más de diez no', await subir({ ref: 'ref_7', paths: Array.from({ length: 11 }, () => 'a.txt') }, { ok: true }), 'error: at most 10 files per upload');
    t('uno que no existe no', await subir({ ref: 'ref_7', paths: ['a.txt', 'fantasma.txt'] }, { ok: true }), `error: ${path.join(SUBIR, 'fantasma.txt')} does not exist`);
    t('una carpeta no es un archivo', await subir({ ref: 'ref_7', paths: [SUBIR] }, { ok: true }), `error: ${SUBIR} is not a file`);
    t('  y nada de eso llegó a la página', subidas.length, 0);
    const runU = hacerRun();
    t('una subida dice qué adjuntó, con su tamaño, y si la página reaccionó',
      await subir({ ref: 'ref_7', paths: ['a.txt', BIN] }, (ref, abs) => ({ ok: true, subidos: abs, nombre: 'Adjuntar', reaccion: { imagenes: 1, nombres: ['a.txt'] } }), runU),
      'Attached a.txt (1 KB), b.bin (2.0 MB) through ref_7 ("Adjuntar").\nThe page reacted: it now shows 1 new image (likely the preview) and the file name "a.txt".\nCall browser_read to confirm the page shows them before sending anything.');
    t('  las rutas relativas se resuelven contra la carpeta de la corrida', subidas.at(-1), ['ref_7', [A, BIN]]);
    t('  y el chip lleva los nombres de lo que salió del disco', runU.avisos, [['tool:activity', { reqId: 'r1', kind: 'browser_upload', label: 'a.txt, b.bin' }]]);
    t('una ruta suelta vale por una lista de una', (await subir({ ref: 'ref_7', paths: 'a.txt' }, (ref, abs) => ({ ok: true, subidos: abs }))).split('\n')[0], 'Attached a.txt (1 KB) through ref_7.');
    ok('si el selector toma uno solo, dice cuántos quedaron afuera',
      (await subir({ ref: 'ref_7', paths: ['a.txt', BIN] }, { ok: true, subidos: [A], sobran: 1 })).includes('\nThat picker takes a single file, so the other one was not attached.\n'));
    ok('si la página no mostró nada, avisa', (await subir({ ref: 'ref_7', paths: ['a.txt'] }, { ok: true, subidos: [A], reaccion: {} }))
      .includes('\nWARNING: nothing new appeared on the page in 4 s (no preview, no file name)'));
    const pegado = await subir({ ref: 'ref_8', paths: ['a.txt'] }, { ok: true, subidos: [A], pegado: true, tomado: false });
    ok('en un campo de texto se pega, y si el campo no lo tomó lo dice',
      pegado.startsWith('Pasted a.txt (1 KB) into ref_8, as if from the clipboard (it is a text field, not a file picker).\nWARNING: the field did not take the pasted files'), pegado);
    t('una subida que falla vuelve como error', await subir({ ref: 'ref_7', paths: ['a.txt'] }, { ok: false, error: 'ref_7 does not open a file picker' }), 'error: ref_7 does not open a file picker');
  }

  seccion('navegador.cjs · los canales de la interfaz');
  {
    const vistas = () => ab.tabs.map((x) => x.view);
    N.ipc.bounds({ x: 1.4, y: 2, width: 300.6, height: 200 });
    ok('bounds le llega a todas las pestañas, en enteros', vistas().every((v) => JSON.stringify(v.calls.bounds.at(-1)) === '{"x":1,"y":2,"width":301,"height":200}'));
    N.ipc.visible(false);
    t('visible(false) apaga la capa', [ab.visible, ab.activa.view.calls.visible.at(-1), ab.panelAbierto], [false, false, true]);
    N.ipc.visible(true);
    t('visible(true) la prende, y solo la activa', vistas().map((v) => v.calls.visible.at(-1)), vistas().map((v) => v === ab.activa.view));
    t('state es el estado de la instancia', N.ipc.state(), ab.state());

    // `panel` es "el usuario lo tiene a la vista", y es la condición de las tools.
    const abiertas = cuantos('browser:open');
    const eran = construidas.length;
    N.ipc.panel(false);
    t('panel(false) cierra el panel y apaga la capa sí o sí', [ab.panelAbierto, ab.visible, ab.activa.view.calls.visible.at(-1)], [false, false, false]);
    ok('  la pestaña sigue viva', ab.alive);
    t('  y la migaja se calla', N.migaja(), '');
    const r = await con({ click: async () => ({ ok: true }) }, () => N.runners.browser_click(hacerRun(), { ref: 'ref_1' }));
    ok('con el panel cerrado, una tool lo pide abrir antes de tocar nada', r.startsWith('Clicked ref_1.') && cuantos('browser:open') === abiertas + 1 && ab.panelAbierto, r);
    t('  y el attach de la interfaz no duplica la pestaña', construidas.length, eran);

    // La barra interpreta texto libre como búsqueda; las tools no.
    const activa = ab.activa.view.webContents;
    t('navigate es la barra: una dirección', N.ipc.navigate('  github.com  '), { ok: true, url: 'https://github.com' });
    t('  o una búsqueda', N.ipc.navigate('cómo usar electron'), { ok: true, url: `https://duckduckgo.com/?q=${encodeURIComponent('cómo usar electron')}` });
    t('  que se cargó en la activa', activa.loaded.at(-1), `https://duckduckgo.com/?q=${encodeURIComponent('cómo usar electron')}`);
    t('  y un esquema que no es web se rechaza', [N.ipc.navigate('javascript:alert(1)'), N.ipc.navigate('file:///C:/x.html')],
      [{ ok: false, error: 'not a valid http(s) address' }, { ok: false, error: 'not a valid http(s) address' }]);

    // Las pestañas, desde la tira: los tres devuelven el estado entero.
    const ids = N.ipc.state().tabs.map((x) => x.id);
    t('tabNew con el cupo lleno devuelve el estado igual, con las mismas cuatro', N.ipc.tabNew().tabs.map((x) => x.id), ids);
    const cerrada = ab.tabs[3].view;
    const st1 = N.ipc.tabClose(ids[3]);
    t('tabClose cierra esa y devuelve el estado', [st1.tabs.map((x) => x.id), cerrada.webContents.cerrada], [ids.slice(0, 3), true]);
    const st2 = N.ipc.tabNew();
    const nueva = ab.activa.view;
    t('tabNew abre una en blanco, al frente', [st2.tabs.length, st2.url, st2.activa === ab.activa.id, nueva.webContents.loaded], [4, '', true, ['about:blank']]);
    t('  sin foco: ahí lo que se quiere es la barra', nueva.webContents.focos, 0);
    const primera = ab.tabs[0].view;
    const st3 = N.ipc.tabGo(ids[0]);
    t('tabGo la pasa al frente, con el teclado', [st3.activa, st3.url, primera.webContents.focos], [ids[0], 'https://ollama.com/library', 1]);
    t('  y un id que no existe deja todo como estaba', N.ipc.tabGo(999).activa, ids[0]);
    const idNueva = st2.activa;
    N.ipc.tabGo(idNueva);
    const st4 = N.ipc.tabClose(idNueva);
    t('tabClose de la activa pasa a la vecina, con el teclado', [st4.tabs.length, st4.activa === st4.tabs.at(-1).id, ab.activa.view.webContents.focos], [3, true, 1]);

    let recargas = 0;
    let frenadas = 0;
    ab.wc.reload = () => { recargas++; };
    ab.wc.stop = () => { frenadas++; };
    let tiro = null;
    try { N.ipc.back(); N.ipc.forward(); N.ipc.reload(); N.ipc.stop(); } catch (e) { tiro = e; }
    t('back, forward, reload y stop van a la activa', [String(tiro), recargas, frenadas], ['null', 1, 1]);

    t('sin nada que fotografiar, capture y freeze dan null', [await N.ipc.capture(), await N.ipc.freeze()], [null, null]);
    ab.wc.capturePage = async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('png'), toJPEG: () => Buffer.from('jpg') });
    t('capture es un PNG en data URL (termina en el chat)', await N.ipc.capture(), 'data:image/png;base64,cG5n');
    t('freeze es un JPEG (dura lo que dura un modal)', await N.ipc.freeze(), 'data:image/jpeg;base64,anBn');

    N.ipc.tabGo(ids[0]);
    N.ipc.external();
    t('external abre afuera la página de la pestaña activa', afuera, ['https://ollama.com/library']);
    const st5 = N.ipc.tabNew();
    N.ipc.external();
    t('  y con la pestaña en blanco no abre nada', afuera.length, 1);
    N.ipc.tabClose(st5.activa);
  }

  seccion('navegador.cjs · favoritos');
  {
    const FAVS = path.join(CARPETA, 'browser-favoritos.json');
    t('sin archivo, la lista está vacía', N.ipc.favList(), []);
    const antes = Date.now();
    const alta = N.ipc.favToggle({ url: 'sied.umaza.edu.ar', title: 'Moodle UMaza' });
    ok('la estrella agrega la página, con la dirección normalizada y su título',
      alta.ok === true && alta.favoritos.length === 1 && alta.favoritos[0].url === 'https://sied.umaza.edu.ar' && alta.favoritos[0].title === 'Moodle UMaza'
      && alta.favoritos[0].at >= antes, JSON.stringify(alta));
    const enDisco = await esperarArchivo(FAVS, (x) => JSON.parse(x).favoritos.length === 1);
    t('  y llega al disco', JSON.parse(enDisco || '{}').favoritos?.map((f) => [f.url, f.title]), [['https://sied.umaza.edu.ar', 'Moodle UMaza']]);
    t('la misma estrella otra vez la saca', N.ipc.favToggle({ url: 'https://sied.umaza.edu.ar' }).favoritos, []);
    t('lo que no es una dirección no entra', [N.ipc.favToggle({ url: 'javascript:alert(1)', title: 'x' }), N.ipc.favToggle()],
      [{ ok: false, error: 'not an address' }, { ok: false, error: 'not an address' }]);
    N.ipc.favToggle({ url: 'https://sied.umaza.edu.ar', title: 'Moodle UMaza' });
    N.ipc.favToggle({ url: 'https://viejo.example', title: 'Moodle viejo' });
    N.ipc.favToggle({ url: 'https://github.com/kiddshady' });
    N.ipc.favToggle({ url: 'https://largo.example', title: 'x'.repeat(300) });
    t('el título se guarda recortado a 200', N.favoritosLista().at(-1).title.length, 200);
    N.ipc.favRemove('https://largo.example');
    ok('favList es la misma lista', N.ipc.favList() === N.favoritosLista() && N.ipc.favList().length === 3);
    t('nombreFavorito: el título, o el host si no tiene', N.favoritosLista().map(N.nombreFavorito), ['Moodle UMaza', 'Moodle viejo', 'github.com']);

    // Por nombre, para el modelo: igual, o la ÚNICA que lo contenga.
    t('buscarFavorito: igual, sin mayúsculas ni espacios de más', N.buscarFavorito('  moodle   umaza '), { url: 'https://sied.umaza.edu.ar' });
    t('  la única que lo contiene', N.buscarFavorito('umaza'), { url: 'https://sied.umaza.edu.ar' });
    t('  por el host, la que no tiene título', N.buscarFavorito('github.com'), { url: 'https://github.com/kiddshady' });
    t('  dos que lo contienen son una pregunta', N.buscarFavorito('moodle').varios?.map((f) => f.title), ['Moodle UMaza', 'Moodle viejo']);
    t('  nada', [N.buscarFavorito('nada que ver'), N.buscarFavorito('  ')], [{}, {}]);

    const run = hacerRun();
    const porNombre = await nav({ url: 'Moodle UMaza' }, run);
    ok('browser_navigate acepta el nombre de un favorito', porNombre.startsWith('Opened https://sied.umaza.edu.ar\n') && ab.wc.loaded.at(-1) === 'https://sied.umaza.edu.ar', porNombre);
    t('  y el chip muestra lo que escribió el modelo', run.avisos[0][1].label, 'Moodle UMaza');
    t('con dos que coinciden pregunta cuál', await nav({ url: 'moodle' }), 'error: more than one bookmark matches "moodle": "Moodle UMaza", "Moodle viejo" — pass the exact name');
    N.ipc.favToggle({ url: 'https://trampa.example', title: 'ollama.com' });
    await nav({ url: 'ollama.com' });
    t('un dominio de verdad nunca se reinterpreta como nombre', ab.wc.loaded.at(-1), 'https://ollama.com');

    t('favRemove saca por dirección', N.ipc.favRemove('https://trampa.example').favoritos.map((f) => f.url),
      ['https://sied.umaza.edu.ar', 'https://viejo.example', 'https://github.com/kiddshady']);
    t('  y una que no está deja la lista igual', N.ipc.favRemove('https://no-esta.example').favoritos.length, 3);
    t('favOpen la abre en la pestaña activa', [N.ipc.favOpen('https://viejo.example'), ab.wc.loaded.at(-1)], [{ ok: true, url: 'https://viejo.example' }, 'https://viejo.example']);
    t('  revalidando: un file:// guardado a mano no pasa', N.ipc.favOpen('file:///C:/x.html'), { ok: false, error: 'not a valid http(s) address' });
    await esperarArchivo(FAVS, (x) => JSON.parse(x).favoritos.length === 3 && !x.includes('trampa'));

    // Un archivo que no se pudo LEER no es un archivo vacío.
    const ROTA = path.join(TMP, 'rota');
    fs.mkdirSync(ROTA);
    fs.writeFileSync(path.join(ROTA, 'browser-favoritos.json'), '{ "favoritos": [ roto');
    N.configurar({ carpeta: ROTA });
    t('un archivo roto arranca de cero', N.ipc.favList(), []);
    ok('  apartado como .corrupto-<fecha>, no borrado', fs.readdirSync(ROTA).some((f) => /^browser-favoritos\.json\.corrupto-\d+$/.test(f)), fs.readdirSync(ROTA).join(','));
    t('  y después se puede guardar', N.ipc.favToggle({ url: 'https://a.example', title: 'A' }).ok, true);
    await esperarArchivo(path.join(ROTA, 'browser-favoritos.json'), (x) => JSON.parse(x).favoritos.length === 1);

    const TRABADA = path.join(TMP, 'trabada');
    fs.mkdirSync(path.join(TRABADA, 'browser-favoritos.json'), { recursive: true }); // una carpeta donde va el archivo: no se puede leer
    N.configurar({ carpeta: TRABADA });
    t('un archivo que no se puede leer da una lista vacía', N.ipc.favList(), []);
    const NO = { ok: false, error: 'the bookmarks file could not be read, so it was not overwritten' };
    t('  pero NO se pisa: ni al agregar ni al sacar', [N.ipc.favToggle({ url: 'https://a.example' }), N.ipc.favRemove('https://a.example')], [NO, NO]);
    ok('  y lo que había sigue ahí', fs.statSync(path.join(TRABADA, 'browser-favoritos.json')).isDirectory() && fs.readdirSync(TRABADA).length === 1, fs.readdirSync(TRABADA).join(','));

    const FILTRADA = path.join(TMP, 'filtrada');
    fs.mkdirSync(FILTRADA);
    fs.writeFileSync(path.join(FILTRADA, 'browser-favoritos.json'), JSON.stringify({ favoritos: [
      { url: 'file:///C:/secreto.txt', title: 'no' }, null, { title: 'sin url' }, { url: 'https://ok.example', title: 5, at: 'x' },
    ] }));
    N.configurar({ carpeta: FILTRADA });
    t('al leer, lo que no es http(s) se descarta y lo demás se normaliza', N.ipc.favList(), [{ url: 'https://ok.example', title: '5', at: 0 }]);

    N.configurar({ carpeta: CARPETA });
    t('volver a la carpeta trae los favoritos que se habían guardado', N.ipc.favList().map((f) => f.url),
      ['https://sied.umaza.edu.ar', 'https://viejo.example', 'https://github.com/kiddshady']);
  }

  seccion('navegador.cjs · la migaja y la ventana que se esconde');
  {
    N.ipc.tabGo(ab.tabs[0].id);
    ab._emitir();
    const miga = N.migaja();
    t('la migaja: lo que el usuario tiene abierto, y qué quiere decir "esta página"', miga,
      `The user has the browser panel open at: ${ab.breadcrumb()}. `
      + 'When they say "this page", "here" or "what I am looking at", they mean that tab — read it with browser_read instead of fetching the URL, so you see what they see (their session, their scroll, what they already filled in).');
    ok('  con el título, la dirección y las otras pestañas', miga.startsWith('The user has the browser panel open at: Ollama — https://ollama.com/library · other tabs: '), miga);
    ok('  en una sola línea, sin salto adelante', !/\n/.test(miga));

    N.ipc.visible(true);
    N.dormir();
    t('dormir apaga la capa', [ab.visible, ab.activa.view.calls.visible.at(-1)], [false, false]);
    ok('  sin cerrar el panel ni la pestaña', ab.alive && ab.panelAbierto);
    N.despertar();
    t('despertar la prende si estaba prendida', [ab.visible, ab.activa.view.calls.visible.at(-1)], [true, true]);
    N.ipc.visible(false);
    N.dormir();
    N.despertar();
    t('  y si estaba apagada (algo encima, o el panel cerrado) la deja apagada', ab.visible, false);
    N.ipc.visible(true);
  }

  seccion('navegador.cjs · las pestañas guardadas y la salida');
  {
    const PEST = path.join(CARPETA, 'browser-pestanas.json');
    fs.rmSync(PEST, { force: true });
    ab._emitir();
    const quiero = { urls: ab.state().tabs.map((x) => x.url || ''), activa: ab.state().tabs.findIndex((x) => x.active) };
    const escrito = await esperarArchivo(PEST, (x) => JSON.stringify(JSON.parse(x)) === JSON.stringify(quiero));
    t('cada cambio de estado anota las direcciones y cuál está al frente', JSON.parse(escrito || 'null'), quiero);
    ok('  con demora, y por la escritura atómica', escrito !== null && escrito.includes('\n'), escrito);
    t('leerPestanas las devuelve', N.leerPestanas(), quiero);

    fs.rmSync(PEST);
    N.anotarPestanas({ open: false, tabs: [{ url: 'https://x.example/', active: true }] });
    N.anotarPestanas({ open: true, tabs: [] });
    N.anotarPestanas(null);
    N.volcarPestanas();
    ok('un estado sin panel o sin pestañas no se anota', !fs.existsSync(PEST));
    t('  y sin archivo no hay nada que restaurar', N.leerPestanas(), null);

    // La salida: lo pendiente se vuelca en el acto, se guardan las cookies y se
    // cierra todo.
    const ses = sesiones.get(PARTITION);
    let bajadas = 0;
    const flushReal = ses.cookies.flushStore;
    ses.cookies.flushStore = () => { bajadas++; return Promise.resolve(); };
    N.ipc.navigate('https://ultima.example/');
    ab._emitir();
    const alSalir = { urls: ab.state().tabs.map((x) => x.url || ''), activa: ab.state().tabs.findIndex((x) => x.active) };
    const vivas = ab.tabs.map((x) => x.view);
    t('cerrar no devuelve nada', N.cerrar(), undefined);
    const volcado = fs.existsSync(PEST) ? fs.readFileSync(PEST, 'utf8') : null;
    t('cerrar vuelca las pestañas que estaban pendientes, sin esperar la demora', JSON.parse(volcado || 'null'), alSalir);
    ok('  la última dirección incluida', alSalir.urls.includes('https://ultima.example/') && volcado !== null && !volcado.includes('\n'), volcado);
    t('  cierra todas las views', [ab.alive, vivas.every((v) => v.webContents.cerrada === true), ab.panelAbierto, ab.visible], [false, true, false, false]);
    t('  y manda las cookies al disco', bajadas, 1);
    N.cerrar();
    t('cerrar dos veces no hace nada', bajadas, 1);
    ses.cookies.flushStore = flushReal;

    // El primer attach de la sesión siguiente las vuelve a abrir.
    fs.writeFileSync(PEST, JSON.stringify({ urls: ['https://a.example/', 'file:///C:/secreto.txt', 'https://b.example/'], activa: 2 }));
    const eran = construidas.length;
    const st = N.ipc.attach();
    t('attach restaura las pestañas guardadas, con la que estaba al frente', [st.open, st.tabs.map((x) => x.url), st.tabs.findIndex((x) => x.active)],
      [true, ['https://a.example/', '', 'https://b.example/'], 2]);
    t('  y lo que no es http(s) vuelve en blanco, sin cargarse', construidas.slice(eran).map((v) => v.webContents.loaded), [['https://a.example/'], ['about:blank'], ['https://b.example/']]);
    t('un segundo attach no duplica nada', [N.ipc.attach().tabs.length, construidas.length], [3, eran + 3]);
    N.cerrar();
    fs.writeFileSync(PEST, '{ roto');
    t('con el archivo roto, el panel abre en una pestaña en blanco', N.ipc.attach().tabs.map((x) => x.url), ['']);
    N.cerrar();
    ok('al final no queda ninguna view viva', construidas.every((v) => v.webContents.cerrada === true));
  }

  seccion('navegador.cjs · lo que el original afirmaba sobre el texto de main.js');
  {
    const src = fs.readFileSync(NAVEGADOR, 'utf8');
    const grab = (re, what) => {
      const m = src.match(re);
      if (!m) throw new Error('no encontré ' + what);
      return m[0];
    };
    const asegurar = grab(/async function asegurarPanel\(\) \{[\s\S]*?\n\}/, 'asegurarPanel');
    ok('asegurarPanel exige el panel abierto, no solo la pestaña viva', /agentBrowser\.alive && agentBrowser\.panelAbierto/.test(asegurar));
    ['runBrowserNavigate', 'runBrowserRead', 'runBrowserClick', 'runBrowserType', 'runBrowserPress', 'runBrowserUpload'].forEach((fn) => {
      const cuerpo = grab(new RegExp(`async function ${fn}\\([\\s\\S]*?\\n\\}`), fn);
      ok(`${fn} pasa por asegurarPanel`, /await asegurarPanel\(\)/.test(cuerpo));
    });
    const espera = grab(/function esperarBrowser\(ms\) \{[\s\S]*?\n\}/, 'esperarBrowser');
    ok('esperarBrowser espera al panel, no a la pestaña', /panelAbierto/.test(espera));

    const tabla = grab(/const runners = \{[\s\S]*?\n\};/, 'runners');
    // La 1.3.0 de NeonCode salió con `browser_read: (run) => runBrowserRead(run)`:
    // los args se tiraban en la tabla y page, wait_for y screenshot no llegaban.
    ['browser_navigate', 'browser_read', 'browser_click', 'browser_type', 'browser_press', 'browser_upload'].forEach((n) => {
      const linea = (tabla.split('\n').find((l) => l.trim().startsWith(`${n}:`)) || '').trim();
      ok(`${n} le pasa los args a su runner`, /^\w+: \(run, a\) => run\w+\(run, a\),$/.test(linea), linea);
    });

    const runNav = grab(/async function runBrowserNavigate\([\s\S]*?\n\}/, 'runBrowserNavigate');
    ok('el runner abre en pestaña nueva con nuevaTab', /agentBrowser\.nuevaTab\(u2\)/.test(runNav));
    ok('  cambia de pestaña SIN foco (no le roba el cursor al usuario)', /agentBrowser\.activar\(destino\.id\)/.test(runNav) && !/activar\(destino\.id, \{/.test(runNav));
    ok('  y con el cupo lleno sigue en la activa en vez de fallar', /r\.lleno/.test(runNav) && /agentBrowser\.navigate\(u2\)/.test(runNav));
    ok('  acepta el nombre de un favorito cuando no es una dirección', /if \(u && !urlValida\(u\)\)/.test(runNav) && /buscarFavorito\(u\)/.test(runNav));
    ok('el modelo no puede cerrar pestañas', !/cerrarTab/.test(runNav) && !/cerrarTab/.test(tabla));

    const runUp = grab(/async function runBrowserUpload\([\s\S]*?\n\}/, 'runBrowserUpload');
    ok('la subida valida que cada archivo exista, sea archivo y no pase el techo', /fsp\.stat\(a\)/.test(runUp) && /isFile\(\)/.test(runUp) && /UPLOAD_MAX_BYTES/.test(runUp) && /UPLOAD_MAX_FILES/.test(runUp));
    ok('  y lo hace ANTES de tocar la página', runUp.indexOf('fsp.stat') < runUp.indexOf('agentBrowser.subir'));

    const runRead = grab(/async function runBrowserRead\([\s\S]*?\n\}/, 'runBrowserRead');
    ok('browser_read incluye la tira de pestañas', /lineaTabs\(agentBrowser\.state\(\)\)/.test(runRead));
    ok('la lectura se parte en páginas y dice cómo seguir', /READ_CHAR_BUDGET/.test(runRead) && /call browser_read with page: \$\{pag \+ 1\}/.test(runRead));
    ok('la foto solo va a un modelo con ojos, por run._capturas', /if \(!modeloVe\(run\)\)/.test(runRead) && /run\._capturas \?\?= \[\]\)\.push/.test(runRead));

    ok('un archivo de favoritos ilegible no se pisa', /if \(favoritosTrabado\) return false;/.test(src));
    ok('las pestañas se leen al abrir el panel y se vuelcan al salir',
      // (desde la 0.18.0 entre medio pasa el historial: lo que se reabre no cuenta como visita, y lo pendiente baja al salir)
      /const restaurar = leerPestanas\(\);/.test(src) && /agentBrowser\.attach\(mainWindow, \{ restaurar \}\)/.test(src) && /volcarPestanas\(\);\n  historial\.volcar\(\);\n  agentBrowser\.destroy\(\);/.test(src));
    ok('tabGo y tabClose van con foco, tabNew sin', /tabGo: [^\n]*activar\(id, \{ foco: true \}/.test(src) && /tabClose: [^\n]*cerrarTab\(id, \{ foco: true \}/.test(src) && /tabNew: [^\n]*nuevaTab\(\)/.test(src));
    // De Electron no se usa nada al cargar: lo único que lo nombra es el require
    // de agent-browser.cjs, y navegador.cjs ni eso.
    ok("navegador.cjs no hace require('electron')", !/require\('electron'\)/.test(src));
  }
} catch (e) {
  failures.push(`[${seccionActual}] el test se cortó: ${e?.stack || e}`);
} finally {
  // Nada puede quedar abierto ni pendiente: ni una view (de mentira), ni una
  // escritura con demora, ni la carpeta descartable.
  try { N.cerrar(); } catch { /* ya estaba cerrado */ }
  hechas++;
  const vivas = construidas.filter((v) => v.webContents.cerrada !== true).length;
  if (vivas) failures.push(`[limpieza] quedaron ${vivas} views sin cerrar`);
  await tick(60); // la última escritura atómica, si quedó alguna en vuelo
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* queda en la carpeta temporal del sistema */ }
}

if (failures.length) {
  console.error(`test-blackcode-tools-browser: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-browser: ok (${hechas} comprobaciones: direcciones y barra, la view y su sesión, permisos y cookies, ventanas hijas, lo tapado, iframes, migaja, atajos, pestañas, teclas y scripts, destroy, cableado, chips, tiradas, panel, los seis runners, canales, favoritos, pestañas guardadas y salida)`);
process.exit(0);
