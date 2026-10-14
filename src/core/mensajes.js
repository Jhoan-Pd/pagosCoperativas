import { CONCEPTOS } from './grafo.js';
import { idDeClave } from './ids.js';

export function mensajesDesdeCaptura(cap) {
  const { m, cols: col } = cap;
  const idx = Array.from({ length: m }, (_, p) => p);
  if (col.ranura) idx.sort((a, b) => col.ranura[a] - col.ranura[b]);
  return idx.map((p) => ({
    id: idDeClave(col.clave[p]), origen: col.origen[p] + 1, destino: col.destino[p] + 1,
    monto: col.monto[p], ts: col.ts[p], prioridad: col.prioridad[p], vence: col.vence[p],
    concepto: CONCEPTOS[col.concepto[p]],
  }));
}
