// Test de las tareas programadas de BlackCode (apps/BlackCode/main/tareas.cjs,
// la tool `schedule` en main/tools/agenda.cjs, qué tools tiene una corrida sin
// nadie mirando, y el ícono de la bandeja en main/bandeja.cjs), con node pelado
// y el reloj en la mano: no espera ni un segundo de verdad, ni llama a un modelo.
// Uso: node tools/test-blackcode-tareas.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'BlackCode');
const T = require(process.env.BLACKCODE_TAREAS || path.join(APP, 'main', 'tareas.cjs'));
const agenda = require(path.join(APP, 'main', 'tools', 'agenda.cjs'));
const motor = require(path.join(APP, 'main', 'tools', 'motor.cjs'));
const defs = require(path.join(APP, 'main', 'tools', 'defs.cjs'));
const sesiones = require(path.join(APP, 'main', 'tools', 'sesion.cjs'));
const B = require(path.join(APP, 'main', 'bandeja.cjs'));

const failures = [];
let hechas = 0;
const ok = (nombre, cond, extra = '') => { hechas++; if (!cond) failures.push(`${nombre}${extra ? `  → ${extra}` : ''}`); };
const MIN = 60000;
const dia = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();

// Un mundo de mentira: el disco, el reloj, y un «modelo» que anota qué le pidieron.
function mundo(extra = {}) {
  const w = { tareas: null, bandeja: null, t: dia(2026, 11, 25, 8, 0), corridas: [], cambios: [], avisos: [], ocupado: false, agentes: new Set(['a1', 'a2']), responde: null, n: 0 };
  w.T = T.crear({
    leer: () => w.tareas,
    escribir: async (d) => { w.tareas = JSON.parse(JSON.stringify(d)); },
    leerBandeja: () => w.bandeja,
    escribirBandeja: async (d) => { w.bandeja = JSON.parse(JSON.stringify(d)); },
    correr: async (tarea, { signal }) => {
      w.corridas.push({ id: tarea.id, titulo: tarea.titulo, actuar: tarea.actuar, t: w.t });
      const r = w.responde ? await w.responde(tarea, signal) : { salida: `did: ${tarea.prompt}`, pasos: [{ name: 'web_search', label: 'x', status: 'ok' }], agente: 'Agent one' };
      w.t += 2 * MIN; // (una corrida tarda dos minutos)
      return r;
    },
    ocupado: () => w.ocupado,
    existeAgente: (id) => w.agentes.has(id),
    ahora: () => w.t,
    alCambiar: (que) => w.cambios.push(que),
    alTerminar: (r) => w.avisos.push(r),
    nuevoId: () => `id${++w.n}`,
    ...extra,
  });
  return w;
}
const nueva = (extra = {}) => ({ titulo: 'News', prompt: 'Tell me the news', agente: 'a1', spec: { kind: 'daily', a: '09:00' }, ...extra });

// ---------- 1. cuándo corre ----------
ok('una hora de 24 horas', JSON.stringify(T.horaDe('9:05')) === '[9,5]' && JSON.stringify(T.horaDe('23:59')) === '[23,59]' && JSON.stringify(T.horaDe(' 00:00 ')) === '[0,0]');
ok('una hora imposible se rechaza, no se acomoda', T.horaDe('25:00') === null && T.horaDe('12:60') === null && T.horaDe('9') === null && T.horaDe('9:5') === null && T.horaDe('') === null && T.horaDe(null) === null);
ok('daily pide una hora', T.revisarSpec({ kind: 'daily', a: '9:00' }).spec.a === '09:00' && Boolean(T.revisarSpec({ kind: 'daily' }).error) && Boolean(T.revisarSpec({ kind: 'daily', a: '24:00' }).error));
ok('every tiene un piso de 5 minutos', T.revisarSpec({ kind: 'every', minutos: 5 }).spec.minutos === 5 && /every 5 minutes at the least/.test(T.revisarSpec({ kind: 'every', minutos: 4 }).error) && Boolean(T.revisarSpec({ kind: 'every' }).error) && Boolean(T.revisarSpec({ kind: 'every', minutos: 'x' }).error));
ok('…y un techo', Boolean(T.revisarSpec({ kind: 'every', minutos: 60 * 24 * 31 }).error));
ok('once: en un rato o a una hora', T.revisarSpec({ kind: 'once', minutos: 30 }).spec.minutos === 30 && T.revisarSpec({ kind: 'once', a: '18:30' }).spec.a === '18:30' && T.revisarSpec({ kind: 'once', a: '18:30', minutos: 5 }).spec.minutos === undefined);
ok('…y sin ninguna de las dos, o con una mala, no', Boolean(T.revisarSpec({ kind: 'once' }).error) && Boolean(T.revisarSpec({ kind: 'once', minutos: 0 }).error) && Boolean(T.revisarSpec({ kind: 'once', a: '7pm' }).error));
ok('otra cosa no es un cuándo', Boolean(T.revisarSpec({ kind: 'weekly' }).error) && Boolean(T.revisarSpec({}).error) && Boolean(T.revisarSpec().error));
ok('los minutos se redondean (un modelo manda 30.4)', T.revisarSpec({ kind: 'every', minutos: 30.4 }).spec.minutos === 30 && T.revisarSpec({ kind: 'once', minutos: '45' }).spec.minutos === 45);

