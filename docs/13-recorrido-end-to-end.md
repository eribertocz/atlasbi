# Documento de implementación: recorrido end-to-end de un dato real

> Ninguna de las 12 capas explica cómo se ve el mismo dato atravesándolas todas. Este documento sigue un caso concreto — "ventas de Salesforce, mostradas como un gráfico de barras en un dashboard" — de punta a punta, con nombres de archivo reales, no genéricos.
>
> **Corrección de una revisión externa (verificada contra documentación oficial de dlt, SQLMesh, Cube y Airflow): la primera versión de este documento tenía código de ejemplo con sintaxis incorrecta en varios pasos** — no eran errores cosméticos, eran ejemplos que si Claude Code los toma literales, generan pipelines rotos desde el día uno. Todo lo de abajo está corregido y verificado contra la documentación oficial de cada herramienta.

---

## El caso elegido, y por qué

"Ventas mensuales por región, desde Salesforce" — toca 8 de las 12 capas en su camino normal. Es representativo del 80% de lo que esta plataforma va a hacer en producción.

---

## Paso 0: dónde vive cada archivo, de una

```
packages/ingestion/pipelines/salesforce_ventas.py       ← Capa 3
packages/ingestion/pipelines/salesforce/                ← Capa 3, código del verified source (via dlt init)
packages/transform/models/staging/stg_ventas_sf.sql     ← Capa 2
packages/transform/models/marts/mart_ventas.sql         ← Capa 2
packages/semantic/cubes/ventas.yml                       ← Capa 4
packages/api-gateway/src/cube-adapter.ts                  ← Capa 6 (nuevo — sección 4)
packages/api-gateway/src/procedures/getMetric.ts          ← Capa 6
apps/web/src/routes/dashboards/[id]/+page.svelte          ← Capa 8
packages/orchestrator/dags/pipeline_ventas.py             ← Capa 7
packages/auth/src/workspace-membership.ts                 ← Capa 9
```

---

## Paso 1 — Ingesta (Capa 3): el dato sale de Salesforce, a un landing mínimo en DuckLake

**Por qué este caso usa el import con ingesta (`02-transformacion.md` §6.1.1):** Salesforce es una API de SaaS paginada, con cuota de llamadas, que no se puede volver a leer barato ni consultar con SQL. Por eso pasa por dlt y deja un landing. Una base SQL certificada para lectura directa (`02-transformacion.md` §6.1.2) no tendría este paso: SQLMesh la leería directo en el paso 2.

**Corrección 1: `destination="ducklake"`, no `"duckdb"`.** dlt tiene un destino nativo de DuckLake desde su versión 1.30 — con catálogo SQLite/Postgres y datos en Parquet, configurable de forma automática en modo local. Usar `destination="duckdb"` en el ejemplo original ignoraba por completo la elección de la Capa 1; con `"ducklake"`, dlt encastra directo sin ningún puente propio.

**Corrección 2: un *verified source* no se importa como `dlt.sources.salesforce.salesforce_source(...)`.** Los verified sources no viven en el core de dlt — se descargan al proyecto con `dlt init salesforce ducklake`, que genera el código localmente (en `packages/ingestion/pipelines/salesforce/`), y de ahí se importa como código propio del proyecto, no como un submódulo de la librería:

```bash
# Una sola vez, para traer el código del source al proyecto
cd packages/ingestion
dlt init salesforce ducklake
```

```python
# packages/ingestion/pipelines/salesforce_ventas.py
import dlt
from salesforce import salesforce_source  # código local, generado por `dlt init`, no un import de dlt.sources

pipeline = dlt.pipeline(
    pipeline_name="salesforce_ventas",
    destination="ducklake",       # el destino nativo de DuckLake, coherente con la capa 1
    dataset_name="landing",
)

source = salesforce_source()  # credenciales resueltas por dlt vía secrets.toml, ver 03-ingesta.md

# Solo el recurso que el análisis usa — nunca todo el catálogo de objetos de Salesforce.
pipeline.run(source.with_resources("opportunity"))
```

**Resultado concreto:** una tabla `landing.opportunity` en DuckLake (capa 1) con los campos que expone la API, más las columnas de control de dlt (`03-ingesta.md` §6.4). Es un landing, no una capa RAW: existe porque esta fuente no se puede volver a leer barato. dlt ya resolvió la paginación, el estado incremental y la evolución de esquema — y ahora, además, escribe directo al formato de la Capa 1 sin destino intermedio.

