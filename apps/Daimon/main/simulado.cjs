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
    { id: 'zai-org-glm-5-2', nombre: 'GLM 5.2', nota: 'privado, sin retención · 1M de contexto' },
    { id: 'grok-4-7', nombre: 'Grok 4.7', nota: 'privado, sin retención · 500k de contexto' },
    { id: 'kimi-k3', nombre: 'Kimi K3', nota: 'privado, sin retención · 1M de contexto' },
    { id: 'venice-uncensored-1-2', nombre: 'Venice Uncensored 1.2', nota: 'privado, sin retención · 128k de contexto' },
  ],
  inicial: 'grok-4-7',
};

function respuesta({ proveedor, modelo, instrucciones, mensajes }) {
  const ultimo = mensajes.at(-1)?.texto ?? '';
  return [
    `## Respuesta simulada`,
    ``,
    `Recibí tu mensaje: «${ultimo}». Esto **no** salió de un modelo: es el proveedor de prueba de Daimon, que escribe de a poco para que se vea llegar el texto.`,
    ``,
    `- modelo: \`${modelo}\``,
    `- instrucciones: ${instrucciones ? instrucciones.length : 0} caracteres`,
    `- mensajes en el pedido: ${mensajes.length}`,
    `- proveedor: ${proveedor}`,
    ``,
    `Un bloque de código, para ver la mono:`,
    ``,
    '```js',
    `const saludo = (nombre) => \`hola, \${nombre}\`;`,
    `console.log(saludo('Daimon'));`,
    '```',
    ``,
    `| pieza | estado |`,
    `| --- | --- |`,
    `| streaming | *anda* |`,
    `| herramientas | no hay |`,
    ``,
    `Y un cierre largo, para que haya texto de sobra cuando alguien quiera frenar a mitad de camino: el agente sigue escribiendo una frase tras otra, sin apuro, hasta que se le termina el guion o hasta que le dicen basta.`,
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

module.exports = { responder, VENICE };
