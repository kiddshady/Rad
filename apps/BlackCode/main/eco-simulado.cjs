'use strict';
// Un Atom Echo de mentira, para los tests y el humo: hace de la librería
// esphome-client (la clase y sus constantes) y deja manejar al «dispositivo»
// desde afuera: que pida atención, que mande audio, que se le corte el wifi.
// Anota todo lo que el cliente le dice, que es lo que prendería su LED.
// No abre ninguna conexión.

const MUESTREO = 16000;
const TRAMO = 1024; // el Echo de verdad manda de a 1024 bytes (32 ms)

/** Un tono: lo que el corte por silencio toma por voz. */
function tono(ms, amplitud = 3000) {
  const n = Math.round(MUESTREO * ms / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amplitud * Math.sin(2 * Math.PI * 220 * i / MUESTREO)), i * 2);
  return b;
}
/** Silencio con el ruido de fondo de un micrófono (el del Echo ronda los 60). */
function silencio(ms, ruido = 60) {
  const n = Math.round(MUESTREO * ms / 1000);
  const b = Buffer.alloc(n * 2);
  // (determinista: un diente de sierra chico, así los tests no dependen del azar)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(ruido * (((i * 7919) % 200) / 100 - 1) * 1.7), i * 2);
  return b;
}

const VoiceAssistantSubscribeFlag = Object.freeze({ NONE: 0, API_AUDIO: 1 });
const VoiceAssistantEvent = Object.freeze({ ERROR: 0, RUN_START: 1, RUN_END: 2, STT_START: 3, STT_END: 4, INTENT_START: 5, INTENT_END: 6, TTS_START: 7, TTS_END: 8, WAKE_WORD_START: 9, WAKE_WORD_END: 10, STT_VAD_START: 11, STT_VAD_END: 12 });
const NOMBRE = Object.fromEntries(Object.entries(VoiceAssistantEvent).map(([k, v]) => [v, k]));

function crear({ llave = null, info = { name: 'fake-atom', esphomeVersion: '2026.4.5', model: 'm5stack-atom' } } = {}) {
  const pedidos = new Set();
  const audios = new Set();
  const echo = {
    llave,                 // si la tiene, el cliente tiene que traer la misma
    info,
    capacidades: { supported: true, apiAudio: true },
    falla: null,           // un error con el que rechaza la próxima conexión (y las que sigan)
    clientes: [],
    eventos: [],           // lo que el cliente le dijo: { tipo: 'RUN_START', datos }
    suscripto: null,
    conexiones: 0,
    desconexiones: 0,
    /** Los nombres de los eventos, en orden (sin las respuestas a los pedidos). */
    nombres: () => echo.eventos.map((e) => e.tipo),
    limpiar: () => { echo.eventos.length = 0; },
    /** Oyó la palabra clave (o le tocaron el botón): pide atención. */
    pedir: ({ palabra = 'okay zac', start = true } = {}) => { for (const fn of [...pedidos]) fn({ start, flags: 1, wakeWordPhrase: palabra, audioSettings: { autoGain: 31, noiseSuppressionLevel: 2, volumeMultiplier: 1 } }); },
    /** Manda audio, en tramos como los del Echo. */
    audio: (pcm, { end = false } = {}) => {
      for (let i = 0; i < pcm.length; i += TRAMO) for (const fn of [...audios]) fn({ data: pcm.subarray(i, i + TRAMO), end: end && i + TRAMO >= pcm.length });
    },
    /** Una frase entera: un respiro, la voz y el silencio de después. */
    hablar: ({ antesMs = 200, vozMs = 1500, despuesMs = 1300 } = {}) => echo.audio(Buffer.concat([silencio(antesMs), tono(vozMs), silencio(despuesMs)])),
    /** Se le corta la conexión (y vuelve, si se lo piden). */
    cortar: (causa = Object.assign(new Error('connection lost'), { name: 'ConnectionLostError' })) => { for (const c of echo.clientes) if (c.conectado) { c.conectado = false; c.emitir('lifecycle', { kind: 'disconnect', cause: causa }); } },
    volver: () => { const c = echo.clientes.at(-1); if (c && !c.cerrado) { c.conectado = true; c.emitir('lifecycle', { kind: 'connect', encrypted: Boolean(c.opciones.psk) }); } },
  };

  // Un flujo que entrega lo que el Echo manda, hasta que lo abortan (como los de la librería).
  function flujo(oyentes, signal) {
    const cola = [];
    let despertar = null;
    const oyente = (x) => { cola.push(x); despertar?.(); };
    oyentes.add(oyente);
    return (async function* entregar() {
      try {
        while (!signal?.aborted) {
          if (cola.length) { yield cola.shift(); continue; }
          await new Promise((r) => { despertar = r; signal?.addEventListener('abort', r, { once: true }); });
          despertar = null;
        }
      } finally { oyentes.delete(oyente); }
    }());
  }

  class EspHomeClient {
    constructor(opciones) {
      this.opciones = opciones ?? {};
      this.oyentes = new Map();
      this.conectado = false;
      this.cerrado = false;
      echo.clientes.push(this);
      const yo = this;
      this.voiceAssistant = {
        subscribe: (flags = 0) => { echo.suscripto = flags; },
        unsubscribe: () => { echo.suscripto = null; },
        requests: ({ signal } = {}) => flujo(pedidos, signal),
        audio: ({ signal } = {}) => flujo(audios, signal),
        respondToRequest: (r = {}) => { if (!yo.conectado) throw new Error('not connected'); echo.eventos.push({ tipo: 'RESPUESTA', datos: r }); },
        sendEvent: (tipo, datos = []) => { if (!yo.conectado) throw new Error('not connected'); echo.eventos.push({ tipo: NOMBRE[tipo] ?? String(tipo), datos }); },
      };
    }

    on(evento, fn) {
      if (!this.oyentes.has(evento)) this.oyentes.set(evento, new Set());
      this.oyentes.get(evento).add(fn);
      return { [Symbol.dispose]: () => this.oyentes.get(evento)?.delete(fn) };
    }

    emitir(evento, dato) { for (const fn of [...(this.oyentes.get(evento) ?? [])]) fn(dato); }

    async connect({ signal } = {}) {
      await new Promise((r) => setImmediate(r));
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      if (echo.falla) throw echo.falla;
      if (echo.llave && !this.opciones.psk) throw Object.assign(new Error('key missing'), { name: 'EncryptionKeyMissingError' });
      if (echo.llave && this.opciones.psk !== echo.llave) throw Object.assign(new Error('key invalid'), { name: 'EncryptionKeyInvalidError' });
      this.conectado = true;
      echo.conexiones++;
      this.emitir('deviceInfo', echo.info);
      this.emitir('lifecycle', { kind: 'connect', encrypted: Boolean(this.opciones.psk) });
    }

    disconnect() { if (this.conectado) echo.desconexiones++; this.conectado = false; this.cerrado = true; }
    capabilities() { return { voiceAssistant: echo.capacidades }; }
    deviceInfo() { return this.conectado ? echo.info : null; }
  }

  return { echo, lib: { EspHomeClient, VoiceAssistantSubscribeFlag, VoiceAssistantEvent } };
}