**Quién lo dispara:** no se corre a mano — lo dispara un DAG de Airflow (paso 6).

---

## Paso 2 — Transformación (Capa 2): de `landing` a `mart_*`, con la sintaxis incremental correcta

```sql
-- packages/transform/models/staging/stg_ventas_sf.sql
-- Corrección: `kind VIEW` (el default de SQLMesh), no `kind FULL` — este modelo solo renombra/tipa
-- columnas, no hay razón de rendimiento para materializarlo aparte. Ver 02-transformacion.md, sección 6.1.1.
MODEL (name stg_ventas_sf, kind VIEW);

SELECT
    id                  AS oportunidad_id,
    account_id          AS cliente_id,
    amount              AS monto,
    close_date          AS fecha_cierre,
    stage_name          AS etapa
FROM landing.opportunity
WHERE stage_name = 'Closed Won'
```

**Corrección 3: la configuración de `INCREMENTAL_BY_TIME_RANGE` va anidada, no como una propiedad suelta — y el modelo necesita filtrar explícitamente por el intervalo que SQLMesh está procesando, o SQLMesh lo rechaza.** La sintaxis correcta, verificada contra la documentación oficial de SQLMesh:

```sql
-- packages/transform/models/marts/mart_ventas.sql
MODEL (
    name mart_ventas,
    kind INCREMENTAL_BY_TIME_RANGE (
        time_column fecha_cierre
    )
);

SELECT
    oportunidad_id,
    cliente_id,
    monto,
    fecha_cierre,
    c.region
FROM stg_ventas_sf v
LEFT JOIN mart_clientes c ON v.cliente_id = c.cliente_id
WHERE fecha_cierre BETWEEN @start_ds AND @end_ds  -- obligatorio: SQLMesh sustituye el rango real en cada corrida
```

**Por qué el `WHERE` no es opcional:** SQLMesh no adivina qué filas pertenecen al intervalo que está procesando — el modelo tiene que decírselo explícitamente con `@start_ds`/`@end_ds` (macros que SQLMesh reemplaza en cada ejecución). Sin ese filtro, cada corrida reprocesaría todo el historial, no solo el intervalo nuevo — el mismo problema que el modelo `INCREMENTAL_BY_TIME_RANGE` existe para evitar.

**Resultado concreto:** `mart_ventas`, con un audit de `not_null`/`unique` sobre `oportunidad_id` — la única tabla de esta cadena que la Capa 4 tiene permitido leer. **Desde el paso posterior a `0.5.0`, ese mart tiene además un contrato de datos versionado** (`21-engineering-standards.md` §2.4), con sus columnas, tipos, nulabilidad y grano. La Capa 2 verifica con los datos que lo cumple, y la Capa 4 prueba su modelo contra el contrato, no contra lo que la Capa 2 publique ese día. En la plataforma real, el primero es `mart.sales_orders` 1.0.

---

## Paso 3 — Semántico (Capa 4): `mart_ventas` se vuelve una métrica con nombre

```yaml
# packages/semantic/cubes/ventas.yml
cubes:
  - name: ventas
    sql_table: mart_ventas

    dimensions:
      - name: fecha_cierre
        sql: fecha_cierre
        type: time
      - name: region
        sql: region
        type: string

    measures:
      - name: total_ventas
        sql: monto
        type: sum
```

**Resultado concreto:** Cube Core compila esto a SQL sobre DuckDB en cada consulta.

---

## Paso 4 — API Gateway (Capa 6): la consulta llega tipada al frontend — con la traducción real al formato de Cube

**Cómo quedó en el Paso 5 (`0.5.0`). Corrige los bloques de esta sección en tres puntos:**

