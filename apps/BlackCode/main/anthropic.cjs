'use strict';

// El proveedor de verdad: la API de Anthropic, en streaming.
//
// Lo que hay que saber de estos modelos (está en la skill claude-api, no es
// de memoria):
//   - el pensamiento está siempre prendido y no lleva presupuesto: lo único
//     que se regula es el esfuerzo (output_config.effort). El de Opus 5.5 y
//     Haiku 5.5 viene en medium y el de los demás en high, así que se manda
//     siempre explícito;
//   - no se mandan temperature / top_p / top_k (400);
//   - un pedido puede terminar en stop_reason "refusal" (HTTP 200): se mira
//     antes de dar el texto por bueno. Con `fallbacks: "default"` la API
//     reintenta sola con otro modelo cuando el que se pidió declina; Haiku
//     5.5 no lo tiene.
//
// El historial viaja como texto pelado. Los bloques de pensamiento de los
// turnos anteriores no se guardan ni se reenvían, y eso es válido: quitarlos
// TODOS no rompe nada (lo que la API rechaza es reenviar un bloque después de
// tocar lo que tenía atrás, por ejemplo las instrucciones del agente). Sin
// herramientas, lo que se pierde es poco.

const Anthropic = require('@anthropic-ai/sdk');

// Los modelos vigentes (noviembre de 2026). `respaldo`: si acepta fallbacks.
const MODELOS = [
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', nota: 'the most capable of the Opus line', esfuerzo: 'medium', respaldo: true },
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', nota: 'fast and cheaper', esfuerzo: 'medium', respaldo: true },
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', nota: 'the fastest and the cheapest', esfuerzo: 'medium', respaldo: false },
  { id: 'claude-fable-5-2', nombre: 'Claude Fable 5.2', nota: 'the most capable, and the most expensive', esfuerzo: 'high', respaldo: true },
];
const MODELO_INICIAL = 'claude-opus-5-5';

// En streaming no hay apuro por el timeout HTTP: se le da lugar al modelo.
const MAX_TOKENS = 64000;

/** Un error de la API en una frase para Fran. Por clase, nunca por el texto. */
function explicar(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'The key is invalid or was revoked. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This key does not have permission to use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'That model does not exist for this key.';
  if (err instanceof Anthropic.RateLimitError) return 'Too many requests in a row. Wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not connect to Anthropic. Is there an internet connection?';
  if (err instanceof Anthropic.APIError) return `Anthropic answered with an error (${err.status ?? 'no code'}). Try again in a while.`;
  return `Something failed while requesting the answer: ${err?.message ?? err}`;
}

// Cuánto se espera la respuesta al comprobar una llave.
const COMPROBAR_MS = 10000;

/**
 * Le pregunta a la API si acepta la llave, con un pedido que no gasta nada
 * (listar un modelo). El prefijo de una llave no dice si sirve: la Console
 * crea llaves personales que andan o no según se las haya atado a un
 * workspace al crearlas, y eso solo lo sabe la API.
 *
 * Devuelve { fase, motivo?, detalle? }:
 *   'aceptada'
 *   'rechazada'      motivo 'invalida' (401: no existe, se deshabilitó o
 *                    venció), 'sin-workspace' (400: no está atada a un
 *                    workspace y el pedido no dice cuál usar) o 'sin-permiso'
 *                    (403). `detalle` es lo que dijo la API.
 *   'sin-comprobar'  no se pudo saber (sin conexión, o la API anda mal):
 *                    NO es un rechazo.
 * Decide por la clase del error, nunca por su texto.
 */
async function comprobar(key) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: COMPROBAR_MS });
  try {
    await client.models.list({ limit: 1 });
    return { fase: 'aceptada' };
  } catch (err) {
    const detalle = err?.error?.error?.message ?? '';
    if (err instanceof Anthropic.AuthenticationError) return { fase: 'rechazada', motivo: 'invalida', detalle };
    // Un pedido tan simple no puede estar mal armado: un 400 acá es la llave.
    if (err instanceof Anthropic.BadRequestError) return { fase: 'rechazada', motivo: 'sin-workspace', detalle };
    if (err instanceof Anthropic.PermissionDeniedError) return { fase: 'rechazada', motivo: 'sin-permiso', detalle };
    if (err instanceof Anthropic.APIConnectionError) return { fase: 'sin-comprobar', motivo: 'conexion' };
    return { fase: 'sin-comprobar', motivo: 'servicio', detalle };
  }
}

