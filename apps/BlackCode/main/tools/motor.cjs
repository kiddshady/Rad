'use strict';

// El motor de las tools de BlackCode: el despachador por el que pasa TODA llamada,
// el registro de lo que corrió y cómo terminó, y el corte de bucles.
//
// Portado de NeonCode 1.11.3 (main.js): argsDigest, failedOut, el thrash
// breaker (M9), congelarRutas y runTool vienen tal cual estaban escritos, con
// sus comentarios. Las «M» numeradas (M1, M9…) son las medidas de su documento
// de guardrails; el resumen está en docs/tools.md de esta app.
//
// La tesis que ordena todo, y que no se negocia: hay UN registro de lo que
// pasó en el turno (run.steps) y lo leen los tres que importan: el modelo (en
// el bloque que la app le pone al final de cada pedido), los chips de la
// interfaz y el contador bajo la respuesta. Si alguno dijera otra cosa, uno de
// los tres estaría mintiendo. La app enuncia hechos, nunca juicios.
//
// Adaptaciones al pasar a BlackCode:
//   - Las tools se registran (registrar) en vez de vivir en una tabla fija, y
//     cada corrida trae su lista (run.tools): las que el agente tiene prendidas.
//   - Si una llamada pide confirmación lo decide run.needsConfirm (el modo
//     manual / automático de BlackCode), no una config global.
//   - El motor no conoce a las familias: lo que necesita de una (cómo es el
//     destino de os_open) le llega por configurar().
//   - No hay skills ni MCP todavía: sus ramas de runTool no vinieron.
//     Tampoco el registro de verificación (M10). Los subagentes llegaron en
//     la 0.13.0 (delegar.cjs): acá está qué tools ve un hijo y cómo se cierra
//     la fila de `delegate`.

const { resolverEn } = require('./base.cjs');
const path = require('node:path');

// Lo que el motor necesita de otra familia: cómo distinguir una ruta de una
// URL en el destino de os_open (lo sabe abrir.cjs).
let clasificarDestino = null;
function configurar({ classifyOsTarget } = {}) {
  if (classifyOsTarget !== undefined) clasificarDestino = classifyOsTarget;
}

// name -> runner(run, args). Lo llena registrar().
const TOOL_RUNNERS = Object.create(null);
/** Suma las tools de una familia: { fs_read: runner, … }. */
function registrar(runners) {
  for (const [name, fn] of Object.entries(runners)) {
    if (typeof fn !== 'function') throw new Error(`[blackcode] la tool ${name} no trae runner`);
    TOOL_RUNNERS[name] = fn;
  }
}
const registradas = () => Object.keys(TOOL_RUNNERS);
/** Cambia de una vez todos los runners cuyo nombre empieza con `prefijo`: las
 *  tools de los servidores MCP (`mcp_`), que aparecen y desaparecen con ellos. */
function reemplazar(prefijo, runners) {
  for (const k of Object.keys(TOOL_RUNNERS)) if (k.startsWith(prefijo)) delete TOOL_RUNNERS[k];
  for (const [k, fn] of Object.entries(runners ?? {})) if (k.startsWith(prefijo) && typeof fn === 'function') TOOL_RUNNERS[k] = fn;
}
/** Las tools de ESTA corrida: las que el agente tiene prendidas y existen. */
function activeToolNames(run) {
  let names = Array.isArray(run?.tools) ? run.tools.filter((n) => n in TOOL_RUNNERS) : [];
  // Un subagente no delega (un solo nivel: un hijo que lanza hijos es el mismo
  // runaway que una tarea que agenda tareas), no agenda y no guarda memorias
  // del usuario: no lo está escuchando. Con access 'read' se queda con las de
  // lectura, que son las mismas que no gastan presupuesto (READ_ROUND_TOOLS).
  // El filtro es fijo para todo el turno del hijo, así que no le cambia la lista
  // de tools detrás de un bloque thinking.
  // Una TAREA PROGRAMADA corre sin nadie mirando: no hay a quién pedirle
  // permiso, así que lo que no puede correr solo directamente no está. Nunca:
  // agendar otra tarea (una tarea que agenda tareas es un runaway), lanzar
  // subagentes, generar imágenes (gasta plata) ni el canvas (es de un chat, y
  // acá no hay). Y, salvo que el usuario le haya prendido «Let it act» a esa
  // tarea, solo las de lectura; la pantalla tampoco, que es lo más privado.
  // (Los servidores MCP que preguntan los saca chat.cjs antes de armar la sesión.)
  if (run?.tarea) {
    names = names.filter((n) => n !== 'schedule' && n !== 'delegate' && n !== 'generate_image' && n !== 'canvas');
    if (!run.tarea.actuar) names = names.filter((n) => READ_ROUND_TOOLS.has(n) && n !== 'screen_capture');
  }
  if (run?.subagent) {
    names = names.filter((n) => n !== 'delegate' && n !== 'schedule' && n !== 'remember' && n !== 'create_skill'
      // (ni genera imágenes: gasta plata del usuario, y la pide quien habla con él)
      && n !== 'generate_image'
      // (ni usa servidores MCP: son código de terceros, que conecta y autoriza el usuario)
      && !n.startsWith('mcp_'));
    if (run.subagent.access !== 'full') names = names.filter((n) => READ_ROUND_TOOLS.has(n));
    // El browser es UNO, compartido con el padre y el usuario, y todas sus tools
    // trabajan sobre la pestaña activa. Dos hijos a la vez con browser_navigate
    // o browser_click se pisan: uno cambia de página o de pestaña en medio del
    // read → click del otro, y el click del segundo cae en otra página, con la
    // sesión real del usuario. Los que corren juntos solo pueden LEER la pestaña;
    // el trabajo de browser va a un subagente solo, que la tiene entera.
    if (run.subagent.paralelo) names = names.filter((n) => !BROWSER_ACTION_TOOLS.has(n));
  }
  return names;
}

