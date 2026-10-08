# CLAUDE.md — Guía del proyecto para Claude Code

Este archivo da contexto a Claude Code al trabajar en este repositorio. Léelo por completo antes de escribir o modificar código.

## Qué es este proyecto

Una plataforma de BI moderna y 100% open source diseñada para reemplazar y superar a Power BI, capa por capa, sin ninguna de sus limitaciones estructurales (formato binario opaco, DAX, licenciamiento por usuario, arquitectura cliente-servidor obligatoria) — y rescatando además lo mejor de otros líderes del mercado (Tableau, Looker, Qlik, ThoughtSpot, Sigma Computing).

**Leer en este orden:**
1. `docs/IMPLEMENTATION.md` — referencia compacta y accionable. Empezar siempre acá, no en la narrativa.
2. `docs/13-recorrido-end-to-end.md` — cómo se ve un dato real atravesando las 12 capas, con nombres de archivo reales.
3. `docs/16-mvp-definicion-terminado.md` — qué entra y qué no entra en la primera versión.
4. `docs/14-interaction-state-engine.md`, `docs/15-testing-cicd.md`, `docs/17-self-service-calculations.md` — diseño de piezas que faltaban (interacción/estado, testing, y cómo el usuario del dashboard crea medidas sin aprender un lenguaje nuevo).
5. `docs/18-first-class-citizens.md` — **leer antes de tocar cualquier código de la Capa 8**: distingue las capacidades arquitectónicas (Semantic Model, Filter Engine, Matrix Engine, etc.) de las herramientas que las implementan hoy. Nunca confundir una con la otra — es el error más caro de corregir después.
6. `docs/19-operabilidad-runtime.md` — **leer antes de escribir el primer `docker-compose`/`podman-compose`**: qué corre como servicio permanente y qué no, cómo arranca la plataforma (`pnpm dev`), migraciones, seed, health checks, el esquema real del Report Document Model.
7. `docs/20-product-ui-ux.md` — **leer antes de tocar la Capa 8**: qué UI es nuestra (Svelte) y qué UI es de una herramienta técnica externa (dlt, SQLMesh, Airflow, Cube, OpenMetadata) — nunca clonarlas, siempre deep-link. La arquitectura de experiencia (Viewer/Author/Explore/Datos/Monitor/Admin) y la anatomía del Report Builder.
8. `docs/22-visualization-engine.md` — **leer antes de tocar cualquier visualización de la Capa 8**: la visualización es un diferenciador principal; `VisualSpec` es contrato propio y nunca persiste configuración de un renderer (ECharts es un adaptador); Custom Components (HTML/CSS/JS) siempre aislados. Es visión: nada de esto entra en un paso anterior al Authoring Engine salvo que el orden de construcción lo diga.
9. `docs/21-engineering-standards.md` — **normativo, aplica a todo el código generado, sin excepción**: inglés obligatorio en identificadores, versionado por contrato separado del versionado del producto, y la arquitectura de Puertos y Adaptadores (ningún tipo de Cube/ECharts/DuckDB/SQLMesh/Electric cruza la frontera de su adaptador).
10. `docs/00-documentacion-general.md` y `docs/01` a `docs/12-metadata-gobernanza.md` — la narrativa completa, con el razonamiento y las correcciones de cada decisión. Consultar solo para el *por qué*, no para el *qué*.

## Las 9 reglas que NUNCA se rompen

