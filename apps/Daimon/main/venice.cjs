'use strict';

// El proveedor de Venice (api.venice.ai), en streaming.
//
// Su API es compatible con la de OpenAI: POST /chat/completions con
// `stream: true` devuelve eventos SSE (`data: {…}` y al final `data: [DONE]`)
// y cada pedazo trae `choices[0].delta`. Se habla con fetch, sin SDK.
//
// Lo propio de Venice (docs.venice.ai, noviembre de 2026):
//   - `venice_parameters.include_venice_system_prompt` viene en true: Venice
//     antepone SU system prompt al del agente. Se manda en false, o las
//     instrucciones del agente dejan de ser las únicas;
//   - los modelos que razonan mandan lo que piensan en `delta.reasoning_content`,
//     aparte del texto. Acá no se muestra: solo se avisa que está pensando.
//     `strip_thinking_response` saca además las etiquetas <think> de los que
//     las escriben adentro del texto;
//   - los modelos cambian seguido: la lista se pide a GET /models (no hace
//     falta la llave) en vez de escribirla acá.
//
// VENICE_BASE_URL cambia la dirección: lo usa el test, que le apunta a un
// servidor local.

const BASE = (process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1').replace(/\/+$/, '');

const contexto = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / 1000)}k`);

/** Un error de Venice en una frase para Fran. */
function explicar(status, detalle) {
  if (status === 401) return 'La llave de Venice no es válida, o ese modelo pide una cuenta Pro. Revisala en Ajustes.';
  if (status === 402) return 'No queda saldo en la cuenta de Venice.';
  if (status === 403) return 'Esta llave de Venice no se puede usar desde esta red.';
  if (status === 429) return 'Demasiados pedidos seguidos a Venice. Esperá un momento y probá de nuevo.';
  if (status === 503) return 'Ese modelo de Venice está saturado. Probá en un rato, o con otro.';
  if (status === 400 || status === 404 || status === 415) return `Venice rechazó el pedido: ${detalle || status}`;
  return `Venice respondió con un error (${status}). Probá de nuevo en un rato.`;
}

async function detalleDe(res) {
  try {
    const cuerpo = await res.json();
    const e = cuerpo?.error;
    return typeof e === 'string' ? e : e?.message ?? '';
  } catch {
    return '';
  }
}

/** Los modelos de texto que Venice ofrece ahora, ordenados por nombre. */
async function modelos({ key, signal } = {}) {
  const res = await fetch(`${BASE}/models?type=text`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal });
  if (!res.ok) throw new Error(explicar(res.status, await detalleDe(res)));
  const data = (await res.json())?.data ?? [];
  const lista = data
    .filter((m) => m?.id && m.type === 'text' && !m.model_spec?.offline)
    .map((m) => {
      const spec = m.model_spec ?? {};
      const partes = [spec.privacy === 'private' ? 'privado, sin retención' : 'anonimizado'];
      if (spec.availableContextTokens) partes.push(`${contexto(spec.availableContextTokens)} de contexto`);
      return { id: m.id, nombre: spec.name || m.id, nota: partes.join(' · '), rasgos: spec.traits ?? [] };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  // El que se ofrece primero: el que Venice marca como predeterminado, o el
  // más capaz, o el primero de la lista.
  const marcado = (rasgo) => lista.find((m) => m.rasgos.includes(rasgo));
  const inicial = (marcado('default') ?? marcado('most_intelligent') ?? lista[0])?.id ?? '';
  return { lista: lista.map(({ rasgos, ...m }) => m), inicial };
}

async function responder({ modelo, instrucciones, mensajes }, { key, signal, onTexto, onPensando }) {
  const messages = mensajes.map((m) => ({ role: m.rol, content: m.texto }));
  if (instrucciones) messages.unshift({ role: 'system', content: instrucciones });

  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        venice_parameters: { include_venice_system_prompt: false, strip_thinking_response: true },
      }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return { motivo: 'frenado' };
    throw new Error('No se pudo conectar con Venice. ¿Hay internet?');
  }
  if (!res.ok) throw new Error(explicar(res.status, await detalleDe(res)));

  let motivo = 'fin';
  let uso = { entrada: 0, salida: 0 };
  let pensando = false;
  const alLlegar = (dato) => {
    if (dato.error) throw new Error(`Venice cortó la respuesta: ${typeof dato.error === 'string' ? dato.error : dato.error.message ?? 'sin detalle'}`);
    if (dato.usage) uso = { entrada: dato.usage.prompt_tokens ?? 0, salida: dato.usage.completion_tokens ?? 0 };
    const opcion = dato.choices?.[0];
    if (!opcion) return;
    const delta = opcion.delta ?? {};
    if (delta.reasoning_content && !pensando) { pensando = true; onPensando(); }
    if (delta.content) { pensando = false; onTexto(delta.content); }
    if (opcion.finish_reason === 'length') motivo = 'largo';
    else if (opcion.finish_reason === 'content_filter') motivo = 'rechazo';
  };

  // Los eventos llegan partidos en cualquier lado: se junta hasta el salto
  // de línea y se lee renglón por renglón.
  const decoder = new TextDecoder();
  let resto = '';
  let fin = false;
  const renglon = (linea) => {
    if (!linea.startsWith('data:')) return;
    const texto = linea.slice(5).trim();
    if (texto === '[DONE]') { fin = true; return; }
    if (!texto) return;
    let dato;
    try { dato = JSON.parse(texto); } catch { return; } // un renglón roto no tira la respuesta
    alLlegar(dato);
  };
  try {
    for await (const trozo of res.body) {
      resto += decoder.decode(trozo, { stream: true });
      const lineas = resto.split(/\r?\n/);
      resto = lineas.pop();
      for (const linea of lineas) renglon(linea);
      if (fin) break;
    }
    if (!fin && resto) renglon(resto);
  } catch (err) {
    if (signal.aborted) return { motivo: 'frenado' };
    if (err.message.startsWith('Venice ')) throw err;
    throw new Error('Se cortó la conexión con Venice a mitad de la respuesta.');
  }
  if (signal.aborted) return { motivo: 'frenado' };
  return { motivo, modelo, uso };
}

module.exports = { responder, modelos };
