'use strict';

// El contrato entre el núcleo y las pieles.
//
// El núcleo nunca escribe un color, una sombra, un redondeo, una fuente ni una
// duración: usa solo estos tokens. Cada piel tiene que definirlos TODOS, y no
// puede inventar otros con el prefijo --rad- (lo propio de una piel va con
// --skin-). tools/verify-core.mjs y tools/verify-skins.mjs lo hacen cumplir.
//
// Agregar un token es un cambio de contrato: sube la versión menor del núcleo
// y obliga a que todas las pieles lo definan antes de pasar el verificador.
//
// type:
//   color     un color (hex, rgb(), oklch()...). Los "surface" deben ser oscuros.
//   length    una medida (px, rem...).
//   font      una lista de familias.
//   weight    un peso tipográfico numérico.
//   shadow    un box-shadow completo (o none).
//   duration  una duración (ms o s).
//   easing    una curva (cubic-bezier(), steps(), linear...).

const group = (name, role, tokens) => tokens.map(([id, type, desc, extra]) => ({
  name: `--rad-${id}`,
  group: name,
  groupRole: role,
  type,
  desc,
  ...(extra || {}),
}));

const TOKENS = [
  ...group('surface', 'Superficies, de la más baja a la más alta. La jerarquía de planos se arma con estas y con la elevación, no con bordes.', [
    ['surface-0', 'color', 'El fondo de la ventana. Tiene que ser IGUAL al "base" del manifiesto de la piel: es lo que pinta Electron antes del primer frame.', { surface: true }],
    ['surface-1', 'color', 'Paneles fijos: rail, barras laterales, titlebar.', { surface: true }],
    ['surface-2', 'color', 'Tarjetas y controles en reposo dentro de un panel.', { surface: true }],
    ['surface-3', 'color', 'Lo que flota: menús, modales, toasts, tooltips.', { surface: true }],
    ['tint-hover', 'color', 'Velo que se suma sobre cualquier superficie al pasar el mouse.'],
    ['tint-press', 'color', 'Velo que se suma sobre cualquier superficie al apretar.'],
    ['scrim', 'color', 'Lo que oscurece la app detrás de un modal.'],
  ]),
  ...group('text', 'Escalera de énfasis del texto.', [
    ['text-1', 'color', 'Texto primario.', { contrastMin: 7 }],
    ['text-2', 'color', 'Texto secundario.', { contrastMin: 4.5 }],
    ['text-3', 'color', 'Texto apagado: pistas, metadatos, deshabilitado.', { contrastMin: 3 }],
  ]),
  ...group('accent', 'El acento es un bisturí: la acción primaria, lo activo y el foco. No decora.', [
    ['accent', 'color', 'El color del acento.'],
    ['accent-strong', 'color', 'El acento en hover o apretado.'],
    ['accent-soft', 'color', 'Fondo teñido de acento: el item activo de una lista, un chip.'],
    ['on-accent', 'color', 'Texto o ícono encima de --rad-accent.'],
    ['focus', 'color', 'El anillo de foco del teclado.'],
    ['selection', 'color', 'El fondo de la selección de texto.'],
  ]),
  ...group('state', 'Colores de estado. Solo para estado, nunca para decorar.', [
    ['danger', 'color', 'Error, acción destructiva.'],
    ['success', 'color', 'Éxito, confirmado.'],
    ['warning', 'color', 'Advertencia.'],
  ]),
  ...group('line', 'Líneas puntuales: divisores finos y contornos. No separan planos.', [
    ['line', 'color', 'Hairline divisor.'],
    ['line-strong', 'color', 'Contorno de un campo o un control que lo necesita.'],
    ['line-width', 'length', 'Grosor de las líneas.'],
  ]),
  ...group('scroll', 'La scrollbar propia.', [
    ['scroll-thumb', 'color', 'El pulgar en reposo.'],
    ['scroll-thumb-hover', 'color', 'El pulgar con el mouse encima.'],
    ['scroll-size', 'length', 'El grosor de la scrollbar.'],
  ]),
  ...group('shape', 'Redondeo de las esquinas.', [
    ['radius-s', 'length', 'Controles chicos: chips, checks, campos compactos.'],
    ['radius-m', 'length', 'Botones, campos, items.'],
    ['radius-l', 'length', 'Paneles flotantes: menús, modales, toasts.'],
    ['radius-pill', 'length', 'Formas de píldora. Una piel cuadrada puede ponerlo igual que radius-m.'],
  ]),
  ...group('space', 'La escala de espaciado. Define la densidad de la piel.', [
    ['space-1', 'length', 'El paso más chico.'],
    ['space-2', 'length', ''],
    ['space-3', 'length', ''],
    ['space-4', 'length', ''],
    ['space-5', 'length', ''],
    ['space-6', 'length', 'El paso más grande.'],
  ]),
  ...group('type', 'Tipografía. Sans para la interfaz, mono solo para datos.', [
    ['font-ui', 'font', 'La familia de la interfaz.'],
    ['font-display', 'font', 'Títulos. Puede ser la misma que font-ui.'],
    ['font-mono', 'font', 'Datos exactos: código, números, rutas, IDs.'],
    ['text-xs', 'length', ''],
    ['text-s', 'length', ''],
    ['text-m', 'length', 'El tamaño base de la interfaz.'],
    ['text-l', 'length', ''],
    ['text-xl', 'length', 'Títulos de vista.'],
    ['weight-regular', 'weight', ''],
    ['weight-strong', 'weight', ''],
  ]),
  ...group('elevation', 'Profundidad. Lo que flota proyecta sombra.', [
    ['shadow-1', 'shadow', 'Apenas despegado: una tarjeta.'],
    ['shadow-2', 'shadow', 'Flotante: menú, toast, tooltip.'],
    ['shadow-3', 'shadow', 'Lo más alto: un modal.'],
  ]),
  ...group('layout', 'Las medidas del shell. Junto con el espaciado, definen la densidad de la piel.', [
    ['titlebar-height', 'length', 'El alto de la titlebar. Los botones de ventana son un poco más anchos que altos.'],
    ['rail-width', 'length', 'El ancho del rail. Si alcanza, los items muestran ícono y nombre.'],
    ['statusbar-height', 'length', 'El alto de la statusbar.'],
    ['control-height', 'length', 'El alto de un control: botón, campo, item del rail.'],
    ['icon-size', 'length', 'El lado de un ícono de interfaz.'],
  ]),
  ...group('motion', 'Movimiento. Todo cambio de estado se anima con estas duraciones y curvas.', [
    ['dur-fast', 'duration', 'Hover, press, cambios chicos.'],
    ['dur-base', 'duration', 'Aparecer y desaparecer, el fundido entre vistas.'],
    ['dur-slow', 'duration', 'Entradas grandes.'],
    ['ease-out', 'easing', 'Para lo que entra.'],
    ['ease-in', 'easing', 'Para lo que sale sin que nadie lo espere.'],
    ['ease-in-out', 'easing', 'Para lo que se mueve de un lugar a otro, y para la salida que otro espera (un relevo, un fundido).'],
  ]),
];

module.exports = {
  version: 2,
  tokens: TOKENS,
  names: TOKENS.map(t => t.name),
};
