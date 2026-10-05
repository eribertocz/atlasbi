# Documento de implementación: estándares de ingeniería, versionado y arquitectura de puertos/adaptadores

> Este documento es normativo. El código generado para este proyecto debe cumplirlo — no es una guía de estilo opcional, es la corrección de un hueco real: sin esto, Claude Code puede empezar a escribir `const espacioActivo = ...` en una línea y `CubeQuery` filtrando hasta el frontend en la otra, y esas convenciones, una vez sentadas en las primeras 10.000 líneas, son carísimas de corregir después.

---

## 1. Nombre del producto — codename, no marca definitiva

**No se elige un nombre público sin una revisión legal/de marca/dominio, que no es un trabajo de este documento.** Se usa un codename interno estable para todo lo que siga (repos, paquetes, variables de entorno tipo `ATLASBI_*`):

```
Project AtlasBI (codename provisional — nunca la marca pública)
```

**Política de naming, fijada en el Paso 1 (para que un renombre futuro sea mecánico):**

1. `AtlasBI` es un **codename provisional**; puede cambiar antes de 1.0, después de una revisión legal y de marca.
2. **Nunca llevan el codename:** contratos, tipos e interfaces de dominio (`AnalyticalQueryPort`, `QueryResult`, `LakehouseError`, `VisualSpec`…); objetos de base de datos (tablas, columnas, schemas); formatos persistidos (Report Document, `VisualSpec`); identificadores de almacenamiento que sobreviven a un renombre (la base del catálogo es `lakehouse`, el alias adjunto es `lake`, las carpetas son `.data/lakehouse/…` y `.data/duckdb/…`); nombres de telemetría (`db.*` estándar, `lakehouse.catalog_type`); superficies públicas para terceros (API/OpenAPI, tokens CSS, globales y protocolo de mensajes del runtime de Custom Components, IDs de esquema de manifiestos — `22-visualization-engine.md` §9.6).
3. **Pueden usarlo:** el scope de paquetes (`@atlasbi/*`), el prefijo de variables de entorno (`ATLASBI_*`), el nombre del repo y del proyecto de compose, los *defaults* de desarrollo de `.env.example`, los prefijos de recursos temporales de tests, la documentación, y el nombre visible — siempre desde **una única constante** (`PRODUCT_DISPLAY_NAME` en `tools/platform-cli/src/product.ts`), nunca como literal disperso.
4. **Un renombre tiene que ser mecánico** (buscar y reemplazar, regenerar el lockfile, recrear volúmenes de desarrollo). Si alguna vez deja de serlo, es un bug de naming a corregir, no una deuda aceptada.

---

## 2. Una versión global del producto, y contratos que evolucionan por separado

**Regla central: una versión global identifica el producto ante el usuario. Las versiones por contrato protegen la arquitectura — no avanzan juntas, y eso es correcto, no un descuido.**

```
BI PLATFORM
Version 1.8.2
│
├── API Contract         v1
├── Report Document      schemaVersion: 4
├── Semantic Contract    v2
├── Filter AST           v3
├── Calculation AST      v2
├── Plugin SDK           1.3.0
├── Transformation AST   v1   (lo que produce Data Studio)
├── Config Schema        v2
└── DB Migration         000072
```

`Product 1.8.2` puede salir sin que ninguno de los contratos de abajo cambie — una mejora visual, un fix, una optimización de consulta no tocan el contrato de API ni el esquema del reporte. Y al revés: reemplazar Cube, ECharts o DuckDB internamente (sección 4) puede pasar sin que el `Report Schema` ni la `API Contract` se enteren, si el contrato hacia afuera sigue siendo el mismo.

### 2.1 SemVer para la versión del producto

```
MAJOR.MINOR.PATCH
```

| Cuándo | Ejemplo |
| --- | --- |
| **PATCH**: sin cambio de capacidad ni de contrato público — *bug fix*, parche de seguridad, optimización, corrección de UI chica, *refactor* interno | "corrige que el drill-up perdía un filtro" → `1.7.2 → 1.7.3` |
| **MINOR**: funcionalidad nueva, compatible hacia atrás | "se agrega formato condicional a Matrix" → `1.7.3 → 1.8.0` |
| **MAJOR**: solo cuando se rompe un contrato público o de usuario (API v1 incompatible, Plugin SDK incompatible, formato de reporte incompatible sin migración transparente) | — |

**Regla fuerte: un cambio interno de arquitectura NUNCA justifica un MAJOR.** Reemplazar Cube, ECharts, SQLMesh o DuckDB por otra pieza, si el contrato externo (sección 4) sigue siendo compatible, es como mucho un MINOR — el usuario ni se entera de qué corre por debajo, y no debería tener que enterarse.

