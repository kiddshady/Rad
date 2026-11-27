// Telegram: lo que se le escribe al bot entra a un chat, como si se tipeara.
//
// El proceso principal lee los mensajes del bot, deja pasar solo los del
// dueño y baja las fotos, los archivos y los audios (main/telegram.cjs); acá
// llega cada mensaje armado (`telegram:mensaje`) y se le manda al agente
// elegido en Settings, a su chat de Telegram (el grupo Channels). Cuando el
// turno termina, la respuesta vuelve a Telegram con lo que el turno generó.
// No cambia lo que hay en pantalla.
//
// Un turno de Telegram corre en modo manual salvo «Let Telegram act»: lo que
// pide permiso llega al celu como un mensaje con botones, y también se puede
// contestar en la PC (entonces los botones se van).

import * as datos from './datos.js';

const cola = [];              // mensajes que esperan su turno (el chat estaba contestando)
let mandando = false;
const enCurso = new Map();    // chat → { hablar } (el turno que corre vino de Telegram)
const tarjetas = new Map();   // chat → callId de la tarjeta que ya se mandó al celu

const avisar = (texto) => window.rad.invoke('telegram:avisar', { texto }).catch(() => {});
const elAgente = (id) => datos.agente(id) ?? datos.listaAgentes()[0];

async function atender() {
  if (mandando || !cola.length) return;
  const m = cola[0];
  const a = elAgente(m.agente);
  if (!a) { cola.shift(); return; }
  const c = datos.chatDeTelegram(a.id);
  // ese chat todavía contesta (lo anterior, o algo tipeado en la PC): esto sale cuando termine
  if (datos.respondiendo(c.id)) return;
  cola.shift();
  mandando = true;
  // (un audio se contesta con otro, si está prendido en Settings)
  const hablar = m.audio === true && m.conVoz !== false;
  let mando = false;
  try {
    enCurso.set(c.id, { hablar });
    mando = await datos.enviar(c.id, m.texto, { imagenes: m.imagenes ?? [], archivos: m.archivos ?? [] }, { modo: m.actua ? 'auto' : 'manual', telegram: { audio: m.audio === true, hablar } });
  } finally { mandando = false; }
  if (mando) window.rad.invoke('telegram:escribiendo', { activo: true, accion: hablar ? 'record_voice' : 'typing' }).catch(() => {});
  else { enCurso.delete(c.id); avisar('That could not be sent to the agent.'); }
  if (cola.length) atender();
}

/** Las imágenes que dejó el último turno de un chat: las de las filas de
 *  generate_image y run_code que vinieron después del último mensaje del
 *  usuario. Las capturas de pantalla o del navegador se quedan en la PC. */
async function delTurno(chatId) {
  const doc = await datos.hilo(chatId);
  const lista = doc.get().mensajes;
  let i = lista.length - 1;
  while (i >= 0 && lista[i].rol !== 'user') i--;
  const turno = lista.slice(i + 1);
  return {
    imagenes: turno
      .filter((m) => m.rol === 'tool' && (m.tool === 'generate_image' || m.tool === 'run_code') && Array.isArray(m.imagenes))
      .flatMap((m) => m.imagenes.map(({ name, archivo, dataUrl }) => (archivo ? { name, archivo } : { name, dataUrl }))),
    // Todo lo que escribió el agente en el turno, en orden: lo de antes de
    // cada tool queda como un mensaje aparte, y al celu le sirve igual.
    texto: turno.filter((m) => m.rol === 'assistant' && typeof m.texto === 'string' && m.texto.trim()).map((m) => m.texto.trim()).join('\n\n'),
  };
}

