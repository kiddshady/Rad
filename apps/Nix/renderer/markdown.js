// Markdown básico -> nodos del DOM.
//
// Lo que escribe el modelo nunca se interpreta como HTML: acá no hay
// innerHTML, todo se arma con createElement y textContent. Un <script> en
// una respuesta sale como texto.
//
// Entiende: párrafos, títulos, **negrita**, *cursiva*, ~~tachado~~, `código`,
// links, listas (anidadas por sangría), citas, reglas, tablas simples,
// bloques de código con ``` y fórmulas en LaTeX (ver formula.js): en bloque
// con $$…$$ o \[…\], y en línea con $…$ o \(…\).
//
// pintar(contenedor, texto) se puede llamar todas las veces que haga falta
// con el texto cada vez más largo (la respuesta llega de a poco): no rehace
// lo que ya estaba. Compara bloque por bloque y solo toca el que cambió, que
// casi siempre es el último; así lo que el usuario seleccionó más arriba
// sigue seleccionado mientras el resto llega.

import { swapText } from '/@core/motion.js';
import { toast } from '/@core/toast.js';
import { h } from './piezas.js';
import { DELIMS, finDeFormula, formula, abreBloque } from './formula.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const INDENTED = /^\s{2,}\S/;
const startsBlock = (l) => FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || Boolean(abreBloque(l));

/** El texto partido en bloques: [{ tipo, … }]. */
export function bloques(texto) {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { i++; continue; }
    let m;

    if ((m = linea.match(FENCE))) {
      const marca = m[1];
      const cuerpo = [];
      i++;
      // Sin cierre (todavía está llegando) el bloque sigue hasta el final.
      while (i < lineas.length) {
        const c = lineas[i].match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (c && c[1][0] === marca[0] && c[1].length >= marca.length) { i++; break; }
        cuerpo.push(lineas[i]);
        i++;
      }
      out.push({ tipo: 'codigo', lang: m[2], texto: cuerpo.join('\n') });
      continue;
    }

    if ((m = linea.match(HEADING))) {
      out.push({ tipo: 'titulo', nivel: m[1].length, texto: m[2] });
      i++;
      continue;
    }

    if (HR.test(linea)) {
      out.push({ tipo: 'regla' });
      i++;
      continue;
    }

    // Una fórmula en bloque: abre con $$ o \[ al principio de la línea y llega
    // hasta su cierre, aunque haya líneas en el medio. Si después del cierre
    // sigue texto en la misma línea no es un bloque: es una fórmula adentro de
    // un párrafo, y la resuelve enLinea. Sin cierre todavía (está llegando, o
    // el modelo no la cerró) llega hasta la primera línea en blanco y se
    // muestra como texto.
    const abre = abreBloque(linea);
    if (abre) {
      const resto = lineas.slice(i).join('\n');
      const desde = resto.indexOf(abre.left) + abre.left.length;
      const fin = finDeFormula(abre.right, resto, desde);
      if (fin >= 0) {
        const cola = resto.slice(fin + abre.right.length).split('\n')[0];
        if (!cola.trim()) {
          out.push({ tipo: 'formula', tex: resto.slice(desde, fin).trim() });
          i += resto.slice(0, fin + abre.right.length).split('\n').length;
          continue;
        }
      } else {
        const cuerpo = [linea];
        i++;
        while (i < lineas.length && lineas[i].trim()) { cuerpo.push(lineas[i]); i++; }
        out.push({ tipo: 'formula', abierta: true, tex: cuerpo.join('\n') });
        continue;
      }
    }

    if (QUOTE.test(linea)) {
      const dentro = [];
      while (i < lineas.length && QUOTE.test(lineas[i])) { dentro.push(lineas[i].match(QUOTE)[1]); i++; }
      out.push({ tipo: 'cita', bloques: bloques(dentro.join('\n')) });
      continue;
    }

    if (linea.includes('|') && i + 1 < lineas.length && lineas[i + 1].includes('-') && TABLE_SEP.test(lineas[i + 1])) {
      const celdas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const cabeza = celdas(linea);
      const filas = [];
      i += 2;
      while (i < lineas.length && lineas[i].trim() && lineas[i].includes('|')) { filas.push(celdas(lineas[i])); i++; }
      out.push({ tipo: 'tabla', cabeza, filas });
      continue;
    }

    if (ITEM.test(linea)) {
      const items = [];
      while (i < lineas.length) {
        const l = lineas[i];
        const it = l.match(ITEM);
        if (it) {
          items.push({ sangria: it[1].replace(/\t/g, '    ').length, ordenada: /\d/.test(it[2]), numero: parseInt(it[2], 10), texto: [it[3]] });
          i++;
        } else if (!l.trim()) {
          // Una línea en blanco sigue en la lista solo si después viene otro
          // item o una continuación con sangría.
          const sig = lineas[i + 1];
          if (sig === undefined || !(ITEM.test(sig) || INDENTED.test(sig))) break;
          i++;
        } else if (INDENTED.test(l) || !startsBlock(l)) {
          items.at(-1).texto.push(l.trim());
          i++;
        } else {
          break;
        }
      }
      out.push({ tipo: 'lista', items });
      continue;
    }

    const parrafo = [linea];
    i++;
    while (i < lineas.length && lineas[i].trim() && !startsBlock(lineas[i]) && !ITEM.test(lineas[i])) { parrafo.push(lineas[i]); i++; }
    out.push({ tipo: 'parrafo', texto: parrafo.join('\n') });
  }
  return out;
}