**Antes de 1.0**, la convención `0.MINOR.PATCH` permite cambios incompatibles sin ceremonia — coherente con el orden de construcción ya definido (`CLAUDE.md`):

```
0.1.0  bootstrap
0.2.0  vertical slice de datos
0.3.0  capa semántica
0.4.0  auth + RLS
0.5.0  report viewer
0.6.0  authoring básico
0.7.0  matrix
0.8.0  realtime
0.9.0  release candidate
1.0.0  primera versión estable
```

### 2.2 No se versiona cada commit

```
commits ──► release branch ──► decisión de release ──► version bump ──► CHANGELOG ──► tag
```

Commits normales (`feat(matrix): add server-side hierarchy expansion`, `fix(query): prevent stale visual responses`) no incrementan versión — pueden ser 25 commits antes de una decisión explícita de "esto ya es `0.7.0`".

### 2.3 La API pública y el Report Schema no siguen al producto

`API v1` puede seguir siendo `v1` durante varios MAJOR del producto — recién se rompe (`/api/v2`, con ventana de deprecación) cuando hace falta de verdad. El `Report Schema` (`schemaVersion`) migra con sus propias funciones de migración (`19-operabilidad-runtime.md` sección 8.1) — un reporte creado hoy tiene que poder abrirse dentro de años, migrado de forma transparente, sin que eso tenga nada que ver con qué versión de producto esté corriendo.

---

## 3. Arquitectura de Puertos y Adaptadores — regla obligatoria, no un diagrama bonito

**Corrección de fondo, señalada en una revisión posterior: varias piezas de este proyecto (Cube, ECharts, ElectricSQL, DuckDB, SQLMesh) ya se trataban informalmente como "reemplazables", pero sin una regla de código que lo garantizara.** `LLMProvider` (capa 5) y `SecretProvider` (capa 11) ya seguían este patrón — se generaliza ahora a **toda** pieza de infraestructura del proyecto, como regla estructural, no como una buena costumbre aislada.

```
PRODUCTO / DOMINIO
      │
      ▼
PUERTO (interfaz propia de la plataforma)
      │
      ▼
ADAPTADOR (traduce el puerto a la tecnología concreta)
      │
      ▼
TECNOLOGÍA (reemplazable)
```

| Puerto | Adaptador de hoy | Tecnología |
| --- | --- | --- |
| `SemanticRuntimePort` (Paso 5, contrato 1.0: `describe(context)` y `query(query, context)`, con el `SecurityContext` de la plataforma, `SemanticQuery` v1 y errores con códigos cerrados) | `createCubeSemanticRuntime`, en `packages/semantic/src/adapters/cube/`. La Gateway nunca lo nombra fuera de su punto de composición (`main.ts`) | Cube Core |
| `VisualizationRendererPort` | `EChartsAdapter`, `MatrixAdapter` (hoy); `VegaAdapter`, `DeckGLAdapter` como candidatos a evaluar — `22-visualization-engine.md` §2.2 | ECharts, TanStack Table |
| `RealtimeSyncPort` | `ElectricAdapter` | ElectricSQL |
| `AnalyticalQueryPort` (solo lectura) + `LakehouseAdminPort` (administración/escritura) — antes un único `AnalyticalEnginePort`; separados en el Paso 1 para que el futuro SQL Lab nunca reciba un puerto con `execute` (`01-motor-almacenamiento.md` §6.7 y §7) | `DuckDBAnalyticalQueryEngine` + `DuckDBLakehouseAdmin` en `packages/warehouse/src/adapters/duckdb/` (y un adaptador ClickHouse cuando aplique, `01` §6.3) | DuckDB + DuckLake / ClickHouse |
| `TransformationEngine` (`plan()`, `run()`, `backfill()`, `getLineage()`) | `SQLMeshAdapter` | SQLMesh |
| `MetadataCatalogPort` | `OpenMetadataAdapter` | OpenMetadata |
| `SecretProvider` (ya definido, `11-infraestructura.md` §4.7) | `EnvSecretProvider`, `OpenBaoAdapter`, `CloudSecretAdapter` | — |
| `IdentityPort` (Paso 4: usuarios, organizaciones, sesiones y el token de identidad con `sub` + `org` únicamente) | `createBetterAuthIdentity`, en `packages/auth/src/adapters/better-auth/` — el único lugar que importa `better-auth` (regla de ESLint) | better-auth |
| `LLMProvider` (ya definido, `05-cerebro-ia.md`) | `ClaudeProvider` | Claude (por defecto) |

**Honestidad sobre el límite de esta regla:** algunos motores tienen capacidades muy específicas — reemplazar SQLMesh no necesariamente da, de fábrica, exactamente el mismo `getLineage()`. El puerto encapsula el *impacto* del reemplazo en un solo lugar (el adaptador), no promete que cualquier reemplazo sea trivial o completo.

