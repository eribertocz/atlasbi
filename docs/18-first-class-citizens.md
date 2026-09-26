# Documento de implementación: capacidades de primer nivel (Architectural First-Class Citizens)

> Este documento existe para prevenir un error estructural específico y caro: implementar, por ejemplo, la matriz como "otro visual de ECharts", un bookmark como un hack de último momento, o los filtros como un `filters: []` suelto sin tipado. **Estas capacidades son la plataforma en sí** — el resto de las herramientas (dlt, SQLMesh, DuckDB, Cube, ECharts, Electric, Airflow, OpenMetadata) son implementaciones intercambiables de una capacidad, nunca la capacidad misma. Si en tres años se cambia Cube por otro runtime semántico, la arquitectura no desaparece — porque nunca dependió de Cube en sí, dependió de "Semantic Model" como capacidad.
>
> **Regla crítica para cualquiera que implemente código de estas capacidades: no se construyen como detalles ad hoc de un visual, una página o una tecnología concreta. Son subsistemas de plataforma con contrato propio, aunque su primera versión sea chica.**
>
> **Regla de lectura:** la columna "Implementación actual" puede cambiar con una corrección de gobernanza (como ya pasó varias veces en este proyecto). "Responsabilidad" e "Invariante" no deberían cambiar aunque la implementación sí. Los ítems de Tier 2/3 marcados "no diseñado" son intencionalmente así — nombrarlos ahora evita que alguien los invente mal más tarde, pero diseñarlos en detalle hoy sería trabajo especulativo sobre un producto que todavía no tiene Tier 0 funcionando.

---

## TIER 0 — ADN del producto (sin esto, no hay BI)

| Capacidad | Responsabilidad | Invariante | Implementación actual | Detalle en |
| --- | --- | --- | --- | --- |
| **Semantic Model** | Métricas, dimensiones, jerarquías, relaciones, seguridad de fila | Todo visual consulta al Semantic Model — nunca SQL arbitrario directo, salvo el escape hatch explícito de SQL Lab | Cube Core | `04-semantico.md` |
| **Calculation Engine** | La *definición* de un cálculo (ratio, % del total, YoY, rolling, medida que ignora un filtro) — separado de quién lo *ejecuta* | La definición del cálculo le pertenece a esta plataforma, no a Cube — Cube ejecuta, no decide qué significa un cálculo del usuario | `Visual Builder → AST → Semantic Query Compiler → Cube Semantic SQL` (ya diseñado, no es trabajo nuevo) | `17-self-service-calculations.md` |
| **Filter / Context Engine** | Modelar un filtro con su alcance real (seguridad, workspace, reporte, página, visual, *slicer*, cross-filter, drill, drill-through) | Un Filter AST tipado, nunca `filters: []` libre | `DashboardFilter` (Filter AST) | `14-interaction-state-engine.md` parte 1 |
| **Interaction State Engine** | Selección, cross-filter, cross-highlight, drill (con *path* conservado), navegación | El estado de interacción es compartido por dashboard, no por widget aislado | `InteractionState` (Svelte) | `14-interaction-state-engine.md` parte 1 |
| **Report Document Model** | La jerarquía de contenido: Workspace → Report → Page → Visual/Filter | Modelo versionable y serializable — el "documento de reporte" de la plataforma | `report`/`page`/`visual` (esquema real, ya resuelto) + `dashboard_widget`/`dashboard_filter` como estado sincronizado en vivo | `19-operabilidad-runtime.md` §8 |
| **Security & Entitlement Engine** | `{ user_id, organization_id, workspace_id, workspace_role, entitlements }` coherente por Auth → Gateway → Query → Cube → Caché | `workspace_role` (qué podés hacer) y `entitlements` (qué ves) nunca se mezclan en un solo campo | better-auth + `workspace_membership` + `data_entitlements` | `09-auth-gobernanza.md` sección 6.1 |

## TIER 1 — Motores de BI (lo que hace que se sienta como Power BI, no como un dashboard estático)

**Corrección de un límite real de la arquitectura hasta este punto, señalado en una revisión posterior: sin esta capacidad, la plataforma es un "Looker gobernado" (un equipo de ingeniería prepara el modelo, los usuarios solo consumen) — no un sustituto de Power BI Desktop, donde el mismo autor no técnico conecta, prepara y modela sus datos.** Nombrada acá, deliberadamente no diseñada en detalle todavía (ver la nota de alcance al final de esta fila).

