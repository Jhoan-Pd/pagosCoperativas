import { N } from './grafo.js';

const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function verificarInvariantes(E, R) {
  const { orden, c, saldo0, cupo } = E;
  const m = orden.length;
  const O = c.origen, D = c.destino, M = c.monto;
  const lista = [];

  let t = ahora();
  const delta = new Float64Array(N);
  let debitos = 0, creditos = 0;
  for (let p = 0; p < m; p++) {
    if (!R.decision[p]) continue;
    const s = orden[p];
    delta[O[s]] -= M[s]; delta[D[s]] += M[s];
    debitos += M[s]; creditos += M[s];
  }
  let suma = 0, sumaAntes = 0, sumaDespues = 0;
  for (let v = 0; v < N; v++) { suma += delta[v]; sumaAntes += saldo0[v]; sumaDespues += R.saldoFinal[v]; }
  const ok1 = suma === 0 && sumaAntes === sumaDespues && debitos === creditos;
  lista.push({
    codigo: 'I1', nombre: 'La suma de todos los movimientos es cero', ok: ok1,
    detalle: ok1 ? `Σ movimientos = 0 · Σ saldos se mantiene en ${sumaAntes}` : `Σ movimientos = ${suma}, Σ saldos ${sumaAntes} → ${sumaDespues}`,
    ms: ahora() - t,
  });

  t = ahora();
  const netoAntes = new Float64Array(N), netoDespues = new Float64Array(N);
  for (let p = 0; p < m; p++) {
    const s = orden[p];
    netoAntes[O[s]] -= M[s]; netoAntes[D[s]] += M[s];
    if (!R.decision[p]) { netoDespues[O[s]] -= M[s]; netoDespues[D[s]] += M[s]; }
  }
  let malo2 = -1, motivo2 = '';
  if (!R.flujoOk) { malo2 = 0; motivo2 = 'la cancelación de circuitos alteró la posición neta de algún nodo'; }
  for (let v = 0; v < N && malo2 < 0; v++) {
    if (netoAntes[v] - netoDespues[v] !== delta[v]) { malo2 = v; motivo2 = `cooperativa ${v + 1}: posición neta no cuadra con lo liquidado`; }
    else if (R.saldoFinal[v] - saldo0[v] !== delta[v]) { malo2 = v; motivo2 = `cooperativa ${v + 1}: el saldo cambió ${R.saldoFinal[v] - saldo0[v]} pero lo liquidado neto es ${delta[v]}`; }
  }
  lista.push({
    codigo: 'I2', nombre: 'La posición neta de cada cooperativa no cambió por la compensación', ok: malo2 < 0,
    detalle: malo2 < 0 ? 'neto antes = neto liquidado + neto aplazado en las 400 cooperativas' : motivo2,
    ms: ahora() - t,
  });

  t = ahora();
  const s = new Float64Array(saldo0);
  let malo3 = '';
  for (let p = 0; p < m; p++) {
    if (R.decision[p] !== 1 && R.decision[p] !== 2) continue;
    const q = orden[p];
    s[O[q]] -= M[q]; s[D[q]] += M[q];
  }
  for (let v = 0; v < N && !malo3; v++) if (s[v] < -cupo[v]) malo3 = `cooperativa ${v + 1} queda en ${s[v]} tras el bloque de compensación (cupo ${cupo[v]})`;
  for (let x = 0; x < R.secuencia.length && !malo3; x++) {
    const q = orden[R.secuencia[x]];
    s[O[q]] -= M[q];
    if (s[O[q]] < -cupo[O[q]]) malo3 = `cooperativa ${O[q] + 1} baja a ${s[O[q]]} en el paso ${x + 1} (cupo ${cupo[O[q]]})`;
    s[D[q]] += M[q];
  }
  for (let v = 0; v < N && !malo3; v++) if (s[v] !== R.saldoFinal[v]) malo3 = `la reejecución no reproduce el saldo final de la cooperativa ${v + 1}`;
  lista.push({
    codigo: 'I3', nombre: 'Ninguna cuenta bajó de su cupo autorizado en ningún instante', ok: !malo3,
    detalle: malo3 || `reejecutados 1 bloque simultáneo + ${R.secuencia.length} pagos individuales`,
    ms: ahora() - t,
  });

  t = ahora();
  let malo4 = '';
  const visto = new Uint8Array(m);
  let enBloque = 0;
  for (let p = 0; p < m; p++) if (R.decision[p] === 1 || R.decision[p] === 2) { visto[p] = 1; enBloque++; }
  for (let x = 0; x < R.secuencia.length && !malo4; x++) {
    const p = R.secuencia[x];
    if (visto[p]) malo4 = `la obligación en la posición ${p} aparece ejecutada dos veces`;
    visto[p] = 1;
    if (R.decision[p] !== 3) malo4 = `la posición ${p} está en la secuencia pero no marcada como ejecutada`;
  }
  let marcadas = 0;
  for (let p = 0; p < m; p++) if (R.decision[p] === 3) marcadas++;
  if (!malo4 && marcadas !== R.secuencia.length) malo4 = 'hay ejecuciones marcadas que no están en la secuencia';
  if (!malo4) {
    const claves = new Float64Array(m);
    for (let p = 0; p < m; p++) claves[p] = c.clave[orden[p]];
    claves.sort();
    for (let p = 1; p < m && !malo4; p++) if (claves[p] === claves[p - 1]) malo4 = `id repetido en la entrada (clave ${claves[p]})`;
  }
  if (!malo4) {
    const rs = Int32Array.from(orden).sort();
    for (let p = 1; p < m && !malo4; p++) if (rs[p] === rs[p - 1]) malo4 = 'una ranura aparece dos veces en la fotografía';
  }
  lista.push({
    codigo: 'I4', nombre: 'Ninguna obligación aparece ejecutada dos veces', ok: !malo4,
    detalle: malo4 || `${enBloque + R.secuencia.length} ejecuciones únicas, ${m} ids únicos`,
    ms: ahora() - t,
  });
  return lista;
}
