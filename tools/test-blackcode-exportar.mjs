// Exportar un chat a Markdown (apps/BlackCode/renderer/exportar.js), con node
// pelado: el módulo no importa nada, así que se carga tal cual.
//
// Lo que se prueba es el formato que Fran aprobó (1.9.0): el título, el agente
// y la fecha arriba, una raya, y cada turno con su nombre en negrita y lo que
// se dijo tal cual; sin horas ni tools; un turno del agente partido en tramos,
// junto; las imágenes y los archivos como marcas; una respuesta cortada, con
// su nota; y el nombre del archivo, sin lo que Windows no acepta.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// (como texto: importado por su ruta, node avisa que el paquete no dice «type: module»)
const fuente = fs.readFileSync(path.join(ROOT, 'apps', 'BlackCode', 'renderer', 'exportar.js'), 'utf8');
const { chatAMarkdown, nombreDeArchivo } = await import(`data:text/javascript,${encodeURIComponent(fuente)}`);

const failures = [];
let hechas = 0;
const t = (name, got, want) => { hechas++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}\n      esperaba ${JSON.stringify(want)}\n      dio      ${JSON.stringify(got)}`); };
const ok = (name, cond, extra = '') => { hechas++; if (!cond) failures.push(`${name}${extra ? `  → ${String(extra).slice(0, 600)}` : ''}`); };

const chat = { titulo: 'Diseño de íconos para canvas', creado: new Date(2026, 10, 25, 9, 0).getTime() };
const md = chatAMarkdown({
  chat,
  agente: 'Zac',
  yo: 'Fran',
  mensajes: [
    { id: '1', rol: 'user', texto: 'armame una hoja de íconos', t: 1 },
    { id: '2', rol: 'assistant', texto: 'Dale, la armo.', estado: 'ok' },
    { id: '3', rol: 'tool', tool: 'fs_write', texto: 'C:\\iconos\\hoja.html', estado: 'ok', salida: 'wrote 12 KB' },
    { id: '4', rol: 'assistant', texto: '## Listo\n\n- una\n- dos', estado: 'ok', tools: [{ status: 'ok' }] },
    { id: '5', rol: 'user', texto: 'mirá esto', imagenes: ['data:image/png;base64,AA', 'data:image/png;base64,BB'], archivos: [{ name: 'notas.txt', content: 'secreto' }] },
    { id: '6', rol: 'assistant', texto: '', estado: 'ok' },
    { id: '7', rol: 'tool', tool: 'screen_capture', texto: 'screen', estado: 'ok', imagenes: [{ name: 'screen_capture.jpg', dataUrl: 'data:image/jpeg;base64,CC' }] },
    { id: '8', rol: 'assistant', texto: 'Ahí está la captura', estado: 'frenado' },
    { id: '9', rol: 'user', texto: 'y ahora?' },
    { id: '10', rol: 'assistant', texto: '', estado: 'error', nota: 'The Anthropic key was rejected.' },
  ],
});

const esperado = [
  '# Diseño de íconos para canvas',
  'Zac · 25/11/2026',
  '---',
  '**Fran**\n\narmame una hoja de íconos',
  '**Zac**\n\nDale, la armo.\n\n## Listo\n\n- una\n- dos',
  '**Fran**\n\nmirá esto\n\n[2 images] [file: notas.txt]',
  '**Zac**\n\n[image]\n\nAhí está la captura\n\n_(Stopped.)_',
  '**Fran**\n\ny ahora?',
  '**Zac**\n\n_(The Anthropic key was rejected.)_',
].join('\n\n') + '\n';
t('el chat entero, en el formato aprobado', md, esperado);
ok('sin tools ni lo que devolvieron', !md.includes('fs_write') && !md.includes('wrote 12 KB') && !md.includes('screen_capture'));
ok('sin el contenido de un archivo adjunto', !md.includes('secreto'));
ok('un turno partido en tramos va en un solo bloque', (md.match(/\*\*Zac\*\*/g) ?? []).length === 3);

t('sin nombre del usuario ni del agente: You y Agent', chatAMarkdown({ chat: { titulo: 'X' }, mensajes: [{ rol: 'user', texto: 'hola' }, { rol: 'assistant', texto: 'chau', estado: 'ok' }] }),
  '# X\n\nAgent\n\n---\n\n**You**\n\nhola\n\n**Agent**\n\nchau\n');
t('un turno del agente que solo corrió tools (sin decir nada) no deja un bloque vacío', chatAMarkdown({ chat: { titulo: 'X' }, agente: 'Zac', mensajes: [{ rol: 'user', texto: 'listá' }, { rol: 'assistant', texto: '', estado: 'ok' }, { rol: 'tool', tool: 'fs_read', texto: 'a', estado: 'ok' }] }),
  '# X\n\nZac\n\n---\n\n**You**\n\nlistá\n');
t('un mensaje del usuario solo con una imagen', chatAMarkdown({ chat: { titulo: 'X' }, mensajes: [{ rol: 'user', texto: '', imagenes: ['data:'] }] }), '# X\n\nAgent\n\n---\n\n**You**\n\n[image]\n');
t('sin título', chatAMarkdown({ chat: {}, mensajes: [] }), '# Chat\n\nAgent\n\n---\n');

t('el nombre del archivo es el título', nombreDeArchivo('Diseño de íconos para canvas'), 'Diseño de íconos para canvas.md');
t('sin lo que Windows no acepta', nombreDeArchivo('a/b: c*d?'), 'a b c d.md');
t('sin punto ni espacio al final', nombreDeArchivo('Notas. '), 'Notas.md');
t('vacío', nombreDeArchivo('  '), 'Chat.md');
ok('largo, cortado', nombreDeArchivo('x'.repeat(200)).length === 83);

if (failures.length) {
  console.log(`test-blackcode-exportar: ${failures.length} falla(s) de ${hechas}`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`test-blackcode-exportar: ok (${hechas} comprobaciones: el formato aprobado, sin tools ni horas, los tramos juntos, las marcas de imágenes y archivos, las notas de una respuesta cortada o fallida, los nombres de fábrica y el nombre del archivo)`);
