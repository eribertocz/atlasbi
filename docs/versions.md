# versions.md — versiones exactas, fijadas antes del primer commit **estable**

> Referenciado desde `IMPLEMENTATION.md` y `11-infraestructura.md` (sección 4.6/4.7): nada de `:latest` ni dependencias flotantes — especialmente importante ahora, con dos piezas de este stack en movimiento activo (el driver de DuckDB de Cube, `17-self-service-calculations.md` §3.2.2, y DuckDB 2.0 en alfa, `01-motor-almacenamiento.md` §6.3).
>
> **Corrección de expectativa, señalada en una revisión posterior: este archivo está intencionalmente incompleto — no es un olvido, es el orden correcto de trabajo.** Elegir versiones exactas *antes* de tener un vertical slice corriendo sería arbitrario — no hay forma de saber si Cube 1.7.x funciona bien con DuckDB 1.5.x y DuckLake hasta probarlo. **El primer trabajo real del Milestone 0 es precisamente construir la matriz de compatibilidad y completar esta tabla con evidencia, no de memoria.** Recién ahí `versions.md` + `pnpm-lock.yaml` + `uv.lock` + las etiquetas exactas de imagen en el `compose.yaml` se convierten en la fuente de verdad — y cada actualización posterior pasa por PR, nunca una edición silenciosa.
>
> **Estado al cerrar el Paso 0 (0.1.0 bootstrap, 2026-09-23, verificado en vivo):** completadas con evidencia las filas que el Paso 0 usa de verdad. Las demás siguen "completar" hasta el paso que las introduce — la matriz Cube/DuckDB/DuckLake es trabajo de los Pasos 1–3, no algo que se pueda verificar sin ese código corriendo.
>
> **Paso 1 (DuckDB + DuckLake, 2026-09-25):** DuckDB, DuckLake, `@duckdb/node-api` y la API de OpenTelemetry fijados con evidencia de la Fase 0 del Paso 1; la matriz de compatibilidad del lakehouse arranca con la plataforma validada y el resto de los consumidores pendientes de su paso.

