// Test de las tools de red de Nix (apps/Nix/main/tools/web.cjs): fetch,
// web_search y http_request. Con node pelado y SIN red: `globalThis.fetch` se
// cambia por uno falso que graba cada pedido y responde con un guion, y al
// terminar se repone el de verdad. Un pedido que nadie guionó hace fallar el
// test en vez de salir a internet.
// Uso: node tools/test-nix-tools-web.mjs
//
// Las comprobaciones de http_request (los secretos, los redirects y la
// redacción) vienen de scripts/test-http-secrets.js de NeonCode 1.11.3, con
// sus comentarios. Allá el código se sacaba del texto de main.js con una
// regex; acá se importa el módulo.
//
// http_request es el ÚNICO camino por el que una credencial guardada sale de la
// máquina, y su seguridad la sostienen cuatro piezas:
//
//   resolveSecrets    sustituye {{secret:NAME}} por el valor guardado;
//   redact            repone el placeholder en TODO lo que vuelve, porque el
//                     resultado se persiste en el chat y se re-inyecta en los
//                     turnos siguientes;
//   redirect:'manual' undici con 'follow' reenvía todos los headers al destino
//                     nuevo, así que los saltos se caminan a mano;
//   la poda           cuando el salto cruza de origen, lo que lleva un secreto
//                     resuelto no viaja.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = require(path.join(ROOT, 'apps', 'Nix', 'main', 'tools', 'web.cjs'));
const { runners, configurar, htmlToText, httpBackoffMs, abortableSleep, resolveSecrets } = web;

const failures = [];
let total = 0;
const check = (ok, msg) => { total++; if (!ok) failures.push(msg); };
const igual = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want),
  `${msg}: esperaba ${JSON.stringify(want)}, dio ${JSON.stringify(got)}`);
const corto = (s) => { const x = String(s); return x.length > 300 ? `${x.slice(0, 300)}…` : x; };

// ── el banco ────────────────────────────────────────────────────────────────

const fetchDeVerdad = globalThis.fetch;
const sinGuion = async (url) => { throw new Error(`el test intentó salir a la red: ${url}`); };
globalThis.fetch = sinGuion;

const SECRETOS = { OPENAI: 'sk-clave-secreta-larguisima-1234', CORTO: 'abc', RARO: 'ab+cd/ef gh"ij=' };
const sinConfigurar = () => configurar({ webSearch: null, getKey: null, getSecret: null });
const conSecretos = () => configurar({ getSecret: (n) => SECRETOS[n] || null });

/** Instala un fetch falso. `guion` es una función (url, init, n) → lo que
 *  responde: { status, statusText, headers, body } donde body es un string, o
 *  { bytes } con un Buffer, o { json } con un objeto. Si tira, el fetch tira.
 *  Como el de verdad, un pedido con la señal abortada no sale. */
function banco(guion) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method,
      headers: { ...(init?.headers || {}) },
      body: init?.body,
      redirect: init?.redirect,
      signal: init?.signal,
    });
    if (init?.signal?.aborted) {
      const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e;
    }
    const r = (await guion(String(url), init, requests.length - 1)) || {};
    const h = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const status = r.status ?? 200;
    const texto = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? '');
    const bytes = r.bytes ?? Buffer.from(texto, 'utf8');
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: r.statusText ?? 'OK',
      headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
      text: async () => texto,
      json: async () => JSON.parse(texto),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  return requests;
}

/** Un fetch que se queda esperando hasta que le abortan la señal, como uno de
 *  verdad con el servidor mudo. */
function bancoColgado() {
  const requests = [];
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    requests.push({ url: String(url) });
    const cortar = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; reject(e); };
    if (init?.signal?.aborted) return cortar();
    init?.signal?.addEventListener('abort', cortar, { once: true });
  });
  return requests;
}

const hacerRun = () => {
  const filas = [];
  return { reqId: 'r1', ac: new AbortController(), filas, notify(ch, p) { filas.push({ ch, ...p }); } };
};
const http = (args, run = hacerRun()) => runners.http_request(run, args);

