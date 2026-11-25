'use strict';

// El historial del navegador: por dónde se anduvo, para volver.
//
// NeonCode no tenía («el panel es un browser de apoyo», decía su comentario
// sobre los favoritos). Fran lo pidió para BlackCode el 24/11/2026.
//
// Cómo es:
//   - Una entrada por DIRECCIÓN, no por visita: volver a una página la sube al
//     principio y le suma una vez. El panel no es un navegador entero, y una
//     lista donde la misma página aparece veinte veces sirve menos.
//   - Entran las páginas http(s) que cargan en el marco principal y los cambios
//     de dirección de una SPA. Las que abre el agente también: la pestaña es la
//     misma, y es la forma de volver a lo que encontró.
//   - Lo que la app reabre sola al arrancar (las pestañas de la última vez) no
//     cuenta como una visita nueva: no cambia el orden.
//   - Es del usuario. Ninguna tool lo lee: el título de una página es texto que
//     escribe la página, y dárselo al modelo como dato de la app sería abrirle
//     otra puerta a las instrucciones escondidas. (Los marcadores sí se abren
//     por nombre: esos los eligió el usuario uno por uno.)
//   - Queda en browser-historial.json, al lado de los marcadores. Se escribe un
//     rato después del último cambio (navegar dispara varios seguidos) y de una
//     al cerrar la app.
//
// Un archivo que no se pudo LEER no es un archivo vacío (misma regla que los
// marcadores): roto, se aparta como .corrupto-<fecha> y se arranca de cero;
// trabado, no se escribe en esta sesión para no pisarlo.

const fs = require('node:fs');

const TOPE = 1500;          // entradas; las más viejas se caen
const TITULO_MAX = 200;
const ESPERA_MS = 800;

const esWeb = (u) => {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false;
  try { return Boolean(new URL(u).hostname); } catch { return false; }
};
const limpiarTitulo = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, TITULO_MAX);

/**
 * @param {object} deps
 *   archivo    dónde se guarda
 *   escribir   (archivo, objeto) => Promise: la escritura atómica de la app
 *   ahora      () => ms (para los tests)
 *   espera     ms entre el último cambio y la escritura
 */
function crear({ archivo, escribir, ahora = Date.now, espera = ESPERA_MS } = {}) {
  let lista = null;
  let trabado = false;
  let reloj = 0;
  let sucio = false;
  let restauradas = new Set();

  function cargar() {
    if (lista) return lista;
    try {
      const j = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      lista = (Array.isArray(j?.historial) ? j.historial : [])
        .filter((e) => e && esWeb(e.url))
        .map((e) => ({ url: e.url, title: limpiarTitulo(e.title), at: Number(e.at) || 0, veces: Math.max(1, Number(e.veces) | 0) }))
        .slice(0, TOPE);
    } catch (err) {
      lista = [];
      if (err?.code === 'ENOENT') return lista;
      if (err instanceof SyntaxError) {
        try { fs.renameSync(archivo, `${archivo}.corrupto-${ahora()}`); } catch { trabado = true; }
      } else {
        trabado = true;
      }
    }
    return lista;
  }

  function bajar() {
    clearTimeout(reloj);
    reloj = 0;
    if (!sucio || trabado) return;
    sucio = false;
    Promise.resolve(escribir(archivo, { historial: lista })).catch(() => { sucio = true; });
  }
  function tocar() {
    sucio = true;
    if (trabado) return;
    clearTimeout(reloj);
    reloj = setTimeout(bajar, espera);
    reloj.unref?.();
  }

  return {
    /** Una visita. Devuelve true si cambió algo. */
    anotar({ url, title = '' } = {}) {
      if (!esWeb(url)) return false;
      const l = cargar();
      const i = l.findIndex((e) => e.url === url);
      const titulo = limpiarTitulo(title);
      // La reabrió la app al arrancar: no es una visita nueva.
      if (restauradas.has(url)) {
        restauradas.delete(url);
        if (i >= 0) {
          if (titulo && l[i].title !== titulo) { l[i].title = titulo; tocar(); return true; }
          return false;
        }
      }
      const antes = i >= 0 ? l.splice(i, 1)[0] : null;
      l.unshift({ url, title: titulo || antes?.title || '', at: ahora(), veces: (antes?.veces ?? 0) + 1 });
      if (l.length > TOPE) l.length = TOPE;
      tocar();
      return true;
    },
    /** El título llegó después de la visita (casi siempre). */
    titular({ url, title } = {}) {
      const titulo = limpiarTitulo(title);
      if (!titulo || !esWeb(url)) return false;
      const e = cargar().find((x) => x.url === url);
      if (!e || e.title === titulo) return false;
      e.title = titulo;
      tocar();
      return true;
    },
    /** De la más reciente a la más vieja. Copias: nadie toca la lista de adentro. */
    lista: () => cargar().map((e) => ({ ...e })),
    quitar(url) {
      const l = cargar();
      const i = l.findIndex((e) => e.url === url);
      if (i < 0) return false;
      l.splice(i, 1);
      tocar();
      return true;
    },
    vaciar() {
      const l = cargar();
      if (!l.length) return false;
      l.length = 0;
      tocar();
      return true;
    },
    /** Las direcciones que la app está por reabrir sola (las pestañas de la última vez). */
    restauradas(urls) { restauradas = new Set((Array.isArray(urls) ? urls : []).filter(esWeb)); },
    /** Al cerrar la app: lo pendiente baja ya, sin esperar. */
    volcar() {
      clearTimeout(reloj);
      reloj = 0;
      if (!sucio || trabado || !lista) return;
      try { fs.writeFileSync(archivo, JSON.stringify({ historial: lista })); sucio = false; } catch { /* se pierde lo último, no más */ }
    },
    /** (para los tests) */
    get trabado() { return trabado; },
  };
}

module.exports = { crear, TOPE, TITULO_MAX, esWeb };
