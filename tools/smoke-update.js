// Guion del humo para la actualización: corre adentro de una vitrina
// INSTALADA y vieja. Espera que encuentre la versión nueva, la baja y pide
// instalarla (el núcleo sale por quitAndInstall cuando el informe quedó
// escrito). Lo maneja tools/test-update.mjs.

const failures = [];
const data = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    const v = await pred();
    if (v) return v;
  }
  return null;
};

const toastText = () => [...document.querySelectorAll('.rad-toast')].map((t) => t.querySelector('.rad-toast-text')?.textContent).join(' | ');

const available = await until(async () => {
  const s = await window.rad.updates.state();
  return s?.state === 'available' || s?.state === 'error' ? s : null;
}, 30000);
if (!available) failures.push('nunca avisó que había una versión nueva');
else if (available.state === 'error') failures.push(`el actualizador falló: ${available.message}`);
else {
  data.encontrada = `${available.version} (${available.releaseName}), ${Math.round((available.size || 0) / 1e6)} MB`;
  await sleep(400);
  data.aviso = toastText();
  if (!/Hay una versión nueva/.test(data.aviso)) failures.push(`no apareció el aviso de versión nueva: "${data.aviso}"`);
  // El botón del aviso, como lo tocaría Fran.
  [...document.querySelectorAll('.rad-toast-action')].find((b) => b.textContent === 'Descargar')?.click();
  const ready = await until(async () => {
    const s = await window.rad.updates.state();
    return s?.state === 'ready' || s?.state === 'error' ? s : null;
  }, 240000);
  if (!ready) failures.push('la descarga no terminó');
  else if (ready.state === 'error') failures.push(`la descarga falló: ${ready.message}`);
  else {
    await sleep(400);
    data.lista = toastText();
    if (!/está lista/.test(data.lista)) failures.push(`no apareció el aviso de "lista": "${data.lista}"`);
    data.installAfter = true;
  }
}

return { failures, data };
