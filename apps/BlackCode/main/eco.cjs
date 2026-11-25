'use strict';
// El Atom Echo como micrófono: BlackCode ocupa el lugar que tenía Home Assistant.
//
// El Echo (firmware de ESPHome, sin tocar) reconoce él solo la palabra clave
// y, cuando la oye, le pide a quien esté suscripto como «asistente de voz»
// que atienda: manda el audio del micrófono por la misma conexión de su API
// nativa y espera que le vayan diciendo en qué va la cosa, que es lo que
// prende su LED. Acá se atiende ese pedido:
//
//   pedido (start) → se acepta → llega el audio → corte.cjs decide dónde
//   termina la frase → se le avisa al Echo que deje de mandar → se transcribe
//   → la frase sale por alFrase() → se cierra la corrida y el Echo vuelve a
//   esperar su palabra clave.
//
// La corrida se cierra apenas hay texto, sin esperar la respuesta del agente
// (que puede tardar): el Echo no tiene parlante, no espera nada más.
//
// BlackCode es el que sale hacia el Echo: no abre ningún puerto. Sin
// Electron: la librería, la transcripción y la config se inyectan.

const corte = require('./corte.cjs');
const dns = require('node:dns');

// El nombre del Echo (algo.local) lo resuelve mDNS, que en Windows a veces
// tarda o falla las primeras veces (medido: dos fallas seguidas de casi 3 s
// cada una, y a la tercera anda): se intenta tres veces y, si ya se lo había
// encontrado antes, se usa la dirección de la última vez.
const ES_IP = /^d{1,3}(.d{1,3}){3}$|:/;
async function buscar(host) {
  if (ES_IP.test(host)) return host;
  let ultimo = null;
  for (let i = 0; i < 3; i++) {
    try { return (await dns.promises.lookup(host, { family: 4 })).address; } catch (err) { ultimo = err; }
  }
  throw ultimo;
}

const ESPERAS_MS = [3000, 6000, 15000, 30000, 60000];
const CONECTAR_MS = 15000;
const REVISAR_MS = 90000; // la librería reconecta sola; si no vuelve en este rato, se empieza de cero

// Los errores que no se arreglan reintentando: hace falta que el usuario cambie algo.
const FIJOS = {
  EncryptionKeyInvalidError: 'The key is wrong.',
  EncryptionKeyMissingError: 'This device needs its key.',
  EncryptionRequiredError: 'This device needs its key.',
  NegotiationFailedError: 'This device speaks a version of the ESPHome API that is not supported.',
};
function mensajeDe(err, host) {
  if (!err) return '';
  if (FIJOS[err.name]) return FIJOS[err.name];
  if (err.name === 'TimeoutError' || err.name === 'ConnectionTimeoutError' || err.name === 'ConnectionRefusedError' || /ENOTFOUND|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(String(err.code ?? err.cause?.code ?? err.message))) return `Could not reach ${host}.`;
  return String(err.message || err.name || 'Connection failed.').slice(0, 200);
}

/** Saca la palabra clave del principio de la frase, si Whisper la alcanzó a
 *  oír («Okay Zac, apagá la luz» → «apagá la luz»). Solo al principio, y solo
 *  si está entera: «Zac» a secas es hablarle por el nombre, y se queda. */
function sinPalabraClave(texto, frase) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  const palabras = String(frase ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!limpio || palabras.length < 2) return limpio;
  const llano = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  // «okay» lo escribe de muchas formas; el nombre, también (Zac, Zack, Sac, Zak)
  const parecida = (dicha, esperada) => {
    const a = llano(dicha);
    const b = llano(esperada);
    if (!a || !b) return false;
    if (a === b) return true;
    if (/^o+k+(ay|ey|ei|e)?$|^oquei$|^okay$/.test(b)) return /^(ok|okay|okey|okei|oke|oquei|oki)$/.test(a);
    const forma = (t) => t.replace(/^[sz]/, 'z').replace(/ck$|k$|c$/, 'c');
    return forma(a) === forma(b);
  };
  const dichas = limpio.split(' ');
  if (dichas.length < palabras.length) return limpio;
  for (let i = 0; i < palabras.length; i++) if (!parecida(dichas[i], palabras[i])) return limpio;
  return dichas.slice(palabras.length).join(' ').replace(/^[\s,.;:!¡?¿-]+/, '').trim();
}

/**
 * @param {object} o
 * @param {() => Promise<object>} o.cargar      la librería esphome-client (import())
 * @param {() => object} o.config               { activa, host, puerto, llave }
 * @param {(pcm: Buffer, que: object) => Promise<{texto: string}>} o.transcribir
 * @param {() => void} o.calentar               el Echo oyó la palabra clave: que el modelo vaya cargando
 * @param {(frase: object) => void} o.alFrase   { texto, ms } — se dijo algo
 * @param {(estado: object) => void} o.alCambiar
 */
