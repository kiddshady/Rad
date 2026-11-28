'use strict';
// Un micrófono de la PC (la webcam de Fran) en modo conversación.
//
// Con el Atom Echo cada orden es ida y vuelta: palabra clave, una frase, y el
// Echo vuelve a esperar. Con un micrófono de la PC es una CONVERSACIÓN (lo
// eligió Fran el 27/11/2026): «okay zac» (o el atajo) la abre, y después de
// cada respuesta el micrófono se vuelve a abrir solo, sin palabra clave, hasta
// que se la cierra:
//   - diciendo «gracias, zac» (eso no le llega al agente);
//   - con 30 s sin hablar;
//   - con el atajo otra vez.
//
//   esperando la palabra ─ oída / atajo ─▶ escuchando ─ calló ─▶ transcribiendo
//          ▲                                  ▲                       │
//          └──── cierre ────────────── listo ─┴── esperando la respuesta ◀┘
//
// «listo» lo manda la interfaz cuando la respuesta terminó de sonar (o de
// llegar, si no se dice en voz alta): mientras Zac habla el micrófono no abre
// frases, porque se escucharía a sí mismo. La palabra clave sí se oye en todo
// momento: dicha mientras habla, lo calla y abre una frase nueva, como con el
// Echo.
//
// Sin Electron: el audio, la transcripción y los avisos se inyectan. El corte
// de cada frase es el mismo del Echo (corte.cjs).

const corte = require('./corte.cjs');
const { sinPalabraClave } = require('./eco.cjs');

const SILENCIO_MS = 30000;     // sin hablar esto, la conversación se cierra
const FRASE_TOPE_MS = 30000;   // la frase más larga que se acepta
const PALABRA = 'okay zac';
const MIN_VOZ_MS = 400;        // la voz que hace falta en la frase que abre la palabra clave
const PREVIO_BYTES = 16000 * 2 * 1.5; // 1,5 s de audio de antes de oír la palabra

const llano = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
// (Whisper escribe el nombre de muchas formas: Zac, Zack, Zach, Zak, Sac)
const esZac = (p) => /^[sz]a(c|k|ck|ch|j|x|cs|ks)$/.test(p);
/** ¿Lo que se dijo es la frase de cierre? «Gracias, Zac.», «muchas gracias zac»,
 *  «Okay, gracias Zac». (Fran la eligió el 28/11/2026: «chau y listo quedan medio mal».) */
function esCierre(texto) {
  const w = llano(texto).split(' ').filter(Boolean);
  if (w[0] && /^(ok|okay|okey|okei|oke|oki)$/.test(w[0])) w.shift();
  if (w[0] === 'muchas' || w[0] === 'mil') w.shift();
  if (w.length !== 2) return false;
  return /^(gracias|graciass|grax|grachas)$/.test(w[0]) && esZac(w[1]);
}

/**
 * @param {object} o
 * @param {(pcm: Buffer) => Promise<{texto: string}>} o.transcribir
 * @param {() => void} o.calentar   se abrió una frase: que Whisper vaya cargando
 * @param {() => void} o.callar     que deje de sonar lo que el agente estuviera diciendo
 * @param {(frase: object) => void} o.alFrase   { texto, ms, audio }
 * @param {(estado: object) => void} o.alCambiar
 */
