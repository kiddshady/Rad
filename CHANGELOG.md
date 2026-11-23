# Changelog

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
