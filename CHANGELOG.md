# Changelog

## @rad/fonts 0.1.0 · @rad/core 0.4.1 · @rad/skin-classic 0.4.1 (2026-11-23)

- Nuevo paquete `@rad/fonts`, con Roboto Mono variable (pesos 100 a 700,
  normal e itálica, latin y latin-ext; licencia OFL). Se sirve en
  `rad://app/@fonts/` y cualquier piel o app la carga con
  `@import url('/@fonts/roboto-mono.css')`.
- Va con `font-display: block`, y el arranque espera a `document.fonts.ready`
  antes de entrar: el texto nunca cambia de forma ya a la vista.
- Classic la carga y la vitrina muestra Cascadia Mono y Roboto Mono lado a
  lado. El mono de classic sigue siendo Cascadia hasta decidirlo.
- El verificador de pieles sigue los `@import` absolutos (`/@fonts/`, `/@core/`).

## @rad/core 0.4.0 · @rad/skin-classic 0.4.0 (2026-11-23)

La etapa 4: el guardado y el puente.

- Store de documentos JSON: temporal único, cola por documento, `.bak` del
  anterior, reintentos ante EPERM/EBUSY/EACCES, y un documento roto se
  aparta y se recupera del `.bak` en vez de pisarse. Lo pendiente baja al
  disco antes de salir.
- `openDoc()` en el renderer: `get`, `set`, `patch`, `update`, `on`, con los
  valores por defecto mezclados si el archivo es viejo.
- La ventana se acuerda de su lugar, su tamaño y si estaba maximizada, y
  vuelve al centro si su monitor ya no está.
- Instancia única.
- Puente de la app: `rad.handle` / `rad.send` en el main, `rad.invoke` /
  `rad.on` en el renderer, solo por canales `app:*`.
- Los links a la web se abren en el navegador del sistema.
- `hold()`: el arranque espera a que la app arme su interfaz, para que no
  aparezca de golpe después del fundido de entrada.
- `RAD_DATA` para correr con datos descartables.
- `npm test` prueba el store con node pelado; el humo abre la vitrina dos
  veces sobre los mismos datos y la primera sale por el cierre normal.

## @rad/core 0.3.1 (2026-11-23)

- El toast que se va ya no baja de golpe antes de deslizarse. La pila está
  anclada abajo y, al sacarlo del flujo, se achicaba y se lo llevaba (52 px
  con tres toasts); el último, que la dejaba vacía, se cortaba contra el
  borde de la ventana. Ahora sale anclado por abajo y se queda en su lugar.
- Lo que se cierra antes de pintar su primer cuadro de entrada se va directo,
  en vez de aparecer entero para desvanecerse.
- El humo ya no depende de quien esté usando la PC: su ventana no toma el
  foco, no recibe el mouse real y sigue pintando aunque esté tapada.

## @rad/core 0.3.0 · @rad/skin-classic 0.3.0 (2026-11-23)

La etapa 3: lo que flota.

- Capa de overlays hermana de la raíz, con una pila que decide quién atiende
  el Escape, y `place()` para colocar junto a un ancla dándose vuelta si no
  entra.
- `present()` / `dismiss()`: entrada, asentado y salida. Cerrar algo que
  todavía venía entrando da vuelta la entrada desde donde iba.
- `flip()`: lo que cambia de lugar viaja con transform.
- Tooltips con `data-rad-tip` (y atajo opcional), con espera la primera vez y
  enseguida las siguientes.
- Menús con teclado completo, items deshabilitados, peligrosos y separadores,
  y la trampa del ancla resuelta.
- Modales con la app inert atrás, Tab que da la vuelta y foco que vuelve; y
  `confirm()`.
- Toasts que se apilan, viajan al acomodarse, se frenan con el mouse y nunca
  pasan de cuatro.
- `.rad-button` en el núcleo, con variantes primaria, peligrosa y callada.
- Contrato v3: anchos de menú, modal, toast y tooltip. Las perillas de
  anatomía (`--rad-a-*`) no son tokens y una piel las puede pisar.
- El humo prueba todo esto desde adentro de la vitrina.

## @rad/core 0.2.0 · @rad/skin-classic 0.2.0 (2026-11-23)

La etapa 2: el shell y el router.

- `createShell()`: titlebar propia con minimizar, maximizar/restaurar (los
  íconos se relevan) y cerrar; rail con indicador que viaja y navegación con
  flechas; escenario; statusbar de dos lados.
- `createRouter()`: vistas que se montan al primer uso y quedan vivas con su
  scroll. El cambio es un fundido con la nueva quieta debajo; dos cambios
  seguidos apilan bien, y una vista que vuelve sube desde donde iba.
- `motion.js`: duraciones y curvas leídas de los tokens, plazo de red en toda
  salida y `swapText()`, el relevo chico de un texto.
- La raíz apaga su animación de entrada al terminar, para no retener opacidad
  ni transform.
- Contrato v2: cinco tokens de medidas del shell (`titlebar-height`,
  `rail-width`, `statusbar-height`, `control-height`, `icon-size`).
- El puente expone la piel y la versión del núcleo, y avisa al maximizar.
- Classic viste el shell: chrome sobre el fondo y el escenario como una hoja
  un escalón más arriba.
- El humo corre un guion adentro de la vitrina: mide el fundido cuadro por
  cuadro, la ida y vuelta, el apilado, la statusbar, el indicador y el scroll.

## @rad/core 0.1.0 · @rad/skin-classic 0.1.0 (2026-11-23)

La etapa 1: el esqueleto.

- El monorepo con workspaces de npm: el núcleo, la piel classic y la vitrina.
- El contrato de tokens v1: 54 tokens en superficies, texto, acento, estado,
  líneas, scroll, forma, espacio, tipografía, elevación y movimiento.
- La ventana sin flash: nace fuera de pantalla, se muestra ahí y a los 200 ms
  se muda a su lugar, con el fondo de la piel desde el primer frame.
- El protocolo `rad://` que sirve el núcleo, la piel y la app desde un solo
  origen, leyendo con fs para que ande también empaquetado.
- El puente `window.rad` con los controles de ventana.
- El arranque del renderer: el contenido entra recién con la ventana en su lugar.
- Lo nativo de Chromium reemplazado: foco, selección y scrollbar propios, y el
  esfumado del scroll por lado.
- La piel classic: grafito, acento azul acero, sombras suaves.
- Verificadores del núcleo y de las pieles, y el humo de la vitrina.