/** Todo lo que la app necesita para tener voz sin un Echo ni un Whisper de
 *  verdad (el humo): el Echo de mentira, una escucha que «transcribe» lo que
 *  le dejaron dicho, y `simular`, que es lo que maneja el guion. */
function paraElHumo() {
  const { echo, lib } = crear({ llave: Buffer.alloc(32, 9).toString('base64') });
  const dichos = [];
  const cuenta = { cargas: 0, frases: 0, apagadas: 0 };
  const escucha = {
    calentar: () => { cuenta.cargas++; return true; },
    transcribir: async (pcm) => {
      cuenta.frases++;
      const texto = dichos.shift();
      if (texto instanceof Error) throw texto;
      return { texto: texto ?? '', segs: [], dur: pcm.length / 32000, tardo: 0.01, idioma: 'es' };
    },
    apagar: () => { cuenta.apagadas++; },
    estado: () => ({ estado: cuenta.cargas ? 'ready' : 'off', error: '', dispositivo: 'cpu', gpu: null, modelo: 'fake-whisper' }),
  };
  function simular({ que = 'estado', texto = '', palabra = 'okay zac', vozMs = 1200, falla = null } = {}) {
    if (que === 'frase') { dichos.push(falla ? new Error(String(falla)) : String(texto)); echo.pedir({ palabra }); echo.hablar({ vozMs }); }
    // (en dos pasos: el pedido solo —queda escuchando— y después lo que dice)
    else if (que === 'pedir') echo.pedir({ palabra });
    else if (que === 'hablar') { dichos.push(String(texto)); echo.hablar({ vozMs }); }
    else if (que === 'silencio') { echo.pedir({ palabra }); echo.audio(silencio(4600)); }
    else if (que === 'cortar') echo.cortar();
    else if (que === 'volver') echo.volver();
    else if (que === 'limpiar') echo.limpiar();
    return { eventos: echo.nombres(), datos: echo.eventos.map((e) => e.datos), conexiones: echo.conexiones, suscripto: echo.suscripto, llave: echo.clientes.at(-1)?.opciones.psk === echo.llave, host: echo.clientes.at(-1)?.opciones.host ?? null, ...cuenta };
  }
  return { echo, lib, escucha, simular, llave: echo.llave, probar: async () => ({ ok: true, cuda: false, gpu: null, modelo: true }) };
}

module.exports = { crear, paraElHumo, tono, silencio, VoiceAssistantEvent };
