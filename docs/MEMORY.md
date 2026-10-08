# MEMORY.md — Contexto del proyecto (para retomar en otro chat)

> Este chat fue en modo incógnito, sin memoria persistente. Pega o sube este archivo (junto con los 13 `.md` del proyecto) al iniciar el chat normal para que Claude retome exactamente donde quedamos.

## Qué es el proyecto

Construir con Claude Code una plataforma de BI moderna, 100% open source, que reemplace y **supere** a Power BI capa por capa — no para competir en su mismo terreno, sino aprovechando lo que la arquitectura de Power BI estructuralmente no puede hacer (local-first, colaboración en tiempo real, versionado real en Git, sin licenciamiento por usuario), **y además rescatando lo mejor de otros líderes de BI** (Tableau, Looker, Qlik, ThoughtSpot, Sigma) — no solo igualando a Power BI.

## Estado: las 12 capas ya están documentadas a fondo

`00-documentacion-general.md`, `CLAUDE.md`, y `01-motor-almacenamiento.md` a `11-infraestructura.md` — los 13 archivos existen y están completos, con la misma profundidad de análisis en cada uno (qué se reemplaza, comparación con exigencia real, arquitectura interna, contrato de la capa, por dónde empezar). **Pendiente:** incorporar sistemáticamente ideas de otros líderes de BI, capa por capa (ver sección final).

## Reglas fundamentales del proyecto (`CLAUDE.md`, no reabrir sin razón nueva)

1. Reemplazar solo por algo objetivamente mejor, nunca "porque es más nuevo".
2. Responsabilidad única por capa — comunicación solo por contrato, nunca acceso directo a la base de datos o código de otra capa.
3. Open source primero, siempre. Self-hosteable como requisito.
4. Todo en texto plano versionable en Git.
5. Moderno pero con madurez probada en producción.
6. **Gobernanza sobre riesgo de abandono — evaluada con criterio, no de forma mecánica** (corregida para coincidir con la regla 7 de `CLAUDE.md`; la versión anterior decía "sin excepciones, nunca un mantenedor individual", que ya había sido corregida allí): se evalúan licencia, bus factor, ritmo de releases, forkabilidad, criticidad y radio de impacto. Orden de preferencia cuando el resto es parejo: fundación neutral con gobernanza real > empresa con financiamiento real y adopción masiva (riesgo documentado) > mantenedor individual o proyecto chico, aceptable **solo** si la criticidad y el radio de impacto son bajos — nunca para un motor central de cálculo o de datos.
7. **Rescatar lo mejor de todos los líderes de BI** (Tableau, Looker, Qlik, ThoughtSpot, Sigma), no solo reemplazar Power BI 1:1 — sujeto siempre a las reglas 1-6.
8. **Protocolo estándar sobre API propietaria de proveedor**: ninguna capa de aplicación importa el SDK de un proveedor específico (AWS, GCP, etc.) — siempre vía protocolo estándar (S3, Postgres wire protocol, contenedor OCI). El nombre del proveedor solo aparece en la config de infraestructura como código.

## Analogía de arquitectura (corregida)

- **Corazón** (velocidad) = VertiPaq → **DuckDB + DuckLake**
- **Columna vertebral + cálculo** (el rol que cumplía DAX como capa de cálculo gobernado — no equivalencia funcional 1:1, ver `04-semantico.md` sección 6.4) = Modelo semántico → **Cube Core** (YAML → SQL sobre DuckDB, corre sin IA ni internet)
- **Copiloto conversacional, capa opcional y apagable** (nunca el cálculo) = Copilot de Power BI → **API de Claude + servidor MCP propio sobre Cube Core**

*(Nomenclatura corregida: "Cerebro" ya no se usa para la capa de IA, porque sugería erróneamente que ahí vivía el cálculo — ver `05-cerebro-ia.md` sección 0.)*

## Stack final por capa, con reemplazos confirmados y correcciones de gobernanza

| # | Capa | Herramienta final | Nota de gobernanza |
| --- | --- | --- | --- |
| 1 | Motor de almacenamiento | DuckDB + DuckLake (catálogo: SQLite/Postgres/MySQL según nivel de despliegue) + MotherDuck opcional; DirectQuery futuro vía extensión `postgres` de DuckDB (`ATTACH`, no `pg_duckdb`) + ADBC | Bajo riesgo (DuckDB Foundation) |
| 2 | Transformación | **SQLMesh** (dbt OSS alternativa aceptada; Fivetran compró Tobiko Data en 2025 y se fusionó con dbt Labs en 2026 — la donación de SQLMesh a la Linux Foundation en marzo 2026 blindó al proyecto de eso) | Bajo (Linux Foundation) |
| 3 | Ingesta | **dlt** + ADBC/ConnectorX como estándar de conectividad | Riesgo medio documentado (dltHub Inc., sin alternativa de fundación en esta categoría) |
| 4 | Modelo semántico y cálculo | **Cube Core** (MetricFlow descartado: depende de dbt, no de SQLMesh) | Riesgo medio documentado (Cube Dev Inc.; mitigado por Apache Ossie, el ex-Open Semantic Interchange, en incubación ASF desde jun. 2026) |
| 5 | Copiloto conversacional (IA) | API de Claude + servidor MCP **propio** (nunca "ejecutar SQL" como herramienta) sobre Cube Core | Capa opcional/apagable por diseño; sin ella el resto de la plataforma sigue funcionando |
| 6 | API Gateway | **tRPC** como BFF interno (oRPC descartado: sostenido por sponsors individuales) + **contrato OpenAPI 3.x** como API pública versionada, para consumidores externos (SDK, CLI, agentes) — cómo se genera es una decisión de implementación, no una obligación (nunca atado a `trpc-openapi`, archivado, sin mantenedores desde nov. 2024) | Adopción masiva mitiga falta de fundación (tRPC) |
| 7 | Orquestación | **Apache Airflow** (Kestra descartado: empresa VC-funded) | Bajo (ASF) |
| 8 | Frontend | SvelteKit + Svelte 5 + **Apache ECharts** (LayerChart descartado: un solo mantenedor) — wrapper propio en `$effect` para conectar ECharts con runes | Bajo (ASF) |
| 9 | Auth y gobernanza | **better-auth** (adquirida por Vercel, ya no startup en etapa semilla) — **Keycloak** (CNCF) si hay que federar identidad corporativa existente | Bajo tras adquisición |
| 10 | Colaboración en tiempo real | **ElectricSQL** (adquirida por Databricks) distribuye el estado ya confirmado — Postgres resuelve la escritura, no Electric; granularidad por widget/filtro, no un blob por dashboard. **Yjs no se usa para este caso de uso** (razón arquitectónica + gobernanza débil), pero no queda vetado para siempre — evaluable con la regla 7 para una función acotada futura (texto colaborativo) | Bajo tras adquisición (ElectricSQL) |
| 11 | Infraestructura | **Podman** (no Docker Inc.) + **OpenTofu** (no Terraform, relicenciado BSL + IBM) + **Garage** (object storage S3 del nivel equipo local, desde el Paso 3; MinIO descartado, archivado) + **Edge Connector Agent propio** (WireGuard/mTLS como transporte — corrección: WireGuard solo no equivale a un Gateway completo) | Bajo (Red Hat / Linux Foundation-CNCF / kernel Linux) |
| 12 | Metadata, catálogo y lineage | **OpenMetadata** (capa nueva, agregada por análisis de producto externo) | Medio, documentado (Collate Inc.; sin fundación real en esta categoría — corrección: no es un proyecto de la Linux Foundation, esa empresa solo se unió como miembro corporativo) |

