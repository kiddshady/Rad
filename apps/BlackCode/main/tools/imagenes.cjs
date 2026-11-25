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
//   - Desde la 0.22.0 la misma tool EDITA una imagen que ya existe
//     (`input_images`). Ver «Editar una imagen que ya existe», más abajo.
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
const crypto = require('node:crypto');
const { resolverEn } = require('./base.cjs');

const BASE = (process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1').replace(/\/+$/, '');
const VARIANTES_MAX = 4;     // el tope de Venice por pedido
const POR_TURNO = 8;         // imágenes por turno, entre todas las llamadas
const ESPERA_MS = 180000;    // algunos modelos tardan más de un minuto
const LISTA_MS = 10 * 60 * 1000;
const PROMPT_MAX = 7500;     // el tope de Venice; cada modelo puede tener uno menor
// Editar: lo que Venice acepta de cada imagen de entrada, y su modelo de fábrica.
const ENTRADA_MAX_BYTES = 25 * 1024 * 1024;
const PIXELES_MIN = 65536;       // 256×256
const PIXELES_MAX = 33177600;
const EDICION_PREDET = 'firered-image-edit';

let deps = {
  getKey: () => null,          // la llave de Venice, descifrada
  ajustes: () => ({}),         // { modelo, filtro } de Settings
  carpeta: null,               // donde vive `images`
  modeloVe: () => false,       // ¿el modelo de este turno ve imágenes?
  deMentira: false,            // el humo: sin red, con una imagen armada acá
  pedir: (...a) => fetch(...a),
  ahora: () => Date.now(),
  azar: () => Math.random(),
};

/** Lo que este módulo necesita de afuera (ver arriba). Lo que no venga queda como estaba. */
function configurar(d = {}) {
  for (const k of ['getKey', 'ajustes', 'modeloVe', 'pedir', 'ahora', 'azar']) if (typeof d[k] === 'function') deps[k] = d[k];
  if (typeof d.carpeta === 'string' && d.carpeta.trim()) deps.carpeta = path.resolve(d.carpeta);
  if (typeof d.deMentira === 'boolean') deps.deMentira = d.deMentira;
  cache = null;
  cacheEdicion = null;
}

const dirImagenes = () => (deps.carpeta ? path.join(deps.carpeta, 'images') : null);

// ---------- Los modelos ----------

let cache = null; // { at, lista }
let cacheEdicion = null; // lo mismo, para los modelos que editan

const DE_MENTIRA = [
  { id: 'sim-image', nombre: 'Simulated image', precio: 0.04, limite: 1500, aspectos: ['1:1', '16:9', '9:16'], aspecto: '1:1', resoluciones: [], resolucion: '', predeterminado: true },
  { id: 'sim-image-pro', nombre: 'Simulated image Pro', precio: 0.1, limite: 3000, aspectos: [], aspecto: '', resoluciones: ['1K', '2K'], resolucion: '1K', predeterminado: false },
];

// Los que editan, en el humo. El Pro cobra las imágenes de entrada que pasen de la primera.
const DE_MENTIRA_EDICION = [
  { id: 'sim-edit', nombre: 'Simulated edit', precio: 0.04, porResolucion: {}, limite: 1500, aspectos: ['auto', '1:1', '16:9'], aspecto: '', resoluciones: [], resolucion: '', entradas: 3, incluidas: null, porEntrada: null, predeterminado: true },
  { id: 'sim-edit-pro', nombre: 'Simulated edit Pro', precio: 0.1, porResolucion: { '1K': 0.1, '2K': 0.2 }, limite: 3000, aspectos: [], aspecto: '', resoluciones: ['1K', '2K'], resolucion: '1K', entradas: 6, incluidas: 1, porEntrada: 0.01, predeterminado: false },
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

/** Un modelo que EDITA (type=inpaint): lo mismo, con su precio por edición,
 *  cuántas imágenes de entrada acepta y si las cobra aparte. */
function deVeniceEdicion(m) {
  const spec = m?.model_spec ?? {};
  const c = spec.constraints ?? {};
  const precios = spec.pricing ?? {};
  const max = Number(c.maxInputImages);
  const incluidas = Number(precios.inputImages?.included);
  return {
    ...deVenice(m),
    precio: usd(precios.inpaint),
    // (lo que dice su documentación: si no viene, 3; 1 si el modelo no combina imágenes)
    entradas: Number.isInteger(max) && max > 0 ? max : (c.combineImages === false ? 1 : 3),
    incluidas: precios.inputImages && Number.isInteger(incluidas) && incluidas >= 0 ? incluidas : null,
    porEntrada: precios.inputImages ? usd(precios.inputImages.additional) : null,
    predeterminado: String(m.id) === EDICION_PREDET,
  };
}

function explicar(status, cuerpo, edicion = false) {
  const detalle = typeof cuerpo?.error === 'string' ? cuerpo.error : cuerpo?.error?.message ?? '';
  if (status === 401) return detalle && /pro users/i.test(detalle) ? 'that model is only for Venice Pro accounts' : 'Venice rejected the API key (the user sets it in Settings)';
  if (status === 402) return 'the Venice account has no balance left';
  if (status === 403) return 'this Venice key cannot be used from this network';
  if (status === 413) return 'an input image is too large for Venice (under 25 MB)';
  if (status === 422 && edicion) return 'Venice refused the edit: the instruction or the image goes against the content rules of that model, or the image is too large';
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

/** Los modelos que EDITAN imágenes (GET /models?type=inpaint). Otra lista, otros precios. */
async function modelosEdicion({ fresco = false, signal } = {}) {
  if (deps.deMentira) return DE_MENTIRA_EDICION;
  if (!fresco && cacheEdicion && deps.ahora() - cacheEdicion.at < LISTA_MS) return cacheEdicion.lista;
  const key = deps.getKey();
  const res = await deps.pedir(`${BASE}/models?type=inpaint`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal });
  if (!res.ok) throw new Error(explicar(res.status, await res.json().catch(() => null)));
  const data = (await res.json())?.data;
  const lista = (Array.isArray(data) ? data : [])
    .filter((m) => m?.id && m.type === 'inpaint' && !m.model_spec?.offline)
    .map(deVeniceEdicion)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'en', { numeric: true }));
  cacheEdicion = { at: deps.ahora(), lista };
  return lista;
}

