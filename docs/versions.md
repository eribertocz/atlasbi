# versions.md — versiones exactas, fijadas antes del primer commit **estable**

> Referenciado desde `IMPLEMENTATION.md` y `11-infraestructura.md` (sección 4.6/4.7): nada de `:latest` ni dependencias flotantes — especialmente importante ahora, con dos piezas de este stack en movimiento activo (el driver de DuckDB de Cube, `17-self-service-calculations.md` §3.2.2, y DuckDB 2.0 en alfa, `01-motor-almacenamiento.md` §6.3).
>
> **Corrección de expectativa, señalada en una revisión posterior: este archivo está intencionalmente incompleto — no es un olvido, es el orden correcto de trabajo.** Elegir versiones exactas *antes* de tener un vertical slice corriendo sería arbitrario — no hay forma de saber si Cube 1.7.x funciona bien con DuckDB 1.5.x y DuckLake hasta probarlo. **El primer trabajo real del Milestone 0 es precisamente construir la matriz de compatibilidad y completar esta tabla con evidencia, no de memoria.** Recién ahí `versions.md` + `pnpm-lock.yaml` + `uv.lock` + las etiquetas exactas de imagen en el `compose.yaml` se convierten en la fuente de verdad — y cada actualización posterior pasa por PR, nunca una edición silenciosa.
>
> **Estado al cerrar el Paso 0 (0.1.0 bootstrap, 2026-09-23, verificado en vivo):** completadas con evidencia las filas que el Paso 0 usa de verdad. Las demás siguen "completar" hasta el paso que las introduce — la matriz Cube/DuckDB/DuckLake es trabajo de los Pasos 1–3, no algo que se pueda verificar sin ese código corriendo.
>
> **Paso 1 (DuckDB + DuckLake, 2026-09-25):** DuckDB, DuckLake, `@duckdb/node-api` y la API de OpenTelemetry fijados con evidencia de la Fase 0 del Paso 1; la matriz de compatibilidad del lakehouse arranca con la plataforma validada y el resto de los consumidores pendientes de su paso.

