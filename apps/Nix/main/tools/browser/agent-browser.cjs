// El navegador embebido de Nix: la pestaña que miran el usuario y el modelo.
// La clase AgentBrowser (las pestañas, la sesión blindada, los scripts que
// leen la página y lo que hace falta para clickear, teclear y subir archivos)
// y las reglas de qué se acepta como dirección. Quien la usa es
// ../navegador.cjs, que tiene la instancia, las tools y los canales.
//
// Portado de NeonCode 1.11.3 (browser.js), ENTERO y tal cual estaba escrito:
// de acá para abajo es aquel archivo, con sus comentarios, y varios nombran
// cosas de aquella app (main.js, el renderer, terminal.js, `window.neon`,
// Settings, Prism). Se dejan como estaban.
//
// Lo que se adaptó, y nada más:
//   - La partición: 'persist:neon-browser' pasa a 'persist:nix-browser'. Las
//     sesiones de un navegador no se mezclan con las del otro.
//   - uaComoChrome saca del user agent el token de la app. Allá era
//     «neoncode/…» o «NeonCode/…»; acá «nix/…» o «Nix/…», que es como lo
//     arma Electron con el nombre de la app (el productName).
//   - El preload de sesión está al lado y se llama chrome-preload.cjs (allá
//     browser-chrome-preload.cjs, en la raíz).
//
// Lo que NO se tocó aunque lleve el nombre viejo, porque es interno y ninguna
// página ni el modelo lo leen como texto: los atributos `data-neon-ref` y
// `data-neon-nombre`, `window.__neonIds` y compañía, y `ses._neonBlindada`.
//
// ---------------------------------------------------------------------------
// NeonCode — el browser compartido: páginas reales que miran los dos.
//
// La idea entera en una línea: no es un scraper del agente ni un visor del
// usuario, es la MISMA pestaña. Vos navegás, te logueás, desplegás un menú; él
// lee ese estado y actúa sobre él. Sesión, cookies, formularios a medio llenar y
// scroll son uno solo porque los dos operan sobre el mismo `webContents`.
//
// Desde 0.32 hay hasta MAX_TABS pestañas, y eso NO cambia la idea: hay una sola
// ACTIVA, que es la que se dibuja, y es sobre esa que trabajan los dos. El
// agente no tiene una pestaña propia donde hacer cosas sin que se vean — puede
// abrir una nueva o cambiar de pestaña, pero eso le cambia la pantalla al
// usuario igual que a él, que es exactamente lo que "compartido" quiere decir.
// Las de fondo viven escondidas (setVisible(false)) con la misma partición, así
// que un login vale en las cuatro, como en cualquier navegador.
//
// NO CONFUNDIR con `fetch` de main.js. Aquello baja una URL por HTTP y la
// convierte en texto: sin sesión, sin JavaScript, sin nada que haya pasado
// antes. Esto es un Chromium con estado. La diferencia importa a la hora de
// elegir: para leer un artículo público, `fetch` es más barato y no toca la
// ventana; para cualquier cosa detrás de un login o que se arma con JS, es esto
// o nada.
//
// ---------------------------------------------------------------------------
// POR QUÉ WebContentsView Y NO UNA <webview>
//
// main.js frena `will-attach-webview` a propósito, y ese freno no se toca: una
// webview del renderer nace heredando SU preload, o sea la superficie IPC de
// alto privilegio de la app entera, y del otro lado de esa superficie hay una
// shell (ver terminal.js). Una página de internet no puede nacer del mismo lado
// de esa frontera que el chat.
//
// Un WebContentsView está afuera: es su propio `webContents`, con su propia
// sesión, sus propios `webPreferences` y CERO preload. Lo único que comparte con
// la app es el rectángulo de la ventana donde se dibuja. Esa es exactamente la
// separación que queremos, y por eso la política de navegación de main.js sigue
// valiendo palabra por palabra — habla de la VENTANA, y esto no es la ventana.
//
// El precio es que se dibuja ENCIMA del DOM, no adentro: no hay z-index que lo
// tape. Todo lo que flota en la app (Settings, la biblioteca, la tarjeta de
// permiso de una tool) quedaría abajo. Por eso existe `setVisible` y por eso el
// renderer avisa cuando abre algo encima — ver el bloque de eclipse en main.js.
// La alternativa era meter el browser en un modal y perder el "los dos a la vez",
// que es toda la idea.
//
// ---------------------------------------------------------------------------
// POR QUÉ NO CDP (webContents.debugger)
//
// Se evaluó y quedó afuera de esta versión. CDP da clicks y tecleo más fieles y
// un árbol de accesibilidad de verdad, pero abre un canal de depuración completo
// sobre una pestaña con las sesiones del usuario adentro, y todo lo que hace
// falta acá ya existe en la API pública de Electron: `sendInputEvent` manda
// eventos de mouse reales (los mismos que genera una mano), `insertText` escribe
// en el elemento con foco y `executeJavaScript` lee el DOM. Las pestañas
// tampoco lo necesitaron: son N views con la misma API. Si algún día hace falta
// interceptar red, ahí se discute.
'use strict';

const { WebContentsView, session, clipboard, nativeImage } = require('electron');
const { isIP } = require('node:net');
const path = require('node:path');

// Cuánto vive una cookie de sesión que se vuelve persistente (ver
// `_blindarSesion`). Un mes: lo bastante para no reloguearse cada semana, y no
// para siempre.
const COOKIE_DIAS = 30;

function perpetuarCookie(ses, c) {
  const host = String(c.domain || '').replace(/^\./, '');
  if (!host || !c.name) return;
  const det = {
    url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    expirationDate: Math.floor(Date.now() / 1000) + COOKIE_DIAS * 86400,
  };
  if (c.sameSite && c.sameSite !== 'unspecified') det.sameSite = c.sameSite;
  // Una cookie "host-only" no lleva domain: ponérselo la volvería válida para
  // los subdominios, que es más de lo que el sitio pidió.
  if (!c.hostOnly) det.domain = c.domain;
  ses.cookies.set(det).catch(() => { /* una que Chromium no acepta se queda de sesión */ });
}

// El UA de Electron, vestido de Chrome: sin "Electron/…" ni el token de la app
// ("neoncode/1.2.3"), y con la versión recortada como la manda Chrome. Ver
// `_blindarSesion` para el porqué de cada parte.
function uaComoChrome(ua) {
  return String(ua || '')
    .replace(/\s(Electron|nix|Nix)\/\S+/g, '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}

// El techo de pestañas. Cada una es un proceso de Chromium propio —unos 80 MB
// de RAM y un renderer más, lo mismo que cuesta la primera— así que el número
// es un presupuesto y no una preferencia: cuatro son ~300 MB de techo en una
// app que la mayoría de los días se usa para chatear. Se impone en UN lugar
// (`nuevaTab`) y de ahí sale para todos: el `+` de la tira se apaga al llegar,
// la tool del modelo recibe un error que lo dice, y un target="_blank" con el
// cupo lleno se abre donde estás mirando, que es lo que hacía cuando había una.
const MAX_TABS = 4;

// La partición. `persist:` es lo que hace que el login sobreviva al cierre de la
// app — sin eso cada arranque te devuelve deslogueado y la idea se cae sola.
//
// Y es una partición APARTE de la de la app: la sesión por defecto es la del
// renderer, o sea la que tiene el localStorage del chat y las claves del
// updater. Un sitio cualquiera no comparte almacenamiento con eso.
const PARTITION = 'persist:nix-browser';

// Techo de lo que vuelve de UNA lectura. El presupuesto de contexto de esta app
// es chico y una página moderna trae 200k caracteres de basura sin despeinarse.
// Es el tamaño de una PÁGINA de lectura y no un corte final: lo que no entra se
// pide con `browser_read { page: 2 }` (ver runBrowserRead en main.js). Antes
// era un corte seco con "… [truncated]" y ninguna forma de ver el resto.
const READ_CHAR_BUDGET = 12000;
// y de elementos accionables por página: más que esto no es una lista, es un volcado
const READ_MAX_ELEMENTS = 120;
// Lo que el script junta de un frame, que es más que una página: se reparte en
// páginas del lado de main. El techo existe para que un documento patológico
// (un log de 5 MB, un feed infinito ya scrolleado) no cruce entero el IPC.
const READ_HARD_CHARS = 200000;
const READ_HARD_ELEMENTS = 1000;

// Cuánto se le espera a un frame que contesta un executeJavaScript. Sin techo,
// una página trabada —un alert() que nadie cierra, un loop— dejaba la tool
// esperando para siempre, y con ella el turno entero. Cumplido el plazo el frame
// cuenta como muerto, igual que uno que se cayó a mitad de la lectura.
const EVAL_TECHO_MS = 5000;

function evalFrame(frame, src, ms = EVAL_TECHO_MS) {
  let t;
  const plazo = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error('the page did not answer in time (a dialog or a heavy script may be blocking it)')), ms);
  });
  return Promise.race([frame.executeJavaScript(src, true), plazo]).finally(() => clearTimeout(t));
}

