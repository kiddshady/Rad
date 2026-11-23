'use strict';

// El esquema rad:// sirve todo el renderer desde un solo origen (rad://app):
//
//   rad://app/@core/...   los archivos del núcleo (packages/core/renderer)
//   rad://app/@skin/...   los archivos de la piel activa
//   rad://app/@base/...   los de la piel de la que hereda, si hereda de una
//   rad://app/@fonts/...  las fuentes compartidas (@rad/fonts)
//   rad://app/...         el renderer de la app
//
// Así la app nunca sabe dónde vive el núcleo en el disco (node_modules, el
// monorepo o adentro de un asar), y los tres comparten origen: los módulos ES
// se importan entre sí sin CORS.
//
// Se lee con fs y se arma la Response a mano. net.fetch(file://) anda desde la
// carpeta pero da pantalla en blanco empaquetado, porque el cargador de file://
// de Chromium no atraviesa el asar (el fs de Node sí, Electron lo parchea).

const fs = require('node:fs/promises');
const path = require('node:path');
const { protocol } = require('electron');

const SCHEME = 'rad';
const HOST = 'app';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Tiene que correr antes de app.ready. Electron toma una sola llamada a
// registerSchemesAsPrivileged: si algún día una app necesita otro esquema
// propio, tiene que ir en esta misma llamada (el parámetro extra).
function registerScheme(extra = []) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    ...extra,
  ]);
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolve(roots, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let root = roots.app;
  if (rel === '@core' || rel.startsWith('@core/')) {
    root = roots.core;
    rel = rel.slice('@core'.length);
  } else if (rel === '@skin' || rel.startsWith('@skin/')) {
    root = roots.skin;
    rel = rel.slice('@skin'.length);
  } else if (rel === '@base' || rel.startsWith('@base/')) {
    root = roots.base;
    rel = rel.slice('@base'.length);
  } else if (rel === '@fonts' || rel.startsWith('@fonts/')) {
    root = roots.fonts;
    rel = rel.slice('@fonts'.length);
  }
  if (!root) return null;
  rel = rel.replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(root, rel);
  return inside(root, target) ? target : null;
}

function handle(roots) {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('host desconocido', { status: 404 });
    const target = resolve(roots, url.pathname);
    if (!target) return new Response('fuera de la raíz', { status: 403 });
    try {
      const data = await fs.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('no existe', { status: 404 });
    }
  });
}

module.exports = { SCHEME, HOST, ORIGIN: `${SCHEME}://${HOST}`, registerScheme, handle, resolve };
