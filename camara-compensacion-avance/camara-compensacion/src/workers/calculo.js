import { vistas, tomarFotografia, copiarSaldos, H, bytesNecesarios, N } from '../core/grafo.js';
import { fusionar, tramos } from '../core/orden.js';
import { calcularCiclo, huella } from '../core/ciclo.js';
import { capturarEntrada, construirAuditoria } from '../core/auditoria.js';
import { corrida, CONFIGURACIONES, leerArchivo } from '../core/determinismo.js';
import { mensajesDesdeCaptura } from '../core/mensajes.js';

let memoria, g, hub, ingesta;
const shards = [];
let tareaSeq = 0;
const esperas = new Map();
let ocupado = false;
let ultimo = null;
let bytesAhorrados = 0;
const historial = [];

function crearShards(n) {
  for (let i = shards.length; i < n; i++) {
    const w = new Worker(new URL('./shard.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const r = esperas.get(e.data.tarea);
      if (r) { esperas.delete(e.data.tarea); r(e.data); }
    };
    w.postMessage({ tipo: 'adjuntar', id: 'oficial', memoria });
    shards.push(w);
  }
}

function pedir(w, msg) {
  const tarea = ++tareaSeq;
  return new Promise((res) => { esperas.set(tarea, res); w.postMessage({ ...msg, tarea }); });
}

async function ordenarConShards(id, rangos, S) {
  crearShards(rangos.length);
  const r = await Promise.all(rangos.map((t, j) => pedir(shards[j], { tipo: 'tramo', id, desde: t.desde, hasta: t.hasta, S })));
  return r.map((x) => ({ desde: x.desde, n: x.n, ms: x.ms }));
}

function aIngesta(msg, transfer) {
  return new Promise((res) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = (e) => res(e.data);
    ingesta.postMessage({ ...msg, respuesta: canal.port2 }, [canal.port2, ...(transfer || [])]);
  });
}

async function cicloOficial(p) {
  if (ocupado) { hub.postMessage({ tipo: 'aviso', texto: 'Ya hay un ciclo en curso' }); return; }
  ocupado = true;
  const K = Math.max(1, Math.min(8, p.workers | 0 || 4));
  const t = { inicio: performance.now() };
  hub.postMessage({ tipo: 'cicloInicio', numero: p.numero });
  Atomics.store(g.cab, H.OFICIAL, 1);
  try {
    const tc = performance.now();
    const { S, alto } = tomarFotografia(g, 0);
    const { saldo, cupo } = copiarSaldos(g);
    t.congelamiento = performance.now() - tc;

    const to = performance.now();
    const corridas = await ordenarConShards('oficial', tramos(alto, K), S);
    const orden = fusionar(g, g.orden, corridas);
    t.ordenParalelo = performance.now() - to;
    t.shards = corridas.map((x) => +x.ms.toFixed(1));

    const E = { orden, c: g, saldo0: saldo, cupo, ahora: p.ahora };
    const R = calcularCiclo(E, { estrategia: p.estrategia, horizonte: p.horizonte, inyectarFalla: p.inyectarFalla });
    t.fase1 = R.tiempos.fase1; t.fase2 = R.tiempos.fase2; t.invariantes = R.tiempos.invariantes;

    const th = performance.now();
    R.huella = await huella(E, R);
    const cap = capturarEntrada(E);
    t.auditoria = performance.now() - th;

    Atomics.store(g.cab, H.OFICIAL, 0);
    Atomics.notify(g.cab, H.OFICIAL);

    const ta = performance.now();
    let aplicado = null;
    if (R.valido) {
      const ranuras = new Int32Array(R.nFase1 + R.nSecuencia), claves = new Float64Array(ranuras.length);
      let x = 0;
      for (let q = 0; q < R.m; q++) if (R.decision[q]) { ranuras[x] = orden[q]; claves[x++] = g.clave[orden[q]]; }
      aplicado = await aIngesta({ tipo: 'aplicar', ranuras, claves, deltas: R.deltas, ahora: p.ahora, numero: p.numero }, [ranuras.buffer, claves.buffer]);
    } else {
      await aIngesta({ tipo: 'descartar', numero: p.numero });
    }
    t.aplicar = performance.now() - ta;
    t.total = performance.now() - t.inicio;

    const bytesGrafo = bytesNecesarios(memoria.cap);
    bytesAhorrados += bytesGrafo * (K + 1);
    ultimo = { cap, R, meta: { ciclo: p.numero, epoca: S, workers: K, horizonte: p.horizonte ?? 7200, generado: new Date().toISOString() } };
    const reporte = {
      numero: p.numero, ahora: p.ahora, epoca: S, m: R.m, workers: K, estrategia: R.estrategia,
      valido: R.valido, invariantes: R.invariantes, huella: R.huella,
      fase1: R.fase1, comparacion: R.comparacion, resumen: R.resumen,
      bloqueadores: R.bloqueadores, bloqueoMonto: Float64Array.from(R.bloqueoMonto),
      tiempos: t, aplicado,
      memoria: { bytesGrafo, bytesPorCiclo: bytesGrafo * (K + 1), bytesAhorrados },
      dentroPresupuesto: t.total < 20000,
    };
    historial.push({ numero: p.numero, huella: R.huella, total: t.total, m: R.m });
    hub.postMessage({ tipo: 'reporte', reporte });
  } catch (err) {
    Atomics.store(g.cab, H.OFICIAL, 0);
    Atomics.notify(g.cab, H.OFICIAL);
    await aIngesta({ tipo: 'descartar', numero: p.numero });
    hub.postMessage({ tipo: 'aviso', texto: 'Error en el ciclo: ' + err.message });
  } finally {
    ocupado = false;
    hub.postMessage({ tipo: 'cicloFin', numero: p.numero });
  }
}

