# Documento de implementación: operabilidad y runtime

> Hasta este documento, el proyecto diseñó arquitectura abstracta (qué capas existen, qué contratos hay entre ellas) pero nunca cerró **cómo existe físicamente el sistema**: qué corre como servicio permanente y qué no, cómo arranca, qué le pasa a alguien que clona el repo en una laptop limpia. Sin esto, Claude Code puede terminar creando un contenedor para SQLMesh (que no es un servidor) o pidiéndole al usuario de BI que abra una terminal (que nunca debería hacerlo). Este documento cierra ese contrato.

**Regla de fondo, repetida porque es la que más se rompe en la práctica: el desarrollador/administrador arranca la plataforma desde la terminal. El usuario de BI jamás toca una terminal — abre el navegador, entra a una URL, y trabaja.**

---

## 1. Topología real — qué es un servicio permanente y qué no

| Componente | ¿Proceso permanente? | Cómo corre |
| --- | --- | --- |
| SvelteKit | Sí | Servicio web |
| API Gateway | Sí | Servicio Node/TS |
| Cube Core | Sí | Servicio |
| Cube Store | Sí | Servicio |
| Postgres | Sí | Servicio |
| Object storage (MinIO en local, S3-compatible en nube) | Sí en local | Servicio — **decisión pendiente antes del Paso 3:** el repositorio `minio/minio` está archivado, así que la pieza local S3-compatible se reevalúa con la regla 7 antes de agregarla al compose. Hasta entonces el lakehouse usa una carpeta local (Paso 1) |
| OTel Collector | Sí | Servicio |
| Airflow | Sí, cuando se habilita orquestación (perfil MVP en adelante, sección 4) | Servicios de Airflow |
| ElectricSQL | Sí, fase realtime | Servicio |
| OpenMetadata | Sí, fase metadata | Servicios propios |
| **DuckDB** | **No** | Embebido — nunca un "servidor DuckDB" |
| **DuckLake** | **No** | Catálogo + storage, no un servidor propio |
| **SQLMesh** | **No** | Proceso/job/CLI (`sqlmesh run`, disparado por Airflow) |
| **dlt** | **No** | Pipeline/job, disparado por Airflow |
| better-auth | No necesariamente | Librería dentro del backend (API Gateway), no un servicio aparte |
| ECharts / TanStack Table | No | Corre en el navegador |
| OpenTofu | No | CLI de *provisioning*, corre y termina |

**Por qué esta tabla importa más de lo que parece:** sin ella, es fácil terminar creando infraestructura para algo que no la necesita (un contenedor "always-on" para SQLMesh, que en realidad es un comando que corre y termina) — exactamente el tipo de complejidad accidental que el resto de este proyecto evita.

---

## 2. La experiencia canónica — un comando, no doce

**El usuario de BI nunca ve nada de esto — abre `http://localhost:3000` (local) o `https://bi.empresa.com` (producción) y trabaja.** Lo que sigue es para quien desarrolla o administra la plataforma.

```bash
# Primera vez
git clone ...
cd bi-platform
corepack enable   # una vez por máquina: usa la versión exacta de pnpm fijada en package.json
pnpm install
pnpm bootstrap    # valida prerrequisitos, copia .env.example → .env, levanta la infraestructura, aplica migraciones

# Uso cotidiano
pnpm dev          # ver sección 3
```

**Corrección de nombres, detectada al implementar el Paso 0: `pnpm setup` y `pnpm doctor` son comandos nativos de pnpm** — con esos nombres, pnpm ejecuta su propio comando y el script del proyecto nunca corre (y `pnpm setup` nativo, además, modifica el perfil de la shell de quien lo escribe). Se renombran a **`pnpm bootstrap`** y **`pnpm preflight`**. Los scripts viven en `tools/platform-cli` (TypeScript ejecutado directo por Node 24, sin build step); `tools/` es una carpeta de herramientas de desarrollo, no una capa.

