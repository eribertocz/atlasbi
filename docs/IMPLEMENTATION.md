# IMPLEMENTATION.md — Referencia accionable (leer esto primero, no la narrativa)

> Este archivo es el resumen denso de las decisiones ya tomadas en `docs/00` a `docs/12`. Sin "corrección de una revisión externa", sin comparativas — solo la decisión final, el contrato, y dónde está el detalle si hace falta. Úsalo como referencia rápida mientras programás; volvé a la narrativa (`docs/NN-*.md`) solo si necesitás entender *por qué*, no *qué*.

---

## Stack final, una línea por capa

| # | Capa | Paquete | Herramienta | Lenguaje |
|---|---|---|---|---|
| 1 | Almacenamiento | `packages/warehouse` | DuckDB + DuckLake (catálogo SQLite/Postgres según nivel; datos en carpeta local o en S3 — Garage en el nivel "equipo local") | SQL |
| 2 | Transformación | `packages/transform` | SQLMesh | SQL + Python |
| 3 | Ingesta | `packages/ingestion` | dlt (+ ADBC) — solo para fuentes que no se leen directo (**implementado en el Paso 7**: GitHub, `pnpm ingest`, landing como contrato, adaptador TypeScript) | Python + TypeScript |
| 4 | Semántico | `packages/semantic` | Cube Core; el adaptador de `SemanticRuntimePort` vive acá (Paso 5) | YAML |
| 5 | IA/copiloto | `packages/ai-copilot` | `LLMProvider` (Claude por defecto) + MCP propio | TypeScript |
| 6 | API Gateway | `packages/api-gateway` | Fastify + tRPC (BFF, **implementado en el Paso 5**) + OpenAPI 3.x (público, reservado en `/api/v1`) | TypeScript |
| 7 | Orquestación | `packages/orchestrator` | Apache Airflow | Python |
| 8 | Frontend | `apps/web` | SvelteKit + Svelte 5 + ECharts + GridStack + shadcn-svelte + Tailwind v4 (**modo Viewer implementado en el Paso 6**: SPA, cross-filter, sidebar) | TypeScript |
| 9 | Auth | `packages/auth` | better-auth + `workspace_membership` propia | TypeScript |
| 10 | Realtime | `packages/realtime` | ElectricSQL (broadcast) + Postgres (resuelve escritura) | TypeScript |
| 11 | Infraestructura | `infra/` | OpenTofu + Podman + **Garage** (object storage S3-compatible del nivel "equipo local") + **Caddy** (proxy del origen único, desde el Paso 6) + imágenes propias en `infra/images/` + Edge Connector Agent + **OpenTelemetry** (observabilidad transversal) + **OpenBao** (secretos en producción, vía `SecretProvider`) | HCL |
| 12 | Metadata | `packages/metadata` | OpenMetadata | — |

---

## Contratos entre capas (qué puede llamar a qué)

```
Frontend (8)
   │ tRPC (interno) / OpenAPI (externo)
   ▼
API Gateway (6) ──valida identidad──► Auth (9) ──consulta──► workspace_membership
   │ security context {user_id, organization_id, workspace_id, workspace_role, entitlements}
   ▼
Semántico (4) ◄──lee mart_*── Transformación (2) ◄──lee fuente registrada (directo) / archivo durable / landing mínimo (con ingesta) — 02-transformacion.md §6.1.1── Ingesta (3)
   │
   ▼
Almacenamiento (1)

Copiloto (5) ──MCP propio (list_metrics, query_metric)──► Semántico (4)
Orquestación (7) ──dispara/coordina── (2), (3), (4 refresh), (12 ingesta)
Metadata (12) ──lee (solo lectura)── (2), (3), (4), (7), (9)
Realtime (10) ──sync/broadcast── visual, filter_definition (Postgres)
```

**Regla de oro repetida en las 12 capas, con una precisión sobre qué significa "cruzado"**: ninguna capa lee la base de datos interna de otra, ni importa código privado de otro paquete. Lo que **sí** está permitido: importar la API pública que un paquete exporta explícitamente (ej. `import { resolveSecurityContext } from '@atlasbi/auth'`, si `@atlasbi/auth` lo exporta desde su entrada pública) — eso es consumir un contrato, no romperlo. Lo prohibido es importar un archivo interno de otro paquete (`../../auth/src/internal/db-helper`) o hacer un `fetch` directo a otra capa saltándose su API. La diferencia es "contrato publicado" vs. "detalle de implementación" — no "cero imports entre paquetes".


**Las fronteras que se cruzan por tablas también son contratos** (`21-engineering-standards.md` §2.4). Lo que una capa publica como tabla y otra lee (`source`, `landing`, `mart`) tiene un contrato de datos versionado en `packages/contracts/data/`. El productor verifica con los datos que lo cumple, y el consumidor prueba contra el contrato, nunca contra el productor. Las columnas propias de una herramienta (`_dlt_*`) nunca forman parte de un contrato.

