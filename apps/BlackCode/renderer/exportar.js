// Exportar un chat a Markdown (1.9.0). Fran lo pidió así: seleccionar y
// copiar en el chat se lleva TODO lo que se ve (las tools, las horas), y para
// tenerlo limpio está este botón, que arma un .md ordenado:
//
//   # Título del chat
//
//   Zac · 25/11/2026
//
//   ---
//
//   **Fran**
//
//   (lo que escribió, tal cual)
//
//   **Zac**
//
//   (lo que respondió, con su markdown original)
//
// Sin horas, sin tools, sin contadores. Un turno del agente que se partió en
// tramos (texto, tools, más texto) va junto, en un solo bloque. Una imagen
// (adjunta, una captura o una generada) va como una marca, porque el archivo
// es solo texto; un archivo adjunto, con su nombre. Una respuesta que se
// cortó o falló lleva una nota corta en cursiva, para que no parezca entera.
//
// Sin imports: se prueba con node pelado (tools/test-blackcode-exportar.mjs).

const NOTAS = {
  frenado: 'Stopped.',
  cortado: 'Left unfinished: BlackCode was closed while the answer was arriving.',
  largo: 'Cut off here: it reached the maximum length of an answer.',
  rechazo: 'The model declined to answer this.',
};

const fecha = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const marcasDe = (imagenes, archivos) => [
  ...(imagenes > 0 ? [imagenes === 1 ? '[image]' : `[${imagenes} images]`] : []),
  ...archivos.map((f) => `[file: ${f?.name ?? 'file'}]`),
];

/**
 * El chat en Markdown. `chat` es la entrada de la lista ({ titulo, creado }),
 * `agente` y `yo` los nombres que se muestran, y `mensajes` los del documento
 * del chat, tal como se guardan.
 */
export function chatAMarkdown({ chat = {}, agente = 'Agent', yo = 'You', mensajes = [] } = {}) {
  const bloques = [];
  let turno = null; // el del agente que se está juntando: { partes: [] }
  const cerrar = () => {
    if (turno && turno.partes.length) bloques.push(`**${agente}**\n\n${turno.partes.join('\n\n')}`);
    turno = null;
  };
  for (const m of mensajes) {
    if (m?.rol === 'user') {
      cerrar();
      const texto = String(m.texto ?? '').trim();
      const marcas = marcasDe(Array.isArray(m.imagenes) ? m.imagenes.length : 0, Array.isArray(m.archivos) ? m.archivos : []);
      const cuerpo = [texto, marcas.join(' ')].filter(Boolean).join('\n\n');
      bloques.push(`**${yo}**\n\n${cuerpo || '_(empty message)_'}`);
      continue;
    }
    if (m?.rol !== 'assistant' && m?.rol !== 'tool') continue;
    turno ??= { partes: [] };
    if (m.rol === 'tool') {
      // la tool no entra; lo que dejó a la vista (una captura, una imagen), sí, como marca
      const n = Array.isArray(m.imagenes) ? m.imagenes.length : 0;
      if (n) turno.partes.push(marcasDe(n, []).join(' '));
      continue;
    }
    const texto = String(m.texto ?? '').trim();
    if (texto) turno.partes.push(texto);
    const estado = m.estado ?? 'ok';
    if (estado === 'error') turno.partes.push(`_(${String(m.nota || 'Something went wrong and there was no answer.').trim()})_`);
    else if (NOTAS[estado]) turno.partes.push(`_(${NOTAS[estado]})_`);
  }
  cerrar();
  const titulo = String(chat.titulo ?? '').trim() || 'Chat';
  const cabeza = [`# ${titulo}`, [agente, fecha(chat.creado)].filter(Boolean).join(' · '), '---'];
  return `${[...cabeza, ...bloques].join('\n\n')}\n`;
}

/** Un nombre de archivo para el chat: su título, sin lo que Windows no acepta. */
export function nombreDeArchivo(titulo) {
  const limpio = String(titulo ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  return `${limpio || 'Chat'}.md`;
}
