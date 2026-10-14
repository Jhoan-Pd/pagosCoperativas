# Análisis algorítmico y decisiones de diseño

Las cifras son de la prueba de carga (`npm run carga -- 450000`) en un portátil común: 450.000 obligaciones generadas, 446.939 vivas después de deduplicar y cancelar, 400 cooperativas, con el 8 % de ellas concentrando el 61 % de las aristas.

| Fase | Tiempo con 446.939 obligaciones |
|---|---|
| Congelamiento | < 1 ms |
| Escaneo + orden (1 hilo) | 292 ms |
| Fase 1: neteo bilateral + circuitos | 322 ms |
| Fase 2: tres estrategias | 320 ms |
| Cuatro invariantes | 253 ms |
| **Total** | **≈ 1,3 s de 20 s de presupuesto** |

---

## 1. Grafo incremental (RF-1)

Las obligaciones viven en un *pool* de ranuras dentro de un único `SharedArrayBuffer`. Cada campo es un arreglo tipado aparte (estructura de arreglos): `origen`, `destino` (Uint16), `monto`, `vence`, `ts`, `clave` (Float64), `prioridad`, `estado`, `concepto` (Uint8), y los enlaces.

**Adyacencia.** Cada ranura está en dos listas doblemente enlazadas *intrusivas*: las salientes de su origen (`sigOut`/`antOut`) y las entrantes de su destino (`sigIn`/`antIn`). Las cabezas están en `cabOut[400]` y `cabIn[400]`.

- Alta: O(1). Se toma una ranura libre y se inserta en la cabeza de las dos listas.
- Baja (cancelación o ejecución): O(1). Se desenlaza con los punteros anterior y siguiente, sin buscar.
- Memoria: 67 bytes por obligación, independientemente del grado. Con 524.288 ranuras el buffer pesa 40,9 MB.

¿Por qué no otra estructura?

- Un CSR (offsets + vecinos) es más compacto, pero cada alta obliga a desplazar el arreglo o a reconstruirlo, y el enunciado prohíbe reconstruir.
- Un arreglo de capacidad fija por nodo exige dimensionar cada nodo para el peor grado. Con un grafo tan desigual (hubs con decenas de miles de aristas y nodos con tres), o se desperdicia memoria o los hubs se desbordan. Las listas intrusivas no reservan nada por nodo.
- `Map`/objetos por nodo no se pueden compartir entre Workers.

**Posición neta por par.** Como n = 400, una matriz densa 400 × 400 cuesta 160.000 celdas. Se mantienen tres (una por prioridad) con el monto y la cuenta pendiente de cada par ordenado: `parMonto[p][i][j]`. La posición neta entre i y j es `M[i][j] − M[j][i]`, O(1). La matriz se actualiza en cada alta y baja (O(1)) y ocupa 3,8 MB más 1,9 MB de cuentas. También se lleva `posNeta[v]` por cooperativa.

## 2. Fotografía consistente sin copiar (RF-2, RT-3)

Se usa versionado por épocas (MVCC):

- Cada ranura tiene `alta` (época en que se insertó) y `baja` (época en que salió; `SIN` si sigue viva).
- La fotografía de época S ve la ranura i si `alta[i] ≤ S` y `baja[i] > S`.

Protocolo con `Atomics`:

1. El lector se registra con época 0 en su casilla (`LECTOR0 + k`). Eso bloquea la reutilización de ranuras mientras termina el corte.
2. `S = Atomics.add(EPOCA, 1)`: este es el corte. Toda escritura que lea la época después de esta instrucción escribe S + 1 y queda fuera.
3. Guarda S en su casilla y espera con `Atomics.wait` a que `ESCRIBIENDO` vuelva a 0. El escritor abre lotes de a lo sumo 256 mensajes, así que se espera microsegundos y la ingesta nunca se detiene.

El escritor (un solo Worker) hace `ESCRIBIENDO = 1`, lee la época, escribe y publica la ranura con `Atomics.store(alta, i, e)` como última instrucción.

- Lectura: `Atomics.load(baja)` y luego `Atomics.load(alta)`. En ese orden, una ranura que se esté reutilizando nunca parece visible.
- Costo en memoria: los dos Int32 por ranura (4 MB) frente a copiar los 40,9 MB del grafo.

**Reutilización diferida.** Las ranuras dadas de baja van a una cola (limbo) y sólo se reciclan cuando la época de baja es ≤ la mínima época de los lectores activos. Así nadie lee una ranura que cambió debajo de él.

**Saldos.** Son 400 + 400 números protegidos con un *seqlock* (contador impar mientras se escribe). El lector copia 6,4 KB y reintenta si el contador cambió. Los depósitos que llegan durante el ciclo quedan para el siguiente; al aplicar el resultado se suman deltas, no se sobrescriben saldos.

