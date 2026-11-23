'use strict';

const path = require('node:path');
const rad = require('@rad/core/main');

rad.start({
  skin: require('@rad/skin-classic'),
  renderer: path.join(__dirname, 'renderer'),
  appId: 'com.umbrovex.rad.showcase',
  window: { width: 1100, height: 760, title: 'Rad · vitrina' },
});