/** Cuál se usa: el que pidió el agente, el de Settings, el que Venice marca
 *  como predeterminado, o el primero. `{ modelo }` o `{ error }`. */
function elegir(lista, pedido, { ajuste = 'modelo', que = 'image' } = {}) {
  const ids = () => lista.slice(0, 40).map((m) => m.id).join(', ');
  if (!lista.length) return { error: `Venice lists no ${que} models for this key` };
  const p = String(pedido ?? '').trim();
  if (p) {
    const m = lista.find((x) => x.id === p) ?? lista.find((x) => x.nombre.toLowerCase() === p.toLowerCase());
    return m ? { modelo: m } : { error: `there is no ${que} model ${JSON.stringify(p)}. The ${que} models are: ${ids()}` };
  }
  const deAjustes = lista.find((x) => x.id === deps.ajustes()?.[ajuste]);
  return { modelo: deAjustes ?? lista.find((x) => x.predeterminado) ?? lista[0] };
}
/** Lo mismo entre los que editan: el de Settings es `modeloEdicion`. (Un modelo de generar no edita: son ids distintos.) */
const elegirEdicion = (lista, pedido) => elegir(lista, pedido, { ajuste: 'modeloEdicion', que: 'image edit' });

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
  const lado = 256; // (lo mínimo que Venice edita: así una de mentira también se puede editar)
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

// ---------- Editar una imagen que ya existe ----------
//
// Con input_images la misma tool EDITA: el prompt es la instrucción («sacale
// el fondo», «que sea de noche») y Venice devuelve una imagen nueva. Lo que
// dice su documentación (leída el 25/11/2026; la lista de modelos se miró de
// verdad, es pública):
//   POST /image/edit        { model, prompt, image, aspect_ratio?, resolution?,
//                             safe_mode }                    una imagen
//   POST /image/multi-edit  { modelId, prompt, images: […], … }  la primera es
//                             la base y las demás son de referencia
//   → la respuesta ES la imagen (binario), no un JSON como /image/generate.
//   La imagen va en base64, pesa menos de 25 MB y tiene entre 65.536 y
//   33.177.600 píxeles. No hay seed, ni variantes, ni negative_prompt.
//   Los modelos que editan son otra lista (GET /models?type=inpaint), con su
//   precio (pricing.inpaint, y pricing.inputImages si cobra por imagen de
//   entrada) y cuántas imágenes aceptan (constraints.maxInputImages; si falta,
//   3, o 1 cuando combineImages es false). enhance_prompt existe y cuesta
//   aparte: esta tool no lo usa.
//
// Qué se puede editar: una imagen de un archivo (una generada antes, o
// cualquiera del disco) o una que el usuario adjuntó en este chat, que la tool
// recibe por su número (attachment:N). Los adjuntos no se copian al disco:
// llegan con el pedido del turno (run.adjuntas, ver chat.cjs).

