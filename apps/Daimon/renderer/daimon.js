// Daimon: arma el shell del núcleo con sus tres vistas.

import { createShell } from '/@core/shell.js';
import { hold } from '/@core/ready.js';
import { wireUpdates } from '/@core/updates.js';
import * as datos from './datos.js';
import * as llave from './llave.js';
import { montarChat } from './chat.js';
import { montarAgentes } from './agentes.js';
import { montarAjustes } from './ajustes.js';
import { ICONOS } from './piezas.js';

// La interfaz se arma después de leer los datos: el arranque espera.
const release = hold();
await Promise.all([datos.abrir(), llave.refrescar()]);

const views = [
  { id: 'chat', label: 'Chat', icon: ICONOS.chat, scroll: false, mount: (el, router) => montarChat(el, { router }) },
  { id: 'agentes', label: 'Agents', icon: ICONOS.agentes, mount: (el, router) => montarAgentes(el, { router }) },
  { id: 'ajustes', label: 'Settings', icon: ICONOS.ajustes, mount: (el, router) => montarAjustes(el, { router }) },
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
// (o que alguien está contestando).
const ponerEstado = () => {
  const a = datos.agenteActual();
  shell.status.set('right', datos.algunoRespondiendo() ? 'Answering…' : `${a.nombre} · ${datos.modeloDe(a)}`);
};
shell.status.set('left', views.find((v) => v.id === shell.router.current).label);
shell.router.on('change', ({ label }) => shell.status.set('left', label));
ponerEstado();
datos.on('agentes', ponerEstado);
datos.on('modelos', ponerEstado);
datos.on('seleccion', ponerEstado);
datos.on('respuesta', ponerEstado);

// El aviso de versión nueva (no baja nada solo, y no dice «estás al día»).
wireUpdates({ name: 'Daimon' });

release();