| Capacidad | Responsabilidad | Invariante | Implementación actual | Detalle en |
| --- | --- | --- | --- | --- |
| **Query Planning & Coordination Engine** | Deduplicación, cancelación, debounce, caché con `securityFingerprint`+`dataVersion` | Ningún widget consulta la Capa 6 directo | `QueryCoordinator` | `14-interaction-state-engine.md` §1.3 |
| **Authoring Engine** | Canvas, drag & drop, *field wells*, resize, undo/redo, copy/paste | No se confunde con "GridStack" — incluye además Matrix Engine, Visualization Engine y Formula Editor | GridStack + shadcn-svelte + Monaco | `08-frontend.md` §11 |
| **Visualization Engine** | Traducir `VisualSpec` + datos ya agregados + tema + contexto a un render concreto, eligiendo renderer y estrategia de rendimiento; diferenciador principal del producto (visualización analítica premium) | Nunca "ECharts = la arquitectura" — ECharts es un adaptador; `VisualSpec` nunca persiste configuración de un renderer | ECharts adapter + Matrix adapter | **`22-visualization-engine.md`** (canónico) |
| **Visual Intelligence Engine** | Usar metadata del Semantic Model para decidir o sugerir tipo de visual, encoding, formato, escalas, densidad, paleta e interacciones | Produce `VisualSpec`, nunca configuración de renderer; reglas deterministas primero, la IA lo usa en vez de reemplazarlo | **No diseñado todavía** — dirección fijada | `22-visualization-engine.md` §3 |
| **Matrix Engine** | Filas/columnas/jerarquías con expand-collapse *server-side*, subtotales, virtualización, formato condicional | El cálculo siempre viene de Cube, nunca se recalcula sumando filas ya traídas | TanStack Table + Virtual | `08-frontend.md` §11.6 |
| **Formatting & Theme Engine** | Formato de número (moneda/porcentaje/decimales, locale), formato condicional, tema visual — como datos estructurados, no 300 propiedades sueltas en cada componente | `VisualSpec` + `FormattingSpec` + `ThemeSpec` como contrato — cambiar de renderer (ECharts → otro) nunca destruye un reporte existente, porque el formato no vive dentro del componente de ECharts | **No diseñado todavía** — Tier 1 pero pendiente; candidato natural: extender el objeto que ya guarda cada widget (`dashboard_widget.config`, capa 10) con estos tres sub-objetos | Dirección fijada en `22-visualization-engine.md` §4 (Visualization Design System) — diseño detallado pendiente, antes del Builder |
| **Navigation / Bookmark Engine** | *Page navigation*, drill-through, atrás, bookmarks (snapshot de filtros/selección/drill/página), URL profunda | Un bookmark es una foto de `InteractionState` en un momento dado — nunca un mecanismo nuevo y separado | **No diseñado todavía** — pero de bajo costo: es serializar el `InteractionState` que ya existe (`14-interaction-state-engine.md`) a una fila más, con nombre y fecha | Pendiente — extensión natural de `14-interaction-state-engine.md` |
| **Data Preparation & Modeling Studio** | Un autor no técnico conecta, limpia, transforma (filtrar, unir, renombrar, tipar, pivotar, columnas calculadas) y modela relaciones/jerarquías — sin SQL, sin ver SQLMesh, dlt, DuckDB ni Cube YAML | SQLMesh, dlt, DuckDB y Cube son detalles de implementación — nunca requisito de conocimiento para el autor. **Preview** (mientras se arman los pasos) usa Ibis directo a DuckDB; **Publish** siempre compila el **Transformation AST** (`21-engineering-standards.md` §2) a un modelo SQLMesh gestionado — nunca dos motores de transformación paralelos y permanentes para el mismo problema. La plataforma decide el camino de ejecución (import directo o con ingesta, `02-transformacion.md` §6.1.1): el autor no ve dlt, landing, SQLMesh, DuckDB ni DuckLake | **No diseñado en detalle — investigación inicial hecha, no el diseño completo.** Candidato real para Preview: **Ibis** (Apache 2.0, gobernanza de comunidad independiente, DuckDB como backend por defecto, usa SQLGlot — la misma librería que ya usa SQLMesh) | Pendiente — bosquejo de UI y distinción Preview/Publish en `20-product-ui-ux.md` sección 8 |

## TIER 2 — Plataforma empresarial (lo que la convierte en algo que una empresa grande puede operar)

