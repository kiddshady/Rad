'use strict';
// Pasar audio de un formato a otro con ffmpeg, el del usuario (no viaja con
// la app: en su PC está en el PATH). Lo usa el puente a Telegram: un audio de
// Telegram (OGG/Opus, o el MP3/M4A de un archivo) a PCM para Whisper, y la voz
// del agente (PCM) a OGG/Opus, que es lo que Telegram muestra como nota de voz.
//
// La entrada va por un archivo temporal y no por stdin: un M4A guarda su
// índice al final, y leído de un caño ffmpeg no lo encuentra. La salida sí va
// por stdout. Sin Electron: los tests lo corren con node pelado.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLAZO_MS = 120000;
const SALIDA_MAX = 64 * 1024 * 1024;

function correr(args, { comando = 'ffmpeg', lanzar = spawn, plazoMs = PLAZO_MS, entrada = null } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = lanzar(comando, args, { stdio: [entrada ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { reject(new Error(`ffmpeg could not be started: ${err.message}`)); return; }
    const partes = [];
    let largo = 0;
    let error = '';
    let listo = false;
    const fin = (err, buf) => { if (listo) return; listo = true; clearTimeout(t); if (err) reject(err); else resolve(buf); };
    const t = setTimeout(() => { try { p.kill(); } catch { /* ya se fue */ } fin(new Error('ffmpeg took too long.')); }, plazoMs);
    p.on('error', (err) => fin(new Error(err.code === 'ENOENT' ? 'ffmpeg was not found. Install it and put it in the PATH.' : `ffmpeg could not be started: ${err.message}`)));
    p.stdout.on('data', (d) => {
      largo += d.length;
      if (largo > SALIDA_MAX) { try { p.kill(); } catch { /* ya */ } fin(new Error('The audio is too long.')); return; }
      partes.push(d);
    });
    p.stderr.on('data', (d) => { error = (error + d.toString()).slice(-2000); });
    p.on('close', (codigo) => {
      if (codigo === 0) fin(null, Buffer.concat(partes));
      else fin(new Error(`ffmpeg could not convert the audio${error.trim() ? `: ${error.trim().split('\n').pop().slice(0, 200)}` : '.'}`));
    });
    if (entrada) { p.stdin.on('error', () => {}); p.stdin.end(entrada); }
  });
}

/** Cualquier audio → PCM de 16 kHz, mono, 16 bits (lo que come Whisper). */
async function aPcm16k(audio, o = {}) {
  const tmp = path.join(os.tmpdir(), `blackcode-audio-${crypto.randomBytes(6).toString('hex')}`);
  await fs.promises.writeFile(tmp, audio);
  try {
    return await correr(['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', tmp, '-vn', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], o);
  } finally {
    fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}

/** PCM mono de 16 bits → OGG/Opus (una nota de voz de Telegram). */
function aOpus(pcm, sr = 24000, o = {}) {
  return correr(['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(sr), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'pipe:1'], { ...o, entrada: pcm });
}

module.exports = { aPcm16k, aOpus, correr };
