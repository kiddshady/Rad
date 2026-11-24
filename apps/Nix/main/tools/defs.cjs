'use strict';

// Las tools que Nix le ofrece al modelo: nombre, para qué sirve y qué
// argumentos lleva. De acá se derivan los DOS formatos (el de Anthropic y el
// de OpenAI, que es el de Venice), así el schema vive una sola vez.
//
// Las definiciones vienen del TOOL_DEFS de NeonCode 1.11.3, tal cual estaban
// escritas: cada descripción está afinada contra errores que los modelos
// cometían de verdad, y el comentario que algunas llevan adentro cuenta cuál.
// Por ahora: archivos y búsqueda, comandos y jobs, código, bases de datos,
// web, abrir cosas en el escritorio, y mirar la pantalla.

const TOOL_DEFS = [{
  name: 'fs_read',
  description: 'Read up to 10 text files at once and return their contents. A directory path returns its listing instead. Paths resolve against the current working directory.',
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: 'File or directory paths to read (max 10).' },
    },
    required: ['paths'],
  },
}, {
  name: 'fs_write',
  description: 'Write a text file (creating parent folders), or append to it. Writing REPLACES the whole file, so use this to CREATE a file or to replace one wholesale — to change part of a file that already exists, use fs_edit instead.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Target file path (absolute, or relative to the current working directory).' },
      content: { type: 'string', description: 'The text content to write.' },
      append: { type: 'boolean', description: 'Append instead of overwrite. Default false.' },
    },
    required: ['path', 'content'],
  },
}, {
  // La razón de ser de esta tool es que fs_write, para MODIFICAR, obliga a
  // reemitir el archivo entero: 7000 líneas para tocar una. Contra un modelo
  // local eso no es caro, es inviable — reescribe de memoria y se le caen
  // funciones del medio, y el resultado es un archivo plausible al que le falta
  // algo. Acá lo que viaja es el pedazo, y lo que no se nombra no se puede
  // perder.
  name: 'fs_edit',
  description: 'Change PART of an existing text file by replacing exact snippets — this is the normal way to modify a file, and you should reach for it instead of rewriting the whole thing with fs_write. '
    + 'Pass `path` and `edits`: a list of { old, new } where `old` is the exact text to find (whitespace and indentation included, copied from what you actually read) and `new` is what replaces it. '
    + 'Each `old` must appear EXACTLY ONCE in the file — include the surrounding lines until it is unique, or pass replace_all:true to change every occurrence. '
    + 'All edits are applied in order and it is all-or-nothing: if any one of them is not found (or is ambiguous), the file is left completely untouched and you get told which edit failed. '
    + 'The file must already exist; use fs_write to create one. Line endings and encoding are preserved. When it asks for confirmation, the card shows a diff of exactly what changes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to edit (absolute, or relative to the current working directory). It must already exist.' },
      edits: {
        type: 'array',
        description: 'The replacements to apply, in order.',
        items: {
          type: 'object',
          properties: {
            old: { type: 'string', description: 'Exact text to find, copied verbatim from the file — including indentation and line breaks. Must match once.' },
            new: { type: 'string', description: 'Text to put in its place. Use an empty string to delete the snippet.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence of THIS snippet instead of requiring it to be unique (default false). Overrides the call-level replace_all.' },
          },
          required: ['old', 'new'],
        },
      },
      replace_all: { type: 'boolean', description: 'Replace every occurrence of each `old` instead of requiring it to be unique (default false). Can also be set per edit.' },
    },
    required: ['path', 'edits'],
  },
}, {
  name: 'fs_delete',
  description: "Move a file to the Windows Recycle Bin. Moving a directory (with everything inside) requires force=true. Nothing is erased permanently: the user can restore it from the Recycle Bin, so tell them that rather than saying it is gone for good. If the Recycle Bin is unavailable (a network drive, some removable volumes) the call FAILS and nothing is removed — report that instead of retrying with another tool.",
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to remove (absolute, or relative to the current working directory).' },
      force: { type: 'boolean', description: 'Required true to move a directory and its contents.' },
    },
    required: ['path'],
  },
}, {
  name: 'code_search',
  description: 'Search files for text or list files by name, recursively. mode "content": find lines matching `pattern` (literal by default; regex=true for a regular expression) → file:line: matches. mode "files": list file paths matching a `glob`. Skips node_modules/.git/build and binary files. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['content', 'files'], description: 'content = grep contents; files = list by name.' },
      pattern: { type: 'string', description: 'text or regex to find (required for mode "content").' },
      glob: { type: 'string', description: 'limit to files matching this glob, e.g. "*.js" or "**/*.ts" (required for mode "files").' },
      path: { type: 'string', description: 'directory to search, or a single file to search inside (default: current working directory).' },
      regex: { type: 'boolean', description: 'treat pattern as a regular expression (default false = literal).' },
      case_sensitive: { type: 'boolean', description: 'case-sensitive match (default false).' },
      max_results: { type: 'number', description: 'max results (default 100, max 1000).' },
    },
    required: ['mode'],
  },
}, {
  name: 'shell_exec',
  description: "Run a PowerShell command on the user's Windows machine and return its output. The working directory persists between shell/cmd/file calls.",
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The PowerShell command to run.' },
      cwd: { type: 'string', description: 'Working directory (absolute, or relative to the current one). Must exist.' },
      timeout: { type: 'number', description: 'Seconds before the process is killed. Default 30, max 120.' },
    },
    required: ['command'],
  },
}, {
  name: 'cmd_exec',
  description: "Run a cmd.exe command on the user's Windows machine and return its output. The working directory persists between shell/cmd/file calls.",
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The cmd.exe command to run.' },
      cwd: { type: 'string', description: 'Working directory (absolute, or relative to the current one). Must exist.' },
      timeout: { type: 'number', description: 'Seconds before the process is killed. Default 30, max 120.' },
    },
    required: ['command'],
  },
}, {
  name: 'job_start',
  description: "Start a PowerShell command as a BACKGROUND job and return at once with its id — for dev servers, long builds, watchers, scans and anything else that runs longer than 2 minutes or never exits. The job keeps running after your turn ends. Read its output with job_output; stop it with job_kill. It has no stdin: interactive prompts get end-of-input.",
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The PowerShell command to run, e.g. "npm run dev".' },
      cwd: { type: 'string', description: 'Working directory (absolute, or relative to the current one). Must exist.' },
      name: { type: 'string', description: 'Optional short label for the job, e.g. "vite".' },
    },
    required: ['command'],
  },
}, {
  name: 'job_output',
  description: "Read a background job's output: what it printed SINCE THE LAST READ, plus whether it is still running or how it exited. While it runs, it also lists the job's live process tree and the windows that tree has open — so you can tell whether an app that logs nothing actually opened its window. Call it with no id to list every job. With wait > 0 it blocks until the job exits, until `until` shows up in the new output, or until the seconds run out — use that to wait for a server to be ready instead of polling.",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The job id exactly as job_start returned it, e.g. "j1-k3f". Omit to list all jobs.' },
      wait: { type: 'number', description: 'Seconds to wait for the job to exit or for `until` to appear (max 60). Default 0: read right away.' },
      until: { type: 'string', description: 'Text or regex (case-insensitive) to wait for in the new output, e.g. "ready|listening|error".' },
      all: { type: 'boolean', description: 'Return the last part of the whole output instead of only what is new.' },
    },
    required: [],
  },
}, {
  name: 'job_kill',
  description: 'Stop a background job started with job_start: kills its whole process tree, says which processes it killed and warns if any of them is still alive, and returns its last output.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The job id exactly as job_start returned it, e.g. "j1-k3f".' },
    },
    required: ['id'],
  },
}, {
  name: 'run_code',
  description: "Run a Python or Node.js snippet and get back its stdout/stderr plus any files it produced. The code runs in a PERSISTENT workspace directory (its working directory) — save plots/CSVs/images to the current directory and they are kept and reported back by absolute path. For Python, pass `pip` to install packages into a persistent workspace virtualenv (cached across calls) — e.g. matplotlib for charts.",
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['python', 'node'], description: 'which runtime to use.' },
      code: { type: 'string', description: 'the source code to execute.' },
      pip: { type: 'array', items: { type: 'string' }, description: 'Python only: package names to pip-install before running (e.g. ["pandas","matplotlib"]).' },
      timeout: { type: 'number', description: 'seconds before the code is killed (default 30, max 120).' },
    },
    required: ['language', 'code'],
  },
}, {
  name: 'db_query',
  description: "Run SQL on YOUR own private SQLite database (agent.db). It is yours alone: create tables freely and use it for structured data worth keeping — lists, logs, trackers, indexes. One statement per call with optional ? params (SELECT returns rows as JSON); multi-statement DDL scripts are allowed. The database persists across chats and scheduled runs.",
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: "the SQL to run, e.g. CREATE TABLE, INSERT with ? placeholders, SELECT." },
      params: { type: 'array', items: {}, description: 'values for the ? placeholders, in order (optional).' },
    },
    required: ['sql'],
  },
}, {
  // Hermana de db_query y no su reemplazo: db_query es la base PROPIA del agente
  // (agent.db, fuera de DANGER porque no toca nada del sistema); ésta abre
  // cualquier .db del disco, incluidas las de la app y las del usuario, y por eso
  // es DANGER. La distinción es la misma que hay entre el workspace de run_code y
  // fs_write sobre cualquier ruta. (Confirmar la decide el MODO, como en todas:
  // en manual las dos preguntan, en auto ninguna — DANGER gobierna el sandbox.)
  name: 'sqlite_query',
  description: 'Run a SQL statement against a SQLite database FILE on disk (any .db/.sqlite the user can reach) and return the rows (SELECT/PRAGMA) or the number of rows changed (INSERT/UPDATE/DELETE/DDL). Pass `db` (path to the file, which must already exist — this never creates one), `sql` (one statement) and optional `params` for the ? placeholders. Set `readonly: true` to open it read-only so any write fails; prefer that whenever you are only reading. For your OWN scratch data use db_query instead — this one is for existing databases.',
  parameters: {
    type: 'object',
    properties: {
      db: { type: 'string', description: 'path to the SQLite database file (absolute, or relative to the workspace). The file must already exist.' },
      sql: { type: 'string', description: 'a single SQL statement. Use ? placeholders together with `params` for values.' },
      params: { type: 'array', items: {}, description: 'values for the ? placeholders, in order (optional).' },
      readonly: { type: 'boolean', description: 'open the database read-only (default false) — any write statement then fails.' },
    },
    required: ['db', 'sql'],
  },
}, {
  name: 'fetch',
  description: 'Fetch a web page or HTTP(S) resource by URL and return its content as readable text. Use for live or external information.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http:// or https:// URL to fetch.' },
    },
    required: ['url'],
  },
}, {
  name: 'web_search',
  description: 'Search the public web for current or factual information. Returns a numbered list of titles, snippets and URLs. Use fetch afterwards to read a full page from the results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'the search query' },
      count: { type: 'integer', description: 'how many results (1-10, default from Settings)' },
    },
    required: ['query'],
  },
}, {
  name: 'http_request',
  description: 'Make an HTTP(S) request to any URL and get back the status, the main response headers and the (truncated) body. Use it to talk to REST APIs, webhooks or data endpoints. Set `method` (GET/POST/PUT/PATCH/DELETE/HEAD), `url`, optional `headers` (a JSON object) and `body` (a string — for JSON send the JSON text and set the Content-Type header). To use a secret API key WITHOUT exposing it, put the placeholder {{secret:NAME}} in a header, the url or the body, and have the user store the value under that name in Settings; it is substituted at call time and never comes back to you. GET and HEAD auto-retry transient failures (429/5xx); writes are never retried. A non-2xx response is reported but does NOT mean success — always read the status before trusting the body. To READ a web page as text, use `fetch` instead: this one returns the raw body.',
  parameters: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method (default GET).' },
      url: { type: 'string', description: 'the full URL (must start with http:// or https://). May contain a {{secret:NAME}} placeholder.' },
      headers: { type: 'object', description: 'request headers as a JSON object; any value may contain a {{secret:NAME}} placeholder.' },
      body: { type: 'string', description: 'request body for POST/PUT/PATCH (a string; for JSON send the JSON text and set Content-Type: application/json).' },
      timeout: { type: 'integer', description: 'timeout in seconds (default 30, max 120).' },
    },
    required: ['url'],
  },
}, {
  name: 'os_open',
  description: "Open a file, folder, or http(s) URL the way the user would — launch it in its default app (or the browser for a URL). Pass reveal:true to instead highlight a file in Explorer WITHOUT opening it. Use this to SHOW the user a file you just generated (e.g. a chart from run_code). Executables (and anything that resolves to one) are refused: use reveal:true for those.",
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'a file/folder path (absolute or relative to the current directory) or an http(s) URL.' },
      reveal: { type: 'boolean', description: 'true = reveal/highlight the file in Explorer instead of opening it (launches nothing).' },
    },
    required: ['target'],
  },
}, {
  name: 'screen_capture',
  description: "Take a screenshot and look at it. By default captures the primary display; pass `window` to capture one window by (part of) its title, `job` to capture the window of an app you started with job_start (no title guessing), or `display` for another monitor. To zoom into small text, pass `region` in the pixel space of a previous full capture of the same target: the crop comes back at native resolution. The user sees the capture in the chat.",
  parameters: {
    type: 'object',
    properties: {
      window: { type: 'string', description: 'Part of the window title to capture; case, spaces and dashes are ignored (e.g. "Nix", "Visual Studio Code"). If several match, the best one is used and the others are listed. With `job` or `pid`, it picks among that tree\'s windows.' },
      job: { type: 'string', description: 'A job id exactly as job_start returned it, e.g. "j1-k3f": captures the window opened by any process of that job\'s tree.' },
      pid: { type: 'number', description: 'Like `job`, for a process you did not start: captures a window of that process or of its children.' },
      wait: { type: 'number', description: 'Seconds to wait for the window to appear before giving up (max 30). Use it right after job_start, while the app is still opening.' },
      display: { type: 'number', description: 'Which monitor, 1-based (1 = primary). Ignored when `window`, `job` or `pid` is given.' },
      region: {
        type: 'object',
        description: 'Crop, in pixels of the full capture of the same target as you received it.',
        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
        required: ['x', 'y', 'width', 'height'],
      },
    },
    required: [],
  },
}];

