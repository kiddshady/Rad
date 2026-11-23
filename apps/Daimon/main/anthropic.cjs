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
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', nota: 'el más capaz de la línea Opus', esfuerzo: 'medium', respaldo: true },
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', nota: 'rápido y más barato', esfuerzo: 'medium', respaldo: true },
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', nota: 'el más rápido y el más barato', esfuerzo: 'medium', respaldo: false },
  { id: 'claude-fable-5-2', nombre: 'Claude Fable 5.2', nota: 'el más capaz, y el más caro', esfuerzo: 'high', respaldo: true },
];
const MODELO_INICIAL = 'claude-opus-5-5';

// En streaming no hay apuro por el timeout HTTP: se le da lugar al modelo.
const MAX_TOKENS = 64000;

/** Un error de la API en una frase para Fran. Por clase, nunca por el texto. */
function explicar(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'La llave no es válida o fue revocada. Revisala en Ajustes.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Esta llave no tiene permiso para usar ese modelo.';
  if (err instanceof Anthropic.NotFoundError) return 'Ese modelo no existe para esta llave.';
  if (err instanceof Anthropic.RateLimitError) return 'Demasiados pedidos seguidos. Esperá un momento y probá de nuevo.';
  if (err instanceof Anthropic.BadRequestError) return `La API rechazó el pedido: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'No se pudo conectar con Anthropic. ¿Hay internet?';
  if (err instanceof Anthropic.APIError) return `Anthropic respondió con un error (${err.status ?? 'sin código'}). Probá de nuevo en un rato.`;
  return `Algo falló al pedir la respuesta: ${err?.message ?? err}`;
}

async function responder({ modelo, instrucciones, mensajes }, { key, signal, onTexto, onPensando }) {
  const info = MODELOS.find((m) => m.id === modelo);
  const client = new Anthropic({ apiKey: key });
  const params = {
    model: modelo,
    max_tokens: MAX_TOKENS,
    output_config: { effort: info?.esfuerzo ?? 'medium' },
    // Cada turno reenvía el chat entero: con esto lo ya enviado se cobra a
    // un décimo cuando el turno siguiente llega dentro de los cinco minutos.
    cache_control: { type: 'ephemeral' },
    messages: mensajes.map((m) => ({ role: m.rol, content: m.texto })),
  };
  if (instrucciones) params.system = instrucciones;

  const stream = info?.respaldo === false
    ? client.messages.stream(params, { signal })
    : client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal });

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'thinking') onPensando();
      else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onTexto(event.delta.text);
    }
    const final = await stream.finalMessage();
    const motivo = final.stop_reason === 'refusal' ? 'rechazo' : final.stop_reason === 'max_tokens' ? 'largo' : 'fin';
    return { motivo, modelo: final.model, uso: { entrada: final.usage?.input_tokens ?? 0, salida: final.usage?.output_tokens ?? 0 } };
  } catch (err) {
    if (signal.aborted) return { motivo: 'frenado' };
    throw new Error(explicar(err));
  }
}

module.exports = { responder, MODELOS, MODELO_INICIAL };