function crear({ cargar, config, transcribir, calentar = () => {}, alFrase, alCambiar = () => {}, ahora = () => Date.now(), opcionesCorte = {}, esperas = ESPERAS_MS, revisarMs = REVISAR_MS, resolver = buscar } = {}) {
  let vuelta = 0;      // sube con cada arrancar/parar: lo que quedó de una vuelta vieja se da cuenta y se va
  let cliente = null;
  let aborto = null;
  let reintento = null;
  let revision = null;
  let intentos = 0;
  let frase = null;    // la frase en curso: { corte, palabra, guardia, cerrada }
  let cuenta = 0;
  const vistas = new Map(); // host → la última dirección donde se lo encontró
  const e = { conexion: 'off', error: '', dispositivo: null, fase: 'idle', ultima: null };
  const estado = () => ({ ...e, dispositivo: e.dispositivo ? { ...e.dispositivo } : null, ultima: e.ultima ? { ...e.ultima } : null });
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar(estado()); } catch { /* el que escucha no frena esto */ } };

  function soltarFrase() {
    if (frase) { clearTimeout(frase.guardia); frase.cerrada = true; frase = null; }
  }

  function parar(avisar = true) {
    vuelta++;
    clearTimeout(reintento);
    clearTimeout(revision);
    reintento = revision = null;
    soltarFrase();
    const c = cliente;
    cliente = null;
    try { aborto?.abort(); } catch { /* nada */ }
    aborto = null;
    if (c) {
      try { c.voiceAssistant.unsubscribe(); } catch { /* ya no estaba conectado */ }
      try { c.disconnect(); } catch { /* idem */ }
    }
    intentos = 0;
    if (avisar) poner({ conexion: 'off', error: '', dispositivo: null, fase: 'idle' });
  }

  const despues = (mia) => {
    clearTimeout(reintento);
    reintento = setTimeout(() => { if (mia === vuelta) arrancar(true); }, esperas[Math.min(intentos++, esperas.length - 1)]);
    reintento.unref?.();
  };

  /** Conecta (o reconecta) según la config. Con la escucha apagada, desconecta. */
  async function arrancar(reintentando = false) {
    const veces = reintentando ? intentos : 0;
    parar(false);
    intentos = veces;
    const c = config() ?? {};
    if (!c.activa) { poner({ conexion: 'off', error: '', dispositivo: null, fase: 'idle' }); return; }
    const host = String(c.host ?? '').trim();
    if (!host) { poner({ conexion: 'error', error: 'No address set.', dispositivo: null, fase: 'idle' }); return; }
    // una llave guardada que ya no se puede leer no es «sin llave»: hay que pegarla de nuevo
    if (c.ilegible) { poner({ conexion: 'error', error: 'The saved key can no longer be read. Paste it again.', dispositivo: null, fase: 'idle' }); return; }
    const mia = vuelta;
    poner({ conexion: 'connecting', error: reintentando ? e.error : '', fase: 'idle' });
    let lib;
    try { lib = await cargar(); } catch { if (mia === vuelta) poner({ conexion: 'error', error: 'Voice support is not installed in this build.' }); return; }
    if (mia !== vuelta) return;
    let donde;
    try { donde = await resolver(host); vistas.set(host, donde); } catch (err) {
      if (mia !== vuelta) return;
      donde = vistas.get(host);
      if (!donde) { poner({ conexion: 'connecting', error: `Could not find ${host} on the network.`, fase: 'idle' }); despues(mia); return; }
    }
    if (mia !== vuelta) return;
    let cl;
    try {
      cl = new lib.EspHomeClient({ clientId: 'blackcode', host: donde, ...(Number(c.puerto) > 0 ? { port: Number(c.puerto) } : {}), psk: c.llave ? String(c.llave) : null });
    } catch (err) { poner({ conexion: 'error', error: mensajeDe(err, host) }); return; }
    cliente = cl;
    aborto = new AbortController();
    cl.on('deviceInfo', (i) => { if (mia === vuelta) poner({ dispositivo: { nombre: String(i?.name ?? ''), version: String(i?.esphomeVersion ?? ''), modelo: String(i?.model ?? '') } }); });
    cl.on('lifecycle', (ev) => {
      if (mia !== vuelta) return;
      if (ev?.kind === 'connect' || ev?.kind === 'recovered') { clearTimeout(revision); intentos = 0; poner({ conexion: 'connected', error: '' }); }
      else if (ev?.kind === 'disconnect' || ev?.kind === 'lost') {
        // se cortó (el Echo se reinició, se cayó el wifi): la frase a medias se pierde
        soltarFrase();
        poner({ conexion: 'connecting', fase: 'idle', error: mensajeDe(ev.cause, host) });
        clearTimeout(revision);
        revision = setTimeout(() => { if (mia === vuelta && e.conexion !== 'connected') arrancar(true); }, revisarMs);
        revision.unref?.();
      }
    });
    try {
      await cl.connect({ signal: AbortSignal.any([aborto.signal, AbortSignal.timeout(CONECTAR_MS)]) });
    } catch (err) {
      if (mia !== vuelta) return;
      try { cl.disconnect(); } catch { /* nunca llegó a conectar */ }
      cliente = null;
      if (FIJOS[err?.name]) poner({ conexion: 'error', error: mensajeDe(err, host), fase: 'idle' });
      else { poner({ conexion: 'connecting', error: mensajeDe(err, host), fase: 'idle' }); despues(mia); }
      return;
    }
    if (mia !== vuelta) return;
    intentos = 0;
    let voz = null;
    try { voz = cl.capabilities().voiceAssistant; } catch { /* una librería que no lo dice: se intenta igual */ }
    if (voz && voz.supported === false) {
      parar(false);
      poner({ conexion: 'error', error: 'This device has no voice assistant in its firmware.', fase: 'idle' });
      return;
    }
    const va = cl.voiceAssistant;
    try { va.subscribe(lib.VoiceAssistantSubscribeFlag.API_AUDIO); } catch (err) { poner({ conexion: 'error', error: mensajeDe(err, host) }); return; }
    poner({ conexion: 'connected', error: '' });
    atender(mia, lib, va, aborto.signal);
  }

  function atender(mia, lib, va, signal) {
    const EV = lib.VoiceAssistantEvent;
    // (si la conexión se cayó justo ahora, avisarle al Echo no puede fallar el resto)
    const decir = (tipo, datos) => { try { va.sendEvent(tipo, datos); } catch { /* sin conexión */ } };
    const sinTexto = (f, motivo) => {
      // «no entendí nada»: el firmware no lo trata como un error (no prende el rojo)
      decir(EV.ERROR, [{ name: 'code', value: 'stt-no-text-recognized' }, { name: 'message', value: 'No speech was recognized.' }]);
      decir(EV.RUN_END);
      if (frase === f) frase = null;
      poner({ fase: 'idle', ultima: { texto: '', motivo, cuando: ahora() } });
    };

    function empezar(pedido) {
      soltarFrase(); // un pedido nuevo pisa al que estuviera a medias
      const f = { corte: corte.crear(opcionesCorte), palabra: String(pedido?.wakeWordPhrase ?? ''), cerrada: false, guardia: null, n: ++cuenta };
      frase = f;
      try { va.respondToRequest(); } catch { soltarFrase(); return; }
      decir(EV.RUN_START);
      decir(EV.STT_START);
      // si el audio no llega nunca, el corte no avanza: esto cierra igual
      const espera = (opcionesCorte.esperaMs ?? 4000) + 2500;
      f.guardia = setTimeout(() => { if (frase === f && !f.cerrada && f.corte.ms() === 0) terminar(f, 'vacio'); }, espera);
      f.guardia.unref?.();
      poner({ fase: 'listening' });
      try { calentar(); } catch { /* si Whisper no arranca, se sabrá al transcribir */ }
    }

    async function terminar(f, motivo) {
      if (!f || f.cerrada || frase !== f) return;
      f.cerrada = true;
      clearTimeout(f.guardia);
      decir(EV.STT_VAD_END); // el Echo deja de mandar audio
      if (!f.corte.hablo()) { sinTexto(f, motivo === 'vacio' ? 'silence' : motivo); return; }
      poner({ fase: 'transcribing' });
      const t0 = ahora();
      let r;
      try {
        r = await transcribir(f.corte.pcm(), { palabra: f.palabra });
      } catch (err) {
        if (mia !== vuelta || frase !== f) return;
        // Whisper no anda: esto sí es un error, y el Echo lo muestra en rojo
        decir(EV.ERROR, [{ name: 'code', value: 'stt-provider-unavailable' }, { name: 'message', value: String(err?.message ?? 'Speech-to-text failed.').slice(0, 120) }]);
        decir(EV.RUN_END);
        frase = null;
        poner({ fase: 'idle', ultima: { texto: '', error: String(err?.message ?? 'Speech-to-text failed.').slice(0, 200), cuando: ahora() } });
        return;
      }
      if (mia !== vuelta || frase !== f) return; // otra frase la pisó, o se apagó la escucha
      const texto = sinPalabraClave(r?.texto, f.palabra);
      if (!texto) { sinTexto(f, 'nothing'); return; }
      decir(EV.STT_END, [{ name: 'text', value: texto }]);
      decir(EV.RUN_END);
      frase = null;
      poner({ fase: 'idle', ultima: { texto, ms: ahora() - t0, audio: f.corte.ms(), cuando: ahora() } });
      try { alFrase({ texto, ms: ahora() - t0, audio: f.corte.ms() }); } catch { /* el que recibe no frena esto */ }
    }

    (async () => {
      try {
        for await (const pedido of va.requests({ signal })) {
          if (mia !== vuelta) return;
          if (pedido?.start) empezar(pedido);
          else if (frase && !frase.cerrada) terminar(frase, 'device'); // el Echo cortó por su cuenta
        }
      } catch { /* se apagó la escucha o se cortó la conexión */ }
    })();
    (async () => {
      try {
        for await (const tramo of va.audio({ signal })) {
          if (mia !== vuelta) return;
          const f = frase;
          if (!f || f.cerrada) continue;
          const que = f.corte.dar(tramo?.data);
          if (que || tramo?.end) terminar(f, que || 'device');
        }
      } catch { /* idem */ }
    })();
  }

  return { arrancar: () => arrancar(false), parar: () => parar(true), estado };
}

module.exports = { crear, sinPalabraClave, mensajeDe, buscar };