1. **Responsabilidad única por capa.** Cada paquete hace una sola cosa. Si vas a escribir lógica de negocio dentro de `packages/warehouse`, o SQL crudo dentro de `apps/web`, para — esa lógica va en otra capa.
2. **Comunicación solo por contrato, nunca por acceso directo.** Ningún paquete importa el código fuente interno de otro, ni lee su base de datos directamente. Toda comunicación pasa por una API, un esquema versionado, o un archivo de formato acordado.
3. **Open source primero, siempre.** No introducir dependencias SaaS propietarias que reintroduzcan vendor lock-in. Todo debe poder self-hostearse.
4. **Texto plano versionable en Git** en cada capa que lo permita (SQL, YAML, JSON, TypeScript, HCL) — nunca binarios opacos como formato de intercambio entre capas.
5. **Reemplazar solo por algo objetivamente mejor**, nunca "porque es más nuevo". Si vas a proponer una librería o herramienta no mencionada en los documentos de capa, justifica por qué supera a la alternativa ya elegida antes de usarla.
6. **Moderno mantiene un estándar mínimo de madurez en producción** — no elegir algo experimental sin decirlo explícitamente y sin marcarlo como tal en el código/PR.
7. **Gobernanza sobre riesgo de abandono — evaluada con criterio, no de forma mecánica.** Ninguna herramienta se descarta ni se acepta solo por "¿tiene fundación o no?" — esa pregunta sola llevó a un error real en este proyecto (ver `12-metadata-gobernanza.md`, sección 3.0: se confundió "una empresa se unió a la Linux Foundation como miembro" con "el proyecto está gobernado por la Linux Foundation"). Evaluar, en cambio: **licencia** (¿abierta de verdad, sin letra chica que se cierre después?), **bus factor** (¿cuánta gente puede seguir manteniéndolo si el mantenedor principal se baja?), **ritmo de releases** (¿sigue vivo?), **forkabilidad** (¿el código es lo bastante chico/simple como para que forkearlo sea realista?), **criticidad** (¿esta pieza calcula lógica de negocio, o es una pieza de UI/infraestructura reemplazable?), y **radio de impacto si falla** (¿romper esto rompe toda la plataforma, o solo un componente aislado?). Orden de preferencia cuando el resto es parejo: (1) fundación neutral con gobernanza real, no solo membresía corporativa de una empresa asociada; (2) empresa con financiamiento real y adopción masiva, documentando el riesgo residual explícitamente; (3) mantenedor individual o proyecto chico — aceptable únicamente cuando la criticidad y el radio de impacto son bajos (una pieza de UI encapsulada, forkeable, con alternativas equivalentes) y **nunca** cuando la pieza es un motor central de cálculo o de datos. No hay una tabla de puntaje fija — es criterio aplicado con la misma vara en ambos sentidos (nunca aceptar en una herramienta lo que se rechazó en otra con el mismo perfil de riesgo, como ocurrió y se corrigió con tRPC/Yjs).
8. **Rescatar lo mejor de todos los líderes de BI, no solo reemplazar Power BI** (Tableau, Looker, Qlik, ThoughtSpot, Sigma) — sujeto siempre a las reglas 1-7. Ninguna idea externa se adopta en su implementación propietaria original; se traduce siempre a una herramienta ya elegida en este proyecto.
9. **No materializar ni duplicar datos sin justificación explícita — sin RAW persistente por defecto.** *AtlasBI does not require a persistent RAW layer by default; logical pipeline stages do not imply physical copies.* En modo Import, DuckLake guarda el resultado analítico (`mart_*`); un **landing** mínimo existe solo cuando la fuente se trae con dlt, y un **snapshot** solo con un motivo explícito y retención. `stg_*`/`int_*` son lógicos por defecto (VIEW, CTE o efímeros) y se materializan solo con una razón demostrable, nunca "por las dudas". Live/DirectQuery no materializa nada. Política canónica en `02-transformacion.md` §6.1.1–6.1.2; retención de DuckLake, explícita y configurable, en `01-motor-almacenamiento.md` §6.8.

## Stack por capa (no cambiar sin actualizar el documento de esa capa primero)