// Rondas que NO se cobran del presupuesto de tools: si TODAS las calls de una
// ronda son de LECTURA, la ronda es gratis — "leer no es entregar" (el doc de
// guardrails lo dice desde M3), y un presupuesto que se gasta en fs_read deja
// al modelo sin rondas justo cuando llega a la parte donde tiene que actuar.
//
// OJO: esta lista mide OTRA dimensión que DANGER_TOOLS_NAMES. fs_read y fetch
// son DANGER para el sandbox (juntas son un canal de exfiltración) y acá son
// lectura igual: el presupuesto protege al turno de no terminar nunca, no al
// sistema del modelo. Las MCP nunca refundan — código de terceros, nada suyo
// se da por lectura — y `db_query` tampoco: es SQL libre, puede escribir.
//
// El riesgo de la ronda gratis es el loop infinito de lecturas, y está cubierto
// DOS veces: el thrash breaker (M9) corta la lectura repetida, y el tope duro
// (RONDAS_TOPE_FACTOR) corta hasta la lectura siempre-nueva que M9 no ve.
//
// `browser_read` entra y las otras tres browser_* no, por la misma línea que
// separa a fs_read de fs_write: leer la página que está abierta no la cambia.
// Navegar sí cuenta como acción aunque "solo" cargue una URL — le cambia al
// usuario lo que tiene en pantalla, y un turno que se va de gira por diez sitios
// sin gastar presupuesto es justo el loop que el tope existe para cortar.
//
// `screen_capture` y `job_output` también son lectura: mirar la pantalla no la
// cambia, y leer la salida de un job tampoco cambia el job.
const READ_ROUND_TOOLS = new Set(['fs_read', 'code_search', 'chat_search', 'chat_read', 'rag_search',
  'notepad', 'recall', 'skill', 'list_skills', 'web_search', 'fetch', 'browser_read', 'screen_capture', 'job_output']);

// Las del browser que CAMBIAN la pestaña (todas menos browser_read). Ver el
// filtro de subagentes en paralelo en activeToolNames.
const BROWSER_ACTION_TOOLS = new Set(['browser_navigate', 'browser_click', 'browser_type', 'browser_press', 'browser_upload']);

// ¿La ronda fue toda de lectura? Las skills de instrucciones también cuentan:
// llamarlas DEVUELVE texto (el cuerpo del .md) y no ejecuta nada.
function rondaEsLectura(nombres) {
  return nombres.length > 0 && nombres.every((n) => READ_ROUND_TOOLS.has(n));
}

