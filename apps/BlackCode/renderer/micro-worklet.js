// El micrófono de la PC, del lado del hilo de audio: junta lo que llega (ya a
// 16 kHz: el AudioContext se crea a ese muestreo y Chromium remuestrea) y lo
// entrega de a 100 ms en PCM de 16 bits, que es lo que esperan el detector de
// la palabra clave y Whisper.

const TRAMO = 1600; // 100 ms a 16 kHz

class Micro extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(TRAMO);
    this.n = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      const v = Math.max(-1, Math.min(1, canal[i]));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === TRAMO) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(TRAMO);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('blackcode-micro', Micro);
