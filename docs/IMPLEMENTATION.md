# IMPLEMENTATION.md — Referencia accionable (leer esto primero, no la narrativa)

> Este archivo es el resumen denso de las decisiones ya tomadas en `docs/00` a `docs/12`. Sin "corrección de una revisión externa", sin comparativas — solo la decisión final, el contrato, y dónde está el detalle si hace falta. Úsalo como referencia rápida mientras programás; volvé a la narrativa (`docs/NN-*.md`) solo si necesitás entender *por qué*, no *qué*.

---

## Stack final, una línea por capa

| # | Capa | Paquete | Herramienta | Lenguaje |
|---|---|---|---|---|
| 1 | Almacenamiento | `packages/warehouse` | DuckDB + DuckLake (catálogo SQLite/Postgres según nivel) | SQL |
| 2 | Transformación | `packages/transform` | SQLMesh | SQL + Python |
| 3 | Ingesta | `packages/ingestion` | dlt (+ ADBC) | Python |
| 4 | Semántico | `packages/semantic` | Cube Core | YAML |
| 5 | IA/copiloto | `packages/ai-copilot` | `LLMProvider` (Claude por defecto) + MCP propio | TypeScript |
| 6 | API Gateway | `packages/api-gateway` | tRPC (BFF) + OpenAPI 3.x (público) | TypeScript |
| 7 | Orquestación | `packages/orchestrator` | Apache Airflow | Python |
| 8 | Frontend | `apps/web` | SvelteKit + Svelte 5 + ECharts + GridStack + shadcn-svelte + Tailwind v4 | TypeScript |
| 9 | Auth | `packages/auth` | better-auth + `workspace_membership` propia | TypeScript |
| 10 | Realtime | `packages/realtime` | ElectricSQL (broadcast) + Postgres (resuelve escritura) | TypeScript |
| 11 | Infraestructura | `infra/` | OpenTofu + Podman + Edge Connector Agent + **OpenTelemetry** (observabilidad transversal) + **OpenBao** (secretos en producción, vía `SecretProvider`) | HCL |
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
Semántico (4) ◄──lee mart_*── Transformación (2) ◄──lee raw_* (condicional, solo si la fuente lo justifica — ver 02-transformacion.md §6.1.1) / Parquet externo durable── Ingesta (3)
   │
   ▼
Almacenamiento (1)

