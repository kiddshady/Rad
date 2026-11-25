// La hora de un mensaje, como se ve en el chat. Cada mensaje guarda cuándo se
// mandó (el del usuario) o cuándo terminó (el del agente) en `t`, en
// milisegundos. Los de antes de la 1.4.0 no la tienen: no se les inventa una.

const p2 = (n) => String(n).padStart(2, '0');
const valida = (t) => typeof t === 'number' && Number.isFinite(t) && t > 0;
const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Lo que va debajo del mensaje: `10:47` si fue hoy, `24/11 23:58` si fue
 *  otro día, y con el año si fue otro año. '' si el mensaje no tiene hora. */
export function horaCorta(t, ahora = Date.now()) {
  if (!valida(t)) return '';
  const d = new Date(t);
  const h = new Date(ahora);
  const hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  if (d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate()) return hm;
  const dia = p2(d.getDate()) + '/' + p2(d.getMonth() + 1);
  return (d.getFullYear() === h.getFullYear() ? dia : dia + '/' + d.getFullYear()) + ' ' + hm;
}

/** La fecha entera, para el tooltip: `Wednesday 25 November 2026, 10:47:12`. */
export function horaLarga(t) {
  if (!valida(t)) return '';
  const d = new Date(t);
  return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

/** Pone la hora de `t` en un elemento (y su fecha entera en el tooltip).
 *  Devuelve si quedó algo que mostrar. */
export function ponerHora(el, t) {
  const corta = horaCorta(t);
  if (el.textContent !== corta) el.textContent = corta;
  if (corta) el.setAttribute('data-rad-tip', horaLarga(t));
  else el.removeAttribute('data-rad-tip');
  return Boolean(corta);
}
