# Rad

Un núcleo de app de escritorio (Electron) y las pieles que nacen de él.

El núcleo pone los huesos: la ventana, el puente al main, el protocolo, el
arranque y, a medida que crezca, el shell, el router, el movimiento, los
overlays y el guardado. **No sabe nada de estilo.** Todo lo que se ve lo pone
una piel. Un arreglo en el núcleo les llega a todas las pieles, y una piel
nueva no toca el núcleo.

## Estructura

```
packages/core           @rad/core: los huesos
  contract/tokens.cjs   el contrato de tokens entre el núcleo y las pieles
  main/                 proceso principal: ventana, protocolo rad://, humo
  preload/              el puente window.rad
  renderer/             core.css, boot.js, scroll.js
packages/skin-classic   @rad/skin-classic: la piel neutral
packages/skin-glass     @rad/skin-glass: la piel de vidrio
packages/skin-mono      @rad/skin-mono: glass sin color (hereda de glass)
apps/showcase           la vitrina: todos los tokens con la piel activa
apps/BlackCode             BlackCode: un chat con IA y varios agentes (piel mono)
tools/                  verificadores, humo y capturas
```

## El contrato

`packages/core/contract/tokens.cjs` lista cada token (`--rad-*`) con su tipo y
su rol. El núcleo usa solo esos tokens; cada piel los define todos. Lo propio
de una piel va con `--skin-*`.

Las capas de CSS van en este orden: `rad.reset, rad.core, rad.skin, app`. La
piel le gana al núcleo, y la app a los dos.

## Cómo arma su ventana una app

```js
const path = require('node:path');
const rad = require('@rad/core/main');

rad.start({
  skin: require('@rad/skin-classic'),
  renderer: path.join(__dirname, 'renderer'),
  window: { width: 1200, height: 780, title: 'Mi app' },
});
```

El renderer se sirve desde un solo origen:

- `rad://app/@core/…` son los archivos del núcleo;
- `rad://app/@skin/…` son los de la piel activa (la entrada es `index.css`);
- `rad://app/…` es el renderer de la app.

En el `index.html` van `@core/core.css`, `@skin/index.css` y
`@core/boot.js`, y todo el contenido adentro de un `.rad-root`. Desde JS, el
núcleo se importa con la ruta absoluta (`/@core/shell.js`): un nombre suelto
necesitaría un import map, que es un script inline y la CSP no lo deja pasar.

## El shell y las vistas

```js
import { createShell } from '/@core/shell.js';

const shell = createShell({
  root: document.querySelector('.rad-root'),
  title: 'Mi app',
  views: [
    { id: 'inicio', label: 'Inicio', icon: '<svg…>', mount(el, router) { … } },
    { id: 'ajustes', label: 'Ajustes', icon: '<svg…>', mount(el) { … } },
  ],
});

shell.router.go('ajustes');
shell.router.on('change', ({ id, from, label }) => { … });
shell.status.set('left', 'Listo');
shell.setSubtitle('borrador');
```

- **Titlebar** propia con los controles de ventana. Se arrastra entera. Cada
  botón de ventana ocupa todo el alto y llega al canto (la esquina sigue
  cerrando con la ventana maximizada), pero lo que se ve es una pastilla más
  chica adentro: la piel pinta `.rad-winbtn::before`, no el botón.
- **Rail** con un item por vista. El indicador viaja al activo, y las flechas
  lo recorren con el teclado. Se apaga con `rail: false`.
- **Pestañas en la titlebar**: con `nav: 'titlebar'` las vistas van como
  pestañas adentro de la titlebar en vez de en el rail, y el escenario gana
  ese ancho. La activa muestra su rótulo y las demás solo el ícono, con el
  rótulo en el tooltip (una vista sin ícono lo muestra siempre); las flechas
  a los lados las recorren. De lo que ocupan no se arrastra la ventana.
  `title: false` saca el nombre de la app de la titlebar. `nav` vale
  `'rail'` (por defecto), `'titlebar'` o `'none'`.
