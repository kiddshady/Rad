'use strict';

// Las tools de BlackCode que salen a la red: `fetch` (trae una página y la devuelve
// como texto legible), `web_search` (búsqueda en un servicio fijo: DuckDuckGo sin
// llave, Tavily o Brave con la llave del usuario) y `http_request` (hablarle a
// cualquier API HTTP, con los secretos como {{secret:NAME}} que el modelo
// nunca ve resueltos).
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código, y por eso
// algunos nombran cosas de aquella app (toolNeedsConfirm, el cifrado con
// DPAPI, la app de la que NeonCode había portado esto). El contrato de un
// runner es el de base.cjs.
//
// LO ÚNICO QUE CAMBIA respecto del original:
//
//   - Lo que allá se leía de globales de la app llega por configurar({ … }):
//       webSearch()      los ajustes de web_search, { provider, maxResults }.
//                        Era `config.webSearch`. Lo que falte se completa con
//                        los mismos valores por defecto: 'duckduckgo' y 5.
//       getKey(nombre)   una llave guardada, o null. web_search pide 'websearch'.
//       getSecret(nombre) el valor de un secreto con nombre, o null/undefined:
//                        es lo que reemplaza a {{secret:NOMBRE}} en http_request.
//     Sin configurar nada, DuckDuckGo y fetch andan igual, y un {{secret:…}}
//     falla como fallaba allá uno que no existe («missing secret(s)»), antes
//     de salir a la red.
//   - web_search SIN LLAVE busca de verdad (BlackCode 0.7.4). Allá, sin llave, iba a
//     la API de respuestas instantáneas de DuckDuckGo, que no es un buscador:
//     solo contesta cuando la consulta es el nombre de algo con ficha propia, y
//     para lo demás devuelve un JSON vacío (o un cuerpo vacío, que reventaba
//     como «Unexpected end of JSON input»). El modelo leía «No web results
//     found» para búsquedas que tienen miles de resultados. Ahora primero se
//     leen los resultados web de DuckDuckGo (wsDdgWeb) y la API instantánea
//     queda de segundo intento; y si la búsqueda no se pudo hacer, vuelve un
//     «error:» que lo dice, no un «sin resultados» que es mentira. Tavily y
//     Brave, con llave, no cambian.
//   - En el texto que lee el modelo, dónde se guarda un secreto o una llave es
//     «Settings» a secas (allá eran «Settings → Integrations» y «Settings →
//     Tools», secciones que BlackCode no tiene por qué repetir).
//
// Los mensajes, los límites y el orden de los chequeos son los mismos. Stop
// (run.ac.signal) aborta el pedido en las tres.

// ---------------------------------------------------------------------------
// Lo que pone la app. Los tres nombres de abajo (getKey, getSecret y
// webSearchConfig) existen para que el código portado los llame como llamaba
// a los de NeonCode.
// ---------------------------------------------------------------------------

let deps = {};

/** Recibe lo que este módulo necesita de la app. Se puede llamar más de una
 *  vez: lo nuevo pisa lo anterior y lo que no se nombra queda como estaba. */
function configurar(nuevas) {
  deps = { ...deps, ...(nuevas || {}) };
}

const getKey = (id) => (typeof deps.getKey === 'function' ? deps.getKey(id) : null);

const getSecret = (name) => (typeof deps.getSecret === 'function' ? deps.getSecret(name) : null);

// Los mismos valores con los que NeonCode completaba `config.webSearch` al
// cargar la configuración.
const WEB_SEARCH_DEFAULTS = { provider: 'duckduckgo', maxResults: 5 };

function webSearchConfig() {
  const w = typeof deps.webSearch === 'function' ? deps.webSearch() : null;
  return { ...WEB_SEARCH_DEFAULTS, ...(w && typeof w === 'object' ? w : {}) };
}

