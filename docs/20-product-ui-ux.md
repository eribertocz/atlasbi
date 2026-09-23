# Documento de implementación: arquitectura de producto — UI/UX

> No hace falta diseñar cada botón, color o animación antes de programar — pero sí hace falta congelar la **arquitectura de experiencia**: qué ve un usuario de BI, qué ve un autor de reportes, qué ve un administrador, y qué interfaces técnicas quedan deliberadamente afuera de nuestra UI. Sin esto, Claude Code puede terminar clonando el Playground de Cube dentro de Svelte, o construyendo un inspector de pipelines de dlt que ya existe y no había que reconstruir. Este documento cierra esa arquitectura, a nivel de estructura, no de pixel-perfect.

**Regla de fondo:** esta plataforma tiene **una sola UI principal, en Svelte 5**. Las interfaces de dlt, SQLMesh, Airflow, Cube y OpenMetadata son herramientas técnicas auxiliares — nunca se convierten en el frontend del producto, y nunca se clonan dentro de él.

```
BI PLATFORM
            ┌───────────────────────┐
            │   NUESTRA UI SVELTE   │
            │   bi.empresa.com      │
            └───────────┬───────────┘
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
      Viewer          Author            Admin

BACKEND (el usuario común nunca sabe que esto existe)
dlt ───────────┐
SQLMesh ───────┤
Airflow ───────┼──→ nuestra API (capa 6) → Svelte
Cube ──────────┤
OpenMetadata ──┤
Electric ──────┘
```

---

## 1. Qué UI técnica ya existe, y qué hacemos con cada una — verificado, no asumido

| Herramienta | UI propia | Para quién | Qué hacemos nosotros |
| --- | --- | --- | --- |
| **dlt** | Sí — un dashboard local (CLI) para inspeccionar pipelines, esquemas, *traces*, cargas incrementales | Data engineer / debugging | No se reconstruye. Deep-link cuando un admin necesita diagnosticar un pipeline a fondo. |
| **SQLMesh** | **Deprecada** — su Browser UI está oficialmente descontinuada; la documentación recomienda la extensión de VS Code | Analytics engineer | No se diseña nada alrededor de una UI que el propio proyecto abandonó. SQLMesh vive en VS Code/CLI/CI-CD — punto. Nuestra plataforma solo muestra el *estado* de un modelo (ver sección 6), nunca su edición. |
| **Airflow** | Sí, muy completa — DAGs, *graph view*, *grid*, ejecuciones, logs, *backfills*, diagnóstico del *scheduler* | DataOps | No se reconstruye nada de esto — sería años de trabajo duplicando algo que ya existe y es bueno. Nuestra plataforma muestra un resumen (sección 6) con un enlace "Ver en Airflow →". |
| **Cube Core** | Sí — el Playground, para desarrollar y probar el modelo semántico | *Semantic engineer* | Es una herramienta de desarrollo, no la experiencia de negocio — la propia documentación de Cube lo aclara. Nunca se expone al usuario de BI. |
| **OpenMetadata** | Sí, muy completa — descubrimiento, *lineage* visual, calidad, *profiling*, *tags* | *Data steward* / gobernanza | No se reconstruye el catálogo completo. Pero una porción sí vale la pena mostrar *dentro* de nuestra UI (certificación, *owner*, enlace a *lineage* — sección 5), consumiendo su API. |

**Por qué nunca `iframe`, ni siquiera como atajo inicial:** integrar estas UIs embebidas trae autenticación cruzada, cookies entre dominios, políticas CSP, choques de estilos, *routing* anidado, falta de responsividad, y acoplamiento a la versión exacta de cada herramienta — una lista de problemas que no vale la pena para ahorrar un poco de trabajo de diseño. **El camino es: deep-link (un botón "Ver en Airflow →" que abre una pestaña nueva) primero, y solo si una funcionalidad puntual realmente lo justifica, integración por API propia después — nunca `iframe` como arquitectura principal.**

---

## 2. App Shell — un único cascarón, contenido según rol

```
┌──────────────────────────────────────────────────────┐
│ Logo   Workspace: Comercial ▾      Buscar      Usuario│
├──────────┬───────────────────────────────────────────┤
│ Inicio   │                                           │
│ Reportes │                                           │
│ Explorar │                 CONTENIDO                 │
│ Datos    │                                           │
│ Monitor  │                                           │
│ Admin    │                                           │
└──────────┴───────────────────────────────────────────┘
```