- **Escenario**: cada vista se monta la primera vez que se visita y queda
  viva, con su scroll y su estado. El cambio entre vistas es un fundido: la
  nueva está entera debajo y la vieja se esfuma encima.
- **Statusbar** con dos lados; cada texto cambia con un relevo. Se apaga con
  `statusbar: false`.

La anatomía (`.rad-titlebar`, `.rad-rail-item`, `.rad-tab`, `.rad-stage`, `.rad-view`,
`.rad-statusbar`…) es parte de la API: la piel se engancha ahí.

## Lo que flota

```js
import { menuButton, contextMenu } from '/@core/menu.js';
import { openModal, confirm } from '/@core/modal.js';
import { toast } from '/@core/toast.js';

menuButton(boton, () => [
  { id: 'dup', label: 'Duplicar', shortcut: 'Ctrl+D', onSelect() { … } },
  { separator: true },
  { id: 'del', label: 'Eliminar', danger: true, onSelect() { … } },
]);

// Contextual: sale en el punto del click derecho (o de la tecla de menú).
contextMenu(lista, (e) => {
  const fila = e.target.closest('.fila');
  return fila && [{ label: 'Renombrar', onSelect() { … } }];   // sin items, no abre
});

const m = openModal({ title: 'Renombrar', body: nodo, actions: [
  { id: 'cancel', label: 'Cancelar' },
  { id: 'ok', label: 'Guardar', variant: 'primary' },
] });
await m.closed; // el id de la acción, o 'dismiss'

if (await confirm({ title: '¿Eliminar?', confirmLabel: 'Eliminar', danger: true })) { … }

toast({ text: 'Guardado', kind: 'success' });
```

Y los tooltips no se importan: cualquier elemento con `data-rad-tip="Guardar"`
(y opcionalmente `data-rad-tip-key="Ctrl+S"`) ya lo tiene. Nunca `title=`.

Todo vive en una capa fija hermana de `.rad-root`, entra y sale animado
(`present()` y `dismiss()` de `motion.js`), y el Escape lo atiende siempre el
de más arriba. El botón del núcleo es `.rad-button`, con
`data-variant="primary" | "danger" | "quiet"`.

### Cargando

```js
import { setBusy } from '/@core/busy.js';

setBusy(tarjeta, true);    // una luz empieza a recorrer su reborde
await guardar();
setBusy(tarjeta, false);   // se apaga fundiéndose
```

Una luz con resplandor recorre el contorno de lo que está trabajando, a la
misma velocidad en todo el recorrido. Todo lo que carga a la vez gira en
fase. Marca además `aria-busy`. Los colores (cola y cabeza), el grosor, el
resplandor y cuánto tarda la vuelta son perillas `--rad-a-busy-*` que la piel
puede pisar en `.rad-busy`.

El anillo es un hijo del elemento: no sirve en un `<input>` (se pone en lo
que lo envuelve) ni en algo que scrollea. Si el elemento recorta
(`overflow: hidden`), se ve la línea pero no el resplandor de afuera.

### Listas que cambian

```js
import { reconcile } from '/@core/list.js';

reconcile(lista, chats, {
  key: (chat) => chat.id,
  create: (chat) => fila(chat),        // el nodo de un item nuevo
  update: (nodo, chat) => { … },       // pone al día el de uno que sigue
});
```

Una lista que ya se ve no se rehace: se pone al día por clave. El item que
sigue es el mismo nodo (conserva su foco y su hover) y, si cambió de lugar,
viaja hasta él. El que se va se esfuma en su lugar, fuera del flujo, mientras
los demás se acomodan. El nuevo entra fundiéndose, después de que el que se
iba casi no se ve. El primer llenado no es un cambio: aparece sin entrada.

La entrada, la salida y el viaje los pone `reconcile`: las filas no llevan
una animación de entrada propia en el CSS. El viaje se mide contra el
contenedor (un cambio de scroll no es un movimiento), se mide todo antes de
animar, y lo que está fuera de la ventana no viaja: una lista de cientos de
items no congela la ventana cuando entra uno.

