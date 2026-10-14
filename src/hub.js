import { crearRed, FuenteRed, INICIO_DIA } from './core/generador.js';

const pestanas = new Map();
let liderId = null;
let motor = null;
let semilla = 2026;
let red = crearRed(semilla);
let fuente = new FuenteRed(red, 7);
const config = {
  velocidad: 30,
  tasa: 120,
  intervalo: 900,
  estrategia: 'B',
  workers: 2,
  horizonte: 7200,
  alimentando: true,
};
let base = INICIO_DIA, t0 = Date.now();
let proximoCiclo = INICIO_DIA + config.intervalo;
let numeroCiclo = 0;
let cicloEnCurso = false;
let fallaPendiente = null;
let acumulado = 0;
let espera = [];
let recientes = [];
let ultimaVista = null, ultimoReporte = null, ultimoDeterminismo = null;
const sims = new Map();
let simSeq = 0;
let simActiva = null;
const reportes = [];

const reloj = () => base + ((Date.now() - t0) / 1000) * config.velocidad;

function rebase() { base = reloj(); t0 = Date.now(); }

self.onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = (ev) => desdePestana(port, ev.data);
  port.start();
};

function enviar(port, msg, transfer) {
  try { port.postMessage(msg, transfer || []); } catch { }
}

function difundir(msg) {
  for (const p of pestanas.values()) enviar(p.port, msg);
}

function estadoGeneral() {
  return {
    tipo: 'estado', config, reloj: reloj(), proximoCiclo, cicloEnCurso, numeroCiclo,
    pestanas: pestanas.size, liderId, motorListo: !!motor, enEspera: espera.length,
    fallaPendiente, semilla,
  };
}

function desdePestana(port, d) {
  if (d.tipo === 'hola') {
    pestanas.set(d.id, { port, visto: Date.now(), desde: Date.now() });
    enviar(port, { tipo: 'bienvenida', id: d.id });
    if (!liderId || !pestanas.has(liderId)) elegirLider();
    else enviar(port, { tipo: 'rol', rol: d.id === liderId ? 'lider' : 'seguidor', semilla });
    enviar(port, estadoGeneral());
    if (ultimaVista) enviar(port, ultimaVista);
    if (ultimoReporte) enviar(port, { tipo: 'reporte', reporte: ultimoReporte });
    for (const s of sims.values()) enviar(port, s);
    if (ultimoDeterminismo) enviar(port, ultimoDeterminismo);
    return;
  }
  const yo = pestanas.get(d.id);
  if (yo) yo.visto = Date.now();
  if (d.tipo === 'latido') return;
  if (d.tipo === 'adios') { quitar(d.id); return; }
  if (d.tipo === 'motorListo' && d.id === liderId) { conectarMotor(d); return; }
  if (d.tipo === 'cmd') comando(d.id, d.cmd, d.datos || {});
}

function quitar(id) {
  pestanas.delete(id);
  if (id === liderId) {
    liderId = null;
    motor = null;
    cicloEnCurso = false;
    elegirLider();
  }
  difundir(estadoGeneral());
}

function elegirLider() {
  let mejor = null;
  for (const [id, p] of pestanas) if (!mejor || p.desde < pestanas.get(mejor).desde) mejor = id;
  liderId = mejor;
  motor = null;
  for (const [id, p] of pestanas) enviar(p.port, { tipo: 'rol', rol: id === liderId ? 'lider' : 'seguidor', semilla });
}

function conectarMotor(d) {
  motor = d.puertos;
  if (d.seqMax && fuente.gen.seq <= d.seqMax) fuente.gen.seq = d.seqMax + 1;
  if (d.reloj && d.reloj > reloj()) { base = d.reloj; t0 = Date.now(); }
  while (proximoCiclo <= reloj()) proximoCiclo += config.intervalo;
  motor.ingesta.onmessage = (e) => desdeMotor(e.data);
  motor.calculo.onmessage = (e) => desdeMotor(e.data);
  motor.sim.onmessage = (e) => desdeMotor(e.data);
  const reenviar = [];
  for (const [, l] of recientes) for (const m of l) reenviar.push(m);
  for (const m of espera) reenviar.push(m);
  espera = [];
  for (let i = 0; i < reenviar.length; i += 5000) motor.ingesta.postMessage({ tipo: 'mensajes', lote: reenviar.slice(i, i + 5000), reloj: reloj() });
  difundir(estadoGeneral());
  difundir({ tipo: 'aviso', texto: d.restaurado ? 'Motor reiniciado desde el último estado guardado' : 'Motor listo' });
}

function desdeMotor(d) {
  switch (d.tipo) {
    case 'vista':
      ultimaVista = d;
      difundir(d);
      break;
    case 'reporte':
      ultimoReporte = d.reporte;
      reportes.push({ numero: d.reporte.numero, huella: d.reporte.huella, valido: d.reporte.valido, total: d.reporte.tiempos.total, m: d.reporte.m });
      if (reportes.length > 50) reportes.shift();
      difundir(d);
      difundir({ tipo: 'historial', reportes });
      break;
    case 'cicloInicio':
      cicloEnCurso = true;
      difundir(d);
      difundir(estadoGeneral());
      break;
    case 'cicloFin':
      cicloEnCurso = false;
      difundir(d);
      difundir(estadoGeneral());
      break;
    case 'simEstado':
      sims.set(d.id, { ...(sims.get(d.id) || {}), ...d });
      if (d.estado === 'corriendo' || d.estado === 'en pausa') simActiva = d.id;
      else if (simActiva === d.id) simActiva = null;
      difundir(sims.get(d.id));
      break;
    case 'determinismo':
      ultimoDeterminismo = d;
      difundir(d);
      break;
    case 'auditoria':
    case 'reproduccion': {
      const p = pestanas.get(d.para);
      if (p) enviar(p.port, d);
      break;
    }
    default:
      difundir(d);
  }
}

