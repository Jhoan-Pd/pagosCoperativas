import { N } from './grafo.js';
import { mulberry32, barajar } from './aleatorio.js';

export const N_HUBS = 32;

export const Q_HUB = 1 - Math.sqrt(1 - 0.61);
export const P_DUPLICADO = 0.021;
export const P_DESORDEN = 0.03;
export const P_CANCELACION = 2000 / 300000;
export const INICIO_DIA = Date.UTC(2026, 9, 13, 13, 0, 0) / 1000;

const CONCEPTO_POR_PRIORIDAD = {
  1: ['NOMINA', 'NOMINA', 'JUDICIAL'],
  2: ['GIRO', 'RECAUDO', 'TRANSFERENCIA', 'RECAUDO'],
  3: ['COMPENSACION'],
};

export function crearRed(semilla = 2026) {
  const rng = mulberry32(semilla ^ 0x5bd1e995);
  const perm = barajar(Array.from({ length: N }, (_, i) => i), rng);
  const esHub = new Uint8Array(N);
  const hubs = perm.slice(0, N_HUBS).sort((a, b) => a - b);
  for (const h of hubs) esHub[h] = 1;
  const noHubs = [];
  for (let i = 0; i < N; i++) if (!esHub[i]) noHubs.push(i);
  const saldo = new Float64Array(N), cupo = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const base = esHub[i] ? rng.uniforme(30e6, 160e6) : rng.uniforme(1e6, 9e6);
    saldo[i] = Math.round(base);
    if (rng() < (esHub[i] ? 0.7 : 0.3)) cupo[i] = Math.round(base * rng.uniforme(0.2, 0.6));
  }
  return { semilla, esHub, hubs, noHubs, saldo, cupo };
}

export class Generador {
  constructor(red, semilla = 7, inicioSeq = 1) {
    this.red = red;
    this.rng = mulberry32(semilla);
    this.seq = inicioSeq;
  }

  extremo() {
    const r = this.rng;
    return r() < Q_HUB ? r.elegir(this.red.hubs) : r.elegir(this.red.noHubs);
  }

  obligacion(ts) {
    const r = this.rng;
    const o = this.extremo();
    let d = this.extremo();
    while (d === o) d = this.extremo();
    const u = r();
    const prioridad = u < 0.15 ? 1 : u < 0.75 ? 2 : 3;
    const monto = Math.max(10000, Math.min(900e6, Math.round(Math.exp(Math.log(1.8e6) + 1.25 * r.normal()))));
    const plazo = prioridad === 1 ? r.uniforme(1800, 4 * 3600) : r.uniforme(3600, 12 * 3600);
    const id = `OB-2026-${String(this.seq++).padStart(7, '0')}`;
    return {
      id, origen: o + 1, destino: d + 1, monto, ts: Math.floor(ts), prioridad,
      vence: Math.floor(ts + plazo), concepto: r.elegir(CONCEPTO_POR_PRIORIDAD[prioridad]),
    };
  }
}

export class FuenteRed {
  constructor(red, semilla = 7, inicioSeq = 1) {
    this.gen = new Generador(red, semilla, inicioSeq);
    this.rng = mulberry32(semilla * 31 + 17);
    this.paso = 0;
    this.diferidos = new Map();
    this.emitidas = 0;
  }

  retener(msg, retraso) {
    const p = this.paso + retraso;
    let l = this.diferidos.get(p);
    if (!l) this.diferidos.set(p, (l = []));
    l.push(msg);
  }

  emitir(n, t0, t1, salida = []) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      this.paso++;
      const ts = t0 + ((t1 - t0) * k) / Math.max(1, n);
      const ob = this.gen.obligacion(ts);
      this.emitidas++;
      if (r() < P_CANCELACION) {
        const cancel = { tipo: 'cancelacion', id: ob.id, ts: ob.ts };
        if (r() < 0.1) { salida.push(cancel); this.retener(ob, r.entero(1, 50)); }
        else { this.retener(cancel, r.entero(10, 20000)); this.encolar(ob, salida); }
      } else this.encolar(ob, salida);
      if (r() < P_DUPLICADO) this.retener({ ...ob }, r.entero(0, 500));
      const l = this.diferidos.get(this.paso);
      if (l) { for (const m of l) salida.push(m); this.diferidos.delete(this.paso); }
    }
    return salida;
  }

  encolar(ob, salida) {
    if (this.rng() < P_DESORDEN) this.retener(ob, this.rng.entero(1, 200));
    else salida.push(ob);
  }

  vaciar(salida = []) {
    const pasos = [...this.diferidos.keys()].sort((a, b) => a - b);
    for (const p of pasos) for (const m of this.diferidos.get(p)) salida.push(m);
    this.diferidos.clear();
    return salida;
  }

  deposito(ts) {
    const r = this.rng;
    const red = this.gen.red;
    const v = r() < 0.4 ? r.elegir(red.hubs) : r.elegir(red.noHubs);
    const monto = Math.round((red.esHub[v] ? r.uniforme(50e6, 400e6) : r.uniforme(2e6, 30e6)));
    return { tipo: 'deposito', cooperativa: v + 1, monto, ts: Math.floor(ts) };
  }
}
