# Changelog

Versionado del producto según [`docs/21-engineering-standards.md`](docs/21-engineering-standards.md)
§2: SemVer `0.MINOR.PATCH` hasta 1.0; los contratos (API, Report Schema, Config Schema, DB
Migration…) versionan por separado y se listan en cada release.

## Unreleased — Pasos 1 y 2: vertical slice de datos (será 0.2.0)

Queda en "Unreleased" hasta cerrar el Paso 2: la versión `0.2.0` ("vertical slice de datos",
`21-engineering-standards.md` §2.1) se publica con la transformación.

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
