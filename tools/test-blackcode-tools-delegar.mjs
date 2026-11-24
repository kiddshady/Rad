// Los subagentes de BlackCode (la tool delegate) con node pelado, sin red y sin
// gastar un token: el proveedor es de mentira y sigue un guion por brief, pero
// la sesión, el despachador y las tools que corren (fs_read, fs_write,
// code_search) son los de verdad, sobre una carpeta descartable.
// Uso: node tools/test-blackcode-tools-delegar.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'apps', 'BlackCode', 'main');

const failures = [];
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) failures.push(msg); };
const igual = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);

const herramientas = require(path.join(MAIN, 'tools', 'index.cjs'));
const motor = require(path.join(MAIN, 'tools', 'motor.cjs'));
const guardas = require(path.join(MAIN, 'tools', 'guardas.cjs'));
const delegar = require(path.join(MAIN, 'tools', 'delegar.cjs'));

const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'blackcode-delegar-'));
fs.writeFileSync(path.join(taller, 'notas.txt'), 'la yerba va en el frasco\n');
fs.mkdirSync(path.join(taller, 'sub'));

// ---------- El proveedor de mentira ----------
// Cada brief tiene su guion: una lista de rondas { say, tools, wait, throws,
// motivo, agotar }. Una ronda sin tools es la última.
const GUIONES = new Map();
const vistos = []; // lo que le llegó al proveedor en cada corrida de un hijo
const dormir = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});
async function responder(pedido, { signal, onTexto, sesion }) {
  const brief = pedido.mensajes[0].texto;
  vistos.push({
    brief,
    pedido,
    nombres: sesion?.nombres ?? [],
    system: sesion ? sesion.sistema(pedido.instrucciones) : pedido.instrucciones,
    cwd: sesion ? herramientasCwd(sesion.run) : null,
    ve: sesion?.run.ve,
  });
  const rondas = GUIONES.get(brief) ?? [{ say: `report about: ${brief}` }];
  for (const r of rondas) {
    if (r.wait) await dormir(r.wait, signal);
    if (signal.aborted) return { motivo: 'frenado' };
    if (r.throws) throw new Error(r.throws);
    if (r.say) onTexto(r.say);
    if (r.agotar) sesion.marcarAgotado();
    if (!r.tools?.length) return { motivo: r.motivo ?? 'fin', uso: { entrada: 5, salida: r.tokens ?? 7 } };
    for (const t of r.tools) await sesion.correr(t.name, t.args);
    sesion.cerrarRonda(r.tools.map((t) => t.name));
    if (signal.aborted) return { motivo: 'frenado' };
  }
  return { motivo: 'fin', uso: { entrada: 5, salida: 7 } };
}
const { cwdDe } = require(path.join(MAIN, 'tools', 'base.cjs'));
const herramientasCwd = (run) => cwdDe(run);

// Con qué corre un hijo: lo decide la app. Acá, lo que diga `destino`.
let destino = { proveedor: 'anthropic', modelo: 'acme/modelo-x', nombre: 'Anthropic', ve: true, error: null };
herramientas.iniciar({ carpeta: taller, trash: async () => {}, subagentes: { destino: () => destino, responder } });
herramientas.setCwd(taller);

const TODAS = ['fs_read', 'fs_write', 'fs_edit', 'code_search', 'shell_exec', 'web_search', 'fetch', 'screen_capture', 'job_output',
  'browser_navigate', 'browser_read', 'browser_click', 'notepad', 'delegate'];

// La corrida del padre: una sesión como la que arma el chat, con los avisos a
// la vista. `confirmar` son las tarjetas (null = modo automático).
function padre({ id = 'req-A', tools = TODAS, confirmar = null } = {}) {
  const eventos = [];
  const ac = new AbortController();
  const tarjetas = [];
  const sesion = herramientas.crearSesion({
    reqId: id,
    convoId: 'chat-1',
    ac,
    tools,
    confirma: () => confirmar !== null,
    notify(canal, datos) { eventos.push({ canal, ...datos, callId: datos.callId ?? this._callId }); },
    async confirm(name, args, callId, quien = null) {
      tarjetas.push({ name, callId, quien });
      return confirmar({ name, args, callId, quien });
    },
  });
  Object.assign(sesion.run, { proveedor: 'anthropic', modelo: 'acme/modelo-x', instrucciones: 'You are Mate, a helpful agent.' });
  return { sesion, run: sesion.run, eventos, ac, tarjetas };
}
const filas = (eventos) => eventos.filter((e) => e.canal === 'tool:activity');
const cierres = (eventos) => eventos.filter((e) => e.canal === 'tool:result');