// Las teclas que el modelo puede apretar con browser_press. Lista CERRADA: son
// las que destraban una página (cerrar un modal, moverse en una lista de
// autocompletar, marcar un checkbox, bajar a lo que carga al scrollear), no un
// teclado entero. Sin Alt, y de Ctrl solo los de EDICIÓN (ver EDICION, abajo):
// un Ctrl+W o un Alt+F4 desde acá no tienen nada que hacer, y los atajos de la
// app ya tienen sus dueños.
const TECLAS = {
  Enter: { k: 'Return', char: '\r' },
  Escape: { k: 'Escape' },
  Tab: { k: 'Tab' },
  'Shift+Tab': { k: 'Tab', mods: ['shift'] },
  ArrowDown: { k: 'Down' },
  ArrowUp: { k: 'Up' },
  ArrowLeft: { k: 'Left' },
  ArrowRight: { k: 'Right' },
  Backspace: { k: 'Backspace' },
  Space: { k: 'Space', char: ' ' },
  // Muchos editores de chat mandan con Ctrl+Enter (y Enter solo es salto).
  'Ctrl+Enter': { k: 'Return', char: '\r', mods: ['control'] },
};
// Los atajos de edición van por los comandos del webContents y no como teclas:
// `paste()` pega en el elemento con foco DE LA PESTAÑA (un SendKeys desde afuera
// le llegaba a la ventana de la app, no a la página — ronda 4 de Neo), y lo que
// se pega es el portapapeles del usuario, imágenes incluidas.
const EDICION = { 'Ctrl+A': 'selectAll', 'Ctrl+C': 'copy', 'Ctrl+X': 'cut', 'Ctrl+V': 'paste', 'Ctrl+Z': 'undo' };
// Las de scroll NO van como teclas: PageDown con el foco en un campo de texto no
// mueve nada, y el foco casi siempre está en algún lado. Van como rueda del mouse
// en el centro de la pestaña (o del ref), que mueve lo que esté debajo — la
// página o el contenedor con scroll propio, que es el caso de media web.
const SCROLLS = { PageDown: 'abajo', PageUp: 'arriba', End: 'fin', Home: 'inicio' };
const TECLAS_VALIDAS = [...Object.keys(TECLAS), ...Object.keys(EDICION), ...Object.keys(SCROLLS)];
// Los nombres que un modelo escribe de memoria y que significan lo mismo.
const ALIAS_TECLAS = { esc: 'Escape', return: 'Enter', down: 'ArrowDown', up: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', ' ': 'Space', spacebar: 'Space', pgdn: 'PageDown', pgup: 'PageUp', pagedown: 'PageDown', pageup: 'PageUp' };

function normalizarTecla(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const exacta = TECLAS_VALIDAS.find((t) => t.toLowerCase() === k.toLowerCase());
  return exacta || ALIAS_TECLAS[k.toLowerCase()] || null;
}

// El prólogo de los scripts que se inyectan: buscar ATRAVESANDO shadow roots.
//
// `document.querySelectorAll` no entra a un shadow root, y media web moderna vive
// adentro de uno (Reddit, Salesforce, cualquier web component). En esas páginas
// la lectura volvía con la cáscara —el header y dos links— y el modelo concluía,
// razonablemente, que no había nada. Los cerrados (`mode: 'closed'`) siguen
// afuera: no hay forma de nombrarlos desde la página, y eso es a propósito de
// quien los cerró.
//
// El texto tampoco atraviesa: `innerText` recorre el árbol de luz, así que lo de
// adentro de cada shadow root se junta aparte (`textoSombra`) y se suma al final.
const PRELUDIO_PROFUNDO = `
  // Lo que se puede accionar: lo que la lectura lista con un ref, y lo que el
  // nombre del renglón usa para saber dónde termina un renglón.
  const SEL_ACCION = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="option"]', '[role="switch"]',
    '[contenteditable=""]', '[contenteditable="true"]',
  ].join(',');
  const todosProfundo = (sel) => {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.matches(sel)) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  };
  const unoProfundo = (sel) => {
    const walk = (root) => {
      const hit = root.querySelector(sel);
      if (hit) return hit;
      for (const el of root.querySelectorAll('*')) {
        if (!el.shadowRoot) continue;
        const h = walk(el.shadowRoot);
        if (h) return h;
      }
      return null;
    };
    return walk(document);
  };
  const textoSombra = (raiz) => {
    const partes = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (!el.shadowRoot) continue;
        for (const hijo of el.shadowRoot.children) {
          if (/^(STYLE|SCRIPT|TEMPLATE|LINK)$/.test(hijo.tagName)) continue;
          const t = (hijo.innerText || '').trim();
          if (t) partes.push(t);
        }
        walk(el.shadowRoot);
      }
    };
    if (raiz) walk(raiz);
    return partes.join('\\n');
  };

  // El NOMBRE de un elemento, uno solo para la lectura y para el click: antes
  // cada uno lo armaba distinto y el mismo botón salía "Send" en el read y
  // "Enviar" en el click (reporte de Neo, 2/11/2026).
  //
  // El texto visible va primero —es lo que el usuario nombra cuando dice
  // "apretá Aceptar"—, y después lo que un lector de pantalla usaría para un
  // botón que es solo un ícono: aria-labelledby, aria-label, el <label>, el alt
  // o el aria-label de la imagen o el svg de adentro, title, placeholder. Si no
  // hay nada, un link se nombra por adónde va: en Instagram las doce
  // conversaciones de la bandeja eran "button" pelados.
  //
  // Un nombre con forma de identificador ("handle-only-single-clicks") no es
  // un nombre: es una clase o un data-* que se coló, y se descarta.
  //
  // Los caracteres invisibles (zero-width, BOM, guion blando) se van ANTES de
  // decidir si hay nombre: en claude.ai los botones de acción de cada mensaje
  // salían como button "" — un nombre que era solo eso (ronda 4 de Neo).
  //
  // Y los glifos de una FUENTE DE ÍCONOS, que son caracteres del área de uso
  // privado (U+E000–F8FF y los planos 15 y 16): en la página se dibujan como
  // un ícono, pero como texto no son nada. En claude.ai los botones de acción
  // seguían saliendo button "" en la ronda 5 aunque los invisibles ya se iban:
  // un nombre hecho de eso pasaba como nombre y le ganaba al aria-label y al
  // data-testid. Con ellos van los rellenos que se ven en blanco (braille
  // vacío, el relleno hangul) y los selectores de variante sueltos.
  const INVISIBLES = /[\\u200b-\\u200f\\u2060-\\u2064\\ufeff\\u00ad\\u034f\\u180e\\u2800\\u3164\\u115f\\u1160\\uffa0\\ue000-\\uf8ff]|[\\u{F0000}-\\u{10FFFF}]/gu;
  const limpiar = (x) => String(x || '').replace(INVISIBLES, '').replace(/^[\\ufe00-\\ufe0f\\s]+|[\\s]+$/g, '').replace(/\\s+/g, ' ').trim();
  const pareceId = (x) => /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(x);
  // Un atributo que trae un id interpolado al final ("Página siguiente de la
  // lista: carousel-placeholder", el aria-label de Canva, ronda 14) se queda
  // con la parte legible. Solo kebab-case (con guion), y solo en atributos: lo
  // que se ve en pantalla no pasa por acá.
  const util = (x) => {
    let t = limpiar(x);
    const sinId = t.replace(/\\s*[:|–—]\\s*[a-z0-9]+(?:-[a-z0-9]+)+$/, '');
    if (sinId !== t && /\\p{L}{2}/u.test(sinId)) t = sinId;
    return t && !pareceId(t) ? t : '';
  };
  // Una palabra de identificador en palabras: "content_copy" → "content copy".
  const humano = (x) => String(x || '').replace(/[-_]+/g, ' ').trim();

  // El nombre de un ícono, cuando es lo único que hay. Casi toda la web dice
  // qué ícono dibuja en algún lado aunque no lo diga para lectores de
  // pantalla: la clase (lucide-copy, fa-trash, bi-x, ph-paper-plane), el
  // data-icon de Font Awesome, el #fragmento de un sprite (<use
  // href="#icon-copy">), o la ligadura de Material ("content_copy" como texto
  // de un <span class="material-symbols">). Se usa después de todo lo que la
  // página dice a propósito, y antes del renglón.
  const RELLENO_ICONO = /^(lg|sm|xs|xl|\\d*x|\\d+|solid|regular|outline|outlined|fill|filled|duotone|light|thin|bold|rounded|sharp|fw|icon|icons|svg|small|large|mini|micro)$/;
  const PREFIJO_ICONO = /^(?:lucide|icon|icons|ph|fa|fas|far|fal|fab|bi|ri|ti|tabler|mdi|ion|gg|bx|bxs|feather|octicon|heroicon|iconoir|codicon|i)-(.+)$/;
  const deIcono = (el) => {
    const nodos = [el, ...(el.querySelectorAll ? Array.from(el.querySelectorAll('svg, use, i, span, [data-icon], [data-lucide]')).slice(0, 8) : [])];
    for (const n of nodos) {
      const di = n.getAttribute('data-icon') || n.getAttribute('data-lucide');
      if (di && !/^\\d+$/.test(di)) return humano(di);
      if (n.tagName && n.tagName.toLowerCase() === 'use') {
        const h = n.getAttribute('href') || n.getAttribute('xlink:href') || '';
        const frag = h.split('#')[1];
        if (frag) { const t = deTestId(frag.replace(/^(icon|icons|i|svg|sprite)[-_]/, '')); if (t) return t; }
      }
      const cls = typeof n.className === 'string' ? n.className : (n.getAttribute('class') || '');
      for (const c of cls.split(/\\s+/)) {
        const m = c.match(PREFIJO_ICONO);
        if (!m) continue;
        const resto = m[1].split('-').filter((p) => !RELLENO_ICONO.test(p)).join(' ');
        if (resto) return resto;
      }
      // La ligadura: el texto ES el nombre del ícono, con forma de identificador
      // (por eso util() lo descartó como nombre).
      if (n !== el && /material|symbol|icon/i.test(cls)) {
        const t = limpiar(n.textContent);
        if (/^[a-z0-9_]{2,40}$/.test(t)) return humano(t);
      }
    }
    return '';
  };
  // Lo repetido pegado a sí mismo, una vez: "Farmaco y Toxico I Farmaco y
  // Toxico I" (el texto para lectores de pantalla al lado del visible).
  //
  // La frase tiene que tener al menos DOS palabras distintas y repetirse con un
  // espacio simple: una palabra repetida puede ser texto de verdad ("sí sí",
  // "ja ja ja"), y las celdas de una tabla van separadas por TAB en el
  // innerText — una fila de notas "8,00<TAB>8,00" no se puede juntar en un solo
  // 8,00 (el tab queda adentro de la "palabra" y no hay eco que encontrar).
  // Sirve para el texto de la página y para los nombres de los refs, que en el
  // Área personal de Moodle salían "Nombre del curso X X" (ronda 4).
  const sinEco = (l) => {
    const w = l.split(' ');
    if (w.length < 4) return l;
    const out = [];
    for (let i = 0; i < w.length;) {
      let salto = 0;
      for (let k = Math.min(12, out.length); k >= 2 && !salto; k--) {
        if (i + k > w.length) continue;
        let igual = true;
        for (let j = 0; j < k; j++) if (out[out.length - k + j] !== w[i + j]) { igual = false; break; }
        if (igual && new Set(w.slice(i, i + k)).size > 1) salto = k;
      }
      if (salto) { i += salto; continue; }
      out.push(w[i]);
      i++;
    }
    return out.join(' ');
  };
  // Un data-testid es un identificador, pero muchas veces es el ÚNICO rastro
  // de qué hace un botón de puro ícono ("action-bar-copy" → "copy"). Se usa
  // como último recurso antes del renglón, sin las palabras de relleno.
  const deTestId = (x) => {
    const partes = String(x || '').split(/[-_.:\\s]+|(?=[A-Z])/).map((p) => p.toLowerCase())
      .filter((p) => p && !/^(btn|button|icon|action|actions|bar|testid|test|id|el|item|wrapper|container|\\d+)$/.test(p));
    return partes.slice(-3).join(' ');
  };
  // El texto de un nodo aunque esté oculto, con un espacio entre pedazo y
  // pedazo: textContent pega los spans ("Kidd ShadyActivo hace 2 h").
  const textoSuelto = (n) => {
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const p = [];
    while (w.nextNode()) {
      const padre = w.currentNode.parentElement;
      if (padre && /^(STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/.test(padre.tagName)) continue;
      const t = (w.currentNode.nodeValue || '').trim();
      if (t) p.push(t);
    }
    return p.join(' ');
  };
  // El nombre que se muestra y con el que se reporta un click: el propio, o
  // adónde va. La lectura usa las dos mitades por separado (ver nombrePropio y
  // aDonde): un link que solo se nombra por su destino se lista con el
  // contexto al lado, y no como si "to …/liked_by" fuera su nombre.
  const nombreAcc = (el) => nombrePropio(el) || aDonde(el);
  // El eco se saca ANTES de recortar: en el Área personal de Moodle el nombre
  // de un curso largo salía "…Biofarmacia I - 2026 Tecnología Farmacéutica y"
  // porque el corte a 90 dejaba la repetición a medias, y a medias no es eco
  // (ronda 6).
  const nombrePropio = (el) => sinEco(nombreCrudo(el)).slice(0, 90).trim();

  // El texto de un elemento sin lo que es solo para lectores de pantalla,
  // siempre que quede algo: en Moodle el link de cada curso arranca con un
  // .sr-only "Nombre del curso" y el label lo arrastraba. Si el sr-only es lo
  // ÚNICO que hay (un botón de ícono con su texto escondido), se queda.
  const SR_ONLY = '.sr-only, .visually-hidden, .visuallyhidden, .accesshide, .screen-reader-text';
  const textoSinSr = (el) => {
    const todo = el.innerText || textoSuelto(el);
    if (!el.querySelector || !el.querySelector(SR_ONLY)) return todo;
    let t = todo;
    for (const s of el.querySelectorAll(SR_ONLY)) {
      const x = (s.innerText || s.textContent || '').trim();
      if (x) t = t.replace(x, ' ');
    }
    return limpiar(t) ? t : todo;
  };

  // Un campo de texto se nombra por su ETIQUETA, nunca por lo que tiene
  // escrito: en claude.ai el editor se llamaba "Escribe tu mensaje…" vacío y
  // pasaba a llamarse como el borrador apenas tenía texto, y el agente perdía
  // de vista cuál era el campo (ronda 5 de Neo). Lo escrito va aparte, como
  // value=. El placeholder de los editores de ProseMirror/Tiptap vive en un
  // data-placeholder del párrafo vacío y desaparece con la primera letra, así
  // que el nombre que se vio una vez queda anotado en el nodo
  // (data-neon-nombre) y se reusa mientras el nodo exista.
  const esCampo = (el) => el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && /^(text|search|email|url|tel|number|password|)$/.test(el.type || ''))
    || el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox'
    || (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable));
  const nombreCampo = (el) => {
    const ph = el.querySelector ? el.querySelector('[data-placeholder]') : null;
    const cand = [
      el.getAttribute('aria-label'),
      el.labels && el.labels[0] ? el.labels[0].innerText : '',
      el.getAttribute('placeholder'),
      el.getAttribute('aria-placeholder'),
      el.getAttribute('data-placeholder'),
      ph ? ph.getAttribute('data-placeholder') : '',
      el.getAttribute('title'),
      el.getAttribute('name'),
    ];
    for (const c of cand) {
      const t = util(c);
      if (t) { el.setAttribute('data-neon-nombre', t.slice(0, 90)); return t.slice(0, 90); }
    }
    return util(el.getAttribute('data-neon-nombre'));
  };
  // Lo que hay escrito en un campo, para mostrarlo aparte del nombre.
  const valorCampo = (el) => {
    if (el.tagName === 'INPUT') return el.type === 'password' ? '' : String(el.value || '');
    if (el.tagName === 'TEXTAREA') return String(el.value || '');
    return limpiar(el.innerText || '');
  };

  const nombreCrudo = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const root = el.getRootNode();
      const t = util(lb.split(/\\s+/).map((id) => { const n = (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id); return n ? n.innerText || n.textContent : ''; }).join(' '));
      if (t) return t.slice(0, 90);
    }
    if (esCampo(el)) return nombreCampo(el);
    // El texto VISIBLE no pasa por el filtro de identificadores: ese filtro es
    // para atributos (una clase que se cuela como nombre), y en pantalla
    // "tato_olarte" es un usuario de Instagram, no un id — los links de
    // perfil con guion bajo salían sin nombre (visto en el banco de la ronda
    // 8). La excepción es la ligadura de un ícono ("content_copy" adentro de
    // un span de Material), que deIcono nombra mejor más abajo.
    // Lo que dicen los controles ANIDADOS no es de este: en un post de video de
    // Instagram el link que envuelve el video se llamaba "El audio está
    // silenciado Hashtags" por el botón de audio de adentro, y salía doble con
    // ese botón (ronda 11). Sin nada propio, cae a su destino o su contexto.
    const anidados = el.querySelectorAll ? Array.from(el.querySelectorAll(SEL_ACCION)).filter((c) => c !== el) : [];
    let txt = el.tagName === 'SELECT' ? '' : limpiar(textoSinSr(el));
    // Sin texto visible, lo de arriba es el texto SUELTO (los <title> de los
    // SVG y lo escondido), y ahí un "carousel-placeholder" es un identificador
    // y no un nombre: dos botones de Canva se llamaban así (ronda 13). El
    // filtro sigue sin aplicarse a lo que se ve ("tato_olarte").
    if (txt && pareceId(txt) && !limpiar(el.innerText || '')) txt = '';
    for (const c of anidados) {
      // innerText o, si no tiene, su texto suelto: el link del reel no tiene
      // texto visible y se nombraba por los <title> de los SVG de adentro, el
      // del botón de audio incluido (ronda 12; con innerText solo no salía).
      const x = limpiar(c.innerText || textoSuelto(c));
      if (x && txt) txt = limpiar(txt.replace(x, ' '));
    }
    const ligadura = txt && pareceId(txt) && el.querySelector && el.querySelector('[class*="material"], [class*="symbol"], [class*="icon"]');
    if (txt && !ligadura) return txt.slice(0, 400);
    // De adentro: TODAS las imágenes, íconos y etiquetas hijas en orden, y la
    // primera que sirva. Con la primera a secas no alcanzaba: en la bandeja
    // angosta de Instagram el primer [aria-label] de adentro no decía nada útil
    // y el avatar con el nombre venía después (reporte de Neo, ronda 2).
    let deImg = '';
    if (el.querySelectorAll) {
      for (const h of el.querySelectorAll('img[alt], [aria-label], svg title, [title]')) {
        if (anidados.some((c) => c === h || c.contains(h))) continue;
        deImg = util(h.getAttribute('alt') || h.getAttribute('aria-label') || h.getAttribute('title') || (h.tagName.toLowerCase() === 'title' ? h.textContent : ''));
        if (deImg) break;
      }
    }
    const cand = [
      el.getAttribute('aria-label'),
      el.labels && el.labels[0] ? el.labels[0].innerText : '',
      deImg,
      el.getAttribute('title'),
      el.getAttribute('placeholder'),
      el.getAttribute('alt'),
      el.getAttribute('name'),
      el.tagName === 'INPUT' && el.type !== 'password' ? el.value : '',
    ];
    for (const c of cand) { const t = util(c); if (t) return t.slice(0, 90); }
    // El tooltip asociado (aria-describedby) y, después, el data-testid propio
    // o del primer hijo que lo tenga.
    const db = el.getAttribute('aria-describedby');
    if (db) {
      const n = document.getElementById(db.split(/\\s+/)[0]);
      const t = n ? util(n.innerText || n.textContent) : '';
      if (t) return t.slice(0, 90);
    }
    const conTid = el.getAttribute('data-testid') ? el : (el.querySelector ? el.querySelector('[data-testid]') : null);
    const tid = conTid ? deTestId(conTid.getAttribute('data-testid')) : '';
    if (tid) return tid.slice(0, 90);
    const ico = deIcono(el);
    if (ico) return ico.slice(0, 90);
    // El RENGLÓN. Si el botón no dice nada de sí mismo, lo que lo nombra suele
    // estar al lado: en la bandeja angosta de Instagram el avatar es el botón y
    // el nombre de la persona es un hermano, escondido por CSS en ese ancho
    // pero presente en el DOM (ronda 3 de Neo: los chats seguían anónimos con
    // el nombre buscado solo ADENTRO). Se sube hasta cuatro niveles mientras el
    // ancestro no tenga otro elemento accionable —así el texto es de ESTE
    // renglón y no de la lista entera— y se toma su texto, aunque esté oculto,
    // o la etiqueta o el alt de lo que tenga adentro.
    let a = el.parentElement;
    for (let k = 0; a && a !== document.body && k < 4; k++, a = a.parentElement) {
      if (a.querySelectorAll(SEL_ACCION).length > 1) break;
      const t = util(a.getAttribute('aria-label')) || util(textoSuelto(a));
      if (t && t.length <= 140) return t.slice(0, 90);
      for (const h of a.querySelectorAll('img[alt], [aria-label], svg title')) {
        const d = util(h.getAttribute('alt') || h.getAttribute('aria-label') || (h.tagName.toLowerCase() === 'title' ? h.textContent : ''));
        if (d) return d.slice(0, 90);
      }
    }
    return '';
  };

  // Adónde va, cuando no hay nombre. Corto: los dos últimos tramos del camino
  // ("to …/DfN-CVao/liked_by"), que es lo que lo distingue; el camino entero
  // gastaba tokens y se leía peor (ronda 3).
  const aDonde = (el) => {
    const href = el.getAttribute && el.getAttribute('href');
    if (href && !/^(#|javascript:)/i.test(href)) {
      try {
        const u = new URL(href, location.href);
        const tramos = u.pathname.split('/').filter(Boolean);
        const camino = tramos.length > 2 ? '…/' + tramos.slice(-2).join('/') : '/' + tramos.join('/');
        return ('to ' + (u.host === location.host ? '' : u.host) + camino).slice(0, 90);
      } catch {}
    }
    return '';
  };

  // Qué hay adentro de algo que se quedó sin nombre: una pista para el modelo
  // (y para quien depure, que con esto sabe qué falta en esa página) en vez de
  // un "button" pelado.
  const pistaSinNombre = (el) => {
    if (/[\\ue000-\\uf8ff]/.test(el.textContent || '')) return 'an icon-font glyph';
    if (esCampo(el)) return 'a text field with no label';
    if (el.querySelector('img:not([alt]), img[alt=""]') || el.tagName === 'IMG') return 'an image with no alt text';
    if (el.querySelector('svg')) return 'an icon';
    if (el.querySelector('canvas')) return 'a canvas';
    const bg = (x) => x && getComputedStyle(x).backgroundImage !== 'none';
    if (bg(el) || bg(el.firstElementChild)) return 'a background image';
    return 'nothing readable';
  };

  // Lo que dice al LADO de algo que no tiene nombre. No es su nombre —por eso
  // se muestra como "next to"—, pero es lo que le alcanza al modelo para saber
  // qué es: el avatar de "Les gusta a santilzn y otros" (ronda 5 de Neo) vive
  // en un renglón con otros dos links, así que el nombre por renglón no lo
  // toma (ese texto no es solo de él). Hasta tres niveles y un texto corto: lo
  // largo ya es un post entero y no dice nada de este botón.
  //
  // Los niveles SIN texto no cuentan: en Instagram el avatar de los likes
  // vive en una pila de avatares (tres o cuatro cajas sin una letra) antes de
  // llegar al renglón que dice "Les gusta a…", y con tres niveles a secas no
  // llegaba nunca (ronda 6). Se sube hasta encontrar el primer texto, y se usa
  // si es corto.
  const contexto = (el) => {
    let a = el.parentElement;
    for (let k = 0; a && a !== document.body && k < 7; k++, a = a.parentElement) {
      const t = util(a.innerText || '');
      if (!t) continue;
      return t.length <= 120 ? t : '';
    }
    return '';
  };

  // ¿Lo ve el usuario? No alcanza con tener caja: el índice lateral de Moodle
  // es un cajón CERRADO que tiene caja, corrido fuera de pantalla, y le llenaba
  // al modelo la primera página de la lectura con cien links que no se podían
  // clickear ("could not be scrolled into view"). checkVisibility cubre
  // display/visibility/opacidad heredadas (el input de archivo transparente es
  // la excepción: se clickea igual); aria-hidden e inert son lo que la página
  // misma marca como "esto no está"; y lo que cae entero a un costado del
  // documento es un cajón fuera de pantalla. Lo que está MÁS ABAJO sí cuenta:
  // se llega scrolleando, y la lectura es de la página entera.
  const seVe = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const archivo = el.tagName === 'INPUT' && el.type === 'file';
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: !archivo, checkVisibilityCSS: true })) return false;
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    const ancho = Math.max(document.documentElement.scrollWidth, innerWidth);
    if (r.right <= 0 || r.left >= ancho) return false;
    return true;
  };
`;

// about:blank y nada más. Una home configurable es una preferencia que no pidió
// nadie, y arrancar en un buscador manda la primera consulta a un tercero antes
// de que el usuario haya tipeado nada.
const HOME = 'about:blank';

// Las direcciones que solo existen adentro de esta máquina o de esta red. Es la
// única lista que se sirve por http: para una IP pública el default sigue siendo
// https, que es lo que hacía la barra antes de que las locales se aceptaran.
// `isIP() !== 0` no sirve acá — es verdadero para 8.8.8.8 igual que para 10.0.0.1.
function esPrivada(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(h);
  if (version === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31);
  }
  if (version === 6) return h === '::1' || /^f[cd]/.test(h) || h.startsWith('fe80:');
  return false;
}

