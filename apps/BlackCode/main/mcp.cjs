'use strict';

// Servidores MCP (Model Context Protocol): las tools que no trae la app, las
// trae un servidor que el usuario conecta.
//
// El cliente viene de NeonCode 1.11.3 (mcp.js): el SDK oficial hace el
// handshake, se listan las tools de cada servidor y se le ofrecen al modelo con
// el nombre `mcp_<servidor>_<tool>`. Los comentarios que cuentan por qué existe
// cada cuidado (el sello de cada intento, los nombres que chocan, el corte por
// la señal del turno) vienen con el código.
//
// Lo que BlackCode hace distinto, decidido con Fran el 25/11/2026:
//   - LOCALES Y REMOTOS. Local: un comando que corre en la PC (stdio). Remoto:
//     una URL, con encabezados (un token). Allá el remoto era la URL pelada, y
//     sin token casi ningún servidor remoto sirve. OAuth no está.
//   - LOS SECRETOS VAN CIFRADOS. Las variables de entorno y los encabezados de
//     un servidor suelen ser llaves. Allá iban en claro al config y volvían a la
//     interfaz; acá se cifran (safeStorage, como las llaves de las APIs) y la
//     interfaz solo recibe sus NOMBRES.
//   - PREGUNTAR, POR SERVIDOR. Un servidor es código de terceros. Cada uno trae
//     un interruptor «preguntar antes de cada llamada», prendido al agregarlo:
//     con él, sus tools piden permiso AUNQUE la app esté en modo automático.
//   - APAGADO EN LOS AGENTES. Cada servidor es un grupo de tools opcional: no lo
//     recibe ningún agente hasta que se lo prende. Un agente guarda la marca
//     `mcp:<id>` y no la lista de tools, que cambia cuando el servidor cambia.
//   - SE PUEDE PEGAR EL JSON de `mcpServers` que traen las instrucciones de casi
//     todos los servidores (y el config de Claude Desktop).
//   - Los subagentes no reciben tools de MCP.
//
// Lo que no está: resources y prompts (solo tools), imágenes en el resultado
// (se dicen, no se muestran), OAuth, reconexión sola.

const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