**No se agrega `just`, `make`, ni un `Taskfile` solo para esto** — ya existe `pnpm` en la raíz del monorepo (`00-documentacion-general.md`, estructura de carpetas); es la UX operativa, y por debajo llama a Turborepo, Podman y scripts de Node multiplataforma. Agregar una segunda herramienta de orquestación de comandos solo duplicaría lo que ya tenemos.

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Infraestructura en contenedores (Postgres, Cube, etc.) + API/Web como procesos locales con *hot reload* — la experiencia de desarrollo día a día |
| `pnpm stack:up` / `stack:down` / `stack:logs` | Todo containerizado (formato OCI) — para probar cómo se comportaría una instalación real, y para los tests E2E de `15-testing-cicd.md` |
| `pnpm preflight` | Verifica que la máquina tiene lo necesario (Node, pnpm, uv, Podman, compose provider, puertos libres) antes de arrancar nada — solo verifica, nunca instala ni cambia nada |
| `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` | La pirámide de testing de `15-testing-cicd.md` — `test` son unit tests sin infraestructura; `test:integration` necesita `pnpm dev` corriendo (Postgres real); `test:e2e` llega con el primer recorrido de punta a punta |
| `pnpm seed` | Carga datos de demo (sección 6) — nunca corre solo, siempre a pedido explícito. Llega en el Paso 1 con el dataset del lakehouse; la organización y los usuarios demo se suman en el Paso 4 |
| `pnpm transform <comando>` | Corre SQLMesh (`plan`, `run`, `test`, `audit`, `lint`…) sobre el lakehouse — **la única forma soportada** (`02-transformacion.md` §6.5): verifica el lakehouse antes y le pasa los secretos solo a ese proceso. `test` y `lint` corren sin lakehouse ni secretos |
| `pnpm reset:local` | **Destructivo, siempre explícito.** Pide escribir `atlasbi` para confirmar (o `--confirm=atlasbi` en uso no interactivo) y borra los volúmenes; `.env` no se toca. Nunca se esconde un borrado de datos dentro de `dev` — si `pnpm dev` alguna vez necesita limpiar algo, lo pide, no lo hace solo |

**Por qué `pnpm dev` y `pnpm stack:up` son comandos distintos, no el mismo con una bandera:** durante desarrollo, *hot reload* en el código propio (Web, API Gateway) es lo que hace productivo el día a día — nadie quiere reconstruir un contenedor cada vez que cambia una línea de Svelte. Pero esa velocidad esconde diferencias reales con producción (variables de entorno, healthchecks, tiempos de arranque). `stack:up` es la versión honesta — todo en contenedores, la misma forma en que corre de verdad — y es la que se usa para el vertical slice de validación (`16-mvp-definicion-terminado.md`) y para CI.

---

## 3. Qué hace `pnpm dev`, paso a paso

```
pnpm dev
   │
   ├── pnpm preflight (verificación de prerrequisitos, falla rápido si falta algo)
   ├── valida .env (configuración + secretos obligatorios, sección 7) — falla antes de levantar nada
   ├── levanta infraestructura en Podman: Postgres, object storage, OTel Collector, Cube, Cube Store
   ├── aplica migraciones pendientes (sección 5)
   ├── arranca API Gateway (hot reload)
   ├── arranca SvelteKit (hot reload)
   ├── espera los health checks de cada pieza (sección 7) — nunca asume que "arrancó" es lo mismo que "está listo"
   │
   └── imprime:

       BI Platform ✓

       Web:       http://localhost:3000
       API:       healthy
       Cube:      healthy
       Warehouse: healthy
       OTel:      healthy
```

Si algo no está saludable, `pnpm dev` no imprime el resumen de arriba como si todo estuviera bien — muestra explícitamente qué pieza falló y por qué, antes de dejar que alguien abra el navegador y se encuentre con errores confusos más adelante.

**Paso 2:** `pnpm bootstrap` además prepara el entorno Python de `packages/transform` (`uv sync --frozen`, la única descarga de esa pieza) y la base `sqlmesh_state`; `pnpm preflight` verifica sin red que el entorno coincida con `uv.lock`. `pnpm dev` no corre SQLMesh: es un job, no un servicio (§1) — lo programa Airflow en el Paso 8.

**Alcance real a partir del Paso 1:** el resumen lista Postgres, Migrations, OTel Collector y **Lakehouse** (`healthy — Catalog: PostgreSQL`, o `healthy — Catalog: SQLite (single-writer mode — recommended for individual development)`; depende de Postgres solo si el catálogo es PostgreSQL). `pnpm bootstrap` agrega, una sola vez, la base del catálogo, las extensiones de DuckDB (la única descarga, línea `DuckDB extensions`) y el aprovisionamiento del lakehouse; `pnpm dev` solo verifica — nunca instala, descarga ni crea nada (`01-motor-almacenamiento.md` §6.7). `pnpm preflight` verifica sin red las extensiones y que las carpetas del lakehouse se puedan escribir.

