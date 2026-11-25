'use strict';
// La voz: darle una orden a un agente hablándole al Atom Echo.
//
// Tres piezas, cada una en su archivo y sin Electron: eco.cjs (la conexión
// con el Echo y la frase), corte.cjs (dónde termina de hablar) y escucha.cjs
// (Whisper, en esta máquina). Esto las une con la app: guarda la config, cifra
// la llave del Echo y le pasa cada frase a la interfaz, que la manda a un chat
// como si se hubiera tipeado (el canal `voz:frase`).
//
// La config vive en un documento reservado (`_voz`): la interfaz no lo lee, y
// de la llave solo sabe si está puesta. Viene todo apagado de fábrica.
//
// Un turno de voz no corre en automático salvo que el usuario lo prenda
// («Let voice act»): la frase la pudo haber dicho un video, y Whisper se puede
// equivocar. Lo que pide permiso siempre (agendar una tarea, un servidor MCP
// con «preguntar») lo sigue pidiendo igual.

const path = require('node:path');

const DOC = '_voz';
const IDIOMAS = ['es', 'en', 'auto'];
// La llave de la API de ESPHome: 32 bytes en base64.
const esLlave = (t) => typeof t === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(t.trim()) && Buffer.from(t.trim(), 'base64').length === 32;

