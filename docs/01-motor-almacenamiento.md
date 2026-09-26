# Capa 1: Motor de Almacenamiento (el "corazón")

> Reemplazo: **VertiPaq → DuckDB (+ MotherDuck para escalar)**

---

## 1. Responsabilidad única de esta capa

Almacenar datos ya limpios en formato columnar comprimido y responder consultas analíticas (agregaciones, filtros, joins) lo más rápido posible.

**Esta capa NO debe saber:**
- Nada sobre métricas de negocio ni nombres de "medidas" (eso es la capa semántica).
- Nada sobre relaciones lógicas entre entidades de negocio (eso también es semántico).
- Nada sobre quién está consultando ni con qué permisos (eso es auth).
- Nada sobre cómo se visualiza el resultado (eso es frontend).

Si esta capa empieza a contener lógica de negocio, el diseño está roto — señal de que alguien puso una fórmula de negocio en una vista SQL "porque era más rápido" en vez de subirla a la capa semántica.

---

## 2. Qué hace VertiPaq exactamente (para saber qué estamos reemplazando)

- **Compresión columnar por diccionario** — cada columna se almacena por separado, con valores repetidos codificados como enteros contra un diccionario, no como texto repetido.
- **Ejecución en memoria** — todo el modelo (comprimido) vive en RAM del proceso de Power BI o de la capacidad Premium/Fabric.
- **Motor vectorizado** — procesa lotes de filas en paralelo, no fila por fila.
- **Import u DirectQuery** — dos modos: cargar todo el dataset comprimido a memoria (rápido, pero exige refresco completo), o consultar la fuente en vivo (lento, porque no hay compresión ni caché propia).

---

## 3. Defectos concretos de VertiPaq que eliminamos

| Defecto | Por qué es un problema real |
| --- | --- |
| Tamaño del modelo limitado por la RAM del SKU de capacidad contratado | El costo de escalar datos es directamente el costo de licenciamiento de Fabric/Premium, no el costo real de cómputo |
| Import completo obligatorio para rendimiento razonable | Refrescar un modelo grande es lento y costoso; DirectQuery como alternativa es notoriamente lento en interactividad |
| No soporta formatos abiertos nativamente | No puede leer Parquet/Iceberg/Delta directamente — todo pasa por conectores propietarios de Power Query |
| Encerrado dentro del ecosistema Power BI | No se puede usar VertiPaq como motor de otra aplicación — es una pieza no reutilizable |
| Sin ejecución client-side | No existe versión de VertiPaq que corra en el navegador — la arquitectura es intrínsecamente cliente-servidor |
| Single-node únicamente | No escala horizontalmente; el único camino de escalado es "comprar más capacidad" |

---

## 4. Por qué DuckDB gana (no solo iguala)

- **Ejecución vectorizada con SIMD** — arquitectura de motor moderna (basada en ideas de MonetDB/X100), competitiva en benchmarks de cargas OLAP típicas contra motores columnares comerciales.
- **Cero fricción de import** — puede hacer `SELECT * FROM 'datos.parquet'` directo, sin ETL previo solo para "meter los datos al motor". Lee Parquet, Iceberg, Delta Lake y CSV nativamente.
- **Embebido, no un servidor** — se instala como una librería (Python, Node, etc.), no como un proceso de infraestructura separado. Reduce drásticamente la superficie operativa comparado con levantar un cluster.
- **DuckDB-WASM** — corre compilado a WebAssembly dentro del navegador. Esto es estructuralmente imposible para VertiPaq: habilita analítica **local-first**, sin servidor, sin roundtrip de red, incluso offline.
- **Extensible** — sistema de extensiones community (geoespacial, full-text search, conectores a object storage) sin esperar a que un vendor lo priorice.
- **Sin licenciamiento** — Apache-compatible (MIT), sin costo por capacidad ni por usuario.