## Controles

Casi todos son HTML con clases, sin JS:

```html
<label class="rad-field">
  <span class="rad-field-label">Nombre</span>
  <input class="rad-input" type="text">
  <span class="rad-field-hint">Como aparece en las recetas.</span>
</label>

<label class="rad-check"><input type="checkbox"><span class="rad-check-box"></span>Recordarme</label>
<label class="rad-radio"><input type="radio" name="orden"><span class="rad-radio-dot"></span>Fecha</label>
<label class="rad-switch"><input type="checkbox" role="switch"><span class="rad-switch-track"></span>Sonido</label>
<button class="rad-iconbutton" aria-label="Fijar" data-rad-tip="Fijar">…</button>
```

Son inputs nativos de verdad, escondidos, con el dibujo propio encima. Los
que necesitan JS:

```js
import { createSelect, setFieldError } from '/@core/controls.js';

const turno = createSelect({ options: [{ value: 'm', label: 'Mañana' }, …], value: 'm', onChange(v) { … } });
setFieldError(campo, 'Falta el nombre.');   // null lo limpia
```

Una etiqueta que no entra en el botón del select se corta con puntos
suspensivos (el chevron no se mueve) y el botón la muestra entera en su
tooltip.

## Guardado y puente

```js
// renderer
import { openDoc, removeDoc } from '/@core/store.js';
import { hold } from '/@core/ready.js';

const release = hold();                      // el arranque espera a la interfaz
const ajustes = await openDoc('ajustes', { densidad: 'normal' });
ajustes.patch({ densidad: 'compacta' });     // se guarda solo
armarInterfaz();
release();

await removeDoc('nota-vieja');               // borra el archivo y su .bak

const info = await rad.invoke('sistema:info');
rad.on('notas:cambiaron', (datos) => { … });
```

```js
// main
rad.handle('sistema:info', () => ({ … }));
rad.send('notas:cambiaron', datos);
rad.store.read('ajustes');
rad.store.remove('nota-vieja');
rad.adoptData('Nombre viejo');               // antes de tocar el store
```

- Cada documento es un JSON en `<userData>/data`. Se escribe a un temporal
  único y se renombra encima, con `.bak` del anterior y reintentos si Windows
  tiene el archivo tomado. Un documento roto no se pisa: se aparta y se
  recupera del `.bak`.
- Al cerrar la app, lo pendiente baja al disco antes de salir.
- La ventana se acuerda de su lugar, su tamaño y si estaba maximizada; si el
  monitor ya no está, vuelve al centro.
- Una sola instancia: la segunda le pasa el foco a la primera.
- Los links a la web (`http`, `https`, `mailto`) se abren en el navegador.
- El renderer solo ve canales `app:*`. Los documentos con `_` son del proceso
  principal: el renderer no puede leerlos, escribirlos ni borrarlos. El núcleo
  guarda ahí el lugar de la ventana, y una app, lo que el renderer no tiene
  que ver (una llave cifrada).
- Borrar un documento va por la misma cola que guardarlo: un guardado que
  venía en vuelo no lo resucita.
- Una app que cambia de nombre estrena carpeta de datos (sale del
  `productName`). `rad.adoptData('Nombre viejo')`, antes del primer uso del
  store, copia los datos de la carpeta vieja si la nueva todavía no existe.
  Se puede dejar para siempre: no pisa nada y no borra la vieja.
- `RAD_DATA=<carpeta>` manda los datos y el perfil a otro lado (los tests lo
  usan para no tocar la app real).

## Una piel

Una piel es una carpeta `packages/skin-<id>` con:

- `skin.cjs`: `{ id, name, base, root }`. `base` es el color con que Electron
  pinta la ventana antes del primer frame: `#rrggbb` e igual a `--rad-surface-0`.
  Opcionales, para quien liste las pieles: `description` y `preview` (cuatro o
  cinco colores que la resumen).
- `index.css`: la entrada, que importa sus partes en `layer(rad.skin)`.