// Una línea legible de los argumentos: lo justo para identificar la acción.
// Se muestra en el chip Y viaja al modelo en el ledger, así que se mantiene corto
// a propósito — acá no va el contenido de nada.
function argsDigest(name, args) {
  const a = args || {};
  const cut = (s, n = 60) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  const base = (p) => cut(String(p ?? '').split(/[\\/]/).filter(Boolean).pop() || p);
  switch (name) {
    // Misma normalización que runFsRead: `paths` como string en vez de array es
    // un error clásico de modelo chico, y el runner ya lo contempla. Acá no, y
    // `.filter` sobre un string tiraba TypeError — en argsDigest, o sea ANTES de
    // que la tool llegara a correr, matando el turno entero por un chip.
    case 'fs_read': {
      const ps = a.paths != null ? (Array.isArray(a.paths) ? a.paths : [a.paths]) : [a.path];
      return cut(ps.filter(Boolean).map(base).join(', '));
    }
    case 'fs_write': case 'fs_delete': return base(a.path);
    // os_open declara `target`, no `path`: agrupada con las de arriba leía
    // siempre undefined, así que el chip, el step guardado y el ledger que ve el
    // modelo decían `os_open()` — sin decir jamás qué se había abierto.
    case 'os_open': return base(a.target);
    // El archivo Y cuántos fragmentos toca: un fs_edit sin el conteo se lee
    // igual que un fs_write en el chip, y son cosas distintas. El chequeo del
    // array va inline y no por normalizeEdits a propósito — esta función se
    // extrae sola del fuente en test-guardrails, sin ninguna dependencia.
    case 'fs_edit': {
      const n = Array.isArray(a.edits) ? a.edits.length : (a.edits ? 1 : 0);
      return cut(`${base(a.path)}${n ? ` · ${n} edit${n === 1 ? '' : 's'}` : ''}`, 60);
    }
    case 'shell_exec': case 'cmd_exec': return cut(a.command);
    case 'job_start': return cut(a.name ? `${a.name} · ${a.command}` : a.command);
    case 'job_output': return a.id ? cut(`${a.id}${a.until ? ` · until ${a.until}` : ''}`, 50) : 'all jobs';
    case 'job_kill': return cut(a.id, 20);
    case 'screen_capture': {
      const titulo = a.window ? `window "${cut(a.window, 30)}"` : '';
      const que = a.job ? `job ${cut(a.job, 10)}${titulo ? ` · ${titulo}` : ''}`
        : Number(a.pid) > 0 ? `pid ${Math.round(a.pid)}${titulo ? ` · ${titulo}` : ''}`
          : titulo || (Number(a.display) > 1 ? `display ${Math.round(a.display)}` : 'screen');
      return a.region ? `${que} · region` : que;
    }
    case 'run_code': return cut(a.language || a.lang || 'code');
    case 'web_search': case 'chat_search': case 'rag_search': case 'code_search':
      // ([BlackCode] chat_search sin consulta lista los chats recientes)
      if (name === 'chat_search' && !a.query) return 'recent chats';
      return cut(a.query || a.pattern);
    case 'notepad': return cut(a.query || 'recent notes');
    case 'notepad_write': return cut(`${a.action || 'write'}${a.folder ? ` · ${a.folder}` : ''}`);
    case 'fetch': { try { return new URL(a.url).hostname; } catch { return cut(a.url, 40); } }
    // El host, y si fue a otra pestaña se dice: "ollama.com · new tab" es una
    // acción distinta de "ollama.com" para quien mira el chip, porque le cambió
    // la tira. Un cambio de pestaña sin URL muestra el número, que es lo único
    // que hay.
    case 'browser_navigate': {
      let host = '';
      try { host = new URL(a.url).hostname; } catch { host = cut(a.url, 40); }
      if (!host && a.tab != null) return `tab ${a.tab}`;
      return a.new_tab ? cut(`${host} · new tab`, 50) : host;
    }
    case 'browser_read': return a.page > 1 ? `page ${a.page}` : 'the open page';
    // Los nombres de los archivos sí: son lo que el usuario tiene que poder
    // reconocer en el chip (qué salió de su disco y hacia dónde).
    case 'browser_upload': return cut(`${a.ref || ''} · ${(Array.isArray(a.paths) ? a.paths : [a.paths]).filter(Boolean).map((x) => path.basename(String(x))).join(', ')}`, 70);
    case 'browser_press': {
      const { key: tecla, ref } = a;
      return cut(`${tecla || ''}${ref ? ` · ${ref}` : ''}`, 30);
    }
    case 'browser_click': return cut(a.ref || '', 20);
    // LO QUE SE TECLEÓ NO ENTRA. Es la única tool de la app por la que pasan
    // contraseñas, tarjetas y datos personales — el usuario le dice "completá el
    // formulario" y eso va a un campo de una página real. El digest se muestra en
    // el chip, se GUARDA con el chat y vuelve al modelo en el ledger de cada
    // ronda, así que un volcado del default (que es donde caía sin este case)
    // dejaba la contraseña escrita en el .json del chat y de vuelta en el
    // contexto en cada turno siguiente. El campo alcanza para reconocer la
    // acción, que es todo lo que este digest promete.
    case 'browser_type': return cut(`${a.ref || ''}${a.submit ? ' + Enter' : ''}`, 30);
    // el digest viaja al modelo en el ledger y se muestra en el chip, así que la URL
    // va TAL CUAL la escribió el modelo: con {{secret:NAME}} sin resolver. Reponerlo
    // después sería tarde — acá el valor real nunca estuvo.
    case 'http_request': return cut(`${String(a.method || 'GET').toUpperCase()} ${a.url}`, 70);
    case 'sqlite_query': return cut(`${base(a.db)} · ${a.sql}`, 70);
    case 'db_query': return cut(a.sql);
    case 'remember': return cut(a.fact);
    case 'recall': return cut(a.id || a.query);
    case 'chat_read': {
      const tramo = a.around != null ? ` · around #${a.around}` : a.from != null || a.to != null ? ` · #${a.from ?? 1}–${a.to ?? 'end'}` : '';
      return cut(`${a.id || ''}${tramo}`);
    }
    case 'schedule':
      if (a.action === 'list') return 'list';
      if (a.action === 'delete') return cut(`delete ${a.id || ''}`.trim());
      return cut(a.title || a.prompt);
    // el conteo de edits por el mismo motivo que en fs_edit, y con el mismo
    // chequeo inline: argsDigest se extrae sola del fuente, sin dependencias
    case 'canvas': {
      if (a.action === 'edit') {
        const n = Array.isArray(a.edits) ? a.edits.length : (a.edits ? 1 : 0);
        return cut(`edit${a.title ? ` ${a.title}` : ''}${n ? ` · ${n} edit${n === 1 ? '' : 's'}` : ''}`, 60);
      }
      return cut([a.action, a.action === 'list' && a.scope === 'all' ? 'library' : null, a.title].filter(Boolean).join(' '));
    }
    case 'create_skill': return cut([a.type, a.name].filter(Boolean).join(' '));
    case 'generate_image': return cut(a.prompt);
    case 'skill': return cut(a.name || 'all skills');
    case 'list_skills': return 'my skills';
    default: {
      // skill_<nombre>: el chip dice la SKILL, no su JSON de args — que para las
      // de prompt es siempre `{}` y no distingue una de otra. El prefijo va
      // literal y no por skillEngine: esto es formateo puro, y colgarle el
      // engine obligaría a inyectárselo a una función que solo arma un string.
      if (String(name).startsWith('skill_')) {
        const argTxt = cut(Object.values(a).filter((v) => v != null && v !== '').join(' '), 40);
        return cut(name.slice(6) + (argTxt ? ` · ${argTxt}` : ''), 60);
      }
      // mcp_<server>_<tool>: mismo criterio que las skills. Caía en el volcado
      // de JSON de abajo, y eso rompe la única regla que este digest tiene — "lo
      // que se guarda es DESPACHO y DESENLACE, nunca contenido": un
      // `mcp_fs_write_file` metía el archivo ENTERO en el step, en el chat
      // persistido y en el ledger que vuelve al modelo.
      // El prefijo va literal y no por isMcpName por lo mismo que el de skill_:
      // esta función se extrae SOLA del fuente en los tests, sin dependencias.
      if (String(name).startsWith('mcp_')) {
        const argTxt = cut(Object.values(a).filter((v) => typeof v !== 'object' && v != null && v !== '').join(' '), 40);
        return cut(name.replace(/^mcp_/, '') + (argTxt ? ` · ${argTxt}` : ''), 60);
      }
      try { return cut(JSON.stringify(a), 80); } catch { return ''; }
    }
  }
}