## Niveles de despliegue (flexibilidad real, sin reescribir código)

1. **Portátil**: catálogo DuckLake en SQLite (un archivo), datos en carpeta local — corre en una tablet, sin servidor.
2. **Equipo local**: catálogo en Postgres vía Podman, datos en S3 — Garage vía Podman (corregido en el Paso 3: nunca una carpeta local, por la frontera de contenedor; MinIO descartado).
3. **Nube**: catálogo en Postgres gestionado y datos en bucket S3-compatible, **misma región** (garantizado por una sola variable en OpenTofu) — el usuario elige proveedor por pieza (ej. catálogo en Neon, datos en R2, frontend en DigitalOcean), porque cada pieza habla un protocolo estándar, no la API de un proveedor.

Migrar de un nivel a otro es *copiar datos* (volcado SQLite→Postgres, sync de archivos), nunca reescribir código de aplicación — detalle en `11-infraestructura.md`.

## Cómo se traduce DAX a este stack (para referencia rápida)

- Medida simple (`SUM`) → medida `type: sum` en el YAML de Cube.
- Time-intelligence (`SAMEPERIODLASTYEAR`, variación %) → `time_shift` + `multi_stage: true` en Cube (motor Tesseract, Cube ≥ v1.7.0).
- Lógica compleja fila-por-fila con múltiples ventanas de agregación distintas por entidad (ej. segmentación de clientes combinando período + histórico + condición de exclusión) → **no se fuerza en Cube en vivo**: se pre-calcula como modelo SQL en SQLMesh (capa 2), testeable con audits, y Cube solo cuenta sobre el resultado ya materializado. Esta es la traducción del `REMOVEFILTERS`/`FILTER(VALUES(...))` de DAX — no tiene equivalente de una línea en un semántico live, y forzarlo ahí sería peor que resolverlo donde corresponde.
- Para necesidades exploratorias puntuales (no gobernadas, no repetibles) se evalúa un "SQL Lab" de solo lectura en el frontend, directo contra el warehouse — nunca reemplaza a Cube como camino gobernado, es un escape hatch para análisis ad hoc (pendiente de formalizar, ver abajo).

## Estilo de trabajo acordado

- Documentación separada en archivos `.md`, uno general + uno por capa.
- Se avanza una capa a la vez: análisis con la misma exigencia (comparación real, no confirmación del borrador), qué se reemplaza y por qué, qué se elimina/agrega respecto a Power BI, arquitectura interna, contrato, por dónde empezar — recién después se pide confirmación para avanzar.
- Regla de reemplazo: objetivamente mejor, open source, moderno, con responsabilidad única, **y ahora con la regla de gobernanza (6) aplicada sin excepciones a toda decisión, pasada y futura**.
- Cuando no existe una alternativa de fundación en una categoría (pasó en capas 3 y 4), se documenta el riesgo residual explícitamente en vez de forzar una opción peor solo por cumplir la letra de la regla.

## Qué falta (próximos pasos, en orden)

- [x] Ronda completa de "rescatar lo mejor de otros líderes de BI" — las 11 capas, una por una, cerrada
- [x] **Auditoría externa (ChatGPT + Kimi K3, dos rondas)**: hallazgos verificados y corregidos — ver `AUDITORIA-EXTERNA.md`
- [x] **Análisis de producto (2 chats de ChatGPT)**: agregó la Capa 12 (metadata) y el Authoring Engine completo de la capa 8
- [x] **Documentos de implementación**: `IMPLEMENTATION.md` (referencia compacta), `13-recorrido-end-to-end.md`, `14-interaction-state-engine.md`, `15-testing-cicd.md`, `16-mvp-definicion-terminado.md` — cierran los huecos entre "arquitectura decidida" y "listo para programar"
- [x] Pasar de documentación a implementación real con Claude Code — iniciado con el Paso 0; el avance se registra abajo, en "Registro de construcción"

## Ronda de ideas de otros líderes de BI (cerrada, resumen)

Se revisaron las 11 capas contra Tableau, Looker, Qlik, ThoughtSpot y Sigma (Gartner MQ Analytics & BI, jun. 2026). Sin cambios en capas 1, 7, 11 (ya cubiertas o superadas). Incorporado en:

- **Capa 2**: Input Tables (Sigma) — nueva fuente escribible para SQLMesh.
- **Capa 3**: CDC en tiempo real (Qlik Replicate) — resuelto con `pg_replication` de dlt, mismo mecanismo (WAL de Postgres) que ElectricSQL en capa 10.
- **Capa 4**: exploración asociativa (Qlik) — *disjunctive faceting* sobre el grafo de joins ya explícito, sin cambiar el modelo.
- **Capa 5**: entrega proactiva de insights (Tableau Pulse) — suscripciones + digest vía Airflow.
- **Capa 6**: procedimiento de escritura (cierre de Input Tables) + Action Hub abierto (Looker Actions).
- **Capa 8**: renderizado asociativo, interfaz de planilla (Sigma), SQL Lab (Tableau/DirectQuery), búsqueda opcional encima de los dashboards (ThoughtSpot, adaptada para no romper la regla de apagado de la capa 5).
- **Capa 9**: certificación de datos (Tableau), mejorada con revocación automática vía audits de SQLMesh.
- **Capa 10**: comentarios anclados a un dato (varios), sin mecanismo nuevo.

Detalle completo en `00-documentacion-general.md`, sección 11.

## Registro de construcción (qué se construyó y cuándo)

> Una entrada por milestone completo, con la numeración de `21-engineering-standards.md` §2.1. Registra qué quedó construido y verificado, los contratos introducidos y los desvíos respecto de la documentación — el detalle de cada decisión vive en el documento de su capa y en `versions.md`.

### 0.1.0 — bootstrap (Paso 0) — cerrado el 2026-09-23

**Qué quedó construido y verificado en vivo** (Windows 11, Podman 5.8.3 sobre WSL2):

- Monorepo pnpm 11.27.1 + Turborepo 2.11.2, scope `@atlasbi/*`, versiones en un único `catalog` de `pnpm-workspace.yaml`. Paquetes TypeScript sin build step: Node 24.12 los ejecuta con type stripping nativo (estable justo desde 24.12.0).
- `compose.yaml`: PostgreSQL 17.11 + OpenTelemetry Collector 0.161.0 (core), puertos solo en `127.0.0.1` — Postgres en **55432** (no 5432: la máquina de desarrollo ya tenía un PostgreSQL 14 nativo en 5432).
- `packages/contracts` (puerto `SecretProvider` + batería de contract tests), `packages/config` (configuración validada con zod, `EnvSecretProvider`, secretos obligatorios verificados al arrancar), `packages/database` (`pg` + Kysely + Kysely Migrator sobre `.sql` forward-only; carpeta de migraciones vacía hasta el Paso 4).
- `tools/platform-cli`: `pnpm preflight | bootstrap | dev | stack:up | stack:down | stack:logs | reset:local`, con cadena de readiness (Postgres → Migrations; OTel independiente).
- ESLint 10 + typescript-eslint + Prettier; 39 unit tests + 5 de integración contra Postgres real.
- Verificado: clon nuevo → `pnpm bootstrap` en verde en 8 s; span OTLP real recibido por el Collector; tres casos negativos (secreto faltante, credenciales inválidas, puerto ocupado) fallan rápido y dicen qué pieza y por qué; `reset:local` → `bootstrap` reproduce todo desde cero.

**Contratos introducidos:** Config Schema v1, SecretProvider v1. DB Migration: ninguna aplicada (solo el mecanismo).

**Decisiones del usuario:** codename `@atlasbi/*` + `ATLASBI_*`; `pnpm setup`/`pnpm doctor` renombrados a `pnpm bootstrap`/`pnpm preflight` (chocaban con comandos nativos de pnpm); `docker-compose` standalone como compose provider de Podman (evaluación de regla 7 en `11-infraestructura.md` §4.2); ESLint + Prettier.

**Decisiones con evidencia (detalle en `versions.md`):** TypeScript 6.0.3 y no 7 (typescript-eslint exige `<6.1.0`); pnpm 11 y Vitest 4 (sus majors nuevas tenían 3–4 semanas); PostgreSQL 17 y no 18 (el CI de la extensión `postgres` de DuckDB — el camino de DuckLake — solo cubre 17); Python 3.13 para las capas de datos (máximo común de Airflow, dlt y SQLMesh).

**Desvíos respecto de los docs, ya corregidos en ellos:** DuckLake, MinIO y Cube quedan para los Pasos 1 y 3 (IMPLEMENTATION.md ponía DuckLake en el paso 0; se siguió CLAUDE.md); `seed` y `test:e2e` no existen todavía; se agregó `pnpm test:integration`; migraciones con 6 dígitos.

**Lecciones de la verificación en vivo** (ninguna la detectaban los unit tests, que codificaban suposiciones en vez de salida real): Podman imprime la ruta del compose provider con barras escapadas y el chequeo contra Docker Desktop no la reconocía; el template `{{.Host.Os}}` no existe en Podman 5.8; `podman compose version` necesita el motor corriendo; en Windows, un chequeo de puerto por *bind* da conflictos falsos por sockets en TIME_WAIT (se cambió a chequeo por conexión); un error de credenciales se reintentaba 90 s (ahora falla en ~5 s). Además: Podman Desktop solo no instala el motor, y el repositorio oficial de Podman se mudó a `podman-container-tools/podman` (verificado por id de repo y firma de Red Hat).

**Siguiente:** Paso 1 — motor de almacenamiento (DuckDB + DuckLake con catálogo en este Postgres), empezando por la matriz de compatibilidad DuckDB/DuckLake/Cube que `versions.md` todavía deja en "completar".

### 0.1.1 — seguridad del runtime (PATCH) — 2026-09-24

Node fijado en **24.21.0** (antes 24.12.0). Al revisar el CVE-2026-58041 (`node:sqlite`) para la decisión de WAL del Paso 1 apareció que el pin de 0.1.0 no tenía cuatro *security releases* de la línea 24 (la última, 24.18.1, con fixes de undici, llhttp, HTTP/2 y Permission Model). Instalado desde el MSI oficial con hash y firma verificados; Milestone 0 re-verificado sin regresiones sobre el runtime nuevo. **Lección:** un pin "con evidencia" envejece — se revisa contra las *security releases* antes de cada milestone. Sin cambios de contrato. Separado del "Unreleased" del Paso 1.

### 0.2.0 — vertical slice de datos (Pasos 1 y 2) — cerrado el 2026-09-26

