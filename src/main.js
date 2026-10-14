import { crearMemoria, vistas, N, H } from './core/grafo.js';
import { crearRed } from './core/generador.js';
import { ESTRATEGIAS } from './core/seleccion.js';
import { Lienzo } from './ui/lienzo.js';
import { iniciarMetricas, inp, tareasLargas, memoria as medirMemoria } from './ui/metricas.js';
import * as F from './ui/formato.js';
import { cuandoPinte, ceder } from './ui/ceder.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const yo = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + '';

let rol = null;
let estado = null;
let vista = null;
let reporte = null;
let g = null;
let motorArrancado = false;
let sync = null;
let memoriaUsada = null;
let historial = [];
const sims = new Map();
let circuitoSel = -1, pasoCirc = 0;

iniciarMetricas();

const lienzo = new Lienzo($('#lienzo'), $('#tip'), (v) => { pintarNodo(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    if (!crossOriginIsolated && navigator.serviceWorker.controller && !sessionStorage.getItem('recargaCOI')) {
      sessionStorage.setItem('recargaCOI', '1');
      location.reload();
    }
  }).catch((e) => anotar('No se pudo registrar el Service Worker: ' + e.message));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!crossOriginIsolated && !sessionStorage.getItem('recargaCOI')) {
      sessionStorage.setItem('recargaCOI', '1');
      location.reload();
    }
  });
}

if (!crossOriginIsolated) {
  const fr = $('#aviso-coi');
  fr.hidden = false;
  fr.textContent = 'La página no está aislada (crossOriginIsolated = false), así que no hay SharedArrayBuffer. Revise las cabeceras COOP/COEP del servidor o recargue una vez.';
}
$('#e-coi').innerHTML = crossOriginIsolated ? '<span class="ok">crossOriginIsolated</span>' : '<span class="mal">sin aislar</span>';

const hub = new SharedWorker(new URL('./hub.js', import.meta.url), { type: 'module', name: 'camara-hub' });
const puerto = hub.port;
puerto.onmessage = (e) => desdeHub(e.data);
puerto.start();
puerto.postMessage({ tipo: 'hola', id: yo });
setInterval(() => puerto.postMessage({ tipo: 'latido', id: yo }), 1000);
addEventListener('pagehide', () => puerto.postMessage({ tipo: 'adios', id: yo }));

const cmd = (c, datos) => puerto.postMessage({ tipo: 'cmd', id: yo, cmd: c, datos });

function desdeHub(d) {
  switch (d.tipo) {
    case 'rol':
      rol = d.rol;
      lienzo.ponerHubs(crearRed(d.semilla).esHub);
      pintarEstado();
      if (rol === 'lider' && !motorArrancado) arrancarMotor(d.semilla);
      if (rol === 'lider') anotar('Esta pestaña quedó a cargo del motor de cálculo');
      break;
    case 'estado':
      estado = d;
      pintarEstado();
      break;
    case 'vista':
      vista = d;
      lienzo.actualizar(d);
      pintarIngesta();
      pintarNodo();
      break;
    case 'reporte':
      reporte = d.reporte;
      lienzo.ponerBloqueo(reporte.bloqueoMonto);
      pintarReporte();
      anotar(`Ciclo ${reporte.numero}: ${reporte.valido ? 'aplicado' : 'RECHAZADO'} · ${F.n(reporte.m)} obligaciones · ${F.ms(reporte.tiempos.total)}`);
      break;
    case 'historial':
      historial = d.reportes;
      pintarHistorial();
      break;
    case 'cicloInicio':
      anotar(`Ciclo ${d.numero}: congelando y calculando…`);
      break;
    case 'simEstado':
      sims.set(d.id, d);
      pintarSims();
      break;
    case 'determinismoProgreso':
      $('#det').innerHTML = `<p class="nota">${F.esc(d.texto)}</p>`;
      break;
    case 'determinismo':
      pintarDeterminismo(d);
      break;
    case 'auditoria':
      descargar(d.blob, d.nombre);
      anotar(`Registro descargado (${F.bytes(d.blob.size)})`);
      break;
    case 'reproduccion':
      pintarReproduccion(d);
      break;
    case 'cancelarSim':
      if (g) Atomics.store(g.cab, H.CANCELAR0 + 1, 1);
      break;
    case 'calculoListo':
      anotar(`Motor de cálculo con ${d.shards} workers de apoyo`);
      break;
    case 'aviso':
      anotar(d.texto);
      break;
  }
}

