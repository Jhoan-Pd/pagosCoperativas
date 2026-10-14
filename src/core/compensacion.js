import { N, NN } from './grafo.js';

export const VIA = { NINGUNA: 0, BILATERAL: 1, CIRCUITO: 2, SELECCION: 3 };

export function tarjan(R) {
  const indice = new Int32Array(N).fill(-1), bajo = new Int32Array(N), comp = new Int32Array(N).fill(-1);
  const enPila = new Uint8Array(N), pila = new Int32Array(N), it = new Int32Array(N);
  const llamadas = new Int32Array(N);
  let idx = 0, sp = 0, nComp = 0;
  const tam = [];
  for (let s = 0; s < N; s++) {
    if (indice[s] >= 0) continue;
    let cp = 0;
    llamadas[cp++] = s; indice[s] = bajo[s] = idx++; pila[sp++] = s; enPila[s] = 1; it[s] = 0;
    while (cp > 0) {
      const u = llamadas[cp - 1];
      let avanzo = false;
      while (it[u] < N) {
        const v = it[u]++;
        if (R[u * N + v] <= 0) continue;
        if (indice[v] < 0) {
          indice[v] = bajo[v] = idx++; pila[sp++] = v; enPila[v] = 1; it[v] = 0;
          llamadas[cp++] = v; avanzo = true; break;
        } else if (enPila[v] && indice[v] < bajo[u]) bajo[u] = indice[v];
      }
      if (avanzo) continue;
      if (bajo[u] === indice[u]) {
        let t = 0, w;
        do { w = pila[--sp]; enPila[w] = 0; comp[w] = nComp; t++; } while (w !== u);
        tam.push(t); nComp++;
      }
      cp--;
      if (cp > 0) { const p = llamadas[cp - 1]; if (bajo[u] < bajo[p]) bajo[p] = bajo[u]; }
    }
  }
  return { comp, tam, nComp };
}

export function cancelarCircuitos(R, opciones = {}) {
  const maxGuardados = opciones.maxGuardados ?? 5000;
  const debeParar = opciones.debeParar;
  let pasadas = 0, eliminado = 0, nCircuitos = 0, sccNoTriviales = 0, sccMayor = 1;
  const circuitos = [];
  const estado = new Uint8Array(N), it = new Int32Array(N), posPila = new Int32Array(N);
  const pila = new Int32Array(N + 1);
  for (;;) {
    pasadas++;
    const { comp, tam } = tarjan(R);
    let hay = 0;
    for (const t of tam) if (t > 1) { hay++; if (t > sccMayor) sccMayor = t; }
    if (pasadas === 1) sccNoTriviales = hay;
    if (hay === 0 || pasadas > 20) break;

    const ini = new Int32Array(N + 1), ady = [];
    for (let u = 0; u < N; u++) {
      ini[u] = ady.length;
      if (tam[comp[u]] < 2) continue;
      for (let v = 0; v < N; v++) if (R[u * N + v] > 0 && comp[v] === comp[u]) ady.push(v);
    }
    ini[N] = ady.length;
    estado.fill(0);
    for (let u = 0; u < N; u++) it[u] = ini[u];
    for (let s = 0; s < N; s++) {
      if (estado[s] !== 0 || ini[s] === ini[s + 1]) continue;
      let sp = 0;
      pila[sp++] = s; estado[s] = 1; posPila[s] = 0;
      while (sp > 0) {
        const u = pila[sp - 1];
        while (it[u] < ini[u + 1]) {
          const v = ady[it[u]];
          if (R[u * N + v] > 0 && estado[v] !== 2) break;
          it[u]++;
        }
        if (it[u] >= ini[u + 1]) { estado[u] = 2; sp--; continue; }
        const v = ady[it[u]];
        if (estado[v] === 0) { estado[v] = 1; posPila[v] = sp; pila[sp++] = v; continue; }

        const a = posPila[v];
        let delta = Infinity;
        for (let t = a; t < sp; t++) {
          const x = pila[t], y = t + 1 < sp ? pila[t + 1] : v;
          const r = R[x * N + y]; if (r < delta) delta = r;
        }
        let corte = -1;
        for (let t = a; t < sp; t++) {
          const x = pila[t], y = t + 1 < sp ? pila[t + 1] : v;
          R[x * N + y] -= delta;
          if (corte < 0 && R[x * N + y] === 0) corte = t;
        }
        const largo = sp - a;
        eliminado += delta * largo;
        nCircuitos++;
        if (circuitos.length < maxGuardados) {
          const nodos = new Uint16Array(largo);
          for (let t = 0; t < largo; t++) nodos[t] = pila[a + t];
          circuitos.push({ nodos, delta });
        }
        for (let t = corte + 1; t < sp; t++) estado[pila[t]] = 0;
        sp = corte + 1;
        if (debeParar && (nCircuitos & 0xff) === 0) debeParar();
      }
    }
  }
  return { pasadas, eliminado, nCircuitos, sccNoTriviales, sccMayor, circuitos };
}

