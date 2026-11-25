'use strict';
// El habla: decir en voz alta lo que contestó un agente, con una voz clonada.
//
// La voz la hace Qwen3-TTS en un proceso aparte de Python
// (motor/habla_motor.py, con faster-qwen3-tts), que carga el modelo una vez,
// aprende la voz de una muestra y va entregando el audio por tramos mientras
// lo genera. Python y el modelo son del usuario: no viajan con la app. El
// proceso se levanta con la primera frase y se apaga tras un rato sin uso,
// para devolver la memoria de la placa.
//
// Lo que se dice es texto para oír, no para leer: sin markdown, sin código,
// en frases. Se manda de a una frase, así callarlo corta en seco y una
// respuesta larga no se va de tema.
//
// Sin Electron: el proceso se lanza con lo que le pasen (los tests le dan uno
// de mentira). El audio sale por alAudio() y no toca el disco.

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');

const MODELOS = [
  { id: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', nombre: 'Large (1.7B)' },
  { id: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base', nombre: 'Small (0.6B)' },
];
const MODELO = MODELOS[0].id;
const IDIOMAS = { es: 'Spanish', en: 'English', auto: 'Auto' };
const OCIOSO_MS = 10 * 60000;
const TOPE = 700;        // más que esto no se dice: es una respuesta para leer
const FRASE_MAX = 240;

/** Un texto para oír: lo que quedaría de una respuesta en markdown si se la
 *  leyera en voz alta. El código, las tablas y las imágenes se saltean. */
function paraOir(texto) {
  return String(texto ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')               // bloques de código
    .replace(/^\s*\|.*\|\s*$/gm, ' ')                  // filas de una tabla
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')             // imágenes
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')           // [texto](url) → texto
    // Una dirección suelta no se lee letra por letra, pero tampoco se borra: si
    // la frase queda colgando («más detalles en»), el modelo de voz la termina
    // por su cuenta con cualquier cosa. Se dice «link».
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')                 // fórmulas
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/[*_~#]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ') // emojis
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?…:;,])\s*\.(\s|$)/g, '$1$2')
    .replace(/\s+([.,;:!?…])/g, '$1')
    .trim();
}

/** El texto partido en frases de a lo sumo `max` caracteres, hasta `tope` en
 *  total (lo que pasa de ahí no se dice). */
function enFrases(texto, { max = FRASE_MAX, tope = TOPE } = {}) {
  const limpio = paraOir(texto);
  if (!limpio) return [];
  const piezas = limpio.match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g)?.map((p) => p.trim()).filter(Boolean) ?? [limpio];
  const frases = [];
  let largo = 0;
  for (let pieza of piezas) {
    if (largo + pieza.length > tope && frases.length) break;
    // una frase eterna se parte en sus comas, y si ni así, en sus espacios
    while (pieza.length > max) {
      let i = pieza.lastIndexOf(', ', max);
      if (i < max / 3) i = pieza.lastIndexOf(' ', max);
      if (i < max / 3) i = max;
      frases.push(pieza.slice(0, i + 1).trim());
      largo += i + 1;
      pieza = pieza.slice(i + 1).trim();
    }
    if (!pieza) continue;
    // las frases cortitas van juntas: suenan mejor de un tirón
    const ultima = frases.at(-1);
    if (ultima !== undefined && ultima.length + pieza.length + 1 <= max / 2) frases[frases.length - 1] = `${ultima} ${pieza}`;
    else frases.push(pieza);
    largo += pieza.length;
  }
  return frases;
}

/**
 * @param {object} o
 * @param {() => string} o.python   el intérprete que tiene faster-qwen3-tts
 * @param {string} o.script         la ruta a habla_motor.py
 * @param {() => object} o.config   { modelo, muestra, idioma }
 * @param {Function} o.alAudio      ({ turno, n, sr, pcm }) un tramo de audio (PCM de 16 bits, mono)
 * @param {Function} o.alFin        ({ turno, callado, error }) terminó de decir ese turno
 */
