// Test de la memoria de BlackCode (apps/BlackCode/main/memoria.cjs) y de sus
// dos tools, `remember` y `recall` (main/tools/memoria.cjs), con node pelado.
// Uso: node tools/test-blackcode-memoria.mjs
//
// NeonCode no tenía tests de `runRemember` (solo de la carrera entre su panel
// y la tool: scripts/test-memory-panel.js). De ahí viene el grupo «el Core y
// la base»; el resto es de acá, porque la memoria de BlackCode es otra: una
// lista de entradas con detalle a pedido, sin el recuerdo por similitud.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const { crear, crearPorAgente, repartir, runRemember, runRecall, CORE_CHARS, LISTA_CHARS, HECHO_MAX, DETALLE_MAX } = require(path.join(APP, 'main', 'memoria.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };

// Una memoria sobre un documento en memoria, que anota cada guardado.
function nueva(doc = undefined) {
  const caja = { doc, guardados: 0, cambios: 0, reloj: 1000 };
  const m = crear({ leer: () => caja.doc, escribir: (d) => { caja.doc = JSON.parse(JSON.stringify(d)); caja.guardados++; }, ahora: () => caja.reloj++, alCambiar: () => { caja.cambios++; } });
  return { m, caja };
}
// La memoria de la app entera, por agente (1.18.0), sobre un documento en memoria.
function porAgente(doc = undefined, migrar = null) {
  const caja = { doc, guardados: 0, cambios: [], reloj: 1000 };
  const pa = crearPorAgente({ leer: () => caja.doc, escribir: (d) => { caja.doc = JSON.parse(JSON.stringify(d)); caja.guardados++; }, ahora: () => caja.reloj++, alCambiar: (a) => { caja.cambios.push(a); }, migrar });
  return { pa, caja };
}

// ---------- vacía ----------
{
  const { m, caja } = nueva();
  const e = m.estado();
  ok('una memoria nueva está vacía', e.core === '' && e.entradas.length === 0 && e.enContexto.usado === 0 && e.enContexto.fuera === 0);
  ok('dice sus topes', e.topes.core === CORE_CHARS && e.topes.lista === LISTA_CHARS && e.topes.hecho === HECHO_MAX && e.topes.detalle === DETALLE_MAX);
  ok('sin nada, no hay bloque para el system', m.bloque() === '' && m.bloque({ recall: true }) === '');
  ok('pero el que puede anotar ve que está vacía', m.bloque({ remember: true }) === '## Memory\n(empty)');
  ok('leer no guarda nada', caja.guardados === 0 && caja.cambios === 0);
  ok('un documento roto no tumba nada', nueva({ core: 7, entradas: 'x', sig: -3 }).m.estado().entradas.length === 0 && nueva('basura').m.bloque() === '');
}

