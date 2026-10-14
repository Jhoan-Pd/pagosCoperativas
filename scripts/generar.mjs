import fs from 'node:fs';
import path from 'node:path';
import { crearRed, FuenteRed, INICIO_DIA } from '../src/core/generador.js';

const n = Number(process.argv[2] || 200000);
const salida = process.argv[3] || 'datos/entrada.jsonl';
const semilla = Number(process.argv[4] || 2026);

const red = crearRed(semilla);
const fuente = new FuenteRed(red, semilla + 5);
const horas = 10;
const lineas = [];
const ahora = INICIO_DIA + horas * 3600;
lineas.push(JSON.stringify({ tipo: 'red', semilla, ahora, saldos: Array.from(red.saldo), cupos: Array.from(red.cupo) }));
const bloque = 5000;
for (let hecho = 0; hecho < n; hecho += bloque) {
  const k = Math.min(bloque, n - hecho);
  const t0 = INICIO_DIA + (hecho / n) * horas * 3600;
  const t1 = INICIO_DIA + ((hecho + k) / n) * horas * 3600;
  for (const m of fuente.emitir(k, t0, t1)) lineas.push(JSON.stringify(m));
  lineas.push(JSON.stringify(fuente.deposito(t1)));
}
for (const m of fuente.vaciar()) lineas.push(JSON.stringify(m));
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, lineas.join('\n') + '\n');
console.log(`${salida}: ${lineas.length - 1} mensajes (${n} obligaciones nuevas, semilla ${semilla})`);
