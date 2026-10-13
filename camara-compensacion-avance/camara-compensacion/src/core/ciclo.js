import { N } from './grafo.js';
import { fase1, VIA } from './compensacion.js';
import { correrEstrategia, metricasEstrategia, MOTIVO } from './seleccion.js';
import { verificarInvariantes } from './invariantes.js';

const reloj = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Cancelado extends Error {
  constructor() { super('cancelado'); this.cancelado = true; }
}

export function prepararEscenario(E, escenario) {
  if (!escenario || escenario.tipo === 'base') return { E, excluida: null, descripcion: 'Sin cambios' };
  const saldo0 = new Float64Array(E.saldo0), cupo = new Float64Array(E.cupo);
  let excluida = null, descripcion = '';
  if (escenario.tipo === 'deposito') {
    const v = escenario.cooperativa - 1;
    saldo0[v] += escenario.monto;
    descripcion = `Cooperativa ${escenario.cooperativa} deposita ${escenario.monto.toLocaleString('es-CO')}`;
  } else if (escenario.tipo === 'cupo') {
    const comp = comprometidas(E, escenario.cuantas ?? 5);
    for (const v of comp) cupo[v] += escenario.monto;
    descripcion = `Cupo +${escenario.monto.toLocaleString('es-CO')} a las ${comp.length} más comprometidas: ${comp.map((v) => v + 1).join(', ')}`;
  } else if (escenario.tipo === 'diferibles') {
    const { orden, c } = E;
    excluida = new Uint8Array(orden.length);
    let n = 0;
    for (let p = 0; p < orden.length; p++) if (c.prioridad[orden[p]] === 3) { excluida[p] = 1; n++; }
    descripcion = `Se aplazan las ${n} obligaciones diferibles (prioridad 3)`;
  }
  return { E: { ...E, saldo0, cupo }, excluida, descripcion };
}

export function comprometidas(E, cuantas) {
  const { orden, c, saldo0, cupo } = E;
  const neto = new Float64Array(N);
  for (let p = 0; p < orden.length; p++) {
    const s = orden[p];
    neto[c.origen[s]] -= c.monto[s];
    neto[c.destino[s]] += c.monto[s];
  }
  const idx = Array.from({ length: N }, (_, v) => v);
  const falta = (v) => -(neto[v] + saldo0[v] + cupo[v]);
  idx.sort((a, b) => falta(b) - falta(a) || a - b);
  return idx.slice(0, cuantas);
}

