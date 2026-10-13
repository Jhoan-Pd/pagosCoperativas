import { vistas } from '../core/grafo.js';
import { ordenarTramo } from '../core/orden.js';

const grafos = new Map();

self.onmessage = (e) => {
  const d = e.data;
  if (d.tipo === 'adjuntar') {
    grafos.set(d.id, vistas(d.memoria.sab, d.memoria.cap));
    return;
  }
  if (d.tipo === 'soltar') {
    grafos.delete(d.id);
    return;
  }
  if (d.tipo === 'tramo') {
    const g = grafos.get(d.id);
    const t = performance.now();
    const n = ordenarTramo(g, d.desde, d.hasta, d.S, g.orden);
    self.postMessage({ tarea: d.tarea, desde: d.desde, n, ms: performance.now() - t });
  }
};
