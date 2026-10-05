# Changelog

Versionado del producto según [`docs/21-engineering-standards.md`](docs/21-engineering-standards.md)
§2: SemVer `0.MINOR.PATCH` hasta 1.0; los contratos (API, Report Schema, Config Schema, DB
Migration…) versionan por separado y se listan en cada release.

## Unreleased

Primera tanda de la auditoría de aislamiento entre capas (2026-10-04): reemplazar una herramienta
no debería tocar a sus vecinos.

### Cambiado

- **`createSemanticRuntime({ config, secrets })`**, la fábrica pública de `@atlasbi/semantic`.
  Decide el motor y si hay capa semántica en el despliegue. La Gateway ya no nombra a Cube ni
  conoce la regla de niveles, y `createCubeSemanticRuntime` deja de exportarse.
- **`config.semantic.enabled`:** la regla "la capa semántica corre solo en el nivel equipo
  local" vive ahora en un solo lugar (`semanticLayerRuns`). La usan también `semanticSecretKeys`.

### Agregado

- **Baterías de contrato de identidad** en `@atlasbi/contracts/testing`:
  - `describeIdentityPortContract`: usuarios, organizaciones, inicio de sesión, el token de
    identidad (solo `sub` y `org`, como mucho 15 minutos, rechazo de uno adulterado, sin firma o
    de otro despliegue) y el cierre de sesión.
  - `describeIdentityHttpContract`: las tres operaciones, las respuestas limpias, el `Origin` y los
    atributos de la _cookie_.
- **El adaptador de better-auth corre las dos baterías.** Sus tests propios quedan solo para lo
  que es suyo: EdDSA, emisor y audiencia, el nombre de la _cookie_ y el token que sigue válido
  después de cerrar la sesión.
- **Contratos de datos** (`docs/21` §2.4): archivos JSON propios y versionados en
  `packages/contracts/data/`, con los tipos de la plataforma (`LogicalType`), nunca los de un motor.
  - `parseDataContract` rechaza las columnas propias de una herramienta (`_dlt_*`) y exige
    `_load_id` y `_loaded_at` en un contrato de landing.
  - Los productores verifican con los datos lo que publican, con `findDataContractViolations`: el
    dataset de desarrollo en `warehouse` y el mart en `transform`.
  - `semantic` corre sus tests sobre un mart generado desde el contrato, y su modelo de Cube solo
    puede leer tablas de contratos que declara.
  - `external_models.yaml` de SQLMesh tiene que coincidir con el contrato de la fuente.

### Contratos

- **Contratos de datos nuevos:** `mart.sales_orders` 1.0 y `source.development_sales_orders` 1.0.

## 0.5.0 — API Gateway (2026-10-05)

Paso 5 del orden de construcción: la API Gateway. El navegador tiene un único punto de entrada:
inicia sesión, obtiene un token de identidad y consulta métricas. El gateway verifica la identidad
en cada llamada, resuelve el contexto de seguridad por workspace y le pide los datos a la capa
semántica por un puerto propio, sin conocer el motor. Dos personas con el mismo rol en el mismo
workspace ven datos distintos, verificado por HTTP de punta a punta.

### Agregado — puerto semántico (`SemanticRuntimePort` 1.0)

- **El contrato, en `@atlasbi/contracts`:**
  - `SemanticQuery` v1: medidas, dimensiones, dimensiones de tiempo con granularidad y rango,
    los 12 operadores del Filter AST (`docs/14` §1.1), orden y un límite de 1 a 10.000 filas.
  - `SemanticResult`: columnas y filas posicionales, con todo número como el string exacto del
    motor, más `rowCount` y `truncated`.
  - `SemanticModel` (lo que un contexto puede consultar) y capacidades por nombre, nunca por
    motor (`docs/21` §3.4).
  - `SemanticRuntimeError`, con cuatro códigos cerrados y `retryable`. Un miembro inexistente y
    uno que el contexto no puede usar fallan igual: sin oráculo.
- **El adaptador de Cube, `createCubeSemanticRuntime`, en `@atlasbi/semantic`.**
  - Por consulta: metadata visible para ese contexto, validación y recién después los datos,
    con `limit + 1` filas.
  - Devuelve solo datos: Cube repite la consulta efectiva con los filtros de RLS y sus valores.
  - Nunca pide `meta?extended=true`, que expone el SQL del modelo (`docs/04` §6.6).
