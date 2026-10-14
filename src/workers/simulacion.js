import { vistas, tomarFotografia, liberarFotografia, copiarSaldos, H } from '../core/grafo.js';
import { ordenarFotografia } from '../core/orden.js';
import { calcularCiclo, Cancelado } from '../core/ciclo.js';
import { reproducir } from '../core/auditoria.js';

const LECTOR = 1;
let g, hub;
const cola = [];
let activa = null;

self.onmessage = (e) => {
  const d = e.data;
  if (d.tipo === 'init') {
    g = vistas(d.memoria.sab, d.memoria.cap);
    g.ordenLocal = new Int32Array(d.memoria.cap);
    hub = d.puertoHub;
    hub.onmessage = (ev) => pedido(ev.data);
  }
};

function pedido(d) {
  if (d.tipo === 'simular') {
    cola.push(d);
    hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'en cola', escenario: d.escenario });
    if (!activa) siguiente();
  } else if (d.tipo === 'quitarDeCola') {
    const i = cola.findIndex((x) => x.id === d.id);
    if (i >= 0) {
      cola.splice(i, 1);
      hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'cancelada' });
    }
  } else if (d.tipo === 'reproducir') {
    reproducirRegistro(d);
  }
}

function esperarOficial() {
  let pausa = 0;
  while (Atomics.load(g.cab, H.OFICIAL) === 1) {
    if (Atomics.load(g.cab, H.CANCELAR0 + LECTOR) === 1) throw new Cancelado();
    const t = performance.now();
    Atomics.wait(g.cab, H.OFICIAL, 1, 50);
    pausa += performance.now() - t;
  }
  return pausa;
}

async function siguiente() {
  activa = cola.shift();
  if (!activa) return;
  const d = activa;
  Atomics.store(g.cab, H.CANCELAR0 + LECTOR, 0);
  let pausado = 0;
  let paso = 'esperando';
  const avisar = (texto) => hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'corriendo', paso: texto, pausado });
  const debeParar = () => {
    if (Atomics.load(g.cab, H.CANCELAR0 + LECTOR) === 1) throw new Cancelado();
    if (Atomics.load(g.cab, H.OFICIAL) === 1) {
      hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'en pausa', paso, pausado });
      pausado += esperarOficial();
    }
  };
  let tomada = false;
  const t0 = performance.now();
  try {
    pausado += esperarOficial();
    paso = 'congelando'; avisar(paso);
    const { S, alto } = tomarFotografia(g, LECTOR);
    tomada = true;
    const { saldo, cupo } = copiarSaldos(g);
    paso = 'ordenando'; avisar(paso);
    const orden = ordenarFotografia(g, alto, S, 1, debeParar);
    const E = { orden, c: g, saldo0: saldo, cupo, ahora: d.ahora };
    paso = 'ciclo base'; avisar(paso);
    const base = calcularCiclo(E, { estrategia: d.estrategia, horizonte: d.horizonte, comparar: [d.estrategia], debeParar });
    paso = 'escenario'; avisar(paso);
    const esc = calcularCiclo(E, { estrategia: d.estrategia, horizonte: d.horizonte, comparar: [d.estrategia], escenario: d.escenario, debeParar });
    const montoNoDiferible = (r) => {
      let s = 0;
      for (let p = 0; p < r.m; p++) if (r.decision[p] && g.prioridad[orden[p]] !== 3) s += g.monto[orden[p]];
      return s;
    };
    hub.postMessage({
      tipo: 'simEstado', id: d.id, estado: 'terminada', escenario: d.escenario, descripcion: esc.descripcion,
      m: orden.length, epoca: S,
      base: { ...base.resumen, fase1: base.fase1.montoEliminado, noDiferible: montoNoDiferible(base) },
      esc: { ...esc.resumen, fase1: esc.fase1.montoEliminado, noDiferible: montoNoDiferible(esc) },
      validos: base.valido && esc.valido,
      ms: performance.now() - t0, pausado,
    });
  } catch (err) {
    if (err.cancelado) hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'cancelada', paso, pausado });
    else hub.postMessage({ tipo: 'simEstado', id: d.id, estado: 'error', error: String(err.message || err) });
  } finally {
    if (tomada) liberarFotografia(g, LECTOR);
    Atomics.store(g.cab, H.CANCELAR0 + LECTOR, 0);
    activa = null;
    if (cola.length) setTimeout(siguiente, 0);
  }
}

async function reproducirRegistro(d) {
  try {
    const reg = JSON.parse(d.texto);
    const t = performance.now();
    const r = await reproducir(reg);
    hub.postMessage({
      tipo: 'reproduccion', para: d.para, coincide: r.coincide, diferencias: r.diferencias,
      huellaOriginal: r.huellaOriginal, huellaReproducida: r.huellaReproducida, m: r.res.m,
      ms: performance.now() - t,
    });
  } catch (err) {
    hub.postMessage({ tipo: 'reproduccion', para: d.para, error: String(err.message || err) });
  }
}
