'use strict';

// La memoria: lo que BlackCode sabe del usuario de un chat a otro.
//
// Es POR AGENTE (1.18.0, pedido de Fran el 27/11/2026: «necesito que las
// memorias sean por agente, puras, sin cruces con otros»; trabajando con Mat
// en ciberseguridad le aparecían recuerdos de Zac, y al revés). Hasta la 1.17
// era una sola para toda la app, como en NeonCode, que tenía un único agente.
// Cada agente tiene su cajón con su Core y su lista; `crear` es UN cajón, y
// `crearPorAgente` el documento entero, que reparte los cajones por agente.
//
// Viene de la memoria de NeonCode 1.11.3 (los dos documentos, Core y Recall, y
// la tool `remember`), sin su recuerdo automático por similitud: allá, antes
// de cada mensaje se buscaban con embeddings los recuerdos «parecidos» y se
// inyectaban. Acá no hay embeddings ni inyección a ciegas. Son dos cosas:
//
//   - Core: un texto corto que escribe el usuario (quién es, cómo quiere que
//     le hablen). Entra ENTERO al contexto en cada turno.
//   - La lista: recuerdos de UNA línea cada uno, que anotan los agentes con
//     `remember` (o el usuario a mano). Entra entera al contexto, como un
//     índice. Un recuerdo puede llevar un `detalle` más largo que NO entra: el
//     agente lo lee cuando lo necesita, con `recall`.
//
// Lo que cambia respecto de NeonCode, y por qué:
//   - Allá eran dos archivos de texto y el panel guardaba el documento entero
//     mientras `remember` le agregaba líneas por detrás. Acá la lista son
//     entradas con id y cada operación toca una sola: no hay documento entero
//     que pisar. Core sigue siendo un texto, y ahí sí vale su cuidado: el
//     guardado manda la `base` con la que se abrió y lo que el agente agregó
//     mientras tanto se conserva.
//   - Allá, pasado el tope, lo que no entraba al contexto era lo MÁS NUEVO (se
//     cortaba el final del archivo, que es donde se agrega) y nadie avisaba:
//     lo tapaba el recuerdo por similitud. Acá quedan afuera las más viejas,
//     el bloque lo dice, y `remember` se lo avisa al agente.
//   - No se anota dos veces lo mismo.
//
// No importa nada de Electron: el documento lo lee y lo escribe quien lo crea
// (en la app, el store del núcleo, en un documento que la interfaz no puede
// leer). El contenido de la memoria viaja al proveedor de cada agente que la
// tenga prendida.

const CORE_CHARS = 4000;    // el Core es chico a propósito: entra entero cada turno
const LISTA_CHARS = 8000;   // lo que ocupa la lista en el contexto (~2000 tokens)
const HECHO_MAX = 300;      // un recuerdo es una línea
const DETALLE_MAX = 8000;
const RECALL_CHARS = 12000; // lo más largo que devuelve `recall`

const unaLinea = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clave = (s) => unaLinea(s).toLowerCase().replace(/[.!?…]+$/, '');
const renglon = (e) => `- (${e.id})${e.detalle ? ' [+]' : ''} ${e.hecho}`;

/**
 * `leer()` devuelve el documento guardado (o undefined) y `escribir(doc)` lo
 * guarda. `alCambiar()` se llama después de cada cambio.
 */
