import { N, ESTADO, H, SIN, codigoConcepto, Escritor } from './grafo.js';
import { claveDeId, claveReverso, idDeClave } from './ids.js';

export const RESULTADO = {
  ALTA: 'alta', DUPLICADO: 'duplicado', RECHAZADA: 'rechazada', LAPIDA: 'lapida',
  CANCELADA: 'cancelada', CANCEL_TARDIA: 'cancelTardia', REVERSO: 'reverso',
  CANCEL_DUP: 'cancelDuplicada', CANCEL_ANTICIPADA: 'cancelAnticipada', DEPOSITO: 'deposito',
};

export class Ingestor {
  constructor(memoria) {
    this.w = new Escritor(memoria);
    this.g = this.w.g;
    this.pendientes = new Map();
    this.finalizados = new Map();
    this.lapidas = new Set();
    this.tardias = new Set();
    this.stats = {
      altas: 0, duplicados: 0, rechazadas: 0, cancelaciones: 0, cancelTardias: 0,
      reversos: 0, lapidas: 0, depositos: 0, montoDepositos: 0, mensajes: 0,
    };
  }

  abrir() { this.w.abrir(); }
  cerrar() { this.w.cerrar(); }

  procesar(msg) {
    this.stats.mensajes++;
    if (msg.ts > (this.ultimoTs ?? 0)) this.ultimoTs = msg.ts;
    if (msg.tipo === 'cancelacion') return this.cancelar(msg.id);
    if (msg.tipo === 'deposito') return this.depositar(msg.cooperativa - 1, msg.monto);
    return this.altaObligacion(msg);
  }

  altaObligacion(m) {
    const clave = claveDeId(m.id);
    const o = m.origen - 1, d = m.destino - 1;
    if (!Number.isFinite(clave) || !(o >= 0 && o < N && d >= 0 && d < N) || o === d ||
        !(Number.isInteger(m.monto) && m.monto > 0) || !(m.prioridad >= 1 && m.prioridad <= 3)) {
      this.stats.rechazadas++; return RESULTADO.RECHAZADA;
    }
    if (this.pendientes.has(clave) || this.finalizados.has(clave)) { this.stats.duplicados++; return RESULTADO.DUPLICADO; }
    if (this.lapidas.has(clave)) {
      this.lapidas.delete(clave); this.finalizados.set(clave, 2);
      this.stats.lapidas++; return RESULTADO.LAPIDA;
    }
    const ranura = this.w.alta({
      origen: o, destino: d, prioridad: m.prioridad, monto: m.monto, clave,
      vence: m.vence ?? (m.ts + 86400), ts: m.ts ?? 0, concepto: codigoConcepto(m.concepto),
    });
    this.pendientes.set(clave, ranura);
    this.stats.altas++;
    return RESULTADO.ALTA;
  }

  cancelar(id) {
    const clave = claveDeId(id);
    if (!Number.isFinite(clave)) { this.stats.rechazadas++; return RESULTADO.RECHAZADA; }
    const ranura = this.pendientes.get(clave);
    if (ranura !== undefined) {
      this.pendientes.delete(clave);
      this.finalizados.set(clave, 2);
      this.stats.cancelaciones++;
      const S0 = Atomics.load(this.g.cab, H.LECTOR0);
      if (S0 !== SIN && Atomics.load(this.g.alta, ranura) <= S0) {
        this.w.baja(ranura, ESTADO.CANCEL_TARDIA);
        this.tardias.add(ranura);
        this.stats.cancelTardias++;
        return RESULTADO.CANCEL_TARDIA;
      }
      this.w.baja(ranura, ESTADO.CANCELADA);
      return RESULTADO.CANCELADA;
    }
    const f = this.finalizados.get(clave);
    if (f === 1) {
      this.finalizados.set(clave, 3);
      return this.crearReversoDesdeRegistro(clave);
    }
    if (f !== undefined) { this.stats.duplicados++; return RESULTADO.CANCEL_DUP; }
    this.lapidas.add(clave);
    return RESULTADO.CANCEL_ANTICIPADA;
  }