// ---------- En línea ----------

// En orden: código, fórmula, negrita (** y __), tachado, cursiva (* y _),
// link, dirección suelta y escape. En la misma posición gana la primera. De
// la fórmula acá solo se reconoce dónde ABRE (un grupo con nombre); dónde
// cierra lo decide finDeFormula, que cuenta llaves y barras.
const INLINE = [
  '(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)',
  '(?<abre>\\$\\$|\\\\\\[|\\\\\\(|\\$)',
  '\\*\\*([^\\s*](?:[\\s\\S]*?[^\\s])?)\\*\\*',
  '__([^\\s_](?:[\\s\\S]*?[^\\s])?)__',
  '~~([^\\s~](?:[\\s\\S]*?[^\\s])?)~~',
  '\\*([^\\s*](?:[^*]*?[^\\s*])?)\\*',
  '(?<![\\w])_([^\\s_](?:[^_]*?[^\\s_])?)_(?![\\w])',
  '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '(https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?\'"])',
  '\\\\([\\\\`*_{}\\[\\]()#+\\-.!~|>])',
].join('|');

const SEGURO = /^(https?:|mailto:)/i;

function plano(padre, texto) {
  if (!texto) return;
  // Un salto de línea adentro de un párrafo se respeta.
  texto.split('\n').forEach((parte, i) => {
    if (i) padre.append(document.createElement('br'));
    if (parte) padre.append(parte);
  });
}

function link(padre, texto, url, anidar) {
  if (!SEGURO.test(url)) { plano(padre, texto); return; }
  // El núcleo frena la navegación y abre la dirección en el navegador.
  const a = h('a', 'dm-link', { href: url });
  if (anidar) enLinea(a, texto);
  else a.textContent = texto;
  padre.append(a);
}

function enLinea(padre, texto) {
  const re = new RegExp(INLINE, 'g'); // una por llamada: es recursivo
  let desde = 0;
  let m;
  while ((m = re.exec(texto))) {
    plano(padre, texto.slice(desde, m.index));
    desde = re.lastIndex;
    if (m.groups.abre !== undefined) {
      // ¿cierra, y es una fórmula de verdad? Si no, el delimitador es texto.
      const d = DELIMS.find((x) => x.left === m.groups.abre);
      const fin = finDeFormula(d.right, texto, desde);
      const tex = fin >= 0 ? texto.slice(desde, fin) : '';
      if (fin >= 0 && d.vale(tex, texto, m.index, fin)) {
        padre.append(formula(tex.trim(), d.display));
        desde = fin + d.right.length;
        re.lastIndex = desde;
      } else {
        // un \( o un \[ sueltos siguen siendo el escape de siempre
        plano(padre, d.left.startsWith('\\') ? d.left.slice(1) : d.left);
      }
      continue;
    }
    if (m[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[2];
      padre.append(code);
    } else if (m[4] !== undefined || m[5] !== undefined) {
      const b = document.createElement('strong');
      enLinea(b, m[4] ?? m[5]);
      padre.append(b);
    } else if (m[6] !== undefined) {
      const s = document.createElement('del');
      enLinea(s, m[6]);
      padre.append(s);
    } else if (m[7] !== undefined || m[8] !== undefined) {
      const e = document.createElement('em');
      enLinea(e, m[7] ?? m[8]);
      padre.append(e);
    } else if (m[9] !== undefined) {
      link(padre, m[9], m[10], true);
    } else if (m[11] !== undefined) {
      link(padre, m[11], m[11], false);
    } else if (m[12] !== undefined) {
      plano(padre, m[12]);
    }
  }
  plano(padre, texto.slice(desde));
}

// ---------- Bloques ----------

function lista(items) {
  const nueva = (it) => {
    const el = document.createElement(it.ordenada ? 'ol' : 'ul');
    if (it.ordenada && it.numero > 1) el.start = it.numero;
    return el;
  };
  const raiz = nueva(items[0]);
  const pila = [{ sangria: items[0].sangria, el: raiz, ultimo: null }];
  for (const it of items) {
    while (pila.length > 1 && it.sangria < pila.at(-1).sangria) pila.pop();
    let tope = pila.at(-1);
    // Dos espacios o más adentro: una lista dentro del último item.
    if (it.sangria >= tope.sangria + 2 && tope.ultimo) {
      const sub = nueva(it);
      tope.ultimo.append(sub);
      tope = { sangria: it.sangria, el: sub, ultimo: null };
      pila.push(tope);
    }
    const li = document.createElement('li');
    enLinea(li, it.texto.join('\n'));
    tope.el.append(li);
    tope.ultimo = li;
  }
  return raiz;
}

function tabla(b) {
  const caja = h('div', 'dm-tabla');
  const table = document.createElement('table');
  const fila = (celdas, tag) => {
    const tr = document.createElement('tr');
    for (let i = 0; i < b.cabeza.length; i++) {
      const celda = document.createElement(tag);
      enLinea(celda, celdas[i] ?? '');
      tr.append(celda);
    }
    return tr;
  };
  const thead = document.createElement('thead');
  thead.append(fila(b.cabeza, 'th'));
  const tbody = document.createElement('tbody');
  for (const f of b.filas) tbody.append(fila(f, 'td'));
  table.append(thead, tbody);
  caja.append(table);
  return caja;
}

async function copiar(boton, code) {
  const rotulo = boton.firstElementChild;
  try {
    await navigator.clipboard.writeText(code.textContent);
    swapText(rotulo, 'Copied');
    clearTimeout(boton._volver);
    boton._volver = setTimeout(() => swapText(rotulo, 'Copy'), 1600);
  } catch {
    toast({ text: 'Could not copy', kind: 'danger' });
  }
}

function codigo(b) {
  const caja = h('figure', 'dm-codigo');
  const lang = h('span', 'dm-codigo-lang');
  lang.textContent = b.lang || 'text';
  const rotulo = h('span', 'rad-swap');
  const boton = h('button', 'dm-codigo-copiar', { type: 'button' }, rotulo);
  swapText(rotulo, 'Copy');
  const code = document.createElement('code');
  code.textContent = b.texto;
  boton.addEventListener('click', () => copiar(boton, code));
  caja.append(h('div', 'dm-codigo-cabeza', { 'data-rad-chrome': '' }, lang, boton), h('pre', null, {}, code));
  return caja;
}

function armar(b) {
  if (b.tipo === 'parrafo') {
    const p = document.createElement('p');
    enLinea(p, b.texto);
    return p;
  }
  if (b.tipo === 'titulo') {
    // Adentro de un mensaje los títulos arrancan en h3; el nivel de verdad
    // va en data-nivel, para el tamaño.
    const t = h(`h${Math.min(6, b.nivel + 2)}`, 'dm-titulo', { 'data-nivel': String(b.nivel) });
    enLinea(t, b.texto);
    return t;
  }
  if (b.tipo === 'regla') return document.createElement('hr');
  if (b.tipo === 'cita') {
    const q = document.createElement('blockquote');
    for (const hijo of b.bloques) q.append(armar(hijo));
    return q;
  }
  if (b.tipo === 'lista') return lista(b.items);
  if (b.tipo === 'tabla') return tabla(b);
  if (b.tipo === 'formula') {
    // sin cerrar todavía: se ve el texto que va llegando, tal cual
    if (b.abierta) return h('p', 'dm-formula-abierta rad-mono', {}, b.tex);
    return h('div', 'dm-formula-bloque', {}, formula(b.tex, true));
  }
  return codigo(b);
}

// Pone al día un nodo que ya estaba sin cambiarlo por otro, cuando se puede:
// un párrafo o un título que creció, o un bloque de código al que le llegaron
// más líneas.
function retocar(nodo, b) {
  if (b.tipo === 'parrafo' || (b.tipo === 'titulo' && nodo.dataset.nivel === String(b.nivel))) {
    nodo.replaceChildren();
    enLinea(nodo, b.texto);
    return true;
  }
  if (b.tipo === 'codigo') {
    nodo.querySelector('.dm-codigo-lang').textContent = b.lang || 'text';
    nodo.querySelector('code').textContent = b.texto;
    return true;
  }
  return false;
}

/** Pinta el markdown de `texto` en `contenedor`, tocando solo lo que cambió. */
export function pintar(contenedor, texto) {
  const lista2 = bloques(texto);
  const antes = contenedor._md ?? [];
  const ahora = [];
  for (let i = 0; i < lista2.length; i++) {
    const b = lista2[i];
    const huella = JSON.stringify(b);
    const viejo = antes[i];
    if (viejo && viejo.huella === huella) { ahora.push(viejo); continue; }
    let nodo;
    if (viejo && viejo.tipo === b.tipo && retocar(viejo.nodo, b)) {
      nodo = viejo.nodo;
    } else {
      nodo = armar(b);
      if (viejo) viejo.nodo.replaceWith(nodo);
      else contenedor.append(nodo);
    }
    ahora.push({ huella, tipo: b.tipo, nodo });
  }
  for (let i = lista2.length; i < antes.length; i++) antes[i].nodo.remove();
  contenedor._md = ahora;
}
