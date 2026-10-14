import { vistas, N, NN, H } from '../core/grafo.js';
import { Ingestor } from '../core/ingestor.js';
import { crearRed } from '../core/generador.js';

let ing, g, hub, ciclo;
const cola = [];
let cabeza = 0;
let corriendo = false;
let lote = [];
let numLote = 0;
let ultimoLoteEnviado = 0;
let seqMax = 0;
let recibidosVentana = [];
let ultimoReloj = 0;

const canalCeder = new MessageChannel();
canalCeder.port1.onmessage = () => trabajar();
const ceder = () => canalCeder.port2.postMessage(0);

self.onmessage = (e) => {
  const d = e.data;
  if (d.tipo === 'init') iniciar(d);
};

function iniciar(d) {
  ing = new Ingestor(d.memoria);
  g = vistas(d.memoria.sab, d.memoria.cap);
  hub = d.puertoHub;
  ciclo = d.puertoCiclo;
  let meta = null;
  if (d.estado) {
    try { meta = ing.restaurarEstado(d.estado); } catch (err) { meta = null; }
  }
  if (!meta) {
    const red = crearRed(d.semilla);
    ing.w.modificarSaldos((s, c) => { s.set(red.saldo); c.set(red.cupo); });
  }
  let repetidos = 0;
  if (d.lotes?.length) {
    ing.abrir();
    for (const l of d.lotes) {
      if (meta && l.lote <= (meta.hastaLote ?? 0) && l.sesion === meta.sesion) continue;
      for (const m of l.mensajes) { ing.procesar(m); repetidos++; actualizarSeq(m); }
    }
    ing.cerrar();
  }
  if (meta?.seqMax) seqMax = Math.max(seqMax, meta.seqMax);
  numLote = meta?.hastaLote ?? 0;
  ultimoLoteEnviado = numLote;
  hub.onmessage = (ev) => desdeHub(ev.data);
  ciclo.onmessage = (ev) => desdeCiclo(ev.data);
  setInterval(publicar, 1000);
  setInterval(enviarLote, 1000);
  self.postMessage({ tipo: 'listo', restaurado: !!meta, reprocesados: repetidos, seqMax, reloj: meta?.reloj ?? null });
  publicar();
}

function actualizarSeq(m) {
  if (m.id && m.id.startsWith('OB-')) {
    const n = Number(m.id.slice(8));
    if (n > seqMax) seqMax = n;
  }
}

function desdeHub(d) {
  if (d.tipo === 'mensajes') {
    for (const m of d.lote) cola.push(m);
    if (d.reloj) ultimoReloj = d.reloj;
    if (!corriendo) { corriendo = true; ceder(); }
  } else if (d.tipo === 'red') {
    ing.abrir();
    ing.w.modificarSaldos((s, c) => { s.set(d.saldos); c.set(d.cupos); });
    ing.cerrar();
  } else if (d.tipo === 'vistaYa') publicar();
}

function trabajar() {
  const limite = performance.now() + 8;
  let n = 0;
  while (cabeza < cola.length && performance.now() < limite) {
    ing.abrir();
    const fin = Math.min(cola.length, cabeza + 256);
    for (; cabeza < fin; cabeza++) {
      const m = cola[cabeza];
      ing.procesar(m);
      actualizarSeq(m);
      lote.push(m);
      n++;
    }
    ing.cerrar();
  }
  if (n) recibidosVentana.push([performance.now(), n]);
  if (cabeza > 50000) { cola.splice(0, cabeza); cabeza = 0; }
  if (cabeza < cola.length) ceder();
  else { cola.length = 0; cabeza = 0; corriendo = false; ing.recuperar(); }
}

function enviarLote() {
  if (!lote.length) return;
  numLote++;
  const cuerpo = { lote: numLote, sesion: sesion(), mensajes: lote };
  lote = [];
  ultimoLoteEnviado = numLote;
  self.postMessage({ tipo: 'diario', cuerpo: JSON.stringify(cuerpo), lote: numLote });
}

let _sesion = null;
function sesion() {
  if (!_sesion) _sesion = 'S' + Date.now().toString(36);
  return _sesion;
}

function desdeCiclo(d) {
  const responder = (x) => (d.respuesta ? d.respuesta.postMessage(x) : ciclo.postMessage(x));
  if (d.tipo === 'aplicar') {
    const t = performance.now();
    const r = ing.aplicarResultado(d);
    responder({ tipo: 'aplicado', ...r, ms: performance.now() - t });
    enviarLote();
    const estado = ing.exportarEstado({ hastaLote: ultimoLoteEnviado, sesion: sesion(), seqMax, reloj: d.ahora, ciclo: d.numero });
    self.postMessage({ tipo: 'estado', estado, ciclo: d.numero, hastaLote: ultimoLoteEnviado, sesion: sesion() }, [estado]);
    setTimeout(() => { ing.recuperar(); publicar(); }, 50);
  } else if (d.tipo === 'descartar') {
    ing.abrir(); ing.finalizarTardias(); ing.cerrar();
    responder({ tipo: 'descartado' });
  }
}

function tasa() {
  const ahora = performance.now();
  recibidosVentana = recibidosVentana.filter(([t]) => ahora - t < 5000);
  let s = 0;
  for (const [, n] of recibidosVentana) s += n;
  return s / 5;
}

function publicar() {
  if (!ing) return;
  const nodos = new Float64Array(N * 7);
  for (let v = 0; v < N; v++) {
    nodos[v * 7] = g.saldo[v];
    nodos[v * 7 + 1] = g.cupo[v];
    nodos[v * 7 + 2] = g.posNeta[v];
    nodos[v * 7 + 5] = g.gradOut[v];
    nodos[v * 7 + 6] = g.gradIn[v];
  }
  const tmpI = [], tmpT = [];
  for (let k = 0; k < NN; k++) {
    const c = g.parCuenta[k] + g.parCuenta[k + NN] + g.parCuenta[k + 2 * NN];
    if (!c) continue;
    const t = g.parMonto[k] + g.parMonto[k + NN] + g.parMonto[k + 2 * NN];
    const i = (k / N) | 0, j = k % N;
    nodos[i * 7 + 3] += t;
    nodos[j * 7 + 4] += t;
    tmpI.push(k); tmpT.push(t);
  }
  const idx = Array.from(tmpI.keys()).sort((a, b) => tmpT[b] - tmpT[a]);
  const n = Math.min(idx.length, 40000);
  const pares = new Uint32Array(n), montos = new Float32Array(n * 3), cuentas = new Uint32Array(n);
  for (let x = 0; x < n; x++) {
    const k = tmpI[idx[x]];
    pares[x] = k;
    montos[x * 3] = g.parMonto[k]; montos[x * 3 + 1] = g.parMonto[k + NN]; montos[x * 3 + 2] = g.parMonto[k + 2 * NN];
    cuentas[x] = g.parCuenta[k] + g.parCuenta[k + NN] + g.parCuenta[k + 2 * NN];
  }
  const resumen = { ...ing.resumen(), tasa: tasa(), rezago: cola.length - cabeza, paresActivos: tmpI.length, seqMax, ciclosAplicados: Atomics.load(g.cab, H.CICLO) };
  hub.postMessage({ tipo: 'vista', nodos, pares, montos, cuentas, resumen }, [nodos.buffer, pares.buffer, montos.buffer, cuentas.buffer]);
}