function crear({ leer, escribir, ahora = Date.now, alCambiar = () => {} }) {
  const todo = () => {
    const d = leer();
    return {
      core: typeof d?.core === 'string' ? d.core : '',
      entradas: Array.isArray(d?.entradas) ? d.entradas.filter((e) => e && typeof e.id === 'string' && typeof e.hecho === 'string') : [],
      sig: Number.isInteger(d?.sig) && d.sig > 0 ? d.sig : 1,
    };
  };
  const guardar = (d) => { escribir(d); alCambiar(); };

  // Las que entran al contexto: de la más nueva hacia atrás hasta llenar el
  // tope, y se muestran en orden (la más vieja primero).
  function visibles(d = todo()) {
    const dentro = [];
    let usado = 0;
    for (let i = d.entradas.length - 1; i >= 0; i--) {
      const largo = renglon(d.entradas[i]).length + 1;
      if (dentro.length && usado + largo > LISTA_CHARS) break;
      dentro.unshift(d.entradas[i]);
      usado += largo;
    }
    return { dentro, fuera: d.entradas.length - dentro.length, usado };
  }

  return {
    /** Todo, para la vista: el Core, las entradas y cuánto entra al contexto. */
    estado() {
      const d = todo();
      const v = visibles(d);
      return {
        core: d.core,
        entradas: d.entradas.map((e) => ({ id: e.id, hecho: e.hecho, detalle: e.detalle ?? '', creado: e.creado ?? 0, de: e.de ?? 'user' })),
        topes: { core: CORE_CHARS, lista: LISTA_CHARS, hecho: HECHO_MAX, detalle: DETALLE_MAX },
        enContexto: { usado: v.usado, fuera: v.fuera },
      };
    },

    /** Guarda el Core que escribió el usuario. `base` es el texto con el que
     *  abrió: lo que un agente le agregó desde entonces (siempre al final) no
     *  se pisa. Devuelve lo que quedó guardado. */
    ponerCore(texto, base) {
      const d = todo();
      const agregado = typeof base === 'string' && d.core.startsWith(base) ? d.core.slice(base.length) : '';
      let final = String(texto ?? '');
      if (agregado.trim()) final = `${final.trimEnd()}\n${agregado.trimStart()}`;
      if (final !== d.core) guardar({ ...d, core: final });
      return final;
    },

    /** Un agente agrega una línea al Core (raro, y lo dice su tool). */
    agregarCore(hecho) {
      const linea = unaLinea(hecho);
      if (!linea) return { ok: false, error: 'empty fact' };
      const d = todo();
      if (d.core.split('\n').some((l) => clave(l.replace(/^\s*-\s*/, '')) === clave(linea))) return { ok: true, repetida: true };
      guardar({ ...d, core: `${d.core.trim() ? `${d.core.trimEnd()}\n` : ''}- ${linea}\n` });
      return { ok: true };
    },

    /** Anota un recuerdo. `de` dice quién: 'user' o 'agent'. */
    agregar({ hecho, detalle = '', de = 'user' } = {}) {
      const linea = unaLinea(hecho);
      const cuerpo = String(detalle ?? '').trim();
      if (!linea) return { ok: false, error: 'empty fact' };
      if (linea.length > HECHO_MAX) return { ok: false, error: `a fact is ONE short line (at most ${HECHO_MAX} characters; this one has ${linea.length}). Put the rest in \`detail\`.` };
      if (cuerpo.length > DETALLE_MAX) return { ok: false, error: `the detail is too long (${cuerpo.length} characters; at most ${DETALLE_MAX}). Keep what matters, or use a canvas for a long document.` };
      const d = todo();
      const igual = d.entradas.find((e) => clave(e.hecho) === clave(linea));
      if (igual) return { ok: true, id: igual.id, repetida: true };
      const id = `m${d.sig}`;
      const entrada = { id, hecho: linea, ...(cuerpo ? { detalle: cuerpo } : {}), creado: ahora(), de };
      const nuevo = { ...d, entradas: [...d.entradas, entrada], sig: d.sig + 1 };
      guardar(nuevo);
      return { ok: true, id, fuera: visibles(nuevo).fuera };
    },

    editar(id, { hecho, detalle } = {}) {
      const d = todo();
      const e = d.entradas.find((x) => x.id === id);
      if (!e) return { ok: false, error: 'not found' };
      const linea = hecho === undefined ? e.hecho : unaLinea(hecho);
      const cuerpo = detalle === undefined ? (e.detalle ?? '') : String(detalle ?? '').trim();
      if (!linea) return { ok: false, error: 'empty fact' };
      if (linea.length > HECHO_MAX) return { ok: false, error: `at most ${HECHO_MAX} characters` };
      if (cuerpo.length > DETALLE_MAX) return { ok: false, error: `the detail is too long (at most ${DETALLE_MAX} characters)` };
      const otra = { id: e.id, hecho: linea, ...(cuerpo ? { detalle: cuerpo } : {}), creado: e.creado ?? 0, de: e.de ?? 'user' };
      guardar({ ...d, entradas: d.entradas.map((x) => (x.id === id ? otra : x)) });
      return { ok: true };
    },

    borrar(id) {
      const d = todo();
      if (!d.entradas.some((x) => x.id === id)) return { ok: false, error: 'not found' };
      guardar({ ...d, entradas: d.entradas.filter((x) => x.id !== id) });
      return { ok: true };
    },

    entrada(id) { return todo().entradas.find((x) => x.id === String(id ?? '').trim()) ?? null; },

    /** Las que tienen todas las palabras, en el hecho o en el detalle. Las más
     *  nuevas primero. */
    buscar(consulta, limite = 20) {
      const palabras = unaLinea(consulta).toLowerCase().split(' ').filter(Boolean);
      if (!palabras.length) return [];
      return todo().entradas
        .filter((e) => { const t = `${e.hecho}\n${e.detalle ?? ''}`.toLowerCase(); return palabras.every((p) => t.includes(p)); })
        .reverse()
        .slice(0, limite);
    },

    /**
     * Lo que va en el system de un turno: el Core y la lista. '' si no hay
     * nada que decir. `recall`: el agente tiene la tool para leer detalles;
     * `remember`: puede anotar (entonces una memoria vacía también se dice).
     */
    bloque({ recall = false, remember = false } = {}) {
      const d = todo();
      const partes = [];
      const core = d.core.trim().slice(0, CORE_CHARS);
      if (core) partes.push('## Core memory', 'Key persistent facts you must always keep in mind:', core);
      if (d.entradas.length || remember) {
        if (partes.length) partes.push('');
        partes.push('## Memory');
        if (!d.entradas.length) partes.push('(empty)');
        else {
          const v = visibles(d);
          const hayDetalle = v.dentro.some((e) => e.detalle);
          partes.push(
            'What you have learned about the user across chats, one line per entry, oldest first. Use it naturally, but never quote it verbatim or say "according to my notes". If the user asks where something came from, you may briefly explain.'
              + (hayDetalle ? (recall ? ' An entry marked [+] has more detail behind it: read it with `recall` when it matters.' : ' An entry marked [+] has more detail behind it that you cannot read in this chat.') : ''),
            ...v.dentro.map(renglon),
          );
          if (v.fuera) partes.push(`(${v.fuera} older entr${v.fuera === 1 ? 'y is' : 'ies are'} not shown here${recall ? ': search them with `recall`' : ''}.)`);
        }
      }
      return partes.join('\n');
    },
  };
}

