const interacciones = new Map();
const largas = [];
const marcos = [];
let peor = null;
let totalLargas = 0, msLargas = 0;

function registrarEvento(e) {
  if (!e.interactionId) return;
  const previa = interacciones.get(e.interactionId);
  if (previa && previa.duration >= e.duration) return;
  const d = {
    id: e.interactionId,
    nombre: e.name,
    objetivo: describir(e.target),
    duration: e.duration,
    retraso: e.processingStart - e.startTime,
    proceso: e.processingEnd - e.processingStart,
    presentacion: Math.max(0, e.startTime + e.duration - e.processingEnd),
    cuando: performance.now(),
  };
  interacciones.set(e.interactionId, d);
  if (interacciones.size > 500) interacciones.delete(interacciones.keys().next().value);
}

function describir(t) {
  if (!t) return '';
  if (t.id) return '#' + t.id;
  const txt = (t.textContent || '').trim().slice(0, 24);
  return t.tagName.toLowerCase() + (txt ? ` "${txt}"` : '');
}

export function iniciarMetricas() {
  try {
    new PerformanceObserver((l) => l.getEntries().forEach(registrarEvento))
      .observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch { }
  try {
    new PerformanceObserver((l) => l.getEntries().forEach(registrarEvento)).observe({ type: 'first-input', buffered: true });
  } catch { }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        totalLargas++; msLargas += e.duration;
        largas.push({ inicio: e.startTime, duracion: e.duration, origen: e.attribution?.[0]?.containerType || e.name });
        if (largas.length > 30) largas.shift();
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const guion = e.scripts?.slice().sort((a, b) => b.duration - a.duration)[0];
        marcos.push({ inicio: e.startTime, duracion: e.duration, bloqueo: e.blockingDuration, guion: guion ? (guion.sourceFunctionName || guion.invoker || '') : '' });
        if (marcos.length > 30) marcos.shift();
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { }
}

export function inp() {
  const lista = [...interacciones.values()].sort((a, b) => b.duration - a.duration);
  if (!lista.length) return { valor: null, n: 0, peor: null };
  const k = Math.min(lista.length - 1, Math.floor(lista.length / 50));
  peor = lista[k];
  return { valor: peor.duration, n: lista.length, peor, ultimas: [...interacciones.values()].slice(-6).reverse() };
}

export function tareasLargas() {
  return { total: totalLargas, ms: msLargas, recientes: largas.slice(-10).reverse(), marcos: marcos.slice(-10).reverse() };
}

export async function memoria() {
  if (crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
    try { return (await performance.measureUserAgentSpecificMemory()).bytes; } catch { }
  }
  return performance.memory?.usedJSHeapSize ?? null;
}