> **Paso 3 (Cube Core + S3, 2026-09-26):** Garage (object storage del nivel "equipo local"), la extensión `httpfs`, Cube Core y Cube Store fijados con evidencia de la Fase 0 del Paso 3; la fila de Cube en la matriz pasa a validada con el test de integración del producto.
>
> **Paso 5 (API Gateway, 2026-09-27; revisado al cerrar `0.5.0`, 2026-10-05):** Fastify, tRPC, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/otel` y el SDK de trazas de OpenTelemetry fijados con evidencia de la Fase 0 del Paso 5 (P5-1: licencias del árbol instalado, atestaciones, *advisories* y antigüedad). Antes de cerrar la versión se volvió a revisar el GitHub Advisory Database para cada paquete de npm y de PyPI fijado, incluidos los de los Pasos 0–4: sin *advisories*. Las imágenes de contenedor no se revisaron por esa vía. Node 24.21.0 sigue siendo la última 24.x.
>
> **Paso 6 (frontend mínimo, modo Viewer, 2026-10-06/07):** SvelteKit, Svelte, Vite, Tailwind, Bits UI, ECharts y los íconos fijados con evidencia de la Fase 0 del Paso 6 (P6-1: fecha, licencia, mantenedores); Caddy y la imagen base de Node, por digest. Detalle en la sección "Frontend y proxy (Paso 6)".

| Pieza | Versión fijada | Notas |
| --- | --- | --- |
| Node.js | **24.21.0** (línea 24 LTS "Krypton"; `.node-version`, `engines: >=24.21.0 <25`) — desde 0.1.1 | **El piso es la última *security release*, no la primera versión que funciona.** 24.12.0 (el pin de 0.1.0) sigue siendo el dato de estabilidad: `doc/api/typescript.md` de Node v24.12.0 dice *"Type stripping is now stable"* (Stability 2), la base de los paquetes TypeScript sin build step. Pero 24.12.0 (10/12/2025) no incluía las *security releases* 24.13.0, 24.14.1, 24.17.0 y 24.18.1 (28/7/2026: CVE-2026-58041 en `node:sqlite`, undici, llhttp, HTTP/2, Permission Model — `nodejs.org/dist/index.json`, campo `security`). Runtime verificado: undici 7.29.1, llhttp 9.4.3, `process.features.typescript = "strip"`. Instalado desde el MSI oficial (SHA-256 contra `SHASUMS256.txt`, firma Authenticode de OpenJS Foundation), porque el paquete `OpenJS.NodeJS.LTS` de winget llegaba solo hasta 24.19.0. **Revisar este pin contra las *security releases* nuevas antes de cada milestone** |
| pnpm | **11.27.1** (`packageManager`, vía corepack) | pnpm 12.0.0 salió el 2026-08-26 — demasiado nuevo (regla 6); la línea 11 existe desde 2026-04-28. pnpm 11 aplica `minimumReleaseAge` (~1 día) a las dependencias: **nunca aceptar las excepciones que agrega solo** (`minimumReleaseAgeExclude`) — se elige otra versión |
| uv | **≥ 0.11** (verificado con 0.11.21) | Gestiona el Python de cada paquete de datos; cada uno tiene su propio entorno |
| Python | **3.13.14** (`packages/transform/.python-version`, fijado con `uv python pin` en el Paso 2) | El máximo soportado por los tres: Airflow 3.3.2 (README: 3.10–3.14), dlt 1.30.0 (clasificadores PyPI: 3.10–3.14), SQLMesh 0.236.2 (matriz de CI de `pr.yaml`: 3.9–3.13). uv lo gestiona; cada paquete Python tiene su propio `uv.lock` con `exclude-newer = "1 day"` — el mismo freno que el `minimumReleaseAge` de pnpm (probado: rechazó un paquete publicado dos días antes con 7 días de ventana) |
| PostgreSQL | **17.11** (`docker.io/library/postgres:17.11-trixie`) | Se eligió 17 y no 18.6 con evidencia: Airflow 3.3.2 soporta 14–18 y ElectricSQL documenta "cualquier Postgres ≥ 14", pero la extensión `postgres` de DuckDB — el camino del catálogo de DuckLake, la pieza más crítica — corre su CI de integración solo contra 17, igual que el CI de ElectricSQL. Revisar la 18 cuando el CI de `duckdb-postgres` la cubra |
| DuckDB | **1.5.5** (embebido vía `@duckdb/node-api` 1.5.5-r.5) — desde el Paso 1 | Elegido **por mérito propio**, no por el driver de Cube: 1.5.2 es la primera versión con DuckLake 1.0 y 1.5.5 (22/7/2026) es el último patch de esa línea; la 1.4.x LTS no trae DuckLake 1.0. La compatibilidad con los demás consumidores vive en la **matriz del lakehouse** (abajo). No adoptar DuckDB 2.0 hasta que salga de alfa (proyectado segunda mitad de octubre 2026) |
| DuckLake | **formato de catálogo 1.0**; extensiones `ducklake` d8a1881e, `postgres_scanner` 41223e5, `sqlite_scanner` f79b1db y `httpfs` 827222f (esta desde el Paso 3, para S3) — las que instala `pnpm bootstrap` para DuckDB 1.5.5 en `windows_amd64`. Para Cube, el mismo bootstrap instala desde dentro de su imagen `ducklake`, `postgres_scanner` y `httpfs` en `linux_amd64`, con las mismas revisiones (d8a1881e, 41223e5, 827222f) | v1.0 production-ready desde abril 2026. El runtime rechaza cualquier otro formato (`SUPPORTED_CATALOG_FORMAT`) y nunca pasa `AUTOMATIC_MIGRATION`: cambiar de formato es una migración administrativa explícita que obliga a revalidar la matriz |
| SQLMesh | **0.236.2** (`sqlmesh[postgres]`, `packages/transform/uv.lock`) — desde el Paso 2 | Apache 2.0, bajo Linux Foundation desde marzo 2026 (repositorio `github.com/SQLMesh/sqlmesh`). Última al 2026-09-25 (publicada el 8/9). Con **`duckdb==1.5.5`** de PyPI, el mismo motor que la plataforma: comparten el directorio de extensiones. Particularidades medidas y el parche temporal de DuckLake: `02-transformacion.md` §6.5. Cómo adjuntará fuentes registradas para el import directo: se verifica en el Paso 7 |
| dlt | _(completar en el Paso 7 — confirmar soporte `destination="ducklake"`)_ | Solo para el import con ingesta (`02-transformacion.md` §6.1.1). Verificar con la versión exacta: el destino `ducklake`, el dataset intermedio de las cargas `merge`, las opciones de proyección y filtro en el origen, y el directorio de trabajo dentro del repo (`03-ingesta.md` §6.4) |
| Cube Core | **1.7.45** — imagen `docker.io/cubejs/cube:v1.7.45@sha256:c4dae518806fdedc78b623192ffd187df46d32d212985306a8adf7b1482804a1` (revisión `f2c28b80` de `cube-js/cube`) — desde el Paso 3 | Incorpora el PR `cube-js/cube#11165`: su driver usa `@duckdb/node-api` 1.5.5-r.5, el mismo que la plataforma, y la imagen trae Node 24.21.0 (Fase 0 del Paso 3). Fijada por digest y con al menos 1 día de antigüedad: la 1.7.46 se publicó horas antes de la medición. Cube publica casi a diario, así que se actualiza a propósito, con esta matriz, nunca por arrastre. Validar `checkSqlAuth` contra esta versión exacta antes de escribir el código final de la Capa 17 (Paso 5) |
| Cube Store | **1.7.45** — imagen `docker.io/cubejs/cubestore:v1.7.45@sha256:888a9eb901b1f313836b4d5f1d19ffe035cf0e6595dafa6b6fc03a9daa28523b` (misma revisión que Cube Core) | Incluido desde el MVP ("production-like"), ver `17-self-service-calculations.md` §8. Variante estándar (con AVX); la misma versión existe como `-non-avx` y `-arm64v8`. Hueco conocido de esta versión: un filtro sobre una medida decimal, con orden, falla cuando lo responde una pre-agregación (`17-self-service-calculations.md` §3.2.2, con test de alerta) |
| Garage (object storage, nivel "equipo local") | **2.4.1** — imagen `docker.io/dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020` — desde el Paso 3 | Elegido en la Fase 0 del Paso 3 frente a versitygw; MinIO está descartado (`11-infraestructura.md` §4.4). AGPL-3.0: corre sin modificar como servicio aparte y nunca se distribuye con la plataforma (`21-engineering-standards.md` §11). En un nodo (`server --single-node`); la API de administración v2 crea el bucket y las claves (bootstrap). La imagen no trae shell: el *healthcheck* del compose es `/garage status` |
| Apache Airflow | _(completar)_ | Última al 2026-09-23: 3.3.2 (usada solo como evidencia para Python/Postgres) |
| SvelteKit / Svelte | **SvelteKit 2.70.3** + **Svelte 5.57.1** (runes) — desde el Paso 6 | Detalle en "Frontend y proxy (Paso 6)". SvelteKit 3 se adopta cuando tenga algunas semanas de parches |
| Apache ECharts | **6.1.0** — desde el Paso 6 | Apache-2.0, ASF (`08-frontend.md` §4.4). Importado por partes: 202 kB gzip contra 392 kB del paquete completo |
| GridStack.js | _(completar — riesgo de gobernanza documentado, `08-frontend.md` §11.1)_ | |
| shadcn-svelte / Tailwind | **shadcn-svelte CLI 1.7.0** (los componentes se copian al repo) + **Bits UI 2.19.5** (dependencia viva) + **Tailwind 4.3.3** — desde el Paso 6 | Riesgo residual de Bits UI, un solo mantenedor: `08-frontend.md` §11.2 |
| Monaco Editor | _(completar)_ | |
| ElectricSQL | _(completar)_ | Requiere `wal_level=logical` en Postgres — se agrega al compose en el Paso 10, no antes |
| better-auth | **1.7.6** (`catalog`) — desde el Paso 4 | MIT; Vercel la adquirió el 7/7/2026 (`09-auth-gobernanza.md` §4.1). Publicada el 24/9/2026, con atestación SLSA de npm verificada y las 23 *advisories* conocidas corregidas en versiones anteriores. Plugins: solo `organization` y `jwt` (sin `admin`). Depende de `kysely ^0.28.17 \|\| ^0.29.0`: comparte nuestro Kysely 0.29.6 (una sola copia). El CLI `@better-auth/cli` quedó en 1.4.21: el esquema se genera con su planificador programático (`better-auth/db/migration`), nunca con `migrate`. Telemetría apagada; ninguna llamada de red medida Sus *peers* opcionales `vitest`, `svelte` y `@sveltejs/kit` los quita `.pnpmfile.mjs` (sección "Frontend y proxy (Paso 6)") |
| jose | **6.2.12** (`catalog`) — desde el Paso 4 | MIT, cero dependencias. Verifica localmente el token de identidad (EdDSA) contra el JWKS; es también dependencia de better-auth |
| Caddy (proxy del origen único) | **2.11.7** — imagen `docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f` (digest del índice multiplataforma) — desde el Paso 6 | Apache-2.0, publicada el 2026-10-03; elegida con la regla 7 frente a nginx y Traefik (`11-infraestructura.md` §4.4.1) |
| Imagen base de Node (imágenes propias) | `docker.io/library/node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66` — desde el Paso 6 | La misma versión de `.node-version`; se actualiza junto con ella |
| OpenTelemetry Collector | **0.161.0**, distribución core (`docker.io/otel/opentelemetry-collector:0.161.0`) | El manifiesto de la distribución core ya incluye `otlpreceiver`, `batchprocessor`, `debugexporter` y `healthcheckextension`; contrib agregaría cientos de componentes sin uso. Imagen distroless: sin healthcheck en el compose, la readiness se prueba desde el host (`:13133`) |
| OpenTelemetry SDKs | TypeScript: **SDK de trazas 2.11.0**, desde el Paso 5. Detalle en la sección "API Gateway (Paso 5)". Python: _(completar en los Pasos 7–8)_ | Graduated CNCF, mayo 2026. Sin `@opentelemetry/sdk-node`, que trae decenas de instrumentaciones que nadie usa (P5-1) |
| OpenBao | _(completar — solo para producción self-hosteada)_ | Linux Foundation + OpenSSF |
| OpenMetadata | _(completar)_ | Collate Inc., riesgo documentado |
| OpenTofu | _(completar)_ | |
| Podman | **5.8.3** (mínimo aceptado por `pnpm preflight`: 5.0) — máquina `quay.io/podman/machine-os:5.8` sobre WSL2 | Verificado con el Paso 0 en vivo. Instalado con `winget install -e --id RedHat.Podman`; firma Authenticode válida de "Red Hat, Inc". El repositorio oficial hoy es `github.com/podman-container-tools/podman` (transferido desde `containers/podman`, mismo id 109145553 — no es un typosquat). Podman Desktop es solo la interfaz: no instala el motor por sí solo |
| docker-compose (compose provider de Podman) | **5.5.1** (mínimo aceptado: 2.20) | Binario standalone (`winget install -e --id Docker.DockerCompose`), SHA-256 idéntico al checksum oficial del release de `docker/compose`. No es el de Docker Desktop (`11-infraestructura.md` §4.2): si Docker Desktop está instalado, su copia va antes en el PATH aunque esté detenido, así que la CLI del proyecto elige el standalone y se lo pasa como `PODMAN_COMPOSE_PROVIDER` **solo a sus propios procesos `podman compose`** — nunca como variable global ni en `containers.conf` |