// Los runners devuelven los errores como TEXTO, no tiran: sin esto un fs_write
// que falló contaría como ok en el contador y en el ledger — la app mintiéndole
// al modelo, que es peor que no decirle nada.
//
// Casi todos declaran la falla al PRINCIPIO ('error: …'), pero los dos que
// lanzan procesos no pueden: su salida arranca con el stdout del comando y el
// fracaso llega al final, en una marca que ponemos nosotros. Un `npm test` en
// rojo o un script que revienta se registraban como ok, y el ledger le juraba al
// modelo que el comando había andado — que es exactamente la mentira que todo
// este registro existe para no decir.
//
// La marca se mira SOLO en esas tools: un `[exit code 1]` adentro de un fs_read
// es el contenido de un log, no un fracaso. Y `[stderr]` no cuenta: un montón de
// comandos escriben ahí y terminan bien.
const PROC_TOOLS = new Set(['shell_exec', 'cmd_exec', 'run_code']);

const PROC_FAILED = /^\[(?:exit code \d+\]|timed out after )/m;

const failedOut = (out, name) => {
  const s = String(out ?? '');
  if (/^\s*error:/i.test(s)) return true;
  return PROC_TOOLS.has(name) && PROC_FAILED.test(s);
};

// Repetir una de estas con el MISMO resultado es no-progreso demostrable: no
// tienen efecto, así que la segunda vez no cambió nada del mundo y el modelo ya
// tiene la respuesta arriba. La lista es explícita y corta A PROPÓSITO: lo que no
// está —skill_*, mcp_*, y cualquier tool nueva— NO cuenta como idempotente, que
// es el lado seguro (el detector de no-progreso simplemente no se aplica y
// quedan los otros dos, que no necesitan saber nada de la tool).
//
// http_request queda AFUERA aunque un GET sea de lectura: el método lo elige el
// modelo, y una lista que depende de un argumento no es una lista. Lo mismo
// sqlite_query (tiene `readonly`, pero es opcional) y canvas (depende de
// `action`). En los tres, equivocarse hacia adentro sería bloquear una escritura
// legítima porque devolvió dos veces la misma confirmación.
const IDEMPOTENT_TOOLS = new Set([
  'fs_read', 'web_search', 'chat_search', 'chat_read', 'rag_search', 'code_search', 'notepad', 'recall', 'skill', 'fetch', 'list_skills',
]);

