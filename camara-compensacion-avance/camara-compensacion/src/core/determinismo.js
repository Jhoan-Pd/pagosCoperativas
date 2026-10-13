import { crearMemoria, vistas, tomarFotografia, copiarSaldos, liberarFotografia } from './grafo.js';
import { Ingestor } from './ingestor.js';
import { mulberry32, barajar } from './aleatorio.js';
import { calcularCiclo, huella } from './ciclo.js';
import { fusionar, tramos } from './orden.js';

export function leerArchivo(texto) {
  const mensajes = [];
  let red = null;
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const o = JSON.parse(l);
    if (o.tipo === 'red') red = o;
    else mensajes.push(o);
  }
  return { red, mensajes };
}

export function reordenar(mensajes, llegada, semilla = 99) {
  const copia = mensajes.slice();
  if (llegada === 'inverso') copia.reverse();
  else if (llegada === 'aleatorio') barajar(copia, mulberry32(semilla));
  return copia;
}

function capacidadPara(n) {
  let c = 1024;
  while (c < n * 1.25) c <<= 1;
  return c;
}

export function construirGrafo(mensajes, saldos, cupos) {
  const memoria = crearMemoria(capacidadPara(mensajes.length + 16));
  const ing = new Ingestor(memoria);
  ing.abrir();
  ing.w.modificarSaldos((s, c) => { s.set(saldos); c.set(cupos); });
  for (const m of mensajes) ing.procesar(m);
  ing.cerrar();
  return { memoria, ing };
}

export async function corrida({ mensajes, saldos, cupos, ahora, llegada, K, estrategia = 'B', horizonte = 7200, ordenarTramos }) {
  const t0 = performance.now();
  const lista = reordenar(mensajes, llegada);
  const { memoria, ing } = construirGrafo(lista, saldos, cupos);
  const g = vistas(memoria.sab, memoria.cap);
  const { S, alto } = tomarFotografia(g, 0);
  const sc = copiarSaldos(g);
  const corridas = await ordenarTramos(memoria, g, tramos(alto, K), S);
  const orden = fusionar(g, g.orden, corridas);
  const E = { orden, c: g, saldo0: sc.saldo, cupo: sc.cupo, ahora };
  const R = calcularCiclo(E, { estrategia, horizonte });
  const h = await huella(E, R);
  liberarFotografia(g, 0);
  return {
    llegada, K, huella: h, m: orden.length, valido: R.valido,
    duplicados: ing.stats.duplicados, ejecutadas: R.resumen.ejecutadas, monto: R.resumen.montoLiquidado,
    ms: performance.now() - t0,
  };
}

export const CONFIGURACIONES = [
  { llegada: 'original', K: 1 },
  { llegada: 'inverso', K: 2 },
  { llegada: 'aleatorio', K: 4 },
];