// Los grupos con que se prenden y se apagan en un agente.
const GRUPOS = [
  { id: 'files', nombre: 'Files', tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_delete', 'code_search'] },
  { id: 'commands', nombre: 'Commands', tools: ['shell_exec', 'cmd_exec', 'job_start', 'job_output', 'job_kill'] },
  { id: 'code', nombre: 'Code', tools: ['run_code'] },
  { id: 'data', nombre: 'Databases', tools: ['db_query', 'sqlite_query'] },
  { id: 'web', nombre: 'Web', tools: ['fetch', 'web_search', 'http_request'] },
  { id: 'desktop', nombre: 'Desktop', tools: ['os_open'] },
  // sola en su grupo: la pantalla es lo más privado que una tool puede mirar
  { id: 'screen', nombre: 'Screen', tools: ['screen_capture'] },
];

const porNombre = new Map(TOOL_DEFS.map((t) => [t.name, t]));
const existe = (name) => porNombre.has(name);

/** El formato de OpenAI (Venice): { type: 'function', function: { … } }. */
const paraOpenAI = (names) => names.filter(existe).map((n) => {
  const t = porNombre.get(n);
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
});

/** El formato de Anthropic. eager_input_streaming: los argumentos largos (un
 *  archivo entero) llegan mientras se generan, en vez de después de un silencio
 *  de minutos. A cambio la API ya no los valida: lo hace validar(), antes de
 *  correr la tool. */
const paraAnthropic = (names) => names.filter(existe).map((n) => {
  const t = porNombre.get(n);
  return { name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true };
});

/**
 * ¿Los argumentos tienen la forma que pide la tool? No es un validador de JSON
 * Schema completo: mira que sea un objeto, que estén los obligatorios y que
 * el tipo de cada argumento conocido sea el declarado. Es lo que atrapa unos
 * argumentos cortados o mal armados antes de que la tool corra con ellos.
 * Devuelve null si están bien, o el motivo.
 */
function validar(name, args) {
  const t = porNombre.get(name);
  if (!t) return null; // una tool desconocida la rechaza el despachador, con su mensaje
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'the arguments are not a JSON object';
  const { properties = {}, required = [] } = t.parameters;
  for (const k of required) if (args[k] === undefined || args[k] === null) return `missing required argument "${k}"`;
  const es = { string: (v) => typeof v === 'string', number: (v) => typeof v === 'number', integer: (v) => typeof v === 'number',
    boolean: (v) => typeof v === 'boolean', array: Array.isArray, object: (v) => v && typeof v === 'object' && !Array.isArray(v) };
  for (const [k, v] of Object.entries(args)) {
    const tipo = properties[k]?.type;
    if (v == null || !tipo || !es[tipo]) continue;
    // los modelos chicos mandan un número como texto, o un texto donde va una
    // lista de uno: los runners ya lo contemplan, así que eso no es un error
    if (tipo === 'number' || tipo === 'integer' || tipo === 'boolean' || tipo === 'array') continue;
    if (!es[tipo](v)) return `argument "${k}" should be ${tipo === 'object' ? 'an object' : `a ${tipo}`}`;
  }
  return null;
}

module.exports = { TOOL_DEFS, GRUPOS, existe, paraOpenAI, paraAnthropic, validar };
