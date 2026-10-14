# Cámara de compensación de pagos entre cooperativas

Caso de estudio 6 – Programación Orientada a la Web.

Aplicación web que recibe el flujo de obligaciones entre 400 cooperativas, ejecuta el ciclo de compensación cada 15 minutos (compensación bilateral, circuitos y selección con restricción de liquidez), verifica los cuatro invariantes antes de liquidar y deja un registro de auditoría que se puede reproducir.

No usa frameworks ni dependencias: HTML, CSS y JavaScript con módulos ES, Workers y un servidor de Node de unas 50 líneas para desarrollo.

## Cómo correrlo

Requiere Node 22 o superior.

```bash
npm start
```

Abrir <http://localhost:5173>. El servidor envía las cabeceras `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`; sin ellas no hay `SharedArrayBuffer`. En la barra superior debe aparecer **crossOriginIsolated**.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas del grafo, del ciclo, de los invariantes y del determinismo |
| `npm run generar -- 200000 datos/entrada.jsonl` | Genera un archivo de entrada con duplicados, desorden, cancelaciones y depósitos |
| `npm run determinismo -- datos/entrada.jsonl` | Corre el ciclo tres veces (llegada original/1 worker, invertida/2, aleatoria/4) y compara las huellas |
| `npm run reproducir -- auditoria-ciclo-3.json` | Reejecuta un registro exportado desde la aplicación y compara el resultado |
| `npm run carga -- 450000` | Prueba de carga del núcleo sin navegador |

## Despliegue

El proyecto es estático; sólo necesita que el hosting permita configurar cabeceras.

**Netlify** (recomendado): conectar el repositorio de GitHub en app.netlify.com → *Add new site* → *Import an existing project*. No hay comando de build y el directorio a publicar es la raíz. `netlify.toml` ya trae las cabeceras COOP/COEP y la función `/api/sync`.

**Vercel**: importar el repositorio; `vercel.json` trae las cabeceras y `api/sync.js` es la función de sincronización.

Si el hosting no deja poner cabeceras (GitHub Pages, por ejemplo), el Service Worker las agrega a las respuestas que sirve y la página se recarga una vez para quedar aislada.

Para verificar RT-6 en el sitio desplegado: abrir la consola y escribir `crossOriginIsolated`; debe dar `true`.

## Estructura

```
index.html, estilos.css      interfaz
sw.js                        Service Worker (caché, cola sin conexión, estado liquidado)
server.js                    servidor de desarrollo con COOP/COEP
src/main.js                  hilo principal: interfaz, arranque del motor en la pestaña líder
src/hub.js                   SharedWorker: red simulada, elección de líder, reloj y difusión a las pestañas
src/workers/ingesta.js       único escritor del grafo
src/workers/calculo.js       ciclo oficial, reparte el escaneo/orden entre shards
src/workers/shard.js         escanea y ordena un tramo del pool de aristas
src/workers/simulacion.js    escenarios del operador (prioridad menor, cancelables)
src/core/grafo.js            grafo en SharedArrayBuffer, épocas y fotografía
src/core/ingestor.js         deduplicación, cancelaciones, reversos, persistencia
src/core/orden.js            orden total y fusión de corridas
src/core/compensacion.js     neteo bilateral, Tarjan y cancelación de circuitos
src/core/seleccion.js        estrategias de selección con liquidez
src/core/invariantes.js      los cuatro controles
src/core/ciclo.js            el ciclo completo y la huella SHA-256
src/core/auditoria.js        registro exportable y reproducción
docs/ANALISIS.md             análisis algorítmico y respuestas a los requerimientos técnicos
```

## Guía rápida para la sustentación

1. **RT-6:** abrir la URL y revisar que en la barra diga *crossOriginIsolated*.
2. **RT-10 y RT-11:** subir la tasa a 900/s (botón *Pico 900/s*) y abrir la pestaña *Rendimiento*: obligaciones por segundo, INP desglosado, tareas largas y tiempo por cuadro del grafo.
3. **RT-1:** con DevTools → Performance grabando, pulsar *Ejecutar ciclo ahora*. El hilo principal queda libre; el trabajo aparece en los hilos `ingesta`, `calculo` y en los shards.
4. **RF-3 y RF-4:** pestaña *Último ciclo*: monto eliminado por neteo y por circuitos, pendientes después, tiempos por fase y los cuatro controles. La pestaña *Estrategias* compara las estrategias.
5. **Controles:** en *Probar controles* elegir, por ejemplo, "romper I3" y ejecutar un ciclo. El ciclo no se aplica y se informa cuál control falló.
6. **RF-6 y RT-5:** lanzar una simulación y, mientras corre, ejecutar un ciclo. La simulación queda *en pausa* hasta que termina el oficial. Con *Cancelar* se detiene sin tocar el estado.
7. **RT-7:** abrir una segunda pestaña. Aparece como *seguidora*: no crea Workers ni ingiere nada y muestra lo mismo. Al cerrar la líder, la otra toma el motor y se recupera desde el último estado guardado.
8. **RT-8:** en DevTools → Network marcar *Offline*. La barra muestra cuántas obligaciones quedan por sincronizar. Se puede recargar la página sin red y vuelve con el estado. Al quitar *Offline* se sincroniza.
9. **RT-4 y RF-8:** en *Auditoría*, descargar el registro, reproducirlo y correr la prueba de determinismo.