## API Gateway (Paso 5)

Todas en el `catalog` de `pnpm-workspace.yaml`. Fechas de publicación y licencias, del registro de npm.

| Pieza | Versión | Notas |
| --- | --- | --- |
| `fastify` | **5.12.5** (2026-09-16) | MIT, OpenJS Foundation (`06-api-gateway.md` §1.1). La última de la línea 5 |
| `@trpc/server` / `@trpc/client` | **11.19.0** (2026-09-16) | MIT. El adaptador de Fastify es el oficial de tRPC. `@trpc/client` lo usan los tests y, desde el Paso 6, el frontend (`httpLink`, `08` §9). El *peer* `typescript` de `@trpc/server` lo quita `.pnpmfile.mjs` (sección "Frontend y proxy (Paso 6)") |
| `@fastify/helmet` | **13.1.1** (2026-08-19) | MIT. CSP `default-src 'none'` para una API JSON |
| `@fastify/rate-limit` | **11.2.0** (2026-07-29) | MIT. Dos `rateLimit()` en una misma ruta: el segundo nunca corre (medido), por eso se usa `createRateLimit()` (`06-api-gateway.md` §6.3) |
| `@fastify/otel` | **0.21.0** (2026-09-06) | MIT, proyecto oficial de Fastify. La 0.21.1 (2026-10-02) solo sube su dependencia `@opentelemetry/instrumentation`, sin cambio de seguridad; se queda la 0.21.0 |
| `@opentelemetry/sdk-trace-node`, `sdk-trace-base`, `resources` | **2.11.0** (2026-08-31) | Apache 2.0, CNCF Graduated |
| `@opentelemetry/exporter-trace-otlp-http`, `instrumentation` | **0.222.0** (2026-08-31) | Apache 2.0. OTLP/HTTP hacia el Collector local |
| `@opentelemetry/instrumentation-pg` | **0.74.0** (2026-08-31) | Apache 2.0, `opentelemetry-js-contrib`. Registra el SQL parametrizado, sin valores (medido) |
| `@opentelemetry/instrumentation-undici` | **0.32.0** (2026-08-31) | Apache 2.0, `opentelemetry-js-contrib`. Las llamadas a Cube; `url.full` y `url.query` recortados (`06-api-gateway.md` §6.5) |