export function calcularCiclo(Ebase, opciones = {}) {
  const tiempos = {};
  const debeParar = opciones.debeParar;
  let t = reloj();
  const { E, excluida, descripcion } = prepararEscenario(Ebase, opciones.escenario);
  const { orden, c } = E;
  const m = orden.length;

  const f1 = fase1(E, excluida, debeParar);
  tiempos.fase1 = reloj() - t;

  t = reloj();
  const pend = [];
  for (let p = 0; p < m; p++) if (!f1.via[p] && !(excluida && excluida[p])) pend.push(p);
  const pendientes = Int32Array.from(pend);
  const elegida = opciones.estrategia ?? 'B';
  const comparar = opciones.comparar ?? ['simple', 'A', 'B'];
  const comparacion = {};
  let principal = null;
  for (const nombre of new Set([...comparar, elegida])) {
    const r = correrEstrategia(nombre, E, pendientes, f1.saldo1, { registrar: nombre === elegida, horizonte: opciones.horizonte, debeParar });
    comparacion[nombre] = metricasEstrategia(E, f1.via, r, E.saldo0);
    if (nombre === elegida) principal = r;
  }
  tiempos.fase2 = reloj() - t;

  t = reloj();
  const decision = new Uint8Array(m);
  const ordenEj = new Int32Array(m).fill(-1);
  const liqSaldo = new Float64Array(m), liqCupo = new Float64Array(m), saldoAntes = new Float64Array(m);
  const motivo = new Uint8Array(m), disponible = new Float64Array(m), faltante = new Float64Array(m);
  let k = 0;
  for (let p = 0; p < m; p++) if (f1.via[p]) {
    decision[p] = f1.via[p];
    ordenEj[p] = k++;
    saldoAntes[p] = E.saldo0[c.origen[orden[p]]];
  }
  const run = principal.run;
  for (let x = 0; x < run.n; x++) {
    const p = run.secuencia[x];
    decision[p] = VIA.SELECCION;
    ordenEj[p] = k++;
    liqSaldo[p] = run.liqSaldo[p];
    liqCupo[p] = run.liqCupo[p];
    saldoAntes[p] = run.antes[p];
  }
  const secuencia = run.secuencia.slice(0, run.n);
  const saldoFinal = run.saldo;
  const bloqueo = new Float64Array(N), cuentaBloqueo = new Int32Array(N), faltaNodo = new Float64Array(N);
  for (let p = 0; p < m; p++) {
    if (decision[p]) continue;
    const s = orden[p], v = c.origen[s];
    if (excluida && excluida[p]) {
      motivo[p] = MOTIVO.ESCENARIO;
      disponible[p] = saldoFinal[v];
      continue;
    }
    const conCupo = principal.permitido(p);
    const disp = saldoFinal[v] + (conCupo ? E.cupo[v] : 0);
    motivo[p] = conCupo ? MOTIVO.SIN_SALDO : MOTIVO.CUPO_RESERVADO;
    disponible[p] = disp;
    faltante[p] = Math.max(0, c.monto[s] - disp);
    bloqueo[v] += c.monto[s];
    cuentaBloqueo[v]++;
  }
  for (let v = 0; v < N; v++) faltaNodo[v] = Math.max(0, bloqueo[v] - Math.max(0, saldoFinal[v] + E.cupo[v]));
  const bloqueadores = [];
  for (let v = 0; v < N; v++) if (bloqueo[v] > 0) bloqueadores.push({
    cooperativa: v + 1, aplazadas: cuentaBloqueo[v], montoAplazado: bloqueo[v],
    disponible: saldoFinal[v] + E.cupo[v], faltante: faltaNodo[v],
  });
  bloqueadores.sort((a, b) => b.faltante - a.faltante || b.montoAplazado - a.montoAplazado || a.cooperativa - b.cooperativa);
  const deltas = new Float64Array(N);
  for (let v = 0; v < N; v++) deltas[v] = saldoFinal[v] - E.saldo0[v];
  tiempos.registro = reloj() - t;

  const R = { decision, secuencia, saldoFinal, flujoOk: f1.flujoOk };
  if (opciones.inyectarFalla) inyectar(opciones.inyectarFalla, E, R, faltante);
  t = reloj();
  const invariantes = verificarInvariantes(E, R);
  tiempos.invariantes = reloj() - t;

  const circuitosTop = f1.circuitos
    .map((x, i) => ({ nodos: Array.from(x.nodos, (v) => v + 1), monto: x.delta, total: x.delta * x.nodos.length, i }))
    .sort((a, b) => b.total - a.total || a.i - b.i)
    .slice(0, 200);

  return {
    m, ahora: E.ahora, estrategia: elegida, escenario: opciones.escenario ?? { tipo: 'base' }, descripcion,
    decision, ordenEj, liqSaldo, liqCupo, saldoAntes, motivo, disponible, faltante,
    secuencia, nFase1: f1.metricas.liquidadas,
    saldo0: E.saldo0, cupo: E.cupo, saldoFinal, deltas,
    fase1: f1.metricas, circuitosTop,
    comparacion, resumen: comparacion[elegida],
    bloqueadores: bloqueadores.slice(0, 40), bloqueoPorNodo: faltaNodo,
    invariantes, valido: invariantes.every((x) => x.ok),
    tiempos,
  };
}

function inyectar(tipo, E, R, faltante) {
  const { orden, c } = E;
  if (tipo === 'I1') {
    R.saldoFinal[0] += 1;
  } else if (tipo === 'I2') {
    R.saldoFinal[0] += 1;
    R.saldoFinal[1] -= 1;
  } else if (tipo === 'I3') {
    for (let p = 0; p < orden.length; p++) if (!R.decision[p] && faltante[p] > 0) {
      const s = orden[p];
      R.decision[p] = 3;
      R.secuencia = Int32Array.from([...R.secuencia, p]);
      R.saldoFinal[c.origen[s]] -= c.monto[s];
      R.saldoFinal[c.destino[s]] += c.monto[s];
      break;
    }
  } else if (tipo === 'I4' && R.secuencia.length) {
    R.secuencia = Int32Array.from([...R.secuencia, R.secuencia[0]]);
  }
}

export async function huella(E, res) {
  const { orden, c } = E;
  const m = orden.length;
  const buf = new Float64Array(m * 5 + N * 2 + 2);
  let x = 0;
  for (let p = 0; p < m; p++) {
    buf[x++] = c.clave[orden[p]];
    buf[x++] = res.decision[p];
    buf[x++] = res.ordenEj[p];
    buf[x++] = res.liqCupo[p];
    buf[x++] = res.motivo[p];
  }
  for (let v = 0; v < N; v++) { buf[x++] = res.saldoFinal[v]; buf[x++] = res.cupo[v]; }
  buf[x++] = m; buf[x++] = res.fase1.montoEliminado;
  const h = await crypto.subtle.digest('SHA-256', buf.buffer);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}
