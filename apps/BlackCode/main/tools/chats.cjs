'use strict';

// chat_search y chat_read: que un agente recupere lo que se habló en sus
// OTROS chats. Lo propuso Zac (un agente de BlackCode) y Fran lo pidió el
// 25/11/2026, con una regla que no se negocia: cada agente busca y lee SOLO
// en sus propios chats. Zac no ve los de Oracle ni al revés: los chats de un
// agente de Venice no viajan nunca a Anthropic por esta puerta.
//
// chat_search viene de NeonCode 1.11.3 (main.js, runChatSearch, que a su vez
// venía de Umbra): palabras sueltas y sin orden, primero los mensajes que las
// tienen TODAS y, si no hay ninguno, los que tienen alguna; por recencia,
// agrupado por chat, con un fragmento centrado en la coincidencia. Lo que se
// adaptó:
//   - Los chats no son JSON en una carpeta: son documentos del store del
//     núcleo (`chats` con la lista y `chat-<id>` con los mensajes, que escribe
//     la interfaz). Llegan por configurar({ lista, leer }).
//   - Solo los chats del agente de la corrida (`run.agente`). Sin agente, no
//     busca nada: mejor un error que buscar en todos.
//   - Cada coincidencia dice el id del chat y el número del mensaje, para ir
//     directo con chat_read (`around`). NeonCode no tenía chat_read.
//   - Sin consulta, en vez de los últimos mensajes, la lista de los chats más
//     recientes (título, id, fecha, cuántos mensajes).
//   - Mira también las filas de las tools (qué tocó cada una), no solo lo que
//     se dijo: «el archivo que editamos» se encuentra por su ruta.
//
// chat_read es de BlackCode: lee un tramo de un chat, numerado desde 1,
// paginado por caracteres. Las tools van en una línea y las imágenes como
// una marca: lo que llena el contexto no es lo que el agente necesita.
//
// Las dos son de solo lectura: no piden permiso y sus rondas no se cobran.

const deps = { lista: null, leer: null };
function configurar(d = {}) {
  if (d.lista !== undefined) deps.lista = d.lista;
  if (d.leer !== undefined) deps.leer = d.leer;
}
const lista = () => Boolean(deps.lista && deps.leer);

const SIN_CHATS = 'error: past chats are not available in this app';
const SIN_AGENTE = 'error: this run does not belong to an agent, so there are no chats of its own to search';

const BUSQUEDA_MAX = 8000;   // lo que devuelve chat_search, como en NeonCode
const LECTURA_MAX = 12000;   // una página de chat_read
const MENSAJE_MAX = 3000;    // un mensaje largo se corta (y se dice cómo seguir)
const ALREDEDOR = 5;         // `around`: tantos antes y tantos después

// ---------- de NeonCode, tal cual ----------
const CHAT_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'it', 'that', 'this', 'what', 'how',
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'y', 'o', 'u', 'que', 'en', 'del', 'al', 'con', 'por', 'para', 'es', 'se',
  'lo', 'mi', 'me', 'te', 'no', 'si', 'su', 'sus', 'como', 'mas', 'pero', 'yo', 'vos', 'ya', 'le', 'les', 'nos', 'hay', 'muy',
]);

function chatSearchTerms(q) {
  return String(q || '').toLowerCase()
    .split(/[^\p{L}\p{N}._-]+/u)
    .filter((t) => t.length > 1 && !CHAT_STOP.has(t))
    .slice(0, 8);
}

// snippet de 400 chars centrado en el primer término que matchea
function chatSnippet(text, terms) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= 400) return s;
  const low = s.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  if (idx <= 260) return s.slice(0, 400) + '…';
  const start = Math.max(0, idx - 150);
  return '…' + s.slice(start, start + 400) + '…';
}