try {
  // ═══ 1. Qué tools ve un subagente ═══════════════════════════════════════
  {
    const base = { tools: TODAS };
    check(motor.activeToolNames(base).includes('delegate'), 'el padre no ve delegate');
    const full = motor.activeToolNames({ ...base, subagent: { access: 'full' } });
    check(!full.includes('delegate') && full.includes('fs_write') && full.includes('shell_exec') && full.includes('browser_click'),
      `un hijo con acceso completo ve: ${full.join(', ')}`);
    igual(motor.activeToolNames({ ...base, subagent: { access: 'read' } }),
      ['fs_read', 'code_search', 'web_search', 'fetch', 'screen_capture', 'job_output', 'browser_read', 'notepad'], 'un hijo de lectura solo mira');
    const juntos = motor.activeToolNames({ ...base, subagent: { access: 'full', paralelo: true } });
    check(juntos.includes('browser_read') && !juntos.includes('browser_navigate') && !juntos.includes('browser_click') && juntos.includes('fs_write'),
      `hijos a la vez: del navegador solo leen. Ven: ${juntos.join(', ')}`);
  }

  // ═══ 2. Un hijo ══════════════════════════════════════════════════════════
  {
    GUIONES.set('look at notas', [
      { say: 'Reading the file first.', tools: [{ name: 'fs_read', args: { paths: ['notas.txt'] } }] },
      { say: 'Now searching.', tools: [{ name: 'code_search', args: { mode: 'content', pattern: 'yerba' } }] },
      { say: 'The note says the yerba goes in the jar.', tokens: 41 },
    ]);
    vistos.length = 0;
    const p = padre();
    p.run.etiquetaSubagente = 'the same model as you';
    const r = await p.sesion.correr('delegate', { task: 'look at notas' });
    check(!r.error, `delegate con un hijo falló: ${r.out.slice(0, 200)}`);
    const f = filas(p.eventos);
    igual([f[0].kind, f[0].callId, f[0].sub], ['delegate', 'req-A:1', undefined], 'la primera fila es la de delegate, sin `sub`');
    igual(f[0].label, 'modelo-x · look at notas', 'la fila de delegate dice el modelo y el brief');
    igual(f.slice(1).map((e) => [e.kind, e.callId, e.sub, e.subN]), [['fs_read', 'req-A:1.1:1', 'req-A:1', 0], ['code_search', 'req-A:1.1:2', 'req-A:1', 0]],
      'las filas del hijo cuelgan de la de delegate, con su propia numeración');
    igual(cierres(p.eventos).map((e) => [e.callId, e.status, e.sub ?? null]),
      [['req-A:1.1:1', 'ok', 'req-A:1'], ['req-A:1.1:2', 'ok', 'req-A:1'], ['req-A:1', 'ok', null]], 'los cierres: los del hijo marcados, el de delegate no');
    check(/^Subagent report \(modelo-x, fs_read, code_search, \d+ s, 41 output tokens\):\n\nThe note says the yerba goes in the jar\.$/.test(r.out),
      `el informe de un hijo: ${JSON.stringify(r.out)}`);
    check(!r.out.includes('Reading the file first') && !r.out.includes('Now searching'), 'la prosa de entre tools del hijo llegó al padre');
    igual(p.run.steps.map((s) => s.name), ['delegate'], 'los pasos del padre: solo delegate');
    igual(p.sesion.resumen().map((s) => [s.name, s.status]), [['delegate', 'ok']], 'el resumen del turno cuenta una tool');

    // lo que recibió el proveedor del hijo
    const v = vistos[0];
    igual(v.pedido.mensajes, [{ rol: 'user', texto: 'look at notas' }], 'el hijo arranca con el brief y nada más');
    igual([v.pedido.proveedor, v.pedido.modelo, v.pedido.instrucciones], ['anthropic', 'acme/modelo-x', 'You are Mate, a helpful agent.'], 'el hijo: mismo modelo e instrucciones del agente');
    check(v.system.includes('## You are a subagent') && v.system.includes('say where you looked'), 'el system del hijo no trae la nota de subagente');
    check(v.system.includes('Your text between tool calls is NOT shown to anyone'), 'el system del hijo no dice que su prosa se descarta');
    check(!v.system.includes('`delegate`: hand a self-contained'), 'el system del hijo le explica delegate, que no tiene');
    check(!v.nombres.includes('delegate') && v.nombres.includes('fs_read') && !v.nombres.includes('fs_write'), `las tools del hijo de lectura: ${v.nombres.join(', ')}`);
    igual(v.cwd, taller, 'el hijo arranca en la carpeta del padre');
    // y lo que sabe el padre
    const sys = p.sesion.sistema('x');
    check(sys.includes('`delegate`: hand a self-contained chunk of work to a subagent (the same model as you) that starts with an EMPTY context'), 'la guía del padre no dice con qué modelo corre el subagente');
    check(sys.includes('missing, unused, never run or not covered') && sys.includes('unverified'), 'la guía del padre no dice qué verificar del informe');
    check(!sys.includes('## You are a subagent'), 'el padre recibió la nota de subagente');
  }

  // ═══ 3. Varios a la vez ══════════════════════════════════════════════════
  {
    for (const n of ['uno', 'dos', 'tres']) GUIONES.set(n, [{ wait: 150, say: `leo ${n}`, tools: [{ name: 'fs_read', args: { paths: ['notas.txt'] } }] }, { say: `informe ${n}` }]);
    const p = padre();
    const t0 = Date.now();
    const r = await p.sesion.correr('delegate', { tasks: ['uno', 'dos', 'tres'] });
    const tardo = Date.now() - t0;
    check(tardo < 400, `tres hijos de 150 ms tardaron ${tardo} ms: no corrieron a la vez`);
    igual(filas(p.eventos)[0].label, 'modelo-x · 3 tasks', 'la fila de delegate con varios');
    igual(filas(p.eventos).slice(1).map((e) => [e.callId, e.subN]).sort(), [['req-A:1.1:1', 1], ['req-A:1.2:1', 2], ['req-A:1.3:1', 3]], 'cada hijo numera lo suyo');
    const partes = r.out.split('\n\n## ');
    igual(partes.length, 3, 'un bloque por hijo');
    check(/^## Subagent 1 of 3 \(modelo-x, fs_read, \d+ s, 7 output tokens\)\nBrief: uno\n\ninforme uno$/.test(partes[0]), `el primer bloque: ${JSON.stringify(partes[0])}`);
    check(partes[1].startsWith('Subagent 2 of 3') && partes[1].endsWith('informe dos') && partes[2].endsWith('informe tres'), 'los informes no salieron en orden');

    const q = padre();
    igual((await q.sesion.correr('delegate', { tasks: ['a', 'b', 'c', 'd', 'e'] })).out, 'error: at most 4 subagents per call — put the rest in another call', 'más de cuatro');
    igual(q.run.steps[0].status, 'error', 'más de cuatro: la fila queda como falla');
    igual(filas(q.eventos).length, 1, 'más de cuatro: no arrancó ningún hijo');
    igual((await q.sesion.correr('delegate', {})).out, 'error: write the brief in `task` (or several in `tasks`)', 'sin brief');
    // (otra corrida: tres fallas seguidas de la misma tool traen el aviso del corte de bucles)
    igual((await padre().sesion.correr('delegate', { tasks: [], task: '  ' })).out, 'error: write the brief in `task` (or several in `tasks`)', 'con un brief vacío');
    // un modelo chico manda `tasks` como texto: es un brief
    GUIONES.set('solo texto', [{ say: 'ok texto' }]);
    check((await padre().sesion.correr('delegate', { tasks: 'solo texto' })).out.endsWith('ok texto'), '`tasks` como texto no se tomó por un brief');
  }

  // ═══ 4. Solo mirar, o también tocar ══════════════════════════════════════
  {
    const escribir = [{ tools: [{ name: 'fs_write', args: { path: 'nuevo.txt', content: 'hola' } }] }, { say: 'listo' }];
    GUIONES.set('escribir', escribir);
    const p = padre();
    const r = await p.sesion.correr('delegate', { task: 'escribir' });
    check(!fs.existsSync(path.join(taller, 'nuevo.txt')), 'un hijo de lectura escribió un archivo');
    const c = cierres(p.eventos).find((e) => e.callId === 'req-A:1.1:1');
    igual([c.status, c.out], ['error', "error: tool 'fs_write' is not available in this run"], 'fs_write en un hijo de lectura');
    check(r.out.includes('fs_write (1 did not succeed)'), `el informe no cuenta la tool que falló: ${r.out.slice(0, 120)}`);

    const q = padre();
    await q.sesion.correr('delegate', { task: 'escribir', access: 'full' });
    igual(fs.readFileSync(path.join(taller, 'nuevo.txt'), 'utf8'), 'hola', 'un hijo con acceso completo escribe');
    igual(filas(q.eventos)[0].label, 'modelo-x · escribir · full access', 'la fila dice que va con acceso completo');

    // un hijo no delega: ni la ve, ni puede llamarla
    GUIONES.set('delegar', [{ tools: [{ name: 'delegate', args: { task: 'x' } }] }, { say: 'no pude' }]);
    const d = padre();
    await d.sesion.correr('delegate', { task: 'delegar', access: 'full' });
    igual(cierres(d.eventos).find((e) => e.callId === 'req-A:1.1:1').out, "error: tool 'delegate' is not available in this run", 'un hijo que quiere delegar');
    igual(await delegar.runDelegate({ subagent: { access: 'full' }, reqId: 'x', notify() {} }, { task: 'x' }), 'error: a subagent cannot start subagents', 'la defensa de runDelegate');

    // dos a la vez no actúan en el navegador; uno solo, sí lo tiene
    GUIONES.set('clic', [{ tools: [{ name: 'browser_click', args: { ref: 'e1' } }] }, { say: 'x' }]);
    GUIONES.set('nada', [{ say: 'y' }]);
    const b = padre();
    await b.sesion.correr('delegate', { tasks: ['clic', 'nada'], access: 'full' });
    igual(cierres(b.eventos).find((e) => e.callId === 'req-A:1.1:1').out, "error: tool 'browser_click' is not available in this run", 'browser_click con dos hijos a la vez');
    vistos.length = 0;
    await padre().sesion.correr('delegate', { task: 'nada', access: 'full' });
    check(vistos[0].nombres.includes('browser_click'), 'un hijo solo con acceso completo no tiene browser_click');
  }

  // ═══ 5. El Stop del padre corta a los hijos ══════════════════════════════
  {
    for (const n of ['lento 1', 'lento 2']) GUIONES.set(n, [{ say: 'empiezo', tools: [{ name: 'fs_read', args: { paths: ['notas.txt'] } }] }, { wait: 5000, say: 'nunca' }]);
    const p = padre();
    const t0 = Date.now();
    setTimeout(() => p.ac.abort(), 60);
    const r = await p.sesion.correr('delegate', { tasks: ['lento 1', 'lento 2'] });
    check(Date.now() - t0 < 1500, `el Stop no cortó a los hijos: ${Date.now() - t0} ms`);
    igual(r.out.match(/the run was stopped while this subagent was working/g)?.length, 2, 'cada hijo cortado lleva su nota');
    check(!r.out.includes('nunca'), 'un hijo siguió después del Stop');
    igual([p.run.steps[0].status, cierres(p.eventos).at(-1).status], ['aborted', 'aborted'], 'un delegate cortado se lee como cancelado, no como ok');
    check(r.error, 'un delegate cortado no cuenta como éxito');
    // un padre ya frenado: los hijos nacen frenados
    const q = padre();
    q.ac.abort();
    igual((await q.sesion.correr('delegate', { task: 'lento 1' })).out, 'the run was stopped before this tool ran', 'con el Stop ya dado no arranca nada');
  }

  // ═══ 6. Errores ══════════════════════════════════════════════════════════
  {
    GUIONES.set('cae 1', [{ throws: '429 rate limited' }]);
    GUIONES.set('cae 2', [{ throws: '429 rate limited' }]);
    GUIONES.set('anda', [{ say: 'este sí' }]);
    const p = padre();
    const todos = await p.sesion.correr('delegate', { tasks: ['cae 1', 'cae 2'] });
    check(todos.out.startsWith('error: ## Subagent 1 of 2') && todos.out.includes('[this subagent failed: 429 rate limited]'), `si fallan todos: ${todos.out.slice(0, 160)}`);
    igual(p.run.steps[0].status, 'error', 'si fallan todos, la fila es una falla');
    const algunos = await p.sesion.correr('delegate', { tasks: ['cae 1', 'anda'] });
    check(!algunos.error && algunos.out.includes('este sí') && algunos.out.includes('[this subagent failed: 429 rate limited]'), 'si falla uno, el informe del otro sale igual');
    check(algunos.out.includes('(the subagent ended without writing a report)'), 'un hijo sin informe no lo dice');

    // lo que la app no puede usar lo dice, sin arrancar a nadie
    vistos.length = 0;
    destino = { ...destino, error: 'no API key set for Venice, the subagent provider' };
    igual((await p.sesion.correr('delegate', { task: 'anda' })).out, 'error: no API key set for Venice, the subagent provider', 'sin llave para el proveedor de los subagentes');
    igual(vistos.length, 0, 'con un destino que no sirve no se llama a nadie');
    destino = { ...destino, error: null };

    // cortado por largo, rechazado, sin pasos
    GUIONES.set('largo', [{ say: 'medio inf', motivo: 'largo' }]);
    GUIONES.set('rechazo', [{ motivo: 'rechazo' }]);
    GUIONES.set('agotado', [{ say: 'iba por la mitad', agotar: true }]);
    const n = await p.sesion.correr('delegate', { tasks: ['largo', 'rechazo', 'agotado'] });
    check(n.out.includes('medio inf\n\n[this subagent hit the length limit: its report is cut short]'), 'la nota de cortado por largo');
    check(n.out.includes('[the model declined this task]'), 'la nota de rechazo');
    check(n.out.includes('iba por la mitad\n\n[this subagent ran out of tool steps: its work may be unfinished]'), 'la nota de pasos agotados');
  }

  // ═══ 7. Cuánto vuelve y cuánto guarda la fila ════════════════════════════
  {
    GUIONES.set('enorme', [{ say: 'x'.repeat(30000) }]);
    GUIONES.set('enorme 2', [{ say: 'y'.repeat(30000) }]);
    const p = padre();
    const uno = await p.sesion.correr('delegate', { task: 'enorme' });
    check(uno.out.includes('x'.repeat(24000) + '\n…[report cut at 24000 characters]') && !uno.out.includes('x'.repeat(24001)), 'un informe enorme se corta en 24000');
    const c = cierres(p.eventos).at(-1);
    igual([c.out.length, c.outCut], [4000, true], 'la fila de delegate guarda 4000 caracteres del informe');
    const dos = await p.sesion.correr('delegate', { tasks: ['enorme', 'enorme 2'] });
    check(dos.out.includes('[report cut at 12000 characters]') && !dos.out.includes('x'.repeat(12001)) && dos.out.includes('y'.repeat(12000)), 'el techo se reparte entre los hijos');
    // una fila común sigue en 600
    await p.sesion.correr('fs_write', { path: 'largo.txt', content: 'z'.repeat(2000) });
    await p.sesion.correr('fs_read', { paths: ['largo.txt'] });
    igual(cierres(p.eventos).at(-1).out.length, 600, 'una fila que no es delegate guarda 600');
  }

  // ═══ 8. Las tarjetas ═════════════════════════════════════════════════════
  {
    GUIONES.set('toca 1', [{ tools: [{ name: 'fs_write', args: { path: 'sub/a.txt', content: 'a' } }] }, { say: 'a' }]);
    GUIONES.set('toca 2', [{ tools: [{ name: 'fs_write', args: { path: 'sub/b.txt', content: 'b' } }] }, { say: 'b' }]);
    let abiertas = 0;
    let maximo = 0;
    const p = padre({
      confirmar: async ({ name }) => {
        if (name === 'delegate') return true;
        abiertas++;
        maximo = Math.max(maximo, abiertas);
        await new Promise((r) => setTimeout(r, 40));
        abiertas--;
        return name !== 'fs_write' || true;
      },
    });
    await p.sesion.correr('delegate', { tasks: ['toca 1', 'toca 2'], access: 'full' });
    igual(maximo, 1, 'las tarjetas de dos hijos a la vez se pidieron juntas');
    igual(p.tarjetas.map((t) => [t.name, t.quien?.sub ?? null]).sort(), [['delegate', null], ['fs_write', 1], ['fs_write', 2]], 'cada tarjeta dice qué subagente la pide');
    check(fs.existsSync(path.join(taller, 'sub', 'a.txt')) && fs.existsSync(path.join(taller, 'sub', 'b.txt')), 'con las tarjetas aceptadas, los dos escribieron');
    check(p.tarjetas.filter((t) => t.name === 'fs_write').every((t) => /^req-A:1\.[12]:1$/.test(t.callId)), 'la tarjeta de un hijo lleva el id de SU paso');

    // una tarjeta rechazada es del hijo: la fila queda «declined» y el padre lo lee
    GUIONES.set('toca 3', [{ tools: [{ name: 'fs_write', args: { path: 'sub/c.txt', content: 'c' } }] }, { say: 'no me dejaron' }]);
    const q = padre({ confirmar: async ({ name }) => name === 'delegate' });
    const r = await q.sesion.correr('delegate', { task: 'toca 3', access: 'full' });
    igual(cierres(q.eventos).find((e) => e.callId === 'req-A:1.1:1').status, 'declined', 'una tarjeta rechazada a un hijo');
    check(!fs.existsSync(path.join(taller, 'sub', 'c.txt')) && r.out.includes('fs_write (1 did not succeed)'), 'el hijo escribió igual, o el informe no lo cuenta');
    igual(q.tarjetas.find((t) => t.name === 'fs_write').quien, { sub: true }, 'un hijo solo: la tarjeta dice que es de un subagente, sin número');
    // en automático nadie pregunta
    const a = padre();
    await a.sesion.correr('delegate', { task: 'toca 3', access: 'full' });
    igual(a.tarjetas.length, 0, 'en automático un hijo pidió permiso');
  }

  // ═══ 9. Con qué corre ════════════════════════════════════════════════════
  {
    vistos.length = 0;
    destino = { proveedor: 'venice', modelo: 'grok-4-7', nombre: 'Venice', ve: false, error: null };
    const p = padre();
    await p.sesion.correr('delegate', { task: 'nada' });
    igual([vistos[0].pedido.proveedor, vistos[0].pedido.modelo], ['venice', 'grok-4-7'], 'el hijo corre con lo que diga la app');
    igual(filas(p.eventos)[0].label, 'grok-4-7 · nada', 'la fila dice ese modelo');
    check(!vistos[0].nombres.includes('screen_capture') && vistos[0].ve === false, 'un hijo cuyo modelo no ve recibió screen_capture');
    destino = { proveedor: 'anthropic', modelo: 'acme/modelo-x', nombre: 'Anthropic', ve: true, error: null };

    // un agente sin ninguna tool de lectura: el hijo conversa, y sabe qué es
    vistos.length = 0;
    const s = padre({ tools: ['fs_write', 'delegate'] });
    const r = await s.sesion.correr('delegate', { task: 'nada' });
    check(vistos[0].nombres.length === 0 && vistos[0].system.startsWith('You are Mate, a helpful agent.\n\n## You are a subagent'), 'un hijo sin tools no recibió la nota de subagente');
    check(r.out.includes('(modelo-x, no tools,'), `un hijo sin tools: ${r.out.slice(0, 80)}`);
  }

  // ═══ 10. Piezas sueltas ══════════════════════════════════════════════════
  {
    igual(delegar.informeDeSubagente(['a', 'b', '  ']), 'b', 'el informe es la última ronda con texto');
    igual(delegar.informeDeSubagente(['hallazgo', '[cut by the app]']), 'hallazgo\n\n[cut by the app]', 'una nota de la app va con la ronda anterior');
    igual(delegar.informeDeSubagente(['', '']), '', 'sin texto no hay informe');
    igual(delegar.resumenPasos([]), 'no tools', 'el resumen sin pasos');
    igual(delegar.resumenPasos([{ name: 'fs_read', status: 'ok' }, { name: 'fs_read', status: 'ok' }, { name: 'shell_exec', status: 'error' }]), 'fs_read ×2, shell_exec (1 did not succeed)', 'el resumen de pasos');
    check(guardas.SUBAGENT_NOTE.includes('never ask one') && guardas.SUBAGENT_NOTE.includes('say where you looked'), 'la nota de subagente perdió sus reglas');
    igual([delegar.DELEGATE_MAX, delegar.DELEGATE_REPORT_CHARS, motor.DELEGATE_CHIP_CHARS], [4, 24000, 4000], 'los topes');
  }
} finally {
  herramientas.cerrar();
  fs.rmSync(taller, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`test-blackcode-tools-delegar: ${failures.length} falla(s) de ${checks}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tools-delegar: ok (${checks} comprobaciones: qué tools ve un subagente, uno y varios a la vez, lectura y acceso completo, el Stop, los errores, los topes, las tarjetas y con qué modelo corre)`);
