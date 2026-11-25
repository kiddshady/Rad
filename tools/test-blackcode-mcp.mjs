// Test de los servidores MCP de BlackCode (apps/BlackCode/main/mcp.cjs), con
// node pelado contra un servidor de mentira (tools/fake-mcp-server.cjs): uno
// local por stdio y uno remoto por HTTP, los dos en esta PC. No sale a la red.
// Uso: node tools/test-blackcode-mcp.mjs

import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const M = require(process.env.BLACKCODE_MCP || path.join(APP, 'main', 'mcp.cjs'));
const defs = require(process.env.BLACKCODE_DEFS || path.join(APP, 'main', 'tools', 'defs.cjs'));
const motor = require(process.env.BLACKCODE_MOTOR || path.join(APP, 'main', 'tools', 'motor.cjs'));
const FALSO = path.join(ROOT, 'tools', 'fake-mcp-server.cjs');

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(40); } return false; };

// Un «disco» y un cifrado de mentira (que se note si algo quedó en claro).
function nuevo(extra = {}) {
  const disco = { doc: null, escrituras: 0 };
  const orden = [];
  const m = M.crear({
    leer: () => disco.doc,
    escribir: async (d) => { disco.doc = JSON.parse(JSON.stringify(d)); disco.escrituras++; },
    cifrar: (t) => `CIFRADO:${Buffer.from(t).toString('hex')}`,
    descifrar: (b) => Buffer.from(String(b).replace(/^CIFRADO:/, ''), 'hex').toString(),
    alCambiar: () => orden.push('app'),
    ...extra,
  });
  m.on('cambio', () => orden.push('motor'));
  return { m, disco, orden };
}
const de = (m, nombre) => m.lista().find((s) => s.nombre === nombre);
const listo = (m, nombre) => hasta(() => { const s = de(m, nombre); return s && s.estado !== 'connecting' && (s.estado !== 'disconnected' || !s.activo); });
const run = () => ({ ac: new AbortController(), reqId: 'r1', notify() {} });
const local = (nombre, extra = {}) => ({ nombre, tipo: 'local', comando: 'node', args: [FALSO], ...extra });

// ---------- 1. los nombres con que las tools viajan al modelo ----------
ok('un nombre con punto se limpia', M.nombreSeguro('mcp_s_', 'get.item') === 'mcp_s_get_item');
{
  const largo = M.nombreSeguro('mcp_servidor_', 'x'.repeat(100));
  ok('un nombre largo entra en 64 y sigue siendo válido', largo.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(largo), largo);
  ok('dos largos parecidos no dan el mismo', M.nombreSeguro('mcp_s_', `${'x'.repeat(100)}a`) !== M.nombreSeguro('mcp_s_', `${'x'.repeat(100)}b`));
  const d = M.desambiguarNombres([{ name: 'mcp_a_b', serverId: 'aaaa1', toolName: 'b' }, { name: 'mcp_a_b', serverId: 'bbbb2', toolName: 'b' }, { name: 'mcp_c', serverId: 'cccc3', toolName: 'c' }]);
  ok('dos tools con el mismo nombre final salen distintas', new Set(d.map((s) => s.name)).size === 3 && d[2].name === 'mcp_c', d.map((s) => s.name).join(' '));
  ok('slugify deja letras, números y guion bajo', M.slugify('My Server (v2)') === 'my_server_v2');
}