---

## Las tablas propias que no vienen de ninguna herramienta (construirlas primero)

| Tabla | Dónde vive | Para qué | Doc |
|---|---|---|---|
| `identity.organization`, `identity.principal`, `identity.provider_subject` | Postgres, capa 9 — **implementadas después de `0.5.0`** (migración `000003`) | Quién existe para la plataforma, fuera del proveedor de identidad; qué cuenta de qué proveedor es qué principal. `access` apunta acá, nunca a `auth.*` | `09-auth-gobernanza.md` §6.4 |
| `access.workspace` (id, organization_id, slug, name) | Postgres, capa 9 — **implementada en el Paso 4** | El workspace, dentro de una organización (`identity.organization` desde la migración `000003`) | `09-auth-gobernanza.md` §6.2 |
| `access.workspace_membership` (workspace_id, user_id, role) | Postgres, capa 9 — **implementada en el Paso 4** | Rol por workspace — qué puede **hacer** alguien (admin/editor/analyst/viewer). better-auth no lo da de fábrica | `09-auth-gobernanza.md` §6.2 |
| `workspace_permissions` (user_id, workspace_id, permission) | Postgres, capa 9 — **todavía no existe**: nace con su primer consumidor (SQL Lab o certificación), decisión D8 del Paso 4 | Permisos de gobernanza otorgables (`certify_metric`, `sql_lab_access`, `manage_agent_rules`) | `09-auth-gobernanza.md` §9.1 |
| `access.data_entitlements` (workspace_id, user_id, dimension, all_values, allowed_values) | Postgres, capa 9 — **implementada en el Paso 4**, denegar por defecto y "todos" explícito | Qué datos puede **ver** alguien — separado del rol, para no inventar roles como `viewer_norte`/`viewer_sur` por cada recorte de datos. El security context de Cube combina `workspace_role` (acciones) + `data_entitlements` (filas), nunca uno solo | `09-auth-gobernanza.md` §6.1 |
| `user_measures` (id, workspace_id, report_id, expression_sql, scope, status) | Postgres, capa 8/4 | Medidas de auto-servicio creadas por el autor del reporte (Visual Builder/SQL/IA). `expression_sql` es la **expresión semántica de la medida** (ej. `MEASURE(a)/NULLIF(MEASURE(b),0)`), no una consulta completa — un Self-Service Query Compiler la combina con dimensiones/filtros/orden en el momento de la consulta. Se ejecuta query-time, nunca toca el YAML de Cube salvo que se certifique | `17-self-service-calculations.md` |
| `report` / `page` / `visual` / `filter_definition` | Postgres, capa 8 — **`report`, `page` y `visual` implementadas en el Paso 6** (esquema `reporting`, migración `000004`, paquete `@atlasbi/reports`); `filter_definition` nace con los filtros del autor | El Report Document Model real (Workspace → Report → Page → Visual), con filtros persistentes del autor separados del `InteractionState` efímero del usuario. Única fuente de verdad — sin tabla espejo (corregido; `dashboard_widget`/`dashboard_filter` ya no existen como tablas aparte) | `19-operabilidad-runtime.md` §8 |
| `audit.audit_event` + la vista `audit.current_certifications` | Postgres, transversal — esquema mínimo fijado, sin implementar | El único registro *append-only* de quién hizo qué, incluidas las certificaciones (reemplaza a la `gobernanza.certificaciones` que se había propuesto) | `18-first-class-citizens.md` (Audit & Compliance), `09-auth-gobernanza.md` §9.1 |

---

## Reglas no negociables (resumen de `CLAUDE.md`)

1. Responsabilidad única por capa.
2. Comunicación solo por contrato.
3. Open source primero — self-hosteable siempre.
4. Texto plano versionable en Git.
5. Reemplazar solo por algo objetivamente mejor.
6. Madurez verificada en producción, no experimental.
7. Gobernanza evaluada con criterio (licencia, bus factor, forkabilidad, criticidad, radio de impacto) — nunca mecánica. Detalle completo en `CLAUDE.md`.
8. Rescatar lo mejor de otros BI, traducido a herramientas ya elegidas, nunca copiado literal.
9. **No materializar ni duplicar datos sin justificación explícita — sin RAW persistente por defecto.** Import guarda en DuckLake el resultado analítico (`mart_*`); landing mínimo solo con dlt; snapshot solo con motivo y retención; `stg_*`/`int_*` lógicos por defecto; Live no materializa. Política canónica en `02-transformacion.md` §6.1.1–6.1.2; retención en `01-motor-almacenamiento.md` §6.8.