ok('every: tantos minutos después', T.proxima({ kind: 'every', minutos: 90 }, dia(2026, 11, 25, 8)) === dia(2026, 11, 25, 9, 30));
ok('once en un rato', T.proxima({ kind: 'once', minutos: 15 }, dia(2026, 11, 25, 8)) === dia(2026, 11, 25, 8, 15));
ok('daily: hoy si la hora no pasó', T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 11, 25, 8)) === dia(2026, 11, 25, 9));
ok('…y mañana si ya pasó, o si es justo ahora', T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 11, 25, 10)) === dia(2026, 11, 26, 9) && T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 11, 25, 9)) === dia(2026, 11, 26, 9));
ok('once a una hora: la próxima vez que el reloj la marque', T.proxima({ kind: 'once', a: '07:00' }, dia(2026, 11, 25, 8)) === dia(2026, 11, 26, 7));
ok('a fin de mes pasa al mes siguiente', T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 11, 30, 10)) === dia(2026, 12, 1, 9) && T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 12, 31, 10)) === dia(2027, 1, 1, 9));
{
  // «mañana a la misma hora de reloj», aunque el día dure 23 o 25 horas
  const p = new Date(T.proxima({ kind: 'daily', a: '09:00' }, dia(2026, 3, 7, 10)));
  ok('la próxima de una diaria cae a la misma hora de reloj', p.getHours() === 9 && p.getMinutes() === 0 && p.getDate() === 8);
}
ok('cada cuánto, en palabras', T.describir({ kind: 'daily', a: '09:00' }) === 'every day at 09:00' && T.describir({ kind: 'every', minutos: 5 }) === 'every 5 minutes' && T.describir({ kind: 'every', minutos: 60 }) === 'every 1 hour'
  && T.describir({ kind: 'every', minutos: 180 }) === 'every 3 hours' && T.describir({ kind: 'every', minutos: 2880 }) === 'every 2 days' && T.describir({ kind: 'once', minutos: 90 }) === 'once, in 90 minutes' && T.describir({ kind: 'once', a: '18:30' }) === 'once, at 18:30' && T.describir(null) === 'never');