// ---------- Las tools ----------

/** `remember`: el agente anota algo del usuario. */
function runRemember(memoria, { fact, detail, core } = {}) {
  if (!unaLinea(fact)) return 'error: empty fact';
  if (core === true) {
    if (String(detail ?? '').trim()) return 'error: core memory is one short text, it has no detail. Save this as a normal entry (without core), or put only the defining fact in core.';
    const r = memoria.agregarCore(fact);
    if (!r.ok) return `error: ${r.error}`;
    return r.repetida ? 'already in core memory — nothing saved' : 'saved to core memory (always in context)';
  }
  const r = memoria.agregar({ hecho: fact, detalle: detail, de: 'agent' });
  if (!r.ok) return `error: ${r.error}`;
  if (r.repetida) return `already in memory as ${r.id} — nothing saved`;
  return `saved to memory as ${r.id}`
    + (String(detail ?? '').trim() ? ' (its detail is not in context: read it back with `recall` when you need it)' : '')
    + (r.fuera ? ` — memory is over its context budget: the ${r.fuera} oldest entr${r.fuera === 1 ? 'y is' : 'ies are'} no longer shown to you (still searchable with \`recall\`). Tell the user it is time to prune the Memory view.` : '');
}

/** `recall`: leer el detalle de un recuerdo, o buscar en todos. */
function runRecall(memoria, { id, query } = {}) {
  const cual = String(id ?? '').trim();
  const consulta = unaLinea(query);
  if (cual) {
    const e = memoria.entrada(cual);
    if (!e) return `error: there is no memory entry "${cual.slice(0, 40)}". The ids are the ones in parentheses in your Memory list, like m3.`;
    return `${e.id} — ${e.hecho}\n\n${e.detalle ? e.detalle : '(no detail: that line is all there is)'}`.slice(0, RECALL_CHARS);
  }
  if (!consulta) return 'error: pass an entry `id` (to read its detail) or a `query` (to search every entry)';
  const hallados = memoria.buscar(consulta);
  if (!hallados.length) return `No memory entry matches "${consulta.slice(0, 80)}".`;
  const lineas = hallados.map((e) => `${renglon(e)}${e.detalle ? `\n  detail: ${unaLinea(e.detalle).slice(0, 240)}${unaLinea(e.detalle).length > 240 ? '…' : ''}` : ''}`);
  return `Memory entries matching "${consulta.slice(0, 80)}" (${hallados.length}, newest first):\n${lineas.join('\n')}`.slice(0, RECALL_CHARS);
}

