// NeonCode — diff por líneas. Puro: sin dependencias, sin estado, sin disco.
//
// Existe para una sola pregunta: ANTES de aprobar una escritura, ¿qué cambia?
// La tarjeta de confirmación mostraba el contenido NUEVO y nada más, así que
// pisar un archivo de 3000 líneas se aprobaba mirando lo que iba a quedar, nunca
// lo que se iba a perder. Un diff es la única forma de que ese OK sea informado.
//
// Se usa en el main (calcula) y viaja armado al renderer (pinta). El renderer no
// ve nunca el archivo viejo: lo que cruza el puente son hunks, no contenido.
//
// Por qué a mano y no una librería: son 200 líneas, el resultado va a una
// tarjeta de 640px y no a un `patch`, y una dependencia nueva acá se paga en el
// instalador y en la lista blanca de build.files para siempre.
//
// Portado de NeonCode 1.11.3 (diff.js) a BlackCode, el archivo entero y sin cambios.
'use strict';

// Cuántas celdas de DP nos permitimos antes de buscar otro camino. 2M en Int32
// son 8MB — se libera al salir, y es un techo que en la práctica solo tocan los
// archivos grandes reescritos enteros.
const LCS_CELLS = 2_000_000;
// Hasta dónde baja el anclaje antes de rendirse. Cada nivel achica el problema
// de verdad (se come al menos el ancla), así que 6 no se alcanza nunca con
// entradas reales; está para que un caso patológico corte y no cuelgue la app.
const MAX_DEPTH = 6;

// El \r se va del contenido de la línea, no del archivo: acá solo se compara.
// Quien escribe (fs_edit) restaura el final de línea original — si el CRLF
// llegara hasta esta comparación, en un archivo de Windows CADA línea saldría
// distinta de sí misma cuando el modelo manda \n, que es el 100% de las veces.
function splitLines(text) {
  const s = String(text ?? '');
  if (!s) return { lines: [], endsNl: false };
  const norm = s.replace(/\r\n?/g, '\n');
  const endsNl = norm.endsWith('\n');
  const lines = norm.split('\n');
  // El '' final de un archivo terminado en newline no es una línea: es el
  // newline. Se lo saca del arreglo y se lo recuerda aparte, si no toda
  // comparación arrastra una línea vacía de mentira al final.
  if (endsNl) lines.pop();
  return { lines, endsNl };
}

// ---------------------------------------------------------------------------
// LCS clásico. Solo se llama cuando el rectángulo entra en LCS_CELLS.
// ---------------------------------------------------------------------------
function lcsOps(A, B, out) {
  const n = A.length;
  const m = B.length;
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = A[i] === B[j]
        ? dp[(i + 1) * W + (j + 1)] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; }
    // El empate se resuelve SIEMPRE para el mismo lado (borrar antes que
    // agregar): sin un criterio fijo, dos diffs del mismo par de archivos
    // podrían no coincidir, y una tarjeta que muestra algo distinto cada vez
    // no sirve para revisar nada.
    else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) { out.push({ t: '-', s: A[i] }); i++; }
    else { out.push({ t: '+', s: B[j] }); j++; }
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
}

// ---------------------------------------------------------------------------
// Anclas: las líneas que aparecen UNA sola vez de los dos lados.
//
// Es lo que salva al caso que más importa —un archivo grande reescrito entero,
// donde el rectángulo del DP no entra ni cerca—. Una línea única en los dos
// archivos casi con seguridad es "la misma línea", así que sirve de clavo: se
// parte el problema ahí y cada pedazo entre clavos ya es chico.
//
// Sin esto, un archivo de 7000 líneas con un cambio en la primera daba un diff
// de 7000 borrados y 7000 agregados: técnicamente cierto e inútil.
// ---------------------------------------------------------------------------
function uniqueAnchors(A, B) {
  const cA = new Map();
  const cB = new Map();
  for (const l of A) cA.set(l, (cA.get(l) || 0) + 1);
  for (const l of B) cB.set(l, (cB.get(l) || 0) + 1);
  const posB = new Map();
  for (let j = 0; j < B.length; j++) if (cB.get(B[j]) === 1) posB.set(B[j], j);
  const pairs = [];
  for (let i = 0; i < A.length; i++) {
    if (cA.get(A[i]) === 1 && cB.get(A[i]) === 1) pairs.push([i, posB.get(A[i])]);
  }
  return longestIncreasing(pairs);
}

