'use strict';

// remember y recall: las dos tools de la memoria. La memoria en sí (el
// documento, sus topes, lo que entra al system) vive en main/memoria.cjs, que
// no es de las tools: también la leen los agentes sin ninguna prendida.
//
// `remember` viene de NeonCode 1.11.3. `recall` es de BlackCode: allá los
// recuerdos «parecidos» al mensaje se inyectaban solos, por similitud; acá el
// agente ve la lista entera, de una línea por recuerdo, y con `recall` lee el
// detalle de uno o busca entre todos.
//
// La memoria es del USUARIO: el agente anota y lee, pero no edita ni borra.
// Eso lo hace el usuario, en la vista Memory.
//
// Y es POR AGENTE (1.18.0): las dos tools trabajan sobre la memoria del agente
// de la corrida (`run.agente`), nunca sobre la de otro. Un subagente es una
// copia de su padre (delegar.cjs le pasa `agente`) y una tarea corre a nombre
// de su agente. Una corrida sin agente no tiene memoria: no hay una «de la app».

const { runRemember, runRecall } = require('../memoria.cjs');

const deps = { memoria: null };
function configurar(d = {}) {
  if (d.memoria !== undefined) deps.memoria = d.memoria;
}
const SIN_MEMORIA = 'error: memory is not set up in this app';
const SIN_AGENTE = 'error: memory belongs to an agent, and this run has none';

/** La memoria del agente de la corrida, o el error que corresponde. */
function suya(run) {
  if (!deps.memoria) return SIN_MEMORIA;
  const agente = typeof run?.agente === 'string' ? run.agente : '';
  return deps.memoria.de(agente) ?? SIN_AGENTE;
}

module.exports = {
  runners: {
    remember: async (run, a) => { const m = suya(run); return typeof m === 'string' ? m : runRemember(m, a ?? {}); },
    recall: async (run, a) => { const m = suya(run); return typeof m === 'string' ? m : runRecall(m, a ?? {}); },
  },
  configurar,
  /** ¿Hay memoria configurada? Sin ella, las dos tools no se ofrecen. */
  lista: () => Boolean(deps.memoria),
};