  depositar(v, monto) {
    if (!(v >= 0 && v < N) || !(monto > 0)) { this.stats.rechazadas++; return RESULTADO.RECHAZADA; }
    this.w.modificarSaldos((saldo) => { saldo[v] += monto; });
    this.stats.depositos++; this.stats.montoDepositos += monto;
    return RESULTADO.DEPOSITO;
  }

  registrarEjecutada(clave, o, d, monto, prioridad) {
    if (!this.ejecutadas) this.ejecutadas = new Map();
    this.ejecutadas.set(clave, [o, d, monto, prioridad]);
  }

  crearReversoDesdeRegistro(clave) {
    const r = this.ejecutadas?.get(clave);
    if (!r) { this.stats.rechazadas++; return RESULTADO.RECHAZADA; }
    this.ejecutadas.delete(clave);
    return this.crearReverso(clave, r[0], r[1], r[2]);
  }

  crearReverso(clave, o, d, monto) {
    const k = claveReverso(clave);
    if (this.pendientes.has(k) || this.finalizados.has(k)) return RESULTADO.DUPLICADO;
    const ahora = this.ultimoTs ?? 0;
    const ranura = this.w.alta({
      origen: d, destino: o, prioridad: 2, monto, clave: k, vence: ahora + 86400, ts: ahora,
      concepto: codigoConcepto('REVERSO'),
    });
    this.pendientes.set(k, ranura);
    this.stats.reversos++;
    return RESULTADO.REVERSO;
  }

  aplicarResultado({ ranuras, claves, deltas, ahora }) {
    const g = this.g;
    this.ultimoTs = ahora;
    let aplicadas = 0, reversos = 0, conflictos = 0;
    this.abrir();
    try {
      for (let x = 0; x < ranuras.length; x++) {
        const i = ranuras[x];
        if (g.clave[i] !== claves[x]) { conflictos++; continue; }
        const est = g.estado[i];
        if (est === ESTADO.PENDIENTE) {
          this.w.baja(i, ESTADO.EJECUTADA);
          this.pendientes.delete(claves[x]);
          this.finalizados.set(claves[x], 1);
          this.registrarEjecutada(claves[x], g.origen[i], g.destino[i], g.monto[i], g.prioridad[i]);
          aplicadas++;
        } else if (est === ESTADO.CANCEL_TARDIA) {

          g.estado[i] = ESTADO.CANCELADA;
          this.tardias.delete(i);
          this.finalizados.set(claves[x], 3);
          this.crearReverso(claves[x], g.origen[i], g.destino[i], g.monto[i]);
          aplicadas++; reversos++;
        } else conflictos++;
      }
      this.w.modificarSaldos((saldo) => { for (let v = 0; v < N; v++) saldo[v] += deltas[v]; });
      this.finalizarTardias();
    } finally { this.cerrar(); }
    Atomics.add(g.cab, H.CICLO, 1);
    return { aplicadas, reversos, conflictos };
  }

  finalizarTardias() {
    for (const i of this.tardias) if (this.g.estado[i] === ESTADO.CANCEL_TARDIA) this.g.estado[i] = ESTADO.CANCELADA;
    this.tardias.clear();
  }

  recuperar() { return this.w.recuperar(); }

  resumen() {
    return {
      ...this.stats,
      vivas: Atomics.load(this.g.cab, H.VIVAS),
      alto: Atomics.load(this.g.cab, H.ALTO),
      epoca: Atomics.load(this.g.cab, H.EPOCA),
      limbo: this.w.limboN,
      libres: this.w.nLibres,
      lapidasActivas: this.lapidas.size,
    };
  }