**Honestidad sobre los límites:** DuckDB es single-writer y pensado para cargas analíticas de lectura intensiva sobre un solo nodo. Para volumen verdaderamente masivo con muchas escrituras concurrentes, no reemplaza a un motor distribuido tipo ClickHouse o BigQuery — para eso está el escalón de MotherDuck (ver sección 6).

---

## 5. Qué agregamos que VertiPaq/Power BI no tienen

- **Ejecución client-side vía WASM** — dashboards que funcionan sin conexión, procesando datos ya cacheados localmente.
- **Zero-copy queries sobre object storage** — consultar Parquet/Iceberg directamente en S3/GCS sin duplicar los datos en un "modelo" separado.
- **Portabilidad total** — el mismo motor corre en tu laptop, en un contenedor, o embebido en la app — sin reescribir nada.
- **Interoperabilidad con el ecosistema de datos abierto** (Iceberg, Delta) en vez de un formato propietario cerrado.

---

## 6. Arquitectura interna de esta capa

```mermaid
flowchart LR
    S[Fuentes registradas] -->|Import: directo o con landing, ver 02 §6.1.1| T[Transformación: SQLMesh sobre DuckDB]
    T --> L[DuckLake: Parquet + catálogo PostgreSQL o SQLite]
    L --> D[DuckDB: consultas de la plataforma y de Cube]
    L --> E[MotherDuck - escalado cloud, opcional]
    S -.Live/DirectQuery futuro: DuckDB ATTACH de solo lectura, nunca via SQLMesh.-> D
```

### 6.1 Modo import: ¿`.duckdb` puro, Parquet suelto, o DuckLake?