const THRASH = {
  exactWarn: 2, exactBlock: 5, // misma tool + mismos args, fallando
  toolWarn: 3, toolBlock: 8,   // misma tool fallando, con cualquier args
  stuckWarn: 2, stuckBlock: 5, // idempotente devolviendo exactamente lo mismo
};

// FNV-1a de 32 bits en hex. Los args y los resultados se guardan HASHEADOS y
// nunca crudos, por dos motivos que no son el de siempre (acá no hay red): un
// fs_write lleva el archivo entero adentro y el Map se quedaría con esa copia
// todo el turno, y el registro de la app no guarda contenido, nunca.
function fnv1a(s) {
  const t = String(s ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Los args con las claves ORDENADAS, recursivamente: `{a:1,b:2}` y `{b:2,a:1}`
// son la misma llamada y el modelo las emite indistintamente entre rondas. Sin
// canonicalizar, el detector de falla exacta no vería nunca dos iguales.
function canonArgs(args) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = walk(v[k]); return o; }, {});
    }
    return v;
  };
  try { return JSON.stringify(walk(args || {})) ?? ''; } catch { return ''; }
}

const thrashKey = (name, args) => `${name}#${fnv1a(canonArgs(args))}`;

const thrashState = () => ({ exact: new Map(), tool: new Map(), stuck: new Map() });

// el estado vive en el `run`, que ya es por-turno: los contadores arrancan
// limpios en cada turno sin que nadie tenga que acordarse de resetearlos. Una
// racha no puede cruzar de un turno al siguiente, y no debe: entre medio habló
// el usuario, y eso cambia la tarea.
const thrashOf = (run) => (run._thrash ??= thrashState());

// ANTES de despachar. Devuelve null (seguir) o el veredicto de bloqueo.
//
// El mensaje abre con el hecho y cierra con la salida, nunca al revés: es la
// misma lección del postmortem de M8, donde un nudge que ORDENABA primero hacía
// que el modelo ejecutara cualquier cosa para obedecer.
function thrashCheck(st, name, args) {
  const key = thrashKey(name, args);
  const bloqueo = (code, message) => ({ action: 'block', code, message });

  const exact = st.exact.get(key) || 0;
  if (exact >= THRASH.exactBlock) {
    return bloqueo('thrash_exact', `Blocked by BlackCode: this exact call — same tool, same arguments — has already failed ${exact} times in this turn, so it was NOT dispatched. Repeating it unchanged fails again. Read the errors above and change the arguments or the approach; if you cannot, say plainly what is blocking you.`);
  }

  const porTool = st.tool.get(name) || 0;
  if (porTool >= THRASH.toolBlock) {
    return bloqueo('thrash_tool', `Blocked by BlackCode: ${name} has failed ${porTool} times in this turn, so this call was NOT dispatched. Stop routing this task through ${name}. Use a different tool, or tell the user what is blocking you.`);
  }

  const stuck = st.stuck.get(key);
  if (stuck && stuck.n >= THRASH.stuckBlock) {
    return bloqueo('thrash_stuck', `Blocked by BlackCode: this read-only call has already returned the exact same result ${stuck.n} times in this turn, so it was NOT dispatched. You already have this answer above — use it, or ask something different.`);
  }
  return null;
}