  exportarEstado(meta = {}) {
    const g = this.g;
    const n = this.pendientes.size;
    const ranuras = new Int32Array(n);
    let x = 0;
    for (const r of this.pendientes.values()) ranuras[x++] = r;
    ranuras.sort();
    const fin = new Float64Array(this.finalizados.size * 2);
    x = 0;
    for (const [k, v] of this.finalizados) { fin[x++] = k; fin[x++] = v; }
    const ejec = new Float64Array((this.ejecutadas?.size ?? 0) * 5);
    x = 0;
    if (this.ejecutadas) for (const [k, r] of this.ejecutadas) { ejec[x++] = k; ejec[x++] = r[0]; ejec[x++] = r[1]; ejec[x++] = r[2]; ejec[x++] = r[3]; }
    const cols = {
      clave: new Float64Array(n), monto: new Float64Array(n), vence: new Float64Array(n), ts: new Float64Array(n),
      origen: new Uint16Array(n), destino: new Uint16Array(n), prioridad: new Uint8Array(n), concepto: new Uint8Array(n),
    };
    for (let k = 0; k < n; k++) {
      const i = ranuras[k];
      cols.clave[k] = g.clave[i]; cols.monto[k] = g.monto[i]; cols.vence[k] = g.vence[i]; cols.ts[k] = g.ts[i];
      cols.origen[k] = g.origen[i]; cols.destino[k] = g.destino[i]; cols.prioridad[k] = g.prioridad[i]; cols.concepto[k] = g.concepto[i];
    }
    const saldo = new Float64Array(g.saldo), cupo = new Float64Array(g.cupo);
    const lap = Float64Array.from(this.lapidas);
    return codificar({ ...meta, n, creado: Date.now() },
      { saldo, cupo, fin, ejec, lap, ...cols });
  }

  restaurarEstado(buffer) {
    const { meta, arr } = decodificar(buffer);
    this.abrir();
    try {
      this.w.modificarSaldos((saldo, cupo) => { saldo.set(arr.saldo); cupo.set(arr.cupo); });
      for (let k = 0; k < arr.fin.length; k += 2) this.finalizados.set(arr.fin[k], arr.fin[k + 1]);
      for (let k = 0; k < arr.ejec.length; k += 5) this.registrarEjecutada(arr.ejec[k], arr.ejec[k + 1], arr.ejec[k + 2], arr.ejec[k + 3], arr.ejec[k + 4]);
      for (const c of arr.lap) this.lapidas.add(c);
      for (let k = 0; k < meta.n; k++) {
        const clave = arr.clave[k];
        if (this.pendientes.has(clave)) continue;
        const r = this.w.alta({
          origen: arr.origen[k], destino: arr.destino[k], prioridad: arr.prioridad[k], monto: arr.monto[k],
          clave, vence: arr.vence[k], ts: arr.ts[k], concepto: arr.concepto[k],
        });
        this.pendientes.set(clave, r);
      }
    } finally { this.cerrar(); }
    return meta;
  }
}

const TIPOS = { Float64Array, Uint16Array, Uint8Array, Int32Array };

export function codificar(meta, arreglos) {
  const desc = Object.entries(arreglos).map(([k, a]) => [k, a.constructor.name, a.length]);
  const texto = new TextEncoder().encode(JSON.stringify({ meta, desc }));
  let off = 4 + texto.length; off = (off + 7) & ~7;
  let total = off;
  for (const [, , a] of Object.entries(arreglos).map(([k, a]) => [k, 0, a])) { total = (total + 7) & ~7; total += a.byteLength; }
  const buf = new ArrayBuffer((total + 7) & ~7);
  new DataView(buf).setUint32(0, texto.length, true);
  new Uint8Array(buf, 4, texto.length).set(texto);
  let p = off;
  for (const a of Object.values(arreglos)) {
    p = (p + 7) & ~7;
    new Uint8Array(buf, p, a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    p += a.byteLength;
  }
  return buf;
}

export function decodificar(buf) {
  const lm = new DataView(buf).getUint32(0, true);
  const { meta, desc } = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, lm)));
  let p = (4 + lm + 7) & ~7;
  const arr = {};
  for (const [k, tipo, len] of desc) {
    p = (p + 7) & ~7;
    const T = TIPOS[tipo];
    arr[k] = new T(buf.slice(p, p + len * T.BYTES_PER_ELEMENT));
    p += len * T.BYTES_PER_ELEMENT;
  }
  return { meta, arr };
}

export { idDeClave };
