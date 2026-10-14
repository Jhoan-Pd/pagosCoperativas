import { N } from '../core/grafo.js';
import { pesos, n as num } from './formato.js';

const COLOR_CUBETA = ['rgba(70,100,140,0.06)', 'rgba(70,100,140,0.10)', 'rgba(60,90,135,0.16)', 'rgba(50,80,130,0.25)', 'rgba(40,70,125,0.38)', 'rgba(30,60,115,0.55)'];
const ANCHO_CUBETA = [0.5, 0.6, 0.8, 1, 1.4, 2];

export class Lienzo {
  constructor(canvas, tip, alSeleccionar) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tip;
    this.alSeleccionar = alSeleccionar;
    this.capa = document.createElement('canvas');
    this.vista = null;
    this.esHub = new Uint8Array(N);
    this.bloqueo = new Float64Array(N);
    this.filtro = { prios: [1, 2, 3], minimo: 1e7, soloBloq: false };
    this.sel = -1;
    this.hover = -1;
    this.circuito = null;
    this.paso = 0;
    this.esc = 1; this.dx = 0; this.dy = 0;
    this.sucia = true;
    this.dibujadas = 0;
    this.msCapa = 0;
    this.msCuadro = 0;
    this.posiciones();
    this.eventos();
    new ResizeObserver(() => this.medir()).observe(canvas);
    this.medir();
    const bucle = () => { this.cuadro(); requestAnimationFrame(bucle); };
    requestAnimationFrame(bucle);
  }

  ponerHubs(esHub) { this.esHub = esHub; this.posiciones(); this.sucia = true; }

  posiciones() {
    this.px = new Float32Array(N); this.py = new Float32Array(N);
    const hubs = [], otros = [];
    for (let v = 0; v < N; v++) (this.esHub[v] ? hubs : otros).push(v);
    hubs.forEach((v, i) => {
      const a = (i / hubs.length) * Math.PI * 2 - Math.PI / 2;
      this.px[v] = Math.cos(a) * 0.3; this.py[v] = Math.sin(a) * 0.3;
    });
    otros.forEach((v, i) => {
      const a = (i / otros.length) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 0.86 : 0.93;
      this.px[v] = Math.cos(a) * r; this.py[v] = Math.sin(a) * r;
    });
  }

  medir() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.capa.width = this.c.width; this.capa.height = this.c.height;
    this.sucia = true;
  }

  aPantalla(v) {
    const s = Math.min(this.w, this.h) * 0.47 * this.esc;
    return [this.w / 2 + this.dx + this.px[v] * s, this.h / 2 + this.dy + this.py[v] * s];
  }

  actualizar(vista) { this.vista = vista; this.sucia = true; }
  ponerBloqueo(b) {
    this.bloqueo = new Float64Array(N);
    if (b) {
      const orden = Array.from(b).filter((x) => x > 0).sort((x, y) => y - x);
      const corte = orden[Math.min(orden.length, 25) - 1] ?? Infinity;
      for (let v = 0; v < N; v++) if (b[v] >= corte) this.bloqueo[v] = b[v];
    }
    this.sucia = true;
  }
  ponerFiltro(f) { Object.assign(this.filtro, f); this.sucia = true; }
  seleccionar(v) { this.sel = v; this.alSeleccionar?.(v); }
  ponerCircuito(c, paso = 0) { this.circuito = c; this.paso = paso; }
  centrar() { this.esc = 1; this.dx = 0; this.dy = 0; this.sucia = true; }

  montoPar(x) {
    const m = this.vista.montos;
    let t = 0;
    for (const p of this.filtro.prios) t += m[x * 3 + p - 1];
    return t;
  }

  dibujarCapa() {
    const t = performance.now();
    const ctx = this.capa.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.capa.width, this.capa.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    let dibujadas = 0;
    if (this.vista) {
      const { pares } = this.vista;
      const cubetas = ANCHO_CUBETA.map(() => new Path2D());
      const { minimo, soloBloq } = this.filtro;
      for (let x = 0; x < pares.length; x++) {
        const k = pares[x];
        const i = (k / N) | 0, j = k % N;
        if (soloBloq && !(this.bloqueo[i] > 0 || this.bloqueo[j] > 0)) continue;
        const m = this.montoPar(x);
        if (m <= 0 || m < minimo) continue;
        const [x1, y1] = this.aPantalla(i), [x2, y2] = this.aPantalla(j);
        if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > this.w && x2 > this.w) || (y1 > this.h && y2 > this.h)) continue;
        const largo = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ox = (-(y2 - y1) / largo) * 1.5, oy = ((x2 - x1) / largo) * 1.5;
        const b = Math.max(0, Math.min(5, Math.floor(Math.log10(m)) - 5));
        cubetas[b].moveTo(x1 + ox, y1 + oy);
        cubetas[b].lineTo(x2 + ox, y2 + oy);
        dibujadas++;
      }
      for (let b = 0; b < cubetas.length; b++) {
        ctx.strokeStyle = COLOR_CUBETA[b];
        ctx.lineWidth = ANCHO_CUBETA[b];
        ctx.stroke(cubetas[b]);
      }
    }
    this.dibujadas = dibujadas;
    this.msCapa = performance.now() - t;
    this.sucia = false;
  }

  cuadro() {
    const t = performance.now();
    if (this.sucia) this.dibujarCapa();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.c.width, this.c.height);
    ctx.drawImage(this.capa, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.sel >= 0 && this.vista) this.aristasDe(this.sel);
    this.nodos();
    if (this.circuito) this.dibujarCircuito();
    this.msCuadro = performance.now() - t;
  }

  aristasDe(v) {
    const ctx = this.ctx;
    const { pares } = this.vista;
    ctx.lineWidth = 1.2;
    const salida = new Path2D(), entrada = new Path2D();
    for (let x = 0; x < pares.length; x++) {
      const k = pares[x];
      const i = (k / N) | 0, j = k % N;
      if (i !== v && j !== v) continue;
      if (this.montoPar(x) <= 0) continue;
      const [x1, y1] = this.aPantalla(i), [x2, y2] = this.aPantalla(j);
      (i === v ? salida : entrada).moveTo(x1, y1);
      (i === v ? salida : entrada).lineTo(x2, y2);
    }
    ctx.strokeStyle = 'rgba(196,106,60,0.55)'; ctx.stroke(salida);
    ctx.strokeStyle = 'rgba(61,122,179,0.55)'; ctx.stroke(entrada);
  }

  nodos() {
    const ctx = this.ctx;
    const nod = this.vista?.nodos;
    let maxNeta = 1;
    if (nod) for (let v = 0; v < N; v++) maxNeta = Math.max(maxNeta, Math.abs(nod[v * 7 + 2]));
    for (let v = 0; v < N; v++) {
      const [x, y] = this.aPantalla(v);
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) continue;
      const r = (this.esHub[v] ? 5 : 2.8) * Math.min(2.2, Math.sqrt(this.esc));
      let color = '#9aa0a6';
      if (nod) {
        const neta = nod[v * 7 + 2];
        const f = Math.min(1, Math.sqrt(Math.abs(neta) / maxNeta) + 0.25);
        color = neta >= 0 ? `rgba(61,122,179,${f})` : `rgba(196,106,60,${f})`;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (this.bloqueo[v] > 0) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#b3261e'; ctx.stroke(); }
      if (v === this.sel || v === this.hover) {
        ctx.lineWidth = 2; ctx.strokeStyle = '#1f2328';
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (this.sel >= 0) {
      const [x, y] = this.aPantalla(this.sel);
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#1f2328';
      ctx.fillText(String(this.sel + 1), x + 8, y - 6);
    }
  }

  dibujarCircuito() {
    const ctx = this.ctx;
    const nodos = this.circuito.nodos.map((c) => c - 1);
    const L = nodos.length;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(47,125,50,0.5)';
    ctx.beginPath();
    for (let t = 0; t <= L; t++) {
      const [x, y] = this.aPantalla(nodos[t % L]);
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const a = nodos[this.paso % L], b = nodos[(this.paso + 1) % L];
    const [x1, y1] = this.aPantalla(a), [x2, y2] = this.aPantalla(b);
    ctx.lineWidth = 4; ctx.strokeStyle = '#2f7d32';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = '#2f7d32';
    ctx.beginPath();
    ctx.moveTo(x2 - Math.cos(ang) * 6, y2 - Math.sin(ang) * 6);
    ctx.lineTo(x2 - Math.cos(ang - 0.4) * 16, y2 - Math.sin(ang - 0.4) * 16);
    ctx.lineTo(x2 - Math.cos(ang + 0.4) * 16, y2 - Math.sin(ang + 0.4) * 16);
    ctx.fill();
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    nodos.forEach((v, i) => {
      const [x, y] = this.aPantalla(v);
      ctx.fillStyle = i === this.paso % L ? '#2f7d32' : '#444';
      ctx.fillText(`${i + 1}·${v + 1}`, x + 6, y + 14);
    });
  }

  cercano(mx, my) {
    let mejor = -1, d2 = 100;
    for (let v = 0; v < N; v++) {
      const [x, y] = this.aPantalla(v);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < d2) { d2 = d; mejor = v; }
    }
    return mejor;
  }

  eventos() {
    let arrastre = null, movio = false;
    let pendiente = null;
    this.c.addEventListener('mousedown', (e) => { arrastre = [e.clientX, e.clientY, this.dx, this.dy]; movio = false; });
    window.addEventListener('mouseup', () => { arrastre = null; });
    this.c.addEventListener('mousemove', (e) => {
      if (arrastre) {
        const ddx = e.clientX - arrastre[0], ddy = e.clientY - arrastre[1];
        if (Math.abs(ddx) + Math.abs(ddy) > 3) movio = true;
        this.dx = arrastre[2] + ddx; this.dy = arrastre[3] + ddy;
        this.sucia = true;
        return;
      }
      const r = this.c.getBoundingClientRect();
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = null;
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        this.hover = this.cercano(mx, my);
        this.mostrarTip(mx, my);
      });
    });
    this.c.addEventListener('mouseleave', () => { this.hover = -1; this.tip.hidden = true; });
    this.c.addEventListener('click', (e) => {
      if (movio) return;
      const r = this.c.getBoundingClientRect();
      const v = this.cercano(e.clientX - r.left, e.clientY - r.top);
      this.seleccionar(v === this.sel ? -1 : v);
    });
    this.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.c.getBoundingClientRect();
      const mx = e.clientX - r.left - this.w / 2 - this.dx, my = e.clientY - r.top - this.h / 2 - this.dy;
      const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const nuevo = Math.max(0.5, Math.min(12, this.esc * f));
      const k = nuevo / this.esc;
      this.dx -= mx * (k - 1); this.dy -= my * (k - 1);
      this.esc = nuevo;
      this.sucia = true;
    }, { passive: false });
  }

  mostrarTip(mx, my) {
    const v = this.hover;
    if (v < 0 || !this.vista) { this.tip.hidden = true; return; }
    const nod = this.vista.nodos;
    const b = this.bloqueo[v];
    this.tip.innerHTML = `<b>Cooperativa ${v + 1}</b>${this.esHub[v] ? ' · concentradora' : ''}<br>` +
      `posición neta ${pesos(nod[v * 7 + 2])}<br>saldo ${pesos(nod[v * 7])} · cupo ${pesos(nod[v * 7 + 1])}<br>` +
      `${num(nod[v * 7 + 5])} por pagar · ${num(nod[v * 7 + 6])} por cobrar` +
      (b > 0 ? `<br><span class="mal">le faltaron ${pesos(b)}</span>` : '');
    this.tip.hidden = false;
    const x = Math.min(mx + 14, this.w - 230);
    this.tip.style.left = x + 'px';
    this.tip.style.top = Math.min(my + 12, this.h - 80) + 'px';
  }
}
