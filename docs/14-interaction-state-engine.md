# Documento de implementación: Interaction Engine y State Engine

> `08-frontend.md` (sección 11.7) dejó estas dos piezas explícitamente como backlog. Este documento las diseña.
>
> **Corrección de una revisión externa: la primera versión de este diseño tenía tres huecos reales — un modelo de filtros demasiado simple para BI, un drill-down que perdía el contexto del nivel anterior, y un undo/redo que, en los hechos, hacía exactamente lo que decía que no hacía (pisar el cambio de otro usuario).** Los tres están corregidos abajo.

---

## Parte 1: Interaction Engine (cross-filter, drill-down, drill-through)

### 1.1 Filter AST, no un `Record<string, string[]>`

**Corrección: el diseño original modelaba cada filtro como `{ 'ventas.region': ['Norte'] }` — alcanza para "es igual a", pero un BI real necesita `entre`, `mayor que`, `no está en`, `contiene`, `fecha relativa`, etc.** Modelarlo así desde el principio evita reconstruir el Interaction Engine cuando aparezca el segundo operador:

### 1.1.1 Un filtro guardado por el autor y un click temporal del usuario no son la misma entidad

**Corrección de una confusión real, señalada en una revisión posterior: no distinguir esto lleva a mezclar dos cosas de vida y alcance completamente distintos.**

| | `FilterDefinition` (persistente) | `InteractionState` (efímero) |
| --- | --- | --- |
| Quién lo crea | El autor, al diseñar el reporte | Cualquier usuario, mirando el reporte |
| Dónde vive | `filter_definition` (Postgres, `19-operabilidad-runtime.md` §8) | En memoria del navegador, por sesión |
| Alcance | `report` / `page` / `visual` (columna `scope`) | El dashboard/reporte abierto en ese momento, nada más |
| Se sincroniza vía Electric? | Sí — es parte del documento | No — desaparece al cerrar la pestaña |

El AST (`DashboardFilter`, abajo) es la **estructura compartida** que usan las dos — un filtro guardado y una selección temporal tienen la misma forma (`member`/`operator`/`values`), pero viven en lugares distintos y con reglas de persistencia distintas. Nunca se confunde "el autor definió este filtro" con "alguien lo activó mirando el reporte ahora".

```ts
// apps/web/src/lib/dashboard/filter-ast.ts
export type DashboardFilter = {
  member: string;              // 'ventas.region' — mismo formato que un member de Cube
  operator:
    | 'equals' | 'notEquals'
    | 'in' | 'notIn'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'between'
    | 'contains' | 'startsWith'
    | 'isNull';
  values: unknown[];
  sourceWidgetId?: string;     // qué widget originó el filtro, para poder excluirlo de su propio cross-filter
};
```

Esta forma coincide, a propósito, con el formato de `filters` que Cube ya espera (`{ member, operator, values }`, verificado en `13-recorrido-end-to-end.md` paso 4) — no hace falta traducir dos veces, el mismo objeto viaja del Interaction Engine al adaptador de Cube casi sin cambios.

### 1.2 El estado compartido, sobre el AST

```ts
// apps/web/src/lib/dashboard/interaction-state.svelte.ts
export class InteractionState {
  filtrosActivos = $state<DashboardFilter[]>([]);
  drillPath = $state<Record<string, { member: string; value: unknown }[]>>({}); // por widget, ver 1.4

  aplicarFiltro(filtro: DashboardFilter) {
    this.filtrosActivos = this.filtrosActivos.filter((f) => f.member !== filtro.member);
    this.filtrosActivos.push(filtro);
  }

  limpiarFiltro(member: string) {
    this.filtrosActivos = this.filtrosActivos.filter((f) => f.member !== member);
  }
}
```

### 1.3 Query Coordinator — la pieza que faltaba, para no disparar N consultas por click

**Corrección: sin esto, un click en un dashboard de 20 widgets dispara ~20 consultas a la vez, y tres clicks seguidos pueden disparar ~60 — sin ningún control de orden, cancelación ni caché.** El Query Coordinator es la pieza intermedia entre `InteractionState` y la Capa 6.

**Corrección adicional, señalada en una revisión posterior: un caché sin invalidación queda desactualizado en silencio.** Si el usuario consulta "facturación" a las 9am (100M, queda en caché) y a las 10am el pipeline de Airflow (capa 7) carga datos nuevos (105M), una consulta idéntica más tarde en la misma sesión seguiría devolviendo 100M — el caché nunca se entera de que el dato de origen cambió. La corrección: cada entrada de caché lleva, además de la clave de la consulta, una **versión del dato** que se invalida cuando termina un refresco.

