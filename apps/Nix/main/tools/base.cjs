'use strict';

// La base que comparten las tools de Nix: el directorio de trabajo de una
// corrida, la escritura atómica, el acumulador acotado para la salida de un
// proceso y cómo se mata su árbol.
//
// Portado de NeonCode 1.11.3 (main.js), tal cual estaba escrito: los
// comentarios que explican cada decisión vienen con el código. Lo único que
// cambia es que acá es un módulo y no un tramo de un archivo grande.
//
// EL CONTRATO DE UNA TOOL (el mismo de NeonCode, para que el código portado
// no cambie):
//
//   runner(run, args) -> Promise<string>
//
//   - Devuelve el TEXTO que lee el modelo. Un fracaso se devuelve como texto
//     que empieza con «error: …» (no se tira); si tira, el despachador lo
//     convierte en eso.
//   - `run` es la corrida (un turno de un chat):
//       run.reqId     el id del pedido
//       run.ac        AbortController: run.ac.signal se aborta con Stop
//       run.convoId   el id del chat
//       run.cwd       el directorio de trabajo de ESTA corrida (lo maneja cwdDe)
//       run.notify(canal, datos)   avisa a la interfaz. Antes de ejecutar,
//                     cada runner manda run.notify('tool:activity',
//                     { reqId: run.reqId, kind: '<nombre de la tool>', label: '<qué va a tocar>' })
//       run.steps     el registro de lo que corrió (lo escribe el despachador)
//   - Lo que una tool necesita de la app (una llave, la papelera, la config)
//     le llega por configurar({ … }) de su módulo, nunca por un global.

const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Escritura atómica: va a un temporal, se fuerza a disco y se renombra encima
// (el rename es atómico en NTFS), así un corte nunca deja un archivo a medio
// escribir. Las dos cosas hacen falta y el fsync faltaba: ver más abajo.
//
// El temporal lleva pid + contador porque el de nombre fijo se rompía de dos
// formas, las dos EN SILENCIO:
//   - Dos escrituras a la vez sobre el mismo archivo compartían el `.tmp`: la
//     primera renombraba y la segunda se quedaba sin archivo (ENOENT). Su
//     guardado se perdía sin que nada lo dijera y el renderer se comía una
//     promesa rechazada sin catch. Se llega clickeando rápido las flechitas de un
//     num-field (cada click es su propio config:set) o con dos chats llamando
//     `remember` a la vez — la unidad de trabajo es el chat, y hay varios.
//   - Dos PROCESOS sobre el mismo data/: el modo captura no toma el lock de
//     instancia única, así que puede escribir donde la app abierta.
//
// Y la cola por archivo es la que garantiza el ORDEN. Sin ella las dos
// escrituras salen igual, pero el archivo queda con la que renombre última, que
// no es necesariamente la última que pediste.
let tmpSeq = 0;

const writeQueue = new Map(); // archivo -> promesa de la última escritura encolada

function atomicWriteText(file, text) {
  const prev = writeQueue.get(file) || Promise.resolve();
  // el eslabón se traga el error del anterior a propósito: una escritura que
  // falla no puede cortar la cadena y dejar ese archivo sin poder escribirse
  // nunca más. Quien pidió LA que falló igual recibe su rechazo (ver return).
  const next = prev.catch(() => {}).then(async () => {
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
    let fh = null;
    try {
      fh = await fsp.open(tmp, 'w');
      await fh.writeFile(text, 'utf8');
      // fsync ANTES del rename, y no es opcional: el rename es atómico, pero eso
      // garantiza que nadie vea un archivo A MEDIAS, no que los datos del
      // temporal hayan llegado al disco. Con el contenido todavía en el cache
      // del sistema, un corte de luz puede dejar asentado el rename y el archivo
      // renombrado lleno de ceros — exactamente el final que el comentario de
      // arriba declaraba imposible, servido por el otro lado.
      await fh.sync();
      await fh.close();
      fh = null;
      await fsp.rename(tmp, file);
    } catch (err) {
      if (fh) await fh.close().catch(() => { /* ya cerrado */ });
      await fsp.unlink(tmp).catch(() => {}); // un rename fallido no deja basura al lado
      throw err;
    }
  });
  writeQueue.set(file, next);
  // la entrada se saca cuando ESTA era la última encolada; si no, el Map se
  // queda con un path por cada chat guardado, para siempre
  next.catch(() => {}).then(() => { if (writeQueue.get(file) === next) writeQueue.delete(file); });
  return next;
}

const SHELL_MAX_TIMEOUT = 120000; // techo duro 2 min

const SHELL_MAX_CHARS = 10000;

// El "directorio actual" de la sesión. Era UNA variable de módulo compartida por
// shell_exec, cmd_exec, fs_read, fs_write, fs_edit, fs_delete, code_search,
// os_open, sqlite_query y el contexto del system prompt — y no hay nada que
// serialice las corridas: dos chats pueden contestar a la vez, bridgeRunTurn no
// consulta `inflight` antes de arrancar y `tasks:runNow` solo mira taskRunning.
// El chat A dejaba el cwd en C:\proj-a, el chat B lo movía a C:\proj-b mientras
// A esperaba al proveedor, y la ronda siguiente de A resolvía 'src/index.js'
// contra el proyecto equivocado: la tarjeta mostraba la ruta ya envenenada y el
// ledger lo registraba como éxito.
//
// Ahora el cwd vive en el `run`: dentro de un turno nadie se lo puede mover por
// abajo. El global queda como el valor con el que ARRANCA el turno siguiente
// —que es lo que hace persistir el `cd` entre turnos, la razón de que esto
// exista— y como el que lee envContext, que no tiene run.
let persistentCwd = os.homedir();

