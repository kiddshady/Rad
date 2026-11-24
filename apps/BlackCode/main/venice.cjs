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
  if (status === 401) return 'The Venice key is invalid, or that model requires a Pro account. Check it in Settings.';
  if (status === 402) return 'The Venice account has no balance left.';
  if (status === 403) return 'This Venice key cannot be used from this network.';
  if (status === 429) return 'Too many requests in a row to Venice. Wait a moment and try again.';
  if (status === 503) return 'That Venice model is overloaded. Try again in a while, or use another one.';
  if (status === 400 || status === 404 || status === 415) return `Venice rejected the request: ${detalle || status}`;
  return `Venice answered with an error (${status}). Try again in a while.`;
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
      const partes = [spec.privacy === 'private' ? 'private, no retention' : 'anonymized'];
      if (spec.availableContextTokens) partes.push(`${contexto(spec.availableContextTokens)} context`);
      return { id: m.id, nombre: spec.name || m.id, nota: partes.join(' · '), tools: spec.capabilities?.supportsFunctionCalling === true, vision: spec.capabilities?.supportsVision === true, rasgos: spec.traits ?? [] };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'en', { numeric: true }));
  // El que se ofrece primero: el que Venice marca como predeterminado, o el
  // más capaz, o el primero de la lista.
  const marcado = (rasgo) => lista.find((m) => m.rasgos.includes(rasgo));
  const inicial = (marcado('default') ?? marcado('most_intelligent') ?? lista[0])?.id ?? '';
  return { lista: lista.map(({ rasgos, ...m }) => m), inicial };
}

// Lee el stream de UNA ronda (eventos SSE con el formato de OpenAI) y devuelve
// lo que trajo: el texto, lo que pensó, las llamadas a tools y cómo terminó.
// Los eventos llegan partidos en cualquier lado: se junta hasta el salto de
// línea y se lee renglón por renglón.
async function leerRonda(res, ronda, { signal, onTexto, onPensando }) {
  const r = { content: '', reasoning: '', reasoningDetails: [], calls: [], motivo: 'fin', uso: null };
  let pensando = false;
  // Las llamadas se arman de a pedazos. La documentación de Venice avisa que
  // dos llamadas en paralelo pueden compartir el `index` y que lo único que
  // las distingue es el `id`: un id nuevo en un índice ya usado abre otra.
  const porIndice = new Map();
  const alLlegar = (dato) => {
    if (dato.error) throw new Error(`Venice cut the answer short: ${typeof dato.error === 'string' ? dato.error : dato.error.message ?? 'no details'}`);
    if (dato.usage) r.uso = { entrada: dato.usage.prompt_tokens ?? 0, salida: dato.usage.completion_tokens ?? 0 };
    const opcion = dato.choices?.[0];
    if (!opcion) return;
    const delta = opcion.delta ?? {};
    if (delta.reasoning_content) {
      r.reasoning += delta.reasoning_content;
      if (!pensando) { pensando = true; onPensando(); }
    }
    if (Array.isArray(delta.reasoning_details)) r.reasoningDetails.push(...delta.reasoning_details);
    if (delta.content) { pensando = false; r.content += delta.content; onTexto(delta.content); }
    for (const tc of delta.tool_calls || []) {
      const i = tc.index ?? 0;
      let call = porIndice.get(i);
      if (!call || (tc.id && call.idReal && tc.id !== call.id)) {
        // el id de reserva lleva la ronda adentro: numerado solo por índice, la
        // ronda siguiente repetiría `call_0` y el historial quedaría con dos
        // tool_call_id iguales
        call = { id: tc.id || `call_r${ronda}_${r.calls.length}`, idReal: Boolean(tc.id), type: 'function', function: { name: '', arguments: '' } };
        porIndice.set(i, call);
        r.calls.push(call);
      } else if (tc.id && !call.idReal) { call.id = tc.id; call.idReal = true; }
      if (tc.function?.name) call.function.name += tc.function.name;
      if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
    }
    if (opcion.finish_reason === 'length') r.motivo = 'largo';
    else if (opcion.finish_reason === 'content_filter') r.motivo = 'rechazo';
  };

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
    if (signal.aborted) return { ...r, motivo: 'frenado' };
    if (err.message.startsWith('Venice ')) throw err;
    throw new Error('The connection to Venice dropped in the middle of the answer.');
  }
  if (signal.aborted) return { ...r, motivo: 'frenado' };
  for (const c of r.calls) delete c.idReal;
  return r;
}

