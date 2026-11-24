// El navegador: un panel al lado de la conversación con un navegador de
// verdad adentro. Es la MISMA pestaña la que usa el usuario a mano y la que
// maneja el agente con sus tools (browser_*): lo que uno abre lo ve el otro.
//
// Es el navegador de NeonCode. Del lado main vino portado tal cual
// (main/tools/navegador.cjs y browser/agent-browser.cjs); este panel se
// reescribió sobre Rad con sus reglas, que salen todas de una misma cosa: LA
// PÁGINA NO ES DOM. Es una capa nativa que el proceso principal pinta encima
// de la ventana, sobre el hueco que este panel le deja. Por eso:
//   - el panel le manda al main dónde está el hueco, y se lo vuelve a mandar
//     cada vez que cambia (tamaño de la ventana, abrir, cerrar);
//   - la capa se prende recién cuando el panel TERMINÓ de entrar: antes
//     aparecería de golpe en su lugar final mientras el panel todavía llega;
//   - la capa tapa todo lo que la app ponga encima (un menú, un modal, la
//     tarjeta de permiso de una tool, un aviso). Cuando algo de eso cae sobre
//     el hueco hay un «eclipse»: la capa se apaga y en su lugar queda una foto
//     de la página. Sin esto, la tarjeta de permiso quedaba tapada y el turno
//     colgado;
//   - con otra vista de la app al frente (Agents, Settings) la capa se apaga.
// Comparte el hueco de la escena con el canvas y la terminal: uno solo abierto
// a la vez. Es el único de los tres que se puede ESTIRAR (la manija de su
// borde izquierdo): adentro hay una página ajena con su propio layout, y en el
// ancho de la casa media web se va al modo teléfono. Lo que crece no empuja a
// la conversación: la tapa.