function crear({ python = () => '', script, lanzar = spawn, config = () => ({}), ociosoMs = OCIOSO_MS, existe = fs.existsSync, alAudio = () => {}, alFin = () => {}, alCambiar = () => {} } = {}) {
  let proc = null;
  let ocio = null;
  let cuenta = 0;
  let cargado = null;            // «modelo|muestra» que el proceso tiene en memoria
  const turnos = new Map();      // turno → { faltan: Set de ids, n, callado, error }
  const e = { estado: 'off', error: '', gpu: null };
  const estado = () => ({ ...e, hablando: [...turnos.values()].some((t) => !t.callado) });
  const poner = (cambio) => { Object.assign(e, cambio); try { alCambiar(estado()); } catch { /* el que escucha no frena esto */ } };

  const descansar = () => {
    clearTimeout(ocio);
    ocio = setTimeout(() => { if (!turnos.size) apagar(); else descansar(); }, ociosoMs);
    ocio.unref?.();
  };

  function cerrarTurnos(error) {
    for (const [turno, t] of turnos) { turnos.delete(turno); try { alFin({ turno, callado: t.callado, error }); } catch { /* idem */ } }
  }

  function levantar() {
    if (proc) return proc;
    const exe = String(python() ?? '').trim();
    if (!exe) { poner({ estado: 'error', error: 'No Python set for the voice.' }); return null; }
    let p;
    let ultimoError = '';
    try {
      p = lanzar(exe, ['-X', 'utf8', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      poner({ estado: 'error', error: `Python could not be started: ${err.message}` });
      return null;
    }
    proc = p;
    cargado = null;
    poner({ estado: 'starting', error: '' });
    p.on('error', (err) => {
      if (proc !== p) return;
      proc = null;
      poner({ estado: 'error', error: err.code === 'ENOENT' ? 'That Python was not found.' : `Python could not be started: ${err.message}` });
      cerrarTurnos(e.error);
    });
    p.on('exit', (codigo) => {
      if (proc !== p) return;
      proc = null;
      cargado = null;
      clearTimeout(ocio);
      if (p.pedidoSalir) { poner({ estado: 'off', error: '' }); cerrarTurnos('The voice was stopped.'); return; }
      const falta = /No module named '([\w.]+)'/.exec(ultimoError)?.[1];
      poner({ estado: 'error', error: falta ? `That Python is missing the “${falta}” package.` : `The voice stopped (exit ${codigo ?? '?'}).${ultimoError ? ` ${ultimoError.split('\n').filter(Boolean).pop().slice(0, 200)}` : ''}` });
      cerrarTurnos(e.error);
    });
    p.stderr?.on('data', (d) => { ultimoError = (ultimoError + d.toString()).slice(-4000); });
    p.stdin?.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', (linea) => {
      let ev;
      try { ev = JSON.parse(linea); } catch { return; }
      if (proc !== p || !ev || typeof ev !== 'object') return;
      if (ev.ev === 'listo') poner({ estado: e.estado === 'starting' ? 'idle' : e.estado, gpu: ev.gpu ?? null });
      else if (ev.ev === 'cargando') poner({ estado: 'loading' });
      else if (ev.ev === 'cargado') poner({ estado: 'ready' });
      else if (ev.ev === 'audio' || ev.ev === 'fin' || ev.ev === 'error') {
        const turno = String(ev.id ?? '').split('.')[0];
        const t = turnos.get(turno);
        if (!t) { if (ev.ev === 'error' && !ev.id) poner({ estado: 'error', error: String(ev.msg ?? 'The voice failed.').slice(0, 300) }); return; }
        if (ev.ev === 'audio') {
          if (t.callado) return; // lo callaron: lo que siga llegando no suena
          let pcm;
          try { pcm = Buffer.from(String(ev.pcm ?? ''), 'base64'); } catch { return; }
          if (pcm.length) { try { alAudio({ turno, n: t.n++, sr: Number(ev.sr) || 24000, pcm }); } catch { /* idem */ } }
          return;
        }
        if (ev.ev === 'error') { t.error = String(ev.msg ?? 'The voice failed.').slice(0, 300); cargado = null; }
        t.faltan.delete(ev.id);
        if (!t.faltan.size) {
          turnos.delete(turno);
          if (t.error) poner({ estado: 'error', error: t.error }); else poner({});
          try { alFin({ turno, callado: t.callado, ...(t.error ? { error: t.error } : {}) }); } catch { /* idem */ }
        }
      }
    });
    return p;
  }

  const mandar = (obj) => {
    const p = levantar();
    if (!p) return false;
    try { p.stdin.write(`${JSON.stringify(obj)}\n`); return true; } catch { return false; }
  };

  // El modelo y la muestra van en un pedido aparte, y solo cuando cambian.
  function preparar() {
    const c = config() ?? {};
    const modelo = MODELOS.some((m) => m.id === c.modelo) ? c.modelo : MODELO;
    const muestra = String(c.muestra ?? '').trim();
    if (!muestra) { poner({ estado: 'error', error: 'No voice sample set.' }); return null; }
    if (!existe(muestra)) { poner({ estado: 'error', error: 'The voice sample was not found.' }); return null; }
    const clave = `${modelo}|${muestra}`;
    if (!proc || cargado !== clave) {
      if (!mandar({ op: 'cargar', modelo, referencia: muestra })) return null;
      cargado = clave;
    }
    return { idioma: IDIOMAS[c.idioma] ?? 'Spanish' };
  }

  /** Que el modelo vaya entrando a memoria (el agente ya está contestando). */
  function calentar() {
    descansar();
    return Boolean(preparar());
  }

  /** Dice un texto. Devuelve el turno (para saber de quién es cada tramo) o null si no hay nada que decir o no se puede. */
  function decir(texto) {
    const frases = enFrases(texto);
    if (!frases.length) return null;
    descansar();
    const listo = preparar();
    if (!listo) return null;
    const turno = `t${++cuenta}`;
    const t = { faltan: new Set(), n: 0, callado: false, error: '' };
    turnos.set(turno, t);
    for (const [i, frase] of frases.entries()) {
      const id = `${turno}.${i}`;
      t.faltan.add(id);
      if (!mandar({ op: 'decir', id, texto: frase, idioma: listo.idioma })) { turnos.delete(turno); return null; }
    }
    poner({});
    return turno;
  }

  /** Deja de hablar: lo que se estaba diciendo se corta y lo que esperaba no se dice. */
  function callar() {
    let alguno = false;
    for (const t of turnos.values()) {
      if (t.callado) continue;
      t.callado = true;
      alguno = true;
      for (const id of t.faltan) { try { proc?.stdin.write(`${JSON.stringify({ op: 'callar', id })}\n`); } catch { /* ya se fue */ } }
    }
    if (alguno) poner({});
    return alguno;
  }

  function apagar() {
    clearTimeout(ocio);
    const p = proc;
    // (sin proceso que apagar, igual se limpia lo que hubiera quedado dicho: se
    // apaga cuando el usuario cambió el Python, la muestra o el modelo, y un
    // «falta la muestra» de antes ya no es verdad)
    if (!p) { poner({ estado: 'off', error: '' }); return; }
    p.pedidoSalir = true;
    try { p.stdin.write('{"op":"salir"}\n'); p.stdin.end(); } catch { /* ya se fue */ }
    const t = setTimeout(() => { try { p.kill(); } catch { /* ya se fue */ } }, 3000);
    t.unref?.();
  }

  return { calentar, decir, callar, apagar, estado, vivo: () => Boolean(proc) };
}

