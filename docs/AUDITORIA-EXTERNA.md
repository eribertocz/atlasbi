# Auditoría externa — hallazgos consolidados (ChatGPT + Kimi K3)

> **Estado: CERRADA.** Los 4 hallazgos críticos, los 10 importantes y los 5 menores fueron corregidos en los documentos del proyecto. Este archivo queda como registro histórico de qué se encontró, qué se verificó, y cómo se resolvió cada punto — no como lista de pendientes.

---

## CRÍTICO — corregir antes de seguir avanzando

### ✅ RESUELTO — C1. SQL Lab rompe el contrato de la Capa 4 y es un hueco de seguridad real
**Coinciden ambas revisiones.** DuckDB no tiene RLS nativo. "SQL Lab, solo lectura, directo al warehouse" (capa 8, sección 10.3) significa que cualquier usuario con acceso puede saltarse el *security context* de Cube y leer filas/columnas que su rol no debería ver. "Solo lectura" evita `DELETE`, no evita leer datos de otro tenant o columnas sensibles (salarios, PII).
**Afecta:** `08-frontend.md` (sección 10.3), `04-semantico.md` (contrato, sección 7), `09-auth-gobernanza.md`.
**Acción:** diseñar RLS de verdad para SQL Lab (vistas por rol en el warehouse, o credenciales de DuckDB limitadas por usuario) antes de dejarlo documentado como si ya estuviera resuelto — o restringirlo a un rol explícito (`data_steward`/`analista`) mientras no exista esa solución.

### ✅ RESUELTO — C2. Aplicación inconsistente de la regla de gobernanza (tRPC/better-auth vs. Yjs)
**Coinciden ambas revisiones, de forma independiente.** Se usó "adopción masiva sin empresa/fundación" para salvar a tRPC, y "adopción masiva sin empresa/fundación" para descalificar a Yjs — mismo perfil de riesgo, veredicto opuesto.
**Afecta:** `CLAUDE.md` (regla 7), `06-api-gateway.md`, `10-colaboracion-realtime.md`.
**Acción:** definir un criterio único y explícito de "cuánta adopción alcanza" (ej. un umbral concreto: descargas semanales + años en producción + cantidad de proyectos de terceros que dependen de la herramienta), aplicarlo igual a los dos casos, y aceptar el resultado sea cual sea — incluso si eso significa revisar la decisión de tRPC o la de Yjs.

### ✅ RESUELTO — C3. Cube Core no expone MDX ni DAX — dato factual incorrecto en `04-semantico.md`
**Verificado con la documentación oficial de Cube.** El README de Cube Core dice "REST, GraphQL, and SQL" — nada de MDX/DAX. Ambas APIs están confirmadas como exclusivas de Cube Cloud, tier Enterprise+. Esto también cierra la puerta a "Analyze in Excel" que ambos revisores señalan como hueco.
**Afecta:** `04-semantico.md` (sección 4.2), `00-documentacion-general.md`.
**Acción:** corregir la frase, y documentar honestamente que el camino a Excel/herramientas legadas que hablan MDX/DAX no existe en la versión self-hosteada — no fingir que sí.

### ✅ RESUELTO — C4. Contexto de Fivetran/Tobiko/dbt Labs — falta, y en realidad favorece la decisión
**Verificado: Fivetran compró Tobiko Data (creadores de SQLMesh) en sept. 2025; Fivetran se fusionó con dbt Labs en jun. 2026 — misma empresa hoy.** SQLMesh se donó a la Linux Foundation en marzo 2026, antes de que la fusión se completara — es la jugada que blindó al proyecto de terminar bajo el mismo techo corporativo que dbt.
**Afecta:** `02-transformacion.md` (sección 4.1).
**Acción:** agregar este contexto como el argumento más fuerte a favor de la decisión, no como un riesgo — es la prueba concreta de por qué la regla de gobernanza importa.

---

## IMPORTANTE — corregir, no bloquea pero deja el diseño más honesto

### ✅ RESUELTO — I1. dbt cambió de licencia otra vez (jun.–sept. 2026): ahora existe "dbt OSS", 100% Apache 2.0
**Verificado.** El argumento de licencia contra dbt en la Capa 2 está desactualizado. SQLMesh sigue ganando por gobernanza (Linux Foundation vs. una empresa) y encaje técnico, pero no por el argumento de licencia tal como está escrito hoy.
**Afecta:** `02-transformacion.md` (sección 4.1–4.2).

