export function mulberry32(semilla) {
  let a = semilla >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.entero = (min, max) => min + Math.floor(f() * (max - min + 1));
  f.uniforme = (min, max) => min + f() * (max - min);
  f.normal = () => {
    let u = 0; while (u === 0) u = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f());
  };
  f.elegir = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

export function barajar(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
