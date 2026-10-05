# Documento de implementación: cálculos de auto-servicio (Visual Builder + Semantic SQL + IA)

> Este documento resuelve un hueco real: hasta acá, el diseño asumía que las métricas se escriben en YAML vía pull request — un flujo de ingeniero de datos. Pero el usuario que arma un dashboard (el equivalente al usuario de Power BI Desktop) necesita poder crear sus propias medidas, incluso avanzadas, **sin aprender un lenguaje nuevo que esta plataforma inventó**. Ese fue el error del primer intento de este documento, y esta versión lo corrige de raíz.

---

## 1. El camino que se descartó, y por qué

La primera versión de este documento proponía un lenguaje propio (`CALC()`, `IGNORE()`, `ROLLING()`), con parser, gramática y compilador propios. Es exactamente el tipo de encierro que este proyecto existe para evitar — aplicado, en ese momento, al usuario final en vez de a la infraestructura. Se descartó por una razón simple: mantener un lenguaje propio durante años (parser, lexer, type checker, autocompletado, mensajes de error, documentación, compatibilidad hacia atrás) es un trabajo enorme, y encima el usuario tendría que aprenderlo — lo contrario de "sin fricción".

La alternativa "usemos fórmulas de Excel" tampoco es la correcta: es más liviana de construir, pero **le pone un techo bajo al proyecto** justo en el punto donde se supone que hay que superar a Power BI, no empatar con una hoja de cálculo.

## 2. La corrección real: SQL, sin ninguna capa propia encima — porque Cube ya lo resuelve

**Cube tiene una capacidad real, llamada "Semantic SQL": SQL estándar (compatible con Postgres) que puede referenciar métricas ya gobernadas por nombre, vía una función `MEASURE()`, en vez de reconstruir la lógica de agregación a mano.** El propio equipo de Cube llegó a esta decisión por el mismo argumento que motivó este cambio: un DSL propio obliga a cada consumidor (personas, herramientas, LLMs) a aprender una sintaxis nueva; SQL ya lo habla todo el mundo, incluidos los modelos de IA, que están entrenados sobre millones de ejemplos de SQL real.

### 2.1 Corrección de gobernanza: Cube Core vs. Cube (el producto comercial) — no repetir el error de MDX/DAX

**Verificado explícitamente, porque ya nos pasó una vez con MDX/DAX en la Capa 4: "Calculated Fields" (la UI donde en Cube Cloud se arma un cálculo clickeando desde Explore/Workbook) es parte de "Cube", el producto comercial construido sobre Cube Core — no de Cube Core, que es lo que este proyecto self-hostea.**

Lo que sí es parte de Cube Core, confirmado:

| Capacidad | ¿Cube Core (self-hosteado) o solo Cube (comercial)? |
| --- | --- |
| SQL API (el motor que ejecuta Semantic SQL, con `MEASURE()`) | **Cube Core** — deshabilitado por defecto, se habilita con una línea de configuración |
| Pushdown de consultas SQL complejas (window functions, subqueries, CASE) al motor subyacente | **Cube Core** |
| La UI de "Calculated Fields" (clickear un campo, elegir una operación) | Solo Cube (comercial) |
| Workbooks, Explore, Analytics Chat | Solo Cube (comercial) |

**La consecuencia práctica: el motor difícil (ejecutar Semantic SQL con seguridad, caché y pushdown) ya lo tenemos gratis. La interfaz visual la construimos nosotros — pero eso ya estaba planeado como parte del Authoring Engine (capa 8), no es trabajo nuevo que este documento agregue.**

---

## 3. La arquitectura: tres caminos, un solo destino

```
AUTOR DEL DASHBOARD
                      │
       ┌──────────────┼──────────────┐
       │              │              │
 Visual Builder   Editor SQL      Asistente IA
  (Capa 8,        avanzado        (Capa 5, ya
  nuevo)          (Capa 8)        existente)
       │              │              │
       └──────────────┼──────────────┘
                      ▼
              AST interno (estructura de datos,
              nunca un lenguaje que el usuario ve)
                      ▼
                Semantic SQL
        "MEASURE(recaudacion) / NULLIF(MEASURE(facturacion), 0)"
                      ▼
         Cube Core — SQL API (habilitado)
                      ▼
              DuckDB / ClickHouse
```

### 3.1 Camino 1 — Visual Builder (el que va a usar la mayoría)

```
Nueva medida
──────────────────────
Nombre:      Cobrabilidad
Operación:   Ratio
Numerador:   Recaudación
Denominador: Facturación
```

El usuario no escribe nada. La plataforma arma internamente una estructura tipada — el AST — y **recién ahí** la traduce a Semantic SQL:

```ts
// El AST es una estructura de datos interna, nunca algo que el usuario escribe o lee
const ast = { type: 'ratio', numerator: 'recaudacion', denominator: 'facturacion' };

function astToSemanticSql(ast: MeasureAst): string {
  switch (ast.type) {
    case 'ratio':
      return `MEASURE(${ast.numerator}) / NULLIF(MEASURE(${ast.denominator}), 0)`;
    // ... otros patrones del Visual Builder (% del total, año anterior, rolling)
  }
}
```

**Corrección de un error de orden en la primera versión de este documento:** para "Cobrabilidad = Recaudación / Facturación", el numerador es Recaudación, así que el SQL generado es `MEASURE(recaudacion) / NULLIF(MEASURE(facturacion), 0)` — no al revés.

