'use strict';

// El manifiesto de la piel. Lo lee el main del núcleo:
//   base   el color con que Electron pinta la ventana antes del primer frame.
//          Tiene que ser #rrggbb e igual a --rad-surface-0 (lo exige el
//          verificador): si no, al arrancar se ve un salto de color.
//   root   la carpeta que se sirve como rad://app/@skin/. La entrada es
//          siempre index.css.
// Opcionales, para quien liste las pieles (el selector de la vitrina):
//   description   una línea que la cuenta.
//   preview       cuatro o cinco colores que la resumen, del fondo al acento.

module.exports = {
  id: 'classic',
  name: 'Classic',
  description: 'Neutral y sobria: grafito, un acento azul acero y sombras suaves.',
  base: '#111215',
  preview: ['#111215', '#16171b', '#23262c', '#a6abb6', '#7c9fe0'],
  root: __dirname,
};
