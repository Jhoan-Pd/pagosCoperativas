import { crearMemoria, vistas, tomarFotografia, copiarSaldos, liberarFotografia } from '../src/core/grafo.js';
import { Ingestor } from '../src/core/ingestor.js';
import { crearRed, FuenteRed, INICIO_DIA } from '../src/core/generador.js';
import { ordenarFotografia } from '../src/core/orden.js';
import { calcularCiclo, huella } from '../src/core/ciclo.js';
import { barajar, mulberry32 } from '../src/core/aleatorio.js';

const n = +(process.argv[2] ?? 20000);
const red = crearRed(2026);
const f = new FuenteRed(red, 7);
const msgs = f.emitir(n, INICIO_DIA, INICIO_DIA + 3600 * 4);
f.vaciar(msgs);
for (let i = 0; i < 12; i++) msgs.push(f.deposito(INICIO_DIA + 100 * i));

async function correr(orden, k, est) {
  const mem = crearMemoria(1 << 19);
  const ing = new Ingestor(mem);
  ing.w.modificarSaldos((s, c) => { s.set(red.saldo); c.set(red.cupo); });
  ing.abrir(); for (const m of orden) ing.procesar(m); ing.cerrar();
  const g = vistas(mem.sab, mem.cap);
  const t0 = performance.now();
  const { S, alto } = tomarFotografia(g, 0);
  const { saldo, cupo } = copiarSaldos(g);
  const ord = ordenarFotografia(g, alto, S, k);
  const t1 = performance.now();
  const res = calcularCiclo({ orden: ord, c: g, saldo0: saldo, cupo, ahora: INICIO_DIA + 4 * 3600 }, { estrategia: est });
  const h = await huella({ orden: ord, c: g }, res);
  liberarFotografia(g, 0);
  return { h, res, tOrden: t1 - t0, stats: ing.stats };
}
const a = await correr(msgs, 1, 'B');
const b = await correr([...msgs].reverse(), 2, 'B');
const c = await correr(barajar([...msgs], mulberry32(9)), 4, 'B');
console.log('stats', a.stats);
console.log('huellas', a.h.slice(0, 16), b.h.slice(0, 16), c.h.slice(0, 16), a.h === b.h && b.h === c.h);
console.log('orden ms', a.tOrden.toFixed(1), 'tiempos', a.res.tiempos);
console.log('fase1', a.res.fase1);
console.log('comparacion', JSON.stringify(a.res.comparacion, null, 1));
console.log('inv', a.res.invariantes.map(x => x.codigo + ':' + x.ok + ' ' + x.detalle));
console.log('bloq', a.res.bloqueadores.slice(0, 3));