Esta es la misma estructura de sidebar colapsable a íconos + árbol de jerarquías ya diseñada en `08-frontend.md` (secciones 11.3-11.4) — este documento no la rediseña, define **qué módulos aparecen ahí** y **para quién**. El selector de workspace en el header conecta directo con el modelo de `workspace_role`/`data_entitlements` (`09-auth-gobernanza.md`) — los módulos visibles cambian según el rol real del usuario en el workspace activo, no según una configuración de UI separada.

| Módulo | Quién lo ve | Qué es |
| --- | --- | --- |
| Inicio / Reportes / Favoritos / Recientes | Todos | Modo **Viewer** (sección 3) |
| Explorar | `analyst` en adelante (permiso `sql_lab_access` o equivalente de exploración, `09-auth-gobernanza.md` §9.1) | Modo **Explore** (sección 4) |
| Datos | `analyst` en adelante | Vista de producto sobre el modelo semántico (sección 5) |
| Monitor | `admin`/`data_steward` | Estado simplificado de pipelines (sección 6) |
| Admin | `admin` de organización | Gestión de usuarios, workspaces, permisos |

---

## 3. Modo Viewer — lo único que ve la mayoría de los usuarios

Un usuario de BI común quiere abrir su reporte y mirar datos — nunca quiere ver ETL, modelos semánticos, ni pipelines. `HOME` / `REPORTS` / `FAVORITES` / `RECENTS`, y adentro de un reporte: el Interaction Engine ya diseñado (cross-filter, drill, bookmarks — `14-interaction-state-engine.md`, `18-first-class-citizens.md`). Nada de GridStack activo acá — es de solo lectura (`08-frontend.md` sección 12, ya decidido: Viewer y Builder son rutas separadas por costo de cargar el motor de canvas).

---

## 4. Modo Explore — más que un editor de dashboards

**Una capacidad que no estaba diseñada todavía: explorar el modelo semántico sin tener que crear un reporte primero.**

```
EXPLORE — Semantic model: Comercial

Dimensiones          Métricas
□ Área                □ Facturación
□ Categoría           □ Cobranza
□ Fecha                □ Cobrabilidad

                    ↓ (instantáneo, vía Query Coordinator)

              Tabla / Chart

[ Guardar como reporte ]  [ Agregar a reporte existente ]
```

El usuario tilda dimensiones y métricas, ve el resultado al instante (mismo camino que cualquier consulta — Filter/Context Engine + Query Coordinator, `18-first-class-citizens.md`), y recién si el resultado le sirve, lo guarda como un `report`/`page`/`visual` real (`19-operabilidad-runtime.md` sección 8) o lo agrega a uno existente. Es el mismo motor de consulta que el resto de la plataforma — Explore no es una ruta de datos aparte, es una UI distinta sobre el mismo camino.

---

## 5. "Datos" — conceptos de producto, nunca nombres de herramienta

**El usuario nunca ve "DuckDB", "SQLMesh" ni "dlt" — ve conceptos de negocio, aunque por debajo sean esas herramientas exactas:**

```
DATOS

Modelos semánticos   Datasets   Métricas   Dimensiones   Jerarquías   Conexiones   Actualizaciones
```

| Lo que el usuario ve | Lo que hay debajo |
| --- | --- |
| Modelo semántico | Cube (capa 4) |
| Actualizaciones | SQLMesh + Airflow (capas 2 y 7) |
| Conexiones | dlt (capa 3) |
| (nunca aparece en la UI) | DuckDB/DuckLake (capa 1) — el usuario de negocio no tiene ninguna razón para saber que existen |

Al abrir una métrica, se muestra su certificación y su *owner* (capa 9) y un enlace a *lineage* — consumiendo la API de OpenMetadata (sección 1), no reconstruyendo su UI:

```
Facturación Total
Owner: Comercial · Certificada ✓ · Actualizado: hace 4h
Lineage: Ver →   (deep-link a OpenMetadata)
```

---

## 6. Monitor — un resumen, nunca un clon de Airflow

```
MONITOR

Dataset          Última actualización   Estado
Facturación      08:42                  ✓
Cobranza         08:38                  ✓
Clientes         07:55                  ⚠ Ver detalles en Airflow →
```