async function exportarAuditoria(p) {
  if (!ultimo) { hub.postMessage({ tipo: 'aviso', texto: 'Aún no hay un ciclo para auditar' }); return; }
  const a = construirAuditoria(ultimo.cap, ultimo.R, ultimo.meta);
  const blob = new Blob([JSON.stringify(a)], { type: 'application/json' });
  hub.postMessage({ tipo: 'auditoria', para: p.para, blob, nombre: `auditoria-ciclo-${ultimo.meta.ciclo}.json` });
}

async function pruebaDeterminismo(p) {
  if (ocupado) { hub.postMessage({ tipo: 'aviso', texto: 'Espere a que termine el ciclo' }); return; }
  let mensajes, saldos, cupos, ahora, fuente;
  if (p.texto) {
    const { red, mensajes: ms } = leerArchivo(p.texto);
    mensajes = ms;
    saldos = Float64Array.from(red.saldos); cupos = Float64Array.from(red.cupos); ahora = red.ahora;
    fuente = 'archivo';
  } else {
    if (!ultimo) { hub.postMessage({ tipo: 'aviso', texto: 'Ejecute un ciclo primero o cargue un archivo' }); return; }
    mensajes = mensajesDesdeCaptura(ultimo.cap);
    saldos = ultimo.cap.saldo0; cupos = ultimo.cap.cupo; ahora = ultimo.cap.ahora;
    fuente = 'ciclo ' + ultimo.meta.ciclo;
  }
  ocupado = true;
  const resultados = [];
  try {
    let n = 0;
    for (const cfg of CONFIGURACIONES) {
      const id = 'det' + (++n);
      hub.postMessage({ tipo: 'determinismoProgreso', texto: `Corrida ${n}/3: llegada ${cfg.llegada}, ${cfg.K} worker(s)` });
      const r = await corrida({
        mensajes, saldos, cupos, ahora, ...cfg, estrategia: p.estrategia ?? 'B',
        ordenarTramos: async (mem, gg, rangos, S) => {
          crearShards(rangos.length);
          for (let j = 0; j < rangos.length; j++) shards[j].postMessage({ tipo: 'adjuntar', id, memoria: mem });
          const out = await ordenarConShards(id, rangos, S);
          for (let j = 0; j < rangos.length; j++) shards[j].postMessage({ tipo: 'soltar', id });
          return out;
        },
      });
      resultados.push(r);
    }
  } finally { ocupado = false; }
  const iguales = resultados.every((r) => r.huella === resultados[0].huella);
  const coincideOficial = fuente.startsWith('ciclo') && ultimo.R.estrategia === (p.estrategia ?? 'B') ? resultados[0].huella === ultimo.R.huella : null;
  hub.postMessage({ tipo: 'determinismo', fuente, resultados, iguales, coincideOficial, mensajes: mensajes.length });
}

function conectarHub(port) {
  hub = port;
  hub.onmessage = (e) => {
    const d = e.data;
    if (d.tipo === 'ejecutar') cicloOficial(d);
    else if (d.tipo === 'auditoria') exportarAuditoria(d);
    else if (d.tipo === 'determinismo') pruebaDeterminismo(d);
  };
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.tipo === 'init') {
    memoria = d.memoria;
    g = vistas(memoria.sab, memoria.cap);
    ingesta = d.puertoIngesta;
    conectarHub(d.puertoHub);
    crearShards(d.nShards || 4);
    hub.postMessage({ tipo: 'calculoListo', shards: shards.length, N });
  }
};
