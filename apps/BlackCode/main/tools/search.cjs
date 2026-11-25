'use strict';

// La tool de búsqueda en código de BlackCode: code_search, que busca texto adentro
// de los archivos (modo "content") o lista archivos por nombre (modo "files").
// El recorrido no corre acá: lo hace code-search-worker.cjs, un proceso hijo
// que se puede matar, lanzado con el binario de la propia app como Node
// (process.execPath + ELECTRON_RUN_AS_NODE; con node pelado la variable no
// molesta y anda igual).
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código.
//
// Lo que se adaptó, y nada más:
//   - resolverEn y truncateOut salen de base.cjs en vez de ser vecinos del
//     mismo archivo.
//   - runProc era un global del archivo grande. Acá arranca con el de
//     shell.cjs y configurar({ runProc }) lo cambia (para un test).
//   - El worker se llama code-search-worker.cjs y se busca al lado de este
//     archivo (en NeonCode era code-search-worker.js al lado de main.js).
//   - El nombre de TOOL_RUNNERS (code_search) es `runners`.
//
// Empaquetado: el worker tiene que viajar con la app. NeonCode lo lista en
// `files` y además en `asarUnpack`.
//
// El contrato de un runner está en la cabecera de base.cjs.

const fs = require('node:fs');
const path = require('node:path');

const { resolverEn, truncateOut, getReservada } = require('./base.cjs');

let runProc = require('./shell.cjs').runProc;

/** Lo que este módulo necesita de afuera. Todo es opcional: sin llamarla
 *  queda el runProc de shell.cjs. */
function configurar(deps = {}) {
  if (typeof deps.runProc === 'function') runProc = deps.runProc;
}

// Techo de lo que se lee del worker. No es el tope de lo que ve el modelo —eso
// lo sigue poniendo truncateOut sobre los resultados ya parseados—: es el techo
// de memoria del main mientras el hijo escribe.
const CODE_SEARCH_MAX_CHARS = 2 * 1024 * 1024;

// Cero resultados en modo LITERAL con un patrón que tiene pinta de regex: lo
// más probable es que se haya querido una regex. Un agente escribió
// `encargo|Encargos`, no encontró nada (se buscó el texto con la barra
// incluida) y concluyó que la palabra no estaba en el proyecto. «No está» es
// la conclusión más peligrosa que puede sacar de una búsqueda, así que el
// resultado se lo advierte. No cambia qué se busca: un `|` literal se sigue
// pudiendo buscar.
// (Solo lo que casi nunca se busca tal cual. Quedan afuera a propósito `\d` y
// `\s` —una ruta de Windows los trae: C:\docs\src— y los paréntesis solos
// —`f()` es una búsqueda de lo más común—.)
const DE_REGEX = [[/\|/, '|'], [/\.[*+?]/, '.*'], [/\[\^?[^\]]*[a-zA-Z0-9]-[a-zA-Z0-9][^\]]*\]/, 'a class like [a-z]'], [/\([^)]*\)[*+?]/, '(…)*'], [/^\^/, '^']];
function pistaLiteral(modo, pattern, regex) {
  if (modo !== 'content' || regex) return '';
  const cual = DE_REGEX.find(([r]) => r.test(String(pattern)));
  return cual ? ` — searched as LITERAL text, and the pattern contains ${cual[1]}: if you meant a regular expression ("a|b" as a-or-b), run it again with regex=true. As it stands this does not show the words are absent.` : '';
}

async function runCodeSearch(run, { mode, pattern, glob, path: root, regex, case_sensitive, max_results } = {}) {
  const m = mode === 'files' ? 'files' : 'content';
  if (m === 'content' && !pattern) return 'error: pattern is required for content mode';
  if (m === 'files' && !glob) return 'error: glob is required for files mode';
  const searchRoot = resolverEn(run, root || '.');
  if (!fs.existsSync(searchRoot)) return `error: path does not exist: ${searchRoot}`;
  run.notify('tool:activity', { reqId: run.reqId, kind: 'code_search', label: m === 'content' ? String(pattern) : String(glob) });
  // (`exclude`: buscando desde más arriba, la carpeta de la app no se recorre)
  const opts = { root: searchRoot, mode: m, pattern, glob, regex: !!regex, case_sensitive: !!case_sensitive, max_results, ...(getReservada() ? { exclude: getReservada() } : {}) };
  // el scan corre en un proceso hijo killeable (un regex malicioso no congela el main)
  const r = await runProc({
    bin: process.execPath,
    args: [path.join(__dirname, 'code-search-worker.cjs'), JSON.stringify(opts)],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeoutMs: 15000,
    signal: run.ac.signal,
    // Esta salida NO se muestra: se parsea. Un recorte por la mitad no la
    // acorta, la vuelve JSON inválido, así que el tope tiene que dejar entrar
    // el peor caso del worker (1000 resultados × 500 chars de línea + rutas)
    // con lugar de sobra. Sigue siendo un techo: sin él, `out += d` no tenía.
    maxChars: CODE_SEARCH_MAX_CHARS,
  });
  if (r.timedOut) return 'error: search timed out (pattern too broad or tree too large)';
  // Decir "search failed" de algo que el usuario cortó es la misma clase de
  // hecho fabricado que el "[timed out]" de un Stop.
  if (r.aborted) return 'error: search stopped';
  // Un JSON recortado no parsea, y el catch de abajo lo contaría como falla del
  // worker: el worker anduvo bien, lo que no entró fue la respuesta.
  if (r.cortado) return 'error: search returned too much to read back — narrow it with `path`, `glob` or a smaller `max_results`';
  let data;
  try { data = JSON.parse(r.out); } catch { return `error: search failed${r.err ? ` — ${truncateOut(r.err)}` : ''}`; }
  if (!data.ok) return `error: ${data.error || 'search failed'}`;
  const qué = m === 'content' ? `"${pattern}"` : glob;
  // El walk se corta a los MAX_FILES archivos. Decir "No matches" cuando dejamos
  // de mirar es afirmar un hecho que no se verificó: el modelo lo toma como que
  // no existe y sigue de largo. Cero resultados con el árbol a medio caminar es
  // una respuesta incompleta y tiene que decirlo.
  if (!data.results.length) {
    if (data.walkCapped) {
      return `No matches for ${qué} in the first ${data.filesWalked} files under ${searchRoot} — the walk stopped at its ${data.maxFiles}-file cap, so the tree was NOT fully searched. This is not proof the pattern is absent: narrow it with \`path\` or \`glob\` and search again.`;
    }
    return `No matches for ${qué} under ${searchRoot}${pistaLiteral(m, pattern, regex)}`;
  }
  const notas = [
    data.truncated ? 'truncated at limit' : null,
    data.walkCapped ? `walk stopped at the first ${data.maxFiles} files` : null,
  ].filter(Boolean);
  const head = `${data.results.length} result${data.results.length > 1 ? 's' : ''}${notas.length ? ` (${notas.join('; ')})` : ''} under ${searchRoot}:`;
  return truncateOut(`${head}\n${data.results.join('\n')}`);
}

const runners = {
  code_search: (run, a) => runCodeSearch(run, a),
};

module.exports = {
  pistaLiteral, runners, configurar, runCodeSearch, CODE_SEARCH_MAX_CHARS };
