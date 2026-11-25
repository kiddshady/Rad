'use strict';

// generate_image: el agente genera imágenes, y quedan en el chat.
//
// Es de BlackCode (NeonCode no la tenía). Fran la pidió el 25/11/2026 con un
// brief armado con un agente; de ahí salió que sea una tool nativa y no un
// servidor MCP, y que el proveedor sea Venice, que con una sola llave da todo
// su catálogo de modelos de imagen. Lo que se decidió distinto del brief:
//
//   - La llave es la de Venice que la app ya guarda cifrada (Settings), la
//     misma de los agentes de Venice. No hay otra, ni va por el entorno.
//   - Los modelos no están escritos acá: se le piden a Venice
//     (GET /models?type=image), con sus límites y su precio. Cambian seguido.
//   - Se llama generate_image y no venice_image: si mañana hay otro proveedor,
//     el agente no se entera.
//   - Las imágenes se guardan en ARCHIVOS (la carpeta `images` de los datos de
//     las tools), y al chat va la referencia. Las capturas van adentro del
//     documento del chat, en base64; con imágenes generadas un chat pasaría a
//     pesar decenas de MB.
//   - GASTA PLATA en cada llamada. Por eso: nace apagada en los agentes, los
//     subagentes no la tienen, la tarjeta de permiso dice cuánto sale, y hay un
//     tope de imágenes por turno (en modo automático nadie mira cada llamada).
//   - El filtro de contenido adulto de Venice (`safe_mode`) es del usuario: un
//     interruptor de Settings. No es un parámetro de la tool.
//   - El modelo NO recibe la imagen de vuelta salvo que la pida (`look`): el
//     que la juzga es el usuario, y mandársela cuesta tokens.
//
// Lo que dice la documentación de Venice (leída el 25/11/2026):
//   POST /image/generate  { model, prompt, negative_prompt?, aspect_ratio?,
//     resolution?, variants (1-4), seed?, style_preset?, safe_mode (true),
//     hide_watermark, return_binary (false), format (webp) }
//   → { id, images: [base64, …], timing }   y en los encabezados
//     x-venice-is-blurred y x-venice-is-content-violation.
//   422: el prompt va contra sus reglas; puede traer `suggested_prompt`.
//   Algunos modelos rechazan width/height: por eso la tool no los expone.
//
// El contrato de un runner está en la cabecera de base.cjs.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BASE = (process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1').replace(/\/+$/, '');
const VARIANTES_MAX = 4;     // el tope de Venice por pedido
const POR_TURNO = 8;         // imágenes por turno, entre todas las llamadas
const ESPERA_MS = 180000;    // algunos modelos tardan más de un minuto
const LISTA_MS = 10 * 60 * 1000;
const PROMPT_MAX = 7500;     // el tope de Venice; cada modelo puede tener uno menor

let deps = {
  getKey: () => null,          // la llave de Venice, descifrada
  ajustes: () => ({}),         // { modelo, filtro } de Settings
  carpeta: null,               // donde vive `images`
  modeloVe: () => false,       // ¿el modelo de este turno ve imágenes?
  deMentira: false,            // el humo: sin red, con una imagen armada acá
  pedir: (...a) => fetch(...a),
  ahora: () => Date.now(),
};

/** Lo que este módulo necesita de afuera (ver arriba). Lo que no venga queda como estaba. */
function configurar(d = {}) {
  for (const k of ['getKey', 'ajustes', 'modeloVe', 'pedir', 'ahora']) if (typeof d[k] === 'function') deps[k] = d[k];
  if (typeof d.carpeta === 'string' && d.carpeta.trim()) deps.carpeta = path.resolve(d.carpeta);
  if (typeof d.deMentira === 'boolean') deps.deMentira = d.deMentira;
  cache = null;
}

const dirImagenes = () => (deps.carpeta ? path.join(deps.carpeta, 'images') : null);

// ---------- Los modelos ----------

let cache = null; // { at, lista }