1. **El adaptador no vive en la Gateway.** `toCubeQuery` y la traducción de operadores están en `packages/semantic/src/adapters/cube/cube-query.ts`. La Gateway solo conoce `SemanticRuntimePort` (`21-engineering-standards.md` §3). Los archivos `packages/api-gateway/src/cube-adapter.ts` y `procedures/getMetric.ts` de abajo no existen.
2. **El procedimiento es `semantic.query({ workspaceId, query })`**, con `SemanticQuery` v1: medidas, dimensiones, tiempo, filtros, orden y límite. No hay un campo `metric`. La traducción de filtros es la de abajo, más `in`/`notIn`, que van como `equals`/`notEquals`.
3. **Los tipos generados desde `/meta` no se adoptaron en el Paso 5.** Un `enum` estático de miembros no sabe qué puede ver cada persona. La validación que importa es en tiempo de ejecución, contra la metadata visible para ese security context, y la hace el adaptador antes de pedir datos: un miembro inexistente y uno no visible fallan igual. Si el frontend del Paso 6 necesita los miembros en tiempo de compilación, se reevalúa ahí.

**Corrección 4, la más importante de este documento: Cube nunca recibió un campo `metric`.** Su formato de consulta real, verificado contra la documentación oficial, es `{ measures: [...], dimensions: [...], filters: [...], timeDimensions: [...] }` — siempre arrays, nunca un string suelto. El contrato original de este documento (`{ metric, dimensions, filters }`) es una abstracción propia razonable para exponer al frontend, **pero necesita un adaptador explícito antes de llegar a Cube, nunca un passthrough directo**.

**Corrección adicional, señalada en una revisión posterior: los operadores del Filter AST (`14-interaction-state-engine.md`) no son idénticos a los operadores reales de Cube — traducirlos "casi sin cambios" fue una simplificación excesiva.** Cube tiene operadores propios que no tienen un equivalente 1:1 obvio (`set`/`notSet` en vez de "no es nulo", `inDateRange` para fechas, sin un `between` genérico para números). El adaptador tiene que traducir explícitamente, no asumir que el mismo nombre sirve — **y una corrección más: `between` sobre un número no es un solo filtro de Cube, son dos (`gte` + `lte`), así que el adaptador devuelve una lista de filtros por cada entrada del AST, no una traducción 1 a 1**:

```ts
// packages/api-gateway/src/cube-adapter.ts
// Traduce el contrato propio de esta plataforma al formato real de la Cube Query API —
// incluida la traducción de operadores, que NO son 1:1 con los de Cube.
import type { DashboardFilter } from '@atlasbi/contracts/filter-ast';

type CubeFilter = { member: string; operator: string; values: unknown[] };

// Devuelve un ARRAY — un filtro de nuestro AST puede traducirse a 0, 1 o 2 filtros de Cube.
function toCubeFilters(filtro: DashboardFilter): CubeFilter[] {
  switch (filtro.operator) {
    case 'isNull':
      return [{ member: filtro.member, operator: 'notSet', values: [] }]; // Cube usa notSet, no isNull
    case 'between':
      if (esDimensionDeFecha(filtro.member)) {
        return [{ member: filtro.member, operator: 'inDateRange', values: filtro.values }];
      }
      // Cube no tiene "between" para números — se arma con dos filtros combinados con AND (comportamiento por defecto)
      const [desde, hasta] = filtro.values;
      return [
        { member: filtro.member, operator: 'gte', values: [desde] },
        { member: filtro.member, operator: 'lte', values: [hasta] },
      ];
    default:
      return [{ member: filtro.member, operator: filtro.operator, values: filtro.values }]; // equals, notEquals, in, notIn, gt, gte, lt, lte, contains, startsWith sí coinciden
  }
}

export function toCubeQuery(input: { metric: string; dimensions?: string[]; filters?: DashboardFilter[] }) {
  return {
    measures: [input.metric],
    dimensions: input.dimensions ?? [],
    filters: (input.filters ?? []).flatMap(toCubeFilters), // flatMap, no map — un between numérico expande a dos filtros
  };
}
```

**Por qué esto importa, más allá de la corrección puntual:** mantener el AST propio (`DashboardFilter`) desacoplado de los operadores exactos de Cube es lo que permite, en el futuro, cambiar de motor semántico sin tocar el Interaction Engine — el adaptador absorbe la diferencia, el resto del frontend nunca sabe que existe.

