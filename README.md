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
apps/showcase           la vitrina: todos los tokens con la piel activa
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

- **Titlebar** propia con los controles de ventana. Se arrastra entera.
- **Rail** con un item por vista. El indicador viaja al activo, y las flechas
  lo recorren con el teclado. Se apaga con `rail: false`.
- **Escenario**: cada vista se monta la primera vez que se visita y queda
  viva, con su scroll y su estado. El cambio entre vistas es un fundido: la
  nueva está entera debajo y la vieja se esfuma encima.
- **Statusbar** con dos lados; cada texto cambia con un relevo. Se apaga con
  `statusbar: false`.

La anatomía (`.rad-titlebar`, `.rad-rail-item`, `.rad-stage`, `.rad-view`,
`.rad-statusbar`…) es parte de la API: la piel se engancha ahí.

## Lo que flota

```js
import { menuButton } from '/@core/menu.js';
import { openModal, confirm } from '/@core/modal.js';
import { toast } from '/@core/toast.js';

menuButton(boton, () => [
  { id: 'dup', label: 'Duplicar', shortcut: 'Ctrl+D', onSelect() { … } },
  { separator: true },
  { id: 'del', label: 'Eliminar', danger: true, onSelect() { … } },
]);

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

## Guardado y puente

```js
// renderer
import { openDoc } from '/@core/store.js';
import { hold } from '/@core/ready.js';

const release = hold();                      // el arranque espera a la interfaz
const ajustes = await openDoc('ajustes', { densidad: 'normal' });
ajustes.patch({ densidad: 'compacta' });     // se guarda solo
armarInterfaz();
release();

const info = await rad.invoke('sistema:info');
rad.on('notas:cambiaron', (datos) => { … });
```

```js
// main
rad.handle('sistema:info', () => ({ … }));
rad.send('notas:cambiaron', datos);
rad.store.read('ajustes');
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
- El renderer solo ve canales `app:*`; los documentos con `_` son del núcleo.
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

Hoy hay dos:

- **classic**: neutral y sobria. Grafito, un acento azul acero, sombras suaves.
- **glass**: vidrio ahumado sobre una luz lejana. El fondo es un telón casi
  negro con campos de color apagados, y todo lo demás son hojas que lo dejan
  pasar.

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

## Comandos

```
npm install
npm run showcase   abre la vitrina
npm run verify     el núcleo sin estilo y cada piel contra el contrato
npm run test       el guardado, con node pelado
npm run smoke      abre la vitrina dos veces por piel, mide lo que se ve y lo que sobrevive
npm run check      verify + test + smoke
npm run shots      capturas de la vitrina con una piel, para diseñarla
```

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
npm run build        el instalador (dist/Rad Vitrina-Setup-<versión>.exe)
```

### Publicar y actualizar

Cada app publica en su propio repo de releases (la vitrina, en
`kiddshady/rad-releases`): electron-updater toma la versión del tag, así que dos
apps no pueden compartir uno. El repo va en `build.publish` del `package.json`
de la app, y el instalador se llama sin espacios.

```
# subir la versión en apps/<app>/package.json, commitear y pushear, y después:
GH_TOKEN=$(gh auth token) node tools/release.mjs apps/showcase --title "lo nuevo" --notes notas.md
```

`release.mjs` compila local, verifica el trío (`latest.yml`, `.exe`,
`.blockmap`), crea el release con `gh` y lo vuelve a verificar bajándolo de
GitHub. En la app, `wireUpdates()` (de `/@core/updates.js`) pone el aviso: no
baja nada solo, no dice "estás al día", e instala en silencio al tocar
Reiniciar (o sola al cerrar).

`node tools/test-update.mjs --exe "<la app instalada>" --expect <versión>`
prueba la actualización de punta a punta sobre una versión instalada vieja.

El ícono se hornea desde el código con la baldosa estándar
(`tools/icon-kit.mjs`; el de la vitrina en `apps/showcase/scripts/icon.mjs`), y
`tools/icon-sheet.py` arma la hoja de control contra los íconos de las otras
apps. En Windows la ventana usa el mismo `.ico` que el ejecutable.

---

Kidd Shady · Umbrovex Systems