// ---------------------------------------------------------------------------
// http_request — hablarle a cualquier API HTTP (port de core/tools/http-request.js).
//
// Lo que lo hace distinto de `fetch`: métodos, headers y body — y sobre todo, que
// la API key NO pasa por el chat. El modelo escribe {{secret:NAME}}, main lo
// sustituye recién al salir, y todo lo que vuelve pasa por redact() que repone el
// placeholder. Eso último no es paranoia de más: lo que devuelve un runner se
// guarda en el chat, se re-inyecta en los turnos siguientes y se muestra en el
// chip, así que alcanza con que el server refleje la key en su respuesta para
// filtrarla.
//
// Divergencias contra Umbra:
//  - allá el gate era por método (GET/HEAD libres, escrituras confirmaban). Acá el
//    gate es global —manual pregunta por todo, auto por nada (ver toolNeedsConfirm)—
//    y un tercer modo por tool es justamente lo que se sacó a propósito. Lo que sí
//    se conserva es la asimetría donde todavía significa algo: el retry.
//  - devuelve string, por el contrato de runner de esta app.
// ---------------------------------------------------------------------------

const HTTP_MAX_BODY = 6000;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const HTTP_WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HTTP_IDEMPOTENT = new Set(['GET', 'HEAD']);
const HTTP_RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const HTTP_MAX_RETRIES = 2;
const HTTP_KEEP_HEADERS = ['content-type', 'content-length', 'location', 'retry-after',
  'x-ratelimit-remaining', 'x-ratelimit-reset'];
const HTTP_REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const HTTP_MAX_REDIRECTS = 5;

// Reintentar SOLO lo idempotente: re-mandar un POST puede duplicar la operación.
// Espera lo que diga Retry-After (segundos o fecha HTTP, tope 8s), si no backoff.
function httpBackoffMs(attempt, res) {
  const ra = res?.headers?.get('retry-after');
  if (ra) {
    const t = String(ra).trim();
    const secs = /^\d+$/.test(t) ? Number(t) : (Date.parse(t) - Date.now()) / 1000;
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 8000);
  }
  return Math.min(500 * (3 ** attempt), 8000);
}

const abortableSleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Cambia {{secret:NAME}} por el valor guardado. Los que no existen se juntan en
// `missing` (la llamada se corta antes de salir a la red) y los que sí, en `used`,
// para poder reponer el placeholder en todo lo que vuelva.
function resolveSecrets(str, missing, used) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{\s*secret:([A-Za-z0-9_.\-]+)\s*\}\}/g, (_, name) => {
    const v = getSecret(name);
    if (!v) { if (!missing.includes(name)) missing.push(name); return ''; }
    used.set(name, v);
    return v;
  });
}