- **Batería de contrato** `describeSemanticRuntimePortContract`, independiente de los datos.
  El adaptador de Cube la pasa contra un stack propio.

### Agregado — `@atlasbi/api-gateway` (Fastify 5.12.5 + tRPC 11.19.0)

- **Procedimientos:** `session.me`, `semantic.meta` y `semantic.query` (`docs/06` §7).
  - Identidad en cada llamada, con `Authorization: Bearer` y verificación local.
  - Contexto de seguridad por workspace y por llamada, sin caché.
  - El mismo `FORBIDDEN` para toda denegación.
  - El frontend importa el tipo `AppRouter` (Paso 6).
- **Identidad por HTTP: tres rutas y nada más** (`docs/06` §6.4). Las demás rutas de
  better-auth, que permiten crear organizaciones o listar sesiones con sus _tokens_, no son
  alcanzables.
  - `Origin` obligatorio en los POST.
  - El limitador de better-auth se apaga y el gateway limita el inicio de sesión: 10 intentos
    por minuto por IP y 5 fallos cada 15 minutos por cuenta (`docs/06` §6.3).
- **Endurecimiento** (`docs/06` §6.5):
  - tRPC: sin _stack_ ni mensaje interno, _batch_ de hasta 10, solo POST y cuerpo de hasta 1 MB.
  - 404 y 500 neutros, CSP `default-src 'none'`, `no-store` y sin CORS.
  - Escucha solo en `127.0.0.1`.
- **Trazas OpenTelemetry** de Fastify, `pg` y las llamadas a Cube:
  - sin _query string_, sin valores de SQL y sin cabeceras;
  - el `traceparent` del cliente se ignora.
- **`/health` y `/ready`.** `/ready` depende solo de la base de la plataforma.
- **`@atlasbi/auth`:** `IdentityHttpHandler` sobre better-auth (`createBetterAuthHttp`), y en el
  directorio de acceso, `listMemberships` y `ping`.

### Agregado — `pnpm dev`

- **Arranca la API Gateway** con `node --watch`, después de la infraestructura.
  - El paso `API Gateway` de la cadena espera `/ready`.
  - Si el gateway no arranca, el paso falla enseguida con la línea del error.
- **Queda en primer plano** con la salida del gateway.
  - Ctrl+C lo detiene, junto con el proceso que corre `node --watch`.
  - La infraestructura sigue corriendo.
- **`pnpm preflight` revisa el puerto 4100.**
- **La sonda de Cube usa `ATLASBI_SEMANTIC_URL`**, la misma dirección que el gateway.
- `pnpm stack:up` no cambia: la imagen del gateway llega en el Paso 6.

### Medido

- **`/v1/cubesql` autentica con `checkAuth`, no con `checkSqlAuth`.** La hipótesis anterior de
  `docs/17` §3.2.3 era incorrecta (`docs/17` §3.2.4).
- **Costo por request por HTTP** (`docs/06` §6.6):
  - `session.me`: 2,7 ms de p50.
  - `semantic.query`: 24 ms de p50 cuando la responde la caché de Cube, 66 ms si no.
  - Sin caché de metadata: ahorraría 2–3 ms y arriesgaría servir permisos viejos.
- **Dos huecos nuevos de Cube** (`docs/17` §3.2.2):
  - Las medidas derivadas que responde Cube Store se truncan a 6 decimales.
  - Un `OR` con una constante siempre verdadera termina en _panic_, igual en 1.7.45 y en 1.7.50.
    Es `cube-js/cube#7880`, que evolucionó.
- **better-auth apaga su chequeo de `Origin` con `NODE_ENV=test`.** Ahora queda encendido de
  forma explícita.

### Contratos

- **Config Schema v5 → v6:** `ATLASBI_GATEWAY_PORT`, `ATLASBI_PUBLIC_URL` y
  `ATLASBI_SEMANTIC_URL`, con valores por defecto. Un `.env` existente sigue funcionando.
- **Contratos nuevos:**
  - `SemanticRuntimePort` 1.0, con `SemanticQuery` v1 y `SemanticResult`.
  - `IdentityHttpHandler` 1.0 (`IDENTITY_HTTP_VERSION`), con las operaciones `sign-in`,
    `sign-out` y `token`.
