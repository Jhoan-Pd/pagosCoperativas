export const N = 400;
export const NN = N * N;
export const CAP_DEFECTO = 1 << 19;
export const SIN = 0x7fffffff;
export const MAX_LECTORES = 8;

export const H = {
  EPOCA: 0,
  ESCRIBIENDO: 1,
  ALTO: 2,
  VIVAS: 3,
  SALDO_SEQ: 4,
  OFICIAL: 5,
  LECTOR0: 8,
  CANCELAR0: 16,
  CICLO: 24,
};
const H_LEN = 32;

export const ESTADO = { LIBRE: 0, PENDIENTE: 1, EJECUTADA: 2, CANCELADA: 3, CANCEL_TARDIA: 4 };
export const CONCEPTOS = ['OTRO', 'GIRO', 'RECAUDO', 'NOMINA', 'TRANSFERENCIA', 'JUDICIAL', 'COMPENSACION', 'REVERSO'];
export const codigoConcepto = (c) => { const i = CONCEPTOS.indexOf(c); return i < 0 ? 0 : i; };

function plan(cap) {
  return [
    ['cab', Int32Array, H_LEN],
    ['monto', Float64Array, cap],
    ['clave', Float64Array, cap],
    ['vence', Float64Array, cap],
    ['ts', Float64Array, cap],
    ['alta', Int32Array, cap],
    ['baja', Int32Array, cap],
    ['sigOut', Int32Array, cap],
    ['antOut', Int32Array, cap],
    ['sigIn', Int32Array, cap],
    ['antIn', Int32Array, cap],
    ['orden', Int32Array, cap],
    ['origen', Uint16Array, cap],
    ['destino', Uint16Array, cap],
    ['prioridad', Uint8Array, cap],
    ['estado', Uint8Array, cap],
    ['concepto', Uint8Array, cap],
    ['cabOut', Int32Array, N],
    ['cabIn', Int32Array, N],
    ['gradOut', Int32Array, N],
    ['gradIn', Int32Array, N],
    ['saldo', Float64Array, N],
    ['cupo', Float64Array, N],
    ['posNeta', Float64Array, N],
    ['parMonto', Float64Array, 3 * NN],
    ['parCuenta', Int32Array, 3 * NN],
  ];
}

export function bytesNecesarios(cap = CAP_DEFECTO) {
  let off = 0;
  for (const [, T, len] of plan(cap)) { off = (off + 7) & ~7; off += T.BYTES_PER_ELEMENT * len; }
  return (off + 7) & ~7;
}

export function vistas(sab, cap) {
  const v = { sab, cap };
  let off = 0;
  for (const [nombre, T, len] of plan(cap)) {
    off = (off + 7) & ~7;
    v[nombre] = new T(sab, off, len);
    off += T.BYTES_PER_ELEMENT * len;
  }
  return v;
}

export function crearMemoria(cap = CAP_DEFECTO) {
  const Buf = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer;
  const sab = new Buf(bytesNecesarios(cap));
  const g = vistas(sab, cap);
  inicializar(g);
  return { sab, cap };
}

function inicializar(g) {
  g.cab.fill(0);
  Atomics.store(g.cab, H.EPOCA, 1);
  for (let i = 0; i < MAX_LECTORES; i++) Atomics.store(g.cab, H.LECTOR0 + i, SIN);
  g.alta.fill(SIN); g.baja.fill(SIN);
  g.cabOut.fill(-1); g.cabIn.fill(-1);
}

export function bytesPorRanura() {
  return 8 * 4 + 4 * 7 + 2 * 2 + 3;
}

export function visible(g, i, S) {
  if (Atomics.load(g.baja, i) <= S) return false;
  return Atomics.load(g.alta, i) <= S;
}

export function tomarFotografia(g, lector) {

  Atomics.store(g.cab, H.LECTOR0 + lector, 0);

  const S = Atomics.add(g.cab, H.EPOCA, 1);
  Atomics.store(g.cab, H.LECTOR0 + lector, S);

  let esperas = 0;
  while (Atomics.load(g.cab, H.ESCRIBIENDO) === 1) {
    if (typeof Atomics.wait === 'function') {
      try { Atomics.wait(g.cab, H.ESCRIBIENDO, 1, 5); } catch {  }
    }
    if (++esperas > 100000) break;
  }
  const alto = Atomics.load(g.cab, H.ALTO);
  return { S, alto };
}

export function liberarFotografia(g, lector) {
  Atomics.store(g.cab, H.LECTOR0 + lector, SIN);
}

export function copiarSaldos(g) {
  const saldo = new Float64Array(N), cupo = new Float64Array(N);
  for (;;) {
    const s1 = Atomics.load(g.cab, H.SALDO_SEQ);
    if (s1 & 1) continue;
    saldo.set(g.saldo); cupo.set(g.cupo);
    if (Atomics.load(g.cab, H.SALDO_SEQ) === s1) return { saldo, cupo };
  }
}

export function escanear(g, desde, hasta, S) {
  const out = new Int32Array(hasta - desde);
  let n = 0;
  for (let i = desde; i < hasta; i++) if (visible(g, i, S)) out[n++] = i;
  return out.subarray(0, n);
}

export class Escritor {
  constructor(memoria) {
    this.g = vistas(memoria.sab, memoria.cap);
    this.cap = memoria.cap;
    this.libres = new Int32Array(this.cap); this.nLibres = 0;

    this.limboR = new Int32Array(this.cap); this.limboE = new Int32Array(this.cap);
    this.limboIni = 0; this.limboFin = 0; this.limboN = 0;
    this.e = Atomics.load(this.g.cab, H.EPOCA);
    this.abierto = false;
  }