// ---------- 2. lo que devuelve una tool, hecho texto ----------
ok('texto e imagen: el texto y un rótulo, sin el binario', M.resultToText({ content: [{ type: 'text', text: 'hola' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] }) === 'hola\n[image image/png — binary omitted]');
ok('un error del servidor llega como error', M.resultToText({ isError: true, content: [{ type: 'text', text: 'no' }] }) === 'error: no');
ok('sin contenido se dice', M.resultToText({ content: [] }) === '(no content)');
{
  const t = M.resultToText({ content: [{ type: 'text', text: 'y'.repeat(20000) }] });
  ok('un resultado enorme se corta', t.length < M.RESULTADO_MAX + 40 && t.endsWith('[truncated]'), String(t.length));
}

// ---------- 3. revisar lo que llega de la interfaz ----------
ok('sin nombre no hay servidor', M.revisar({ tipo: 'local', comando: 'npx' }).campo === 'nombre');
ok('un local pide un comando', M.revisar({ nombre: 'a', tipo: 'local' }).campo === 'comando');
ok('una variable con nombre inválido se rechaza', M.revisar({ nombre: 'a', tipo: 'local', comando: 'npx', env: { 'MAL NOMBRE': 'x' } }).campo === 'env');
ok('un remoto pide una URL', M.revisar({ nombre: 'a', tipo: 'remoto', url: 'no es una url' }).campo === 'url');
ok('un remoto por http a otra máquina se rechaza', M.revisar({ nombre: 'a', tipo: 'remoto', url: 'http://example.com/mcp' }).campo === 'url');
ok('…por https vale', M.revisar({ nombre: 'a', tipo: 'remoto', url: 'https://example.com/mcp' }).entrada?.url === 'https://example.com/mcp');
ok('…y por http a esta PC también', Boolean(M.revisar({ nombre: 'a', tipo: 'remoto', url: 'http://127.0.0.1:9/mcp' }).entrada));
ok('un encabezado con nombre inválido se rechaza', M.revisar({ nombre: 'a', tipo: 'remoto', url: 'https://e.com', headers: { 'X Y': '1' } }).campo === 'headers');
{
  const r = M.revisar({ nombre: '  Uno  ', tipo: 'local', comando: 'npx', args: ['-y', 3, null, {}], env: { A: null, B: 'b' } });
  ok('nace preguntando y activo', r.entrada.preguntar === true && r.entrada.activo === true && r.entrada.nombre === 'Uno');
  ok('los argumentos quedan como texto', JSON.stringify(r.entrada.args) === '["-y","3"]', JSON.stringify(r.entrada.args));
  ok('un secreto en null sigue en null («el que estaba»)', r.secretos.env.A === null && r.secretos.env.B === 'b');
  ok('la entrada no lleva los secretos', !JSON.stringify(r.entrada).includes('"b"') && r.entrada.env === undefined);
}

// ---------- 4. el JSON de las instrucciones de un servidor ----------
{
  const j = M.deJson(JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg'], env: { K: 'v' } }, web: { url: 'https://e.com/mcp', headers: { Authorization: 'Bearer t' } }, mal: 7 } }));
  ok('entiende el bloque mcpServers', j.servidores.length === 2 && j.servidores[0].nombre === 'fs' && j.servidores[0].tipo === 'local' && j.servidores[0].env.K === 'v', JSON.stringify(j));
  ok('…con un remoto por su url', j.servidores[1].tipo === 'remoto' && j.servidores[1].headers.Authorization === 'Bearer t');
  ok('…y dice cuál no es un servidor', j.errores.length === 1 && j.errores[0].startsWith('mal:'), JSON.stringify(j.errores));
  ok('vale el mapa de adentro solo', M.deJson('{"fs":{"command":"npx"}}').servidores.length === 1);
  ok('vale un servidor suelto', M.deJson('{"command":"npx","args":["x"]}').servidores[0]?.comando === 'npx');
  ok('lo que no es JSON se dice', M.deJson('{nope').errores[0] === 'That is not valid JSON.' && M.deJson('{nope').servidores.length === 0);
  ok('un JSON sin servidores se dice', M.deJson('{}').errores.length === 1 && M.deJson('[1]').errores.length === 1);
}

// ---------- 5. un servidor local ----------
{
  const { m, disco, orden } = nuevo();
  ok('sin servidores no hay nada', m.lista().length === 0 && m.specs().length === 0 && m.grupos().length === 0 && m.disponible() === true);
  const r = await m.guardar(local('Fake', { env: { FAKE_MCP_SECRET: 'abc123' } }));
  ok('guardar devuelve el id', r.ok === true && typeof r.id === 'string', JSON.stringify(r));
  ok('mientras conecta se ve conectando', de(m, 'Fake').estado === 'connecting');
  await listo(m, 'Fake');
  const s = de(m, 'Fake');
  ok('conecta y trae sus tools', s.estado === 'connected' && s.tools.length === 11 && s.tools.includes('echo'), `${s.estado} ${s.error} ${s.tools.length}`);
  ok('a la interfaz van los NOMBRES de las variables, no los valores', JSON.stringify(s.env) === '["FAKE_MCP_SECRET"]' && !JSON.stringify(m.lista()).includes('abc123'), JSON.stringify(s.env));
  ok('en el disco el secreto está cifrado', !JSON.stringify(disco.doc).includes('abc123') && String(disco.doc.servidores[0].secreto).startsWith('CIFRADO:'), JSON.stringify(disco.doc).slice(0, 200));
  ok('avisa primero al motor y después a la app', orden.length >= 2 && orden[0] === 'motor' && orden.every((x, i) => (i % 2 === 0 ? x === 'motor' : x === 'app')), orden.join(' '));

  const specs = m.specs();
  const nombres = specs.map((x) => x.name);
  ok('las tools se llaman mcp_<servidor>_<tool>', nombres.includes('mcp_fake_echo') && nombres.every((n) => /^mcp_fake_[a-zA-Z0-9_-]+$/.test(n) && n.length <= 64), nombres.join(' '));
  ok('get.item y get_item no chocan', new Set(nombres).size === nombres.length && specs.filter((x) => x.toolName === 'get.item' || x.toolName === 'get_item').length === 2);
  const pushy = specs.find((x) => x.toolName === 'pushy');
  ok('la descripción va marcada como del servidor y acotada', pushy.description.startsWith('[MCP server "Fake"] ') && pushy.description.length <= 900, String(pushy.description.length));
  ok('cada spec lleva su esquema', specs.find((x) => x.toolName === 'echo').parameters.required[0] === 'text');

  ok('echo', await m.correr('mcp_fake_echo', run(), { text: 'hola' }) === 'echo: hola');
  ok('el servidor recibió su variable', await m.correr('mcp_fake_whoami', run(), {}) === 'secret: got 6 characters');
  ok('un error de la tool llega como error', await m.correr('mcp_fake_boom', run(), {}) === 'error: it broke on purpose');
  ok('una imagen llega como rótulo', (await m.correr('mcp_fake_picture', run(), {})).includes('[image image/png — binary omitted]'));
  ok('un resultado enorme llega cortado', (await m.correr('mcp_fake_big', run(), {})).length < M.RESULTADO_MAX + 40);
  ok('las dos que chocaban llaman cada una a la suya', await m.correr(specs.find((x) => x.toolName === 'get.item').name, run(), {}) === 'dotted' && await m.correr(specs.find((x) => x.toolName === 'get_item').name, run(), {}) === 'underscored');
  ok('una tool que no existe se dice', (await m.correr('mcp_fake_nada', run(), {})).startsWith('error: that MCP tool is not available'));
  {
    const r1 = run();
    const t0 = Date.now();
    setTimeout(() => r1.ac.abort(), 150);
    const out = await m.correr('mcp_fake_slow', r1, {});
    ok('frenar el turno corta la llamada', out === 'error: stopped by the user' && Date.now() - t0 < 3000, `${out} en ${Date.now() - t0} ms`);
    const r2 = run();
    r2.ac.abort();
    ok('con el turno ya frenado no llama', (await m.correr('mcp_fake_echo', r2, { text: 'x' })).startsWith('error: the run was stopped'));
  }

  // el permiso
  ok('nace preguntando', m.pregunta('mcp_fake_echo') === true && s.preguntar === true);
  ok('una tool que no es de MCP no pregunta por esto', m.pregunta('fs_read') === false && m.pregunta(undefined) === false);
  ok('una de MCP que ya no está, pregunta', m.pregunta('mcp_fake_nada') === true);
  ok('la tarjeta dice de qué servidor es', JSON.stringify(m.vista('mcp_fake_echo')) === JSON.stringify({ mode: 'mcp', servidor: 'Fake', tool: 'echo', siempre: true }) && m.vista('mcp_fake_nada') === null, JSON.stringify(m.vista('mcp_fake_echo')));
  await m.ajustar(r.id, { preguntar: false });
  ok('apagado «preguntar», no pregunta', m.pregunta('mcp_fake_echo') === false && de(m, 'Fake').preguntar === false && disco.doc.servidores[0].preguntar === false && m.vista('mcp_fake_echo').siempre === false);
  ok('…y eso no lo desconecta', de(m, 'Fake').estado === 'connected');

  // los grupos y las marcas
  const g = m.grupos();
  ok('un grupo opcional por servidor, con su marca', g.length === 1 && g[0].id === `mcp:${r.id}` && g[0].tools.length === 1 && g[0].tools[0] === `mcp:${r.id}` && g[0].opcional === true && g[0].nombre === 'MCP: Fake', JSON.stringify(g));
  ok('…que dice cuántas tools trae y cómo está', g[0].mcp.cuenta === 11 && g[0].mcp.estado === 'connected');
  const exp = m.expandir(['fs_read', `mcp:${r.id}`, 'mcp:noexiste']);
  ok('la marca se cambia por las tools del servidor', exp.length === 12 && exp[0] === 'fs_read' && exp.includes('mcp_fake_echo') && !exp.some((n) => n.startsWith('mcp:')), exp.join(' '));

  // el motor de tools
  defs.ponerDinamicas(specs.map((x) => ({ name: x.name, description: x.description, parameters: x.parameters })));
  motor.reemplazar('mcp_', Object.fromEntries(specs.map((x) => [x.name, (rn, a) => m.correr(x.name, rn, a)])));
  ok('las definiciones las conoce el motor', defs.existe('mcp_fake_echo') && !defs.existe('mcp_fake_nada') && defs.existe('fs_read'));
  const an = defs.paraAnthropic(['fs_read', 'mcp_fake_echo']);
  const oa = defs.paraOpenAI(['mcp_fake_echo']);
  ok('viajan a Anthropic con su esquema', an.length === 2 && an[1].name === 'mcp_fake_echo' && an[1].input_schema?.required?.[0] === 'text', JSON.stringify(an[1]).slice(0, 200));
  ok('…y a los demás', oa.length === 1 && (oa[0].function?.name ?? oa[0].name) === 'mcp_fake_echo');
  ok('los argumentos se validan contra el esquema del servidor', defs.validar('mcp_fake_echo', {}) === 'missing required argument "text"' && defs.validar('mcp_fake_echo', { text: 'x' }) === null && defs.validar('mcp_fake_whoami', {}) === null);
  ok('una definición dinámica no pisa una de la app', (defs.ponerDinamicas([{ name: 'fs_read', description: 'falsa', parameters: {} }, ...specs.map((x) => ({ name: x.name, description: x.description, parameters: x.parameters }))]), defs.paraAnthropic(['fs_read'])[0].description !== 'falsa'));
  ok('los runners quedan registrados', motor.registradas().includes('mcp_fake_echo'));
  ok('el agente las recibe', motor.activeToolNames({ tools: ['mcp_fake_echo', 'mcp_fake_nada'] }).join() === 'mcp_fake_echo');
  ok('un subagente no', motor.activeToolNames({ tools: ['mcp_fake_echo'], subagent: { access: 'full' } }).length === 0);
  motor.reemplazar('mcp_', { mcp_otro_x: () => 'x', fs_colado: () => 'no' });
  ok('reemplazar saca las de antes y no deja colar otro prefijo', !motor.registradas().includes('mcp_fake_echo') && motor.registradas().includes('mcp_otro_x') && !motor.registradas().includes('fs_colado'));
  motor.reemplazar('mcp_', {});
  defs.ponerDinamicas([]);
  ok('…y vacío no deja ninguna', !motor.registradas().some((n) => n.startsWith('mcp_')) && !defs.existe('mcp_fake_echo'));

  // cambiarlo sin volver a escribir el secreto
  const r2 = await m.guardar({ ...local('Fake', { env: { FAKE_MCP_SECRET: null } }), id: r.id, preguntar: true });
  await listo(m, 'Fake');
  ok('cambiar un servidor conserva su id', r2.ok && r2.id === r.id && m.lista().length === 1);
  ok('un secreto en null conserva el guardado', await m.correr('mcp_fake_whoami', run(), {}) === 'secret: got 6 characters');
  await m.guardar({ ...local('Fake', { env: {} }), id: r.id });
  await listo(m, 'Fake');
  ok('sacar la variable la saca', await m.correr('mcp_fake_whoami', run(), {}) === 'secret: none' && disco.doc.servidores[0].secreto === undefined && de(m, 'Fake').env.length === 0);
  const dup = await m.guardar(local('fake'));
  ok('dos servidores no pueden llamarse igual', dup.ok === false && dup.campo === 'nombre' && m.lista().length === 1, JSON.stringify(dup));

  // se muere solo
  ok('el que se va a morir contesta', await m.correr('mcp_fake_die', run(), {}) === 'bye');
  await hasta(() => de(m, 'Fake').estado === 'error');
  ok('un servidor que se muere queda en error y sin tools', de(m, 'Fake').estado === 'error' && /closed/.test(de(m, 'Fake').error ?? '') && m.specs().length === 0 && m.grupos()[0].mcp.cuenta === 0, JSON.stringify(de(m, 'Fake')));
  ok('…y sus tools dejan de correr', (await m.correr('mcp_fake_echo', run(), { text: 'x' })).startsWith('error: that MCP tool is not available'));
  await m.reconectar(r.id);
  ok('reconectar lo levanta', de(m, 'Fake').estado === 'connected' && m.specs().length === 11);

  // apagarlo y quitarlo
  await m.ajustar(r.id, { activo: false });
  ok('apagado: sin conexión, sin tools y sin grupo', de(m, 'Fake').estado === 'disconnected' && de(m, 'Fake').activo === false && m.specs().length === 0 && m.grupos().length === 0);
  ok('…y la marca del agente no trae nada', m.expandir([`mcp:${r.id}`]).length === 0);
  await m.ajustar(r.id, { activo: true });
  await listo(m, 'Fake');
  ok('prendido de nuevo vuelve', de(m, 'Fake').estado === 'connected' && m.grupos().length === 1);
  const q = await m.quitar(r.id);
  ok('quitar lo saca de todos lados', q.ok && m.lista().length === 0 && m.specs().length === 0 && disco.doc.servidores.length === 0 && (await m.quitar(r.id)).ok === false);

  // quitarlo mientras conecta no deja una conexión suelta
  const r3 = await m.guardar(local('Apurado'));
  await m.quitar(r3.id);
  await sleep(2500);
  ok('quitado a mitad de conectar no deja nada', m.lista().length === 0 && m.specs().length === 0);
  await m.cerrar();
}

// ---------- 6. lo que sale mal ----------
{
  const { m } = nuevo();
  await m.guardar({ nombre: 'Roto', tipo: 'local', comando: 'node', args: ['-e', 'process.exit(3)'] });
  await listo(m, 'Roto');
  ok('un comando que no es un servidor queda en error, con su motivo', de(m, 'Roto').estado === 'error' && Boolean(de(m, 'Roto').error) && m.specs().length === 0, JSON.stringify(de(m, 'Roto')));
  await m.guardar({ nombre: 'Nada', tipo: 'local', comando: 'esto-no-existe-blackcode' });
  await listo(m, 'Nada');
  ok('un comando que no existe, también', de(m, 'Nada').estado === 'error');
  await m.cerrar();

  // sin cifrado, un servidor con secretos no se guarda
  const sin = nuevo({ cifrar: () => null });
  const r = await sin.m.guardar({ nombre: 'S', tipo: 'local', comando: 'node', args: ['-e', '0'], env: { K: 'v' } });
  ok('sin cifrado no se guardan secretos', r.ok === false && /encryption/.test(r.error) && sin.m.lista().length === 0 && sin.disco.doc === null, JSON.stringify(r));
  const r2 = await sin.m.guardar({ nombre: 'S', tipo: 'local', comando: 'node', args: ['-e', '0'], activo: false });
  ok('…pero uno sin secretos sí', r2.ok === true && sin.m.lista().length === 1 && sin.m.lista()[0].estado === 'disconnected');
  await sin.m.cerrar();

  // un secreto que no se puede leer no rompe la lista
  const roto = nuevo({ descifrar: () => { throw new Error('no'); } });
  roto.disco.doc = { v: 1, servidores: [{ id: 'x1', nombre: 'Viejo', tipo: 'local', comando: 'node', args: [], activo: false, secreto: 'basura' }, { nombre: 'sin id' }, null] };
  ok('un documento con basura se lee igual', roto.m.lista().length === 1 && roto.m.lista()[0].env.length === 0);
}

// ---------- 7. el tope de tools por servidor ----------
{
  const { m } = nuevo();
  await m.guardar(local('Muchas', { env: { FAKE_MCP_MUCHAS: '100' } }));
  await listo(m, 'Muchas');
  const s = de(m, 'Muchas');
  ok('de un servidor con 111 tools se ofrecen 80, y se dice cuántas quedaron afuera', s.tools.length === M.TOOLS_POR_SERVIDOR && s.cortadas === 31 && m.specs().length === 80, `${s.tools.length} ${s.cortadas}`);
  await m.cerrar();
}

// ---------- 8. un servidor remoto, con su token ----------
{
  const hijo = spawn(process.execPath, [FALSO, '--http', '0'], { env: { ...process.env, FAKE_MCP_TOKEN: 'tok-9' } });
  let visto = '';
  hijo.stderr.on('data', (d) => { visto += d; });
  const puerto = await new Promise((res) => hijo.stdout.on('data', (d) => { const x = /LISTO (\d+)/.exec(String(d)); if (x) res(x[1]); }));
  const { m, disco } = nuevo();
  const url = `http://127.0.0.1:${puerto}/mcp`;
  const r = await m.guardar({ nombre: 'Remote', tipo: 'remoto', url, headers: { Authorization: 'Bearer tok-9' } });
  await listo(m, 'Remote');
  const s = de(m, 'Remote');
  ok('el remoto conecta con su encabezado', r.ok && s.estado === 'connected' && s.tools.length === 11, `${s.estado} ${s.error}`);
  ok('el servidor recibió el token', visto.includes('AUTH Bearer tok-9'), visto.slice(0, 120));
  ok('a la interfaz va el nombre del encabezado, no el token', JSON.stringify(s.headers) === '["Authorization"]' && !JSON.stringify(m.lista()).includes('tok-9') && !JSON.stringify(disco.doc).includes('tok-9'));
  ok('una llamada al remoto', await m.correr('mcp_remote_add', run(), { a: 2, b: 3 }) === '5');
  await m.guardar({ nombre: 'Sin token', tipo: 'remoto', url });
  await listo(m, 'Sin token');
  ok('sin el token queda en error', de(m, 'Sin token').estado === 'error' && Boolean(de(m, 'Sin token').error), JSON.stringify(de(m, 'Sin token')));
  ok('dos servidores conectados no mezclan sus tools', m.specs().every((x) => x.serverName === 'Remote') && m.grupos().length === 2);

  // pegar el JSON
  const p = await m.pegar(JSON.stringify({ mcpServers: { pegado: { command: 'node', args: [FALSO], env: { FAKE_MCP_SECRET: 'zzz999' } }, Remote: { url }, roto: { command: 5 } } }));
  await listo(m, 'pegado');
  ok('pegar agrega los que entiende y dice los que no', p.agregados.join() === 'pegado' && p.errores.length === 2 && p.errores.some((e) => e.startsWith('Remote: There is already')) && p.errores.some((e) => e.startsWith('roto:')), JSON.stringify(p));
  ok('…conectados, preguntando y con su secreto cifrado', de(m, 'pegado').estado === 'connected' && de(m, 'pegado').preguntar === true && !JSON.stringify(disco.doc).includes('zzz999') && await m.correr('mcp_pegado_whoami', run(), {}) === 'secret: got 6 characters');
  ok('pegar basura no agrega nada', (await m.pegar('nope')).agregados.length === 0 && m.lista().length === 3);

  // al abrir la app
  const otra = nuevo();
  otra.disco.doc = JSON.parse(JSON.stringify(disco.doc));
  await otra.m.conectarActivos();
  ok('al abrir la app conecta los activos', de(otra.m, 'Remote').estado === 'connected' && de(otra.m, 'pegado').estado === 'connected' && de(otra.m, 'Sin token').estado === 'error');
  await otra.m.cerrar();
  ok('al cerrar no queda ninguno conectado', otra.m.specs().length === 0 && otra.m.lista().every((x) => x.estado === 'disconnected'));
  await m.cerrar();
  hijo.kill();
}

if (failures.length) {
  console.error(`test-blackcode-mcp: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-mcp: ok (${hechas} comprobaciones: los nombres, el resultado hecho texto, revisar y el JSON pegado, un servidor local con sus secretos cifrados, el permiso, los grupos y las marcas, el motor de tools, lo que sale mal, el tope, y un remoto con su token)`);
process.exit(0);