function wire(rad, { taller, cifrar, descifrar, agentes, simulada = null }) {
  const electron = require('electron');
  const leer = () => { const d = rad.store.read(DOC); return d && typeof d === 'object' ? d : {}; };
  const config = () => {
    const d = leer();
    return {
      activa: d.activa === true,
      host: typeof d.host === 'string' ? d.host : '',
      puerto: Number.isInteger(d.puerto) && d.puerto > 0 && d.puerto < 65536 ? d.puerto : 0,
      agente: typeof d.agente === 'string' ? d.agente : '',
      idioma: IDIOMAS.includes(d.idioma) ? d.idioma : 'es',
      actua: d.actua === true,
      python: typeof d.python === 'string' ? d.python : '',
      hayLlave: typeof d.llave === 'string' && d.llave.length > 0,
    };
  };
  const laLlave = () => { const d = leer(); return typeof d.llave === 'string' && d.llave ? descifrar(d.llave) : null; };

  const script = electron.app.isPackaged ? path.join(process.resourcesPath, 'motor', 'escucha_motor.py') : path.join(__dirname, '..', 'motor', 'escucha_motor.py');
  let avisar = () => {};
  const escucha = simulada?.escucha ?? require('./escucha.cjs').crear({
    python: () => config().python || 'python',
    script,
    alCambiar: () => avisar(),
  });
  // A Whisper le ayuda saber qué nombres puede oír: los de los agentes.
  const pista = () => [...new Set([...agentes().map((a) => String(a?.nombre ?? '').trim()).filter(Boolean), 'BlackCode'])].join(', ').slice(0, 300);
  let cuenta = 0;
  const eco = require('./eco.cjs').crear({
    cargar: simulada ? async () => simulada.lib : () => import('esphome-client'),
    // (`ilegible`: hay una llave guardada pero Windows ya no la descifra —pasa si se borran los datos de la app a medias—)
    config: () => { const c = config(); const llave = laLlave(); return { activa: c.activa, host: c.host, puerto: c.puerto, llave, ilegible: c.hayLlave && !llave }; },
    calentar: () => escucha.calentar(),
    transcribir: (pcm) => { const c = config(); return escucha.transcribir(pcm, { idioma: c.idioma === 'auto' ? '' : c.idioma, prompt: pista() }); },
    alFrase: (f) => {
      const c = config();
      rad.send('voz:frase', { n: ++cuenta, texto: f.texto, agente: c.agente, actua: c.actua, tardo: f.ms });
    },
    alCambiar: () => avisar(),
    ...(simulada ? { resolver: async (h) => h } : {}),
  });

  const vista = () => {
    const { hayLlave, ...c } = config();
    return { ...c, hayLlave, cifrado: cifrar('x') !== null, eco: eco.estado(), whisper: escucha.estado() };
  };
  avisar = () => rad.send('voz:evento', vista());

  rad.handle('voz:estado', vista);
  rad.handle('voz:guardar', (cambio) => {
    const c = cambio && typeof cambio === 'object' ? cambio : {};
    const d = leer();
    const antes = JSON.stringify([d.activa === true, d.host ?? '', d.puerto ?? 0]);
    if (typeof c.activa === 'boolean') d.activa = c.activa;
    if (typeof c.host === 'string') {
      const h = c.host.trim();
      // (un nombre de la red o una IP: sin esquema, sin barras, sin espacios)
      if (h && !/^[A-Za-z0-9.\-:]{1,253}$/.test(h)) return { ok: false, error: 'That address does not look right: use a name like atom-echo.local or an IP.' };
      d.host = h;
    }
    if (c.puerto !== undefined) {
      const p = Number(c.puerto);
      if (c.puerto !== '' && c.puerto !== 0 && !(Number.isInteger(p) && p > 0 && p < 65536)) return { ok: false, error: 'The port is a number between 1 and 65535.' };
      d.puerto = Number.isInteger(p) && p > 0 ? p : 0;
    }
    if (typeof c.agente === 'string') d.agente = c.agente.slice(0, 80);
    if (IDIOMAS.includes(c.idioma)) d.idioma = c.idioma;
    if (typeof c.actua === 'boolean') d.actua = c.actua;
    if (typeof c.python === 'string') d.python = c.python.trim().slice(0, 400);
    rad.store.write(DOC, d);
    // solo lo que cambia la conexión la reinicia (elegir otro agente no corta nada)
    if (antes !== JSON.stringify([d.activa === true, d.host ?? '', d.puerto ?? 0])) {
      if (!d.activa) escucha.apagar();
      eco.arrancar();
    }
    avisar();
    return { ok: true };
  });
  // La llave: entra en claro una sola vez, se guarda cifrada y no vuelve a salir.
  rad.handle('voz:llave', (texto) => {
    const d = leer();
    if (texto === null || texto === '') {
      delete d.llave;
    } else {
      if (!esLlave(texto)) return { ok: false, error: 'That does not look like an ESPHome API key: it is 44 characters ending in “=”, from api: encryption: key: in the device’s YAML.' };
      const blob = cifrar(String(texto).trim());
      if (!blob) return { ok: false, error: 'Windows could not encrypt the key, so it was not saved.' };
      d.llave = blob;
    }
    rad.store.write(DOC, d);
    if (d.activa === true) eco.arrancar();
    avisar();
    return { ok: true };
  });
  // ¿Este Python tiene Whisper? (no carga ningún modelo)
  rad.handle('voz:probar', () => (simulada ? simulada.probar() : require('./escucha.cjs').probar({ python: config().python || 'python' })));

  // Terminó un turno de voz (o quedó esperando permiso) y nadie mira la
  // ventana: un aviso de Windows, que al tocarlo trae la app a ese chat.
  let ultimoAviso = null;
  rad.handle('voz:aviso', (que) => {
    const titulo = String(que?.titulo ?? 'BlackCode').slice(0, 80);
    const cuerpo = String(que?.cuerpo ?? '').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 220);
    const chat = String(que?.chat ?? '');
    const w = electron.BrowserWindow.getAllWindows()[0];
    const mirando = Boolean(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused());
    ultimoAviso = { titulo, cuerpo, chat, mirando };
    if (taller || mirando) return { mostrado: false }; // (en el humo no se le manda un aviso de verdad al usuario)
    if (!electron.Notification.isSupported()) return { mostrado: false };
    const aviso = new electron.Notification({ title: titulo, body: cuerpo, silent: false });
    aviso.on('click', () => { rad.tray?.show(); rad.send('voz:abrir', { chat }); });
    aviso.show();
    return { mostrado: true };
  });
  if (taller) rad.handle('voz:ultimo-aviso', () => ultimoAviso);
  // En el humo el Echo y Whisper son de mentira, así que lo de verdad no se
  // usa: esto comprueba que igual esté (en la app empaquetada es lo primero
  // que se rompe si la librería o el motor no viajaron).
  if (taller) {
    rad.handle('voz:piezas', async () => {
      const fs = require('node:fs');
      let libreria = false;
      let error = '';
      try {
        const lib = await import('esphome-client');
        libreria = typeof lib.EspHomeClient === 'function' && lib.VoiceAssistantSubscribeFlag?.API_AUDIO === 1 && lib.VoiceAssistantEvent?.RUN_END === 2 && lib.VoiceAssistantEvent?.STT_VAD_END === 12;
      } catch (err) { error = String(err?.message ?? err).slice(0, 200); }
      let motor = false;
      try { motor = fs.readFileSync(script, 'utf8').includes('"op": "transcribir"'); } catch (err) { error = error || String(err?.message ?? err).slice(0, 200); }
      return { libreria, motor, empaquetada: electron.app.isPackaged, error };
    });
  }

  electron.app.on('before-quit', () => { eco.parar(); escucha.apagar(); });
  // Al abrir la app, si la escucha quedó prendida, se conecta sola. Recién
  // cuando la app está lista: antes de eso safeStorage no descifra, la llave
  // saldría vacía y el Echo contestaría que le falta.
  electron.app.whenReady().then(() => eco.arrancar());
  return { eco, escucha, vista };
}

module.exports = { wire, esLlave, DOC };
