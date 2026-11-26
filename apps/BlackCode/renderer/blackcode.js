// BlackCode: arma el shell del núcleo con sus cuatro vistas.

import { createShell } from '/@core/shell.js';
import { hold } from '/@core/ready.js';
import { wireUpdates } from '/@core/updates.js';
import * as datos from './datos.js';
import * as llave from './llave.js';
import { montarChat } from './chat.js';
import { montarAgentes } from './agentes.js';
import { montarNotas } from './notas.js';
import { montarMemoria } from './memoria.js';
import { montarSkills, revisarSkill } from './skills.js';
import { toast } from '/@core/toast.js';
import { abrirAjustes, cerrarAjustes } from './ajustes.js';
import { montarTareas, ponerPunto, abrirResultado } from './tareas.js';
import { ICONOS } from './piezas.js';
import { montarVoz, estadoDeVoz, estadoDeHabla } from './voz.js';
import { montarMovil } from './movil.js';

// La interfaz se arma después de leer los datos: el arranque espera.
const release = hold();
await Promise.all([datos.abrir(), llave.refrescar()]);

const views = [
  { id: 'chat', label: 'Chat', icon: ICONOS.chat, scroll: false, sheets: true, mount: (el, router) => montarChat(el, { router }) },
  { id: 'notas', label: 'Notes', icon: ICONOS.nota, scroll: false, sheets: true, mount: (el, router) => montarNotas(el, { router }) },
  { id: 'memoria', label: 'Memory', icon: ICONOS.memoria, mount: (el) => montarMemoria(el) },
  { id: 'skills', label: 'Skills', icon: ICONOS.skills, mount: (el) => montarSkills(el) },
  { id: 'tareas', label: 'Tasks', icon: ICONOS.reloj, mount: (el, router) => montarTareas(el, { router }) },
  { id: 'agentes', label: 'Agents', icon: ICONOS.agentes, mount: (el, router) => montarAgentes(el, { router }) },
  // (Settings no es una vista: es un modal que flota sobre la que esté)
  { id: 'ajustes', label: 'Settings', icon: ICONOS.ajustes, action: () => abrirAjustes() },
];

const shell = createShell({
  root: document.querySelector('.rad-root'),
  // Las vistas van como pestañas en la titlebar, sin rail y sin el nombre
  // de la app: todo el ancho queda para los chats, la conversación y lo que
  // se abra al lado.
  title: false,
  nav: 'titlebar',
  views,
});

// La barra de abajo: a la izquierda la vista, a la derecha con quién se habla
// (o que alguien está contestando). Dice también cuántas tools lleva ese
// agente en cada pedido: nacen apagadas, y sin esto no hay forma de saber,
// desde el chat, si el modelo las tiene o no.
const ponerEstado = () => {
  const a = datos.agenteActual();
  const n = datos.toolsQueViajan(a);
  const tools = n ? `${n} tool${n === 1 ? '' : 's'}` : 'no tools';
  // (mientras el Atom Echo escucha o Whisper transcribe, eso es lo que se dice)
  shell.status.set('right', estadoDeVoz() ?? estadoDeHabla() ?? (datos.algunoRespondiendo() ? 'Answering…' : `${a.nombre} · ${datos.modeloDe(a)} · ${tools}`));
};
// (el lado izquierdo de la barra queda vacío: dónde se está ya lo dicen las pestañas)
// Settings flota sobre la vista: lo que lleve a una vista (el «Open» de un
// aviso, «Go to the chat», el ícono de la bandeja) lo cierra, o quedaría
// tapando el lugar al que se quiso ir.
shell.router.on('go', () => cerrarAjustes());
ponerEstado();
datos.on('agentes', ponerEstado);
datos.on('modelos', ponerEstado);
// (un servidor MCP conecta o se cae: cambia cuántas tools tiene el agente)
datos.on('tools', ponerEstado);
datos.on('seleccion', ponerEstado);
datos.on('respuesta', ponerEstado);
datos.on('voz', ponerEstado);

// Un agente propuso una skill: no se puede usar hasta que el usuario la
// apruebe, así que se le avisa, esté en la vista que esté.
window.rad.on('skills:evento', (ev) => {
  if (!ev?.propuesta) return;
  toast({
    text: `An agent proposed a skill: “${ev.propuesta}”. No agent can use it until you approve it.`,
    duration: 12000,
    action: { label: 'Review', onClick: () => { shell.router.go('skills'); revisarSkill(ev.propuesta); } },
  });
});

// Las tareas programadas: el punto de su pestaña dice que hay resultados sin
// leer (también antes de abrirla), el aviso de Windows trae al resultado, y si
// un agente borra una tarea se le dice al usuario, que la puede recuperar.
ponerPunto();
window.rad.on('tareas:evento', () => ponerPunto());
window.rad.on('tareas:abrir', (ev) => { shell.router.go('tareas'); if (ev?.id) abrirResultado(ev.id); });
window.rad.on('tareas:borrada', (ev) => {
  if (!ev?.id) return;
  toast({
    text: `An agent deleted the task “${ev.titulo}”.`,
    duration: 12000,
    action: { label: 'Undo', onClick: () => window.rad.invoke('tareas:restaurar', ev.id) },
  });
});

// La voz: lo que se le dice al Atom Echo entra a un chat de su agente.
montarVoz({ shell, alHablar: ponerEstado });

// El celular (BlackCode Mobile): contesta lo que pide el puente y le pasa lo que
// pasa en los chats. Ver movil.js y main/movil.cjs.
montarMovil();

// El aviso de versión nueva (no baja nada solo, y no dice «estás al día»).
wireUpdates({ name: 'BlackCode' });

release();