async function arrancarMotor(semilla) {
  if (!crossOriginIsolated) { anotar('No se arranca el motor: falta aislamiento de origen'); return; }
  motorArrancado = true;
  await swListo();
  const memoria = crearMemoria();
  g = vistas(memoria.sab, memoria.cap);
  let guardado = null, lotes = [];
  if (conSW()) {
    try {
      const r = await fetch('/api/estado');
      if (r.status === 200) guardado = await r.arrayBuffer();
    } catch { }
    try {
      const r = await fetch('/api/recibidas');
      if (r.ok) lotes = await r.json();
    } catch { }
  }
  const opciones = { type: 'module' };
  const ingesta = new Worker(new URL('./workers/ingesta.js', import.meta.url), { ...opciones, name: 'ingesta' });
  const calculo = new Worker(new URL('./workers/calculo.js', import.meta.url), { ...opciones, name: 'calculo' });
  const sim = new Worker(new URL('./workers/simulacion.js', import.meta.url), { ...opciones, name: 'simulacion' });
  const hI = new MessageChannel(), hC = new MessageChannel(), hS = new MessageChannel(), ic = new MessageChannel();
  ingesta.postMessage({ tipo: 'init', memoria, semilla, estado: guardado, lotes, puertoHub: hI.port1, puertoCiclo: ic.port1 },
    [hI.port1, ic.port1, ...(guardado ? [guardado] : [])]);
  calculo.postMessage({ tipo: 'init', memoria, puertoHub: hC.port1, puertoIngesta: ic.port2, nShards: 4 }, [hC.port1, ic.port2]);
  sim.postMessage({ tipo: 'init', memoria, puertoHub: hS.port1 }, [hS.port1]);
  for (const w of [ingesta, calculo, sim]) w.onerror = (e) => anotar(`Error en worker ${e.filename || ''}: ${e.message}`);
  ingesta.onmessage = (e) => {
    const d = e.data;
    if (d.tipo === 'listo') {
      puerto.postMessage({
        tipo: 'motorListo', id: yo, seqMax: d.seqMax, reloj: d.reloj, restaurado: d.restaurado,
        puertos: { ingesta: hI.port2, calculo: hC.port2, sim: hS.port2 },
      }, [hI.port2, hC.port2, hS.port2]);
      if (d.restaurado || d.reprocesados) anotar(`Recuperado: estado guardado${d.reprocesados ? ` + ${F.n(d.reprocesados)} mensajes del diario` : ''}`);
    } else if (d.tipo === 'diario') {
      if (conSW()) fetch('/api/recibidas', { method: 'POST', body: d.cuerpo, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    } else if (d.tipo === 'estado') {
      if (conSW()) fetch('/api/estado', {
        method: 'POST', body: d.estado,
        headers: { 'Content-Type': 'application/octet-stream', 'x-hasta-lote': String(d.hastaLote), 'x-sesion': d.sesion, 'x-ciclo': String(d.ciclo) },
      }).catch(() => {});
    }
  };
}

const pintarEstado = cuandoPinte(() => {
  if (!estado) return;
  $('#e-reloj').textContent = F.relojSim(estado.reloj);
  const falta = Math.max(0, (estado.proximoCiclo - estado.reloj) / estado.config.velocidad);
  $('#e-proximo').textContent = estado.cicloEnCurso ? `ciclo ${estado.numeroCiclo} calculando…` : `${F.horaSim(estado.proximoCiclo)} (en ${Math.ceil(falta)} s)`;
  const otras = estado.pestanas - 1;
  $('#e-rol').textContent = (rol === 'lider' ? 'líder, el motor corre aquí' : rol === 'seguidor' ? 'seguidora' : '…') +
    (otras > 0 ? ` · ${otras} pestaña${otras > 1 ? 's' : ''} más` : '');
  const c = estado.config;
  ponerSiNoFoco('#c-alimentando', c.alimentando, 'checked');
  ponerSiNoFoco('#c-tasa', c.tasa);
  $('#o-tasa').textContent = c.tasa;
  ponerSiNoFoco('#c-intervalo', c.intervalo);
  ponerSiNoFoco('#c-velocidad', c.velocidad);
  ponerSiNoFoco('#c-estrategia', c.estrategia);
  ponerSiNoFoco('#c-workers', c.workers);
  ponerSiNoFoco('#c-falla', estado.fallaPendiente || '');
  $('#b-ciclo').disabled = estado.cicloEnCurso || !estado.motorListo;
});

function ponerSiNoFoco(sel, valor, prop = 'value') {
  const el = $(sel);
  if (document.activeElement === el) return;
  if (prop === 'checked') el.checked = !!valor; else el.value = String(valor);
}

const pintarIngesta = cuandoPinte(() => {
  if (!vista) return;
  const r = vista.resumen;
  filas('#t-ing', [
    ['Recibidas por segundo', F.n(r.tasa)],
    ['En cola sin procesar', F.n(r.rezago)],
    ['Pendientes en el grafo', F.n(r.vivas)],
    ['Pares con saldo pendiente', F.n(r.paresActivos)],
    ['Duplicados descartados', F.n(r.duplicados)],
    ['Cancelaciones', `${F.n(r.cancelaciones)} (${F.n(r.cancelTardias)} tardías)`],
    ['Llegaron antes que su obligación', F.n(r.lapidas)],
    ['Reversos generados', F.n(r.reversos)],
    ['Depósitos', `${F.n(r.depositos)} · ${F.pesos(r.montoDepositos)}`],
    ['Época actual', F.n(r.epoca)],
    ['Ranuras usadas / en limbo', `${F.n(r.alto)} / ${F.n(r.limbo)}`],
  ]);
});

function filas(sel, datos, cab) {
  const h = cab ? `<thead><tr>${cab.map((c, i) => `<th class="${i ? 'n' : ''}">${c}</th>`).join('')}</tr></thead>` : '';
  $(sel).innerHTML = h + '<tbody>' + datos.map((f) => `<tr>${f.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('') + '</tbody>';
}

const pintarNodo = cuandoPinte(() => {
  const v = lienzo.sel;
  $('#n-cod').textContent = v >= 0 ? v + 1 : '—';
  $('#n-vacio').hidden = v >= 0;
  $('#n-cont').hidden = v < 0;
  if (v < 0 || !vista) return;
  const nod = vista.nodos;
  const b = reporte?.bloqueoMonto?.[v] ?? 0;
  filas('#t-nodo', [
    ['Saldo en el banco', F.pesos(nod[v * 7])],
    ['Cupo de sobregiro', F.pesos(nod[v * 7 + 1])],
    ['Posición neta', `<span class="${nod[v * 7 + 2] < 0 ? 'mal' : 'ok'}">${F.pesos(nod[v * 7 + 2])}</span>`],
    ['Por pagar', `${F.pesos(nod[v * 7 + 3])} en ${F.n(nod[v * 7 + 5])}`],
    ['Por cobrar', `${F.pesos(nod[v * 7 + 4])} en ${F.n(nod[v * 7 + 6])}`],
    ['Le faltó en el último ciclo', b > 0 ? `<span class="mal">${F.pesos(b)}</span>` : 'nada'],
  ]);
  const neto = new Map();
  const { pares, montos } = vista;
  for (let x = 0; x < pares.length; x++) {
    const k = pares[x], i = (k / N) | 0, j = k % N;
    if (i !== v && j !== v) continue;
    const m = montos[x * 3] + montos[x * 3 + 1] + montos[x * 3 + 2];
    const otra = i === v ? j : i;
    neto.set(otra, (neto.get(otra) || 0) + (i === v ? -m : m));
  }
  const top = [...neto].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  filas('#t-nodo-pares', top.map(([o, m]) => [`con ${o + 1}`, `<span class="${m < 0 ? 'mal' : 'ok'}">${m < 0 ? 'debe ' : 'le deben '}${F.pesos(Math.abs(m))}</span>`]));
});

async function pintarReporte() {
  const r = reporte;
  $('#ciclo-vacio').hidden = true;
  $('#ciclo-cont').hidden = false;
  const fallo = r.invariantes.filter((x) => !x.ok).map((x) => x.codigo);
  $('#ciclo-titulo').innerHTML = `Ciclo <b>${r.numero}</b> · corte ${F.relojSim(r.ahora)} · ${F.n(r.m)} obligaciones congeladas · estrategia ${r.estrategia} · ${r.workers} worker(s) — ` +
    (r.valido ? '<b class="ok">aplicado</b>' : `<b class="mal">no se ejecutó: falló ${fallo.join(', ')}</b>`);
  const f1 = r.fase1, s = r.resumen;
  filas('#t-fase1', [
    ['Monto bruto en la fotografía', F.pesos(f1.flujoBruto)],
    ['Eliminado por neteo bilateral', `${F.pesos(f1.eliminadoBilateral)} (${F.n(f1.paresBilaterales)} pares)`],
    ['Eliminado en circuitos', `${F.pesos(f1.eliminadoCircuitos)} (${F.n(f1.nCircuitos)} circuitos)`],
    ['Total eliminado en la fase 1', `<b>${F.pesos(f1.montoEliminado)}</b> · ${F.pct(f1.montoEliminado, f1.flujoBruto)}`],
    ['Componentes con circuitos / mayor', `${f1.sccNoTriviales} / ${f1.sccMayor} nodos · ${f1.pasadas} pasadas`],
    ['Liquidadas en el bloque compensado', `${F.n(f1.liquidadas)} (${F.n(f1.viaBilateral)} bilat. + ${F.n(f1.viaCircuito)} circ.)`],
    ['Liquidez que usó el bloque', F.pesos(f1.liquidezUsada)],
    ['Pendientes tras la compensación', F.n(f1.pendientesDespues)],
    ['Liquidado en todo el ciclo', `<b>${F.pesos(s.montoLiquidado)}</b>`],
    ['Ejecutadas / aplazadas', `${F.n(s.ejecutadas)} / ${F.n(s.aplazadas)}`],
    ['Prioridad 1 cumplidas', `${F.n(s.p1.cumplidas)} de ${F.n(s.p1.total)}`],
  ], ['Fase 1 y resultado', '']);
  await ceder();
  const t = r.tiempos;
  filas('#t-tiempos', [
    ['Congelamiento', F.ms(t.congelamiento)],
    ['Escaneo y orden en paralelo', `${F.ms(t.ordenParalelo)} (${(t.shards || []).map((x) => x + ' ms').join(' · ')})`],
    ['Fase 1 · compensación', F.ms(t.fase1)],
    ['Fase 2 · selección (3 estrategias)', F.ms(t.fase2)],
    ['Los cuatro controles', F.ms(t.invariantes)],
    ['Huella y registro', F.ms(t.auditoria)],
    ['Aplicar en el grafo', F.ms(t.aplicar)],
    ['Total', `<b class="${r.dentroPresupuesto ? 'ok' : 'mal'}">${F.ms(t.total)}</b> de 20.000 ms`],
    ['Grafo compartido (SAB)', F.bytes(r.memoria.bytesGrafo)],
    ['Se habría copiado por postMessage', `${F.bytes(r.memoria.bytesPorCiclo)} por ciclo`],
    ['Ahorrado desde que abrió', F.bytes(r.memoria.bytesAhorrados)],
  ], ['Tiempos', '']);
  filas('#t-inv', r.invariantes.map((x) => [
    `${x.codigo}`, x.nombre, x.ok ? '<span class="ok">pasa</span>' : '<span class="mal">falla</span>', F.esc(x.detalle), F.ms(x.ms),
  ]), ['', 'Control', 'Resultado', 'Detalle', 'Costo']);
  $$('#t-inv td').forEach((td) => td.classList.remove('n'));
  await ceder();

  const nombres = ['simple', 'A', 'B'].filter((k) => r.comparacion[k]);
  const col = (fn) => nombres.map((k) => fn(r.comparacion[k]));
  filas('#t-estr', [
    ['Monto liquidado', ...col((c) => F.pesos(c.montoLiquidado))],
    ['Ejecutadas', ...col((c) => F.n(c.ejecutadas))],
    ['Aplazadas', ...col((c) => F.n(c.aplazadas))],
    ['Prioridad 1 cumplidas', ...col((c) => `${F.n(c.p1.cumplidas)} / ${F.n(c.p1.total)}`)],
    ['Próximas a vencer cumplidas', ...col((c) => `${F.n(c.urgentes.cumplidas)} / ${F.n(c.urgentes.total)}`)],
    ['Cupo de sobregiro usado', ...col((c) => F.pesos(c.cupoUsado))],
    ['Pasadas sobre la cola', ...col((c) => F.n(c.pasadas))],
  ], ['', ...nombres.map((k) => ESTRATEGIAS[k] + (k === r.estrategia ? ' ✔' : ''))]);
  const A = r.comparacion.A, B = r.comparacion.B;
  if (A && B) {
    const dm = B.montoLiquidado - A.montoLiquidado, da = B.aplazadas - A.aplazadas, dc = B.cupoUsado - A.cupoUsado;
    $('#estr-dif').textContent = `B frente a A: ${dm >= 0 ? '+' : ''}${F.pesos(dm)} liquidado, ${da >= 0 ? '+' : ''}${F.n(da)} aplazadas, ` +
      `${dc >= 0 ? '+' : ''}${F.pesos(dc)} de cupo, ${B.p1.cumplidas - A.p1.cumplidas >= 0 ? '+' : ''}${B.p1.cumplidas - A.p1.cumplidas} de prioridad 1.`;
  }
  await ceder();
  filas('#t-bloq', r.bloqueadores.map((b) => [
    `<a href="#" data-coop="${b.cooperativa}">${b.cooperativa}</a>`, F.n(b.aplazadas), F.pesos(b.montoAplazado), F.pesos(b.disponible), `<span class="mal">${F.pesos(b.faltante)}</span>`,
  ]), ['Cooperativa', 'Aplazadas', 'Monto aplazado', 'Tenía disponible', 'Le faltó']);
  const cs = r.circuitos || [];
  filas('#t-circ', cs.map((c, i) => [
    i + 1, c.nodos.length, F.esc(c.nodos.slice(0, 6).join(' → ') + (c.nodos.length > 6 ? ' …' : '') + ' → ' + c.nodos[0]), F.pesos(c.monto),
  ]), ['#', 'Coops', 'Recorrido', 'Cancelado por tramo']);
  $$('#t-circ tbody tr').forEach((tr, i) => tr.addEventListener('click', () => elegirCircuito(i)));
  circuitoSel = -1;
  lienzo.ponerCircuito(null);
  pintarPasos();
}

function elegirCircuito(i) {
  circuitoSel = i; pasoCirc = 0;
  $$('#t-circ tbody tr').forEach((tr, k) => tr.classList.toggle('activa', k === i));
  lienzo.ponerCircuito(reporte.circuitos[i], 0);
  pintarPasos();
}

function pintarPasos() {
  const c = circuitoSel >= 0 ? reporte.circuitos[circuitoSel] : null;
  $('#b-c-ant').disabled = $('#b-c-sig').disabled = $('#b-c-quitar').disabled = !c;
  if (!c) { $('#circ-pasos').innerHTML = ''; $('#circ-desc').textContent = 'Elija un circuito de la lista para recorrerlo.'; return; }
  const L = c.nodos.length;
  $('#circ-desc').innerHTML = `Circuito de ${L} cooperativas. En cada tramo se canceló ${F.pesos(c.monto)} sin mover dinero (${F.pesos(c.monto * L)} en total).`;
  $('#circ-pasos').innerHTML = c.nodos.map((v, k) =>
    `<li class="${k === pasoCirc ? 'actual' : ''}">${v} le debía a ${c.nodos[(k + 1) % L]}: se cancelan ${F.pesos(c.monto)}</li>`).join('');
  $('#circ-pasos li.actual')?.scrollIntoView({ block: 'nearest' });
}

function pintarSims() {
  const lista = [...sims.values()].sort((a, b) => (b.creada || 0) - (a.creada || 0));
  filas('#t-sims', lista.map((s) => {
    let res = '';
    if (s.estado === 'terminada') {
      const b = s.base, e = s.esc;
      const dif = (a, z, fmt) => { const d = z - a; return `${d >= 0 ? '+' : ''}${fmt(d)}`; };
      res = `liquidado ${dif(b.montoLiquidado, e.montoLiquidado, F.pesos)} · aplazadas ${dif(b.aplazadas, e.aplazadas, F.n)} · P1 ${dif(b.p1.cumplidas, e.p1.cumplidas, F.n)} · cupo ${dif(b.cupoUsado, e.cupoUsado, F.pesos)}`;
      if (s.escenario.tipo === 'diferibles') {
        const lib = e.noDiferible - b.noDiferible;
        res += lib >= 0 ? ` · <b>se liberan ${F.pesos(lib)} para P1 y P2</b>`
          : ` · <b>P1 y P2 liquidan ${F.pesos(-lib)} menos</b>: las diferibles ayudaban a cerrar circuitos`;
      }
      res += `<br><span class="nota">${F.n(s.m)} obligaciones · ${F.ms(s.ms)}${s.pausado > 1 ? ` (en pausa ${F.ms(s.pausado)} por el ciclo oficial)` : ''}</span>`;
    } else if (s.estado === 'error') res = `<span class="mal">${F.esc(s.error)}</span>`;
    const activa = ['pedida', 'en cola', 'corriendo', 'en pausa'].includes(s.estado);
    const est = s.estado === 'cancelada' ? '<span class="aviso">cancelada</span>' : s.estado === 'en pausa' ? `<span class="aviso">en pausa</span> (${s.paso})` :
      s.estado === 'corriendo' ? `corriendo: ${s.paso}` : s.estado;
    return [s.id.replace('sim', '#'), F.esc(s.descripcion || describirEscenario(s.escenario)), est, res,
      activa ? `<button type="button" class="mini" data-cancelar="${s.id}">Cancelar</button>` : ''];
  }), ['', 'Escenario', 'Estado', 'Resultado frente al ciclo sin cambios', '']);
  $$('#t-sims td').forEach((td) => td.classList.remove('n'));
}

function describirEscenario(e) {
  if (!e) return '';
  if (e.tipo === 'deposito') return `Cooperativa ${e.cooperativa} deposita ${F.pesos(e.monto)}`;
  if (e.tipo === 'cupo') return `Cupo +${F.pesos(e.monto)} a las 5 más comprometidas`;
  return 'Aplazar diferibles';
}

function pintarDeterminismo(d) {
  const filasHtml = d.resultados.map((r) => `<tr><td>${r.llegada}</td><td class="n">${r.K}</td><td class="n">${F.n(r.m)}</td><td class="n">${F.n(r.duplicados)}</td><td class="n">${F.pesos(r.monto)}</td><td><code class="huella">${r.huella.slice(0, 24)}…</code></td><td class="n">${F.ms(r.ms)}</td></tr>`).join('');
  $('#det').innerHTML = `<p>Fuente: ${F.esc(d.fuente)} · ${F.n(d.mensajes)} mensajes · ${d.iguales ? '<span class="ok">las tres huellas son idénticas</span>' : '<span class="mal">las huellas difieren</span>'}` +
    (d.coincideOficial === true ? ' · coincide con la huella del ciclo oficial' : d.coincideOficial === false ? ' · <span class="aviso">no coincide con el ciclo oficial</span>' : '') + '</p>' +
    `<table class="datos"><thead><tr><th>Llegada</th><th class="n">Workers</th><th class="n">Obligaciones</th><th class="n">Duplicados</th><th class="n">Liquidado</th><th>Huella SHA-256</th><th class="n">Tiempo</th></tr></thead><tbody>${filasHtml}</tbody></table>`;
}

function pintarReproduccion(d) {
  $('#repro').innerHTML = d.error ? `<p class="mal">${F.esc(d.error)}</p>` :
    `<p>${d.coincide ? '<span class="ok">Reproducido: mismo resultado</span>' : `<span class="mal">No coincide (${d.diferencias} diferencias)</span>`} · ${F.n(d.m)} obligaciones · ${F.ms(d.ms)}<br>` +
    `<code class="huella">original ${d.huellaOriginal}</code><br><code class="huella">ahora&nbsp;&nbsp;&nbsp; ${d.huellaReproducida}</code></p>`;
}

function pintarHistorial() {
  filas('#t-hist', historial.slice().reverse().map((h) => [h.numero, F.n(h.m), F.ms(h.total), h.valido ? '<span class="ok">aplicado</span>' : '<span class="mal">rechazado</span>', `<code class="huella">${h.huella.slice(0, 16)}</code>`]),
    ['Ciclo', 'Obligaciones', 'Duración', 'Resultado', 'Huella']);
}

function pintarRendimiento() {
  const i = inp();
  const p = i.peor;
  filas('#t-inp', [
    ['INP (p98 de las interacciones)', i.valor == null ? 'sin interacciones aún' : `<b class="${i.valor <= 200 ? 'ok' : 'mal'}">${F.ms(i.valor)}</b>`],
    ['Interacciones medidas', F.n(i.n)],
    ['Peor: elemento', p ? F.esc(`${p.nombre} en ${p.objetivo}`) : '—'],
    ['· retraso de entrada', p ? F.ms(p.retraso) : '—'],
    ['· procesamiento', p ? F.ms(p.proceso) : '—'],
    ['· presentación', p ? F.ms(p.presentacion) : '—'],
    ['Cuadro del grafo', `${F.ms(lienzo.msCuadro)} (capa ${F.ms(lienzo.msCapa)}, ${F.n(lienzo.dibujadas)} aristas)`],
  ], ['Interacción', '']);
  const lt = tareasLargas();
  const r = vista?.resumen;
  filas('#t-mem', [
    ['Obligaciones ingeridas por segundo', r ? F.n(r.tasa) : '—'],
    ['Tareas largas (>50 ms) en el hilo principal', `${F.n(lt.total)} · ${F.ms(lt.ms)}`],
    ['Memoria medida', memoriaUsada ? F.bytes(memoriaUsada) : '—'],
    ['Grafo en SharedArrayBuffer', reporte ? F.bytes(reporte.memoria.bytesGrafo) : '—'],
    ['Núcleos lógicos', navigator.hardwareConcurrency || '—'],
  ], ['Hilo principal', '']);
  filas('#t-lt', lt.marcos.length ? lt.marcos.map((m) => [F.ms(m.inicio), F.ms(m.duracion), F.ms(m.bloqueo), F.esc(m.guion || '')])
    : lt.recientes.map((m) => [F.ms(m.inicio), F.ms(m.duracion), '—', F.esc(m.origen || '')]), ['Inicio', 'Duración', 'Bloqueo', 'Script']);
}

setInterval(() => { if (!$('#p-rendimiento').hidden) pintarRendimiento(); }, 1000);
setInterval(async () => { memoriaUsada = await medirMemoria(); }, 15000);

function swListo() {
  if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise((ok) => {
    navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true });
    setTimeout(ok, 3000);
  });
}

const conSW = () => !!navigator.serviceWorker?.controller;

async function revisarSync() {
  if (!conSW()) { $('#e-red').innerHTML = navigator.onLine ? '<span class="ok">en línea</span>' : '<span class="mal">sin conexión</span>'; return; }
  try {
    const r = await fetch('/api/sincronizacion');
    sync = await r.json();
  } catch { sync = null; }
  const linea = navigator.onLine ? '<span class="ok">en línea</span>' : '<span class="mal">sin conexión</span>';
  let det = '';
  if (sync) det = sync.lotesPendientes ? ` · <span class="aviso">${F.n(sync.mensajesPendientes)} obligaciones por sincronizar</span>` : ' · al día';
  $('#e-red').innerHTML = linea + det;
}
setInterval(revisarSync, 3000);
revisarSync();
addEventListener('online', () => {
  anotar('Volvió la conexión: sincronizando lo pendiente');
  navigator.serviceWorker?.controller?.postMessage({ tipo: 'online' });
  fetch('/api/sincronizacion', { method: 'POST' }).then(revisarSync).catch(() => {});
});
addEventListener('offline', () => { anotar('Se perdió la conexión: lo recibido queda guardado localmente'); revisarSync(); });

function anotar(texto) {
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString('es-CO', { hour12: false });
  li.innerHTML = `<time>${t}</time>${F.esc(texto)}`;
  const ul = $('#bitacora');
  ul.prepend(li);
  while (ul.children.length > 80) ul.lastChild.remove();
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

$('#c-alimentando').addEventListener('change', (e) => cmd('config', { alimentando: e.target.checked }));
$('#c-tasa').addEventListener('input', (e) => { $('#o-tasa').textContent = e.target.value; });
$('#c-tasa').addEventListener('change', (e) => cmd('config', { tasa: Number(e.target.value) }));
$$('[data-tasa]').forEach((b) => b.addEventListener('click', () => cmd('config', { tasa: Number(b.dataset.tasa), alimentando: true })));
$('#b-rafaga').addEventListener('click', () => cmd('rafaga', { n: 13000 }));
$('#f-archivo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) cmd('archivo', { archivo: f }); e.target.value = ''; });
$('#c-intervalo').addEventListener('change', (e) => cmd('config', { intervalo: Number(e.target.value) }));
$('#c-velocidad').addEventListener('change', (e) => cmd('config', { velocidad: Number(e.target.value) }));
$('#c-estrategia').addEventListener('change', (e) => cmd('config', { estrategia: e.target.value }));
$('#c-workers').addEventListener('change', (e) => cmd('config', { workers: Number(e.target.value) }));
$('#c-falla').addEventListener('change', (e) => cmd('falla', { invariante: e.target.value }));
$('#b-ciclo').addEventListener('click', () => cmd('ciclo'));

$$('[data-sim]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.sim;
  let escenario;
  if (t === 'deposito') escenario = { tipo: 'deposito', cooperativa: Math.min(400, Math.max(1, Number($('#s-coop').value) || 118)), monto: Math.round((Number($('#s-monto').value) || 400) * 1e6) };
  else if (t === 'cupo') escenario = { tipo: 'cupo', cuantas: 5, monto: Math.round((Number($('#s-cupo').value) || 200) * 1e6) };
  else escenario = { tipo: 'diferibles' };
  cmd('simular', { escenario });
  abrirPestana('simulaciones');
}));
$('#t-sims').addEventListener('pointerdown', (e) => {
  const id = e.target.dataset?.cancelar;
  if (id) { e.target.disabled = true; cmd('cancelarSim', { id }); }
});

$$('.f-prio').forEach((c) => c.addEventListener('change', () => {
  lienzo.ponerFiltro({ prios: $$('.f-prio').filter((x) => x.checked).map((x) => Number(x.value)) });
}));
$('#f-min').addEventListener('change', (e) => lienzo.ponerFiltro({ minimo: Number(e.target.value) }));
$('#f-bloq').addEventListener('change', (e) => lienzo.ponerFiltro({ soloBloq: e.target.checked }));
$('#b-centrar').addEventListener('click', () => lienzo.centrar());
$('#n-buscar').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (v >= 1 && v <= 400) lienzo.seleccionar(v - 1);
});
$('#t-bloq').addEventListener('click', (e) => {
  const c = e.target.dataset?.coop;
  if (c) { e.preventDefault(); lienzo.seleccionar(Number(c) - 1); }
});

$('#b-c-ant').addEventListener('click', () => { const L = reporte.circuitos[circuitoSel].nodos.length; pasoCirc = (pasoCirc - 1 + L) % L; lienzo.ponerCircuito(reporte.circuitos[circuitoSel], pasoCirc); pintarPasos(); });
$('#b-c-sig').addEventListener('click', () => { const L = reporte.circuitos[circuitoSel].nodos.length; pasoCirc = (pasoCirc + 1) % L; lienzo.ponerCircuito(reporte.circuitos[circuitoSel], pasoCirc); pintarPasos(); });
$('#b-c-quitar').addEventListener('click', () => { circuitoSel = -1; lienzo.ponerCircuito(null); $$('#t-circ tbody tr').forEach((tr) => tr.classList.remove('activa')); pintarPasos(); });

$('#b-auditoria').addEventListener('click', () => cmd('auditoria'));
$('#f-reproducir').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { $('#repro').innerHTML = '<p class="nota">Reproduciendo…</p>'; cmd('reproducir', { archivo: f }); }
  e.target.value = '';
});
$('#b-det').addEventListener('click', () => { $('#det').innerHTML = '<p class="nota">Preparando…</p>'; cmd('determinismo', {}); });
$('#f-det').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { $('#det').innerHTML = '<p class="nota">Leyendo archivo…</p>'; cmd('determinismo', { archivo: f }); }
  e.target.value = '';
});

function abrirPestana(p) {
  $$('.pestanas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === p)));
  $$('.panel').forEach((x) => { x.hidden = x.id !== 'p-' + p; });
  if (p === 'rendimiento') pintarRendimiento();
}
$$('.pestanas button').forEach((b) => b.addEventListener('click', () => abrirPestana(b.dataset.p)));