| Opción | Qué es | Cuándo usarla |
| --- | --- | --- |
| Archivo `.duckdb` nativo | Datos + catálogo en un solo binario | Experimentos sueltos — la plataforma no lo usa: un solo proceso, sin catálogo compartido |
| Parquet suelto (sin catálogo) | Archivos en una carpeta/bucket, sin metadata centralizada | Casos simples, pero sin ACID ni time-travel |
| **DuckLake** (el que usa la plataforma, en todos los niveles) | Parquet como almacenamiento + **catálogo en una base SQL** (PostgreSQL o SQLite — un catálogo en archivo `.duckdb` no se soporta, §6.7), en vez de metadata dispersa en archivos como hacen Iceberg/Delta | Siempre: versionado/*time travel*, varios escritores con catálogo PostgreSQL, refrescos frecuentes con cambios pequeños |

DuckLake llegó a v1.0 producción-ready en abril 2026 — con apenas 5 meses de historial en producción al momento de este documento, vale la pena tenerlo presente como una madurez todavía joven, no la de un formato con años de uso masivo. Su ventaja central: Iceberg y Delta ya usan una base de datos para el catálogo, pero solo guardan un puntero al último snapshot — la metadata real vive en archivos por capas en object storage, y cada consulta debe leerlos secuencialmente antes de tocar el dato, agregando latencia. DuckLake mete *toda* la metadata en la base SQL, eliminando ese problema y resolviendo además el "problema de los cambios chicos" (cada insert pequeño generando un archivo nuevo) — justo el patrón de un dashboard con refrescos frecuentes.

**Regla práctica (corregida en el Paso 1):** la versión anterior recomendaba arrancar con un `.duckdb` puro y migrar a DuckLake al aparecer un segundo escritor. La plataforma usa DuckLake desde el primer día, en los tres niveles: catálogo SQLite en el portátil (un proceso escritor, §6.6) y PostgreSQL en equipo local y nube. Cambiar de catálogo es configuración, no código (§6.7). MotherDuck ofrece DuckLake gestionado (storage, catálogo y cómputo escalables por separado) como capa de conveniencia opcional — nunca como dependencia dura, para mantener la regla de "open source primero".

### 6.2 Import (Lakehouse) vs. Live/DirectQuery — dos caminos distintos, nunca el mismo *hot path*

**Corrección de dos errores reales, señalados en una revisión posterior — uno de rol de herramienta, y uno estructural más serio.**

**Error 1 — `pg_duckdb` estaba mal ubicado.** No es un conector genérico para que *nuestro* DuckDB consulte un Postgres externo — es exactamente lo contrario: una extensión que instala DuckDB **dentro** del propio proceso de Postgres (útil solo si controlamos ese Postgres y podemos instalarle extensiones, ej. una base operativa propia). Para que nuestro DuckDB (capa 1) consulte un Postgres cualquiera, el mecanismo correcto — verificado contra la documentación oficial — es la **extensión `postgres` de DuckDB, con `ATTACH ... (TYPE POSTGRES)`**. Las funciones viejas (`postgres_attach`, `postgres_scan`) están deprecadas a favor de `ATTACH`.

**Error 2, más serio — DirectQuery estaba dibujado hacia la capa equivocada.** La versión anterior sugería que una fuente en vivo pasaba "hacia la capa de transformación" — eso implicaría que SQLMesh corre en el camino de una consulta interactiva, lo cual nunca puede pasar: **SQLMesh no está en el *hot path* de un click de usuario.** Son dos caminos completamente separados:

```
IMPORT / LAKEHOUSE (el camino normal, el único soportado oficialmente en el MVP)
Directo:       fuente certificada ──SQLMesh/DuckDB──► DuckLake: resultado analítico ──► Cube ──► Visual
Con ingesta:   fuente ──dlt──► landing mínimo ──SQLMesh/DuckDB──► DuckLake: resultado analítico ──► Cube ──► Visual
(política de materialización: 02-transformacion.md §6.1.1 — sin RAW persistente por defecto)

LIVE / DIRECTQUERY (capacidad futura/experimental — no del MVP)
Visual ──► Cube ──► DuckDB ──► ATTACH de solo lectura de una fuente registrada ──► Postgres/MySQL en vivo
(sin SQLMesh, sin landing, sin DuckLake materializado)
```

En el camino Live, SQLMesh nunca aparece — DuckDB consulta la fuente operativa directo, en el momento de la consulta, vía `ATTACH`. Es una arquitectura genuina pero distinta, con sus propios problemas por resolver (latencia de la fuente operativa, no incrementalidad, sin *pre-aggregations* de Cube Store aplicables de la misma forma) — **por eso el MVP declara Import/Lakehouse como el camino soportado oficialmente, y DirectQuery como capacidad futura, en vez de prometer algo cuya arquitectura todavía no está terminada.**

**Los mecanismos de conexión en vivo, en orden de prioridad, para cuando DirectQuery se construya:**

1. **Extensión `postgres` de DuckDB** (`ATTACH ... TYPE POSTGRES`) cuando la fuente es Postgres estándar — el camino normal, no `pg_duckdb`.
2. **Scanners nativos de DuckDB** (`mysql_scanner`, etc.) para otras fuentes con atajo nativo.
3. **ADBC** para todo lo demás (SQL Server, Snowflake, BigQuery, Trino) — mismo mecanismo ya elegido en la capa de ingesta (`03-ingesta.md`), reutilizado acá.
4. **`pg_duckdb`** queda como optimización opcional, solo cuando controlamos el Postgres fuente y tenemos permiso de instalarle extensiones — nunca como el mecanismo por defecto.

### 6.3 Cuándo agregar ClickHouse (no en vez de, sino además)

Si el caso de uso exige cientos de usuarios concurrentes con SLA de latencia estricto sobre datasets muy grandes, ClickHouse (Apache 2.0, escala horizontal real) se agrega como motor de *serving* detrás del semántico — no reemplaza a DuckDB, convive con él para esa carga específica.

**Nota de reevaluación futura, no una decisión de arquitectura actual: DuckDB 2.0 ("Cyanoptera") puede cambiar este cálculo, pero todavía no está listo.** Verificado: DuckDB anunció el 17 de agosto de 2026 la vista previa de su versión 2.0, que agrega **modo servidor** (la extensión `Quack`, ya disponible como extensión core desde DuckDB 1.5.3, pasa de beta a protocolo 1.0 estable recién con el 2.0) y **I/O asíncrono** — el propio DuckDB Labs lo describe como "el año de DuckDB como servidor", después de "el año del lakehouse". Al momento de este documento, DuckDB 2.0 está en fase alfa, con release proyectado para la **segunda mitad de octubre de 2026** — todavía no es una versión estable.

**Por qué esto no se adopta ahora, y qué condición dispara la reevaluación:** la regla 6 de `CLAUDE.md` exige madurez verificada en producción, no software experimental — un modo servidor recién saliendo de alfa no la cumple. Además, aunque DuckDB 2.0 llegue a versión estable, **eso no significa que Cube lo soporte automáticamente**: el driver de DuckDB de Cube todavía tiene trabajo pendiente de actualización (ver `17-self-service-calculations.md`, sección 3.2.2) y no hay confirmación de que vaya a adoptar el protocolo Quack para conectarse en modo servidor en vez de embebido. **Se reevalúa esta sección cuando se cumplan las dos condiciones a la vez: DuckDB 2.0 llegue a versión estable, Y el driver de Cube confirme soporte del modo servidor** — recién ahí tendría sentido probar si DuckDB en modo servidor reduce la necesidad de ClickHouse para cargas de concurrencia media, no antes.

### 6.4 SQL Server y MariaDB: dónde encajan (y dónde no)

Ninguno de los dos es candidato a motor del corazón: SQL Server es propietario (viola la regla de código abierto) y MariaDB es un motor de filas (OLTP), no columnar. Ambos solo tienen sentido como **fuentes** a las que se les pega vía la extensión `postgres`/`mysql_scanner` de DuckDB o ADBC (sección 6.2) — nunca como el motor analítico en sí.

### 6.5 Tres escritores concurrentes (CDC, SQLMesh, Input Tables) — investigado, mayormente resuelto

**Una revisión externa marcó como riesgo no examinado que este proyecto tiene, en la práctica, procesos que pueden escribir al mismo tiempo:** el CDC de dlt (capa 3, escribiendo su log de cambios en el landing), el `plan`/`run` de SQLMesh (capa 2, escribiendo físicamente solo a `mart_*` — `stg_*`/`int_*` son vistas lógicas por defecto, sección 6.1.1 de `02-transformacion.md`, y una vista no escribe ningún archivo, así que no participa de este problema en absoluto), y las escrituras en vivo de Input Tables (capa 2, sección 9, escribiendo a `raw_input_*`). Vale la pena separar qué de esto ya está resuelto por diseño y qué queda como pendiente real.

**Lo que ya está resuelto, y por una razón concreta:** DuckLake usa **control de concurrencia optimista a nivel de catálogo**, no a nivel de archivo — cada escritor sube sus Parquet a object storage de forma independiente y recién al final hace una transacción corta contra el catálogo para registrarlos. Los **appends nunca generan conflicto, ni siquiera sobre la misma tabla**, y los commits que no chocan (por ejemplo, escrituras a tablas distintas) se resuelven automáticamente con reintentos — DuckLake sostiene del orden de 100 transacciones por segundo a nivel de catálogo. Como los escritores físicos reales de este proyecto (CDC → su landing, SQLMesh → `mart_*` y los intermedios que se justifiquen, Input Tables → `raw_input_*`) tocan **conjuntos de tablas disjuntos**, y las vistas intermedias no escriben nada, el escenario de "escritores pisándose" descrito en la crítica casi no ocurre en la práctica.

**Lo que sí queda como riesgo genuino, y hay que diseñarlo:** un conflicto real de concurrencia optimista ocurre cuando dos escritores intentan **modificar (no agregar) la misma fila** al mismo tiempo — por ejemplo, dos usuarios editando el mismo valor de forecast en Input Tables en el mismo instante. Ese caso sí puede fallar con un error de conflicto, y la mitigación es responsabilidad de la Capa 6 (API Gateway), no de esta capa: el procedimiento de escritura de Input Tables (capa 6, sección 9.1) debe reintentar automáticamente con backoff ante un conflicto de commit, usando los parámetros que DuckLake ya expone para esto (`ducklake_max_retry_count`, `ducklake_retry_wait_ms`, `ducklake_retry_backoff`) — no hay que inventar un mecanismo de colas ni de locking propio.

### 6.6 Catálogo SQLite: límite multi-proceso medido, y su remedio

El catálogo SQLite existe para el nivel **portátil** (un solo desarrollador, un solo proceso que escribe); el catálogo **PostgreSQL** es el primario y el único para escritura concurrente real. La documentación de DuckLake dice que, con SQLite, su modo por defecto (ATTACH/DETACH por consulta más un *retry time-out* ante el bloqueo de escritura) da *"a reasonable amount of multi-processing support"*. Se midió en la Fase 0 del Paso 1 (septiembre 2026; Windows 11, DuckDB 1.5.5, extensión `ducklake` `d8a1881e`, journal por defecto de SQLite, sin reintentos de la aplicación):

| Escenario | Resultado |
| --- | --- |
| **Cadencia realista**: un escritor cada 2 s + un lector cada 1 s; o dos escritores cada 2 s | **5/5 corridas por escenario sin errores** y sin operaciones de más de 1 s — lo documentado se cumple |
| **Contención alta**: lector cada 25 ms mientras se escribe, o escritores sin pausa | Fallos `database is locked`; **el proceso que pierde puede quedar sin poder usar el catálogo** (sus reintentos y lecturas siguen fallando) hasta reiniciarse. Nunca se corrompió nada: el proceso siguiente recupera el catálogo con el *journal* de SQLite, sin datos parciales |
| **Transacción explícita larga** de varias sentencias + otro escritor | Cascada: falla también el `COMMIT` de quien tenía la transacción; el bloqueo dura hasta que termina el proceso |

**Remedio:** reiniciar el proceso afectado; si hay más de un proceso escribiendo con frecuencia, o más de un usuario, usar el catálogo **PostgreSQL**.

**Consecuencias de diseño** (Paso 1): el puerto administrativo serializa las escrituras dentro del proceso y no ofrece transacciones explícitas de varias sentencias; ante `database is locked` reintenta con un presupuesto acotado y, si se agota, falla con ese remedio en el mensaje. **No se activa el modo WAL de SQLite:** en las pruebas de contención alta eliminó los fallos, pero activarlo exige `node:sqlite` (Stability 1.1 en Node 24) y a cadencia realista no hace falta — queda como opción documentada si el uso real lo pidiera. Los scripts de la medición fueron exploratorios y no forman parte del repositorio: esta tabla es el registro de sus resultados.

### 6.7 Cómo abre la plataforma el lakehouse (implementado en el Paso 1)

`packages/warehouse` es el único lugar del código que ve DuckDB: un adaptador (`src/adapters/duckdb/`) detrás de dos puertos propios (§7). Todo lo que sigue se midió en la Fase 0 del Paso 1 (DuckDB 1.5.5, extensión `ducklake` d8a1881e) antes de programarlo.

**Catálogos soportados — dos, con un único camino de código:** `ATLASBI_LAKEHOUSE_CATALOG_TYPE = postgres` (por defecto; base `lakehouse` en el Postgres local, escritura concurrente real) o `sqlite` (portátil, un proceso escritor — límite y remedio en §6.6). Un catálogo en archivo DuckDB se rechaza en la configuración: DuckLake lo limita a un solo cliente. Los datos van a `.data/lakehouse/<tipo>/files` por defecto, una carpeta por tipo de catálogo.

**Extensiones sin red en runtime.** `pnpm bootstrap` instala `ducklake`, `postgres` y `sqlite` en `.data/duckdb/extensions` (las tres siempre, para que cambiar de catálogo no necesite Internet) — nunca en `~/.duckdb`. Toda instancia se crea con `autoinstall_known_extensions=false`, `autoload_known_extensions=false` y `allow_unsigned_extensions=false`: con los *defaults*, DuckDB descarga en silencio una extensión que falta. Si falta una, el error es `extension_missing` en milisegundos, con el remedio, sin intentar descargar nada. **Esto vale también para tests y scripts**: durante el Paso 1, una instancia de prueba creada con los *defaults* descargó una extensión en la carpeta global del usuario (se borró y los tests usan ahora un helper sin red).

**Inicialización.** Una vez por instancia (el `ATTACH`, los `LOAD`, los secrets y los `SET` sin calificar son de toda la instancia): `LOAD` → `SET GLOBAL TimeZone='UTC'` (no se acepta como opción de creación) y los reintentos de DuckLake fijados explícitamente → secret del catálogo → `ATTACH` → refuerzo de solo lectura. Por conexión, solo `USE lake` — lo único que una conexión nueva no hereda, y que sigue funcionando después de `lock_configuration`. El SQL de la plataforma usa siempre nombres calificados (`lake.<schema>.<tabla>`).

**Credenciales.** La URL del catálogo PostgreSQL (secreto `lakehouse.catalog-url`) nunca viaja en el `ATTACH`: DuckDB repite la cadena de conexión, contraseña incluida, en sus errores. Se parsea a un `CREATE TEMPORARY SECRET` y se adjunta con `META_SECRET`. Además, todo mensaje que sale del adaptador pasa por una redacción de credenciales. Una URL con parámetros (p. ej. `sslmode`) se rechaza en vez de ignorarlos en silencio.

**`ATTACH` sin *defaults* peligrosos.** Con los *defaults* de DuckLake, un error de configuración crearía un lakehouse vacío (`CREATE_IF_NOT_EXISTS` true) o escondería los datos (`OVERRIDE_DATA_PATH` true). El runtime pasa siempre `CREATE_IF_NOT_EXISTS false` y `OVERRIDE_DATA_PATH false`, y nunca `AUTOMATIC_MIGRATION`. Solo `provisionLakehouse()` —que corre únicamente desde `pnpm bootstrap`— puede crear un lakehouse; es idempotente. Con catálogo SQLite, el runtime ni siquiera intenta el `ATTACH` si el archivo no existe (SQLite lo crearía vacío). Leer un lakehouse copiado o montado en otra ruta es una opción explícita por proceso (`overrideDataPath`), nunca un *default*, y no persiste nada en el catálogo.

**Solo lectura reforzada en el motor.** El puerto de lectura adjunta `READ_ONLY` y después, en este orden, `allowed_directories` (la carpeta de datos), `allowed_paths` (el archivo SQLite), `enable_external_access=false` y `lock_configuration=true`. Encima, un *allowlist*: exactamente **una** sentencia de tipo `SELECT` (primero por la palabra clave inicial, después por el tipo de la sentencia preparada, sin ejecutarla); todo lo demás es `read_only_violation` — incluido lo que un `READ_ONLY` todavía permite (`DETACH`, `CREATE SECRET`, `SET`, tablas temporales). **Residual aceptado para la plataforma, y bloqueante antes del SQL Lab:** un `SELECT` todavía puede leer las tablas internas del catálogo, los Parquet de la carpeta de datos y `duckdb_secrets()` (contraseña redactada). La lista única de lo que hay que resolver antes del SQL Lab está en `08-frontend.md` §10.3; un test fija el residual para que no crezca sin que nadie lo note.

**Política *Inlining v1*.** El umbral de *data inlining* (10 filas) se persiste en el catálogo al aprovisionar, así que todo escritor —plataforma, SQLMesh, dlt— obedece la misma regla aunque su cliente diga otra cosa (medido: gana sobre el `ATTACH` y sobre el *default* de DuckDB). Las cargas masivas van directo a Parquet; las escrituras chicas quedan en el catálogo hasta un vaciado **explícito** (`LakehouseAdminPort.flushInlinedData()`: al final de `pnpm seed` hoy, programado por Airflow en el Paso 8). Los lectores, incluidos los `READ_ONLY`, ven esas filas. El *health* informa cuántas quedan sin vaciar. Los tests aseveran con consultas y con metadata de DuckLake, nunca por la existencia de archivos Parquet.

**Errores.** Un único `LakehouseError` con `code` cerrado (`extension_missing`, `catalog_unreachable`, `catalog_format_mismatch`, `data_path_mismatch`, `query_failed`, `read_only_violation`, `write_conflict`, `catalog_busy`, `engine_closed`), `retryable` y un `remedy` cuando hay algo que hacer. El mapeo se construyó con los mensajes textuales del motor capturados en la Fase 0, que son los *fixtures* de sus tests. Un `timeoutMs` vencido cancela la consulta y responde `query_failed` con `retryable: true` — a diferencia de una sentencia inválida, que es `query_failed` no reintentable.

**Telemetría.** Un span `CLIENT` y una medición de `db.client.operation.duration` por sentencia, solo con convenciones estables (`db.system.name="duckdb"`, `db.namespace="lake"`, `db.operation.name` por la palabra clave inicial, `error.type` con el `code`) más el atributo propio `lakehouse.catalog_type`. Nunca el texto SQL, literales, parámetros, mensajes del motor ni credenciales.

### 6.8 Retención del lakehouse — explícita y configurable (sección canónica)

**DuckLake no borra nada por sí mismo.** Cada commit crea una versión nueva de las tablas que toca (*time travel*), y los archivos Parquet que una tabla deja de usar —porque se reemplazó, se borraron filas o se compactó— **siguen en disco** mientras alguna versión retenida los referencie. Medido en el Paso 1: después de dos `pnpm seed` sobre el mismo lakehouse, `fixture/sales_orders` tiene 20.000 filas pero **dos** archivos Parquet. Sin una política de retención, "no duplicar datos" (`02-transformacion.md` §6.1.1) se cumple en el diseño lógico y no en el disco. Un modelo `FULL` de SQLMesh, que reescribe su tabla en cada `run`, lo haría notar enseguida.

> **DuckLake retention is explicit and configurable.**

La política cubre cuatro operaciones de mantenimiento de DuckLake (nombres según la documentación de DuckLake 1.0; se verifican con la versión fijada antes de programarlas):

| Operación | Qué hace | Efecto |
| --- | --- | --- |
| Expirar versiones (`ducklake_expire_snapshots`) | Marca como expiradas las versiones más viejas que el umbral | Ya no se puede hacer *time travel* a ellas; sus archivos exclusivos quedan elegibles para borrarse |
| Limpiar archivos viejos (`ducklake_cleanup_old_files`) | Borra los archivos que solo usaban versiones expiradas, pasado un umbral de seguridad | Libera el espacio de verdad |
| Limpiar huérfanos (`ducklake_delete_orphaned_files`) | Borra archivos de la carpeta de datos que el catálogo no conoce (p. ej., escrituras interrumpidas) | Evita basura invisible |
| Compactar (`ducklake_merge_adjacent_files`, y la reescritura de archivos con muchos borrados) | Junta archivos chicos y reescribe los muy fragmentados | Rendimiento de lectura; genera versiones nuevas, que la misma política expira después |

**Política:**

- **Desarrollo** usa un *default* razonable: 7 días de *time travel*.
- **Producción** es configurable por política, no una constante del producto: se fija por instalación y, si hace falta, por tabla. **La política concreta de producción se cierra antes de depender de ella operacionalmente.**
- El mantenimiento **es una operación administrativa explícita**, igual que el vaciado de *Inlining v1* (§6.7): nunca un efecto de leer ni de escribir. Se ejecuta a través del puerto administrativo —hoy `LakehouseAdminPort` no la ofrece: agregarla es un cambio de contrato versionado— y la programa Airflow en el Paso 8 (`07-orquestacion.md`).
- La retención de versiones **no reemplaza a un snapshot**. Si una fuente necesita historia más allá de la ventana de *time travel* —auditoría, regulación, reproducibilidad—, eso es un snapshot con motivo y retención propios (`02-transformacion.md` §6.1.1), no un umbral de expiración más largo.

---

## 7. Contrato de esta capa (qué expone, qué consume)

- **Consume**: archivos Parquet/CSV/Iceberg ya depositados en object storage por la capa de ingesta.
- **Expone**: una conexión SQL estándar (protocolo DuckDB o el conector de MotherDuck) — nada de HTTP directo al frontend. La capa de transformación y la capa semántica son las únicas que hablan directo con este motor.
- **Expone a la plataforma TypeScript (implementado en el Paso 1)** dos puertos propios en `@atlasbi/contracts`, nunca un tipo de DuckDB (`21-engineering-standards.md` §3):
  - **`AnalyticalQueryPort` v1** — solo lectura, para *health*, lectores y el futuro SQL Lab: `query(statement, parameters?, { maxRows?, timeoutMs? })` → `QueryResult`, `capabilities`, `close()`. **No tiene `execute`.**
  - **`LakehouseAdminPort` v1** — administración y escritura (seed, mantenimiento, futuras Input Tables): `execute(statement, parameters?)` → `{ affectedRows }` (una sentencia por llamada, sin transacciones explícitas), `checkHealth()`, `flushInlinedData()`, `close()`. `capabilities.concurrentWriters` es `false` con catálogo SQLite.
  - **`QueryResult` sin pérdida:** `{ columns: [{ name, type }], rows, rowCount, truncated }`, con filas posicionales (los nombres de columna duplicados son SQL válido) y un `LogicalType` propio. Enteros de 64/128 bits y `DECIMAL` siempre como string (el decimal con exactamente su escala); `float` como número, con `NaN`/`±Infinity` como string; `TIMESTAMP` como `2026-09-23T12:34:56.123456`, sin zona ni `Z`; `TIMESTAMPTZ` en UTC con `Z`, calculado desde el instante y no desde la zona de la sesión; `INTERVAL` como `{ months, days, micros }` con `micros` string; `BLOB` en base64; listas, structs y mapas con las mismas reglas. Los parámetros se enlazan por posición y aceptan string para `bigint` y `decimal`. Por defecto se leen hasta 10.000 filas (`DEFAULT_QUERY_MAX_ROWS`).
  - Las baterías de contrato de los dos puertos (`@atlasbi/contracts/testing`) son las que cualquier adaptador futuro tiene que pasar.
- **No expone**: ninguna noción de "métrica" ni "medida" — eso vive exclusivamente en la capa semántica (documento 04).

---

## 8. Por dónde empezar a construir (paso a paso concreto)

1. Instalar DuckDB localmente (`pip install duckdb` o el binding de Node) — sin infraestructura, corre en tu máquina.
2. Tomar una fuente real tuya (un CSV o export de una fuente actual) y cargarla como Parquet en una carpeta local o un bucket de prueba.
3. Verificar que DuckDB puede leerla directo (`SELECT * FROM read_parquet('ruta')`) sin pasos de import intermedios.
4. Medir tiempos de una consulta agregada típica (la que hoy tarda en Power BI) para tener una línea base de comparación real, no teórica.
5. Solo cuando el volumen lo justifique, evaluar MotherDuck para el mismo dataset sin cambiar el SQL.

Este paso es la base de todo lo demás — la capa de transformación (documento siguiente) se construye directamente encima de esto.

---

**Siguiente documento:** `02-transformacion.md` — dbt/SQLMesh reemplazando Power Query (M).