Rad es solo oscuro: el verificador rechaza una superficie clara.

Hoy hay tres:

- **classic**: neutral y sobria. Grafito, un acento azul acero, sombras suaves.
- **glass**: vidrio ahumado sobre una luz lejana. El fondo es un telón casi
  negro con campos de color apagados, y todo lo demás son hojas que lo dejan
  pasar.
- **mono**: glass sin color. Vidrio oscuro acromático donde toda la luz es
  blanca; lo prendido no es un bloque blanco sino vidrio encendido. Hereda de
  glass.

### Una piel que hereda de otra

Si una piel es una variante de otra, no la copia: la hereda.

```js
// packages/skin-mono/skin.cjs
module.exports = { id: 'mono', name: 'Mono', base: '#0a0a0a', root: __dirname,
  extends: require('@rad/skin-glass') };
```

```css
/* packages/skin-mono/index.css */
@import url('/@base/index.css') layer(rad.skin);   /* la base, entera */
@import url('tokens.css') layer(rad.skin);         /* lo que cambia */
@import url('mono.css') layer(rad.skin);
```

El núcleo sirve los archivos de la base en `/@base/`. La base queda en una
subcapa de `rad.skin` y lo propio, directo en `rad.skin`, así que le gana sin
pelear especificidad. Un arreglo en la base le llega sola a la que hereda. Se
admite un solo nivel. Para que funcione, la base no puede tener colores del
acento escritos a mano en su anatomía: salen de los tokens (o de un
`color-mix` sobre ellos).

### Superficies translúcidas

`--rad-surface-0` es opaca siempre (es el fondo de la ventana). De la 1 a la 3
pueden ser velos translúcidos, que se suman sobre lo que tengan abajo: así una
tarjeta de una app (`background: var(--rad-surface-2)`) sale de vidrio sin
saber nada de la piel. Una app no puede contar con que una superficie tape.

Lo único que sí tiene que tapar es una vista: el fundido entre vistas deja a
la que se va encima de la nueva. Por eso una piel de vidrio no pinta el
escenario con el velo suelto: lo compone opaco (el velo encima del mismo
fondo de la ventana, corrido para que calce), y la vista lo hereda. El humo
lo comprueba.

Lo que scrollea de costado (una tira de fichas) lleva `.rad-scroll-x`: el
mismo esfumado que `.rad-scroll`, del lado que recorta (`at-start` / `at-end`
los pone `wireScroll`; `data-rad-line="start|end|both"` apaga el lado que ya
tiene una línea).

Si algo scrollea y tiene las esquinas redondeadas, su scrollbar lleva respiro
para que la curva no corte el pulgar: `--rad-a-scroll-inset` en ese elemento
(vale también para lo propio de una app: `.mi-panel { --rad-a-scroll-inset:
var(--rad-space-2); }`). No se hereda a los scrolls de adentro.

Una piel también puede traer sus propias entradas: define sus `@keyframes`
(con prefijo `skin-`) y pisa `--rad-a-in` / `--rad-a-out` en el componente.
Si la entrada es un recorte que se abre (`clip-path`), el recorte termina con
margen negativo, así apagar la animación no corta ninguna sombra.

Y el vidrio que esmerila (`backdrop-filter`) es solo para lo que flota sobre
el contenido. No viaja: una piel cambia las entradas con transform del núcleo
por fundidos, pisando `--rad-a-in` y `--rad-a-out` en ese componente.

### Diseñar una piel

La vitrina tiene un selector (la vista Pieles): elegís una, se cierra y
vuelve a abrir con ella, y se acuerda. `RAD_SKIN=<id>` la fuerza sin tocar lo
guardado. Para mirar una piel escena por escena sin abrir nada a mano:

```
npm run shots -- glass              todas las escenas
npm run shots -- glass menu modal   solo esas
```

Deja las capturas en `.smoke/shots/`.

## Fuentes compartidas

`packages/fonts` (`@rad/fonts`) trae fuentes que viajan con Rad y se sirven en
`rad://app/@fonts/`. La piel define sus fuentes, y cada app puede elegir otra
al arrancar:

