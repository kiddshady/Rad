'use strict';

// Humo: con RAD_SMOKE=<archivo.json>, la app arranca, espera a estar en su
// lugar y con el contenido ya entrado, mide lo que de verdad se ve y sale.
//
// Mide píxeles y estilos computados, no clases: una clase dice que alguien
// dijo que terminó, no que se ve. Y mide con la ventana ya en pantalla:
// capturePage de una ventana oculta o fuera de pantalla devuelve un frame viejo.
//
// Sale siempre con app.exit(código) explícito: si se deja cerrar la última
// ventana, el proceso termina con 0 aunque algo haya fallado.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const contract = require('../contract/tokens.cjs');

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function attach(win, { skin, settleMs = 900, timeoutMs = 15000 }) {
  const out = process.env.RAD_SMOKE;
  if (!out) return false;

  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => errors.push(`did-fail-load ${code} ${desc} ${url}`));

  const finish = (report) => {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : 1);
  };

  const timer = setTimeout(() => finish({ ok: false, failures: ['timeout: la ventana nunca quedó en su lugar'] }), timeoutMs);

  win.once('rad:placed', () => setTimeout(async () => {
    clearTimeout(timer);
    const failures = [];
    try {
      const probe = await win.webContents.executeJavaScript(`(() => {
        const css = getComputedStyle(document.documentElement);
        const names = ${JSON.stringify(contract.names)};
        return {
          missing: names.filter(n => css.getPropertyValue(n).trim() === ''),
          ready: document.documentElement.hasAttribute('data-rad-ready'),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          title: document.title,
        };
      })()`);

      if (probe.missing.length) failures.push(`tokens sin resolver: ${probe.missing.join(', ')}`);
      if (!probe.ready) failures.push('el contenido nunca entró (falta data-rad-ready)');

      const [r, g, b] = hexToRgb(skin.base);
      if (probe.bodyBg !== `rgb(${r}, ${g}, ${b})`) failures.push(`el fondo del body es ${probe.bodyBg}, no el base ${skin.base}`);

      // El píxel de la esquina inferior izquierda tiene que ser el base: si no
      // lo es, algo pinta encima del fondo o el fondo no llegó.
      const img = await win.webContents.capturePage();
      const size = img.getSize();
      const bmp = img.toBitmap(); // BGRA
      const px = (x, y) => {
        const i = (y * size.width + x) * 4;
        return [bmp[i + 2], bmp[i + 1], bmp[i]];
      };
      const corner = px(2, size.height - 3);
      const off = corner.map((v, i) => Math.abs(v - [r, g, b][i]));
      if (Math.max(...off) > 2) failures.push(`píxel de la esquina = rgb(${corner.join(', ')}), se esperaba el base ${skin.base}`);

      if (errors.length) failures.push(...errors.map(e => `consola: ${e}`));

      const shot = process.env.RAD_SMOKE_SHOT;
      if (shot) fs.writeFileSync(shot, img.toPNG());

      finish({ ok: failures.length === 0, failures, probe, size, bounds: win.getBounds() });
    } catch (err) {
      finish({ ok: false, failures: [`excepción: ${err && err.stack || err}`] });
    }
  }, settleMs));

  return true;
}

module.exports = { attach };
