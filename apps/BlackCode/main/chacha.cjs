'use strict';
// ChaCha20-Poly1305 para Electron.
//
// La conexión con el Atom Echo va cifrada con Noise, que usa ChaCha20-Poly1305,
// y la librería (esphome-client) lo pide con crypto.createCipheriv. En Node
// existe; en Electron no: su crypto es BoringSSL, que no lo ofrece por esa
// puerta («Unknown cipher»). Lo demás que usa Noise (X25519, HKDF, SHA-256) sí
// está. Sin esto la app conecta en las pruebas con node y falla instalada, que
// es lo que pasó en la 1.1.0.
//
// instalar() le enseña ese único algoritmo a createCipheriv/createDecipheriv,
// con @noble/ciphers, y solo si el proceso no lo trae: cualquier otro pedido
// sigue yendo al de siempre. Hay que llamarla antes de conectar.

const crypto = require('node:crypto');

const ALGO = 'chacha20-poly1305';
const TAG = 16;
let listo = null;

/** ¿Este proceso ya sabe hacer ChaCha20-Poly1305 por createCipheriv? */
function nativo() {
  try {
    crypto.createCipheriv(ALGO, Buffer.alloc(32), Buffer.alloc(12), { authTagLength: TAG });
    return true;
  } catch { return false; }
}

// Lo mínimo de la interfaz de Cipher/Decipher: se junta lo que llega y se
// cifra (o se descifra y se comprueba la marca) en final(), de una vez.
function cifrador(aead, clave, nonce) {
  const partes = [];
  let aad = Buffer.alloc(0);
  let marca = null;
  return {
    setAAD(datos) { aad = Buffer.from(datos ?? []); return this; },
    update(datos) { partes.push(Buffer.from(datos)); return Buffer.alloc(0); },
    final() {
      const salida = Buffer.from(aead(clave, nonce, aad).encrypt(Buffer.concat(partes)));
      marca = salida.subarray(salida.length - TAG);
      return salida.subarray(0, salida.length - TAG);
    },
    getAuthTag() { if (!marca) throw new Error('final() has not been called'); return Buffer.from(marca); },
  };
}
function descifrador(aead, clave, nonce) {
  const partes = [];
  let aad = Buffer.alloc(0);
  let marca = null;
  return {
    setAAD(datos) { aad = Buffer.from(datos ?? []); return this; },
    setAuthTag(m) { marca = Buffer.from(m); return this; },
    update(datos) { partes.push(Buffer.from(datos)); return Buffer.alloc(0); },
    final() {
      if (!marca || marca.length !== TAG) throw new Error('Unsupported state or unable to authenticate data');
      // (si la marca no coincide, esto tira: los datos no son de quien dicen)
      try { return Buffer.from(aead(clave, nonce, aad).decrypt(Buffer.concat([...partes, marca]))); } catch { throw new Error('Unsupported state or unable to authenticate data'); }
    },
  };
}

/** Deja ChaCha20-Poly1305 disponible en crypto.createCipheriv/createDecipheriv.
 *  Devuelve cómo quedó: 'nativo' (ya estaba) o 'propio' (lo puso esto). */
function instalar() {
  listo ??= (async () => {
    if (nativo()) return 'nativo';
    const { chacha20poly1305 } = await import('@noble/ciphers/chacha.js');
    const cifrar = crypto.createCipheriv;
    const descifrar = crypto.createDecipheriv;
    const esEl = (algo) => String(algo).toLowerCase() === ALGO;
    const revisar = (clave, nonce) => {
      if (Buffer.byteLength(clave) !== 32) throw new RangeError('Invalid key length');
      if (Buffer.byteLength(nonce) !== 12) throw new RangeError('Invalid initialization vector');
    };
    crypto.createCipheriv = function createCipheriv(algo, clave, nonce, ...resto) {
      if (!esEl(algo)) return cifrar.call(this, algo, clave, nonce, ...resto);
      revisar(clave, nonce);
      return cifrador(chacha20poly1305, Buffer.from(clave), Buffer.from(nonce));
    };
    crypto.createDecipheriv = function createDecipheriv(algo, clave, nonce, ...resto) {
      if (!esEl(algo)) return descifrar.call(this, algo, clave, nonce, ...resto);
      revisar(clave, nonce);
      return descifrador(chacha20poly1305, Buffer.from(clave), Buffer.from(nonce));
    };
    // lo que importó `node:crypto` como módulo ES (la librería del Echo) ve el cambio
    require('node:module').syncBuiltinESMExports();
    return 'propio';
  })();
  return listo;
}

/** Una vuelta entera con el vector de prueba de la RFC 8439 (§2.8.2), por la
 *  misma puerta que usa la librería. true si este proceso cifra y descifra bien. */
function probar() {
  const hex = (h) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
  const clave = hex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = hex('070000004041424344454647');
  const aad = hex('50515253c0c1c2c3c4c5c6c7');
  const claro = Buffer.from("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.", 'ascii');
  const c = crypto.createCipheriv(ALGO, clave, nonce, { authTagLength: TAG });
  c.setAAD(aad, { plaintextLength: claro.length });
  const cifrado = Buffer.concat([c.update(claro), c.final()]);
  const marca = c.getAuthTag();
  if (marca.toString('hex') !== '1ae10b594f09e26a7e902ecbd0600691' || !cifrado.toString('hex').startsWith('d31a8d34648e60db7b86afbc53ef7ec2')) return false;
  const d = crypto.createDecipheriv(ALGO, clave, nonce, { authTagLength: TAG });
  d.setAAD(aad, { plaintextLength: cifrado.length });
  d.setAuthTag(marca);
  if (!Buffer.concat([d.update(cifrado), d.final()]).equals(claro)) return false;
  // …y un dato tocado no pasa
  const malo = crypto.createDecipheriv(ALGO, clave, nonce, { authTagLength: TAG });
  malo.setAAD(aad);
  malo.setAuthTag(marca);
  const tocado = Buffer.from(cifrado);
  tocado[3] ^= 1;
  try { Buffer.concat([malo.update(tocado), malo.final()]); return false; } catch { return true; }
}

module.exports = { instalar, probar, nativo, cifrador, descifrador };