### 3.1 Ejemplo concreto — por qué esto no es solo teoría

**Incorrecto** (el tipo de Cube se filtra hasta el dominio):

```ts
const cubeQuery: CubeQuery = { measures: [...], dimensions: [...] };
```

**Correcto** (el dominio habla su propio lenguaje; el adaptador traduce):

```ts
// domain/semantic-query.ts — el contrato de la plataforma, nunca de Cube
interface SemanticQuery {
  measures: string[];
  dimensions: string[];
  filters: FilterNode[]; // FilterAst propio, 14-interaction-state-engine.md — nunca CubeFilter directo
}

// adapters/cube/cube-query-adapter.ts — acá, y solo acá, aparece el tipo de Cube
function toCubeQuery(query: SemanticQuery): CubeQuery { /* ... */ }
```

Mismo principio para Visualización — `VisualSpec` (`19-operabilidad-runtime.md` §8.1) nunca guarda un `echartsOption` — guarda `{ type: 'bar', measure: 'facturacion', ... }`, y es el `EChartsAdapter` el único lugar que sabe traducir eso a la opción real de ECharts.

### 3.2 Regla estricta: los tipos del proveedor nunca cruzan la frontera del adaptador

> **Vendor-specific types, SDK objects, configuration objects and exceptions MUST NOT cross adapter boundaries.**

`CubeQuery` no llega al frontend. `EChartsOption` no se guarda en Postgres. Un objeto de error específico de un SDK no se propaga tal cual hasta una respuesta de la API — se normaliza al contrato propio antes de cruzar el puerto.

### 3.3 Contract tests — la modularidad real, no solo el diagrama

Cada adaptador pasa la **misma** batería de tests que el puerto define — no una suite distinta por implementación:

```
SemanticRuntimePort — contract tests        (describeSemanticRuntimePortContract, Paso 5)
├── métrica: el total es la suma de los grupos               ✓
├── filtros: los 12 operadores del Filter AST                ✓
├── security context: una lista ⊆ "todo"; sin concesión,
│   miembro desconocido (sin oráculo)                        ✓
├── dimensión de tiempo: granularidad + rango                ✓
├── jerarquía: el padre es la suma de sus hijos              ✓
├── medida derivada = sumable / conteo                       ✓
├── truncado (limit + 1)                                     ✓
└── normalización de errores, sin texto del motor            ✓

createCubeSemanticRuntime → pasa todos (contra un stack de Cube propio, no el de desarrollo)
FutureAdapter       → tiene que pasar todos, o no reemplaza a Cube todavía
```

Sin esto, "es modular" es solo un diagrama — con esto, reemplazar una pieza es una tarea verificable, no una promesa.

### 3.4 Negociación de capacidades — nunca `if (provider === 'cube')` disperso

No todos los motores tienen las mismas capacidades (ver, por ejemplo, la tabla de cobertura de `17-self-service-calculations.md` sección 4 — `RANKX` como "a validar"). En vez de condicionales dispersos por toda la aplicación:

```ts
interface SemanticRuntimeCapabilities {
  windowFunctions: boolean;
  multiStageCalculations: boolean;
  preAggregations: boolean;
  semanticSql: boolean;
}
```

El producto pregunta `runtime.capabilities.windowFunctions` — nunca compara contra el nombre de un proveedor específico.

### 3.5 Las dos reglas centrales, para citar literal en cualquier PR

> **Replaceability Principle**: No infrastructure or third-party technology is part of the product domain contract. Every replaceable subsystem MUST be accessed through a platform-owned port/interface and a technology-specific adapter. Replacing an implementation MUST NOT require changes outside its adapter unless the platform contract itself changes.

> **Contract Ownership Principle**: Platform contracts are owned by the product, never by Cube, DuckDB, ECharts, ElectricSQL, SQLMesh, OpenMetadata or any other provider.

---

## 4. Código — inglés siempre, sin excepción

> **All code identifiers MUST be in English** — variables, funciones, clases, interfaces, tipos, archivos, carpetas, identificadores de base de datos, campos de API, eventos, tests.

```ts
// Correcto
const activeWorkspace = ...;
function resolveSecurityContext() {}
class QueryCoordinator {}

// Incorrecto
const espacioActivo = ...;
function resolverSeguridad() {}
```

## 5. Comentarios — por qué, nunca qué

**No** (ruido, describe lo que la línea ya dice):
```ts
// Increment counter by one
counter++;
```

**Sí** (explica una decisión no evidente):
```ts
// Preserve the previous version to detect concurrent edits.
const expectedVersion = visual.version;
```

## 6. Docstrings — solo APIs públicas o comportamiento no evidente

```python
def build_incremental_window(start, end):
    """Build the execution interval used by the incremental model."""
```

