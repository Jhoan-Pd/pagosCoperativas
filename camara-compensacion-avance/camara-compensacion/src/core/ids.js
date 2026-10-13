const PREFIJOS = { OB: 1, RV: 2 };
const NOMBRES = { 1: 'OB', 2: 'RV' };
const RE = /^([A-Z]{2})-(\d{4})-(\d{1,9})$/;

export function claveDeId(id) {
  const m = RE.exec(id);
  if (!m) return NaN;
  const p = PREFIJOS[m[1]];
  if (!p) return NaN;
  return p * 1e13 + Number(m[2]) * 1e9 + Number(m[3]);
}

export function idDeClave(k) {
  const p = Math.floor(k / 1e13);
  const r = k - p * 1e13;
  const y = Math.floor(r / 1e9);
  const n = r - y * 1e9;
  return `${NOMBRES[p] ?? '??'}-${y}-${String(n).padStart(7, '0')}`;
}

export function claveReverso(k) {
  const p = Math.floor(k / 1e13);
  return k - p * 1e13 + 2e13;
}
