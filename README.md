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
pnpm transform plan # opcional: SQLMesh construye el mart sobre ese dataset
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

Turborepo envía telemetría anónima por defecto; para desactivarla en tu máquina:
`pnpm exec turbo telemetry disable`.

## Día a día

| Comando                                              | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | Verifica prerrequisitos y `.env`, levanta la infraestructura local (Postgres, OTel Collector, object storage, Cube y Cube Store; en el nivel portátil, solo los dos primeros), aplica migraciones pendientes, arranca la API Gateway con _hot reload_ en `http://127.0.0.1:4100` y espera a que cada pieza —incluidos el lakehouse, Cube respondiendo desde él y el `/ready` del gateway— esté lista. Después queda en primer plano con la salida del gateway; Ctrl+C lo detiene y la infraestructura sigue corriendo. Nunca descarga ni crea nada |
| `pnpm preflight`                                     | Solo verifica la máquina: versiones, compose provider, puertos libres (los del nivel configurado), extensiones de DuckDB (las del host y las de Cube) y carpetas del lakehouse. No cambia nada                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm seed`                                          | Carga el dataset de desarrollo en el lakehouse y los accesos demo: organización `demo`, workspaces `comercial` y `finanzas`, `ana@example.com` y `bruno@example.com` con la contraseña de `ATLASBI_SEED_DEMO_PASSWORD` (idempotente; nunca corre solo)                                                                                                                                                                                                                                                                                             |
| `pnpm identity:reconcile`                            | Repara la identidad propia de la plataforma: agrega las personas y organizaciones que el proveedor de identidad conoce y la plataforma no. Nunca borra nada; `pnpm dev` solo detecta el desfase                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm transform <comando>`                           | Corre SQLMesh (`plan`, `run`, `test`, `audit`, `lint`…) sobre el lakehouse. **Es la única forma soportada**: `uv run sqlmesh` directo se salta la verificación del lakehouse y los secretos ([por qué](docs/02-transformacion.md))                                                                                                                                                                                                                                                                                                                 |
| `pnpm stack:up` / `stack:down` / `stack:logs`        | Todo en contenedores / detener / ver logs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm reset:local`                                   | **Destructivo**: borra la infraestructura local, sus datos y `.data/lakehouse` (pide confirmación). `.env` y las extensiones de DuckDB no se tocan                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Chequeos estáticos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test`                                          | Unit tests (sin infraestructura)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test:integration`                              | Tests contra Postgres, el object storage, DuckDB/DuckLake y Cube reales — requiere `pnpm bootstrap` hecho y `pnpm dev` corriendo                                                                                                                                                                                                                                                                                                                                                                                                                   |

La infraestructura local publica sus puertos solo en `127.0.0.1`: Postgres en **55432** (no 5432,
para no chocar con un Postgres ya instalado), OTLP en 4317/4318, el health check del Collector en
13133, el object storage en 53900 (S3) y 53903 (administración), y Cube en 4000 (REST) y 15432 (SQL
API). Se cambian en `.env`. Cube y Cube Store no tienen salida a Internet: viven en una red interna.
Cube solo acepta el token corto que firma la plataforma, también en el SQL API (como contraseña): no
hay una contraseña fija, y cada consulta ve solo las filas de quien pregunta ([`docs/04`](docs/04-semantico.md) §6.6).

## Estructura

Ver "Estructura del monorepo" en [`CLAUDE.md`](CLAUDE.md). Cada paquete aparece en su paso del
orden de construcción; lo construido hasta ahora está en [`CHANGELOG.md`](CHANGELOG.md).