**Alcance real a partir del Paso 0 (0.1.0):** el resumen solo lista lo que existe — Postgres, Migrations, OTel Collector. Web, API y Cube se suman a la cadena en sus pasos (3, 5, 6); hasta que exista algo con *hot reload*, `pnpm dev` termina después del resumen y la infraestructura queda corriendo en segundo plano (`pnpm stack:down` la detiene).

---

## 4. Perfiles — no todo tiene que estar arriba para cambiar un botón

**Corrección de un problema real: levantar OpenMetadata + Electric + Airflow + Grafana completos cada vez que alguien quiere ajustar un componente de frontend es fricción innecesaria.** Perfiles acumulativos:

| Perfil | Incluye |
| --- | --- |
| `CORE` | Postgres, object storage, Cube, Cube Store, OTel |
| `MVP` | CORE + Airflow |
| `REALTIME` | MVP + ElectricSQL |
| `METADATA` | REALTIME + OpenMetadata |
| `OBSERVABILITY` | + backend de OTel (Grafana/Tempo/Loki, ver `11-infraestructura.md` §4.6) |
| `FULL` | Todo |

```bash
pnpm dev              # perfil por defecto: CORE
pnpm dev:mvp
pnpm dev:realtime
pnpm dev:full
```

---

## 5. Migraciones — un solo mecanismo, nunca `CREATE TABLE` disperso

**Corrección de un hueco real: ya aparecen varias tablas propias (`workspace_membership`, `data_entitlements`, `dashboard_widget`, `dashboard_filter`, `user_measures`, y ahora `report`/`page`/`visual` — sección 8) sin que nunca se haya dicho quién las crea y versiona.**

```
packages/database/
  migrations/
    000001_workspaces.sql
    000002_reports.sql
    ...
```

**Convención fijada al implementar el Paso 0:** seis dígitos (coherente con "DB Migration 000072" de `21-engineering-standards.md` §2), `snake_case` en inglés, SQL plano leído por un `MigrationProvider` propio de Kysely — *forward-only* (un error se corrige con una migración nueva, nunca editando una aplicada). En Postgres, Kysely aplica todo el lote pendiente en una sola transacción: si una migración falla, no queda ninguna aplicada a medias. La carpeta arranca vacía a propósito: la primera tabla real es del Paso 4 (Auth).

**Corrección de una decisión que quedaba abierta, señalada en una revisión posterior: no es sano dejar que Claude Code elija el mecanismo de migraciones mientras programa — se congela ahora.** La capa de datos de la API Gateway (capa 6) usa **`pg`** (el driver) + **Kysely** (query builder tipado, MIT, sin dependencias en runtime, pensado como una capa delgada sobre SQL — no un ORM pesado tipo Prisma) + **Kysely Migrator** como único mecanismo de migración. Corre como parte de `pnpm setup` (primera vez) y de `pnpm dev`/`stack:up` (migraciones pendientes) — nunca a mano, nunca disperso entre TypeScript y documentos de arquitectura como los `CREATE TABLE` que hasta ahora vivían solo en Markdown.

---

## 6. Seed de desarrollo

Después de `pnpm bootstrap`, `pnpm seed` genera, **solo en desarrollo**:

- Una organización demo, un workspace "Comercial"
- Un usuario `admin` y un usuario `viewer` (para poder demostrar RLS de inmediato, sin configurar Salesforce el primer día)
- Un dataset, un reporte, una página, 3 visuales

Esto es lo que hace posible correr el script de la demo de aceptación (`16-mvp-definicion-terminado.md`, sección 4) sin depender de que una fuente externa real ya esté conectada.

**Implementado en el Paso 1 — solo el dataset:** `pnpm seed` reemplaza `lake.fixture.sales_orders`, 20.000 filas determinísticas (cada columna es función del número de fila: mismas filas en cualquier máquina y en los dos catálogos), y termina con el vaciado explícito de *Inlining v1*. Es idempotente, se niega a correr con `ATLASBI_ENV=production`, y es la base de los primeros modelos del Paso 2 hasta que la ingesta real (Paso 7) lo reemplace. La organización, los usuarios y el reporte demo llegan con el Paso 4.

