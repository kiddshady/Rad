// Test de generate_image (apps/BlackCode/main/tools/imagenes.cjs) con node
// pelado, contra un servidor local que hace de Venice: no sale a internet ni
// gasta un crédito.
// Uso: node tools/test-blackcode-imagenes.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };

// ---------- Un Venice de mentira ----------
const LLAVE = 'no-es-una-llave-de-venice';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 7)]);
const MODELOS = [
  { id: 'zeta-image', type: 'image', model_spec: { name: 'Zeta', traits: [], pricing: { generation: { usd: 0.01, diem: 0.01 } }, constraints: { promptCharacterLimit: 60, steps: { default: 8, max: 30 }, widthHeightDivisor: 16 } } },
  { id: 'alfa-image', type: 'image', model_spec: { name: 'Alfa', traits: ['default'], pricing: { generation: { usd: 0.04, diem: 0.04 }, resolutions: { '1K': { usd: 0.04 }, '2K': { usd: 0.09 } } }, constraints: { promptCharacterLimit: 1500, steps: { default: 8, max: 30 }, widthHeightDivisor: 16, aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1', resolutions: ['1K', '2K'], defaultResolution: '1K' } } },
  { id: 'apagado-image', type: 'image', model_spec: { name: 'Apagado', offline: true, pricing: {}, constraints: {} } },
  { id: 'un-texto', type: 'text', model_spec: { name: 'Un modelo de texto' } },
  { id: 'sin-precio', type: 'image', model_spec: { name: 'Beta sin precio', constraints: { promptCharacterLimit: 500 } } },
];
// Los que editan (type=inpaint): otra lista, con su precio por edición.
const MODELOS_EDICION = [
  { id: 'seed-edit', type: 'inpaint', model_spec: { name: 'Seed', pricing: { inpaint: { usd: 0.02 }, resolutions: { '1K': { usd: 0.02 }, '2K': { usd: 0.05 } }, inputImages: { included: 1, additional: { usd: 0.01 } } }, constraints: { promptCharacterLimit: 10000, combineImages: true, maxInputImages: 10, aspectRatios: ['auto', '1:1', '16:9'], defaultResolution: '1K', resolutions: ['1K', '2K'] } } },
  { id: 'firered-image-edit', type: 'inpaint', model_spec: { name: 'FireRed', pricing: { inpaint: { usd: 0.04 } }, constraints: { promptCharacterLimit: 1500, combineImages: true, aspectRatios: ['auto', '1:1', '16:9'] } } },
  { id: 'luma-edit', type: 'inpaint', model_spec: { name: 'Luma', pricing: {}, constraints: { combineImages: false } } },
  { id: 'apagado-edit', type: 'inpaint', model_spec: { name: 'Apagado', offline: true, pricing: { inpaint: { usd: 1 } }, constraints: {} } },
  { id: 'colado-image', type: 'image', model_spec: { name: 'Colado', pricing: { generation: { usd: 1 } }, constraints: {} } },
];
// (lo que /image/edit devuelve: la imagen en binario, un PNG mínimo)
const EDITADA = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
const visto = { modelos: 0, modelosEdicion: 0, generar: [], editar: [], cabeceras: [] };
let proximo = null; // lo que contesta el próximo /image/generate
let proximoE = null; // …y el próximo /image/edit o /image/multi-edit
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let cuerpo = '';
  req.on('data', (d) => { cuerpo += d; });
  req.on('end', () => {
    visto.cabeceras.push(req.headers.authorization ?? '');
    const json = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${LLAVE}`) return json(401, { error: 'Authentication failed' });
    if (url.pathname === '/models' && url.searchParams.get('type') === 'inpaint') {
      visto.modelosEdicion++;
      return json(200, { data: MODELOS_EDICION });
    }
    if (url.pathname === '/models') {
      visto.modelos++;
      if (url.searchParams.get('type') !== 'image') return json(200, { data: MODELOS.filter((m) => m.type === 'text') });
      return json(200, { data: MODELOS });
    }
    if (url.pathname === '/image/generate' && req.method === 'POST') {
      const pedido = JSON.parse(cuerpo);
      visto.generar.push(pedido);
      const r = proximo ?? {};
      proximo = null;
      if (r.cuelga) return; // nunca contesta
      if (r.status) return json(r.status, r.cuerpo ?? { error: 'x' });
      if (r.crudo !== undefined) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(r.crudo); }
      const imagenes = r.imagenes ?? Array.from({ length: pedido.variants ?? 1 }, () => WEBP.toString('base64'));
      return json(200, { id: 'generate-image-1', images: imagenes, timing: { total: 1 } }, r.headers ?? {});
    }
    if ((url.pathname === '/image/edit' || url.pathname === '/image/multi-edit') && req.method === 'POST') {
      visto.editar.push({ ruta: url.pathname, pedido: JSON.parse(cuerpo) });
      const r = proximoE ?? {};
      proximoE = null;
      if (r.cuelga) return; // nunca contesta
      if (r.status) return json(r.status, r.cuerpo ?? { error: 'x' });
      res.writeHead(200, { 'content-type': 'image/png', ...(r.headers ?? {}) });
      return res.end(r.binario ?? EDITADA);
    }
    json(404, { error: 'no such endpoint' });
  });
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
process.env.VENICE_BASE_URL = `http://127.0.0.1:${servidor.address().port}`;

const I = require(process.env.BLACKCODE_IMAGENES || path.join(APP, 'main', 'tools', 'imagenes.cjs'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-imagenes-'));
const ajustes = { modelo: '', filtro: true };
let llave = LLAVE;
let ve = false;
let reloj = Date.parse('2026-11-25T15:04:05');
I.configurar({ getKey: () => llave, ajustes: () => ajustes, carpeta: dir, modeloVe: () => ve, ahora: () => reloj, azar: () => 0.5, deMentira: false });

// Una corrida de mentira, que anota lo que la tool avisa.
function corrida() {
  const avisos = [];
  return { reqId: 'r1', ac: new AbortController(), notify: (canal, datos) => avisos.push([canal, datos]), avisos };
}
const generar = (args, run = corrida()) => I.runGenerateImage(run, args).then((texto) => ({ texto, run }));

try {
  // ---------- 1. los modelos ----------
  {
    const lista = await I.modelos();
    ok('pide los modelos de IMAGEN, con la llave', visto.modelos === 1 && visto.cabeceras.at(-1) === `Bearer ${LLAVE}`);
    ok('deja afuera los de texto y los apagados, ordenados por nombre', lista.map((m) => m.id).join() === 'alfa-image,sin-precio,zeta-image', lista.map((m) => m.id).join());
    const alfa = lista[0];
    ok('de cada uno: nombre, precio, límite del prompt, formatos y cuál es el predeterminado', alfa.nombre === 'Alfa' && alfa.precio === 0.04 && alfa.limite === 1500 && alfa.aspectos.join() === '1:1,16:9' && alfa.aspecto === '1:1' && alfa.resoluciones.join() === '1K,2K' && alfa.porResolucion['2K'] === 0.09 && alfa.predeterminado === true, JSON.stringify(alfa));
    ok('uno sin precio ni formatos declarados no rompe', lista[1].precio === null && lista[1].aspectos.length === 0 && lista[1].limite === 500 && lista[1].predeterminado === false);
    await I.modelos();
    ok('la lista se guarda un rato: no se pide en cada llamada', visto.modelos === 1);
    reloj += 11 * 60 * 1000;
    await I.modelos();
    ok('…y pasados diez minutos se pide de nuevo', visto.modelos === 2);
    await I.modelos({ fresco: true });
    ok('…o cuando se la pide fresca (Settings)', visto.modelos === 3);
    llave = 'otra';
    let dijo = '';
    try { await I.modelos({ fresco: true }); } catch (err) { dijo = err.message; }
    ok('con la llave rechazada, lo dice', /rejected the API key/.test(dijo), dijo);
    llave = LLAVE;
  }

  // ---------- 2. elegir el modelo ----------
  {
    const lista = await I.modelos({ fresco: true });
    ok('sin pedir ninguno ni elegir en Settings: el que Venice marca como predeterminado', I.elegir(lista).modelo?.id === 'alfa-image');
    ajustes.modelo = 'zeta-image';
    ok('el de Settings manda sobre el predeterminado', I.elegir(lista).modelo?.id === 'zeta-image');
    ok('el que pide el agente manda sobre el de Settings', I.elegir(lista, 'sin-precio').modelo?.id === 'sin-precio');
    ok('también por su nombre', I.elegir(lista, 'beta SIN precio').modelo?.id === 'sin-precio');
    const malo = I.elegir(lista, 'flux-99');
    ok('uno que no existe: error con la lista de los que hay', !malo.modelo && malo.error?.includes('"flux-99"') && malo.error?.includes('alfa-image, sin-precio, zeta-image'), malo.error);
    ajustes.modelo = 'uno-que-ya-no-existe';
    ok('si el de Settings ya no existe, cae al predeterminado', I.elegir(lista).modelo?.id === 'alfa-image');
    ajustes.modelo = '';
    ok('sin ningún modelo en la lista, lo dice', I.elegir([]).error?.includes('no image models'));
  }

  // ---------- 3. revisar los argumentos ----------
  {
    const [alfa, , zeta] = await I.modelos();
    ok('sin prompt no hay imagen', I.armar(alfa, {}).error?.includes('prompt is required') && I.armar(alfa, { prompt: '   ' }).error?.includes('prompt is required'));
    ok('un prompt más largo que el tope DEL MODELO se rechaza antes de pedir', I.armar(zeta, { prompt: 'x'.repeat(61) }).error?.includes('takes up to 60'));
    ok('…y uno que entra, no', !I.armar(zeta, { prompt: 'x'.repeat(60) }).error);
    ok('aspect_ratio tiene que tener forma de proporción', I.armar(alfa, { prompt: 'p', aspect_ratio: 'wide' }).error?.includes('must look like'));
    ok('…y ser uno de los que el modelo hace', I.armar(alfa, { prompt: 'p', aspect_ratio: '4:5' }).error?.includes('It does: 1:1, 16:9') && !I.armar(alfa, { prompt: 'p', aspect_ratio: '16:9' }).error);
    ok('si el modelo no declara cuáles hace, pasa el que se pida', I.armar(zeta, { prompt: 'p', aspect_ratio: '4:5' }).aspecto === '4:5');
    ok('resolution, lo mismo', I.armar(alfa, { prompt: 'p', resolution: '4K' }).error?.includes('It does: 1K, 2K') && I.armar(alfa, { prompt: 'p', resolution: '2K' }).resolucion === '2K' && I.armar(zeta, { prompt: 'p', resolution: '2K' }).error?.includes('single resolution'));
    ok('variants va de 1 a 4', [0, -3, 'x', undefined, 2.4, 4, 9].map((v) => I.armar(alfa, { prompt: 'p', variants: v }).cuantas).join() === '1,1,1,1,2,4,4');
    ok('seed: un entero dentro del rango, o nada', I.armar(alfa, { prompt: 'p', seed: 42.9 }).semilla === 42 && I.armar(alfa, { prompt: 'p' }).semilla === null && I.armar(alfa, { prompt: 'p', seed: 'abc' }).error?.includes('seed') && I.armar(alfa, { prompt: 'p', seed: 1e12 }).error?.includes('seed'));
  }

  // ---------- 4. generar ----------
  {
    visto.generar.length = 0;
    const { texto, run } = await generar({ prompt: '  A red fox in the snow  ', aspect_ratio: '16:9', negative_prompt: 'text', variants: 2, seed: 7, style: 'Cinematic' });
    const p = visto.generar[0];
    ok('pide a Venice con el modelo, el prompt limpio y lo que se pasó', p.model === 'alfa-image' && p.prompt === 'A red fox in the snow' && p.aspect_ratio === '16:9' && p.negative_prompt === 'text' && p.variants === 2 && p.seed === 7 && p.style_preset === 'Cinematic', JSON.stringify(p));
    ok('…en base64, sin marca de agua, en webp', p.return_binary === false && p.hide_watermark === true && p.format === 'webp');
    ok('…con el filtro de Settings (prendido)', p.safe_mode === true);
    ok('…y sin width ni height (hay modelos que los rechazan)', !('width' in p) && !('height' in p) && !('steps' in p));
    const artefacto = run.avisos.find(([c]) => c === 'tool:artifact')?.[1];
    ok('avisa de las dos imágenes, por su ARCHIVO', artefacto?.images.length === 2 && artefacto.images.every((im) => typeof im.archivo === 'string' && typeof im.name === 'string'), JSON.stringify(artefacto));
    ok('…y no manda la imagen adentro del aviso (no va al documento del chat)', artefacto.images.every((im) => !('dataUrl' in im)) && !JSON.stringify(artefacto).includes('base64'));
    const [a1, a2] = artefacto.images.map((im) => im.archivo);
    ok('las guarda en images/<año-mes>/, con el formato que tienen de verdad', a1.startsWith(path.join(dir, 'images', '2026-11') + path.sep) && a1.endsWith('.webp') && a1 !== a2 && fs.readFileSync(a1).equals(WEBP) && fs.existsSync(a2), `${a1} · ${a2}`);
    ok('le dice al modelo qué hizo y dónde quedó', texto.startsWith('Generated 2 images with Alfa (alfa-image), 16:9.') && texto.includes(`- ${a1}`) && texto.includes(`- ${a2}`), texto);
    ok('…cuánto salió', texto.includes('Cost: about $0.08'), texto);
    ok('…y que no la vio', texto.includes('You did not get the image itself') && !run._capturas, texto);
    ok('avisa de la actividad con el prompt', run.avisos.some(([c, d]) => c === 'tool:activity' && d.kind === 'generate_image' && d.label === 'A red fox in the snow'));
    ok('cuenta las imágenes del turno', run._imagenes === 2);
    // lo que queda anotado para los turnos siguientes
    ok('deja anotado el prompt ENTERO, el modelo, el formato, la semilla y que no la miró', JSON.stringify(artefacto.detalle) === JSON.stringify({ prompt: 'A red fox in the snow', modelo: 'alfa-image', aspecto: '16:9', resolucion: '', semilla: 7, visto: false }), JSON.stringify(artefacto.detalle));
    ok('le dice la semilla al agente', texto.includes('Seed: 7.'), texto);
    // otra en el mismo segundo no pisa a la anterior
    const { run: otra } = await generar({ prompt: 'again' });
    const a3 = otra.avisos.find(([c]) => c === 'tool:artifact')[1].images[0].archivo;
    ok('dos pedidos en el mismo segundo no se pisan', a3 !== a1 && a3 !== a2 && fs.existsSync(a3), a3);
  }
  {
    // el precio por resolución, y lo mínimo
    visto.generar.length = 0;
    const { texto } = await generar({ prompt: 'p', resolution: '2K' });
    ok('con resolución, el precio es el de esa resolución', texto.includes('Cost: about $0.09') && visto.generar[0].resolution === '2K', texto);
    const { texto: t2 } = await generar({ prompt: 'p', model: 'sin-precio' });
    ok('un modelo sin precio publicado no inventa un costo', !t2.includes('Cost:') && t2.startsWith('Generated 1 image with Beta sin precio'), t2);
    ok('lo que no se pasa no viaja', !('aspect_ratio' in visto.generar[1]) && !('negative_prompt' in visto.generar[1]) && !('style_preset' in visto.generar[1]) && visto.generar[1].variants === 1, JSON.stringify(visto.generar[1]));
    // la semilla: si el agente no pasó una y pide UNA imagen, la elige la tool y la dice
    ok('una imagen sin semilla: la tool elige una, la manda y la dice', visto.generar[1].seed === 499999999 + 1 - 0 || (Number.isSafeInteger(visto.generar[1].seed) && visto.generar[1].seed > 0 && t2.includes(`Seed: ${visto.generar[1].seed}.`)), `${visto.generar[1].seed} · ${t2}`);
    ok('…y es la misma que le dice', t2.includes(`Seed: ${visto.generar[1].seed}.`), t2);
    const antesV = visto.generar.length;
    const { texto: t3 } = await generar({ prompt: 'p', variants: 3 });
    ok('con varias variantes no manda semilla (saldrían iguales) ni dice una', !('seed' in visto.generar[antesV]) && !t3.includes('Seed:'), JSON.stringify(visto.generar[antesV]));
  }

  // ---------- 5. mirar lo que generó ----------
  {
    ve = true;
    const { texto, run } = await generar({ prompt: 'p', look: true, variants: 2 });
    ok('…y queda anotado que la miró', run.avisos.find(([c]) => c === 'tool:artifact')[1].detalle.visto === true);
    ok('con look y un modelo que ve, recibe las imágenes', run._capturas?.length === 2 && run._capturas.every((u) => u.startsWith('data:image/webp;base64,')) && texto.includes('attached below for you to look at'), texto);
    ve = false;
    const { texto: t2, run: r2 } = await generar({ prompt: 'p', look: true });
    ok('con look y un modelo que no ve, se le dice y no se le manda nada', !r2._capturas && t2.includes('this model cannot see images'), t2);
    ve = true;
    const { run: r3 } = await generar({ prompt: 'p' });
    ok('sin look no la recibe aunque vea (no gasta en mirar)', !r3._capturas);
    ve = false;
  }

  // ---------- 6. el filtro ----------
  {
    visto.generar.length = 0;
    ajustes.filtro = false;
    await generar({ prompt: 'p', safe_mode: true });
    ok('con el filtro apagado en Settings, safe_mode va en false', visto.generar[0].safe_mode === false);
    ajustes.filtro = true;
    await generar({ prompt: 'p', safe_mode: false });
    ok('el agente no puede apagarlo con un argumento', visto.generar[1].safe_mode === true);
    proximo = { headers: { 'x-venice-is-blurred': 'true' } };
    const { texto } = await generar({ prompt: 'p' });
    ok('si Venice la devolvió borroneada, se dice', texto.includes('Venice blurred the result'), texto);
    proximo = { headers: { 'x-venice-is-content-violation': 'true' } };
    ok('…y si la marcó como infracción, también', (await generar({ prompt: 'p' })).texto.includes('against its terms'));
  }

  // ---------- 7. lo que sale mal ----------
  {
    const antes = fs.readdirSync(path.join(dir, 'images', '2026-11')).length;
    const falla = async (r, args = { prompt: 'p' }) => { proximo = r; const { texto, run } = await generar(args); return { texto, run }; };
    ok('sin saldo', (await falla({ status: 402, cuerpo: { error: 'INSUFFICIENT_BALANCE' } })).texto === 'error: the Venice account has no balance left');
    const rechazo = await falla({ status: 422, cuerpo: { error: 'violation', suggested_prompt: 'a fox, fully dressed' } });
    ok('un prompt rechazado trae la sugerencia de Venice', rechazo.texto.includes('refused the prompt') && rechazo.texto.includes('"a fox, fully dressed"'), rechazo.texto);
    ok('demasiados pedidos', (await falla({ status: 429 })).texto.includes('too many requests'));
    ok('el modelo sin lugar', (await falla({ status: 503 })).texto.includes('at capacity'));
    ok('un modelo solo para Pro', (await falla({ status: 401, cuerpo: { error: 'This model is only available to Pro users' } })).texto.includes('only for Venice Pro'));
    ok('un 400 dice lo que dijo Venice', (await falla({ status: 400, cuerpo: { error: 'aspect_ratio is not supported' } })).texto.includes('aspect_ratio is not supported'));
    ok('una respuesta que no es JSON', (await falla({ crudo: '<html>oops' })).texto.includes('not JSON'));
    ok('ninguna imagen en la respuesta', (await falla({ imagenes: [] })).texto === 'error: Venice returned no image');
    const basura = await falla({ imagenes: [Buffer.from('esto no es una imagen, es texto').toString('base64')] });
    ok('algo que no es una imagen no se guarda como si lo fuera', basura.texto.includes('could not be saved') && basura.texto.includes('not an image'), basura.texto);
    ok('ninguno de esos dejó un archivo ni un aviso', fs.readdirSync(path.join(dir, 'images', '2026-11')).length === antes && !rechazo.run.avisos.some(([c]) => c === 'tool:artifact') && !basura.run.avisos.some(([c]) => c === 'tool:artifact') && !basura.run._imagenes);
    // frenado a mitad
    const run = corrida();
    proximo = { cuelga: true };
    const pendiente = I.runGenerateImage(run, { prompt: 'p' });
    const t0 = Date.now();
    setTimeout(() => run.ac.abort(), 60);
    const frenado = await pendiente;
    // (enseguida: no cuando venza la espera del pedido)
    ok('frenar el turno corta el pedido, en el acto', frenado === 'error: stopped' && Date.now() - t0 < 600, `${frenado} a los ${Date.now() - t0} ms`);
    // sin llave
    llave = null;
    visto.generar.length = 0;
    ok('sin llave de Venice lo dice, sin pedir nada', (await generar({ prompt: 'p' })).texto.includes('no Venice API key') && visto.generar.length === 0);
    llave = LLAVE;
    ok('sin prompt no se pide nada', (await generar({})).texto === 'error: prompt is required: describe the image' && visto.generar.length === 0);
    ok('un modelo que no existe no se pide', (await generar({ prompt: 'p', model: 'flux-99' })).texto.includes('there is no image model "flux-99"') && visto.generar.length === 0);
  }

  // ---------- 8. el tope del turno ----------
  {
    const run = corrida();
    visto.generar.length = 0;
    await I.runGenerateImage(run, { prompt: 'p', variants: 4 });
    await I.runGenerateImage(run, { prompt: 'p', variants: 3 });
    ok('lleva la cuenta entre llamadas del mismo turno', run._imagenes === 7);
    const pasada = await I.runGenerateImage(run, { prompt: 'p', variants: 2 });
    ok(`pasado el tope de ${I.POR_TURNO} por turno, se niega y le dice que pregunte`, pasada.includes('already made 7 images') && pasada.includes('ask the user'), pasada);
    ok('…sin pedirle nada a Venice (no gasta)', visto.generar.length === 2);
    ok('una más que entra justo, sí', (await I.runGenerateImage(run, { prompt: 'p', variants: 1 })).startsWith('Generated 1 image') && run._imagenes === 8);
    ok('otro turno arranca de cero', (await generar({ prompt: 'p' })).run._imagenes === 1);
  }

  // ---------- 9. leer para mostrar ----------
  {
    const { run } = await generar({ prompt: 'p' });
    const archivo = run.avisos.find(([c]) => c === 'tool:artifact')[1].images[0].archivo;
    ok('una imagen de la carpeta se lee como data URL', I.leer(archivo) === `data:image/webp;base64,${WEBP.toString('base64')}`);
    const afuera = path.join(dir, 'secreto.png');
    fs.writeFileSync(afuera, I.pngDeMentira('x', 0));
    ok('un archivo de AFUERA de la carpeta no se lee, aunque sea una imagen', I.leer(afuera) === null && !I.esMia(afuera));
    ok('…ni subiendo con ..', I.leer(path.join(dir, 'images', '..', 'secreto.png')) === null);
    const texto = path.join(dir, 'images', 'notas.txt');
    fs.writeFileSync(texto, 'hola');
    ok('…ni algo de la carpeta que no es una imagen', I.leer(texto) === null);
    const disfraz = path.join(dir, 'images', 'disfraz.png');
    fs.writeFileSync(disfraz, 'esto dice png pero es texto');
    ok('…ni un archivo con extensión de imagen que no lo es', I.leer(disfraz) === null);
    ok('una ruta que no existe, o cualquier cosa, da null', I.leer(path.join(dir, 'images', 'no.png')) === null && I.leer('') === null && I.leer(null) === null && I.leer({}) === null);
  }

  // ---------- 10. la tarjeta de permiso ----------
  {
    const v = await I.vista({ prompt: 'p', variants: 3, aspect_ratio: '16:9' });
    ok('la tarjeta dice el modelo, cuántas y cuánto sale', v.mode === 'imagen' && v.modelo === 'Alfa' && v.cuantas === 3 && v.total === 0.12 && v.aspecto === '16:9' && v.filtro === true, JSON.stringify(v));
    ok('sin precio publicado no dice un total', (await I.vista({ prompt: 'p', model: 'sin-precio' })).total === null);
    ok('si la llamada va a fallar, la tarjeta lo adelanta', (await I.vista({ prompt: 'p', model: 'flux-99' })).mode === 'fail' && (await I.vista({ prompt: '' })).mode === 'fail');
    const antes = visto.generar.length;
    await I.vista({ prompt: 'p' });
    ok('mirar la tarjeta no genera nada', visto.generar.length === antes);
  }

  // ---------- 11. el modo de mentira (el humo) ----------
  {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-imagenes-sim-'));
    let pedidos = 0;
    I.configurar({ carpeta: dir2, deMentira: true, getKey: () => null, pedir: () => { pedidos++; throw new Error('el modo de mentira no sale a la red'); } });
    const lista = await I.modelos();
    ok('en el humo los modelos son de mentira', lista.length === 2 && lista[0].id === 'sim-image' && lista[0].predeterminado);
    const { texto, run } = await generar({ prompt: 'A fox', variants: 2 });
    const imgs = run.avisos.find(([c]) => c === 'tool:artifact')?.[1].images ?? [];
    ok('genera sin llave y sin red', texto.startsWith('Generated 2 images with Simulated image') && pedidos === 0, texto);
    ok('…PNG de verdad, distintos entre sí', imgs.length === 2 && imgs.every((im) => im.archivo.endsWith('.png') && I.formatoDe(fs.readFileSync(im.archivo)) === 'png') && !fs.readFileSync(imgs[0].archivo).equals(fs.readFileSync(imgs[1].archivo)));
    ok('…que se pueden mostrar', I.leer(imgs[0].archivo)?.startsWith('data:image/png;base64,'));
    ok('un prompt con REFUSED hace de prompt rechazado', (await generar({ prompt: 'REFUSED fox' })).texto.includes('refused the prompt'));
    fs.rmSync(dir2, { recursive: true, force: true });
    I.configurar({ carpeta: dir, deMentira: false, getKey: () => llave, pedir: (...a) => fetch(...a) });
  }

  // ---------- 12. cómo está enchufada ----------
  {
    const defs = require(path.join(APP, 'main', 'tools', 'defs.cjs'));
    const def = defs.TOOL_DEFS.find((t) => t.name === 'generate_image');
    const params = Object.keys(def?.parameters?.properties ?? {});
    ok('la tool está definida, y solo pide el prompt', Boolean(def) && def.parameters.required.join() === 'prompt', params.join());
    ok('no tiene safe_mode (es del usuario) ni width/height (hay modelos que los rechazan)', !params.includes('safe_mode') && !params.includes('width') && !params.includes('height'), params.join());
    ok('su descripción avisa que gasta plata', /spends money/.test(def?.description ?? ''));
    const grupo = defs.GRUPOS.find((g) => g.id === 'images');
    ok('va sola en un grupo OPCIONAL: no nace prendida', grupo?.opcional === true && grupo.tools.join() === 'generate_image' && defs.GRUPOS.filter((g) => g.opcional).length === 1, JSON.stringify(grupo));
    ok('cada argumento de la definición es uno que la tool lee', params.every((p) => ['prompt', 'input_images', 'aspect_ratio', 'variants', 'negative_prompt', 'model', 'resolution', 'style', 'seed', 'look'].includes(p)), params.join());
    const motor = fs.readFileSync(path.join(APP, 'main', 'tools', 'motor.cjs'), 'utf8');
    ok('un subagente no la tiene (gasta plata del usuario)', /if \(run\?\.subagent\) \{[^}]*n !== 'generate_image'/s.test(motor));
    const indice = fs.readFileSync(path.join(APP, 'main', 'tools', 'index.cjs'), 'utf8');
    ok('la tarjeta de permiso le pide a la tool cuánto sale', indice.includes("if (name === 'generate_image') return await imagenes.vista(args, run);"));
    ok('el catálogo le dice a la interfaz que el grupo es opcional', indice.includes("...(g.opcional ? { opcional: true } : {})"));
    const chat = fs.readFileSync(path.join(APP, 'main', 'chat.cjs'), 'utf8');
    ok('usa la llave de Venice que la app ya guarda cifrada', chat.includes("getKey: () => llave.leer(rad.store, 'venice')") && !/process\.env\.VENICE_API_KEY/.test(chat + fs.readFileSync(path.join(APP, 'main', 'tools', 'imagenes.cjs'), 'utf8')));
    ok('la interfaz solo recibe archivos de la carpeta de imágenes', /const esta = \(archivo\) => img\.esMia\(archivo\)/.test(chat) && chat.includes("rad.handle('imagenes:ver', (archivo) => img.leer(archivo));"));
    const datos = fs.readFileSync(path.join(APP, 'renderer', 'datos.js'), 'utf8');
    ok('un agente nuevo nace sin las tools de un grupo opcional', datos.includes('herramientas.grupos.filter((g) => !g.opcional).flatMap((g) => g.tools)'));
    // Entre turnos el modelo no vuelve a ver el resultado de una tool: recibe
    // un registro de qué corrió. Para una imagen, ese registro dice dónde quedó.
    const { foldToolRows } = require(path.join(APP, 'main', 'tools', 'guardas.cjs'));
    const plegado = foldToolRows([
      { role: 'user', content: 'make a fox' },
      { role: 'tool', tool: 'generate_image', content: 'A red fox', status: 'ok', facts: ['model flux-3', '16:9', 'seed 42', 'you did not look at it'], saved: ['C:\\datos\\images\\2026-11\\image-1.webp', 'C:\\datos\\images\\2026-11\\image-2.webp'] },
      { role: 'tool', tool: 'fs_read', content: 'notes.md', status: 'ok' },
      { role: 'assistant', content: 'Done.' },
    ]);
    const registro = plegado.find((m) => m.appRecord)?.content ?? '';
    ok('el registro entre turnos dice dónde quedaron las imágenes', registro.includes('1. generate_image(A red fox) -> ok · model flux-3 · 16:9 · seed 42 · you did not look at it · saved: C:\\datos\\images\\2026-11\\image-1.webp, C:\\datos\\images\\2026-11\\image-2.webp'), registro);
    ok('…y una llamada que no dejó archivos queda como siempre', registro.includes('2. fs_read(notes.md) -> ok\n') || registro.includes('2. fs_read(notes.md) -> ok<') || /2\. fs_read\(notes\.md\) -> ok\s*\n?<\/tools_ran>/.test(registro), registro);
    ok('…y avisa que NO trae lo que devolvió cada tool (si no, el modelo cree que inventó lo que dijo)', registro.includes('It lists each call and how it ended, not what it returned'), registro.slice(0, 300));
    ok('el registro lleva el prompt entero (no el recorte de la fila) y los datos de la imagen', chat.includes("content: corto(d?.prompt, 2000) || String(m.texto ?? '')") && chat.includes("d.visto === true ? 'you looked at it' : 'you did not look at it'") && datos.includes('...(m.detalle ? { detalle: m.detalle } : {})'));
    ok('la interfaz manda esas rutas con la fila', datos.includes("const dejo = (Array.isArray(m.imagenes) ? m.imagenes : []).map((im) => im.archivo).filter(Boolean);") && chat.includes('(Array.isArray(m.dejo) ? m.dejo : [])'));
    ok('la fila del chat guarda la ruta de la imagen, no la imagen', datos.includes('(archivo ? { name, archivo } : { name, dataUrl })'));
  }
  // ---------- Editar una imagen que ya existe (input_images) ----------
  {
    const aj = { modelo: '', modeloEdicion: '', filtro: true };
    let llaveE = LLAVE;
    let veE = false;
    I.configurar({ getKey: () => llaveE, ajustes: () => aj, carpeta: dir, modeloVe: () => veE, ahora: () => reloj, azar: () => 0.5, deMentira: false, pedir: (...a) => fetch(...a) });
    const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const pngDe = (ancho, alto) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(ancho), u32(alto), Buffer.alloc(9)]);
    const jpgDe = (ancho, alto) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 255, ancho >> 8, ancho & 255]), Buffer.alloc(12)]);
    const webpXDe = (ancho, alto) => { const b = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(14)]); b.writeUIntLE(ancho - 1, 24, 3); b.writeUIntLE(alto - 1, 27, 3); return b; };
    const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]);
    const zorro = I.pngDeMentira('fox', 0);
    const gato = I.pngDeMentira('cat', 0);
    const url = (buf, mime = 'image/png') => 'data:' + mime + ';base64,' + buf.toString('base64');
    const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-editar-'));
    fs.writeFileSync(path.join(taller, 'fox.png'), zorro);
    fs.writeFileSync(path.join(taller, 'tiny.png'), pngDe(10, 10));
    fs.writeFileSync(path.join(taller, 'huge.png'), pngDe(8000, 8000));
    fs.writeFileSync(path.join(taller, 'anim.gif'), GIF);
    fs.writeFileSync(path.join(taller, 'notes.txt'), 'hola');
    const corridaE = (extra = {}) => ({ ...corrida(), cwd: taller, adjuntas: [url(zorro), url(jpgDe(640, 480), 'image/jpeg'), url(gato)], ...extra });

    // los modelos que editan: otra lista
    const le = await I.modelosEdicion();
    ok('los modelos de edición salen de type=inpaint, sin los apagados y en orden', visto.modelosEdicion === 1 && le.map((m) => m.id).join() === 'firered-image-edit,luma-edit,seed-edit', le.map((m) => m.id).join());
    const fire = le.find((m) => m.id === 'firered-image-edit') ?? {};
    const luma = le.find((m) => m.id === 'luma-edit') ?? {};
    const seed = le.find((m) => m.id === 'seed-edit') ?? { porResolucion: {} };
    ok('su precio es el de editar, no el de generar', fire.precio === 0.04 && seed.precio === 0.02 && seed.porResolucion['2K'] === 0.05);
    ok('cuántas imágenes acepta: lo que diga, 3 si no dice, 1 si no combina', seed.entradas === 10 && fire.entradas === 3 && luma.entradas === 1, [seed.entradas, fire.entradas, luma.entradas].join());
    ok('si cobra las imágenes de entrada, cuántas incluye y cuánto sale cada una más', seed.incluidas === 1 && seed.porEntrada === 0.01 && fire.incluidas === null && fire.porEntrada === null);
    ok('el de fábrica es el de Venice', fire.predeterminado === true && !seed.predeterminado);
    await I.modelosEdicion();
    ok('la lista se guarda un rato', visto.modelosEdicion === 1);
    await I.modelosEdicion({ fresco: true });
    ok('…y fresco la vuelve a pedir', visto.modelosEdicion === 2);
    ok('sin elegir va el de fábrica', I.elegirEdicion(le, '').modelo?.id === 'firered-image-edit');
    aj.modeloEdicion = 'seed-edit';
    ok('el de Settings es «modeloEdicion», no el de generar', I.elegirEdicion(le, '').modelo?.id === 'seed-edit' && (aj.modelo = 'luma-edit', I.elegirEdicion(le, '').modelo?.id === 'seed-edit'));
    aj.modelo = '';
    ok('el que pide el agente gana', I.elegirEdicion(le, 'luma-edit').modelo?.id === 'luma-edit');
    ok('un modelo de generar no edita, y se dice cuáles sí', /there is no image edit model "alfa-image"\. The image edit models are: firered-image-edit, luma-edit, seed-edit/.test(I.elegirEdicion(le, 'alfa-image').error), I.elegirEdicion(le, 'alfa-image').error);
    aj.modeloEdicion = '';

    // las medidas, de la cabecera
    ok('las medidas de un PNG', JSON.stringify(I.medidas(zorro, 'png')) === '{"ancho":256,"alto":256}' && I.medidas(pngDe(1920, 1080), 'png').alto === 1080);
    ok('las de un JPEG', JSON.stringify(I.medidas(jpgDe(640, 480), 'jpg')) === '{"alto":480,"ancho":640}', JSON.stringify(I.medidas(jpgDe(640, 480), 'jpg')));
    ok('las de un WebP', I.medidas(webpXDe(1568, 784), 'webp').ancho === 1568 && I.medidas(webpXDe(1568, 784), 'webp').alto === 784 && I.medidas(WEBP, 'webp').ancho > 0);
    ok('una cabecera rota no rompe', I.medidas(Buffer.from([0xff, 0xd8, 0xff]), 'jpg') === null && I.medidas(Buffer.alloc(4), 'png') === null);

    // qué imágenes se pueden editar
    const e1 = I.entradasDe(corridaE(), ['attachment:1']);
    ok('un adjunto por su número', e1.entradas?.length === 1 && e1.entradas[0].rotulo === 'attachment:1' && e1.entradas[0].buf.equals(zorro) && e1.entradas[0].ancho === 256, JSON.stringify(e1.error ?? e1.entradas?.map((x) => x.rotulo)));
    ok('attachment:last es el último', I.entradasDe(corridaE(), ['attachment:last']).entradas[0].buf.equals(gato) && I.entradasDe(corridaE(), ['Attachment:LAST']).entradas[0].rotulo === 'attachment:3');
    ok('un JPEG adjunto vale', I.entradasDe(corridaE(), ['attachment:2']).entradas[0].ext === 'jpg');
    ok('un número que no hay dice cuántos hay', /there is no attachment:7\. The user attached 3 images in this chat: attachment:1 to attachment:3/.test(I.entradasDe(corridaE(), ['attachment:7']).error) && /there is no attachment:0/.test(I.entradasDe(corridaE(), ['attachment:0']).error), I.entradasDe(corridaE(), ['attachment:7']).error);
    ok('sin adjuntos se dice', /has not attached any image/.test(I.entradasDe(corridaE({ adjuntas: [] }), ['attachment:1']).error) && /has not attached any image/.test(I.entradasDe({ cwd: taller }, ['attachment:last']).error));
    const e2 = I.entradasDe(corridaE(), ['fox.png']);
    ok('un archivo, contra la carpeta del chat', e2.entradas?.[0].rotulo === path.join(taller, 'fox.png') && e2.entradas[0].bytes === zorro.length, e2.error);
    ok('…o por su ruta entera', I.entradasDe(corridaE({ cwd: os.tmpdir() }), [path.join(taller, 'fox.png')]).entradas?.length === 1);
    ok('un archivo que no está', /there is no file .*nope\.png/.test(I.entradasDe(corridaE(), ['nope.png']).error));
    ok('una carpeta no es una imagen', /is not a file/.test(I.entradasDe(corridaE(), ['.']).error));
    ok('un GIF no se edita', /anim\.gif is not a PNG, JPEG or WebP image/.test(I.entradasDe(corridaE(), ['anim.gif']).error) && /is not a PNG, JPEG or WebP/.test(I.entradasDe(corridaE(), ['notes.txt']).error) && /attachment:1 is not a PNG/.test(I.entradasDe(corridaE({ adjuntas: [url(GIF, 'image/gif')] }), ['attachment:1']).error));
    ok('una imagen chica no se manda', /tiny\.png is 10×10: too small to edit/.test(I.entradasDe(corridaE(), ['tiny.png']).error), I.entradasDe(corridaE(), ['tiny.png']).error);
    ok('ni una enorme', /huge\.png is 8000×8000: too large to edit/.test(I.entradasDe(corridaE(), ['huge.png']).error));
    ok('varias, en el orden pedido', I.entradasDe(corridaE(), ['attachment:3', 'fox.png']).entradas.map((x) => path.basename(x.rotulo)).join() === 'attachment:3,fox.png');
    ok('una mala entre varias corta todo', Boolean(I.entradasDe(corridaE(), ['fox.png', 'nope.png']).error));

    // lo que se le pide al modelo
    ok('la instrucción es obligatoria', /say what to change/.test(I.armarEdicion(fire, {}, 1).error));
    ok('…y tiene el tope del modelo', /takes up to 1500/.test(I.armarEdicion(fire, { prompt: 'x'.repeat(1501) }, 1).error));
    ok('más imágenes de las que acepta el modelo', /luma-edit takes up to 1 input image and you passed 2/.test(I.armarEdicion(luma, { prompt: 'x' }, 2).error) && !I.armarEdicion(seed, { prompt: 'x' }, 10).error && /takes up to 10 input images and you passed 11/.test(I.armarEdicion(seed, { prompt: 'x' }, 11).error));
    ok('una edición devuelve una imagen', /an edit returns one image/.test(I.armarEdicion(fire, { prompt: 'x', variants: 3 }, 1).error) && !I.armarEdicion(fire, { prompt: 'x', variants: 1 }, 1).error);
    ok('auto es la proporción de la entrada: no se manda', I.armarEdicion(fire, { prompt: 'x', aspect_ratio: 'auto' }, 1).aspecto === '' && I.armarEdicion(fire, { prompt: 'x' }, 1).aspecto === '' && I.armarEdicion(fire, { prompt: 'x', aspect_ratio: '16:9' }, 1).aspecto === '16:9');
    ok('una proporción que el modelo no hace', /does not do 7:3/.test(I.armarEdicion(fire, { prompt: 'x', aspect_ratio: '7:3' }, 1).error) && /must look like/.test(I.armarEdicion(fire, { prompt: 'x', aspect_ratio: 'wide' }, 1).error));
    ok('la resolución, contra las del modelo', I.armarEdicion(seed, { prompt: 'x', resolution: '2K' }, 1).resolucion === '2K' && /does not do 8K/.test(I.armarEdicion(seed, { prompt: 'x', resolution: '8K' }, 1).error) && /single resolution/.test(I.armarEdicion(fire, { prompt: 'x', resolution: '2K' }, 1).error));
    ok('el precio: el del modelo, o el de la resolución, más las entradas de más', I.precioEdicion(fire, '', 3) === 0.04 && I.precioEdicion(seed, '', 1) === 0.02 && I.precioEdicion(seed, '2K', 1) === 0.05 && Math.abs(I.precioEdicion(seed, '2K', 3) - 0.07) < 1e-9 && I.precioEdicion(luma, '', 1) === null, [I.precioEdicion(seed, '2K', 3), I.precioEdicion(luma, '', 1)].join());

    // una imagen: /image/edit
    {
      const run = corridaE();
      const antes = fs.readdirSync(path.join(dir, 'images', '2026-11')).length;
      const out = await I.runGenerateImage(run, { prompt: 'Make it night', input_images: ['attachment:1'], seed: 5, negative_prompt: 'x', style: 'Anime' });
      const p = visto.editar.at(-1);
      ok('con una imagen va a /image/edit', p?.ruta === '/image/edit' && p.pedido.model === 'firered-image-edit' && p.pedido.prompt === 'Make it night' && p.pedido.safe_mode === true, JSON.stringify(p?.pedido ?? null).slice(0, 200));
      ok('la imagen viaja entera, en base64', p.pedido.image === zorro.toString('base64'));
      ok('sin lo que editar no acepta (semilla, variantes, negativo, estilo) ni lo que no se pidió', Object.keys(p.pedido).sort().join() === 'image,model,prompt,safe_mode', Object.keys(p.pedido).join());
      const nuevos = fs.readdirSync(path.join(dir, 'images', '2026-11'));
      ok('lo que devuelve Venice (binario) queda en un archivo', nuevos.length === antes + 1 && out.includes(path.join(dir, 'images', '2026-11')) && fs.readFileSync(out.split('\n').find((l) => l.startsWith('- ')).slice(2)).equals(EDITADA), out);
      ok('el resultado dice de qué imagen salió y que la original no cambió', out.startsWith('Edited with FireRed (firered-image-edit), from attachment:1. The user sees the result in the chat, under this call. The input image was not changed.') && out.includes('Cost: about $0.04') && out.includes('To edit it again, pass that path as input_images.') && out.includes('You did not get the image itself'), out);
      const art = run.avisos.find(([c]) => c === 'tool:artifact')?.[1];
      ok('la fila lleva la imagen nueva y de dónde salió', art?.images.length === 1 && art.detalle.prompt === 'Make it night' && art.detalle.modelo === 'firered-image-edit' && art.detalle.entradas?.join() === 'attachment:1' && art.detalle.semilla === null && art.detalle.visto === false, JSON.stringify(art?.detalle ?? null));
      ok('cuenta para el tope del turno', run._imagenes === 1);
    }
    // de un archivo: el original no cambia
    {
      const run = corridaE();
      const out = await I.runGenerateImage(run, { prompt: 'Remove the background', input_images: 'fox.png' });
      ok('un archivo como entrada (y una sola ruta suelta vale)', visto.editar.at(-1).pedido.image === zorro.toString('base64') && out.includes('from ' + path.join(taller, 'fox.png')), out.slice(0, 160));
      ok('el archivo original queda igual', fs.readFileSync(path.join(taller, 'fox.png')).equals(zorro));
    }
    // varias: /image/multi-edit
    {
      aj.modeloEdicion = 'seed-edit';
      aj.filtro = false;
      const run = corridaE();
      const out = await I.runGenerateImage(run, { prompt: 'Put the cat next to the fox', input_images: ['fox.png', 'attachment:3'], resolution: '2K', aspect_ratio: '16:9' });
      const p = visto.editar.at(-1);
      ok('con varias va a /image/multi-edit, con el modelo en «modelId»', p.ruta === '/image/multi-edit' && p.pedido.modelId === 'seed-edit' && p.pedido.model === undefined, JSON.stringify(Object.keys(p.pedido)));
      ok('la primera es la base y las demás van detrás', p.pedido.images?.length === 2 && p.pedido.images[0] === zorro.toString('base64') && p.pedido.images[1] === gato.toString('base64') && p.pedido.image === undefined);
      ok('con la resolución, la proporción y el filtro de Settings', p.pedido.resolution === '2K' && p.pedido.aspect_ratio === '16:9' && p.pedido.safe_mode === false);
      ok('el resultado nombra las dos y lo que sale', out.includes('Edited with Seed (seed-edit), 16:9, 2K, from 2 images: ' + path.join(taller, 'fox.png') + ', attachment:3.') && out.includes('The input images were not changed.') && out.includes('Cost: about $0.06'), out);
      aj.modeloEdicion = '';
      aj.filtro = true;
    }
    // mirarla
    {
      veE = true;
      const run = corridaE();
      const out = await I.runGenerateImage(run, { prompt: 'Brighter', input_images: ['attachment:1'], look: true });
      ok('con look y un modelo que ve, la editada va adjunta', run._capturas?.length === 1 && run._capturas[0] === 'data:image/png;base64,' + EDITADA.toString('base64') && out.includes('attached below for you to look at') && run.avisos.find(([c]) => c === 'tool:artifact')[1].detalle.visto === true);
      veE = false;
      const run2 = corridaE();
      const out2 = await I.runGenerateImage(run2, { prompt: 'Brighter', input_images: ['attachment:1'], look: true });
      ok('…y si no ve, se le dice', !run2._capturas && out2.includes('this model cannot see images'));
    }
    // lo que sale mal
    {
      const cuenta = () => visto.editar.length;
      let n = cuenta();
      ok('una entrada mala no llega a Venice', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['tiny.png'] })).startsWith('error: ') && (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['attachment:9'] })).startsWith('error: there is no attachment:9') && cuenta() === n);
      ok('ni una instrucción vacía, ni variantes', (await I.runGenerateImage(corridaE(), { input_images: ['fox.png'] })).includes('say what to change') && (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'], variants: 2 })).includes('an edit returns one image') && cuenta() === n);
      proximoE = { status: 422, cuerpo: { error: 'policy' } };
      ok('Venice rechaza la edición', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'] })) === 'error: Venice refused the edit: the instruction or the image goes against the content rules of that model, or the image is too large');
      proximoE = { status: 413, cuerpo: { error: 'big' } };
      ok('un archivo que a Venice le resulta grande', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'] })).includes('too large for Venice'));
      proximoE = { status: 402, cuerpo: { error: 'no' } };
      const run = corridaE();
      ok('sin saldo, y sin contar para el tope', (await I.runGenerateImage(run, { prompt: 'x', input_images: ['fox.png'] })).includes('no balance left') && !run._imagenes);
      proximoE = { binario: Buffer.from('<html>oops</html>') };
      ok('si lo que vuelve no es una imagen, no se guarda', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'] })).includes('could not be saved') );
      n = cuenta();
      ok('pasado el tope del turno no edita más', (await I.runGenerateImage(corridaE({ _imagenes: I.POR_TURNO }), { prompt: 'x', input_images: ['fox.png'] })).includes('the limit is ' + I.POR_TURNO + ' per turn') && cuenta() === n);
      llaveE = null;
      ok('sin llave no edita', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'] })).includes('there is no Venice API key') && cuenta() === n);
      llaveE = LLAVE;
      proximoE = { cuelga: true };
      const frenada = corridaE();
      const t0 = Date.now();
      setTimeout(() => frenada.ac.abort(), 120);
      ok('frenar el turno corta el pedido', (await I.runGenerateImage(frenada, { prompt: 'x', input_images: ['fox.png'] })) === 'error: stopped' && Date.now() - t0 < 600, String(Date.now() - t0));
      proximoE = { headers: { 'x-venice-is-blurred': 'true' } };
      ok('una editada que Venice desenfocó, se dice', (await I.runGenerateImage(corridaE(), { prompt: 'x', input_images: ['fox.png'] })).includes('Venice blurred the result'));
    }
    // la tarjeta de permiso
    {
      const v = await I.vista({ prompt: 'Make it night', input_images: ['attachment:1', 'fox.png'], model: 'seed-edit' }, corridaE());
      ok('la tarjeta dice que edita, con qué, qué imágenes se suben y cuánto sale', v.mode === 'imagen' && v.edita === true && v.modelo === 'Seed' && v.total === 0.03 && v.entradas.length === 2 && v.entradas[0].rotulo === 'attachment:1' && v.entradas[0].ancho === 256 && v.entradas[1].bytes === zorro.length && !('buf' in v.entradas[0]), JSON.stringify(v));
      const mal = await I.vista({ prompt: 'x', input_images: ['nope.png'] }, corridaE());
      ok('…o por qué va a fallar', mal.mode === 'fail' && /^There is no file .*nope\.png/.test(mal.error) && (await I.vista({ prompt: 'x', input_images: ['fox.png', 'attachment:1'], model: 'luma-edit' }, corridaE())).mode === 'fail', JSON.stringify(mal));
      const gen = await I.vista({ prompt: 'A fox' }, corridaE());
      ok('sin imágenes de entrada sigue siendo la de generar', gen.mode === 'imagen' && !gen.edita);
    }
    // el modo de mentira (el humo)
    {
      let pedidos = 0;
      I.configurar({ carpeta: dir, deMentira: true, getKey: () => null, pedir: () => { pedidos++; throw new Error('el modo de mentira no sale a la red'); } });
      const a = await I.runGenerateImage(corridaE(), { prompt: 'Make it night', input_images: ['attachment:1'] });
      const b = await I.runGenerateImage(corridaE(), { prompt: 'Make it night', input_images: ['attachment:3'] });
      const archivo = (t) => t.split('\n').find((l) => l.startsWith('- ')).slice(2);
      ok('en el humo edita sin red ni llave', pedidos === 0 && a.startsWith('Edited with Simulated edit (sim-edit), from attachment:1.') && I.formatoDe(fs.readFileSync(archivo(a))) === 'png', a.slice(0, 120));
      ok('…y otra imagen de entrada da otra imagen', !fs.readFileSync(archivo(a)).equals(fs.readFileSync(archivo(b))));
      ok('…una de mentira se puede volver a editar (mide lo mínimo)', (await I.runGenerateImage(corridaE(), { prompt: 'Again', input_images: [archivo(a)] })).startsWith('Edited with'));
      ok('…y REFUSED hace de edición rechazada', (await I.runGenerateImage(corridaE(), { prompt: 'REFUSED', input_images: ['attachment:1'] })).startsWith('error: Venice refused the edit'));
      ok('…con sus modelos de mentira', (await I.modelosEdicion()).map((m) => m.id).join() === 'sim-edit,sim-edit-pro');
      I.configurar({ carpeta: dir, deMentira: false, getKey: () => llave, pedir: (...x) => fetch(...x) });
    }
    // el cableado
    {
      const chat = fs.readFileSync(path.join(APP, 'main', 'chat.cjs'), 'utf8');
      ok('la tool recibe las imágenes adjuntas del chat con el pedido (no se copian al disco)', chat.includes("const adjuntas = pedido.mensajes.flatMap((m) => (m.rol === 'user' && Array.isArray(m.imagenes) ? m.imagenes : []));") && chat.includes('sesion.run.adjuntas = adjuntas;'));
      ok('cada adjunto lleva su número a la vista del modelo', /const marcas = m\.imagenes\.map\(\(\) => .attachment:\$\{\+\+n\}.\);/.test(chat) && chat.includes("pedido.tools.includes('generate_image')"));
      ok('la interfaz recibe también los modelos que editan', chat.includes('img.modelosEdicion({ fresco: fresco === true })'));
      const defs = fs.readFileSync(path.join(APP, 'main', 'tools', 'defs.cjs'), 'utf8');
      ok('la definición trae input_images', /input_images: \{ type: 'array', items: \{ type: 'string' \}/.test(defs) && !defs.includes('an image cannot be edited in place'));
      ok('enhance_prompt no es un parámetro de la tool', !/enhance_prompt/.test(defs) && !/enhance_prompt: /.test(fs.readFileSync(path.join(APP, 'main', 'tools', 'imagenes.cjs'), 'utf8')));
      const { foldToolRows } = require(path.join(APP, 'main', 'tools', 'guardas.cjs'));
      const registro = foldToolRows([
        { role: 'user', content: 'make it night' },
        { role: 'tool', tool: 'generate_image', content: 'Make it night', status: 'ok', facts: ['model firered-image-edit', 'edited from attachment:1', 'you did not look at it'], saved: ['C:\\datos\\images\\2026-11\\image-9.png'] },
        { role: 'assistant', content: 'Done.' },
      ]).find((m) => m.appRecord)?.content ?? '';
      ok('el registro del turno siguiente dice de qué imagen salió', registro.includes('1. generate_image(Make it night) -> ok · model firered-image-edit · edited from attachment:1 · you did not look at it · saved: C:\\datos\\images\\2026-11\\image-9.png'), registro);
      ok('…porque chat.cjs lo arma con las entradas', /edited from \$\{d\.entradas\.filter\(/.test(chat));
    }
    fs.rmSync(taller, { recursive: true, force: true });
  }
} finally {
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`test-blackcode-imagenes: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-imagenes: ok (${hechas} comprobaciones: los modelos de Venice y su precio, elegir el modelo, revisar los argumentos, generar y guardar en archivos, mirar lo generado, el filtro, lo que sale mal, el tope del turno, leer para mostrar, la tarjeta de permiso, el modo de mentira, y editar una imagen que ya existe: los modelos, qué se puede editar, /image/edit y /image/multi-edit, lo que sale mal y el registro)`);
process.exit(0);