// DESPUÉS de que la llamada se resolvió. Devuelve null o el aviso a pegarle al
// resultado. El estado que entra es el YA normalizado por settle (un runner que
// devuelve 'error: …' llega acá como 'error', no como 'ok').
//
// Solo `error` y `ok` mueven contadores. `declined` y `aborted` NO son fracasos:
// el usuario dijo que no, o apretó Stop. Contarlos llevaría a bloquear una tool
// que el usuario podría aprobar en la tarjeta siguiente — la app sacándole la
// decisión de las manos, que es justo lo que la tarjeta existe para darle. Y
// `blocked` tampoco cuenta: esa llamada nunca corrió (si contara, un bloqueo se
// realimentaría a sí mismo para siempre).
function thrashRecord(st, name, args, status, out) {
  if (status !== 'error' && status !== 'ok') return null;
  const key = thrashKey(name, args);
  const aviso = (code, message) => ({ action: 'warn', code, message });

  if (status === 'error') {
    // una falla invalida cualquier racha de "devolvió lo mismo" de esta llamada
    st.stuck.delete(key);
    const exact = (st.exact.get(key) || 0) + 1;
    st.exact.set(key, exact);
    const porTool = (st.tool.get(name) || 0) + 1;
    st.tool.set(name, porTool);

    if (exact >= THRASH.exactWarn) {
      return aviso('thrash_exact', `BlackCode: this exact call has now failed ${exact} times in this turn. Repeating it unchanged will fail again — change the arguments or the approach instead of retrying it. After ${THRASH.exactBlock} it stops being dispatched.`);
    }
    if (porTool >= THRASH.toolWarn) {
      return aviso('thrash_tool', `BlackCode: ${name} has failed ${porTool} times in this turn with different arguments. Consider a different route.`);
    }
    return null;
  }

  // EL ÉXITO BORRA LOS CONTADORES. Es lo que hace que esto mida un loop TRABADO
  // y no ruido acumulado: un turno largo y sano que falla una vez cada tanto y
  // sigue adelante nunca llega al umbral. Sin esto, el breaker dispara solo en
  // cualquier sesión de trabajo real.
  st.exact.delete(key);
  st.tool.delete(name);

  if (!IDEMPOTENT_TOOLS.has(name)) { st.stuck.delete(key); return null; }
  const h = fnv1a(out);
  const prev = st.stuck.get(key);
  const n = prev && prev.h === h ? prev.n + 1 : 1;
  st.stuck.set(key, { h, n });
  if (n >= THRASH.stuckWarn) {
    return aviso('thrash_stuck', `BlackCode: this call has returned the exact same result ${n} times in this turn. You already have this answer — use it instead of asking again. After ${THRASH.stuckBlock} it stops being dispatched.`);
  }
  return null;
}

// Qué argumento de cada tool es una ruta. `os_open` no está acá: su `target`
// puede ser una URL y resolverla como ruta la rompería — se trata aparte.
const ARGS_DE_RUTA = {
  fs_read: ['paths'], fs_write: ['path'], fs_edit: ['path'], fs_delete: ['path'],
  sqlite_query: ['db'], code_search: ['path'],
};

/**
 * Resuelve las rutas de los argumentos a absolutas, UNA vez, antes de que nadie
 * las mire.
 *
 * El preview resolvía `path` contra el cwd para armar el `target` que la tarjeta
 * pinta como ruta absoluta, y el runner volvía a resolver el MISMO string
 * relativo recién cuando el usuario aprobaba. Entre esas dos cosas hay un gate
 * SIN timeout y un candado de turnos que es por chat: el usuario dejaba una
 * tarjeta abierta en el chat A, aprobaba en el chat B un shell_exec con `cwd`,
 * volvía a A y aprobaba. Se confirmaba un archivo y se escribía otro — con
 * fs_delete, se borraba un árbol distinto del que la tarjeta contó.
 *
 * Congelando acá, la tarjeta, el preview, el runner, el ledger de verificación y
 * el thrash breaker leen todos la misma ruta, y el volcado de argumentos de la
 * tarjeta muestra el absoluto: lo que se aprueba es lo que se toca.
 */