## Frontend y proxy (Paso 6)

Todas en el `catalog` de `pnpm-workspace.yaml`, salvo Caddy y la imagen base de Node, que están en `infra/images/`. Las licencias y la cantidad de mantenedores salen del registro de npm y de los repositorios (Fase 0 del Paso 6, P6-1). Ninguna tenía *advisories* abiertas al fijarla.

| Pieza | Versión | Notas |
| --- | --- | --- |
| `@sveltejs/kit` | **2.70.3** (2026-08-18) | MIT. No 3.0.x: la 3.0.0 salió el 2026-10-01 y la 3.0.1 el mismo día de la medición. Es demasiado nueva para una mayor (regla 6) y no pasaba la edad mínima. **Migrar a SvelteKit 3 cuando tenga algunas semanas de parches** |
| `@sveltejs/adapter-static` | **3.0.10** | La app es una SPA (decisión H1, `08` §9) |
| `svelte` | **5.57.1** (2026-09-18) | MIT. Runes |
| `vite` | **8.3.3** (2026-10-06) | MIT. Parche de una dependencia (`launch-editor`). Fijada al pasar la edad mínima de publicación (Paso 7); el Paso 6 salió con la 8.3.2 |
| `@sveltejs/vite-plugin-svelte` / `svelte-check` | **7.3.1** / **4.7.6** | `svelte-check` corre con `--fail-on-warnings` |
| `tailwindcss` / `@tailwindcss/vite` | **4.3.3** | MIT, Tailwind Labs |
| `bits-ui` | **2.19.5** | MIT. Un solo mantenedor con permiso de publicación (`huntabyte`), 126 contribuyentes. Riesgo aceptado con la regla 7: `08` §11.2 |
| `tailwind-merge` / `tailwind-variants` / `clsx` | **3.7.0** / **3.3.1** / **2.1.1** | MIT. Un mantenedor cada una, salvo `clsx`. Son utilidades chicas y forkeables |
| `@internationalized/date` | **3.12.4** | Apache-2.0, Adobe. Dependencia de Bits UI |
| `@lucide/svelte` | **1.52.0** (2026-10-04) | ISC, organización Lucide, más de 400 contribuyentes. Íconos |
| `echarts` | **6.1.0** | Apache-2.0, ASF |
| `eslint-plugin-svelte` / `svelte-eslint-parser` / `prettier-plugin-svelte` | **3.23.0** / **1.8.1** / **4.1.1** | MIT, organización `sveltejs` |