| Capa | Paquete | Tecnología |
| --- | --- | --- |
| Motor de almacenamiento | `packages/warehouse` | DuckDB + DuckLake (catálogo: SQLite en modo portátil, Postgres en modo local/nube; datos: carpeta local en modo portátil, S3 en modo local/nube); MotherDuck opcional para escalar |
| Conectividad a fuentes vivas (DirectQuery, capacidad futura — no del MVP) | dentro de `packages/warehouse` | Extensión `postgres` de DuckDB (`ATTACH ... TYPE POSTGRES`, no `pg_duckdb` — ese vive dentro de Postgres, no al revés) → scanners nativos → ADBC (todo lo demás: SQL Server, Snowflake, BigQuery, Trino) |
| Transformación | `packages/transform` | **SQLMesh** (dbt OSS es alternativa aceptada; misma empresa que ahora es dueña de Tobiko Data, por eso la donación de SQLMesh a la Linux Foundation importa), SQL + Python |
| Ingesta | `packages/ingestion` | **dlt** (`sql_database` para batch, `pg_replication` para CDC en tiempo real) + ADBC como estándar de conectividad — una capacidad, no un paso obligatorio: solo para fuentes que no se leen directo, con landing mínimo (`02-transformacion.md` §6.1.1) |
| Modelo semántico y cálculo | `packages/semantic` | **Cube Core**, YAML declarativo (reemplaza el rol de DAX como capa de cálculo gobernado — métricas, dimensiones, joins, RLS, API SQL/REST/GraphQL; no pretende compatibilidad funcional 1:1 con todo DAX, ver `04-semantico.md` sección 6.4) |
| Copiloto de IA (opcional, apagable) | `packages/ai-copilot` | Interfaz `LLMProvider` + servidor MCP propio sobre Cube Core (Claude es la implementación por defecto, no la única posible) — nunca una herramienta de "ejecutar SQL" |
| API gateway | `packages/api-gateway` | **Fastify** (OpenJS Foundation) como host HTTP + **tRPC** como BFF interno (frontend, capa 8) + **contrato OpenAPI 3.x** como API pública para consumidores externos — cómo se genera OpenAPI (`@trpc/openapi` cuando salga de alpha, un adaptador propio, o un router REST específico) es una decisión de implementación, nunca una obligación del contrato (nunca `trpc-openapi`, archivado sin mantenedores desde nov. 2024) |
| Base de datos/migraciones | `packages/database` | **`pg`** (driver) + **Kysely** (query builder tipado, MIT, sin dependencias runtime) + **Kysely Migrator** como único mecanismo de migración — nunca un ORM pesado (Prisma) ni `CREATE TABLE` disperso entre TypeScript y Markdown |
| Orquestación | `packages/orchestrator` | **Apache Airflow** (DAGs en Python) |
| Frontend | `apps/web` | SvelteKit + Svelte 5 (runes) + **Apache ECharts** (charts) + **GridStack.js** (canvas del authoring, riesgo de gobernanza documentado) + **shadcn-svelte + Tailwind v4** (componentes base copiados al repo; Bits UI, su lógica *headless*, sí es dependencia viva — riesgo residual en `08-frontend.md` §11.2) |
| Auth | `packages/auth` | **better-auth** (Vercel) — Keycloak (CNCF) si hay que federar identidad corporativa existente |
| Colaboración en tiempo real | `packages/realtime` | **ElectricSQL** (Databricks) distribuye el estado ya confirmado (Postgres resuelve la escritura); Yjs no se usa para este caso de uso (razón arquitectónica + gobernanza débil), pero queda evaluable con la regla 7 para una función acotada futura (texto colaborativo) |
| Infraestructura | `infra/` | **OpenTofu** (nunca Terraform — BSL, IBM) + **Podman** (nunca Docker como producto) + **Caddy** (proxy del origen único, Apache-2.0, elegido con la regla 7 — `11-infraestructura.md` §4.4.1) + **Garage** (object storage S3-compatible del modo local, AGPL-3.0 corriendo sin modificar como servicio aparte — nunca MinIO, archivado; `11-infraestructura.md` §4.4) + **Edge Connector Agent propio** (ejecuta conectores dentro de la red del cliente, credenciales locales, conexión saliente únicamente — WireGuard o mTLS como transporte, no como la solución completa) + **OpenTelemetry** (observabilidad transversal, CNCF Graduated, desde el bootstrap — no una capa que se agrega después) + **OpenBao** (secretos en producción self-hosteada, Linux Foundation + OpenSSF, vía interfaz `SecretProvider` — `.env` en desarrollo, gestor nativo de nube en despliegues cloud) |
| Metadata, catálogo y lineage | `packages/metadata` | **OpenMetadata** (Collate Inc.; sin fundación real en esta categoría, riesgo residual documentado como dlt/Cube) — alimentado por ingesta programada desde las capas 2, 3, 4, 7 y 9, nunca escribe en ellas |

**Lenguajes:** SQL + Python en las capas de datos; TypeScript en las capas de aplicación (frontend, API, auth, IA, realtime); HCL para infraestructura; Rust solo si se extiende el motor o se escribe un conector propio — nunca para lógica de negocio cotidiana. **Nunca FastAPI ni ningún otro framework Python para servir requests al frontend** — ese trabajo lo hace la API Gateway en TypeScript; Python queda para las capas de datos.

## Estructura del monorepo

