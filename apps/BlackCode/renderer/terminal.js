// La terminal: un panel al lado de la conversación con una shell de verdad
// (PowerShell 7 con el profile del usuario), para teclear sin salir de la app.
// Es del USUARIO: ninguna tool del agente llega a ella (ver main/terminal.cjs).
//
// Es la terminal de NeonCode. El lado main vino portado; este panel se
// reescribió sobre Rad. Comparte el hueco de la escena con el canvas y el
// navegador: uno solo abierto a la vez.
//   - La shell arranca la primera vez que se abre el panel, no con la app.
//   - Cerrar el panel NO la mata: cerrar la vista de algo que está corriendo no
//     es matarlo, y volver a abrir tiene que encontrar lo que quedó. Se muere
//     con la app o con el botón de reiniciar.
//   - El cursor es un bloque, del blanco de la app: el de NTX (1.8.1), con
//     aureola y del alto de la letra con foco, y apagado sin foco. Lo dibuja
//     el CSS (blackcode.css, «El cursor, como el de NTX»).
//
// xterm (renderer/vendor/xterm) se carga recién al abrir el panel por primera
// vez. Viaja adaptado a la CSP de la app: ver scripts/vendor-xterm.mjs.

import { toast } from '/@core/toast.js';
import { swapText, ms } from '/@core/motion.js';
import { h, icono } from './piezas.js';

const pedir = (canal, ...args) => window.rad.invoke(canal, ...args);

// <dm-estilo>: el lugar de los <style> que xterm llena a mano. La CSP de la
// app no deja pasar un <style> en línea; esto vuelca el mismo texto en una
// hoja construida, que es estilo puesto desde el código y sí pasa. xterm le
// escribe por textContent, igual que a un <style>, y no se entera.
class Estilo extends HTMLElement {
  #hoja = null;

