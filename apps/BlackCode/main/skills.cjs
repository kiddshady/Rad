'use strict';

// Las skills: procedimientos que el usuario le deja escritos a sus agentes
// (cómo quiere un informe, los pasos para publicar una app). Cada una es un
// nombre, una descripción de una línea que dice cuándo usarla, y un cuerpo en
// markdown con las instrucciones. Son UNAS para toda la app.
//
// Es el mismo mecanismo que la memoria (main/memoria.cjs): un índice de una
// línea por skill va siempre en el contexto, y el cuerpo se lee a pedido, con
// la tool `skill`.
//
// Vienen de las skills de NeonCode 1.11.3, pero solo las de INSTRUCCIONES.
// Allá había dos tipos, y acá vino uno. Lo que cambió, y por qué:
//
//   - No vinieron las skills de CÓDIGO (un .js que el modelo escribía y la app
//     ejecutaba adentro de su proceso principal, con todos los permisos de
//     Node). Tenían una esclusa (nacían pendientes y las aprobaba el usuario),
//     pero una vez aprobadas corrían sin sandbox, un bucle las colgaba junto
//     con la app, y la aprobación era un JSON que el propio agente podía
//     reescribir. Para ejecutar código un agente ya tiene `run_code` y los
//     comandos, que pasan por la tarjeta de permiso. Una skill de
//     instrucciones puede decirle «corré este script»: lo corre por ahí.
//   - Allá cada skill era una tool propia (`skill_<nombre>`) y la lista de
//     tools cambiaba a mitad de un turno, con un reintento para el 400 que eso
//     le saca a Anthropic. Acá hay UNA tool, `skill({ name })`, y la lista no
//     cambia: qué skills hay lo dice el índice del system.
//   - Allá lo que escribía el agente con `create_skill` quedaba vivo en el
//     acto: instrucciones persistentes, para todos los chats, que nadie había
//     leído (y que una página web podía haberle dictado). Acá lo que escribe
//     un agente es una PROPUESTA: no entra al índice ni se puede cargar hasta
//     que el usuario la aprueba en la vista Skills. Si la skill ya existía,
//     la versión vigente sigue en uso mientras tanto.
//   - El agente no borra ni apaga skills.
//
// No importa nada de Electron: el documento lo lee y lo escribe quien lo crea.

const { diffLines } = require('./tools/diff.cjs');

const NOMBRE = /^[a-z][a-z0-9_-]{1,39}$/;
const DESCRIPCION_MAX = 300;
const CUERPO_MAX = 20000;
const INDICE_CHARS = 4000; // lo que ocupa el índice en el contexto

const unaLinea = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const renglon = (s) => `- ${s.nombre}: ${s.descripcion}`;
const viva = (s) => Boolean(s.cuerpo) && s.activa !== false;

/** Revisa los tres campos. Devuelve { nombre, descripcion, cuerpo } o { error }. */
function limpiar({ nombre, descripcion, cuerpo } = {}) {
  const n = String(nombre ?? '').trim().toLowerCase();
  const d = unaLinea(descripcion);
  const c = String(cuerpo ?? '').replace(/\r\n/g, '\n').trim();
  if (!NOMBRE.test(n)) return { error: 'the name must be 2 to 40 characters: lowercase letters, digits, - or _, starting with a letter (for example: weekly-report)' };
  if (!d) return { error: 'the description is required: one line that says WHEN to use this skill' };
  if (d.length > DESCRIPCION_MAX) return { error: `the description is one line of at most ${DESCRIPCION_MAX} characters (this one has ${d.length}): it is what tells an agent when to use the skill` };
  if (!c) return { error: 'the body is required: the instructions themselves, in markdown' };
  if (c.length > CUERPO_MAX) return { error: `the body is too long (${c.length} characters; at most ${CUERPO_MAX})` };
  return { nombre: n, descripcion: d, cuerpo: c };
}

/**
 * Un .md con frontmatter (el formato de las skills de Claude Code y de
 * NeonCode: `name:` y `description:` entre dos renglones `---`) a sus tres
 * campos, para llenar el formulario al importar. No valida: eso lo hace
 * guardar.
 */