// ---------- Por agente ----------

/**
 * El documento entero: `{ version: 2, agentes: { <id del agente>: cajón } }`,
 * donde cada cajón es lo que guarda `crear` (`{ core, entradas, sig }`).
 * `de(agente)` da la memoria de ese agente, con la misma forma que `crear`;
 * sin agente da null (nadie lee ni anota en la memoria «de la app»: ya no hay).
 * Un documento de antes de la 1.18 (una sola memoria) se reparte la primera vez
 * que se lee, con `migrar(viejo)` → `{ agentes, sinDueño }` (ver `repartir`).
 * `alCambiar(agente)` dice de quién fue el cambio.
 */
function crearPorAgente({ leer, escribir, ahora = Date.now, alCambiar = () => {}, migrar = null }) {
  const doc = () => {
    const d = leer();
    if (d && d.version === 2 && d.agentes && typeof d.agentes === 'object') return d;
    if (d && (typeof d.core === 'string' || Array.isArray(d.entradas))) {
      // (el documento viejo queda entero en `anterior`, de respaldo: no lo ve
      // ningún agente ni la interfaz, y si el reparto falla nada se pierde)
      let r = null;
      try { r = migrar ? migrar(d) : null; } catch { r = null; }
      const nuevo = { version: 2, agentes: r?.agentes ?? {}, ...(r?.sinDueño?.length ? { sinDueño: r.sinDueño } : {}), anterior: d };
      escribir(nuevo);
      return nuevo;
    }
    return { version: 2, agentes: {} };
  };
  const cajones = new Map();
  return {
    de(agente) {
      const id = typeof agente === 'string' ? agente.trim() : '';
      if (!id) return null;
      if (!cajones.has(id)) {
        cajones.set(id, crear({
          leer: () => { const d = doc(); return Object.hasOwn(d.agentes, id) ? d.agentes[id] : undefined; },
          escribir: (cajon) => { const d = doc(); escribir({ ...d, agentes: { ...d.agentes, [id]: cajon } }); },
          ahora,
          alCambiar: () => alCambiar(id),
        }));
      }
      return cajones.get(id);
    },
    /** Se borró el agente: su cajón se va con él, entero (Core y lista). Lo
     *  de los demás no se toca. Devuelve si había algo que borrar. */
    olvidar(agente) {
      const id = typeof agente === 'string' ? agente.trim() : '';
      if (!id) return false;
      cajones.delete(id);
      const d = doc();
      if (!Object.hasOwn(d.agentes, id)) return false;
      const { [id]: _, ...resto } = d.agentes;
      escribir({ ...d, agentes: resto });
      alCambiar(id);
      return true;
    },
    /** Los agentes que tienen algo guardado (para los tests y el diagnóstico). */
    agentes: () => Object.keys(doc().agentes),
  };
}