const DE_MENTIRA = [
  { id: 'sim-image', nombre: 'Simulated image', precio: 0.04, limite: 1500, aspectos: ['1:1', '16:9', '9:16'], aspecto: '1:1', resoluciones: [], resolucion: '', predeterminado: true },
  { id: 'sim-image-pro', nombre: 'Simulated image Pro', precio: 0.1, limite: 3000, aspectos: [], aspecto: '', resoluciones: ['1K', '2K'], resolucion: '1K', predeterminado: false },
];

const usd = (p) => { const n = Number(p?.usd ?? p); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Un modelo de la lista de Venice, con lo que la tool necesita de él. */
function deVenice(m) {
  const spec = m?.model_spec ?? {};
  const c = spec.constraints ?? {};
  const precios = spec.pricing ?? {};
  const porResolucion = {};
  for (const [r, p] of Object.entries(precios.resolutions ?? {})) { const v = usd(p); if (v !== null) porResolucion[r] = v; }
  const textos = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s) : []);
  return {
    id: String(m.id),
    nombre: String(spec.name || m.id),
    precio: usd(precios.generation),
    porResolucion,
    limite: Number(c.promptCharacterLimit) > 0 ? Number(c.promptCharacterLimit) : PROMPT_MAX,
    aspectos: textos(c.aspectRatios),
    aspecto: typeof c.defaultAspectRatio === 'string' ? c.defaultAspectRatio : '',
    resoluciones: textos(c.resolutions),
    resolucion: typeof c.defaultResolution === 'string' ? c.defaultResolution : '',
    predeterminado: Array.isArray(spec.traits) && spec.traits.includes('default'),
  };
}

function explicar(status, cuerpo) {
  const detalle = typeof cuerpo?.error === 'string' ? cuerpo.error : cuerpo?.error?.message ?? '';
  if (status === 401) return detalle && /pro users/i.test(detalle) ? 'that model is only for Venice Pro accounts' : 'Venice rejected the API key (the user sets it in Settings)';
  if (status === 402) return 'the Venice account has no balance left';
  if (status === 403) return 'this Venice key cannot be used from this network';
  if (status === 422) return `Venice refused the prompt: it goes against its content rules${cuerpo?.suggested_prompt ? `. Venice suggests this prompt instead: ${JSON.stringify(String(cuerpo.suggested_prompt).slice(0, 1500))}` : ''}`;
  if (status === 429) return 'too many requests in a row to Venice. Wait a moment and try again';
  if (status === 503) return 'that Venice model is at capacity. Try again in a while, or use another model';
  if (status === 400 || status === 404 || status === 415) return `Venice rejected the request: ${detalle || status}`;
  return `Venice answered with an error (${status})${detalle ? `: ${detalle}` : ''}`;
}

/** Los modelos de imagen que Venice ofrece ahora. Se guardan diez minutos. */
async function modelos({ fresco = false, signal } = {}) {
  if (deps.deMentira) return DE_MENTIRA;
  if (!fresco && cache && deps.ahora() - cache.at < LISTA_MS) return cache.lista;
  const key = deps.getKey();
  const res = await deps.pedir(`${BASE}/models?type=image`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal });
  if (!res.ok) throw new Error(explicar(res.status, await res.json().catch(() => null)));
  const data = (await res.json())?.data;
  const lista = (Array.isArray(data) ? data : [])
    .filter((m) => m?.id && m.type === 'image' && !m.model_spec?.offline)
    .map(deVenice)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'en', { numeric: true }));
  cache = { at: deps.ahora(), lista };
  return lista;
}

/** Cuál se usa: el que pidió el agente, el de Settings, el que Venice marca
 *  como predeterminado, o el primero. `{ modelo }` o `{ error }`. */
function elegir(lista, pedido) {
  const ids = () => lista.slice(0, 40).map((m) => m.id).join(', ');
  if (!lista.length) return { error: 'Venice lists no image models for this key' };
  const p = String(pedido ?? '').trim();
  if (p) {
    const m = lista.find((x) => x.id === p) ?? lista.find((x) => x.nombre.toLowerCase() === p.toLowerCase());
    return m ? { modelo: m } : { error: `there is no image model ${JSON.stringify(p)}. The image models are: ${ids()}` };
  }
  const deAjustes = lista.find((x) => x.id === deps.ajustes()?.modelo);
  return { modelo: deAjustes ?? lista.find((x) => x.predeterminado) ?? lista[0] };
}