- **Sin cambios:** `IdentityPort` 1.0, `SecurityContext` 1.0, el token de consulta hacia Cube y
  las migraciones (`000002`).
- **La API pública** sigue sin procedimientos: `/api/v1` queda reservado. El BFF de tRPC es
  interno y no se versiona como API pública.

### Corrección

- **`docs/17` §8** todavía nombraba `semantic.sql-password`, retirado en `0.4.0`.
- **`docs/13`, paso 4:**
  - El adaptador de Cube vive en `@atlasbi/semantic`, no en la Gateway.
  - El procedimiento es `semantic.query`.
  - Los tipos generados desde `/meta` no se adoptaron: la validación es en tiempo de ejecución,
    contra lo que cada contexto puede ver.
- **`docs/06` §1.1:** better-auth no se monta como plugin.

## 0.4.0 — identidad y autorización (2026-09-27)

Paso 4 del orden de construcción: identidad y autorización. Con él, dos usuarios ven recortes
distintos de la misma métrica. La cadena es la misma que la API Gateway va a recorrer en cada
request en el Paso 5, y ya está verificada de punta a punta (`docs/16`: el RLS del MVP).

### Agregado — identidad (better-auth 1.7.6)

- **`@atlasbi/auth`**, con el puerto propio `IdentityPort` (`@atlasbi/contracts`): ningún tipo
  de better-auth sale de su adaptador, y ESLint impide importarlo fuera de él.
  - Usuarios con email y contraseña (12 a 128 caracteres).
  - **Sin registro público:** los usuarios los crea una acción de administración (decisión D5).
  - Organización con el plugin `organization`, sin _teams_ ni invitaciones.
  - Sesiones.
- **Token de identidad verificable localmente.**
  - Lleva **solo** `sub` (el usuario) y `org` (la organización), más `iss`, `aud`, `iat` y `exp`.
    Nunca un rol ni un permiso sobre datos (`docs/09` §7); cualquier _claim_ extra lo invalida.
  - EdDSA, 15 minutos de vida, con las claves en la base y la privada cifrada con
    `auth.secret`.
  - Sin `definePayload`, better-auth metería el usuario entero en el token: un test lo impide.
- **Superficie mínima.**
  - Solo los plugins `organization` y `jwt`. El plugin `admin` queda afuera: con solo activarlo
    expondría por HTTP unos 20 endpoints `/admin/*` (medido).
  - Telemetría apagada: ninguna llamada de red, medido en los tests.

### Agregado — autorización propia

- **`resolveSecurityContext`:** resuelve por separado el rol (qué puede hacer) y los permisos
  sobre datos (qué puede ver), y los combina en `SecurityContext` v1.
  - Deniega un workspace inexistente, uno de otra organización (aunque haya una fila de
    membresía ahí) y a quien no es miembro.
  - Deniega por defecto: una dimensión protegida sin concesión no se ve. "Todos los valores" es
    una concesión explícita.

### Agregado — RLS en Cube

- **Políticas de acceso en el modelo** (`sales_orders` y `regions`) con los grupos
  `region:listed` y `region:all`.
  - Los grupos se arman en un solo lugar, `toQueryClaims` (`@atlasbi/semantic`), a partir del
    contexto de seguridad; el rol no viaja.
  - Con una segunda dimensión protegida el código falla a propósito, por la advertencia de
    `docs/09` §6.1 sobre el OR entre grupos.
- **Token corto hacia Cube:** HS256, emisor `platform-api`, audiencia `semantic-layer`, vida de
  5 minutos como máximo.
  - Por REST, Cube lo verifica fijado a ese algoritmo, emisor y audiencia.
  - **El SQL API ya no tiene contraseña fija:** acepta el mismo token como contraseña y aplica la
    misma RLS (decisión E5).
- **Control de vencimiento en cada consulta.** Una conexión del SQL API no sobrevive a su token
  (medido: token de 6 s, conexión de 9 s), y un token sin `exp` se rechaza también por REST.
- **La sonda de `pnpm dev`** usa el grupo `readiness`, que solo ve `regions.zone`.

### Agregado — base de datos, seed y CLI