**Cancelación que llega después del congelamiento.** Sale de inmediato de la vista viva (`baja = época actual > S`), pero la fotografía la sigue viendo y queda marcada `CANCEL_TARDIA`. Al aplicar el resultado:

- si el ciclo no la ejecutó, queda simplemente cancelada;
- si la ejecutó, el dinero ya se movió en el banco liquidador y no se puede "des-ejecutar". Se genera un **reverso** `RV-…` (destino → origen, mismo monto, prioridad 2) que entra al ciclo siguiente.

Lo mismo pasa con una cancelación de algo liquidado en un ciclo anterior. En la interfaz se cuentan aparte las cancelaciones tardías y los reversos.

## 3. Compensación bilateral y circuitos (RF-3)

1. Se agregan las obligaciones de la fotografía por par: G[i][j]. Es O(m).
2. **Neteo bilateral:** para cada par, b = min(G[i][j], G[j][i]) se elimina de los dos lados. O(n²) = 80.000 pares. Queda un grafo R con a lo sumo una arista por par.
3. **Componentes fuertemente conexas** con Tarjan iterativo, O(n + e). Sólo dentro de una componente con dos o más nodos puede haber circuitos. Con los datos generados casi siempre hay una componente gigante de 400 nodos: los hubs conectan todo.
4. **Cancelación de circuitos** con un DFS que lleva pila e iterador por nodo.
   - Cuando aparece una arista u → v con v en la pila, el circuito es v … u → v. Se resta el mínimo δ en todas sus aristas (al menos una queda en cero) y se retrocede la pila hasta la primera arista que se anuló.
   - Un nodo terminado no vuelve a formar parte de ningún circuito, porque los montos sólo bajan. Por eso una sola pasada deja R acíclico.
   - **Criterio de terminación:** se vuelve a correr Tarjan y todas las componentes deben ser triviales. En la práctica son siempre **2 pasadas**: la que cancela y la que verifica.
   - Complejidad: O(n · e) en el peor caso (≤ e circuitos, cada uno de largo ≤ n); con 450.000 obligaciones fueron 65.330 circuitos.
5. **De montos a obligaciones.** Lo compensado en el par (G − R) se cubre con obligaciones completas, en el orden total, mientras quepan. Una obligación no se parte, así que pueden quedar pequeñas diferencias que se cubren con saldo. Si una cooperativa no alcanza, se le retiran salientes del bloque (en orden inverso) hasta que el bloque sea factible **sin tocar el cupo**. Cada retiro puede afectar a otro nodo, que entra a una cola; cada obligación sale a lo sumo una vez, así que el costo es O(m).

El bloque resultante se ejecuta de forma simultánea, como permite el enunciado. Se informa:

- el monto eliminado por neteo y por circuitos (en la prueba, el 94 % del bruto);
- las obligaciones liquidadas en el bloque;
- la liquidez que consumió;
- cuántas quedan pendientes.

## 4. Selección con restricción de liquidez (RF-4)

**Formulación.** Se busca elegir un subconjunto X de las obligaciones pendientes y un orden de ejecución tal que, en cada paso, el origen tenga `saldo + cupo ≥ monto`. El objetivo es lexicográfico:

1. obligaciones de prioridad 1 cumplidas;
2. obligaciones próximas a vencer cumplidas (vencen antes de `ahora + 2 h`);
3. monto total liquidado.

Además, se quiere usar poco cupo.

Es NP-difícil. Con una sola cooperativa pagadora, saldo S y obligaciones de distinto monto, maximizar lo pagado es *subset-sum*.

**Contraejemplo del voraz simple** (`test/ciclo.test.mjs`): la cooperativa 1 tiene 100 de saldo; la 2 y la 3 tienen 0.

| Orden | Obligación | Prioridad |
|---|---|---|
| 1 | 2 → 3 por 100 | 1 |
| 2 | 1 → 2 por 100 | 2 |

El voraz de una pasada en orden de prioridad intenta primero 2 → 3: la 2 no tiene saldo y la salta. Paga 1 → 2 y termina. Resultado: 100 liquidado y **ninguna** de prioridad 1. El óptimo paga 1 → 2 y luego 2 → 3: 200 liquidado, con la de prioridad 1 cumplida. El voraz falla porque no aprovecha que el dinero recibido habilita pagos que ya había descartado.

**Estrategia A — voraz por orden total con reciclaje.** Recorre la cola en el orden total y paga lo que alcance (saldo + cupo). Repite pasadas mientras alguna obligación se haya pagado: el dinero recibido "recicla" liquidez. O(m · pasadas).

**Estrategia B — saldo primero, cupo dirigido.**