const cuantasDe = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(VARIANTES_MAX, Math.max(1, n)) : 1; };
const precioDe = (modelo, resolucion) => (resolucion && modelo.porResolucion?.[resolucion] !== undefined ? modelo.porResolucion[resolucion] : modelo.precio);

/** Revisa los argumentos contra lo que el modelo acepta. `{ error }` o lo que se va a pedir. */
function armar(modelo, a = {}) {
  const prompt = String(a.prompt ?? '').trim();
  if (!prompt) return { error: 'prompt is required: describe the image' };
  if (prompt.length > modelo.limite) return { error: `the prompt has ${prompt.length} characters and ${modelo.id} takes up to ${modelo.limite}. Shorten it` };
  const aspecto = String(a.aspect_ratio ?? '').trim();
  if (aspecto && !/^\d{1,2}:\d{1,2}$/.test(aspecto)) return { error: `aspect_ratio must look like "16:9", not ${JSON.stringify(aspecto)}` };
  if (aspecto && modelo.aspectos.length && !modelo.aspectos.includes(aspecto)) return { error: `${modelo.id} does not do ${aspecto}. It does: ${modelo.aspectos.join(', ')}` };
  const resolucion = String(a.resolution ?? '').trim();
  if (resolucion && modelo.resoluciones.length && !modelo.resoluciones.includes(resolucion)) return { error: `${modelo.id} does not do ${resolucion}. It does: ${modelo.resoluciones.join(', ')}` };
  if (resolucion && !modelo.resoluciones.length) return { error: `${modelo.id} has a single resolution: leave resolution out` };
  const negativo = String(a.negative_prompt ?? '').trim().slice(0, PROMPT_MAX);
  const estilo = String(a.style ?? '').trim().slice(0, 80);
  const semilla = a.seed === undefined || a.seed === null || a.seed === '' ? null : Math.trunc(Number(a.seed));
  if (semilla !== null && (!Number.isFinite(semilla) || Math.abs(semilla) > 999999999)) return { error: 'seed must be a whole number between -999999999 and 999999999' };
  return { prompt, aspecto, resolucion, negativo, estilo, semilla, cuantas: cuantasDe(a.variants) };
}

// ---------- Guardar y leer ----------

