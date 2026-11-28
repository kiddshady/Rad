'use strict';
// El corte de una frase: dónde termina de hablar el usuario.
//
// El Atom Echo manda el audio del micrófono desde que oye la palabra clave y
// no para hasta que alguien le dice que la frase terminó. Con Home Assistant
// eso lo decidía su pipeline; acá lo decide esto, mirando el volumen: hay voz
// cuando un cuadro suena bastante más fuerte que el piso de ruido, y la frase
// termina cuando, después de haber oído voz, pasa un rato sin ella.
//
// Sin Electron y sin reloj: avanza con el audio que le dan (16 kHz, mono,
// 16 bits), así que se prueba con audio fabricado.

const MUESTREO = 16000;
const CUADRO_MS = 20;
const CUADRO = (MUESTREO * CUADRO_MS / 1000) * 2; // en bytes

/** El volumen (RMS) de un cuadro de PCM de 16 bits. */
function volumen(buf, desde = 0, hasta = buf.length) {
  let suma = 0;
  let n = 0;
  for (let i = desde; i + 1 < hasta; i += 2) { const v = buf.readInt16LE(i); suma += v * v; n++; }
  return n ? Math.sqrt(suma / n) : 0;
}

/**
 * @param {object} o
 * @param {number} o.silencioMs  silencio, después de la voz, que cierra la frase
 * @param {number} o.esperaMs    cuánto se espera a que empiece a hablar
 * @param {number} o.topeMs      la frase más larga que se acepta
 * @param {number} o.umbral      volumen mínimo para contar como voz, sea cual sea el piso
 * @param {number} o.sobrePiso   cuántas veces el piso de ruido tiene que superar la voz
 * @param {number} o.arranqueMs  voz seguida que hace falta para dar la frase por empezada
 * @param {number} o.piso        el ruido de fondo, si ya se conoce (el micrófono de la PC lo
 *                               mide todo el tiempo: la frase se abre mientras se sigue
 *                               hablando, y sin esto la voz pasaba por el piso)
 */
// (minVozMs: una frase con menos voz que esto no se cierra al callar: se
// sigue esperando. Es para la que se abre con la palabra clave en el micrófono
// de la PC: la cola de «zac» y la pausa que se hace antes de pedir algo la
// cerraban antes de que se dijera nada. 0 = sin mínimo, como el Echo.)
function crear({ silencioMs = 900, esperaMs = 4000, topeMs = 15000, umbral = 350, sobrePiso = 3, arranqueMs = 60, piso: pisoInicial = Infinity, minVozMs = 0 } = {}) {
  const partes = [];
  let resto = Buffer.alloc(0);
  let ms = 0;          // audio recibido
  let piso = Number.isFinite(pisoInicial) && pisoInicial > 0 ? pisoInicial : Infinity; // el ruido de fondo: el cuadro más callado, que sube despacio
  let seguida = 0;     // voz seguida, hasta que la frase empieza
  let empezo = false;
  let callado = 0;     // silencio desde la última voz
  let conVoz = 0;      // cuánta voz hubo en total
  let cierre = null;

  /** Recibe un tramo de audio. Devuelve null mientras la frase sigue, o por
   *  qué terminó: 'fin' (calló), 'tope' (habló demasiado) o 'vacio' (no habló). */
  function dar(buf) {
    if (cierre) return cierre;
    if (!buf?.length) return null;
    partes.push(Buffer.from(buf));
    let todo = resto.length ? Buffer.concat([resto, buf]) : buf;
    let i = 0;
    for (; i + CUADRO <= todo.length && !cierre; i += CUADRO) {
      const v = volumen(todo, i, i + CUADRO);
      ms += CUADRO_MS;
      // El piso baja de golpe y sube de a poco, y solo mientras no hay voz: si
      // subiera también durante la voz, una frase larga y pareja terminaría
      // tapándose a sí misma y se cortaría sola por la mitad.
      const voz = v > Math.max(umbral, piso * sobrePiso);
      piso = voz ? Math.min(v, piso) : Math.min(v, piso * 1.003 + 0.5);
      if (voz) { conVoz += CUADRO_MS; callado = 0; seguida += CUADRO_MS; if (seguida >= arranqueMs) empezo = true; } else { seguida = 0; if (empezo) callado += CUADRO_MS; }
      if (empezo && callado >= silencioMs && conVoz < minVozMs) { empezo = false; callado = 0; conVoz = 0; } // (un pedacito suelto: no era la frase)
      else if (empezo && callado >= silencioMs) cierre = 'fin';
      else if (!empezo && ms >= esperaMs) cierre = 'vacio';
      else if (ms >= topeMs) cierre = empezo ? 'tope' : 'vacio';
    }
    resto = Buffer.from(todo.subarray(i));
    return cierre;
  }

  return {
    dar,
    /** ¿Se oyó voz? (sin ella no hay nada que transcribir) */
    hablo: () => empezo,
    /** Todo el audio recibido, tal como llegó. */
    pcm: () => Buffer.concat(partes),
    ms: () => ms,
    medidas: () => ({ ms, conVoz, piso: Number.isFinite(piso) ? Math.round(piso) : 0, empezo, cierre }),
  };
}

module.exports = { crear, volumen, MUESTREO, CUADRO_MS };