// ---------- anotar ----------
{
  const { m, caja } = nueva();
  const a = m.agregar({ hecho: '  Prefers   short answers\nin Spanish ', de: 'agent' });
  ok('anotar devuelve el id', a.ok && a.id === 'm1' && !a.repetida, JSON.stringify(a));
  ok('el hecho queda en UNA línea', caja.doc.entradas[0].hecho === 'Prefers short answers in Spanish');
  ok('y avisa que cambió', caja.guardados === 1 && caja.cambios === 1);
  ok('guarda quién lo anotó y cuándo', caja.doc.entradas[0].de === 'agent' && caja.doc.entradas[0].creado === 1000);
  const b = m.agregar({ hecho: 'Works on BlackCode', detalle: '  An Electron app.\n\nIt has agents.  ' });
  ok('el segundo es m2, con su detalle', b.id === 'm2' && caja.doc.entradas[1].detalle === 'An Electron app.\n\nIt has agents.' && caja.doc.entradas[1].de === 'user');
  const c = m.agregar({ hecho: 'prefers short answers in spanish.' });
  ok('lo mismo no se anota dos veces (sin mayúsculas ni punto final)', c.ok && c.repetida === true && c.id === 'm1' && caja.doc.entradas.length === 2 && caja.guardados === 2, JSON.stringify(c));
  ok('un hecho vacío no entra', m.agregar({ hecho: '   ' }).ok === false && m.agregar({}).ok === false && caja.doc.entradas.length === 2);
  const largo = m.agregar({ hecho: 'x'.repeat(HECHO_MAX + 1) });
  ok('un hecho que no es una línea corta se rechaza diciendo por qué', !largo.ok && /ONE short line/.test(largo.error) && largo.error.includes(String(HECHO_MAX + 1)) && /`detail`/.test(largo.error), largo.error);
  ok('justo en el tope entra', m.agregar({ hecho: 'y'.repeat(HECHO_MAX) }).ok === true);
  ok('un detalle enorme se rechaza', m.agregar({ hecho: 'big one', detalle: 'z'.repeat(DETALLE_MAX + 1) }).ok === false);
  // los ids no se reusan aunque se borre
  m.borrar('m2');
  ok('borrar saca esa sola', caja.doc.entradas.map((e) => e.id).join() === 'm1,m3');
  ok('y el id no se vuelve a usar', m.agregar({ hecho: 'another fact' }).id === 'm4');
  ok('borrar una que no está lo dice', m.borrar('m99').ok === false);
  // editar
  ok('editar cambia el hecho y deja el resto', m.editar('m1', { hecho: 'Prefers long answers' }).ok && caja.doc.entradas[0].hecho === 'Prefers long answers' && caja.doc.entradas[0].de === 'agent' && caja.doc.entradas[0].creado === 1000);
  ok('editar puede ponerle y sacarle el detalle', m.editar('m1', { detalle: 'Because.' }).ok && caja.doc.entradas[0].detalle === 'Because.' && m.editar('m1', { detalle: '' }).ok && !('detalle' in caja.doc.entradas[0]));
  ok('editar no deja un hecho vacío', m.editar('m1', { hecho: ' ' }).ok === false && caja.doc.entradas[0].hecho === 'Prefers long answers');
  ok('editar una que no está lo dice', m.editar('m99', { hecho: 'x' }).ok === false);
}

// ---------- el bloque del system ----------
{
  const { m } = nueva();
  m.ponerCore('I am Fran.\nAnswer in Spanish.', '');
  m.agregar({ hecho: 'Studies pharmacy' });
  m.agregar({ hecho: 'Builds BlackCode', detalle: 'Many decisions.' });
  const conRecall = m.bloque({ recall: true, remember: true });
  ok('el Core va primero, con el título de NeonCode', conRecall.startsWith('## Core memory\nKey persistent facts you must always keep in mind:\nI am Fran.\nAnswer in Spanish.\n\n## Memory\n'), conRecall.slice(0, 120));
  ok('cada recuerdo es una línea con su id', conRecall.includes('\n- (m1) Studies pharmacy\n- (m2) [+] Builds BlackCode'));
  ok('el detalle NO entra al contexto', !conRecall.includes('Many decisions.'));
  ok('dice cómo usarla (el texto de NeonCode)', conRecall.includes('never quote it verbatim or say "according to my notes"'));
  ok('con recall, dice cómo leer un detalle', conRecall.includes('An entry marked [+] has more detail behind it: read it with `recall`'));
  const sinRecall = m.bloque();
  ok('sin recall, no le promete una tool que no tiene', !sinRecall.includes('`recall`') && sinRecall.includes('that you cannot read in this chat'));
  m.borrar('m2');
  ok('sin ningún detalle no se habla de [+]', !m.bloque({ recall: true }).includes('[+]'));
  m.ponerCore('   ', 'I am Fran.\nAnswer in Spanish.');
  ok('un Core en blanco no pone su título', m.bloque().startsWith('## Memory\n'));
  m.borrar('m1');
  ok('sin recuerdos y sin Core, nada', m.bloque() === '');
  m.ponerCore('x'.repeat(CORE_CHARS + 500), '   ');
  ok('el Core entra hasta su tope', m.bloque().length === '## Core memory\nKey persistent facts you must always keep in mind:\n'.length + CORE_CHARS);
}