```js
rad.start({
  skin: require('@rad/skin-classic'),
  renderer: path.join(__dirname, 'renderer'),
  fonts: { mono: 'roboto-mono' },   // ui, display o mono
});
```

Los ids salen de `packages/fonts/catalog.json` (hoy: `roboto-mono` y
`cascadia-mono`). La elegida va adelante y la de la piel queda de reserva. Van
con `font-display: block` y el arranque espera a que estén cargadas, así el
texto nunca cambia de forma ya a la vista.

## Idioma

El núcleo pone pocos textos por su cuenta (los botones de la ventana, los
de un `confirm`, el aviso de actualización, el placeholder de un select).
Salen en castellano; una app en inglés lo dice al arrancar:

```js
rad.start({ …, lang: 'en' });   // 'es' si no se dice nada
```

El renderer lo ve en `rad.lang`, y el núcleo lo pone en el `lang` del
documento. Los textos están en `packages/core/renderer/strings.js`. Lo que
escribe la app (títulos, rótulos, mensajes) es de la app: esto no es un
sistema de traducciones.

## Comandos

```
npm install
npm run showcase   abre la vitrina
npm run blackcode     abre BlackCode
npm run verify     el núcleo sin estilo y cada piel contra el contrato
npm run test       el guardado y el proveedor de BlackCode, con node pelado
npm run smoke      abre la vitrina dos veces por piel y BlackCode dos veces, mide lo que se ve y lo que sobrevive
npm run check      verify + test + smoke
npm run shots      capturas de la vitrina con una piel, para diseñarla
npm run shots:blackcode   capturas de BlackCode con datos de mentira
```

El humo de cada app es su propio guion (`tools/smoke-showcase.js`,
`tools/smoke-blackcode.js`), que corre adentro de la página. El de BlackCode usa un
proveedor simulado (`DAIMON_PROVEEDOR=simulado`): contesta en streaming sin
tocar la red. Y `test-blackcode-provider` prueba los proveedores de verdad
(Anthropic y Venice) contra un servidor local que habla el protocolo de cada
API. Ninguno gasta un token.

El humo no puede ver el flash del compositor al arrancar: no sale en ninguna
captura. Ese se juzga a ojo, en vivo y en frío.

## Empaquetar una app

Las apps hechas con Rad viven en `apps/<Nombre>`, cada una con su
`package.json`, su versión y su bloque `build` de electron-builder. El
empaquetado se lleva bien con el monorepo: los paquetes `@rad/*` entran al
asar como dependencias normales.

```
npm run pack         la vitrina sin instalador (dist/win-unpacked), para probar
npm run smoke:pack   el humo entero contra la vitrina empaquetada
npm run build        el instalador (dist/Rad-Setup-<versión>.exe)
npm run pack:blackcode         lo mismo para BlackCode
npm run smoke:pack:blackcode   su humo contra la empaquetada
```

## BlackCode

(Hasta la 0.4.0 se llamó Daimon. El paquete se sigue llamando `daimon`, su
`appId` es `com.umbrovex.daimon` y publica en `kiddshady/daimon-releases`:
es por donde la instalada encuentra su actualización, y no se tocan.)

La primera app hecha con Rad: un chat con IA donde se arman varios agentes,
cada uno con su nombre, su proveedor y su modelo, sus instrucciones y sus
propios chats, con los modelos de Anthropic y los de Venice. Un agente puede
tener tools prendidas (archivos, comandos y jobs, código, SQLite, web, abrir cosas, mirar la pantalla, un canvas y un navegador al lado del chat, una libreta de notas y subagentes) y entonces actúa en la PC;
cómo están armadas, en `apps/BlackCode/docs/tools.md`. Las respuestas dibujan las
fórmulas en LaTeX (KaTeX, con mhchem). A un mensaje se le adjuntan imágenes y
archivos de texto con el botón +, pegando o soltándolos sobre la conversación
(`renderer/adjuntos.js`). Al lado de la conversación hay además una terminal
(Ctrl+T): una shell de verdad, PowerShell 7 con el profile del usuario, que es
solo suya (ninguna tool del agente llega a ella: `main/terminal.cjs`). Viaja
con xterm adaptado a la CSP de la app (`scripts/vendor-xterm.mjs`) y con
`@lydell/node-pty`. Las vistas van como pestañas en la
titlebar, sin rail ni nombre de la app. La interfaz está en inglés (el código
y los comentarios siguen en castellano) y la fuente de código es Roboto Mono.

