'use strict';
// La escucha: pasa a texto lo que se dijo, con Whisper, en esta máquina.
//
// Whisper corre en un proceso aparte de Python (motor/escucha_motor.py), que
// carga el modelo una vez y transcribe frase por frase. Python y Whisper son
// del usuario: no viajan con la app. El proceso se levanta con la primera
// frase —el modelo empieza a cargar apenas el Echo oye la palabra clave,
// mientras el usuario todavía habla— y se apaga tras un rato sin uso, para
// devolver la memoria de la placa. Salvo que `mantener()` diga que no: con el
// Echo conectado queda cargado siempre, porque en frío tarda unos 14 s y la
// primera orden después de un rato esperaba unos 10 s de más.
//
// Sin Electron: el proceso se lanza con lo que le pasen (los tests le dan uno
// de mentira) y el audio no toca el disco.

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const MODELO = 'large-v3-turbo';
const OCIOSO_MS = 5 * 60000;
const PLAZO_MS = 90000; // una frase que tarda más que esto (con la carga del modelo adentro) se da por perdida

// Lo que Whisper escribe cuando no oye nada: frases de relleno de los videos
// con los que aprendió. Si es TODO lo que salió, no se dijo nada.
const INVENTOS = [
  /^(muchas\s+)?gracias(\s+por\s+(ver|mirar)(\s+el\s+v[ií]deo)?)?$/,
  /^subt[ií]tulos?\s+(realizados?|creados?|hechos?)?\s*(por|de)\s+.*$/,
  /^(thank\s+you|thanks)(\s+for\s+watching)?$/,
  /^(suscr[ií]bete|suscribite)(\s+al\s+canal)?$/,
  /^(¡|!)*\s*(hasta\s+la\s+pr[oó]xima|chau|adi[oó]s)$/,
];
const llano = (t) => String(t).toLowerCase().replace(/[¡!¿?.,;:"'«»]+/g, ' ').replace(/\s+/g, ' ').trim();

/** El texto de una transcripción, sin lo que Whisper inventó: los segmentos
 *  que él mismo marca como «acá no habla nadie» y las frases de relleno. */
function textoDe(segs) {
  const buenos = (Array.isArray(segs) ? segs : []).filter((s) => {
    const t = String(s?.t ?? '').trim();
    if (!t) return false;
    // dice que no hay voz, y encima no confía en lo que escribió
    if (Number(s.ns) > 0.6 && Number(s.lp) < -1) return false;
    // un bucle («la la la la…»): comprime demasiado bien
    if (Number(s.cr) > 2.4) return false;
    return true;
  });
  const texto = buenos.map((s) => String(s.t).trim()).join(' ').replace(/\s+/g, ' ').trim();
  // (solo signos —«...»— tampoco es texto)
  if (!texto || !llano(texto) || INVENTOS.some((r) => r.test(llano(texto)))) return '';
  return texto;
}

/**
 * @param {object} o
 * @param {() => string} o.python     el intérprete (por defecto, el del PATH)
 * @param {string} o.script           la ruta a escucha_motor.py
 * @param {Function} o.lanzar         (comando, args, opciones) → proceso (por defecto, spawn)
 * @param {Function} o.alCambiar      cambió el estado
 * @param {() => boolean} o.mantener  mientras diga que sí, el rato sin uso no lo apaga
 */
function crear({ python = () => 'python', script, lanzar = spawn, ociosoMs = OCIOSO_MS, plazoMs = PLAZO_MS, modelo = MODELO, dispositivo = () => 'auto', mantener = () => false, alCambiar = () => {} } = {}) {
  let proc = null;
  let n = 0;
  let ocio = null;
  const pendientes = new Map(); // id → { resolve, reject, plazo }
  const e = { estado: 'off', error: '', dispositivo: null, gpu: null };
  const poner = (cambio) => { Object.assign(e, cambio); alCambiar(estado()); };
  const estado = () => ({ ...e, modelo });

  const descansar = () => {
    clearTimeout(ocio);
    // (si hay que mantenerlo, se vuelve a mirar en otro rato: cuando el Echo se
    // desconecta, se apaga a lo sumo un rato después)
    ocio = setTimeout(() => { if (!pendientes.size && !mantener()) apagar(); else descansar(); }, ociosoMs);
    ocio.unref?.();
  };

  function soltar(motivo) {
    for (const [, p] of pendientes) { clearTimeout(p.plazo); p.reject(new Error(motivo)); }
    pendientes.clear();
  }

  function levantar() {
    if (proc) return proc;
    let p;
    let ultimoError = '';
    try {
      p = lanzar(python() || 'python', ['-X', 'utf8', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      poner({ estado: 'error', error: `Python could not be started: ${err.message}` });
      return null;
    }
    proc = p;
    poner({ estado: 'starting', error: '' });
    p.on('error', (err) => {
      if (proc !== p) return;
      proc = null;
      soltar('Python could not be started.');
      poner({ estado: 'error', error: err.code === 'ENOENT' ? 'Python was not found.' : `Python could not be started: ${err.message}` });
    });
    p.on('exit', (codigo) => {
      if (proc !== p) return;
      proc = null;
      clearTimeout(ocio);
      const falta = /No module named '([\w.]+)'/.exec(ultimoError)?.[1];
      // (salió porque se lo pidieron: no es un error)
      if (p.pedidoSalir) { soltar('The listener was stopped.'); poner({ estado: 'off', error: '' }); return; }
      soltar('The listener stopped.');
      poner({ estado: 'error', error: falta ? `Python is missing the “${falta}” package.` : `The listener stopped (exit ${codigo ?? '?'}).${ultimoError ? ` ${ultimoError.split('\n').filter(Boolean).pop().slice(0, 200)}` : ''}` });
    });
    p.stderr?.on('data', (d) => { ultimoError = (ultimoError + d.toString()).slice(-4000); });
    p.stdin?.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', (linea) => {
      let ev;
      try { ev = JSON.parse(linea); } catch { return; }
      if (proc !== p || !ev || typeof ev !== 'object') return;
      if (ev.ev === 'listo') poner({ estado: 'idle', dispositivo: ev.dispositivo ?? null, gpu: ev.gpu ?? null });
      else if (ev.ev === 'cargando') poner({ estado: 'loading' });
      else if (ev.ev === 'cargado') poner({ estado: 'ready', dispositivo: ev.dispositivo ?? e.dispositivo });
      else if (ev.ev === 'hecho' || ev.ev === 'error') {
        const pedido = pendientes.get(ev.id);
        if (!pedido) return;
        pendientes.delete(ev.id);
        clearTimeout(pedido.plazo);
        if (ev.ev === 'hecho') pedido.resolve({ texto: textoDe(ev.segs), segs: ev.segs ?? [], dur: ev.dur ?? 0, tardo: ev.tardo ?? 0, idioma: ev.idioma ?? null });
        else pedido.reject(new Error(String(ev.msg ?? 'Whisper failed.')));
      }
    });
    return p;
  }

  const mandar = (obj) => {
    const p = levantar();
    if (!p) return false;
    try { p.stdin.write(`${JSON.stringify(obj)}\n`); return true; } catch { return false; }
  };

  /** Que el modelo vaya entrando a memoria (se llama cuando el Echo oye la palabra clave). */
  function calentar() {
    descansar();
    return mandar({ op: 'cargar', modelo, dispositivo: dispositivo() });
  }

  /** PCM de 16 kHz, mono, 16 bits → { texto, tardo, … }. Rechaza si Whisper no anda. */
  function transcribir(pcm, { idioma = 'es', prompt = '' } = {}) {
    descansar();
    return new Promise((resolve, reject) => {
      const id = `f${++n}`;
      const plazo = setTimeout(() => { if (pendientes.delete(id)) reject(new Error('Whisper took too long.')); }, plazoMs);
      plazo.unref?.();
      pendientes.set(id, { resolve, reject, plazo });
      const ok = mandar({ op: 'transcribir', id, pcm: Buffer.from(pcm).toString('base64'), idioma: idioma || null, prompt: prompt || null, modelo, dispositivo: dispositivo() });
      if (!ok && pendientes.delete(id)) { clearTimeout(plazo); reject(new Error(e.error || 'The listener could not be started.')); }
    });
  }

  function apagar() {
    clearTimeout(ocio);
    const p = proc;
    // (sin proceso que apagar, igual se limpia el error que hubiera quedado: se apaga cuando el usuario cambió algo)
    if (!p) { poner({ estado: 'off', error: '' }); return; }
    p.pedidoSalir = true;
    try { p.stdin.write('{"op":"salir"}\n'); p.stdin.end(); } catch { /* ya se fue */ }
    // (si no sale por las buenas, por las malas)
    const t = setTimeout(() => { try { p.kill(); } catch { /* ya se fue */ } }, 3000);
    t.unref?.();
  }

  return { calentar, transcribir, apagar, estado, vivo: () => Boolean(proc) };
}

/** ¿Este Python tiene Whisper? Lo mira sin cargar ningún modelo.
 *  → { ok, cuda, gpu, modelo (¿ya está bajado?) } o { ok: false, error }. */
function probar({ python = 'python', lanzar = spawn, modelo = MODELO, plazoMs = 40000 } = {}) {
  const codigo = [
    'import json, os, sys',
    'import torch, whisper',
    `m = os.path.join(os.path.expanduser("~"), ".cache", "whisper", "${modelo}.pt")`,
    'c = torch.cuda.is_available()',
    'print(json.dumps({"ok": True, "cuda": c, "gpu": torch.cuda.get_device_name(0) if c else None, "modelo": os.path.exists(m)}))',
  ].join('\n');
  return new Promise((resolve) => {
    let p;
    let sale = '';
    let error = '';
    let listo = false;
    const fin = (r) => { if (listo) return; listo = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { p?.kill(); } catch { /* ya se fue */ } fin({ ok: false, error: 'Python took too long to answer.' }); }, plazoMs);
    try { p = lanzar(python || 'python', ['-X', 'utf8', '-c', codigo], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { return fin({ ok: false, error: `Python could not be started: ${err.message}` }); }
    p.on('error', (err) => fin({ ok: false, error: err.code === 'ENOENT' ? 'Python was not found.' : `Python could not be started: ${err.message}` }));
    p.stdout?.on('data', (d) => { sale += d.toString(); });
    p.stderr?.on('data', (d) => { error = (error + d.toString()).slice(-4000); });
    p.on('exit', () => {
      try { const r = JSON.parse(sale.trim().split('\n').pop()); if (r?.ok) return fin({ ok: true, cuda: r.cuda === true, gpu: r.gpu ?? null, modelo: r.modelo === true }); } catch { /* no contestó */ }
      const falta = /No module named '([\w.]+)'/.exec(error)?.[1];
      fin({ ok: false, error: falta ? `Python is missing the “${falta}” package.` : 'Python answered, but Whisper could not be loaded.' });
    });
  });
}

module.exports = { crear, probar, textoDe, MODELO };
