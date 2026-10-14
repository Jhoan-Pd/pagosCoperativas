const VERSION = 'cc-v3';
const ARCHIVOS = [
  '/', '/index.html', '/estilos.css', '/manifest.webmanifest',
  '/src/main.js', '/src/hub.js', '/src/ui/lienzo.js', '/src/ui/metricas.js', '/src/ui/formato.js', '/src/ui/ceder.js',
  '/src/workers/ingesta.js', '/src/workers/calculo.js', '/src/workers/shard.js', '/src/workers/simulacion.js',
  '/src/core/grafo.js', '/src/core/ids.js', '/src/core/aleatorio.js', '/src/core/generador.js', '/src/core/ingestor.js',
  '/src/core/orden.js', '/src/core/compensacion.js', '/src/core/seleccion.js', '/src/core/invariantes.js',
  '/src/core/ciclo.js', '/src/core/auditoria.js', '/src/core/determinismo.js', '/src/core/mensajes.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

function aislar(r) {
  if (!r || r.status === 0 || r.type === 'opaque') return r;
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/sync') return;
    e.respondWith(api(e.request, url));
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(estatico(e.request));
});

async function estatico(req) {
  const cache = await caches.open(VERSION);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
    if (r.ok) cache.put(req, r.clone());
    return aislar(r);
  } catch {
    const c = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('/index.html') : null);
    if (c) return aislar(c);
    return new Response('Sin conexión', { status: 503 });
  }
}

let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((ok, mal) => {
    const r = indexedDB.open('camara', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('diario', { keyPath: 'clave' });
      d.createObjectStore('estado');
      d.createObjectStore('salida', { autoIncrement: true });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return _db;
}

async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((ok, mal) => {
    const t = d.transaction(store, modo);
    let res;
    Promise.resolve(fn(t.objectStore(store))).then((x) => { res = x; });
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error);
  });
}

const pedir = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function api(req, url) {
  const ruta = url.pathname;
  if (ruta === '/api/recibidas' && req.method === 'POST') {
    const cuerpo = await req.text();
    const { lote, sesion, mensajes } = JSON.parse(cuerpo);
    const reg = { clave: `${sesion}:${String(lote).padStart(9, '0')}`, lote, sesion, n: mensajes.length, cuerpo, sincronizado: false };
    await tx('diario', 'readwrite', (s) => s.put(reg));
    const ok = await subir({ tipo: 'recibidas', lote, sesion, n: mensajes.length, mensajes });
    if (ok) { reg.sincronizado = true; await tx('diario', 'readwrite', (s) => s.put(reg)); }
    else programarSync();
    return json({ ok: true, sincronizado: ok });
  }
  if (ruta === '/api/recibidas' && req.method === 'GET') {
    const todos = await tx('diario', 'readonly', (s) => pedir(s.getAll()));
    return json(todos.map((r) => ({ lote: r.lote, sesion: r.sesion, mensajes: JSON.parse(r.cuerpo).mensajes })));
  }
  if (ruta === '/api/estado' && req.method === 'POST') {
    const buffer = await req.arrayBuffer();
    const meta = {
      hastaLote: Number(req.headers.get('x-hasta-lote') || 0), sesion: req.headers.get('x-sesion') || '',
      ciclo: Number(req.headers.get('x-ciclo') || 0), fecha: Date.now(), bytes: buffer.byteLength,
    };
    await tx('estado', 'readwrite', (s) => { s.put(buffer, 'ultimo'); s.put(meta, 'meta'); });
    await tx('diario', 'readwrite', async (s) => {
      const todos = await pedir(s.getAll());
      for (const r of todos) if (r.sincronizado && r.sesion === meta.sesion && r.lote <= meta.hastaLote) s.delete(r.clave);
    });
    const ok = await subir({ tipo: 'estado', ...meta });
    if (!ok) { await tx('salida', 'readwrite', (s) => s.add({ tipo: 'estado', ...meta })); programarSync(); }
    return json({ ok: true, sincronizado: ok });
  }
  if (ruta === '/api/estado' && req.method === 'GET') {
    const buf = await tx('estado', 'readonly', (s) => pedir(s.get('ultimo')));
    if (!buf) return new Response(null, { status: 204 });
    return new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  if (ruta === '/api/sincronizacion') {
    if (req.method === 'POST') await vaciar();
    const diario = await tx('diario', 'readonly', (s) => pedir(s.getAll()));
    const salida = await tx('salida', 'readonly', (s) => pedir(s.count()));
    const meta = await tx('estado', 'readonly', (s) => pedir(s.get('meta')));
    return json({
      lotesPendientes: diario.filter((r) => !r.sincronizado).length,
      mensajesPendientes: diario.filter((r) => !r.sincronizado).reduce((a, r) => a + r.n, 0),
      lotesGuardados: diario.length, salidaPendiente: salida, ultimoEstado: meta || null,
    });
  }
  if (ruta === '/api/olvidar' && req.method === 'POST') {
    await tx('diario', 'readwrite', (s) => s.clear());
    await tx('estado', 'readwrite', (s) => s.clear());
    await tx('salida', 'readwrite', (s) => s.clear());
    return json({ ok: true });
  }
  return json({ error: 'ruta desconocida' }, 404);
}

async function subir(cuerpo) {
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return r.ok || r.status === 404 || r.status === 405;
  } catch {
    return false;
  }
}

let vaciando = null;
async function vaciar() {
  if (vaciando) return vaciando;
  vaciando = (async () => {
    const diario = await tx('diario', 'readonly', (s) => pedir(s.getAll()));
    for (const r of diario.filter((x) => !x.sincronizado)) {
      const { mensajes } = JSON.parse(r.cuerpo);
      if (!(await subir({ tipo: 'recibidas', lote: r.lote, sesion: r.sesion, n: r.n, mensajes }))) return false;
      r.sincronizado = true;
      await tx('diario', 'readwrite', (s) => s.put(r));
    }
    const salida = await tx('salida', 'readonly', async (s) => {
      const claves = await pedir(s.getAllKeys());
      const valores = await pedir(s.getAll());
      return claves.map((k, i) => [k, valores[i]]);
    });
    for (const [k, v] of salida) {
      if (!(await subir(v))) return false;
      await tx('salida', 'readwrite', (s) => s.delete(k));
    }
    return true;
  })();
  try { return await vaciando; } finally { vaciando = null; }
}

function programarSync() {
  if (self.registration.sync) self.registration.sync.register('sincronizar').catch(() => {});
}

self.addEventListener('sync', (e) => {
  if (e.tag === 'sincronizar') e.waitUntil(vaciar().then((ok) => { if (!ok) throw new Error('sin red'); }));
});

self.addEventListener('message', (e) => {
  if (e.data?.tipo === 'online') e.waitUntil(vaciar());
});