- Las llaves de las APIs (una por proveedor) se pegan en Ajustes y se guardan
  cifradas con `safeStorage`, en documentos que el renderer no puede leer.
  Nunca quedan en claro.
- La llamada al modelo va en el proceso principal (`apps/BlackCode/main/`) y el
  texto llega al renderer de a poco por el puente. Anthropic va con su SDK;
  Venice, con `fetch` (su API es compatible con la de OpenAI) y con la lista
  de modelos pedida a Venice, no escrita a mano.
- Los datos son del store del núcleo: un documento con los agentes, otro con
  el índice de chats y uno por chat.
- Se instala y se actualiza desde `kiddshady/daimon-releases`. En Settings,
  About tiene un botón para buscar una versión nueva sin esperar al núcleo.
- El ícono es la «Red hexagonal»: seis agentes en los vértices de un
  hexágono, todos conectados al núcleo, sobre baldosa negra, en el degradé
  metálico del hexágono de UmbroSys, con el núcleo blanco y un resplandor
  suave. Fran la eligió entre las variantes de
  `S:\mockups\daimon\variantes-hex-red.html`. Lo hornea
  `apps/BlackCode/scripts/icon.mjs` (con `--hoja <dir>` deja las variantes de
  color para compararlas en chico). Hasta la 0.14.1 fue el «Cubo» y hasta la
  0.12.0, el «Radar».

### Publicar y actualizar

Cada app publica en su propio repo de releases (la vitrina, en
`kiddshady/rad-releases`): electron-updater toma la versión del tag, así que dos
apps no pueden compartir uno. El repo va en `build.publish` del `package.json`
de la app, y el instalador se llama sin espacios.

```
# subir la versión en apps/<app>/package.json, commitear y pushear, y después:
GH_TOKEN=$(gh auth token) node tools/release.mjs apps/showcase --title "lo nuevo" --notes notas.md
GH_TOKEN=$(gh auth token) node tools/release.mjs apps/BlackCode --title "lo nuevo" --notes notas.md
```

`release.mjs` compila local, verifica el trío (`latest.yml`, `.exe`,
`.blockmap`), crea el release con `gh` y lo vuelve a verificar bajándolo de
GitHub. En la app, `wireUpdates()` (de `/@core/updates.js`) pone el aviso: no
baja nada solo, no dice "estás al día", e instala en silencio al tocar
Reiniciar (o sola al cerrar).

Para un botón «Buscar actualizaciones», `rad.updates.check()` devuelve qué
encontró (no hay evento de «estás al día»): `{ supported: false, reason }`
fuera de la app instalada (`'dev'`, `'portable'`, `'disabled'`, `'missing'`),
o `{ supported: true, available, version, error }`. Con eso y los eventos
(`rad.updates.on`), `download()` e `install()` se arma el resto; el de
BlackCode está en `apps/BlackCode/renderer/actualizacion.js`.

`node tools/test-update.mjs --exe "<la app instalada>" --expect <versión>`
prueba la actualización de punta a punta sobre una versión instalada vieja.

El ícono se hornea desde el código con la baldosa estándar
(`tools/icon-kit.mjs`; el de la vitrina en `apps/showcase/scripts/icon.mjs`;
`rasterizeGlow` le suma un resplandor al dibujo, como el del ícono de BlackCode), y
`tools/icon-sheet.py` arma la hoja de control contra los íconos de las otras
apps. En Windows la ventana usa el mismo `.ico` que el ejecutable.

---

Kidd Shady · Umbrovex Systems