// ---------- 2. armar, cambiar, borrar ----------
{
  const w = mundo();
  ok('sin nada guardado no hay tareas ni resultados', w.T.lista().length === 0 && w.T.resultados().length === 0 && w.T.sinLeer() === 0 && w.T.corriendo() === null);
  const r = await w.T.agregar(nueva());
  ok('una tarea nueva queda prendida, con su próxima corrida', r.ok && r.tarea.activa === true && r.tarea.proxima === dia(2026, 11, 25, 9) && r.tarea.corridas === 0 && r.tarea.de === 'user' && r.tarea.actuar === false, JSON.stringify(r));
  ok('…guardada, y la interfaz se entera', w.tareas.lista.length === 1 && w.cambios.includes('tareas'));
  ok('la interfaz recibe cada cuánto corre, en palabras', w.T.lista()[0].cuando === 'every day at 09:00' && w.T.lista()[0].corriendo === false);
  ok('sin nombre', (await w.T.agregar(nueva({ titulo: '  ' }))).campo === 'titulo');
  ok('sin pedido', (await w.T.agregar(nueva({ prompt: '' }))).campo === 'prompt');
  ok('con un agente que no existe', (await w.T.agregar(nueva({ agente: 'nadie' }))).campo === 'agente' && (await w.T.agregar(nueva({ agente: undefined }))).campo === 'agente');
  ok('con un cuándo malo', (await w.T.agregar(nueva({ spec: { kind: 'every', minutos: 1 } }))).campo === 'spec');
  ok('nada de eso guardó una tarea', w.T.lista().length === 1);
  ok('«Let it act» solo con un true de verdad', (await w.T.agregar(nueva({ titulo: 'Acts', actuar: true }))).tarea.actuar === true && (await w.T.agregar(nueva({ titulo: 'No', actuar: 'yes' }))).tarea.actuar === false);
  ok('lo que crea un agente queda marcado', (await w.T.agregar(nueva({ titulo: 'Agent made', de: 'agent' }))).tarea.de === 'agent');
  ok('el título y el pedido tienen tope', (await w.T.agregar(nueva({ titulo: 'x'.repeat(200), prompt: 'y'.repeat(20000) }))).tarea.titulo.length === 80 && w.T.lista().at(-1).prompt.length === T.PROMPT_MAX);

  // cambiar
  const id = r.tarea.id;
  w.t += 10 * MIN;
  const c1 = await w.T.cambiar(id, nueva({ titulo: 'Renamed' }));
  ok('cambiar el nombre no corre el reloj de la tarea', c1.ok && w.T.buscar(id).titulo === 'Renamed' && w.T.buscar(id).proxima === dia(2026, 11, 25, 9));
  {
    // (con una que corre cada tanto se nota: renombrarla a los 10 minutos no la corre 10 minutos)
    const cada = (await w.T.agregar(nueva({ titulo: 'Cada hora', spec: { kind: 'every', minutos: 60 } }))).tarea;
    const antes = cada.proxima; // (agregar devuelve la tarea viva: hay que anotar el valor, no mirarla después)
    w.t += 10 * MIN;
    await w.T.cambiar(cada.id, nueva({ titulo: 'Cada hora, renombrada', spec: { kind: 'every', minutos: 60 } }));
    ok('…ni el de una que corre cada tanto', w.T.buscar(cada.id).proxima === antes && w.T.buscar(cada.id).titulo === 'Cada hora, renombrada', String(w.T.buscar(cada.id).proxima - antes));
    await w.T.quitar(cada.id);
  }
  const c2 = await w.T.cambiar(id, nueva({ titulo: 'Renamed', spec: { kind: 'every', minutos: 30 } }));
  ok('cambiar cuándo corre, sí: cuenta desde ahora', c2.ok && w.T.buscar(id).proxima === w.t + 30 * MIN);
  ok('cambiar una que no está', (await w.T.cambiar('nada', nueva())).ok === false);
  ok('cambiarla con algo malo no la toca', (await w.T.cambiar(id, nueva({ prompt: '' }))).campo === 'prompt' && w.T.buscar(id).prompt === 'Tell me the news');

  // apagar y prender
  await w.T.activar(id, false);
  ok('apagada no vence', w.T.buscar(id).activa === false && (w.t += 3 * 60 * MIN, w.T.vencidas().every((t) => t.id !== id)));
  await w.T.activar(id, true);
  ok('al prenderla, la próxima se cuenta desde ahora (no corre de golpe todo lo que faltó)', w.T.buscar(id).proxima === w.t + 30 * MIN);

  // borrar y deshacer
  const antes = w.T.lista().length;
  const q = await w.T.quitar(id);
  ok('borrar la saca', q.ok && w.T.lista().length === antes - 1 && w.T.buscar(id) === null && (await w.T.quitar(id)).ok === false);
  ok('…y se puede deshacer por un rato', (await w.T.restaurar(id)).ok === true && w.T.buscar(id)?.titulo === 'Renamed' && (await w.T.restaurar(id)).ok === false);
  await w.T.quitar(id);
  w.t += T.PAPELERA_MS + 1;
  ok('…pero no para siempre', (await w.T.restaurar(id)).ok === false && w.T.buscar(id) === null);

  // el tope
  const w2 = mundo();
  for (let i = 0; i < T.TAREAS_MAX; i++) await w2.T.agregar(nueva({ titulo: `T${i}` }));
  ok('hay un tope de tareas', w2.T.lista().length === T.TAREAS_MAX && /up to 50 tasks/.test((await w2.T.agregar(nueva())).error));

  // un agente que se borra se lleva sus tareas
  const w3 = mundo();
  await w3.T.agregar(nueva({ titulo: 'De uno' }));
  await w3.T.agregar(nueva({ titulo: 'De dos', agente: 'a2' }));
  await w3.T.alBorrarAgente('a1');
  ok('las tareas de un agente borrado se van con él', w3.T.lista().map((t) => t.titulo).join() === 'De dos');

  // un documento con basura
  const w4 = mundo();
  w4.tareas = { v: 1, lista: [{ id: 'ok1', titulo: 'Buena', prompt: 'p', agente: 'a1', spec: { kind: 'daily', a: '09:00' }, activa: true, proxima: 1 }, { id: 'mala', prompt: 'p', spec: { kind: 'nunca' } }, null, { titulo: 'sin id' }] };
  w4.bandeja = { lista: [{ id: 'r1', titulo: 'x', pasos: [] }, null, 7] };
  ok('un documento con basura se lee igual', w4.T.lista().map((t) => t.id).join() === 'ok1' && w4.T.resultados().length === 1);
}