// Lo que se acepta como destino. `file://` NO entra: el agente ya tiene fs_read
// con sus guardrails para leer del disco, y dejarlo cargar archivos locales acá
// le daría un segundo camino al mismo lugar, sin gate y con el DOM de una página
// que después se lee como si viniera de internet.
function urlValida(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) {
    try { return new URL(u).hostname ? u : null; } catch { return null; }
  }
  if (/\s|\\/.test(u)) return null;
  // URL interpreta un número suelto como IPv4; en la barra debe ser una búsqueda.
  // Y no alcanza con los que no tienen punto: "1.5" y "0.29.0" salen de ahí
  // normalizados a 1.0.0.5 y 0.29.0.0. Se pregunta por la autoridad TAL COMO SE
  // TIPEÓ, porque para cuando `hostname` la devuelve ya es una IP legítima.
  const autoridad = u.split(/[/?#]/, 1)[0];
  if (!autoridad.includes('.') && !autoridad.startsWith('[') && !/^localhost(?::\d+)?$/i.test(autoridad)) return null;
  const tipeado = autoridad.replace(/:\d+$/, '');
  if (/^[\d.]+$/.test(tipeado) && isIP(tipeado) === 0) return null;
  try {
    const parsed = new URL(`http://${u}`);
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname;
    const local = host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.lan')
      || esPrivada(host);
    // Una IP es un destino válido aunque no tenga forma de dominio: `[2606::1]`
    // no pasa el regex de puntos y no por eso deja de ser una dirección. Lo que
    // decide el esquema es `local`; esto decide si existe.
    const dominio = isIP(host.replace(/^\[|\]$/g, '')) !== 0
      || /^[a-z\d_-]+(?:\.[a-z\d_-]+)+\.?$/i.test(host);
    if (!local && !dominio) return null;
    return `${local ? 'http' : 'https'}://${u}`;
  } catch { return null; }
}

// Solo la barra interpreta texto libre como búsqueda. La navegación de páginas
// y las tools siguen usando urlValida: un protocolo rechazado no es una consulta.
function destinoBarra(input) {
  const texto = String(input || '').trim();
  if (!texto) return null;
  const url = urlValida(texto);
  if (url) return url;
  // Lo que separa un esquema de una consulta es el espacio DESPUÉS de los dos
  // puntos: "https://bad host/" es una dirección rota y se rechaza, pero
  // "TypeError: x is not a function" arranca igual para un regex de esquema y es
  // exactamente lo que uno pega en una barra sin pensarlo. Un esquema nunca
  // lleva un espacio pegado a los dos puntos; una frase, casi siempre.
  if (/^[a-z][a-z\d+.-]*:(?!\s)/i.test(texto)) return null;
  if (/^[\\/\[]/.test(texto)) return null;
  return `https://duckduckgo.com/?q=${encodeURIComponent(texto)}`;
}

// ---------------------------------------------------------------------------
// Las teclas que la página NO se queda
//
// Con el panel abierto el foco es de la página, y la página vive en otro
// webContents: un Ctrl+B ahí no burbujea hasta el `document` del renderer —no
// hay por dónde subir— así que el atajo de la app directamente no existía.
// Peor: se lo quedaba el sitio de turno, donde Ctrl+B suele ser negrita.
//
// La regla es la MISMA que la terminal ya aplica desde su lado (ver
// `esAtajoDeSalida` en renderer/js/panels/canvas.js): el contenido se queda con
// todo, salvo las teclas que sirven para SALIR de él. Ctrl+B cierra el panel,
// Ctrl+T se va a la terminal.
//
// Ctrl+F queda AFUERA a propósito, igual que en la lista de la terminal y por el
// mismo motivo: adentro de una página es el buscador del sitio, y robárselo para
// el del chat es sacarle al usuario la herramienta que estaba usando.
//
// LOS PREDICADOS SON UNA COPIA LITERAL de los del renderer, y la duplicación es
// del proceso y no de la pereza: el `preventDefault` de un before-input-event se
// decide acá y en el acto, y preguntarle al renderer por IPC llega tarde. Si una
// lista cambia, cambia la otra — y de las dos, la que se olvida es ésta.
const esToggleBrowser = (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B');
const esToggleTerm = (e) => e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 't';
const esAtajoDeSalida = (e) => esToggleBrowser(e) || esToggleTerm(e);

// Y las teclas de las PESTAÑAS, que son la segunda familia que la página no se
// queda. No sacan del panel —cambian qué pestaña se ve, o cierran una— pero
// son de la app igual: un Ctrl+Tab que le llega al sitio mueve el foco entre sus
// campos, y un Ctrl+W no hace nada, que es peor. Los tres están libres en el
// resto de la app (medido antes de tomarlos: no hay otro Ctrl+W ni Ctrl+Tab).
//
// Ctrl+T NO abre pestaña, aunque sea lo que hacen los dedos en un navegador: es
// la terminal, y la lista de salida de arriba es la misma que la terminal aplica
// de su lado. Pestaña nueva es el `+` de la tira.
//
// MISMA REGLA DE COPIA LITERAL que los de arriba: viven también en
// renderer/js/panels/browser.js, y el test compara los textos.
const esTabSiguiente = (e) => e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Tab';
const esTabAnterior = (e) => e.ctrlKey && !e.altKey && e.shiftKey && e.key === 'Tab';
const esCerrarTab = (e) => e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'w' || e.key === 'W');
const esAtajoDeTabs = (e) => esTabSiguiente(e) || esTabAnterior(e) || esCerrarTab(e);

// El `input` de before-input-event no es un KeyboardEvent: trae `control`,
// `meta`, `shift` y `alt` donde el DOM tiene `ctrlKey` y compañía. Se traduce una
// sola vez, acá, para que los predicados de arriba puedan ser esa copia literal
// en vez de una variante con otros nombres — que es exactamente como se empiezan
// a separar dos listas que tienen que decir lo mismo.
//
// El `String(...)` no es decorativo: esto corre en CADA tecla que se aprieta en
// la página, y `esToggleTerm` llama a `.toLowerCase()`. Un `key` que no sea
// string tiraría desde adentro del handler de input de Chromium.
function comoEvento(input) {
  return {
    ctrlKey: !!input.control,
    metaKey: !!input.meta,
    shiftKey: !!input.shift,
    altKey: !!input.alt,
    key: String(input.key || ''),
  };
}

// ---------------------------------------------------------------------------
// El script que se inyecta para LEER.
//
// Va como string y no como archivo aparte por una razón práctica: tiene que
// viajar adentro del asar y ejecutarse en el mundo de la página, así que un
// require() no lo alcanza nunca. Se mantiene chico y sin dependencias.
//
// Lo que devuelve es DOS cosas y no una: el texto visible (para entender de qué
// habla la página) y la lista de elementos accionables con su referencia (para
// poder hacer algo con ellos). Un modelo que solo recibe texto puede resumir
// pero no clickear, y uno que solo recibe elementos no sabe cuál elegir.
//
// LAS REFERENCIAS SE ESCRIBEN EN EL DOM (`data-neon-ref`) y no se guardan en una
// variable de la página. Una variable la pisa cualquier framework al re-renderear
// y el ref queda apuntando a un elemento que ya no existe, sin que nadie se
// entere; el atributo viaja con el nodo. Y si el nodo se fue de verdad, el
// `querySelector` del click no encuentra nada y el error lo dice — que es lo que
// tiene que pasar.
//
// SE EJECUTA UNA VEZ POR FRAME, no una vez por página, y por eso recibe `base`:
// los refs tienen que ser únicos en toda la pestaña, así que cada frame arranca
// a numerar donde terminó el anterior. Ver `read()` para el porqué de recorrer
// los frames en vez de leer solo el documento de arriba.
const scriptRead = (base, principal) => `(() => {
  ${PRELUDIO_PROFUNDO}
  const BASE = ${base};
  const PRINCIPAL = ${principal ? 'true' : 'false'};
  const MAX_EL = ${READ_HARD_ELEMENTS};
  const MAX_CH = ${READ_HARD_CHARS};

  const SEL = SEL_ACCION;

  const tipo = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return 'input:' + (el.type || 'text');
    if (tag === 'a') return 'link';
    if (el.isContentEditable) return 'editable';
    return el.getAttribute('role') || tag;
  };

  // Los refs viejos se borran ANTES de repartir los nuevos. Sin esto, dos
  // lecturas seguidas dejan el DOM lleno de números que ya nadie va a usar y un
  // ref_7 podía seguir vivo apuntando a otra cosa después de navegar.
  todosProfundo('[data-neon-ref]').forEach((el) => el.removeAttribute('data-neon-ref'));

  // Un select va con lo que tiene elegido y sus opciones (las primeras 15): el
  // modelo elige por el texto que ve, con browser_type, y no puede adivinar las
  // opciones de un desplegable que nunca se abre (el popup es nativo).
  const opciones = (el) => {
    const ops = Array.from(el.options || []);
    const elegida = ops[el.selectedIndex];
    const lista = ops.slice(0, 15).map((o) => (o.text || o.value || '').replace(/\\s+/g, ' ').trim().slice(0, 40));
    return (elegida ? ' selected=' + JSON.stringify((elegida.text || '').trim().slice(0, 40)) : '')
      + ' options=' + JSON.stringify(lista) + (ops.length > 15 ? ' (+' + (ops.length - 15) + ' more)' : '');
  };

  // Lo que está en pantalla AHORA va marcado con *: el modelo sabe qué está
  // mirando el usuario y si un scroll hizo algo. Solo en el frame principal: un
  // iframe no sabe dónde cae él mismo dentro de la pestaña.
  //
  // "En pantalla" es contra la ventana Y contra cada ancestro que recorta
  // (overflow distinto de visible): en un layout de chat el hilo y la lista
  // scrollean por dentro, y un mensaje de arriba del hilo está "en la ventana"
  // pero tapado por el borde de su panel.
  const enPantalla = (el) => {
    if (!PRINCIPAL) return false;
    const r = el.getBoundingClientRect();
    let top = Math.max(r.top, 0), left = Math.max(r.left, 0);
    let bottom = Math.min(r.bottom, innerHeight), right = Math.min(r.right, innerWidth);
    let p = el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;
    while (p && top < bottom && left < right) {
      if (p !== document.body && p !== document.documentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const c = p.getBoundingClientRect();
          top = Math.max(top, c.top); left = Math.max(left, c.left);
          bottom = Math.min(bottom, c.bottom); right = Math.min(right, c.right);
        }
      }
      p = p.parentElement || (p.getRootNode() && p.getRootNode().host) || null;
    }
    return top < bottom && left < right;
  };

  // Dos refs iguales (mismo tipo, nombre y destino) adentro del mismo post o
  // renglón de lista son el mismo botón dibujado dos veces: Instagram tiene dos
  // "Guardar" por post (ronda 1 y 4 de Neo). Se lista el primero.
  const vistosPorCaja = new Map();
  // Lo mismo por post entero, pero solo cuando uno de los dos está en una
  // diapositiva escondida de un carrusel: cada foto o video del carrusel es un
  // <li> propio con su botón de audio, y el de la diapositiva que no se ve
  // salía como un segundo "El audio está silenciado" (ronda 9). Dos botones
  // iguales que se ven los dos (el "Me gusta" de cada comentario) quedan.
  const vistosPorPost = new Map();
  const fueraDeCarrusel = (el, tope) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== tope.parentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.right <= c.left + 1 || r.left >= c.right - 1) return true;
    }
    return false;
  };
  // Los elementos de cada línea, para la pasada del final que saca las pilas
  // de avatares.
  const porLinea = new Map();
  // Y adónde va cada línea de link, para la pasada que saca los links sin
  // nombre cuyo destino ya está en la lista con nombre.
  const destDeLinea = new Map();

  const candidatos = todosProfundo(SEL);
  const els = [];
  let n = 0;
  // La clave del último ref listado: dos links seguidos con el mismo nombre y
  // el mismo destino son uno solo (el avatar y el nombre de un perfil, que en
  // el feed de Instagram salían como ref_6 y ref_7 "Foto del perfil de…",
  // ronda 5), aunque no estén adentro de un post.
  let anterior = null;
  // Comparten un ancestro a cuatro niveles o menos.
  const vecinos = (a, b) => {
    let x = a.parentElement;
    for (let k = 0; x && k < 4; k++, x = x.parentElement) if (x.contains(b)) return true;
    return false;
  };
  for (const el of candidatos) {
    if (els.length >= MAX_EL) break;
    // Un botón deshabilitado se lista igual, marcado: el "Authorize" de GitHub
    // se apaga unos segundos contra el clickjacking, y sin él en los refs el
    // agente no sabía que existía (ronda 10). Un campo deshabilitado no.
    const apagado = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
    if (apagado && esCampo(el)) continue;
    if (!seVe(el)) continue;
    const propio = nombrePropio(el);
    // Un spinner con nombre ("Cargando...", al pie de la lista de chats de
    // Instagram, ronda 10) no es algo para tocar.
    if (el.matches('[role="progressbar"], [aria-busy="true"]') || /^(cargando|loading|carregando|chargement|caricamento)\\s*(\\.\\.\\.|…)?$/i.test(propio)) continue;
    const destino = propio ? '' : aDonde(el);
    const nom = propio || destino;
    const href = el.getAttribute('href') || '';
    const clave = tipo(el) + '|' + nom + '|' + href;
    // Seguidos, con el mismo tipo y nombre, y el mismo destino YA RESUELTO (uno
    // puede decir "/franpavez_/" y el otro la URL entera) o uno de los dos sin
    // destino, y vecinos en el DOM: es el mismo link dibujado dos veces. En la
    // ronda 6 el perfil de franpavez_ seguía doble con la comparación literal.
    const destinoAbs = href ? (() => { try { return new URL(href, location.href).href.replace(/\\/$/, ''); } catch { return href; } })() : '';
    if (nom && anterior && anterior.tipo === tipo(el) && anterior.nom === nom
      && (anterior.destino === destinoAbs || !anterior.destino || !destinoAbs)
      && (destinoAbs || anterior.destino) && vecinos(anterior.el, el)) continue;
    // Mismo destino y un nombre que es el otro RECORTADO ("Metodología de la
    // Investigación - ..." al lado del nombre entero, en la tarjeta de un
    // curso de /my/, ronda 7): es el mismo link. Queda uno, con el nombre largo.
    if (nom && anterior && anterior.tipo === tipo(el) && destinoAbs && anterior.destino === destinoAbs && vecinos(anterior.el, el)) {
      const corto = (s) => s.replace(/(\\s*(\\.\\.\\.|…))+\\s*$/, '').trim();
      const a = corto(anterior.nom), b = corto(nom);
      if (a && b && (a.startsWith(b) || b.startsWith(a))) {
        if (b.length > a.length && anterior.idx !== undefined && els[anterior.idx].includes(JSON.stringify(anterior.nom))) {
          els[anterior.idx] = els[anterior.idx].replace(JSON.stringify(anterior.nom), JSON.stringify(nom));
          anterior.nom = nom;
        }
        continue;
      }
    }
    // Un botón y un link seguidos con el MISMO nombre exacto, vecinos: la foto
    // de perfil del autor de un post de Instagram, dibujada como botón y como
    // link (ronda 8). Queda el link, que dice adónde va. En las historias el
    // par se llama distinto ("joaqui.ruizz" abre la historia, "Foto del
    // perfil de…" va al perfil) y no entra acá.
    if (propio && anterior && anterior.nom === nom && vecinos(anterior.el, el)
      && ((anterior.tipo === 'button' && tipo(el) === 'link') || (anterior.tipo === 'link' && tipo(el) === 'button'))) {
      if (tipo(el) === 'button') continue;
      const ultimo = els[els.length - 1] || '';
      if (anterior.idx === els.length - 1 && /^\\*?\\[ref_\\d+\\] /.test(ultimo)) {
        els.pop();
        anterior.el.removeAttribute('data-neon-ref');
        n--;
      }
    }
    // Uno SIN nombre propio (se lista por su destino) y otro con nombre, al
    // mismo destino y vecinos: queda el que tiene nombre. En la barra lateral
    // de Instagram salía "to /franpavez_" arriba de "Foto del perfil de
    // franpavez_" (ronda 12).
    // Seguidos alcanza: en la barra de Instagram los dos links del perfil no
    // comparten un ancestro cercano y con "vecinos" el arreglo no agarró
    // (ronda 13). Uno sin nombre justo antes o después de otro con nombre al
    // mismo destino es el mismo link.
    if (anterior && anterior.tipo === tipo(el) && destinoAbs && anterior.destino === destinoAbs
      && !propio !== !anterior.propio && !/^(#|javascript:)/i.test(href)) {
      if (!propio) continue;
      if (anterior.idx === els.length - 1 && /^\\*?\\[ref_\\d+\\] /.test(els[els.length - 1] || '')) {
        els.pop();
        porLinea.delete(els.length);
        destDeLinea.delete(els.length);
        anterior.el.removeAttribute('data-neon-ref');
        n--;
      }
    }
    anterior = { el, tipo: tipo(el), nom, destino: destinoAbs, propio };
    const caja = nom ? el.closest('article, [role="article"], li') : null;
    if (caja) {
      const vistos = vistosPorCaja.get(caja) || new Set();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      vistosPorCaja.set(caja, vistos);
    }
    const post = propio ? el.closest('article, [role="article"]') : null;
    const enPost = post ? (vistosPorPost.get(post) || new Map()) : null;
    if (post) vistosPorPost.set(post, enPost);
    const previo = enPost ? enPost.get(clave) : null;
    const escondido = post ? fueraDeCarrusel(el, post) : false;
    if (previo) {
      if (escondido) continue;
      // El que quedó listado era el de la diapositiva escondida: el ref pasa
      // al que se ve, con el mismo número.
      if (previo.escondido && (els[previo.idx] || '').includes('[' + previo.ref + ']')) {
        previo.el.removeAttribute('data-neon-ref');
        el.setAttribute('data-neon-ref', previo.ref);
        if (enPantalla(el) && !els[previo.idx].startsWith('*')) els[previo.idx] = '*' + els[previo.idx];
        previo.el = el;
        previo.escondido = false;
        continue;
      }
    }
    const ref = 'ref_' + (BASE + (++n));
    el.setAttribute('data-neon-ref', ref);
    const valor = esCampo(el) ? valorCampo(el) : '';
    const extra = el.tagName === 'SELECT' ? opciones(el)
      : valor ? ' value=' + JSON.stringify(valor.length > 60 ? valor.slice(0, 60) + '…' : valor)
      : el.checked === true ? ' checked'
      : '';
    const flag = apagado ? ' [disabled]' : '';
    // Sin nombre propio: lo que tiene al lado, para que se sepa qué es.
    const ctx = propio ? '' : contexto(el);
    const alLado = ctx ? 'next to ' + JSON.stringify(ctx.slice(0, 70)) : '';
    // Un link sin nombre pero con contexto se describe por el contexto, y su
    // destino en palabras: "to …/De4u3ArFjYl/liked_by" al lado de "Les gusta
    // a…" no le decía nada al modelo que el contexto no dijera mejor (ronda 8).
    const enPalabras = (d) => {
      const ult = d.replace(/^to /, '').split('/').filter(Boolean).pop() || '';
      return /^[a-z][a-z_-]{2,30}$/i.test(ult) && !/\\d/.test(ult) ? 'goes to "' + humano(ult) + '"' : d;
    };
    const rotulo = propio ? ' ' + JSON.stringify(propio)
      : destino && alLado ? ' (no name: ' + alLado + '; ' + enPalabras(destino) + ')'
      : destino ? ' ' + JSON.stringify(destino)
      : ' (no name: ' + pistaSinNombre(el) + (alLado ? '; ' + alLado : '') + ')';
    const marca = enPantalla(el) ? '*' : '';
    // Varios seguidos SIN nombre y con la misma descripción (los avatares de
    // "Les gusta a…", ronda 8) van en una sola línea con todos sus refs: se
    // pueden clickear, así que no se sacan, pero no hace falta repetir la
    // misma frase cuatro veces.
    const resto = tipo(el) + rotulo + extra + flag;
    const ult = els.length ? els[els.length - 1] : '';
    const mUlt = ult.match(/^(\\*?)\\[([^\\]]+)\\] (.*)$/);
    if (!propio && mUlt && mUlt[3] === resto) {
      els[els.length - 1] = (mUlt[1] || marca) + '[' + mUlt[2] + ', ' + ref + '] ' + resto;
      if (anterior && anterior.el === el) anterior.idx = els.length - 1;
      (porLinea.get(els.length - 1) || []).push(el);
      continue;
    }
    els.push(marca + '[' + ref + '] ' + resto);
    if (anterior && anterior.el === el) anterior.idx = els.length - 1;
    porLinea.set(els.length - 1, [el]);
    destDeLinea.set(els.length - 1, tipo(el) === 'link' && destinoAbs && !/^(#|javascript:)/i.test(href) ? { dest: destinoAbs, propio: !!propio } : null);
    if (enPost && !previo) enPost.set(clave, { el, ref, idx: els.length - 1, escondido });
  }

  // Una pila de avatares chicos sin nombre ni alt, al lado de un texto que ya
  // dice quiénes son ("Les gusta a tato_olarte y 139 personas más"), sale de
  // la lista: en el DOM no tienen nada que los distinga, el texto de al lado
  // lo dice mejor y el link de "liked by" que los acompaña queda. En la ronda
  // 8 ya iban en una sola línea; en la 9 Neo pidió sacarlos (R9-1). Un avatar
  // suelto queda: puede ser el único camino a un perfil.
  // En la ronda 10 la pila venía de a pares, un botón y un link por avatar,
  // así que nunca había dos líneas iguales seguidas: cuenta la TIRADA de
  // líneas seguidas sin nombre, con el mismo "next to", cuyos elementos son
  // todos una imagen chica sin alt y sin texto.
  const chico = (x) => { const r = x.getBoundingClientRect(); return r.width <= 48 && r.height <= 48; };
  const avatar = (x) => chico(x) && !limpiar(x.innerText || '') && !!x.querySelector('img:not([alt]), img[alt=""]');
  const ctxDe = (l) => { const m = /^\\*?\\[[^\\]]+\\] \\w+(:\\w+)? \\(no name: [^)]*next to ("(?:[^"\\\\]|\\\\.)*")/.exec(l); return m ? m[2] : null; };
  const esAvatar = (i) => !!ctxDe(els[i] || '') && (porLinea.get(i) || []).length > 0 && porLinea.get(i).every(avatar);
  const afuera = new Set();
  for (let i = els.length - 1; i >= 0; i--) {
    if (!esAvatar(i)) continue;
    let j = i;
    while (j > 0 && esAvatar(j - 1) && ctxDe(els[j - 1]) === ctxDe(els[i])) j--;
    const grupo = [];
    for (let k = j; k <= i; k++) grupo.push(...porLinea.get(k));
    if (grupo.length >= 2) for (let k = j; k <= i; k++) afuera.add(k);
    i = j;
  }
  // El aro de historia del autor de un post: un botón sin nombre cuyo único
  // dibujo es un <canvas>, pegado al link "Foto del perfil de…" que ya dice
  // quién es (ronda 12). Sale si la línea de al lado es un link con nombre.
  const linkConNombre = (k) => /^\\*?\\[ref_\\d+\\] link "/.test(els[k] || '') && (porLinea.get(k) || []).length === 1;
  for (let i = 0; i < els.length; i++) {
    const g = porLinea.get(i) || [];
    if (g.length !== 1 || !/ \\(no name: a canvas[;)]/.test(els[i])) continue;
    const vecino = [i - 1, i + 1].find((k) => !afuera.has(k) && linkConNombre(k) && vecinos(g[0], porLinea.get(k)[0]));
    if (vecino !== undefined) afuera.add(i);
  }
  // Un ícono sin nombre cuyo único contexto es un número ("147 2", al lado de
  // los contadores de un post, ronda 13): no hay de dónde saber qué hace, y
  // la línea solo gasta. Los botones con nombre de al lado quedan.
  for (let i = 0; i < els.length; i++) {
    if (!(porLinea.get(i) || []).length) continue;
    const m = / \\(no name: an icon; next to "([^"]*)"\\)/.exec(els[i]);
    // "26,9 mil 44 545": cifras con sus unidades (ronda 14; "mil" no entraba).
    if (m && !m[1].replace(/\\d+|\\b(mil|mill(ones|ón)?|mm?|k|b|bn|thousand|millions?)\\b|[\\s.,·]/gi, '')) afuera.add(i);
  }
  // Un link SIN nombre cuyo destino ya tiene, en algún lugar de la lista, un
  // link CON nombre: clickear cualquiera de los dos lleva al mismo lado. En la
  // barra de Instagram "to /franpavez_" siguió con la regla de "seguidos"
  // (rondas 12 a 14): no importa dónde esté el otro.
  const conNombre = new Set([...destDeLinea.values()].filter((d) => d && d.propio).map((d) => d.dest));
  for (const [i, d] of destDeLinea) if (d && !d.propio && conNombre.has(d.dest) && i < els.length) afuera.add(i);
  for (const i of [...afuera].sort((a, b) => b - a)) {
    for (const x of porLinea.get(i) || []) x.removeAttribute('data-neon-ref');
    els.splice(i, 1);
  }

  // Dónde está parado el scroll: el del documento y el de los contenedores que
  // scrollean por dentro, que en una app de chat son los que importan (el
  // documento de Instagram no scrollea nunca: la lista y el hilo sí, cada uno
  // con su barra). Hasta tres, los más grandes, y solo los que se ven y tienen
  // un tamaño que no sea de mini-scroll (un textarea, un menú).
  //
  // column-reverse: el hilo de un chat suele ir de abajo hacia arriba, y ahí
  // Chromium cuenta scrollTop desde el FONDO — 0 es abajo de todo y sube en
  // negativo. Se normaliza a "píxeles desde arriba" como cualquier otro.
  let scroll = null;
  if (PRINCIPAL) {
    const pos = (s, doc) => {
      const vista = doc ? innerHeight : s.clientHeight;
      const max = Math.max(0, s.scrollHeight - vista);
      const reverso = !doc && /-reverse$/.test(getComputedStyle(s).flexDirection);
      const y = reverso ? max - Math.abs(s.scrollTop) : s.scrollTop;
      return { y: Math.round(Math.max(0, Math.min(max, y))), max: Math.round(max) };
    };
    // El nombre de una zona sale de lo que la NOMBRA —su aria-label, el de un
    // ancestro cercano, su rol— y nunca de lo que tiene adentro: en claude.ai
    // el hilo se llamaba como el primer encabezado de un mensaje viejo
    // ("¡Anotado!") y cambiaba con el contenido (ronda 7). Sin nada de eso, el
    // lado de la pantalla donde está, que es estable y distingue la lista del
    // hilo.
    const nombreZona = (s) => {
      for (let a = s, k = 0; a && a !== document.body && k < 4; k++, a = a.parentElement) {
        const lb = a.getAttribute('aria-labelledby');
        const t = util(a.getAttribute('aria-label')) || (lb ? util((document.getElementById(lb.split(/\\s+/)[0]) || {}).innerText) : '');
        if (t) return t.slice(0, 40);
      }
      const rol = util(s.getAttribute('role'));
      if (rol && !/^(presentation|none|generic|group)$/.test(rol)) return rol;
      const r = s.getBoundingClientRect();
      const c = (r.left + r.right) / 2 / innerWidth;
      return 'scrollable area' + (r.width < innerWidth * 0.8 ? (c < 0.4 ? ' (left)' : c > 0.6 ? ' (right)' : ' (center)') : '');
    };
    scroll = [];
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > innerHeight + 4) scroll.push({ nombre: 'page', ...pos(doc, true) });
    const minimo = Math.max(150, innerHeight * 0.2);
    const zonas = [];
    for (const el of todosProfundo('*')) {
      if (el === doc || el === document.body) continue;
      if (el.clientHeight < minimo || el.scrollHeight <= el.clientHeight + 4) continue;
      if (!/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
      zonas.push({ el, area: r.width * r.height });
    }
    zonas.sort((a, b) => b.area - a.area);
    for (const z of zonas.slice(0, 3)) scroll.push({ nombre: nombreZona(z.el), ...pos(z.el, false) });
    if (!scroll.length) scroll = null;
  }

  // Los ADJUNTOS que la página muestra: después de un browser_upload, claude.ai
  // pinta una miniatura en el campo del mensaje, y la lectura no la listaba
  // (una <img> no es texto, y su botón de quitar era un ícono): para saber si
  // el archivo había entrado había que mirar la captura (ronda 5 de Neo).
  //
  // Cuenta como adjunto una imagen que viene de un archivo local (blob:) o una
  // miniatura chica que vive al lado de un campo de texto o de un selector de
  // archivos, fuera de un link: así no entran las fotos de un feed ni los
  // avatares. Va con su nombre (alt, title, o un nombre de archivo escrito
  // cerca) y con el ref del botón que la quita, si lo hay.
  const adjuntos = [];
  if (PRINCIPAL) {
    const RE_ARCHIVO = /[^\\s\\/\\\\]{1,80}\\.(png|jpe?g|gif|webp|heic|bmp|svg|pdf|docx?|xlsx?|pptx?|odt|txt|csv|md|json|zip|rar|7z|mp3|mp4|wav|mov)\\b/i;
    const CAMPO = 'textarea, input[type="file"], [contenteditable=""], [contenteditable="true"], [role="textbox"]';
    const vistas = new Set();
    for (const img of todosProfundo('img')) {
      const r = img.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || !seVe(img)) continue;
      if (img.closest('a[href]') || img.closest('[contenteditable=""], [contenteditable="true"]')) continue;
      const src = img.currentSrc || img.getAttribute('src') || '';
      const local = /^blob:/.test(src);
      let caja = null;
      let a = img.parentElement;
      // Hasta 12 niveles: en claude.ai la miniatura del composer puede quedar
      // más lejos del campo que 6, y desde la 1.7.1 (que pide campo cerca
      // también a las de blob:) el adjunto pendiente dejó de listarse (ronda
      // 10). Lo que separa el composer del hilo es el alto de la caja, no la
      // distancia.
      for (let k = 0; a && a !== document.body && k < 12; k++, a = a.parentElement) {
        if (a.querySelector(CAMPO)) { caja = a; break; }
      }
      // Siempre al lado de un campo, también las de blob:. Una vez enviado el
      // mensaje, claude.ai sigue mostrando la imagen en el hilo con el mismo
      // blob:, y la lectura la listaba como si siguiera pendiente (ronda 8).
      const cajaChica = caja && caja.getBoundingClientRect().height <= 500;
      if (!cajaChica || (!local && (r.width > 200 || r.height > 200))) continue;
      // La ficha del adjunto: el ancestro más alto que no llega al campo.
      // Sin campo cerca (un blob suelto), a lo sumo cuatro niveles.
      let ficha = img.parentElement;
      for (let k = 0; ficha && ficha.parentElement && ficha.parentElement !== caja && ficha.parentElement !== document.body && k < (caja ? 8 : 4); k++) {
        // Ni hasta el campo ni hasta la fila de TODOS los adjuntos: uno por ficha.
        if (ficha.parentElement.querySelector(CAMPO) || ficha.parentElement.querySelectorAll('img').length > 1) break;
        ficha = ficha.parentElement;
      }
      if (!ficha || vistas.has(ficha)) continue;
      const textoFicha = limpiar(ficha.innerText || '') + ' ' + [ficha, ...ficha.querySelectorAll('[title], [aria-label], img[alt]')].map((x) => (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('alt') || '')).join(' ');
      const m = textoFicha.match(RE_ARCHIVO);
      const nombre = util(img.getAttribute('alt')) || (m ? m[0] : '') || util(img.getAttribute('title')) || util(ficha.getAttribute('aria-label'));
      const quitar = Array.from(ficha.querySelectorAll('[data-neon-ref]')).map((x) => x.getAttribute('data-neon-ref'));
      // Una imagen que NO viene de un archivo local tiene que parecer un
      // adjunto: un nombre de archivo o un botón de quitar en su ficha. En
      // Canva el dibujo del botón "Sube tu propio material", al lado del
      // buscador, salía como adjunto (ronda 11). Y si la imagen es parte de
      // un botón o link que se llama de otra forma, es la cara de ese botón.
      if (!local) {
        const RE_QUITAR = /\\b(quitar|eliminar|borrar|sacar|remove|delete|clear|discard|descartar)\\b|^[x×✕✖]$/i;
        const deQuitar = Array.from(ficha.querySelectorAll(SEL_ACCION)).some((b) => RE_QUITAR.test(limpiar(nombrePropio(b))));
        const dueño = img.parentElement && img.parentElement.closest(SEL_ACCION);
        const caraDeBoton = dueño && ficha.contains(dueño) && !RE_ARCHIVO.test(nombrePropio(dueño)) && !RE_QUITAR.test(nombrePropio(dueño));
        if ((!m && !deQuitar) || caraDeBoton) continue;
      }
      // Recién acá se anota como vista: anotada antes, una miniatura que NO era
      // adjunto tapaba a la ficha entera, y la tarjeta del PDF de claude.ai (su
      // dibujo + "discurso.pdf") no entraba por la pasada de abajo (ronda 12).
      vistas.add(ficha);
      adjuntos.push((nombre ? JSON.stringify(nombre.slice(0, 80)) : 'an image') + (local ? ' (local file preview)' : ' (preview next to a text field)') + (quitar.length ? ' — refs in it: ' + quitar.slice(0, 3).join(', ') : ''));
      if (adjuntos.length >= 12) break;
    }
    // Las fichas SIN miniatura: un PDF, o una imagen que el sitio muestra como
    // "image.png" con un ícono mientras la sube. Un elemento corto, al lado de un
    // campo, cuyo texto es un nombre de archivo.
    for (const campo of todosProfundo('textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) {
      if (campo.parentElement && campo.parentElement.closest('[contenteditable=""], [contenteditable="true"]')) continue;
      let caja = campo.parentElement;
      for (let k = 0; caja && caja !== document.body && k < 10 && caja.getBoundingClientRect().height <= 500; k++) {
        for (const x of caja.querySelectorAll('*')) {
          if (x.closest('[contenteditable=""], [contenteditable="true"]')) continue;
          // Un ref se mira por su NOMBRE, que puede venir del aria-label o del
          // title: la tarjeta del PDF de claude.ai se listaba como button
          // "discurso.pdf" pero su texto no decía el nombre entero, y no
          // entraba en los adjuntos (ronda 12). Lo demás, por su texto.
          const conRef = x.hasAttribute('data-neon-ref');
          if (!conRef && x.children.length > 3) continue;
          const t = conRef ? limpiar(nombrePropio(x)) : limpiar(x.innerText || '');
          if (!t || t.length > 100) continue;
          const m = t.match(RE_ARCHIVO);
          if (!m || !seVe(x)) continue;
          let ficha = x;
          for (let j = 0; j < 4 && ficha.parentElement && ficha.parentElement !== caja && !ficha.parentElement.querySelector(CAMPO); j++) ficha = ficha.parentElement;
          if ([...vistas].some((v) => v.contains(ficha) || ficha.contains(v))) continue;
          vistas.add(ficha);
          const refs = Array.from(ficha.querySelectorAll('[data-neon-ref]')).map((y) => y.getAttribute('data-neon-ref'));
          adjuntos.push(JSON.stringify(m[0].slice(0, 80)) + ' (file next to a text field)' + (refs.length ? ' — refs in it: ' + refs.slice(0, 3).join(', ') : ''));
        }
        caja = caja.parentElement;
      }
    }
    // Y un input de archivos que ya tiene archivos elegidos (Moodle, formularios
    // comunes): los nombres están en .files aunque la página no muestre nada.
    for (const inp of todosProfundo('input[type="file"]')) {
      const elegidos = Array.from(inp.files || []).map((f) => f.name);
      if (elegidos.length) adjuntos.push(elegidos.map((x) => JSON.stringify(x)).join(', ') + ' (selected in ' + (inp.getAttribute('data-neon-ref') || 'a file input') + ')');
    }
  }

  // main/article antes que body: en una página de contenido eso saca el menú, el
  // pie y las tres columnas de "seguí leyendo" sin heurísticas.
  const raiz = document.querySelector('main, article, [role="main"]') || document.body;
  // Los emojis que la página dibuja como <img alt="🤖"> (Instagram, Discord,
  // X) no están en innerText: el mensaje "prueba 🤖" llegaba como "prueba ".
  // Se les pone al lado su alt como texto, se lee, y se sacan en el mismo
  // tick: no hay un frame en el medio, así que nadie lo ve. Solo emojis (un
  // alt corto con un pictograma) y nunca adentro de un editor, que vigila su
  // propio DOM y "corregiría" el cambio.
  const marcas = [];
  if (raiz) {
    for (const img of raiz.querySelectorAll('img[alt]')) {
      const alt = img.getAttribute('alt') || '';
      if (alt.length > 8 || !/\\p{Extended_Pictographic}/u.test(alt)) continue;
      if (img.closest('[contenteditable=""], [contenteditable="true"]')) continue;
      const s = document.createElement('span');
      s.textContent = alt;
      img.after(s);
      marcas.push(s);
    }
  }
  // Y lo que es SOLO para lectores de pantalla (.sr-only y compañía) se apaga
  // durante la lectura: está ahí para repetir en palabras lo que el ojo ya ve,
  // y en el Área personal de Moodle duplicaba cada curso en el texto (ronda 4).
  // Mismo tick que los emojis: se apaga, se lee, se devuelve como estaba.
  const apagados = [];
  if (raiz) {
    for (const el of raiz.querySelectorAll('.sr-only, .visually-hidden, .visuallyhidden, .accesshide, .screen-reader-text, .sr-only-focusable')) {
      apagados.push([el, el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]);
      el.style.setProperty('display', 'none', 'important');
    }
    // Los avisos que la página tiene montados pero no muestra: el "No tienes
    // conexión a internet." de Canva estaba en el texto sin verse en la
    // captura (ronda 10). innerText ya saca display:none y visibility:hidden;
    // acá va lo transparente, lo de tamaño cero y lo corrido fuera de la
    // pantalla, solo en regiones de avisos (aria-live, status, alert, toasts).
    const fuera = (x) => {
      if (x.checkVisibility && !x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
      const r = x.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return true;
      const fijo = getComputedStyle(x).position === 'fixed';
      const alto = fijo ? innerHeight : Math.max(document.documentElement.scrollHeight, innerHeight);
      const arriba = fijo ? 0 : -scrollY;
      return r.right <= 0 || r.left >= Math.max(innerWidth, document.documentElement.scrollWidth) || r.bottom <= arriba || r.top >= alto + arriba;
    };
    const avisos = raiz.querySelectorAll('[aria-live], [role="status"], [role="alert"], [class*="toast" i], [class*="snackbar" i]');
    for (const av of Array.from(avisos).slice(0, 40)) {
      if (!limpiar(av.innerText || '')) continue;
      for (const x of [av, ...Array.from(av.querySelectorAll('*')).slice(0, 60)]) {
        if (!limpiar(x.innerText || '') || !fuera(x)) continue;
        apagados.push([x, x.style.getPropertyValue('display'), x.style.getPropertyPriority('display')]);
        x.style.setProperty('display', 'none', 'important');
        break;
      }
    }
  }
  // Y en toda la página, no solo en las regiones de avisos: el toast de Canva
  // siguió en el texto con la 1.8.0 (ronda 11), así que no estaba en una. Un
  // texto cuyo elemento es transparente (opacity 0, propia o heredada), no
  // tiene caja, o quedó corrido fuera de la pantalla adentro de algo fijo —o
  // fuera del documento entero— no se ve. Lo que está más abajo o más arriba
  // dentro de algo que scrollea SÍ cuenta: se llega scrolleando.
  if (raiz) {
    const anchoDoc = Math.max(innerWidth, document.documentElement.scrollWidth);
    const altoDoc = Math.max(innerHeight, document.documentElement.scrollHeight);
    const veredicto = new Map(); // ancestro → 'scroll' | 'fijo' | ''
    const tipoDe = (x) => {
      if (veredicto.has(x)) return veredicto.get(x);
      const cs = getComputedStyle(x);
      const v = /(auto|scroll)/.test(cs.overflowX + cs.overflowY) ? 'scroll' : cs.position === 'fixed' ? 'fijo' : '';
      veredicto.set(x, v);
      return v;
    };
    const visto = new Map();
    const noSeVe = (x) => {
      if (visto.has(x)) return visto.get(x);
      let v = false;
      if (getComputedStyle(x).display === 'contents') v = false;
      else if (x.checkVisibility && !x.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) v = true;
      else {
        const r = x.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) v = !x.closest(SR_ONLY);
        else if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) {
          // Fuera de la ventana: depende de quién lo contiene.
          let dueño = '';
          for (let a = x; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
            dueño = tipoDe(a);
            if (dueño) break;
          }
          v = dueño === 'fijo' || (!dueño && (r.right <= 0 || r.left >= anchoDoc || r.bottom + scrollY <= 0 || r.top + scrollY >= altoDoc));
        }
      }
      visto.set(x, v);
      return v;
    };
    const tapar = new Set();
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let pasos = 0;
    for (let t; (t = w.nextNode()) && pasos < 20000; pasos++) {
      const el = t.parentElement;
      if (!el || !t.data.trim() || /^(STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/.test(el.tagName) || !noSeVe(el)) continue;
      // El más alto que tampoco se ve, para taparlo una vez.
      let alto = el;
      while (alto.parentElement && alto.parentElement !== raiz && noSeVe(alto.parentElement)) alto = alto.parentElement;
      tapar.add(alto);
    }
    for (const x of tapar) {
      if ([...tapar].some((o) => o !== x && o.contains(x))) continue;
      apagados.push([x, x.style.getPropertyValue('display'), x.style.getPropertyPriority('display')]);
      x.style.setProperty('display', 'none', 'important');
    }
  }
  let texto = (raiz ? raiz.innerText : '') || '';
  for (const s of marcas) s.remove();
  // Al revés: un mismo elemento puede haberse apagado dos veces (el aviso y la
  // pasada de lo que no se ve), y la segunda anotó "none" como su valor previo.
  // En orden, quedaba escondido en la página después de leer.
  for (const [el, v, pr] of apagados.reverse()) { if (v) el.style.setProperty('display', v, pr); else el.style.removeProperty('display'); }
  const sombra = textoSombra(raiz);
  if (sombra) texto += '\\n\\n' + sombra;
  // Un diálogo abierto casi nunca está adentro de <main>: los frameworks lo
  // montan en un portal al final del body. Si la raíz es <main>, su texto no
  // entraba, y el modelo tenía los refs del modal sin saber qué decía.
  if (raiz && raiz !== document.body) {
    for (const d of todosProfundo('[role="dialog"], [role="alertdialog"], dialog[open]')) {
      if (raiz.contains(d) || !seVe(d)) continue;
      if (d.parentElement && d.parentElement.closest('[role="dialog"], [role="alertdialog"], dialog[open]')) continue;
      const t = (d.innerText || '').trim();
      if (t) texto += '\\n\\n[dialog open' + (util(d.getAttribute('aria-label')) ? ': ' + util(d.getAttribute('aria-label')) : '') + ']\\n' + t;
    }
  }
  // Lo repetido se dice una vez. Los textos para lectores de pantalla (.sr-only,
  // .accesshide) y los layouts duplicados hacían que en Moodle cada curso
  // saliera tres o cuatro veces seguidas: líneas iguales consecutivas se juntan,
  // y una frase repetida pegada a sí misma queda una sola vez.
  // (sinEco vive en el prólogo: los nombres de los refs la usan también.)
  const lineas = [];
  // Una línea que es SOLO emojis va pegada a la anterior: el <img> del emoji
  // suele vivir en su propia caja, e innerText lo partía en dos renglones
  // ("prueba de enter 2" y abajo "🤖", ronda 3 de Neo). Las líneas en blanco
  // del medio no cuentan: el emoji va con el último texto de verdad.
  const soloEmoji = (x) => /^[\\p{Extended_Pictographic}\\u200d\\ufe0f\\s]+$/u.test(x) && /\\p{Extended_Pictographic}/u.test(x);
  for (const l of texto.split('\\n')) {
    // Una línea que es solo tabs y espacios es una línea en blanco: en las
    // carpetas de Moodle las celdas vacías de la tabla dejaban "\\t\\n\\t\\n"
    // entre archivo y archivo (ronda 5). Las de adentro de una fila de datos
    // no se tocan.
    if (!l.trim()) { lineas.push(''); continue; }
    const t = sinEco(l.replace(/\\s+$/, ''));
    if (soloEmoji(t)) {
      let k = lineas.length - 1;
      while (k >= 0 && !lineas[k].trim()) k--;
      if (k >= 0) { lineas.length = k + 1; lineas[k] = lineas[k].replace(/\\s+$/, '') + ' ' + t.trim(); continue; }
    }
    if (t.trim() && lineas.length && lineas[lineas.length - 1].trim() === t.trim()) continue;
    lineas.push(t);
  }
  texto = lineas.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  const cortado = texto.length > MAX_CH;
  if (cortado) texto = texto.slice(0, MAX_CH);

  return {
    title: document.title || '',
    url: location.href,
    text: texto,
    cortado,
    elements: els,
    total: candidatos.length,
    scroll,
    adjuntos,
  };
})()`;

// Cuántas veces aparece este texto en el frame. Para `browser_read { wait_for }`:
// el contenido de una SPA llega por fetch DESPUÉS de did-stop-loading.
//
// Se CUENTA y no se pregunta si está, porque "está" daba falsos positivos: el
// texto ya estaba en un menú, o en el campo donde el modelo lo acababa de
// escribir (reporte de Neo: wait_for "holis" volvía al instante por el propio
// borrador). Lo que hay en campos editables no cuenta, y quien espera compara
// contra la cuenta del arranque para saber si apareció algo NUEVO.
const scriptCuenta = (texto, fase = 'contar') => `(() => {
  ${PRELUDIO_PROFUNDO}
  const q = ${JSON.stringify(String(texto))}.replace(/\\s+/g, ' ').trim().toLowerCase();
  if (!q) return { n: 0, nuevos: 0 };
  // QUIÉN lo tiene, además de cuántas veces está. claude.ai saca la barra de
  // acciones del mensaje anterior y la pone en el último: sigue habiendo UN
  // "Copiar", pero es otro nodo, en otro lugar (ronda 10 de Neo). Al empezar se
  // anota cada nodo que tiene el texto y en qué padre estaba; después, uno que
  // no estaba o que cambió de padre es nuevo.
  const fase = ${JSON.stringify(fase)};
  const tienen = [];
  const enCampo = (x) => x.closest('[contenteditable=""], [contenteditable="true"], textarea, input');
  if (document.body) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) {
      const h = t.parentElement;
      if (!h || !t.data.replace(/\\s+/g, ' ').toLowerCase().includes(q) || enCampo(h)) continue;
      if (h.checkVisibility && !h.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      tienen.push(h);
    }
  }
  const b = document.body;
  let todo = ((b ? b.innerText : '') + '\\n' + textoSombra(b)).replace(/\\s+/g, ' ').toLowerCase();
  for (const ed of todosProfundo('[contenteditable=""], [contenteditable="true"], textarea')) {
    const t = (ed.innerText || ed.value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    if (t) todo = todo.replace(t, ' ');
  }
  // Y los NOMBRES de lo que se puede tocar sin texto propio: el "Copiar" de
  // claude.ai es un botón de ícono con aria-label, y wait_for "Copiar" se
  // vencía con el botón ya en los refs (ronda 7 de Neo). Solo los que no tienen
  // texto visible —los otros ya están contados en el innerText— y nunca los
  // campos: lo escrito en un campo no prueba que algo haya llegado.
  for (const el of todosProfundo(SEL_ACCION)) {
    if (esCampo(el) || limpiar(el.innerText || '') || !seVe(el)) continue;
    const nom = nombrePropio(el).toLowerCase();
    if (nom) todo += ' \\n ' + nom;
    if (nom.includes(q)) tienen.push(el);
  }
  const n = todo.split(q).length - 1;
  // Dónde está: sus ancestros hasta cinco niveles. El que se muda suele ser
  // la barra entera, no el botón, así que el padre solo no alcanza.
  const ids = window.__neonIds || (window.__neonIds = new WeakMap());
  const idDe = (x) => { if (!ids.has(x)) ids.set(x, (window.__neonSig = (window.__neonSig || 0) + 1)); return ids.get(x); };
  const linaje = (h) => { const r = []; for (let x = h.parentElement, k = 0; x && k < 5; x = x.parentElement, k++) r.push(idDe(x)); return r.join('.'); };
  if (fase === 'inicio') {
    const m = new WeakMap();
    for (const h of tienen) m.set(h, linaje(h));
    window.__neonEspera = m;
    // Contra la foto de la última acción: uno que no existía entonces, o que
    // él o un ancestro cercano cambió de padre desde entonces, llegó después.
    const a = window.__neonAccion;
    const desde = (h) => { for (let x = h, k = 0; x && k < 6; x = x.parentElement, k++) if (!a.has(x) || a.get(x) !== x.parentElement) return true; return false; };
    return { n, nuevos: 0, desdeAccion: a ? tienen.filter(desde).length : 0 };
  }
  const m = window.__neonEspera;
  const nuevos = m ? tienen.filter((h) => !m.has(h) || m.get(h) !== linaje(h)).length : 0;
  return { n, nuevos };
})()`;

// La foto de la página en el momento de una ACCIÓN del agente (click, type,
// press, upload): cada elemento con su padre. wait_for la usa para saber si lo
// que espera apareció DESPUÉS de esa acción, aunque haya llegado entre dos
// lecturas: en la ronda 13 el "Copiar" llegó entre el primer read y el segundo,
// y el segundo decía "ALREADY" porque comparaba contra su propio arranque.
const scriptMarcaAccion = `(() => {
  ${PRELUDIO_PROFUNDO}
  const m = new WeakMap();
  for (const el of todosProfundo('*')) m.set(el, el.parentElement);
  window.__neonAccion = m;
  return true;
})()`;

// Espera a que el DOM se calme: sin altas ni bajas de nodos ni cambios de texto
// durante QUIETO ms, con techo. Es lo que separa "la SPA cambió la URL" de "la
// SPA terminó de pintar la vista nueva": un read inmediato después de abrir un
// chat de Instagram devolvía la lista de chats sin la conversación. Los
// atributos no cuentan: una página con un reloj o una animación por clases
// los cambia sin parar, y nunca se calmaría.
const scriptQuieto = (quieto, techo) => `new Promise((res) => {
  const t0 = performance.now();
  let ultimo = t0;
  const mo = new MutationObserver(() => { ultimo = performance.now(); });
  mo.observe(document, { subtree: true, childList: true, characterData: true });
  const mirar = () => {
    const ahora = performance.now();
    if (ahora - ultimo >= ${quieto} || ahora - t0 >= ${techo}) { mo.disconnect(); res(Math.round(ahora - t0)); }
    else setTimeout(mirar, 50);
  };
  setTimeout(mirar, 50);
})`;

// Elegir una opción de un <select> por su texto visible (o su value).
//
// Sin mouse: un click sobre un select abre el popup NATIVO, que sendInputEvent
// no maneja y que queda abierto encima de la página. Se setea el value con el
// setter del prototipo —el que React vigila; asignar `el.value` a secas en un
// select controlado se pisa en el próximo render— y se disparan input y change,
// que es lo que escucha cualquier framework.
const scriptElegir = (ref, texto) => `(() => {
  ${PRELUDIO_PROFUNDO}
  const el = unoProfundo('[data-neon-ref=${JSON.stringify(ref)}]');
  if (!el || el.tagName !== 'SELECT') return { error: 'gone' };
  const limpio = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const q = limpio(${JSON.stringify(String(texto))}).toLowerCase();
  const ops = Array.from(el.options);
  const txt = (o) => limpio(o.text).toLowerCase();
  let o = ops.find((x) => txt(x) === q) || ops.find((x) => String(x.value).toLowerCase() === q);
  if (!o && q) {
    const parecidas = ops.filter((x) => txt(x).includes(q));
    if (parecidas.length > 1) return { error: 'ambiguous', opciones: parecidas.slice(0, 10).map((x) => limpio(x.text)) };
    o = parecidas[0];
  }
  if (!o) return { error: 'none', opciones: ops.slice(0, 20).map((x) => limpio(x.text)) };
  if (o.disabled) return { error: 'disabled', opcion: limpio(o.text) };
  el.focus();
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(el, o.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { elegida: limpio(o.text) };
})()`;

// Enfocar un ref sin clickearlo, para browser_press: la tecla va a ese elemento
// y un click de más podía disparar lo que el elemento hace al clickearlo.
const scriptFoco = (ref) => `(() => {
  ${PRELUDIO_PROFUNDO}
  const el = unoProfundo('[data-neon-ref=${JSON.stringify(ref)}]');
  if (!el) return { error: 'gone' };
  el.focus();
  return { ok: true };
})()`;

// Llevar al principio o al final lo que scrollea debajo de un punto: el primer
// ancestro con scroll propio, o el documento. Es el Home/End de browser_press.
const scriptExtremo = (x, y, fin) => `(() => {
  const puede = (el) => {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const o = getComputedStyle(el).overflowY;
    return o === 'auto' || o === 'scroll' || o === 'overlay';
  };
  let el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
  while (el && el !== document.body && el !== document.documentElement && !puede(el)) el = el.parentElement;
  const blanco = el && el !== document.body && el !== document.documentElement ? el : (document.scrollingElement || document.documentElement);
  // En column-reverse (el hilo de un chat) el fondo es scrollTop 0 y arriba es
  // negativo: End y Home van al revés que en un contenedor normal.
  const reverso = blanco !== document.scrollingElement && blanco !== document.documentElement
    && /-reverse$/.test(getComputedStyle(blanco).flexDirection);
  const fin = ${fin ? 'true' : 'false'};
  blanco.scrollTop = reverso ? (fin ? 0 : -blanco.scrollHeight) : (fin ? blanco.scrollHeight : 0);
  return true;
})()`;

// Cuánto está scrolleado lo que hay debajo de un punto: la ventana más cada
// ancestro con scroll propio. No es una posición, es una FIRMA: si cambió
// después de la rueda, algo se movió; si no, ya estaba en el borde. Sirve para
// que el modelo deje de bajar un feed que no da más.
const scriptFirmaScroll = (x, y) => `(() => {
  let s = Math.round(scrollY) + ',' + Math.round(scrollX);
  let el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
  while (el) { if (el.scrollTop || el.scrollLeft) s += ',' + el.scrollTop + ':' + el.scrollLeft; el = el.parentElement; }
  return s;
})()`;

// Los rectángulos de los <iframe> de ESTE frame, en orden de documento.
//
// Existe para traducir coordenadas: un elemento adentro de un iframe tiene su
// rect medido contra el viewport DEL IFRAME, y `sendInputEvent` habla en
// coordenadas de la pestaña entera. Sin sumarle dónde empieza el iframe, el
// click aterriza a cientos de píxeles de donde tenía que ir.
//
// `clientLeft`/`clientTop` son el borde del propio iframe: el contenido empieza
// adentro de esa línea, no en el borde exterior que devuelve el rect.
const SCRIPT_FRAMES = `Array.from(document.querySelectorAll('iframe,frame')).map((f) => {
  const r = f.getBoundingClientRect();
  return { x: r.left + f.clientLeft, y: r.top + f.clientTop, w: r.width, h: r.height };
})`;

// Ubica un ref y lo deja LISTO para que le llegue un click: lo trae al viewport y
// devuelve el punto donde hay que apretar.
//
// El centro del rectángulo y no su esquina: un link que envuelve varias líneas
// tiene su esquina superior izquierda en el aire (el rect es la unión de las
// líneas) y el click caía al lado. `elementFromPoint` confirma que en ese punto
// está de verdad nuestro elemento y no un banner de cookies encima — que es el
// caso que más veces convierte un click en "no pasó nada" sin ningún error.
//
// Adentro de un shadow root el hit test se le pregunta a ESE root y no al
// documento: `document.elementFromPoint` devuelve el host (el resultado se
// retarguetea a su árbol), y todo elemento de un web component parecía tapado
// por su propio componente.
const scriptPunto = (ref) => `(() => {
  ${PRELUDIO_PROFUNDO}
  const el = unoProfundo('[data-neon-ref=${JSON.stringify(ref)}]');
  if (!el) return { error: 'gone' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { error: 'invisible' };
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { error: 'offscreen' };
  const raizEl = el.getRootNode();
  const hit = (raizEl && raizEl.elementFromPoint ? raizEl : document).elementFromPoint(x, y);
  const tapado = hit && hit !== el && !el.contains(hit) && !hit.contains(el);
  return {
    x, y,
    tapado: !!tapado,
    quien: tapado ? (hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(/\\s+/)[0] : '')) : '',
    editable: !!(el.matches('input, textarea') || el.isContentEditable),
    apagado: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
    archivo: el.tagName === 'INPUT' && el.type === 'file',
    select: el.tagName === 'SELECT',
    nombre: nombreAcc(el).slice(0, 60),
  };
})()`;

// La huella de la página para saber si una subida se notó: las imágenes que se
// ven (por su src) y cuáles de los nombres de archivo aparecen escritos en
// algún lado —texto, title, aria-label, alt— o elegidos en un input de
// archivos. browser_upload la toma antes y después: "adjunté" no prueba que la
// página haya recibido nada, y en la ronda 5 Neo tuvo que mirar la captura
// para saberlo.
const scriptHuella = (nombres) => `(() => {
  ${PRELUDIO_PROFUNDO}
  const imgs = [];
  for (const img of todosProfundo('img')) {
    const r = img.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) continue;
    imgs.push(img.currentSrc || img.getAttribute('src') || '');
  }
  const partes = [(document.body && document.body.innerText) || '', textoSombra(document)];
  for (const el of todosProfundo('[title], [aria-label], img[alt]')) {
    partes.push(el.getAttribute('title') || '', el.getAttribute('aria-label') || '', el.getAttribute('alt') || '');
  }
  // Lo elegido en un input va aparte: que el input tenga el archivo no dice
  // que la página lo haya mostrado.
  const enInput = [];
  for (const inp of todosProfundo('input[type="file"]')) for (const f of Array.from(inp.files || [])) enInput.push(f.name);
  const todo = partes.join('\\n').toLowerCase();
  const lista = ${JSON.stringify(nombres)};
  // CUÁNTAS veces, no si está: el nombre puede estar de antes (en claude.ai
  // la lista de "Cargas" ya decía "…_image.png"), y lo que prueba que entró
  // es que aparezca una vez más.
  const cuentas = {};
  for (const n of lista) cuentas[n] = todo.split(n.toLowerCase()).length - 1;
  return { imgs, cuentas, enInput: lista.filter((n) => enInput.includes(n)) };
})()`;

// Pegar ARCHIVOS en un elemento: un ClipboardEvent('paste') con un DataTransfer
// que trae los File, que es lo que leen los sitios (claude.ai, los editores de
// ProseMirror y Lexical, Discord) en su handler de paste. El paste nativo del
// webContents pega bien el texto, pero con una imagen del portapapeles de
// Windows claude.ai no recibía nada (ronda 6 de Neo). Va al elemento del ref, o
// al que tiene el foco —atravesando shadow roots— si no hay ref.
//
// `tomado` es si alguien llamó a preventDefault: un sitio que maneja el pegado
// de archivos lo hace casi siempre. Si nadie lo tomó, quien llama decide si
// prueba el paste nativo.
const scriptPegarArchivos = (ref, archivos) => `(() => {
  ${PRELUDIO_PROFUNDO}
  let el = ${ref ? `unoProfundo('[data-neon-ref=${JSON.stringify(ref)}]')` : 'document.activeElement'};
  if (!el) return { error: 'gone' };
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (el === document.body || el === document.documentElement) {
    const campo = unoProfundo('[contenteditable=""], [contenteditable="true"], textarea');
    if (campo) el = campo;
  }
  if (el.focus) el.focus();
  const dt = new DataTransfer();
  for (const a of ${JSON.stringify(archivos)}) {
    const bin = atob(a.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    dt.items.add(new File([u], a.name, { type: a.type }));
  }
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
  const siguio = el.dispatchEvent(ev);
  return { ok: true, tomado: !siguio, destino: el.tagName.toLowerCase() + (el.isContentEditable ? '[contenteditable]' : '') };
})()`;

// El tipo de un archivo por su extensión, para el File que se pega. Los que no
// están en la lista van como binario genérico, que es lo que haría el sistema.
const MIME_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
};
const PEGAR_MAX_BYTES = 25 * 1024 * 1024;
const mimeDe = (nombre) => MIME_EXT[String(path.extname(nombre)).slice(1).toLowerCase()] || 'application/octet-stream';

// La imagen del portapapeles del sistema como PNG, o null. Electron 44: el
// clipboard del main es el de la web, y un recorte que solo trae DIB (lo que
// deja Forms SetImage o Win+Shift+S) igual sale como 'image/png'.
async function imagenPortapapeles() {
  try {
    const items = await clipboard.read();
    for (const it of items || []) {
      const tipo = (it.types || []).find((t) => /^image\//.test(t));
      if (!tipo) continue;
      const blob = await it.getType(tipo);
      const buf = Buffer.from(await blob.arrayBuffer());
      if (!buf.length) continue;
      if (tipo === 'image/png') return buf;
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) return img.toPNG();
    }
  } catch { /* portapapeles ocupado o vacío */ }
  return null;
}

class AgentBrowser {
  // `onState` lo pone main.js para que el renderer pinte la barra (URL, título,
  // si puede volver atrás, si está cargando). Es un solo canal para los dos
  // orígenes del cambio —el usuario tipeando y el agente navegando— justamente
  // para que la barra no pueda mentir sobre dónde está parada la página.
  // `onAtajo` es el otro canal hacia el renderer, y va aparte del de estado a
  // propósito: aquel cuenta dónde está la página, éste avisa que el usuario
  // apretó una tecla que es de la app. Meterlos juntos obligaría a la barra a
  // repintarse por un Ctrl+T.
  constructor({ onState, onAtajo } = {}) {
    this.onState = onState || (() => {});
    this.onAtajo = onAtajo || (() => {});
    this.win = null;
    this.bounds = null;
    // Las pestañas, en el orden de la tira, y cuál está a la vista. Cada una es
    // `{ id, view }`: el id es un contador y no el índice, porque cerrar la
    // segunda corre a la tercera y un renderer que guardó "la 2" clickearía la
    // que quedó en su lugar. Casi todo lo demás de la clase habla de `this.wc`,
    // que es el webContents de la ACTIVA — las tools, la barra, la captura y la
    // migaja operan sobre lo que se está viendo, y nunca sobre una de fondo.
    this.tabs = [];
    this.activa = null;
    this._seq = 0;
    this._ses = null;
    // DOS estados, y la diferencia es load-bearing:
    //   panelAbierto → el usuario tiene el panel a la vista. Es la promesa de la
    //                  feature ("los dos miran la misma pantalla") y por eso es
    //                  la condición para que las tools puedan tocar la página.
    //   visible      → la capa se está dibujando AHORA. Se apaga sola cada vez
    //                  que la app pone algo encima (Settings, la tarjeta de
    //                  permiso) o se minimiza la ventana.
    // Confundirlas hacía que un browser_click fallara porque el usuario tenía
    // Settings abierto medio segundo, que no es lo que queremos impedir.
    this.panelAbierto = false;
    this.visible = false;
    // Lo que se le muestra al modelo como migaja en el system prompt. Se guarda
    // acá y no se lee de la view a demanda porque el prompt se arma en un tick
    // donde la view puede estar navegando: una lectura a mitad de camino da la
    // URL vieja con el título nuevo, que es peor que llegar un segundo tarde.
    this.last = { url: '', title: '', loading: false };
  }

  get alive() { return this.tabs.length > 0; }
  get view() { return this.activa ? this.activa.view : null; }
  get wc() { return this.activa ? this.activa.view.webContents : null; }

  // Idempotente, igual que Terminal.start(): el panel llama a esto cada vez que
  // se abre y abrir dos veces no puede duplicar la pestaña.
  //
  // `restaurar` son las pestañas de la última vez ({ urls, activa }, ver
  // browser-pestanas.json en main.js): el panel vuelve a abrir donde quedó, en
  // vez de en una pestaña en blanco. Se valida cada dirección de nuevo —el
  // archivo es del disco, no de esta corrida— y lo que no pasa queda en blanco.
  attach(win, { restaurar = null } = {}) {
    if (this.alive) return this.state();
    this.win = win;

    this._ses = session.fromPartition(PARTITION);
    this._blindarSesion(this._ses);

    const urls = Array.isArray(restaurar?.urls) ? restaurar.urls.slice(0, MAX_TABS).map((u) => (u ? urlValida(u) : null)) : [];
    if (!urls.length) {
      this._crearTab();
    } else {
      const activa = Math.min(Math.max(0, Number(restaurar.activa) | 0), urls.length - 1);
      urls.forEach((u, i) => this._crearTab({ url: u, activar: i === activa }));
    }
    return this.state();
  }

  // Una pestaña más, con todo lo que la primera tenía: misma sesión, mismo
  // blindaje, mismos oídos. Es el ÚNICO lugar donde nace una view — attach,
  // nuevaTab, el window.open de una página y el reemplazo de la última cerrada
  // pasan todos por acá, y por eso el blindaje no se puede olvidar en ninguno.
  //
  // No mira el techo: eso es de `nuevaTab`. Acá se construye lo que se pidió, y
  // los que piden ya vienen con el cupo contado (o son la primera, o reemplazan
  // a la que se está cerrando, que no suma).
  _crearTab({ url = null, activar = true, foco = false } = {}) {
    const view = new WebContentsView({
      webPreferences: {
        session: this._ses,
        // Lo importante de este bloque es lo que NO está: no hay `preload`. La
        // página no tiene forma de nombrar a `window.neon` porque nadie se lo
        // puso. El resto son los defaults seguros, escritos igual — un default
        // que cambia de versión y nadie lo nota es la clase de regresión que no
        // se ve hasta que ya pasó.
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webviewTag: false,
        // El agente ni el usuario necesitan mirar la consola de la página desde
        // acá, y las devtools de una view abren una ventana propia que no
        // entiende nada de este layout.
        devTools: false,
        // Sin esto Chromium deja pasar mixed content y algunos permisos por
        // defecto en páginas que no son seguras.
        webSecurity: true,
        // El zoom se maneja desde la app, no con el Ctrl+rueda de la página: con
        // zoom distinto de 1 las coordenadas que calcula scriptPunto dejan de
        // coincidir con las que espera sendInputEvent y los clicks caen al lado.
        zoomFactor: 1,
        // El visor de PDF de Chromium es un plugin: sin esto un PDF se queda en
        // un rectángulo vacío, y el modelo no tiene nada que leer.
        plugins: true,
      },
    });

    // El fondo va oscuro y explícito. Sin esto Chromium pinta blanco mientras
    // carga, y en esta app un frame blanco es un fogonazo (misma razón por la
    // que la ventana nace fuera de pantalla).
    view.setBackgroundColor('#0d0d11');
    // Las esquinas de la casa. El panel que la rodea tiene 14px.
    try { view.setBorderRadius(12); } catch { /* Electron viejo: se ve cuadrada y ya */ }

    const tab = { id: ++this._seq, view };
    this._blindarView(tab);
    this._escucharEstado(tab);
    this._escucharAtajos(tab);

    this.win.contentView.addChildView(view);
    // Nace INVISIBLE. Quien la muestra es el renderer cuando terminó de abrir el
    // panel (la primera) o `_activar` (las demás): si apareciera acá, se
    // dibujaría un rectángulo de página encima del chat mientras el panel
    // todavía se está deslizando.
    view.setVisible(false);
    // Y con los bounds que ya tiene el hueco, si los hay. Una pestaña de fondo
    // con viewport 0×0 es una página que se cree en un teléfono de cero píxeles:
    // no carga imágenes, arma el layout para nadie, y al traerla al frente se
    // remaqueta entera delante del usuario. Con la medida real desde que nace,
    // cambiar de pestaña es un solo frame.
    view.setBounds(this.bounds || { x: 0, y: 0, width: 0, height: 0 });

    this.tabs.push(tab);
    view.webContents.loadURL(url || HOME);
    if (activar) this._activar(tab, { foco });
    else this._emitir();
    return tab;
  }

  // Quién está a la vista. Es el único lugar donde una pestaña se muestra y otra
  // se esconde, y van en el mismo tick a propósito: dos views con los mismos
  // bounds que intercambian `setVisible` se resuelven en un frame del
  // compositor, sin un hueco entre medio.
  //
  // `foco` es para los cambios que pide el USUARIO (la tira, Ctrl+Tab, Ctrl+W):
  // esconder una view no le saca el teclado a su webContents —es el mismo bug
  // que documenta `_escucharAtajos`—, así que lo que se tecleara después iría a
  // una página que ya no se ve. Los cambios que pide el modelo van sin foco: le
  // robarían el cursor al usuario en mitad de una frase en el composer.
  //
  // Y con foco pero SIN página no se enfoca nada: en una pestaña en blanco lo
  // que uno quiere es la barra de direcciones, y la barra es del renderer, que
  // la enfoca solo cuando ve que el estado que le vuelve no tiene URL.
  _activar(tab, { foco = false } = {}) {
    const antes = this.activa;
    if (antes && antes !== tab) antes.view.setVisible(false);
    this.activa = tab;
    tab.view.setVisible(this.visible);
    if (foco && tab.view.webContents.getURL() !== HOME) tab.view.webContents.focus();
    this._emitir();
  }

  _tab(id) {
    const n = Number(id);
    return this.tabs.find((t) => t.id === n) || null;
  }

  // Pestaña nueva, si entra. Los tres que la piden —el `+` de la tira, la tool
  // del modelo y un target="_blank"— reciben la misma respuesta cuando no entra,
  // y cada uno decide qué hacer con eso (apagar el botón, decírselo al modelo,
  // navegar en la actual).
  nuevaTab(url = null, { activar = true, foco = false } = {}) {
    if (!this.alive) return { ok: false, error: 'the browser panel is not open' };
    if (this.tabs.length >= MAX_TABS) {
      return { ok: false, error: `the browser panel already has ${MAX_TABS} tabs, which is the limit — navigate in the current tab or ask the user to close one`, lleno: true };
    }
    let destino = null;
    if (url) {
      destino = urlValida(url);
      if (!destino) return { ok: false, error: 'not a valid http(s) address' };
    }
    const tab = this._crearTab({ url: destino, activar, foco });
    return { ok: true, id: tab.id, url: destino || '' };
  }

  activar(id, opts = {}) {
    const tab = this._tab(id);
    if (!tab) return { ok: false, error: 'no such tab' };
    if (tab !== this.activa) this._activar(tab, opts);
    else if (opts.foco && tab.view.webContents.getURL() !== HOME) tab.view.webContents.focus();
    return { ok: true, id: tab.id };
  }

  // Cerrar una pestaña. La que queda a la vista es la vecina de la derecha, y si
  // no hay, la de la izquierda —lo que hace cualquier navegador—.
  //
  // La ÚLTIMA no se cierra: se reemplaza por una en blanco. Cerrar la vista de
  // algo no es cerrar el panel (misma línea que la shell de la terminal), y una
  // pestaña vacía es exactamente el estado en el que el panel abre. Pero se
  // reemplaza de verdad, con una view nueva, en vez de navegar la vieja a
  // about:blank: cerrar una pestaña tiene que devolver la memoria de la página
  // pesada que había adentro y dejar el historial limpio, y navegar no hace
  // ninguna de las dos.
  cerrarTab(id, opts = {}) {
    const tab = this._tab(id);
    if (!tab) return { ok: false, error: 'no such tab' };
    const i = this.tabs.indexOf(tab);
    // Sale de la lista ANTES de que nazca la que la reemplaza o se active la
    // vecina: los dos emiten estado, y la tira no tiene por qué ver un frame con
    // la pestaña que se está yendo todavía puesta.
    this.tabs.splice(i, 1);
    if (!this.tabs.length) {
      this._crearTab({ foco: opts.foco }); // activa → esconde la vieja y emite
    } else if (tab === this.activa) {
      this._activar(this.tabs[i] || this.tabs[i - 1], opts);
    } else {
      this._emitir();
    }
    this._cerrarView(tab);
    return { ok: true, id: this.activa.id };
  }

  _cerrarView(tab) {
    try { this.win?.contentView.removeChildView(tab.view); } catch { /* la ventana ya se fue */ }
    try { tab.view.webContents.close(); } catch { /* ya estaba cerrada */ }
  }

  // La sesión de la pestaña. Todo lo de acá es "que no pase sin que alguien lo
  // haya pedido": son las cosas que un sitio puede pedir solo, sin que el
  // usuario ni el agente hagan nada.
  _blindarSesion(ses) {
    if (ses._neonBlindada) return; // la partición es la misma entre attach y attach
    ses._neonBlindada = true;

    // Cámara, micrófono, ubicación, notificaciones, portapapeles, MIDI, USB.
    // Deny a todo y sin tarjeta: una app de chat que empieza a preguntar por el
    // micrófono porque una página lo pidió es una app que enseñó a decir que sí.
    // `fullscreen` entra en la lista igual que el resto — una página que se pone
    // en pantalla completa arriba de todo el layout es exactamente el problema
    // que este panel no puede tener.
    //
    // UNA excepción, y acotada: leer el portapapeles mientras corre un Ctrl+V
    // que pidió el agente, en esa pestaña y por unos segundos (ver press). Hay
    // sitios que no toman la imagen del evento de pegado sino que la leen con
    // navigator.clipboard.read() al recibirlo, y con el deny pelado el pegado
    // de una imagen no podía andar nunca (ronda 7 de Neo, claude.ai). Fuera de
    // esa ventana, una página que lee el portapapeles por su cuenta sigue sin
    // poder: lo que el usuario copió no es de ella.
    const pegando = (wc, perm) => {
      const v = this._lecturaPortapapeles;
      if (perm !== 'clipboard-read' || !v || Date.now() > v.hasta) return false;
      return !!(wc && this.wc && !this.wc.isDestroyed() && wc.id === this.wc.id);
    };
    ses.setPermissionRequestHandler((wc, perm, cb) => {
      try {
        if (pegando(wc, perm)) { this._lecturaPortapapeles.pedido = true; return cb(true); }
      } catch { /* una excepción acá es un cartel por evento: se niega */ }
      cb(false);
    });
    ses.setPermissionCheckHandler((wc, perm) => {
      try {
        if (pegando(wc, perm)) { this._lecturaPortapapeles.pedido = true; return true; }
      } catch { /* */ }
      return false;
    });
    // Ningún dispositivo, ni aunque el sitio insista.
    ses.setDevicePermissionHandler(() => false);

    // Las descargas se cancelan. No es una limitación técnica: es que un archivo
    // que aterriza en Descargas sin que nadie lo haya decidido es justo lo que
    // no queremos de un agente que clickea, y el usuario que quiera bajar algo
    // de verdad tiene su navegador de siempre a un click (el botón de abrir
    // afuera). Si alguna vez se habilita, va con tarjeta de permiso.
    ses.on('will-download', (e) => e.preventDefault());

    // Se presenta como el Chrome que es por dentro. El UA de fábrica dice
    // "Electron/44…" y "neoncode/1.x", y con eso el login de Google corta ("este
    // navegador no es seguro"); y la versión entera ("152.0.7977.130") solo la
    // manda un Chromium embebido, que Cloudflare (ScienceDirect) bloquea sin
    // ofrecer siquiera el captcha. Chrome la manda recortada: "Chrome/152.0.0.0".
    // Es el mismo arreglo de Prism (src/web.cjs), probado allá contra los dos.
    ses.setUserAgent(uaComoChrome(ses.getUserAgent()));

    // El otro chequeo de Google: en Chrome toda página tiene window.chrome con
    // `app`, `csi` y `loadTimes`, y en Electron está vacío. Lo completa un
    // preload DE SESIÓN que solo corre `contextBridge.executeInMainWorld`: no
    // expone IPC ni nada de la app. La view sigue sin `webPreferences.preload`
    // —el de la app, el que lleva a `window.neon`—, que es la frontera que
    // importa (ver el encabezado del archivo).
    try {
      ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'chrome-preload.cjs') });
    } catch { /* Electron sin registerPreloadScript: Google pedirá otro navegador y ya */ }

    // Las cookies DE SESIÓN (sin fecha de vencimiento) Chromium las borra al
    // cerrar, y con ellas el login de los sitios que las usan: Moodle te
    // deslogueaba en cada reinicio de la app. Fran pidió que sobrevivan
    // (2/11/2026), así que cada una que aparece se vuelve a guardar igual pero
    // con vencimiento a COOKIE_DIAS. Solo en esta partición: la de la app no se
    // toca. Lo que no cambia es el servidor: si el sitio da la sesión por
    // vencida de su lado, hay que volver a entrar igual.
    ses.cookies.on('changed', (_e, cookie, _causa, borrada) => {
      if (borrada || !cookie || !cookie.session) return;
      perpetuarCookie(ses, cookie);
    });
  }

  // La view en sí. Acá viven las dos puertas por las que una página se escapa de
  // su rectángulo: abrir ventanas y navegar a esquemas que no son web.
  _blindarView(tab) {
    const wc = tab.view.webContents;

    // target="_blank", window.open y el click del medio. Con pestañas, lo que
    // espera cualquiera es lo que hace su navegador: el link se abre en una
    // nueva, adelante si fue un click común y ATRÁS si fue con el botón del
    // medio o Ctrl+click (`disposition: 'background-tab'` es exactamente esa
    // distinción, y viene hecha). Con el cupo lleno se navega en la misma view,
    // que es lo que hacía cuando había una sola — denegar a secas dejaba links
    // que "no hacen nada", que es la peor de las opciones.
    //
    // Lo que NO se hace nunca es dejar que Electron cree la ventana: una ventana
    // hija hereda los webPreferences del padre y esto pasaría a ser una ventana
    // suelta sin barra, sin botón de cerrar y fuera de todo lo de arriba.
    //
    // La EXCEPCIÓN es un popup de verdad: un window.open con tamaño
    // (`disposition: 'new-window'`), que es como abren su login Google ("Entrar
    // con Google" de claude.ai), Apple, Microsoft y GitHub. Ese popup le avisa a
    // la página que lo abrió por `window.opener` y después se cierra solo con
    // window.close(). Convertido en pestaña perdía el opener —el login no
    // llegaba nunca a la página— y su window.close() se llevaba la pestaña
    // entera (2/11/2026: claude.ai dejaba la app tirando errores sin fin). Ese
    // caso sí va como ventana, chica, encima de la app y blindada igual que una
    // pestaña (ver `_blindarPopup`), como hace Prism.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const u = urlValida(url);
      if (!u) return { action: 'deny' };
      if (disposition === 'new-window' && this.win && !this.win.isDestroyed()) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.win,
            width: 520,
            height: 680,
            minWidth: 320,
            minHeight: 400,
            autoHideMenuBar: true,
            backgroundColor: '#0d0d11',
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              nodeIntegrationInSubFrames: false,
              sandbox: true,
              webviewTag: false,
              devTools: false,
              webSecurity: true,
              plugins: true,
            },
          },
        };
      }
      const fondo = disposition === 'background-tab';
      // El foco va a la pestaña nueva cuando se abre adelante: el click salió
      // de esta página, que quedaría con el teclado estando ya escondida.
      const r = this.nuevaTab(u, { activar: !fondo, foco: !fondo });
      if (!r.ok) wc.loadURL(u);
      return { action: 'deny' };
    });

    // Esquemas que no son http(s): mailto:, tel:, y sobre todo los protocolos de
    // aplicación que Windows tiene registrados (steam:, ms-settings:, y
    // cualquier cosa que haya instalado el usuario). Que una página los dispare
    // sola es ejecución de otro programa desde adentro del panel.
    //
    // No se abren afuera tampoco: `shell.openExternal` sobre un esquema
    // arbitrario es exactamente el mismo agujero con un paso más.
    wc.on('will-navigate', (e, url) => {
      if (!urlValida(url)) e.preventDefault();
    });
    wc.on('will-redirect', (e, url) => {
      if (!urlValida(url)) e.preventDefault();
    });

    // Sin subframes con privilegios: una webview adentro de la página tampoco.
    wc.on('will-attach-webview', (e) => e.preventDefault());

    // El popup que el handler de arriba dejó nacer (solo los de login).
    wc.on('did-create-window', (ventana) => this._blindarPopup(ventana));

    // Los diálogos de la página (alert/confirm/prompt) se descartan en el
    // preload de sesión (browser-chrome-preload.cjs): un alert() que nadie
    // contesta deja la pestaña congelada. El `-window-dialog` que había acá no
    // llega en Electron 44 (medido: la pestaña quedaba bloqueada igual).
  }

  // Un popup de login (ver el window open handler de `_blindarView`). Las
  // mismas puertas cerradas que una pestaña: nada que no sea http(s), ninguna
  // webview, y lo que ESE popup quiera abrir va a una pestaña del panel. Sin
  // menú, y con el sitio en el título: una ventana sin barra de direcciones
  // tiene que decir de dónde es, que es lo único que separa un login de verdad
  // de una página que se hace pasar por uno.
  _blindarPopup(ventana) {
    try {
      ventana.setMenu(null);
      const cw = ventana.webContents;
      cw.setWindowOpenHandler(({ url }) => {
        const u = urlValida(url);
        if (u) this.nuevaTab(u, { activar: true, foco: true });
        return { action: 'deny' };
      });
      cw.on('will-navigate', (e, url) => { if (!urlValida(url)) e.preventDefault(); });
      cw.on('will-redirect', (e, url) => { if (!urlValida(url)) e.preventDefault(); });
      cw.on('will-attach-webview', (e) => e.preventDefault());
      const titular = (t) => {
        let host = '';
        try { host = new URL(cw.getURL()).host; } catch { /* todavía sin dirección */ }
        if (!ventana.isDestroyed()) ventana.setTitle(host ? `${host} · ${t || ''}`.replace(/ · $/, '') : (t || ''));
      };
      ventana.on('page-title-updated', (e, t) => { e.preventDefault(); titular(t); });
      cw.on('did-navigate', () => titular(cw.getTitle()));
    } catch { /* la ventana se cerró antes de blindarla: no queda nada que blindar */ }
  }

  // Una pestaña cuyo webContents se destruyó SIN pasar por cerrarTab: la página
  // se cerró sola (window.close()), o se cayó del todo. Sale de la lista igual
  // que si el usuario la hubiera cerrado. Antes se quedaba adentro con su view
  // muerta, y el próximo evento de cualquier otra pestaña reventaba en
  // `_resumen` — un error por evento, o sea un cartel detrás de otro.
  //
  // Si ya no está en la lista es porque la cerró cerrarTab o destroy (los dos la
  // sacan antes de cerrar la view): no hay nada que hacer.
  _seFue(tab) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    try { this.win?.contentView.removeChildView(tab.view); } catch { /* la ventana ya se fue */ }
    if (!this.tabs.length) {
      if (this.win && !this.win.isDestroyed()) this._crearTab();
      else this.activa = null;
      return;
    }
    if (tab === this.activa) this._activar(this.tabs[i] || this.tabs[i - 1]);
    else this._emitir();
  }

  // Los atajos que sacan de la página (ver la lista y el porqué, arriba).
  //
  // `before-input-event` corre ANTES de que Chromium le entregue la tecla al
  // sitio, así que el preventDefault la deja sin llegar nunca: la página no ve
  // el Ctrl+B, no lo interpreta como negrita, y el atajo vuelve a ser de la app.
  //
  // Quién hace QUÉ con la tecla es del renderer, que es el que tiene el layout —
  // de acá sale el aviso y nada más. El evento traducido viaja entero en vez de
  // un "cerrá el browser" ya masticado: así el renderer consulta sus propios
  // predicados y el día que la lista crezca, este lado solo tiene que dejarla
  // pasar.
  _escucharAtajos(tab) {
    tab.view.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const ev = comoEvento(input);
      const salida = esAtajoDeSalida(ev);
      if (!salida && !esAtajoDeTabs(ev)) return;
      e.preventDefault();
      // El foco vuelve a la app ANTES de avisar, y sin esto el atajo funcionaba
      // una sola vez: esconder la capa no le saca el foco al webContents de la
      // página, así que el Ctrl+B siguiente lo seguía recibiendo una view que ya
      // no está en pantalla y el panel no volvía a abrir nunca.
      //
      // Solo con los de SALIDA. Con los de pestañas el teclado se queda en el
      // browser: quien lo recibe es la pestaña que pasa al frente (ver `foco` en
      // `_activar`), y mandarlo a la app dejaría al usuario que rota de pestaña
      // con Ctrl+Tab escribiendo en el composer sin haberlo pedido.
      if (salida && this.win && !this.win.isDestroyed()) this.win.webContents.focus();
      this.onAtajo(ev);
    });
  }

  // Un solo lugar donde el estado cambia, y de ahí sale el aviso. Todos los
  // eventos empujan al mismo `_emitir` para que no haya dos versiones de "dónde
  // está la página" — la de la barra y la del prompt son la misma.
  //
  // Se escucha a TODAS las pestañas, no solo a la activa: la tira muestra el
  // título de cada una, y una de fondo que termina de cargar tiene que dejar de
  // decir "cargando". Lo único que se filtra por activa es el `error`, que la
  // barra pinta sobre LA página que se ve — una de fondo que falló no puede
  // colgarle su aviso a la de adelante.
  _escucharEstado(tab) {
    const wc = tab.view.webContents;
    const emitir = () => this._emitir();
    wc.on('did-start-loading', emitir);
    wc.on('did-stop-loading', emitir);
    wc.on('did-navigate', emitir);
    // Un documento nuevo que todavía no se leyó: ahí, que el texto esperado ya
    // esté ES la prueba (ronda 11). Solo la navegación entera: un pushState
    // (el chat nuevo de claude.ai cambia la URL al mandar el primer mensaje)
    // no es una página nueva.
    wc.on('did-navigate', () => (this._sinLeer ||= new WeakSet()).add(wc));
    wc.on('did-navigate-in-page', emitir);
    wc.on('page-title-updated', emitir);
    // Una carga que falla también es un cambio de estado: sin esto la barra se
    // quedaba girando para siempre sobre una URL que nunca llegó.
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this._emitir(tab === this.activa ? { error: `${desc} (${code})`, url } : null);
    });
    // La página se cayó (OOM, un crash de renderer). Que la barra lo diga en vez
    // de dejar un rectángulo negro sin explicación.
    wc.on('render-process-gone', () => this._emitir(tab === this.activa ? { error: 'the page crashed' } : null));
    // La página se cerró sola (ver `_seFue`).
    wc.once('destroyed', () => this._seFue(tab));
  }

  // Corre adentro de handlers de eventos de Chromium: un error acá sube como
  // "Uncaught Exception" del main, que Electron muestra como un cartel modal, y
  // como corre en CADA evento de CADA pestaña, un estado roto era un cartel
  // detrás de otro sin fin. Un aviso de estado perdido es mucho mejor.
  _emitir(extra) {
    try {
      this.last = this.state();
      this.onState({ ...this.last, ...(extra || {}) });
    } catch (err) {
      console.error('[browser] estado:', err);
    }
  }

  // Lo que la tira necesita de cada pestaña. Lo mínimo: la tira no tiene favicon
  // —serían un fetch por pestaña por navegación y un carril más por el que entra
  // una imagen de un tercero— así que se identifica por título, y por host
  // mientras el título no llegó.
  _resumen(tab) {
    const w = tab?.view?.webContents;
    if (!w || w.isDestroyed()) return { id: tab?.id, url: '', title: '', loading: false, active: tab === this.activa };
    const u = w.getURL();
    return {
      id: tab.id,
      url: u === HOME ? '' : u,
      title: w.getTitle() || '',
      loading: w.isLoading(),
      active: tab === this.activa,
    };
  }

  state() {
    const wc = this.wc;
    if (!wc || wc.isDestroyed()) return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, open: this.alive, tabs: this.tabs.map((t) => this._resumen(t)), activa: this.activa?.id ?? null, maxTabs: MAX_TABS };
    // about:blank es un detalle de implementación, no una dirección: en la barra
    // se ve vacía, que es lo que ve cualquiera al abrir una pestaña nueva.
    const url = wc.getURL() === HOME ? '' : wc.getURL();
    return {
      url,
      title: wc.getTitle() || '',
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      open: true,
      tabs: this.tabs.map((t) => this._resumen(t)),
      activa: this.activa.id,
      maxTabs: MAX_TABS,
    };
  }

  // La migaja del system prompt: una línea, o nada. Vive acá y no en main.js
  // porque quien sabe si hay página es este módulo.
  // Cuelga de `panelAbierto` y no de `visible`: la migaja no tiene que
  // parpadear porque el usuario abrió Settings un segundo.
  //
  // Con más de una pestaña, las otras van en la misma línea y solo por título:
  // el modelo tiene que saber que existen (si no, "la otra pestaña" del usuario
  // no le dice nada), pero el cuerpo de cada una lo pide con browser_read
  // después de cambiar. Una pestaña activa en blanco con otras cargadas también
  // se cuenta —antes era null y el panel desaparecía del prompt—.
  breadcrumb() {
    if (!this.alive || !this.panelAbierto) return null;
    const { url, title } = this.last;
    const otras = (this.last.tabs || []).filter((t) => !t.active);
    if (!url && !otras.length) return null;
    const linea = !url ? 'a blank tab' : title ? `${title} — ${url}` : url;
    if (!otras.length) return linea;
    const nombre = (t) => {
      if (t.title) return t.title.length > 40 ? `${t.title.slice(0, 39)}…` : t.title;
      try { return t.url ? new URL(t.url).hostname : 'blank'; } catch { return 'blank'; }
    };
    return `${linea} · other tab${otras.length === 1 ? '' : 's'}: ${otras.map(nombre).join(', ')}`;
  }

  // El rectángulo va a TODAS las pestañas y no solo a la activa, por lo mismo
  // que la view nace con él (ver _crearTab): las de fondo tienen que tener el
  // viewport real para que traerlas al frente no las remaquete. Son cuatro
  // llamadas como mucho, y setBounds sobre una view escondida no dibuja nada.
  setBounds(r) {
    if (!this.alive) return;
    const b = {
      x: Math.round(r?.x || 0),
      y: Math.round(r?.y || 0),
      width: Math.max(0, Math.round(r?.width || 0)),
      height: Math.max(0, Math.round(r?.height || 0)),
    };
    this.bounds = b;
    for (const t of this.tabs) t.view.setBounds(b);
  }

  // Mostrar y ocultar es lo que hace que una view nativa pueda convivir con un
  // DOM que tiene cosas flotando encima. Se llama desde tres lados: el panel al
  // abrir/cerrar, el eclipse de los overlays y el minimizado de la ventana.
  // Solo la ACTIVA: las de fondo están escondidas siempre, y `visible` se
  // recuerda para que la que pase al frente sepa si tiene que dibujarse.
  setVisible(v) {
    if (!this.alive) return;
    this.visible = !!v;
    this.activa.view.setVisible(!!v);
  }

  navigate(url) {
    const u = urlValida(url);
    if (!u) return { ok: false, error: 'not a valid http(s) address' };
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    this.wc.loadURL(u);
    return { ok: true, url: u };
  }

  back() { if (this.wc?.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack(); }
  forward() { if (this.wc?.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward(); }
  reload() { this.wc?.reload(); }
  stop() { this.wc?.stop(); }

  // Espera a que la página termine de cargar, con techo. No es un `sleep`: casi
  // todas las acciones del agente (navegar, clickear un link) disparan una carga
  // y leer en el medio devuelve la página vieja o una a medio armar, que es peor
  // que esperar 200ms.
  //
  // El techo existe porque `did-stop-loading` no llega nunca en las páginas que
  // dejan una conexión abierta (analytics, websockets, un video). Cumplido el
  // plazo se sigue igual: la página ya está usable hace rato.
  esperarCarga(ms = 8000) {
    const wc = this.wc;
    if (!wc || !wc.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
      const listo = () => { clearTimeout(t); wc.off('did-stop-loading', listo); wc.off('did-fail-load', listo); resolve(); };
      const t = setTimeout(listo, ms);
      wc.once('did-stop-loading', listo);
      wc.once('did-fail-load', listo);
    });
  }

  // Un respiro después de actuar. Un click que abre un menú o dispara un fetch no
  // cambia el DOM en el mismo tick, y leer inmediatamente devuelve el estado de
  // antes — el agente concluía que su click no había hecho nada y lo repetía.
  _asentar(ms = 350) { return new Promise((r) => setTimeout(r, ms)); }

  // El árbol de frames de la pestaña, cada uno con el offset acumulado de dónde
  // empieza dentro del viewport de arriba.
  //
  // La correspondencia hijo↔<iframe> se hace POR ORDEN: `frame.frames` devuelve
  // los hijos directos y `SCRIPT_FRAMES` los elementos en orden de documento, y
  // en la práctica coinciden. No es una garantía del estándar, y por eso el
  // offset viaja con `medido`: cuando la cuenta no cierra —hay más frames que
  // elementos, un frame sin caja, un `object` de por medio— el que actúa lo sabe
  // y usa el camino sintético en vez de tirar un click a ciegas a una coordenada
  // inventada. Un click en el lugar equivocado es peor que un click sintético.
  async _arbolFrames() {
    const raiz = this.wc.mainFrame;
    const todos = [{ frame: raiz, dx: 0, dy: 0, medido: true }];
    const cola = [todos[0]];
    while (cola.length) {
      const actual = cola.shift();
      let hijos = [];
      try { hijos = actual.frame.frames || []; } catch { hijos = []; }
      if (!hijos.length) continue;
      let rects = [];
      try { rects = (await evalFrame(actual.frame, SCRIPT_FRAMES)) || []; } catch { rects = []; }
      hijos.forEach((h, i) => {
        const r = rects[i];
        // Un iframe sin caja (display:none, 0×0) no se puede clickear ni tiene
        // sentido leer: se marca sin medida y sus elementos no van a la lista.
        const vale = !!r && r.w > 0 && r.h > 0 && actual.medido;
        const item = {
          frame: h,
          dx: vale ? actual.dx + r.x : 0,
          dy: vale ? actual.dy + r.y : 0,
          medido: vale,
        };
        todos.push(item);
        cola.push(item);
      });
    }
    return todos;
  }

  // Leer la página es leer TODOS sus frames, no el documento de arriba.
  //
  // Se hacía solo el principal, y eso dejaba afuera justo el contenido que
  // importa en media web: un artifact de claude.ai, un visor de PDF, un editor
  // embebido, un formulario de pago. La lectura devolvía el título, dos botones
  // y el link de "Sign in" —la carcasa— y el modelo concluía, razonablemente,
  // que la página no tenía nada.
  //
  // Por qué funciona incluso cross-origin: `WebFrameMain.executeJavaScript` se
  // ejecuta desde el proceso principal contra ese frame, no desde el documento
  // padre. Un `iframe.contentDocument` en la página se choca con la política de
  // mismo origen; esto no la toca.
  //
  // Los frames de publicidad y tracking se caen solos por el filtro de abajo: se
  // quedan los que tienen algo que ofrecer (texto de verdad o algo accionable),
  // que es lo mismo que uno mira cuando decide si un iframe importa.
  async read() {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    await this.esperarCarga();
    if (this._sinLeer) this._sinLeer.delete(this.wc);
    // Y que el DOM se calme: una SPA cambia la URL antes de pintar la vista
    // nueva, y leer en ese hueco devolvía la vista vieja.
    const asento = await this._quieto();
    let frames;
    try { frames = await this._arbolFrames(); } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }

    const partes = [];
    let elements = [];
    let total = 0;
    let cortado = false;
    let base = 0;
    let principal = null;
    let fallaPrincipal = '';

    for (const f of frames) {
      if (!f.medido) continue; // un frame sin caja no se ve ni se toca
      let r;
      try {
        r = await evalFrame(f.frame, scriptRead(base, f.frame === this.wc.mainFrame));
      } catch (err) {
        // un frame que murió (o no contestó) a mitad de la lectura no rompe el
        // resto; el del principal se guarda para decir POR QUÉ no se pudo leer
        if (f.frame === this.wc.mainFrame) fallaPrincipal = String(err?.message || err);
        continue;
      }
      if (!r) continue;
      const esPrincipal = f.frame === this.wc.mainFrame;
      if (esPrincipal) principal = r;
      // El filtro de los frames de relleno: sin texto de verdad y sin nada que
      // tocar, un iframe es un pixel de tracking o un anuncio.
      else if ((r.text || '').trim().length < 40 && !r.elements.length) continue;

      base += r.elements.length;
      elements = elements.concat(r.elements);
      total += r.total;
      cortado = cortado || r.cortado;
      const cuerpo = (r.text || '').trim();
      if (esPrincipal) partes.unshift({ frame: false, url: r.url, text: cuerpo });
      else if (cuerpo) partes.push({ frame: true, url: r.url, text: cuerpo, title: r.title });
    }

    if (!principal) return { ok: false, error: fallaPrincipal || 'could not read the page' };
    return {
      ok: true,
      title: principal.title,
      url: principal.url,
      partes,
      elements,
      total,
      cortado,
      frames: partes.filter((p) => p.frame).length,
      scroll: principal.scroll || null,
      adjuntos: principal.adjuntos || [],
      asento,
    };
  }

  // Click con eventos de mouse REALES, no `el.click()`.
  //
  // La diferencia no es cosmética: `el.click()` dispara un solo evento
  // sintético, y media web moderna abre sus menús en `mousedown`, arma el estado
  // en `mouseover` o directamente ignora los clicks que no tienen `isTrusted`.
  // `sendInputEvent` entra por el mismo camino que una mano — pasa por hit
  // testing, mueve el foco, y el sitio no puede distinguirlo.
  async click(ref) {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    const p = await this._punto(ref);
    if (!p.ok) return p;
    // Clickear un deshabilitado no hace nada y se reportaba como hecho. Muchos
    // se habilitan solos al rato (el "Authorize" de GitHub).
    if (p.apagado) return { ok: false, error: `${ref}${p.nombre ? ` (${JSON.stringify(p.nombre)})` : ''} is disabled right now — sites often enable it after a few seconds or once a form is filled; wait and call browser_read again` };
    await this._marcarAccion();

    // El movimiento va ANTES del apretón, y no es de más: sin un mouseMove
    // previo, los menús que se abren en hover y los botones que se habilitan al
    // acercarse no llegan a existir cuando aterriza el click.
    this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    this.wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    this.wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });

    await this._asentar();
    await this.esperarCarga();
    return { ok: true, nombre: p.nombre, tapado: p.tapado, quien: p.quien };
  }

  // Escribir es clickear para enfocar y después `insertText`.
  //
  // Por qué no tecla por tecla con sendInputEvent: además de ser 40 veces más
  // lento, rompe con cualquier layout de teclado que no sea el que asume el
  // código, y los acentos y la ñ salen mal. `insertText` va al elemento con foco
  // y dispara beforeinput/input, que es lo que escuchan React, Vue y los
  // autocompletados. Lo que NO dispara son keydown/keyup, y hay sitios que solo
  // reaccionan a eso: por eso `submit` manda un Enter de verdad al final.
  async type(ref, text, submit) {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    const p = await this._punto(ref);
    if (!p.ok) return p;
    // Un desplegable se "escribe" eligiendo la opción por su texto: es el único
    // camino, porque el popup de un <select> es nativo y ningún evento de mouse
    // lo maneja (ver scriptElegir).
    if (p.select) return this._elegir(ref, text, p);
    if (!p.editable) return { ok: false, error: `${ref} is not a text field (it is ${p.nombre ? JSON.stringify(p.nombre) : 'not editable'})` };
    await this._marcarAccion();

    this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    this.wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    this.wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });

    // Se vacía lo que había. Sin esto, escribir sobre un campo con contenido
    // concatena, y el agente que "corrige" un buscador termina buscando las dos
    // cosas pegadas. Ctrl+A dentro del campo enfocado y encima se escribe.
    this.wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
    this.wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });

    this.wc.insertText(String(text ?? ''));

    if (submit) {
      // Un respiro ENTRE el texto y el Enter. Los editores de React (Lexical en
      // Instagram, Draft.js) procesan el input en su propio ciclo: un Enter que
      // llega en el mismo tick encuentra el estado viejo, con el campo vacío
      // para ellos, y no envía nada — el texto quedaba escrito y sin mandar
      // (reporte de Neo, 2/11/2026).
      await this._asentar(150);
      this.wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      this.wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      this.wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await this._asentar();
      await this.esperarCarga();
    } else {
      await this._asentar(120);
    }
    // El aviso de "había algo encima" viaja también acá, y no solo en click.
    // Medido en el banco de pruebas: con un modal de cookies tapando el campo,
    // el click de foco no llega, `insertText` escribe en la nada y el value
    // queda como estaba — pero la tool devolvía ok y el modelo seguía adelante
    // convencido de que había completado el formulario. Es el mismo desenlace
    // silencioso que en click y merece el mismo aviso.
    return { ok: true, nombre: p.nombre, tapado: p.tapado, quien: p.quien };
  }

  async _elegir(ref, text, p) {
    const frame = p.frame || this.wc.mainFrame;
    let r;
    try { r = await evalFrame(frame, scriptElegir(ref, text)); } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    if (!r || r.error === 'gone') return { ok: false, error: `${ref} is not on the page any more — the page changed, call browser_read again` };
    const lista = (ops) => (ops || []).map((o) => JSON.stringify(o)).join(', ');
    if (r.error === 'ambiguous') return { ok: false, error: `more than one option of ${ref} matches ${JSON.stringify(String(text))}: ${lista(r.opciones)} — pass the exact option text` };
    if (r.error === 'none') return { ok: false, error: `${ref} has no option ${JSON.stringify(String(text))}. Its options include: ${lista(r.opciones)}` };
    if (r.error === 'disabled') return { ok: false, error: `the option ${JSON.stringify(r.opcion)} of ${ref} is disabled` };
    await this._asentar(120);
    await this.esperarCarga();
    return { ok: true, nombre: p.nombre, elegida: r.elegida, tapado: false, quien: '' };
  }

  // Una tecla, de la lista cerrada de TECLAS/SCROLLS. Con `ref`, la tecla va a ese
  // elemento (se enfoca sin clickear); sin ref, a lo que tenga el foco en la
  // página — que después de un browser_type es el campo donde se escribió, que es
  // justo lo que quiere un ArrowDown sobre un autocompletado.
  async press(key, ref) {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    const k = normalizarTecla(key);
    if (!k) return { ok: false, error: `'${key}' is not a key this tool presses — use one of: ${TECLAS_VALIDAS.join(', ')}` };
    await this.esperarCarga();

    let p = null;
    if (ref) {
      p = await this._punto(ref);
      if (!p.ok) return p;
      let f;
      try { f = await evalFrame(p.frame || this.wc.mainFrame, scriptFoco(String(ref).trim())); } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
      if (!f || f.error) return { ok: false, error: `${ref} is not on the page any more — the page changed, call browser_read again` };
    }
    await this._marcarAccion();

    if (SCROLLS[k]) {
      const b = this.bounds || { width: 800, height: 600 };
      const x = p ? p.x : Math.round(b.width / 2);
      const y = p ? p.y : Math.round(b.height / 2);
      // En la rueda de Chromium el delta POSITIVO sube (el contenido baja hacia
      // el ojo). Una pantalla es el 85% del alto, como el PageDown de cualquier
      // navegador: la última línea de antes queda arriba, para no perder el hilo.
      const pantalla = Math.round(b.height * 0.85);
      const firma = async () => {
        try { return await evalFrame(this.wc.mainFrame, scriptFirmaScroll(x, y), 2000); } catch { return null; }
      };
      const antes = await firma();
      if (SCROLLS[k] === 'fin' || SCROLLS[k] === 'inicio') {
        // Home y End van por script: Chromium recorta el delta de una rueda
        // (medido: un -1e6 baja ~1500px), así que "hasta el fondo" con rueda
        // eran varias vueltas. scrollTop dispara los mismos eventos de scroll
        // que escuchan los feeds infinitos.
        try { await evalFrame(this.wc.mainFrame, scriptExtremo(x, y, SCROLLS[k] === 'fin'), 2000); } catch { /* la firma lo va a decir */ }
      } else {
        const dy = SCROLLS[k] === 'abajo' ? -pantalla : pantalla;
        this.wc.sendInputEvent({ type: 'mouseMove', x, y });
        this.wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, canScroll: true });
      }
      await this._asentar();
      const despues = await firma();
      return { ok: true, tecla: k, scroll: true, movio: antes === null || despues === null ? null : antes !== despues, nombre: p?.nombre || '' };
    }

    // Ctrl+V con una IMAGEN en el portapapeles: el paste nativo pega texto,
    // pero claude.ai no recibía la imagen (ronda 6 de Neo). Se le pasa al campo
    // como un pegado con el archivo adentro, y se mide si la página reaccionó.
    //
    // Mientras dura, la pestaña puede leer el portapapeles (ver _blindarSesion):
    // es lo que hace una persona al pegar, y hay sitios que leen la imagen así.
    // Lo que se mide va en el resultado —si la página tomó el evento, si pidió
    // leer el portapapeles, si corrió el pegado nativo— para que, si no anda,
    // se sepa en qué parte se cortó (en la ronda 7 de claude.ai no se sabía).
    // El pegado nativo entrega el archivo como "image.png": se mira ese nombre
    // también.
    if (k === 'Ctrl+V') {
      const png = await imagenPortapapeles();
      if (png) {
        this._lecturaPortapapeles = { hasta: Date.now() + 10000, pedido: false };
        // Y la pestaña tiene que creerse ENFOCADA: navigator.clipboard.read()
        // tira NotAllowedError si el documento no tiene el foco, antes de
        // preguntar el permiso — y mientras el agente trabaja, el foco está en
        // el chat de NeonCode, no en la página (medido en el banco de la ronda
        // 7). La emulación de foco de Chromium va por CDP, enganchado solo
        // para este pegado como en subir().
        const dbg = this.wc.debugger;
        let propio = false;
        try {
          if (!dbg.isAttached()) { dbg.attach('1.3'); propio = true; }
          await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        } catch { /* sin emulación: el pegado sintético y el nativo igual andan */ }
        let r;
        try {
          r = await this._pegarArchivos(ref, p?.frame, [{ name: 'pasted-image.png', type: 'image/png', buf: png }], true, ['image.png']);
        } finally {
          const leyo = !!this._lecturaPortapapeles?.pedido;
          this._lecturaPortapapeles = null;
          if (r) r.leyoPortapapeles = leyo;
          try { if (dbg.isAttached()) await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); } catch { /* ya se soltó */ }
          if (propio) { try { dbg.detach(); } catch { /* ya se soltó */ } }
        }
        if (!r.ok) return r;
        return { ok: true, tecla: k, imagen: true, porNativo: r.porNativo, tomado: r.tomado, destino: r.destino, reaccion: r.reaccion, leyoPortapapeles: r.leyoPortapapeles, nombre: p?.nombre || '', tapado: !!p?.tapado, quien: p?.quien || '' };
      }
    }

    if (EDICION[k]) {
      this.wc[EDICION[k]]();
      await this._asentar();
      return { ok: true, tecla: k, nombre: p?.nombre || '', tapado: !!p?.tapado, quien: p?.quien || '' };
    }

    const t = TECLAS[k];
    const mods = t.mods || [];
    this.wc.sendInputEvent({ type: 'keyDown', keyCode: t.k, modifiers: mods });
    if (t.char) this.wc.sendInputEvent({ type: 'char', keyCode: t.char, modifiers: mods });
    this.wc.sendInputEvent({ type: 'keyUp', keyCode: t.k, modifiers: mods });
    await this._asentar();
    await this.esperarCarga();
    return { ok: true, tecla: k, nombre: p?.nombre || '', tapado: !!p?.tapado, quien: p?.quien || '' };
  }

  // Subir archivos: el agente clickea el botón que abre el selector de archivos
  // ("Subir", el "+" de claude.ai, un <input type="file">) y en vez del diálogo
  // de Windows —que no puede manejar— los archivos entran directo.
  //
  // ACÁ SÍ VA CDP, y es la única excepción a lo que dice el encabezado del
  // archivo: no hay API pública de Electron para llenar un input de archivos.
  // Se acota todo lo posible: el debugger se engancha para ESTA subida y se
  // suelta al terminar (salvo que ya estuviera enganchado, en cuyo caso no es
  // nuestro y no se toca), y lo único que se usa es interceptar el selector y
  // ponerle los archivos. Que los archivos existan y sean del tamaño razonable
  // lo valida main.js antes de llegar acá; la tool es peligrosa y pide permiso.
  //
  // Por qué interceptar el selector en vez de buscar el <input>: en media web
  // el input está escondido y lo dispara un botón por script (claude.ai, Google
  // Drive, Moodle). Clickear el botón visible es lo que hace una persona, y el
  // selector que se abre trae exactamente el input que la página quería.
  // La huella de la página (ver scriptHuella) y cuánto cambió desde `antes`.
  async _huella(nombres) {
    try { return await evalFrame(this.wc.mainFrame, scriptHuella(nombres), 2000); } catch { return null; }
  }

  // ¿Se notó? Hasta `ms`: una miniatura llega cuando la página terminó de leer
  // el archivo, y un sitio que sube al servidor antes de mostrar nada tarda
  // más. Si en ese rato no apareció ni una imagen nueva ni el nombre del
  // archivo, el modelo tiene que saberlo para ir a mirar.
  async _reaccion(antes, nombres, ms = 4000) {
    if (!antes) return null;
    const previas = new Set(antes.imgs);
    const t0 = Date.now();
    let reaccion = null;
    for (;;) {
      const ahora = await this._huella(nombres);
      if (ahora) {
        reaccion = {
          imagenes: ahora.imgs.filter((s) => !previas.has(s)).length,
          nombres: nombres.filter((x) => (ahora.cuentas[x] || 0) > (antes.cuentas[x] || 0)),
          enInput: ahora.enInput.filter((x) => nombres.includes(x)),
        };
        if (reaccion.imagenes || reaccion.nombres.length) break;
      }
      if (Date.now() - t0 > ms) break;
      await this._asentar(400);
    }
    return reaccion;
  }

  // Pegar archivos como si vinieran del portapapeles (ver scriptPegarArchivos).
  // Si la página no tomó el evento y en 1,5 s no se vio nada, y `nativo` lo
  // permite, se prueba el paste del webContents: algún sitio puede leer el
  // portapapeles a su manera. Nunca los dos si el primero ya se notó: un
  // handler que no llama a preventDefault recibiría la imagen dos veces.
  //
  // `otros`: nombres que también prueban que entró (el pegado nativo de una
  // imagen la entrega como "image.png", no con el nombre que le pusimos).
  // El nativo espera más: un sitio que sube la imagen antes de mostrarla puede
  // tardar varios segundos en pintar la ficha.
  async _pegarArchivos(ref, frame, archivos, nativo, otros = []) {
    const nombres = [...archivos.map((a) => a.name), ...otros];
    const antes = await this._huella(nombres);
    let r;
    try {
      r = await evalFrame(frame || this.wc.mainFrame, scriptPegarArchivos(ref ? String(ref).trim() : '', archivos.map((a) => ({ name: a.name, type: a.type, b64: a.buf.toString('base64') }))), 15000);
    } catch (err) {
      return { ok: false, error: `could not paste into the page (${err?.message || err})` };
    }
    if (!r || r.error) return { ok: false, error: `${ref} is not on the page any more — the page changed, call browser_read again` };
    await this._asentar(300);
    let reaccion = await this._reaccion(antes, nombres, r.tomado ? 4000 : 1500);
    let porNativo = false;
    const seNoto = () => !!(reaccion && (reaccion.imagenes || reaccion.nombres.length));
    // La página pidió leer el portapapeles al recibir el pegado: lo está
    // tomando por ese lado. Se le da tiempo, y el nativo NO corre — sería la
    // misma imagen dos veces.
    if (!seNoto() && this._lecturaPortapapeles?.pedido) {
      reaccion = await this._reaccion(antes, nombres, 7000);
    } else if (!r.tomado && nativo && !seNoto()) {
      this.wc.paste();
      porNativo = true;
      await this._asentar(300);
      reaccion = await this._reaccion(antes, nombres, 7000);
    }
    return { ok: true, tomado: !!r.tomado, destino: r.destino, porNativo, reaccion };
  }

  async subir(ref, archivos) {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    const p = await this._punto(ref);
    if (!p.ok) return p;
    await this._marcarAccion();
    // Un CAMPO DE TEXTO no abre selector: ahí los archivos se pegan, como
    // haría una persona con Ctrl+V (claude.ai, Discord y compañía lo aceptan),
    // y sin tocar el portapapeles del usuario. Techo propio, más bajo que el de
    // la subida: acá los bytes viajan a la página como texto.
    if (p.editable && !p.archivo) {
      const fsp = require('node:fs/promises');
      const lista = [];
      let total = 0;
      for (const ruta of archivos) {
        const buf = await fsp.readFile(ruta);
        total += buf.length;
        if (total > PEGAR_MAX_BYTES) return { ok: false, error: `pasting into a text field takes up to ${PEGAR_MAX_BYTES / 1048576} MB in all — for bigger files use the site's upload button` };
        lista.push({ name: path.basename(ruta), type: mimeDe(ruta), buf });
      }
      const r = await this._pegarArchivos(ref, p.frame, lista, false);
      if (!r.ok) return r;
      return { ok: true, nombre: p.nombre, subidos: archivos, sobran: 0, pegado: true, tomado: r.tomado, reaccion: r.reaccion, tapado: p.tapado, quien: p.quien };
    }
    const dbg = this.wc.debugger;
    let propio = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); propio = true; }
    } catch (err) {
      return { ok: false, error: `could not reach the page to upload (${err?.message || err})` };
    }
    let oyente = null;
    const antes = await this._huella(archivos.map((a) => path.basename(a)));
    try {
      await dbg.sendCommand('Page.enable');
      await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      const abierto = new Promise((res) => {
        const t = setTimeout(() => res(null), 4000);
        oyente = (_e, metodo, params) => {
          if (metodo !== 'Page.fileChooserOpened') return;
          clearTimeout(t);
          res(params);
        };
        dbg.on('message', oyente);
      });
      this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
      this.wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      this.wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      const sel = await abierto;
      if (!sel || !sel.backendNodeId) {
        return { ok: false, error: `clicking ${ref}${p.nombre ? ` (${JSON.stringify(p.nombre)})` : ''} did not open a file picker — use the button or field that opens it (an "Upload"/"Attach" item, sometimes inside a menu you open first), or pass the ref of the message's text field to paste the files there` };
      }
      const uno = sel.mode === 'selectSingle';
      const lista = uno ? archivos.slice(0, 1) : archivos;
      await dbg.sendCommand('DOM.setFileInputFiles', { files: lista, backendNodeId: sel.backendNodeId });
      await this._asentar(500);
      const reaccion = await this._reaccion(antes, lista.map((a) => path.basename(a)));
      return { ok: true, nombre: p.nombre, subidos: lista, sobran: archivos.length - lista.length, tapado: p.tapado, quien: p.quien, reaccion };
    } catch (err) {
      return { ok: false, error: `the upload failed (${err?.message || err})` };
    } finally {
      if (oyente) { try { dbg.removeListener('message', oyente); } catch { /* */ } }
      try { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }); } catch { /* ya se soltó */ }
      if (propio) { try { dbg.detach(); } catch { /* ya se soltó */ } }
    }
  }

  // Espera a que un texto aparezca en la página, en cualquier frame, con techo.
  // Es el `wait_for` de browser_read: una SPA termina de "cargar" y el contenido
  // llega después por fetch, así que did-stop-loading no alcanza.
  //
  // Lo que cuenta es que aparezca algo NUEVO: se cuentan las apariciones al
  // arrancar y se espera a que crezcan. Si el texto ya estaba (en un menú, en el
  // título de la bandeja, en un mensaje viejo) se espera un ratito por si llega
  // otra, y si no, se devuelve `ya: true` para que el modelo sepa que el
  // match no prueba nada. Antes volvía "encontrado" al instante por una palabra
  // del menú lateral (reporte de Neo, 2/11/2026).
  async esperarTexto(texto, ms = 10000) {
    if (!this.wc) return { ok: false, error: 'the browser panel is not open' };
    const q = String(texto || '').trim();
    if (!q) return { ok: true, encontrado: true, ms: 0 };
    await this.esperarCarga();
    const contar = async (fase) => {
      let frames = [];
      try { frames = await this._arbolFrames(); } catch { frames = []; }
      let n = 0, nuevos = 0, desdeAccion = 0;
      for (const f of frames) {
        if (!f.medido) continue;
        try {
          const r = await evalFrame(f.frame, scriptCuenta(q, fase), 2000);
          n += Number(r && r.n) || 0;
          nuevos += Number(r && r.nuevos) || 0;
          desdeAccion += Number(r && r.desdeAccion) || 0;
        } catch { /* frame muerto */ }
      }
      return { n, nuevos, desdeAccion };
    };
    const t0 = Date.now();
    const ini = await contar('inicio');
    const inicial = ini.n;
    if (ini.desdeAccion > 0) return { ok: true, encontrado: true, desdeAccion: true, ms: Date.now() - t0 };
    if (inicial > 0 && this._sinLeer && this._sinLeer.has(this.wc)) return { ok: true, encontrado: true, fresca: true, ms: Date.now() - t0 };
    // Ya estaba: se espera igual el tiempo entero a que aparezca uno NUEVO.
    // Antes se cortaba a los 1,5 s, y en un chat eso rompía el caso más común:
    // cada respuesta vieja de claude.ai ya tiene su "Copiar", así que esperar
    // el "Copiar" de la respuesta que se está escribiendo volvía "ya estaba"
    // mucho antes de que terminara (ronda 7 de Neo). Si no llega ninguno, la
    // respuesta sigue diciendo que el match no prueba nada.
    const techo = ms;
    for (;;) {
      if (Date.now() - t0 >= techo) {
        return inicial > 0
          ? { ok: true, encontrado: true, ya: true, ms: Date.now() - t0 }
          : { ok: true, encontrado: false, ms: Date.now() - t0 };
      }
      await new Promise((r) => setTimeout(r, 250));
      // Más que al principio, o la misma cantidad pero en un nodo que no
      // estaba (o que se mudó): las dos cosas son "llegó uno nuevo".
      const ahora = await contar('mirar');
      if (ahora.n > inicial || (inicial > 0 && ahora.nuevos > 0)) return { ok: true, encontrado: true, habia: inicial, movido: ahora.n <= inicial, ms: Date.now() - t0 };
    }
  }

  // La foto de la página para wait_for (ver scriptMarcaAccion), en todos los
  // frames. Si falla no pasa nada: wait_for compara contra su arranque.
  async _marcarAccion() {
    let frames = [];
    try { frames = await this._arbolFrames(); } catch { return; }
    for (const f of frames) {
      if (!f.medido) continue;
      try { await evalFrame(f.frame, scriptMarcaAccion, 1500); } catch { /* frame muerto */ }
    }
  }

  // Espera a que el DOM del frame principal se calme (ver scriptQuieto).
  // Devuelve cuánto esperó, o null si la página no contestó.
  async _quieto(quieto = 300, techo = 2000) {
    if (!this.wc) return null;
    try { return await evalFrame(this.wc.mainFrame, scriptQuieto(quieto, techo), techo + 1500); } catch { return null; }
  }

  // La foto de la pestaña activa como imagen nativa, para el modelo (main.js la
  // escala y la pega al tool_result, el mismo carril que screen_capture). La
  // primera capturePage de una view puede salir vacía: se reintenta (aprendido
  // en Prism).
  async imagen() {
    if (!this.wc) return null;
    for (let i = 0; i < 3; i++) {
      try {
        const img = await this.wc.capturePage();
        if (!img.isEmpty()) return img;
      } catch { /* se reintenta */ }
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  }

  // Resuelve un ref a un punto clickeable, o explica por qué no se puede. Los
  // cuatro motivos son distintos y el agente tiene que poder distinguirlos: uno
  // se arregla releyendo, otro scrolleando, otro cerrando lo que tapa.
  async _punto(ref) {
    const r = String(ref || '').trim();
    if (!/^ref_\d+$/.test(r)) return { ok: false, error: `'${ref}' is not a reference — use a ref_N from browser_read` };
    await this.esperarCarga();

    // Se busca en TODOS los frames y no en un mapa guardado de la última
    // lectura. Un mapa se desincroniza —el frame se recarga, el ref queda
    // apuntando a un id que ya no existe— y para saber que se desincronizó hay
    // que ir a mirar igual. Buscar es una consulta por frame, y los frames de
    // una página se cuentan con los dedos.
    let frames;
    try { frames = await this._arbolFrames(); } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }

    let visto = null; // el mejor hallazgo: uno "gone" no descarta a los demás
    for (const f of frames) {
      if (!f.medido) continue;
      let p;
      try { p = await evalFrame(f.frame, scriptPunto(r)); } catch { continue; }
      if (!p || p.error === 'gone') continue;
      if (p.error) { visto = visto || p; continue; }
      const principal = f.frame === this.wc.mainFrame;
      // Las coordenadas salen del viewport del frame; el evento se manda a la
      // pestaña. La suma es lo que hace que un click adentro de un iframe
      // aterrice donde tiene que aterrizar.
      const x = p.x + f.dx;
      const y = p.y + f.dy;
      // El `scrollIntoView` de adentro trae el elemento a la vista DE SU FRAME,
      // y eso no dice nada de si el frame está a la vista en la página. Un
      // iframe scrolleado fuera de pantalla deja un punto que existe en su
      // sistema de coordenadas y no en el de la pestaña: `sendInputEvent` ahí no
      // hace nada y el click se reporta como exitoso sin haber pasado.
      if (!principal && this.bounds && (x < 0 || y < 0 || x > this.bounds.width || y > this.bounds.height)) {
        visto = visto || { error: 'offscreen' };
        continue;
      }
      return { ok: true, ...p, x, y, frame: principal ? null : f.frame };
    }

    if (visto?.error === 'invisible') return { ok: false, error: `${r} is on the page but has no visible box (hidden or collapsed)` };
    if (visto?.error === 'offscreen') return { ok: false, error: `${r} could not be scrolled into view` };
    return { ok: false, error: `${r} is not on the page any more — the page changed, call browser_read again` };
  }

  // Una captura de lo que se ve, como PNG en data URL, para el USUARIO: el botón
  // de la barra la mete en el composer como adjunto, el mismo carril de un
  // Ctrl+V. La del MODELO es otra (`imagen`, arriba): desde la 1.1.0 un
  // tool_result puede llevar imágenes (run._capturas), y `browser_read
  // { screenshot: true }` la pega ahí.
  async capture() {
    if (!this.wc) return null;
    try {
      const img = await this.wc.capturePage();
      if (img.isEmpty()) return null;
      return `data:image/png;base64,${img.toPNG().toString('base64')}`;
    } catch {
      return null;
    }
  }

  // La MISMA foto, pero para taparse a sí misma. Cuando la app abre algo encima
  // (Settings, la biblioteca, la tarjeta de permiso) la capa se apaga, porque no
  // hay z-index que la pase — y ahí la página desaparecía de golpe y volvía de
  // golpe al cerrar. Con esto el renderer pone la foto en el hueco ANTES de
  // apagarla: lo que se ve sigue siendo la página, el velo la oscurece como
  // oscurece al resto de la app, y no hay ningún salto.
  //
  // JPEG y no PNG, que es toda la diferencia entre que sirva y no: es un fondo
  // congelado detrás de un velo y nadie le va a mirar los bordes. Medido sobre el
  // hueco real (506×765): capturar 5-14ms, y de ahí PNG 30ms / 109KB contra JPEG
  // 2ms / 68KB. Diez milisegundos de punta a punta entran enteros en un frame, y
  // eso es lo que hace que el cambio no se vea — con PNG el modal ya se estaría
  // abriendo con la página encima.
  async freeze() {
    if (!this.wc) return null;
    try {
      const img = await this.wc.capturePage();
      if (img.isEmpty()) return null;
      return `data:image/jpeg;base64,${img.toJPEG(80).toString('base64')}`;
    } catch {
      return null;
    }
  }

  // Cerrar de verdad: se usa al cerrar la app. El panel que se cierra NO llama a
  // esto — misma decisión que la terminal, y por el mismo motivo: cerrar la
  // vista de algo no es matarlo, y volver a abrir tiene que encontrar la página
  // donde estaba. La sesión persiste igual (está en disco), pero el scroll, el
  // formulario a medio llenar y el historial de la pestaña no.
  destroy() {
    if (!this.alive) return;
    const tabs = this.tabs;
    this.tabs = [];
    this.activa = null;
    this.visible = false;
    this.panelAbierto = false;
    this.last = { url: '', title: '', loading: false };
    for (const t of tabs) this._cerrarView(t);
    // Que las cookies recién vueltas persistentes lleguen al disco antes de
    // salir: Chromium las baja cada tanto, no en el acto.
    try { this._ses?.cookies.flushStore().catch(() => {}); } catch { /* ya se fue */ }
  }
}

module.exports = { AgentBrowser, urlValida, destinoBarra, uaComoChrome, normalizarTecla, TECLAS_VALIDAS, PARTITION, HOME, MAX_TABS, READ_CHAR_BUDGET, READ_MAX_ELEMENTS, EVAL_TECHO_MS };
