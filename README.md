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
pnpm bootstrap      # crea .env, levanta la infraestructura, aplica migraciones, instala las
                    # extensiones de DuckDB (la única descarga) y aprovisiona el lakehouse
pnpm seed           # opcional: dataset de desarrollo en el lakehouse (20.000 filas)
pnpm transform plan # opcional: SQLMesh construye el mart sobre ese dataset
```

**El lakehouse** (DuckDB + DuckLake, [`docs/01`](docs/01-motor-almacenamiento.md) §6.6–6.7) usa por
defecto un catálogo PostgreSQL en el Postgres local (base `lakehouse`) y guarda los datos en
`.data/lakehouse/`. Para un catálogo SQLite portátil (un solo proceso que escribe), poné
`ATLASBI_LAKEHOUSE_CATALOG_TYPE=sqlite` en `.env` y corré `pnpm bootstrap` otra vez. Si ya tenías un
`.env` de antes del Paso 1, agregale `ATLASBI_LAKEHOUSE_CATALOG_URL` desde `.env.example`:
`bootstrap` nunca reescribe un `.env` existente.

Turborepo envía telemetría anónima por defecto; para desactivarla en tu máquina:
`pnpm exec turbo telemetry disable`.

## Día a día

| Comando                                              | Qué hace                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                           | Verifica prerrequisitos y `.env`, levanta la infraestructura local (Postgres, OTel Collector), aplica migraciones pendientes y espera a que cada pieza —incluido el lakehouse— esté lista. Nunca descarga ni crea nada del lakehouse |
| `pnpm preflight`                                     | Solo verifica la máquina: versiones, compose provider, puertos libres, extensiones de DuckDB y carpetas del lakehouse. No cambia nada                                                                                                |
| `pnpm seed`                                          | Carga el dataset de desarrollo en el lakehouse (idempotente; nunca corre solo)                                                                                                                                                       |
| `pnpm transform <comando>`                           | Corre SQLMesh (`plan`, `run`, `test`, `audit`, `lint`…) sobre el lakehouse. **Es la única forma soportada**: `uv run sqlmesh` directo se salta la verificación del lakehouse y los secretos ([por qué](docs/02-transformacion.md))   |
| `pnpm stack:up` / `stack:down` / `stack:logs`        | Todo en contenedores / detener / ver logs                                                                                                                                                                                            |
| `pnpm reset:local`                                   | **Destructivo**: borra la infraestructura local, sus datos y `.data/lakehouse` (pide confirmación). `.env` y las extensiones de DuckDB no se tocan                                                                                   |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Chequeos estáticos                                                                                                                                                                                                                   |
| `pnpm test`                                          | Unit tests (sin infraestructura)                                                                                                                                                                                                     |
| `pnpm test:integration`                              | Tests contra Postgres y DuckDB/DuckLake reales — requiere `pnpm bootstrap` hecho y `pnpm dev` corriendo                                                                                                                              |

La infraestructura local publica sus puertos solo en `127.0.0.1`: Postgres en **55432** (no 5432,
para no chocar con un Postgres ya instalado), OTLP en 4317/4318 y el health check del Collector
en 13133. Se cambian en `.env`.

## Estructura

Ver "Estructura del monorepo" en [`CLAUDE.md`](CLAUDE.md). Cada paquete aparece en su paso del
orden de construcción; lo construido hasta ahora está en [`CHANGELOG.md`](CHANGELOG.md).
