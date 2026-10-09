# AtlasBI (codename)

Plataforma de BI 100% open source que reemplaza a Power BI capa por capa. La arquitectura completa
está en [`docs/`](docs/) — empezar por [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md). Las
reglas que todo el código cumple están en [`CLAUDE.md`](CLAUDE.md) y
[`docs/21-engineering-standards.md`](docs/21-engineering-standards.md).

> El usuario de BI nunca toca una terminal. Todo lo que sigue es para quien desarrolla o
> administra la plataforma.

## Prerrequisitos

Versiones exactas y su justificación en [`docs/versions.md`](docs/versions.md). `pnpm preflight`
verifica todo esto y dice cómo resolver lo que falte.

| Herramienta                 | Versión                                        | Cómo                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                     | 24.x ≥ 24.21.0 (LTS, ver `.node-version`)      | [nodejs.org](https://nodejs.org) o tu gestor de versiones                                                                                                                                                               |
| pnpm                        | la fijada en `package.json` (`packageManager`) | `corepack enable` una vez por máquina — en Windows, desde una terminal de administrador                                                                                                                                 |
| uv                          | ≥ 0.11                                         | [docs.astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/) — gestiona los entornos Python de las capas de datos, y el Python 3.13 que usan (`uv python install 3.13` si no lo tenés)                  |
| Podman (motor)              | ≥ 5                                            | `winget install -e --id RedHat.Podman` y después `podman machine init` — o desde el Dashboard de [Podman Desktop](https://podman-desktop.io)                                                                            |
| docker-compose (standalone) | ≥ 2.20                                         | `winget install -e --id Docker.DockerCompose` — o Podman Desktop → Settings → Resources → Compose. Es el _provider_ de `podman compose`; no usa Docker Engine ni Docker Desktop ([por qué](docs/11-infraestructura.md)) |

**Podman Desktop solo es la interfaz gráfica:** instalarlo no instala el motor Podman ni crea la
máquina. `pnpm preflight` lo detecta.

**Windows:** si Docker Desktop está instalado, conviene dejarlo detenido. Su `docker-compose` sigue
en el PATH aunque esté detenido: la CLI del proyecto lo saltea y elige el standalone **solo para los
`podman compose` que lanza ella**, sin tocar variables de entorno globales ni `containers.conf` (otros
proyectos Podman de la máquina no se ven afectados). Si el standalone no está en el PATH, definí
`ATLASBI_COMPOSE_PROVIDER` con su ruta en el `.env` de este repo — nunca como variable global.

## Primer uso

```bash
corepack enable     # una vez por máquina
pnpm install
pnpm bootstrap      # crea .env, levanta la infraestructura, aplica migraciones, crea el bucket
                    # y las claves del object storage, instala las extensiones de DuckDB (las del
                    # host y las de Cube: la única descarga) y aprovisiona el lakehouse
pnpm seed           # opcional: dataset de desarrollo (20.000 filas) y usuarios demo
pnpm ingest github  # opcional: trae la actividad de GitHub (ATLASBI_GITHUB_REPOSITORIES y
                    # ATLASBI_GITHUB_TOKEN en .env: un token de solo lectura)
pnpm transform plan # opcional: SQLMesh construye los marts sobre esos datos
```

**El lakehouse** (DuckDB + DuckLake, [`docs/01`](docs/01-motor-almacenamiento.md) §6.6–6.7) usa por
defecto el nivel "equipo local": un catálogo PostgreSQL en el Postgres local (base `lakehouse`) y los
datos en el object storage S3 local (Garage, bucket `lakehouse`). **Cube** (la capa semántica,
[`docs/04`](docs/04-semantico.md) §6.6) lo lee como su lector de solo lectura. Para el nivel portátil
(catálogo SQLite, datos en `.data/lakehouse/`, un solo proceso que escribe, sin object storage ni
Cube), poné `ATLASBI_LAKEHOUSE_CATALOG_TYPE=sqlite` en `.env` y corré `pnpm bootstrap` otra vez.

`bootstrap` nunca reescribe un `.env` existente: si el tuyo es de una versión anterior, agregale las
variables nuevas desde `.env.example` (al pasar a `0.3.0`: el object storage, el lector del lakehouse
y Cube; al pasar a `0.4.0`: `ATLASBI_AUTH_SECRET` y `ATLASBI_SEED_DEMO_PASSWORD`, y
`ATLASBI_SEMANTIC_SQL_PASSWORD` sobra; al pasar a `0.5.0`, nada obligatorio: `ATLASBI_GATEWAY_PORT`,
`ATLASBI_PUBLIC_URL` y `ATLASBI_SEMANTIC_URL` tienen valores por defecto). Un lakehouse de desarrollo de `0.2.0` (PostgreSQL con los datos en una carpeta) ya no es un
nivel soportado: recrealo con `pnpm reset:local` y `pnpm bootstrap`.

**Al pasar a `0.6.0`:** si tu `.env` tiene `ATLASBI_PUBLIC_URL=http://127.0.0.1:4100` (copiado del
`.env.example` de `0.5.0`), cambialo a `http://127.0.0.1:3000` o borrá la línea. El navegador ahora
entra por la web, y el gateway rechaza el inicio de sesión desde cualquier otro origen. Las variables
nuevas (`ATLASBI_WEB_PORT`, `ATLASBI_GATEWAY_HOST`, `ATLASBI_TRUSTED_PROXIES`) tienen valores por
defecto. Después, `pnpm dev` (aplica la migración `000004`) y `pnpm seed` para el reporte demo.

**Al pasar a `0.7.0`:**

1. Para la primera fuente real, agregá a `.env`:
   - `ATLASBI_GITHUB_REPOSITORIES`: dos repositorios públicos, por ejemplo `duckdb/duckdb,sveltejs/svelte`;
   - `ATLASBI_GITHUB_TOKEN`: un token de solo lectura (fine-grained, acceso de lectura a repositorios públicos).

   Sin ellos, todo lo demás funciona igual y solo `pnpm ingest github` se niega a correr.

2. Corré `pnpm bootstrap`: prepara el entorno de la ingesta y publica su landing vacío.
3. Corré `pnpm seed`: los permisos por repositorio y el reporte "Actividad en GitHub".
4. Corré `pnpm ingest github` y `pnpm transform plan`.

La primera vez que `pnpm dev` arranque después de actualizar, Cube se recrea una vez: desde esta versión, se recrea cada vez que cambia su modelo, y solo entonces.

Turborepo envía telemetría anónima por defecto; para desactivarla en tu máquina:
`pnpm exec turbo telemetry disable`.

## Día a día

| Comando                                              | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | Verifica prerrequisitos y `.env`, levanta la infraestructura local (Postgres, OTel Collector, object storage, Cube y Cube Store; en el nivel portátil, solo los dos primeros), aplica migraciones pendientes, arranca la API Gateway en `http://127.0.0.1:4100` y la web en **`http://127.0.0.1:3000`**, las dos con _hot reload_, y espera a que cada pieza —incluidos el lakehouse, Cube respondiendo desde él, el `/ready` del gateway y la web llegando al gateway— esté lista. Después queda en primer plano con la salida de los dos; Ctrl+C los detiene y la infraestructura sigue corriendo. Nunca descarga ni crea nada |
| `pnpm preflight`                                     | Solo verifica la máquina: versiones, compose provider, puertos libres (los del nivel configurado), extensiones de DuckDB (las del host y las de Cube) y carpetas del lakehouse. No cambia nada                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm seed`                                          | Carga el dataset de desarrollo en el lakehouse y los accesos demo: organización `demo`, workspaces `comercial` y `finanzas`, `ana@example.com` y `bruno@example.com` con la contraseña de `ATLASBI_SEED_DEMO_PASSWORD` (idempotente; nunca corre solo). Desde `0.6.0`, también el reporte demo "Ventas" en cada workspace; desde `0.7.0`, el reporte "Actividad en GitHub" y los permisos por repositorio (los de `ATLASBI_GITHUB_REPOSITORIES`)                                                                                                                                                                                 |
| `pnpm identity:reconcile`                            | Repara la identidad propia de la plataforma: agrega las personas y organizaciones que el proveedor de identidad conoce y la plataforma no. Nunca borra nada; `pnpm dev` solo detecta el desfase                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm transform <comando>`                           | Corre SQLMesh (`plan`, `run`, `test`, `audit`, `lint`…) sobre el lakehouse. **Es la única forma soportada**: `uv run sqlmesh` directo se salta la verificación del lakehouse y los secretos ([por qué](docs/02-transformacion.md))                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm ingest <source> [--json]`                      | Trae una fuente con ingesta a su landing en el lakehouse (hoy `github`), de forma incremental. **Es la única forma soportada** de correr la ingesta: abre el lakehouse antes y le pasa los secretos solo a ese proceso. Termina con un código de salida (75: reintentable) y, con `--json`, un resumen en stdout; para que stdout lleve solo el JSON: `pnpm --reporter=silent ingest github --json` ([`docs/07`](docs/07-orquestacion.md) §7.1)                                                                                                                                                                                  |
| `pnpm stack:up` / `stack:down` / `stack:logs`        | Todo en contenedores, con las imágenes de la plataforma (gateway y web) construidas desde este checkout: la web, en `http://127.0.0.1:3000` / detener / ver logs. No corre a la vez que `pnpm dev`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm reset:local`                                   | **Destructivo**: borra la infraestructura local, sus datos y `.data/lakehouse` (pide confirmación). `.env` y las extensiones de DuckDB no se tocan                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Chequeos estáticos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                          | Unit tests (sin infraestructura)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test:integration`                              | Tests contra Postgres, el object storage, DuckDB/DuckLake y Cube reales — requiere `pnpm bootstrap` hecho y `pnpm dev` corriendo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test:image`                                    | Tests sobre la imagen del gateway ya construida (`pnpm stack:up`): sin TypeScript, Vite ni Vitest, sin privilegios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

La infraestructura local publica sus puertos solo en `127.0.0.1`: Postgres en **55432** (no 5432,
para no chocar con un Postgres ya instalado), OTLP en 4317/4318, el health check del Collector en
13133, el object storage en 53900 (S3) y 53903 (administración), y Cube en 4000 (REST) y 15432 (SQL
API). La web (`pnpm dev` o `pnpm stack:up`) usa el **3000**. Se cambian en `.env`. Cube y Cube Store no tienen salida a Internet: viven en una red interna, igual que el gateway y el proxy de `pnpm stack:up`.
Cube solo acepta el token corto que firma la plataforma, también en el SQL API (como contraseña): no
hay una contraseña fija, y cada consulta ve solo las filas de quien pregunta ([`docs/04`](docs/04-semantico.md) §6.6).

## Estructura

Ver "Estructura del monorepo" en [`CLAUDE.md`](CLAUDE.md). Cada paquete aparece en su paso del
orden de construcción; lo construido hasta ahora está en [`CHANGELOG.md`](CHANGELOG.md).