1. Pasadas sólo con saldo.
2. Pasadas que permiten cupo únicamente a las obligaciones de prioridad 1 y a las próximas a vencer.
3. Rondas de desbloqueo: se calcula qué cooperativas tienen obligaciones urgentes sin cubrir y se permite cupo sólo para pagos dirigidos a ellas, porque esos pagos destraban lo urgente.

Usa el cupo como último recurso, que es lo que pide el caso ("su uso tiene costo y debe minimizarse").

**Comparación sobre la misma fotografía** (la aplicación la recalcula en cada ciclo, pestaña *Estrategias*). Corrida de 20.000 obligaciones:

| | Voraz simple | A | B |
|---|---|---|---|
| Monto liquidado | $61.035 M | $63.054 M | $62.886 M |
| Aplazadas | 1.655 | 1.202 | 1.201 |
| Prioridad 1 cumplidas (de 3.085) | 2.941 | 3.006 | 3.009 |
| Próximas a vencer (de 7.744) | 7.273 | 7.425 | 7.452 |
| Cupo usado | $235 M | $305 M | $240 M |

B cumple un poco más de prioridad 1 y de urgentes y usa un 21 % menos de cupo que A, a cambio de liquidar un 0,3 % menos de monto. Con unas 300.000 obligaciones la diferencia de monto entre A y B bajó a 0,02 %.

**Los cuatro controles** (`src/core/invariantes.js`) se ejecutan sobre el resultado antes de aplicarlo:

| Control | Cómo se verifica | Costo |
|---|---|---|
| I1 Suma de movimientos cero | Se acumulan débitos y créditos de lo ejecutado y la suma de saldos antes y después | O(m + n) |
| I2 Posición neta | Neto antes = neto liquidado + neto aplazado por cooperativa, y Δsaldo = neto liquidado. También se comprueba que la cancelación de circuitos no cambió el neto de ningún nodo | O(m + n²) |
| I3 Nunca bajo el cupo | Se reejecuta todo desde cero: primero el bloque simultáneo y luego cada pago en su orden, comprobando saldo ≥ −cupo en cada instante | O(m) |
| I4 Sin doble ejecución | Marca por posición y unicidad de ids y ranuras (ordenamiento de las claves) | O(m log m) |

Los montos son enteros en Float64, exactos hasta 2⁵³ (9 × 10¹⁵ pesos), así que las comparaciones son exactas y no dependen del orden de suma. Los cuatro tardan 253 ms con 446.939 obligaciones: caben de sobra en los 20 s.

Si alguno falla, el ciclo no se aplica, la ingesta descarta el resultado y la interfaz dice cuál falló y por qué. Se puede comprobar con *Probar controles*, que corrompe a propósito el resultado.

## 5. Orden total y paralelismo determinista (RF-5, RT-4)

Orden: **(prioridad ASC, vence ASC, id ASC)**. El id es único, así que no hay empates: es un orden estricto.

Paralelismo:

1. El pool [0, alto) se parte en K tramos contiguos.
2. Cada shard escanea su tramo, filtra lo visible en la época S y ordena con ese comparador. Escribe en su zona de `orden` dentro del mismo SAB y no se copia nada.
3. El Worker de cálculo fusiona las K corridas (fusión k-vías).

Como el orden es estricto, el resultado de la fusión es la misma secuencia sin importar K ni en qué ranura cayó cada obligación (que depende del orden de llegada). Todo lo posterior recorre esa secuencia y matrices indexadas por nodo, con sumas enteras exactas. Por eso el resultado es idéntico.

Costo:

- Ordenar: O(m log m), 292 ms con un hilo para 446.939.
- Fusionar: O(m · K).
- Para que exista el desempate, cada obligación necesita su id numérico (`clave`, 8 bytes): 4 MB.

La prueba `npm run determinismo` (y el botón en *Auditoría*) construye tres grafos nuevos con llegada original, invertida y aleatoria, los calcula con 1, 2 y 4 Workers, y compara la huella SHA-256 del resultado (decisión, orden, liquidez y saldos finales de cada obligación).

## 6. Simulaciones (RF-6, RT-5)

Cada escenario es un ciclo completo sobre una fotografía propia (casilla de lector 1) y no escribe nada en el grafo:

- depósito de una cooperativa;
- más cupo para las 5 más comprometidas;
- aplazar las diferibles.

**Prioridad.** El ciclo oficial pone `OFICIAL = 1`. La simulación revisa esa bandera cada 16.384 iteraciones y, si está activa, se duerme con `Atomics.wait` hasta que baje. Los navegadores no exponen prioridades de hilo, así que la prioridad se implementa de forma cooperativa.

