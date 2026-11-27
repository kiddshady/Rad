// El panel del typo lab. Lo evalúa index.mjs por CDP adentro de la página de
// BlackCode: es UNA expresión (una función async) que recibe
// { familias, css, guardado } y devuelve true. Usa las piezas del núcleo
// (motion, overlays, tooltips, controles) importándolas de /@core/, que son
// las mismas instancias que usa la app.
//
// Qué toca: solo propiedades --rad-* en línea sobre <html> (le ganan a la piel
// y a la app). Lo de antes se anota al entrar y se devuelve tal cual: el
// núcleo ya pone ahí la mono que eligió la app (Roboto Mono), no se borra.
async ({ familias, css, guardado }) => {
  const { present, dismiss } = await import('/@core/motion.js');
  const { layer, pushOverlay } = await import('/@core/overlays.js');
  const { toast } = await import('/@core/toast.js');
  const { wireControls } = await import('/@core/controls.js');

  // Si ya había uno (se volvió a inyectar sin recargar), se va primero.
  window.__typoLab?.quitar();

  const root = document.documentElement;
  const ROLES = [
    { id: 'ui', token: '--rad-font-ui', rotulo: 'Interface' },
    { id: 'display', token: '--rad-font-display', rotulo: 'Titles' },
    { id: 'mono', token: '--rad-font-mono', rotulo: 'Mono' },
  ];
  const TAMANOS = ['xs', 's', 'm', 'l', 'xl'].map((id) => ({ id, token: `--rad-text-${id}`, rotulo: id.toUpperCase(), paso: 0.5, min: 6, max: 48 }));
  const PESOS = [
    { id: 'regular', token: '--rad-weight-regular', rotulo: 'Regular', paso: 50, min: 100, max: 900 },
    { id: 'strong', token: '--rad-weight-strong', rotulo: 'Strong', paso: 50, min: 100, max: 900 },
  ];
  const TODOS = [...ROLES, ...TAMANOS, ...PESOS];

  // Lo de antes: el valor en línea (si había) y el calculado.
  const antes = {};
  for (const t of TODOS) antes[t.token] = { enLinea: root.style.getPropertyValue(t.token), calculado: getComputedStyle(root).getPropertyValue(t.token).trim() };
  const primera = (pila) => (pila.split(',')[0] || '').trim().replace(/^['"]|['"]$/g, '');
  const numero = (t) => parseFloat(antes[t.token].calculado) || 0;

  const estado = {
    fuentes: { ui: null, display: null, mono: null },
    tam: {}, peso: {}, pos: { dx: 0, dy: 0 }, plegado: false,
    ...(guardado ?? {}),
  };
  estado.fuentes = { ui: null, display: null, mono: null, ...(guardado?.fuentes ?? {}) };

  // ---------- Aplicar ----------
  const valorDe = (t) => {
    if (t.token.startsWith('--rad-font-')) {
      const f = estado.fuentes[t.id];
      return f ? `'${f}', ${antes[t.token].calculado}` : null;
    }
    const v = (TAMANOS.includes(t) ? estado.tam : estado.peso)[t.id];
    if (v == null) return null;
    return TAMANOS.includes(t) ? `${v}px` : String(v);
  };
  let comparando = false;
  let previa = null; // { rol, familia } mientras se recorre la lista
  function aplicar() {
    for (const t of TODOS) {
      let v = comparando ? null : valorDe(t);
      if (!comparando && previa && t.id === previa.rol) v = previa.familia ? `'${previa.familia}', ${antes[t.token].calculado}` : null;
      if (v != null) root.style.setProperty(t.token, v);
      else if (antes[t.token].enLinea) root.style.setProperty(t.token, antes[t.token].enLinea);
      else root.style.removeProperty(t.token);
    }
  }

  let guardarTimer = 0;
  function guardar() {
    clearTimeout(guardarTimer);
    guardarTimer = setTimeout(() => window.typoLab?.(JSON.stringify({ que: 'guardar', estado })), 400);
  }
  const cambio = () => { aplicar(); pintar(); guardar(); };

  // ---------- Íconos (trazos propios, nada de glifos) ----------
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = {
    tipo: svg('M5 7V5h14v2M9.5 19h5M12 5v14'),
    plegar: svg('M6 9l6 6 6-6'),
    menos: svg('M6 12h12'),
    mas: svg('M6 12h12M12 6v12'),
    volver: svg('M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6'),
    chevron: svg('M7 10l5 5 5-5'),
  };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const boton = (cls, icono, tip) => { const b = el('button', `rad-iconbutton ${cls}`, icono); b.type = 'button'; if (tip) { b.dataset.radTip = tip; b.setAttribute('aria-label', tip); } return b; };

  // ---------- La hoja de estilos (construida: la CSP bloquea un <style>) ----------
  const hoja = new CSSStyleSheet();
  hoja.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];

  // ---------- El panel ----------
  const panel = el('section', 'tl-panel');
  panel.setAttribute('aria-label', 'Typo lab');
  // la letra del panel queda fija en la de la piel: una fuente rara no lo rompe
  panel.style.setProperty('--tl-ui', antes['--rad-font-ui'].calculado);
  panel.style.setProperty('--tl-mono', antes['--rad-font-mono'].enLinea || antes['--rad-font-mono'].calculado);
  const cabeza = el('header', 'tl-cabeza');
  const titulo = el('div', 'tl-titulo', `<span class="tl-titulo-icono">${I.tipo}</span><span>Typo lab</span>`);
  const plegar = boton('tl-plegar', I.plegar, 'Collapse');
  cabeza.append(titulo, plegar);

  const cuerpo = el('div', 'tl-cuerpo rad-scroll');
  const grupo = (nombre) => { const g = el('div', 'tl-grupo'); g.append(el('div', 'tl-grupo-titulo', nombre)); cuerpo.append(g); return g; };

  const filas = {};
  const gFam = grupo('Families');
  for (const r of ROLES) {
    const fila = el('div', 'tl-fila tl-fila-fuente');
    const rot = el('span', 'tl-rotulo', r.rotulo);
    const elegir = el('button', 'tl-fuente', `<span class="tl-fuente-nombre"></span><span class="tl-fuente-chevron">${I.chevron}</span>`);
    elegir.type = 'button';
    elegir.setAttribute('aria-haspopup', 'listbox');
    const volver = boton('tl-volver', I.volver, 'Back to the default');
    elegir.addEventListener('click', () => abrirLista(r, elegir));
    volver.addEventListener('click', () => { estado.fuentes[r.id] = null; cambio(); });
    fila.append(rot, elegir, volver);
    gFam.append(fila);
    filas[r.id] = { fila, elegir, volver };
  }
  const paso = (g, t, donde) => {
    const fila = el('div', 'tl-fila');
    const rot = el('span', 'tl-rotulo', `${t.rotulo}<small class="tl-def">${numero(t)}</small>`);
    const caja = el('div', 'tl-paso');
    const menos = boton('tl-menos', I.menos, 'Smaller');
    const valor = el('span', 'tl-valor');
    const mas = boton('tl-mas', I.mas, 'Bigger');
    const mover = (signo) => {
      const actual = donde[t.id] ?? numero(t);
      const nuevo = Math.min(t.max, Math.max(t.min, Math.round((actual + signo * t.paso) * 100) / 100));
      donde[t.id] = nuevo === numero(t) ? null : nuevo;
      cambio();
    };
    menos.addEventListener('click', () => mover(-1));
    mas.addEventListener('click', () => mover(1));
    // la rueda sobre el valor también mueve
    caja.addEventListener('wheel', (e) => { e.preventDefault(); mover(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    caja.append(menos, valor, mas);
    const volver = boton('tl-volver', I.volver, 'Back to the default');
    volver.addEventListener('click', () => { donde[t.id] = null; cambio(); });
    fila.append(rot, caja, volver);
    g.append(fila);
    filas[t.id] = { fila, valor, volver, donde, t };
  };
  const gTam = grupo('Sizes');
  for (const t of TAMANOS) paso(gTam, t, estado.tam);
  const gPeso = grupo('Weights');
  for (const t of PESOS) paso(gPeso, t, estado.peso);

  const pie = el('footer', 'tl-pie');
  const comparar = el('button', 'rad-button tl-comparar', 'Compare');
  comparar.type = 'button';
  comparar.dataset.radTip = 'Hold to see the original';
  const reset = el('button', 'rad-button', 'Reset');
  reset.type = 'button';
  reset.dataset.variant = 'quiet';
  const copiar = el('button', 'rad-button', 'Copy CSS');
  copiar.type = 'button';
  copiar.dataset.variant = 'primary';
  pie.append(comparar, reset, copiar);
  panel.append(cabeza, cuerpo, pie);

  const pastilla = el('button', 'tl-pastilla', `<span class="tl-titulo-icono">${I.tipo}</span><span>Typo lab</span>`);
  pastilla.type = 'button';
  pastilla.style.setProperty('--tl-ui', antes['--rad-font-ui'].calculado);

  function pintar() {
    for (const r of ROLES) {
      const { fila, elegir } = filas[r.id];
      const f = estado.fuentes[r.id];
      const nombre = f ?? primera(antes[r.token].enLinea || antes[r.token].calculado);
      const n = elegir.querySelector('.tl-fuente-nombre');
      n.textContent = nombre;
      n.style.fontFamily = `'${nombre}', var(--tl-ui)`;
      elegir.dataset.radTip = f ? nombre : `${nombre} (default)`;
      fila.toggleAttribute('data-cambiado', !!f);
    }
    for (const t of [...TAMANOS, ...PESOS]) {
      const { fila, valor, donde } = filas[t.id];
      valor.textContent = String(donde[t.id] ?? numero(t));
      fila.toggleAttribute('data-cambiado', donde[t.id] != null);
    }
    const algo = Object.values(estado.fuentes).some(Boolean) || Object.values(estado.tam).some((v) => v != null) || Object.values(estado.peso).some((v) => v != null);
    reset.disabled = !algo;
    copiar.disabled = !algo;
    comparar.disabled = !algo;
  }

  // ---------- Comparar: mientras se aprieta se ve lo original ----------
  const soltar = () => { if (!comparando) return; comparando = false; comparar.removeAttribute('data-apretado'); aplicar(); };
  comparar.addEventListener('pointerdown', (e) => { if (e.button !== 0 || comparar.disabled) return; comparando = true; comparar.setAttribute('data-apretado', ''); comparar.setPointerCapture(e.pointerId); aplicar(); });
  comparar.addEventListener('pointerup', soltar);
  comparar.addEventListener('pointercancel', soltar);
  comparar.addEventListener('lostpointercapture', soltar);
  comparar.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !comparar.disabled) { e.preventDefault(); comparando = true; comparar.setAttribute('data-apretado', ''); aplicar(); } });
  comparar.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') soltar(); });
  comparar.addEventListener('blur', soltar);

  reset.addEventListener('click', () => {
    estado.fuentes = { ui: null, display: null, mono: null };
    for (const k of Object.keys(estado.tam)) estado.tam[k] = null;
    for (const k of Object.keys(estado.peso)) estado.peso[k] = null;
    for (const t of [...TAMANOS, ...PESOS]) filas[t.id].donde = TAMANOS.includes(t) ? estado.tam : estado.peso;
    cambio();
  });

  copiar.addEventListener('click', () => {
    const lineas = [];
    for (const t of TODOS) { const v = valorDe(t); if (v != null) lineas.push(`  ${t.token}: ${v};`); }
    const hoy = new Date().toLocaleDateString('es-AR');
    const texto = `/* BlackCode, typo lab (${hoy}) */\n:root {\n${lineas.join('\n')}\n}\n`;
    window.typoLab?.(JSON.stringify({ que: 'copiar', texto }));
    toast({ text: 'CSS copied to the clipboard', kind: 'success', duration: 2500 });
  });

  // ---------- Plegar y desplegar ----------
  async function relevar(sale, entra) {
    delete sale._radDismiss;
    await dismiss(sale, { remove: false });
    delete sale._radDismiss;
    sale.hidden = true;
    entra.hidden = false;
    entra.classList.remove('is-settled');
    present(entra);
  }
  plegar.addEventListener('click', () => { estado.plegado = true; guardar(); cerrarLista(); relevar(panel, pastilla); });
  pastilla.addEventListener('click', () => { if (pastilla._arrastrado) return; estado.plegado = false; guardar(); relevar(pastilla, panel); });

  // ---------- Arrastrar (por la cabecera o la pastilla) ----------
  const ubicar = () => {
    // que no se vaya de la ventana
    for (const n of [panel, pastilla]) n.style.translate = `${estado.pos.dx}px ${estado.pos.dy}px`;
    const caja = (panel.hidden ? pastilla : panel).getBoundingClientRect();
    let { dx, dy } = estado.pos;
    if (caja.left < 0) dx -= caja.left;
    if (caja.top < 0) dy -= caja.top;
    if (caja.right > innerWidth) dx -= caja.right - innerWidth;
    if (caja.bottom > innerHeight) dy -= caja.bottom - innerHeight;
    if (dx !== estado.pos.dx || dy !== estado.pos.dy) { estado.pos = { dx, dy }; for (const n of [panel, pastilla]) n.style.translate = `${dx}px ${dy}px`; }
  };
  const arrastre = (asa, nodo) => {
    asa.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest('button') && e.target.closest('button') !== nodo)) return;
      const x0 = e.clientX, y0 = e.clientY, { dx, dy } = estado.pos;
      let movio = false;
      nodo._arrastrado = false;
      const mover = (ev) => {
        if (!movio && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        movio = true;
        nodo.setAttribute('data-arrastrando', '');
        estado.pos = { dx: dx + ev.clientX - x0, dy: dy + ev.clientY - y0 };
        ubicar();
      };
      const fin = () => {
        removeEventListener('pointermove', mover);
        removeEventListener('pointerup', fin);
        nodo.removeAttribute('data-arrastrando');
        if (movio) { nodo._arrastrado = true; setTimeout(() => { nodo._arrastrado = false; }, 0); guardar(); }
      };
      addEventListener('pointermove', mover);
      addEventListener('pointerup', fin);
    });
  };
  arrastre(cabeza, panel);
  arrastre(pastilla, pastilla);
  addEventListener('resize', ubicar);

  // ---------- La lista de familias ----------
  // ¿Monoespaciada? Se mide en un canvas contra una de reserva proporcional:
  // si la familia no existe, mide la de reserva y no pasa.
  const ctx = document.createElement('canvas').getContext('2d');
  const esMono = new Map();
  const mono = (f) => {
    if (!esMono.has(f)) {
      ctx.font = `20px '${f}', serif`;
      const a = ctx.measureText('iiiiiiiiii').width, b = ctx.measureText('MMMMMMMMMM').width;
      esMono.set(f, Math.abs(a - b) < 0.5);
    }
    return esMono.get(f);
  };

  let lista = null;
  function cerrarLista({ volver = true } = {}) {
    if (!lista) return;
    const l = lista;
    lista = null;
    l.sacar();
    if (previa) { previa = null; aplicar(); }
    if (volver && l.ancla.isConnected) l.ancla.focus({ preventScroll: true, focusVisible: false });
    l.ancla.setAttribute('aria-expanded', 'false');
    dismiss(l.nodo);
  }
  function abrirLista(rol, ancla) {
    if (lista) { const misma = lista.rol === rol; cerrarLista({ volver: false }); if (misma) return; }
    ancla.setAttribute('aria-expanded', 'true');
    const nodo = el('div', 'tl-lista-caja');
    nodo.style.setProperty('--tl-ui', antes['--rad-font-ui'].calculado);
    const buscar = el('input', 'rad-input tl-buscar');
    buscar.type = 'text';
    buscar.placeholder = 'Search fonts';
    buscar.spellcheck = false;
    buscar.setAttribute('aria-label', 'Search fonts');
    const opciones = el('label', 'rad-check tl-solo-mono');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = rol.id === 'mono';
    opciones.append(casilla, el('span', 'rad-check-box'), document.createTextNode('Monospaced only'));
    wireControls(opciones.parentNode ?? opciones);
    const ul = el('div', 'tl-lista rad-scroll');
    ul.setAttribute('role', 'listbox');
    nodo.append(buscar, opciones, ul);

    const defecto = primera(antes[rol.token].enLinea || antes[rol.token].calculado);
    let items = [];
    let activo = -1;
    const elegida = estado.fuentes[rol.id];
    const llenar = () => {
      const q = buscar.value.trim().toLowerCase();
      const fams = familias.filter((f) => (!q || f.toLowerCase().includes(q)) && (!casilla.checked || mono(f)));
      ul.replaceChildren();
      items = [{ familia: null, nombre: `${defecto}`, nota: 'default' }, ...fams.map((f) => ({ familia: f, nombre: f }))];
      if (q) items = items.filter((it) => it.familia || it.nombre.toLowerCase().includes(q));
      items.forEach((it, i) => {
        const b = el('button', 'tl-item');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.tabIndex = -1;
        const nombre = el('span', 'tl-item-nombre');
        nombre.textContent = it.nombre;
        nombre.style.fontFamily = `'${it.familia ?? it.nombre}', var(--tl-ui)`;
        b.append(nombre);
        if (it.nota) b.append(el('span', 'tl-item-nota', it.nota));
        if ((it.familia ?? null) === (elegida ?? null)) b.setAttribute('aria-selected', 'true');
        b.addEventListener('pointerenter', () => marcar(i, { previa: true, mover: false }));
        b.addEventListener('click', () => confirmar(i));
        it.nodo = b;
        ul.append(b);
      });
      if (!items.length) ul.append(el('div', 'tl-vacio', 'No font with that name'));
      activo = -1;
      ul.scrollTop = 0;
    };
    let previaTimer = 0;
    const marcar = (i, { previa: conPrevia = true, mover = true } = {}) => {
      if (!items.length) return;
      activo = Math.max(0, Math.min(items.length - 1, i));
      items.forEach((it, j) => it.nodo.toggleAttribute('data-activo', j === activo));
      if (mover) items[activo].nodo.scrollIntoView({ block: 'nearest' });
      if (conPrevia) {
        clearTimeout(previaTimer);
        // un respiro: pasar el mouse por encima de diez filas no repinta diez veces
        previaTimer = setTimeout(() => { if (lista?.nodo !== nodo) return; previa = { rol: rol.id, familia: items[activo].familia }; aplicar(); }, 90);
      }
    };
    const confirmar = (i) => {
      clearTimeout(previaTimer);
      estado.fuentes[rol.id] = items[i].familia;
      previa = null;
      cerrarLista();
      cambio();
    };
    buscar.addEventListener('input', llenar);
    casilla.addEventListener('change', () => { llenar(); buscar.focus(); });
    buscar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar(activo + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(activo - 1); }
      else if (e.key === 'PageDown') { e.preventDefault(); marcar(activo + 8); }
      else if (e.key === 'PageUp') { e.preventDefault(); marcar(activo - 8); }
      else if (e.key === 'Enter') { e.preventDefault(); if (activo >= 0) confirmar(activo); }
    });
    ul.addEventListener('pointerleave', () => { clearTimeout(previaTimer); if (previa) { previa = null; aplicar(); } });

    const capa = layer();
    capa.append(nodo);
    // al lado del panel, a la altura del botón; que no se salga de la ventana
    const a = ancla.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const ancho = 300, alto = Math.min(440, innerHeight - 24);
    let left = p.left - ancho - 8;
    if (left < 8) left = p.right + 8;
    let top = Math.min(Math.max(8, a.top - 8), innerHeight - alto - 8);
    nodo.style.left = `${left}px`;
    nodo.style.top = `${top}px`;
    nodo.style.height = `${alto}px`;
    llenar();
    present(nodo);
    buscar.focus({ preventScroll: true });
    // el elegido a la vista
    const i = items.findIndex((it) => (it.familia ?? null) === (elegida ?? null));
    if (i >= 0) { activo = i; items[i].nodo.setAttribute('data-activo', ''); items[i].nodo.scrollIntoView({ block: 'center' }); }

    const popStack = pushOverlay({ onEscape: () => cerrarLista() });
    const afuera = (e) => { if (!nodo.contains(e.target) && e.target !== ancla && !ancla.contains(e.target)) cerrarLista({ volver: false }); };
    document.addEventListener('pointerdown', afuera, true);
    lista = { rol, ancla, nodo, sacar: () => { popStack(); document.removeEventListener('pointerdown', afuera, true); clearTimeout(previaTimer); } };
  }

  // ---------- Montar ----------
  // En la capa de overlays, y siempre al final: un modal que se abre después
  // (Settings) queda debajo del panel, y los toasts y tooltips (z-index propio)
  // siguen encima.
  const capa = layer();
  capa.append(panel, pastilla);
  const alFinal = new MutationObserver(() => {
    const ultimos = [...capa.children].slice(-2);
    if (ultimos.includes(panel) && ultimos.includes(pastilla)) return;
    const foco = document.activeElement;
    capa.append(panel, pastilla);
    if (foco && panel.contains(foco)) foco.focus({ preventScroll: true });
  });
  alFinal.observe(capa, { childList: true });

  panel.hidden = !!estado.plegado;
  pastilla.hidden = !estado.plegado;
  aplicar();
  pintar();
  ubicar();
  present(estado.plegado ? pastilla : panel);

  window.__typoLab = {
    quitar() {
      alFinal.disconnect();
      cerrarLista({ volver: false });
      panel.remove();
      pastilla.remove();
      removeEventListener('resize', ubicar);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((h) => h !== hoja);
      comparando = true;
      aplicar();
      comparando = false;
    },
  };
  return true;
}
