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
// Lo que se le dice al agente cuando su respuesta se va a decir en voz alta.
const VOICE_NOTE = '[Voice] The user said this out loud to a microphone, and your final reply will be read aloud to them through the speakers by a text-to-speech voice. Answer in the language the user spoke, in one or two short plain sentences, the way you would say it out loud: no markdown, no lists, no code, no URLs, no emoji. Say numbers and units as words when that reads more naturally. If you ran tools, say only what matters about the result.';
// Lo que dice cuando un turno de voz queda esperando permiso (va en el idioma en que se habla).
const PIDE_PERMISO = { es: 'Necesito tu permiso en la pantalla.', en: 'I need your permission on screen.', auto: 'I need your permission on screen.' };
const PRUEBA = { es: 'Así sueno yo. Si me escuchás, está todo andando.', en: 'This is how I sound. If you can hear me, everything is working.', auto: 'This is how I sound. If you can hear me, everything is working.' };
const IDIOMAS = ['es', 'en', 'auto'];
// La llave de la API de ESPHome: 32 bytes en base64.
const esLlave = (t) => typeof t === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(t.trim()) && Buffer.from(t.trim(), 'base64').length === 32;

// Con qué voz contesta: Qwen3-TTS en esta PC o ElevenLabs en la nube.
const MOTORES = ['qwen', 'elevenlabs'];
const esIdVoz11 = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t);
const esModelo11 = (t) => typeof t === 'string' && /^[a-z0-9_.-]{1,64}$/.test(t);

