import fs from 'node:fs';
import { reproducir } from '../src/core/auditoria.js';

const archivo = process.argv[2];
if (!archivo) {
  console.log('uso: npm run reproducir -- auditoria-ciclo-1.json');
  process.exit(1);
}
const reg = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const t = performance.now();
const r = await reproducir(reg);
console.log(`ciclo ${reg.ciclo} · ${r.res.m} obligaciones · ${(performance.now() - t).toFixed(0)} ms`);
console.log(`huella registrada  ${r.huellaOriginal}`);
console.log(`huella reproducida ${r.huellaReproducida}`);
console.log(r.coincide ? 'Coincide: la ejecución se reproduce exactamente.' : `No coincide (${r.diferencias} diferencias)`);
process.exit(r.coincide ? 0 : 2);