/** Ancho y alto de un PNG, JPEG o WebP, leídos de su cabecera. null si no se puede. */
function medidas(buf, ext) {
  try {
    if (ext === 'png') return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
    if (ext === 'jpg') {
      for (let i = 2; i + 9 < buf.length;) {
        if (buf[i] !== 0xff || buf[i + 1] === 0xff) { i++; continue; }
        const m = buf[i + 1];
        // (los marcadores SOF traen el tamaño; C4, C8 y CC no lo son)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (ext === 'webp') {
      const tipo = buf.toString('latin1', 12, 16);
      if (tipo === 'VP8X') return { ancho: 1 + buf.readUIntLE(24, 3), alto: 1 + buf.readUIntLE(27, 3) };
      if (tipo === 'VP8 ') return { ancho: buf.readUInt16LE(26) & 0x3fff, alto: buf.readUInt16LE(28) & 0x3fff };
      if (tipo === 'VP8L') { const b = buf.readUInt32LE(21); return { ancho: 1 + (b & 0x3fff), alto: 1 + ((b >>> 14) & 0x3fff) }; }
    }
  } catch { /* una cabecera rota: no se sabe */ }
  return null;
}

/** Lo que pidió el agente en input_images, como lista de textos. */
const pedidasDe = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

/**
 * Busca cada imagen de entrada y la revisa contra los límites de Venice.
 * { entradas: [{ rotulo, buf, ext, bytes, ancho, alto }] } o { error }.
 */
function entradasDe(run, pedidas) {
  const adjuntas = Array.isArray(run?.adjuntas) ? run.adjuntas : [];
  const entradas = [];
  for (const ref of pedidas) {
    let buf;
    let rotulo = ref;
    const marca = /^attachment:\s*(\d+|last)$/i.exec(ref);
    if (marca) {
      if (!adjuntas.length) return { error: 'the user has not attached any image in this chat, so there is no ' + ref };
      const n = marca[1].toLowerCase() === 'last' ? adjuntas.length : Number(marca[1]);
      const url = adjuntas[n - 1];
      if (typeof url !== 'string') return { error: 'there is no attachment:' + n + '. The user attached ' + adjuntas.length + ' image' + (adjuntas.length === 1 ? '' : 's') + ' in this chat: attachment:1' + (adjuntas.length > 1 ? ' to attachment:' + adjuntas.length : '') };
      rotulo = 'attachment:' + n;
      buf = Buffer.from(url.replace(/^data:[^,]*,/, ''), 'base64');
    } else {
      let abs;
      try { abs = resolverEn(run, ref); } catch { return { error: JSON.stringify(ref) + ' is not a path' }; }
      let st;
      try { st = fs.statSync(abs); } catch { return { error: 'there is no file ' + abs + '. Pass the path of an image, or attachment:N for an image the user attached' }; }
      if (!st.isFile()) return { error: abs + ' is not a file' };
      if (st.size >= ENTRADA_MAX_BYTES) return { error: abs + ' is ' + Math.round(st.size / 1048576) + ' MB and Venice takes images under 25 MB' };
      try { buf = fs.readFileSync(abs); } catch (err) { return { error: 'could not read ' + abs + ' — ' + (err?.code ?? err?.message ?? err) }; }
      rotulo = abs;
    }
    const ext = formatoDe(buf);
    if (!ext) return { error: rotulo + ' is not a PNG, JPEG or WebP image, the three Venice can edit' };
    if (buf.length >= ENTRADA_MAX_BYTES) return { error: rotulo + ' is ' + Math.round(buf.length / 1048576) + ' MB and Venice takes images under 25 MB' };
    const m = medidas(buf, ext);
    if (m && m.ancho * m.alto < PIXELES_MIN) return { error: rotulo + ' is ' + m.ancho + '×' + m.alto + ': too small to edit (Venice needs at least 256×256)' };
    if (m && m.ancho * m.alto > PIXELES_MAX) return { error: rotulo + ' is ' + m.ancho + '×' + m.alto + ': too large to edit (Venice takes up to about 33 megapixels)' };
    entradas.push({ rotulo, buf, ext, bytes: buf.length, ancho: m?.ancho ?? null, alto: m?.alto ?? null });
  }
  return { entradas };
}

/** Revisa una edición contra lo que el modelo acepta. { error } o lo que se va a pedir. */
function armarEdicion(modelo, a = {}, cuantasEntradas = 1) {
  const prompt = String(a.prompt ?? '').trim();
  if (!prompt) return { error: 'prompt is required: say what to change in the image' };
  if (prompt.length > modelo.limite) return { error: 'the prompt has ' + prompt.length + ' characters and ' + modelo.id + ' takes up to ' + modelo.limite + '. Shorten it' };
  if (cuantasEntradas > modelo.entradas) return { error: modelo.id + ' takes up to ' + modelo.entradas + ' input image' + (modelo.entradas === 1 ? '' : 's') + ' and you passed ' + cuantasEntradas };
  if (cuantasDe(a.variants) > 1) return { error: 'an edit returns one image: leave variants out, and call again for another take' };
  // (auto, o nada, es la proporción de la imagen de entrada)
  const pedido = String(a.aspect_ratio ?? '').trim().toLowerCase();
  const aspecto = pedido === 'auto' ? '' : pedido;
  if (aspecto && !/^\d{1,2}:\d{1,2}$/.test(aspecto)) return { error: 'aspect_ratio must look like "16:9", not ' + JSON.stringify(aspecto) + '. Leave it out to keep the shape of the input image' };
  if (aspecto && modelo.aspectos.length && !modelo.aspectos.includes(aspecto)) return { error: modelo.id + ' does not do ' + aspecto + '. It does: ' + modelo.aspectos.join(', ') };
  const resolucion = String(a.resolution ?? '').trim();
  if (resolucion && modelo.resoluciones.length && !modelo.resoluciones.includes(resolucion)) return { error: modelo.id + ' does not do ' + resolucion + '. It does: ' + modelo.resoluciones.join(', ') };
  if (resolucion && !modelo.resoluciones.length) return { error: modelo.id + ' has a single resolution: leave resolution out' };
  return { prompt, aspecto, resolucion };
}

/** Lo que sale una edición: el precio del modelo (o el de esa resolución) y, si
 *  el modelo cobra las imágenes de entrada, las que pasen de las incluidas. null si Venice no lo publica. */
function precioEdicion(modelo, resolucion, cuantasEntradas) {
  const base = precioDe(modelo, resolucion);
  if (base === null || base === undefined) return null;
  const extra = modelo.porEntrada !== null && modelo.porEntrada !== undefined && modelo.incluidas !== null && modelo.incluidas !== undefined
    ? Math.max(0, cuantasEntradas - modelo.incluidas) * modelo.porEntrada : 0;
  return base + extra;
}

async function pedirEdicion(modelo, p, entradas, filtro, signal) {
  if (deps.deMentira) {
    if (/\bREFUSED\b/.test(p.prompt)) return { error: explicar(422, null, true) };
    // (el color sale de la instrucción Y de las imágenes de entrada: otra entrada, otra imagen)
    const huella = entradas.map((e) => crypto.createHash('sha1').update(e.buf).digest('hex').slice(0, 8)).join('+');
    return { imagen: pngDeMentira(p.prompt + '|' + huella, 0), borrosa: false };
  }
  const varias = entradas.length > 1;
  const b64 = (e) => e.buf.toString('base64');
  const cuerpo = {
    // (el campo del modelo se llama distinto en cada endpoint)
    ...(varias ? { modelId: modelo.id, images: entradas.map(b64) } : { model: modelo.id, image: b64(entradas[0]) }),
    prompt: p.prompt,
    ...(p.aspecto ? { aspect_ratio: p.aspecto } : {}),
    ...(p.resolucion ? { resolution: p.resolucion } : {}),
    safe_mode: filtro,
  };
  let res;
  try {
    res = await deps.pedir(BASE + (varias ? '/image/multi-edit' : '/image/edit'), {
      method: 'POST',
      headers: { authorization: 'Bearer ' + deps.getKey(), 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.any([signal, AbortSignal.timeout(ESPERA_MS)].filter(Boolean)),
    });
  } catch (err) {
    if (signal?.aborted) return { error: 'stopped' };
    if (err?.name === 'TimeoutError') return { error: 'Venice took more than ' + (ESPERA_MS / 1000) + ' seconds. Nothing was saved; the edit may still have been charged' };
    return { error: 'could not reach Venice — ' + (err?.cause?.code ?? err?.message ?? err) };
  }
  if (!res.ok) return { error: explicar(res.status, await res.json().catch(() => null), true) };
  let imagen;
  try { imagen = Buffer.from(await res.arrayBuffer()); } catch { return { error: 'Venice answered, but the image did not arrive whole' }; }
  const si = (h) => String(res.headers.get(h) ?? '').toLowerCase() === 'true';
  return { imagen, borrosa: si('x-venice-is-blurred'), infraccion: si('x-venice-is-content-violation') };
}

async function runEditarImagen(run, a, pedidas) {
  const hechas = run._imagenes ?? 0;
  if (hechas + 1 > POR_TURNO) return 'error: this turn already made ' + hechas + ' image' + (hechas === 1 ? '' : 's') + ' and the limit is ' + POR_TURNO + ' per turn (each one costs the user money). Stop here and ask the user before making more.';
  if (!deps.deMentira && !deps.getKey()) return 'error: there is no Venice API key. The user sets it in Settings, under Venice key.';
  const e = entradasDe(run, pedidas);
  if (e.error) return 'error: ' + e.error;
  let lista;
  try { lista = await modelosEdicion({ signal: run.ac?.signal }); } catch (err) { return 'error: could not load the image edit models — ' + err.message; }
  const { modelo, error: sinModelo } = elegirEdicion(lista, a?.model);
  if (sinModelo) return 'error: ' + sinModelo;
  const p = armarEdicion(modelo, a, e.entradas.length);
  if (p.error) return 'error: ' + p.error;

  run.notify('tool:activity', { reqId: run.reqId, kind: 'generate_image', label: p.prompt.slice(0, 80) });
  const r = await pedirEdicion(modelo, p, e.entradas, deps.ajustes()?.filtro !== false, run.ac?.signal);
  if (r.error) return 'error: ' + r.error;
  let g;
  try { g = guardar(r.imagen, 0); } catch (err) { return 'error: the image was edited but could not be saved — ' + err.message; }
  run._imagenes = hechas + 1;
  const mira = a?.look === true;
  const ve = mira && deps.modeloVe(run);
  const rotulos = e.entradas.map((x) => x.rotulo);
  // («entradas» va al registro del turno siguiente: de qué imágenes salió esta)
  run.notify('tool:artifact', {
    reqId: run.reqId,
    images: [{ name: g.name, archivo: g.archivo }],
    detalle: { prompt: p.prompt, modelo: modelo.id, aspecto: p.aspecto, resolucion: p.resolucion, semilla: null, visto: ve, entradas: rotulos },
  });
  if (ve) (run._capturas ??= []).push('data:' + MIME[g.ext] + ';base64,' + r.imagen.toString('base64'));
  const precio = precioEdicion(modelo, p.resolucion, e.entradas.length);
  return [
    'Edited with ' + modelo.nombre + ' (' + modelo.id + ')' + (p.aspecto ? ', ' + p.aspecto : '') + (p.resolucion ? ', ' + p.resolucion : '') + ', from ' + (rotulos.length === 1 ? rotulos[0] : rotulos.length + ' images: ' + rotulos.join(', ')) + '. The user sees the result in the chat, under this call. The input image' + (rotulos.length === 1 ? ' was' : 's were') + ' not changed.',
    '- ' + g.archivo,
    r.borrosa ? 'Venice blurred the result: its filter classed it as adult content. (The user can turn that filter off in Settings.)' : null,
    r.infraccion ? 'Venice flagged the result as against its terms: the image may be blacked out.' : null,
    precio !== null ? 'Cost: about $' + precio.toFixed(2) + " of the user's Venice balance." : null,
    'To edit it again, pass that path as input_images.',
    mira ? (ve ? 'It is attached below for you to look at.' : 'You asked to look at it, but this model cannot see images.') : 'You did not get the image itself: say what you asked for, not what it looks like. Pass look: true next time if you need to check it.',
  ].filter(Boolean).join('\n');
}

/** Para la tarjeta de permiso de una edición: con qué modelo, qué imágenes se suben y cuánto sale. */
async function vistaEdicion(run, a, pedidas) {
  const e = entradasDe(run, pedidas);
  const mayus = (t) => t.charAt(0).toUpperCase() + t.slice(1) + '.';
  if (e.error) return { mode: 'fail', error: mayus(e.error) };
  const { modelo, error } = elegirEdicion(await modelosEdicion(), a?.model);
  if (error) return { mode: 'fail', error: mayus(error) };
  const p = armarEdicion(modelo, a, e.entradas.length);
  if (p.error) return { mode: 'fail', error: mayus(p.error) };
  const precio = precioEdicion(modelo, p.resolucion, e.entradas.length);
  return {
    mode: 'imagen', edita: true, modelo: modelo.nombre, cuantas: 1, aspecto: p.aspecto, resolucion: p.resolucion,
    total: precio === null ? null : Math.round(precio * 100) / 100, filtro: deps.ajustes()?.filtro !== false,
    entradas: e.entradas.map((x) => ({ rotulo: x.rotulo, bytes: x.bytes, ancho: x.ancho, alto: x.alto })),
  };
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
  // Con imágenes de entrada no genera: edita.
  const pedidas = pedidasDe(a?.input_images);
  if (pedidas.length) return runEditarImagen(run, a, pedidas);
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
  // La semilla. Si el agente no pasó una y pide UNA imagen, la elige la tool:
  // así queda anotada y esa imagen se puede repetir o variar después (Venice
  // no devuelve la que usó). Con varias variantes no se manda: con la misma
  // semilla no hay garantía de que salgan distintas.
  const semilla = p.semilla ?? (p.cuantas === 1 ? Math.floor(deps.azar() * 999999999) + 1 : null);
  const cuerpo = {
    model: modelo.id,
    prompt: p.prompt,
    ...(p.negativo ? { negative_prompt: p.negativo } : {}),
    ...(p.aspecto ? { aspect_ratio: p.aspecto } : {}),
    ...(p.resolucion ? { resolution: p.resolucion } : {}),
    ...(p.estilo ? { style_preset: p.estilo } : {}),
    ...(semilla !== null ? { seed: semilla } : {}),
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
  // El modelo solo la ve si la pidió, y si ve.
  const mira = a?.look === true;
  const ve = mira && deps.modeloVe(run);
  // `detalle` es lo que el agente va a necesitar en los turnos SIGUIENTES,
  // cuando ya no tenga este resultado a la vista: el prompt entero (para
  // mejorarlo hay que volver a mandarlo completo), con qué se hizo, la
  // semilla y si la miró. Va con la fila del chat y vuelve en el registro.
  run.notify('tool:artifact', {
    reqId: run.reqId,
    images: guardadas.map((g) => ({ name: g.name, archivo: g.archivo })),
    detalle: { prompt: p.prompt, modelo: modelo.id, aspecto: p.aspecto, resolucion: p.resolucion, semilla, visto: ve },
  });
  if (ve) for (const g of guardadas) (run._capturas ??= []).push(`data:${MIME[g.ext]};base64,${g.buf.toString('base64')}`);

  const precio = precioDe(modelo, p.resolucion);
  const renglones = [
    `Generated ${guardadas.length} image${guardadas.length === 1 ? '' : 's'} with ${modelo.nombre} (${modelo.id})${p.aspecto ? `, ${p.aspecto}` : ''}${p.resolucion ? `, ${p.resolucion}` : ''}. The user sees ${guardadas.length === 1 ? 'it' : 'them'} in the chat, under this call.`,
    ...guardadas.map((g) => `- ${g.archivo}`),
    guardadas.length < p.cuantas ? `Venice returned ${guardadas.length} of the ${p.cuantas} asked for.` : null,
    r.borrosa ? 'Venice blurred the result: its filter classed it as adult content. (The user can turn that filter off in Settings.)' : null,
    r.infraccion ? 'Venice flagged the result as against its terms: the image may be blacked out.' : null,
    precio !== null ? `Cost: about $${(precio * guardadas.length).toFixed(2)} of the user's Venice balance.` : null,
    semilla !== null ? `Seed: ${semilla}. The same seed with the same prompt and model gives this image again.` : null,
    mira ? (ve ? `${guardadas.length === 1 ? 'It is' : 'They are'} attached below for you to look at.` : 'You asked to look at it, but this model cannot see images.') : 'You did not get the image itself: say what you asked for, not what it looks like. Pass look: true next time if you need to check it.',
  ];
  return renglones.filter(Boolean).join('\n');
}

/** Para la tarjeta de permiso: con qué modelo, cuántas, y cuánto sale. */
async function vista(a = {}, run = null) {
  try {
    const pedidas = pedidasDe(a?.input_images);
    if (pedidas.length) return await vistaEdicion(run, a, pedidas);
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

module.exports = { runners, configurar, modelos, modelosEdicion, vista, leer, esMia, formatoDe, medidas, deVenice, deVeniceEdicion, elegir, elegirEdicion, armar, armarEdicion, entradasDe, precioEdicion, runGenerateImage, pngDeMentira, lista: () => Boolean(deps.carpeta), POR_TURNO, VARIANTES_MAX, MIME };