const FIRMAS = [
  ['png', (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['jpg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
/** El formato de verdad, por los primeros bytes (no por lo que se pidió). null si no es una imagen. */
const formatoDe = (buf) => FIRMAS.find(([, es]) => es(buf))?.[0] ?? null;

function guardar(buf, indice) {
  const dir = dirImagenes();
  if (!dir) throw new Error('there is no folder to save images in');
  const ext = formatoDe(buf);
  if (!ext) throw new Error('what Venice returned is not an image');
  const d = new Date(deps.ahora());
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sello = `${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const carpeta = path.join(dir, mes);
  fs.mkdirSync(carpeta, { recursive: true });
  let archivo;
  for (let n = 0; ; n++) {
    archivo = path.join(carpeta, `image-${sello}-${indice + 1}${n ? `-${n}` : ''}.${ext}`);
    if (!fs.existsSync(archivo)) break;
  }
  fs.writeFileSync(archivo, buf);
  return { archivo, name: path.basename(archivo), ext };
}

/** ¿Esa ruta es una imagen de las que guardó esta tool? (La interfaz pide
 *  archivos por su ruta: solo se le dan los de esta carpeta.) */
function esMia(archivo) {
  const dir = dirImagenes();
  if (!dir || typeof archivo !== 'string' || !archivo) return false;
  const abs = path.resolve(archivo);
  return abs.startsWith(dir + path.sep) && Object.hasOwn(MIME, path.extname(abs).slice(1).toLowerCase());
}

/** La imagen como data URL, para mostrarla. null si no es de acá o ya no está. */
function leer(archivo) {
  if (!esMia(archivo)) return null;
  try {
    const buf = fs.readFileSync(path.resolve(archivo));
    const ext = formatoDe(buf);
    return ext ? `data:${MIME[ext]};base64,${buf.toString('base64')}` : null;
  } catch { return null; }
}

// ---------- La imagen de mentira (el humo) ----------

// Un PNG de verdad, chico, armado acá: un degradé cuyo color sale del prompt,
// para que dos pedidos distintos den dos imágenes distintas.
function pngDeMentira(prompt, indice) {
  const lado = 96;
  let h = 2166136261;
  for (const ch of `${prompt}#${indice}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  const [r, g, b] = [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
  const filas = Buffer.alloc((lado * 3 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const o = y * (lado * 3 + 1);
    for (let x = 0; x < lado; x++) {
      const k = (x + y) / (2 * lado);
      filas[o + 1 + x * 3] = Math.round(r * k + 20 * (1 - k));
      filas[o + 2 + x * 3] = Math.round(g * k + 20 * (1 - k));
      filas[o + 3 + x * 3] = Math.round(b * k + 24 * (1 - k));
    }
  }
  const crcTabla = pngDeMentira.tabla ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTabla[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (tipo, datos) => {
    const cabeza = Buffer.alloc(8);
    cabeza.writeUInt32BE(datos.length, 0);
    cabeza.write(tipo, 4, 'latin1');
    const cola = Buffer.alloc(4);
    cola.writeUInt32BE(crc(Buffer.concat([cabeza.subarray(4), datos])), 0);
    return Buffer.concat([cabeza, datos, cola]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
}

// ---------- La tool ----------

async function pedirAVenice(cuerpo, signal) {
  if (deps.deMentira) {
    // (un prompt que dice REFUSED hace de prompt rechazado, para probar ese camino)
    if (/\bREFUSED\b/.test(cuerpo.prompt)) return { error: explicar(422, { suggested_prompt: 'a calmer version of the same idea' }) };
    return { imagenes: Array.from({ length: cuerpo.variants }, (_, i) => pngDeMentira(cuerpo.prompt, i)), borrosa: false };
  }
  let res;
  try {
    res = await deps.pedir(`${BASE}/image/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.getKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.any([signal, AbortSignal.timeout(ESPERA_MS)].filter(Boolean)),
    });
  } catch (err) {
    if (signal?.aborted) return { error: 'stopped' };
    if (err?.name === 'TimeoutError') return { error: `Venice took more than ${ESPERA_MS / 1000} seconds. Nothing was saved; the image may still have been charged` };
    return { error: `could not reach Venice — ${err?.cause?.code ?? err?.message ?? err}` };
  }
  if (!res.ok) return { error: explicar(res.status, await res.json().catch(() => null)) };
  let data;
  try { data = await res.json(); } catch { return { error: 'Venice answered with something that is not JSON' }; }
  const imagenes = (Array.isArray(data?.images) ? data.images : [])
    .filter((s) => typeof s === 'string' && s)
    // (base64 pelado según la documentación; si alguna vez viene como data URL, también)
    .map((s) => Buffer.from(s.replace(/^data:[^,]*,/, ''), 'base64'));
  const si = (h) => String(res.headers.get(h) ?? '').toLowerCase() === 'true';
  return { imagenes, borrosa: si('x-venice-is-blurred'), infraccion: si('x-venice-is-content-violation') };
}

async function runGenerateImage(run, a = {}) {
  const cuantas = cuantasDe(a?.variants);
  // El tope del turno: en modo automático nadie mira cada llamada, y cada
  // imagen sale plata. Pasado el tope, que el agente pregunte.
  const hechas = run._imagenes ?? 0;
  if (hechas + cuantas > POR_TURNO) return `error: this turn already made ${hechas} image${hechas === 1 ? '' : 's'} and the limit is ${POR_TURNO} per turn (each one costs the user money). Stop here and ask the user before making more.`;
  if (!deps.deMentira && !deps.getKey()) return 'error: there is no Venice API key. The user sets it in Settings, under Venice key.';
  let lista;
  try { lista = await modelos({ signal: run.ac?.signal }); } catch (err) { return `error: could not load the image models — ${err.message}`; }
  const { modelo, error: sinModelo } = elegir(lista, a?.model);
  if (sinModelo) return `error: ${sinModelo}`;
  const p = armar(modelo, a);
  if (p.error) return `error: ${p.error}`;

  run.notify('tool:activity', { reqId: run.reqId, kind: 'generate_image', label: p.prompt.slice(0, 80) });
  const filtro = deps.ajustes()?.filtro !== false;
  const cuerpo = {
    model: modelo.id,
    prompt: p.prompt,
    ...(p.negativo ? { negative_prompt: p.negativo } : {}),
    ...(p.aspecto ? { aspect_ratio: p.aspecto } : {}),
    ...(p.resolucion ? { resolution: p.resolucion } : {}),
    ...(p.estilo ? { style_preset: p.estilo } : {}),
    ...(p.semilla !== null ? { seed: p.semilla } : {}),
    variants: p.cuantas,
    safe_mode: filtro,
    hide_watermark: true,
    return_binary: false,
    format: 'webp',
  };
  const r = await pedirAVenice(cuerpo, run.ac?.signal);
  if (r.error) return `error: ${r.error}`;
  if (!r.imagenes.length) return 'error: Venice returned no image';

  const guardadas = [];
  try {
    for (const [i, buf] of r.imagenes.entries()) guardadas.push({ ...guardar(buf, i), buf });
  } catch (err) {
    return `error: the image was generated but could not be saved — ${err.message}`;
  }
  run._imagenes = hechas + guardadas.length;
  run.notify('tool:artifact', { reqId: run.reqId, images: guardadas.map((g) => ({ name: g.name, archivo: g.archivo })) });
  // El modelo solo la ve si la pidió, y si ve.
  const mira = a?.look === true;
  const ve = mira && deps.modeloVe(run);
  if (ve) for (const g of guardadas) (run._capturas ??= []).push(`data:${MIME[g.ext]};base64,${g.buf.toString('base64')}`);

  const precio = precioDe(modelo, p.resolucion);
  const renglones = [
    `Generated ${guardadas.length} image${guardadas.length === 1 ? '' : 's'} with ${modelo.nombre} (${modelo.id})${p.aspecto ? `, ${p.aspecto}` : ''}${p.resolucion ? `, ${p.resolucion}` : ''}. The user sees ${guardadas.length === 1 ? 'it' : 'them'} in the chat, under this call.`,
    ...guardadas.map((g) => `- ${g.archivo}`),
    guardadas.length < p.cuantas ? `Venice returned ${guardadas.length} of the ${p.cuantas} asked for.` : null,
    r.borrosa ? 'Venice blurred the result: its filter classed it as adult content. (The user can turn that filter off in Settings.)' : null,
    r.infraccion ? 'Venice flagged the result as against its terms: the image may be blacked out.' : null,
    precio !== null ? `Cost: about $${(precio * guardadas.length).toFixed(2)} of the user's Venice balance.` : null,
    mira ? (ve ? `${guardadas.length === 1 ? 'It is' : 'They are'} attached below for you to look at.` : 'You asked to look at it, but this model cannot see images.') : 'You did not get the image itself: say what you asked for, not what it looks like. Pass look: true next time if you need to check it.',
  ];
  return renglones.filter(Boolean).join('\n');
}

/** Para la tarjeta de permiso: con qué modelo, cuántas, y cuánto sale. */
async function vista(a = {}) {
  try {
    const lista = await modelos();
    const { modelo, error } = elegir(lista, a?.model);
    if (error) return { mode: 'fail', error: error.charAt(0).toUpperCase() + error.slice(1) + '.' };
    const p = armar(modelo, a);
    if (p.error) return { mode: 'fail', error: p.error.charAt(0).toUpperCase() + p.error.slice(1) + '.' };
    const precio = precioDe(modelo, p.resolucion);
    return { mode: 'imagen', modelo: modelo.nombre, cuantas: p.cuantas, aspecto: p.aspecto, resolucion: p.resolucion, total: precio === null ? null : Math.round(precio * p.cuantas * 100) / 100, filtro: deps.ajustes()?.filtro !== false };
  } catch {
    return null;
  }
}

const runners = {
  generate_image: (run, a) => runGenerateImage(run, a),
};

module.exports = { runners, configurar, modelos, vista, leer, esMia, formatoDe, deVenice, elegir, armar, runGenerateImage, pngDeMentira, lista: () => Boolean(deps.carpeta), POR_TURNO, VARIANTES_MAX, MIME };