---

## 7. Configuración — contrato, no solo `.env`

**`.env.example` documenta cada variable, y la aplicación falla inmediatamente al arrancar si falta una obligatoria — nunca 20 minutos después, con un `undefined` silencioso en medio de una consulta.**

```bash
# .env.example (ilustrativo, no exhaustivo)
DATABASE_URL=
DUCKLAKE_CATALOG_URL=
S3_ENDPOINT=
S3_BUCKET=
CUBE_URL=
CUBEJS_API_SECRET=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Validación al arrancar (parte de `pnpm dev`/`pnpm bootstrap` y del bootstrap de la API Gateway) — un esquema de configuración (ej. con `zod`, ya presente en el proyecto vía tRPC) que rechaza el arranque con un mensaje claro si algo obligatorio no está.

**Implementado en el Paso 0 (`packages/config`, contrato "Config Schema v1"):**

- Variables propias con prefijo `ATLASBI_` (codename, `21-engineering-standards.md` §1); las de terceros conservan su nombre estándar (`OTEL_*`, y más adelante `CUBEJS_*`). El `.env.example` real documenta cada una.
- `loadConfig()` valida la configuración no secreta y la traduce a un objeto de dominio (`{ environment, secretProvider, telemetry }`) — ningún código lee nombres de variables de entorno directo. Un `KEY=` vacío cuenta como "no definido".
- Los secretos nunca se leen como configuración: pasan por el puerto `SecretProvider` (`11-infraestructura.md` §4.7) con claves lógicas (`database.url`); el adaptador `EnvSecretProvider` las mapea a `ATLASBI_DATABASE_URL`. `assertSecretsAvailable()` resuelve todos los obligatorios al arrancar y lista **todos** los faltantes de una vez, nombrando la variable a definir.
- El puerto de host de Postgres por defecto es **55432**, no 5432, para no chocar con un Postgres ya instalado en la máquina (caso real encontrado al implementar).

**Paso 1 — "Config Schema v2":** agrega la sección `lakehouse` del objeto de dominio. `ATLASBI_LAKEHOUSE_CATALOG_TYPE` es `postgres` (por defecto) o `sqlite`, y `duckdb` se rechaza explicando por qué; `ATLASBI_LAKEHOUSE_DATA_PATH`, `ATLASBI_LAKEHOUSE_SQLITE_PATH` y `ATLASBI_DUCKDB_EXTENSION_DIRECTORY` son opcionales, con *defaults* bajo `.data/` y rutas relativas a la raíz del repo. El secreto nuevo `lakehouse.catalog-url` (`ATLASBI_LAKEHOUSE_CATALOG_URL`) solo es obligatorio con catálogo PostgreSQL. Como `bootstrap` nunca reescribe un `.env` existente, quien ya tenía uno lo completa a mano desde `.env.example`: `pnpm dev` falla en segundos nombrando la variable que falta.

---

## 8. El Report Document Model — esquema real, sin tabla espejo

**Corrección de un problema estructural real, señalado en una revisión posterior: la primera versión de esta sección dejaba dos fuentes de verdad para la misma entidad** — `visual.position` por un lado, `dashboard_widget.x/y/width/height` por otro, sincronizadas "al guardar" de una forma que nunca quedó bien definida. Eso es exactamente el tipo de ambigüedad que genera bugs de sincronización reales (¿qué pasa si alguien mueve un widget mientras otro guarda el reporte?). **La corrección: no hay tabla espejo — ElectricSQL sincroniza las filas canónicas de `visual` directamente, con la misma concurrencia optimista ya diseñada.**

```sql
CREATE TABLE report (
    id             UUID PRIMARY KEY,
    workspace_id   TEXT NOT NULL,
    name           TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    created_by     TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE page (
    id         UUID PRIMARY KEY,
    report_id  UUID NOT NULL REFERENCES report(id),
    name       TEXT NOT NULL,
    "order"    INT NOT NULL
);

CREATE TABLE visual (
    id               UUID PRIMARY KEY,
    page_id          UUID NOT NULL REFERENCES page(id),
    type             TEXT NOT NULL,     -- 'chart' | 'matrix' | 'kpi' | ...
    position         JSONB NOT NULL,    -- { x, y, width, height }
    visual_spec      JSONB NOT NULL,    -- qué medida/dimensiones consulta (Visualization Engine, 18-first-class-citizens.md)
    formatting_spec  JSONB,             -- Formatting & Theme Engine, todavía sin diseño detallado — este campo ya le reserva el lugar
    version          BIGINT NOT NULL DEFAULT 1,
    updated_by       TEXT,
    updated_at       TIMESTAMPTZ
);

-- Corrección adicional (ver "antes del Builder" en 20-product-ui-ux.md): un filtro que el AUTOR
-- define y guarda es una entidad distinta de una selección temporal del usuario (InteractionState,
-- 14-interaction-state-engine.md) — nunca la misma tabla.
CREATE TABLE filter_definition (
    id         UUID PRIMARY KEY,
    scope      TEXT NOT NULL,   -- 'report' | 'page' | 'visual'
    scope_id   UUID NOT NULL,   -- report_id, page_id o visual_id según el scope
    member     TEXT NOT NULL,   -- mismo formato que un member de Cube/Filter AST
    operator   TEXT NOT NULL,
    value      JSONB NOT NULL,
    version    BIGINT NOT NULL DEFAULT 1
);
```

**`visual` (y `filter_definition`) son la única fuente de verdad — no existe `dashboard_widget`/`dashboard_filter` como tabla aparte.** El flujo de mutation, ya diseñado en `14-interaction-state-engine.md`, aplica directo sobre `visual`:

```
Svelte ──mutation { ..., expectedVersion }──► API Gateway
                                                  │
                                                  ▼
                              UPDATE visual SET position = ..., version = version + 1
                              WHERE id = ? AND version = $expectedVersion
                                                  │
                        0 filas (conflicto) ──────┴────────── 1 fila (confirmado)
                                                                    │
                                                                    ▼
                                                              ElectricSQL Shape
                                                                    │
                                                                    ▼
                                                        Todos los clientes conectados
```

**Qué pasa con `dashboard_id`, que ya aparece en otros documentos (`user_measures.dashboard_id`, `InteractionState` por dashboard):** ver la corrección de terminología en la sección 8.2 — pasa a ser `report_id`, consistente con esta tabla.

### 8.1 Versionado de `VisualSpec`/`FormattingSpec`/`ThemeSpec` y migración del documento — antes del Builder, no del MVP

**Corrección de dos huecos reales, señalados en una revisión posterior — ninguno bloquea el MVP, pero los dos bloquean empezar el Authoring Engine si no están resueltos antes.**

**Primero: `visual_spec` y `formatting_spec` son hoy `JSONB` sin contrato — eso es aceptable para el MVP (donde nadie construye el Builder todavía), pero antes del Builder necesitan una forma tipada mínima**, coherente con el Visualization Engine y el Formatting Engine ya nombrados en `18-first-class-citizens.md`:

```ts
// packages/contracts/visual-spec.ts — versionado igual que el resto del documento
interface VisualSpecV1 {
  version: 1;
  kind: 'line' | 'bar' | 'kpi' | 'matrix'; // tipo de visual de la gramática propia — nunca un renderer
  measures: string[];
  dimensions: string[];
}

interface FormattingSpecV1 {
  version: 1;
  numberFormat?: { type: 'currency' | 'percent' | 'decimal'; locale: string };
  conditionalRules?: { if: string; style: Record<string, string> }[];
}
```

**Corrección posterior de este ejemplo:** la primera versión persistía `adapter: 'echarts' | 'matrix'` — el nombre del renderer dentro del documento del reporte, justo lo que `21-engineering-standards.md` §3.1 prohíbe. `VisualSpec` declara **qué** se visualiza (el `kind` de la gramática de la plataforma, *data roles*, encoding); **cuál** renderer lo dibuja lo decide el Visualization Compiler en tiempo de render (`22-visualization-engine.md` §2). Así, cambiar o sumar renderers nunca obliga a migrar reportes guardados. Los valores de `kind` de arriba son ilustrativos.

**Segundo: `report.schema_version` ya existe en la tabla (sección 8), pero todavía no hay un mecanismo que lo use.** Sin esto, un `VisualSpec` que cambie de forma dentro de tres años deja huérfanos a los reportes creados hoy. La corrección: cada versión de `VisualSpec`/`FormattingSpec` trae su propia función de migración, aplicada de forma perezosa (al abrir el reporte, no en un *batch* masivo):

```ts
// packages/contracts/migrations/visual-spec.ts
const migrations: Record<number, (old: unknown) => unknown> = {
  1: (v0) => ({ ...v0, version: 1 /* ajustes de forma v0→v1 */ }),
  // 2: (v1) => ({ ...v1, version: 2, ... }), cuando exista v2
};

function migrateVisualSpec(spec: { version: number }): VisualSpecV1 {
  let current = spec;
  while (current.version < CURRENT_VERSION) {
    current = migrations[current.version + 1](current);
  }
  return current as VisualSpecV1;
}
```

Esto no se construye para el MVP (donde `VisualSpec` todavía no tiene ni una versión que migrar) — se nombra y se reserva el campo (`report.schema_version` ya existe) para que el día que haga falta, no sea un rediseño de esquema.

### 8.2 Terminología: "Report", no "Dashboard" — para V1

**Corrección de una inconsistencia real: los documentos usaban "report" y "dashboard" como sinónimos, cuando conceptualmente son cosas distintas.** Se define, desde ahora:

- **`Report`**: el artefacto de BI multipágina (`report` → `page` → `visual`, arriba) — lo que un autor construye y publica. Es el único concepto que existe en V1.
- **`Dashboard`**: reservado para una capacidad futura y distinta — una superficie de monitoreo de una sola página, con visuales "pineados" desde uno o más reports (el mismo patrón que históricamente separó Power BI). **No existe en V1** — no hay que construir nada para esto todavía, solo evitar usar la palabra como si ya existiera.

**Consecuencia práctica: toda referencia a `dashboard_id` en otros documentos de este proyecto (`14-interaction-state-engine.md`, `17-self-service-calculations.md` en `user_measures.dashboard_id`, `18-first-class-citizens.md`) pasa a ser `report_id`** — no son dos conceptos, es el mismo, con el nombre ya corregido.

---

## 9. Health / readiness — no alcanza con "el contenedor está corriendo"

```
Postgres ready
     ↓
migraciones aplicadas
     ↓
Cube ready
     ↓
API Gateway ready
     ↓
Web ready
```

Cada servicio de la sección 1 expone un endpoint de *readiness* — `pnpm dev` (sección 3) espera esta cadena antes de imprimir el resumen final, en vez de asumir que "el proceso arrancó" significa "está listo para recibir tráfico".

---

## 10. Un solo punto de entrada HTTP — el navegador no conoce la topología interna

**El navegador nunca habla directo con Cube, Postgres, Airflow o Electric — solo con un único dominio.**

```
https://bi.empresa.com  (o http://localhost:3000 en local)
│
├── /              → SvelteKit
├── /api/trpc      → API Gateway (BFF interno)
├── /api/v1        → API Gateway (OpenAPI público, 06-api-gateway.md)
└── /auth          → flujo de better-auth
```

Cube, Postgres, Cube Store, Electric, Airflow, OpenMetadata quedan en la red interna, nunca expuestos directo — es la misma regla que ya rige en `06-api-gateway.md` ("Cube Core nunca se expone directo al frontend"), aplicada ahora a nivel de red, no solo de código. **Pendiente de decidir al momento de desplegar producción, no bloqueante para escribir el primer modelo:** el proxy/*ingress* concreto (Caddy o Nginx son los candidatos razonables) — resolverlo ahora sería adelantarse a una decisión que no cambia nada del código de las 12 capas. Esto también evita, de entrada, problemas de CORS y cookies entre dominios que aparecerían si el navegador tuviera que hablar con varios *hosts* distintos.

---

## 11. Qué es bloqueante antes del primer commit, y qué puede esperar

| Bloqueante ahora | Antes del Builder | Puede esperar |
| --- | --- | --- |
| Runtime/topología (sección 1) | Report Document Model ya tiene esquema (sección 8, resuelto en este mismo documento) | Plugin SDK completo |
| `pnpm dev`/`stack:up` (secciones 2-3) | Matrix Engine con datos reales del modelo de arriba | Paginated reports |
| `.env.example` + validación (sección 7) | | Export Engine completo |
| Mecanismo de migraciones (sección 5) | | Presence avanzado (cursores) |
| `versions.md` ya creado | | UI de OpenMetadata |
| | | Producción HA |

Esto evita el otro extremo: intentar especificar el 100% del producto antes de escribir la primera línea de código.