function crear({ transcribir, calentar = () => {}, callar = () => {}, alFrase, alCambiar = () => {}, ahora = () => Date.now(), silencioMs = SILENCIO_MS, opcionesCorte = {}, palabra = PALABRA } = {}) {
  let vuelta = 0;      // sube al cerrar o apagar: una transcripción vieja que vuelve tarde se descarta
  let frase = null;    // { corte, n, cerrada }
  let cuenta = 0;
  let calladoDesde = 0; // desde cuándo se espera que hable (para los 30 s)
  // El ruido del cuarto, medido todo el tiempo (no solo con una frase
  // abierta): la frase se abre al oír la palabra clave, MIENTRAS se sigue
  // hablando («okay zac, qué hora es»), y un corte que aprendiera el piso ahí
  // tomaría la voz por ruido. Misma regla que el corte: baja de golpe, sube
  // despacio. (Probado con la webcam de Fran el 28/11/2026: sin esto, lo
  // dicho de corrido tras la palabra se perdía.)
  let pisoAmb = Infinity;
  // Lo último que oyó el micrófono. El detector reconoce la palabra unos
  // 400 ms DESPUÉS de dicha (medido con la webcam el 28/11/2026: «okey zac,
  // ¿qué hora es?» se oía ya por la mitad de «qué hora es»), así que la frase
  // que abre la palabra arranca desde acá: lo que se alcanzó a decir no se
  // pierde. Lo que entre de la palabra misma lo saca sinPalabraClave.
  let previo = [];
  let previoBytes = 0;
  const guardarPrevio = (buf) => {
    previo.push(buf);
    previoBytes += buf.length;
    while (previo.length > 1 && previoBytes - previo[0].length >= PREVIO_BYTES) previoBytes -= previo.shift().length;
  };
  const CUADRO = (corte.MUESTREO * corte.CUADRO_MS / 1000) * 2;
  const medirPiso = (buf) => {
    for (let i = 0; i + CUADRO <= buf.length; i += CUADRO) {
      const v = corte.volumen(buf, i, i + CUADRO);
      pisoAmb = Math.min(v, Number.isFinite(pisoAmb) ? pisoAmb * 1.003 + 0.5 : v);
    }
  };
  const e = { activo: false, conversacion: false, fase: 'idle', ultima: null, cierre: '' };
  const estado = () => ({ ...e, ultima: e.ultima ? { ...e.ultima } : null });
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar(estado()); } catch { /* el que escucha no frena esto */ } };

  function soltarFrase() { if (frase) { clearTimeout(frase.guardia); frase.cerrada = true; frase = null; } }

  /** Abre una frase. Lo que queda de los 30 s es lo que espera a que empiece a hablar. */
  function empezar(trasPalabra = false) {
    soltarFrase();
    const queda = silencioMs - (ahora() - calladoDesde);
    if (queda <= 0) { cerrar('silence'); return; }
    // (el tope del corte cuenta desde que se abre: la espera va adentro)
    // (la que abre la palabra clave pide algo de voz de verdad: la cola de
    // «zac» y la pausa de antes de pedir algo la cerraban vacía. Las que
    // siguen no, que un «sí» es cortito)
    const f = { corte: corte.crear({ esperaMs: queda, topeMs: queda + FRASE_TOPE_MS, piso: pisoAmb, ...(trasPalabra ? { minVozMs: MIN_VOZ_MS } : {}), ...opcionesCorte }), n: ++cuenta, cerrada: false };
    frase = f;
    // si el audio deja de llegar (se desenchufó la webcam), el corte no avanza: esto cierra igual
    f.guardia = setTimeout(() => { if (frase === f && !f.cerrada && !f.corte.hablo()) terminar(f, 'vacio'); }, queda + 2500);
    f.guardia.unref?.();
    poner({ fase: 'listening' });
    try { calentar(); } catch { /* si Whisper no arranca, se sabrá al transcribir */ }
  }

  /** Abre la conversación (o, si ya estaba, una frase nueva ya mismo).
   *  `conPrevio`: la abrió la palabra clave, y la frase arranca con lo último que se oyó. */
  function abrir(conPrevio = false) {
    if (!e.activo) return;
    try { callar(); } catch { /* nada que callar */ }
    calladoDesde = ahora();
    if (!e.conversacion) poner({ conversacion: true, cierre: '' });
    empezar(true);
    const f = frase;
    if (!conPrevio || !f) return;
    const antes = previo;
    previo = [];
    previoBytes = 0;
    for (const b of antes) {
      const que = f.corte.dar(b);
      if (que) { terminar(f, que); return; }
    }
  }

  function cerrar(motivo) {
    if (!e.conversacion && !frase) return;
    vuelta++;
    soltarFrase();
    poner({ conversacion: false, fase: 'idle', cierre: motivo });
  }

  async function terminar(f, motivo) {
    if (!f || f.cerrada || frase !== f) return;
    f.cerrada = true;
    clearTimeout(f.guardia);
    // no habló en todo el rato que le quedaba: se cierra
    if (!f.corte.hablo()) { frase = null; cerrar('silence'); return; }
    poner({ fase: 'transcribing' });
    const mia = vuelta;
    const t0 = ahora();
    let r;
    try {
      r = await transcribir(f.corte.pcm());
    } catch (err) {
      if (mia !== vuelta || frase !== f) return;
      frase = null;
      // Whisper no anda: seguir escuchando no serviría de nada
      poner({ ultima: { texto: '', error: String(err?.message ?? 'Speech-to-text failed.').slice(0, 200), cuando: ahora() } });
      cerrar('error');
      return;
    }
    if (mia !== vuelta || frase !== f) return;
    frase = null;
    const texto = sinPalabraClave(r?.texto, palabra);
    // ruido, o algo que Whisper no entendió: sigue escuchando, con lo que quedaba de los 30 s
    if (!texto) { poner({ ultima: { texto: '', motivo: motivo === 'tope' ? 'tope' : 'nothing', cuando: ahora() } }); empezar(); return; }
    if (esCierre(texto)) { poner({ ultima: { texto, cierre: true, cuando: ahora() } }); cerrar('phrase'); return; }
    poner({ fase: 'waiting', ultima: { texto, ms: ahora() - t0, audio: f.corte.ms(), cuando: ahora() } });
    try { alFrase({ texto, ms: ahora() - t0, audio: f.corte.ms() }); } catch { /* el que recibe no frena esto */ }
  }

  return {
    /** El modo micrófono se prende o se apaga (apagarlo cierra la conversación). */
    activar(si) {
      if (si === e.activo) return;
      if (!si) { cerrar('off'); poner({ activo: false, fase: 'idle' }); return; }
      poner({ activo: true });
    },
    /** Un tramo del micrófono (16 kHz, mono, 16 bits). */
    dar(pcm) {
      if (!e.activo || !pcm?.length) return;
      const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
      medirPiso(buf);
      guardarPrevio(buf);
      const f = frase;
      if (!f || f.cerrada) return;
      const que = f.corte.dar(buf);
      if (que) terminar(f, que);
    },
    /** Se oyó la palabra clave. */
    oida: () => abrir(true),
    /** El atajo: abre la conversación, o la cierra si ya estaba abierta. */
    atajo() { if (e.conversacion) cerrar('shortcut'); else abrir(); },
    /** La respuesta terminó de sonar (o de llegar): el micrófono se vuelve a abrir. */
    listo() {
      if (!e.activo || !e.conversacion || e.fase !== 'waiting') return;
      calladoDesde = ahora();
      empezar();
    },
    cerrar: (motivo = 'closed') => cerrar(motivo),
    estado,
  };
}

module.exports = { crear, esCierre, SILENCIO_MS };
