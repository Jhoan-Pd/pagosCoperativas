import { test } from 'node:test';
import assert from 'node:assert/strict';
import { N } from '../src/core/grafo.js';
import { calcularCiclo } from '../src/core/ciclo.js';
import { tarjan, cancelarCircuitos } from '../src/core/compensacion.js';
import { claveDeId } from '../src/core/ids.js';
import { comparador } from '../src/core/orden.js';

function instancia(lista, saldos = {}, cupos = {}) {
  const m = lista.length;
  const c = {
    origen: new Uint16Array(m), destino: new Uint16Array(m), monto: new Float64Array(m), prioridad: new Uint8Array(m),
    vence: new Float64Array(m), clave: new Float64Array(m), ts: new Float64Array(m), concepto: new Uint8Array(m),
  };
  lista.forEach(([o, d, monto, prioridad = 2, vence = 50000], i) => {
    c.origen[i] = o - 1; c.destino[i] = d - 1; c.monto[i] = monto; c.prioridad[i] = prioridad; c.vence[i] = vence;
    c.clave[i] = claveDeId(`OB-2026-${String(i + 1).padStart(7, '0')}`);
  });
  const orden = Int32Array.from(lista.keys()).sort(comparador(c));
  const saldo0 = new Float64Array(N), cupo = new Float64Array(N);
  for (const k in saldos) saldo0[k - 1] = saldos[k];
  for (const k in cupos) cupo[k - 1] = cupos[k];
  return { orden, c, saldo0, cupo, ahora: 10000 };
}

test('un circuito A→B→C→A se liquida sin liquidez', () => {
  const E = instancia([[1, 2, 100], [2, 3, 100], [3, 1, 100]]);
  const r = calcularCiclo(E);
  assert.equal(r.fase1.liquidadas, 3);
  assert.equal(r.fase1.liquidezUsada, 0);
  assert.equal(r.fase1.eliminadoCircuitos, 300);
  assert.ok(r.valido);
});

test('tarjan separa componentes y la cancelación deja el grafo acíclico', () => {
  const R = new Float64Array(N * N);
  const arista = (a, b, m) => { R[(a - 1) * N + (b - 1)] = m; };
  arista(1, 2, 50); arista(2, 3, 70); arista(3, 1, 20); arista(3, 4, 10);
  const { comp } = tarjan(R);
  assert.equal(comp[0], comp[1]); assert.equal(comp[1], comp[2]); assert.notEqual(comp[2], comp[3]);
  const r = cancelarCircuitos(R);
  assert.equal(r.eliminado, 60);
  assert.equal(tarjan(R).tam.every((t) => t === 1), true);
});

test('contraejemplo: el voraz simple se queda corto', () => {
  const E = instancia([[2, 3, 100, 1], [1, 2, 100, 2]], { 1: 100 });
  const r = calcularCiclo(E, { estrategia: 'A' });
  assert.equal(r.comparacion.simple.montoLiquidado, 100);
  assert.equal(r.comparacion.A.montoLiquidado, 200);
  assert.equal(r.comparacion.simple.p1.cumplidas, 0);
  assert.equal(r.comparacion.A.p1.cumplidas, 1);
});

test('cada control detecta su falla y el ciclo no se da por bueno', () => {
  const lista = [];
  for (let i = 0; i < 60; i++) { const o = 1 + (i % 7), d = 1 + ((i * 3 + 1) % 7); if (o !== d) lista.push([o, d, 1000 + i * 37, 1 + (i % 3)]); }
  for (const k of ['I1', 'I2', 'I3', 'I4']) {
    const E = instancia(lista, { 1: 5000, 2: 3000, 3: 1000, 5: 2500 }, { 4: 1000 });
    const r = calcularCiclo(E, { inyectarFalla: k });
    assert.equal(r.valido, false, k + ' ' + JSON.stringify(r.invariantes.map((x) => x.ok)) + ' aplazadas ' + r.resumen.aplazadas);
    assert.equal(r.invariantes.find((x) => x.codigo === k).ok, false, k);
  }
  const r = calcularCiclo(instancia(lista, { 1: 5000, 2: 3000, 3: 1000, 5: 2500 }, { 4: 1000 }));
  assert.ok(r.valido);
});