**Qué quedó construido y verificado en vivo** (Windows 11, Node 24.21.0, DuckDB 1.5.5, DuckLake 1.0, SQLMesh 0.236.2 sobre Python 3.13.14):

- **Paso 1 — `@atlasbi/warehouse`:** DuckDB embebido con DuckLake detrás de dos puertos propios, `AnalyticalQueryPort` (solo lectura reforzada en el motor más un *allowlist* de un único `SELECT`) y `LakehouseAdminPort`. Catálogo PostgreSQL (por defecto, base `lakehouse`) o SQLite (portátil, un proceso escritor), con un solo camino de código. Resultados sin pérdida, errores con `code` cerrado y remedio, *Inlining v1* persistido, OpenTelemetry solo con convenciones estables, extensiones instaladas en el proyecto y runtime sin red. `pnpm seed` carga `lake.fixture.sales_orders` (20.000 filas determinísticas).
- **Paso 2 — `packages/transform`:** proyecto SQLMesh en su propio entorno uv. `staging.stg_sales_orders` (vista, cero datos copiados) → `marts.mart_sales_orders` (incremental por fecha, grano pedido, un archivo Parquet), con audits y un unit test. Se corre solo con `pnpm transform`, que verifica el lakehouse antes de que SQLMesh lo adjunte, le pasa los secretos solo a ese proceso y usa un state por lakehouse.
- `pnpm bootstrap` instala extensiones, aprovisiona el lakehouse (con su identidad), prepara el entorno Python y la base `sqlmesh_state`; `pnpm dev` verifica sin crear ni descargar nada; `pnpm preflight` revisa todo sin red.
- **Tests:** 126 unit (config 16, database 5, CLI 38, warehouse 55, transform 12) y 86 de integración contra motores reales (database 7, warehouse 67 con los dos catálogos, transform 12). Los tests de state por lakehouse se validaron por mutación: con un state compartido, fallan los dos.
- **En vivo, con los dos catálogos:** bootstrap, seed y `pnpm transform plan` → mart con 20.000 filas, suma 5243402.47, 5 regiones, sin partición por día; ningún log con la contraseña. Negativos: secreto faltante, catálogo `duckdb` o inválido, contraseña incorrecta (rápido, sin la contraseña en el mensaje), extensión faltante sin descarga, ruta de datos distinta, lakehouse sin aprovisionar (SQLMesh no llega a correr y no se crea nada), `uv run sqlmesh` directo rechazado, `ATTACH` en un modelo rechazado por el linter. `~/.duckdb` sin cambios; ni carpetas temporales ni bases de prueba sobrantes.

**Contratos:** Config Schema v1 → v2 (lakehouse) → v3 (`transform.state-url`); `AnalyticalQueryPort` v1 y `LakehouseAdminPort` v1 (reemplazan al `AnalyticalEnginePort` de `21` §3; `LakehouseHealth.lakehouseId` agregado antes de publicar); formato de catálogo DuckLake 1.0; primer resultado analítico `marts.mart_sales_orders`. DB Migration: sin cambios.

**Decisiones del usuario:** Plan B v3 del Paso 1 (catálogo SQLite sin WAL — límite multi-proceso documentado en `01` §6.6; naming del codename en `21` §1; seed solo con el dataset; CLI en inglés; OpenTelemetry solo API; residual del puerto de lectura aceptado como bloqueante antes del SQL Lab, en una sola lista de `08` §10.3; timeout reintentable; filas posicionales). Política de materialización sin RAW persistente por defecto (`02` §6.1.1–6.1.2, `01` §6.8). Plan A del Paso 2: solo el fixture; mantenimiento del lakehouse en el Paso 8; SQLMesh solo vía `pnpm transform`; un mart; `partition_by_time_column false` como regla; parche temporal del janitor con test de alerta; paquetes Python con 1 día de antigüedad mínima; state por lakehouse con identidad UUID.

**Decisiones con evidencia (detalle en `versions.md`):** DuckDB 1.5.5 por mérito propio (mínimo con DuckLake 1.0, último patch), sin acoplarse a Cube; `sqlmesh[postgres]` sin extra `duckdb` (no existe); la contraseña del catálogo en un secret de DuckDB, nunca en el `ATTACH` (DuckDB la repite en sus errores); identidad del lakehouse en una tabla propia del catálogo (la versión 0 expira y DuckLake rechaza opciones propias).

**Desvíos respecto de los docs, ya corregidos en ellos:** `02` §8 pedía un extra `sqlmesh[duckdb]` inexistente; el Plan A suponía que las vistas de SQLMesh guardaban el alias del catálogo (DuckLake guarda un marcador, funcionan con cualquier alias); el `AnalyticalEnginePort` de `21` §3 pasó a ser dos puertos; `node:sqlite` finalmente no se usa; MinIO queda como decisión antes del Paso 3.