function congelarRutas(run, name, args) {
  if (!args || typeof args !== 'object') return args;
  const congelar = (v) => {
    if (typeof v !== 'string' || !v.trim()) return v;
    // (una ruta imposible: que falle el runner, con su mensaje. Una de la carpeta de la app, no: se rechaza acá, antes de la tarjeta)
    try { return resolverEn(run, v); } catch (err) { if (err?.code === 'RESERVADA') throw err; return v; }
  };
  for (const k of ARGS_DE_RUTA[name] || []) {
    const v = args[k];
    if (Array.isArray(v)) args[k] = v.map(congelar);
    else if (v != null) args[k] = congelar(v);
  }
  // os_open aparte: solo se congela cuando su target es una ruta y no una URL.
  if (name === 'os_open' && typeof args.target === 'string'
      && clasificarDestino?.(args.target).kind === 'path') {
    args.target = congelar(args.target);
  }
  return args;
}

// El despachador. Viene de NeonCode sin sus ramas de skills, MCP y subagentes.
async function runTool(run, name, args) {
  const runner = TOOL_RUNNERS[name];
  // Una tool que no existe, o que existe pero no está en ESTA corrida. Pasa
  // por el mismo registro que cualquier llamada (step, chip, estado error) y
  // el mensaje lleva el nombre: el usuario ve que el modelo pidió algo, y el
  // modelo sabe QUÉ nombre falló para corregirse.
  let rechazo = null;
  if (!runner) {
    rechazo = `error: there is no tool named '${name}' — call only the tools you were given`;
  } else if (!activeToolNames(run).includes(name)) {
    rechazo = `error: tool '${name}' is not available in this run`;
  }

  // (una ruta de la carpeta de la app se rechaza ya: no tiene sentido pedir permiso para algo que no se va a hacer)
  if (!rechazo) { try { congelarRutas(run, name, args); } catch (err) { rechazo = `error: ${String(err?.message || err)}`; } }

  // El id tiene que ser único en TODA la conversación, no en el turno: con el
  // reqId adelante (uno por turno) no se repite, tampoco contra los turnos que
  // ya están guardados en el chat y vuelven al DOM al reabrirlo.
  const callId = `${run.callPrefix || run.reqId}:${run.steps.length + 1}`;
  const step = { callId, name, args: argsDigest(name, args), status: 'run', t0: Date.now() };
  run.steps.push(step);
  run._callId = callId; // el chip que emita el runner se ata a ESTE step

  // ¿ALGUIEN EMITIÓ EL CHIP? Lo manda cada runner —cada uno sabe qué etiqueta le
  // queda bien—, pero varios validan sus argumentos y devuelven `error: …` ANTES
  // de llegar a esa línea. Entonces quedaba un step sin chip: el contador decía
  // "1 herramienta · 1 error" arriba de CERO chips. Se envuelve el notify de la
  // corrida en vez de emitir el chip desde acá siempre: si lo emitiera el
  // dispatcher, los runners perderían su etiqueta (el comando, el host, el
  // archivo) y todos los chips dirían el digest pelado.
  const notifyOriginal = run.notify;
  let chipEmitido = false;
  run.notify = function notifyConTestigo(channel, payload) {
    if (channel === 'tool:activity') chipEmitido = true;
    return notifyOriginal.call(this, channel, payload);
  };

  const settle = (status, out) => {
    run.notify = notifyOriginal; // la corrida sigue con su notify de siempre
    // el runner nunca llegó a su línea: el chip lo pone el dispatcher, con el
    // digest, que es peor etiqueta que la del runner pero infinitamente mejor
    // que ninguna
    if (!chipEmitido) {
      notifyOriginal.call(run, 'tool:activity', { reqId: run.reqId, callId, kind: name, label: step.args });
    }
    step.status = status === 'ok' && failedOut(out, name) ? 'error' : status;
    step.ms = Date.now() - step.t0;
    // M9. El veredicto se calcula con el estado YA normalizado: un runner que
    // devolvió 'error: …' llega acá como 'error', no como 'ok'. El aviso se PEGA
    // al resultado en vez de viajar por un canal aparte: el modelo lo lee en el
    // punto donde decide. Y como viaja adentro de `out`, el chip lo muestra igual.
    const aviso = thrashRecord(thrashOf(run), name, args, step.status, out);
    if (aviso) out = `${typeof out === 'string' ? out : JSON.stringify(out ?? '')}\n\n[${aviso.message}]`;
    // el chip ABRE y muestra este texto, así que el recorte viaja declarado: sin
    // el flag, 600 caracteres cortados al medio se leen como si fueran todo lo
    // que la tool devolvió
    const completo = String(out ?? '');
    // el chip de `delegate` es donde el usuario lee el informe del subagente:
    // con 600 caracteres no se lee nada
    step.out = completo.slice(0, name === 'delegate' ? DELEGATE_CHIP_CHARS : CHIP_CHARS);
    step.outCut = completo.length > step.out.length;
    run._callId = null;
    notifyOriginal.call(run, 'tool:result', {
      reqId: run.reqId, callId, status: step.status, ms: step.ms, out: step.out, outCut: step.outCut,
    });
    return out;
  };

  if (rechazo) return settle('error', rechazo); // settle emite el chip con el digest

  // STOP YA DADO. El modelo pide varias tools en la MISMA ronda y el loop las
  // corre en serie: sin este corte, las que quedaban detrás del Stop se
  // ejecutaban igual — escribiendo archivos y corriendo comandos que el usuario
  // acababa de cancelar. El step y el chip se emiten lo mismo: una tool que
  // desaparece sin dejar rastro es indistinguible de una que nunca se pidió.
  if (run.ac?.signal?.aborted) {
    run.notify('tool:activity', { reqId: run.reqId, callId, kind: name, label: step.args });
    return settle('aborted', 'the run was stopped before this tool ran');
  }

  // M9 — THRASH BREAKER. Va ANTES de la tarjeta de confirmación a propósito:
  // preguntarle al usuario si aprueba algo que la app va a rechazar igual es
  // teatro.
  const corte = thrashCheck(thrashOf(run), name, args);
  if (corte) {
    run.notify('tool:activity', { reqId: run.reqId, callId, kind: name, label: step.args });
    return settle('blocked', corte.message);
  }

  if (run.needsConfirm?.(name, args || {})) {
    const verdict = await run.confirm(name, args || {}, callId);
    if (verdict !== true) {
      // una tool declinada tiene que dejar rastro: el chip lo emite el runner,
      // y el runner nunca corre. Se emite acá para que el rechazo se vea.
      run.notify('tool:activity', { reqId: run.reqId, callId, kind: name, label: step.args });
      return settle(verdict === 'abort' ? 'aborted' : 'declined', 'the user declined to run this tool');
    }
  }
  try {
    const out = await runner(run, args || {});
    // Un `delegate` cortado por el Stop vuelve con los informes parciales y no
    // con un error, así que el chip quedaba con su tilde de ok arriba de cuatro
    // subagentes cortados y el pie decía "1 ok". Lo que pasó fue un cancel.
    return settle(name === 'delegate' && run.ac?.signal?.aborted ? 'aborted' : 'ok', out);
  } catch (err) {
    return settle('error', `error: ${String(err?.message || err)}`);
  }
}

