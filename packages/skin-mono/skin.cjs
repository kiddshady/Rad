'use strict';

// El manifiesto de la piel (ver el de classic para cada campo).
//
// extends: mono hereda de glass. Sus archivos se sirven en /@base/ y el
// index.css de mono los importa; acá solo va lo que cambia.

module.exports = {
  id: 'mono',
  name: 'Mono',
  description: 'Glass sin color: vidrio oscuro acromático, y toda la luz es blanca.',
  base: '#0a0a0a',
  preview: ['#0a0a0a', '#1e1e1e', '#3a3a3a', '#b9b9b9', '#ffffff'],
  root: __dirname,
  extends: require('@rad/skin-glass'),
};