**Cancelación.** La pestaña líder escribe `CANCELAR0 + 1 = 1` en el SAB. Un `postMessage` no serviría: el Worker está ocupado y no atiende mensajes. La simulación lo ve en la siguiente revisión, lanza `Cancelado` y en el `finally` libera su fotografía. Como nunca escribió en el grafo, no queda estado a medias. Las que aún están en cola simplemente se retiran.

## 7. Dibujo del grafo (RF-7, RT-9)

- El Worker de ingesta agrega por par (a partir de las matrices) y envía cada segundo las 40.000 parejas de mayor monto, con su monto por prioridad, como arreglos tipados transferidos (≈ 1 MB). El hilo principal nunca recorre el grafo.
- El canvas dibuja las aristas en una capa fuera de pantalla sólo cuando cambian los datos, los filtros o el zoom.
- Se descartan aristas bajo el monto mínimo, las que no cumplen el filtro de prioridad y las que quedan fuera de la vista.
- Las restantes se agrupan en 6 cubetas logarítmicas de monto: 6 `Path2D` y 6 `stroke()` en vez de uno por arista.
- Cada cuadro de `requestAnimationFrame` sólo copia la capa (`drawImage`) y pinta los 400 nodos, la selección y el circuito: 1–2 ms.
- Reconstruir la capa con unas 20.000 aristas toma 8–15 ms.
- No hay ningún elemento del DOM por arista. La pestaña *Rendimiento* muestra el costo de cada cuadro.

## 8. Requerimientos técnicos que necesitan explicación

**RT-1.** La ingesta (`ingesta.js`) y el cálculo (`calculo.js` + shards) son Workers distintos. El hilo principal sólo pinta y hace `fetch` hacia el Service Worker.

**RT-2.** El grafo y los saldos están en un `SharedArrayBuffer` de 40,9 MB que se comparte una sola vez al arrancar. Si se enviara por `postMessage` en cada ciclo, se copiaría al Worker de cálculo y a cada shard: 40,9 MB × (K + 1) por ciclo. La interfaz muestra lo ahorrado acumulado.

**RT-7 y la limitación del SharedWorker.** En Chromium un SharedWorker vive en otro *agent cluster*: dentro de él no existen `SharedArrayBuffer` ni el constructor `Worker`. Lo comprobé con Chromium 141: `typeof Worker === 'undefined'` en `SharedWorkerGlobalScope`.

Por eso el grafo no puede vivir físicamente en el SharedWorker. Lo que hace `hub.js` es garantizar que haya **un único grafo para todas las pestañas**:

- es la única fuente de la red (no se duplica la ingesta);
- elige una pestaña líder, que es la única que crea el SAB y los Workers (no se duplica el cálculo);
- difunde las vistas y los reportes a todas las pestañas;
- enruta los comandos de cualquiera de ellas.

Si la líder se cierra, el hub promueve otra. La nueva líder reconstruye el grafo desde el último estado guardado por el Service Worker y el hub le reenvía lo que tenía en espera más los últimos 3 s. Las obligaciones repetidas las descarta la deduplicación.

**RT-8. Service Worker.**

- Guarda en caché los archivos de la aplicación.
- Guarda en IndexedDB cada lote de obligaciones recibidas (el diario) y, al cerrar cada ciclo, el estado liquidado completo: saldos, pendientes e ids finalizados, en binario.
- Intenta subir todo a `/api/sync`. Si no hay red, lo deja marcado y lo reintenta con Background Sync o cuando vuelve el evento `online`.

Un Web Worker no puede cumplir ese papel por tres razones:

1. vive y muere con la pestaña;
2. no intercepta peticiones de red, así que no puede responder `/api/estado` ni servir la página cuando no hay conexión;
3. no recibe eventos `sync` con la página cerrada.

El Service Worker sí persiste entre recargas y es el único que puede atender la carga de la aplicación sin red.

**RT-10. Ingesta sin tareas largas.** El rezago se procesa en el Worker en lotes de 256 mensajes, con un presupuesto de 8 ms por tarea. Al agotarse se cede con un `MessageChannel`, que es una tarea nueva (macrotarea).

Encadenar microtareas (`Promise.resolve().then(...)`) no cede: el navegador vacía toda la cola de microtareas antes de procesar otro evento o pintar, así que 50.000 microtareas seguidas son una sola tarea larga.

El hilo principal recibe a lo sumo una vista por segundo. Cuando necesita repartir trabajo usa `scheduler.yield()` o, si no existe, el mismo truco del `MessageChannel`.

**RT-11.** `PerformanceObserver` sobre:

- `event`: INP como p98 por `interactionId`, desglosado en retraso de entrada, procesamiento y presentación;
- `longtask` y `long-animation-frame`.

A eso se suman las duraciones de cada fase que reporta el Worker de cálculo y las obligaciones por segundo que reporta la ingesta.
