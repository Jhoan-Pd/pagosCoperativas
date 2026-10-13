import { N } from './grafo.js';

export const ESTRATEGIAS = {
  simple: 'Voraz simple (una pasada)',
  A: 'A · Voraz por orden total con reciclaje',
  B: 'B · Saldo primero, cupo dirigido',
};

export const MOTIVO = { NINGUNO: 0, SIN_SALDO: 1, CUPO_RESERVADO: 2, ESCENARIO: 3 };
export const NOMBRE_MOTIVO = ['', 'SIN_SALDO', 'CUPO_RESERVADO', 'DIFERIDA_POR_ESCENARIO'];

class Corrida {
  constructor(E, saldoInicial, registrar, debeParar) {
    this.E = E;
    this.saldo = new Float64Array(saldoInicial);
    this.cupo = E.cupo;
    this.registrar = registrar;
    this.debeParar = debeParar;
    const m = E.orden.length;
    this.secuencia = new Int32Array(m);
    this.n = 0;
    this.monto = 0;
    if (registrar) {
      this.liqSaldo = new Float64Array(m);
      this.liqCupo = new Float64Array(m);
      this.antes = new Float64Array(m);
    }
    this.pasadasHechas = 0;
  }

  pagar(p) {
    const { orden, c } = this.E;
    const s = orden[p], v = c.origen[s], d = c.destino[s], mm = c.monto[s];
    const antes = this.saldo[v];
    this.saldo[v] = antes - mm;
    this.saldo[d] += mm;
    if (this.registrar) {
      const usoCupo = Math.max(0, -this.saldo[v]) - Math.max(0, -antes);
      this.liqCupo[p] = usoCupo;
      this.liqSaldo[p] = mm - usoCupo;
      this.antes[p] = antes;
    }
    this.secuencia[this.n++] = p;
    this.monto += mm;
  }

  pasadas(lista, permitir, max) {
    const { orden, c } = this.E;
    const O = c.origen, M = c.monto;
    let n = lista.length;
    const buf = lista.slice();
    for (let k = 0; k < max; k++) {
      this.pasadasHechas++;
      let w = 0, cambio = false;
      for (let r = 0; r < n; r++) {
        const p = buf[r];
        const s = orden[p], v = O[s];
        const disp = this.saldo[v] + (permitir(p) ? this.cupo[v] : 0);
        if (M[s] <= disp) { this.pagar(p); cambio = true; } else buf[w++] = p;
        if (this.debeParar && (r & 0x3fff) === 0) this.debeParar();
      }
      n = w;
      if (!cambio) break;
    }
    return buf.subarray(0, n);
  }
}

function esUrgente(E, horizonte) {
  const { orden, c, ahora } = E;
  const limite = ahora + horizonte;
  return (p) => {
    const s = orden[p];
    return c.prioridad[s] === 1 || c.vence[s] <= limite;
  };
}

export function correrEstrategia(nombre, E, pendientes, saldo1, opciones = {}) {
  const registrar = !!opciones.registrar;
  const horizonte = opciones.horizonte ?? 7200;
  const urgente = esUrgente(E, horizonte);
  const run = new Corrida(E, saldo1, registrar, opciones.debeParar);
  let resto, permitido;
  if (nombre === 'simple') {
    resto = run.pasadas(pendientes, () => true, 1);
    permitido = () => true;
  } else if (nombre === 'A') {
    resto = run.pasadas(pendientes, () => true, 64);
    permitido = () => true;
  } else {
    const { orden, c } = E;
    resto = run.pasadas(pendientes, () => false, 64);
    resto = run.pasadas(resto, urgente, 64);
    const necesidad = new Float64Array(N);
    let destrabar = () => false;
    for (let ronda = 0; ronda < 4; ronda++) {
      resto = run.pasadas(resto, () => false, 64);
      necesidad.fill(0);
      for (let r = 0; r < resto.length; r++) {
        const p = resto[r];
        if (urgente(p)) necesidad[c.origen[orden[p]]] += c.monto[orden[p]];
      }
      for (let v = 0; v < N; v++) necesidad[v] -= Math.max(0, run.saldo[v]);
      const nec = necesidad.slice();
      destrabar = (p) => urgente(p) || nec[c.destino[orden[p]]] > 0;
      const antes = resto.length;
      resto = run.pasadas(resto, destrabar, 64);
      if (resto.length === antes) break;
    }
    permitido = destrabar;
  }
  return { nombre, run, resto, permitido, urgente };
}

export function metricasEstrategia(E, fase1Via, r, saldo0) {
  const { orden, c } = E;
  const m = orden.length;
  const ejec = new Uint8Array(m);
  for (let p = 0; p < m; p++) if (fase1Via[p]) ejec[p] = 1;
  for (let x = 0; x < r.run.n; x++) ejec[r.run.secuencia[x]] = 1;
  let monto = 0, n = 0, p1 = 0, p1t = 0, urg = 0, urgt = 0;
  for (let p = 0; p < m; p++) {
    const s = orden[p];
    const u = r.urgente(p);
    if (c.prioridad[s] === 1) { p1t++; if (ejec[p]) p1++; }
    if (u) { urgt++; if (ejec[p]) urg++; }
    if (ejec[p]) { monto += c.monto[s]; n++; }
  }
  let cupoUsado = 0, cupoAntes = 0;
  for (let v = 0; v < N; v++) { cupoUsado += Math.max(0, -r.run.saldo[v]); cupoAntes += Math.max(0, -saldo0[v]); }
  return {
    estrategia: r.nombre,
    montoLiquidado: monto,
    ejecutadas: n,
    aplazadas: m - n,
    p1: { cumplidas: p1, total: p1t },
    urgentes: { cumplidas: urg, total: urgt },
    cupoUsado: Math.max(0, cupoUsado - cupoAntes),
    pasadas: r.run.pasadasHechas,
  };
}