// ---------- 3. el latido ----------
{
  const w = mundo();
  const diaria = (await w.T.agregar(nueva({ titulo: 'Diaria' }))).tarea;                                     // 09:00
  const cada = (await w.T.agregar(nueva({ titulo: 'Cada hora', spec: { kind: 'every', minutos: 60 } }))).tarea; // 09:00
  const unaVez = (await w.T.agregar(nueva({ titulo: 'Una vez', spec: { kind: 'once', minutos: 30 }, actuar: true }))).tarea; // 08:30
  ok('antes de hora no corre nada', await w.T.tic() === 0 && w.corridas.length === 0);
  w.t = dia(2026, 11, 25, 8, 31);
  ok('a su hora corre la que toca, y solo esa', await w.T.tic() === 1 && w.corridas.map((c) => c.titulo).join() === 'Una vez');
  ok('la corrida recibe si puede actuar', w.corridas[0].actuar === true);
  ok('una «once» queda apagada después de correr', w.T.buscar(unaVez.id).activa === false && w.T.buscar(unaVez.id).proxima === null && w.T.buscar(unaVez.id).corridas === 1);
  ok('su resultado queda en la bandeja, sin leer', w.T.resultados().length === 1 && w.T.resultados()[0].titulo === 'Una vez' && w.T.resultados()[0].salida === 'did: Tell me the news' && w.T.resultados()[0].leida === false && w.T.sinLeer() === 1 && w.T.resultados()[0].agenteNombre === 'Agent one' && w.T.resultados()[0].pasos.length === 1 && w.T.resultados()[0].actuo === true && w.T.resultados()[0].manual === false && w.T.resultados()[0].ms === 2 * MIN);
  ok('…y se avisa (el aviso de Windows)', w.avisos.length === 1 && w.avisos[0].id === w.T.resultados()[0].id);
  ok('…guardado en su documento', w.bandeja.lista.length === 1);
  ok('una «once» que ya corrió no vuelve a correr', await w.T.tic() === 0);

  w.t = dia(2026, 11, 25, 9, 1);
  ok('dos que vencen juntas corren de a una, la más atrasada primero', await w.T.tic() === 2 && w.corridas.slice(1).map((c) => c.titulo).join() === 'Diaria,Cada hora');
  ok('la diaria queda para mañana a su hora', w.T.buscar(diaria.id).proxima === dia(2026, 11, 26, 9));
  ok('la de cada hora, una hora después de TERMINAR', w.T.buscar(cada.id).proxima === w.corridas[2].t + 2 * MIN + 60 * MIN, String(new Date(w.T.buscar(cada.id).proxima)));

  // la app estuvo cerrada tres días
  w.t = dia(2026, 11, 29, 14, 0);
  const antes = w.corridas.length;
  ok('lo que faltó con la app cerrada corre UNA vez al abrir, no una por cada día', await w.T.tic() === 2 && w.corridas.length === antes + 2 && w.corridas.slice(antes).map((c) => c.titulo).sort().join() === 'Cada hora,Diaria');
  ok('…y la diaria queda para el día siguiente', w.T.buscar(diaria.id).proxima === dia(2026, 11, 30, 9) && await w.T.tic() === 0);

  // no compite con un chat
  w.t = dia(2026, 11, 30, 9, 1);
  w.ocupado = true;
  ok('con un turno de chat en curso no arranca', await w.T.tic() === 0 && w.corridas.length === antes + 2);
  w.ocupado = false;
  ok('…y corre cuando el chat termina', await w.T.tic() >= 1);

  // dos latidos encimados no corren la misma tarea dos veces
  w.t = dia(2026, 12, 1, 9, 1);
  const n0 = w.corridas.length;
  let soltar;
  w.responde = () => new Promise((r) => { soltar = () => r({ salida: 'lenta' }); });
  const lento = w.T.tic();
  await new Promise((r) => setTimeout(r, 10));
  ok('mientras corre una, se sabe cuál', w.T.corriendo()?.id === diaria.id || w.T.corriendo()?.id === cada.id);
  ok('…figura corriendo en la lista', w.T.lista().filter((t) => t.corriendo).length === 1);
  ok('un segundo latido no arranca nada mientras tanto', await w.T.tic() === 0);
  ok('…ni «Run now»', w.T.correrAhora(diaria.id).ocupado === true);
  w.responde = null;
  soltar();
  await lento;
  ok('cada tarea vencida corrió una sola vez', w.corridas.length - n0 === 2 && w.T.corriendo() === null, String(w.corridas.length - n0));
}