Copiloto (5) ──MCP propio (list_metrics, query_metric)──► Semántico (4)
Orquestación (7) ──dispara/coordina── (2), (3), (4 refresh), (12 ingesta)
Metadata (12) ──lee (solo lectura)── (2), (3), (4), (7), (9)
Realtime (10) ──sync/broadcast── visual, filter_definition (Postgres)
```

**Regla de oro repetida en las 12 capas, con una precisión sobre qué significa "cruzado"**: ninguna capa lee la base de datos interna de otra, ni importa código privado de otro paquete. Lo que **sí** está permitido: importar la API pública que un paquete exporta explícitamente (ej. `import { resolveSecurityContext } from '@atlasbi/auth'`, si `@atlasbi/auth` lo exporta desde su entrada pública) — eso es consumir un contrato, no romperlo. Lo prohibido es importar un archivo interno de otro paquete (`../../auth/src/internal/db-helper`) o hacer un `fetch` directo a otra capa saltándose su API. La diferencia es "contrato publicado" vs. "detalle de implementación" — no "cero imports entre paquetes".

---

## Las tablas propias que no vienen de ninguna herramienta (construirlas primero)

| Tabla | Dónde vive | Para qué | Doc |
|---|---|---|---|
| `workspace_membership` (user_id, workspace_id, role) | Postgres, capa 9 | Rol por workspace — qué puede **hacer** alguien (admin/editor/analyst/viewer). better-auth no lo da de fábrica | `09-auth-gobernanza.md` §6.2 |
| `workspace_permissions` (user_id, workspace_id, permission) | Postgres, capa 9 | Permisos de gobernanza otorgables (`certify_metric`, `sql_lab_access`) | `09-auth-gobernanza.md` §9.1 |
| `data_entitlements` (user_id, workspace_id, dimension, values) | Postgres, capa 9 | Qué datos puede **ver** alguien — separado del rol, para no inventar roles como `viewer_norte`/`viewer_sur` por cada recorte de datos. El security context de Cube combina `workspace_role` (acciones) + `data_entitlements` (filas), nunca uno solo | `09-auth-gobernanza.md` §6.1 |
| `user_measures` (id, workspace_id, report_id, expression_sql, scope, status) | Postgres, capa 8/4 | Medidas de auto-servicio creadas por el autor del reporte (Visual Builder/SQL/IA). `expression_sql` es la **expresión semántica de la medida** (ej. `MEASURE(a)/NULLIF(MEASURE(b),0)`), no una consulta completa — un Self-Service Query Compiler la combina con dimensiones/filtros/orden en el momento de la consulta. Se ejecuta query-time, nunca toca el YAML de Cube salvo que se certifique | `17-self-service-calculations.md` |
| `report` / `page` / `visual` / `filter_definition` | Postgres, capa 8 | El Report Document Model real (Workspace → Report → Page → Visual), con filtros persistentes del autor separados del `InteractionState` efímero del usuario. Única fuente de verdad — sin tabla espejo (corregido; `dashboard_widget`/`dashboard_filter` ya no existen como tablas aparte) | `19-operabilidad-runtime.md` §8 |
| `gobernanza.certificaciones` | Postgres, capa 9 | Registro de qué está certificado y por quién | `09-auth-gobernanza.md` §9.1 |

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
9. **No materializar ni duplicar datos sin justificación explícita.** `stg_*`/`int_*` son `VIEW` (lógicas) por defecto — el propio default de SQLMesh. Solo `mart_*` se materializa siempre (rendimiento real, consultado en vivo por Cube). Materializar algo intermedio exige una de cuatro razones: rendimiento, reutilización por 2+ marts, incrementalidad real con estado, o auditoría — nunca "por las dudas". Detalle completo en `02-transformacion.md` sección 6.1.1.

**Nunca**: FastAPI ni otro framework Python sirviendo al frontend (Python es solo para capas de datos). SQL Lab tocando `mart_*` directo. Un modelo Python de SQLMesh llamando a una API externa (eso es trabajo de dlt, capa 3). Un rol de workspace baked-in en el JWT. Un objeto `{ metric, dimensions }` pasado directo a `cubeClient.load()` sin el adaptador de `13-recorrido-end-to-end.md` §4 — Cube espera `{ measures: [...], dimensions: [...] }`, nunca un campo `metric` suelto. `sqlmesh apply` como comando (no existe) — es `sqlmesh plan --auto-apply` para desplegar cambios, `sqlmesh run` para la ejecución programada de modelos ya desplegados; nunca `plan --auto-apply` dentro del DAG diario de Airflow.

---

## Los 3 niveles de despliegue

| Nivel | Catálogo | Postgres | Cuándo |
|---|---|---|---|
| Portátil | SQLite | No hace falta | Un solo dev, sin servidor |
| Equipo local | Postgres vía Podman | Uno solo | Equipo chico, misma red |
| Nube | Postgres gestionado | **2 instancias** (plano control + plano operativo, ver `11-infraestructura.md` §4.5) | Producción real |

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
- **Decisión pendiente antes del Paso 3:** el repositorio `minio/minio` está archivado; la pieza S3-compatible local se reevalúa con la regla 7 (`11-infraestructura.md` §4.4).
- **Nunca confundir una capacidad arquitectónica con la herramienta que la implementa hoy** (Semantic Model ≠ Cube, Matrix Engine ≠ TanStack Table, Visualization Engine ≠ ECharts) — **resuelto en `18-first-class-citizens.md`**, lectura obligatoria antes de tocar código de la Capa 8.

---

## Orden de construcción real (repetido de `CLAUDE.md`, es el que importa)

0. **Bootstrap del entorno de desarrollo** (nuevo, corrección de una revisión externa que señaló que faltaba un paso explícito): repo clonado, gestor de paquetes (`pnpm`/`uv`), `podman compose` levantando Postgres local, **OTel Collector incluido desde este primer compose**, DuckLake local configurado, la interfaz `SecretProvider` definida (con `EnvSecretProvider` como única implementación por ahora) — **todo esto tiene que poder reproducirse desde cero en una laptop nueva antes de escribir el primer modelo**. No es "construir la Capa 11 completa" (eso incluye OpenTofu, modo nube, el Edge Connector Agent, OpenBao) — es asegurar que el entorno de desarrollo local arranca solo, sin pasos manuales no documentados.

**Corrección de orden, señalada en una revisión posterior: Auth tiene que ir antes del frontend, no en el paso 8 — el checklist del MVP exige demostrar RLS con dos usuarios viendo datos distintos, y eso es imposible sin Auth ya construido.** Secuencia completa (repetida en `CLAUDE.md`, que es la que Claude Code obedece):

1. Almacenamiento (nivel "equipo local mínimo" — no "portátil") → 2. Transformación → 3. Semántico básico + *pushdown* validado → **4. Auth (`workspace_membership` + `data_entitlements`)** → 5. API Gateway + seguridad de Cube (JWT REST + experimento `checkSqlAuth`) → 6. Frontend mínimo Viewer → 7. Ingesta real → 8. Orquestación → 9. Interaction/State Engine → 10. Realtime (Electric) → 11. Self-service calculations → 12. IA → 13. Metadata → 14. Producción avanzada (OpenBao, nube, Edge Agent completo).

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
