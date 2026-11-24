// Test del guardado (packages/core/main/store.cjs), con node pelado y una
// carpeta descartable. Uso: node tools/test-store.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Store, adopt, adoptSecrets } = require(path.join(ROOT, 'packages', 'core', 'main', 'store.cjs'));

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rad-store-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
const onDisk = (dir, name) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')); } catch { return {}; }
};

// 1. Doscientos guardados seguidos, sin esperar: queda el último y no
//    sobra ningún temporal.
{
  const dir = fresh();
  const s = new Store(dir, { debounceMs: 0 });
  const all = [];
  for (let i = 0; i < 200; i++) {
    all.push(s.write('notas', { n: i }));
    if (i % 17 === 0) s.flush('notas'); // que se solapen escrituras de verdad
  }
  await Promise.all(all);
  await s.flushAll();
  check(onDisk(dir, 'notas').n === 199, `ráfaga: en disco quedó ${onDisk(dir, 'notas').n}, se esperaba 199`);
  check(leftovers(dir).length === 0, `ráfaga: sobraron temporales: ${leftovers(dir).join(', ')}`);
  check(s.read('notas').n === 199, 'ráfaga: la caché no tiene el último valor');
}

// 2. Un principal roto con .bak bueno: se recupera del .bak y el roto se
//    aparta, no se pisa.
{
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'ajustes.json'), '{ "tema": ', 'utf8');
  fs.writeFileSync(path.join(dir, 'ajustes.json.bak'), '{ "tema": "classic" }', 'utf8');
  const logs = [];
  const s = new Store(dir, { log: (m) => logs.push(m) });
  check(s.read('ajustes')?.tema === 'classic', 'roto con .bak: no se recuperó del .bak');
  check(fs.readdirSync(dir).some((f) => f.startsWith('ajustes.json.corrupt-')), 'roto con .bak: el archivo roto no quedó apartado');
}

// 3. Roto y sin .bak: undefined (la app pone sus valores por defecto) y el
//    roto se conserva.
{
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'x.json'), 'no es json', 'utf8');
  const s = new Store(dir);
  check(s.read('x') === undefined, 'roto sin .bak: no devolvió undefined');
  check(fs.readdirSync(dir).some((f) => f.startsWith('x.json.corrupt-')), 'roto sin .bak: se perdió el archivo roto');
}

// 4. Cada guardado deja el anterior en .bak.
{
  const dir = fresh();
  const s = new Store(dir, { debounceMs: 0 });
  await s.write('doc', { v: 1 });
  await s.write('doc', { v: 2 });
  check(JSON.parse(fs.readFileSync(path.join(dir, 'doc.json.bak'), 'utf8')).v === 1, '.bak: no tiene la versión anterior');
}

// 5. El rename de Windows que falla un rato (EPERM) se reintenta y llega.
{
  const dir = fresh();
  const s = new Store(dir, { debounceMs: 0 });
  const real = fs.promises.rename;
  let fails = 2;
  fs.promises.rename = async (...args) => {
    if (fails-- > 0) { const e = new Error('tomado'); e.code = 'EPERM'; throw e; }
    return real(...args);
  };
  try {
    await s.write('lock', { ok: true });
  } catch (err) {
    check(false, `EPERM: el guardado falló en vez de reintentar: ${err.message}`);
  } finally {
    fs.promises.rename = real;
  }
  check(onDisk(dir, 'lock').ok === true, 'EPERM: no llegó al disco después de reintentar');
  check(leftovers(dir).length === 0, 'EPERM: sobró el temporal');
}

// 6. Si el rename no se libera nunca, el guardado falla (no miente) y no
//    deja el temporal tirado.
{
  const dir = fresh();
  const s = new Store(dir, { debounceMs: 0, log: () => {} });
  const real = fs.promises.rename;
  fs.promises.rename = async () => { const e = new Error('tomado'); e.code = 'EBUSY'; throw e; };
  let failed = false;
  try { await s.write('pegado', { a: 1 }); } catch { failed = true; } finally { fs.promises.rename = real; }
  check(failed, 'EBUSY eterno: el guardado dijo que anduvo');
  check(leftovers(dir).length === 0, 'EBUSY eterno: quedó el temporal tirado');
}

// 7. Nombres: nada de rutas.
{
  const s = new Store(fresh());
  for (const bad of ['../fuera', 'a/b', 'Mayus', '', 'con espacio']) {
    let threw = false;
    try { s.read(bad); } catch { threw = true; }
    check(threw, `nombre inválido aceptado: ${JSON.stringify(bad)}`);
  }
}