- **Las primeras migraciones reales.**
  - `000001_auth_schema.sql`: las tablas de better-auth en el esquema `auth`, generadas por su
    planificador para las opciones de la plataforma. Un test de contrato detecta cualquier cambio
    al actualizar.
  - `000002_access_control.sql`: `access.workspace`, `access.workspace_membership` y
    `access.data_entitlements`, con restricciones en la base (sin lista vacía, sin permiso sobre
    datos sin membresía).
- **`pnpm seed`** agrega la organización `demo`, los workspaces `comercial` y `finanzas`, y los
  usuarios `ana@example.com` y `bruno@example.com`: el escenario de la demo de aceptación
  (`docs/16` §4).
  - Es idempotente y valida todos los secretos antes de escribir.
  - Prueba cada acceso iniciando sesión, sin imprimir nunca la contraseña.
  - Si los usuarios ya existen con otra contraseña, lo dice y da el remedio.
- **`pnpm dev`** exige `auth.secret` y aplica las migraciones nuevas sobre la base existente: no
  hace falta `reset:local`.

### Contratos

- **Config Schema v4 → v5.**
  - Secretos nuevos: `auth.secret` (`ATLASBI_AUTH_SECRET`) y `seed.demo-password`
    (`ATLASBI_SEED_DEMO_PASSWORD`).
  - Se retira `semantic.sql-password`.
  - Un `.env` existente se completa desde `.env.example`; `ATLASBI_SEMANTIC_SQL_PASSWORD` sobra.
- **Contratos nuevos:** `IdentityPort` 1.0, `SecurityContext` 1.0 (con `DataEntitlement`:
  `all` o una lista que nunca está vacía) y `AccessDeniedError`.
- **DB Migration:** `000002`, la primera versión con tablas.
- **Token de consulta hacia Cube:** emisor `platform-api`, audiencia `semantic-layer`, ≤ 300 s,
  para REST y SQL.

### Corrección

- **`docs/04` §6.2:** el ejemplo de `access_policy` usaba `role:` y una lista anidada. En Cube
  1.7.45 es `group:` con `contextToGroups`: `contextToRoles` ni siquiera arranca.
- **`docs/09` §6.1:**
  - Advertencia explícita sobre la combinación con OR entre grupos de Cube.
  - `values` pasa a `allowed_values`, porque es palabra reservada en SQL.
- **`pnpm seed`:** con un `auth.secret` inválido, fallaba después de sembrar el dataset. Ahora
  valida todo antes de escribir.

## 0.3.0 — capa semántica (2026-09-26)

Paso 3 del orden de construcción: Cube Core sobre el lakehouse. Para que un lector en un contenedor
vea los mismos datos que la plataforma, el nivel "equipo local" pasa a guardar los datos del
lakehouse en S3 (Garage), con el mismo protocolo que en la nube.

### Agregado — Paso 3: capa semántica (Cube Core)

- **`packages/semantic`**: Cube Core 1.7.45 y Cube Store 1.7.45, fijados por digest, en el perfil
  CORE del compose.
  - Modo seguro desde el primer arranque: `NODE_ENV=production`, sin modo desarrollo y sin
    telemetría, con el secreto de API y una contraseña para el SQL API.
  - Cube Store en un nodo, con sus datos en el volumen `cube-store-data`.
- **Driver propio**, subclase del de DuckDB de Cube (`docs/04` §6.6):
  - Abre la instancia sin red y prepara el lakehouse en el mismo orden que el puerto de lectura de
    la plataforma, con `READ_ONLY` y la configuración congelada.
  - No se traga los errores: el driver original ocultaba un lakehouse caído detrás de
    `/readyz` 200 y de las pre-agregaciones.
  - El cliente recibe un error genérico, y el detalle va al log con las credenciales redactadas.
- **Cube lee como lector, nunca como escritor**: el rol del catálogo de solo `SELECT` y la clave S3
  de solo lectura.
- **Cube no tiene salida a Internet.** Vive con Cube Store en la red interna `semantic` del
  compose. Las extensiones de DuckDB que carga (`linux_*`) las instala `pnpm bootstrap` desde
  dentro de su imagen.
