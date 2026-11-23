# Changelog

## @rad/core 0.7.0 · @rad/skin-glass 0.1.0 · Rad Vitrina 0.6.0 (2026-11-23)

- **Glass, la segunda piel.** Vidrio ahumado sobre una luz lejana: el fondo de
  la ventana es un telón casi negro con tres campos de color apagados, el
  chrome vive directo sobre él y el escenario es una hoja que lo deja pasar.
  Los campos son pozos tallados, el primario es el único vidrio con luz propia,
  y lo que flota (menús, toasts, tooltips, el velo del modal) esmerila de
  verdad lo que tiene atrás.
- **Contrato v4: las superficies 1 a 3 pueden ser translúcidas.** `surface-0`
  sigue opaca. El verificador mide las otras compuestas sobre ella. No hay
  tokens nuevos: classic no cambió.
- Lo que el vidrio pidió y cómo se resolvió sin tocar el núcleo: el escenario
  se pinta opaco (el velo sobre el mismo telón, alineado) para que el fundido
  entre vistas siga tapando; el canto de la hoja va en un `::after` por encima
  de las vistas; el escenario aísla su apilado para no pintarse sobre un
  modal; y lo que esmerila entra y sale solo por opacidad.
- La vitrina tiene un **selector de piel** (la vista Pieles): se cierra y
  vuelve a abrir con la elegida, y se acuerda. `RAD_SKIN=<id>` la fuerza.
- El **humo corre una vez por piel**, y la segunda pasada comprueba que la
  vitrina se acordó de la piel. Las esperas del guion salen de las duraciones
  de la piel, y se suma una comprobación: una vista tiene que tapar.
- `npm run shots -- <piel>`: capturas de la vitrina escena por escena, para
  diseñar una piel mirándola.

## @rad/core 0.6.1 · Rad Vitrina 0.5.2 (2026-11-23)

- Actualizaciones desde GitHub (`updater.cjs` + `wireUpdates()`), probadas de
  punta a punta: la 0.5.1 instalada encontró la 0.5.2, avisó, la bajó con el
  botón, se instaló en silencio y el humo pasó entero sobre la versión nueva.
- `tools/release.mjs` publica verificando contra lo que quedó en GitHub;
  `tools/test-update.mjs` prueba una actualización real.
- La vitrina publica en `kiddshady/rad-releases` (0.5.0, 0.5.1 y 0.5.2) y
  muestra su versión en Datos.

## Rad Vitrina 0.5.0, la primera empaquetada (2026-11-23)

- electron-builder 26 en el monorepo. La vitrina se empaqueta con su bloque
  `build`, y los paquetes `@rad/*` entran al asar como dependencias normales:
  el asar quedó con el núcleo, la piel, las fuentes y la app, nada más (384 KB).
- Instalador NSIS (`Rad Vitrina-Setup-0.5.0.exe`) con los campos del
  ejecutable de Kidd Shady · Umbrovex Systems.
- Ícono horneado desde el código con la baldosa estándar: un núcleo y su
  anillo, en los colores de classic. `tools/icon-kit.mjs` dibuja cada tamaño a
  su tamaño y arma el .ico (PNG de 128 para arriba, DIB abajo);
  `tools/icon-sheet.py` lo compara con los íconos de las otras apps.
- La ventana usa el `.ico` en Windows, igual que el ejecutable.
- `npm run smoke:pack` corre las dos pasadas del humo contra la app
  empaquetada: pasaron enteras, con el protocolo leyendo desde el asar.

## @rad/core 0.5.2 (2026-11-23)

- Los tooltips ya no quedan pegados al recorrer rápido con Tab. Cerrar algo
  que todavía venía entrando daba vuelta su animación de CSS; al rato el
  temporizador de la entrada lo asentaba (apagaba la animación), eso
  cancelaba la vuelta y el elemento quedaba entero, abierto y fuera de toda
  salida. Ahora la salida a mitad de la entrada es una animación propia
  encima, desde la opacidad que tiene, y sale del DOM al terminar o al
  vencer su plazo, pase lo que pase. Nada se asienta mientras se va.
- Lo que ya terminó de entrar (el modal, que nunca se asienta) sigue
  saliendo con su salida propia.
- El humo recorre los tooltips cerrándolos a mitad de la entrada con
  distintas esperas, y comprueba la salida del modal.

## @rad/core 0.5.1 (2026-11-23)

- El relevo de un texto (la statusbar, el subtítulo, el valor de un select)
  ya no encima las dos frases: lo viejo sube apenas y se va del todo, y
  recién ahí entra lo nuevo subiendo desde abajo. Antes el nuevo asomaba con
  el viejo todavía al 9 %.
- La frase nueva ya no salta de costado en el lado derecho de la
  statusbar: los ítems del relevo se alinean al lado de su celda. Antes nacía
  contra la izquierda del ancho de la vieja y saltaba 50 px al irse esta.
- El humo mide el relevo cuadro por cuadro (las dos opacidades y el borde
  del texto con un Range, no de la caja) y muestra sus datos también cuando
  falla.

## @rad/core 0.5.0 · @rad/skin-classic 0.5.0 (2026-11-23)

La etapa 5: classic completa.

- Campos (`.rad-field`, `.rad-input`, etiqueta y pista) con su propio estado
  de foco: en un campo de texto Chromium prende `:focus-visible` también con
  el mouse, así que ahí no va el anillo de teclado. Sin flechitas en los de
  número ni manija para estirar en los de texto largo.
- `setFieldError()`: el renglón del error se despliega y se pliega, y el
  mensaje se releva si cambia.
- Check, radio y switch dibujados: el input nativo queda adentro, invisible
  pero vivo (teclado, formularios, lectores de pantalla). El tilde se dibuja,
  el punto crece y el pulgar viaja.
- `createSelect()`: un select propio que despliega un menú del ancho del
  botón, abre con el elegido activo, saltea los deshabilitados y resuelve la
  trampa del ancla. El menú suma items con tilde (`checked`).
- `.rad-iconbutton`, con estado apretado (`aria-pressed`).
- Classic los viste: los campos son un pozo un escalón más abajo que la
  hoja, y el contorno pasa al acento al enfocarlos.
- La vitrina suma la vista Controles con un formulario de verdad, y lo
  provisorio (el campo de la nota, los botones de ícono) pasa a ser del núcleo.
- El humo prueba cada control: el tilde entero, el pulgar que viaja, un solo
  radio por grupo, el deshabilitado, el select con teclado y el error que se
  despliega y se pliega.

## @rad/fonts 0.2.0 · @rad/core 0.4.2 · @rad/skin-classic 0.4.2 (2026-11-23)

- Cada app elige sus fuentes al arrancar: `rad.start({ fonts: { mono:
  'roboto-mono' } })`. La elegida va adelante y la de la piel queda de
  reserva. Sin elección, manda la piel.
- `@rad/fonts/catalog.json` lista las fuentes y para qué rol sirve cada una
  (`roboto-mono`, `cascadia-mono`). Un id que no existe frena el arranque con
  la lista de los que hay.
- El núcleo carga el CSS de la fuente elegida, la pide explícitamente y
  espera a que esté antes de entrar.
- Classic ya no carga Roboto Mono: su mono sigue siendo Cascadia.
- El humo corre la segunda pasada con Roboto Mono elegida.

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