// ---------- pasado el tope: quedan afuera las MÁS VIEJAS, y se dice ----------
{
  const { m } = nueva();
  let ultimo = null;
  for (let i = 0; i < 60; i++) ultimo = m.agregar({ hecho: `fact number ${i} ${'x'.repeat(170)}` });
  const e = m.estado();
  ok('la lista se pasa de su tope', e.enContexto.fuera > 0 && e.enContexto.usado <= LISTA_CHARS, JSON.stringify(e.enContexto));
  ok('anotar avisa cuántas quedaron afuera', ultimo.fuera === e.enContexto.fuera);
  const b = m.bloque({ recall: true });
  ok('la más nueva está en el contexto', b.includes('fact number 59 '));
  ok('la más vieja no', !b.includes('fact number 0 '));
  ok('van en orden, la más vieja primero', b.indexOf(`fact number ${e.enContexto.fuera} `) < b.indexOf('fact number 59 ') && b.indexOf(`fact number ${e.enContexto.fuera} `) > 0);
  ok('y el bloque dice cuántas no se muestran', b.endsWith(`(${e.enContexto.fuera} older entries are not shown here: search them with \`recall\`.)`), b.slice(-90));
  ok('sin recall lo dice sin nombrar la tool', m.bloque().endsWith(`(${e.enContexto.fuera} older entries are not shown here.)`));
  ok('lo que no entra se sigue encontrando', m.buscar('number 0').some((x) => x.hecho.startsWith('fact number 0 ')));
  const sola = nueva();
  sola.m.agregar({ hecho: 'h'.repeat(HECHO_MAX), detalle: 'd' });
  ok('una sola entrada entra siempre', sola.m.estado().enContexto.fuera === 0);
}

// ---------- el Core y la base (la carrera de NeonCode) ----------
{
  const { m, caja } = nueva();
  ok('guardar el Core devuelve lo que quedó', m.ponerCore('Line one', '') === 'Line one' && caja.doc.core === 'Line one');
  // el usuario abrió el texto ('Line one'); mientras lo edita, un agente agrega
  const base = 'Line one';
  ok('un agente agrega su línea al final', m.agregarCore('Is left-handed').ok && caja.doc.core === 'Line one\n- Is left-handed\n');
  const final = m.ponerCore('Line one, edited', base);
  ok('el guardado del usuario NO pisa lo que agregó el agente', final === 'Line one, edited\n- Is left-handed\n' && caja.doc.core === final, JSON.stringify(final));
  ok('con la base al día no se duplica', m.ponerCore('Line one, edited\n- Is left-handed\n', final) === 'Line one, edited\n- Is left-handed\n');
  ok('guardar lo mismo no escribe', (() => { const antes = caja.guardados; m.ponerCore(caja.doc.core, caja.doc.core); return caja.guardados === antes; })());
  ok('el agente no agrega dos veces lo mismo al Core', m.agregarCore('is left-handed.').repetida === true && caja.doc.core.split('left-handed').length === 2);
  ok('ni una línea vacía', m.agregarCore('  ').ok === false);
  ok('una base que no calza no inventa nada', m.ponerCore('Whole new text', 'something else') === 'Whole new text');
  const vacia = nueva();
  ok('sobre un Core vacío, la línea del agente va con su viñeta', vacia.m.agregarCore('First').ok && vacia.caja.doc.core === '- First\n');
}

// ---------- buscar ----------
{
  const { m } = nueva();
  m.agregar({ hecho: 'Has a cat named Miso' });
  m.agregar({ hecho: 'Final exam of Biochemistry', detalle: 'Oral exam. The professor asks about the Krebs cycle.' });
  m.agregar({ hecho: 'Likes mate' });
  ok('busca en el hecho, sin mayúsculas', m.buscar('MISO').map((e) => e.id).join() === 'm1');
  ok('y en el detalle', m.buscar('krebs').map((e) => e.id).join() === 'm2');
  ok('todas las palabras tienen que estar', m.buscar('exam krebs').length === 1 && m.buscar('exam miso').length === 0);
  ok('las más nuevas primero', m.buscar('a').map((e) => e.id).join() === 'm3,m2,m1');
  ok('una búsqueda vacía no trae todo', m.buscar('   ').length === 0);
  ok('entrada() trae una por su id', m.entrada(' m2 ')?.hecho === 'Final exam of Biochemistry' && m.entrada('m9') === null);
}