### ✅ RESUELTO — I2. DuckDB-WASM ya soporta persistencia nativa vía OPFS (desde el 18 de septiembre de 2026)
**Verificado, con la salvedad exacta que hay que fijar una versión de npm específica por un bug de la build "latest".** Cambia la arquitectura offline de la Capa 8.
**Afecta:** `08-frontend.md` (sección 6).

### ✅ RESUELTO — I3. ElectricSQL: el mecanismo descrito está mal explicado
**Verificado con la documentación oficial.** El plugin de sync no soporta escrituras locales hacia el servidor ni resolución de conflictos — "las escrituras son responsabilidad tuya" (vía API normal). La arquitectura de fondo sigue siendo válida (Postgres como verdad única, Electric solo hace el broadcast a los demás clientes, la escritura ya la resuelve la mutation de tRPC de la capa 6) — pero hay que corregir la descripción del mecanismo.
**Afecta:** `10-colaboracion-realtime.md` (secciones 4 y 6.1).

### ✅ RESUELTO — I4. Un solo Postgres sirviendo 5 consumidores es un dominio de falla compartido, no aislamiento
Catálogo DuckLake + estado de Airflow + estado de SQLMesh + estado de Electric + RLS nativo, todo en el mismo servidor. "Esquemas separados" no es lo mismo que aislamiento real, y contradice la propia regla 1 (responsabilidad única).
**Afecta:** `01-motor-almacenamiento.md`, `07-orquestacion.md`, `10-colaboracion-realtime.md`, `11-infraestructura.md` (nota transversal).

### ✅ RESUELTO — I5. Interfaz `LLMProvider` en vez de Claude hardcodeado en el contrato
Sugerencia de buena práctica de ingeniería, independiente de qué proveedor se use por defecto — deja explícito que el *core* es OSS y el proveedor de IA es una pieza intercambiable, no una atadura.
**Afecta:** `05-cerebro-ia.md`.

### ✅ RESUELTO — I6. `organization` ≠ `workspace` — mezcla de identidad/tenant con fronteras de contenido/gobernanza
Corregirlo ahora es barato; corregirlo después de construido, no.
**Afecta:** `09-auth-gobernanza.md`.

### ✅ RESUELTO — I7. `triggerAction` (Action Hub) es un vector de SSRF sin allowlist de dominios
Nadie lo había señalado hasta esta ronda. POST a URLs configurables por el usuario sin restricción es un vector clásico.
**Afecta:** `06-api-gateway.md` (sección 9.2).

### ✅ RESUELTO — I8. Apache Ossie: correcciones menores de precisión
Los core developers son Snowflake, Dremio y dbt Labs (Databricks es partner, no core); la iniciativa nació en sept. 2025, v0.1 en enero 2026 — no "lanzado en enero 2026" sin más contexto.
**Afecta:** `04-semantico.md` (nota de gobernanza).

### ✅ RESUELTO — I9. Benchmark 90%→98,2%: correcto en el número, sobre-interpretado en el peso que se le da
Es real (Ganz & Perigaud 2026, verificado), pero son 11 preguntas sobre un dataset de seguros, hecho por dbt Labs (vendor con interés en el resultado). El argumento cualitativo (tipo de error, no el número) es el que sostiene la arquitectura — no el porcentaje en sí.
**Afecta:** `05-cerebro-ia.md` (sección 4.2).

### ✅ RESUELTO — I10. DuckDB single-writer + tres escritores concurrentes (CDC, `plan/apply`, Input Tables)
No hay ningún documento que resuelva el orden/serialización de escrituras cuando las tres cosas quieren escribir al mismo tiempo.
**Afecta:** `01-motor-almacenamiento.md`, `02-transformacion.md`, `03-ingesta.md`.

---

## MENOR — vale la pena, no urgente

**✅ Los 5 puntos de esta lista fueron corregidos:** "~20% Fortune 1000" marcado como claim del vendor (`04-semantico.md`); "coherencia de lenguaje" en Airflow reconocido como argumento secundario, no decisivo (`07-orquestacion.md`); justificación técnica agregada a la decisión de "nada de React" (`08-frontend.md`); madurez de 5 meses de DuckLake explicitada (`01-motor-almacenamiento.md`); anécdotas sin fuente (pg_duckdb, Iceberg, ECharts) reescritas como ilustrativas, no como benchmarks (`01-motor-almacenamiento.md`, `08-frontend.md`). Además se agregaron dos secciones nuevas al documento general que no estaban en la lista original de "menor" pero surgieron del mismo bloque de hallazgos: TCO real (sección 12) y migración desde Power BI (sección 13) — el segundo queda como trabajo pendiente explícito, no resuelto del todo, porque es un documento en sí mismo, no una corrección de una frase.

