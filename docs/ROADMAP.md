# Roadmap — de Alpha 1 a Beta 1

> Fases, versiones e issues tentativos (2026-10-17). El orden de los pasos es el aprobado en `CLAUDE.md` ("Orden de construcción") y se revisa después de cada Fase 0: este documento lo sigue, no lo reemplaza. Cada fase es un milestone en GitHub (`eribertocz/atlasbi`) con el nombre de su versión.

## 1. Canales y versiones

Hasta 1.0 la versión del producto es `0.X.Y` (`21-engineering-standards.md` §2). El canal (alpha, beta) es una etiqueta de un rango de versiones, no un sufijo: el 0 ya dice "inestable".

| Canal | Versiones | Versión mayor del canal (`0.X.0`) | Versión menor (`0.X.Y`) | Contratos (API, Report Schema, AST…) |
| --- | --- | --- | --- | --- |
| Pre-alpha (hecho) | 0.1 – 0.7 | Cada paso de construcción | Correcciones | Se rompen sin ceremonia |
| **Alpha** | **0.8 – 0.17** | Cierra una fase de este roadmap | Correcciones y entregables chicos sin capacidad nueva | Pueden romperse, con nota de migración y la migración de datos hecha |
| **Beta** | **0.18 en adelante** | Una ronda de beta: cambios por lo aprendido, sin capacidades fuera del alcance v1 | Correcciones | **Congelados:** un cambio incompatible es una versión mayor nueva del contrato, que convive con la anterior |
| RC (fuera de este roadmap) | `1.0.0-rc.N` | — | Solo correcciones que bloquean | Congelados |
| Estable (fuera de este roadmap) | 1.0.0 en adelante | SemVer completo (`21` §2.1) | | |

- Dentro de una fase, los entregables se acumulan en "Unreleased" del `CHANGELOG.md`. Se etiqueta al cerrar la fase, o cuando se pida.
- Los contratos versionan aparte, como siempre (`21` §2).
- **Este roadmap termina en Beta 1 (0.18.0).** Al terminar todas las fases existe todo el alcance v1, así que los contratos se pueden congelar, y eso es lo que define una beta. No llega a RC: una RC necesita pilotos con usuarios reales, una auditoría de seguridad externa, rendimiento medido a escala, el modo nube corriendo en producción y un período sin cambios de contrato.

## 2. Cómo se trabaja en GitHub

- **Un milestone por fase**, con el nombre de su versión.
- **Antes de empezar una fase, se arma su roadmap tentativo** (la tabla de issues de su sección en este documento), y de ahí salen los issues y, después, los PRs. Una fase que todavía no empezó tiene solo su milestone, con la lista tentativa en la descripción, sin issues: así ningún issue queda viejo cuando cambien el orden o el diseño.
- **Cada issue** lleva su contexto, su alcance, lo que queda fuera y criterios de aceptación verificables.
- **Etiquetas:**
  - `type:` (`feature`, `decision`, `chore`, `docs`, `bug`);
  - `layer:`, la capa o pieza que toca.

  Un issue `type: decision` mide o decide algo antes de construir, como O1–O5. Se cierra con lo medido escrito en el documento de su capa.
- **Ramas y PRs:** una rama por issue (`<tipo>/<número>-<tema>`) y un PR que dice `Closes #N`. Commits separados por tema, como hasta ahora (`CHANGELOG.md`).

## 3. Fases

### Fase 0 — Cimientos · pre-alpha · 0.1.0 – 0.7.0 (hecha)

Pasos 0–7, Plan C, C6a y la medición de O1 (`07` §7.2). MVP: 9 de 11 casillas (`16`).

### Fase 1 — Cierre del MVP · Paso 8 · → **0.8.0, Alpha 1**

| Id | Issue | Tipo |
| --- | --- | --- |
| F1-01 | O2: el comando estable de la imagen de trabajos | decision |
| F1-02 | La imagen OCI de trabajos: la CLI, los verbos y sus entornos, fijada por *digest* | feature |
| F1-03 | `packages/orchestrator`: proyecto uv, Airflow fijado (O5) y su servicio en el perfil MVP | feature |
| F1-04 | El puerto `JobLauncher`, su adaptador para Podman y `run_job`, probado con un verbo falso | feature |
| F1-05 | El DAG diario: ingesta → transformación → refresco semántico, con el `cron '@daily'` del mart | feature |
| F1-06 | El DAG de mantenimiento del lakehouse | feature |
| F1-07 | Un reintento demostrado (75) y la alerta de un 65: la casilla de la Capa 7 | feature |
| F1-08 | O4: si una auditoría debe bloquear antes de publicar | decision |
| F1-09 | El pipeline de CI y el recorrido de `13` como test: la última casilla del MVP | feature |
| F1-10 | C6b: el confinamiento de Cube (servicio y motor) y el de Airflow | chore |
| F1-11 | Qué hacer con los esquemas físicos `sqlmesh__*` del lakehouse | decision |

