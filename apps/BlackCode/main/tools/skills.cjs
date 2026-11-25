'use strict';

// skill y create_skill: las dos tools de las skills. Las skills en sí (el
// documento, las propuestas, el índice que entra al system) viven en
// main/skills.cjs.
//
// En NeonCode cada skill era una tool propia (`skill_<nombre>`) y había un
// `list_skills`. Acá hay una sola tool para cargarlas, `skill({ name })`, que
// sin nombre las lista; y `create_skill` no deja nada vivo: propone, y aprueba
// el usuario.

const { runSkill, runCreateSkill } = require('../skills.cjs');

const deps = { skills: null };
function configurar(d = {}) {
  if (d.skills !== undefined) deps.skills = d.skills;
}
const SIN_SKILLS = 'error: skills are not set up in this app';

module.exports = {
  runners: {
    skill: async (_run, a) => (deps.skills ? runSkill(deps.skills, a ?? {}) : SIN_SKILLS),
    create_skill: async (_run, a) => (deps.skills ? runCreateSkill(deps.skills, a ?? {}) : SIN_SKILLS),
  },
  configurar,
  /** ¿Hay skills configuradas? Sin ellas, las dos tools no se ofrecen. */
  lista: () => Boolean(deps.skills),
};
