import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRed, FuenteRed, INICIO_DIA } from '../src/core/generador.js';
import { corrida, CONFIGURACIONES } from '../src/core/determinismo.js';
import { ordenarTramo } from '../src/core/orden.js';

test('misma huella con 1, 2 y 4 particiones y distinto orden de llegada', async () => {
  const red = crearRed(11);
  const f = new FuenteRed(red, 3);
  const mensajes = f.emitir(8000, INICIO_DIA, INICIO_DIA + 7200);
  f.vaciar(mensajes);
  const ordenarTramos = async (mem, g, rangos, S) => rangos.map((r) => ({ desde: r.desde, n: ordenarTramo(g, r.desde, r.hasta, S, g.orden) }));
  const huellas = [];
  for (const cfg of CONFIGURACIONES) {
    const r = await corrida({ mensajes, saldos: red.saldo, cupos: red.cupo, ahora: INICIO_DIA + 7200, ...cfg, ordenarTramos });
    assert.ok(r.valido);
    huellas.push(r.huella);
  }
  assert.equal(new Set(huellas).size, 1);
});
