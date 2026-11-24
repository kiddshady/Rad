'use strict';

// Un proveedor de mentira, para el humo y las capturas: contesta en streaming
// sin tocar la red ni gastar un token. Se elige con DAIMON_PROVEEDOR=simulado.
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
    { id: 'venice-uncensored-1-2', nombre: 'Venice Uncensored 1.2', nota: 'private, no retention · 128k context' },
  ],
  inicial: 'grok-4-7',
};

function respuesta({ proveedor, modelo, instrucciones, mensajes }) {
  const ultimo = mensajes.at(-1)?.texto ?? '';
  return [
    `## Simulated answer`,
    ``,
    `I got your message: “${ultimo}”. This did **not** come from a model: it is Daimon’s test provider, which writes little by little so the text can be seen arriving.`,
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
    `console.log(greet('Daimon'));`,
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

async function responder(pedido, { signal, onTexto, onPensando }) {
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

module.exports = { responder, comprobarLlave, VENICE };
