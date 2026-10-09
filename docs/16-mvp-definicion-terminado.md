# Documento de implementación: definición de "terminado" del MVP

> Ninguno de los 12 documentos de capa, ni el plan de implementación, dice cuándo el primer vertical slice cuenta como listo. Sin esto, "MVP" es una palabra sin límites — se puede seguir agregando cosas para siempre. Este documento fija la línea.
>
> **Corrección de una contradicción real, señalada por una revisión externa: la versión anterior decía que el MVP corre en "modo portátil" y al mismo tiempo requería Airflow y Postgres vía Podman — pero `11-infraestructura.md` define "portátil" específicamente como *sin* Postgres, *sin* Airflow, solo catálogo SQLite. No pueden ser la misma cosa.** La corrección: el MVP corre en **"equipo local mínimo"** — el segundo de los tres niveles de despliegue (`11-infraestructura.md` sección 4.4): Postgres vía Podman, Airflow, todo en una sola laptop, pero un nivel más arriba que "portátil". El modo portátil puro (sin Postgres, sin Airflow) queda como una experiencia a validar por separado, fuera del checklist de v1.

---

## 1. Qué SÍ entra en el MVP (v1) — checklist verificable

Un ítem cuenta como "hecho" solo si se puede demostrar en vivo, no si "el código existe". La demo de aceptación está en la sección 4.

- [ ] **Capa 1**: DuckDB + DuckLake corriendo en modo "equipo local mínimo" (catálogo Postgres vía Podman, no SQLite — ver corrección arriba), con al menos una tabla real de más de 10.000 filas.
- [x] **Capa 2**: al menos un modelo SQLMesh real (`stg_*` → `mart_*`), con al menos un audit (`not_null`/`unique`) pasando en verde. *(Paso 7, con el modelo de GitHub: `staging.stg_github_repo_events` → `marts.mart_github_repo_events`, sobre datos reales de `pnpm ingest github`. Sus audits `not_null` y `unique_values` pasan en verde sobre el lakehouse de desarrollo, en `pnpm transform plan` y en `pnpm transform audit`. El de ventas tiene la misma forma y sus audits también pasan, pero corre sobre el fixture determinista de desarrollo, no sobre datos reales. Que el mart de GitHub sea `FULL` y el de ventas incremental no cambia nada: la casilla no pide un modelo incremental.)*
- [x] **Capa 3**: al menos una fuente real conectada con dlt (una de las ~30 *verified sources*, `03-ingesta.md` sección 10.1 — no un CSV de prueba), con carga incremental funcionando (correrla dos veces y confirmar que la segunda solo trae lo nuevo). *(Paso 7, verificado en vivo con la *verified source* de GitHub sobre `duckdb/duckdb` y `sveltejs/svelte`: la primera corrida de `pnpm ingest github` cargó 595 eventos y la segunda, uno solo, el nuevo; la tercera, nada. El landing y el mart cumplen sus contratos con los datos reales, y el reporte "Actividad en GitHub" muestra a Ana solo `duckdb/duckdb` y a Bruno solo `sveltejs/svelte` en Finanzas.)*
- [x] **Capa 4**: entre 3 y 5 métricas reales en Cube, incluyendo al menos una de time-intelligence (`time_shift`, `04-semantico.md` sección 4) y al menos un security context de RLS demostrado con dos usuarios que ven datos distintos. *(Métricas y time-intelligence: Paso 3; RLS con Ana y Bruno: Paso 4, verificada en vivo por REST y por el SQL API.)*
- [x] **Capa 4/17, verificación de riesgo temprana** *(Paso 3; resultados y huecos en `17-self-service-calculations.md` §3.2.2)*: correr la batería de patrones de `17-self-service-calculations.md` (sección 3.2.2) contra el SQL API de Cube sobre DuckLake — medida simple, ratio, función de ventana, CTE, join, rolling window, time-shift — y confirmar cuánto hace *pushdown* real y cuánto cae a post-procesamiento, antes de construir el Editor de SQL avanzado sobre esa base.
- [ ] **Capa 17, primer experimento técnico obligatorio**: confirmar empíricamente cómo `/v1/cubesql` invoca `checkSqlAuth` (sección 3.2.4) — el mecanismo de autenticación del SQL API es distinto al de REST/GraphQL, y no se escribe código real de la Capa 17 hasta validar esto contra una instancia real de Cube.
- [x] **Capa 6**: esas métricas expuestas vía tRPC, con tipado end-to-end verificable (romper un tipo en el backend y ver el error en el frontend antes de correr nada). *(Paso 5: las métricas expuestas por tRPC, en `semantic.meta` y `semantic.query`, con la RLS verificada por HTTP. Paso 6: el corte de tipos de punta a punta, verificado: renombrar el procedimiento `report.get` en el gateway hace fallar el typecheck de la web justo en la página del reporte, sin correr nada; restaurado, vuelve a cero errores.)*
- [ ] **Capa 7**: un DAG de Airflow que encadena ingesta → transformación → refresco semántico, corriendo con éxito al menos una vez de punta a punta, con reintento demostrado (forzar un fallo y ver que se reintenta esa tarea específica, no todo el DAG).
- [x] **Capa 8**: un dashboard con 2-3 charts reales (ECharts) en **modo Viewer**, con cross-filter básico funcionando entre al menos dos widgets (`14-interaction-state-engine.md`, parte 1) y navegación por sidebar. *(Paso 6, verificado en un navegador real, sobre `pnpm dev` y sobre `pnpm stack:up`. El reporte demo "Ventas" tiene dos KPIs, barras por región y línea por mes, todo de Cube con la RLS de cada persona. Un click en East deja los KPIs en 1.049.744 y 4.000, y quitar el filtro los vuelve a 5.243.402 y 20.000. La sidebar navega workspaces y reportes. Ana y Bruno ven números distintos en el mismo reporte de Finanzas.)*
- [x] **Capa 9**: better-auth + `workspace_membership` con al menos dos workspaces de prueba y un usuario con rol distinto en cada uno, demostrando que el RLS de la Capa 4 responde distinto según el workspace activo. *(Paso 4: `pnpm seed` deja el escenario y se verificó en vivo con la cadena que usará la Gateway; el login con pantalla llega con el frontend, Paso 6.)*
- [ ] **El recorrido completo de `13-recorrido-end-to-end.md`** corre como test automatizado (`15-testing-cicd.md`, sección 4) y pasa en CI.

