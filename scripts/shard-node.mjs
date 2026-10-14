import { parentPort } from 'node:worker_threads';
import { vistas } from '../src/core/grafo.js';
import { ordenarTramo } from '../src/core/orden.js';

parentPort.on('message', (d) => {
  const g = vistas(d.memoria.sab, d.memoria.cap);
  const t = performance.now();
  const n = ordenarTramo(g, d.desde, d.hasta, d.S, g.orden);
  parentPort.postMessage({ desde: d.desde, n, ms: performance.now() - t });
});