// Lo que el chip guarda de la salida de una tool, y lo que guarda del informe
// de un subagente.
const CHIP_CHARS = 600;
const DELEGATE_CHIP_CHARS = 4000;

/**
 * Una llamada que no llegó a despacharse porque sus argumentos no se pudieron
 * leer o no tienen la forma de la tool. Deja su paso y su chip igual que
 * cualquier otra (una llamada que desaparece sin rastro es indistinguible de
 * una que nunca se pidió) y cuenta como fracaso para el corte de bucles.
 */
function anotarRechazo(run, name, args, out) {
  const callId = `${run.callPrefix || run.reqId}:${run.steps.length + 1}`;
  const completo = String(out ?? '');
  const step = {
    callId, name, args: argsDigest(name, args), status: 'error', t0: Date.now(), ms: 0,
    out: completo.slice(0, CHIP_CHARS), outCut: completo.length > CHIP_CHARS,
  };
  run.steps.push(step);
  run.notify('tool:activity', { reqId: run.reqId, callId, kind: name, label: step.args });
  run.notify('tool:result', { reqId: run.reqId, callId, status: 'error', ms: 0, out: step.out, outCut: step.outCut });
  thrashRecord(thrashOf(run), name, args, 'error', completo);
  return completo;
}

module.exports = {
  registrar, reemplazar, configurar, registradas, activeToolNames, runTool, anotarRechazo, argsDigest, failedOut,
  thrashCheck, thrashRecord, thrashState, thrashOf, congelarRutas, rondaEsLectura,
  READ_ROUND_TOOLS, BROWSER_ACTION_TOOLS, IDEMPOTENT_TOOLS, THRASH, CHIP_CHARS, DELEGATE_CHIP_CHARS,
};
