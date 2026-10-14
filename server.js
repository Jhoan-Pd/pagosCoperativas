import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const puerto = Number(process.env.PORT || 5173);
const tipos = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jsonl': 'application/x-ndjson',
};
const cabeceras = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-cache',
};

let recibidos = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/sync') {
    let n = 0;
    req.on('data', (c) => { n += c.length; });
    req.on('end', () => {
      recibidos++;
      res.writeHead(200, { 'Content-Type': 'application/json', ...cabeceras });
      res.end(JSON.stringify({ ok: true, bytes: n, recibidos }));
    });
    return;
  }
  let ruta = decodeURIComponent(url.pathname);
  if (ruta === '/') ruta = '/index.html';
  const archivo = path.normalize(path.join(raiz, ruta));
  if (!archivo.startsWith(raiz) || ruta.includes('/node_modules/') || ruta.startsWith('/.git')) {
    res.writeHead(403); res.end(); return;
  }
  fs.stat(archivo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, cabeceras); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream', ...cabeceras });
    fs.createReadStream(archivo).pipe(res);
  });
}).listen(puerto, () => {
  console.log(`Cámara de compensación en http://localhost:${puerto}`);
});