import { menuButton } from '/@core/menu.js';
import { reconcile } from '/@core/list.js';
import { toast } from '/@core/toast.js';
import { ms } from '/@core/motion.js';
import { h, icono } from './piezas.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);
const sinPagina = (url) => !url || url === 'about:blank';
// Lo que se muestra en la barra: la dirección sin el protocolo de siempre.
const paraLaBarra = (url) => (sinPagina(url) ? '' : String(url).replace(/^https:\/\//, ''));
const hostDe = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
// http a un host que no es esta máquina: sin candado.
const inseguro = (url) => { try { const u = new URL(url); return u.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(u.host); } catch { return false; } };

/**
 * Arma el navegador adentro de la vista de chat.
 *   escena   el contenedor de la conversación y el panel
 *   turnos   { pedir(quien) }: cierra el otro panel antes de abrir este
 *   router   para saber si la vista de chat está al frente
 * Devuelve { panel, boton, abierto(), abrir(), cerrar() }.
 */
export function montarNavegador({ escena, turnos, router }) {
  let estado = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, tabs: [], maxTabs: 4 };
  let favoritos = [];
  let capa = false;       // lo último que se le pidió al main
  let eclipsado = false;
  let enChat = router.current === 'chat';
  let listo = false;      // el panel ya terminó de entrar

  // ---------- El panel ----------
  const boton = h('button', 'rad-iconbutton dm-nav-boton', { type: 'button', 'data-accion': 'navegador', 'aria-label': 'Browser', 'aria-pressed': 'false', 'data-rad-tip': 'Browser', 'data-rad-tip-key': 'Ctrl+B', 'data-rad-tip-side': 'bottom' }, icono('globo'));
  // Los rótulos de la barra salen hacia ARRIBA: hacia abajo caerían sobre la
  // página y cada uno apagaría la capa.
  const ib = (accion, nombre, etiqueta, extra = {}) => h('button', 'rad-iconbutton', { type: 'button', 'data-accion': accion, 'aria-label': etiqueta, 'data-rad-tip': etiqueta, 'data-rad-tip-side': 'top', ...extra }, icono(nombre));
  const tabs = h('div', 'dm-nav-tabs', { role: 'tablist' });
  const bNueva = ib('nav-nueva', 'mas', 'New tab');
  const bCerrar = ib('nav-cerrar', 'cerrar', 'Close the browser');
  const bAtras = ib('nav-atras', 'atras', 'Back');
  const bAdelante = ib('nav-adelante', 'adelante', 'Forward');
  const bRecargar = h('button', 'rad-iconbutton dm-nav-recargar', { type: 'button', 'data-accion': 'nav-recargar', 'aria-label': 'Reload', 'data-rad-tip': 'Reload', 'data-rad-tip-side': 'top' }, icono('recargar', 'dm-nav-ic-recargar'), icono('cerrar', 'dm-nav-ic-parar'));
  const candado = icono('candado', 'dm-nav-candado');
  const url = h('input', 'dm-nav-url', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address', placeholder: 'Search or type an address' });
  const barraUrl = h('form', 'dm-nav-direccion', {}, candado, url);
  const bEstrella = ib('nav-estrella', 'estrella', 'Bookmark this page', { 'aria-pressed': 'false' });
  const bFavoritos = ib('nav-favoritos', 'marcadores', 'Bookmarks');
  const bAfuera = ib('nav-afuera', 'externo', 'Open in your browser');
  const foto = h('img', 'dm-nav-foto', { alt: '', 'aria-hidden': 'true' });
  const vacio = h('p', 'dm-nav-vacio', {}, 'Type an address above, or ask an agent with the Browser tools to open a page. You and the agent share this tab.');
  const hueco = h('div', 'dm-nav-hueco', {}, vacio, foto);
  // La manija: un separador que se arrastra, y que también se maneja con las
  // flechas. Su rótulo sale arriba, sobre las barras: lejos de la página.
  const manija = h('div', 'dm-nav-manija', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the browser', tabindex: '0', 'data-rad-tip': 'Drag to resize', 'data-rad-tip-side': 'top' }, h('span'));
  // Cuánto mide el panel en el ancho de la casa: un testigo invisible con la
  // misma cuenta del CSS, para no repetir acá el 52 % ni los topes.
  const casaEl = h('div', 'dm-nav-casa', { 'aria-hidden': 'true' });
  escena.append(casaEl);
  const panel = h('aside', 'dm-nav', { 'aria-label': 'Browser', 'aria-hidden': 'true' },
    h('div', 'dm-nav-tira', { 'data-rad-chrome': '' }, tabs, bNueva, h('span', 'dm-nav-aire'), bCerrar),
    h('div', 'dm-nav-barra', { 'data-rad-chrome': '' }, bAtras, bAdelante, bRecargar, barraUrl, bEstrella, bFavoritos, bAfuera),
    hueco, manija);
  panel.inert = true;

  const abierto = () => panel.hasAttribute('data-abierto');

  // ---------- La capa nativa ----------
  function mandarBounds() {
    const r = hueco.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    pedir('browser:bounds', { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  }
  // ¿Se tiene que ver la página ahora? Solo con el panel abierto y asentado,
  // la vista de chat al frente, una página cargada y nada de la app encima.
  function aplicarCapa() {
    const quiere = abierto() && listo && enChat && !eclipsado && !sinPagina(estado.url);
    if (quiere === capa) return;
    capa = quiere;
    if (quiere) mandarBounds();
    pedir('browser:visible', quiere);
  }

  // El eclipse: algo de la app (lo que vive en .rad-overlays) cae sobre el hueco.
  let turnoEclipse = 0;
  function tapado() {
    // (con el panel cerrado no se mide nada: medir obliga a maquetar, y esto
    // corre con cada rótulo y cada menú de la app)
    if (!abierto()) return false;
    const r = hueco.getBoundingClientRect();
    if (r.width < 2) return false;
    const capas = document.querySelector('.rad-overlays');
    if (!capas) return false;
    for (const nodo of capas.querySelectorAll(':scope > *, :scope > * > *')) {
      const o = nodo.getBoundingClientRect();
      if (o.width < 1 || o.height < 1) continue;
      if (o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top) return true;
    }
    return false;
  }
  async function revisarEclipse() {
    const ahora = tapado();
    if (ahora === eclipsado) return;
    const turno = ++turnoEclipse;
    if (ahora) {
      // primero la foto, después se apaga la capa: así no hay un cuadro vacío
      if (capa) {
        const jpeg = await pedir('browser:freeze').catch(() => null);
        if (turno !== turnoEclipse) return;
        if (jpeg) { foto.src = jpeg; hueco.setAttribute('data-foto', ''); }
      }
      eclipsado = true;
      aplicarCapa();
    } else {
      eclipsado = false;
      aplicarCapa();
      // la foto se va cuando la capa ya volvió a pintarse encima
      setTimeout(() => { if (turno === turnoEclipse && !eclipsado) hueco.removeAttribute('data-foto'); }, 140);
    }
  }
  const capas = document.querySelector('.rad-overlays') ?? document.body;
  new MutationObserver(() => { revisarEclipse(); setTimeout(revisarEclipse, ms('dur-base') + 60); }).observe(capas, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'data-rad-leaving'] });
  new ResizeObserver(() => { if (abierto()) { mandarBounds(); revisarEclipse(); } }).observe(hueco);
  window.addEventListener('resize', () => requestAnimationFrame(() => { reencajar(); if (abierto()) mandarBounds(); }));

  // ---------- Estirarlo ----------
  // El ancho arrastrado dura la sesión (cerrar y reabrir el panel lo conserva;
  // reiniciar la app vuelve al de la casa). El piso es el ancho de la casa: la
  // manija es para agrandar. El techo deja un pedazo de conversación a la
  // vista, para que se note que sigue ahí abajo. Viene de NeonCode, con sus
  // números.
  const CHAT_A_LA_VISTA = 120;
  const PASO_TECLA = 32;
  let ancho = 0; // 0 = el de la casa
  const casa = () => casaEl.getBoundingClientRect().width;
  // (el margen derecho del panel también cuenta: es lo que separa al testigo del borde de la escena)
  const techo = () => {
    const e = escena.getBoundingClientRect();
    const margen = e.right - casaEl.getBoundingClientRect().right;
    return Math.max(casa(), Math.round(e.width - CHAT_A_LA_VISTA - margen));
  };
  const anchoAhora = () => (ancho || casa());
  function ponerAncho(w) {
    const piso = casa();
    const justo = Math.min(techo(), Math.max(piso, Math.round(w)));
    // en el piso vuelve a ser «el de la casa», que sigue a la ventana
    ancho = justo <= piso + 0.5 ? 0 : justo;
    if (ancho) panel.style.setProperty('--dm-nav-w', `${ancho}px`);
    else panel.style.removeProperty('--dm-nav-w');
    panel.toggleAttribute('data-estirado', ancho > 0);
    manija.setAttribute('aria-valuenow', String(Math.round(anchoAhora())));
    mandarBounds();
  }
  // La ventana cambió de tamaño: el ancho arrastrado se vuelve a encajar entre
  // el piso y el techo, que cambiaron con ella.
  function reencajar() { if (ancho) ponerAncho(ancho); }
  new ResizeObserver(reencajar).observe(escena);

  // Volver al ancho de la casa (doble clic, Home). Va cuadro por cuadro por el
  // mismo camino que el arrastre, para que la página lo acompañe. Con la
  // ventana tapada no hay cuadros: el plazo lo deja en su lugar igual.
  let vuelta = null;
  function cortarVuelta() { if (vuelta) { cancelAnimationFrame(vuelta.raf); clearTimeout(vuelta.plazo); vuelta = null; } }
  function volver() {
    cortarVuelta();
    if (!ancho) return;
    const desde = ancho;
    const hasta = casa();
    const dura = ms('dur-base');
    const t0 = performance.now();
    const fin = () => { cortarVuelta(); ponerAncho(0); };
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dura);
      if (k >= 1) { fin(); return; }
      // (el +1 es para que no caiga al piso, y deje de estar estirado, antes de llegar)
      ponerAncho(desde + (hasta - desde) * (1 - (1 - k) ** 3) + 1);
      vuelta.raf = requestAnimationFrame(paso);
    };
    vuelta = { raf: requestAnimationFrame(paso), plazo: setTimeout(fin, dura + 120) };
  }

  manija.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cortarVuelta();
    // Con el puntero capturado, los movimientos siguen llegando acá aunque el
    // mouse se vaya de la manija (y se va enseguida).
    try { manija.setPointerCapture(e.pointerId); } catch { /* un puntero que no es de verdad (el humo) */ }
    document.documentElement.classList.add('dm-estirando');
    const x0 = e.clientX;
    const w0 = panel.getBoundingClientRect().width;
    let ultimo = w0;
    // Un pointermove no es un cuadro: un mouse manda varios por cada uno que se
    // pinta. Se guarda el último y se aplica uno por cuadro.
    let pendiente = 0;
    const aplicar = () => { pendiente = 0; ponerAncho(ultimo); };
    // hacia la izquierda es MÁS ancho: el panel crece contra la conversación
    const mover = (ev) => { ultimo = w0 + (x0 - ev.clientX); if (!pendiente) pendiente = requestAnimationFrame(aplicar); };
    const soltar = () => {
      if (pendiente) { cancelAnimationFrame(pendiente); pendiente = 0; }
      manija.removeEventListener('pointermove', mover);
      manija.removeEventListener('pointerup', soltar);
      manija.removeEventListener('pointercancel', soltar);
      document.documentElement.classList.remove('dm-estirando');
      ponerAncho(ultimo);
      try { manija.releasePointerCapture(e.pointerId); } catch { /* ya se soltó */ }
    };
    manija.addEventListener('pointermove', mover);
    manija.addEventListener('pointerup', soltar);
    // (el sistema se llevó el puntero: Alt+Tab con el botón apretado)
    manija.addEventListener('pointercancel', soltar);
  });
  manija.addEventListener('dblclick', volver);
  manija.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); cortarVuelta(); ponerAncho(anchoAhora() + PASO_TECLA); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); cortarVuelta(); ponerAncho(anchoAhora() - PASO_TECLA); }
    else if (e.key === 'Home') { e.preventDefault(); volver(); }
  });

  router.on('change', ({ id }) => { enChat = id === 'chat'; aplicarCapa(); });

  // ---------- Pintar ----------
  function ponerTab(nodo, t) {
    const nombre = nodo.querySelector('.dm-nav-tab-nombre');
    const texto = t.title || hostDe(t.url) || 'New tab';
    if (nombre.textContent !== texto) nombre.textContent = texto;
    nodo.setAttribute('aria-selected', String(Boolean(t.active)));
    nodo.toggleAttribute('data-cargando', Boolean(t.loading));
  }
  function pintar(st) {
    if (!st || st.open === false) return;
    estado = { ...estado, ...st };
    const lista = Array.isArray(estado.tabs) ? estado.tabs : [];
    reconcile(tabs, lista, {
      key: (t) => t.id,
      create: (t) => {
        const cerrarla = h('span', 'dm-nav-tab-x', { role: 'button', 'aria-label': 'Close tab' }, icono('cerrar'));
        const nodo = h('button', 'dm-nav-tab', { type: 'button', role: 'tab' }, h('span', 'dm-nav-tab-nombre'), cerrarla);
        const id = () => nodo.dataset.radKey ?? String(t.id);
        nodo.addEventListener('click', async (e) => {
          const st2 = await pedir(e.target.closest('.dm-nav-tab-x') ? 'browser:tab-close' : 'browser:tab-go', id());
          pintar(st2);
        });
        // el botón del medio cierra, como en cualquier navegador
        nodo.addEventListener('auxclick', async (e) => { if (e.button === 1) pintar(await pedir('browser:tab-close', id())); });
        ponerTab(nodo, t);
        return nodo;
      },
      update: ponerTab,
    });
    bNueva.disabled = lista.length >= (estado.maxTabs ?? 4);
    bAtras.disabled = !estado.canGoBack;
    bAdelante.disabled = !estado.canGoForward;
    bRecargar.toggleAttribute('data-cargando', Boolean(estado.loading));
    bRecargar.setAttribute('aria-label', estado.loading ? 'Stop' : 'Reload');
    bRecargar.setAttribute('data-rad-tip', estado.loading ? 'Stop' : 'Reload');
    // lo que el usuario está escribiendo en la barra no se le pisa
    if (document.activeElement !== url) url.value = paraLaBarra(estado.url);
    barraUrl.toggleAttribute('data-inseguro', inseguro(estado.url));
    barraUrl.toggleAttribute('data-con-pagina', !sinPagina(estado.url));
    hueco.toggleAttribute('data-vacio', sinPagina(estado.url));
    bAfuera.disabled = sinPagina(estado.url);
    bEstrella.disabled = sinPagina(estado.url);
    const es = favoritos.some((f) => f.url === estado.url);
    bEstrella.setAttribute('aria-pressed', String(es));
    bEstrella.setAttribute('data-rad-tip', es ? 'Remove bookmark' : 'Bookmark this page');
    aplicarCapa();
  }
  async function cargarFavoritos() {
    const lista = await pedir('browser:fav-list').catch(() => []);
    favoritos = Array.isArray(lista) ? lista : [];
    pintar(estado);
  }

  // ---------- Abrir y cerrar ----------
  let cerrando = null;
  async function abrir() {
    if (abierto()) return true;
    turnos.pedir('browser');
    clearTimeout(cerrando);
    escena.setAttribute('data-panel', 'browser');
    panel.setAttribute('data-abierto', '');
    panel.removeAttribute('aria-hidden');
    panel.inert = false;
    boton.setAttribute('aria-pressed', 'true');
    listo = false;
    const st = await pedir('browser:attach').catch((err) => ({ open: false, error: String(err?.message || err) }));
    if (st?.open === false) {
      toast({ text: `The browser could not start: ${st.error ?? 'unknown error'}`, kind: 'danger' });
      cerrar();
      return false;
    }
    pintar(st);
    cargarFavoritos();
    mandarBounds();
    await pedir('browser:panel', true);
    // La capa aparece cuando el panel terminó de entrar. Con un temporizador
    // y no con el fin de la transición: con la ventana tapada no hay cuadros.
    setTimeout(() => {
      if (!abierto()) return;
      listo = true;
      mandarBounds();
      revisarEclipse();
      aplicarCapa();
    }, ms('dur-base') + 40);
    return true;
  }
  function cerrar() {
    if (!abierto()) return;
    listo = false;
    capa = false;
    pedir('browser:panel', false); // también apaga la capa
    panel.removeAttribute('data-abierto');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    boton.setAttribute('aria-pressed', 'false');
    hueco.removeAttribute('data-foto');
    clearTimeout(cerrando);
    cerrando = setTimeout(() => {
      if (!abierto() && escena.getAttribute('data-panel') === 'browser') escena.removeAttribute('data-panel');
    }, ms('dur-base') + 40);
  }

  // ---------- Los controles ----------
  boton.addEventListener('click', () => (abierto() ? cerrar() : abrir()));
  bCerrar.addEventListener('click', cerrar);
  bNueva.addEventListener('click', async () => { pintar(await pedir('browser:tab-new')); url.focus(); });
  bAtras.addEventListener('click', () => pedir('browser:back'));
  bAdelante.addEventListener('click', () => pedir('browser:forward'));
  bRecargar.addEventListener('click', () => pedir(estado.loading ? 'browser:stop' : 'browser:reload'));
  bAfuera.addEventListener('click', () => pedir('browser:external'));
  barraUrl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = url.value.trim();
    if (!texto) return;
    const r = await pedir('browser:navigate', texto);
    if (r?.ok === false) toast({ text: `Could not open that: ${r.error ?? 'not a valid address'}`, kind: 'danger' });
    else url.blur();
  });
  url.addEventListener('focus', () => { url.value = sinPagina(estado.url) ? '' : estado.url; url.select(); });
  url.addEventListener('blur', () => { url.value = paraLaBarra(estado.url); });
  url.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); url.blur(); } });
  bEstrella.addEventListener('click', async () => {
    const r = await pedir('browser:fav-toggle', { url: estado.url, title: estado.title });
    if (r?.ok === false) { toast({ text: `Could not save the bookmark: ${r.error ?? 'unknown error'}`, kind: 'danger' }); return; }
    favoritos = Array.isArray(r?.favoritos) ? r.favoritos : favoritos;
    pintar(estado);
  });
  menuButton(bFavoritos, () => (favoritos.length
    ? favoritos.map((f) => ({ id: f.url, label: (f.title || hostDe(f.url) || f.url).slice(0, 60), onSelect: async () => { const r = await pedir('browser:fav-open', f.url); if (r?.ok === false) toast({ text: `Could not open that bookmark: ${r.error ?? ''}`, kind: 'danger' }); } }))
    : [{ id: 'nada', label: 'No bookmarks yet', disabled: true }]), { align: 'end' });

  // Ctrl+B abre y cierra, desde la app y desde adentro de la página (ahí las
  // teclas no llegan al DOM: las reenvía el main).
  const esAtajo = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'b';
  document.addEventListener('keydown', (e) => { if (esAtajo(e) && enChat) { e.preventDefault(); if (abierto()) cerrar(); else abrir(); } });
  window.rad.on('browser:atajo', (e) => { if (e && esAtajo(e)) cerrar(); });
  window.rad.on('browser:state', pintar);
  // Una tool del navegador lo necesita abierto: lo abre el agente.
  window.rad.on('browser:open', () => { abrir(); });

  return { panel, boton, abierto, abrir, cerrar };
}
