'use strict';
// Lo que escribe un agente (markdown) pasado a lo que muestra Telegram.
//
// Telegram no lee markdown común: tiene su «MarkdownV2», que rebota el
// mensaje entero por un solo signo sin escapar, y un HTML con pocas
// etiquetas (b, i, s, u, code, pre, a, blockquote). Va el HTML: se escapa
// todo y se ponen solo esas. Lo que Telegram no tiene se acomoda: un título
// va en negrita, una lista con su viñeta, una tabla como texto de ancho fijo.
// Si Telegram igual rechaza el HTML, el mensaje se manda en texto plano
// (`plano`), así que nada de esto puede dejar al usuario sin respuesta.
//
// Un mensaje de Telegram tiene a lo sumo 4096 caracteres: `partir` corta lo
// largo en bloques (párrafos y bloques de código enteros), y cada pedazo se
// convierte solo.

const LARGO_MAX = 4096;
const MARGEN = 3900; // lo que se apunta: el HTML de un pedazo mide más que su markdown

const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escaparAtributo = (t) => escapar(t).replace(/"/g, '&quot;');

/** Lo de adentro de un renglón: código, enlaces, negrita, cursiva y tachado. */
function enLinea(texto) {
  // El código va primero y se aparta: adentro no se interpreta nada.
  const codigos = [];
  let t = String(texto).replace(/`([^`\n]+)`/g, (_, c) => { codigos.push(c); return `\u0000${codigos.length - 1}\u0000`; });
  // Los enlaces también se apartan (su dirección lleva signos que no son formato).
  const enlaces = [];
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => { enlaces.push({ txt, url }); return `\u0001${enlaces.length - 1}\u0001`; });
  t = escapar(t);
  t = t
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '<b>$1</b>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>')
    // (una cursiva con asterisco, que no sea el de una viñeta)
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<i>$2</i>')
    // (con guion bajo, solo entre palabras: un_nombre_de_archivo no es cursiva)
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => { const e = enlaces[Number(i)]; return `<a href="${escaparAtributo(e.url)}">${enLinea(e.txt)}</a>`; });
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapar(codigos[Number(i)])}</code>`);
  return t;
}