**Por qué pasar por un AST y no concatenar strings SQL desde los componentes visuales directamente:** una estructura tipada se valida antes de convertirse en texto (¿existe la métrica referenciada? ¿los tipos coinciden?) — concatenar strings desde una UI es la forma más fácil de terminar con un SQL malformado o, peor, con una inyección si algún campo no se sanitiza bien.

### 3.2 Camino 2 — Editor de Semantic SQL (usuario avanzado)

Un toggle `[ Visual | SQL ]` en la misma pantalla. El usuario avanzado escribe SQL real, en un editor de código embebido — **Monaco Editor** (Microsoft, MIT), elegido por la misma razón que otras piezas de este proyecto: gobernanza sin nada que auditar, sin necesidad de aplicar el checklist de "adopción masiva sin empresa" que sí hizo falta para otras librerías. Se carga de forma diferida (recién cuando el usuario abre el toggle `[ SQL ]`, nunca en la carga inicial del dashboard) para no cargar su peso completo (2-10 MB) en el camino de lectura, que es de solo lectura para la mayoría de los usuarios. Si el peso del bundle se vuelve un problema medido en la práctica, CodeMirror 6 es la alternativa a evaluar — pero recién aplicándole el mismo checklist de gobernanza que ya se usó para tRPC, no adoptándola por su adopción masiva sin verificarlo.

```sql
MEASURE(recaudacion) / NULLIF(MEASURE(facturacion), 0)
```

Sin pasar por el AST del Visual Builder — este camino habla Semantic SQL directo con el SQL API de Cube Core.

**Detalle técnico de cómo se conecta, y por qué el rendimiento no se resiente por hablar "dialecto Postgres":**

- **Corrección de un error de arquitectura real, señalado en una revisión posterior: el navegador nunca debe conectarse directo al puerto Postgres de Cube.** La versión anterior de esta sección proponía que el editor (corriendo en el navegador del usuario) abriera una conexión `node-postgres`/`psycopg` directa contra `CUBEJS_PG_SQL_PORT` — eso viola una regla que este mismo proyecto ya estableció en la Capa 6: **Cube Core nunca se expone directo al frontend**, todo pasa por la API Gateway.

**La corrección: el navegador nunca abre una conexión Postgres — llama a un procedimiento de la Capa 6, que es quien habla con Cube.** Cube Core tiene, desde su versión 1.5, un **transporte HTTP** para el SQL API — el endpoint `POST /v1/cubesql`, documentado explícitamente para "aplicaciones de frontend personalizadas, escenarios de analítica embebida y experiencias basadas en IA" — exactamente este caso de uso:

```
Editor (Monaco, en el navegador) — SQL en dialecto Postgres, con MEASURE()
   ↓ tRPC (mutation/query normal, como cualquier otra llamada del frontend)
API Gateway (Capa 6) — servidor, nunca el navegador
   ↓ POST /v1/cubesql (HTTP, con el JWT firmado del security context, misma autenticación que el resto)
Cube Core — SQL API
   ↓ Apache DataFusion → pushdown
DuckDB
```

**El puerto Postgres (`CUBEJS_PG_SQL_PORT`, `15432` por convención) queda reservado para herramientas externas de escritorio** (DBeaver, DataGrip, Jupyter, Tableau) que un analista conecta directo desde su máquina, con sus propias credenciales — nunca para el navegador de la plataforma. Son dos superficies de conexión distintas, con dos propósitos distintos, y no hay que confundirlas.
- **Ejecución real, verificada:** por dentro, el SQL API usa **Apache DataFusion** (motor de consultas en Rust, proyecto de la **Apache Software Foundation**) para parsear, reescribir la consulta (resolviendo `MEASURE()` al nivel de agregación correcto) y elegir un plan de ejecución. **Corrección de precisión, señalada en una revisión posterior: DataFusion y DuckDB no son "casi lo mismo" — son cosas arquitectónicamente distintas.** DataFusion es una *librería* de motor de consultas sobre Arrow, pensada para integrarse dentro de otros sistemas (como hace Cube); DuckDB es un DBMS analítico completo y embebido. Lo que comparten es la categoría (ambos columnares, vectorizados, multi-hilo, comparados como pares en benchmarks académicos como SIGMOD 2024) — no la naturaleza del software.
- **Pushdown cuando es posible, post-procesamiento cuando no — nunca "siempre" una de las dos.** Corrección de una afirmación demasiado categórica: no es cierto que "DuckDB siempre termina haciendo todo el trabajo pesado". Cuando DataFusion puede traducir la consulta completa al dialecto del motor de destino, la empuja entera (*pushdown*) y DuckDB hace la agregación real. Pero para combinaciones más complejas (ciertos CTEs, joins anidados, algunas combinaciones de funciones de ventana), Cube puede resolver una parte como consultas regulares contra DuckDB y terminar el resto como post-procesamiento **dentro de DataFusion** — en ese caso, esa porción sí corre en el motor de Cube, no en el motor columnar de DuckDB.

**Conclusión práctica, más precisa que la versión anterior: "habla dialecto Postgres" describe la sintaxis y el protocolo de conexión, nunca el rendimiento — pero el rendimiento real depende de cuánto de la consulta logre empujarse al motor columnar de destino, no está garantizado al 100% para cualquier fórmula que alguien escriba.**