```
bi-platform/
├── compose.yaml             # infraestructura local (Compose Spec, vía `podman compose`)
├── apps/web/                # SvelteKit + Svelte 5
├── packages/
│   ├── contracts/           # puertos y tipos compartidos (SecretProvider, ReportDocument, VisualSpec, ...)
│   ├── contracts-testing/   # baterías de contract tests de esos puertos (solo dependencia de desarrollo)
│   ├── config/              # configuración validada (zod) + adaptadores de SecretProvider
│   ├── database/            # pg + Kysely + Kysely Migrator (migraciones .sql, forward-only)
│   ├── ingestion/           # dlt (Python, entorno propio)
│   ├── transform/           # SQLMesh (Python, entorno propio — nunca comparte venv con ingestion)
│   ├── warehouse/           # DuckDB/DuckLake
│   ├── semantic/            # Cube Core (YAML)
│   ├── api-gateway/         # tRPC
│   ├── reports/             # Report Document Model: report/page/visual (Kysely), `19-operabilidad-runtime.md` §8
│   ├── orchestrator/        # DAGs de Airflow (Python)
│   ├── auth/                # better-auth
│   ├── realtime/            # ElectricSQL
│   ├── metadata/            # OpenMetadata (ingesta programada desde 2, 3, 4, 7, 9)
│   └── ai-copilot/          # Servidor MCP propio + LLMProvider (Claude por defecto)
├── tools/platform-cli/      # pnpm bootstrap/preflight/dev/stack:*/reset:local — herramienta de desarrollo, no una capa
├── infra/                   # OpenTofu, por proveedor; infra/local/ = config de la infraestructura del compose; infra/images/ = imágenes propias + Caddyfile
└── docs/                    # Esta documentación
```

Paquetes con scope `@atlasbi/*` (codename, `docs/21-engineering-standards.md` §1). Cada paquete nace en su paso del orden de construcción — nunca carpetas vacías "para después". Los paquetes TypeScript internos exportan su `.ts` fuente (sin build step: Node 24 lo ejecuta con type stripping nativo), así que solo admiten sintaxis borrable (`erasableSyntaxOnly`: sin `enum`, `namespace` ni parameter properties).

pnpm workspaces + Turborepo para el monorepo JS/TS; cada paquete Python (`ingestion`, `transform`, tareas de `orchestrator`) tiene su propio entorno virtual gestionado independiente — nunca comparten dependencias entre sí ni con el resto del monorepo.

## Niveles de despliegue (ver `docs/00-documentacion-general.md`, sección 8)

El proyecto corre en tres niveles sin reescribir código de aplicación: **portátil** (SQLite + carpeta local, sin servidor), **equipo local** (Postgres vía Podman) y **nube** (Postgres gestionado + bucket S3-compatible, misma región). Ninguna capa de aplicación importa el SDK propietario de un proveedor de nube — siempre protocolo estándar (S3, Postgres wire protocol, contenedor OCI); el nombre de un proveedor concreto solo aparece en `infra/`.

## Orden de construcción (no saltarse pasos)

**Corrección de dos problemas reales, señalados en una revisión posterior: (1) esta lista todavía decía "modo portátil primero", contradiciendo `IMPLEMENTATION.md` y `16-mvp-definicion-terminado.md`, que ya corrigieron esto a "equipo local mínimo" — y este archivo es precisamente el que Claude Code va a obedecer, así que la contradicción importa. (2) Auth llegaba en el paso 8, después del frontend — pero el propio checklist del MVP exige demostrar RLS con dos usuarios viendo datos distintos, lo que es imposible sin Auth ya construido antes.** Secuencia corregida:

0. **Bootstrap** — `pnpm`/`uv` + Podman + Postgres + OTel Collector + interfaz `SecretProvider` + versiones fijadas (`docs/versions.md`) — nunca "modo portátil", el nivel real de arranque es **equipo local mínimo** (`11-infraestructura.md` sección 4.4). La experiencia real es `pnpm bootstrap` una vez, `pnpm dev` en el día a día (no `pnpm setup`/`pnpm doctor`: son comandos nativos de pnpm y nunca ejecutarían el script — `19-operabilidad-runtime.md` §2) — nunca doce comandos sueltos que alguien tiene que recordar (`19-operabilidad-runtime.md`, secciones 2-3).
1. Motor de almacenamiento (DuckDB/DuckLake).
2. Transformación (SQLMesh) — de un fixture/Parquet a `stg_*`/`mart_*`.
3. Modelo semántico básico (Cube Core) — medidas y dimensiones, `/v1/load`, con la batería de *pushdown* de `17-self-service-calculations.md` sección 3.2.2 corrida temprano.
4. **Auth (better-auth + `workspace_membership` + `data_entitlements`)** — antes del frontend, porque el MVP necesita demostrar RLS real, y eso exige que Auth ya exista.
5. API Gateway + seguridad de Cube — JWT para REST, y el experimento obligatorio de `checkSqlAuth` para `/v1/cubesql` (`17-self-service-calculations.md` sección 3.2.4) resuelto acá, no después.
6. Frontend mínimo, modo Viewer (2-3 charts reales con ECharts, cross-filter básico).
7. Primera fuente externa real, reemplazando el fixture del paso 2: con dlt y landing mínimo (una *verified source*, como exige el MVP); las fuentes certificadas para lectura directa no necesitan dlt (`02-transformacion.md` §6.1.1–6.1.2).
8. Orquestación (Airflow): `[dlt, solo si la fuente usa ingesta] → sqlmesh run → refresco de Cube`, más el mantenimiento del lakehouse (retención, `01-motor-almacenamiento.md` §6.8).
9. Interaction Engine + State Engine (Filter AST, drill, `version`/mutations — `14-interaction-state-engine.md`).
10. Colaboración en tiempo real (ElectricSQL) — Shapes sobre `dashboard_widget`/`dashboard_filter`, broadcast servidor→clientes.
11. Cálculos de auto-servicio (Visual Builder + Semantic SQL — `17-self-service-calculations.md`).
12. Copiloto de IA (sobre contratos ya estables — opcional, debe poder apagarse sin romper nada más).
13. Metadata y catálogo (OpenMetadata) — se alimenta de las capas ya construidas, no tiene sentido antes.
14. Producción avanzada: OpenBao, modo nube de OpenTofu, Edge Connector Agent completo.

Si te piden trabajar en un paso posterior sin que los anteriores existan, dilo antes de improvisar una base temporal.

## Al proponer código

**`docs/21-engineering-standards.md` es normativo — todo código generado lo cumple, sin excepción.** En particular: identificadores en inglés, ningún tipo de proveedor (Cube, ECharts, DuckDB, SQLMesh, Electric) cruza la frontera de su adaptador, y el versionado del producto nunca se confunde con el versionado de un contrato (API, esquema de reporte, AST).

- **Naming:** `AtlasBI` es un codename provisional — nunca en contratos, tipos de dominio, objetos de base de datos, formatos persistidos, telemetría ni superficies públicas; solo en scope de paquetes, prefijo `ATLASBI_*`, defaults de desarrollo, docs y el nombre visible desde una única constante. Política completa en `docs/21-engineering-standards.md` §1.

- Antes de escribir en un paquete, revisa si el documento de esa capa ya existe en `docs/` y sigue lo que dice, incluida cualquier sección de correcciones de gobernanza o ideas de otros líderes de BI incorporadas.
- Si el documento de esa capa **no existe todavía**, dilo explícitamente y propone su contenido primero (aunque sea un resumen breve) antes de generar código — no inventes arquitectura para una capa no documentada.
- **Corrección de una regla demasiado estricta (revisión externa):** no está prohibido todo import entre paquetes — está prohibido importar el **detalle interno** de otro paquete (un archivo dentro de `src/internal/` o equivalente, o cualquier ruta que no sea la entrada pública declarada). Consumir la **API pública** que un paquete exporta explícitamente (`import { resolveSecurityContext } from '@atlasbi/auth'`, si `@atlasbi/auth` lo exporta desde su punto de entrada) está permitido — es consumir un contrato, no romperlo. Aplicarlo de forma mecánica ("cero imports, siempre") termina forzando microservicios innecesarios solo para cumplir la letra de la regla en vez de su espíritu. Si dos paquetes necesitan compartir tipos generados (no lógica), van en `packages/contracts/`.
- **Qué puede leer SQLMesh (`packages/transform`):** los modelos **SQL** pueden consultar **fuentes externas registradas por la plataforma** —bases SQL y archivos durables, a través de DuckDB— además de los landings en DuckLake. Solo fuentes registradas; conexión de solo lectura para las operacionales; credenciales siempre vía `SecretProvider`, nunca un secreto dentro de un modelo; ningún `ATTACH` definido por un modelo (`02-transformacion.md` §6.1.2). Los modelos **Python** nunca llaman a una API externa ni abren conexiones de red: eso es trabajo de `packages/ingestion` (dlt), en su propio entorno. SQLMesh se ejecuta **solo** con `pnpm transform` — nunca `uv run sqlmesh` directo (`02-transformacion.md` §6.5).
- Cualquier decisión que se desvíe del stack de la tabla de arriba requiere actualizar primero el `.md` de esa capa, en la misma tanda de cambios, aplicando la regla 7 (gobernanza) a la alternativa propuesta antes de adoptarla.
