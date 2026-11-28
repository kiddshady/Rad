'use strict';
// La palabra clave en la PC: el detector de «okay zac» para el micrófono de
// la PC (el Atom Echo la reconoce en su firmware; la webcam no puede).
//
// Corre en un proceso aparte de Python (motor/palabra_motor.py) con el mismo
// modelo de microWakeWord que usa el Echo: el .json del usuario, con su
// .tflite al lado. Se le da el audio crudo del micrófono (16 kHz, mono, 16
// bits) por stdin y avisa por stdout cuando oye la palabra. Es barato: unos
// 20 ms de CPU por cada 3 s de audio (medido el 27/11/2026).
//
// Sin Electron: el proceso se lanza con lo que le pasen (los tests le dan uno
// de mentira).

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const REINTENTO_MS = 5000;

/**
 * @param {object} o
 * @param {() => string} o.python   el intérprete (el mismo de Whisper)
 * @param {string} o.script         la ruta a palabra_motor.py
 * @param {() => string} o.modelo   la ruta al .json del modelo
 * @param {() => void} o.alOir      se dijo la palabra clave
 * @param {(estado: object) => void} o.alCambiar
 */
function crear({ python = () => 'python', script, modelo = () => '', lanzar = spawn, alOir = () => {}, alCambiar = () => {}, reintentoMs = REINTENTO_MS } = {}) {
  let proc = null;
  let quiere = false;   // ¿tiene que estar corriendo?
  let reintento = null;
  const e = { estado: 'off', error: '', palabra: '' };
  const estado = () => ({ ...e });
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar(estado()); } catch { /* el que escucha no frena esto */ } };

  function levantar() {
    if (proc || !quiere) return;
    const json = modelo();
    if (!json) { poner({ estado: 'error', error: 'No wake word model chosen.' }); return; }
    let p;
    let ultimoError = '';
    try {
      p = lanzar(python() || 'python', ['-X', 'utf8', script, json], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      poner({ estado: 'error', error: `Python could not be started: ${err.message}` });
      return;
    }
    proc = p;
    poner({ estado: 'starting', error: '' });
    p.on('error', (err) => {
      if (proc !== p) return;
      proc = null;
      poner({ estado: 'error', error: err.code === 'ENOENT' ? 'Python was not found.' : `Python could not be started: ${err.message}` });
    });
    p.on('exit', (codigo) => {
      if (proc !== p) return;
      proc = null;
      if (p.pedidoSalir || !quiere) { poner({ estado: 'off', error: '' }); return; }
      // (un error que dijo el motor ya quedó puesto: no se pisa con el código de salida)
      if (e.estado !== 'error') {
        const falta = /No module named '([\w.]+)'/.exec(ultimoError)?.[1];
        poner({ estado: 'error', error: falta ? `Python is missing the “${falta}” package.` : `The wake word listener stopped (exit ${codigo ?? '?'}).` });
      }
      // se cayó andando: vuelve a intentar en un rato. Si no llegó a cargar
      // (falta el paquete, el modelo no está), no: reintentar daría lo mismo;
      // vuelve a probar cuando el usuario cambie algo (reiniciar)
      if (!p.listo) return;
      clearTimeout(reintento);
      reintento = setTimeout(levantar, reintentoMs);
      reintento.unref?.();
    });
    p.stderr?.on('data', (d) => { ultimoError = (ultimoError + d.toString()).slice(-4000); });
    p.stdin?.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', (linea) => {
      let ev;
      try { ev = JSON.parse(linea); } catch { return; }
      if (proc !== p || !ev || typeof ev !== 'object') return;
      if (ev.ev === 'listo') { p.listo = true; poner({ estado: 'ready', error: '', palabra: String(ev.palabra ?? '') }); }
      else if (ev.ev === 'oida') { try { alOir({ p: Number(ev.p) || 0 }); } catch { /* idem */ } }
      else if (ev.ev === 'error') {
        const msg = String(ev.msg ?? '');
        const falta = /No module named '([\w.]+)'/.exec(msg)?.[1];
        poner({ estado: 'error', error: falta ? `Python is missing the “${falta}” package (pip install pymicro-wakeword).` : /FileNotFound|No such file/.test(msg) ? 'The wake word model could not be found.' : `The wake word model could not be loaded: ${msg.slice(0, 200)}` });
      }
    });
  }

  return {
    /** Que esté corriendo (o que deje de estarlo). */
    prender() { quiere = true; levantar(); },
    apagar() {
      quiere = false;
      clearTimeout(reintento);
      const p = proc;
      proc = null;
      if (!p) { poner({ estado: 'off', error: '' }); return; }
      p.pedidoSalir = true;
      try { p.stdin.end(); } catch { /* ya se fue */ }
      const t = setTimeout(() => { try { p.kill(); } catch { /* ya se fue */ } }, 2000);
      t.unref?.();
      poner({ estado: 'off', error: '' });
    },
    /** Cambió el Python o el modelo: lo que corría se suelta y arranca con lo nuevo. */
    reiniciar() { const si = quiere; this.apagar(); if (si) this.prender(); },
    /** Un tramo de audio del micrófono. */
    dar(pcm) {
      if (!proc || e.estado !== 'ready' || !pcm?.length) return;
      try { proc.stdin.write(pcm); } catch { /* se está yendo */ }
    },
    estado,
  };
}

module.exports = { crear };