**Segunda corrección, más seria — un problema de aislamiento de datos, no solo de performance.** La clave de caché original era solo `JSON.stringify(query)` — si Juan consulta "facturación" en el workspace Comercial, y después cambia al workspace Finanzas y hace la misma consulta semántica, el JSON de la query puede ser idéntico aunque el `securityContext` (y por lo tanto las filas que debería ver) sea distinto. Sin el `workspace_id` en la clave, **el caché le devolvería a Finanzas un resultado que en realidad correspondía a Comercial** — no es un bug de performance, es una fuga de datos entre workspaces.

**Tercera corrección sobre el mismo problema, señalada en una revisión posterior: agregar `workspace_id` no alcanza — dos usuarios del *mismo* workspace pueden tener `entitlements` distintos.** Si Juan (entitlement `region = Norte`) y Pedro (entitlement `region = Sur`) están los dos en el workspace Comercial y ejecutan exactamente la misma consulta "facturación por mes", la clave `workspace_id:query` sería **idéntica para los dos** — el caché le devolvería a Pedro el resultado que en realidad correspondía a Juan. La corrección final: la clave usa un `securityFingerprint` — un hash del `security context` efectivo completo (`workspace_role` + `entitlements`, no solo el `workspace_id`) — así Juan:Norte y Pedro:Sur nunca comparten una entrada de caché, aunque la consulta sea idéntica letra por letra.

```ts
// apps/web/src/lib/dashboard/query-coordinator.ts
export class QueryCoordinator {
  private pendientes = new Map<string, AbortController>();
  private cache = new Map<string, { valor: unknown; dataVersion: number; creadoEn: number }>();
  private dataVersion = 0; // se incrementa cuando termina un refresco (ver abajo)
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutos, respaldo además de la invalidación explícita

  invalidarCache() {
    this.dataVersion++;
    this.cache.clear(); // simple para MVP — invalidar todo es más seguro que rastrear qué cambió exactamente
  }

  // securityFingerprint: un hash del security context efectivo (workspace_role + entitlements),
  // no solo el workspaceId — dos usuarios del mismo workspace con entitlements distintos
  // (Juan ve región Norte, Pedro ve región Sur) NUNCA pueden compartir una entrada de caché,
  // aunque hagan exactamente la misma consulta semántica. Ver la corrección de abajo.
  async consultar(securityFingerprint: string, widgetId: string, query: CubeQueryInput) {
    this.pendientes.get(widgetId)?.abort();
    const controller = new AbortController();
    this.pendientes.set(widgetId, controller);

    const clave = `${securityFingerprint}:${JSON.stringify(query)}`;
    const cacheado = this.cache.get(clave);
    const vigente = cacheado
      && cacheado.dataVersion === this.dataVersion
      && (Date.now() - cacheado.creadoEn) < this.TTL_MS;
    if (vigente) return cacheado.valor;

    await new Promise((r) => setTimeout(r, 150)); // debounce simple
    if (controller.signal.aborted) return;

    const resultado = await client.getMetric.query(query, { signal: controller.signal });
    this.cache.set(clave, { valor: resultado, dataVersion: this.dataVersion, creadoEn: Date.now() });
    return resultado;
  }
}
```

**Quién llama a `invalidarCache()`, y cuándo:** cuando el DAG de Airflow (capa 7) termina el paso de "refresco semántico" (`13-recorrido-end-to-end.md`, paso 6), publica un evento — vía un WebSocket simple, o vía polling de un endpoint liviano de "última actualización" — que el frontend escucha para invalidar. No hace falta Redis ni un sistema de invalidación distribuido para el MVP: un TTL corto (2-5 minutos) como respaldo, más esta invalidación explícita en el momento del refresco, alcanza.

Cada widget consulta a través del `QueryCoordinator`, nunca directo al cliente de la Capa 6 — así el debounce, la cancelación y el caché quedan en un solo lugar, no reimplementados por cada componente de gráfico. **No hace falta que sea sofisticado en v1** (el ejemplo de arriba alcanza), pero tiene que existir como pieza propia desde el principio — agregarlo después significa tocar cada widget uno por uno.

### 1.4 Drill-down: conserva el camino recorrido, no solo el nivel

**Corrección: el diseño original solo incrementaba un número (`drillLevel[widgetId]++`) — eso pierde el filtro del nivel anterior.** Si el usuario hace drill-down desde "Región = Norte" hacia ciudad, sin conservar `region = Norte` como filtro, el siguiente nivel muestra **todas** las ciudades de **todas** las regiones, no solo las del Norte.

```ts
// El path completo, no solo un número de nivel
interaction.drillPath['widget_15'] = [
  { member: 'ventas.region', value: 'Norte' },
];

function drillDown(widgetId: string, jerarquia: string[], valorClickeado: string, nivelActual: number) {
  const path = interaction.drillPath[widgetId] ?? [];
  path.push({ member: jerarquia[nivelActual], value: valorClickeado });
  interaction.drillPath[widgetId] = path;
  // la próxima consulta usa jerarquia[nivelActual + 1] como dimensión
  // Y path.map(p => ({ member: p.member, operator: 'equals', values: [p.value] })) como filtros — nunca solo el último nivel
}
```