**Lecciones de la verificación en vivo** (ninguna salía de leer la documentación): con los *defaults*, DuckDB descarga extensiones en silencio a `~/.duckdb` (pasó una vez en un test); SQLMesh adjunta DuckLake de forma que crea un lakehouse vacío sobre un catálogo equivocado; el *default* de partición por fecha dejaba 365 archivos de ~2 KiB para 20.000 filas; el janitor de SQLMesh falla en DuckLake (`DROP … CASCADE`; SQLMesh/sqlmesh#6032, PR #6034); un state de SQLMesh compartido respondía *No changes* sobre un lakehouse sin el mart; una función de mantenimiento rechazada en el puerto de lectura igual escribía un Parquet huérfano; en Windows, SQLMesh con la salida a `NUL` termina con código 1. DuckLake no borra nada por sí mismo: la retención es explícita (`01` §6.8).

**Pendiente, sabido:** `pnpm reset:local` no se corrió en esta tanda (lo verifica el usuario); el esquema `sqlmesh` que usaba el state antes de atarlo al lakehouse quedó sin uso en la base `sqlmesh_state` local, y el lakehouse PostgreSQL de desarrollo tiene dos archivos del mart (al pasar al state nuevo, SQLMesh lo reconstruyó sobre la misma tabla física, sin filas duplicadas) — los dos desaparecen con `reset:local`; tag `v0.2.0` pendiente de pedido explícito.

**Siguiente:** Paso 3 — modelo semántico básico (Cube Core) sobre `marts.mart_sales_orders`, empezando por la decisión de MinIO y la validación "AtlasBI escribe → Cube lee" de la matriz de compatibilidad de `versions.md`, y la batería de *pushdown* de `17` §3.2.2.

### 0.3.0 — capa semántica (Paso 3) — cerrado el 2026-09-26

**Qué quedó construido y verificado en vivo** (Windows 11, Podman 5.8.3, Cube Core y Cube Store 1.7.45, Garage 2.4.1):

- **Almacenamiento S3 en el nivel equipo local:** Garage en el compose, con el bucket y dos claves (escritor de lectura y escritura, lectores de solo lectura) creados por `pnpm bootstrap` con su API de administración. `@atlasbi/warehouse` sobre S3 (`httpfs`, secreto acotado a la ruta de datos, código de error `storage_unreachable`). SQLMesh también escribe en S3. Cada nivel fija su almacenamiento: PostgreSQL + S3 o SQLite + carpeta.
- **Lectores de solo lectura:** el rol `lakehouse_reader` (`ensureReadOnlyRole`) más la clave S3 de solo lectura. La verificación del lakehouse en `pnpm dev` lee un valor como lector.
- **`packages/semantic`:** Cube Core + Cube Store, en modo seguro. Un driver propio (subclase del de DuckDB de Cube) abre el lakehouse sin red, como lector, en el orden de la plataforma, y devuelve un error genérico al cliente. Cube vive en una red interna sin salida a Internet, y bootstrap le instala las extensiones `linux_*` desde dentro de su imagen. Modelo `sales_orders` + `regions` con una pre-agregación. El paso `Cube` de `pnpm dev` exige una consulta que lea datos.
- **Tests:** 169 unit (config 21, database 5, CLI 47, warehouse 73, transform 13, semantic 10) y 120 de integración contra motores reales (database 11, warehouse 73, transform 12, semantic 24). Cada suite de semantic levanta su propio Cube y Cube Store sobre un lakehouse descartable.
- **En vivo, después del `reset:local` del usuario:** bootstrap, seed, `pnpm transform plan` y `pnpm dev` en verde. Cube devuelve exactamente lo que escribió la plataforma (20.000 órdenes, 5243402.47, las 5 regiones), y además inteligencia de tiempo, join y pre-agregación sin escribir en el lago. Sin `/root/.duckdb` y sin salida a Internet. Negativos:
  - Secretos equivocados del lector y del escritor, con el remedio.
  - Object storage caído.
  - Extensiones de Cube ausentes: falla en el acto con el remedio.
  - Contraseña del catálogo equivocada: `/readyz` da 500 y el cliente recibe el error genérico.
  - Secreto S3 equivocado: lo detecta la sonda que lee datos.
  - Contraseña del SQL API equivocada.
  - Nivel portátil sin object storage ni Cube.

**Contratos:** Config Schema v3 → v4 (S3, par nivel/almacenamiento, secretos del lector, del object storage y de Cube). `AnalyticalQueryPort` y `LakehouseAdminPort` v1 → v1.1 (`storage_unreachable`; versiones como `"MAJOR.MINOR"`). DB Migration sin cambios. El modelo semántico todavía no es un contrato público: `SemanticQueryPort` se diseña en el Paso 5.

**Decisiones del usuario:**

- Camino B: S3 en el nivel equipo local, con `11` §4.4 corregido. La razón es la frontera de contenedor, que vuelve en el Paso 8 con escritores.
- Servidor Garage, elegido después de conocer el costo exacto de SigV4 que exigía versitygw.
- Credenciales de solo lectura para todo lector, y subclase del driver con error genérico.
- Cube exige el catálogo PostgreSQL, y el join de la batería usa un cube derivado del mart.
- Cube y Cube Store fijados por digest.
- D1: se abandona PostgreSQL + carpeta. D2: credenciales de desarrollo fijas. D3: `storage_unreachable`. D4: tests de alerta.
- Licencia Apache-2.0 (`21` §11), con la auditoría de licencias pendiente antes del lanzamiento público.
- `member_masking` anotado en `09`.
- El hueco de Cube Store con medidas decimales queda documentado con su test de alerta, sin arreglo por ahora (se retoma antes del Paso 11 si aparece).

**Desvíos respecto del plan, informados en cada punto de control:**

- S3 en transform se adelantó a la fase A.
- Se creó la entrada `@atlasbi/warehouse/testing`.
- El bucket y las claves los crea bootstrap por la API de administración, no con `--default-bucket`.
- El paso `Cube extensions` también corre en `dev`, donde solo verifica.
- Un *token* rechazado no se reintenta.
- La red interna para Cube se aplicó al verificar el riesgo que el plan dejaba abierto.

**Lecciones de la verificación en vivo:**

- `count(*)` en DuckLake sale de las estadísticas y no prueba el acceso a los datos.
- `READ_ONLY` no impide `COPY … TO` ni `CREATE SECRET` en el motor.
- El driver original de Cube oculta un lakehouse caído (`/readyz` 200 y pre-agregaciones que siguen respondiendo) y devuelve errores internos al cliente.
- `/readyz` no detecta una clave S3 equivocada.
- La batería de *pushdown* de la Fase 0 estaba mal en dos puntos: el remedio `HAVING` y "sin post-procesamiento". La revalidación con el modelo real y su pre-agregación los corrigió en `17` §3.2.2.
- Sin `--continue`, Turborepo cortaba las suites hermanas antes de su limpieza y dejaba contenedores, bases y objetos. Se limpiaron y ahora no se repite.
- Con cuatro suites de integración en paralelo, la latencia host→VM llegó a 10 s para un `SELECT 1`.

**Siguiente:** Paso 4 — Auth (better-auth + `workspace_membership` + `data_entitlements`), antes del frontend, porque el MVP exige demostrar RLS con dos usuarios.

### 0.4.0 — identidad y autorización (Paso 4) — cerrado el 2026-09-27

**Qué quedó construido y verificado en vivo** (better-auth 1.7.6, Cube Core 1.7.45):

- **`@atlasbi/auth`:** better-auth detrás de `IdentityPort`: email y contraseña, organización, sesiones.
  - **Sin registro público:** los usuarios los crea una acción de administración.
  - **Sin el plugin `admin`:** expondría unos 20 endpoints `/admin/*` por HTTP, medido.
  - **Token de identidad:** solo `sub` y `org`, EdDSA, 15 minutos, verificado localmente con `jose`.
  - **`resolveSecurityContext`:** rol y permisos sobre datos por separado, deniega por defecto y controla el cruce entre organizaciones.
- **Primeras migraciones reales:**
  - `000001`: el esquema de better-auth en `auth`, generado por su planificador y vigilado por un test de contrato.
  - `000002`: `access.workspace`, `workspace_membership` y `data_entitlements`, con restricciones en la base.
- **RLS en Cube:**
  - Políticas con los grupos `region:listed` y `region:all`, armados solo por `toQueryClaims`; el rol nunca viaja.
  - Token corto HS256 (≤ 5 minutos, `platform-api` → `semantic-layer`) para REST y, como contraseña, para el SQL API, que ya no tiene contraseña fija.
  - Control de vencimiento por consulta: una conexión abierta no sobrevive a su token.
  - Grupo `readiness` para la sonda de `pnpm dev`.
- **`pnpm seed`:** la organización `demo`, los workspaces `comercial` y `finanzas`, y `ana@example.com` y `bruno@example.com` (el escenario de `16` §4). Es idempotente y prueba cada acceso iniciando sesión.
- **Tests:** 195 unit (auth 9, config 21, database 5, CLI 47, warehouse 73, transform 13, semantic 27) y 152 de integración (auth 23, database 11, warehouse 73, transform 12, semantic 33).
- **En vivo:**
  - `pnpm dev` aplicó las dos migraciones sobre la base existente, sin `reset:local`.
  - La cadena completa (*sign in* → token de identidad → contexto de seguridad → grupos → token corto → Cube) da, por REST y por SQL, exactamente los números del puerto de lectura: Ana en Comercial, 5 regiones; Ana en Finanzas, North = 1048798.45; Bruno en Finanzas, South = 1048442.15.
  - La vieja contraseña fija del SQL API se rechaza.
  - Negativos: `auth.secret` vacío o corto, contraseña demo distinta o corta, `pnpm seed` repetido, nivel portátil.

**Contratos:** Config Schema v4 → v5 (`auth.secret` y `seed.demo-password`; se retira `semantic.sql-password`); `IdentityPort` 1.0; `SecurityContext` 1.0; DB Migration `000002`.

**Decisiones del usuario:**
- **D1:** la RLS de Cube entra en el Paso 4.
- **D2:** esquemas `auth` (nombres del proveedor) y `access` (propio).
- **D3:** se deniega por defecto; "todos" es explícito; `allowed_values`.
- **D4:** el token de identidad lleva solo `sub` y `org`.
- **D5:** sin registro público.
- **D6:** contraseña demo fija de desarrollo.
- **D7:** secreto vía `SecretProvider`, telemetría apagada.
- **D8:** `workspace_permissions` pospuesta.
- **E1:** API interna de better-auth en lugar del plugin `admin`, con evidencia medida.
- **E2:** la traducción a grupos vive en `@atlasbi/semantic`.
- **E3:** token HS256 con emisor y audiencia fijados.
- **E4:** IDs UUID.
- **E5:** el token como contraseña del SQL API, con la misma vida máxima que REST.
- **Además:** la advertencia del OR entre grupos queda escrita en `09` §6.1.

**Desvíos respecto del plan, informados en cada punto de control:**
- `IdentityPort` suma `findUserByEmail` y `findOrganizationBySlug`, para el seed idempotente.
- Nombres de *claims* neutros, por `21` §1.
- El control de vencimiento por consulta se agregó al medir E5.
- El ejemplo con `role:` que había que corregir estaba en `04` §6.2, no en `09` §6.2.

**Lecciones de la verificación:**
- En Cube 1.7.45 las políticas se eligen por `group`, y `contextToRoles` ni siquiera arranca.
- Las políticas de grupos distintos se combinan con OR.
- Una lista vacía o una clave ausente en la política fallan cerrado.
- Cube acepta HS512 y tokens sin `exp` si no se lo fija.
- `checkSqlAuth` corre una sola vez por conexión.
- Cube escribe en su log los tokens rechazados.
- better-auth mete el usuario entero en el token si no se define `definePayload`.
- Su CLI quedó en 1.4, así que el esquema de 1.7 se genera con su planificador.
- `internalAdapter.createUser` exige declarar el origen.

**Siguiente:** Paso 5 — API Gateway (Fastify + tRPC), con la seguridad de Cube por request y el experimento de `checkSqlAuth` sobre `/v1/cubesql`.

### 0.5.0 — API Gateway (Paso 5) — cerrado el 2026-10-05

**Qué quedó construido y verificado en vivo** (Fastify 5.12.5, tRPC 11.19.0, Cube Core 1.7.45):

- **`SemanticRuntimePort` 1.0** (`@atlasbi/contracts`): `SemanticQuery` v1 con los 12 operadores del Filter AST, `SemanticResult` con filas posicionales y números como string exacto, y errores con códigos cerrados.
  - **Adaptador de Cube** en `@atlasbi/semantic` (`createCubeSemanticRuntime`): metadata del contexto → validación → datos, con `limit + 1`. Devuelve solo datos y nunca usa `extended=true`.
  - **Batería de contrato** independiente de los datos, que el adaptador pasa contra un stack propio.
- **`@atlasbi/api-gateway`:** `session.me`, `semantic.meta` y `semantic.query`.
  - Identidad verificada en cada llamada; contexto de seguridad por workspace y por llamada.
  - `/auth`: tres rutas por `IdentityHttpHandler` 1.0, con `Origin` obligatorio. Las otras 51 rutas de better-auth no son alcanzables.
  - Límites de intentos: 10 por minuto por IP y 5 fallos cada 15 minutos por cuenta. El limitador de better-auth está apagado.
  - tRPC endurecido, respuestas neutras, CSP, `no-store`, sin CORS, solo `127.0.0.1`.
  - Trazas OTel de Fastify, `pg` y `undici`, sin *query string* ni valores, y sin propagador.
- **`pnpm dev`:** levanta el gateway con `node --watch`, espera `/ready` y queda en primer plano. Ctrl+C lo detiene, verificado por el usuario en Windows. El preflight revisa el puerto 4100.
- **Tests:** 299 unit (api-gateway 28, auth 11, config 24, database 5, CLI 54, warehouse 73, transform 13, semantic 91) y 188 de integración (api-gateway 8, auth 33, database 11, warehouse 73, transform 12, semantic 51).
- **En vivo:**
  - Recorrido de Ana y Bruno, 31/31: en Finanzas, Ana ve North y Bruno South; en Comercial, North da el mismo número exacto.
  - Negativos: `Origin`, rutas ocultas de better-auth, GET, *batch*, 1 MB, *tokens* inválidos, límites de intentos.
  - p50 por HTTP: `session.me` 2,7 ms; `semantic.query` 24 ms con la caché de Cube y 66 ms sin ella.

**Contratos:** Config Schema v5 → v6 (`ATLASBI_GATEWAY_PORT`, `ATLASBI_PUBLIC_URL`, `ATLASBI_SEMANTIC_URL`, con valores por defecto); `SemanticRuntimePort` 1.0; `IdentityHttpHandler` 1.0. Sin cambios en `IdentityPort`, `SecurityContext` ni en las migraciones.

**Decisiones del usuario:**
- **G1–G10** y los ajustes 1–6 del plan v2, aprobados sin cambios. Lo central:
  - Identidad por `Bearer`.
  - El puerto semántico en `contracts`.
  - `/auth` por lista explícita.
  - `/api/v1` reservado.
  - Límites de intentos en el gateway.
  - OTel mínimo.
- **El límite por cuenta también bloquea a su dueño:** el usuario aceptó ese costo, documentado en `06` §6.3.
- **Sin caché de metadata:** 2–3 ms no justifican servir metadata vieja después de un cambio de permisos.
- **El *panic* de Cube con un `OR` siempre verdadero** es `cube-js/cube#7880` que evolucionó: se agrega como comentario en ese issue, no como uno nuevo, y lo publica el usuario.
- **`IDENTITY_HTTP_VERSION = '1.0'`.**
- **La casilla de la Capa 6 en `16`** queda sin marcar hasta el frontend.

**Desvíos respecto del plan, informados en cada punto de control:**
- Saqué la *query string* también de los spans de `undici`: la misma fuga que `@fastify/otel`, encontrada en el test de integración. El usuario lo aprobó.
- Fastify limita a 100 caracteres el parámetro de ruta de tRPC: un *batch* de 10 daba 414, y el límite se subió.
- `/ready` solo depende de la base de la plataforma.
- En el nivel portátil, `semantic.*` responde `NOT_IMPLEMENTED`.
- La verificación de Cube de `pnpm dev` usa `ATLASBI_SEMANTIC_URL`.

**Lecciones de la verificación:**
- `/v1/cubesql` autentica con `checkAuth`, no con `checkSqlAuth`: la hipótesis de `17` §3.2.3 era incorrecta.
- Cube repite en `/v1/load` la consulta con los filtros de RLS, y escribe en su log el security context completo.
- `public: false` no es seguridad.
- Cube Store trunca las medidas derivadas a 6 decimales.
- tRPC, por defecto, manda el mensaje interno y el *stack*.
- better-auth expone 54 rutas, deja pasar requests sin `Origin` y apaga su chequeo de origen con `NODE_ENV=test`.
- En `@fastify/rate-limit`, el segundo `rateLimit()` de una ruta no corre.
- `node --watch` sigue vivo cuando su script falla, y su script hijo puede quedar huérfano en Windows: se detiene con `taskkill /T`.
- La copia de trabajo en Windows puede tener CRLF (`core.autocrlf=true`); el repo normaliza a LF con `.gitattributes`.

**Siguiente:** antes del Paso 6, la tanda propia de la auditoría de aislamiento:
- La fábrica `createSemanticRuntime`, para que el gateway no conozca a Cube ni la regla de niveles.
- La batería de contrato de identidad.
- Los planes, pendientes de decisión: contrato de datos del mart y de landing, la regla de lint contra `_dlt_*`, los verbos de plataforma de los jobs y las claves foráneas hacia better-auth.

Después, el Paso 6: frontend mínimo, modo Viewer.

### 0.6.0 — frontend mínimo, modo Viewer (Paso 6) — cerrado el 2026-10-07

**Antes del Paso 6, la tanda propia de la auditoría de aislamiento** (c6f07a1…29017dd):
- La fábrica `createSemanticRuntime` y la batería de contrato de identidad.
- Los contratos de datos (Plan A) y la regla de lint `NoIngestionInternals`.
- La identidad propia de la plataforma (migración `000003`, aplicada a la base de desarrollo con el OK del usuario).

**Qué quedó construido y verificado en vivo** (SvelteKit 2.70.3, Svelte 5.57.1, ECharts 6.1.0, Caddy 2.11.7):

- **El Report Document Model:**
  - `ReportDocument` y `VisualSpec` v1 en `@atlasbi/contracts`.
  - El esquema `reporting` (migración `000004`), con CHECK de forma sobre los JSONB y claves hacia `identity.*`, nunca hacia `auth.*`.
  - `@atlasbi/reports`, un paquete nuevo.
  - `report.list` y `report.get` en el BFF, y el reporte demo "Ventas" creado por `pnpm seed`.
- **`apps/web`:**
  - Una SPA con la sesión en memoria y el cliente tRPC con `httpLink`.
  - El adaptador de ECharts, importado por partes.
  - El primer corte del Interaction Engine: `InteractionState`, `QueryCoordinator` y cross-filter.
  - La sidebar con su árbol propio, y la CSP con hash.
- **Imágenes y proxy:** el gateway sin TypeScript, Vite ni Vitest (`pnpm test:image`), y la web servida por Caddy como origen único. Una red interna `edge`, con el proxy en una dirección fija que es la única en la que confía el gateway.
- **`pnpm dev` levanta la web** (paso `Web`). `pnpm stack:up` construye y corre las imágenes.
- **Tests:**
  - 376 unitarios: web 28, api-gateway 33, CLI 69, contracts 15, contracts-testing 2, reports 3, config 26, auth 11, database 5, warehouse 73, transform 16, semantic 95.
  - 217 de integración: api-gateway 9, reports 13, auth 45, database 11, warehouse 74, transform 14, semantic 51.
- **En vivo:**
  - **En un navegador real** (Edge sin interfaz, por el protocolo DevTools), sobre `pnpm dev` y sobre `pnpm stack:up`: inicio de sesión, sidebar, el reporte con sus 4 visuales y un cross-filter que cambia los KPIs y vuelve.
  - **El token** no aparece en el almacenamiento del navegador.
  - **El corte de tipos de punta a punta:** renombrar `report.get` rompe el *typecheck* de la web.
  - **`trustProxy` con un `X-Forwarded-For` falsificado:**
    - A través del proxy, el límite corta con la IP real.
    - Otro cliente real tiene su propio cupo.
    - Un contenedor que va directo al gateway corta a los 10 intentos.

**Contratos:**
- Config Schema v6 → v7 (`ATLASBI_GATEWAY_HOST`, `ATLASBI_TRUSTED_PROXIES`, `ATLASBI_WEB_PORT`; `ATLASBI_PUBLIC_URL` por defecto es el origen de la web).
- Report Document `schemaVersion` 1 y `VisualSpec` v1.
- DB Migration `000003` y `000004`.
- `IdentityPort` 1.1.

**Decisiones del usuario:**
- **H1–H6:**
  - Una SPA sin SSR, que se revisa si algún día hace falta.
  - `trustProxy` limitado a nuestro proxy.
  - `visual_spec` nunca guarda opciones de ECharts, con un test que lo verifica.
  - Las claves hacia personas apuntan a `identity.*`.
  - El estado de interacción es el primer corte del diseño de `14`.
- **A1–A9:**
  - SvelteKit 2.70.3, no 3.x.
  - Vite 8.3.3 cuando pase la edad mínima.
  - El riesgo de Bits UI, documentado.
  - El origen de la web como `PUBLIC_URL`.
  - `httpLink` y `QueryCoordinator` sin caché hasta el Paso 9.
  - Las baterías de test en su propio paquete.
  - Caddy como proxy.
- **Condiciones:**
  - Probar `trustProxy` en vivo, desde otra IP.
  - Un test de que la imagen del gateway no contiene TypeScript, Vite ni Vitest.
- **El paquete nuevo `packages/reports`** es dueño del repositorio de reportes.
- **En `docs`:**
  - El CHECK de `visual_spec` obliga a una migración de base cuando cambie la versión de `VisualSpec` (`19` §8.1).
  - Borrar a quien creó un reporte queda bloqueado: hay que reasignar primero (`09` §6.4, `19` §8).
- **`.pnpmfile.mjs`:** aprobado, con un comentario y una nota en `versions.md` para revisarlo al actualizar `better-auth` o `@trpc/server`.
- **La contraseña de la base no tiene que ser apta para URL:** el CLI la codifica al armar la URL del gateway en contenedor.
- **Commits separados por tema** (web, modelo de reporte y release). El tag se pide aparte.

**Desvíos respecto del plan, informados en cada punto de control:**
- **No `pnpm deploy`:** Node no quita los tipos de un `.ts` bajo `node_modules`. La imagen deja los paquetes enlazados como en desarrollo.
- **Del esquema de `19` §8:** sin `visual.type`, con `page.ordinal`, y sin `formatting_spec` ni `filter_definition`.
- **Nombres:** `ReportFilter` y `sourceVisualId`, en `lib/report/`; las rutas dicen "reporte".
- **El reporte demo tiene un KPI más** (la cantidad de pedidos) que H4.
- **La *cookie* de estado de la sidebar** se quitó del código copiado; el estado va en `localStorage`.
- **Sumados:** el favicon, los títulos de pestaña y la CSP de la página (`kit.csp`).

**Lecciones de la verificación:**
- **pnpm resuelve los *peers* opcionales contra cualquier paquete del workspace**, así que un despliegue de producción se lleva el toolchain que tenga al lado.
- **Node 24 no quita tipos bajo `node_modules`.**
- **En un CHECK de Postgres, una expresión NULL pasa:** una clave ausente tiene que fallar explícitamente (`?&` y `CASE`). Además, `-` liga más fuerte que `->`.
- **Caddy con `admin off`** no acepta subopciones y guarda igual su configuración al arrancar.
- **El CLI de shadcn-svelte** pregunta antes de pisar archivos: se respalda, se usa `--overwrite` y se compara.
- **Git Bash reescribe las rutas** que se le pasan a `podman`; se evita con `MSYS_NO_PATHCONV=1`.
- **La ventana del límite por IP se cruza entre pruebas en vivo seguidas:** el navegador recibió 429 justo después de la prueba de spoofing, como corresponde.
- **El `.env.example` de `0.5.0` fijaba `ATLASBI_PUBLIC_URL` en el puerto del gateway:** al actualizar hay que cambiarlo (README).

**Siguiente:**
- El tag `v0.6.0`, cuando el usuario lo pida.
- Después, el Paso 7, con la primera fuente externa real, y antes del Paso 8 el Plan C de la auditoría (verbos de los jobs).
- Los documentos de ingesta (`03`, `02` §6.1.1, `13`, `01`) se editan después de la Fase 0 del Paso 7.
- **Versiones del frontend:** subir Vite a 8.3.3 cuando pase la edad mínima, y migrar a SvelteKit 3 cuando tenga algunas semanas de parches.