### 3.2.1 Regla de diseño: las medidas de auto-servicio deben maximizar el pushdown

Si se permiten fórmulas arbitrariamente complejas sin ningún límite, el riesgo real es que DataFusion tenga que traer resultados intermedios grandes para terminar el cálculo por su cuenta — ahí sí se pierde rendimiento. La regla para este proyecto: los patrones que el Visual Builder genera (ratios, % del total, time-shift, rolling) están elegidos específicamente porque son los que Cube más confiablemente empuja entero al motor — no es casualidad, es la razón de estar en la lista de "resuelto limpio" de la sección 4. El Editor de SQL avanzado, al ser SQL libre, no tiene esa garantía automática — una fórmula rara puede caer en post-procesamiento sin que nadie lo note hasta que se vuelve lenta.

### 3.2.2 Riesgo real y verificado: el driver de DuckDB de Cube todavía está poniéndose al día con DuckLake

**Hallazgo concreto, no especulativo: hay un PR activo en el propio repositorio de Cube (`cube-js/cube#11165`) que dice explícitamente que el paquete `duckdb` que usaba el driver oficial de Cube tope en la versión 1.4.x de DuckDB — lo cual bloquea extensiones que necesitan DuckDB ≥1.5.2**, justo la generación de versiones donde DuckLake maduró más en capacidades. El PR migra el driver a `@duckdb/node-api` (los bindings "Neo", activamente mantenidos) precisamente para resolver esto.

**Consecuencia práctica para este proyecto: no asumir en el papel que "Cube → DuckDB → DuckLake" funciona perfecto con toda la superficie de Semantic SQL — probarlo temprano, como parte del primer vertical slice (`16-mvp-definicion-terminado.md`), con una batería concreta:** una medida simple, un ratio, una función de ventana, un CTE, un join, un rolling window, un time-shift — y confirmar, contra la versión exacta de Cube y de DuckDB que se vaya a usar, cuánto de eso realmente hace pushdown y cuánto cae a post-procesamiento. Si la versión de Cube en uso todavía no incorporó la migración del PR de arriba, es una razón concreta para fijar una versión más nueva antes de construir el Editor de SQL avanzado sobre DuckLake (Cube 1.7.45, la fijada en el Paso 3, ya la incorpora: su driver usa `@duckdb/node-api` 1.5.5-r.5, el mismo que la plataforma).

**Nota relacionada, sobre un cambio más grande en el horizonte: DuckDB 2.0 (modo servidor vía `Quack`, en alfa, release proyectado para la segunda mitad de octubre de 2026) podría eventualmente cambiar cómo Cube se conecta a DuckDB — de embebido a modo servidor.** No se adopta ahora (no está estable, y Cube no confirmó soporte), pero queda como condición explícita de reevaluación en `01-motor-almacenamiento.md`, sección 6.3 — vale la pena revisar esa sección junto con esta cuando llegue el momento de decidir entre DuckDB y ClickHouse para concurrencia media.

**Resultado de la batería — Paso 3 (2026-09-26), contra Cube Core 1.7.45 y DuckDB 1.5.5 sobre DuckLake en S3.** Medida en la Fase 0 y revalidada en la fase C con el modelo real (`packages/semantic/cube/model/`) y su pre-agregación construida en Cube Store; la revalidación corrigió dos puntos de la primera versión de esta tabla (el ratio y el filtro sobre una medida). Método: `EXPLAIN` por el SQL API, en modo seguro, y además **ejecutar** cada consulta — `EXPLAIN` planifica sin error los casos que después fallan. El plan físico incluye el request o el SQL exacto que Cube le manda a DuckDB, y los operadores que Cube ejecuta por encima, así que cada caso se clasifica mirando qué se ejecuta dónde. La batería vive como test de integración en `packages/semantic/test/integration/semantic-layer.test.ts`:

| Patrón | Resultado |
| --- | --- |
| Medida simple | Una consulta de Cube (`CubeScan`) |
| Ratio de medidas | Sin `ORDER BY`: una consulta de Cube que agrega en DuckDB, y la división la hace Cube fila por fila sobre el resultado agregado (`ProjectionExec`). Con `ORDER BY`: SQL completo en DuckDB (`CubeScanWrappedSql`) |
| Función de ventana (`RANK`) | ✘ Falla: `Type UInt64 is not supported in response transformation from Cube`. Con `CAST(RANK() OVER (…) AS INTEGER)`: SQL completo en DuckDB, ventana incluida |
| Filtro sobre una medida (`HAVING`, CTE o subconsulta) | Una consulta de Cube: el filtro viaja como filtro de Cube. ✘ Falla con una medida decimal cuando la consulta tiene orden y la responde una pre-agregación — ver *Hueco de Cube Store* más abajo |
| CTE | Un CTE sin filtro: una consulta de Cube. Varios CTE unidos con `JOIN` y filtrados: SQL completo en DuckDB, y el filtro lo aplica Cube sobre el resultado (`FilterExec`) |
| Join entre cubes | Una consulta de Cube |
| Rolling window | Medida del modelo (`rolling_window`): una consulta de Cube. `SUM() OVER (… ROWS 2 PRECEDING)` en SQL: SQL completo en DuckDB |
| Time-shift | Medida `multi_stage` con `time_shift`: una consulta de Cube. `LAG()` en SQL: SQL completo en DuckDB |