try {
  // ═══ la forma del módulo ══════════════════════════════════════════════════
  igual(Object.keys(runners).sort(), ['fetch', 'http_request', 'web_search'], 'runners: las tres tools');
  check(typeof configurar === 'function' && typeof htmlToText === 'function', 'el módulo exporta configurar y htmlToText');

  // ═══ http_request · el secreto sale resuelto y vuelve tapado ══════════════
  conSecretos();

  {
    const requests = banco(() => ({ body: 'hola' }));
    const run = hacerRun();
    const out = await http({
      url: 'https://api.ejemplo.com/v1/x',
      headers: { Authorization: 'Bearer {{secret:OPENAI}}' },
    }, run);
    igual(requests[0].headers.Authorization, `Bearer ${SECRETOS.OPENAI}`, 'el header sale con el valor de verdad');
    check(!out.includes(SECRETOS.OPENAI), `en el resultado el valor aparece: ${corto(out)}`);
    check(out.includes('https://api.ejemplo.com/v1/x'), 'la URL no se hace eco tal como la escribió el modelo');
    igual(run.filas, [{ ch: 'tool:activity', reqId: 'r1', kind: 'http_request', label: 'GET api.ejemplo.com' }],
      'http_request avisa a la interfaz antes de salir');
  }

  {
    // El resultado se PERSISTE en el chat y se re-inyecta en los turnos
    // siguientes: si el cuerpo devuelve la key, queda ahí para siempre.
    banco(() => ({ body: `tu key es ${SECRETOS.OPENAI} , cuidala` }));
    const out = await http({
      url: 'https://api.ejemplo.com/x',
      headers: { Authorization: 'Bearer {{secret:OPENAI}}' },
    });
    check(!out.includes(SECRETOS.OPENAI), `un eco del secreto en el CUERPO no se tapó: ${corto(out)}`);
    check(out.includes('{{secret:OPENAI}}'), `no se repuso el placeholder: ${corto(out)}`);
  }

  {
    // 1.11.3: un eco no devuelve el secreto como lo mandamos sino como lo VIO
    // el servidor. Cada forma tiene que volver tapada igual.
    const v = SECRETOS.RARO;
    const b64 = Buffer.from(v).toString('base64');
    const formas = {
      'URL-encoded': encodeURIComponent(v),
      'URL-encoded en minúsculas': encodeURIComponent(v).replace(/%[0-9A-F]{2}/g, (x) => x.toLowerCase()),
      'form (+ por espacio)': encodeURIComponent(v).replace(/%20/g, '+'),
      'escapado en JSON': JSON.stringify(v).slice(1, -1),
      'JSON con \\/': JSON.stringify(v).slice(1, -1).replace(/\//g, '\\/'),
      base64: b64,
      'base64 sin relleno': b64.replace(/=+$/, ''),
      base64url: b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    };
    for (const [nombre, forma] of Object.entries(formas)) {
      banco(() => ({ body: `eco: [${forma}]` }));
      const out = await http({ url: 'https://api.ejemplo.com/x', headers: { 'X-Key': '{{secret:RARO}}' } });
      check(!out.includes(forma) && out.includes('eco: [{{secret:RARO}}]'), `un eco ${nombre} no se tapó: ${corto(out)}`);
    }
  }

  {
    banco(() => ({ body: 'abcdefg abc' }));
    const out = await http({ url: 'https://api.ejemplo.com/x', headers: { X: '{{secret:CORTO}}' } });
    // reponer un "secreto" de 3 caracteres destrozaría texto que no es la key
    check(out.includes('abcdefg'), `un secreto muy corto se repuso y destrozó el texto: ${corto(out)}`);
  }

  {
    const requests = banco(() => ({}));
    const out = await http({ url: 'https://api.ejemplo.com/x', headers: { A: '{{secret:NO_EXISTE}}' } });
    check(/missing secret/.test(out), `un secreto que no existe no cortó: ${corto(out)}`);
    igual(requests.length, 0, 'un secreto que no existe: no se manda nada');
    igual(out, 'error: missing secret(s): NO_EXISTE — the user adds them in Settings, or drop the {{secret:...}} placeholder',
      'el mensaje del secreto que falta');
  }

  {
    // el secreto en la URL y en el cuerpo: salen resueltos, y lo que vuelve
    // muestra la URL que escribió el modelo
    const requests = banco(() => ({ body: 'ok' }));
    const run = hacerRun();
    const out = await http({
      method: 'post', url: 'https://api.ejemplo.com/x?key={{ secret:OPENAI }}',
      headers: '{"Content-Type":"application/json"}', body: '{"k":"{{secret:OPENAI}}"}',
    }, run);
    igual(requests[0].url, `https://api.ejemplo.com/x?key=${SECRETOS.OPENAI}`, 'el secreto en la URL sale resuelto');
    igual(requests[0].body, `{"k":"${SECRETOS.OPENAI}"}`, 'el secreto en el cuerpo sale resuelto');
    igual(requests[0].method, 'POST', 'el método se pasa a mayúsculas');
    igual(requests[0].headers['Content-Type'], 'application/json', 'los headers como JSON string se aceptan');
    check(out.startsWith('POST https://api.ejemplo.com/x?key={{ secret:OPENAI }}\n'), `el eco de la URL no conserva el placeholder: ${corto(out)}`);
    check(!out.includes(SECRETOS.OPENAI), 'el secreto de la URL aparece en el resultado');
    igual(run.filas[0].label, 'POST api.ejemplo.com', 'el rótulo de la actividad lleva el host, no la URL con la key');
  }

  {
    // un GET no lleva cuerpo aunque el modelo lo mande
    const requests = banco(() => ({ body: 'ok' }));
    await http({ url: 'https://api.ejemplo.com/x', body: 'no va' });
    igual(requests[0].body, undefined, 'un GET no manda cuerpo');
  }

  {
    // un error de red que repite la URL con la key adentro también se tapa
    banco((url) => { throw new Error(`connect ECONNREFUSED ${url}`); });
    const out = await http({ method: 'POST', url: 'https://api.ejemplo.com/x?key={{secret:OPENAI}}', body: 'x' });
    check(out.startsWith('error: http_request failed: connect ECONNREFUSED'), `el error de red no vino como error: ${corto(out)}`);
    check(!out.includes(SECRETOS.OPENAI) && out.includes('{{secret:OPENAI}}'), `el error de red filtró el secreto: ${corto(out)}`);
  }

  // sin configurar nada, un placeholder falla igual que un secreto que no existe
  sinConfigurar();
  {
    const requests = banco(() => ({}));
    const out = await http({ url: 'https://api.ejemplo.com/x?k={{secret:OPENAI}}' });
    igual(out, 'error: missing secret(s): OPENAI — the user adds them in Settings, or drop the {{secret:...}} placeholder',
      'sin getSecret, un placeholder falla como un secreto que no existe');
    igual(requests.length, 0, 'sin getSecret: no se manda nada');
    const missing = []; const used = new Map();
    igual(resolveSecrets('a {{secret:X}} b {{secret:X}} {{secret:Y.z-1}}', missing, used), 'a  b  ', 'resolveSecrets sin valores deja el hueco');
    igual(missing, ['X', 'Y.z-1'], 'resolveSecrets junta los que faltan, sin repetir');
    igual(resolveSecrets(42, missing, used), 42, 'resolveSecrets deja pasar lo que no es texto');
  }
  conSecretos();

  // ═══ http_request · los saltos se caminan a mano ══════════════════════════

  {
    const requests = banco(() => ({ body: 'ok' }));
    await http({ url: 'https://api.ejemplo.com/x' });
    igual(requests[0].redirect, 'manual', 'el fetch va con redirect manual, nunca follow');
  }

  {
    // EL caso: un dominio aprobado que responde 302 a otro origen. Con
    // redirect:'follow' undici le entregaba la key ya resuelta a evil.example.
    const requests = banco((url) => (
      url.startsWith('https://api.ejemplo.com')
        ? { status: 302, headers: { location: 'https://evil.example/collect' } }
        : { body: 'gracias' }
    ));
    const out = await http({
      url: 'https://api.ejemplo.com/x',
      headers: { Authorization: 'Bearer {{secret:OPENAI}}', Accept: 'application/json' },
    });
    igual(requests.length, 2, 'cruce de origen: se siguieron dos requests');
    igual(requests[0].headers.Authorization, `Bearer ${SECRETOS.OPENAI}`, 'cruce de origen: el primero SÍ lleva el header con secreto');
    igual(requests[1].headers.Authorization, undefined, 'cruce de origen: el segundo NO');
    igual(requests[1].headers.Accept, 'application/json', 'cruce de origen: los headers sin secreto sí viajan');
    check(out.includes('evil.example/collect'), `cruce de origen: el resultado no dice a dónde terminó: ${corto(out)}`);
    check(/crossed to another origin/.test(out), `cruce de origen: no dice que se podó: ${corto(out)}`);
  }

  {
    // Mismo origen: no hay nada que podar, y podar de más rompe APIs que
    // redirigen adentro de su propio dominio.
    const requests = banco((url) => (
      url.endsWith('/x')
        ? { status: 302, headers: { location: 'https://api.ejemplo.com/y' } }
        : { body: 'ok' }
    ));
    const out = await http({ url: 'https://api.ejemplo.com/x', headers: { Authorization: 'Bearer {{secret:OPENAI}}' } });
    igual(requests[1].headers.Authorization, `Bearer ${SECRETOS.OPENAI}`, 'un salto DENTRO del mismo origen conserva el header');
    check(!/crossed to another origin/.test(out), `mismo origen: dice que podó: ${corto(out)}`);
    check(/followed 1 redirect/.test(out), `mismo origen: no dice que hubo un salto: ${corto(out)}`);
  }

  {
    // una Location relativa se resuelve contra la URL del salto
    const requests = banco((url) => (
      url.endsWith('/a/x') ? { status: 301, headers: { location: '../y?z=1' } } : { body: 'ok' }
    ));
    await http({ url: 'https://api.ejemplo.com/a/x' });
    igual(requests[1]?.url, 'https://api.ejemplo.com/y?z=1', 'una Location relativa se resuelve contra el salto');
  }

  {
    // El cuerpo también: un POST con la key adentro no puede reenviarse a otro
    // origen.
    const requests = banco((url) => (
      url.startsWith('https://api.ejemplo.com')
        ? { status: 307, headers: { location: 'https://evil.example/x' } }
        : { body: 'ok' }
    ));
    await http({
      method: 'POST', url: 'https://api.ejemplo.com/x',
      body: JSON.stringify({ key: '{{secret:OPENAI}}' }),
    });
    check(!String(requests[1].body || '').includes(SECRETOS.OPENAI), `el body con secreto cruzó de origen: ${String(requests[1].body)}`);
    check(String(requests[0].body).includes(SECRETOS.OPENAI), 'el primer pedido no llevaba el body con el secreto');
  }

  {
    // Un redirect a otro ESQUEMA no se sigue nunca.
    for (const destino of ['file:///C:/Windows/win.ini', 'data:text/plain,hola']) {
      const requests = banco(() => ({ status: 302, headers: { location: destino }, body: 'nada' }));
      await http({ url: 'https://api.ejemplo.com/x' });
      igual(requests.length, 1, `no se sigue un redirect a ${destino.split(':')[0]}:`);
    }
  }

  {
    // Cadena infinita: el tope corta y no cuelga el turno.
    const requests = banco((url) => ({ status: 302, headers: { location: `${url}/mas` }, body: 'nada' }));
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    check(requests.length <= 7, `una cadena infinita no cortó en el tope: ${requests.length} requests`);
    igual(requests.length, web.HTTP_MAX_REDIRECTS + 1, 'la cadena infinita hace el primer pedido más los saltos del tope');
    check(typeof out === 'string' && out.length > 0, 'la cadena infinita no devolvió nada');
  }

  {
    // 303 degrada a GET, como todos los clientes: sin esto un POST se reenviaría
    // entero al destino nuevo.
    const requests = banco((url) => (
      url.endsWith('/x')
        ? { status: 303, headers: { location: 'https://api.ejemplo.com/y' } }
        : { body: 'ok' }
    ));
    await http({ method: 'POST', url: 'https://api.ejemplo.com/x', body: 'hola' });
    igual(requests[1].method, 'GET', 'un 303 degrada a GET');
    igual(requests[1].body, undefined, 'un 303 va sin cuerpo');
  }

  {
    // 307 conserva el método y el cuerpo cuando no hay secreto que cuidar
    const requests = banco((url) => (
      url.endsWith('/x') ? { status: 307, headers: { location: 'https://otro.ejemplo.com/y' } } : { body: 'ok' }
    ));
    await http({ method: 'PUT', url: 'https://api.ejemplo.com/x', body: 'hola' });
    igual([requests[1].method, requests[1].body], ['PUT', 'hola'], 'un 307 conserva método y cuerpo');
  }

  // ═══ http_request · el resultado no puede parecer un éxito si no lo fue ═══

  {
    banco(() => ({ status: 401, statusText: 'Unauthorized', body: '{"error":"nope"}' }));
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    check(/^!! HTTP 401/.test(out), `un 4xx no viene marcado adelante: ${out.slice(0, 60)}`);
    check(/did NOT succeed/.test(out), 'un 4xx no dice que NO anduvo');
  }

  {
    banco(() => ({
      status: 200, statusText: 'OK', body: '{"a":1}',
      headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '9', 'Set-Cookie': 'sid=1', Server: 'nginx' },
    }));
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    igual(out, 'GET https://api.ejemplo.com/x\nHTTP 200 OK\ncontent-type: application/json\nx-ratelimit-remaining: 9\n\n{"a":1}',
      'el resultado: pedido, estado, los headers que importan y el cuerpo');
  }

  {
    banco(() => ({ body: '' }));
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    check(out.endsWith('\n\n(empty body)'), `un cuerpo vacío no se dice: ${corto(out)}`);
  }

  {
    // el tope del cuerpo
    banco(() => ({ body: 'a'.repeat(6000) }));
    const justo = await http({ url: 'https://api.ejemplo.com/x' });
    check(justo.endsWith('a'.repeat(6000)) && !/truncated/.test(justo), 'un cuerpo de 6000 caracteres se recortó');
    banco(() => ({ body: 'a'.repeat(6000) + 'b'.repeat(250) }));
    const largo = await http({ url: 'https://api.ejemplo.com/x' });
    check(largo.endsWith(`${'a'.repeat(6000)}\n…[250 more chars truncated]`), `un cuerpo largo no se recortó a 6000: …${largo.slice(-60)}`);
  }

  // ═══ http_request · los chequeos de entrada, en orden ═════════════════════

  {
    const requests = banco(() => ({ body: 'ok' }));
    igual(await http({ method: 'TRACE', url: 'https://api.ejemplo.com/x' }),
      'error: method must be one of: GET, POST, PUT, PATCH, DELETE, HEAD', 'un método que no existe');
    igual(await http({ method: 'TRACE' }), 'error: method must be one of: GET, POST, PUT, PATCH, DELETE, HEAD', 'el método se mira antes que la URL');
    igual(await http({ url: '   ' }), 'error: url is required', 'sin URL');
    igual(await http(), 'error: url is required', 'sin argumentos');
    igual(await http({ url: 'ftp://ejemplo.com/x' }), 'error: url must start with http:// or https://', 'un esquema que no es http');
    igual(await http({ url: 'ftp://{{secret:NO_EXISTE}}/x' }),
      'error: missing secret(s): NO_EXISTE — the user adds them in Settings, or drop the {{secret:...}} placeholder',
      'el secreto que falta se dice antes que el esquema');
    igual(requests.length, 0, 'ninguno de los chequeos de entrada salió a la red');
  }

  // ═══ http_request · el reintento: solo GET y HEAD ═════════════════════════

  {
    // Retry-After: 0 para que el test no espere
    const requests = banco((_, __, n) => (n < 2 ? { status: 503, statusText: 'Service Unavailable', headers: { 'retry-after': '0' } } : { body: 'al fin' }));
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    igual(requests.length, 3, 'un GET reintenta un 503 hasta dos veces');
    check(out.includes('HTTP 200 OK [after 2 retries]') && out.endsWith('al fin'), `el resultado no cuenta los reintentos: ${corto(out)}`);
  }

  {
    const requests = banco(() => ({ status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '0' }, body: 'despacio' }));
    const out = await http({ method: 'HEAD', url: 'https://api.ejemplo.com/x' });
    igual(requests.length, 3, 'un HEAD también reintenta, y para en el tope');
    check(/^!! HTTP 429/.test(out) && out.includes('[after 2 retries]'), `agotados los reintentos, el 429 no vuelve marcado: ${corto(out)}`);
  }

  {
    // re-mandar un POST puede duplicar la operación
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const requests = banco(() => ({ status: 503, statusText: 'Service Unavailable', headers: { 'retry-after': '0' } }));
      const out = await http({ method, url: 'https://api.ejemplo.com/x', body: 'x' });
      igual(requests.length, 1, `un ${method} NO se reintenta`);
      check(/^!! HTTP 503/.test(out) && !/after \d+ retr/.test(out), `un ${method} con 503 no vuelve tal cual: ${corto(out)}`);
    }
  }

  {
    const requests = banco(() => ({ status: 404, statusText: 'Not Found' }));
    await http({ url: 'https://api.ejemplo.com/x' });
    igual(requests.length, 1, 'un 404 no se reintenta: no es transitorio');
  }

  {
    // una escritura que no llegó a ninguna parte tampoco se reintenta
    const requests = banco(() => { throw new Error('fetch failed'); });
    const out = await http({ method: 'POST', url: 'https://api.ejemplo.com/x', body: 'x' });
    igual(requests.length, 1, 'un POST con error de red no se reintenta');
    igual(out, 'error: http_request failed: fetch failed', 'el error de red de un POST');
  }

  {
    // el error de red de un GET sí: dos reintentos con backoff (0,5 s y 1,5 s)
    const requests = banco(() => { throw new Error('fetch failed'); });
    const t0 = Date.now();
    const out = await http({ url: 'https://api.ejemplo.com/x' });
    const tardo = Date.now() - t0;
    igual(requests.length, 3, 'un GET con error de red reintenta dos veces');
    igual(out, 'error: http_request failed: fetch failed (after 2 retries)', 'el error de red de un GET, con sus reintentos');
    check(tardo >= 1900 && tardo < 4000, `el backoff entre reintentos no fue de 0,5 s + 1,5 s: tardó ${tardo} ms`);
  }

  {
    const conNombre = (name) => () => { const e = new Error('x'); e.name = name; throw e; };
    banco(conNombre('TimeoutError'));
    igual(await http({ method: 'POST', url: 'https://api.ejemplo.com/x' }), 'error: http_request failed: timed out after 30s', 'el timeout por defecto es de 30 s');
    igual(await http({ method: 'POST', url: 'https://api.ejemplo.com/x', timeout: 5 }), 'error: http_request failed: timed out after 5s', 'el timeout que pide el modelo');
    igual(await http({ method: 'POST', url: 'https://api.ejemplo.com/x', timeout: 0.2 }), 'error: http_request failed: timed out after 1s', 'el timeout tiene un piso de 1 s');
    igual(await http({ method: 'POST', url: 'https://api.ejemplo.com/x', timeout: 9999 }), 'error: http_request failed: timed out after 120s', 'el timeout tiene un techo de 120 s');
  }

  // ═══ http_request · Stop ══════════════════════════════════════════════════

  {
    const requests = bancoColgado();
    const run = hacerRun();
    const t0 = Date.now();
    const pendiente = http({ url: 'https://api.ejemplo.com/x' }, run);
    setTimeout(() => run.ac.abort(), 30);
    igual(await pendiente, 'error: http_request aborted', 'Stop corta un pedido en vuelo');
    check(Date.now() - t0 < 1000, 'Stop no cortó el pedido en el acto');
    igual(requests.length, 1, 'tras Stop no se reintenta');
  }

  {
    // Stop durante la espera entre reintentos: no se duerme el backoff entero
    const requests = banco(() => { throw new Error('fetch failed'); });
    const run = hacerRun();
    const t0 = Date.now();
    const pendiente = http({ url: 'https://api.ejemplo.com/x' }, run);
    setTimeout(() => run.ac.abort(), 30);
    igual(await pendiente, 'error: http_request aborted', 'Stop durante el backoff corta el turno');
    check(Date.now() - t0 < 400, `Stop durante el backoff esperó de más: ${Date.now() - t0} ms`);
    check(requests.length <= 2, `Stop durante el backoff siguió reintentando: ${requests.length} pedidos`);
  }

  // ═══ httpBackoffMs y abortableSleep ═══════════════════════════════════════

  {
    const con = (v) => ({ headers: { get: (k) => (k === 'retry-after' ? v : null) } });
    igual([0, 1, 2, 3, 9].map((n) => httpBackoffMs(n, null)), [500, 1500, 4500, 8000, 8000], 'el backoff: 0,5 s por tres, con tope de 8 s');
    igual(httpBackoffMs(0, con('2')), 2000, 'Retry-After en segundos manda sobre el backoff');
    igual(httpBackoffMs(0, con('0')), 0, 'Retry-After: 0 no espera');
    igual(httpBackoffMs(0, con('30')), 8000, 'Retry-After tiene tope de 8 s');
    const enTres = httpBackoffMs(0, con(new Date(Date.now() + 3000).toUTCString()));
    check(enTres > 1500 && enTres <= 3000, `Retry-After como fecha HTTP: dio ${enTres} ms`);
    igual(httpBackoffMs(1, con(new Date(Date.now() - 60000).toUTCString())), 1500, 'una fecha que ya pasó cae al backoff');
    igual(httpBackoffMs(1, con('pronto')), 1500, 'un Retry-After ilegible cae al backoff');

    const ac = new AbortController();
    let t0 = Date.now();
    setTimeout(() => ac.abort(), 20);
    await abortableSleep(5000, ac.signal);
    check(Date.now() - t0 < 500, 'abortableSleep no se despertó con el abort');
    t0 = Date.now();
    await abortableSleep(5000, ac.signal);
    check(Date.now() - t0 < 100, 'abortableSleep durmió con la señal ya abortada');
    t0 = Date.now();
    await abortableSleep(40);
    check(Date.now() - t0 >= 30, 'abortableSleep sin señal no esperó');
  }

  // ═══ htmlToText ═══════════════════════════════════════════════════════════

  {
    igual(htmlToText('<html><head><title>T</title><style>p{color:red}</style><script>var a = "<p>no</p>";</script></head>'
      + '<body><!-- un comentario --><h1>Hola</h1><p>Uno   dos</p><div>Tres<br>Cuatro</div><noscript>sin js</noscript></body></html>'),
    'T Hola\nUno dos\nTres\nCuatro', 'htmlToText: scripts, estilos y comentarios afuera, y los bloques como renglones');
    igual(htmlToText('a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&apos; &AMP;'), 'a b & c <d> "e" \'f\' &', 'htmlToText: las entidades con nombre');
    igual(htmlToText('caf&#233; &#x27;x&#X2019; &#128512; &#x1F600;'), 'café \'x\u2019 \u{1F600} \u{1F600}', 'htmlToText: entidades decimales y hexadecimales, también arriba de U+FFFF');
    igual(htmlToText('&#x110000; &#0; &#9999999;'), '&#x110000; &#0; &#9999999;', 'htmlToText: un código imposible queda como estaba');
    igual(htmlToText('<p>a</p>\n\n\n\n<p>b</p>   <ul><li>c</li><li>d</li></ul>'), 'a\n\nb\nc\nd', 'htmlToText: no deja más de un renglón en blanco');
    igual(htmlToText('<svg><path d="M0 0"/></svg><template><b>x</b></template>visible'), 'visible', 'htmlToText: svg y template afuera');
  }

  // ═══ fetch ════════════════════════════════════════════════════════════════
  sinConfigurar();

  {
    const requests = banco(() => ({ body: 'x' }));
    for (const mala of ['', '   ', 'ejemplo.com', 'file:///C:/x', 'ftp://ejemplo.com']) {
      igual(await runners.fetch(hacerRun(), { url: mala }), 'error: url must be an absolute http:// or https:// address', `fetch rechaza «${mala}»`);
    }
    igual(requests.length, 0, 'fetch: una URL inválida no sale a la red');
  }

  {
    const requests = banco(() => ({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!doctype html><html><body><h1>Título</h1><p>Un párrafo &amp; algo más.</p><script>x()</script></body></html>',
    }));
    const run = hacerRun();
    const out = await runners.fetch(run, { url: '  https://ejemplo.com/pagina  ' });
    igual(out, 'Fetched https://ejemplo.com/pagina — HTTP 200\n\nTítulo\nUn párrafo & algo más.', 'fetch: una página HTML vuelve como texto');
    igual(run.filas, [{ ch: 'tool:activity', reqId: 'r1', kind: 'fetch', label: 'https://ejemplo.com/pagina' }], 'fetch avisa a la interfaz');
    igual(requests[0].url, 'https://ejemplo.com/pagina', 'fetch pide la URL sin los espacios');
    igual(requests[0].redirect, 'follow', 'fetch sigue los redirects');
    check(/text\/html/.test(requests[0].headers.Accept) && !!requests[0].headers['User-Agent'], 'fetch no manda Accept y User-Agent');
    check(requests[0].signal instanceof AbortSignal, 'fetch no lleva señal');
  }

  {
    banco(() => ({ headers: { 'content-type': 'application/json' }, body: '{"a":"<b>no es html</b>"}' }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/a.json' }),
      'Fetched https://ejemplo.com/a.json — HTTP 200\n\n{"a":"<b>no es html</b>"}', 'fetch: lo que no es HTML vuelve crudo');
    // sin content-type, se reconoce por cómo empieza
    banco(() => ({ body: '\n<html><body><p>hola</p></body></html>' }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/' }), 'Fetched https://ejemplo.com/ — HTTP 200\n\nhola', 'fetch: HTML sin content-type se reconoce igual');
  }

  {
    // el charset del header: res.text() lo ignoraba y devolvía caracteres de reemplazo
    // (los bytes 0x80–0x9F de windows-1252 —€, comillas curvas— quedan afuera
    // a propósito: el TextDecoder de Node 22 los decodifica como latin1, así
    // que dependen de la versión de Node y no de este módulo)
    banco(() => ({ headers: { 'content-type': 'text/plain; charset=windows-1252' }, bytes: Buffer.from([0x63, 0x61, 0x66, 0xE9]) }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/t' }), 'Fetched https://ejemplo.com/t — HTTP 200\n\ncafé', 'fetch decodifica con el charset declarado');
    banco(() => ({ headers: { 'content-type': 'text/html; charset=ISO-8859-2' }, bytes: Buffer.from([0x3C, 0x70, 0x3E, 0xB1, 0x3C, 0x2F, 0x70, 0x3E]) }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/t' }), 'Fetched https://ejemplo.com/t — HTTP 200\n\ną', 'fetch decodifica un charset que no es latin1');
    banco(() => ({ headers: { 'content-type': 'text/plain; charset="inventado-9"' }, bytes: Buffer.from('año', 'utf8') }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/t' }), 'Fetched https://ejemplo.com/t — HTTP 200\n\naño', 'fetch: un charset desconocido cae a UTF-8');
  }

  {
    banco(() => ({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(6000) + 'y'.repeat(50) }));
    const out = await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/largo' });
    igual(out, `Fetched https://ejemplo.com/largo — HTTP 404\n\n${'x'.repeat(6000)}\n… [truncated]`, 'fetch recorta a 6000 caracteres y dice el estado');
    banco(() => ({ headers: { 'content-type': 'text/html' }, body: '<script>solo()</script>' }));
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/v' }), 'Fetched https://ejemplo.com/v — HTTP 200\n\n(empty body)', 'fetch: una página sin texto');
  }

  {
    banco(() => { throw new Error('getaddrinfo ENOTFOUND ejemplo.invalid'); });
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.invalid/' }),
      'error: could not fetch https://ejemplo.invalid/ — getaddrinfo ENOTFOUND ejemplo.invalid', 'fetch: un error de red vuelve como error');
    banco(() => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; });
    igual(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/' }), 'error: could not fetch https://ejemplo.com/ — timed out (15s)', 'fetch: el timeout');
    const requests = bancoColgado();
    const run = hacerRun();
    const t0 = Date.now();
    const pendiente = runners.fetch(run, { url: 'https://ejemplo.com/lento' });
    setTimeout(() => run.ac.abort(), 30);
    igual(await pendiente, 'error: could not fetch https://ejemplo.com/lento — aborted', 'fetch: Stop corta el pedido');
    check(Date.now() - t0 < 1000 && requests.length === 1, 'fetch: Stop no cortó en el acto');
  }

  // ═══ web_search ═══════════════════════════════════════════════════════════

  const DDG = {
    Heading: 'Mate', AbstractText: 'Infusión   de\nyerba mate.', AbstractURL: 'https://es.wikipedia.org/wiki/Mate',
    RelatedTopics: [
      { Text: 'Yerba mate - La planta', FirstURL: 'https://duckduckgo.com/Yerba_mate' },
      { Name: 'Otros', Topics: [{ Text: 'Bombilla - El sorbete', FirstURL: 'https://duckduckgo.com/Bombilla' }, { Text: 'Tereré - Frío' }] },
      { FirstURL: 'https://duckduckgo.com/sin-texto' },
      { Text: 'Cuarto - d', FirstURL: 'https://duckduckgo.com/4' },
      { Text: 'Quinto - e', FirstURL: 'https://duckduckgo.com/5' },
      { Text: 'Sexto - f', FirstURL: 'https://duckduckgo.com/6' },
    ],
  };

  {
    const requests = banco(() => ({}));
    igual(await runners.web_search(hacerRun(), { query: '   ' }), 'error: query is required', 'web_search sin consulta');
    igual(await runners.web_search(hacerRun()), 'error: query is required', 'web_search sin argumentos');
    igual(requests.length, 0, 'web_search sin consulta no sale a la red');
  }

  {
    // sin configurar nada: DuckDuckGo, sin llave, cinco resultados. Primero
    // sus resultados web; acá la página no trae ninguno, así que sigue con la
    // API de respuestas instantáneas.
    const requests = banco((url) => (url.startsWith('https://html.duckduckgo.com/') ? { body: '<html><body>No results.</body></html>' } : { json: DDG }));
    const run = hacerRun();
    const out = await runners.web_search(run, { query: ' mate & bombilla ' });
    igual(requests.length, 2, 'web_search sin configurar: la búsqueda web y, sin resultados, la API instantánea');
    igual(requests[0].url, 'https://html.duckduckgo.com/html/?q=mate%20%26%20bombilla', 'web_search sin configurar busca primero en la web de DuckDuckGo');
    igual(requests[1].url, 'https://api.duckduckgo.com/?q=mate%20%26%20bombilla&format=json&no_html=1&no_redirect=1', 'web_search: el segundo intento va a la API instantánea');
    igual(out.split('\n'), [
      '[1] Mate — Infusión de yerba mate. (https://es.wikipedia.org/wiki/Mate)',
      '[2] Yerba mate — Yerba mate - La planta (https://duckduckgo.com/Yerba_mate)',
      '[3] Bombilla — Bombilla - El sorbete (https://duckduckgo.com/Bombilla)',
      '[4] Tereré — Tereré - Frío ()',
      '[5] Cuarto — Cuarto - d (https://duckduckgo.com/4)',
    ], 'web_search: la lista numerada, cinco por defecto');
    igual(run.filas, [{ ch: 'tool:activity', reqId: 'r1', kind: 'web_search', label: 'mate & bombilla' }], 'web_search avisa a la interfaz');
    check(requests[0].signal instanceof AbortSignal, 'web_search no lleva señal');
  }

  {
    // cuántos: lo que pide el modelo, si no lo de los ajustes, entre 1 y 10
    const muchos = { RelatedTopics: Array.from({ length: 30 }, (_, i) => ({ Text: `T${i} - x`, FirstURL: `https://e.com/${i}` })) };
    const cuantos = async (args) => { banco(() => ({ json: muchos })); return (await runners.web_search(hacerRun(), args)).split('\n').length; };
    configurar({ webSearch: () => ({ provider: 'duckduckgo', maxResults: 3 }) });
    igual(await cuantos({ query: 'q' }), 3, 'web_search usa maxResults de los ajustes');
    igual(await cuantos({ query: 'q', count: 7 }), 7, 'web_search: count le gana a los ajustes');
    igual(await cuantos({ query: 'q', count: 99 }), 10, 'web_search: nunca más de 10');
    igual(await cuantos({ query: 'q', count: -4 }), 1, 'web_search: nunca menos de 1');
    configurar({ webSearch: () => ({}) });
    igual(await cuantos({ query: 'q' }), 5, 'web_search: ajustes vacíos se completan con los de fábrica');
    configurar({ webSearch: () => null });
    igual(await cuantos({ query: 'q' }), 5, 'web_search: ajustes nulos se completan con los de fábrica');
    sinConfigurar();
  }

  {
    banco(() => ({ json: {} }));
    igual(await runners.web_search(hacerRun(), { query: 'nada' }), 'No web results found.', 'web_search sin resultados');
    // la lista se corta en 2000 caracteres, por renglones enteros
    banco(() => ({ json: { RelatedTopics: Array.from({ length: 10 }, (_, i) => ({ Text: `T${i} - ${'x'.repeat(600)}`, FirstURL: 'https://e.com' })) } }));
    const out = await runners.web_search(hacerRun(), { query: 'largo', count: 10 });
    check(out.length <= 2000 && out.split('\n').length === 3 && out.split('\n').every((l) => l.endsWith('(https://e.com)')),
      `web_search no cortó la lista en 2000 caracteres: ${out.length} caracteres, ${out.split('\n').length} renglones`);
    banco(() => ({ status: 500 }));
    igual(await runners.web_search(hacerRun(), { query: 'q' }), 'error: web search failed: HTTP 500', 'web_search: un error del servidor');
  }

  {
    // La búsqueda web sin llave: la página de resultados de DuckDuckGo, con la
    // forma que tiene de verdad. Un aviso pago, un resultado con entidades y
    // etiquetas adentro, y la dirección real envuelta en su redirect.
    const fila = (href, titulo, resumen) => `<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${titulo}</a></h2>
      <a class="result__snippet" href="${href}">${resumen}</a></div></div>`;
    const PAGINA = `<html><body><div id="links" class="results">
      ${fila('//duckduckgo.com/y.js?ad_domain=x.example&amp;u3=https%3A%2F%2Fx.example', 'Un aviso pago', 'compre ya')}
      ${fila('//duckduckgo.com/l/?uddg=https%3A%2F%2Fz.ai%2Fblog%2Fglm%2D5.3&amp;rut=abc123', 'GLM-5.3: <b>Frontier</b> Coding &amp; more', 'Today we are   releasing <b>GLM-5.3</b>.\n It&#x27;s new.')}
      ${fila('https://directo.example/pagina?a=1&amp;b=2', 'Directo', 'sin redirect')}
      ${fila('//duckduckgo.com/l/?uddg=https%3A%2F%2Ftres.example%2F&amp;rut=def', 'Tres', '')}
    </div></body></html>`;
    const requests = banco(() => ({ body: PAGINA }));
    const out = await runners.web_search(hacerRun(), { query: 'GLM-5.3 news' });
    igual(requests.length, 1, 'web_search: con resultados web no hace falta el segundo intento');
    igual(requests[0].url, 'https://html.duckduckgo.com/html/?q=GLM-5.3%20news', 'web_search: a dónde va la búsqueda web');
    check(/Nix/.test(requests[0].headers['User-Agent'] ?? '') && requests[0].signal instanceof AbortSignal, 'web_search: la búsqueda web no se identifica o no lleva señal');
    igual(out.split('\n'), [
      '[1] GLM-5.3: Frontier Coding & more — Today we are releasing GLM-5.3 . It\'s new. (https://z.ai/blog/glm-5.3)',
      '[2] Directo — sin redirect (https://directo.example/pagina?a=1&b=2)',
      '[3] Tres —  (https://tres.example/)',
    ], 'web_search: título, resumen y dirección real de cada resultado, sin el aviso');
    igual((await runners.web_search(hacerRun(), { query: 'q', count: 2 })).split('\n').length, 2, 'web_search: count también corta los resultados web');
    igual(web.leerResultadosDdg('<a class="otra result__a x" href="https://a.example">A</a>', 5), [{ title: 'A', url: 'https://a.example/', snippet: '' }], 'leerResultadosDdg: la clase puede venir con otras');
    igual(web.leerResultadosDdg('<p>nada</p>', 5), [], 'leerResultadosDdg: una página sin resultados');

    // Nada en la web y la API instantánea contesta con el cuerpo vacío (un 202
    // de verdad): es «sin resultados», no un JSON roto.
    banco((url) => (url.startsWith('https://html.') ? { body: '<html></html>' } : { status: 202, body: '' }));
    igual(await runners.web_search(hacerRun(), { query: 'q' }), 'No web results found.', 'web_search: un cuerpo vacío de la API instantánea no es un error');
    // DuckDuckGo pide una comprobación humana y la otra no trae nada: eso NO es
    // «sin resultados», y el modelo tiene que saberlo.
    banco((url) => (url.startsWith('https://html.') ? { body: '<html><div class="anomaly-modal">Select all squares</div></html>' } : { json: {} }));
    igual(await runners.web_search(hacerRun(), { query: 'q' }), 'error: web search failed: DuckDuckGo asked for a human check instead of answering', 'web_search: una búsqueda que no se pudo hacer no dice «sin resultados»');
    // …pero si la API instantánea sí tenía algo, sirve
    banco((url) => (url.startsWith('https://html.') ? { status: 503 } : { json: DDG }));
    check((await runners.web_search(hacerRun(), { query: 'q' })).startsWith('[1] Mate'), 'web_search: con la búsqueda web caída no usó la API instantánea');
    // un Stop corta sin ir al segundo intento
    const colgado = bancoColgado();
    const runS = hacerRun();
    const p = runners.web_search(runS, { query: 'q' });
    setTimeout(() => runS.ac.abort(), 30);
    check((await p).startsWith('error: web search failed:') && colgado.length === 1, `web_search: un Stop hizo ${colgado.length} pedidos`);
  }

  {
    // Tavily y Brave piden llave, y sin ella no salen a la red
    const requests = banco(() => ({ json: { results: [] } }));
    configurar({ webSearch: () => ({ provider: 'tavily', maxResults: 5 }) });
    igual(await runners.web_search(hacerRun(), { query: 'q' }), 'error: web search needs a Tavily API key (Settings)', 'Tavily sin llave');
    configurar({ webSearch: () => ({ provider: 'brave', maxResults: 5 }) });
    igual(await runners.web_search(hacerRun(), { query: 'q' }), 'error: web search needs a Brave API key (Settings)', 'Brave sin llave');
    igual(requests.length, 0, 'sin llave no se sale a la red');
  }

  {
    const LLAVE = 'tvly-llave-de-mentira-0001';
    const pedidas = [];
    configurar({ webSearch: () => ({ provider: 'tavily', maxResults: 2 }), getKey: (n) => { pedidas.push(n); return LLAVE; } });
    const requests = banco(() => ({ json: { results: [
      { title: 'Uno', url: 'https://uno.example', content: 'primero\n  resultado' },
      { title: 'Dos', url: 'https://dos.example', content: 'segundo' },
      { title: 'Tres', url: 'https://tres.example', content: 'tercero' },
    ] } }));
    const out = await runners.web_search(hacerRun(), { query: 'q' });
    igual(pedidas, ['websearch'], 'web_search pide la llave «websearch»');
    igual([requests[0].url, requests[0].method], ['https://api.tavily.com/search', 'POST'], 'Tavily: a dónde va');
    igual(JSON.parse(requests[0].body), { api_key: LLAVE, query: 'q', max_results: 2, include_answer: false }, 'Tavily: el cuerpo');
    igual(out, '[1] Uno — primero resultado (https://uno.example)\n[2] Dos — segundo (https://dos.example)', 'Tavily: los resultados');
    check(!out.includes(LLAVE), 'Tavily: la llave aparece en el resultado');

    // jamás filtrar la key en un error
    banco(() => { throw new Error(`request to https://api.tavily.com/search?api_key=${LLAVE} failed (${LLAVE})`); });
    const err = await runners.web_search(hacerRun(), { query: 'q' });
    igual(err, 'error: web search failed: request to https://api.tavily.com/search?api_key=*** failed (***)', 'la llave se restriega del texto de un error');

    configurar({ webSearch: () => ({ provider: 'brave', maxResults: 5 }) });
    const reqB = banco(() => ({ json: { web: { results: [{ title: 'B', url: 'https://b.example', description: 'de brave' }] } } }));
    const outB = await runners.web_search(hacerRun(), { query: 'a b', count: 4 });
    igual(reqB[0].url, 'https://api.search.brave.com/res/v1/web/search?q=a%20b&count=4', 'Brave: a dónde va');
    igual([reqB[0].headers['X-Subscription-Token'], reqB[0].headers.Accept], [LLAVE, 'application/json'], 'Brave: la llave va en el header');
    igual(outB, '[1] B — de brave (https://b.example)', 'Brave: los resultados');

    // un proveedor que no se conoce cae a DuckDuckGo, y no manda la llave
    configurar({ webSearch: () => ({ provider: 'otro' }) });
    const reqD = banco(() => ({ json: DDG }));
    await runners.web_search(hacerRun(), { query: 'q' });
    check(reqD.length === 2 && reqD[0].url.startsWith('https://html.duckduckgo.com/') && reqD[1].url.startsWith('https://api.duckduckgo.com/') && !JSON.stringify(reqD).includes(LLAVE), 'un proveedor desconocido no cayó a DuckDuckGo sin llave');
    sinConfigurar();
  }

  {
    const requests = bancoColgado();
    const run = hacerRun();
    const t0 = Date.now();
    const pendiente = runners.web_search(run, { query: 'lento' });
    setTimeout(() => run.ac.abort(), 30);
    const out = await pendiente;
    check(out.startsWith('error: web search failed: ') && Date.now() - t0 < 1000 && requests.length === 1, `web_search: Stop no cortó el pedido: ${corto(out)}`);
  }

  // ═══ el nombre de la otra app no llega al modelo ══════════════════════════
  {
    conSecretos();
    const salidas = [];
    banco(() => ({ status: 500, statusText: 'Internal Server Error', body: 'x' }));
    salidas.push(await http({ method: 'POST', url: 'https://api.ejemplo.com/x' }));
    salidas.push(await http({ url: 'https://api.ejemplo.com/{{secret:NO}}' }));
    salidas.push(await runners.fetch(hacerRun(), { url: 'https://ejemplo.com/' }));
    salidas.push(await runners.fetch(hacerRun(), { url: 'x' }));
    salidas.push(await runners.web_search(hacerRun(), { query: 'q' }));
    check(!salidas.some((s) => /NeonCode|Integrations|Settings →/.test(s)), 'un resultado nombra a NeonCode o una sección de sus ajustes');
    sinConfigurar();
  }
} finally {
  globalThis.fetch = fetchDeVerdad;
}

check(globalThis.fetch === fetchDeVerdad, 'el fetch de verdad no quedó repuesto');

if (failures.length) {
  console.error(`test-nix-tools-web: ${failures.length} falla(s) de ${total}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-nix-tools-web: ok (${total} comprobaciones: http_request con secretos, redirects, reintentos y topes; fetch; web_search; htmlToText)`);