---

## 2. Qué NO entra en el MVP — fuera de alcance explícito, no olvidado

Sacado directamente del backlog ya documentado en cada capa, consolidado acá para que quede en un solo lugar:

| Queda afuera de v1 | Por qué | Cuándo se retoma |
| --- | --- | --- |
| Capa 5 (copiloto de IA) | El propio orden de construcción del proyecto la pone al final, sobre contratos ya estables | Después de v1, sin bloquear nada |
| Capa 10 (colaboración en tiempo real) | Ya documentada como "la última milla", pospostergable sin costo | Fase 2 |
| Capa 12 (metadata/catálogo) | Mejora de descubribilidad, no bloquea que la plataforma funcione | Fase 2, en paralelo si hay ancho de banda |
| Modo Builder del dashboard (GridStack, arrastrar/redimensionar) | v1 sale con dashboards pre-armados (YAML/código), sin editor visual todavía | Fase 2 |
| SQL Lab | Requiere el modelo de permisos ya andando (v1 lo tiene) pero es un escape hatch, no el camino principal | Fase 2 |
| Input Tables / Action Hub / Tableau Pulse (digest) | Ideas rescatadas de otros BI, ninguna es requisito para un dashboard funcional | Fase 2+ |
| Undo/redo (State Engine completo) | Cross-filter es más urgente que deshacer un movimiento de widget | Fase 2 |
| Modo nube/producción con 2 instancias de Postgres | v1 corre en "equipo local mínimo" — el modo nube es un problema de infraestructura, no de producto | Cuando haya un despliegue real que lo necesite |
| Modo portátil puro (SQLite, sin Postgres ni Airflow) | Es un nivel de despliegue más liviano que el MVP, no un requisito de v1 — se valida por separado | Cuando alguien necesite específicamente un solo dev sin ningún servicio corriendo |
| Cualquier cosa de la lista de "huecos de alcance" (`00-documentacion-general.md` sección 4, `AUDITORIA-EXTERNA.md`) | Authoring completo, embedding, alertas, exportación, mobile, accesibilidad — capacidades de plataforma madura, no de un primer slice | Explícitamente fuera de v1, sin fecha |

**Regla para decidir si algo nuevo entra o no entra en v1, cuando aparezca la duda:** ¿el checklist de la sección 1 se puede demostrar sin esto? Si sí, no entra en v1 — va a la tabla de arriba.

---

## 3. Qué significa "terminado" para v1 (una frase)

**v1 está terminado cuando alguien que no participó en construirlo puede: conectar una fuente real, ver los datos transformados y modelados, abrir un dashboard con al menos dos gráficos que reaccionan entre sí, y confirmar que un segundo usuario con otro rol ve un recorte distinto de los mismos datos — todo corriendo en una laptop, sin infraestructura de nube.**

---

## 4. Script de la demo de aceptación

El checklist de la sección 1 se verifica corriendo esto, en orden, frente a alguien que no construyó el proyecto:

1. `podman compose up` en modo "equipo local mínimo" (Postgres + Airflow incluidos) — sin ninguna configuración de nube.
2. Disparar el DAG de Airflow manualmente y ver las tres tareas (ingesta, transformación, refresco) pasar en verde, en ese orden.
3. Abrir el frontend, loguearse como Usuario A (workspace "Comercial", rol `admin`).
4. Ver el dashboard con los 2-3 charts reales, con datos que vienen de la fuente conectada en el paso 2 — no datos de prueba hardcodeados.
5. Clickear un valor en un chart y confirmar que otro widget del mismo dashboard reacciona (cross-filter).
6. Cerrar sesión, loguearse como Usuario B (workspace "Finanzas", rol `viewer`).
7. Confirmar que Usuario B ve un recorte de datos distinto al de Usuario A, sobre la misma métrica.
8. Romper algo a propósito (una columna esperada, una API key inválida) y confirmar que el DAG de Airflow marca la tarea específica como fallida, sin tirar abajo el dashboard que ya tenía datos cargados de antes.

**Si los 8 pasos se pueden hacer sin que nadie del equipo original ayude, v1 está terminado.** Si alguno falla o necesita explicación fuera de lo documentado, todavía no.