| Pieza | Versión fijada | Notas |
| --- | --- | --- |
| Node.js | **24.21.0** (línea 24 LTS "Krypton"; `.node-version`, `engines: >=24.21.0 <25`) — desde 0.1.1 | **El piso es la última *security release*, no la primera versión que funciona.** 24.12.0 (el pin de 0.1.0) sigue siendo el dato de estabilidad: `doc/api/typescript.md` de Node v24.12.0 dice *"Type stripping is now stable"* (Stability 2), la base de los paquetes TypeScript sin build step. Pero 24.12.0 (10/12/2025) no incluía las *security releases* 24.13.0, 24.14.1, 24.17.0 y 24.18.1 (28/7/2026: CVE-2026-58041 en `node:sqlite`, undici, llhttp, HTTP/2, Permission Model — `nodejs.org/dist/index.json`, campo `security`). Runtime verificado: undici 7.29.1, llhttp 9.4.3, `process.features.typescript = "strip"`. Instalado desde el MSI oficial (SHA-256 contra `SHASUMS256.txt`, firma Authenticode de OpenJS Foundation), porque el paquete `OpenJS.NodeJS.LTS` de winget llegaba solo hasta 24.19.0. **Revisar este pin contra las *security releases* nuevas antes de cada milestone** |
| pnpm | **11.27.1** (`packageManager`, vía corepack) | pnpm 12.0.0 salió el 2026-08-26 — demasiado nuevo (regla 6); la línea 11 existe desde 2026-04-28. pnpm 11 aplica `minimumReleaseAge` (~1 día) a las dependencias: **nunca aceptar las excepciones que agrega solo** (`minimumReleaseAgeExclude`) — se elige otra versión |
| uv | **≥ 0.11** (verificado con 0.11.21) | Gestiona el Python de cada paquete de datos; cada uno tiene su propio entorno |
| Python | **3.13.14** (`packages/transform/.python-version`, fijado con `uv python pin` en el Paso 2) | El máximo soportado por los tres: Airflow 3.3.2 (README: 3.10–3.14), dlt 1.30.0 (clasificadores PyPI: 3.10–3.14), SQLMesh 0.236.2 (matriz de CI de `pr.yaml`: 3.9–3.13). uv lo gestiona; cada paquete Python tiene su propio `uv.lock` con `exclude-newer = "1 day"` — el mismo freno que el `minimumReleaseAge` de pnpm (probado: rechazó un paquete publicado dos días antes con 7 días de ventana) |
| PostgreSQL | **17.11** (`docker.io/library/postgres:17.11-trixie`) | Se eligió 17 y no 18.6 con evidencia: Airflow 3.3.2 soporta 14–18 y ElectricSQL documenta "cualquier Postgres ≥ 14", pero la extensión `postgres` de DuckDB — el camino del catálogo de DuckLake, la pieza más crítica — corre su CI de integración solo contra 17, igual que el CI de ElectricSQL. Revisar la 18 cuando el CI de `duckdb-postgres` la cubra |
| DuckDB | **1.5.5** (embebido vía `@duckdb/node-api` 1.5.5-r.5) — desde el Paso 1 | Elegido **por mérito propio**, no por el driver de Cube: 1.5.2 es la primera versión con DuckLake 1.0 y 1.5.5 (22/7/2026) es el último patch de esa línea; la 1.4.x LTS no trae DuckLake 1.0. La compatibilidad con los demás consumidores vive en la **matriz del lakehouse** (abajo). No adoptar DuckDB 2.0 hasta que salga de alfa (proyectado segunda mitad de octubre 2026) |
| DuckLake | **formato de catálogo 1.0**; extensiones `ducklake` d8a1881e, `postgres_scanner` 41223e5, `sqlite_scanner` f79b1db (las que instala `pnpm bootstrap` para DuckDB 1.5.5 en `windows_amd64`) | v1.0 production-ready desde abril 2026. El runtime rechaza cualquier otro formato (`SUPPORTED_CATALOG_FORMAT`) y nunca pasa `AUTOMATIC_MIGRATION`: cambiar de formato es una migración administrativa explícita que obliga a revalidar la matriz |
| SQLMesh | **0.236.2** (`sqlmesh[postgres]`, `packages/transform/uv.lock`) — desde el Paso 2 | Apache 2.0, bajo Linux Foundation desde marzo 2026 (repositorio `github.com/SQLMesh/sqlmesh`). Última al 2026-09-25 (publicada el 8/9). Con **`duckdb==1.5.5`** de PyPI, el mismo motor que la plataforma: comparten el directorio de extensiones. Particularidades medidas y el parche temporal de DuckLake: `02-transformacion.md` §6.5. Cómo adjuntará fuentes registradas para el import directo: se verifica en el Paso 7 |
| dlt | _(completar en el Paso 7 — confirmar soporte `destination="ducklake"`)_ | Solo para el import con ingesta (`02-transformacion.md` §6.1.1). Verificar con la versión exacta: el destino `ducklake`, el dataset intermedio de las cargas `merge`, las opciones de proyección y filtro en el origen, y el directorio de trabajo dentro del repo (`03-ingesta.md` §6.4) |
| Cube Core | **1.7.45** — imagen `docker.io/cubejs/cube:v1.7.45@sha256:c4dae518806fdedc78b623192ffd187df46d32d212985306a8adf7b1482804a1` (revisión `f2c28b80` de `cube-js/cube`) — desde el Paso 3 | Incorpora el PR `cube-js/cube#11165`: su driver usa `@duckdb/node-api` 1.5.5-r.5, el mismo que la plataforma, y la imagen trae Node 24.21.0 (Fase 0 del Paso 3). Fijada por digest y con al menos 1 día de antigüedad: la 1.7.46 se publicó horas antes de la medición. Cube publica casi a diario, así que se actualiza a propósito, con esta matriz, nunca por arrastre. Validar `checkSqlAuth` contra esta versión exacta antes de escribir el código final de la Capa 17 (Paso 5) |
| Cube Store | **1.7.45** — imagen `docker.io/cubejs/cubestore:v1.7.45@sha256:888a9eb901b1f313836b4d5f1d19ffe035cf0e6595dafa6b6fc03a9daa28523b` (misma revisión que Cube Core) | Incluido desde el MVP ("production-like"), ver `17-self-service-calculations.md` §8. Variante estándar (con AVX); la misma versión existe como `-non-avx` y `-arm64v8` |
| Apache Airflow | _(completar)_ | Última al 2026-09-23: 3.3.2 (usada solo como evidencia para Python/Postgres) |
| SvelteKit / Svelte | _(completar)_ | Svelte 5 (runes) |
| Apache ECharts | _(completar)_ | |
| GridStack.js | _(completar — riesgo de gobernanza documentado, `08-frontend.md` §11.1)_ | |
| shadcn-svelte / Tailwind | _(completar)_ | Tailwind v4 |
| Monaco Editor | _(completar)_ | |
| ElectricSQL | _(completar)_ | Requiere `wal_level=logical` en Postgres — se agrega al compose en el Paso 10, no antes |
| better-auth | _(completar)_ | |
| OpenTelemetry Collector | **0.161.0**, distribución core (`docker.io/otel/opentelemetry-collector:0.161.0`) | El manifiesto de la distribución core ya incluye `otlpreceiver`, `batchprocessor`, `debugexporter` y `healthcheckextension`; contrib agregaría cientos de componentes sin uso. Imagen distroless: sin healthcheck en el compose, la readiness se prueba desde el host (`:13133`) |
| OpenTelemetry SDKs | _(completar al instrumentar el primer servicio — Paso 5 en TS, Pasos 2/7 en Python)_ | Graduated CNCF, mayo 2026 |
| OpenBao | _(completar — solo para producción self-hosteada)_ | Linux Foundation + OpenSSF |
| OpenMetadata | _(completar)_ | Collate Inc., riesgo documentado |
| OpenTofu | _(completar)_ | |
| Podman | **5.8.3** (mínimo aceptado por `pnpm preflight`: 5.0) — máquina `quay.io/podman/machine-os:5.8` sobre WSL2 | Verificado con el Paso 0 en vivo. Instalado con `winget install -e --id RedHat.Podman`; firma Authenticode válida de "Red Hat, Inc". El repositorio oficial hoy es `github.com/podman-container-tools/podman` (transferido desde `containers/podman`, mismo id 109145553 — no es un typosquat). Podman Desktop es solo la interfaz: no instala el motor por sí solo |
| docker-compose (compose provider de Podman) | **5.5.1** (mínimo aceptado: 2.20) | Binario standalone (`winget install -e --id Docker.DockerCompose`), SHA-256 idéntico al checksum oficial del release de `docker/compose`. No es el de Docker Desktop (`11-infraestructura.md` §4.2): si Docker Desktop está instalado, su copia va antes en el PATH aunque esté detenido, así que la CLI del proyecto elige el standalone y se lo pasa como `PODMAN_COMPOSE_PROVIDER` **solo a sus propios procesos `podman compose`** — nunca como variable global ni en `containers.conf` |