**`.pnpmfile.mjs` (raíz del repositorio).** Un hook `readPackage` quita cuatro *peers* que la plataforma no usa en tiempo de ejecución, porque si no, terminan en la imagen de producción del gateway (`11-infraestructura.md` §4.4.1):
- de `better-auth`: `vitest`, `svelte` y `@sveltejs/kit`, opcionales;
- de `@trpc/server`: `typescript`.

**Se revisa en cada actualización de `better-auth` o de `@trpc/server`.** Si una versión nueva empieza a usar alguno de esos paquetes en tiempo de ejecución, el hook tiene que dejarlo pasar. Si declara *peers* nuevos de desarrollo, el hook los suma. `pnpm test:image` avisa si alguna herramienta vuelve a la imagen.

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
| Plataforma (`@atlasbi/warehouse`, TypeScript) | Aprovisiona, escribe, lee | 1.5.5 (node-api 1.5.5-r.5) | d8a1881e | 1.0 | **Validada** — Paso 1, 2026-09-25: baterías de contrato de los dos puertos con los dos catálogos (`packages/warehouse/test/integration`). Revalidada en el Paso 3 con los pares de cada nivel: PostgreSQL + S3 (Garage 2.4.1, `httpfs` 827222f) y SQLite + carpeta |
| SQLMesh 0.236.2 (Python) | Escribe (`mart_*`) y lee (fuentes) | 1.5.5 (PyPI) | d8a1881e (mismo directorio de extensiones) | 1.0 | **Validada** — Paso 2, 2026-09-25: la plataforma aprovisiona y siembra, SQLMesh transforma, la plataforma lee el mart con su puerto de solo lectura, con los dos catálogos (`packages/transform/test/integration`). Revalidada en el Paso 3 con los datos en S3 |
| dlt (Python) | Escribe (ingesta) | _(Paso 7)_ | — | 1.0 | Pendiente — Paso 7 |
| Cube Core 1.7.45 (subclase propia de `@cubejs-backend/duckdb-driver`, `04-semantico.md` §6.6) | Lee, como lector de solo lectura | 1.5.5 (node-api 1.5.5-r.5, dentro de la imagen) | d8a1881e (`linux_amd64`) | 1.0 | **Validada** — Paso 3, 2026-09-26: "la plataforma escribe → Cube lee" con resultados idénticos a los del puerto de lectura de la plataforma (REST, decimales sin la escala), inteligencia de tiempo, join, pre-agregación sin escribir en el lago, datos en S3 y Cube sin ruta a Internet (`packages/semantic/test/integration`). Solo el nivel PostgreSQL + S3 |

**Regla de actualización:** cambiar una fila de esta tabla es, en sí mismo, un cambio que pasa por PR — nunca una edición silenciosa del `compose.yaml`/`package.json` sin que este archivo se actualice en el mismo commit.