async function runHttpRequest(run, { method = 'GET', url, headers, body, timeout } = {}) {
  const m = String(method || 'GET').toUpperCase();
  if (!HTTP_METHODS.includes(m)) return `error: method must be one of: ${HTTP_METHODS.join(', ')}`;
  const shownUrl = String(url || '').trim(); // con los placeholders intactos
  if (!shownUrl) return 'error: url is required';

  const missing = [];
  const used = new Map();
  const finalUrl = resolveSecrets(shownUrl, missing, used);

  // los headers pueden llegar como objeto o, según el modelo, como JSON string
  let hdrIn = headers;
  if (typeof hdrIn === 'string') { try { hdrIn = JSON.parse(hdrIn); } catch { hdrIn = null; } }
  const finalHeaders = {};
  // qué headers llevan un secreto YA resuelto adentro. Es lo que no puede cruzar
  // a otro origen si el servidor nos manda a pasear (ver seguirRedirects).
  const headersConSecreto = new Set();
  if (hdrIn && typeof hdrIn === 'object') {
    for (const [k, v] of Object.entries(hdrIn)) {
      finalHeaders[k] = resolveSecrets(String(v), missing, used);
      if (String(v) !== finalHeaders[k]) headersConSecreto.add(k.toLowerCase());
    }
  }
  const finalBody = (HTTP_WRITE.has(m) && body != null) ? resolveSecrets(String(body), missing, used) : undefined;
  const bodyConSecreto = finalBody !== undefined && String(body) !== finalBody;

  // Nada de lo que devolvemos puede llevar un secreto resuelto. Los muy cortos se
  // saltean: reponer un "secreto" de 3 caracteres destrozaría texto que no es la key.
  //
  // Y no alcanza con buscarlo tal cual: un servidor que hace eco (httpbin, un
  // error que repite el request) lo devuelve en la forma en que LO VIO, que no
  // es la que mandamos — la URL con %2B en vez de +, un JSON con \/ en vez de /,
  // un header pasado a base64. Cada forma se tapa con el mismo placeholder. Un
  // pedazo suelto del secreto o adentro de un base64 más largo no se puede
  // reconocer sin tapar texto ajeno, y queda afuera a sabiendas.
  const formasDe = (value) => {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const url = encodeURIComponent(value);
    return [...new Set([
      value,
      url,
      url.replace(/%[0-9A-F]{2}/g, (x) => x.toLowerCase()),
      url.replace(/%20/g, '+'),
      JSON.stringify(value).slice(1, -1),
      JSON.stringify(value).slice(1, -1).replace(/\//g, '\\/'),
      b64,
      b64.replace(/=+$/, ''),
      b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ])].filter((f) => f.length >= 4)
      // la más larga primero: si una forma contiene a otra, se tapa entera
      .sort((a, b) => b.length - a.length);
  };
  const redact = (s) => {
    let out = String(s ?? '');
    for (const [name, value] of used) {
      if (!value || value.length < 4) continue;
      for (const f of formasDe(value)) out = out.split(f).join(`{{secret:${name}}}`);
    }
    return out;
  };

  if (missing.length) {
    return `error: missing secret(s): ${missing.join(', ')} — the user adds them in Settings, or drop the {{secret:...}} placeholder`;
  }
  if (!/^https?:\/\//i.test(finalUrl)) return 'error: url must start with http:// or https://';

  let host = shownUrl;
  try { host = new URL(finalUrl).hostname; } catch { /* el label cae al url crudo */ }
  run.notify('tool:activity', { reqId: run.reqId, kind: 'http_request', label: `${m} ${host}` });

  const ms = Math.min(Math.max((Number(timeout) || 30) * 1000, 1000), 120000);
  const idempotent = HTTP_IDEMPOTENT.has(m);

  // REDIRECTS A MANO. Con `redirect: 'follow'` undici sigue el salto y vuelve a
  // mandar TODOS los headers al destino nuevo: un open redirect —o un host
  // comprometido— en el dominio que aprobaste se llevaba el `X-Api-Key` ya
  // resuelto a donde quisiera. Y el resultado seguía diciendo la URL que había
  // escrito el modelo, así que ni el chip, ni el ledger, ni la respuesta
  // registraban que el secreto había salido a otro dominio.
  const seguirRedirects = async () => {
    let target = finalUrl;
    let met = m;
    let hdrs = { ...finalHeaders };
    let bod = finalBody;
    let saltos = 0;
    let podado = false; // se dejó algo afuera al cruzar de origen
    for (;;) {
      const res = await fetch(target, {
        method: met, headers: hdrs, body: bod, redirect: 'manual',
        // el abort del turno y el timeout propio, juntos (mismo patrón que runFetch)
        signal: AbortSignal.any([run.ac.signal, AbortSignal.timeout(ms)]),
      });
      const loc = HTTP_REDIRECT_STATUS.has(res.status) ? res.headers.get('location') : null;
      if (!loc || saltos >= HTTP_MAX_REDIRECTS) return { res, target, saltos, podado };
      let next;
      try { next = new URL(loc, target); } catch { return { res, target, saltos, podado }; }
      // un redirect a otro esquema (file:, data:) no se sigue nunca
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return { res, target, saltos, podado };
      if (next.origin !== new URL(target).origin) {
        for (const k of Object.keys(hdrs)) {
          if (headersConSecreto.has(k.toLowerCase())) { delete hdrs[k]; podado = true; }
        }
        if (bodyConSecreto) { bod = undefined; podado = true; }
      }
      // 303 —y 301/302 sobre un método con cuerpo— degradan a GET, como todos los
      // clientes; sin esto un POST se reenviaría entero al destino nuevo
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && met !== 'GET' && met !== 'HEAD')) {
        met = 'GET';
        bod = undefined;
      }
      target = next.toString();
      saltos++;
    }
  };

  let res;
  let hop = { target: finalUrl, saltos: 0, podado: false };
  let attempt = 0;
  for (;;) {
    try {
      hop = await seguirRedirects();
      res = hop.res;
    } catch (err) {
      if (run.ac.signal.aborted) return 'error: http_request aborted';
      if (idempotent && attempt < HTTP_MAX_RETRIES) {
        attempt++;
        await abortableSleep(httpBackoffMs(attempt - 1, null), run.ac.signal);
        continue;
      }
      const why = err?.name === 'TimeoutError' ? `timed out after ${ms / 1000}s`
        : err?.name === 'AbortError' ? 'aborted'
        : redact(String(err?.message || err));
      const tries = attempt ? ` (after ${attempt} retr${attempt > 1 ? 'ies' : 'y'})` : '';
      return `error: http_request failed: ${why}${tries}`;
    }
    if (idempotent && HTTP_RETRY_STATUS.has(res.status) && attempt < HTTP_MAX_RETRIES) {
      attempt++;
      await abortableSleep(httpBackoffMs(attempt - 1, res), run.ac.signal);
      continue;
    }
    break;
  }

  const raw = await res.text();
  const shownBody = raw.length > HTTP_MAX_BODY
    ? `${raw.slice(0, HTTP_MAX_BODY)}\n…[${raw.length - HTTP_MAX_BODY} more chars truncated]`
    : raw;
  const hdrs = HTTP_KEEP_HEADERS.map((h) => [h, res.headers.get(h)]).filter(([, v]) => v)
    .map(([h, v]) => `${h}: ${v}`);
  // Un cuerpo de 4xx/5xx suele PARECER una respuesta válida (JSON de error, una
  // página HTML). La marca va adelante y sin ambigüedad para que el modelo no lo
  // lea como éxito — que es el error caro acá: seguir la cadena creyendo que anduvo.
  const marca = res.status >= 400
    ? `!! HTTP ${res.status} ${res.statusText} — the request did NOT succeed. Read the status and body below before trusting them.\n\n`
    : '';
  const tries = attempt ? ` [after ${attempt} retr${attempt > 1 ? 'ies' : 'y'}]` : '';
  // A DÓNDE TERMINÓ. Reportar solo la URL pedida convertía un redirect en una
  // mentira silenciosa: el modelo leía el cuerpo de otro host creyendo que era
  // el que había pedido. Si hubo saltos se dicen, y se dice también si al cruzar
  // de origen se dejaron headers afuera — porque eso explica un 401 que si no
  // parece un problema de la key.
  const saltoLinea = hop.saltos
    ? `\n→ followed ${hop.saltos} redirect${hop.saltos > 1 ? 's' : ''}, final URL: ${hop.target}`
      + (hop.podado ? '\n→ the redirect crossed to another origin: headers holding a {{secret:...}} were NOT sent to it' : '')
    : '';
  // se hace eco de la URL que escribió el modelo (con placeholders), nunca la enviada
  return redact(`${marca}${m} ${shownUrl}${saltoLinea}\nHTTP ${res.status} ${res.statusText}${tries}\n${hdrs.join('\n')}\n\n${shownBody || '(empty body)'}`);
}