**Nunca**: FastAPI ni otro framework Python sirviendo al frontend (Python es solo para capas de datos). SQL Lab tocando `mart_*` directo. Un modelo Python de SQLMesh llamando a una API externa (eso es trabajo de dlt, capa 3). Un modelo SQL adjuntando una fuente por su cuenta, o una fuente no registrada (`02-transformacion.md` §6.1.2). Un pipeline de dlt copiando tablas completas cuando la fuente permitía traer solo lo necesario. Un rol de workspace baked-in en el JWT. Un objeto `{ metric, dimensions }` pasado directo a `cubeClient.load()` sin el adaptador de `13-recorrido-end-to-end.md` §4 — Cube espera `{ measures: [...], dimensions: [...] }`, nunca un campo `metric` suelto. `sqlmesh apply` como comando (no existe) — es `sqlmesh plan --auto-apply` para desplegar cambios, `sqlmesh run` para la ejecución programada de modelos ya desplegados; nunca `plan --auto-apply` dentro del DAG diario de Airflow.

---

## Los 3 niveles de despliegue

| Nivel | Catálogo | Datos | Postgres | Cuándo |
|---|---|---|---|---|
| Portátil | SQLite | Carpeta local | No hace falta | Un solo dev, sin servidor; sin Cube |
| Equipo local | Postgres vía Podman | S3 — Garage vía Podman (Paso 3) | Uno solo | Equipo chico, misma red |
| Nube | Postgres gestionado | Bucket S3-compatible | **2 instancias** (plano control + plano operativo, ver `11-infraestructura.md` §4.5) | Producción real |

---

## Lo que todavía es backlog explícito (no fingir que está resuelto)

- Interaction Engine (cross-filter, drill-down) y State Engine (undo/redo) — capa 8, sin diseño hasta este momento. **Resuelto en `14-interaction-state-engine.md`.**
- Recorrido end-to-end de un dato real de punta a punta — **resuelto en `13-recorrido-end-to-end.md`.**
- Estrategia de testing/CI-CD del conjunto — **resuelto en `15-testing-cicd.md`.**
- Definición de "terminado" del MVP — **resuelto en `16-mvp-definicion-terminado.md`.**
- Cómo arranca físicamente el sistema (topología, `pnpm dev`, migraciones, seed, health checks, esquema real del Report Document Model) — **resuelto en `19-operabilidad-runtime.md`.**
- Arquitectura de experiencia (qué UI es nuestra, qué UI es de una herramienta técnica externa, navegación por rol, anatomía del Report Builder) — **resuelto en `20-product-ui-ux.md`.**
- Estándares de ingeniería, versionado por contrato, y la arquitectura de Puertos y Adaptadores (ningún tipo de proveedor cruza la frontera de su adaptador) — **resuelto en `21-engineering-standards.md`, normativo.**
- Fuera de alcance todavía (huecos de producto, no de arquitectura): authoring visual completo, catálogo/lineage en UI, embedding, alertas por umbral, exportación programada, mobile, accesibilidad. Ver `00-documentacion-general.md` sección 4 y `AUDITORIA-EXTERNA.md`.
- Dirección estratégica de visualización (diferenciador principal: Visualization Engine propio, Visual Intelligence, Design System, Motion, Custom Component Studio en HTML/CSS/Vanilla JS aislado, Custom Visual SDK) — **fijada en `22-visualization-engine.md`**; es visión, no entra en el MVP. `VisualSpec` nunca persiste configuración de un renderer.
- **Bloqueante antes del SQL Lab (medido en el Paso 1):** el puerto de solo lectura del lakehouse es suficiente para la plataforma, no para SQL libre de usuarios humanos — la lista única de pendientes está en `08-frontend.md` §10.3.
- **Retención del lakehouse en producción:** explícita y configurable; el *default* de desarrollo es 7 días, y la política de producción se cierra antes de depender de ella operacionalmente (`01-motor-almacenamiento.md` §6.8).
- **Pendiente antes del lanzamiento público — auditoría de licencias de las dependencias embebidas** (`21-engineering-standards.md` §11): revisar todas las librerías npm y Python que corren dentro de los procesos de AtlasBI contra la regla de compatibilidad con Apache-2.0 (permisivas sin restricción, copyleft débil caso por caso, GPL/AGPL nunca embebidas). Casos conocidos: `psycopg2` (LGPL-3.0), que entra por `sqlmesh[postgres]` en `packages/transform`; `certifi` (MPL-2.0) y `orjson` (`MPL-2.0 AND (Apache-2.0 OR MIT)`), que entran por `dlt` en `packages/ingestion` — aceptados en la Fase 0 del Paso 7 (`versions.md`, "Ingesta (Paso 7)"). Tarea aparte; no bloquea los pasos de construcción.
- ~~Decisión pendiente antes del Paso 3: la pieza S3-compatible local, con `minio/minio` archivado~~ — **resuelta en el Paso 3: Garage**, elegido con la regla 7 frente a versitygw; el nivel "equipo local" guarda sus datos en S3 (`11-infraestructura.md` §4.4).
- **Hueco conocido de Cube Store 1.7.45, a retomar si aparece antes del Paso 11:** un filtro sobre una medida decimal, con orden, falla cuando lo responde una pre-agregación. Documentado con su test de alerta en `17-self-service-calculations.md` §3.2.2; el Visual Builder es quien puede generar ese patrón.
- **Versiones del frontend a revisar** (`versions.md`, "Frontend y proxy (Paso 6)"): migrar a SvelteKit 3 cuando tenga algunas semanas de parches. Vite ya está en 8.3.3.
- **La *verified source* de GitHub se revisa en cada actualización de dlt y al menos una vez por milestone** (`versions.md`, "Ingesta (Paso 7)"; `packages/ingestion/runner/vendor/github/PROVENANCE.md`). El mart FULL de GitHub tiene un umbral de revisión medido en la misma sección.
- **Para el Paso 8 (orquestación), del Paso 7:** llamar a la ingesta con `pnpm --reporter=silent ingest <source> --json` y decidir por el código de salida (solo el 75 se reintenta). Tener en cuenta el `cron '@daily'` del mart de GitHub, y programar la retención del lakehouse junto con la ingesta (`07-orquestacion.md` §7.1, `01-motor-almacenamiento.md` §6.8).
- **Nunca confundir una capacidad arquitectónica con la herramienta que la implementa hoy** (Semantic Model ≠ Cube, Matrix Engine ≠ TanStack Table, Visualization Engine ≠ ECharts) — **resuelto en `18-first-class-citizens.md`**, lectura obligatoria antes de tocar código de la Capa 8.