export function fase1(E, excluida, debeParar) {
  const { orden, c, saldo0 } = E;
  const m = orden.length;
  const O = c.origen, D = c.destino, M = c.monto;
  const G = new Float64Array(NN);
  let flujoBruto = 0;
  for (let p = 0; p < m; p++) {
    if (excluida && excluida[p]) continue;
    const s = orden[p];
    G[O[s] * N + D[s]] += M[s];
    flujoBruto += M[s];
  }

  const R = new Float64Array(G), B = new Float64Array(NN);
  let eliminadoBilateral = 0, paresBilaterales = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const a = G[i * N + j], b = G[j * N + i];
    const mn = a < b ? a : b;
    if (mn > 0) {
      B[i * N + j] = mn; B[j * N + i] = mn;
      R[i * N + j] -= mn; R[j * N + i] -= mn;
      eliminadoBilateral += 2 * mn; paresBilaterales++;
    }
  }

  const circ = cancelarCircuitos(R, { debeParar });

  let flujoOk = true;
  for (let v = 0; v < N && flujoOk; v++) {
    let ng = 0, nr = 0;
    for (let u = 0; u < N; u++) { ng += G[u * N + v] - G[v * N + u]; nr += R[u * N + v] - R[v * N + u]; }
    if (ng !== nr) flujoOk = false;
  }

  const via = new Uint8Array(m);
  const capacidad = new Float64Array(NN), acum = new Float64Array(NN);
  for (let k = 0; k < NN; k++) capacidad[k] = G[k] - R[k];
  for (let p = 0; p < m; p++) {
    if (excluida && excluida[p]) continue;
    const s = orden[p], k = O[s] * N + D[s], mm = M[s];
    if (mm <= capacidad[k]) {
      capacidad[k] -= mm;
      via[p] = acum[k] + mm <= B[k] ? VIA.BILATERAL : VIA.CIRCUITO;
      acum[k] += mm;
    }
  }

  const s1 = new Float64Array(saldo0), piso = new Float64Array(N);
  for (let v = 0; v < N; v++) piso[v] = Math.min(0, saldo0[v]);
  const cuenta = new Int32Array(N + 1);
  for (let p = 0; p < m; p++) if (via[p]) {
    const s = orden[p]; s1[O[s]] -= M[s]; s1[D[s]] += M[s]; cuenta[O[s] + 1]++;
  }
  for (let v = 0; v < N; v++) cuenta[v + 1] += cuenta[v];
  const lista = new Int32Array(cuenta[N]), llenado = cuenta.slice(0, N);
  for (let p = 0; p < m; p++) if (via[p]) lista[llenado[O[orden[p]]]++] = p;
  const ptr = llenado;
  const cola = new Int32Array(N * 64), enCola = new Uint8Array(N);
  let qi = 0, qf = 0, retiradas = 0;
  for (let v = 0; v < N; v++) if (s1[v] < piso[v]) { cola[qf++ % cola.length] = v; enCola[v] = 1; }
  while (qi < qf) {
    const v = cola[qi++ % cola.length]; enCola[v] = 0;
    while (s1[v] < piso[v] && ptr[v] > cuenta[v]) {
      const p = lista[--ptr[v]];
      if (!via[p]) continue;
      const s = orden[p];
      via[p] = 0; retiradas++;
      s1[v] += M[s]; s1[D[s]] -= M[s];
      const d = D[s];
      if (s1[d] < piso[d] && !enCola[d]) { cola[qf++ % cola.length] = d; enCola[d] = 1; }
    }
  }
  let liquidado = 0, liquidadas = 0, viaBil = 0, viaCirc = 0;
  for (let p = 0; p < m; p++) if (via[p]) {
    liquidado += M[orden[p]]; liquidadas++;
    if (via[p] === VIA.BILATERAL) viaBil++; else viaCirc++;
  }
  let liquidezUsada = 0;
  for (let v = 0; v < N; v++) if (s1[v] < saldo0[v]) liquidezUsada += saldo0[v] - s1[v];
  return {
    via, saldo1: s1, flujoOk,
    metricas: {
      flujoBruto, eliminadoBilateral, paresBilaterales,
      eliminadoCircuitos: circ.eliminado, nCircuitos: circ.nCircuitos, pasadas: circ.pasadas,
      sccNoTriviales: circ.sccNoTriviales, sccMayor: circ.sccMayor,
      montoEliminado: eliminadoBilateral + circ.eliminado,
      liquidado, liquidadas, viaBilateral: viaBil, viaCircuito: viaCirc, retiradasReparacion: retiradas,
      liquidezUsada, pendientesDespues: m - liquidadas,
    },
    circuitos: circ.circuitos,
  };
}