// ---------- 4. correr ahora, frenar, lo que falla ----------
{
  const w = mundo();
  const t = (await w.T.agregar(nueva())).tarea;
  const r = w.T.correrAhora(t.id);
  ok('«Run now» arranca sin esperar a que termine', r.ok === true && typeof r.trabajo?.then === 'function');
  const res = await r.trabajo;
  ok('…deja su resultado, marcado como corrida a mano', res.manual === true && w.T.resultados()[0].id === res.id && w.T.buscar(t.id).corridas === 1);
  ok('…y no mueve el horario', w.T.buscar(t.id).proxima === dia(2026, 11, 25, 9) && w.T.buscar(t.id).activa === true);
  {
    // (con una que corre cada tanto se nota: la próxima no se cuenta desde la corrida a mano)
    const cada = (await w.T.agregar(nueva({ titulo: 'Cada hora', spec: { kind: 'every', minutos: 60 } }))).tarea;
    const antes = cada.proxima;
    await w.T.correrAhora(cada.id).trabajo;
    ok('…tampoco el de una que corre cada tanto', w.T.buscar(cada.id).proxima === antes && w.T.buscar(cada.id).corridas === 1, String(w.T.buscar(cada.id).proxima - antes));
    const una = (await w.T.agregar(nueva({ titulo: 'Una', spec: { kind: 'once', minutos: 90 } }))).tarea;
    const suHora = una.proxima;
    await w.T.correrAhora(una.id).trabajo;
    ok('…y una «once» corrida a mano sigue esperando su hora', w.T.buscar(una.id).activa === true && w.T.buscar(una.id).proxima === suHora);
    await w.T.quitar(cada.id);
    await w.T.quitar(una.id);
  }
  await w.T.activar(t.id, false);
  ok('se puede correr a mano una apagada, y sigue apagada', (await w.T.correrAhora(t.id).trabajo).manual === true && w.T.buscar(t.id).activa === false);
  ok('correr una que no está', w.T.correrAhora('nada').ok === false);

  // frenar
  let alFrenar = null;
  w.responde = (_t, signal) => new Promise((resolve) => { alFrenar = () => resolve({ salida: 'a medias', cortada: 'stopped' }); signal.addEventListener('abort', alFrenar); });
  const lenta = w.T.correrAhora(t.id);
  await new Promise((r) => setTimeout(r, 10));
  ok('Stop le llega a la corrida', w.T.frenar().ok === true && typeof alFrenar === 'function');
  const cortada = await lenta.trabajo;
  ok('…y el resultado dice que se cortó', cortada.cortada === 'stopped' && cortada.salida === 'a medias');
  ok('sin nada corriendo, Stop no hace nada', w.T.frenar().ok === false);

  // lo que falla
  w.responde = () => { throw new Error('the provider exploded'); };
  const rota = await w.T.correrAhora(t.id).trabajo.catch(() => ({ revento: true }));
  ok('una corrida que revienta deja su error en la bandeja', rota.error === 'the provider exploded' && rota.salida === '' && w.T.corriendo() === null);
  w.responde = () => ({ error: 'The agent of this task no longer exists.' });
  ok('…y la que vuelve con un error, también', (await w.T.correrAhora(t.id).trabajo)?.error === 'The agent of this task no longer exists.');
  ok('una falla no traba las que siguen', (w.responde = null, (await w.T.correrAhora(t.id).trabajo)?.error === null));

  // borrada mientras corre
  let soltar;
  w.responde = () => new Promise((r) => { soltar = () => r({ salida: 'tarde' }); });
  const enVuelo = w.T.correrAhora(t.id);
  await new Promise((r) => setTimeout(r, 10));
  await w.T.quitar(t.id);
  soltar();
  const tarde = await enVuelo.trabajo;
  ok('una tarea borrada mientras corre no vuelve, y su resultado queda', w.T.buscar(t.id) === null && tarde.salida === 'tarde' && w.T.resultados()[0].id === tarde.id);
}

// ---------- 5. la bandeja ----------
{
  const w = mundo();
  const t = (await w.T.agregar(nueva())).tarea;
  for (let i = 0; i < 3; i++) await w.T.correrAhora(t.id).trabajo;
  const [c, b, a] = w.T.resultados();
  ok('lo último va arriba', c.ts > b.ts && b.ts > a.ts && w.T.sinLeer() === 3);
  await w.T.marcarLeida(b.id);
  ok('leer uno', w.T.sinLeer() === 2 && w.T.resultados()[1].leida === true && w.bandeja.lista[1].leida === true && (await w.T.marcarLeida('nada')).ok === false);
  await w.T.quitarResultado(a.id);
  ok('borrar uno', w.T.resultados().length === 2 && (await w.T.quitarResultado(a.id)).ok === false);
  await w.T.marcarTodas();
  ok('leer todos', w.T.sinLeer() === 0);
  await w.T.vaciarBandeja();
  ok('vaciar', w.T.resultados().length === 0 && w.bandeja.lista.length === 0 && w.T.lista().length === 1);
  w.responde = () => ({ salida: 'z'.repeat(100000), pasos: Array.from({ length: 200 }, () => ({ name: 'fs_read', label: 'x', status: 'ok' })) });
  for (let i = 0; i < T.BANDEJA_MAX + 5; i++) await w.T.correrAhora(t.id).trabajo;
  ok('la bandeja tiene tope, y cada resultado también', w.T.resultados().length === T.BANDEJA_MAX && w.T.resultados()[0].salida.length === 60000 && w.T.resultados()[0].pasos.length === 60);
}

