import { CONCEPTOS, N } from './grafo.js';
import { idDeClave, claveDeId } from './ids.js';
import { calcularCiclo, huella } from './ciclo.js';
import { NOMBRE_MOTIVO } from './seleccion.js';

const FASES = ['APLAZADA', 'COMPENSACION_BILATERAL', 'COMPENSACION_CIRCUITO', 'SELECCION_DIRECTA'];
export const FORMATO = 'camara-compensacion/auditoria@1';

export function capturarEntrada(E) {
  const { orden, c } = E;
  const m = orden.length;
  const cols = {
    clave: new Float64Array(m), origen: new Uint16Array(m), destino: new Uint16Array(m),
    monto: new Float64Array(m), prioridad: new Uint8Array(m), vence: new Float64Array(m),
    ts: new Float64Array(m), concepto: new Uint8Array(m), ranura: new Int32Array(m),
  };
  for (let p = 0; p < m; p++) {
    const s = orden[p];
    cols.clave[p] = c.clave[s]; cols.origen[p] = c.origen[s]; cols.destino[p] = c.destino[s];
    cols.monto[p] = c.monto[s]; cols.prioridad[p] = c.prioridad[s]; cols.vence[p] = c.vence[s];
    cols.ts[p] = c.ts[s]; cols.concepto[p] = c.concepto[s]; cols.ranura[p] = s;
  }
  return { cols, saldo0: new Float64Array(E.saldo0), cupo: new Float64Array(E.cupo), ahora: E.ahora, m };
}

export function entradaDesdeCaptura(cap) {
  const orden = new Int32Array(cap.m);
  for (let p = 0; p < cap.m; p++) orden[p] = p;
  return { orden, c: cap.cols, saldo0: cap.saldo0, cupo: cap.cupo, ahora: cap.ahora };
}

export function construirRegistro(cap, res, meta) {
  const { cols, m } = cap;
  const ids = new Array(m);
  for (let p = 0; p < m; p++) ids[p] = idDeClave(cols.clave[p]);
  const ejecutadas = { id: [], fase: [], orden: [], liquidezSaldo: [], liquidezCupo: [], saldoOrigenAntes: [] };
  const aplazadas = { id: [], motivo: [], cooperativa: [], disponible: [], faltante: [] };
  const porOrden = [];
  for (let p = 0; p < m; p++) if (res.decision[p]) porOrden.push(p);
  porOrden.sort((a, b) => res.ordenEj[a] - res.ordenEj[b]);
  for (const p of porOrden) {
    ejecutadas.id.push(ids[p]);
    ejecutadas.fase.push(FASES[res.decision[p]]);
    ejecutadas.orden.push(res.ordenEj[p] + 1);
    ejecutadas.liquidezSaldo.push(res.liqSaldo[p]);
    ejecutadas.liquidezCupo.push(res.liqCupo[p]);
    ejecutadas.saldoOrigenAntes.push(res.saldoAntes[p]);
  }
  for (let p = 0; p < m; p++) if (!res.decision[p]) {
    aplazadas.id.push(ids[p]);
    aplazadas.motivo.push(NOMBRE_MOTIVO[res.motivo[p]]);
    aplazadas.cooperativa.push(cols.origen[p] + 1);
    aplazadas.disponible.push(res.disponible[p]);
    aplazadas.faltante.push(res.faltante[p]);
  }
  return {
    formato: FORMATO,
    ...meta,
    parametros: { estrategia: res.estrategia, horizonte: meta.horizonte, escenario: res.escenario },
    entrada: {
      ahora: cap.ahora,
      saldos: Array.from(cap.saldo0), cupos: Array.from(cap.cupo),
      obligaciones: {
        id: ids,
        origen: Array.from(cols.origen, (v) => v + 1), destino: Array.from(cols.destino, (v) => v + 1),
        monto: Array.from(cols.monto), ts: Array.from(cols.ts), prioridad: Array.from(cols.prioridad),
        vence: Array.from(cols.vence), concepto: Array.from(cols.concepto, (x) => CONCEPTOS[x]),
      },
    },
    resultado: {
      huella: meta.huella,
      fase1: res.fase1,
      resumen: res.resumen,
      comparacion: res.comparacion,
      invariantes: res.invariantes,
      saldosFinales: Array.from(res.saldoFinal),
      ejecutadas, aplazadas,
      circuitos: res.circuitosTop.slice(0, 50),
    },
  };
}

export function capturaDesdeRegistro(reg) {
  if (reg.formato !== FORMATO) throw new Error('Formato de auditoría no reconocido');
  const ob = reg.entrada.obligaciones;
  const m = ob.id.length;
  const cols = {
    clave: new Float64Array(m), origen: new Uint16Array(m), destino: new Uint16Array(m),
    monto: new Float64Array(m), prioridad: new Uint8Array(m), vence: new Float64Array(m),
    ts: new Float64Array(m), concepto: new Uint8Array(m),
  };
  for (let p = 0; p < m; p++) {
    cols.clave[p] = claveDeId(ob.id[p]);
    cols.origen[p] = ob.origen[p] - 1; cols.destino[p] = ob.destino[p] - 1;
    cols.monto[p] = ob.monto[p]; cols.prioridad[p] = ob.prioridad[p]; cols.vence[p] = ob.vence[p];
    cols.ts[p] = ob.ts[p]; cols.concepto[p] = Math.max(0, CONCEPTOS.indexOf(ob.concepto[p]));
  }
  return {
    cols, m, ahora: reg.entrada.ahora,
    saldo0: Float64Array.from(reg.entrada.saldos), cupo: Float64Array.from(reg.entrada.cupos),
  };
}

export async function reproducir(reg) {
  const cap = capturaDesdeRegistro(reg);
  const E = entradaDesdeCaptura(cap);
  const { comparador } = await import('./orden.js');
  const idx = Array.from(E.orden);
  idx.sort(comparador(cap.cols));
  for (let p = 1; p < idx.length; p++) if (idx[p] < idx[p - 1]) throw new Error('La entrada del registro no está en el orden total');
  const res = calcularCiclo(E, { estrategia: reg.parametros.estrategia, horizonte: reg.parametros.horizonte, escenario: reg.parametros.escenario });
  const h = await huella(E, res);
  let diferencias = 0;
  const ej = reg.resultado.ejecutadas;
  const mapa = new Map();
  for (let x = 0; x < ej.id.length; x++) mapa.set(ej.id[x], ej.orden[x]);
  for (let p = 0; p < cap.m; p++) {
    const id = reg.entrada.obligaciones.id[p];
    const antes = mapa.get(id) ?? 0;
    const ahora = res.decision[p] ? res.ordenEj[p] + 1 : 0;
    if (antes !== ahora) diferencias++;
  }
  for (let v = 0; v < N; v++) if (res.saldoFinal[v] !== reg.resultado.saldosFinales[v]) diferencias++;
  return { huellaOriginal: reg.resultado.huella, huellaReproducida: h, coincide: h === reg.resultado.huella && diferencias === 0, diferencias, res };
}