Suficiente para que un administrador sepa, de un vistazo, si algo está atrasado — y si necesita diagnosticar a fondo (por qué falló una tarea, reintentar, ver logs), el deep-link lo manda a la UI real de Airflow, que ya hace ese trabajo mejor de lo que nosotros lo reconstruiríamos en meses.

---

## 7. Anatomía del Report Builder (modo Author) — la estructura, no el pixel-perfect

```
┌────────────────────────────────────────────────────────────────┐
│ ← Reporte   Ventas 2026    Guardar  Deshacer/Rehacer  Compartir│
├─────────┬──────────────────────────────┬─────────────────────────┤
│ Páginas │                              │ DATOS                   │
│         │                              │ Facturación              │
│ Pág. 1  │           CANVAS             │ ▸ Fecha                 │
│ Pág. 2  │          (GridStack)         │ ▸ Área                  │
│ Pág. 3  │                              │ ▸ Categoría              │
│         │                              ├─────────────────────────┤
│         │                              │ VISUAL                  │
│         │                              │ Campos / Formato /       │
│         │                              │ Interacciones            │
└─────────┴──────────────────────────────┴─────────────────────────┘
```

**Este panel derecho es la superficie donde viven directamente los First-Class Citizens ya definidos (`18-first-class-citizens.md`)** — no una pantalla nueva que inventar, es la interfaz de los contratos que ya existen:

- **DATOS** → arrastra medidas/dimensiones del Semantic Model (Cube, vía Filter/Context Engine).
- **VISUAL → Campos** → Visualization Engine (qué adaptador: ECharts, Matrix).
- **VISUAL → Formato** → Formatting & Theme Engine (`18-first-class-citizens.md`, Tier 1 — todavía sin diseño detallado, pero este es el lugar exacto donde va a vivir cuando se diseñe).
- **VISUAL → Interacciones** → Interaction Engine (cross-filter, drill).

**Para un Matrix**, el panel de campos cambia de forma (no son los mismos "campos" que un chart):

```
FILAS          COLUMNAS        VALORES
Área           Año             Facturación
Municipio      Mes             Cobranza
Zona
```

Esto conecta directo con el Matrix Engine ya diseñado (`08-frontend.md` sección 11.6) — filas/columnas jerárquicas con expand-collapse *server-side*, no una tabla plana con estilos.

**Páginas (columna izquierda):** es la UI directa del `page` del Report Document Model (`19-operabilidad-runtime.md` sección 8) — agregar una página es un `INSERT` en esa tabla, reordenarlas actualiza `"order"`.

---

## 8. Data Studio y Model Studio — para llegar a "Power BI Desktop-like", no solo a "Looker gobernado"

**Corrección de un límite real, señalado en una revisión posterior: la arquitectura hasta este punto asume que un ingeniero de datos prepara el modelo (SQLMesh, PR) y el autor de reportes solo consume — un patrón "BI gobernado" tipo Looker. Para competir con Power BI Desktop de verdad, el mismo autor no técnico necesita poder conectar, preparar y modelar datos, sin SQL.** Esto amplía la experiencia de creador a tres estudios, no dos:

```
CREATOR EXPERIENCE
│
├── 1. Data Studio     — conectar, limpiar, transformar (visual, sin SQL)
├── 2. Model Studio     — relaciones, dimensiones, jerarquías (visual, sin Cube YAML)
└── 3. Report Studio    — canvas, visuales, Matrix, filtros (ya diseñado, sección 7)
```

**Data Studio, bosquejo de UI (diseño completo pendiente — ver `18-first-class-citizens.md`, fila "Data Preparation & Modeling Studio"):**

```
DATA STUDIO — facturacion.csv

Fecha       Área      Consumo      Importe
...

Pasos aplicados
✓ Tipo de fecha
✓ Eliminar nulos
✓ Renombrar Importe → Facturación
✓ Filtrar gestión >= 2024
                                    [Aplicar]
```

Cada paso es una operación de una lista cerrada (filtrar, unir, renombrar, tipar, pivotar/despivotar, columna calculada, deduplicar, agrupar) — nunca SQL libre. Por debajo, cada paso se traduce a una expresión de **Ibis** (el candidato investigado, `18-first-class-citizens.md`), que Ibis compila a SQL real para DuckDB.