// ---------------------------------------------------------------------------
// web_search (port de Umbra core/tools/web-search.js): búsqueda por API fija
// (sin URL arbitraria = sin SSRF). duckduckgo keyless / tavily / brave BYOK.
// La key vive solo acá (DPAPI) y se restriega de cualquier error.
// ---------------------------------------------------------------------------

async function wsDdg(query, count, signal) {
  const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&no_redirect=1';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Para lo que no tiene ficha contesta un 202 con el cuerpo vacío: eso es «no
  // tengo nada», no un error (res.json() reventaba ahí).
  const crudo = await res.text();
  let data = {};
  try { data = crudo.trim() ? JSON.parse(crudo) : {}; } catch { data = {}; }
  const results = [];
  if (data.AbstractText) results.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText });
  const walk = (topics) => {
    for (const t of topics || []) {
      if (results.length >= count) break;
      if (t.Topics) walk(t.Topics);
      else if (t.Text) results.push({ title: String(t.Text).split(' - ')[0], url: t.FirstURL || '', snippet: t.Text });
    }
  };
  walk(data.RelatedTopics);
  return results.slice(0, count);
}

// Los resultados web de DuckDuckGo, sin llave: su página de resultados en HTML
// liso (html.duckduckgo.com), que es la que sirve a los navegadores sin
// JavaScript. De cada resultado sale el título, la dirección de verdad (viene
// envuelta en un redirect de DuckDuckGo, en el parámetro uddg) y el resumen.
// Los avisos pagos se saltean. No es una API: si cambian el HTML deja de
// encontrar resultados, y por eso runWebSearch tiene un segundo intento.
const DDG_WEB = 'https://html.duckduckgo.com/html/?q=';
const textoDe = (html) => htmlToText(String(html || '')).replace(/\s+/g, ' ').trim();
function destinoDdg(href) {
  let h = String(href || '').replace(/&amp;/g, '&');
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    const real = u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/' ? u.searchParams.get('uddg') : null;
    return real || u.href;
  } catch { return ''; }
}
function leerResultadosDdg(html, count) {
  const out = [];
  const titulo = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const marcas = [...String(html).matchAll(titulo)];
  for (const [i, m] of marcas.entries()) {
    if (out.length >= count) break;
    const href = /\bhref="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const url = destinoDdg(href);
    // un aviso: su destino pasa por el contador de clics de DuckDuckGo
    if (!url || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const hasta = marcas[i + 1]?.index ?? html.length;
    const tramo = html.slice(m.index + m[0].length, hasta);
    const snippet = /<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(tramo)?.[1] ?? '';
    const title = textoDe(m[1]);
    if (title) out.push({ title, url, snippet: textoDe(snippet) });
  }
  return out;
}
async function wsDdgWeb(query, count, signal) {
  const res = await fetch(DDG_WEB + encodeURIComponent(query), {
    headers: { 'User-Agent': 'BlackCode/1.0 (local assistant)', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.8' },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const results = leerResultadosDdg(html, count);
  // sin resultados Y con su página de «parecés un robot»: no es «no hay nada»
  if (!results.length && /anomaly|challenge-form|unusual traffic/i.test(html)) throw new Error('DuckDuckGo asked for a human check instead of answering');
  return results;
}

async function wsTavily(query, count, key, signal) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: count, include_answer: false }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, date: r.published_date })).slice(0, count);
}

