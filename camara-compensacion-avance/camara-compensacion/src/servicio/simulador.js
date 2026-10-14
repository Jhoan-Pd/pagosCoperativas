import { crearMemoria, vistas, tomarFotografia, copiarSaldos, liberarFotografia } from '../core/grafo.js';
import { Ingestor } from '../core/ingestor.js';
import { crearRed, FuenteRed, INICIO_DIA } from '../core/generador.js';
import { ordenarFotografia } from '../core/orden.js';
import { calcularCiclo, huella } from '../core/ciclo.js';

export async function generarResumen({ limite = 1200 } = {}) {
  const red = crearRed(2026);
  const fuente = new FuenteRed(red, 7);
  const n = Math.min(Math.max(200, Number(limite) || 1200), 5000);
  const mensajes = fuente.emitir(n, INICIO_DIA, INICIO_DIA + 3600 * 4);
  fuente.vaciar(mensajes);

  for (let i = 0; i < 12; i++) {
    mensajes.push(fuente.deposito(INICIO_DIA + 100 * i));
  }

  const memoria = crearMemoria(1 << 19);
  const ing = new Ingestor(memoria);
  ing.w.modificarSaldos((s, c) => {
    s.set(red.saldo);
    c.set(red.cupo);
  });

  ing.abrir();
  for (const mensaje of mensajes) ing.procesar(mensaje);
  ing.cerrar();

  const grafo = vistas(memoria.sab, memoria.cap);
  const { S, alto } = tomarFotografia(grafo, 0);
  const saldos = copiarSaldos(grafo);
  const orden = ordenarFotografia(grafo, alto, S, 1);
  const resultado = calcularCiclo(
    { orden, c: grafo, saldo0: saldos.saldo, cupo: saldos.cupo, ahora: INICIO_DIA + 4 * 3600 },
    { estrategia: 'B' }
  );
  const huellaFinal = await huella({ orden, c: grafo }, resultado);
  liberarFotografia(grafo, 0);

  return {
    ok: true,
    node: process.version,
    n,
    stats: ing.stats,
    huellas: huellaFinal.slice(0, 12),
    resumen: resultado.resumen,
    fase1: resultado.fase1,
    invariantes: resultado.invariantes.slice(0, 5),
    bloqueadores: resultado.bloqueadores.slice(0, 3),
    tiempos: resultado.tiempos,
  };
}