/**
 * Pide la respuesta. Sin tools es un solo pedido. Con tools (opts.sesion, ver
 * tools/sesion.cjs) es un loop con el formato de OpenAI: el modelo pide
 * `tool_calls`, se corren, cada resultado vuelve como un mensaje `role: tool`,
 * y sigue hasta que contesta sin pedir ninguna o se acaba el presupuesto.
 *
 * Lo que viene de NeonCode (chatOpenAI):
 *   - el registro del turno va como un mensaje `user` AL FINAL de cada pedido
 *     y es efímero: nunca entra a la conversación;
 *   - la última ronda sale sin tools, con su aviso;
 *   - unos argumentos que no son JSON vuelven al proveedor como `{}` (si no,
 *     rechaza el pedido entero) pero la tool no corre: el modelo se entera por
 *     el resultado;
 *   - una llamada que el modelo escribió como texto (un bloque ```tool) se
 *     rescata y se corre, en vez de quedar como una respuesta que no hizo nada.
 *
 * Y de la documentación de Venice: el mensaje del modelo se devuelve con lo
 * que pensó (`reasoning_content`, `reasoning_details`) tal cual llegó.
 */
async function responder({ modelo, instrucciones, mensajes }, { key, signal, onTexto, onPensando, sesion = null }) {
  const conTools = Boolean(sesion?.activa);
  // Un mensaje del usuario con imágenes adjuntas va en partes: el texto y,
  // después, cada imagen (el formato de OpenAI).
  const convo = mensajes.map((m) => (m.rol === 'user' && m.imagenes?.length
    ? { role: 'user', content: [{ type: 'text', text: String(m.texto ?? '').trim() ? m.texto : 'Look at this image.' }, ...m.imagenes.map((u) => ({ type: 'image_url', image_url: { url: u } }))] }
    : { role: m.rol, content: m.texto }));
  const system = conTools ? sesion.sistema(instrucciones) : instrucciones;
  if (system) convo.unshift({ role: 'system', content: system });

  const uso = { entrada: 0, salida: 0 };
  for (let ronda = 0; ; ronda++) {
    const final = conTools && sesion.esFinal();
    const cola = conTools ? sesion.cola({ final }) : null;
    if (final) sesion.marcarAgotado();
    const body = {
      model: modelo,
      messages: cola ? [...convo, { role: 'user', content: cola }] : convo,
      stream: true,
      stream_options: { include_usage: true },
      venice_parameters: { include_venice_system_prompt: false, strip_thinking_response: true },
    };
    if (conTools && !final) body.tools = sesion.paraOpenAI();

    let res;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return { motivo: 'frenado', uso };
      throw new Error('Could not connect to Venice. Is there an internet connection?');
    }
    if (!res.ok) throw new Error(explicar(res.status, await detalleDe(res)));

    const r = await leerRonda(res, ronda, { signal, onTexto, onPensando });
    if (r.uso) { uso.entrada += r.uso.entrada; uso.salida += r.uso.salida; }
    if (r.motivo === 'frenado') return { motivo: 'frenado', modelo, uso };
    if (!conTools || final) return { motivo: r.motivo, modelo, uso };

    let calls = r.calls.filter((c) => c.function.name);
    let rescatada = false;
    if (!calls.length) {
      const rescate = sesion.rescatar(r.content);
      if (rescate?.length) { calls = rescate; rescatada = true; }
    }
    if (!calls.length || r.motivo !== 'fin') return { motivo: r.motivo, modelo, uso };

    // El proveedor VALIDA los tool_calls que se le devuelven: unos argumentos
    // que no son JSON hacen rebotar el pedido entero. Salen normalizados; la
    // tool se corre (o no) con los ORIGINALES.
    convo.push({
      role: 'assistant',
      content: r.content || null,
      tool_calls: calls.map((c) => {
        let args = c.function.arguments || '{}';
        try { JSON.parse(args); } catch { args = '{}'; }
        return { id: c.id, type: 'function', function: { name: c.function.name, arguments: args } };
      }),
      ...(r.reasoning ? { reasoning_content: r.reasoning } : {}),
      ...(r.reasoningDetails.length ? { reasoning_details: r.reasoningDetails } : {}),
    });
    const fotos = []; // las imágenes que las tools de esta ronda le muestran al modelo, en orden
    for (const c of calls) {
      let args = null;
      let crudo = null;
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { crudo = c.function.arguments; }
      const out = await sesion.correr(c.function.name, args, { crudo });
      convo.push({ role: 'tool', tool_call_id: c.id, content: out.out });
      fotos.push(...(out.imagenes ?? []));
    }
    // En este formato un mensaje `tool` no puede llevar imágenes, así que las
    // capturas viajan en un `user` DESPUÉS de todos los resultados (antes
    // rompería el pareo tool_call → tool). Dos `user` seguidos son legales acá.
    // (De NeonCode, con su mismo texto.)
    if (fotos.length) {
      convo.push({
        role: 'user',
        content: [
          { type: 'text', text: `[The app attaches the ${fotos.length === 1 ? 'screenshot' : `${fotos.length} screenshots`} taken by screen_capture above, in call order. This message is not from the user.]` },
          ...fotos.map((u) => ({ type: 'image_url', image_url: { url: u } })),
        ],
      });
    }
    sesion.cerrarRonda(calls.map((c) => c.function.name));
    if (rescatada) sesion.run.rescatadas = (sesion.run.rescatadas || 0) + calls.length;
    if (signal.aborted) return { motivo: 'frenado', modelo, uso };
  }
}

module.exports = { responder, modelos };
