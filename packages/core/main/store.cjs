'use strict';

// El guardado: documentos JSON en una carpeta, uno por archivo.
//
// No importa nada de Electron (los tests lo cargan con node pelado). La
// carpeta se la pasa index.cjs: <userData>/data, nunca al lado del código,
// que empaquetado cae adentro del asar (solo lectura) y cada guardado
// fallaría en silencio.
//
// Lo que garantiza, y por qué (todo salió de bugs reales):
//   - Se escribe a un temporal y se renombra encima: un corte a mitad de la
//     escritura deja el archivo anterior entero, nunca uno a medias.
//   - El temporal tiene nombre ÚNICO (pid + contador). Con un .tmp de nombre
//     fijo, dos guardados que se solapan escriben el mismo temporal, el
//     primero en renombrar se lo lleva y el segundo se pierde en silencio.
//   - Una cola por documento: los guardados salen en orden y el último gana
//     siempre, de forma determinista.
//   - En Windows el rename falla con EPERM/EBUSY/EACCES si alguien tiene el
//     archivo tomado un instante (un antivirus, un lector): se reintenta con
//     espera creciente.
//   - Antes de pisar, el archivo bueno se copia a .bak. Si al leer el
//     principal está roto, se usa el .bak, y el roto se guarda aparte
//     (.corrupt-<fecha>) en vez de pisarlo: nunca se tira un dato.
//   - Los cambios se juntan (debounce) y se escriben de a uno. Al cerrar, el
//     núcleo frena la salida hasta que flushAll() bajó lo pendiente. No hay
//     versión sincrónica a propósito: podría renombrar mientras una escritura
//     de la cola todavía está en vuelo, y la vieja terminaría ganando.

const fs = require('node:fs');
const path = require('node:path');

const NAME = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS = [30, 60, 120, 240];
const DEBOUNCE_MS = 150;

let tmpCounter = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Store {
  constructor(dir, { debounceMs = DEBOUNCE_MS, log = () => {} } = {}) {
    this.dir = dir;
    this.debounceMs = debounceMs;
    this.log = log;
    this.cache = new Map();   // name -> value (lo último que se pidió guardar)
    this.pending = new Map(); // name -> timer del debounce
    this.queues = new Map();  // name -> promesa de la última escritura
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`[rad] nombre de documento inválido: ${JSON.stringify(name)}`);
    return path.join(this.dir, `${name}.json`);
  }

  /** El valor de un documento, o undefined si no existe. Lee el disco una vez. */
  read(name) {
    const file = this.file(name);
    if (this.cache.has(name)) return this.cache.get(name);
    const value = this.load(file);
    this.cache.set(name, value);
    return value;
  }

  load(file) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const aside = `${file}.corrupt-${stamp}`;
      try { fs.renameSync(file, aside); } catch { /* si no se puede apartar, queda donde está */ }
      this.log(`documento roto, apartado en ${path.basename(aside)}`);
      try {
        const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
        this.log(`se recuperó desde ${path.basename(file)}.bak`);
        return backup;
      } catch {
        return undefined;
      }
    }
  }

  /** Guarda un documento. Devuelve una promesa que se cumple cuando está en disco. */
  write(name, value) {
    const file = this.file(name);
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) throw new Error(`[rad] el documento "${name}" no se puede guardar como JSON`);
    this.cache.set(name, JSON.parse(json));
    clearTimeout(this.pending.get(name)?.timer);
    return new Promise((resolve, reject) => {
      const prev = this.pending.get(name);
      const waiters = prev ? prev.waiters : [];
      waiters.push({ resolve, reject });
      const timer = setTimeout(() => this.flush(name), this.debounceMs);
      this.pending.set(name, { timer, file, waiters });
    });
  }

  /** Baja ya lo pendiente de un documento, en la cola de ese documento. */
  flush(name) {
    const job = this.pending.get(name);
    if (!job) return this.queues.get(name) ?? Promise.resolve();
    clearTimeout(job.timer);
    this.pending.delete(name);
    const json = JSON.stringify(this.cache.get(name), null, 2);
    const run = (this.queues.get(name) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.writeAtomic(job.file, json));
    this.queues.set(name, run);
    run.then(
      () => job.waiters.forEach((w) => w.resolve()),
      (err) => { this.log(`no se pudo guardar ${name}: ${err.message}`); job.waiters.forEach((w) => w.reject(err)); },
    );
    return run;
  }

  async flushAll() {
    await Promise.all([...this.pending.keys()].map((n) => this.flush(n)));
    await Promise.all([...this.queues.values()].map((q) => q.catch(() => {})));
  }

  async writeAtomic(file, json) {
    const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
    const handle = await fs.promises.open(tmp, 'w');
    try {
      await handle.writeFile(json, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try { await fs.promises.copyFile(file, `${file}.bak`); } catch (err) { if (err.code !== 'ENOENT') this.log(`sin .bak: ${err.message}`); }
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(tmp, file);
        return;
      } catch (err) {
        if (!RETRY_CODES.has(err.code) || attempt >= RETRY_DELAYS.length) {
          await fs.promises.unlink(tmp).catch(() => {});
          throw err;
        }
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }
}

// Adoptar los datos de otra carpeta: una app que cambió de nombre estrena
// carpeta, y sin esto arrancaría de cero. Si la nueva todavía no existe y la
// vieja sí, se copia entera. Va a un temporal y se renombra al final: o
// queda completa o no queda (una copia a medias no se tomaría nunca más por
// buena ni se reintentaría). No pisa nada y no borra la vieja.
function adopt(oldDir, newDir) {
  if (fs.existsSync(newDir) || !fs.existsSync(oldDir)) return false;
  const tmp = `${newDir}.adopt-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(newDir), { recursive: true });
  try {
    fs.cpSync(oldDir, tmp, { recursive: true, filter: (src) => !src.endsWith('.tmp') });
    fs.renameSync(tmp, newDir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return true;
}

module.exports = { Store, NAME, adopt };
