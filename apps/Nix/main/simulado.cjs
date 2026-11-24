'use strict';

// Un proveedor de mentira, para el humo y las capturas: contesta en streaming
// sin tocar la red ni gastar un token. Se elige con NIX_PROVEEDOR=simulado.
//
// La respuesta trae de todo lo que el chat tiene que saber pintar (títulos,
// negrita, lista, código, tabla) y repite lo que le llegó (proveedor, modelo,
// cuántas instrucciones, cuántos mensajes, el último del usuario): así el humo
// comprueba que el pedido viajó entero, no solo que algo contestó.

const TROZO = 9;      // caracteres por entrega
const PAUSA_MS = 22;  // entre entrega y entrega
const PENSAR_MS = 180;

// Los modelos de Venice de mentira: con el simulado no se le pide la lista a
// nadie. Los ids son de los que Venice tenía en noviembre de 2026.
const VENICE = {
  lista: [
    // Uno de nombre largo: es el que se salía del select y tapaba el chevron.
    { id: 'deepseek-v4-1-flash-1017-uncensored', nombre: 'DeepSeek V4.1 Flash 1017 Uncensored', nota: 'private, no retention · 1M context' },
    { id: 'zai-org-glm-5-2', nombre: 'GLM 5.2', nota: 'private, no retention · 1M context' },
    { id: 'grok-4-7', nombre: 'Grok 4.7', nota: 'private, no retention · 500k context' },
    { id: 'kimi-k3', nombre: 'Kimi K3', nota: 'private, no retention · 1M context' },
    // uno que no acepta tools, como varios de los de verdad
    { id: 'venice-uncensored-1-2', nombre: 'Venice Uncensored 1.2', nota: 'private, no retention · 128k context', tools: false },
  ],
  inicial: 'grok-4-7',
};