```ts
// packages/api-gateway/src/procedures/getMetric.ts
import { toCubeQuery } from '../cube-adapter';
import { signCubeToken } from '../cube-auth'; // ver paso 5 — nunca un campo libre de la query

export const getMetric = protectedProcedure
  .input(z.object({
    metric: z.string(),
    dimensions: z.array(z.string()).optional(),
    filters: z.array(filterSchema).optional(),
  }))
  .query(async ({ input, ctx }) => {
    const cubeToken = signCubeToken(ctx.securityContext); // JWT corto, firmado, ver paso 5
    return cubeClient.load(toCubeQuery(input), {
      apiToken: cubeToken, // Cube decodifica esto del header Authorization — nunca un campo securityContext suelto
    });
  });
```

**Corrección 5, sobre una promesa que el documento hacía sin sustento: "si alguien cambia el nombre de la métrica en el YAML, TypeScript lo marca en rojo" — con `metric: z.string()`, eso es falso.** Un `string` sigue siendo válido para TypeScript aunque la métrica ya no exista en Cube; el error solo aparecería en tiempo de ejecución, no de compilación. Para que la promesa sea real, hace falta generar un tipo desde la metadata de Cube:

**Corrección adicional: `z.custom<Metric>()` ayuda a TypeScript, pero no valida nada en runtime** — un valor que llega por HTTP no pasa por el compilador, así que si el string no es exactamente una de las métricas válidas, `z.custom` lo deja pasar igual. La versión correcta usa `z.enum()` sobre la misma lista generada, dando las dos garantías a la vez:

```ts
// packages/contracts/generated/semantic.ts — generado, no escrito a mano
export const metrics = ['ventas.total_ventas', 'clientes.total_clientes' /* ... */] as const;
export const dimensions = ['ventas.region', 'ventas.fecha_cierre' /* ... */] as const;

export const MetricSchema = z.enum(metrics);
export const DimensionSchema = z.enum(dimensions);
export type Metric = z.infer<typeof MetricSchema>;
export type Dimension = z.infer<typeof DimensionSchema>;
```

```ts
// packages/api-gateway/src/procedures/getMetric.ts — versión con seguridad real de compilación Y de runtime
import { MetricSchema, DimensionSchema } from '@atlasbi/contracts/generated/semantic';

export const getMetric = protectedProcedure
  .input(z.object({ metric: MetricSchema, dimensions: z.array(DimensionSchema).optional() }))
  .query(/* ... */);
```

Este archivo generado (`packages/contracts/generated/semantic.ts`) se regenera con un script que lee la metadata de Cube (`/meta` de su API) en cada cambio del YAML de la Capa 4 — recién con ese paso, renombrar una métrica sin actualizar el frontend rompe la build antes de llegar a producción, que es lo que el documento prometía desde el principio.

---

## Paso 5 — Auth (Capa 9): de quién sos a qué región ves — dos JWT distintos, nunca uno solo

**Corrección, en tres partes — señaladas en revisiones posteriores a este documento.**

**Parte 0, la más importante para no confundirse: hay dos JWT distintos en este flujo, con contenido y propósito diferentes — no son el mismo token en dos lugares.**

| | JWT de sesión (better-auth) | JWT corto hacia Cube |
| --- | --- | --- |
| Quién lo firma | better-auth, una vez por sesión | La API Gateway, en cada request |
| Contenido | `user_id`, `organization_id` — **nunca** `workspace_role` ni `entitlements` | `user_id`, `organization_id`, `workspace_id`, `workspace_role`, `entitlements` |
| Vida | Dura la sesión | Corto, ~5 minutos, se firma de nuevo en cada llamada a Cube |
| A quién se le muestra | Al frontend y a la Gateway | Solo a Cube, nunca al frontend |

**Parte 1: `workspace_role` (qué podés hacer) y `data_entitlements` (qué datos podés ver) son cosas distintas, resueltas por separado** — mezclarlas obligaba a inventar roles combinados (`viewer_norte`, `viewer_sur`) cada vez que aparecía un recorte de datos nuevo. Detalle completo en `09-auth-gobernanza.md`, sección 6.1.

**Implementado en el Paso 4.** La forma real difiere del borrador anterior en tres puntos:
- **Auth no conoce tRPC.** Deniega con un error de su contrato (`AccessDeniedError`), y la Gateway lo traduce a su protocolo.
- **La identidad llega verificada del token**, no como un `userId` suelto.
- **El control entre organizaciones es parte de la resolución.**