async function wsBrave(query, count, key, signal) {
  const url = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + count;
  const res = await fetch(url, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Brave marca lo que coincide con <strong> y manda entidades: se pasa a texto.
  return ((data.web && data.web.results) || []).map((r) => ({ title: textoDe(r.title), url: r.url, snippet: textoDe(r.description), date: r.page_age || r.age })).slice(0, count);
}

// La lista que lee el modelo. Arriba, de dónde salió; después un renglón por
// resultado: [n] título (fecha, si vino) — fragmento (dirección).
//
// Hasta la 0.12.2 la lista se cortaba en 2000 caracteres por renglones
// enteros, y cada fragmento iba como venía. Con los resúmenes cortos de
// DuckDuckGo entraban todos; con los de Tavily, que son largos, entraba uno
// solo: se pedían 5 y llegaba 1. Ahora el espacio se reparte: los fragmentos
// cortos van enteros y los largos se recortan hasta que entren todos.
const TOPE_LISTA = 4000;
const TOPE_TITULO = 160;
const SIN_FRAGMENTO = '(no readable excerpt)';

function recortar(s, tope) {
  if (s.length <= tope) return s;
  if (tope < 8) return '';
  const corte = s.slice(0, tope - 4);
  const espacio = corte.lastIndexOf(' ');
  return (espacio > tope * 0.6 ? corte.slice(0, espacio) : corte).trimEnd() + ' ...';
}

// Un fragmento que no es texto de la página sino su código: el buscador tomó
// el JSON o el HTML con que la página se arma (pasó con la documentación de
// Z.ai en Tavily). No le sirve al modelo y ocupa el lugar de los demás.
function pareceVolcado(s) {
  if (s.length < 60) return false;
  const escapes = (s.match(/\\u00[0-9a-f]{2}/gi) || []).length;
  const etiquetas = (s.match(/<\/?(script|style|link|meta|head)\b/gi) || []).length;
  const claves = (s.match(/"[\w-]+":\s*["{[\d]/g) || []).length;
  return escapes >= 2 || etiquetas >= 2 || claves >= 5;
}

function fechaDe(d) {
  const s = String(d ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = /\d{4}/.test(s) ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? s.slice(0, 30) : new Date(t).toISOString().slice(0, 10);
}

function listar(results, fuente) {
  const cabeza = `Web results from ${fuente}:`;
  const filas = results.map((r, i) => {
    const titulo = recortar(String(r.title || '').replace(/\s+/g, ' ').trim(), TOPE_TITULO);
    const fecha = fechaDe(r.date);
    let snippet = String(r.snippet || '').replace(/\s+/g, ' ').trim();
    if (pareceVolcado(snippet)) snippet = SIN_FRAGMENTO;
    return { antes: `[${i + 1}] ${titulo}${fecha ? ` (${fecha})` : ''} — `, snippet, despues: ` (${r.url || ''})` };
  });
  // Lo que queda para los fragmentos, y el largo máximo con el que entran
  // todos: los que miden menos no se tocan.
  const fijo = cabeza.length + filas.reduce((n, f) => n + 1 + f.antes.length + f.despues.length, 0);
  const libre = Math.max(0, TOPE_LISTA - fijo);
  const entran = (tope) => filas.reduce((n, f) => n + Math.min(f.snippet.length, tope), 0) <= libre;
  let tope = Math.max(...filas.map((f) => f.snippet.length));
  if (!entran(tope)) {
    let lo = 0;
    let hi = tope;
    while (lo < hi) {
      const medio = (lo + hi + 1) >> 1;
      if (entran(medio)) lo = medio; else hi = medio - 1;
    }
    tope = lo;
  }
  let body = cabeza;
  for (const f of filas) {
    const line = f.antes + recortar(f.snippet, tope) + f.despues;
    // por si los títulos y las direcciones solos ya no entran
    if (body.length + 1 + line.length <= TOPE_LISTA) body += '\n' + line;
  }
  return body === cabeza ? 'No web results found.' : body;
}

async function runWebSearch(run, { query, count } = {}) {
  const q = String(query || '').trim();
  if (!q) return 'error: query is required';
  run.notify('tool:activity', { reqId: run.reqId, kind: 'web_search', label: q.slice(0, 60) });
  const cfgW = webSearchConfig();
  const n = Math.max(1, Math.min(10, Number(count) || Number(cfgW.maxResults) || 5));
  const provider = cfgW.provider || 'duckduckgo';
  const key = getKey('websearch');
  const signal = AbortSignal.any([run.ac.signal, AbortSignal.timeout(8000)]);
  try {
    let results;
    let fuente = 'DuckDuckGo';
    if (provider === 'tavily') {
      if (!key) return 'error: web search needs a Tavily API key (Settings)';
      results = await wsTavily(q, n, key, signal);
      fuente = 'Tavily';
    } else if (provider === 'brave') {
      if (!key) return 'error: web search needs a Brave API key (Settings)';
      results = await wsBrave(q, n, key, signal);
      fuente = 'Brave';
    } else {
      // Sin llave: los resultados web de DuckDuckGo y, si no trajeron nada, su
      // API de respuestas instantáneas. Si la búsqueda web no se pudo hacer y
      // la otra tampoco trajo nada, es un error y se dice: «sin resultados»
      // sería afirmar algo que nadie comprobó.
      let fallo = null;
      try { results = await wsDdgWeb(q, n, signal); } catch (err) {
        if (signal.aborted) throw err;
        fallo = err;
      }
      if (!results?.length) {
        fuente = 'DuckDuckGo Instant Answers';
        try { results = await wsDdg(q, n, signal); } catch (err) {
          if (signal.aborted) throw err;
          fallo ??= err;
        }
      }
      if (!results?.length && fallo) throw fallo;
    }
    if (!results?.length) return 'No web results found.';
    return listar(results, fuente);
  } catch (err) {
    let msg = String(err?.message || err);
    if (key) msg = msg.split(key).join('***'); // jamás filtrar la key en un error
    return `error: web search failed: ${msg}`;
  }
}

// ---------------------------------------------------------------------------
// Tool `fetch`: trae una URL y la devuelve como texto legible (compartida)
// ---------------------------------------------------------------------------

const FETCH_CHAR_BUDGET = 6000;

// HTML → texto legible, sin dependencias: saca scripts/estilos/comentarios,
// convierte los cierres de bloque en saltos, tira el resto de tags y decodifica
// las entidades más comunes. No es un parser; alcanza para que el modelo lea.
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // decimales Y hexadecimales: solo estaban los decimales, así que las páginas
    // que escriben `&#x27;` o `&#x2019;` —que son mayoría— dejaban el código
    // crudo en el medio del texto que después lee el modelo.
    // fromCodePoint y no fromCharCode: arriba de U+FFFF (emojis, símbolos) el
    // segundo trunca a 16 bits y devuelve otro carácter.
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m0, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m0;
    })
    .replace(/&#(\d+);/g, (m0, n) => {
      const c = Number(n);
      return Number.isFinite(c) && c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : m0;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function runFetch(run, url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return 'error: url must be an absolute http:// or https:// address';
  run.notify('tool:activity', { reqId: run.reqId, kind: 'fetch', label: u }); // chip de transparencia
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'BlackCode/1.0 (local assistant)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
      },
      // aborta si el usuario frena el stream o si tarda más de 15s
      signal: AbortSignal.any([run.ac.signal, AbortSignal.timeout(15000)]),
    });
    const type = res.headers.get('content-type') || '';
    // `res.text()` decodifica SIEMPRE como UTF-8 e ignora el charset del header:
    // una página en windows-1252 o shift_jis volvía llena de caracteres de
    // reemplazo, sin ningún aviso, y el modelo leía eso como si fuera el
    // contenido. Se decodifica con el charset declarado cuando lo hay.
    const buf = Buffer.from(await res.arrayBuffer());
    const charset = (/charset=["']?([\w-]+)/i.exec(type)?.[1] || 'utf-8').toLowerCase();
    let raw;
    try {
      raw = new TextDecoder(charset, { fatal: false }).decode(buf);
    } catch {
      raw = buf.toString('utf8'); // charset que Node no conoce: se sigue como antes
    }
    const looksHtml = /html|xml/i.test(type) || /^\s*<(!doctype|html)/i.test(raw);
    let text = (looksHtml ? htmlToText(raw) : raw).trim();
    if (text.length > FETCH_CHAR_BUDGET) text = `${text.slice(0, FETCH_CHAR_BUDGET)}\n… [truncated]`;
    const head = `Fetched ${u} — HTTP ${res.status}`;
    return `${head}\n\n${text || '(empty body)'}`;
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? 'timed out (15s)'
      : err?.name === 'AbortError' ? 'aborted'
      : String(err?.message || err);
    return `error: could not fetch ${u} — ${why}`;
  }
}

// Los runners, con el nombre de cada tool y los mismos argumentos con que los
// llamaba la tabla TOOL_RUNNERS de NeonCode.
const runners = {
  web_search: (run, a) => runWebSearch(run, a),
  fetch: (run, a) => runFetch(run, a.url),
  http_request: (run, a) => runHttpRequest(run, a),
};

module.exports = {
  runners, configurar, htmlToText,
  runFetch, runWebSearch, runHttpRequest,
  resolveSecrets, httpBackoffMs, abortableSleep, wsDdg, wsDdgWeb, leerResultadosDdg, wsTavily, wsBrave,
  FETCH_CHAR_BUDGET, HTTP_MAX_BODY, HTTP_METHODS, HTTP_WRITE, HTTP_IDEMPOTENT,
  HTTP_RETRY_STATUS, HTTP_MAX_RETRIES, HTTP_KEEP_HEADERS, HTTP_REDIRECT_STATUS,
  HTTP_MAX_REDIRECTS, WEB_SEARCH_DEFAULTS,
};