// ---------- 6. la tool schedule ----------
{
  const w = mundo();
  const borradas = [];
  agenda.configurar({ tareas: w.T, agentes: () => [{ id: 'a1', nombre: 'Agent one' }, { id: 'a2', nombre: 'Agent two' }], alBorrar: (t) => borradas.push(t.id) });
  const run = (agente = 'a1') => ({ reqId: 'r', agente, notify() {} });
  ok('sin tareas, list lo dice', await agenda.runSchedule(run(), { action: 'list' }) === 'No tasks are scheduled.');
  const out = await agenda.runSchedule(run(), { title: 'Water the plants', prompt: 'Remind me to water the plants', kind: 'daily', at: '9:00' });
  ok('create es la acción de fábrica, y dice cuándo corre y dónde cae', out.startsWith('Scheduled "Water the plants" (every day at 09:00). First run: ') && out.includes('read-only') && out.includes('Tasks tab, not in this chat'), out);
  const creada = w.T.lista()[0];
  ok('la tarea queda a nombre del agente que la pidió, hecha por un agente y sin «Let it act»', creada.agente === 'a1' && creada.de === 'agent' && creada.actuar === false);
  ok('un agente no se da «Let it act» a sí mismo', (await agenda.runSchedule(run('a2'), { title: 'X', prompt: 'p', kind: 'every', every_minutes: 30, actuar: true, act: true, let_it_act: true }), w.T.lista().every((t) => t.actuar === false)));
  ok('once en minutos, y once a una hora', (await agenda.runSchedule(run(), { title: 'Soon', prompt: 'p', kind: 'once', minutes_from_now: 20 })).includes('(once, in 20 minutes)') && (await agenda.runSchedule(run(), { title: 'Later', prompt: 'p', kind: 'once', at: '18:30' })).includes('(once, at 18:30)'));
  ok('lo que falta se dice, sin crear nada', (await agenda.runSchedule(run(), { title: 'Bad', prompt: 'p', kind: 'every', every_minutes: 1 })).startsWith('error: A repeating task runs every 5 minutes') && (await agenda.runSchedule(run(), { title: 'Bad', kind: 'daily', at: '9:00' })).startsWith('error: Write what the agent has to do')
    && (await agenda.runSchedule(run(), { title: 'Bad', prompt: 'p' })).startsWith('error: The task must run once') && (await agenda.runSchedule(run(), { title: 'Bad', prompt: 'p', kind: 'daily', at: '25:00' })).startsWith('error: ') && w.T.lista().every((t) => t.titulo !== 'Bad'));
  ok('una corrida sin agente no agenda', (await agenda.runSchedule({ reqId: 'r', notify() {} }, { title: 'X', prompt: 'p', kind: 'daily', at: '9:00' })).startsWith('error: this run does not belong to an agent'));
  const lista = await agenda.runSchedule(run(), { action: 'list' });
  ok('list trae el id, cada cuánto, de quién es y cuándo corre', lista.startsWith('Scheduled tasks:\n') && lista.includes(`- ${creada.id} · "Water the plants" · every day at 09:00 · agent Agent one · next run `) && lista.includes('agent Agent two') && lista.includes('· read-only'), lista);
  ok('delete pide un id que exista', (await agenda.runSchedule(run(), { action: 'delete' })).startsWith('error: id is required') && (await agenda.runSchedule(run(), { action: 'delete', id: 'nada' })).startsWith('error: there is no task "nada"'));
  const del = await agenda.runSchedule(run(), { action: 'delete', id: creada.id });
  ok('delete la borra y le avisa al usuario, que la puede recuperar', del.startsWith('Deleted the task "Water the plants".') && w.T.buscar(creada.id) === null && borradas.join() === creada.id && (await w.T.restaurar(creada.id)).ok === true);

  // la tarjeta de permiso
  const v = agenda.vista(run(), { title: 'Morning', prompt: 'Do the thing', kind: 'every', every_minutes: 120 });
  ok('la tarjeta de crear dice qué, cada cuánto, quién la corre y qué se le va a pedir', JSON.stringify(v) === JSON.stringify({ mode: 'tarea', accion: 'create', titulo: 'Morning', cuando: 'every 2 hours', agente: 'Agent one', prompt: 'Do the thing' }), JSON.stringify(v));
  ok('…o por qué va a fallar', agenda.vista(run(), { title: 'x', prompt: 'p', kind: 'every', every_minutes: 2 }).mode === 'fail');
  ok('la de borrar dice cuál', JSON.stringify(agenda.vista(run(), { action: 'delete', id: creada.id })) === JSON.stringify({ mode: 'tarea', accion: 'delete', titulo: 'Water the plants', cuando: 'every day at 09:00', agente: 'Agent one' }) && agenda.vista(run(), { action: 'delete', id: 'nada' }).mode === 'fail');
  ok('listar no tiene tarjeta', agenda.vista(run(), { action: 'list' }) === null);
  ok('qué acciones cambian algo', agenda.accionDe({}) === 'create' && agenda.accionDe({ action: 'delete' }) === 'delete' && agenda.accionDe({ action: 'list' }) === 'list' && agenda.accionDe({ action: 'otra' }) === 'create' && agenda.accionDe(undefined) === 'create');

  // la definición y el grupo
  const def = defs.TOOL_DEFS.find((t) => t.name === 'schedule');
  ok('la tool está definida, sin nada obligatorio en el esquema', Boolean(def) && def.parameters.required.length === 0 && Object.keys(def.parameters.properties).join() === 'action,id,title,prompt,kind,minutes_from_now,at,every_minutes');
  ok('su descripción dice que corre sin nadie, dónde cae y que pide permiso', /unattended/.test(def.description) && /Tasks tab/.test(def.description) && /always asks the user first/.test(def.description));
  ok('no tiene un parámetro para darse permiso de actuar', !Object.keys(def.parameters.properties).some((p) => /^(act|actuar|let_it_act|allow.*)$/i.test(p)));
  const grupo = defs.GRUPOS.find((g) => g.id === 'tasks');
  ok('va en su grupo, que no es opcional', grupo?.tools.join() === 'schedule' && !grupo.opcional);
}

