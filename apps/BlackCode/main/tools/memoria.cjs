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

const { runRemember, runRecall } = require('../memoria.cjs');

const deps = { memoria: null };
function configurar(d = {}) {
  if (d.memoria !== undefined) deps.memoria = d.memoria;
}
const SIN_MEMORIA = 'error: memory is not set up in this app';

module.exports = {
  runners: {
    remember: async (_run, a) => (deps.memoria ? runRemember(deps.memoria, a ?? {}) : SIN_MEMORIA),
    recall: async (_run, a) => (deps.memoria ? runRecall(deps.memoria, a ?? {}) : SIN_MEMORIA),
  },
  configurar,
  /** ¿Hay memoria configurada? Sin ella, las dos tools no se ofrecen. */
  lista: () => Boolean(deps.memoria),
};