// ---------- las tools ----------
{
  const { m, caja } = nueva();
  ok('remember anota y dice el id', runRemember(m, { fact: 'Uses PowerShell 7' }) === 'saved to memory as m1' && caja.doc.entradas[0].de === 'agent');
  ok('con detalle, dice que el detalle no está en contexto', /^saved to memory as m2 \(its detail is not in context: read it back with `recall`/.test(runRemember(m, { fact: 'Project Rad', detail: 'A framework.' })));
  ok('repetido: no anota y dice dónde está', runRemember(m, { fact: 'uses powershell 7' }) === 'already in memory as m1 — nothing saved' && caja.doc.entradas.length === 2);
  ok('vacío: error', runRemember(m, { fact: ' ' }) === 'error: empty fact' && runRemember(m, {}) === 'error: empty fact' && runRemember(m) === 'error: empty fact');
  ok('demasiado largo: error que dice qué hacer', /^error: a fact is ONE short line/.test(runRemember(m, { fact: 'q'.repeat(400) })));
  ok('core:true va al Core, con el texto de NeonCode', runRemember(m, { fact: 'Is Fran', core: true }) === 'saved to core memory (always in context)' && caja.doc.core === '- Is Fran\n' && caja.doc.entradas.length === 2);
  ok('core repetido', runRemember(m, { fact: 'is fran', core: true }) === 'already in core memory — nothing saved');
  ok('core con detalle: error', /^error: core memory is one short text/.test(runRemember(m, { fact: 'x', detail: 'y', core: true })));
  ok('core:"true" (texto) no es core', runRemember(m, { fact: 'Not core', core: 'true' }) === 'saved to memory as m3' && caja.doc.core === '- Is Fran\n');
  // pasado el tope, el agente se entera
  let r = '';
  for (let i = 0; i < 60; i++) r = runRemember(m, { fact: `bulk ${i} ${'k'.repeat(170)}` });
  ok('pasado el tope, remember se lo avisa al agente', /memory is over its context budget: the \d+ oldest entries are no longer shown to you \(still searchable with `recall`\)\. Tell the user/.test(r), r.slice(0, 200));

  ok('recall por id trae el detalle', runRecall(m, { id: 'm2' }) === 'm2 — Project Rad\n\nA framework.');
  ok('recall de una sin detalle lo dice', runRecall(m, { id: 'm1' }) === 'm1 — Uses PowerShell 7\n\n(no detail: that line is all there is)');
  ok('recall de un id que no existe: error que orienta', /^error: there is no memory entry "m999"\. The ids are the ones in parentheses/.test(runRecall(m, { id: 'm999' })));
  const busca = runRecall(m, { query: 'rad' });
  ok('recall con query lista lo que encontró', busca.startsWith('Memory entries matching "rad" (1, newest first):\n- (m2) [+] Project Rad\n  detail: A framework.'), busca);
  ok('recall sin resultados lo dice', runRecall(m, { query: 'zzzz' }) === 'No memory entry matches "zzzz".');
  ok('recall sin nada: error', /^error: pass an entry `id`/.test(runRecall(m, {})) && /^error: pass an entry `id`/.test(runRecall(m)));
  ok('recall encuentra las que ya no entran al contexto', runRecall(m, { query: 'bulk 0' }).includes('bulk 0 '));
  ok('recall no devuelve más de 12000 caracteres', runRecall(m, { query: 'bulk' }).length <= 12000);
  const antes = caja.guardados;
  runRecall(m, { id: 'm1' }); runRecall(m, { query: 'rad' });
  ok('recall no escribe nada', caja.guardados === antes);
}

// ---------- el cableado ----------
{
  const tools = require(path.join(APP, 'main', 'tools', 'memoria.cjs'));
  ok('sin configurar, las tools no están listas y lo dicen', tools.lista() === false && (await tools.runners.remember({}, { fact: 'x' })) === 'error: memory is not set up in this app' && (await tools.runners.recall({}, { id: 'm1' })) === 'error: memory is not set up in this app');
  const { pa, caja } = porAgente();
  tools.configurar({ memoria: pa });
  const zac = { agente: 'zac' };
  const mat = { agente: 'mat' };
  ok('configuradas, corren contra la memoria del agente de la corrida', tools.lista() === true && (await tools.runners.remember(zac, { fact: 'From the tool' })) === 'saved to memory as m1' && caja.doc.agentes.zac.entradas.length === 1 && !caja.doc.agentes.mat);
  ok('y recall lee la suya', (await tools.runners.recall(zac, { query: 'tool' })).includes('(m1) From the tool'));
  ok('otro agente no la encuentra: ni buscando ni por id', (await tools.runners.recall(mat, { query: 'tool' })) === 'No memory entry matches "tool".' && /^error: there is no memory entry "m1"/.test(await tools.runners.recall(mat, { id: 'm1' })));
  ok('lo que anota el otro va a la suya, con sus propios ids', (await tools.runners.remember(mat, { fact: 'Pentesting lab' })) === 'saved to memory as m1' && caja.doc.agentes.mat.entradas.length === 1 && caja.doc.agentes.zac.entradas.length === 1);
  ok('…y el primero no la ve', !(await tools.runners.recall(zac, { query: 'pentesting' })).includes('Pentesting'));
  ok('una corrida sin agente no tiene memoria', (await tools.runners.remember({}, { fact: 'x' })) === 'error: memory belongs to an agent, and this run has none' && (await tools.runners.recall({ agente: '' }, { query: 'x' })) === 'error: memory belongs to an agent, and this run has none');
  ok('sin argumentos no tiran', (await tools.runners.remember(zac, undefined)) === 'error: empty fact');
  tools.configurar({ memoria: null });

  const defs = require(path.join(APP, 'main', 'tools', 'defs.cjs'));
  const de = (n) => defs.TOOL_DEFS.find((t) => t.name === n);
  ok('remember y recall están definidas', defs.existe('remember') && defs.existe('recall'));
  ok('remember pide solo el hecho', JSON.stringify(de('remember').parameters.required) === '["fact"]' && Object.keys(de('remember').parameters.properties).join() === 'fact,detail,core');
  ok('recall no exige nada (id o query)', !de('recall').parameters.required && Object.keys(de('recall').parameters.properties).join() === 'id,query');
  ok('la descripción de remember ya no promete el recuerdo por similitud de NeonCode', !/surfaced only when relevant|RECALL memory/.test(de('remember').description) && de('remember').description.includes('Memory list'));
  const grupo = defs.GRUPOS.find((g) => g.id === 'memory');
  // (con los chats de antes, chat_search y chat_read, desde la 1.8.0)
  ok('tienen su grupo, Memory', grupo?.nombre === 'Memory' && grupo.tools.join() === 'remember,recall,chat_search,chat_read');
  ok('validar acepta sus argumentos', defs.validar('remember', { fact: 'x', core: true }) === null && defs.validar('recall', { id: 'm1' }) === null, String(defs.validar('remember', { fact: 'x', core: true })));
  ok('y rechaza remember sin hecho', typeof defs.validar('remember', { detail: 'x' }) === 'string');

  const motor = fs.readFileSync(path.join(APP, 'main', 'tools', 'motor.cjs'), 'utf8');
  ok('recall es de lectura (no gasta presupuesto) y no cuenta como bucle', /READ_ROUND_TOOLS = new Set\(\[[^\]]*'recall'/.test(motor) && /IDEMPOTENT_TOOLS = new Set\(\[[^\]]*'recall'/.test(motor));
  ok('remember NO es de lectura', !/READ_ROUND_TOOLS = new Set\(\[[^\]]*'remember'/.test(motor));
  ok('un subagente no anota (no está escuchando al usuario)', /n !== 'delegate' && n !== 'schedule' && n !== 'remember'/.test(motor));
  const guardas = require(path.join(APP, 'main', 'tools', 'guardas.cjs'));
  const guia = guardas.toolGuidance(['remember', 'recall'], null, false).join('\n');
  ok('la guía nombra las dos', /- `remember`: save ONE concise lasting fact/.test(guia) && /- `recall`: read the detail behind a Memory entry/.test(guia));

  // la memoria vive en un documento que la interfaz no puede leer
  const chat = fs.readFileSync(path.join(APP, 'main', 'chat.cjs'), 'utf8');
  ok('la memoria se guarda en un documento reservado (empieza con _)', /DOC_MEMORIA = '_memoria'/.test(chat));
  ok('y la interfaz la cambia solo por sus canales', ['memoria:leer', 'memoria:core', 'memoria:agregar', 'memoria:editar', 'memoria:borrar'].every((c) => chat.includes(`rad.handle('${c}'`)));
  const vista = fs.readFileSync(path.join(APP, 'renderer', 'memoria.js'), 'utf8');
  ok('la vista no toca el store', !/openDoc|rad\.store/.test(vista));
}

// ---------- la sesión: el bloque llega al system, antes del protocolo ----------
{
  const herramientas = require(path.join(APP, 'main', 'tools', 'index.cjs'));
  const { pa } = porAgente();
  const m = pa.de('zac');
  m.ponerCore('I am the user.', '');
  m.agregar({ hecho: 'Likes tests' });
  herramientas.iniciar({ memoria: pa });
  const s = herramientas.crearSesion({ reqId: 'r1', convoId: 'c1', ac: new AbortController(), tools: ['remember', 'recall'], confirma: false });
  s.run.agente = 'zac';
  ok('con la memoria configurada, las tools se ofrecen', s.nombres.join() === 'remember,recall', s.nombres.join());
  ok('sin texto en la corrida, el system no trae memoria', !s.sistema('Be brief.').includes('## Memory'));
  s.run.memoria = m.bloque({ recall: true, remember: true });
  const system = s.sistema('Be brief.');
  ok('las instrucciones del agente van primero', system.startsWith('Be brief.\n'));
  ok('el bloque de memoria está', system.includes('## Core memory\nKey persistent facts you must always keep in mind:\nI am the user.') && system.includes('- (m1) Likes tests'));
  ok('y va ANTES del protocolo de tools, que queda último', system.indexOf('## Memory') < system.indexOf('The section below is the tool protocol') && system.indexOf('## Memory') > 0);
  const r = await s.correr('remember', { fact: 'Ran in a session' });
  ok('remember corre por el motor de verdad', !r.error && r.out === 'saved to memory as m2', JSON.stringify(r));
  const l = await s.correr('recall', { query: 'session' });
  ok('y recall también', !l.error && l.out.includes('(m2) Ran in a session'), JSON.stringify(l).slice(0, 160));
  ok('lo anotado en la sesión de zac quedó en la de zac y en ninguna otra', pa.de('zac').estado().entradas.length === 2 && pa.de('mat').estado().entradas.length === 0);
  herramientas.cerrar();
}

// ---------- por agente: cada uno tiene su cajón, sin cruces ----------
{
  const { pa, caja } = porAgente();
  ok('sin agente no hay memoria', pa.de('') === null && pa.de(undefined) === null && pa.de(null) === null);
  const zac = pa.de('zac');
  const mat = pa.de('mat');
  ok('el mismo agente da el mismo cajón', pa.de('zac') === zac && pa.de(' zac ') === zac);
  zac.ponerCore('Zac core.', '');
  zac.agregar({ hecho: 'Zac fact', detalle: 'Zac detail' });
  mat.agregar({ hecho: 'Mat fact' });
  ok('cada uno tiene lo suyo', zac.estado().entradas.map((e) => e.hecho).join() === 'Zac fact' && mat.estado().entradas.map((e) => e.hecho).join() === 'Mat fact');
  ok('el Core también es de cada uno', zac.estado().core === 'Zac core.' && mat.estado().core === '');
  ok('el bloque de uno no trae nada del otro', !mat.bloque({ recall: true, remember: true }).includes('Zac') && !zac.bloque({ recall: true, remember: true }).includes('Mat'));
  ok('buscar no cruza', mat.buscar('zac').length === 0 && zac.buscar('mat').length === 0);
  ok('los ids son de cada cajón', mat.entrada('m1')?.hecho === 'Mat fact' && zac.entrada('m1')?.hecho === 'Zac fact');
  ok('borrar en uno no toca el otro', mat.borrar('m1').ok && zac.estado().entradas.length === 1 && mat.estado().entradas.length === 0);
  ok('el documento es v2 con un cajón por agente', caja.doc.version === 2 && Object.keys(caja.doc.agentes).sort().join() === 'mat,zac' && pa.agentes().sort().join() === 'mat,zac');
  ok('cada cambio dice de qué agente fue', caja.cambios.join() === 'zac,zac,mat,mat', caja.cambios.join());
  // un agente llamado como una propiedad de Object no rompe nada
  const raro = pa.de('__proto__');
  raro.agregar({ hecho: 'Weird' });
  ok('un id raro es un cajón más', pa.de('__proto__').estado().entradas.length === 1 && pa.de('constructor').estado().entradas.length === 0 && zac.estado().entradas.length === 1);
}

// ---------- lo de antes de la 1.18: se reparte una vez, sin mirar el contenido ----------
{
  // dos agentes; los chats guardan la hora de cada mensaje del usuario y qué
  // tools corrió cada respuesta (sin los argumentos)
  const chats = [{ id: 'c1', agente: 'zac' }, { id: 'c2', agente: 'mat' }, { id: 'c3', agente: 'zac' }, { id: 'c4', agente: 'borrado' }];
  const docs = {
    c1: { mensajes: [{ rol: 'user', texto: 'a', t: 1000 }, { rol: 'assistant', texto: 'b', tools: [{ name: 'remember', status: 'ok' }] }, { rol: 'user', texto: 'c', t: 5000 }, { rol: 'assistant', texto: 'd' }] },
    c2: { mensajes: [{ rol: 'user', texto: 'a', t: 2000 }, { rol: 'assistant', texto: 'b', tools: [{ name: 'remember', status: 'ok' }, { name: 'recall', status: 'ok' }] }] },
    // un remember que falló no hace dueño a nadie
    c3: { mensajes: [{ rol: 'user', texto: 'a', t: 8000 }, { rol: 'assistant', texto: 'b', tools: [{ name: 'remember', status: 'error' }] }] },
    c4: { mensajes: [{ rol: 'user', texto: 'a', t: 9000 }, { rol: 'assistant', texto: 'b', tools: [{ name: 'remember', status: 'ok' }] }] },
  };
  const viejo = {
    core: 'About me.',
    sig: 7,
    entradas: [
      { id: 'm1', hecho: 'one', creado: 1500, de: 'agent' },  // turno de zac (c1, desde 1000)
      { id: 'm2', hecho: 'two', creado: 2500, de: 'agent' },  // los dos turnos lo cubren: el más cercano es el de mat (desde 2000)
      { id: 'm3', hecho: 'three', creado: 3000, de: 'user' }, // a mano: a todos
      { id: 'm4', hecho: 'four', creado: 8500, de: 'agent' }, // el de c3 falló; el de c2 sigue abierto: mat
      { id: 'm5', hecho: 'five', creado: 500, de: 'agent' },  // antes de cualquier turno: de nadie
      { id: 'm6', hecho: 'six', creado: 9500, de: 'agent' },  // el agente de c4 ya no existe: el turno abierto más cercano que queda es el de mat
    ],
  };
  const r = repartir(viejo, { agentes: ['zac', 'mat'], chats, leerChat: (id) => docs[id] });
  const ids = (a) => r.agentes[a].entradas.map((e) => e.id).join();
  ok('repartir: cada recuerdo del agente va al turno que empezó más cerca antes', ids('zac') === 'm1,m3' && ids('mat') === 'm2,m3,m4,m6', `zac ${ids('zac')} · mat ${ids('mat')}`);
  ok('repartir: lo que no se puede atribuir queda aparte, sin perderse', r.sinDueño.map((e) => e.id).join() === 'm5');
  ok('repartir: el Core va copiado a todos', r.agentes.zac.core === 'About me.' && r.agentes.mat.core === 'About me.');
  ok('repartir: cada cajón sigue numerando desde donde iba (los ids no se repiten con los viejos)', r.agentes.zac.sig === 7 && r.agentes.mat.sig === 7);
  ok('repartir: un agente que ya no existe no recibe nada', !('borrado' in r.agentes));
  // empate exacto entre dos agentes: de nadie
  const empate = repartir({ entradas: [{ id: 'm1', hecho: 'x', creado: 1500, de: 'agent' }] }, { agentes: ['zac', 'mat'], chats: [{ id: 'a', agente: 'zac' }, { id: 'b', agente: 'mat' }], leerChat: () => ({ mensajes: [{ rol: 'user', texto: 'q', t: 1000 }, { rol: 'assistant', texto: 'r', tools: [{ name: 'remember', status: 'ok' }] }] }) });
  ok('repartir: si dos agentes empatan, no es de ninguno', empate.sinDueño.length === 1 && !empate.agentes.zac.entradas.length && !empate.agentes.mat.entradas.length);

  // el documento viejo se reparte la primera vez que se lee, y una sola vez
  let migraciones = 0;
  const { pa, caja } = porAgente(JSON.parse(JSON.stringify(viejo)), (d) => { migraciones++; return repartir(d, { agentes: ['zac', 'mat'], chats, leerChat: (id) => docs[id] }); });
  ok('al leer, lo viejo queda repartido', pa.de('zac').estado().entradas.map((e) => e.id).join() === 'm1,m3' && pa.de('mat').estado().core === 'About me.');
  pa.de('mat').estado();
  pa.de('zac').agregar({ hecho: 'new one' });
  ok('…una sola vez, y lo nuevo sigue la numeración', migraciones === 1 && caja.doc.version === 2 && pa.de('zac').entrada('m7')?.hecho === 'new one');
  ok('…y guarda aparte lo de nadie', caja.doc.sinDueño?.map((e) => e.id).join() === 'm5');
  const sinMigrar = porAgente({ core: 'x', entradas: [{ id: 'm1', hecho: 'y', de: 'agent' }] });
  ok('sin quien reparta, lo viejo no se lo queda nadie (ni se mezcla)', sinMigrar.pa.de('zac').estado().entradas.length === 0 && sinMigrar.pa.de('zac').estado().core === '');
  sinMigrar.pa.de('zac').agregar({ hecho: 'z' });
  ok('…pero queda de respaldo, entero, aunque después se guarde algo', sinMigrar.caja.doc.anterior?.entradas?.[0]?.hecho === 'y' && sinMigrar.caja.doc.anterior.core === 'x');
  ok('el reparto guarda el viejo de respaldo también', caja.doc.anterior?.entradas?.length === 6);
  const tira = porAgente({ core: 'x', entradas: [] }, () => { throw new Error('boom'); });
  ok('si el reparto tira, la app sigue y lo viejo queda de respaldo', tira.pa.de('zac').estado().entradas.length === 0 && tira.caja.doc.anterior?.core === 'x');
}

// ---------- borrar un agente se lleva su memoria (1.18.1) ----------
{
  const { pa, caja } = porAgente();
  pa.de('zac').ponerCore('Soy Fran', '');
  pa.de('zac').agregar({ hecho: 'algo de Zac', de: 'agent' });
  pa.de('mat').ponerCore('Soy Fran también', '');
  pa.de('mat').agregar({ hecho: 'algo de Mat', de: 'agent' });
  caja.cambios.length = 0;
  ok('olvidar sin agente no hace nada', pa.olvidar('') === false && pa.olvidar(null) === false);
  ok('olvidar un agente sin nada guardado dice que no había', pa.olvidar('nadie') === false);
  ok('olvidar a Zac dice que había', pa.olvidar('zac') === true);
  ok('  su cajón ya no está en el documento', !Object.hasOwn(caja.doc.agentes, 'zac') && pa.agentes().join() === 'mat');
  ok('  avisa del cambio de Zac', caja.cambios.join() === 'zac');
  ok('  lo de Mat queda entero', pa.de('mat').estado().core === 'Soy Fran también' && pa.de('mat').estado().entradas.length === 1);
  const otra = pa.de('zac').estado();
  ok('  un agente nuevo con el mismo id arranca vacío', otra.core === '' && otra.entradas.length === 0);
  ok('olvidarlo dos veces no rompe', pa.olvidar('zac') === false);
}

if (failures.length) {
  console.error(`test-blackcode-memoria: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-memoria: ok (${hechas} comprobaciones: vacía, anotar, editar y borrar, el bloque del system, el tope que deja afuera las más viejas y lo dice, el Core con su base, buscar, remember y recall, el cableado, la sesión, por agente sin cruces, el reparto de lo de antes y lo que se lleva un agente al borrarse)`);
process.exit(0);