// ---------- 7. qué tools tiene una corrida sin nadie mirando ----------
{
  motor.registrar(Object.fromEntries(['fs_read', 'fs_write', 'shell_exec', 'web_search', 'fetch', 'schedule', 'delegate', 'generate_image', 'canvas', 'screen_capture', 'recall', 'remember', 'notepad', 'skill', 'browser_read', 'browser_click'].map((n) => [n, () => 'x'])));
  const todas = ['fs_read', 'fs_write', 'shell_exec', 'web_search', 'fetch', 'schedule', 'delegate', 'generate_image', 'canvas', 'screen_capture', 'recall', 'remember', 'notepad', 'skill', 'browser_read', 'browser_click'];
  const lee = motor.activeToolNames({ tools: todas, tarea: { actuar: false } });
  ok('sin «Let it act», solo las de lectura', lee.slice().sort().join() === ['browser_read', 'fetch', 'fs_read', 'notepad', 'recall', 'skill', 'web_search'].join(), lee.join());
  ok('…y la pantalla no, aunque sea de lectura', !lee.includes('screen_capture'));
  const actua = motor.activeToolNames({ tools: todas, tarea: { actuar: true } });
  ok('con «Let it act», lo del agente', actua.includes('fs_write') && actua.includes('shell_exec') && actua.includes('remember') && actua.includes('browser_click'));
  ok('…menos agendar, delegar, generar imágenes y el canvas, nunca', !actua.includes('schedule') && !actua.includes('delegate') && !actua.includes('generate_image') && !actua.includes('canvas'), actua.join());
  ok('un turno de chat sigue teniendo todo', motor.activeToolNames({ tools: todas }).length === todas.length);
  // la sesión
  const s = sesiones.crear({ reqId: 'r', convoId: '', ac: new AbortController(), tools: todas, confirma: false, tarea: { actuar: false } });
  ok('la sesión de una tarea no pide permiso nunca', s.run.needsConfirm('fs_read', {}) === false && s.run.tarea.actuar === false);
  const sistema = s.sistema('Be brief.');
  ok('su system dice que es una tarea programada, que nadie mira y que es de solo lectura', sistema.includes('## This is a scheduled task') && sistema.includes('Nobody can answer a question') && sistema.includes('This run is read-only') && sistema.startsWith('Be brief.'));
  const s2 = sesiones.crear({ reqId: 'r', convoId: '', ac: new AbortController(), tools: todas, confirma: false, tarea: { actuar: true } });
  ok('…y con «Let it act» no dice que es de solo lectura', s2.sistema('').includes('## This is a scheduled task') && !s2.sistema('').includes('This run is read-only'));
  ok('un turno de chat no lleva esa nota', !sesiones.crear({ reqId: 'r', convoId: 'c', ac: new AbortController(), tools: todas, confirma: true }).sistema('').includes('scheduled task'));
}