---

## Orden de construcción real (repetido de `CLAUDE.md`, es el que importa)

0. **Bootstrap del entorno de desarrollo** (nuevo, corrección de una revisión externa que señaló que faltaba un paso explícito): repo clonado, gestor de paquetes (`pnpm`/`uv`), `podman compose` levantando Postgres local, **OTel Collector incluido desde este primer compose**, DuckLake local configurado, la interfaz `SecretProvider` definida (con `EnvSecretProvider` como única implementación por ahora) — **todo esto tiene que poder reproducirse desde cero en una laptop nueva antes de escribir el primer modelo**. No es "construir la Capa 11 completa" (eso incluye OpenTofu, modo nube, el Edge Connector Agent, OpenBao) — es asegurar que el entorno de desarrollo local arranca solo, sin pasos manuales no documentados.

**Corrección de orden, señalada en una revisión posterior: Auth tiene que ir antes del frontend, no en el paso 8 — el checklist del MVP exige demostrar RLS con dos usuarios viendo datos distintos, y eso es imposible sin Auth ya construido.** Secuencia completa (repetida en `CLAUDE.md`, que es la que Claude Code obedece):

1. Almacenamiento (nivel "equipo local mínimo" — no "portátil") → 2. Transformación → 3. Semántico básico + *pushdown* validado → **4. Auth (`workspace_membership` + `data_entitlements`)** → **5. API Gateway + seguridad de Cube** (JWT REST; el experimento de `/v1/cubesql` dio que usa `checkAuth`, no `checkSqlAuth`, `17` §3.2.4) → 6. Frontend mínimo Viewer → 7. Ingesta real → 8. Orquestación → 9. Interaction/State Engine → 10. Realtime (Electric) → 11. Self-service calculations → 12. IA → 13. Metadata → 14. Producción avanzada (OpenBao, nube, Edge Agent completo).

**No saltar pasos.** Si te piden trabajar en el paso 7 sin que el 1-6 exista, decilo antes de improvisar una base temporal.

## Antes del primer commit: fijar versiones exactas, nunca `:latest`

**Recomendación de una revisión posterior, especialmente importante dado que este proyecto ya documentó dos piezas en movimiento activo (el driver de DuckDB de Cube, `17-self-service-calculations.md` §3.2.2, y DuckDB 2.0 en alfa, `01-motor-almacenamiento.md` §6.3):** crear `docs/versions.md` (o un `versions.lock` equivalente) con la versión exacta de cada pieza — `image: cubejs/cube:latest` es exactamente el tipo de dependencia flotante que la regla 7 de gobernanza busca evitar en las herramientas, y no hay razón para relajarla al momento de escribir el `docker-compose`/`podman-compose` real.

```
Cube Core   = X.Y.Z
DuckDB      = X.Y.Z
DuckLake    = X.Y.Z
SQLMesh     = X.Y.Z
dlt         = X.Y.Z
Airflow     = X.Y.Z
PostgreSQL  = X
Node        = X
Python      = X
```

Actualizar cada versión solo después de correr los tests de contrato (`15-testing-cicd.md`) contra la nueva versión — nunca por adelantado "porque ya salió".
