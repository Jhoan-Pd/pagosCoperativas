import { visible } from './grafo.js';

export function comparador(c) {
  const P = c.prioridad, V = c.vence, K = c.clave;
  return (a, b) => {
    const dp = P[a] - P[b];
    if (dp !== 0) return dp;
    const dv = V[a] - V[b];
    if (dv !== 0) return dv < 0 ? -1 : 1;
    const ka = K[a], kb = K[b];
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

export function ordenarTramo(g, desde, hasta, S, destino, debeParar) {
  let n = 0;
  for (let i = desde; i < hasta; i++) {
    if (visible(g, i, S)) destino[desde + n++] = i;
    if (debeParar && (i & 0x3fff) === 0) debeParar();
  }
  destino.subarray(desde, desde + n).sort(comparador(g));
  return n;
}

export function fusionar(c, fuente, corridas) {
  let total = 0;
  for (const r of corridas) total += r.n;
  const out = new Int32Array(total);
  const cmp = comparador(c);
  const pos = corridas.map((r) => r.desde), fin = corridas.map((r) => r.desde + r.n);
  const k = corridas.length;
  for (let x = 0; x < total; x++) {
    let mejor = -1;
    for (let j = 0; j < k; j++) {
      if (pos[j] >= fin[j]) continue;
      if (mejor < 0 || cmp(fuente[pos[j]], fuente[pos[mejor]]) < 0) mejor = j;
    }
    out[x] = fuente[pos[mejor]++];
  }
  return out;
}

export function tramos(alto, k) {
  const r = [];
  const t = Math.ceil(alto / k);
  for (let j = 0; j < k; j++) {
    const desde = Math.min(alto, j * t), hasta = Math.min(alto, (j + 1) * t);
    r.push({ desde, hasta });
  }
  return r;
}

export function ordenarFotografia(g, alto, S, k = 1, debeParar) {
  const corr = tramos(alto, k).map(({ desde, hasta }) => ({ desde, n: ordenarTramo(g, desde, hasta, S, g.ordenLocal ?? g.orden, debeParar) }));
  return fusionar(g, g.ordenLocal ?? g.orden, corr);
}