/**
 * Reparte una memoria de antes de la 1.18 entre los agentes, SIN mirar lo que
 * dice ningún recuerdo (Fran: «manipulalas si querés pero no veas el
 * contenido»). Los chats no guardan los argumentos de `remember`, pero sí la
 * hora de cada mensaje del usuario y qué tools corrió cada respuesta: un
 * recuerdo que anotó un agente es del turno (con un `remember` que salió bien)
 * que empezó más cerca ANTES de su hora. Si dos agentes empatan, es de nadie.
 *   - El Core va copiado a todos los agentes: lo escribió el usuario sobre sí
 *     mismo (y no se puede saber qué línea agregó cuál agente). Fran eligió eso.
 *   - Lo que anotó el usuario a mano también va a todos, por lo mismo.
 *   - Lo que anotó un agente y no se puede atribuir queda en `sinDueño`: en el
 *     documento, sin perderse, pero no lo ve ningún agente.
 * `agentes`: los ids que existen; `chats`: la lista `{ id, agente }`;
 * `leerChat(id)`: el documento del chat (con `mensajes`).
 */
function repartir(viejo, { agentes = [], chats = [], leerChat = () => null } = {}) {
  const entradas = Array.isArray(viejo?.entradas) ? viejo.entradas.filter((e) => e && typeof e.id === 'string' && typeof e.hecho === 'string') : [];
  const core = typeof viejo?.core === 'string' ? viejo.core : '';
  const sig = Number.isInteger(viejo?.sig) && viejo.sig > 0 ? viejo.sig : entradas.length + 1;
  const existen = new Set(agentes.filter((a) => typeof a === 'string' && a));
  // los turnos con un remember que salió bien: [desde, hasta) y de qué agente
  const turnos = [];
  for (const c of chats) {
    if (!c || !existen.has(c.agente)) continue;
    const ms = leerChat(c.id)?.mensajes;
    if (!Array.isArray(ms)) continue;
    const delUsuario = (m) => m?.rol === 'user' && Number.isFinite(m.t);
    for (let i = 0; i < ms.length; i++) {
      if (!(Array.isArray(ms[i]?.tools) && ms[i].tools.some((t) => t?.name === 'remember' && t.status === 'ok'))) continue;
      let j = i; while (j >= 0 && !delUsuario(ms[j])) j--;
      let k = i + 1; while (k < ms.length && !delUsuario(ms[k])) k++;
      turnos.push({ agente: c.agente, desde: j >= 0 ? ms[j].t : 0, hasta: k < ms.length ? ms[k].t : Infinity });
    }
  }
  const dueño = (e) => {
    const t = Number(e.creado);
    if (!Number.isFinite(t) || !t) return null;
    const en = turnos.filter((x) => t >= x.desde && t < x.hasta).sort((a, b) => b.desde - a.desde);
    if (!en.length) return null;
    const empatan = en.filter((x) => x.desde === en[0].desde);
    return empatan.every((x) => x.agente === en[0].agente) ? en[0].agente : null;
  };
  const cajon = () => ({ core, entradas: [], sig });
  const salida = Object.fromEntries([...existen].map((a) => [a, cajon()]));
  const sinDueño = [];
  for (const e of entradas) {
    if (e.de !== 'agent') { for (const a of existen) salida[a].entradas.push({ ...e }); continue; }
    const d = dueño(e);
    if (d) salida[d].entradas.push({ ...e }); else sinDueño.push({ ...e });
  }
  return { agentes: salida, sinDueño };
}

module.exports = { crear, crearPorAgente, repartir, runRemember, runRecall, CORE_CHARS, LISTA_CHARS, HECHO_MAX, DETALLE_MAX };