## Toolchain TypeScript (Paso 0)

La fuente de verdad ejecutable es el `catalog` de `pnpm-workspace.yaml` + `package.json` + `pnpm-lock.yaml`; esta tabla explica el porqué.

| Pieza | Versión | Notas |
| --- | --- | --- |
| TypeScript | **6.0.3** | No 7.0.2: typescript-eslint 8.70.1 declara `peerDependencies.typescript: >=4.8.4 <6.1.0`. Pasar a 7 cuando typescript-eslint lo soporte |
| Turborepo | **2.11.2** | 2.11.3 (2026-09-22) no pasaba el `minimumReleaseAge` de pnpm |
| Kysely | **0.29.6** | Desde 0.29, `Migrator`/`MigrationProvider` se importan desde `kysely/migration` |
| pg | **8.23.0** | Driver de Postgres (`@types/pg` 8.23.1) |
| zod | **4.6.5** | Validación de configuración (`packages/config`) |
| ESLint | **10.11.0** (+ `@eslint/js` 10.0.1, typescript-eslint 8.70.1, eslint-config-prettier 10.1.8) | ESLint 10 existe desde 2026-02 y typescript-eslint lo soporta |
| Prettier | **3.9.8** | 3.9.9 (2026-09-23) no pasaba el `minimumReleaseAge` |
| Vitest | **4.1.11** | Vitest 5.0.0 salió el 2026-09-03 — demasiado nuevo (regla 6) |
| @types/node | **24.13.6** | Misma línea mayor que el runtime (Node 24), no la última (26) |

