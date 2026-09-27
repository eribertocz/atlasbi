# Changelog

Versionado del producto según [`docs/21-engineering-standards.md`](docs/21-engineering-standards.md)
§2: SemVer `0.MINOR.PATCH` hasta 1.0; los contratos (API, Report Schema, Config Schema, DB
Migration…) versionan por separado y se listan en cada release.

## Unreleased

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
