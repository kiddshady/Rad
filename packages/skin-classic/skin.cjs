'use strict';

// El manifiesto de la piel. Lo lee el main del núcleo:
//   base   el color con que Electron pinta la ventana antes del primer frame.
//          Tiene que ser #rrggbb e igual a --rad-surface-0 (lo exige el
//          verificador): si no, al arrancar se ve un salto de color.
//   root   la carpeta que se sirve como rad://app/@skin/. La entrada es
//          siempre index.css.

module.exports = {
  id: 'classic',
  name: 'Classic',
  base: '#111215',
  root: __dirname,
};