/** El cwd de ESTA corrida. Se engancha del global la primera vez que el turno
 *  pregunta, y de ahí en más es suyo hasta que termine. */
function cwdDe(run) {
  if (!run) return persistentCwd;
  if (typeof run.cwd !== 'string') run.cwd = persistentCwd;
  return run.cwd;
}

/** Resuelve una ruta contra el cwd de la corrida. Reemplaza a los
 *  `path.resolve(persistentCwd, …)` que estaban repartidos por cada runner. */
const resolverEn = (run, p) => path.resolve(cwdDe(run), String(p));

function truncateOut(s) {
  if (s.length <= SHELL_MAX_CHARS) return s;
  return `${s.slice(0, 6000)}\n\n…[${s.length - 8000} chars omitted]…\n\n${s.slice(-2000)}`;
}

// Acumulador acotado para la salida de un proceso: guarda la CABEZA, una cola
// rodante y el total, y tira el medio A MEDIDA QUE LLEGA.
//
// Antes esto era `out += d` a secas y el único recorte llegaba en el 'close',
// cuando la memoria ya se había gastado toda: el techo era el RELOJ (30s por
// defecto, 120s de tope duro), así que un `Get-ChildItem C:\ -Recurse` escupía
// a stdout todo lo que pudiera durante dos minutos y cada chunk se concatenaba,
// cientos de MB en el heap del main, para quedarse al final con 8000
// caracteres. Todo lo demás del archivo sí acota lo que lee —boundedErrorBody
// corta en 64 KB, FS_READ_TOTAL_CHARS en 12000, el worker de code_search en
// 2 MB por archivo—: esto era la excepción.
//
// Se guardan las dos puntas y no solo el principio porque el final es donde
// vive el error: cortar de más para adelante deja al modelo con el arranque de
// un build y sin la línea que dice por qué falló.
//
// `maxChars` lo pone el llamador, como el `maxLen` de splitMessage: entre un
// shell (texto para leer) y el worker de code_search (JSON para parsear) lo que
// cambia es el tope, no la rutina.
function boundedSink(maxChars) {
  const maxCabeza = Math.floor(maxChars * 0.75);
  const maxCola = maxChars - maxCabeza;
  let cabeza = '';
  let cola = '';
  let total = 0;
  return {
    push(chunk) {
      const s = String(chunk);
      if (!s) return;
      total += s.length;
      if (cabeza.length < maxCabeza) cabeza += s.slice(0, maxCabeza - cabeza.length);
      cola = s.length >= maxCola ? s.slice(-maxCola) : (cola + s).slice(-maxCola);
    },
    get total() { return total; },
    get cortado() { return total > maxChars; },
    /** Lo acumulado. Por debajo del tope las dos puntas se solapan y se
     *  reconstruye el texto ENTERO; por arriba, el hueco se anuncia con el
     *  total de verdad — el que se vio pasar, no el que sobrevivió. */
    text() {
      if (total <= maxChars) return cabeza + cola.slice(cabeza.length - (total - cola.length));
      return `${cabeza}\n\n…[${total - cabeza.length - cola.length} chars omitted]…\n\n${cola}`;
    },
  };
}

function killTree(child) {
  // taskkill /T baja el árbol entero (un `npm start` deja hijos que sobreviven al shell)
  try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ya murió */ }
}

// resuelve contra el cwd persistente; un cwd explícito inexistente FALLA y uno
// válido mueve el cwd compartido (el "directorio actual" de la sesión)
function resolveCwd(run, cwd) {
  if (!cwd || !String(cwd).trim()) return cwdDe(run);
  const abs = path.resolve(cwdDe(run), String(cwd));
  if (!fs.existsSync(abs)) throw new Error(`cwd does not exist: ${abs}`);
  // TIENE que ser un directorio. Sin este chequeo, un `cwd` que apuntaba a un
  // archivo pasaba `existsSync` y se guardaba en `persistentCwd`, que es
  // COMPARTIDO por shell_exec, fs_* y os_open: a partir de ahí todo se resolvía
  // contra una ruta imposible y cada comando siguiente fallaba con un error del
  // sistema que no nombraba la causa. Y como el cwd persiste, no se arreglaba
  // solo — había que adivinar que estaba envenenado.
  if (!fs.statSync(abs).isDirectory()) throw new Error(`cwd is not a directory: ${abs}`);
  if (run) run.cwd = abs;
  persistentCwd = abs; // el turno SIGUIENTE arranca acá: así es como persiste el `cd`
  return abs;
}

/** El directorio donde arranca el turno siguiente (lo mueve resolveCwd). */
const getCwd = () => persistentCwd;
/** Lo fija desde afuera: al abrir la app, con el que quedó guardado. Uno que
 *  no existe o no es una carpeta se ignora. */
function setCwd(dir) {
  try {
    if (dir && fs.statSync(dir).isDirectory()) { persistentCwd = path.resolve(dir); return true; }
  } catch { /* no existe: queda el que estaba */ }
  return false;
}

module.exports = {
  atomicWriteText, SHELL_MAX_CHARS, SHELL_MAX_TIMEOUT, cwdDe, resolverEn, truncateOut,
  boundedSink, killTree, resolveCwd, getCwd, setCwd,
};
