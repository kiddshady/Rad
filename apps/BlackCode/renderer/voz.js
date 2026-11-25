// La voz: lo que se le dice al Atom Echo entra a un chat, como si se tipeara.
//
// El proceso principal conecta con el Echo y transcribe (main/voz.cjs); acá
// llega la frase ya hecha texto (`voz:frase`) y se la manda al agente elegido
// en Settings, en su chat de voz. No cambia lo que hay en pantalla: avisa con
// un toast que lleva al chat, y con un aviso de Windows si nadie mira la
// ventana (eso lo decide el proceso principal).
//
// Un turno de voz corre en modo manual —lo que pide permiso muestra su
// tarjeta y espera— salvo que «Let voice act» esté prendido en Settings.

import * as datos from './datos.js';
import { toast } from '/@core/toast.js';

const cola = [];        // frases que esperan su turno (el chat de voz estaba contestando)
let mandando = false;
let shell = null;

function abrirChat(chatId) {
  const c = datos.chat(chatId);
  if (!c) return;
  datos.elegirAgente(c.agente);
  datos.elegirChat(c.id);
  shell?.router.go('chat');
}

const aviso = (titulo, cuerpo, chat) => window.rad.invoke('voz:aviso', { titulo, cuerpo, chat }).catch(() => {});

async function atender() {
  if (mandando || !cola.length) return;
  const f = cola[0];
  const a = datos.agenteDeVoz(f.agente);
  if (!a) { cola.shift(); return; }
  const c = datos.chatDeVoz(a.id);
  // ese chat todavía contesta la frase anterior: esta sale cuando termine
  if (datos.respondiendo(c.id)) return;
  cola.shift();
  mandando = true;
  let mando = false;
  try {
    mando = await datos.enviar(c.id, f.texto, null, { voz: true, modo: f.actua ? 'auto' : 'manual' });
  } finally { mandando = false; }
  if (mando && datos.chatActual()?.id !== c.id) {
    toast({ text: `${a.nombre} heard: “${f.texto.length > 90 ? `${f.texto.slice(0, 90)}…` : f.texto}”`, duration: 9000, action: { label: 'Open', onClick: () => abrirChat(c.id) } });
  }
  if (cola.length) atender();
}

/** Lo que dice la barra de abajo mientras el Echo trabaja; null si no hay nada que decir. */
export function estadoDeVoz() {
  const v = datos.voz();
  if (!v.activa || v.eco?.conexion !== 'connected') return null;
  if (v.eco.fase === 'listening') return 'Listening…';
  if (v.eco.fase === 'transcribing') return 'Transcribing…';
  return null;
}

export function montarVoz({ shell: s }) {
  shell = s;
  window.rad.on('voz:frase', (f) => {
    if (!f || typeof f.texto !== 'string' || !f.texto.trim()) return;
    cola.push({ texto: f.texto.trim(), agente: String(f.agente ?? ''), actua: f.actua === true });
    atender();
  });
  window.rad.on('voz:abrir', (ev) => abrirChat(String(ev?.chat ?? '')));
  // Terminó un turno: si era de voz se avisa, y si había una frase esperando, sale.
  datos.on('turno', (t) => {
    if (t.voz) {
      const a = datos.agente(datos.chat(t.chat)?.agente);
      const cuerpo = t.estado === 'error' ? `It failed: ${t.nota || 'there was no answer.'}` : t.estado === 'frenado' ? 'Stopped.' : (t.texto || 'Done.');
      aviso(a?.nombre ?? 'BlackCode', cuerpo, t.chat);
    }
    atender();
  });
  // Un turno de voz quedó esperando permiso: hay que ir a la pantalla.
  datos.on('confirmar', ({ chat }) => {
    const pide = datos.confirmacion(chat);
    if (!pide || !datos.turnoDeVoz(chat)) return;
    const a = datos.agente(datos.chat(chat)?.agente);
    aviso(`${a?.nombre ?? 'BlackCode'} needs your permission`, pide.label || String(pide.name ?? ''), chat);
  });
}
