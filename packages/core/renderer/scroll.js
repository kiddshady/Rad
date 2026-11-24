// Rad · esfumado del scroll.
//
// Pone at-top / at-bottom en cada .rad-scroll según haya o no contenido
// recortado de ese lado. El CSS del núcleo apaga el fade del lado que tiene
// la clase. Los dos observers no son adorno: sin el ResizeObserver el fade
// miente al cambiar el tamaño de la ventana, y sin el MutationObserver cuando
// el contenido cambia de alto (una lista que se llena).
//
// Una .rad-scroll-x es lo mismo de costado: at-start / at-end.

const wired = new WeakSet();

export function wireScroll(el) {
  if (wired.has(el)) return;
  wired.add(el);
  const x = el.classList.contains('rad-scroll-x');
  const update = x ? () => {
    const slack = el.scrollWidth - el.clientWidth;
    if (slack <= 1) {
      el.classList.add('at-start', 'at-end');
      return;
    }
    el.classList.toggle('at-start', el.scrollLeft <= 1);
    el.classList.toggle('at-end', el.scrollLeft >= slack - 1);
  } : () => {
    const slack = el.scrollHeight - el.clientHeight;
    if (slack <= 1) {
      el.classList.add('at-top', 'at-bottom');
      return;
    }
    el.classList.toggle('at-top', el.scrollTop <= 1);
    el.classList.toggle('at-bottom', el.scrollTop >= slack - 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(el);
  new MutationObserver(update).observe(el, { childList: true, subtree: true, characterData: true });
  update();
}

export function wireAll(root = document) {
  root.querySelectorAll('.rad-scroll, .rad-scroll-x').forEach(wireScroll);
}