// Dos mensajes `user` seguidos no entran en Anthropic (la alternancia es
// estricta): se funden en uno. Pasa con el registro de tools de un turno
// anterior, que viaja como un mensaje de la app justo después del del usuario.
function fusionarUsersSeguidos(mensajes) {
  const out = [];
  for (const m of mensajes) {
    const prev = out[out.length - 1];
    if (prev && prev.role === 'user' && m.role === 'user') prev.content = `${prev.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

// Agrega un bloque de texto al final del último mensaje `user` (el que lleva
// los tool_result). Anthropic no acepta otro `user` detrás, así que el bloque
// de la app va adentro de ese.
function agregarAlUltimoUser(convo, texto) {
  const last = convo[convo.length - 1];
  if (!last || last.role !== 'user') { convo.push({ role: 'user', content: texto }); return; }
  const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content ?? '') }];
  last.content = [...blocks, { type: 'text', text: texto }];
}

/**
 * Pide la respuesta. Sin tools es un solo pedido, como siempre. Con tools
 * (opts.sesion, ver tools/sesion.cjs) es un loop: el modelo pide llamadas, se
 * corren, se le devuelven los resultados y sigue, hasta que contesta sin pedir
 * ninguna o se acaba el presupuesto de rondas.
 *
 * Lo del loop que viene de la documentación de la API (skill claude-api, no de
 * memoria):
 *   - el contenido de cada respuesta se devuelve ENTERO y sin tocar en el
 *     pedido siguiente (también los bloques de pensamiento: van atados a esta
 *     conversación);
 *   - todos los tool_result de una ronda van en UN mensaje `user`;
 *   - con un `refusal` no se corre nada de esa ronda, y con `max_tokens` y una
 *     llamada a medio escribir tampoco: los argumentos llegaron cortados;
 *   - los argumentos llegan mientras se generan (eager_input_streaming) y la
 *     API no los valida: los valida la sesión antes de correr la tool.
 *
 * Y lo que viene de NeonCode: el registro del turno se agrega al último
 * mensaje `user` y QUEDA en la conversación del turno (cada ronda declara solo
 * los pasos nuevos). No es efímero como en el loop de Venice: acá cambiar lo
 * ya enviado invalida el pensamiento que el modelo dejó atrás.
 */
async function responder({ modelo, instrucciones, mensajes }, { key, signal, onTexto, onPensando, sesion = null }) {
  const info = MODELOS.find((m) => m.id === modelo);
  const client = new Anthropic({ apiKey: key });
  const conTools = Boolean(sesion?.activa);
  const convo = fusionarUsersSeguidos(mensajes.map((m) => ({ role: m.rol, content: m.texto })));
  const base = {
    model: modelo,
    max_tokens: MAX_TOKENS,
    output_config: { effort: info?.esfuerzo ?? 'medium' },
    // Cada turno reenvía el chat entero: con esto lo ya enviado se cobra a
    // un décimo cuando el turno siguiente llega dentro de los cinco minutos.
    cache_control: { type: 'ephemeral' },
  };
  const system = conTools ? sesion.sistema(instrucciones) : instrucciones;
  if (system) base.system = system;
  if (conTools) base.tools = sesion.paraAnthropic();

  const uso = { entrada: 0, salida: 0 };
  let declarados = 0; // pasos que ya figuran en un registro que quedó en la conversación
  let reintentos = 0;

  for (;;) {
    const final = conTools && sesion.esFinal();
    const params = { ...base, messages: convo };
    if (conTools) {
      const cola = sesion.cola({ final, desde: declarados });
      if (cola) {
        agregarAlUltimoUser(convo, cola);
        declarados = sesion.run.steps.length;
      }
      if (final) {
        // La última ronda: las tools siguen declaradas (sacarlas cambiaría lo ya
        // enviado) pero no se pueden pedir.
        params.tool_choice = { type: 'none' };
        sesion.marcarAgotado();
      }
    }

    const stream = info?.respaldo === false
      ? client.messages.stream(params, { signal })
      : client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal });

    let message;
    let salio = false; // ¿esta ronda ya mostró algo?
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') onPensando();
        else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { salio = true; onTexto(event.delta.text); }
      }
      message = await stream.finalMessage();
      reintentos = 0;
    } catch (err) {
      if (signal.aborted) return { motivo: 'frenado', uso };
      // Unos argumentos que no se pudieron leer ni a medias, o la conexión que
      // se cortó: la ronda se pide de nuevo, pero solo si todavía no mostró
      // nada (si no, el texto saldría dos veces). Un error de la API no se
      // reintenta acá: se explica.
      if (!conTools || err instanceof Anthropic.APIError || salio || reintentos++ >= 2) throw new Error(explicar(err));
      continue;
    }
    uso.entrada += message.usage?.input_tokens ?? 0;
    uso.salida += message.usage?.output_tokens ?? 0;
    const fin = (motivo) => ({ motivo, modelo: message.model, uso });

    if (message.stop_reason === 'refusal') return fin('rechazo');
    if (!conTools) return fin(message.stop_reason === 'max_tokens' ? 'largo' : 'fin');

    // Una tool del servidor que llegó a su tope de vueltas: se devuelve lo que
    // hay y se sigue.
    if (message.stop_reason === 'pause_turn') {
      convo.push({ role: 'assistant', content: message.content });
      continue;
    }
    const usos = message.content.filter((b) => b.type === 'tool_use');
    if (!usos.length || final) return fin(message.stop_reason === 'max_tokens' ? 'largo' : 'fin');
    // Cortado por largo con una llamada a medio escribir: sus argumentos son
    // un pedazo. No se corre nada.
    if (message.stop_reason === 'max_tokens') return fin('largo');

    convo.push({ role: 'assistant', content: message.content });
    const resultados = [];
    for (const u of usos) {
      // en serie: runTool anota como canceladas las que queden detrás de un Stop
      const r = await sesion.correr(u.name, u.input);
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: conImagenes(r), ...(r.error ? { is_error: true } : {}) });
    }
    convo.push({ role: 'user', content: resultados });
    sesion.cerrarRonda(usos.map((u) => u.name));
    if (signal.aborted) return { motivo: 'frenado', modelo: message.model, uso };
  }
}

// El contenido de un tool_result: el texto, o el texto y las imágenes que la
// tool le muestra al modelo (una captura de pantalla), como bloques.
function conImagenes(r) {
  const bloques = (r.imagenes ?? []).map(bloqueDeImagen).filter(Boolean);
  return bloques.length ? [{ type: 'text', text: r.out }, ...bloques] : r.out;
}
function bloqueDeImagen(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s.exec(String(dataUrl));
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

module.exports = { responder, comprobar, MODELOS, MODELO_INICIAL };