Seis consecuencias para el Editor de Semantic SQL:

- **Qué corre dentro de Cube, y con qué límite.** La agregación corre siempre en DuckDB. Cube hace, a lo sumo, operaciones por fila sobre el resultado ya agregado: una proyección (el ratio sin `ORDER BY`) o un filtro (CTE unidos y filtrados). Es trabajo liviano, pero tiene un límite real: el SQL API agrega **`LIMIT 50000`** a lo que empuja, así que un filtro que aplica Cube ve, como mucho, 50 000 filas agregadas. Si la consulta empujada produjera más, ese filtro trabajaría sobre un resultado truncado — se deduce del límite, no se midió con más de 50 000 grupos. Por eso el Visual Builder solo genera formas cuyo filtro viaja a Cube (`HAVING`, o `WHERE` sobre un CTE sin `JOIN`), nunca una donde el filtro quede del lado de Cube.
- **Hueco de Cube Store con medidas decimales.** Un filtro sobre una medida decimal, en una consulta con orden (REST aplica un orden por defecto aunque no se pida), falla cuando la responde una pre-agregación: `Invalid comparison operation: Decimal128(38, 2) > Decimal128(37, 2)`. Falla igual por REST que por el SQL API, y con cualquier forma del filtro — `HAVING`, CTE o subconsulta. **La primera versión de esta sección recomendaba `HAVING` como remedio, y era incorrecto:** solo funcionaba porque esa prueba no tenía `ORDER BY`. La misma consulta respondida por DuckDB (una dimensión que la pre-agregación no cubre) funciona, y con una medida entera (`count`) también. **Decisión del Paso 3:** la pre-agregación se queda, y el hueco queda documentado con su test de alerta, sin buscarle un arreglo ahora. Se retoma si aparece antes del Paso 11: el Visual Builder es quien realmente puede generar ese patrón (un "top N con umbral" sobre una medida decimal).
- **Hueco del SQL API: un `OR` con una constante siempre verdadera termina en *panic*.** `WHERE region = 'North' OR 1 = 1` falla con `Rewrite Error: Unexpected panic. Reason: Expected filter but found CubeScanFilters([])` (`converter.rs:1948`). Falla igual con `OR TRUE`, con la constante primero (`1 = 1 OR …`) y sin `GROUP BY`. Con una constante siempre falsa (`OR 1 = 0`) funciona, igual que `WHERE 1 = 1` sola o `AND 1 = 1`.
  - **Es el caso de `cube-js/cube#7880`, que evolucionó.** Ese issue está abierto desde 2024 y nace del "Todos" de un filtro de Grafana: `('ALL' = 'ALL' OR region IN (…))`. En la 0.34 las dos ramas fallaban con un error de reescritura. Hoy la forma con constante falsa funciona y la verdadera termina en *panic*. El dato actualizado va como comentario en #7880, no como issue nuevo.
  - **Medido el 2026-10-04**, con la imagen oficial de Cube, un modelo mínimo (`VALUES` en DuckDB) y sin código de la plataforma: igual en Cube 1.7.45 y en 1.7.50.
  - **No afecta a la Capa 6 hoy:** no expone `/v1/cubesql`, y el adaptador de `SemanticRuntimePort` solo arma filtros sobre miembros.
  - **Importa en el Paso 11:** el Editor de Semantic SQL puede recibir esa forma tal cual, escrita a mano o generada por una herramienta como Grafana. El Visual Builder nunca debe generarla: un filtro "Todos" se omite, no se escribe como una condición siempre verdadera.
- **Hueco de Cube Store con medidas derivadas: las trunca a 6 decimales.** Una medida derivada de tipo `number` (por ejemplo `average_order_value`, total dividido por cantidad), cuando la responde una pre-agregación, llega **truncada**, no redondeada: South da `262.110537` en vez de `262.1105375`. La misma consulta respondida por DuckDB conserva el `double` completo. Se midió en la Fase A del Paso 5, con la batería de contrato de `SemanticRuntimePort`, que compara el ratio con una tolerancia absoluta de 1e-6 por este motivo.
  - **Consecuencia para el Paso 11:** una medida derivada no da el mismo número según quién responda la consulta. Para un ratio que se muestra con pocos decimales es invisible. Para una comparación exacta (un umbral, un filtro de igualdad) no lo es.
  - Se revalida con cada versión nueva de Cube, como los otros huecos.
- **Exactitud:** el SQL API devuelve las medidas decimales como punto flotante (`262.43600250000003`). La API REST las devuelve como string, pero sin la escala (`446207.5`, no `446207.50`). Ninguna de las dos es el formato sin pérdida del puerto de lectura (`01-motor-almacenamiento.md` §7); la representación la define el contrato de la Capa 6 (Paso 5).
- **Los dos huecos (`RANK` y el filtro decimal) no tienen issue en `cube-js/cube`** (revisado el 2026-09-26; no se publicó ninguno). El PR #11684, ya incorporado, empujó las funciones de ventana y registra un problema de tipos parecido con `NTILE`. Los dos se revalidan con cada versión nueva de Cube — sus tests de alerta fallan el día que Cube los resuelva. Mientras sigan abiertos, el Visual Builder usa `CAST` en las funciones de ranking; para el filtro decimal no hay forma de SQL que lo evite mientras una pre-agregación responda la consulta (ver la decisión de arriba).

