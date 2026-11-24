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
// Comparte el hueco de la escena con el canvas: uno solo abierto a la vez.

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
  const panel = h('aside', 'dm-nav', { 'aria-label': 'Browser', 'aria-hidden': 'true' },
    h('div', 'dm-nav-tira', { 'data-rad-chrome': '' }, tabs, bNueva, h('span', 'dm-nav-aire'), bCerrar),
    h('div', 'dm-nav-barra', { 'data-rad-chrome': '' }, bAtras, bAdelante, bRecargar, barraUrl, bEstrella, bFavoritos, bAfuera),
    hueco);
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
    const r = hueco.getBoundingClientRect();
    if (!abierto() || r.width < 2) return false;
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
  window.addEventListener('resize', () => requestAnimationFrame(() => { if (abierto()) mandarBounds(); }));
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