function aMotor(cual, msg) {
  if (!motor) { difundir({ tipo: 'aviso', texto: 'El motor todavía no está listo' }); return false; }
  motor[cual].postMessage(msg);
  return true;
}

function comando(de, cmd, x) {
  switch (cmd) {
    case 'config': {
      if ('velocidad' in x) rebase();
      Object.assign(config, x);
      if ('intervalo' in x) {
        proximoCiclo = reloj() + config.intervalo;
      }
      difundir(estadoGeneral());
      break;
    }
    case 'ciclo':
      disparar();
      break;
    case 'rafaga':
      generar(x.n || 13000, true);
      break;
    case 'falla':
      fallaPendiente = x.invariante || null;
      difundir(estadoGeneral());
      break;
    case 'simular': {
      const id = 'sim' + ++simSeq;
      const msg = { tipo: 'simEstado', id, estado: 'pedida', escenario: x.escenario, pedidaPor: de, creada: Date.now() };
      sims.set(id, msg);
      difundir(msg);
      aMotor('sim', { tipo: 'simular', id, escenario: x.escenario, estrategia: config.estrategia, horizonte: config.horizonte, ahora: reloj() });
      break;
    }
    case 'cancelarSim':
      if (simActiva === x.id) {
        const l = pestanas.get(liderId);
        if (l) enviar(l.port, { tipo: 'cancelarSim', id: x.id });
      } else aMotor('sim', { tipo: 'quitarDeCola', id: x.id });
      break;
    case 'determinismo':
      conTexto(x, (texto) => aMotor('calculo', { tipo: 'determinismo', texto, estrategia: config.estrategia }));
      break;
    case 'auditoria':
      aMotor('calculo', { tipo: 'auditoria', para: de });
      break;
    case 'reproducir':
      conTexto(x, (texto) => aMotor('sim', { tipo: 'reproducir', texto, para: de }));
      break;
    case 'archivo':
      conTexto(x, cargarArchivo);
      break;
    case 'vista':
      aMotor('ingesta', { tipo: 'vistaYa' });
      break;
  }
}

function conTexto(x, fn) {
  if (x.archivo) x.archivo.text().then(fn, (e) => difundir({ tipo: 'aviso', texto: 'No se pudo leer el archivo: ' + e.message }));
  else fn(x.texto);
}

function disparar() {
  if (!motor) return;
  if (cicloEnCurso) { difundir({ tipo: 'aviso', texto: 'Ya hay un ciclo en curso; se espera a que termine' }); return; }
  numeroCiclo++;
  cicloEnCurso = true;
  motor.calculo.postMessage({
    tipo: 'ejecutar', numero: numeroCiclo, ahora: Math.floor(reloj()), estrategia: config.estrategia,
    workers: config.workers, horizonte: config.horizonte, inyectarFalla: fallaPendiente,
  });
  fallaPendiente = null;
  proximoCiclo = Math.max(proximoCiclo, reloj()) + config.intervalo;
  difundir(estadoGeneral());
}

function entregar(lote) {
  if (!lote.length) return;
  const ahora = Date.now();
  recientes.push([ahora, lote]);
  while (recientes.length && ahora - recientes[0][0] > 3000) recientes.shift();
  if (motor) motor.ingesta.postMessage({ tipo: 'mensajes', lote, reloj: reloj() });
  else {
    for (const m of lote) espera.push(m);
    if (espera.length > 300000) espera.splice(0, espera.length - 300000);
  }
}

function generar(n, rafaga) {
  const t = reloj();
  const lote = fuente.emitir(n, t - (rafaga ? 60 : 0.1 * config.velocidad), t);
  for (let i = 0; i < lote.length; i += 5000) entregar(lote.slice(i, i + 5000));
}

function cargarArchivo(texto) {
  let n = 0, red2 = null;
  let lote = [];
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.tipo === 'red') { red2 = o; continue; }
    lote.push(o); n++;
    if (lote.length === 5000) { entregar(lote); lote = []; }
  }
  if (red2 && motor) motor.ingesta.postMessage({ tipo: 'red', saldos: red2.saldos, cupos: red2.cupos });
  entregar(lote);
  difundir({ tipo: 'aviso', texto: `Archivo cargado: ${n.toLocaleString('es-CO')} mensajes` });
}

setInterval(() => {
  const ahora = Date.now();
  for (const [id, p] of pestanas) if (ahora - p.visto > 4000) quitar(id);
  if (config.alimentando) {
    acumulado += config.tasa / 10;
    const n = Math.floor(acumulado);
    acumulado -= n;
    if (n > 0) generar(n, false);
    const dt = 0.1 * config.velocidad;
    if (Math.random() < (12.5 * dt) / config.intervalo) entregar([fuente.deposito(reloj())]);
  }
  if (motor && !cicloEnCurso && reloj() >= proximoCiclo) disparar();
}, 100);

setInterval(() => difundir(estadoGeneral()), 1000);