// Con qué captura screen_capture en el humo: una pantalla de mentira (un
// degradé de 1920×1080), para no fotografiar el escritorio de nadie. Tiene la
// forma del desktopCapturer y el screen de Electron.
function pantallaDeMentira() {
  const ANCHO = 1920;
  const ALTO = 1080;
  const imagen = () => {
    const { nativeImage } = require('electron');
    const px = Buffer.alloc(ANCHO * ALTO * 4);
    for (let y = 0; y < ALTO; y++) {
      for (let x = 0; x < ANCHO; x++) {
        const i = (y * ANCHO + x) * 4;
        px[i] = Math.round((x / ANCHO) * 255);     // B
        px[i + 1] = Math.round((y / ALTO) * 255);  // G
        px[i + 2] = 40;                            // R
        px[i + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(px, { width: ANCHO, height: ALTO });
  };
  const monitor = { id: 1, size: { width: ANCHO, height: ALTO }, scaleFactor: 1 };
  return {
    pantallas: { getPrimaryDisplay: () => monitor, getAllDisplays: () => [monitor] },
    capturador: {
      getSources: async ({ types = [] } = {}) => (types.includes('screen')
        ? [{ id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: imagen() }]
        : []),
    },
  };
}

function respuesta({ proveedor, modelo, instrucciones, mensajes }) {
  const ultimo = mensajes.at(-1)?.texto ?? '';
  return [
    `## Simulated answer`,
    ``,
    `I got your message: “${ultimo}”. This did **not** come from a model: it is Nix’s test provider, which writes little by little so the text can be seen arriving.`,
    ``,
    `- model: \`${modelo}\``,
    `- instructions: ${instrucciones ? instrucciones.length : 0} characters`,
    `- messages in the request: ${mensajes.length}`,
    `- provider: ${proveedor}`,
    ``,
    `A code block, to see the mono font:`,
    ``,
    '```js',
    `const greet = (name) => \`hello, \${name}\`;`,
    `console.log(greet('Nix'));`,
    '```',
    ``,
    `| piece | status |`,
    `| --- | --- |`,
    `| streaming | *works* |`,
    `| tools | none |`,
    ``,
    `And a long ending, so there is plenty of text left when someone wants to stop halfway: the agent keeps writing one sentence after another, in no hurry, until the script runs out or until it is told to stop.`,
  ].join('\n');
}

const dormir = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Con tools, el proveedor de mentira hace lo que el mensaje le diga en un
// renglón «TOOLS: [{ "name": …, "args": { … } }, …]»: pide esas llamadas (una
// ronda por cada grupo separado por «;;») a través de la sesión de verdad, o
// sea por el mismo despachador, la misma tarjeta y los mismos chips que un
// modelo real. Después cuenta lo que pasó. Sin ese renglón, conversa.
function guion(pedido) {
  const ultimo = pedido.mensajes.at(-1)?.texto ?? '';
  const m = ultimo.match(/^TOOLS:\s*(.+)$/m);
  if (!m) return null;
  try { return m[1].split(';;').map((r) => JSON.parse(r)); } catch { return null; }
}

async function conTools(pedido, { signal, onTexto, onPensando, sesion }) {
  const rondas = guion(pedido);
  const escribir = async (texto) => {
    for (let i = 0; i < texto.length && !signal.aborted; i += TROZO) { onTexto(texto.slice(i, i + TROZO)); await dormir(PAUSA_MS, signal); }
  };
  onPensando();
  await dormir(PENSAR_MS, signal);
  if (!rondas) {
    await escribir(`Simulated answer with tools on: ${sesion.nombres.join(', ')}. Nothing was called.`);
    return signal.aborted ? { motivo: 'frenado' } : { motivo: 'fin', modelo: pedido.modelo };
  }
  const lineas = [];
  let ultimoJob = '';
  for (const [n, llamadas] of rondas.entries()) {
    if (signal.aborted || sesion.esFinal()) break;
    await escribir(`Round ${n + 1}: running ${llamadas.length} call${llamadas.length === 1 ? '' : 's'}.`);
    for (const c of llamadas) {
      // «$JOB» en un argumento es el id del último job que arrancó: un modelo
      // de verdad lo leería del resultado de job_start
      const args = JSON.parse(JSON.stringify(c.args ?? {}).replaceAll('$JOB', ultimoJob));
      const r = await sesion.correr(c.name, args, c.raw ? { crudo: c.raw } : {});
      if (c.name === 'job_start') ultimoJob = r.out.match(/\bj\d+-[a-z0-9]+\b/)?.[0] ?? ultimoJob;
      lineas.push(`- \`${c.name}\`: ${r.error ? 'failed' : 'ok'} — ${r.out.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    sesion.cerrarRonda(llamadas.map((c) => c.name));
  }
  if (signal.aborted) return { motivo: 'frenado' };
  // lo que la app le habría puesto al modelo al final del pedido siguiente
  const cola = sesion.cola({ final: sesion.esFinal() }) ?? '';
  await escribir(['## Tool run', '', ...lineas, '', `record seen: ${/ACTUALLY executed/.test(cola) ? 'yes' : 'no'} · protocol: ${/HOW TOOLS ACTUALLY WORK/.test(sesion.sistema(pedido.instrucciones)) ? 'yes' : 'no'}`].join('\n'));
  return signal.aborted ? { motivo: 'frenado' } : { motivo: 'fin', modelo: pedido.modelo };
}

async function responder(pedido, { signal, onTexto, onPensando, sesion = null }) {
  if (sesion?.activa) return conTools(pedido, { signal, onTexto, onPensando, sesion });
  onPensando();
  await dormir(PENSAR_MS, signal);
  const texto = respuesta(pedido);
  let salida = 0;
  for (let i = 0; i < texto.length && !signal.aborted; i += TROZO) {
    const trozo = texto.slice(i, i + TROZO);
    onTexto(trozo);
    salida += trozo.length;
    await dormir(PAUSA_MS, signal);
  }
  if (signal.aborted) return { motivo: 'frenado' };
  return { motivo: 'fin', modelo: pedido.modelo, uso: { entrada: 0, salida } };
}

// La comprobación de una llave, de mentira: tarda un rato (para que se vea
// «comprobando») y contesta según lo que diga el texto de la llave, así el
// humo recorre cada resultado sin tocar la red. Cualquier otra, la acepta.
const COMPROBAR_MS = 420;
async function comprobarLlave(key) {
  await new Promise((r) => setTimeout(r, COMPROBAR_MS));
  if (key.includes('sin-workspace')) {
    return { fase: 'rechazada', motivo: 'sin-workspace', detalle: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.' };
  }
  if (key.includes('vencida')) return { fase: 'rechazada', motivo: 'invalida', detalle: 'invalid x-api-key' };
  if (key.includes('sin-conexion')) return { fase: 'sin-comprobar', motivo: 'conexion' };
  return { fase: 'aceptada' };
}

module.exports = { responder, comprobarLlave, VENICE, pantallaDeMentira };