export function montarTelegram() {
  window.rad.on('telegram:mensaje', (m) => {
    if (!m || typeof m !== 'object') return;
    const texto = typeof m.texto === 'string' ? m.texto.trim() : '';
    const imagenes = Array.isArray(m.imagenes) ? m.imagenes.filter((x) => typeof x === 'string' && x.startsWith('data:image/')) : [];
    const archivos = Array.isArray(m.archivos) ? m.archivos.filter((x) => x && typeof x.content === 'string') : [];
    if (!texto && !imagenes.length && !archivos.length) return;
    cola.push({ texto, imagenes, archivos, audio: m.audio === true, agente: String(m.agente ?? ''), actua: m.actua === true, conVoz: m.conVoz !== false });
    atender();
  });
  // /new y /stop
  window.rad.on('telegram:comando', (ev) => {
    const a = elAgente(String(ev?.agente ?? ''));
    if (!a) return;
    if (ev.cmd === 'new') {
      const c = datos.chatDeTelegram(a.id);
      // (si el chat de ahora está vacío, no se abre otro vacío)
      if (c.cuenta) datos.chatDeTelegram(a.id, { nuevo: true });
      avisar(`New chat with ${a.nombre}.`);
    } else if (ev.cmd === 'stop') {
      const c = datos.chatDeTelegram(a.id);
      if (datos.respondiendo(c.id)) datos.frenar(c.id);
      else avisar('Nothing is running.');
    }
  });
  // Un botón de una tarjeta, tocado en el celu.
  window.rad.on('telegram:decision', (d) => {
    const chat = String(d?.chat ?? '');
    const pide = datos.confirmacion(chat);
    if (!pide || pide.callId !== d.callId) return;
    tarjetas.delete(chat);
    datos.confirmar(chat, d.permitir === true, d.confiar === true);
    window.rad.invoke('telegram:escribiendo', { activo: true, accion: enCurso.get(chat)?.hablar ? 'record_voice' : 'typing' }).catch(() => {});
  });
  // Un turno de Telegram quedó esperando permiso: la tarjeta va al celu. Si se
  // contestó en la PC, sus botones se van.
  datos.on('confirmar', ({ chat }) => {
    if (!enCurso.has(chat)) return;
    const pide = datos.confirmacion(chat);
    const mandada = tarjetas.get(chat);
    if (mandada && mandada !== pide?.callId) { tarjetas.delete(chat); window.rad.invoke('telegram:permiso-fin', { chat, callId: mandada, como: 'pc' }).catch(() => {}); }
    if (!pide || tarjetas.get(chat) === pide.callId) return;
    tarjetas.set(chat, pide.callId);
    const a = datos.agente(datos.chat(chat)?.agente);
    window.rad.invoke('telegram:permiso', { chat, callId: pide.callId, agente: a?.nombre ?? 'BlackCode', name: pide.name, label: pide.label, args: pide.args }).catch(() => {});
  });
  // Terminó un turno: si era de Telegram, la respuesta vuelve allá; y si había un mensaje esperando, sale.
  datos.on('turno', async (t) => {
    const suyo = enCurso.get(t.chat);
    if (suyo) {
      enCurso.delete(t.chat);
      const mandada = tarjetas.get(t.chat);
      if (mandada) { tarjetas.delete(t.chat); window.rad.invoke('telegram:permiso-fin', { chat: t.chat, callId: mandada, como: 'fin' }).catch(() => {}); }
      const lo = await delTurno(t.chat).catch(() => ({ imagenes: [], texto: '' }));
      const imagenes = t.estado === 'ok' ? lo.imagenes : [];
      // (una respuesta en audio dice solo lo último, que es la respuesta; en texto va todo el turno)
      const hablar = suyo.hablar && t.estado === 'ok' && Boolean(t.texto.trim());
      const dicho = hablar ? t.texto.trim() : lo.texto;
      const texto = t.estado === 'error' ? [lo.texto, `It failed: ${t.nota || 'there was no answer.'}`].filter(Boolean).join('\n\n')
        : t.estado === 'frenado' ? (dicho ? `${dicho}\n\n_(Stopped.)_` : 'Stopped.')
        : t.estado === 'largo' ? `${dicho}\n\n_(The answer was cut: it got too long.)_`
        : t.estado === 'rechazo' ? 'The model declined to answer.'
        : (dicho || (imagenes.length ? '' : 'Done.'));
      await window.rad.invoke('telegram:responder', { texto, imagenes, hablar }).catch(() => {});
    }
    atender();
  });
}