- **"~20% del Fortune 1000 usa Cube"**: cifra de marketing del vendor, sin fuente independiente — marcarla como claim, no como dato (`04-semantico.md`).
- **"Coherencia de lenguaje Python" como argumento para Airflow**: es relleno; el driver real es la regla de gobernanza — decirlo así, sin maquillaje (`07-orquestacion.md`).
- **"Nada de React" sin una sola línea de justificación** en tres documentos — aunque sea una decisión legítima del usuario, falta una nota breve de por qué (`08-frontend.md`, `00-documentacion-general.md`).
- **DuckLake tiene 5 meses de madurez en producción** al momento de escribir esto — la propia regla 6 ("madurez verificada") queda estirada y nadie lo señala (`01-motor-almacenamiento.md`).
- **Anécdotas de rendimiento sin fuente** ("8s→4s" de pg_duckdb, "medio segundo" de metadata Iceberg, "10 millones de puntos" de ECharts) — marcarlas como ilustrativas, no como benchmarks (varios documentos).
- **TCO real**: "cero costo de licenciamiento por usuario" es cierto y potencialmente engañoso sin una sección que compare el costo operativo real de mantener 11 piezas open source contra una licencia de Power BI (`00-documentacion-general.md`).
- **Migración desde Power BI subdesarrollada**: la traducción DAX→Cube ocupa menos espacio que el wrapper de ECharts — desproporcionado si migrar reportes existentes es el 80% del esfuerzo real (`00-documentacion-general.md` o un documento nuevo).

---

## Huecos de alcance (ambos revisores coinciden en buena parte)

No son errores del diseño existente — son capacidades de los líderes de BI que **hoy no están cubiertas por ninguna de las 11 capas**:

1. Catálogo de metadata + lineage navegable en UI (la certificación de la capa 9 es una insignia, no un catálogo).
2. Observabilidad/admin plane (freshness, uso, costo, quién mira qué).
3. Authoring environment real (drag/drop, layouts, formatting, bookmarks) — construir gráficos no es construir Power BI.
4. Embedding / analítica customer-facing (Cube es fuerte acá y no se explota).
5. "Analyze in Excel" / XMLA — cerrado en la práctica por el hallazgo C3.
6. Alertas por umbral definido por el usuario (no solo detección estadística de anomalías).
7. Suscripciones a reportes / exportación programada (PDF, snapshots).
8. Multitenancia real (aislamiento de datos entre organizaciones sobre un mismo warehouse).
9. Reportes paginados/operacionales, mobile nativo, self-service de conexión de fuentes SaaS para usuarios no técnicos (dlt exige saber Python).

---

## Dónde los revisores se equivocan o son injustos

- **"Nunca se pone en duda la regla de gobernanza"**: parcialmente falso — con dlt y Cube se aceptó el riesgo residual explícitamente por falta de alternativa. La crítica válida es que eso pasó solo 2 veces sobre 11 capas, no que nunca pasó.
- **DuckDB como *serving* multiusuario "no se examinó"**: se dejó anotado (ClickHouse "cuando haga falta") — la crítica justa es que debió ser una decisión explícita desde el día uno, no que esté ausente.
- **"Terraform mal por ser comprada, Vercel/Databricks bien por comprar"**: la variable real nunca fue "fue comprada" sino "¿cambió la licencia a algo cerrado?" — Terraform sí, better-auth/Electric no. Vale aclarar el criterio en el documento para que no se lea como doble estándar, pero la decisión de fondo no cambia.

---

## Próximo paso

**Cerrado.** Los 4 críticos, los 10 importantes y los 5 menores fueron corregidos en los documentos correspondientes — el detalle de cada corrección queda en el propio documento de capa afectado, con la marca "corrección de una revisión externa" para que quede trazable de dónde vino cada cambio.

**Lo que esta auditoría NO resuelve, y sigue abierto a propósito:** la sección "Huecos de alcance" de este documento (catálogo de metadata, authoring environment real, embedding, XMLA, alertas por umbral, suscripciones, multitenancia, reportes paginados, mobile) no son errores del diseño actual — son capacidades que directamente no existen todavía en ninguna de las 11 capas. Corregir un error de diseño y construir una capacidad nueva son trabajos de tamaño distinto; esta ronda resolvió lo primero. Lo segundo queda como el trabajo que sigue, fuera del alcance de una corrección de documentación.
