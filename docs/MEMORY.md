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
| 11 | Infraestructura | **Podman** (no Docker Inc.) + **OpenTofu** (no Terraform, relicenciado BSL + IBM) + **Edge Connector Agent propio** (WireGuard/mTLS como transporte — corrección: WireGuard solo no equivale a un Gateway completo) | Bajo (Red Hat / Linux Foundation-CNCF / kernel Linux) |
| 12 | Metadata, catálogo y lineage | **OpenMetadata** (capa nueva, agregada por análisis de producto externo) | Medio, documentado (Collate Inc.; sin fundación real en esta categoría — corrección: no es un proyecto de la Linux Foundation, esa empresa solo se unió como miembro corporativo) |

## Niveles de despliegue (flexibilidad real, sin reescribir código)

1. **Portátil**: catálogo DuckLake en SQLite (un archivo), datos en carpeta local — corre en una tablet, sin servidor.
2. **Equipo local**: catálogo en Postgres vía Podman, datos locales o MinIO self-hosteado.
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