  abrir() {
    Atomics.store(this.g.cab, H.ESCRIBIENDO, 1);
    this.e = Atomics.load(this.g.cab, H.EPOCA);
    this.abierto = true;
  }

  cerrar() {
    Atomics.store(this.g.cab, H.ESCRIBIENDO, 0);
    Atomics.notify(this.g.cab, H.ESCRIBIENDO);
    this.abierto = false;
  }

  maxLector() {
    let m = -1;
    for (let i = 0; i < MAX_LECTORES; i++) {
      const s = Atomics.load(this.g.cab, H.LECTOR0 + i);
      if (s !== SIN && s > m) m = s;
    }
    return m;
  }

  minLector() {
    let m = SIN;
    for (let i = 0; i < MAX_LECTORES; i++) {
      const s = Atomics.load(this.g.cab, H.LECTOR0 + i);
      if (s < m) m = s;
    }
    return m;
  }

  enFotografia(i) {
    return Atomics.load(this.g.alta, i) <= this.maxLector();
  }

  alta(ob) {
    const g = this.g;
    let i;
    if (this.nLibres > 0) i = this.libres[--this.nLibres];
    else {
      i = Atomics.load(g.cab, H.ALTO);
      if (i >= this.cap) { this.recuperar(); if (this.nLibres === 0) throw new Error('Capacidad del grafo agotada'); i = this.libres[--this.nLibres]; }
      else Atomics.store(g.cab, H.ALTO, i + 1);
    }

    Atomics.store(g.alta, i, SIN);
    Atomics.store(g.baja, i, SIN);
    const o = ob.origen, d = ob.destino, p = ob.prioridad;
    g.origen[i] = o; g.destino[i] = d; g.prioridad[i] = p;
    g.monto[i] = ob.monto; g.clave[i] = ob.clave; g.vence[i] = ob.vence; g.ts[i] = ob.ts;
    g.concepto[i] = ob.concepto | 0; g.estado[i] = ESTADO.PENDIENTE;

    g.antOut[i] = -1; g.sigOut[i] = g.cabOut[o]; if (g.cabOut[o] >= 0) g.antOut[g.cabOut[o]] = i; g.cabOut[o] = i;
    g.antIn[i] = -1; g.sigIn[i] = g.cabIn[d]; if (g.cabIn[d] >= 0) g.antIn[g.cabIn[d]] = i; g.cabIn[d] = i;
    g.gradOut[o]++; g.gradIn[d]++;
    const k = (p - 1) * NN + o * N + d;
    g.parMonto[k] += ob.monto; g.parCuenta[k]++;
    g.posNeta[o] -= ob.monto; g.posNeta[d] += ob.monto;
    Atomics.add(g.cab, H.VIVAS, 1);
    Atomics.store(g.alta, i, this.e);
    return i;
  }

  baja(i, nuevoEstado) {
    const g = this.g;
    const o = g.origen[i], d = g.destino[i], p = g.prioridad[i];
    if (g.antOut[i] >= 0) g.sigOut[g.antOut[i]] = g.sigOut[i]; else g.cabOut[o] = g.sigOut[i];
    if (g.sigOut[i] >= 0) g.antOut[g.sigOut[i]] = g.antOut[i];
    if (g.antIn[i] >= 0) g.sigIn[g.antIn[i]] = g.sigIn[i]; else g.cabIn[d] = g.sigIn[i];
    if (g.sigIn[i] >= 0) g.antIn[g.sigIn[i]] = g.antIn[i];
    g.gradOut[o]--; g.gradIn[d]--;
    const k = (p - 1) * NN + o * N + d;
    g.parMonto[k] -= g.monto[i]; g.parCuenta[k]--;
    g.posNeta[o] += g.monto[i]; g.posNeta[d] -= g.monto[i];
    Atomics.sub(g.cab, H.VIVAS, 1);
    g.estado[i] = nuevoEstado;
    Atomics.store(g.baja, i, this.e);
    this.limboR[this.limboFin] = i; this.limboE[this.limboFin] = this.e;
    this.limboFin = (this.limboFin + 1) % this.cap; this.limboN++;
  }

  recuperar() {
    const min = this.minLector();
    let n = 0, presupuesto = this.limboN;
    while (this.limboN > 0 && presupuesto-- > 0) {
      const e = this.limboE[this.limboIni];
      if (e > min) break;
      const i = this.limboR[this.limboIni];
      if (this.g.estado[i] !== ESTADO.CANCEL_TARDIA) {
        this.libres[this.nLibres++] = i;
        n++;
      } else {

        this.limboR[this.limboFin] = i; this.limboE[this.limboFin] = e;
        this.limboFin = (this.limboFin + 1) % this.cap; this.limboN++;
      }
      this.limboIni = (this.limboIni + 1) % this.cap; this.limboN--;
    }
    return n;
  }

  modificarSaldos(fn) {
    const c = this.g.cab;
    Atomics.add(c, H.SALDO_SEQ, 1);
    try { fn(this.g.saldo, this.g.cupo); } finally { Atomics.add(c, H.SALDO_SEQ, 1); }
  }
}

export function netaPar(g, i, j, prioridades = [1, 2, 3]) {
  let s = 0;
  for (const p of prioridades) s += g.parMonto[(p - 1) * NN + i * N + j] - g.parMonto[(p - 1) * NN + j * N + i];
  return s;
}
