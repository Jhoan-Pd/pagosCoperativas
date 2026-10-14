const entero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const uno = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const hora = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' });

export const n = (x) => (x == null || Number.isNaN(x) ? '—' : entero.format(x));
export const ms = (x) => (x == null ? '—' : x < 10 ? uno.format(x) + ' ms' : entero.format(x) + ' ms');
export const pct = (a, b) => (b ? uno.format((100 * a) / b) + ' %' : '—');

export function pesos(x) {
  if (x == null || Number.isNaN(x)) return '—';
  const a = Math.abs(x);
  const s = x < 0 ? '-$' : '$';
  if (a >= 1e12) return s + uno.format(a / 1e12) + ' billones';
  if (a >= 1e9) return s + entero.format(a / 1e6) + ' M';
  if (a >= 1e6) return s + uno.format(a / 1e6) + ' M';
  return s + entero.format(a);
}

export const pesosExactos = (x) => '$' + entero.format(x);

export function relojSim(seg) {
  if (!seg) return '—';
  const d = new Date(seg * 1000);
  return fecha.format(d) + ' ' + hora.format(d);
}

export function horaSim(seg) {
  return seg ? hora.format(new Date(seg * 1000)) : '—';
}

export function bytes(b) {
  if (b >= 1 << 30) return uno.format(b / (1 << 30)) + ' GB';
  if (b >= 1 << 20) return uno.format(b / (1 << 20)) + ' MB';
  if (b >= 1 << 10) return uno.format(b / (1 << 10)) + ' KB';
  return b + ' B';
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