function chatStamp(ts) {
  if (!ts) return '?';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- los chats del agente ----------
/** Los chats de ESTE agente, del más reciente al más viejo. */
function chatsDe(agente) {
  const todos = (() => { try { return deps.lista() ?? []; } catch { return []; } })();
  return todos
    .filter((c) => c && typeof c.id === 'string' && c.agente === agente)
    .sort((a, b) => (b.tocado || b.creado || 0) - (a.tocado || a.creado || 0));
}
const mensajesDe = (id) => { try { const m = deps.leer(id)?.mensajes; return Array.isArray(m) ? m : []; } catch { return []; } };

// Lo buscable de un mensaje: lo que se dijo, o qué tocó una tool y su salida.
function textoDe(m) {
  if (m?.rol === 'tool') return `${m.tool ?? 'tool'} ${m.texto ?? ''}\n${typeof m.salida === 'string' ? m.salida : ''}`;
  if (m?.rol === 'user' || m?.rol === 'assistant') return typeof m.texto === 'string' ? m.texto : '';
  return '';
}
const quien = (m) => (m.rol === 'tool' ? `tool ${m.tool ?? ''}`.trim() : m.rol);

async function runChatSearch(run, { query, scope, limit } = {}) {
  if (!lista()) return SIN_CHATS;
  const agente = typeof run.agente === 'string' && run.agente ? run.agente : null;
  if (!agente) return SIN_AGENTE;
  const sc = ['others', 'current', 'all'].includes(scope) ? scope : 'others';
  if (sc === 'current' && !run.convoId) return "error: this run has no current chat (scope 'current' only works in a live conversation) — use scope 'all'";
  const n = Math.min(30, Math.max(1, Number(limit) || 10));
  const terms = chatSearchTerms(query);
  run.notify('tool:activity', { reqId: run.reqId, kind: 'chat_search', label: terms.length ? terms.join(' ') : 'recent chats' });

  const propios = chatsDe(agente).filter((c) => (sc === 'others' ? c.id !== run.convoId : sc === 'current' ? c.id === run.convoId : true));

  // Sin consulta: los chats más recientes, para elegir cuál leer.
  if (!terms.length) {
    const recientes = propios.filter((c) => (c.cuenta ?? 1) > 0).slice(0, n);
    if (!recientes.length) return sc === 'current' ? 'This chat has no messages yet.' : 'You have no other chats yet.';
    return 'Your most recent chats, newest first (read one with chat_read):\n'
      + recientes.map((c) => `- "${c.titulo || 'Untitled'}" · id ${c.id} · last active ${chatStamp(c.tocado || c.creado)}`).join('\n');
  }

  // Con consulta: chat por chat, podando al top-n por recencia después de cada
  // uno (lo retenido queda acotado por n + el chat más grande).
  const match = (low, every) => (every ? terms.every((t) => low.includes(t)) : terms.some((t) => low.includes(t)));
  const podar = (arr) => { arr.sort((a, b) => b.ts - a.ts); return arr.slice(0, n); };
  let hitsTodos = [];
  let hitsAlguno = [];
  for (const c of propios) {
    const msgs = mensajesDe(c.id);
    // (las respuestas del agente no llevan hora propia: toman la del mensaje
    // que respondieron, no la de la última actividad del chat)
    let hora = c.creado || 0;
    msgs.forEach((m, i) => {
      if (m?.t) hora = m.t;
      const texto = textoDe(m);
      if (!texto) return;
      const low = texto.toLowerCase();
      const row = { chat: c.id, title: c.titulo || 'Untitled', n: i + 1, ts: hora, who: quien(m), content: texto };
      if (match(low, true)) hitsTodos.push(row);
      else if (terms.length > 1 && match(low, false)) hitsAlguno.push(row);
    });
    hitsTodos = podar(hitsTodos);
    hitsAlguno = podar(hitsAlguno);
  }
  const hits = hitsTodos.length ? hitsTodos : hitsAlguno;
  if (!hits.length) return `No messages matching "${terms.join(' ')}" in ${sc === 'current' ? 'this chat' : sc === 'all' ? 'your chats' : 'your other chats'}.`;

  // Agrupado por chat (los chats, por recencia); adentro de cada uno, en el
  // orden en que se dijo.
  const porChat = new Map();
  for (const r of hits) {
    if (!porChat.has(r.chat)) porChat.set(r.chat, { title: r.title, rows: [] });
    porChat.get(r.chat).rows.push(r);
  }
  const cuerpo = [...porChat.entries()].map(([id, c]) => `[Chat "${c.title}" · id ${id}]\n${c.rows.sort((a, b) => a.n - b.n).map((r) => `  #${r.n} [${chatStamp(r.ts)}] ${r.who}: ${chatSnippet(r.content, terms)}`).join('\n')}`).join('\n\n');
  const pie = hitsTodos.length ? '' : `\n\n(No message has all of "${terms.join(' ')}"; these have some of them.)`;
  const out = `${cuerpo}${pie}\n\nTo read around a match: chat_read with the chat id and around: <message number>.`;
  return out.length > BUSQUEDA_MAX ? out.slice(0, BUSQUEDA_MAX) + '\n…[truncated]' : out;
}

// Un mensaje, en una línea de cabecera y su texto. Las tools, en una línea.
function renglon(m, i) {
  const cuando = m.t ? ` [${chatStamp(m.t)}]` : '';
  if (m.rol === 'tool') {
    const que = String(m.texto ?? '').replace(/\s+/g, ' ').trim();
    return `#${i + 1}${cuando} tool ${m.tool ?? '?'} (${m.estado ?? '?'})${que ? `: ${que.slice(0, 200)}` : ''}`;
  }
  if (m.rol !== 'user' && m.rol !== 'assistant') return null;
  let texto = typeof m.texto === 'string' ? m.texto.trim() : '';
  const marcas = [];
  if (Array.isArray(m.imagenes) && m.imagenes.length) marcas.push(`[${m.imagenes.length} image${m.imagenes.length === 1 ? '' : 's'}]`);
  if (Array.isArray(m.archivos) && m.archivos.length) marcas.push(...m.archivos.map((f) => `[file: ${f?.name ?? 'file'}]`));
  if (m.rol === 'assistant' && m.estado && m.estado !== 'ok') marcas.push(`[${m.estado}]`);
  if (texto.length > MENSAJE_MAX) texto = `${texto.slice(0, MENSAJE_MAX)}… [message cut: ${texto.length - MENSAJE_MAX} more characters]`;
  return `#${i + 1}${cuando} ${m.rol}:${marcas.length ? ' ' + marcas.join(' ') : ''}${texto ? `\n${texto}` : ''}`;
}

async function runChatRead(run, { id, from, to, around } = {}) {
  if (!lista()) return SIN_CHATS;
  const agente = typeof run.agente === 'string' && run.agente ? run.agente : null;
  if (!agente) return SIN_AGENTE;
  const chatId = String(id ?? '').trim();
  if (!chatId) return 'error: id is required — the chat id from chat_search';
  // Solo un chat de este agente. Uno ajeno o inventado da el mismo error: no
  // se dice si existe.
  const c = chatsDe(agente).find((x) => x.id === chatId);
  if (!c) return `error: none of your chats has the id ${JSON.stringify(chatId)} — use chat_search to find it`;
  run.notify('tool:activity', { reqId: run.reqId, kind: 'chat_read', label: c.titulo || 'Untitled' });
  const msgs = mensajesDe(chatId);
  const total = msgs.length;
  if (!total) return `Chat "${c.titulo || 'Untitled'}" (id ${chatId}) has no messages.`;

  const entero = (v) => (v == null || v === '' ? null : Math.trunc(Number(v)));
  let a; let b;
  const cerca = entero(around);
  if (cerca !== null && Number.isFinite(cerca)) {
    a = cerca - ALREDEDOR; b = cerca + ALREDEDOR;
  } else {
    a = entero(from) ?? 1;
    b = entero(to) ?? total;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'error: from, to and around are message numbers (1 is the first)';
  a = Math.max(1, Math.min(total, a));
  b = Math.max(a, Math.min(total, b));

  const partes = [];
  let usado = 0;
  let ultimo = a - 1;
  for (let i = a - 1; i < b; i++) {
    const r = renglon(msgs[i], i);
    if (!r) { ultimo = i + 1; continue; }
    if (partes.length && usado + r.length > LECTURA_MAX) break;
    partes.push(r);
    usado += r.length + 2;
    ultimo = i + 1;
  }
  const cabeza = `Chat "${c.titulo || 'Untitled'}" (id ${chatId}) · ${total} messages · showing #${a}–#${ultimo}`;
  const siguen = ultimo < b ? `\n\n[page full — continue with from: ${ultimo + 1}${b < total ? `, to: ${b}` : ''}]`
    : ultimo < total ? `\n\n[${total - ultimo} more message${total - ultimo === 1 ? '' : 's'} after this — from: ${ultimo + 1}]` : '';
  return `${cabeza}\n\n${partes.join('\n\n')}${siguen}`;
}

module.exports = {
  runners: {
    chat_search: (run, a) => runChatSearch(run, a ?? {}),
    chat_read: (run, a) => runChatRead(run, a ?? {}),
  },
  configurar,
  /** ¿Hay chats configurados? Sin ellos, las dos tools no se ofrecen. */
  lista,
  /** El agente dueño de un chat, o null (lo usa el canvas: leer uno de otro chat del mismo agente). */
  agenteDe: (chatId) => { try { return (deps.lista() ?? []).find((c) => c?.id === chatId)?.agente ?? null; } catch { return null; } },
  // (para los tests)
  _: { chatSearchTerms, chatSnippet, renglon },
};
