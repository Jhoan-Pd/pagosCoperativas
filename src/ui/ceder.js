const canal = new MessageChannel();
const cola = [];
canal.port1.onmessage = () => { const f = cola.shift(); if (f) f(); };

export function ceder() {
  if (globalThis.scheduler?.yield) return scheduler.yield();
  return new Promise((r) => { cola.push(r); canal.port2.postMessage(0); });
}

export function cuandoPinte(fn) {
  let pedido = false;
  return () => {
    if (pedido) return;
    pedido = true;
    requestAnimationFrame(() => { pedido = false; fn(); });
  };
}