const esFila = (l) => /^\s*\|.*\|\s*$/.test(l);
const esSeparador = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/** Una tabla de markdown como texto de ancho fijo: columnas alineadas. */
function tabla(lineas) {
  const filas = lineas.filter((l) => !esSeparador(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*|`/g, '')));
  const anchos = [];
  for (const f of filas) f.forEach((c, i) => { anchos[i] = Math.max(anchos[i] ?? 0, [...c].length); });
  return filas.map((f) => f.map((c, i) => c + ' '.repeat(Math.max(0, anchos[i] - [...c].length))).join('  ').trimEnd()).join('\n');
}

/** markdown → el HTML que acepta Telegram. */
function aHtml(md) {
  const lineas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const salida = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // un bloque de código, con su lenguaje si lo dice
    const cerca = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(l);
    if (cerca) {
      const cuerpo = [];
      let j = i + 1;
      while (j < lineas.length && !new RegExp(`^\\s*${cerca[1]}\\s*$`).test(lineas[j])) cuerpo.push(lineas[j++]);
      const lang = cerca[2] ? ` class="language-${escaparAtributo(cerca[2])}"` : '';
      salida.push(`<pre><code${lang}>${escapar(cuerpo.join('\n'))}</code></pre>`);
      i = j;
      continue;
    }
    if (esFila(l)) {
      const filas = [];
      let j = i;
      while (j < lineas.length && (esFila(lineas[j]) || esSeparador(lineas[j]))) filas.push(lineas[j++]);
      salida.push(`<pre>${escapar(tabla(filas))}</pre>`);
      i = j - 1;
      continue;
    }
    if (/^\s*>\s?/.test(l)) {
      const citas = [];
      let j = i;
      while (j < lineas.length && /^\s*>\s?/.test(lineas[j])) citas.push(lineas[j++].replace(/^\s*>\s?/, ''));
      salida.push(`<blockquote>${citas.map(enLinea).join('\n')}</blockquote>`);
      i = j - 1;
      continue;
    }
    const titulo = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (titulo) { salida.push(`<b>${enLinea(titulo[1])}</b>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { salida.push('──────────'); continue; }
    const vineta = /^(\s*)[-*+]\s+(.*)$/.exec(l);
    if (vineta) {
      const tarea = /^\[( |x|X)\]\s+(.*)$/.exec(vineta[2]);
      const marca = tarea ? (tarea[1] === ' ' ? '☐' : '☑') : '•';
      salida.push(`${'  '.repeat(Math.floor(vineta[1].length / 2))}${marca} ${enLinea(tarea ? tarea[2] : vineta[2])}`);
      continue;
    }
    salida.push(enLinea(l));
  }
  // (más de una línea en blanco seguida no suma nada en un chat)
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** markdown → texto sin marcas, para cuando Telegram rechaza el HTML. */
function plano(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n')
    .replace(/^\s*(```|~~~)[\w+#.-]*\s*$/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Los bloques de un markdown: párrafos, y bloques de código enteros. */
function bloques(md) {
  const lineas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lista = [];
  let actual = [];
  let enCodigo = null;
  const cerrar = () => { if (actual.length) lista.push(actual.join('\n')); actual = []; };
  for (const l of lineas) {
    const cerca = /^\s*(```|~~~)/.exec(l)?.[1];
    if (enCodigo) {
      actual.push(l);
      if (cerca === enCodigo) { enCodigo = null; cerrar(); }
      continue;
    }
    if (cerca) { cerrar(); enCodigo = cerca; actual.push(l); continue; }
    if (!l.trim()) { cerrar(); continue; }
    actual.push(l);
  }
  cerrar();
  return lista;
}

/** Un bloque que solo no entra en un mensaje: se corta por renglones (un
 *  bloque de código, en varios bloques de código). */
function cortarBloque(b, max) {
  const cerca = /^\s*(```|~~~)([\w+#.-]*)/.exec(b);
  const lineas = b.split('\n');
  const cuerpo = cerca ? lineas.slice(1, /^\s*(```|~~~)\s*$/.test(lineas[lineas.length - 1]) ? -1 : undefined) : lineas;
  const abre = cerca ? `${cerca[1]}${cerca[2]}\n` : '';
  const cierra = cerca ? `\n${cerca[1]}` : '';
  const pedazos = [];
  let actual = [];
  let largo = 0;
  for (let l of cuerpo) {
    // (un renglón que solo ya es demasiado: a la fuerza)
    while (l.length > max) { if (actual.length) { pedazos.push(actual); actual = []; largo = 0; } pedazos.push([l.slice(0, max)]); l = l.slice(max); }
    if (largo + l.length + 1 > max && actual.length) { pedazos.push(actual); actual = []; largo = 0; }
    actual.push(l);
    largo += l.length + 1;
  }
  if (actual.length) pedazos.push(actual);
  return pedazos.map((p) => `${abre}${p.join('\n')}${cierra}`);
}

/** markdown → los mensajes a mandar, cada uno { html, texto } por debajo del
 *  máximo de Telegram. */
function partir(md, max = MARGEN) {
  const salida = [];
  let actual = '';
  const cabe = (t) => aHtml(t).length <= max;
  const soltar = () => { if (actual.trim()) salida.push(actual); actual = ''; };
  for (const b of bloques(md)) {
    const junto = actual ? `${actual}\n\n${b}` : b;
    if (cabe(junto)) { actual = junto; continue; }
    soltar();
    if (cabe(b)) { actual = b; continue; }
    // (el HTML escapado mide más: se corta con margen)
    for (const p of cortarBloque(b, Math.floor(max * 0.6))) salida.push(p);
  }
  soltar();
  return salida.map((t) => ({ html: aHtml(t), texto: plano(t).slice(0, LARGO_MAX) })).filter((m) => m.html || m.texto);
}

module.exports = { aHtml, plano, partir, escapar, LARGO_MAX };