// ---------- 8. el ícono de la bandeja ----------
{
  ok('el registro dice si la barra de Windows es clara', B.temaDe('\r\nHKEY_CURRENT_USER\\Software\\...\\Personalize\r\n    SystemUsesLightTheme    REG_DWORD    0x1\r\n') === true && B.temaDe('    SystemUsesLightTheme    REG_DWORD    0x0') === false);
  ok('…y lo que no se entiende no es ni una ni otra', B.temaDe('ERROR: The system was unable to find the specified registry key or value.') === null && B.temaDe('') === null && B.temaDe(null) === null);
  const reg = (salida, err = null) => (cmd, args, opts, cb) => { reg.visto = [cmd, ...args]; cb(err, salida); };
  ok('se le pregunta a reg por SystemUsesLightTheme', await B.barraClara({ correr: reg('    SystemUsesLightTheme    REG_DWORD    0x1'), plataforma: 'win32' }) === true && reg.visto[0] === 'reg' && reg.visto.includes('SystemUsesLightTheme') && reg.visto.some((a) => a.includes('Themes\\Personalize')));
  ok('si reg falla, o tira, la barra se supone oscura', await B.barraClara({ correr: reg('', new Error('no')), plataforma: 'win32' }) === false && await B.barraClara({ correr: () => { throw new Error('x'); }, plataforma: 'win32' }) === false);
  ok('fuera de Windows no se pregunta nada', await B.barraClara({ correr: () => { throw new Error('no debería'); }, plataforma: 'darwin' }) === false);
  let cambios = 0;
  let salida = '    SystemUsesLightTheme    REG_DWORD    0x0';
  const b = B.crear({ dir: path.join('C:', 'app', 'build'), alCambiar: () => { cambios++; }, correr: (c, a, o, cb) => cb(null, salida), plataforma: 'win32' });
  ok('de fábrica, el dibujo claro (barra oscura)', path.basename(b.icono()) === 'tray.ico' && b.clara() === false);
  ok('si la barra sigue oscura, no cambia nada', await b.mirar() === false && cambios === 0);
  salida = '    SystemUsesLightTheme    REG_DWORD    0x1';
  ok('con la barra clara va el dibujo oscuro, y se avisa', await b.mirar() === true && path.basename(b.icono()) === 'tray-dark.ico' && cambios === 1);
  ok('…y vuelve cuando vuelve', (salida = 'x', await b.mirar() === true && path.basename(b.icono()) === 'tray.ico' && cambios === 2));
  // los archivos del ícono: existen, son .ico, y viajan en el paquete
  const build = path.join(APP, 'build');
  const ico = (f) => { const buf = fs.readFileSync(path.join(build, f)); return { tipo: buf.readUInt16LE(2), n: buf.readUInt16LE(4), primero: buf[6] }; };
  ok('los dos íconos de bandeja están horneados, con sus tamaños', ico('tray.ico').tipo === 1 && ico('tray.ico').n === 7 && ico('tray.ico').primero === 16 && ico('tray-dark.ico').n === 7);
  ok('…y no son el mismo archivo', !fs.readFileSync(path.join(build, 'tray.ico')).equals(fs.readFileSync(path.join(build, 'tray-dark.ico'))));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok('…y viajan en la app empaquetada', pkg.build.files.includes('build/tray.ico') && pkg.build.files.includes('build/tray-dark.ico'));
  // (desde la 1.3.0 el de la bandeja es el dibujo ENTERO del ícono común —contorno, rayos, agentes y núcleo—, sin la baldosa)
  {
    const horno = fs.readFileSync(path.join(APP, 'scripts', 'icon.mjs'), 'utf8');
    const deBandeja = horno.slice(horno.indexOf('const trayGlyph'), horno.indexOf('const drawTray'));
    ok('el ícono de la bandeja lleva el dibujo entero: contorno, rayos, agentes y núcleo', deBandeja.includes('alpha: CONTORNO') && deBandeja.includes('alpha: RAYOS') && (deBandeja.match(/sdSegment/g) ?? []).length === 2 && (deBandeja.match(/sdCircle/g) ?? []).length === 2);
    ok('…y sigue sin baldosa', horno.includes('const drawTray = (size, v) => rasterizeBare(size, trayGlyph(size, v));'));
    // el archivo horneado: de un agente al núcleo hay tinta todo el camino (el rayo), y la esquina sigue vacía
    const crudo = fs.readFileSync(path.join(build, 'tray.ico'));
    const n = crudo.readUInt16LE(4);
    let mayor = null;
    for (let i = 0; i < n; i++) { const e = 6 + i * 16; const lado = crudo[e] || 256; if (!mayor || lado > mayor.lado) mayor = { lado, largo: crudo.readUInt32LE(e + 8), desde: crudo.readUInt32LE(e + 12) }; }
    ok('el mayor tamaño del ícono de bandeja está y pesa lo que un dibujo con líneas', mayor.lado === 64 && mayor.largo > 600, JSON.stringify(mayor));
  }
}

// ---------- 9. el cableado ----------
{
  const chat = fs.readFileSync(path.join(APP, 'main', 'chat.cjs'), 'utf8');
  ok('agendar o borrar pide permiso siempre: ni el automático ni «no preguntar más» lo saltean', chat.includes("confirma: (name, args) => (name === 'schedule' && herramientas.agendaPide(args)) || ((pedido.modo !== 'auto' || mcp.pregunta(name)) && !confiados.has(pedido.chat)),"));
  ok('una tarea no compite con un turno de chat', chat.includes('ocupado: () => activos.size > 0,'));
  ok('la corrida no pide permiso, y un servidor MCP que pregunta queda afuera', chat.includes('confirma: false,') && chat.includes('.filter((n) => !mcp.pregunta(n));'));
  ok('las tareas y su bandeja van en documentos que la interfaz no lee', chat.includes("rad.store.read('_tareas')") && chat.includes("rad.store.write('_tareas_bandeja', doc)"));
  ok('en el humo no se manda un aviso de Windows de verdad', /if \(taller\) return;[^\n]*\n\s*const \{ Notification \}/.test(chat));
  ok('el latido arranca con la app y para al salir', chat.includes('tareas.arrancar();') && chat.includes('tareas.parar(); tareas.frenar();'));
  const principal = fs.readFileSync(path.join(APP, 'main.cjs'), 'utf8');
  ok('la app pide bandeja, con el ícono según la barra y el ajuste del usuario', principal.includes('tray: {') && principal.includes('icon: () => bandeja.icono(),') && principal.includes("keep: () => rad.store.read('fondo')?.bandeja !== false,"));
}

if (failures.length) {
  console.error(`test-blackcode-tareas: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-tareas: ok (${hechas} comprobaciones: cuándo corre, armar y cambiar, el latido y las atrasadas, correr ahora y frenar, la bandeja, la tool schedule y su tarjeta, qué tools tiene una corrida sin nadie mirando, el ícono de la bandeja y el cableado)`);
process.exit(0);
