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
import * as habla from './habla.js';
import { montarMicro } from './micro.js';
import { montarSenales } from './senales.js';

const cola = [];        // frases que esperan su turno (el chat de voz estaba contestando)
let mandando = false;
let shell = null;
// La conversación por el micrófono de la PC: el chat cuya respuesta se espera
// para volver a abrir el micrófono (main/micro.cjs). null si no hay ninguna.
let enConversacion = null;
const listoParaEscuchar = () => window.rad.invoke('voz:micro-listo').catch(() => {});

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
  if (f.conversacion) enConversacion = c.id;
  try {
    mando = await datos.enviar(c.id, f.texto, null, { voz: true, modo: f.actua ? 'auto' : 'manual' });
  } finally { mandando = false; }
  // (no salió: no hay respuesta que esperar, el micrófono vuelve a escuchar)
  if (!mando && f.conversacion) { enConversacion = null; listoParaEscuchar(); }
  if (mando && datos.chatActual()?.id !== c.id) {
    toast({ text: `${a.nombre} heard: “${f.texto.length > 90 ? `${f.texto.slice(0, 90)}…` : f.texto}”`, duration: 9000, action: { label: 'Open', onClick: () => abrirChat(c.id) } });
  }
  if (cola.length) atender();
}

/** Lo que dice la barra de abajo mientras el Echo trabaja; null si no hay nada que decir. */
export function estadoDeVoz() {
  const v = datos.voz();
  // (con el micrófono de la PC lo dice la isla, arriba: senales.js. La barra
  // sigue con lo de siempre, como en la maqueta que eligió Fran)
  if (v.activa && v.fuente === 'micro') return null;
  if (!v.activa || v.eco?.conexion !== 'connected') return null;
  if (v.eco.fase === 'listening') return 'Listening…';
  if (v.eco.fase === 'transcribing') return 'Transcribing…';
  return null;
}
/** …y mientras el agente habla (se puede estar hablando sin el Echo: la prueba de Settings). */
export const estadoDeHabla = () => (habla.hablando() ? 'Speaking…' : null);

export function montarVoz({ shell: s, alHablar = () => {} }) {
  shell = s;
  habla.montarHabla();
  habla.alCambiar(alHablar);
  // (con «A microphone on this PC» elegido, el micrófono queda abierto)
  montarMicro();
  // …y lo que avisa cuándo escucha y cuándo se cerró: el sonido y la isla
  montarSenales();
  window.rad.on('voz:frase', (f) => {
    if (!f || typeof f.texto !== 'string' || !f.texto.trim()) return;
    cola.push({ texto: f.texto.trim(), agente: String(f.agente ?? ''), actua: f.actua === true, conversacion: f.conversacion === true });
    atender();
  });
  window.rad.on('voz:abrir', (ev) => abrirChat(String(ev?.chat ?? '')));
  // Terminó un turno: si era de voz se avisa, y si había una frase esperando, sale.
  datos.on('turno', (t) => {
    if (t.voz) {
      const a = datos.agente(datos.chat(t.chat)?.agente);
      const cuerpo = t.estado === 'error' ? `It failed: ${t.nota || 'there was no answer.'}` : t.estado === 'frenado' ? 'Stopped.' : (t.texto || 'Done.');
      aviso(a?.nombre ?? 'BlackCode', cuerpo, t.chat);
      // …y, si está prendido, la respuesta se dice en voz alta (un turno frenado o roto, no)
      const decirla = datos.voz().habla?.activa && t.estado === 'ok' && t.texto.trim();
      const dicha = decirla ? window.rad.invoke('voz:decir', { texto: t.texto }).catch(() => null) : Promise.resolve(null);
      // En una conversación por el micrófono de la PC, el micrófono vuelve a
      // abrirse cuando la respuesta terminó de SONAR (si se dijo) o de llegar.
      if (enConversacion === t.chat) {
        enConversacion = null;
        dicha.then((r) => (r?.ok && r.turno ? habla.cuandoTermine(r.turno) : null)).then(listoParaEscuchar);
      }
    }
    atender();
  });
  // Un turno de voz quedó esperando permiso: hay que ir a la pantalla.
  datos.on('confirmar', ({ chat }) => {
    const pide = datos.confirmacion(chat);
    if (!pide || !datos.turnoDeVoz(chat)) return;
    const a = datos.agente(datos.chat(chat)?.agente);
    aviso(`${a?.nombre ?? 'BlackCode'} needs your permission`, pide.label || String(pide.name ?? ''), chat);
    // (quien habló no está mirando la pantalla: se lo dice)
    if (datos.voz().habla?.activa) window.rad.invoke('voz:decir', { permiso: true }).catch(() => {});
  });
}
