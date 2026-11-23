// La vitrina: los botones de ventana provisorios y la demo de movimiento.

document.querySelectorAll('[data-win]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.win;
    if (action === 'minimize') window.rad?.window.minimize();
    else if (action === 'toggle-maximize') window.rad?.window.toggleMaximize();
    else if (action === 'close') window.rad?.window.close();
  });
});

const motion = document.querySelector('.sc-motion');
document.getElementById('motion-toggle')?.addEventListener('click', () => {
  motion.classList.toggle('is-open');
});