  #volcar() {
    if (!this.#hoja) return;
    try { this.#hoja.replaceSync(super.textContent ?? ''); } catch { /* una regla que no se pudo leer: queda la hoja anterior */ }
  }

  get textContent() { return super.textContent; }

  set textContent(texto) {
    super.textContent = texto;
    this.#volcar();
  }

  connectedCallback() {
    this.hidden = true;
    this.#hoja = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#hoja];
    this.#volcar();
  }

  disconnectedCallback() {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((hoja) => hoja !== this.#hoja);
    this.#hoja = null;
  }
}
if (!customElements.get('dm-estilo')) customElements.define('dm-estilo', Estilo);

// El tamaño de la letra (Fran eligió 11, nov 2026): a 13 el panel, de 560 px
// como mucho, daba unas 56 columnas y la tabla de un `ls` de PowerShell partía
// los nombres letra por letra; a 11 entran unas 13 columnas más.
const TAMANO = 11;
const NOMBRES = { pwsh: 'PowerShell 7', powershell: 'Windows PowerShell 5.1', cmd: 'cmd', sh: 'sh' };

// La paleta. Un tema de xterm son colores en un objeto, no CSS, así que se
// leen los tokens de la piel una vez. El cursor es el blanco de la app, y la
// letra que queda debajo del bloque se pinta con el fondo. Los de estado
// (rojo, verde, amarillo) son los de la piel; el azul, el magenta y el cian
// no existen en el contrato y van fijos, apagados para que no griten al lado.
function tema() {
  const css = getComputedStyle(document.documentElement);
  const t = (nombre, si) => css.getPropertyValue(`--rad-${nombre}`).trim() || si;
  const blanco = t('text-1', '#f0f0f0');
  const fondo = t('surface-0', '#0a0a0a');
  return {
    background: 'rgba(0, 0, 0, 0)', // lo pinta el panel
    foreground: blanco,
    cursor: blanco,
    cursorAccent: fondo,
    selectionBackground: t('selection', '#ffffff3d'),
    black: fondo,
    red: t('danger', '#ef4f58'),
    green: t('success', '#2fc27a'),
    yellow: t('warning', '#eca21f'),
    blue: '#6f9ff0',
    magenta: '#b58cf0',
    cyan: '#5cc4d6',
    white: t('text-2', '#b4b4b4'),
    brightBlack: t('text-3', '#7a7a7a'),
    brightRed: '#ff7b83',
    brightGreen: '#5fdc9c',
    brightYellow: '#ffc253',
    brightBlue: '#9dbdf7',
    brightMagenta: '#cfb0f7',
    brightCyan: '#8fdcea',
    brightWhite: '#ffffff',
    // la barra que xterm dibuja por su cuenta: el color es lo único que deja elegir
    scrollbarSliderBackground: t('scroll-thumb', '#ffffff24'),
    scrollbarSliderHoverBackground: t('scroll-thumb-hover', '#ffffff47'),
    scrollbarSliderActiveBackground: t('scroll-thumb-hover', '#ffffff47'),
  };
}

/**
 * Arma la terminal adentro de la vista de chat.
 *   escena   el contenedor de la conversación y el panel
 *   turnos   { pedir(quien) }: cierra los otros paneles antes de abrir este
 *   router   para saber si la vista de chat está al frente
 *   carpeta  () => la carpeta de trabajo del chat que se está viendo
 * Devuelve { panel, boton, abierto(), abrir(), cerrar() }.
 */
export function montarTerminal({ escena, turnos, router, carpeta = () => '' }) {
  let term = null;
  let fit = null;
  let viva = false;     // ¿hay una shell del otro lado?
  let cargando = null;

  // ---------- El panel ----------
  const boton = h('button', 'rad-iconbutton dm-term-boton', { type: 'button', 'data-accion': 'terminal', 'aria-label': 'Terminal', 'aria-pressed': 'false', 'data-rad-tip': 'Terminal', 'data-rad-tip-key': 'Ctrl+T', 'data-rad-tip-side': 'bottom' }, icono('terminal'));
  const ib = (accion, nombre, etiqueta) => h('button', 'rad-iconbutton', { type: 'button', 'data-accion': accion, 'aria-label': etiqueta, 'data-rad-tip': etiqueta, 'data-rad-tip-side': 'bottom' }, icono(nombre));
  // Qué shell salió elegida, a la vista: es la diferencia entre que el profile
  // haya cargado (PowerShell 7) o no (5.1).
  const cual = h('span', 'dm-canvas-sub rad-swap');
  const bReiniciar = ib('term-reiniciar', 'recargar', 'Restart the shell');
  const bCerrar = ib('term-cerrar', 'cerrar', 'Close');
  // Sin esfumado: se comería el renglón de arriba, y en una terminal ese
  // renglón es el que se está leyendo.
  // (xterm se abre en `caja`, que no tiene padding: ver el CSS)
  const caja = h('div', 'dm-term-xterm');
  const cuerpo = h('div', 'dm-term-cuerpo', {}, caja);
  const panel = h('aside', 'dm-term', { 'aria-label': 'Terminal', 'aria-hidden': 'true' },
    h('header', 'dm-canvas-cabeza', { 'data-rad-chrome': '' },
      icono('terminal', 'dm-canvas-icono'),
      h('div', 'dm-canvas-nombre', {}, h('h3', 'dm-canvas-titulo', {}, 'Terminal'), cual),
      h('div', 'dm-canvas-acciones', {}, bReiniciar, bCerrar)),
    cuerpo);
  panel.inert = true;

  const abierto = () => panel.hasAttribute('data-abierto');

  // Las teclas que la shell NO se queda, porque sirven para SALIR de ella:
  // Ctrl+T (cierra la terminal) y Ctrl+B (va al navegador). Tienen que cruzar
  // los dos filtros: el de xterm, que decide si la manda a la shell, y el del
  // panel, que decide si la deja llegar a la app. El resto es de la shell:
  // adentro, Ctrl+U no adjunta un archivo y Esc cancela la línea.
  const ctrl = (e, letra) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === letra;
  const esAtajo = (e) => ctrl(e, 't');
  const deSalida = (e) => esAtajo(e) || ctrl(e, 'b');

  const gris = (texto) => `\r\n\x1b[90m${texto}\x1b[0m\r\n`;
  const rojo = (texto) => `\r\n\x1b[31m${texto}\x1b[0m\r\n`;

  // Copiar y pegar, como en la terminal de Windows: Ctrl+C copia si hay algo
  // marcado (si no, es la interrupción de siempre) y Ctrl+V pega.
  function alTeclear(e) {
    if (deSalida(e)) return false; // no es de la shell: que llegue a la app
    if (e.type !== 'keydown') return true;
    if (ctrl(e, 'c') && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).then(() => term.clearSelection(), () => toast({ text: 'Could not copy', kind: 'danger' }));
      return false;
    }
    if (ctrl(e, 'v')) {
      // (sin acceso al portapapeles, la tecla va a la shell: PowerShell pega sola)
      navigator.clipboard.readText().then((texto) => { if (texto) term.paste(texto); }, () => pedir('term:input', '\x16'));
      e.preventDefault();
      return false;
    }
    return true;
  }

  // Crea el xterm una sola vez. No arranca la shell: eso es arrancar().
  function asegurar() {
    if (term) return Promise.resolve(term);
    cargando ??= (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('/vendor/xterm/xterm.mjs'), import('/vendor/xterm/addon-fit.mjs')]);
      const familia = getComputedStyle(document.documentElement).getPropertyValue('--rad-font-mono').trim() || 'monospace';
      // xterm mide el ancho de una celda al abrirse: la fuente tiene que estar
      try { await document.fonts.load(`${TAMANO}px ${familia}`); } catch { /* mide con la que haya */ }
      const nuevo = new Terminal({
        allowTransparency: true,
        theme: tema(),
        fontFamily: familia,
        fontSize: TAMANO,
        lineHeight: 1.25,
        cursorStyle: 'block',
        cursorBlink: true,
        // el de fábrica (1000) se queda corto apenas corre algo que escupe
        scrollback: 5000,
        // El ancho de su barra: xterm lo toma de acá (de fábrica, 14 px, y el
        // pulgar quedaba de 9, casi el doble que las otras; Fran la vio gruesa
        // con la letra a 11). Con el token de la piel, la pista y el pulgar
        // miden lo mismo que en el resto de la app. El fit lo descuenta igual.
        overviewRuler: { width: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rad-scroll-size')) || 10 },
      });
      fit = new FitAddon();
      nuevo.loadAddon(fit);
      nuevo.open(caja);
      term = nuevo;
      // lo que se teclea va derecho a la shell; acá no se interpreta nada
      term.onData((d) => { pedir('term:input', d); });
      term.attachCustomKeyEventHandler(alTeclear);
      // El panel cambia de medida con la ventana: un observador lo cubre todo.
      new ResizeObserver(() => ajustar()).observe(caja);
      window.rad.on('term:data', (d) => term.write(d));
      window.rad.on('term:exit', (ev) => {
        viva = false;
        swapText(cual, 'ended');
        term.write(gris(`The shell ended (code ${ev?.code ?? '?'}). Restart it with the button above.`));
      });
      return term;
    })().catch((err) => { cargando = null; throw err; });
    return cargando;
  }

  function ajustar() {
    if (!term || !fit || !abierto()) return;
    // con el panel cerrado el cuerpo mide 0, y ConPTY se cae con 0 filas
    const r = caja.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    // Una columna menos de las que entran: es el aire entre la última letra y
    // la barra de scroll, que xterm dibuja pegada al texto.
    let d = null;
    try { d = fit.proposeDimensions(); } catch { return; }
    if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return;
    const cols = Math.max(2, d.cols - 1);
    if (cols !== term.cols || d.rows !== term.rows) term.resize(cols, d.rows);
    if (viva) pedir('term:resize', { cols: term.cols, rows: term.rows });
  }

  async function arrancar(canal = 'term:start') {
    // (abre en la carpeta del chat que se está viendo; reiniciarla la lleva ahí)
    const r = await pedir(canal, { cols: term.cols, rows: term.rows, cwd: carpeta() || null }).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    if (!r?.ok) {
      viva = false;
      swapText(cual, '');
      term.write(rojo(`The shell could not start: ${r?.error ?? 'unknown error'}`));
      return false;
    }
    viva = true;
    swapText(cual, NOMBRES[r.shell] ?? r.shell ?? '');
    return true;
  }

  // ---------- Abrir y cerrar ----------
  let cerrando = null;
  async function abrir() {
    if (abierto()) { term?.focus(); return true; }
    turnos.pedir('terminal');
    clearTimeout(cerrando);
    escena.setAttribute('data-panel', 'terminal');
    panel.setAttribute('data-abierto', '');
    panel.removeAttribute('aria-hidden');
    panel.inert = false;
    boton.setAttribute('aria-pressed', 'true');
    try {
      await asegurar();
    } catch (err) {
      toast({ text: `The terminal could not load: ${String(err?.message || err)}`, kind: 'danger' });
      cerrar();
      return false;
    }
    if (!abierto()) return false; // se cerró mientras cargaba
    ajustar();
    if (!viva) await arrancar();
    ajustar();
    if (abierto()) term.focus();
    return true;
  }
  function cerrar() {
    if (!abierto()) return;
    panel.removeAttribute('data-abierto');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    boton.setAttribute('aria-pressed', 'false');
    clearTimeout(cerrando);
    // el hueco se suelta cuando el panel terminó de irse
    cerrando = setTimeout(() => {
      if (!abierto() && escena.getAttribute('data-panel') === 'terminal') escena.removeAttribute('data-panel');
    }, ms('dur-base') + 40);
  }
  async function reiniciar() {
    if (!term) return;
    term.reset();
    viva = false;
    if (await arrancar('term:restart')) { ajustar(); term.focus(); }
  }

  // ---------- Los controles ----------
  boton.addEventListener('click', () => (abierto() ? cerrar() : abrir()));
  bCerrar.addEventListener('click', cerrar);
  bReiniciar.addEventListener('click', reiniciar);
  // Con el foco adentro de la shell, los atajos de la app no se disparan
  // (xterm frena lo que manda a la shell, pero eso no corta el burbujeo).
  panel.addEventListener('keydown', (e) => { if (!deSalida(e)) e.stopPropagation(); });
  // Ctrl+T abre y cierra, también desde adentro de la shell y desde la página
  // del navegador (ahí las teclas no llegan al DOM: las reenvía el main). Con
  // un modal abierto no abre nada por detrás.
  const conModal = () => Boolean(document.querySelector('.rad-overlays .rad-modal'));
  document.addEventListener('keydown', (e) => {
    if (!esAtajo(e) || router.current !== 'chat') return;
    e.preventDefault(); // (si no, Chromium se queda con el Ctrl+T de «pestaña nueva»)
    if (conModal()) return;
    if (abierto()) cerrar(); else abrir();
  });
  window.rad.on('browser:atajo', (e) => { if (e && esAtajo(e) && router.current === 'chat') abrir(); });

  return { panel, boton, abierto, abrir, cerrar };
}