### 3.2.3 Corrección bloqueante: la autenticación del SQL API no es la misma que la de REST/GraphQL

**Corrección del Paso 5, medida en la Fase 0 (P5-4, 2026-09-27, Cube Core 1.7.45): la hipótesis de esta sección era incorrecta para el transporte HTTP.** Decía que `/v1/cubesql` autentica con `checkSqlAuth`, igual que el protocolo de Postgres. **No es así.**
- **`/v1/cubesql` autentica con `checkAuth`:** la opción `jwt`, la misma verificación de JWT que REST/GraphQL. No invoca `checkSqlAuth` en ningún caso.
- **`checkSqlAuth` solo corre en el protocolo de Postgres.**
- **La tabla de abajo está mal en su segunda fila**, y la frase "ni por el transporte HTTP `/v1/cubesql`" del hallazgo también. Se dejan como estaban para que se vea qué se suponía; lo medido está en §3.2.4.

**Avance del Paso 4, sobre el SQL API por el protocolo de Postgres (no sobre `/v1/cubesql`):**
- **`checkSqlAuth` está implementado:** la contraseña es el mismo token corto que usa REST (HS256, ≤ 5 min), y el security context sale de sus *claims*. Así el SQL API aplica exactamente la misma RLS que REST, y no existe una contraseña fija.
- **`checkSqlAuth` corre una sola vez, al conectar.** Por eso Cube vuelve a verificar el vencimiento en cada consulta (`queryRewrite`), y una conexión abierta muere con su token (`04-semantico.md` §6.6).
- **El transporte HTTP `/v1/cubesql` quedó resuelto en el Paso 5:** no pasa por `checkSqlAuth` (§3.2.4).

**Hallazgo importante, señalado en una revisión posterior y verificado contra la documentación oficial de Cube: el JWT que ya usamos para REST/GraphQL (firmado con `CUBEJS_API_SECRET`, decodificado automáticamente por Cube) NO es el mismo mecanismo que usa el SQL API — ni por el puerto Postgres, ni por el transporte HTTP `/v1/cubesql`.** Cube distingue dos rutas de autenticación completamente separadas:

| API | Mecanismo | Quién lo implementa |
| --- | --- | --- |
| REST / GraphQL | `checkAuth` — decodifica y verifica un JWT automáticamente, con los claims ya disponibles como `securityContext` | En buena parte, comportamiento de fábrica de Cube |
| **SQL API** (los dos transportes: Postgres y `/v1/cubesql`) | **`checkSqlAuth`** — una función que **nosotros mismos escribimos** dentro de la configuración de Cube (`cube.js`/`cube.py`), que recibe usuario/contraseña de la conexión y devuelve `{ password, securityContext }` | Código propio, no viene resuelto de fábrica |

**Lo que sigue (este párrafo y el bloque de código) es la hipótesis anterior, descartada por la medición del Paso 5:** para `/v1/cubesql`, Cube sí decodifica el JWT automáticamente (`checkAuth`). El bloque de código no describe nada que exista: el `checkSqlAuth` real, del Paso 4, está en `packages/semantic/cube/` y solo atiende el protocolo de Postgres.

**La corrección al flujo de la sección 3.2 (`API Gateway → JWT firmado → /v1/cubesql`): el paso "Cube decodifica el JWT automáticamente" no está garantizado para el SQL API — depende de que nuestra propia implementación de `checkSqlAuth` sepa leer ese JWT y devolver el `securityContext` correcto.** El concepto de fondo no cambia (la Gateway sigue resolviendo `workspace_role` + `entitlements` y pasándoselos a Cube de forma verificable) — lo que cambia es que hay una pieza de configuración propia que escribir dentro de Cube, no algo que "ya funciona igual que REST":

```js
// Configuración de Cube Core — código propio, no comportamiento de fábrica
module.exports = {
  checkSqlAuth: async (req, username) => {
    // La Gateway conecta usando un JWT corto (el mismo que ya firma para el resto) como credencial —
    // el mecanismo exacto de cómo llega ese JWT dentro de `req` para el transporte HTTP
    // (¿header Authorization? ¿como password de la conexión?) es lo que hay que validar empíricamente,
    // sección 3.2.4 — no asumirlo escrito acá sin probarlo contra una instancia real.
    const securityContext = verificarYDecodificarJwt(/* de donde corresponda según la validación */);
    return { password: /* el mismo JWT, para que la verificación de Cube pase */, securityContext };
  },
};
```

### 3.2.4 Primer experimento técnico obligatorio, antes de construir el resto de esta capa

**No copiar el código de autenticación de este documento como si ya estuviera validado — es una hipótesis de diseño, no un hecho confirmado contra una instancia real de Cube.** Antes de escribir una sola línea más de la Capa 17, el primer experimento técnico del vertical slice (`16-mvp-definicion-terminado.md`) tiene que confirmar, contra la versión exacta de Cube Core que se use:

1. ¿El transporte HTTP `/v1/cubesql` efectivamente invoca `checkSqlAuth`, o tiene su propio camino?
2. ¿Cómo llega la credencial dentro de `req` en ese caso — header `Authorization`, usuario/contraseña de la request, otra cosa?
3. ¿Qué `securityContext` recibe realmente `access_policy` cuando se resuelve por esta vía — coincide con lo que devuelve `checkSqlAuth`, o hay alguna transformación intermedia?

