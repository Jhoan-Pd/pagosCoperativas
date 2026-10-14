import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { leerArchivo, corrida, CONFIGURACIONES } from '../src/core/determinismo.js';

const archivo = process.argv[2];
if (!archivo) {
  console.log('uso: npm run determinismo -- datos/entrada.jsonl [A|B]');
  process.exit(1);
}
const estrategia = process.argv[3] || 'B';
const { red, mensajes } = leerArchivo(fs.readFileSync(archivo, 'utf8'));
if (!red) { console.error('El archivo no tiene la línea {"tipo":"red", ...}'); process.exit(1); }

const hilos = [];
const pedir = (w, msg) => new Promise((ok) => { w.once('message', ok); w.postMessage(msg); });

async function ordenarTramos(memoria, g, rangos, S) {
  while (hilos.length < rangos.length) hilos.push(new Worker(new URL('./shard-node.mjs', import.meta.url)));
  return Promise.all(rangos.map((r, j) => pedir(hilos[j], { memoria, desde: r.desde, hasta: r.hasta, S })));
}

console.log(`${archivo}: ${mensajes.length} mensajes, estrategia ${estrategia}\n`);
const res = [];
for (const cfg of CONFIGURACIONES) {
  const r = await corrida({
    mensajes, saldos: Float64Array.from(red.saldos), cupos: Float64Array.from(red.cupos), ahora: red.ahora,
    ...cfg, estrategia, ordenarTramos,
  });
  res.push(r);
  console.log(`llegada ${cfg.llegada.padEnd(9)} workers ${cfg.K}  obligaciones ${r.m}  liquidado ${r.monto}  ${r.ms.toFixed(0)} ms  ${r.huella}`);
}
for (const h of hilos) h.terminate();
const iguales = res.every((r) => r.huella === res[0].huella);
console.log(iguales ? '\nLas tres corridas dan la misma huella.' : '\nLAS HUELLAS NO COINCIDEN');
process.exit(iguales ? 0 : 2);
