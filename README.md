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
packages/skin-classic   @rad/skin-classic: la primera piel
apps/showcase           la vitrina: todos los tokens con la piel activa
tools/                  verificadores y humo
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
- `index.css`: la entrada, que importa sus partes en `layer(rad.skin)`.

Rad es solo oscuro: el verificador rechaza una superficie clara.

## Comandos

```
npm install
npm run showcase   abre la vitrina
npm run verify     el núcleo sin estilo y cada piel contra el contrato
npm run test       el guardado, con node pelado
npm run smoke      abre la vitrina dos veces, mide lo que se ve y lo que sobrevive
npm run check      verify + test + smoke
```

El humo no puede ver el flash del compositor al arrancar: no sale en ninguna
captura. Ese se juzga a ojo, en vivo y en frío.

---

Kidd Shady · Umbrovex Systems