Recién con esas tres respuestas confirmadas empíricamente se termina de escribir el código real de `checkSqlAuth` — el bloque de arriba es la hipótesis de partida, no la implementación final.

**Resuelto en el Paso 5.** Se midió en la Fase 0 (P5-4) contra el Cube Core 1.7.45 de desarrollo, con la configuración del Paso 4, por los dos transportes. **La hipótesis de partida era incorrecta: `/v1/cubesql` no usa `checkSqlAuth`.**

1. **¿Invoca `checkSqlAuth`?** No, nunca. Invoca `checkAuth` (la opción `jwt`), igual que REST. Lo distinguió un token válido de 3600 s:
   - Por HTTP, pasó la autenticación y lo rechazó recién `queryRewrite` ("not short-lived").
   - El mismo token, como contraseña por el protocolo de Postgres, falló en `checkSqlAuth` ("password authentication failed").
2. **¿Cómo llega la credencial?** En el header `Authorization`, el token crudo o con `Bearer`. `Basic` se rechaza. No hay usuario ni contraseña de la request.
3. **¿Qué `securityContext` reciben las `access_policy`?** El *payload* del JWT verificado, tal cual, sin ninguna transformación: el mismo que con REST. Cube lo escribe completo en su log (`09-auth-gobernanza.md` §6.1).

Medido además:

- **`queryRewrite` es imprescindible también por HTTP.** Un token sin `exp` pasa `checkAuth`, y solo `queryRewrite` impone la vida máxima de 300 s.
- **Un error posterior a la autenticación llega como HTTP 200**, con `{"error": …}` en el cuerpo. El cliente tiene que leer el cuerpo, no solo el estado.
- **El cambio de usuario `__user` se rechaza por los dos transportes** ("from unknown" por HTTP).
- **La RLS se sostuvo en todas las formas de consulta probadas:** sin agrupar, CTE, función de ventana, `UNION`, *join*, y filtros ensanchados con `OR` o `IN`.
- **La única falla fue un *panic* del reescritor** con un `OR` siempre verdadero, que no filtra datos. Está en §3.2.2.

**Consecuencia:** para el transporte HTTP no hay ningún código propio que escribir dentro de Cube. Quien use `/v1/cubesql` (el Editor de Semantic SQL del Paso 11) manda el mismo token corto que REST en `Authorization`. `checkSqlAuth`, del Paso 4, queda solo para las herramientas que hablan el protocolo de Postgres.



```
Usuario: "Creá una medida de cobrabilidad: recaudación dividida facturación"
```

El copiloto de IA (capa 5, ya construido) genera el Semantic SQL correspondiente y **se lo muestra al usuario para que lo confirme antes de guardar** — nunca lo guarda solo. Esto es una extensión del mismo servidor MCP de la capa 5, con una herramienta nueva (`generate_measure_sql`), no un sistema de IA aparte.

---

## 4. Honestidad sobre la cobertura — qué está resuelto limpio y qué necesita validarse

**Corrección de la primera versión de este documento, que prometía una tabla de equivalencia 1:1 con DAX sin matices.** Semantic SQL resuelve gran parte del problema sin inventar un lenguaje — pero no es un reemplazo funcional completo de DAX, y hay que decirlo así, no disimularlo:

| Patrón | Estado |
| --- | --- |
| Ratios, aritmética entre medidas | ✅ Resuelto limpio — `MEASURE(a) / NULLIF(MEASURE(b), 0)` |
| `SAMEPERIODLASTYEAR`, rolling N meses | ✅ Resuelto — vía `time_shift`/`rolling_window` ya definidos en el modelo base de Cube (capa 4), referenciados desde Semantic SQL |
| % del total, `ALL(dimensión)` | ✅ Resuelto — vía `group_by` del modelo base, referenciado desde Semantic SQL |
| `REMOVEFILTERS(dimensión)` | ✅ Resuelto — vía `filter: exclude` del modelo base |
| Ranking (`RANKX`) | 🟡 **A validar, no descartado** — el SQL API de Cube empuja *window functions* al motor subyacente, así que `RANK() OVER (ORDER BY MEASURE(facturacion) DESC)` podría funcionar directo en Cube. Hay que probarlo contra la versión real de Cube que se use, en vez de asumir que sí o que no — no es un "no" categórico como se afirmó en la primera versión de este documento. |
| Iteradores muy anidados, lógica de `FILTER` fila-por-fila compleja | 🔴 Sin solución limpia todavía — se documenta como límite conocido cuando aparezca un caso real, no se fuerza |

**Regla del proyecto para esta tabla:** se actualiza con evidencia real de pruebas contra la versión de Cube que se esté usando, nunca con una promesa optimista sin probar.

---

## 5. Alcance de las medidas: query-time primero, el modelo de Cube solo para lo certificado

**Corrección de un riesgo real que tenía la primera versión: "cada medida de usuario modifica el schema de Cube" no escala.** Con cientos de usuarios y decenas de medidas de prueba cada uno, eso significaría cientos de miles de definiciones dinámicas compitiendo por entrar al modelo semántico — un problema de recompilación, caché y gobernanza, no una funcionalidad.