// 8. Adoptar los datos de la carpeta vieja (una app que cambió de nombre):
//    se copia entera si la nueva no existe, sin temporales; no pisa una que
//    ya existe, no borra la vieja y sin vieja no inventa nada.
{
  const base = fresh();
  const old = path.join(base, 'Vieja', 'data');
  const now = path.join(base, 'Nueva', 'data');
  const s = new Store(old, { debounceMs: 0 });
  await s.write('ajustes', { piel: 'mono' });
  await s.flushAll();
  fs.writeFileSync(path.join(old, 'ajustes.json.7.tmp'), 'a medias');
  check(adopt(old, now) === true, 'adoptar: no adoptó una carpeta que existía');
  check(onDisk(now, 'ajustes').piel === 'mono', 'adoptar: el documento no llegó a la carpeta nueva');
  check(leftovers(now).length === 0, 'adoptar: se trajo un temporal');
  check(fs.readdirSync(path.dirname(now)).join() === 'data', `adoptar: quedó algo más al lado: ${fs.readdirSync(path.dirname(now)).join(', ')}`);
  check(onDisk(old, 'ajustes').piel === 'mono', 'adoptar: tocó la carpeta vieja');
  const s2 = new Store(now, { debounceMs: 0 });
  await s2.write('ajustes', { piel: 'glass' });
  await s2.flushAll();
  check(adopt(old, now) === false, 'adoptar: volvió a adoptar sobre una carpeta que ya existía');
  check(onDisk(now, 'ajustes').piel === 'glass', 'adoptar: pisó los datos nuevos con los viejos');
  const nada = path.join(base, 'Otra', 'data');
  check(adopt(path.join(base, 'NoExiste', 'data'), nada) === false && !fs.existsSync(nada), 'adoptar: sin carpeta vieja creó algo');

  // La clave de lo cifrado (el «Local State» de la carpeta de usuario) viaja
  // una sola vez, y nunca pisa la que ya tenga la carpeta nueva.
  const vieja = path.join(base, 'Vieja');
  const nueva = path.join(base, 'Nueva');
  check(adoptSecrets(vieja, nueva) === false && !fs.existsSync(path.join(nueva, 'Local State')), 'adoptar la clave: sin clave vieja creó una');
  fs.writeFileSync(path.join(vieja, 'Local State'), '{"os_crypt":"clave-vieja"}');
  check(adoptSecrets(vieja, nueva) === true, 'adoptar la clave: no la trajo');
  check(fs.readFileSync(path.join(nueva, 'Local State'), 'utf8') === '{"os_crypt":"clave-vieja"}', 'adoptar la clave: llegó distinta');
  check(fs.readdirSync(nueva).sort().join() === 'Local State,data', `adoptar la clave: quedó algo más en la carpeta: ${fs.readdirSync(nueva).join(', ')}`);
  fs.writeFileSync(path.join(nueva, 'Local State'), '{"os_crypt":"clave-nueva"}');
  check(adoptSecrets(vieja, nueva) === false, 'adoptar la clave: volvió a traerla sobre una que ya estaba');
  check(fs.readFileSync(path.join(nueva, 'Local State'), 'utf8') === '{"os_crypt":"clave-nueva"}', 'adoptar la clave: pisó la clave de la carpeta nueva');
}

// 9. Borrar un documento: se van el archivo y su .bak, leerlo da undefined,
//    un guardado que estaba pendiente no lo resucita, uno que venía en vuelo
//    tampoco, y después se puede volver a crear.
{
  const dir = fresh();
  const s = new Store(dir, { debounceMs: 20 });
  await s.write('chat', { v: 1 });
  await s.write('chat', { v: 2 });
  const pendiente = s.write('chat', { v: 3 }); // todavía en el debounce
  await s.remove('chat');
  await pendiente;
  await sleep(60);
  const quedan = () => fs.readdirSync(dir).filter((f) => f.startsWith('chat'));
  check(quedan().length === 0, `borrar: quedaron archivos: ${quedan().join(', ')}`);
  check(s.read('chat') === undefined, 'borrar: leerlo después no dio undefined');

  const enVuelo = s.write('chat', { v: 4 });
  s.flush('chat'); // ya salió a escribirse
  await s.remove('chat');
  await enVuelo.catch(() => {});
  await s.flushAll();
  check(quedan().length === 0, `borrar con una escritura en vuelo: quedaron archivos: ${quedan().join(', ')}`);

  await s.write('chat', { v: 5 });
  await s.flushAll();
  check(onDisk(dir, 'chat').v === 5, 'borrar: no se pudo volver a crear el documento');
  let threw = false;
  try { s.remove('../fuera'); } catch { threw = true; }
  check(threw, 'borrar: aceptó un nombre inválido');
}

if (failures.length) {
  console.error(`test-store: ${failures.length} falla(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('test-store: ok (ráfaga, recuperación, .bak, reintentos, nombres, adoptar, borrar)');