- **Salud real.** El paso `Cube` pide `/readyz` y además una consulta que lee una columna del
  lakehouse. `pnpm dev` muestra `Cube extensions` y `Cube healthy — answers from the lakehouse as its
reader`, y falla en el acto con el remedio si faltan las extensiones.
- **Modelo inicial**:
  - `sales_orders` sobre `marts.mart_sales_orders`: `count`, `sum`, `count_distinct`, un ratio,
    ventana móvil de 3 meses, y mes anterior y variación mes a mes (`multi_stage`).
  - La pre-agregación `amount_by_region_month`.
  - `regions`, derivado del mismo mart, para tener un join real.
- **Tests de integración herméticos**: cada suite levanta su propio Cube y Cube Store en la red
  interna, sobre un lakehouse descartable, y verifica:
  - Los números de Cube contra los del puerto de lectura de la plataforma.
  - La inteligencia de tiempo, el join, y la pre-agregación sin escribir en el lago.
  - La autenticación del SQL API, la batería de _pushdown_ y los tests de alerta.
  - Los modos de falla y la ausencia de ruta a Internet.

### Agregado — almacenamiento S3 en el nivel "equipo local"

- **Garage 2.4.1** (object storage S3-compatible, fijado por digest) en el compose. Se eligió con
  la regla 7 frente a versitygw; MinIO quedó descartado (`docs/11` §4.4). `pnpm bootstrap` crea el
  bucket y dos claves con su API de administración, a partir del `.env`: la del escritor, con
  lectura y escritura, y la de los lectores, de solo lectura.
- **`@atlasbi/warehouse` sobre S3** (`docs/01` §6.7):
  - Extensión `httpfs` y un secreto S3 acotado a la ruta de datos.
  - Errores de S3 mapeados al código nuevo `storage_unreachable`, con el remedio, y redacción de
    `SECRET` y de los parámetros `X-Amz-*`.
  - Telemetría con `lakehouse.storage_type`.
- **Credenciales de solo lectura para todo lector.** El rol `lakehouse_reader` (`ensureReadOnlyRole`
  en `@atlasbi/database`) más la clave S3 de solo lectura. Con `READ_ONLY` el motor todavía
  permite `CREATE SECRET` y `COPY … TO`: la protección real está en las credenciales. La
  verificación del lakehouse en `pnpm dev` lee un valor como lector, no un `count(*)`, que DuckLake
  responde desde las estadísticas.
- **SQLMesh sobre S3**: `pnpm transform` le pasa al proceso de SQLMesh las credenciales del
  escritor.
- **`@atlasbi/warehouse/testing`**: lakehouses descartables por nivel, con las identidades de
  escritor y de lector. Los de S3 usan `s3://lakehouse/tests/<uuid>/`, que nunca se superpone con
  los datos del desarrollador.
- **CLI por nivel**: el nivel portátil levanta solo Postgres y el OTel Collector. `pnpm preflight`
  revisa los puertos del nivel configurado y las extensiones de Cube.

### Cambiado — incompatible para los entornos de desarrollo

- **Cada nivel fija su almacenamiento**: PostgreSQL + S3 (equipo local y nube) o SQLite + carpeta
  (portátil). PostgreSQL + carpeta, el _default_ de desarrollo de `0.2.0`, ya no se soporta: un
  lakehouse de desarrollo anterior se recrea con `pnpm reset:local` + `pnpm bootstrap`.
- Un `.env` existente se completa a mano desde `.env.example`: las variables del object storage,
  las claves S3, el lector del catálogo, los puertos y los secretos de Cube.

### Contratos

- **Config Schema v3 → v4**:
  - Variables `ATLASBI_LAKEHOUSE_S3_URL`, `…_S3_ENDPOINT`, `…_S3_REGION` y `…_S3_USE_SSL`.
  - Validación del par nivel/almacenamiento.
  - Secretos nuevos: `lakehouse.catalog-reader-url`, `lakehouse.s3-writer-access-key-id`,
    `lakehouse.s3-writer-secret-access-key`, `lakehouse.s3-reader-access-key-id`,
    `lakehouse.s3-reader-secret-access-key`, `object-storage.admin-token` (solo bootstrap),
    `semantic.api-secret` y `semantic.sql-password`.
- **`AnalyticalQueryPort` y `LakehouseAdminPort` v1 → v1.1**: código de error nuevo
  `storage_unreachable` (aditivo). Las versiones de contrato pasan a expresarse como
  `"MAJOR.MINOR"`.