**La corrección: las medidas locales y de workspace se ejecutan *en el momento de la consulta* (Semantic SQL enviado directo al SQL API), sin tocar el modelo YAML de Cube en absoluto. Solo una medida certificada se promueve al modelo real.**

| Alcance | Dónde vive | ¿Toca el schema de Cube? |
| --- | --- | --- |
| `report` (borrador) | Tabla propia (`user_measures`, sección 6), Semantic SQL ejecutado query-time | No |
| `workspace` (reutilizable, sin certificar) | Misma tabla, visible para todo el workspace | No |
| `global/certificado` | Se promueve al YAML real de la Capa 4, vía el mismo flujo de PR + `certify_metric` que ya existe (capa 9) | Sí — es la única vía que recompila el modelo |

Esto es, además, exactamente la misma separación que Cube describe para su propia dirección de producto: extensiones ad hoc vía Semantic SQL, promovidas al modelo cuando demuestran ser útiles — no es una idea nuestra aislada, es la misma dirección hacia la que va la herramienta.

---

## 6. Esquema de almacenamiento

```sql
CREATE TABLE user_measures (
    id                  UUID PRIMARY KEY,
    workspace_id        TEXT NOT NULL,
    report_id           TEXT,                 -- NULL si ya se promovió más allá del reporte (terminología unificada, 19-operabilidad-runtime.md §8.2)
    name                TEXT NOT NULL,
    definition_type     TEXT NOT NULL,        -- 'visual' | 'semantic_sql'
    visual_definition   JSONB,                -- el AST, si vino del Visual Builder
    expression_sql      TEXT NOT NULL,        -- la EXPRESIÓN semántica de la medida, no una consulta completa — ver 6.1
    scope               TEXT NOT NULL,        -- 'report' | 'workspace' | 'global' (terminología unificada, 19-operabilidad-runtime.md §8.2)
    status              TEXT NOT NULL,        -- 'draft' | 'certified'
    created_by          TEXT NOT NULL,
    version             INT NOT NULL DEFAULT 1
);
```

**Corrección de precisión, señalada en una revisión posterior: `expression_sql` no es una consulta ejecutable completa — es la expresión de la medida en sí.** Para renderizar "Cobrabilidad por mes y área, últimos 12 meses" hace falta combinar la expresión (`MEASURE(recaudacion)/NULLIF(MEASURE(facturacion),0)`) con dimensiones, filtros, *time grain*, orden y límite — piezas que vienen del widget que está usando la medida, no de la definición guardada.

### 6.1 El Self-Service Query Compiler — quién arma la consulta completa

```
user_measures.expression_sql          ("MEASURE(recaudacion)/NULLIF(MEASURE(facturacion),0)")
        +
dimensiones/filtros/grain del widget  (mes, área, últimos 12 meses — vienen del Filter AST, 14-interaction-state-engine.md)
        ↓
Self-Service Query Compiler (Capa 6, junto al adaptador toCubeQuery ya existente)
        ↓
SELECT mes, area, MEASURE(recaudacion)/NULLIF(MEASURE(facturacion),0)
FROM ...
WHERE ...
GROUP BY mes, area
```

Este compilador es una extensión del mismo adaptador de la Capa 6 que ya arma consultas a Cube (`13-recorrido-end-to-end.md`, paso 4) — no una pieza nueva y aislada, solo con una fuente de entrada adicional (`user_measures` en vez de, o además de, una métrica certificada).

### 6.2 Restricción explícita para V1: una medida self-service solo puede depender de métricas certificadas

**Decisión que hay que tomar ahora para no rediseñar después: ¿una medida local puede referenciar a otra medida local?** Por ejemplo, "Margen %" = "[Margen Ajustado] / [Ingresos]", donde "Margen Ajustado" es en sí otra medida creada por el mismo usuario. Decir que sí de entrada exige resolver un grafo de dependencias, detección de ciclos, y un orden de resolución — trabajo real que no aporta nada al MVP.

**Para V1: una medida self-service (`user_measures`) solo puede referenciar métricas ya certificadas del modelo de Cube — nunca otra fila de `user_measures`.** Esto reduce el primer motor de auto-servicio a lo esencial, sin cerrar la puerta — depender de medidas locales entre sí queda anotado explícitamente para una v2, cuando el patrón de uso real (no una suposición) diga si hace falta.

---

## 7. Seguridad: Semantic SQL nunca es un bypass del security context

**Corrección de una contradicción residual, señalada en una revisión posterior: esta sección generalizaba "el JWT firmado, verificado por Cube" como si fuera un solo mecanismo — pero la sección 3.2.3 de este mismo documento ya distingue dos rutas de autenticación distintas.** Redactado sin ambigüedad:

Una consulta de Semantic SQL sigue las mismas **políticas de RLS** (`access_policy`, `09-auth-gobernanza.md`) que cualquier otra consulta gobernada — eso nunca cambia. Lo que todavía depende de un experimento pendiente (sección 3.2.4) es el **mecanismo de autenticación exacto** por el que ese security context llega al SQL API: REST/GraphQL usa `checkAuth` con el JWT firmado (`13-recorrido-end-to-end.md`, paso 5); el SQL API usa `checkSqlAuth`, un mecanismo distinto, todavía por validar contra una instancia real de Cube. **Las políticas de fila son las mismas en los dos casos — el mecanismo de autenticación que las alimenta no.** El SQL API no es, en ningún caso, una puerta lateral que evita `access_policy` — corre con las mismas reglas de fila que cualquier otra consulta, sea cual sea el mecanismo exacto que termine validándose.