**Sale cuando:** el MVP está en 11 de 11 (`16`).

### Fase 2 — Base de los estudios, Admin y Monitor · Paso 15 · → 0.9.0

- El cascarón según permisos y el sistema de diseño: tokens, tres paneles y los estados vacío, carga y error.
- El ciclo de vida de un artefacto: borrador → validar → vista previa → publicar → versiones, con `version` optimista y un contrato de problemas de validación.
- El servicio de trabajos, sobre el mismo `JobLauncher` que usa Airflow.
- Los permisos por capacidad y los eventos de auditoría.
- Admin: personas, workspaces, membresías y permisos por dimensión.
- Monitor, con O3: de dónde lee el historial.
- R1: editar `20` §1 y §6.

### Fase 3 — Interacción y estado · Paso 9 · → 0.10.0

- El Filter AST como contrato versionado.
- El drill.
- `version` y las mutaciones.
- El cross-filter sobre el AST.
- El estado de una vista.

### Fase 4 — Report Studio · Paso 16 · → 0.11.0

- El lienzo, con GridStack reevaluado con la regla 7.
- Páginas.
- El panel de datos.
- `FormattingSpec`, `ThemeSpec` y el versionado de `VisualSpec`.
- Interacciones y los filtros del autor (`filter_definition`).
- Publicar y versiones.
- Títulos propios en el modelo semántico.

### Fase 5 — Colaboración en tiempo real · Paso 10 · → 0.12.0

- Shapes de Electric sobre `dashboard_widget` y `dashboard_filter`, con difusión del servidor a los clientes.
- El reemplazo de la consulta periódica del servicio de trabajos.

### Fase 6 — Modelo y cálculos · Pasos 11 y 17 · → 0.13.0

- El Semantic Model AST, con su compilador a Cube y el importador de los cubes existentes.
- El verbo `semantic deploy`.
- `MeasureDefinition`, con su gramática medida en la Fase 0.
- El Visual Builder y Semantic SQL como vía de escape.
- La regla D1 en el estudio.
- El hueco de Cube Store con los filtros sobre medidas decimales.

### Fase 7 — Connections Studio · Paso 18 · → 0.14.0

- El registro de fuentes.
- Un `SecretProvider` que también escribe.
- Los conectores declarativos, generados desde formularios.
- La ingesta de fuentes configuradas, sus horarios y "ingerir ahora".

### Fase 8 — Data Studio · Paso 19 · → 0.15.0

- El Transformation AST.
- La vista previa.
- El compilador a modelos.
- Publicar con `transform deploy` a través del servicio de trabajos.
- El puerto de lectura endurecido (`08` §10.3).
- El editor SQL avanzado.

### Fase 9 — Copiloto de IA · Paso 12 · → 0.16.0

- `LLMProvider` y un servidor MCP propio sobre el modelo semántico, que se puede apagar.
- Un agente con los permisos de la persona y los mismos comandos (`21` §3.6).

### Fase 10 — Metadata y catálogo · Paso 13 · → 0.17.0 (último alpha)

- OpenMetadata, alimentado desde las capas 2, 3, 4, 7 y 9.
- El lineage dentro de Monitor, sin la UI de OpenMetadata (R1).

### Fase 11 — Producción y endurecimiento · Paso 14 · → **0.18.0, Beta 1**

- OpenBao como adaptador de `SecretProvider`, el modo nube con OpenTofu y el Edge Connector Agent.
- La auditoría de licencias, la migración a SvelteKit 3 y la política de retención para producción.
- **Lo que hace falta para la beta:**
  - la lista de contratos congelados, con sus versiones;
  - una actualización probada desde 0.17;
  - una revisión de seguridad interna;
  - respaldo y restauración;
  - una guía de instalación.
