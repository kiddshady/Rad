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

const { safeStorage } = require('electron');

const SIMULADO = process.env.DAIMON_PROVEEDOR === 'simulado';

const PROVEEDORES = {
  anthropic: {
    doc: '_llave',
    forma: /^sk-ant-[\w-]{16,}$/,
    error: 'Eso no parece una llave de Anthropic: empiezan con sk-ant- y no llevan espacios.',
    pista: (key) => `${key.slice(0, 10)}…${key.slice(-4)}`,
    // 'api' es la que sirve (sk-ant-api03, creada dentro de un workspace). Una
    // de usuario (sk-ant-usr) da 400 «not scoped to a workspace» en cada
    // pedido, y una de administración no sirve para mensajes: se avisa.
    tipo: (key) => (key.startsWith('sk-ant-usr') ? 'usuario' : key.startsWith('sk-ant-admin') ? 'admin' : 'api'),
  },
  venice: {
    doc: '_llave_venice',
    forma: /^\S{20,}$/,
    error: 'Eso no parece una llave de Venice: es un texto largo, sin espacios.',
    pista: (key) => `…${key.slice(-4)}`,
    tipo: () => 'api',
  },
};

const de = (proveedor) => {
  const p = PROVEEDORES[proveedor];
  if (!p) throw new Error(`[daimon] proveedor desconocido: ${JSON.stringify(proveedor)}`);
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
  if (!store.read(p.doc)?.blob) return { estado: 'falta' };
  const key = leer(store, proveedor);
  if (!key) return { estado: 'ilegible' };
  return { estado: 'lista', pista: p.pista(key), tipo: p.tipo(key) };
}

/** { simulado, anthropic: { estado, pista?, tipo? }, venice: { … } } */
function estado(store) {
  const todo = { simulado: SIMULADO };
  for (const id of Object.keys(PROVEEDORES)) todo[id] = estadoDe(store, id);
  return todo;
}

function wire(rad, { alCambiar } = {}) {
  rad.handle('llave:estado', () => estado(rad.store));

  rad.handle('llave:guardar', async (proveedor, valor) => {
    const p = de(proveedor);
    const key = typeof valor === 'string' ? valor.trim() : '';
    if (!p.forma.test(key)) return { ok: false, error: p.error };
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'Windows no deja cifrar en esta sesión, y la llave no se guarda sin cifrar.' };
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
}

module.exports = { wire, leer, SIMULADO, PROVEEDORES: Object.keys(PROVEEDORES) };