```ts
// packages/auth/src/access/access-directory.ts (resumido)
async resolveSecurityContext(identity: Identity, workspaceId: string): Promise<SecurityContext> {
  // Dos preguntas — qué puede HACER (rol) y qué puede VER (entitlements) — en tres consultas paralelas.
  const [workspace, membership, entitlements] = await Promise.all([
    db.selectFrom('workspace').select(['id', 'organizationId']).where('id', '=', workspaceId).executeTakeFirst(),
    db.selectFrom('workspaceMembership').select('role')
      .where('workspaceId', '=', workspaceId).where('userId', '=', identity.userId).executeTakeFirst(),
    db.selectFrom('dataEntitlements').select(['dimension', 'allValues', 'allowedValues'])
      .where('workspaceId', '=', workspaceId).where('userId', '=', identity.userId).execute(),
  ]);
  // Deniega (AccessDeniedError, contrato de @atlasbi/contracts) si el workspace no existe, si es de
  // otra organización que la del token, o si no hay membresía. Nunca devuelve un contexto parcial.
  return buildSecurityContext(identity, workspace, membership, entitlements);
  // → { userId, organizationId, workspaceId, workspaceRole: 'viewer',
  //     entitlements: { region: { kind: 'listed', values: ['North'] } } }
}
```

**Parte 2: este objeto nunca viaja como un campo suelto de `cubeClient.load()` — Cube solo acepta security context vía un JWT verificado en el header `Authorization`, es su mecanismo real de autenticación, no una opción de conveniencia. Esto describe el camino de REST/GraphQL (`checkAuth`) — el camino del SQL API (`checkSqlAuth`, usado por `/v1/cubesql`) es un mecanismo distinto, todavía pendiente de validar empíricamente antes de escribir su código final (`17-self-service-calculations.md`, secciones 3.2.3 y 3.2.4).**

**Implementado en el Paso 4:**
- **Lo que viaja a Cube no es el security context tal cual,** sino su traducción a los grupos del modelo, en un solo lugar (`toQueryClaims`, `@atlasbi/semantic`). El rol no viaja, porque Cube no decide filas con él.
- **El token es corto y lo arma siempre el firmador de la plataforma:** HS256, emisor `platform-api`, audiencia `semantic-layer`, vida ≤ 300 s.
- **El SQL API por el puerto Postgres ya está resuelto:** `checkSqlAuth` acepta este mismo token como contraseña. El transporte HTTP `/v1/cubesql` quedó resuelto en el Paso 5: autentica con `checkAuth`, no con `checkSqlAuth` (`17-self-service-calculations.md` §3.2.4).

```ts
// Lo que pasa en cada request desde el Paso 5 (la firma del token corto la hace el adaptador de @atlasbi/semantic):
const identity = await identityPort.verifyIdentityToken(sessionIdentityToken); // { userId, organizationId }
const context = await accessDirectory.resolveSecurityContext(identity, workspaceId);
const queryToken = signQueryToken(apiSecret, toQueryClaims(context));
// toQueryClaims → { sub, org, workspace, groups: ['region:listed'], entitlements: { region: ['North'] } }
```

Cube recibe ese token en el header `Authorization`, lo verifica contra `CUBEJS_API_SECRET`, y construye su propio `securityContext` interno a partir de los claims — recién ahí el YAML de la Capa 4 puede referenciar `entitlements.region` en sus reglas de fila (`04-semantico.md` §6.2 y §6.6: `group: 'region:listed'` / `'region:all'`, con `contextToGroups`). La Gateway nunca le "dice" a Cube qué filtrar en un campo aparte; Cube lo deriva del token, como cualquier otro cliente autenticado.

---

## Paso 6 — Orquestación (Capa 7): `run`, no `plan --auto-apply`, para la ejecución diaria

**Corrección 6, importante: `plan` y `run` de SQLMesh son comandos con responsabilidades distintas, y el documento los mezclaba.** Verificado contra la documentación oficial: `sqlmesh plan` sirve para **evaluar y aplicar cambios al proyecto** (cuando el código de un modelo cambió) — es un comando de despliegue, corre en CI/CD cuando se mergea un PR, nunca en el DAG diario. `sqlmesh run` sirve para **ejecutar los intervalos de datos pendientes de modelos ya desplegados** — es el comando correcto para la ejecución diaria programada.