**Corrección de un riesgo de diseño real, señalado en una revisión posterior: si "Ibis → SQL → DuckDB" fuera el único camino, se crearía una segunda vía de transformación paralela a SQLMesh — un ingeniero prepara datos con SQLMesh (con lineage, versionado, incrementalidad, entornos), un autor no técnico prepararía datos con Ibis directo a DuckDB (sin nada de eso). Dos motores de transformación distintos para el mismo problema es exactamente el tipo de duplicación que este proyecto evita en otras capas.** La corrección: separar **Preview** de **Publish**, con destinos distintos a propósito:

```
PREVIEW (mientras el autor arma los pasos, iterativo, instantáneo)
Visual AST ──► Ibis ──► DuckDB ──► resultado de vista previa, descartable

PUBLISH (cuando el autor confirma que el resultado sirve)
Visual AST ──► compilador ──► modelo SQLMesh gestionado ──► sqlmesh plan ──► DuckLake MART
```

**Ibis nunca es el destino final de una transformación publicada** — es el motor rápido para que el autor vea el resultado mientras arma los pasos, sin esperar un ciclo de `sqlmesh plan`. Al publicar, el mismo AST se compila a un modelo SQLMesh real (`stg_*`/`mart_*`, `02-transformacion.md`), que pasa por el mismo `plan`/`run` que cualquier modelo escrito por un ingeniero — heredando lineage, versionado, incrementalidad y *environments* de fábrica, sin que el autor no técnico tenga que saber que eso está pasando.

**Model Studio, bosquejo de UI:**

```
Facturación ──area_id──► Área
                          │
                     Jerarquía:
                     Área → Municipio → Zona
```

Relaciones y jerarquías dibujadas visualmente, compiladas a la sintaxis real de Cube (joins y `hierarchies`, ya definidos en `04-semantico.md`).

**Corrección de un hueco real, señalado en la misma revisión: falta decidir dónde vive un borrador de modelo antes de convertirse en YAML certificado — un autor no técnico no puede hacer `git checkout`/editar YAML/PR.** La corrección: el mismo patrón *draft → validate → publish* que ya usa `17-self-service-calculations.md` para medidas, aplicado acá a relaciones/jerarquías:

```
Borrador de modelo semántico (tabla propia, por workspace)
        ↓ validar (referencias existen, sin ciclos de relaciones)
        ↓ publicar
YAML de Cube generado — el Git/PR ocurre detrás de escena para lo certificado,
nunca como un paso que el autor no técnico tiene que ejecutar
```

**Por qué esto queda fuera del MVP, dicho sin vueltas:** Data Studio es, en los hechos, un Power Query propio — meses de ingeniería real, no una tarde de diseño. Se nombra ahora como capacidad de primer nivel para que nadie la invente mal más tarde (ni como "otro parser propio", ni escondida dentro del Report Builder, ni como una segunda vía de transformación paralela a SQLMesh), pero el MVP (`16-mvp-definicion-terminado.md`) sigue asumiendo que `mart_*` ya existe, preparado por SQLMesh — el camino "autor conecta y prepara sus propios datos" es la evolución natural después de que el Report Studio ya funcione con datos reales.

---

## 9. Qué es bloqueante ahora, qué antes del Authoring Engine, y qué después

| Ahora (arquitectura de experiencia) | Antes del Authoring Engine | Después |
| --- | --- | --- |
| Information Architecture (secciones 2-6) | Anatomía del Report Builder (sección 7) con datos reales | Pixel-perfect, animaciones, microinteracciones |
| Qué UI es nuestra vs. externa (sección 1) | UX del Matrix (paneles de filas/columnas/valores) | Temas avanzados |
| App Shell + navegación por rol | UX de drill/cross-filter dentro del canvas | *Layouts* mobile |
| Principios de diseño (ya en `08-frontend.md` §11.5, no se repiten acá) | | **Data Studio y Model Studio completos** (sección 8) — nombrados y bosquejados, diseño detallado fuera del MVP |

No hace falta detener el Milestone 0 para diseñar cien pantallas — pero tampoco se llega al Authoring Engine sin haber resuelto la anatomía de la sección 7, porque ahí es donde vive la mayor parte del producto real (`18-first-class-citizens.md`, "los siete donde vale la pena invertir ingeniería propia").