- DB Migration: sin cambios. El rol de lectura lo crea `pnpm bootstrap`, no una migración.
- El modelo semántico todavía no es un contrato público: el puerto `SemanticQueryPort`, que aísla
  los tipos de Cube, se diseña en el Paso 5.

### Proyecto

- **Licencia Apache-2.0** (`LICENSE`, campo `license` en cada paquete, `docs/21` §11). La auditoría
  de licencias de las dependencias embebidas queda pendiente antes del lanzamiento público
  (`docs/IMPLEMENTATION.md`).

### Corrección

- **`docs/17` §3.2.2**, la batería de _pushdown_, revalidada con el modelo real y su
  pre-agregación:
  - El remedio "usar `HAVING`" era incorrecto. Un filtro sobre una medida decimal, con orden,
    falla cuando lo responde una pre-agregación de Cube Store, en cualquier forma. Es un hueco
    conocido de 1.7.45, documentado con su test de alerta, y se retoma si aparece antes del
    Paso 11.
  - Cube sí hace post-procesamiento liviano sobre el resultado agregado, acotado por el
    `LIMIT 50000` que agrega el SQL API.
- **`pnpm test:integration` corre con `--continue`.** Sin eso, una suite que fallaba hacía que
  Turborepo cortara las demás antes de su limpieza, y dejaban contenedores, bases y objetos de
  prueba. Los tests de integración de `@atlasbi/database` usan ahora los mismos tiempos máximos que
  el resto.

## 0.2.0 — vertical slice de datos (2026-09-26)

Pasos 1 y 2 del orden de construcción: el lakehouse (DuckDB + DuckLake) y la transformación
(SQLMesh) sobre él, desde el fixture hasta el primer resultado analítico,
`marts.mart_sales_orders`.

### Agregado — Paso 2: transformación (SQLMesh)

- **`packages/transform`**: proyecto SQLMesh 0.236.2 (Python 3.13.14, entorno uv propio con
  `uv.lock` y `exclude-newer = "1 day"`, el mismo freno que pnpm) sobre el lakehouse del Paso 1.
  `staging.stg_sales_orders` (vista, sin copia de datos) → `marts.mart_sales_orders` (resultado
  analítico, incremental por fecha, grano pedido, un solo archivo: sin partición por día), con
  audits y un unit test.
- **`pnpm transform <comando>`**: la única forma soportada de correr SQLMesh. Verifica el
  lakehouse antes de que SQLMesh lo adjunte (SQLMesh crearía uno vacío en silencio sobre un
  catálogo equivocado), le pasa los secretos solo a ese proceso y resume las fallas en una línea.
  `test` y `lint` corren sin lakehouse.
- **Un state de SQLMesh por lakehouse**: esquema `sqlmesh_<identidad>` dentro de `sqlmesh_state`.
  Con un state compartido, un lakehouse que nunca construyó el mart recibía _No changes_; ahora
  un lakehouse nuevo —otro catálogo, o el mismo recreado por `reset:local` + `bootstrap`— empieza
  siempre con un state vacío (`docs/02` §6.3).
- **Identidad del lakehouse**: `provisionLakehouse()` le asigna un UUID guardado en su catálogo
  (`lake.platform.lakehouse_identity`) y `checkHealth()` lo devuelve (`docs/01` §6.7). Un
  lakehouse aprovisionado antes de este cambio pide `pnpm bootstrap`, que se la agrega.
- **`pnpm bootstrap`** prepara el entorno Python (`uv sync --frozen`, la única descarga) y la base
  `sqlmesh_state`; **`pnpm preflight`** verifica sin red que el entorno coincida con `uv.lock`.
- **Guardas de la política de materialización** (`docs/02` §6.1.2): regla propia del linter de
  SQLMesh que rechaza `ATTACH`, `INSTALL`, `SET`, secrets y `COPY` en modelos; test que rechaza
  módulos de red en modelos Python.