let Client;
let StdioClientTransport;
let SSEClientTransport;
let StreamableHTTPClientTransport;
try {
  ({ Client } = require('@modelcontextprotocol/sdk/client/index.js'));
  ({ StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js'));
  ({ SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js'));
  ({ StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js'));
} catch { /* SDK ausente: MCP queda deshabilitado, la app sigue */ }

const TOOLS_POR_SERVIDOR = 80;   // las que se le ofrecen al modelo de un mismo servidor
const DESCRIPCION_MAX = 900;
const RESULTADO_MAX = 8000;
const ESPERA_LLAMADA_MS = 60000;
const ESPERA_LOCAL_MS = 180000;  // la primera vez npx baja el paquete
const ESPERA_REMOTO_MS = 30000;

// PATH sano para el subproceso: colapsa cualquier casing de PATH a uno solo y
// re-agrega los dirs típicos de node/npm (nvm-windows suele romper esto).
function withNodePath(base) {
  const out = {};
  let pathVal = '';
  for (const k of Object.keys(base)) {
    if (k.toLowerCase() === 'path') { pathVal = base[k] || pathVal; } else { out[k] = base[k]; }
  }
  const extra = [];
  if (process.env.NVM_SYMLINK) extra.push(process.env.NVM_SYMLINK);
  if (process.env.ProgramFiles) extra.push(path.join(process.env.ProgramFiles, 'nodejs'));
  if (process.env.APPDATA) extra.push(path.join(process.env.APPDATA, 'npm'));
  out.PATH = [pathVal, ...extra].filter(Boolean).join(path.delimiter);
  return out;
}

// npx/npm/etc no son ejecutables reales en Windows (son .cmd shims): spawnearlos
// directo falla. Los envolvemos en `cmd.exe /c` para que se resuelva el shim.
function resolveStdioSpawn(command, args) {
  const cmd = String(command || '').trim();
  const low = cmd.toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  const RUNNERS = ['npx', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'uvx', 'uv'];
  if (process.platform === 'win32' && RUNNERS.includes(low)) {
    return { command: 'cmd.exe', args: ['/c', cmd, ...args] };
  }
  return { command: cmd, args };
}

// el content[] de un tool_result MCP → texto; blobs binarios a placeholders
function resultToText(res) {
  const parts = [];
  for (const b of (res && res.content) || []) {
    if (b.type === 'text') parts.push(b.text || '');
    else if (b.type === 'image') parts.push(`[image ${b.mimeType || ''} — binary omitted]`);
    else if (b.type === 'audio') parts.push(`[audio ${b.mimeType || ''} — binary omitted]`);
    else if (b.type === 'resource') parts.push(`[resource ${(b.resource && b.resource.uri) || ''}]`);
    else parts.push(`[${b.type}]`);
  }
  let text = parts.join('\n').trim() || '(no content)';
  if (text.length > RESULTADO_MAX) text = `${text.slice(0, RESULTADO_MAX)}\n…[truncated]`;
  return res && res.isError ? `error: ${text}` : text;
}

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// El nombre con el que la tool viaja al modelo. MCP permite puntos y nombres
// largos, y OpenAI exige ^[a-zA-Z0-9_-]{1,64}$: un solo nombre fuera de eso hacía
// rebotar TODOS los turnos de ese provider hasta apagar el server. Lo que no
// entra se cambia por '_', y lo que se pasa de 64 se corta con un hash corto del
// nombre entero para que dos largos parecidos no choquen. El nombre real sigue
// en spec.toolName, que es el que se usa para llamarla.
function nombreSeguro(prefijo, nombre) {
  const limpio = `${prefijo}${String(nombre || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  if (limpio.length <= 64) return limpio;
  const hash = crypto.createHash('sha1').update(String(nombre)).digest('hex').slice(0, 8);
  return `${limpio.slice(0, 55)}_${hash}`;
}

// Desambigua los nombres FINALES, no los slugs de server: «Foo Bar» con la tool
// `baz` da el mismo nombre que «Foo» con `bar_baz`. Al modelo le viajaban dos
// defs con el mismo nombre y lookup() devolvía el primero: se autorizaba una y
// se ejecutaba otra. El sufijo se hace lugar adentro de los 64.
function desambiguarNombres(specs) {
  const cuenta = {};
  for (const s of specs) cuenta[s.name] = (cuenta[s.name] || 0) + 1;
  if (!Object.values(cuenta).some((n) => n > 1)) return specs;
  const conSufijo = (base, sufijo) => `${base.slice(0, 64 - sufijo.length - 1)}_${sufijo}`;
  const hash = (txt) => crypto.createHash('sha1').update(txt).digest('hex').slice(0, 8);
  const usados = new Set(specs.filter((s) => cuenta[s.name] === 1).map((s) => s.name));
  return specs.map((s) => {
    if (cuenta[s.name] === 1) return s;
    let name = conSufijo(s.name, String(s.serverId).slice(0, 4).replace(/[^a-zA-Z0-9_-]/g, '_'));
    for (let n = 0; usados.has(name); n++) name = conSufijo(s.name, hash(`${s.serverId}\0${s.toolName}\0${n}`));
    usados.add(name);
    return { ...s, name };
  });
}

// ---------- La configuración ----------

const MARCA = 'mcp:';   // lo que guarda un agente por cada servidor que tiene prendido
const NOMBRE_VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NOMBRE_ENCABEZADO = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const texto = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');

/** Un mapa nombre → valor, limpio: solo nombres válidos y valores de texto. */
function mapa(obj, patron) {
  const out = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (patron.test(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v).slice(0, 4000);
    }
  }
  return out;
}

/**
 * Revisa lo que llega de la interfaz (o de un JSON pegado) y lo deja como una
 * entrada. `{ entrada, secretos }` o `{ error, campo }`. En `secretos`, un valor
 * `null` quiere decir «el que ya estaba guardado»: la interfaz no los tiene.
 */
function revisar(e = {}) {
  const nombre = texto(e.nombre, 60);
  if (!nombre) return { error: 'Give the server a name.', campo: 'nombre' };
  const tipo = e.tipo === 'remoto' ? 'remoto' : 'local';
  const limpiarSecretos = (obj, patron, cual) => {
    const out = {};
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (!patron.test(k)) return { error: `${JSON.stringify(k)} is not a valid ${cual} name.` };
        out[k] = v === null ? null : String(v ?? '').slice(0, 4000);
      }
    }
    return { out };
  };
  const base = { nombre, tipo, preguntar: e.preguntar !== false, activo: e.activo !== false };
  if (tipo === 'local') {
    const comando = texto(e.comando, 400);
    if (!comando) return { error: 'A local server needs a command (npx, uvx, node…).', campo: 'comando' };
    const args = (Array.isArray(e.args) ? e.args : []).filter((a) => typeof a === 'string' || typeof a === 'number').map((a) => String(a).slice(0, 2000)).slice(0, 60);
    const env = limpiarSecretos(e.env, NOMBRE_VAR, 'variable');
    if (env.error) return { error: env.error, campo: 'env' };
    return { entrada: { ...base, comando, args }, secretos: { env: env.out, headers: {} } };
  }
  let url;
  try { url = new URL(texto(e.url, 2000)); } catch { return { error: 'That is not a valid URL.', campo: 'url' }; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.|\[::1\])/.test(url.host))) return { error: 'A remote server must be an https address (http only for this PC).', campo: 'url' };
  const headers = limpiarSecretos(e.headers, NOMBRE_ENCABEZADO, 'header');
  if (headers.error) return { error: headers.error, campo: 'headers' };
  return { entrada: { ...base, url: url.href }, secretos: { env: {}, headers: headers.out } };
}

/**
 * El JSON que traen las instrucciones de casi todos los servidores:
 * `{ "mcpServers": { "nombre": { "command", "args", "env" } | { "url", "headers" } } }`.
 * También vale el mapa de adentro solo. Devuelve `{ servidores: [lo que entiende
 * revisar()], errores: [texto] }`; no guarda nada.
 */
function deJson(crudo) {
  let j;
  try { j = JSON.parse(String(crudo ?? '')); } catch { return { servidores: [], errores: ['That is not valid JSON.'] }; }
  const dentro = j && typeof j === 'object' && !Array.isArray(j) ? (j.mcpServers ?? j.servers ?? j) : null;
  if (!dentro || typeof dentro !== 'object' || Array.isArray(dentro)) return { servidores: [], errores: ['There is no "mcpServers" object in that JSON.'] };
  // (un solo servidor pegado sin su nombre: { "command": … })
  const mapaServidores = typeof dentro.command === 'string' || typeof dentro.url === 'string' ? { server: dentro } : dentro;
  const servidores = [];
  const errores = [];
  for (const [nombre, s] of Object.entries(mapaServidores)) {
    if (!s || typeof s !== 'object') { errores.push(`${nombre}: not a server entry.`); continue; }
    const remoto = typeof s.url === 'string' && typeof s.command !== 'string';
    const r = revisar(remoto
      ? { nombre, tipo: 'remoto', url: s.url, headers: s.headers }
      : { nombre, tipo: 'local', comando: s.command, args: s.args, env: s.env });
    if (r.error) errores.push(`${nombre}: ${r.error}`);
    else servidores.push({ ...r.entrada, ...(remoto ? { headers: r.secretos.headers } : { env: r.secretos.env }) });
  }
  if (!servidores.length && !errores.length) errores.push('There are no servers in that JSON.');
  return { servidores, errores };
}

/**
 * Los servidores de la app: su configuración (con los secretos cifrados), sus
 * conexiones y sus tools.
 *
 * @param {object} deps
 *   leer(), escribir(doc)     el documento donde se guardan (reservado: `_mcp`)
 *   cifrar(texto) → string | null, descifrar(blob) → string | null
 *   alCambiar()               cambió algo que la app tiene que volver a mirar
 *   nuevoId()                 (para los tests)
 */
function crear({ leer, escribir, cifrar, descifrar, alCambiar = () => {}, nuevoId = () => crypto.randomBytes(5).toString('hex') } = {}) {
  const eventos = new EventEmitter();
  let servidores = null;          // [{ id, nombre, tipo, comando, args, url, preguntar, activo, secreto }]
  const conns = new Map();        // id → { epoch, client, transport, status, tools, error, name, cortadas }
  let epochActual = 0;

  const cargar = () => {
    if (servidores) return servidores;
    const doc = leer();
    servidores = (Array.isArray(doc?.servidores) ? doc.servidores : []).filter((s) => s && typeof s.id === 'string' && typeof s.nombre === 'string');
    return servidores;
  };
  const guardarDoc = () => escribir({ v: 1, servidores: cargar() });
  // (primero los de adentro —el motor pone al día sus tools— y después la app, que le avisa a la interfaz)
  const avisar = () => { eventos.emit('cambio'); try { alCambiar(); } catch { /* quien escucha no tumba esto */ } };

  /** Los secretos de un servidor, descifrados: { env, headers }. Vacíos si no hay o no se pueden leer. */
  function secretosDe(s) {
    if (!s?.secreto) return { env: {}, headers: {} };
    try {
      const j = JSON.parse(descifrar(s.secreto) ?? 'null');
      return { env: mapa(j?.env, NOMBRE_VAR), headers: mapa(j?.headers, NOMBRE_ENCABEZADO) };
    } catch { return { env: {}, headers: {} }; }
  }

  // ---------- Conectar ----------
  const disponible = () => Boolean(Client);

  async function conectar(id) {
    if (!disponible()) return;
    const s = cargar().find((x) => x.id === id);
    if (!s) return;
    // Sello del intento: si mientras dura el handshake (hasta 180 s en un local)
    // alguien lo quita o lo reconecta, este intento ya no es el vigente y lo que
    // corresponde con su cliente es cerrarlo, no publicarlo. Sin esto quedaba
    // una conexión viva que nadie pidió, con su proceso hijo y sus tools viajando.
    const epoch = ++epochActual;
    const vigente = () => conns.get(id)?.epoch === epoch;
    // «Conectando» se anota ANTES de cerrar la conexión que hubiera: mientras
    // se cerraba, el servidor seguía figurando conectado, con sus tools
    // ofrecidas y cada llamada fallando contra un cliente ya cerrado.
    const previa = conns.get(id);
    conns.set(id, { epoch, client: null, transport: null, status: 'connecting', tools: [], error: null, name: s.nombre, cortadas: 0 });
    avisar();
    if (previa) await soltar(previa);
    if (!vigente()) return;
    let client = null;
    let transport = null;
    try {
      const secretos = secretosDe(s);
      const cliente = () => new Client({ name: 'blackcode', version: '1.0.0' });
      if (s.tipo === 'remoto') {
        const url = new URL(s.url);
        const requestInit = Object.keys(secretos.headers).length ? { headers: secretos.headers } : undefined;
        // Primero el transporte de ahora (Streamable HTTP); si el servidor es de
        // los de antes y no lo habla, el de SSE.
        try {
          client = cliente();
          transport = new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
          await client.connect(transport, { timeout: ESPERA_REMOTO_MS });
        } catch (primero) {
          try { await client?.close(); } catch { /* ya cerrado */ }
          try { await transport?.close(); } catch { /* ya cerrado */ }
          if (!vigente()) return;
          client = cliente();
          transport = new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
          try { await client.connect(transport, { timeout: ESPERA_REMOTO_MS }); } catch { throw primero; }
        }
      } else {
        const args = Array.isArray(s.args) ? s.args : [];
        const env = withNodePath({ ...process.env, ...secretos.env });
        const spec = resolveStdioSpawn(s.comando, args);
        if (!spec.command) throw new Error('no command set for this server');
        client = cliente();
        transport = new StdioClientTransport({ command: spec.command, args: spec.args, env, cwd: os.homedir(), stderr: 'pipe' });
        await client.connect(transport, { timeout: ESPERA_LOCAL_MS });
      }
      // La lista se pagina. Solo «no implementa tools» (-32601) cuenta como lista
      // vacía; cualquier otro error va al estado. Cortan un tope de páginas, una
      // página vacía y un cursor repetido (un servidor que devuelve el mismo
      // cursor dejaba esto pidiendo para siempre).
      const lista = [];
      const vistos = new Set();
      let cursor;
      try {
        for (let pagina = 0; pagina < 50; pagina++) {
          const r = await client.listTools(cursor ? { cursor } : undefined);
          const tanda = r.tools || [];
          lista.push(...tanda);
          cursor = r.nextCursor;
          if (!cursor || !tanda.length || vistos.has(cursor) || lista.length >= 2000) break;
          vistos.add(cursor);
        }
      } catch (e) {
        if (e?.code !== -32601) throw e;
      }
      const todas = lista.filter((tl) => tl && typeof tl.name === 'string' && tl.name).map((tl) => ({
        name: tl.name,
        description: typeof tl.description === 'string' ? tl.description : '',
        inputSchema: (tl.inputSchema && tl.inputSchema.type) ? tl.inputSchema : { type: 'object', properties: {} },
      }));
      if (!vigente()) {
        try { await client.close(); } catch { /* ya cerrado */ }
        try { await transport.close(); } catch { /* ya cerrado */ }
        return;
      }
      // (un servidor con cientos de tools no le llena el contexto al modelo: se
      // ofrecen las primeras, y el estado dice cuántas quedaron afuera)
      conns.set(id, { epoch, client, transport, status: 'connected', tools: todas.slice(0, TOOLS_POR_SERVIDOR), cortadas: Math.max(0, todas.length - TOOLS_POR_SERVIDOR), error: null, name: s.nombre });
      // Un servidor que se muere DESPUÉS de conectar quedaba «conectado» para
      // siempre, con sus tools ofrecidas y cada llamada fallando.
      client.onclose = () => {
        const c = conns.get(id);
        if (!c || c.epoch !== epoch || c.closing) return;
        conns.set(id, { ...c, client: null, transport: null, status: 'error', tools: [], cortadas: 0, error: 'the server closed the connection' });
        avisar();
      };
    } catch (err) {
      if (client) { try { await client.close(); } catch { /* ya cerrado */ } }
      if (transport) { try { await transport.close(); } catch { /* ya cerrado */ } }
      if (!vigente()) return;
      conns.set(id, { epoch, client: null, transport: null, status: 'error', tools: [], cortadas: 0, error: String((err && err.message) || err).slice(0, 400), name: s.nombre });
    }
    avisar();
  }

  /** Cierra una conexión (su cliente y su transporte; un local es un proceso hijo). */
  async function soltar(c) {
    c.closing = true; // este cierre sí se pidió: que onclose no lo marque como error
    if (c.client) { try { await c.client.close(); } catch { /* */ } }
    if (c.transport) { try { await c.transport.close(); } catch { /* */ } }
  }
  async function desconectar(id, callado) {
    const c = conns.get(id);
    if (!c) return;
    // (se saca de la lista antes de cerrarla: deja de ofrecer sus tools en el acto)
    conns.delete(id);
    await soltar(c);
    if (!callado) avisar();
  }

  // ---------- Las tools ----------
  function specs() {
    const out = [];
    const slugs = {};
    for (const [, c] of conns) if (c.status === 'connected') { const sl = slugify(c.name) || 'mcp'; slugs[sl] = (slugs[sl] || 0) + 1; }
    for (const [id, c] of conns) {
      if (c.status !== 'connected') continue;
      let slug = slugify(c.name) || 'mcp';
      if (slugs[slug] > 1) slug += `_${id.slice(0, 4)}`;
      for (const tool of c.tools) {
        out.push({
          name: nombreSeguro(`mcp_${slug}_`, tool.name),
          // (lo que dice una tool de sí misma lo escribió el servidor: va marcado)
          description: `[MCP server "${c.name}"] ${tool.description}`.slice(0, DESCRIPCION_MAX),
          parameters: tool.inputSchema,
          serverId: id,
          serverName: c.name,
          toolName: tool.name,
        });
      }
    }
    return desambiguarNombres(out);
  }
  /** Un nombre que resuelve a MÁS de un spec no resuelve a ninguno. */
  const buscar = (nombre) => { const hits = specs().filter((s) => s.name === nombre); return hits.length === 1 ? hits[0] : null; };

  /** ¿Esa tool pide permiso aunque la app esté en automático? (Su servidor tiene «preguntar».) */
  function pregunta(nombre) {
    if (typeof nombre !== 'string' || !nombre.startsWith('mcp_')) return false;
    const spec = buscar(nombre);
    if (!spec) return true; // una que ya no está no corre sola: que falle a la vista
    return cargar().find((s) => s.id === spec.serverId)?.preguntar !== false;
  }

  /** El runner de todas: la busca, la llama, y devuelve texto. Corta con el Stop del turno. */
  async function correr(nombre, run, args) {
    const spec = buscar(nombre);
    if (!spec) return 'error: that MCP tool is not available any more (its server was removed, turned off or disconnected)';
    const c = conns.get(spec.serverId);
    if (!c || !c.client) return 'error: the MCP server is not connected';
    const signal = run?.ac?.signal;
    if (signal?.aborted) return 'error: the run was stopped before this tool ran';
    run?.notify?.('tool:activity', { reqId: run.reqId, kind: nombre, label: `${spec.serverName} · ${spec.toolName}` });
    try {
      // (RequestOptions como tercer argumento: aborta la request y le avisa al
      // servidor. Con un Promise.race el servidor seguía trabajando para nadie.)
      const res = await c.client.callTool({ name: spec.toolName, arguments: args || {} }, undefined, { signal, timeout: ESPERA_LLAMADA_MS });
      return resultToText(res);
    } catch (err) {
      if (signal?.aborted) return 'error: stopped by the user';
      return `error: ${String((err && err.message) || err)}`;
    }
  }

  /** Los grupos que ve la interfaz: uno por servidor ACTIVO, opcional, con su marca. */
  function grupos() {
    const porServidor = new Map();
    for (const s of specs()) porServidor.set(s.serverId, (porServidor.get(s.serverId) ?? 0) + 1);
    return cargar().filter((s) => s.activo !== false).map((s) => ({
      id: `${MARCA}${s.id}`,
      nombre: `MCP: ${s.nombre}`,
      tools: [`${MARCA}${s.id}`],
      opcional: true,
      mcp: { servidor: s.id, cuenta: porServidor.get(s.id) ?? 0, estado: conns.get(s.id)?.status ?? 'disconnected' },
    }));
  }
  /** Las tools de un agente, con cada marca `mcp:<id>` cambiada por las tools de ese servidor hoy. */
  function expandir(nombres) {
    const lista = specs();
    return (Array.isArray(nombres) ? nombres : []).flatMap((n) => (typeof n === 'string' && n.startsWith(MARCA) ? lista.filter((s) => s.serverId === n.slice(MARCA.length)).map((s) => s.name) : [n]));
  }

  /** Lo que dice la tarjeta de permiso de una llamada: de qué servidor es, y si pregunta siempre. */
  function vista(nombre) {
    const spec = buscar(nombre);
    return spec ? { mode: 'mcp', servidor: spec.serverName, tool: spec.toolName, siempre: pregunta(nombre) } : null;
  }

  // ---------- Lo que ve y hace Settings ----------
  /** El estado de cada servidor, SIN sus secretos: de las variables y los encabezados, solo los nombres. */
  function lista() {
    return cargar().map((s) => {
      const c = conns.get(s.id);
      const secretos = secretosDe(s);
      return {
        id: s.id,
        nombre: s.nombre,
        tipo: s.tipo === 'remoto' ? 'remoto' : 'local',
        comando: s.comando ?? '',
        args: Array.isArray(s.args) ? s.args : [],
        url: s.url ?? '',
        env: Object.keys(secretos.env),
        headers: Object.keys(secretos.headers),
        preguntar: s.preguntar !== false,
        activo: s.activo !== false,
        estado: c?.status ?? 'disconnected',
        tools: (c?.tools ?? []).map((t) => t.name),
        cortadas: c?.cortadas ?? 0,
        error: c?.error ?? null,
      };
    });
  }

  /** Agrega un servidor, o cambia el que tiene ese `id`. Conecta si quedó activo. */
  async function guardar(e = {}) {
    if (!disponible()) return { ok: false, error: 'MCP support is not installed in this build.' };
    const r = revisar(e);
    if (r.error) return { ok: false, error: r.error, campo: r.campo };
    const l = cargar();
    const previo = typeof e.id === 'string' ? l.find((s) => s.id === e.id) : null;
    if (l.some((s) => s !== previo && s.nombre.toLowerCase() === r.entrada.nombre.toLowerCase())) return { ok: false, error: 'There is already a server with that name.', campo: 'nombre' };
    // Los secretos: lo que llega en `null` es «el que ya estaba»; lo demás lo pisa.
    const viejos = secretosDe(previo);
    const mezclar = (nuevos, de) => Object.fromEntries(Object.entries(nuevos).map(([k, v]) => [k, v === null ? de[k] : v]).filter(([, v]) => typeof v === 'string'));
    const secretos = { env: mezclar(r.secretos.env, viejos.env), headers: mezclar(r.secretos.headers, viejos.headers) };
    const hay = Object.keys(secretos.env).length + Object.keys(secretos.headers).length > 0;
    const blob = hay ? cifrar(JSON.stringify(secretos)) : null;
    if (hay && !blob) return { ok: false, error: 'Windows encryption is not available, so the variables of this server cannot be saved safely.' };
    const entrada = { id: previo?.id ?? nuevoId(), ...r.entrada, ...(blob ? { secreto: blob } : {}) };
    if (previo) l[l.indexOf(previo)] = entrada; else l.push(entrada);
    await guardarDoc();
    if (entrada.activo) conectar(entrada.id); else await desconectar(entrada.id);
    avisar();
    return { ok: true, id: entrada.id };
  }

  async function quitar(id) {
    const l = cargar();
    const i = l.findIndex((s) => s.id === id);
    if (i < 0) return { ok: false };
    l.splice(i, 1);
    await guardarDoc();
    await desconectar(id, true);
    avisar();
    return { ok: true };
  }

  async function ajustar(id, cambio = {}) {
    const s = cargar().find((x) => x.id === id);
    if (!s) return { ok: false };
    if (typeof cambio.preguntar === 'boolean') s.preguntar = cambio.preguntar;
    if (typeof cambio.activo === 'boolean') s.activo = cambio.activo;
    await guardarDoc();
    if (typeof cambio.activo === 'boolean') { if (s.activo) conectar(id); else await desconectar(id, true); }
    avisar();
    return { ok: true };
  }

  /** El JSON pegado: agrega cada servidor que entiende. `{ agregados: [nombre], errores: [texto] }`. */
  async function pegar(crudo) {
    const { servidores: nuevos, errores } = deJson(crudo);
    const agregados = [];
    for (const s of nuevos) {
      const r = await guardar(s);
      if (r.ok) agregados.push(s.nombre); else errores.push(`${s.nombre}: ${r.error}`);
    }
    return { agregados, errores };
  }

  return {
    disponible,
    lista,
    guardar,
    pegar,
    vista,
    quitar,
    ajustar,
    reconectar: (id) => (cargar().some((s) => s.id === id) ? conectar(id) : Promise.resolve()),
    /** Al arrancar la app: conecta los activos, todos a la vez (uno lento no frena a los demás). */
    async conectarActivos() { await Promise.all(cargar().filter((s) => s.activo !== false).map((s) => conectar(s.id))); },
    /** Al salir: cierra todo (los locales son procesos hijos, y en Windows sobreviven a la app). */
    async cerrar() { for (const id of [...conns.keys()]) await desconectar(id, true); },
    specs,
    grupos,
    expandir,
    pregunta,
    correr,
    tiene: (nombre) => Boolean(buscar(nombre)),
    on: (ev, fn) => eventos.on(ev, fn),
  };
}

module.exports = { crear, revisar, deJson, resultToText, nombreSeguro, desambiguarNombres, resolveStdioSpawn, withNodePath, slugify, MARCA, TOOLS_POR_SERVIDOR, RESULTADO_MAX };
