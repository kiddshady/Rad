// Un ícono por tool, para las filas del chat. Es el sistema de NeonCode
// (1.11.3): los paths vienen de su renderer/js/icons.js, tal cual, y qué ícono
// lleva cada tool, de su TOOL_CHIP (renderer/js/chat/messages.js). Fran pidió
// traerlo el 24/11/2026.
//
// Trazo 2, puntas redondas, viewBox 24; se tiñen con currentColor. Los de la
// app (piezas.js) van en la grilla de 16 con trazo 1,5: a 16 px los dos trazos
// miden casi lo mismo y conviven.
//
// Origen: varios de estos paths vienen de Feather Icons (MIT, © Cole Bemis) —
// mismo trazo 2 / viewBox 24, así que encajan sin retocar. Otros son propios de
// NeonCode o modificados a partir de esos. La licencia MIT de Feather pide que
// el aviso viaje con las copias: acá está.
//
//   Feather Icons — https://github.com/feathericons/feather
//   Copyright (c) 2013-2023 Cole Bemis. MIT License.
//   Texto completo en THIRD-PARTY.md.

import { h, icono } from './piezas.js';

const PATHS = {
  // fetch: el eslabón de la cadena en diagonal (el `link` de Feather). Fran lo
  // eligió en su maqueta el 28/11/2026 (Documents\BlackCode-mockups\
  // fetch-iconos.html): la flecha contra la barra de NeonCode se leía como Tab,
  // no como «traer una URL».
  cadena: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v6l4 2",
  terminal: "M4 17l6-5-6-5M12 19h8",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  edit: "M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6",
  code: "M8 6l-6 6 6 6M16 6l6 6-6 6",
  search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16M21 21l-4.35-4.35",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
  bubble: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  library: "M4 4v16M8 8v12M12 6v14l4 0M16 6l4 14",
  notepad: "M7 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 3v18M11.5 8.5h5M11.5 12.5h5",
  db: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5",
  drive: "M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6.5 16h.01",
  exchange: "M3 8h14M14 5l3 3-3 3M21 16H7M10 13l-3 3 3 3",
  // el canvas: «Documento + sparkle», la hojita con el destello que Fran
  // diseñó con Zac (la `canvas` de piezas.js, que es de esta misma grilla de 24
  // con trazo 2). Reemplazó a los cuatro cuadrados de NeonCode (1.5.2 en el
  // resto de la app; en la fila de la tool, 1.8.1).
  documento: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 11l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z",
  sparkle: "M10 3c0 3.9 3.1 7 7 7-3.9 0-7 3.1-7 7 0-3.9-3.1-7-7-7 3.9 0 7-3.1 7-7zM17.5 14.5c0 1.7 1.3 3 3 3-1.7 0-3 1.3-3 3 0-1.7-1.3-3-3-3 1.7 0 3-1.3 3-3z",
  // la memoria: el `chip` de NeonCode, tal cual (el cuerpo, un cuadrado adentro
  // con el centro hueco, y las patas)
  memory: "M7 7h10v10H7zM10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
  // una imagen generada: la varita con sus destellos, la del grupo Images (la
  // `varita` de piezas.js, que es de esta misma grilla de 24 con trazo 2; Fran
  // la pidió acá en vez del marco con la montaña, 25/11/2026)
  varita: "M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9",
  delegate: "M12 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M12 8v3M12 11c-4 0-6 1.5-6 5M12 11c4 0 6 1.5 6 5M6 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M18 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5",
};

// El ícono AGRUPA: las tools de una misma familia comparten el suyo (los jobs
// con el shell, que son el mismo PowerShell; las del navegador entre sí) y lo
// que cuenta qué pasó es el resto de la fila. Están también las tools que BlackCode
// todavía no tiene: llegan con su ícono puesto.
const DE_TOOL = {
  fs_read: 'folder', fs_write: 'edit', fs_edit: 'edit', fs_delete: 'trash',
  code_search: 'search', web_search: 'search',
  shell_exec: 'terminal', cmd_exec: 'terminal',
  job_start: 'terminal', job_output: 'terminal', job_kill: 'terminal',
  run_code: 'code', db_query: 'db', sqlite_query: 'drive',
  fetch: 'cadena', http_request: 'exchange',
  os_open: 'external', screen_capture: 'eye',
  browser_navigate: 'globe', browser_read: 'globe', browser_click: 'globe',
  browser_type: 'globe', browser_press: 'globe', browser_upload: 'globe',
  canvas: 'documento', notepad: 'notepad', notepad_write: 'notepad',
  chat_search: 'bubble', chat_read: 'bubble', rag_search: 'library', schedule: 'clock',
  skill: 'sparkle', create_skill: 'sparkle', list_skills: 'sparkle',
  mcp: 'enchufe', delegate: 'delegate',
  remember: 'memory', recall: 'memory',
  generate_image: 'varita',
};

/** El nombre del ícono de una tool, o null si no tiene uno propio. */
// (las tools de un servidor MCP se llaman `mcp_<servidor>_<tool>`: todas llevan el enchufe)
const nombreDe = (tool) => DE_TOOL[tool] ?? (typeof tool === 'string' && tool.startsWith('mcp_') ? 'enchufe' : null);

// Los que no son de NeonCode sino de la app: van tal cual los dibuja piezas.js,
// en su grilla de 16. El enchufe es el de Integrations en Settings, en
// diagonal (Fran lo pidió en vez del vertical de NeonCode, 27/11/2026).
const DE_LA_APP = new Set(['enchufe']);
export const iconoDeTool = (tool) => nombreDe(tool);

/** El ícono de una tool en su caja, como icono() de piezas.js. Una tool sin
 *  ícono propio lleva el genérico: la llave fija. */
export function iconoTool(tool, extra = '') {
  const nombre = nombreDe(tool);
  if (!nombre) return icono('tool', extra);
  if (DE_LA_APP.has(nombre)) {
    const caja = icono(nombre, extra);
    caja.dataset.icono = nombre;
    return caja;
  }
  const caja = h('span', `rad-icon ${extra}`.trim(), { 'data-icono': nombre });
  caja.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[nombre]}"/></svg>`;
  return caja;
}