// Subsecuencia creciente más larga sobre la segunda coordenada (patience
// sorting, O(n log n)). Hace falta de verdad: los pares vienen ordenados por su
// posición en A, pero si un bloque se MOVIÓ sus anclas van para atrás en B, y
// anclar sobre pares cruzados daría un diff sin sentido. El goloso (quedarse
// con lo que crece) resolvía el cruce tirando anclas de más.
function longestIncreasing(pairs) {
  if (pairs.length < 2) return pairs;
  const tails = [];   // índices en `pairs` del último par de cada largo
  const prev = new Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    const j = pairs[k][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out = [];
  for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

// Un rango contra otro. Recorta lo común de las puntas, prueba el DP, y si no
// entra parte por anclas y baja un nivel.
function diffRange(A, B, out, depth) {
  if (!A.length && !B.length) return;
  if (!A.length) { for (const s of B) out.push({ t: '+', s }); return; }
  if (!B.length) { for (const s of A) out.push({ t: '-', s }); return; }

  // Las puntas comunes también aparecen adentro de cada pedazo entre anclas, y
  // recortarlas acá es lo que hace que el DP entre en la mayoría de los casos.
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p
    && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  for (let k = 0; k < p; k++) out.push({ t: ' ', s: A[k] });
  const midA = A.slice(p, A.length - s);
  const midB = B.slice(p, B.length - s);

  if (midA.length && midB.length) {
    if (midA.length * midB.length <= LCS_CELLS) {
      lcsOps(midA, midB, out);
    } else {
      const anchors = depth < MAX_DEPTH ? uniqueAnchors(midA, midB) : [];
      if (!anchors.length) {
        // Sin un solo clavo no hay cómo alinear: se declara el bloque entero
        // reemplazado. Es honesto (eso es lo que pasa) aunque sea grueso.
        for (const l of midA) out.push({ t: '-', s: l });
        for (const l of midB) out.push({ t: '+', s: l });
      } else {
        let ai = 0;
        let bi = 0;
        for (const [i, j] of anchors) {
          diffRange(midA.slice(ai, i), midB.slice(bi, j), out, depth + 1);
          out.push({ t: ' ', s: midA[i] });
          ai = i + 1;
          bi = j + 1;
        }
        diffRange(midA.slice(ai), midB.slice(bi), out, depth + 1);
      }
    }
  } else if (midA.length) {
    for (const l of midA) out.push({ t: '-', s: l });
  } else if (midB.length) {
    for (const l of midB) out.push({ t: '+', s: l });
  }

  for (let k = A.length - s; k < A.length; k++) out.push({ t: ' ', s: A[k] });
}

// ---------------------------------------------------------------------------
// Agrupado en hunks: los cambios con `context` líneas alrededor, y lo que queda
// lejos de cualquier cambio no se manda. Una tarjeta no es un archivo.
// ---------------------------------------------------------------------------
function toHunks(ops, context, maxLines) {
  const hunks = [];
  let oldNo = 0;
  let newNo = 0;
  let cur = null;      // hunk abierto
  let pend = [];       // contexto candidato a encabezar el próximo hunk
  let total = 0;
  let cortadas = 0;

  const cerrar = () => {
    if (!cur) return;
    const first = cur.lines[0];
    hunks.push({
      oldStart: first.oldNo ?? first.newNo,
      newStart: first.newNo ?? first.oldNo,
      lines: cur.lines,
    });
    cur = null;
  };

  for (const op of ops) {
    const line = {
      t: op.t,
      s: op.s,
      oldNo: op.t === '+' ? null : ++oldNo,
      newNo: op.t === '-' ? null : ++newNo,
    };
    if (op.t === ' ') {
      if (cur) {
        cur.tail.push(line);
        if (cur.tail.length > context) {
          // el hunk ya tiene su contexto de salida completo: se cierra, y lo
          // que sobra queda de candidato para el que venga
          cur.lines.push(...cur.tail.slice(0, context));
          const sobra = cur.tail.slice(context);
          cerrar();
          pend = sobra.slice(-context);
        }
      } else {
        pend.push(line);
        if (pend.length > context) pend.shift();
      }
      continue;
    }
    if (total >= maxLines) { cortadas++; continue; }
    if (!cur) { cur = { lines: pend, tail: [] }; total += pend.length; pend = []; }
    else if (cur.tail.length) { cur.lines.push(...cur.tail); total += cur.tail.length; cur.tail = []; }
    cur.lines.push(line);
    total++;
  }
  if (cur) { cur.lines.push(...cur.tail.slice(0, context)); cerrar(); }
  return { hunks, cortadas };
}

// ---------------------------------------------------------------------------
// La entrada pública.
//
//   diffLines(viejo, nuevo) -> {
//     changed, added, removed,
//     hunks: [{ oldStart, newStart, lines: [{ t: ' '|'+'|'-', s, oldNo, newNo }] }],
//     truncated,      // cambios que no entraron en maxLines
//     newlineChange,  // cambió el newline final y no se ve en ninguna línea
//   }
// ---------------------------------------------------------------------------
function diffLines(oldText, newText, { context = 3, maxLines = 600 } = {}) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = [];
  diffRange(a.lines, b.lines, ops, 0);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.t === '+') added++;
    else if (op.t === '-') removed++;
  }
  const { hunks, cortadas } = toHunks(ops, context, maxLines);
  return {
    changed: added > 0 || removed > 0 || a.endsNl !== b.endsNl,
    added,
    removed,
    hunks,
    truncated: cortadas,
    // Un archivo al que solo se le agregó (o sacó) el newline final no tiene
    // NINGUNA línea distinta: sin este aviso la tarjeta diría "sin cambios"
    // sobre una escritura que sí cambia el archivo.
    newlineChange: a.endsNl !== b.endsNl,
  };
}

module.exports = { diffLines, splitLines };