## 8. Qué hay que habilitar, en concreto — y en modo seguro, no en modo desarrollo

El SQL API de Cube Core está **deshabilitado por defecto** — se habilita configurando **`CUBEJS_PG_SQL_PORT`** (el puerto donde va a escuchar, por convención `15432`, reservado para herramientas externas — sección 3.2) al momento de desplegar la capa 4.

**Corrección de un riesgo de seguridad real, señalado en una revisión posterior: no alcanza con "habilitarlo", tiene que quedar en modo seguro desde el bootstrap, o el MVP de RLS no prueba nada real.** La propia documentación de Cube Core advierte que `CUBEJS_DEV_MODE=true` desactiva la verificación de JWT en REST/GraphQL, deja el Playground sin autenticación, y si no se configura una contraseña para el SQL API, este acepta credenciales arbitrarias. Probar el checklist del MVP ("Usuario A con `entitlement` Norte y Usuario B con `entitlement` Sur ven resultados distintos para la misma métrica" — `16-mvp-definicion-terminado.md`) **solo tiene valor si Cube está autenticando de verdad** — en modo desarrollo, esa prueba pasaría igual aunque el RLS estuviera completamente roto, porque no habría ninguna verificación real ocurriendo.

**Configuración mínima obligatoria antes de cualquier prueba de seguridad, no opcional:**

```bash
NODE_ENV=production
CUBEJS_DEV_MODE=false
CUBEJS_API_SECRET=<secreto real, el mismo que usa la Capa 6 para firmar el JWT>
# + autenticación del SQL API — sin esto, acepta credenciales arbitrarias (implementada en el Paso 4: el token corto como contraseña, §3.2.3)
```

**Cube Store: decisión explícita, no "después vemos".** Varias capacidades de producción de Cube (pre-agregaciones, caché distribuido) requieren Cube Store — sin él, Cube corre con caché en memoria, válido para un MVP simple pero no para validar comportamiento de producción. Dos opciones igual de válidas, pero hay que elegir una antes de construir, no dejarlo abierto:

- **MVP simple**: sin Cube Store, sin pre-agregaciones — más rápido de levantar, no representativo de producción.
- **MVP production-like**: Cube Store incluido en el `podman compose` desde el principio — más fiel, un poco más de infraestructura desde el día uno.

Este proyecto elige **MVP production-like** (Cube Store incluido desde el principio) — es coherente con la filosofía general de probar contra algo real cuanto antes, en vez de descubrir después que el comportamiento cambia con Cube Store en el medio.

**Implementado en el Paso 3 (`0.3.0`).** Cube Core 1.7.45 y Cube Store 1.7.45, fijados por digest, corren en el perfil CORE del compose del nivel "equipo local" (`19-operabilidad-runtime.md` §1):

- **Modo seguro desde el primer arranque:** `NODE_ENV=production`, `CUBEJS_DEV_MODE=false` y `CUBEJS_TELEMETRY=false`. `CUBEJS_API_SECRET` es el secreto `semantic.api-secret`, y el SQL API escucha en `15432` con usuario `semantic`. **Corregido en el Paso 5:** esta línea todavía nombraba el secreto `semantic.sql-password`, que desapareció en el Paso 4 (`0.4.0`). La contraseña del protocolo de Postgres es el mismo token corto de REST, que `checkSqlAuth` verifica (§3.2.3), y no hay contraseña fija. Los tests de integración verifican que una contraseña incorrecta y un token vencido se rechazan. Por HTTP, `/v1/cubesql` no usa contraseña: autentica con `checkAuth` (§3.2.4).
- **Cube Store en un nodo**, con su *metastore* y su *remote dir* en el volumen `cube-store-data`, que `pnpm reset:local` borra.
- **Sin salida a Internet.** Cube y Cube Store viven solo en la red interna `semantic` del compose, a la que se unen Postgres y el object storage. Publican sus puertos en `127.0.0.1`, pero no tienen ruta hacia afuera, y un test lo verifica. Las extensiones de DuckDB que carga Cube las instala `pnpm bootstrap` desde dentro de su imagen (`04-semantico.md` §6).
- **Lee el lakehouse como su lector:** el rol de solo `SELECT` del catálogo y la clave S3 de solo lectura (`01-motor-almacenamiento.md` §6.7).

---

## 9. Documentos afectados

- **`04-semantico.md`**: agregar que el SQL API se habilita explícitamente, y que las medidas certificadas de este documento son las que terminan como YAML real.
- **`08-frontend.md`**: sección nueva del Authoring Engine — Visual Builder de medidas + Editor de Semantic SQL, ambos apuntando al SQL API de Cube Core.
- **`09-auth-gobernanza.md`**: el flujo de certificación (`certify_metric`) ya definido se reutiliza tal cual para promover una medida de `workspace` a `global` — sin cambios en esa capa, solo una referencia cruzada.
- **`IMPLEMENTATION.md`**: sumar `user_measures` a la lista de tablas propias.

---

**Este documento reemplaza al `17-semantic-calculation-engine.md` original — ese nombre y su contenido (gramática propia) quedan descartados.**