- **Parche temporal y experimental** para que el janitor de SQLMesh pueda borrar versiones viejas
  en DuckLake (no soporta `DROP … CASCADE`; issue SQLMesh/sqlmesh#6032, PR #6034), con un test de
  alerta que avisa cuando sobra.

### Agregado — Paso 1: motor de almacenamiento (DuckDB + DuckLake)

- **`@atlasbi/warehouse`**: DuckDB 1.5.5 embebido con DuckLake 1.0, detrás de dos puertos propios —
  `AnalyticalQueryPort` (solo lectura) y `LakehouseAdminPort` (administración/escritura). Ningún tipo
  de DuckDB sale del adaptador (ESLint lo impide fuera de `src/adapters/duckdb/`).
- **Catálogo PostgreSQL** (por defecto, base `lakehouse`, escritura concurrente real) **o SQLite**
  (portátil, un proceso escritor, con su límite medido y el remedio en `docs/01` §6.6); un catálogo
  en archivo DuckDB se rechaza.
- **Resultados sin pérdida**: enteros de 64/128 bits y `DECIMAL` como string exacto, `TIMESTAMPTZ`
  en UTC desde el instante, `TIMESTAMP` sin zona, `BLOB` en base64, filas posicionales.
- **Solo lectura reforzada en el motor** (`READ_ONLY`, acceso a archivos restringido, configuración
  congelada, un único `SELECT`); lo que falta antes del SQL Lab queda en una lista única
  (`08-frontend.md` §10.3).
- **Política _Inlining v1_** persistida en el catálogo al aprovisionar, con vaciado explícito.
- **`pnpm bootstrap`** crea la base del catálogo, instala las extensiones de DuckDB en
  `.data/duckdb/extensions` (la única descarga) y aprovisiona el lakehouse; **`pnpm dev`** lo
  verifica (`Lakehouse healthy — Catalog: …`) sin instalar, descargar ni crear nada;
  **`pnpm preflight`** revisa las extensiones y las carpetas sin red; **`pnpm seed`** (nuevo) carga
  `lake.fixture.sales_orders` (20.000 filas determinísticas); **`pnpm reset:local`** también borra
  `.data/lakehouse`.
- OpenTelemetry (solo la API): un span `CLIENT` y `db.client.operation.duration` por sentencia, con
  convenciones estables y sin SQL, literales ni credenciales.
- Credenciales del catálogo vía secret de DuckDB (`META_SECRET`), nunca en la cadena de `ATTACH`, y
  redacción de credenciales en todo mensaje de error.
- Baterías de contrato de los dos puertos en `@atlasbi/contracts/testing`; `ensureDatabaseExists` y
  `@atlasbi/database/testing` en `@atlasbi/database`.
- Política de naming del codename (`21` §1) y `PRODUCT_DISPLAY_NAME` como única fuente del nombre
  visible en la CLI.

### Contratos

- **Config Schema v1 → v2**: sección `lakehouse` (`ATLASBI_LAKEHOUSE_CATALOG_TYPE`,
  `…_DATA_PATH`, `…_SQLITE_PATH`, `ATLASBI_DUCKDB_EXTENSION_DIRECTORY`) y secreto
  `lakehouse.catalog-url` (`ATLASBI_LAKEHOUSE_CATALOG_URL`, obligatorio con catálogo PostgreSQL).
  Un `.env` existente se completa a mano desde `.env.example`.
- **Nuevos:** `AnalyticalQueryPort` v1, `LakehouseAdminPort` v1 (reemplazan al `AnalyticalEnginePort`
  que describía `21` §3), formato de catálogo DuckLake **1.0**.
- DB Migration: sin cambios (la carpeta sigue vacía hasta el Paso 4).
- **Paso 2 — Config Schema v2 → v3**: secreto `transform.state-url` (`ATLASBI_TRANSFORM_STATE_URL`),
  obligatorio para `pnpm bootstrap` y `pnpm transform` (no para `pnpm dev`). Un `.env` existente
  se completa a mano desde `.env.example`.
- **Paso 2 — `LakehouseAdminPort` v1:** `LakehouseHealth` suma `lakehouseId` (aditivo, dentro de
  la misma versión sin publicar; la batería de contrato exige un UUID estable).
- **Paso 2 — primer resultado analítico:** `marts.mart_sales_orders` (lo que leerá la capa
  semántica en el Paso 3).

### Corrección

- **Puerto de lectura (encontrado en el Paso 2):** `SELECT * FROM ducklake_flush_inlined_data(…)`
  fallaba por `READ_ONLY`, pero después de escribir un archivo Parquet huérfano en la carpeta de
  datos. El puerto de lectura ahora solo admite las funciones `ducklake_*` de consulta
  (`docs/01` §6.7), con un test que verifica que ningún ataque deja archivos nuevos.
- Los tests unitarios del warehouse dejaban una carpeta temporal vacía por corrida; ahora
  reutilizan una sola.
- La nota de 0.1.1 anticipaba que el Paso 1 usaría `node:sqlite` para aprovisionar un catálogo
  SQLite. Finalmente no lo usa: se eligió el camino sin WAL (`docs/01` §6.6).

## 0.1.1 — seguridad del runtime (2026-09-24)

PATCH (`21-engineering-standards.md` §2.1: parche de seguridad, sin cambio de capacidad ni de
contrato). Independiente del Paso 1.

### Seguridad

- **Node.js fijado en 24.21.0** (antes 24.12.0, del 10/12/2025). La versión anterior no incluía
  cuatro _security releases_ de la línea 24: 24.13.0, 24.14.1, 24.17.0 y **24.18.1** (28/7/2026).
- Correcciones relevantes para este proyecto que ahora quedan incluidas:
  - **undici** actualizado a 7.29.x (el runtime reporta 7.29.1): es el cliente HTTP detrás de
    `fetch`, que usa la CLI de plataforma (health checks).
  - **CVE-2026-58041** (Medium): `node:sqlite` — un iterador de `SQLTagStore` podía re-ejecutar
    escrituras. Relevante porque el Paso 1 usará `node:sqlite` al aprovisionar un catálogo SQLite.
  - **llhttp** 9.4.3 (CVE-2026-58044, _request smuggling_ por truncado de cabeceras), y el resto
    del aviso de julio de 2026 (HTTP/2, HTTPS Agent, Permission Model, `dns`, `zlib`):
    <https://nodejs.org/en/blog/vulnerability/july-2026-security-releases>.
- Instalado desde el MSI oficial de nodejs.org con SHA-256 verificado contra `SHASUMS256.txt` y
  firma Authenticode válida de OpenJS Foundation (winget solo ofrecía hasta 24.19.0).

### Contratos

Sin cambios.

## 0.1.0 — bootstrap (2026-09-23)

Paso 0 del orden de construcción (`CLAUDE.md`): un entorno de desarrollo "equipo local mínimo"
que se reproduce desde cero con `pnpm install` + `pnpm bootstrap`.

### Agregado

- Monorepo pnpm 11 + Turborepo con versiones fijadas en un único `catalog`
  ([`docs/versions.md`](docs/versions.md) justifica cada una con evidencia).
- Infraestructura local en `compose.yaml` (Compose Spec, vía `podman compose`): PostgreSQL 17.11
  y OpenTelemetry Collector 0.161.0 (core), con puertos publicados solo en `127.0.0.1`.
- `@atlasbi/contracts`: puerto `SecretProvider` + batería de contract tests reutilizable que todo
  adaptador debe pasar.
- `@atlasbi/config`: configuración validada al arrancar (falla rápido listando todo lo que falta) y
  adaptador `EnvSecretProvider`.
- `@atlasbi/database`: `pg` + Kysely + Kysely Migrator con migraciones `.sql` forward-only
  (carpeta vacía hasta el Paso 4).
- `tools/platform-cli`: `pnpm preflight`, `bootstrap`, `dev`, `stack:up|down|logs`,
  `reset:local`, con una cadena de readiness que dice qué pieza falló y por qué.
- Selección del compose provider por proceso: la CLI elige el `docker-compose` standalone (salteando
  las copias de Docker Desktop) y lo pasa solo a sus propios `podman compose`, sin modificar el
  entorno global ni `containers.conf`; override opcional `ATLASBI_COMPOSE_PROVIDER` en `.env`.
- Calidad: ESLint 10 + typescript-eslint (reglas de nombres e imports solo por la entrada pública
  de cada paquete), Prettier, Vitest (39 unit tests, 5 de integración contra Postgres real).

### Contratos

| Contrato                        | Versión                              |
| ------------------------------- | ------------------------------------ |
| API Contract                    | — (llega en el Paso 5)               |
| Report Document `schemaVersion` | — (llega en el Paso 6)               |
| Config Schema                   | v1                                   |
| SecretProvider                  | v1                                   |
| DB Migration                    | ninguna aplicada (solo el mecanismo) |
