import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearMemoria, vistas, tomarFotografia, liberarFotografia, visible, netaPar, ESTADO, H } from '../src/core/grafo.js';
import { Ingestor } from '../src/core/ingestor.js';
import { claveDeId } from '../src/core/ids.js';

const ob = (n, o, d, monto, prioridad = 2) => ({ id: `OB-2026-${String(n).padStart(7, '0')}`, origen: o, destino: d, monto, ts: 1000, prioridad, vence: 5000, concepto: 'GIRO' });

function nuevo() {
  const mem = crearMemoria(1024);
  const ing = new Ingestor(mem);
  return { mem, ing, g: vistas(mem.sab, mem.cap) };
}

test('alta, baja y posición neta por par en O(1)', () => {
  const { ing, g } = nuevo();
  ing.abrir();
  ing.procesar(ob(1, 1, 2, 100));
  ing.procesar(ob(2, 2, 1, 30));
  ing.procesar(ob(3, 1, 2, 50, 1));
  ing.cerrar();
  assert.equal(netaPar(g, 0, 1), 120);
  assert.equal(netaPar(g, 0, 1, [1]), 50);
  assert.equal(g.posNeta[0], -120);
  ing.abrir(); ing.procesar({ tipo: 'cancelacion', id: 'OB-2026-0000001' }); ing.cerrar();
  assert.equal(netaPar(g, 0, 1), 20);
  assert.equal(Atomics.load(g.cab, H.VIVAS), 2);
});

test('duplicados y cancelación anticipada', () => {
  const { ing } = nuevo();
  ing.abrir();
  ing.procesar(ob(1, 1, 2, 100));
  assert.equal(ing.procesar(ob(1, 1, 2, 100)), 'duplicado');
  assert.equal(ing.procesar({ tipo: 'cancelacion', id: 'OB-2026-0000009' }), 'cancelAnticipada');
  assert.equal(ing.procesar(ob(9, 3, 4, 10)), 'lapida');
  ing.cerrar();
  assert.equal(ing.stats.altas, 1);
});

test('la fotografía no ve lo que llega después ni pierde lo cancelado tarde', () => {
  const { ing, g } = nuevo();
  ing.abrir(); ing.procesar(ob(1, 1, 2, 100)); ing.cerrar();
  const { S } = tomarFotografia(g, 0);
  ing.abrir();
  ing.procesar(ob(2, 1, 3, 70));
  assert.equal(ing.procesar({ tipo: 'cancelacion', id: 'OB-2026-0000001' }), 'cancelTardia');
  ing.cerrar();
  const r1 = ing.pendientes.get(claveDeId('OB-2026-0000002'));
  assert.equal(visible(g, 0, S), true);
  assert.equal(visible(g, r1, S), false);
  assert.equal(netaPar(g, 0, 1), 0);
  ing.recuperar();
  assert.equal(ing.w.nLibres, 0, 'no se reutiliza una ranura que la fotografía todavía ve');
  const res = ing.aplicarResultado({ ranuras: Int32Array.of(0), claves: Float64Array.of(g.clave[0]), deltas: new Float64Array(400), ahora: 2000 });
  assert.equal(res.reversos, 1);
  liberarFotografia(g, 0);
  ing.abrir(); ing.cerrar();
  ing.recuperar();
  assert.equal(g.estado[0], ESTADO.CANCELADA);
  assert.equal(ing.w.nLibres, 1);
  assert.equal(netaPar(g, 1, 0), 100);
});