```python
# packages/orchestrator/dags/pipeline_ventas.py
with DAG("pipeline_ventas", schedule="@daily") as dag:

    @task
    def ingesta():
        # dispara salesforce_ventas.py (paso 1). Solo existe porque esta fuente usa el import
        # con ingesta: un pipeline de import directo no tiene tarea de extracción.
        ...

    @task
    def transformacion():
        # sqlmesh run — NO "plan --auto-apply": los modelos ya están desplegados,
        # esto solo procesa el intervalo de hoy. El despliegue de cambios de modelo
        # (sqlmesh plan) corre en CI/CD cuando se mergea un PR, ver 15-testing-cicd.md
        ...

    @task
    def refresco_semantico():
        # POST al endpoint de pre-agregaciones de Cube (paso 3)
        ...

    ingesta() >> transformacion() >> refresco_semantico()
```

---

## Paso 7 — Frontend (Capa 8): el dato se convierte en un gráfico

```svelte
<!-- apps/web/src/routes/dashboards/[id]/+page.svelte -->
<script lang="ts">
  import { client } from '$lib/trpc';
  import EChartWrapper from '$lib/components/EChartWrapper.svelte';
  import type { Metric, Dimension } from '@atlasbi/contracts/generated/semantic';

  let ventasPorRegion = $state<{ region: string; total: number }[]>([]);

  $effect(() => {
    client.getMetric.query({
      metric: 'ventas.total_ventas' satisfies Metric,
      dimensions: ['ventas.region' satisfies Dimension],
    }).then((r) => { ventasPorRegion = r; });
  });
</script>

<EChartWrapper option={barChartOption(ventasPorRegion)} />
```

**Resultado concreto:** con el tipo generado del paso 4, `'ventas.total_ventas' satisfies Metric` sí falla en la compilación si esa métrica se renombra en el YAML — la promesa original del documento, ahora cierta.

---

## Paso 8 (opcional) — Metadata (Capa 12): de dónde salió este número

Sin cambios respecto a la versión anterior — un job de OpenMetadata, orquestado por Airflow, lee el lineage de SQLMesh y el YAML de Cube y registra la cadena completa.

---

## Lo que NUNCA pasa en este recorrido (y si pasa, es un bug de diseño)

- El frontend (paso 7) nunca llama directo a Cube (paso 3) — siempre pasa por la Capa 6.
- SQLMesh (paso 2) nunca llama a la API de Salesforce, y ningún modelo adjunta una fuente por su cuenta: solo lee fuentes registradas por la plataforma (`02-transformacion.md` §6.1.2).
- El rol de workspace y los `entitlements` **nunca viajan en el JWT de sesión de better-auth** (ese solo lleva `user_id` + `organization_id`) — se resuelven en cada request y viajan en un JWT corto **distinto**, firmado por la Gateway específicamente para hablarle a Cube (paso 5). Son dos JWT diferentes, con contenido y propósito distintos — no confundirlos.
- Ningún paso escribe directo a `mart_ventas` fuera de SQLMesh.
- **Nuevo: la API Gateway (paso 4) nunca le pasa un objeto con `metric` directo a `cubeClient.load()`** — siempre pasa por `toCubeQuery()`. Un passthrough sin adaptador es un query malformado que Cube va a rechazar.
- **Nuevo: el security context nunca viaja como un campo `securityContext` suelto dentro de las opciones de `load()`** — siempre como un JWT firmado en el header `Authorization` (paso 5). **Corrección: esto es válido para REST/GraphQL (`checkAuth`) — el SQL API (`/v1/cubesql`, usado por el Editor de SQL avanzado de `17-self-service-calculations.md`) usa un mecanismo distinto, `checkSqlAuth`, todavía pendiente de validar empíricamente (esa misma sección, 3.2.3/3.2.4). No generalizar "JWT en Authorization" como si fuera el único mecanismo de todo Cube — son dos rutas de autenticación separadas.**
- **Nuevo: un operador del Filter AST nunca se pasa a Cube sin traducir** — `isNull` no es `notSet`, un `between` de fecha no es un `between` genérico. El adaptador (`toCubeOperator`, paso 4) siempre media entre los dos.
- **Nuevo: `sqlmesh plan` nunca corre dentro de un DAG de ejecución diaria** — eso es trabajo de CI/CD (`15-testing-cicd.md`). El DAG diario solo usa `sqlmesh run`.