Con el path completo guardado, la interfaz también puede mostrar un breadcrumb ("Norte > La Paz > Sucursal Centro") sin lógica adicional — es el mismo array, solo renderizado distinto.

### 1.5 Drill-through: sin cambios respecto al diseño original

Navegación de SvelteKit estándar, pasando el filtro por query param — esa parte no tenía problemas.

---

## Parte 2: State Engine (undo/redo, historial de cambios)

### 2.1 Corrección de un error real: el diseño original decía una cosa y el código hacía la contraria

**El diseño anterior afirmaba: "si María modifica el widget después de Juan, y Juan deshace, no le borra el cambio a María — solo escribe una nueva versión". Eso es falso tal como estaba diseñado.** Si Juan mueve un widget de `x=1` a `x=5`, María lo mueve de `x=5` a `x=10`, y Juan presiona deshacer, el comando de deshacer de Juan escribe `x=1` — y como es la escritura más reciente, gana por *last-write-wins* (Capa 10) y **sí** pisa el cambio de María, exactamente lo que el documento decía que no iba a pasar.

### 2.2 La corrección: versionado optimista, con detección de conflicto de undo

**`visual` ya trae la columna `version` desde su creación** (`19-operabilidad-runtime.md`, sección 8 — no como un `ALTER TABLE` agregado después, y sin una tabla `dashboard_widget` aparte — esa duplicación se corrigió, ver `10-colaboracion-realtime.md` sección 6.1). Esto es lo que hace posible el undo con detección de conflicto:

Cada comando de deshacer guarda la versión que tenía el widget **cuando Juan hizo el cambio original** — no solo el valor anterior.

**Corrección de una condición de carrera real, señalada en una revisión posterior.** La versión anterior hacía un `SELECT` para chequear la versión, y recién después un `UPDATE` — entre esos dos pasos, otra escritura puede colarse (Juan lee versión 5, María escribe versión 6, Juan escribe igual pisando a María, porque el chequeo ya había pasado). El check y la escritura tienen que ser **una sola operación atómica**, no dos:

```sql
-- packages/api-gateway/src/procedures/undoVisual.ts (la consulta SQL real, no un SELECT + UPDATE separados)
UPDATE visual
SET position = $1, version = version + 1
WHERE id = $2 AND version = $3  -- $3 = versionBase + 1, la versión esperada
RETURNING version;
```

```ts
interface Comando {
  widgetId: string;
  versionBase: number;   // la versión del widget en el momento de "hacer"
  deshacer: () => Promise<{ filasAfectadas: number }>; // ejecuta el UPDATE de arriba
}

async function deshacer(comando: Comando) {
  const { filasAfectadas } = await comando.deshacer();
  if (filasAfectadas === 0) {
    // el UPDATE no encontró la fila con esa versión exacta — alguien la cambió en el medio,
    // sin ninguna ventana de tiempo entre "chequear" y "escribir" porque fue una sola sentencia
    mostrarAviso('No se puede deshacer: alguien más editó este widget mientras tanto.');
    return;
  }
}
```

**Por qué esto es la corrección correcta, no un detalle:** `WHERE ... AND version = $7` dentro del propio `UPDATE` hace que la base de datos verifique y escriba en una sola operación indivisible — no hay ventana de tiempo entre "leer la versión" y "escribir" donde otra persona pueda colarse, que es exactamente el hueco que tenía el diseño anterior.

**Esto es exactamente lo que la Capa 10 ya necesita para su propia resolución de escritura concurrente** (control de concurrencia optimista, el mismo patrón que DuckLake usa a nivel de catálogo, capa 1) — no es una pieza nueva y aislada, es la misma técnica aplicada al problema de undo.

**Para el MVP, la regla simple y segura:** *undo solo se permite mientras el objeto no haya recibido un cambio remoto posterior* — si alguien más lo tocó, el botón de deshacer avisa en vez de sobrescribir en silencio. Es una limitación honesta, no una funcionalidad a medias disfrazada de completa.

### 2.3 El resto del diseño de comandos, sin cambios

La pila de comandos (`CommandStack`, ejecutar/deshacer/rehacer) y el historial visible de la versión anterior siguen siendo válidos — lo único que cambia es que `deshacer()` ahora chequea la versión antes de escribir, en vez de escribir a ciegas.

### 2.4 Alcance explícito del MVP

Undo/redo cubre acciones de layout y configuración — no cubre deshacer una escritura de Input Tables sobre datos de negocio, que tiene su propio flujo de auditoría.