function deMd(texto, nombreDeArchivo = '') {
  const t = String(texto ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  const campo = (k) => {
    if (!m) return '';
    const linea = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(m[1]);
    return linea ? linea[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
  };
  const deArchivo = String(nombreDeArchivo).replace(/\\/g, '/').split('/').pop().replace(/\.(md|markdown|txt)$/i, '');
  // (sin acentos: «Informe Académico» → informe-academico)
  const nombre = (campo('name') || (/^skill$/i.test(deArchivo) ? '' : deArchivo)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40);
  return { nombre, descripcion: unaLinea(campo('description')).slice(0, DESCRIPCION_MAX), cuerpo: (m ? t.slice(m[0].length) : t).trim() };
}

function crear({ leer, escribir, ahora = Date.now, alCambiar = () => {} }) {
  const todo = () => {
    const d = leer();
    return (Array.isArray(d?.skills) ? d.skills : []).filter((s) => s && typeof s.nombre === 'string' && NOMBRE.test(s.nombre));
  };
  const guardar = (lista, aviso = {}) => {
    escribir({ skills: [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre)) });
    alCambiar(aviso);
  };
  const vivas = () => todo().filter(viva);

  return {
    /** Todo, para la vista. */
    estado() {
      const lista = todo();
      const indice = vivas().map(renglon).join('\n').length;
      return {
        skills: lista.map((s) => ({
          nombre: s.nombre, descripcion: s.descripcion ?? '', cuerpo: s.cuerpo ?? '', activa: s.activa !== false, de: s.de ?? 'user', tocado: s.tocado ?? 0,
          propuesta: s.propuesta ? { descripcion: s.propuesta.descripcion, cuerpo: s.propuesta.cuerpo, cuando: s.propuesta.cuando ?? 0 } : null,
        })),
        topes: { descripcion: DESCRIPCION_MAX, cuerpo: CUERPO_MAX, indice: INDICE_CHARS },
        enContexto: { usado: indice, pasado: indice > INDICE_CHARS },
      };
    },

    /** El usuario escribe una skill nueva, o cambia una suya (`original`: el
     *  nombre que tenía, si es una edición). Queda viva en el acto. */
    guardar({ nombre, descripcion, cuerpo, original = null } = {}) {
      const s = limpiar({ nombre, descripcion, cuerpo });
      if (s.error) return { ok: false, error: s.error };
      const lista = todo();
      const antes = original ? lista.find((x) => x.nombre === original) : null;
      if (original && !antes) return { ok: false, error: 'that skill is gone' };
      if (lista.some((x) => x.nombre === s.nombre && x !== antes)) return { ok: false, error: `there is already a skill named "${s.nombre}"` };
      const nueva = {
        nombre: s.nombre, descripcion: s.descripcion, cuerpo: s.cuerpo,
        activa: antes ? antes.activa !== false : true,
        de: antes?.cuerpo ? (antes.de ?? 'user') : 'user',
        creado: antes?.creado ?? ahora(), tocado: ahora(),
        // (una propuesta pendiente sobre esta skill sigue esperando)
        ...(antes?.propuesta ? { propuesta: antes.propuesta } : {}),
      };
      guardar([...lista.filter((x) => x !== antes), nueva]);
      return { ok: true, nombre: s.nombre };
    },

    activar(nombre, si) {
      const lista = todo();
      const s = lista.find((x) => x.nombre === nombre);
      if (!s || !s.cuerpo) return { ok: false, error: 'not found' };
      guardar(lista.map((x) => (x === s ? { ...s, activa: si === true } : x)));
      return { ok: true };
    },

    borrar(nombre) {
      const lista = todo();
      if (!lista.some((x) => x.nombre === nombre)) return { ok: false, error: 'not found' };
      guardar(lista.filter((x) => x.nombre !== nombre));
      return { ok: true };
    },

    /** Un agente propone una skill nueva o un cambio a una que existe. NO
     *  queda viva: espera la aprobación del usuario. */
    proponer({ nombre, descripcion, cuerpo } = {}) {
      const s = limpiar({ nombre, descripcion, cuerpo });
      if (s.error) return { ok: false, error: s.error };
      const lista = todo();
      const antes = lista.find((x) => x.nombre === s.nombre);
      if (antes?.cuerpo && antes.cuerpo === s.cuerpo && antes.descripcion === s.descripcion) return { ok: true, igual: true, nombre: s.nombre };
      const propuesta = { descripcion: s.descripcion, cuerpo: s.cuerpo, cuando: ahora() };
      const otra = antes ? { ...antes, propuesta } : { nombre: s.nombre, descripcion: '', cuerpo: '', activa: true, de: 'agent', creado: ahora(), tocado: ahora(), propuesta };
      guardar([...lista.filter((x) => x !== antes), otra], { propuesta: s.nombre });
      return { ok: true, nombre: s.nombre, nueva: !antes?.cuerpo };
    },

    /** Lo que el usuario necesita para decidir sobre una propuesta: lo
     *  propuesto y, si reemplaza a una versión vigente, qué cambia. */
    revisar(nombre) {
      const s = todo().find((x) => x.nombre === nombre);
      if (!s?.propuesta) return null;
      const reemplaza = Boolean(s.cuerpo);
      return {
        nombre: s.nombre,
        propuesta: { descripcion: s.propuesta.descripcion, cuerpo: s.propuesta.cuerpo },
        actual: reemplaza ? { descripcion: s.descripcion, cuerpo: s.cuerpo } : null,
        cambio: reemplaza ? { mode: 'diff', ...diffLines(`${s.cuerpo}\n`, `${s.propuesta.cuerpo}\n`) } : null,
      };
    },

    /** El usuario aprueba la propuesta: pasa a ser la versión vigente. */
    aprobar(nombre) {
      const lista = todo();
      const s = lista.find((x) => x.nombre === nombre);
      if (!s?.propuesta) return { ok: false, error: 'there is nothing to approve' };
      const nueva = { nombre: s.nombre, descripcion: s.propuesta.descripcion, cuerpo: s.propuesta.cuerpo, activa: s.cuerpo ? s.activa !== false : true, de: s.cuerpo ? (s.de ?? 'user') : 'agent', creado: s.creado ?? ahora(), tocado: ahora() };
      guardar(lista.map((x) => (x === s ? nueva : x)));
      return { ok: true };
    },

    /** El usuario descarta la propuesta. Si la skill no tenía versión vigente
     *  (era nueva), se va entera. */
    descartar(nombre) {
      const lista = todo();
      const s = lista.find((x) => x.nombre === nombre);
      if (!s?.propuesta) return { ok: false, error: 'there is nothing to discard' };
      const { propuesta: _fuera, ...resto } = s;
      guardar(s.cuerpo ? lista.map((x) => (x === s ? resto : x)) : lista.filter((x) => x !== s));
      return { ok: true };
    },

    /** La skill, si se puede cargar; si no, por qué no. */
    cargar(nombre) {
      const n = String(nombre ?? '').trim().toLowerCase();
      const s = todo().find((x) => x.nombre === n);
      if (!s) return { ok: false, motivo: 'no-existe', nombres: vivas().map((x) => x.nombre) };
      if (!s.cuerpo) return { ok: false, motivo: 'pendiente' };
      if (s.activa === false) return { ok: false, motivo: 'apagada' };
      return { ok: true, nombre: s.nombre, descripcion: s.descripcion, cuerpo: s.cuerpo };
    },

    vivas: () => vivas().map((s) => ({ nombre: s.nombre, descripcion: s.descripcion })),

    /**
     * Lo que va en el system de un turno: el índice. '' si no hay ninguna
     * skill viva. Lo que no entra en el tope se dice, y se puede listar con
     * la tool.
     */
    bloque() {
      const lista = vivas();
      if (!lista.length) return '';
      const dentro = [];
      let usado = 0;
      for (const s of lista) {
        const largo = renglon(s).length + 1;
        if (dentro.length && usado + largo > INDICE_CHARS) break;
        dentro.push(s);
        usado += largo;
      }
      const fuera = lista.length - dentro.length;
      return [
        '## Skills',
        'Procedures the user saved for you, one per line: its name and when to use it. When a task matches one, load it with `skill` BEFORE you start and follow it. Do not guess what a skill says from its name.',
        ...dentro.map(renglon),
        ...(fuera ? [`(${fuera} more skill${fuera === 1 ? '' : 's'} not listed here: call \`skill\` with no name to see them all.)`] : []),
      ].join('\n');
    },
  };
}

// ---------- Las tools ----------

/** `skill`: cargar una skill por su nombre, o listarlas todas. */
function runSkill(skills, { name } = {}) {
  const n = String(name ?? '').trim();
  if (!n) {
    const lista = skills.vivas();
    if (!lista.length) return 'There are no skills yet. The user writes them in the Skills view.';
    return `Skills (${lista.length}):\n${lista.map(renglon).join('\n')}`;
  }
  const r = skills.cargar(n);
  if (r.ok) return `Skill "${r.nombre}" — a procedure the user wrote or approved. Follow it for this task:\n\n${r.cuerpo}`;
  if (r.motivo === 'pendiente') return `error: the skill "${n.toLowerCase()}" is a proposal waiting for the user's approval in the Skills view: it cannot be loaded yet`;
  if (r.motivo === 'apagada') return `error: the skill "${n.toLowerCase()}" is turned off (the user did that in the Skills view)`;
  return `error: there is no skill named "${n.slice(0, 60)}". ${r.nombres.length ? `The skills are: ${r.nombres.join(', ')}.` : 'There are no skills yet.'}`;
}

/** `create_skill`: el agente propone una skill. */
function runCreateSkill(skills, { name, description, body } = {}) {
  const r = skills.proponer({ nombre: name, descripcion: description, cuerpo: body });
  if (!r.ok) return `error: ${r.error}`;
  if (r.igual) return `the skill "${r.nombre}" already says exactly that — nothing to change`;
  return r.nueva
    ? `Proposed the skill "${r.nombre}". It is NOT in use yet: the user has to approve it in the Skills view (they just got a notice). Tell them in one line what it is for.`
    : `Proposed a change to the skill "${r.nombre}". The current version stays in use until the user approves the change in the Skills view (they just got a notice).`;
}

module.exports = { crear, deMd, limpiar, runSkill, runCreateSkill, NOMBRE, DESCRIPCION_MAX, CUERPO_MAX, INDICE_CHARS };