function wire(rad, { taller, cifrar, descifrar, agentes, simulada = null, llaveElevenlabs = () => null }) {
  const electron = require('electron');
  const MODELOS_HABLA = require('./habla.cjs').MODELOS;
  const elevenlabs = require('./elevenlabs.cjs');
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
      // la respuesta hablada (también apagada de fábrica)
      habla: {
        activa: d.habla?.activa === true,
        python: typeof d.habla?.python === 'string' ? d.habla.python : '',
        modelo: MODELOS_HABLA.some((m) => m.id === d.habla?.modelo) ? d.habla.modelo : MODELOS_HABLA[0].id,
        muestra: typeof d.habla?.muestra === 'string' ? d.habla.muestra : '',
        // con ElevenLabs: una voz de la cuenta del usuario y un modelo
        motor: MOTORES.includes(d.habla?.motor) ? d.habla.motor : 'qwen',
        voz11: esIdVoz11(d.habla?.voz11) ? d.habla.voz11 : '',
        modelo11: esModelo11(d.habla?.modelo11) ? d.habla.modelo11 : elevenlabs.MODELO,
      },
    };
  };
  const laLlave = () => { const d = leer(); return typeof d.llave === 'string' && d.llave ? descifrar(d.llave) : null; };

  const script = electron.app.isPackaged ? path.join(process.resourcesPath, 'motor', 'escucha_motor.py') : path.join(__dirname, '..', 'motor', 'escucha_motor.py');
  let avisar = () => {};
  // Con el Echo conectado, Whisper queda cargado: en frío tarda unos 14 s, y
  // con la descarga a los cinco minutos la primera orden después de un rato
  // esperaba unos 10 s de más (medido el 27/11/2026).
  const conectado = () => config().activa && eco.estado().conexion === 'connected';
  const escucha = simulada?.escucha ?? require('./escucha.cjs').crear({
    python: () => config().python || 'python',
    script,
    mantener: conectado,
    alCambiar: () => avisar(),
  });
  // La voz con la que contesta: Qwen3-TTS, en otro Python del usuario. El audio
  // llega por tramos y va a la interfaz, que es la que lo hace sonar.
  const scriptHabla = electron.app.isPackaged ? path.join(process.resourcesPath, 'motor', 'habla_motor.py') : path.join(__dirname, '..', 'motor', 'habla_motor.py');
  // Un turno que se GRABA en vez de sonar (la nota de voz de Telegram): sus
  // tramos se juntan acá y no van a la interfaz.
  const grabando = new Map(); // turno → { partes, sr, resolve, reject }
  const paraElHabla = {
    alAudio: (a) => {
      const g = grabando.get(a.turno);
      if (g) { g.partes.push(Buffer.from(a.pcm)); g.sr = a.sr; return; }
      rad.send('voz:audio', { turno: a.turno, n: a.n, sr: a.sr, pcm: a.pcm.toString('base64') });
    },
    alFin: (f) => {
      const g = grabando.get(f.turno);
      if (g) {
        grabando.delete(f.turno);
        const pcm = Buffer.concat(g.partes);
        if (f.error) g.reject(new Error(f.error));
        else if (f.callado && !pcm.length) g.reject(new Error('the voice was stopped'));
        else if (!pcm.length) g.reject(new Error('the voice made no sound'));
        else g.resolve({ pcm, sr: g.sr });
        return;
      }
      rad.send('voz:dicho', { turno: f.turno, callado: f.callado === true, error: f.error ?? '' });
    },
    alCambiar: () => avisar(),
  };
  const qwen = simulada?.crearHabla ? simulada.crearHabla(paraElHabla) : require('./habla.cjs').crear({
    python: () => config().habla.python,
    script: scriptHabla,
    config: () => { const c = config(); return { modelo: c.habla.modelo, muestra: c.habla.muestra, idioma: c.idioma }; },
    ...paraElHabla,
  });
  // …o ElevenLabs, con una voz de la cuenta del usuario. Este es el de verdad
  // también en el humo: ahí habla con un servidor de mentira
  // (ELEVENLABS_BASE_URL), y sin él, en modo simulado, no sale a internet.
  const once = elevenlabs.crear({
    llave: llaveElevenlabs,
    config: () => { const c = config(); return { voz: c.habla.voz11, modelo: c.habla.modelo11, idioma: c.idioma }; },
    ...paraElHabla,
  });
  const motor = () => (config().habla.motor === 'elevenlabs' ? once : qwen);
  // Lo que usa el resto de la app: el motor elegido. Callar y apagar van a los
  // dos, por si se cambió de motor mientras hablaba.
  const habla = {
    calentar: () => motor().calentar(),
    decir: (texto) => motor().decir(texto),
    callar: () => { const a = qwen.callar(); const b = once.callar(); return a || b; },
    apagar: () => { qwen.apagar(); once.apagar(); },
    estado: () => motor().estado(),
  };
  // Las voces de la cuenta de ElevenLabs y sus modelos: se piden al abrir
  // Settings y cuando cambia la llave (no gastan créditos).
  let cat11 = { estado: 'off', voces: [], modelos: [], error: '' };
  let turnoCat = 0;
  async function traerCatalogo11({ forzar = false } = {}) {
    if (!llaveElevenlabs()) { turnoCat++; cat11 = { estado: 'sin-llave', voces: [], modelos: [], error: '' }; avisar(); return cat11; }
    if (!forzar && (cat11.estado === 'listo' || cat11.estado === 'cargando')) return cat11;
    const turno = ++turnoCat;
    cat11 = { ...cat11, estado: 'cargando', error: '' };
    avisar();
    try {
      const r = await elevenlabs.catalogo(llaveElevenlabs());
      if (turno === turnoCat) cat11 = { estado: 'listo', voces: r.voces, modelos: r.modelos, error: '' };
    } catch (err) {
      if (turno === turnoCat) cat11 = { estado: 'error', voces: [], modelos: [], error: String(err?.message ?? err).slice(0, 300) };
    }
    avisar();
    return cat11;
  }
  // Callar: el motor deja de generar y la interfaz corta lo que suena.
  const callar = () => { const habia = habla.callar(); rad.send('voz:callar', {}); return habia; };
  // A Whisper le ayuda saber qué nombres puede oír: los de los agentes.
  const pista = () => [...new Set([...agentes().map((a) => String(a?.nombre ?? '').trim()).filter(Boolean), 'BlackCode'])].join(', ').slice(0, 300);
  let cuenta = 0;
  let estabaConectado = false;
  const eco = require('./eco.cjs').crear({
    // (antes de conectar, el cifrado que Electron no trae: ver chacha.cjs)
    cargar: simulada ? async () => simulada.lib : async () => { await require('./chacha.cjs').instalar(); return import('esphome-client'); },
    // (`ilegible`: hay una llave guardada pero Windows ya no la descifra —pasa si se borran los datos de la app a medias—)
    config: () => { const c = config(); const llave = laLlave(); return { activa: c.activa, host: c.host, puerto: c.puerto, llave, ilegible: c.hayLlave && !llave }; },
    // el Echo oyó la palabra clave: si el agente estaba hablando, se calla (es la forma de interrumpirlo)
    // …y si va a contestar en voz alta, el modelo de voz empieza a cargar ya:
    // en frío tarda unos quince segundos, y este es el aviso más temprano que hay
    calentar: () => { callar(); if (config().habla.activa) { try { habla.calentar(); } catch { /* si no arranca, se sabrá al decir */ } } return escucha.calentar(); },
    transcribir: (pcm) => { const c = config(); return escucha.transcribir(pcm, { idioma: c.idioma === 'auto' ? '' : c.idioma, prompt: pista() }); },
    alFrase: (f) => {
      const c = config();
      rad.send('voz:frase', { n: ++cuenta, texto: f.texto, agente: c.agente, actua: c.actua, tardo: f.ms });
    },
    // apenas conecta (al abrir la app, o al volver después de un corte), el
    // modelo empieza a cargar: así la primera orden ya lo encuentra listo
    alCambiar: (s) => {
      const ahora = s?.conexion === 'connected';
      if (ahora && !estabaConectado && config().activa) { try { escucha.calentar(); } catch { /* si no arranca, Settings lo dice */ } }
      estabaConectado = ahora;
      avisar();
    },
    ...(simulada ? { resolver: async (h) => h } : {}),
  });

  const vista = () => {
    const { hayLlave, ...c } = config();
    return { ...c, hayLlave, cifrado: cifrar('x') !== null, eco: eco.estado(), whisper: escucha.estado(), habla: { ...c.habla, ...habla.estado() }, modelosHabla: MODELOS_HABLA, elevenlabs: cat11 };
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
    // (otro Python para Whisper: el proceso del anterior se suelta, y con él lo que hubiera dicho que fallaba)
    if (typeof c.python === 'string' && c.python.trim().slice(0, 400) !== (d.python ?? '')) { d.python = c.python.trim().slice(0, 400); escucha.apagar(); }
    if (c.habla && typeof c.habla === 'object') {
      const h = { ...(d.habla && typeof d.habla === 'object' ? d.habla : {}) };
      const estaba = h.activa === true;
      const claveDe = (x) => [x.python ?? '', x.modelo ?? '', x.muestra ?? '', x.motor ?? '', x.voz11 ?? '', x.modelo11 ?? ''].join('|');
      const clave = claveDe(h);
      if (typeof c.habla.activa === 'boolean') h.activa = c.habla.activa;
      if (typeof c.habla.python === 'string') h.python = c.habla.python.trim().slice(0, 400);
      if (typeof c.habla.muestra === 'string') h.muestra = c.habla.muestra.trim().slice(0, 400);
      if (MODELOS_HABLA.some((m) => m.id === c.habla.modelo)) h.modelo = c.habla.modelo;
      if (MOTORES.includes(c.habla.motor)) h.motor = c.habla.motor;
      if (c.habla.voz11 === '' || esIdVoz11(c.habla.voz11)) h.voz11 = c.habla.voz11;
      if (esModelo11(c.habla.modelo11)) h.modelo11 = c.habla.modelo11;
      d.habla = h;
      // apagarla, o cambiarle el motor, el Python, el modelo, la muestra o la
      // voz, suelta lo que tuviera: lo próximo que diga arranca con lo nuevo
      if ((estaba && !h.activa) || clave !== claveDe(h)) { callar(); habla.apagar(); }
    }
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
  // Decir un texto en voz alta (la respuesta de un turno de voz, o la prueba de Settings).
  rad.handle('voz:decir', (que) => {
    const c = config();
    const prueba = que?.prueba === true;
    if (!c.habla.activa && !prueba) return { ok: false, error: 'Spoken answers are off.' };
    const texto = prueba ? PRUEBA[c.idioma] : que?.permiso === true ? PIDE_PERMISO[c.idioma] : String(que?.texto ?? '');
    const turno = habla.decir(texto);
    return turno ? { ok: true, turno } : { ok: false, error: habla.estado().error || 'There was nothing to say.' };
  });
  rad.handle('voz:callar', () => ({ ok: true, habia: callar() }));
  rad.handle('voz:probar-habla', () => (simulada ? simulada.probar() : require('./habla.cjs').probar({ python: config().habla.python })));
  // Las voces y los modelos de ElevenLabs (con `forzar`, se vuelven a pedir).
  rad.handle('voz:elevenlabs', (que) => traerCatalogo11({ forzar: que?.forzar === true }));
  // La muestra de la voz a clonar: un archivo de audio que elige el usuario.
  rad.handle('voz:elegir-muestra', async (_q, ctx) => {
    if (taller) return path.join(taller, 'voice-sample.wav'); // (en el humo no se abre un diálogo)
    const r = await electron.dialog.showOpenDialog(ctx?.window ?? undefined, { title: 'Voice sample', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
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
      // El saludo cifrado ENTERO (Noise, el mismo que se hace con el Echo), con la
      // librería de verdad haciendo de los dos lados, en ESTE proceso: la 1.1.0
      // conectaba en las pruebas con node y fallaba instalada, porque Electron no
      // trae ChaCha20-Poly1305 y nada lo ejercitaba acá adentro.
      let cifrado = '';
      let vector = false;
      let saludo = false;
      let llaveMala = false;
      try {
        const chacha = require('./chacha.cjs');
        cifrado = await chacha.instalar();
        vector = chacha.probar();
        const lib = await import('esphome-client');
        libreria = typeof lib.EspHomeClient === 'function' && lib.VoiceAssistantSubscribeFlag?.API_AUDIO === 1 && lib.VoiceAssistantEvent?.RUN_END === 2 && lib.VoiceAssistantEvent?.STT_VAD_END === 12;
        const saludar = (pskCliente, pskEcho) => {
          const yo = lib.createESPHomeHandshake({ psk: pskCliente });
          const echo = lib.createESPHomeHandshake({ psk: pskEcho, role: 'responder' });
          echo.readMessage(yo.writeMessage());
          yo.readMessage(echo.writeMessage());
          const dicho = Buffer.from('okay zac');
          return yo.isComplete && echo.isComplete && echo.receiveCipher.DecryptWithAd(Buffer.alloc(0), yo.sendCipher.EncryptWithAd(Buffer.alloc(0), dicho)).equals(dicho) && yo.receiveCipher.DecryptWithAd(Buffer.alloc(0), echo.sendCipher.EncryptWithAd(Buffer.alloc(0), dicho)).equals(dicho);
        };
        saludo = saludar(Buffer.alloc(32, 3), Buffer.alloc(32, 3));
        try { saludar(Buffer.alloc(32, 3), Buffer.alloc(32, 4)); } catch { llaveMala = true; }
      } catch (err) { error = String(err?.message ?? err).slice(0, 200); }
      let motor = false;
      try { motor = fs.readFileSync(script, 'utf8').includes('"op": "transcribir"'); } catch (err) { error = error || String(err?.message ?? err).slice(0, 200); }
      let motorHabla = false;
      try { motorHabla = fs.readFileSync(scriptHabla, 'utf8').includes('"op": "decir"'); } catch (err) { error = error || String(err?.message ?? err).slice(0, 200); }
      return { libreria, motor, motorHabla, cifrado, vector, saludo, llaveMala, empaquetada: electron.app.isPackaged, error };
    });
  }

  electron.app.on('before-quit', () => { eco.parar(); escucha.apagar(); habla.apagar(); });
  // Al abrir la app, si la escucha quedó prendida, se conecta sola. Recién
  // cuando la app está lista: antes de eso safeStorage no descifra, la llave
  // saldría vacía y el Echo contestaría que le falta.
  electron.app.whenReady().then(() => eco.arrancar());
  // Cambió la llave de ElevenLabs: lo que se sabía de la cuenta ya no vale.
  const alCambiarLlave = () => { once.apagar(); cat11 = { estado: 'off', voces: [], modelos: [], error: '' }; traerCatalogo11({ forzar: true }); };
  // Para el puente a Telegram: pasar a texto un audio (PCM de 16 kHz) con el
  // mismo Whisper del Echo, y grabar una respuesta con la voz elegida.
  const oir = (pcm) => { const c = config(); return escucha.transcribir(pcm, { idioma: c.idioma === 'auto' ? '' : c.idioma, prompt: pista() }); };
  const grabar = (texto) => new Promise((resolve, reject) => {
    let turno = null;
    try { turno = motor().decir(texto); } catch (err) { reject(err); return; }
    if (!turno) { reject(new Error(habla.estado().error || (config().habla.motor === 'elevenlabs' ? 'pick a voice in Settings › Voice' : 'set up the voice in Settings › Voice'))); return; }
    // (un turno que tarda demasiado se da por perdido)
    const plazo = setTimeout(() => { if (grabando.delete(turno)) reject(new Error('the voice took too long')); }, 180000);
    grabando.set(turno, { partes: [], sr: 24000, resolve: (x) => { clearTimeout(plazo); resolve(x); }, reject: (err) => { clearTimeout(plazo); reject(err); } });
  });
  return { eco, escucha, habla, vista, alCambiarLlave, hablaActiva: () => config().habla.activa, oir, grabar };
}

module.exports = { wire, esLlave, DOC, VOICE_NOTE };