| Capacidad | Responsabilidad | Invariante | Implementación actual | Detalle en |
| --- | --- | --- | --- | --- |
| **Realtime Collaboration** | Broadcast del estado confirmado del canvas a todos los clientes conectados | Nunca resuelve conflictos por sí sola — Postgres resuelve con concurrencia optimista | ElectricSQL | `10-colaboracion-realtime.md` |
| **Metadata Graph** | Grafo real: fuente → tabla → columna → dimensión → métrica → visual → reporte → workspace, para responder "¿quién usa esta columna?" y hacer *impact analysis* | El grafo es la capacidad; OpenMetadata es la implementación de hoy, no la capacidad en sí | OpenMetadata (riesgo de gobernanza documentado, Collate Inc.) | `12-metadata-gobernanza.md` |
| **Observability** | Seguir una petición de punta a punta, correlacionada por `trace_id`+`query_id`+`workspace_id`+`visual_id` | Todo emite OpenTelemetry — el backend (Grafana, etc.) es intercambiable sin reinstrumentar | OpenTelemetry | `11-infraestructura.md` §4.6 |
| **Performance Intelligence** | Recolectar latencia por etapa (planificación de Cube, ejecución de DuckDB, render), *cache hit rate*, filas escaneadas — y eventualmente recomendaciones automáticas ("esta dimensión causa el 72% del tiempo de consulta") | Se construye **sobre** los datos de Observability, nunca como un sistema de métricas paralelo | **No diseñado todavía** — es una capa de análisis sobre lo que OpenTelemetry ya captura, no una pieza de infraestructura nueva | Pendiente — extensión futura de `11-infraestructura.md` §4.6 |
| **Export / Rendering Engine** | PDF, PNG, SVG, Excel, snapshots programados — sin depender del navegador del usuario abierto | El render para exportar es un servicio server-side separado del render interactivo, nunca el mismo código | **No diseñado todavía** — ya estaba anotado como hueco de alcance (`00-documentacion-general.md` sección 4) | Pendiente — requisitos de visualización y de Custom Components en `22-visualization-engine.md` §11 |
| **Audit & Compliance** | Responder "¿quién cambió este entitlement?", "¿quién certificó esta métrica?", "¿quién publicó este reporte?", "¿quién exportó estos datos?" — distinto de Observability, que responde *por qué* algo tardó, no *quién* hizo qué | Un registro `audit_event`, append-only — nunca se edita ni se borra una fila ya escrita | **No diseñado todavía** | Pendiente |
| **Accessibility + Internationalization** | Navegación por teclado, *screen readers*, ARIA, alto contraste, locale, timezone, formatos de número/fecha/moneda — transversal a Viewer, Author y Explore | No es un "extra" que se agrega al final — una decisión de layout o de componente que lo hace imposible más tarde no se toma ahora, aunque la implementación completa espere | **No diseñado todavía** — requisito transversal, no una pieza aislada | Pendiente |

## TIER 3 — Ecosistema (lo que permite crecer más allá del equipo original)

| Capacidad | Responsabilidad | Invariante | Implementación actual | Detalle en |
| --- | --- | --- | --- | --- |
| **Extensibility / Plugin SDK** | Permitir un visual/conector/cálculo/acción de terceros sin tocar el core (`interface VisualPlugin { manifest, render(), capabilities }`). Para visuales, es el **Custom Visual SDK** | Un plugin de terceros nunca puede saltarse el Security Context ni el Filter Engine — entra por el mismo contrato que un visual propio | **No diseñado todavía** — aspiracional, sin fecha | Custom Visual SDK: `22-visualization-engine.md` §10 |
| **Custom Component Studio** | Componentes de dashboard creados por el autor avanzado con HTML + CSS + Vanilla JavaScript (KPI cards, scorecards, paneles), con datos vía contrato público y acciones estandarizadas hacia el Interaction Engine | El código custom es no confiable: runtime aislado, sin acceso a sesión, cookies, DOM de la app, bases de datos ni red por defecto; distinto del Custom Visual SDK | **No diseñado todavía** — visión de producto, dirección fijada | `22-visualization-engine.md` §9 |
| **Embedding SDK** | Incrustar un dashboard en un producto de terceros | Hereda el mismo Security Context, nunca un modo de acceso paralelo sin autenticación | **No diseñado todavía** | Pendiente |
| **AI / MCP** | El copiloto recorre Metadata Graph + Semantic Model + Report Model + historial de consultas + Security Context para responder preguntas de negocio reales, no solo generar SQL | Nunca inventa SQL libre — siempre pasa por el Semantic Model, mismo principio que ya rige toda la Capa 5. Para visualización produce `VisualSpec` validado, nunca configuración de un renderer; un Custom Component generado pasa por validación, sandbox, preview y aprobación | Servidor MCP propio + `LLMProvider` | `05-cerebro-ia.md`; visualización: `22-visualization-engine.md` §9.11 y §14 |

---

## Los nueve donde vale la pena invertir ingeniería propia, si hay que elegir

DuckDB, Postgres, Airflow, dlt, OpenTelemetry ya son piezas excelentes de infraestructura — no es ahí donde está el diferencial frente a Power BI. Está en:

1. Semantic Model
2. Calculation Engine
3. Filter + Interaction Engine
4. Query Planning & Coordination Engine
5. Authoring Engine
6. Matrix Engine
7. **Data Preparation & Modeling Studio** — es, probablemente, el que más decide si esta plataforma llega a ser "Power BI Desktop-like self-service" o se queda en "Looker gobernado". No es del MVP, pero es de los siete que más ingeniería propia va a consumir cuando se construya.
8. **Visualization Engine + Visual Intelligence** — decisión estratégica: la visualización analítica premium es uno de los diferenciadores principales. La inversión propia va al contrato (`VisualSpec`), Visual Intelligence, el Visualization Design System, el Motion System y la interacción unificada — no a reimplementar Canvas/WebGL, que las librerías ya resuelven (`22-visualization-engine.md`).
9. Plugin / Custom Visual SDK y Custom Component Studio (a futuro, Tier 3 — pero es lo que decide si la plataforma puede crecer más allá del equipo original)

El resto del stack importa y está bien elegido — pero el producto en sí vive en estos nueve.