## Lakehouse (Paso 1)

| Pieza | Versión | Notas |
| --- | --- | --- |
| `@duckdb/node-api` | **1.5.5-r.5** (con `@duckdb/node-bindings-win32-x64` y demás binarios de la misma versión) | Cliente oficial de DuckDB para Node (MIT), publicado el 13/9/2026. Sus tipos solo se importan dentro de `packages/warehouse/src/adapters/duckdb/**` (regla de ESLint, `21` §3.2) |
| `@opentelemetry/api` | **1.9.1** | Solo la API: no-op hasta que el Paso 5 registre el SDK |
| `@opentelemetry/semantic-conventions` | **1.43.0** | Solo la entrada **estable** (una regla de ESLint prohíbe `…/incubating`): `db.system.name`, `db.namespace`, `db.operation.name`, `error.type`, métrica `db.client.operation.duration` |

### Matriz de compatibilidad del lakehouse

La versión de DuckDB de la plataforma **no se acopla** a la del driver de Cube: cada consumidor del lakehouse es una fila, y lo que tiene que coincidir es el **formato del catálogo**, no la versión del motor. Una fila lectora nueva, o un DuckDB nuevo en cualquier fila, se valida con un test antes de fijarse — nunca se supone.

| Consumidor | Rol | DuckDB | Extensión `ducklake` | Formato de catálogo | Estado |
| --- | --- | --- | --- | --- | --- |
| Plataforma (`@atlasbi/warehouse`, TypeScript) | Aprovisiona, escribe, lee | 1.5.5 (node-api 1.5.5-r.5) | d8a1881e | 1.0 | **Validada** — Paso 1, 2026-09-25: baterías de contrato de los dos puertos con los dos catálogos (`packages/warehouse/test/integration`) |
| SQLMesh 0.236.2 (Python) | Escribe (`mart_*`) y lee (fuentes) | 1.5.5 (PyPI) | d8a1881e (mismo directorio de extensiones) | 1.0 | **Validada** — Paso 2, 2026-09-25: la plataforma aprovisiona y siembra, SQLMesh transforma, la plataforma lee el mart con su puerto de solo lectura, con los dos catálogos (`packages/transform/test/integration`) |
| dlt (Python) | Escribe (ingesta) | _(Paso 7)_ | — | 1.0 | Pendiente — Paso 7 |
| Cube Core 1.7.45 (`@cubejs-backend/duckdb-driver`) | Lee | 1.5.5 (node-api 1.5.5-r.5, dentro de la imagen) | d8a1881e (`linux_amd64`) | 1.0 | Fase 0 del Paso 3 (spike, 2026-09-26): "la plataforma escribe → Cube lee" exacto, con los datos en S3 y Cube sin salida a Internet. Pendiente el test de integración del producto |

**Regla de actualización:** cambiar una fila de esta tabla es, en sí mismo, un cambio que pasa por PR — nunca una edición silenciosa del `compose.yaml`/`package.json` sin que este archivo se actualice en el mismo commit.
