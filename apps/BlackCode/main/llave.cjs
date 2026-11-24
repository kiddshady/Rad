'use strict';

// Las llaves de las APIs: una por proveedor (Anthropic y Venice).
//
// Se guardan cifradas con safeStorage y nunca en claro: lo que va al store es
// el blob en base64, en un documento con _ (el renderer no puede leerlo ni
// pisarlo). La llave en claro no sale nunca de este proceso: al renderer le
// llega solo el estado y una pista para reconocerla.
//
// En Windows safeStorage no es DPAPI directo: cifra con una clave maestra
// que vive en <userData>/Local State. Si esa carpeta se borra o se mueve, el
// blob queda pero ya no se puede leer. Por eso el estado no se deduce de que
// exista el registro: se intenta descifrar, y si falla se dice «ilegible»
// (hay que volver a pegarla) en vez de «falta» o de «lista».
//
// Y que una llave esté guardada no dice que sirva. Eso no se adivina por
// cómo empieza (la 0.1.0 avisaba «es una llave de usuario: la API la
// rechaza» por el prefijo, y era falso para las llaves personales atadas a
// un workspace): se le pregunta a la API, con un pedido que no gasta nada.

const crypto = require('node:crypto');
const { safeStorage } = require('electron');
const anthropic = require('./anthropic.cjs');
const simulado = require('./simulado.cjs');

const SIMULADO = process.env.BLACKCODE_PROVEEDOR === 'simulado';

// Lo único que se le pide a lo que se pega: un texto largo, sin espacios.
// Si es o no una llave que sirve lo dice la API.
const FORMA = /^\S{20,}$/;

const PROVEEDORES = {
  anthropic: {
    doc: '_llave',
    pista: (key) => `${key.slice(0, 10)}…${key.slice(-4)}`,
    comprobar: anthropic.comprobar,
  },
  venice: {
    doc: '_llave_venice',
    pista: (key) => `…${key.slice(-4)}`,
    comprobar: null, // su lista de modelos no pide llave: no hay pedido gratis que la pruebe
  },
};

const de = (proveedor) => {
  const p = PROVEEDORES[proveedor];
  if (!p) throw new Error(`[blackcode] proveedor desconocido: ${JSON.stringify(proveedor)}`);
  return p;
};

/** La llave en claro de un proveedor, o null. Solo para este proceso. */
function leer(store, proveedor) {
  const doc = store.read(de(proveedor).doc);
  if (!doc?.blob || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(doc.blob, 'base64')) || null;
  } catch {
    return null;
  }
}

function estadoDe(store, proveedor) {
  const p = de(proveedor);
  const base = { seComprueba: Boolean(p.comprobar) };
  if (!store.read(p.doc)?.blob) return { ...base, estado: 'falta' };
  const key = leer(store, proveedor);
  if (!key) return { ...base, estado: 'ilegible' };
  return { ...base, estado: 'lista', pista: p.pista(key) };
}

/** { simulado, anthropic: { estado, pista?, seComprueba }, venice: { … } } */
function estado(store) {
  const todo = { simulado: SIMULADO };
  for (const id of Object.keys(PROVEEDORES)) todo[id] = estadoDe(store, id);
  return todo;
}

// Lo que dijo la API de cada llave, en memoria y por la huella de la llave
// (nunca la llave): abrir Ajustes no vuelve a preguntar lo que ya se sabe.
// Solo se recuerda lo definitivo; un «no se pudo comprobar» se reintenta.
const sabidas = new Map();
const enCurso = new Map();
const huella = (key) => crypto.createHash('sha256').update(key).digest('hex');

/** ¿La API acepta la llave guardada de ese proveedor? Ver anthropic.comprobar. */
async function comprobar(store, proveedor, { forzar = false } = {}) {
  const p = de(proveedor);
  if (!p.comprobar) return { fase: 'sin-comprobacion' };
  const key = leer(store, proveedor);
  if (!key) return { fase: 'falta' };
  const h = huella(key);
  if (!forzar && sabidas.has(h)) return sabidas.get(h);
  if (enCurso.has(h)) return enCurso.get(h);
  const trabajo = (SIMULADO ? simulado.comprobarLlave(key) : p.comprobar(key))
    .catch(() => ({ fase: 'sin-comprobar', motivo: 'servicio' }))
    .then((r) => {
      if (r.fase === 'aceptada' || r.fase === 'rechazada') sabidas.set(h, r);
      else sabidas.delete(h);
      return r;
    })
    .finally(() => enCurso.delete(h));
  enCurso.set(h, trabajo);
  return trabajo;
}

function wire(rad, { alCambiar } = {}) {
  rad.handle('llave:estado', () => estado(rad.store));

  rad.handle('llave:guardar', async (proveedor, valor) => {
    const p = de(proveedor);
    const key = typeof valor === 'string' ? valor.trim() : '';
    if (!FORMA.test(key)) return { ok: false, error: 'That does not look like a key: a key is a long text with no spaces.' };
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Windows cannot encrypt in this session, and the key is not stored unencrypted.' };
    }
    await rad.store.write(p.doc, { v: 1, blob: safeStorage.encryptString(key).toString('base64') });
    alCambiar?.(proveedor);
    return { ok: true, estado: estado(rad.store) };
  });

  rad.handle('llave:borrar', async (proveedor) => {
    await rad.store.remove(de(proveedor).doc);
    alCambiar?.(proveedor);
    return { ok: true, estado: estado(rad.store) };
  });

  // El renderer manda siempre los dos argumentos: con uno solo, el segundo
  // sería el contexto que agrega el núcleo ({ window }).
  rad.handle('llave:comprobar', (proveedor, opciones) => comprobar(rad.store, proveedor, { forzar: opciones?.forzar === true }));
}

module.exports = { wire, leer, SIMULADO, PROVEEDORES: Object.keys(PROVEEDORES) };