/** ¿Ese Python tiene faster-qwen3-tts? Lo mira sin cargar ningún modelo. */
function probar({ python = '', lanzar = spawn, plazoMs = 60000 } = {}) {
  const codigo = [
    'import json',
    'import torch, faster_qwen3_tts',
    'c = torch.cuda.is_available()',
    'print(json.dumps({"ok": True, "cuda": c, "gpu": torch.cuda.get_device_name(0) if c else None}))',
  ].join('\n');
  return new Promise((resolve) => {
    const exe = String(python ?? '').trim();
    if (!exe) { resolve({ ok: false, error: 'No Python set for the voice.' }); return; }
    let p;
    let sale = '';
    let error = '';
    let listo = false;
    const fin = (r) => { if (listo) return; listo = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { p?.kill(); } catch { /* ya se fue */ } fin({ ok: false, error: 'Python took too long to answer.' }); }, plazoMs);
    try { p = lanzar(exe, ['-X', 'utf8', '-c', codigo], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { fin({ ok: false, error: `Python could not be started: ${err.message}` }); return; }
    p.on('error', (err) => fin({ ok: false, error: err.code === 'ENOENT' ? 'That Python was not found.' : `Python could not be started: ${err.message}` }));
    p.stdout?.on('data', (d) => { sale += d.toString(); });
    p.stderr?.on('data', (d) => { error = (error + d.toString()).slice(-4000); });
    p.on('exit', () => {
      try { const r = JSON.parse(sale.trim().split('\n').pop()); if (r?.ok) { fin({ ok: true, cuda: r.cuda === true, gpu: r.gpu ?? null }); return; } } catch { /* no contestó */ }
      const falta = /No module named '([\w.]+)'/.exec(error)?.[1];
      fin({ ok: false, error: falta ? `That Python is missing the “${falta}” package.` : 'Python answered, but the voice could not be loaded.' });
    });
  });
}

module.exports = { crear, probar, paraOir, enFrases, MODELOS, MODELO, TOPE };