Un *helper* trivial de diez líneas no necesita documentación — un docstring en cada función es tan ruido como un comentario en cada línea.

## 7. Clean code — reglas concretas, no una aspiración vaga

- Preferir código explícito sobre código "inteligente".
- Funciones chicas y cohesivas; una responsabilidad por módulo.
- Evitar abstracciones prematuras y herencia profunda — preferir composición.
- Evitar explosión de parámetros booleanos, estado global oculto, *strings*/números mágicos.
- Sin código muerto, sin código comentado, sin lógica de dominio duplicada.
- **Nunca un módulo basurero** (`utils.ts`, `helpers.py`, `common.py`, `misc.ts`) — cada función vive donde su responsabilidad indica, no en un cajón de sastre.

## 8. Convenciones de nombres, por lenguaje

| Lenguaje | Convención |
| --- | --- |
| TypeScript | `camelCase` (variables/funciones), `PascalCase` (tipos/clases/componentes), `UPPER_SNAKE_CASE` (constantes reales), `kebab-case` (archivos/rutas) |
| Python | PEP 8 — `snake_case`, `PascalCase` para clases, `UPPER_SNAKE_CASE` para constantes |
| SQL | `snake_case`, minúsculas — `fact_billing`, `dim_customer`, `workspace_membership` (inglés cuando el dominio lo permite, coherente con la regla 4) |

## 9. Separación de contratos también dentro del código — nunca el mismo objeto para todo

**El mismo principio de puertos/adaptadores (sección 3), aplicado a la forma de los datos, no solo a las tecnologías externas.** `ReportDocument` (dominio) nunca es automáticamente el mismo objeto que la fila de Postgres, ni el mismo que el DTO de la API:

```
domain/report.ts            — el contrato de dominio
contracts/api/report.ts     — el DTO que cruza la API pública
persistence/report-repository.ts — el mapeo a la fila real de Postgres
```

Cambiar una columna de la tabla `report` (`19-operabilidad-runtime.md` §8) nunca debería, por sí solo, romper el frontend — porque el frontend nunca vio la fila de Postgres directo, vio el contrato de dominio.

---

## 10. Qué es bloqueante ahora

Todo este documento es bloqueante **antes de generar código de cualquier capa** — no después. Las convenciones de las primeras 10.000 líneas son las que después cuesta corregir; corregirlas ahora, en un documento, cuesta una lectura.

---

## 11. Licencia del producto

**Decisión de producto (2026-09-26): AtlasBI se publica como software 100 % open source, bajo la licencia Apache 2.0.** Todo lo que vive en este repositorio —paquetes, CLI, modelos, configuración y documentación— se distribuye bajo Apache-2.0.

**La licencia del producto no se extiende a las herramientas que corren como servicios separados.** PostgreSQL, Cube Core, Cube Store, Garage, Apache Airflow, OpenMetadata, ElectricSQL o el OpenTelemetry Collector no necesitan tener la misma licencia que AtlasBI. La arquitectura de Puertos y Adaptadores (§3) lo garantiza: AtlasBI nunca embebe ni modifica el código fuente de esas herramientas; les habla por red, con su protocolo o su API (protocolo de Postgres, S3, HTTP), desde un adaptador propio. Cada una corre como un proceso aparte y conserva su propia licencia.

**Ejemplo: Garage (AGPL-3.0).** El object storage del nivel "equipo local" (`11-infraestructura.md` §4.4) corre como un contenedor aparte, con la imagen oficial del proyecto Garage, sin cambios. AtlasBI nunca modifica su código ni lo distribuye junto con el propio: el `compose.yaml` solo referencia esa imagen publicada, que cada instalación descarga de su origen, y la plataforma le habla por la API S3. Por eso la AGPL de Garage no genera ninguna obligación de licencia cruzada sobre AtlasBI. Si algún día hiciera falta modificar Garage, ese cambio iría upstream o a un fork público bajo su propia AGPL, nunca a este repositorio.

**Lo que sí queda alcanzado: las dependencias embebidas.** Las librerías que corren dentro de los procesos de AtlasBI —paquetes npm y Python que su código importa— se distribuyen junto con él, así que su licencia tiene que ser compatible con Apache-2.0. Las permisivas (MIT, BSD, ISC, Apache-2.0) no tienen restricción; las de copyleft débil (MPL-2.0, LGPL) se evalúan caso por caso; las de copyleft fuerte (GPL, AGPL) nunca se embeben, a lo sumo corren como servicio separado, como Garage. Es la misma razón por la que `04-semantico.md` §6.5 ya marcaba la AGPL de Sidemantic como un punto a cuidar.

**Esta sección es el criterio de ingeniería del proyecto, no una opinión legal.** Antes de la primera publicación, una revisión legal la confirma, igual que el nombre público (§1).
