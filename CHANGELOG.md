# Changelog

Versionado del producto según [`docs/21-engineering-standards.md`](docs/21-engineering-standards.md)
§2: SemVer `0.MINOR.PATCH` hasta 1.0; los contratos (API, Report Schema, Config Schema, DB
Migration…) versionan por separado y se listan en cada release.

## Unreleased

### Plan C — los verbos de los trabajos (sale en `0.8.0`, con el Paso 8)

Todo lo que corre y termina se llama igual desde Airflow, desde CI y, más adelante, desde los estudios: un verbo de la plataforma, un código de salida y un resumen JSON versionado. Ninguno expone la herramienta de abajo.

#### Agregado

- **`pnpm transform run | deploy | test | check [--json]`** (`TransformJobSummary` 1.0):
  - `run`: los intervalos pendientes, la operación diaria;
  - `deploy`: los modelos del repositorio pasan a ser los que corren, en CI/CD;
  - `test`: los unit tests, sin lakehouse;
  - `check`: las reglas del proyecto y las auditorías.

  Un runner en Python usa la API de SQLMesh, no su CLI, y el resumen dice qué modelos evaluó, cuánto tardó cada uno y qué auditorías pasaron o fallaron. La salida de la herramienta va a stderr.

- **`pnpm semantic refresh [--json]`** (`SemanticRefreshSummary` 1.0): reconstruye las pre-agregaciones de Cube y espera a que terminen, con un token que solo puede lanzar trabajos. Un token de consulta no puede lanzar un trabajo, y uno de trabajo no puede leer datos ni metadata, por REST ni por SQL.
- **`pnpm lakehouse maintain [--dry-run] [--orphan-grace-hours=N] [--json]`** (`LakehouseMaintenanceSummary` 1.0): la retención del lakehouse (`docs/01` §6.8).
  - Expira versiones, borra los archivos que solo ellas usaban y los huérfanos pasado su margen, y compacta.
  - `--dry-run` no cambia nada y dice exactamente lo mismo que la corrida real.
  - Los archivos que se liberan hoy se borran en la corrida siguiente, y la salida lo dice.
  - El margen de los huérfanos nunca baja de 1 hora: lo rechazan el comando (64), la configuración (78) y el puerto.
  - Fuera de desarrollo, una corrida real pide `--confirm=atlasbi`, como `pnpm reset:local`.
- **Un sobre común para todos los resúmenes** (`status`, `exitCode`, `retryable`, `startedAt`, `finishedAt`, `error`) y los mismos códigos de salida: 0, 64, 65, 70, **75 reintentable**, 77 y 78 (`docs/07` §7.1).

#### Cambiado

- **`pnpm transform <comando>` pasa a ser `pnpm transform <verbo>`.** `pnpm transform plan` ya no existe: para desplegar, `pnpm transform deploy`. Cualquier otro comando de SQLMesh queda en `pnpm transform tool <argumentos>`, solo para desarrollo, fuera del contrato y con un aviso: nunca en Airflow ni en CI.
- **Ningún identificador que exporta `@atlasbi/transform` nombra a SQLMesh,** y la salida de los verbos tampoco. El confinamiento completo de SQLMesh y de Cube, con su test, va en una tanda aparte (decisión C6).
- **`pnpm reset:local` y `pnpm lakehouse maintain` comparten la confirmación** por texto.
- **El mensaje de `audit_failed` dice lo que pasa de verdad:** lo que escribió la corrida queda visible hasta la siguiente.

#### Medido

- **En `run`, una auditoría que falla no deshace lo escrito.** SQLMesh escribe primero y audita después: con un evento repetido en el landing, `run` salió con 65 y el mart ya tenía 597 filas en vez de 596. Por eso un 65 de `transform` tiene que alertar (`docs/07` §7.1). Si una auditoría debe bloquear antes de publicar, se mide en la Fase 0 del Paso 8.
- **Un barrido de huérfanos sin margen corrompe una tabla** si hay un escritor en curso: borra los archivos que todavía no confirmó, y la tabla queda apuntando a archivos que no existen. Queda como test de regresión.
- **La compactación de DuckLake no tiene simulación,** así que la plataforma la cuenta con las reglas que sigue DuckLake, medidas: por esquema de cada tabla, y sin archivos con filas borradas. La primera comparación en vivo dio 3 tablas en la simulación y 2 en la corrida real; con las reglas corregidas, la batería exige igualdad exacta con los dos catálogos.
- **`SELECT count(*)` sobre `ducklake_expire_snapshots` no expira nada:** el mantenimiento lee siempre las filas.
- **`pnpm --reporter=silent … --json`** deja en stdout una sola línea de JSON: probado en vivo con `transform run` y `transform deploy`, con los códigos 0, 65 y 75.

#### Verificado en vivo, sobre el lakehouse de desarrollo

- El mantenimiento real expiró 24 versiones y compactó 2 tablas. Los datos quedaron idénticos: los 596 eventos de GitHub y las 20.000 filas de ventas, con el mismo hash. Los reportes de la web dan las mismas cifras.
- `pnpm semantic refresh` reconstruyó `amount_by_region_month` y salió con 0.

#### Contratos

- **Config Schema v8 → v9:** `ATLASBI_LAKEHOUSE_SNAPSHOT_RETENTION_DAYS` (7), `ATLASBI_LAKEHOUSE_CLEANUP_GRACE_MINUTES` (60) y `ATLASBI_LAKEHOUSE_ORPHAN_GRACE_HOURS` (24, nunca menos de 1). Un `.env` anterior sigue funcionando.
- **`LakehouseAdminPort` 1.1 → 1.2:** `maintain(policy, { dryRun })`.
- **Nuevos:** `TransformJobSummary` 1.0, `SemanticRefreshSummary` 1.0 y `LakehouseMaintenanceSummary` 1.0, sobre el sobre común. `IngestSummary` 1.0 no cambia.
- **Sin migraciones de base.** El BFF y la API pública no cambian.
- **Al actualizar:** la primera vez que arranque `pnpm dev`, Cube se recrea una vez, porque cambió su configuración de seguridad; hasta entonces, `pnpm semantic refresh` sale con 77.

## 0.7.0 — la primera fuente externa real, con ingesta (2026-10-08)

Paso 7 del orden de construcción: la primera fuente real, GitHub, entra por la ingesta y llega hasta un reporte.

- `pnpm ingest github` trae, de forma incremental, los eventos de los repositorios configurados a un landing en el lakehouse.
- SQLMesh los transforma en un mart, y Cube los sirve con seguridad por filas por repositorio.
- El reporte "Actividad en GitHub" muestra a Ana y a Bruno repositorios distintos.
- La herramienta de ingesta queda encerrada en su paquete: fuera de él y de la documentación, nada la nombra salvo dos guardas, y un test lo verifica.

### Agregado — la ingesta (`packages/ingestion`, dlt 1.30.0)

- **`pnpm ingest <source> [--json]`, el primer verbo de trabajo:** carga GitHub (los eventos de los repositorios de `ATLASBI_GITHUB_REPOSITORIES`) en el landing `landing_github.repo_events` del lakehouse, de forma incremental.
  - Cada resultado termina en un resumen y un código de salida: 0 bien, 64 uso, 65 datos (un tipo que cambió), 70 interno, **75 reintentable**, 77 credenciales rechazadas, 78 configuración. Con `--json`, el resumen va a stdout y nada más; el progreso, a stderr. Es el contrato que va a leer Airflow en el Paso 8 (`docs/07` §7.1).
  - Para que stdout lleve solo el JSON, hay que llamarlo con `pnpm --reporter=silent ingest …`: `pnpm -s` igual escribe ahí la línea `[ELIFECYCLE]` de pnpm.
- **El paquete:**
  - un runner en Python, con su propio entorno de uv;
  - la _verified source_ de GitHub copiada y fijada a un commit (`runner/vendor/github/PROVENANCE.md`);
  - el adaptador TypeScript que lo corre.
- **Cómo corre la ingesta:**
  - Abre el lakehouse a la manera de la plataforma antes de empezar, y nunca lo crea.
  - Recibe los secretos solo por su entorno de proceso. La contraseña del catálogo va en `PGPASSWORD`, nunca en la URL.
  - No deja nada en el home del usuario: el runner le da a dlt un home propio dentro de `.data/ingestion`.
  - Un pipeline por repositorio, `append` para eventos, y los tipos congelados: un cambio de tipo en la fuente rechaza la carga (código 65).
- **El landing es una vista,** no una copia: las columnas del contrato, solo cargas completas, cada evento una vez. `pnpm bootstrap` la publica vacía y tipada, para que `pnpm transform plan` funcione antes de la primera ingesta.
- **La herramienta queda encerrada (decisión D2).** Fuera del paquete y de la documentación, nada nombra a dlt salvo las dos guardas que lo frenan: el contrato de datos y la regla de lint de SQLMesh. Un test recorre el repositorio y falla ante cualquier otra mención.
- **Las advertencias de dlt**, que nombraban cada columna vacía de una carga, quedan en ERROR; vuelven con `ATLASBI_INGEST_DEBUG=1`.

### Agregado — GitHub de punta a punta

- **Contratos de datos:** `landing.github_repo_events` 1.0 (lo produce la ingesta y lo verifica con datos) y `mart.github_repo_events` 1.0.
- **Transformación:** el landing declarado como modelo externo, `staging.stg_github_repo_events` (vista) y `marts.mart_github_repo_events`.
  - El mart es `FULL`, porque los eventos llegan horas tarde. El umbral para revisarlo está medido en `docs/versions.md`: 5 millones de filas, 30 s por reconstrucción o 100 MiB escritos por corrida.
- **Capa semántica:** el cube `github_events` (eventos, contribuidores, pushes), protegido por `repository`.
  - **Decisión D1: una dimensión protegida por cube,** porque Cube combina las políticas de grupos distintos con OR (`docs/09` §6.1). Un test rechaza un cube protegido por dos dimensiones, o sin política.
  - Un test combinado verifica que el "todos" de una dimensión nunca levanta el filtro de la otra.
- **`pnpm seed`:**
  - permisos por repositorio, tomados de `ATLASBI_GITHUB_REPOSITORIES`: Ana tiene todos en Comercial y el primero en Finanzas, y Bruno, el segundo;
  - el reporte "Actividad en GitHub" en cada workspace demo: dos KPIs, barras por tipo y por repositorio, y una línea diaria.
- **`@atlasbi/warehouse/testing`:** `writeContractView` escribe una tabla tal como la describe un contrato, para los tests de quien la consume.

### Agregado — operación

- **`pnpm bootstrap`** prepara el entorno de la ingesta (`uv sync`) y publica el landing de cada fuente; **`pnpm preflight`** verifica el entorno.
- **Cube se recrea solo cuando cambió su modelo (decisión D3).** Cube compila el modelo una vez al arrancar, y `compose up` no reinicia un contenedor que ya corre. Ahora la CLI le pasa a compose un resumen del contenido de `packages/semantic/cube`: con un cambio, Cube se recrea; sin cambios, el contenedor y sus consultas siguen.

### Cambiado

- **Vite 8.3.2 → 8.3.3**, en cuanto pasó la edad mínima de publicación. Es un parche de una dependencia (`launch-editor`); el Paso 6 había salido con la 8.3.2 por esa espera.
- **La protección por filas acepta más de una dimensión** (`PROTECTED_DIMENSIONS = ['region', 'repository']`), siempre una por cube.

### Verificado en vivo

- **Sobre la base y el lakehouse de desarrollo, con `duckdb/duckdb` y `sveltejs/svelte`:**
  - la primera ingesta cargó 595 eventos; la segunda, solo el nuevo; la tercera, nada;
  - ningún secreto en el resumen, en la salida ni en los archivos de trabajo, y `~/.dlt` sigue sin existir.
- **Cada falla con su código:**
  - token falso → 77;
  - clave S3 equivocada → 77;
  - contraseña del catálogo equivocada → 77;
  - API inalcanzable → 75, reintentable.
- **El landing y el mart cumplen sus contratos con los datos reales.**
- **En un navegador real,** "Actividad en GitHub" muestra:
  - a Ana en Comercial, 596 eventos de los dos repositorios;
  - a Ana en Finanzas, solo `duckdb/duckdb`;
  - a Bruno, solo `sveltejs/svelte`.

  El cross-filter por tipo de evento funciona, y "Ventas" no cambió.

- **D3:** con el modelo igual, `pnpm dev` dejó el mismo contenedor de Cube; con un cambio, lo recreó.

### Medido

- **La Fase 0 de dlt** (detalle en `docs/03` §6.2–6.4):
  - el destino `ducklake` sobre el lakehouse de la plataforma;
  - la contraseña filtrada en la traza si viaja en la URL;
  - el `~/.dlt` que escribe aun con la telemetría apagada;
  - el cursor incremental por pipeline;
  - las cargas parciales visibles;
  - el costo de `merge`.
- **La reconstrucción del mart FULL** sobre catálogo PostgreSQL y Garage: 0,3 s con 100 mil eventos, 1,0 s con un millón y 4,0 s con 5 millones. Cada corrida reescribe el mart entero, unos 13,5 MiB por millón de eventos (`docs/versions.md`).

### Contratos

- **Config Schema v7 → v8:** `ATLASBI_INGESTION_DATA_PATH`, `ATLASBI_GITHUB_REPOSITORIES` y `ATLASBI_GITHUB_API_URL`, con valores por defecto, y el secreto `github.token` (`ATLASBI_GITHUB_TOKEN`). Un `.env` anterior sigue funcionando; sin repositorios, solo `pnpm ingest github` se niega a correr.
- **Nuevos:** el trabajo de ingesta 1.0 (`IngestSummary`, `parseIngestSummary`, `@atlasbi/contracts`), y los contratos de datos `landing.github_repo_events` 1.0 y `mart.github_repo_events` 1.0.
- **Sin migraciones de base.** El BFF y la API pública no cambian.

### Licencias

- Del árbol de dlt (40 paquetes), ninguno GPL ni AGPL. `certifi` y `orjson` (MPL-2.0) se aceptaron caso por caso, y quedan anotadas para la auditoría de licencias (`docs/IMPLEMENTATION.md`).

## 0.6.0 — frontend mínimo, modo Viewer (2026-10-07)

Paso 6 del orden de construcción: el frontend, en modo Viewer.

- Ana inicia sesión en un navegador, navega sus workspaces por la sidebar, abre el reporte demo y filtra con un click: los demás visuales cambian, y el que filtró resalta lo elegido.
- Bruno ve números distintos en el mismo reporte de Finanzas.
- Todo corre también en contenedores (`pnpm stack:up`), detrás de un único origen.
- El reporte se guarda en el Report Document Model, y nunca guarda la configuración de un renderer.

La versión incluye también la primera tanda de la auditoría de aislamiento entre capas (2026-10-04), al final.

### Agregado — el Report Document Model (migración `000004`, `@atlasbi/reports`)

- **El contrato, en `@atlasbi/contracts`:**
  - `ReportDocument`: reporte, páginas y visuales; `schemaVersion` 1.
  - `VisualSpec` v1: `kind` (`kpi`, `bar` o `line`), medidas, dimensiones y `encoding`.
  - **`parseVisualSpec` rechaza en todos los niveles cualquier campo fuera de la gramática.** Ninguna opción de ECharts ni de otro renderer entra en un reporte; lo prueban tests en el contrato, en la base y en la web.
- **El esquema `reporting`**, con `report`, `page` y `visual`:
  - Las claves hacia personas apuntan a `identity.principal`, nunca a `auth.*`; las de workspace, a `access.workspace`.
  - **Borrar a una persona que creó un reporte queda bloqueado:** primero hay que reasignar sus reportes.
  - `visual_spec` y `position` tienen un CHECK de forma.
  - Desvíos del esquema de `docs/19` §8: sin `visual.type`, con `page.ordinal`, y sin `formatting_spec` ni `filter_definition` hasta que tengan un consumidor.
- **`@atlasbi/reports`, un paquete nuevo:** el repositorio (Kysely) que lista, lee y crea reportes; la creación es una sola transacción. Las filas nunca salen del paquete; lo que sale es el documento (`docs/21` §9).
- **La API:** `report.list` y `report.get` en el BFF, de solo lectura, para cualquier miembro del workspace. Un reporte de otro workspace responde `NOT_FOUND`.
- **`pnpm seed`** crea el reporte "Ventas" en cada workspace demo: dos KPIs, barras por región y línea por mes.

### Agregado — `apps/web` (SvelteKit 2.70.3, Svelte 5.57.1, ECharts 6.1.0)

- **Una SPA, sin renderizado en servidor.** El token de identidad vive solo en memoria y se renueva al 80 % de su vida, y una vez más ante un 401. Si algún día hace falta SSR, esa decisión se revisa primero.
- **El cliente tRPC usa `httpLink`, una petición por llamada,** para que cada visual pueda cancelar la suya.
- **El adaptador de ECharts** es el único código que importa ECharts (regla de ESLint) y lo importa por partes: 202 kB gzip contra 392 kB.
- **El primer corte del Interaction Engine** (`docs/14` §1.3.1):
  - `ReportFilter` sobre el Filter AST del puerto semántico.
  - `InteractionState`, con un filtro por miembro y sin aplicarle a cada visual sus propios filtros.
  - `QueryCoordinator`, con espera de 150 ms y cancelación por visual. Todavía sin caché.
- **Navegación por sidebar:** la de shadcn-svelte, colapsable a íconos, con un árbol propio de workspaces y reportes. Rutas `/login`, `/workspaces/[workspace]` y `/workspaces/[workspace]/reports/[report]`.
- **Política de contenido:** la página declara su CSP con el hash del script de arranque. Los estilos inline quedan permitidos, como residual documentado en `docs/08` §9.
- **Componentes base de shadcn-svelte copiados al repositorio,** con `@lucide/svelte` 1.52.0 para los íconos. ESLint y Prettier cubren también los archivos `.svelte`.

### Agregado — imágenes y proxy (`pnpm stack:up`)

- **Imágenes propias** en `infra/images/`: el gateway y la web. El contexto de build es una lista de inclusión, sin `.env`, `.data` ni tests.
  - **La del gateway no trae TypeScript, Vite ni Vitest.** El build falla si alguno aparece, y `pnpm test:image` lo comprueba.
  - **Para eso, `.pnpmfile.mjs` quita cuatro _peers_ que la plataforma no usa en tiempo de ejecución:** `vitest`, `svelte` y `@sveltejs/kit` de `better-auth`, y `typescript` de `@trpc/server`. Se revisa al actualizar esas dos dependencias.
  - **No usa `pnpm deploy`,** porque Node no ejecuta archivos `.ts` que estén bajo `node_modules`. Los paquetes quedan enlazados como en desarrollo.
- **Caddy 2.11.7, el proxy del origen único,** elegido con la regla 7 frente a nginx y Traefik (`docs/11` §4.4.1). Sirve la app y reenvía `/api` y `/auth`. Los _probes_ del gateway no se exponen.
- **Una red interna `edge` con subred fija.** El proxy tiene una dirección fija, y es el único cuyo `X-Forwarded-For` acepta el gateway.
- **La URL de la base del gateway en contenedor** la arma el CLI con cada parte codificada, así que cualquier contraseña funciona.
- **`pnpm stack:up`** construye las imágenes desde el checkout y levanta todo. El paso `API Gateway` pregunta `/ready` dentro del contenedor; el paso `Web`, a través del proxy.

### Agregado — `pnpm dev`

- **El paso `Web`:** el servidor de Vite con _hot reload_, en `127.0.0.1:3000`, como origen único también en desarrollo. Su salida sigue al resumen, etiquetada `web │`.
- **`pnpm preflight` revisa el puerto 3000.** El puerto de un proceso local tiene que estar libre aunque lo ocupe un contenedor del propio stack.

### Cambiado — la Gateway

- **Escucha en `ATLASBI_GATEWAY_HOST`:** `127.0.0.1` por defecto, `0.0.0.0` dentro de su contenedor.
- **`trustProxy` nombra solo las IP de `ATLASBI_TRUSTED_PROXIES`.** Vacía, no confía en nadie.

### Auditoría de aislamiento entre capas (2026-10-04)

Reemplazar una herramienta no debería tocar a sus vecinos.

- **Las baterías de contrato pasan a su propio paquete, `@atlasbi/contracts-testing`.**
  `@atlasbi/contracts` ya no declara `vitest` como dependencia, así que un despliegue de producción
  no arrastra el toolchain de test. Todos los paquetes la usan solo como dependencia de desarrollo.
- **`createSemanticRuntime({ config, secrets })`**, la fábrica pública de `@atlasbi/semantic`.
  Decide el motor y si hay capa semántica en el despliegue. La Gateway ya no nombra a Cube ni
  conoce la regla de niveles, y `createCubeSemanticRuntime` deja de exportarse.
- **`config.semantic.enabled`:** la regla "la capa semántica corre solo en el nivel equipo
  local" vive ahora en un solo lugar (`semanticLayerRuns`). La usan también `semanticSecretKeys`.

- **Baterías de contrato de identidad** en `@atlasbi/contracts-testing`:
  - `describeIdentityPortContract`: usuarios, organizaciones, inicio de sesión, el token de
    identidad (solo `sub` y `org`, como mucho 15 minutos, rechazo de uno adulterado, sin firma o
    de otro despliegue) y el cierre de sesión.
  - `describeIdentityHttpContract`: las tres operaciones, las respuestas limpias, el `Origin` y los
    atributos de la _cookie_.
- **El adaptador de better-auth corre las dos baterías.** Sus tests propios quedan solo para lo
  que es suyo: EdDSA, emisor y audiencia, el nombre de la _cookie_ y el token que sigue válido
  después de cerrar la sesión.
- **Contratos de datos** (`docs/21` §2.4): archivos JSON propios y versionados en
  `packages/contracts/data/`, con los tipos de la plataforma (`LogicalType`), nunca los de un motor.
  - `parseDataContract` rechaza las columnas propias de una herramienta (`_dlt_*`) y exige
    `_load_id` y `_loaded_at` en un contrato de landing.
  - Los productores verifican con los datos lo que publican, con `findDataContractViolations`: el
    dataset de desarrollo en `warehouse` y el mart en `transform`.
  - `semantic` corre sus tests sobre un mart generado desde el contrato, y su modelo de Cube solo
    puede leer tablas de contratos que declara.
  - `external_models.yaml` de SQLMesh tiene que coincidir con el contrato de la fuente.

- **Regla de lint `NoIngestionInternals`** (SQLMesh): un modelo no puede leer columnas ni tablas
  de la herramienta de ingesta (`_dlt_*`) ni su esquema interno (`ingestion_*`), solo el contrato
  de landing. Recorre el árbol sintáctico, no el texto.

- **Identidad propia de la plataforma** (`docs/09` §6.4, migración `000003`):
  - `identity.organization`, `identity.principal` e `identity.provider_subject`. Las claves
    foráneas de `access` apuntan ahí, nunca a las tablas de better-auth.
  - El adaptador escribe esas filas justo después de cada alta en el proveedor, y si falla,
    deshace el alta. Si algún día se habilita el registro público, esta decisión tiene que
    revisarse.
  - `IdentityPort.reconcile`: `pnpm dev` detecta el desfase (paso `Identity`) y
    `pnpm identity:reconcile` agrega lo que falta, sin borrar nunca nada.
  - La batería de contrato de identidad cubre la sincronización.
  - La migración se probó sobre el escenario de `pnpm seed`: sin datos huérfanos, con las
    claves foráneas apuntando a `identity.*`.

### Verificado en vivo

- **En un navegador real** (Edge sin interfaz, controlado por el protocolo DevTools), sobre `pnpm dev` y sobre `pnpm stack:up`:
  - Ana inicia sesión y llega a Comercial; la sidebar lista los dos workspaces con "Ventas".
  - El click en East deja los KPIs en 1.049.744 y 4.000, y al quitar el filtro vuelven a 5.243.402 y 20.000.
  - El token no aparece en `localStorage` ni en `sessionStorage`, y no hay violaciones de CSP.
- **El corte de tipos de punta a punta:** renombrar `report.get` en el gateway rompe el _typecheck_ de la web en la página del reporte.
- **`trustProxy`, con un `X-Forwarded-For` falsificado y distinto en cada intento:**
  - A través del proxy, el límite por IP corta con la IP real.
  - Otro cliente real a través del proxy tiene su propio cupo.
  - Un contenedor que va directo al gateway, sin pasar por el proxy, recibe 429 después de 10 intentos.
- **La migración `000004` en la base de desarrollo** solo creó un esquema, tablas e índices: las filas existentes quedaron iguales.

### Contratos

- **Config Schema v6 → v7:** `ATLASBI_GATEWAY_HOST`, `ATLASBI_TRUSTED_PROXIES` y `ATLASBI_WEB_PORT`, con valores por defecto.
  - **`ATLASBI_PUBLIC_URL` pasa a valer por defecto el origen de la web, `http://127.0.0.1:3000`.** Un `.env` copiado del de `0.5.0`, con `http://127.0.0.1:4100`, tiene que cambiarse: si no, el gateway rechaza el inicio de sesión desde la web (README).
- **Nuevos:** Report Document `schemaVersion` 1 y `VisualSpec` v1.
- **DB Migration:** `000003` (el esquema `identity`) y `000004` (el esquema `reporting`).
- **El BFF suma `report.list` y `report.get`.** Sigue siendo interno: la API pública no cambia y `/api/v1` sigue reservado.
- **Contratos de datos nuevos:** `mart.sales_orders` 1.0 y `source.development_sales_orders` 1.0.
- **`IdentityPort` 1.0 → 1.1:** agrega `reconcile`. Sus consumidores no cambian; cada adaptador
  tiene que implementarlo.

### Corrección

- **`docs/08` §11.2 decía "sin riesgo de gobernanza".** Bits UI sigue siendo una dependencia viva con un solo mantenedor que publica; el riesgo está evaluado con la regla 7.
- **`docs/06` anunciaba `httpBatchLink`** para el frontend: es `httpLink`, medido en la Fase 0.
- **`docs/19` §10 dejaba el proxy sin decidir:** es Caddy.
- **`docs/13`, paso 7:** el frontend real lee el reporte guardado y usa el adaptador de ECharts. Las rutas dicen "reporte", no "dashboard".

## 0.5.0 — API Gateway (2026-10-05)

Paso 5 del orden de construcción: la API Gateway. El navegador tiene un único punto de entrada:
inicia sesión, obtiene un token de identidad y consulta métricas. El gateway verifica la identidad
en cada llamada, resuelve el contexto de seguridad por workspace y le pide los datos a la capa
semántica por un puerto propio, sin conocer el motor. Dos personas con el mismo rol en el mismo
workspace ven datos distintos, verificado por HTTP de punta a punta.

### Agregado — puerto semántico (`SemanticRuntimePort` 1.0)

- **El contrato, en `@atlasbi/contracts`:**
  - `SemanticQuery` v1: medidas, dimensiones, dimensiones de tiempo con granularidad y rango,
    los 12 operadores del Filter AST (`docs/14` §1.1), orden y un límite de 1 a 10.000 filas.
  - `SemanticResult`: columnas y filas posicionales, con todo número como el string exacto del
    motor, más `rowCount` y `truncated`.
  - `SemanticModel` (lo que un contexto puede consultar) y capacidades por nombre, nunca por
    motor (`docs/21` §3.4).
  - `SemanticRuntimeError`, con cuatro códigos cerrados y `retryable`. Un miembro inexistente y
    uno que el contexto no puede usar fallan igual: sin oráculo.
- **El adaptador de Cube, `createCubeSemanticRuntime`, en `@atlasbi/semantic`.**
  - Por consulta: metadata visible para ese contexto, validación y recién después los datos,
    con `limit + 1` filas.
  - Devuelve solo datos: Cube repite la consulta efectiva con los filtros de RLS y sus valores.
  - Nunca pide `meta?extended=true`, que expone el SQL del modelo (`docs/04` §6.6).
- **Batería de contrato** `describeSemanticRuntimePortContract`, independiente de los datos.
  El adaptador de Cube la pasa contra un stack propio.

### Agregado — `@atlasbi/api-gateway` (Fastify 5.12.5 + tRPC 11.19.0)

- **Procedimientos:** `session.me`, `semantic.meta` y `semantic.query` (`docs/06` §7).
  - Identidad en cada llamada, con `Authorization: Bearer` y verificación local.
  - Contexto de seguridad por workspace y por llamada, sin caché.
  - El mismo `FORBIDDEN` para toda denegación.
  - El frontend importa el tipo `AppRouter` (Paso 6).
- **Identidad por HTTP: tres rutas y nada más** (`docs/06` §6.4). Las demás rutas de
  better-auth, que permiten crear organizaciones o listar sesiones con sus _tokens_, no son
  alcanzables.
  - `Origin` obligatorio en los POST.
  - El limitador de better-auth se apaga y el gateway limita el inicio de sesión: 10 intentos
    por minuto por IP y 5 fallos cada 15 minutos por cuenta (`docs/06` §6.3).
- **Endurecimiento** (`docs/06` §6.5):
  - tRPC: sin _stack_ ni mensaje interno, _batch_ de hasta 10, solo POST y cuerpo de hasta 1 MB.
  - 404 y 500 neutros, CSP `default-src 'none'`, `no-store` y sin CORS.
  - Escucha solo en `127.0.0.1`.
- **Trazas OpenTelemetry** de Fastify, `pg` y las llamadas a Cube:
  - sin _query string_, sin valores de SQL y sin cabeceras;
  - el `traceparent` del cliente se ignora.
- **`/health` y `/ready`.** `/ready` depende solo de la base de la plataforma.
- **`@atlasbi/auth`:** `IdentityHttpHandler` sobre better-auth (`createBetterAuthHttp`), y en el
  directorio de acceso, `listMemberships` y `ping`.

### Agregado — `pnpm dev`

- **Arranca la API Gateway** con `node --watch`, después de la infraestructura.
  - El paso `API Gateway` de la cadena espera `/ready`.
  - Si el gateway no arranca, el paso falla enseguida con la línea del error.
- **Queda en primer plano** con la salida del gateway.
  - Ctrl+C lo detiene, junto con el proceso que corre `node --watch`.
  - La infraestructura sigue corriendo.
- **`pnpm preflight` revisa el puerto 4100.**
- **La sonda de Cube usa `ATLASBI_SEMANTIC_URL`**, la misma dirección que el gateway.
- `pnpm stack:up` no cambia: la imagen del gateway llega en el Paso 6.

### Medido

- **`/v1/cubesql` autentica con `checkAuth`, no con `checkSqlAuth`.** La hipótesis anterior de
  `docs/17` §3.2.3 era incorrecta (`docs/17` §3.2.4).
- **Costo por request por HTTP** (`docs/06` §6.6):
  - `session.me`: 2,7 ms de p50.
  - `semantic.query`: 24 ms de p50 cuando la responde la caché de Cube, 66 ms si no.
  - Sin caché de metadata: ahorraría 2–3 ms y arriesgaría servir permisos viejos.
- **Dos huecos nuevos de Cube** (`docs/17` §3.2.2):
  - Las medidas derivadas que responde Cube Store se truncan a 6 decimales.
  - Un `OR` con una constante siempre verdadera termina en _panic_, igual en 1.7.45 y en 1.7.50.
    Es `cube-js/cube#7880`, que evolucionó.
- **better-auth apaga su chequeo de `Origin` con `NODE_ENV=test`.** Ahora queda encendido de
  forma explícita.

### Contratos

- **Config Schema v5 → v6:** `ATLASBI_GATEWAY_PORT`, `ATLASBI_PUBLIC_URL` y
  `ATLASBI_SEMANTIC_URL`, con valores por defecto. Un `.env` existente sigue funcionando.
- **Contratos nuevos:**
  - `SemanticRuntimePort` 1.0, con `SemanticQuery` v1 y `SemanticResult`.
  - `IdentityHttpHandler` 1.0 (`IDENTITY_HTTP_VERSION`), con las operaciones `sign-in`,
    `sign-out` y `token`.
- **Sin cambios:** `IdentityPort` 1.0, `SecurityContext` 1.0, el token de consulta hacia Cube y
  las migraciones (`000002`).
- **La API pública** sigue sin procedimientos: `/api/v1` queda reservado. El BFF de tRPC es
  interno y no se versiona como API pública.

### Corrección

- **`docs/17` §8** todavía nombraba `semantic.sql-password`, retirado en `0.4.0`.
- **`docs/13`, paso 4:**
  - El adaptador de Cube vive en `@atlasbi/semantic`, no en la Gateway.
  - El procedimiento es `semantic.query`.
  - Los tipos generados desde `/meta` no se adoptaron: la validación es en tiempo de ejecución,
    contra lo que cada contexto puede ver.
- **`docs/06` §1.1:** better-auth no se monta como plugin.

## 0.4.0 — identidad y autorización (2026-09-27)

Paso 4 del orden de construcción: identidad y autorización. Con él, dos usuarios ven recortes
distintos de la misma métrica. La cadena es la misma que la API Gateway va a recorrer en cada
request en el Paso 5, y ya está verificada de punta a punta (`docs/16`: el RLS del MVP).

### Agregado — identidad (better-auth 1.7.6)

- **`@atlasbi/auth`**, con el puerto propio `IdentityPort` (`@atlasbi/contracts`): ningún tipo
  de better-auth sale de su adaptador, y ESLint impide importarlo fuera de él.
  - Usuarios con email y contraseña (12 a 128 caracteres).
  - **Sin registro público:** los usuarios los crea una acción de administración (decisión D5).
  - Organización con el plugin `organization`, sin _teams_ ni invitaciones.
  - Sesiones.
- **Token de identidad verificable localmente.**
  - Lleva **solo** `sub` (el usuario) y `org` (la organización), más `iss`, `aud`, `iat` y `exp`.
    Nunca un rol ni un permiso sobre datos (`docs/09` §7); cualquier _claim_ extra lo invalida.
  - EdDSA, 15 minutos de vida, con las claves en la base y la privada cifrada con
    `auth.secret`.
  - Sin `definePayload`, better-auth metería el usuario entero en el token: un test lo impide.
- **Superficie mínima.**
  - Solo los plugins `organization` y `jwt`. El plugin `admin` queda afuera: con solo activarlo
    expondría por HTTP unos 20 endpoints `/admin/*` (medido).
  - Telemetría apagada: ninguna llamada de red, medido en los tests.

### Agregado — autorización propia

- **`resolveSecurityContext`:** resuelve por separado el rol (qué puede hacer) y los permisos
  sobre datos (qué puede ver), y los combina en `SecurityContext` v1.
  - Deniega un workspace inexistente, uno de otra organización (aunque haya una fila de
    membresía ahí) y a quien no es miembro.
  - Deniega por defecto: una dimensión protegida sin concesión no se ve. "Todos los valores" es
    una concesión explícita.

### Agregado — RLS en Cube

- **Políticas de acceso en el modelo** (`sales_orders` y `regions`) con los grupos
  `region:listed` y `region:all`.
  - Los grupos se arman en un solo lugar, `toQueryClaims` (`@atlasbi/semantic`), a partir del
    contexto de seguridad; el rol no viaja.
  - Con una segunda dimensión protegida el código falla a propósito, por la advertencia de
    `docs/09` §6.1 sobre el OR entre grupos.
- **Token corto hacia Cube:** HS256, emisor `platform-api`, audiencia `semantic-layer`, vida de
  5 minutos como máximo.
  - Por REST, Cube lo verifica fijado a ese algoritmo, emisor y audiencia.
  - **El SQL API ya no tiene contraseña fija:** acepta el mismo token como contraseña y aplica la
    misma RLS (decisión E5).
- **Control de vencimiento en cada consulta.** Una conexión del SQL API no sobrevive a su token
  (medido: token de 6 s, conexión de 9 s), y un token sin `exp` se rechaza también por REST.
- **La sonda de `pnpm dev`** usa el grupo `readiness`, que solo ve `regions.zone`.

### Agregado — base de datos, seed y CLI

- **Las primeras migraciones reales.**
  - `000001_auth_schema.sql`: las tablas de better-auth en el esquema `auth`, generadas por su
    planificador para las opciones de la plataforma. Un test de contrato detecta cualquier cambio
    al actualizar.
  - `000002_access_control.sql`: `access.workspace`, `access.workspace_membership` y
    `access.data_entitlements`, con restricciones en la base (sin lista vacía, sin permiso sobre
    datos sin membresía).
- **`pnpm seed`** agrega la organización `demo`, los workspaces `comercial` y `finanzas`, y los
  usuarios `ana@example.com` y `bruno@example.com`: el escenario de la demo de aceptación
  (`docs/16` §4).
  - Es idempotente y valida todos los secretos antes de escribir.
  - Prueba cada acceso iniciando sesión, sin imprimir nunca la contraseña.
  - Si los usuarios ya existen con otra contraseña, lo dice y da el remedio.
- **`pnpm dev`** exige `auth.secret` y aplica las migraciones nuevas sobre la base existente: no
  hace falta `reset:local`.

### Contratos

- **Config Schema v4 → v5.**
  - Secretos nuevos: `auth.secret` (`ATLASBI_AUTH_SECRET`) y `seed.demo-password`
    (`ATLASBI_SEED_DEMO_PASSWORD`).
  - Se retira `semantic.sql-password`.
  - Un `.env` existente se completa desde `.env.example`; `ATLASBI_SEMANTIC_SQL_PASSWORD` sobra.
- **Contratos nuevos:** `IdentityPort` 1.0, `SecurityContext` 1.0 (con `DataEntitlement`:
  `all` o una lista que nunca está vacía) y `AccessDeniedError`.
- **DB Migration:** `000002`, la primera versión con tablas.
- **Token de consulta hacia Cube:** emisor `platform-api`, audiencia `semantic-layer`, ≤ 300 s,
  para REST y SQL.

### Corrección

- **`docs/04` §6.2:** el ejemplo de `access_policy` usaba `role:` y una lista anidada. En Cube
  1.7.45 es `group:` con `contextToGroups`: `contextToRoles` ni siquiera arranca.
- **`docs/09` §6.1:**
  - Advertencia explícita sobre la combinación con OR entre grupos de Cube.
  - `values` pasa a `allowed_values`, porque es palabra reservada en SQL.
- **`pnpm seed`:** con un `auth.secret` inválido, fallaba después de sembrar el dataset. Ahora
  valida todo antes de escribir.

## 0.3.0 — capa semántica (2026-09-26)

Paso 3 del orden de construcción: Cube Core sobre el lakehouse. Para que un lector en un contenedor
vea los mismos datos que la plataforma, el nivel "equipo local" pasa a guardar los datos del
lakehouse en S3 (Garage), con el mismo protocolo que en la nube.

### Agregado — Paso 3: capa semántica (Cube Core)

- **`packages/semantic`**: Cube Core 1.7.45 y Cube Store 1.7.45, fijados por digest, en el perfil
  CORE del compose.
  - Modo seguro desde el primer arranque: `NODE_ENV=production`, sin modo desarrollo y sin
    telemetría, con el secreto de API y una contraseña para el SQL API.
  - Cube Store en un nodo, con sus datos en el volumen `cube-store-data`.
- **Driver propio**, subclase del de DuckDB de Cube (`docs/04` §6.6):
  - Abre la instancia sin red y prepara el lakehouse en el mismo orden que el puerto de lectura de
    la plataforma, con `READ_ONLY` y la configuración congelada.
  - No se traga los errores: el driver original ocultaba un lakehouse caído detrás de
    `/readyz` 200 y de las pre-agregaciones.
  - El cliente recibe un error genérico, y el detalle va al log con las credenciales redactadas.
- **Cube lee como lector, nunca como escritor**: el rol del catálogo de solo `SELECT` y la clave S3
  de solo lectura.
- **Cube no tiene salida a Internet.** Vive con Cube Store en la red interna `semantic` del
  compose. Las extensiones de DuckDB que carga (`linux_*`) las instala `pnpm bootstrap` desde
  dentro de su imagen.
- **Salud real.** El paso `Cube` pide `/readyz` y además una consulta que lee una columna del
  lakehouse. `pnpm dev` muestra `Cube extensions` y `Cube healthy — answers from the lakehouse as its
reader`, y falla en el acto con el remedio si faltan las extensiones.
- **Modelo inicial**:
  - `sales_orders` sobre `marts.mart_sales_orders`: `count`, `sum`, `count_distinct`, un ratio,
    ventana móvil de 3 meses, y mes anterior y variación mes a mes (`multi_stage`).
  - La pre-agregación `amount_by_region_month`.
  - `regions`, derivado del mismo mart, para tener un join real.
- **Tests de integración herméticos**: cada suite levanta su propio Cube y Cube Store en la red
  interna, sobre un lakehouse descartable, y verifica:
  - Los números de Cube contra los del puerto de lectura de la plataforma.
  - La inteligencia de tiempo, el join, y la pre-agregación sin escribir en el lago.
  - La autenticación del SQL API, la batería de _pushdown_ y los tests de alerta.
  - Los modos de falla y la ausencia de ruta a Internet.

### Agregado — almacenamiento S3 en el nivel "equipo local"

- **Garage 2.4.1** (object storage S3-compatible, fijado por digest) en el compose. Se eligió con
  la regla 7 frente a versitygw; MinIO quedó descartado (`docs/11` §4.4). `pnpm bootstrap` crea el
  bucket y dos claves con su API de administración, a partir del `.env`: la del escritor, con
  lectura y escritura, y la de los lectores, de solo lectura.
- **`@atlasbi/warehouse` sobre S3** (`docs/01` §6.7):
  - Extensión `httpfs` y un secreto S3 acotado a la ruta de datos.
  - Errores de S3 mapeados al código nuevo `storage_unreachable`, con el remedio, y redacción de
    `SECRET` y de los parámetros `X-Amz-*`.
  - Telemetría con `lakehouse.storage_type`.
- **Credenciales de solo lectura para todo lector.** El rol `lakehouse_reader` (`ensureReadOnlyRole`
  en `@atlasbi/database`) más la clave S3 de solo lectura. Con `READ_ONLY` el motor todavía
  permite `CREATE SECRET` y `COPY … TO`: la protección real está en las credenciales. La
  verificación del lakehouse en `pnpm dev` lee un valor como lector, no un `count(*)`, que DuckLake
  responde desde las estadísticas.
- **SQLMesh sobre S3**: `pnpm transform` le pasa al proceso de SQLMesh las credenciales del
  escritor.
- **`@atlasbi/warehouse/testing`**: lakehouses descartables por nivel, con las identidades de
  escritor y de lector. Los de S3 usan `s3://lakehouse/tests/<uuid>/`, que nunca se superpone con
  los datos del desarrollador.
- **CLI por nivel**: el nivel portátil levanta solo Postgres y el OTel Collector. `pnpm preflight`
  revisa los puertos del nivel configurado y las extensiones de Cube.

### Cambiado — incompatible para los entornos de desarrollo

- **Cada nivel fija su almacenamiento**: PostgreSQL + S3 (equipo local y nube) o SQLite + carpeta
  (portátil). PostgreSQL + carpeta, el _default_ de desarrollo de `0.2.0`, ya no se soporta: un
  lakehouse de desarrollo anterior se recrea con `pnpm reset:local` + `pnpm bootstrap`.
- Un `.env` existente se completa a mano desde `.env.example`: las variables del object storage,
  las claves S3, el lector del catálogo, los puertos y los secretos de Cube.

### Contratos

- **Config Schema v3 → v4**:
  - Variables `ATLASBI_LAKEHOUSE_S3_URL`, `…_S3_ENDPOINT`, `…_S3_REGION` y `…_S3_USE_SSL`.
  - Validación del par nivel/almacenamiento.
  - Secretos nuevos: `lakehouse.catalog-reader-url`, `lakehouse.s3-writer-access-key-id`,
    `lakehouse.s3-writer-secret-access-key`, `lakehouse.s3-reader-access-key-id`,
    `lakehouse.s3-reader-secret-access-key`, `object-storage.admin-token` (solo bootstrap),
    `semantic.api-secret` y `semantic.sql-password`.
- **`AnalyticalQueryPort` y `LakehouseAdminPort` v1 → v1.1**: código de error nuevo
  `storage_unreachable` (aditivo). Las versiones de contrato pasan a expresarse como
  `"MAJOR.MINOR"`.
- DB Migration: sin cambios. El rol de lectura lo crea `pnpm bootstrap`, no una migración.
- El modelo semántico todavía no es un contrato público: el puerto `SemanticQueryPort`, que aísla
  los tipos de Cube, se diseña en el Paso 5.

### Proyecto

- **Licencia Apache-2.0** (`LICENSE`, campo `license` en cada paquete, `docs/21` §11). La auditoría
  de licencias de las dependencias embebidas queda pendiente antes del lanzamiento público
  (`docs/IMPLEMENTATION.md`).

### Corrección

- **`docs/17` §3.2.2**, la batería de _pushdown_, revalidada con el modelo real y su
  pre-agregación:
  - El remedio "usar `HAVING`" era incorrecto. Un filtro sobre una medida decimal, con orden,
    falla cuando lo responde una pre-agregación de Cube Store, en cualquier forma. Es un hueco
    conocido de 1.7.45, documentado con su test de alerta, y se retoma si aparece antes del
    Paso 11.
  - Cube sí hace post-procesamiento liviano sobre el resultado agregado, acotado por el
    `LIMIT 50000` que agrega el SQL API.
- **`pnpm test:integration` corre con `--continue`.** Sin eso, una suite que fallaba hacía que
  Turborepo cortara las demás antes de su limpieza, y dejaban contenedores, bases y objetos de
  prueba. Los tests de integración de `@atlasbi/database` usan ahora los mismos tiempos máximos que
  el resto.

## 0.2.0 — vertical slice de datos (2026-09-26)

Pasos 1 y 2 del orden de construcción: el lakehouse (DuckDB + DuckLake) y la transformación
(SQLMesh) sobre él, desde el fixture hasta el primer resultado analítico,
`marts.mart_sales_orders`.

### Agregado — Paso 2: transformación (SQLMesh)

- **`packages/transform`**: proyecto SQLMesh 0.236.2 (Python 3.13.14, entorno uv propio con
  `uv.lock` y `exclude-newer = "1 day"`, el mismo freno que pnpm) sobre el lakehouse del Paso 1.
  `staging.stg_sales_orders` (vista, sin copia de datos) → `marts.mart_sales_orders` (resultado
  analítico, incremental por fecha, grano pedido, un solo archivo: sin partición por día), con
  audits y un unit test.
- **`pnpm transform <comando>`**: la única forma soportada de correr SQLMesh. Verifica el
  lakehouse antes de que SQLMesh lo adjunte (SQLMesh crearía uno vacío en silencio sobre un
  catálogo equivocado), le pasa los secretos solo a ese proceso y resume las fallas en una línea.
  `test` y `lint` corren sin lakehouse.
- **Un state de SQLMesh por lakehouse**: esquema `sqlmesh_<identidad>` dentro de `sqlmesh_state`.
  Con un state compartido, un lakehouse que nunca construyó el mart recibía _No changes_; ahora
  un lakehouse nuevo —otro catálogo, o el mismo recreado por `reset:local` + `bootstrap`— empieza
  siempre con un state vacío (`docs/02` §6.3).
- **Identidad del lakehouse**: `provisionLakehouse()` le asigna un UUID guardado en su catálogo
  (`lake.platform.lakehouse_identity`) y `checkHealth()` lo devuelve (`docs/01` §6.7). Un
  lakehouse aprovisionado antes de este cambio pide `pnpm bootstrap`, que se la agrega.
- **`pnpm bootstrap`** prepara el entorno Python (`uv sync --frozen`, la única descarga) y la base
  `sqlmesh_state`; **`pnpm preflight`** verifica sin red que el entorno coincida con `uv.lock`.
- **Guardas de la política de materialización** (`docs/02` §6.1.2): regla propia del linter de
  SQLMesh que rechaza `ATTACH`, `INSTALL`, `SET`, secrets y `COPY` en modelos; test que rechaza
  módulos de red en modelos Python.
- **Parche temporal y experimental** para que el janitor de SQLMesh pueda borrar versiones viejas
  en DuckLake (no soporta `DROP … CASCADE`; issue SQLMesh/sqlmesh#6032, PR #6034), con un test de
  alerta que avisa cuando sobra.

### Agregado — Paso 1: motor de almacenamiento (DuckDB + DuckLake)

- **`@atlasbi/warehouse`**: DuckDB 1.5.5 embebido con DuckLake 1.0, detrás de dos puertos propios —
  `AnalyticalQueryPort` (solo lectura) y `LakehouseAdminPort` (administración/escritura). Ningún tipo
  de DuckDB sale del adaptador (ESLint lo impide fuera de `src/adapters/duckdb/`).
- **Catálogo PostgreSQL** (por defecto, base `lakehouse`, escritura concurrente real) **o SQLite**
  (portátil, un proceso escritor, con su límite medido y el remedio en `docs/01` §6.6); un catálogo
  en archivo DuckDB se rechaza.
- **Resultados sin pérdida**: enteros de 64/128 bits y `DECIMAL` como string exacto, `TIMESTAMPTZ`
  en UTC desde el instante, `TIMESTAMP` sin zona, `BLOB` en base64, filas posicionales.
- **Solo lectura reforzada en el motor** (`READ_ONLY`, acceso a archivos restringido, configuración
  congelada, un único `SELECT`); lo que falta antes del SQL Lab queda en una lista única
  (`08-frontend.md` §10.3).
- **Política _Inlining v1_** persistida en el catálogo al aprovisionar, con vaciado explícito.
- **`pnpm bootstrap`** crea la base del catálogo, instala las extensiones de DuckDB en
  `.data/duckdb/extensions` (la única descarga) y aprovisiona el lakehouse; **`pnpm dev`** lo
  verifica (`Lakehouse healthy — Catalog: …`) sin instalar, descargar ni crear nada;
  **`pnpm preflight`** revisa las extensiones y las carpetas sin red; **`pnpm seed`** (nuevo) carga
  `lake.fixture.sales_orders` (20.000 filas determinísticas); **`pnpm reset:local`** también borra
  `.data/lakehouse`.
- OpenTelemetry (solo la API): un span `CLIENT` y `db.client.operation.duration` por sentencia, con
  convenciones estables y sin SQL, literales ni credenciales.
- Credenciales del catálogo vía secret de DuckDB (`META_SECRET`), nunca en la cadena de `ATTACH`, y
  redacción de credenciales en todo mensaje de error.
- Baterías de contrato de los dos puertos en `@atlasbi/contracts/testing`; `ensureDatabaseExists` y
  `@atlasbi/database/testing` en `@atlasbi/database`.
- Política de naming del codename (`21` §1) y `PRODUCT_DISPLAY_NAME` como única fuente del nombre
  visible en la CLI.

### Contratos

- **Config Schema v1 → v2**: sección `lakehouse` (`ATLASBI_LAKEHOUSE_CATALOG_TYPE`,
  `…_DATA_PATH`, `…_SQLITE_PATH`, `ATLASBI_DUCKDB_EXTENSION_DIRECTORY`) y secreto
  `lakehouse.catalog-url` (`ATLASBI_LAKEHOUSE_CATALOG_URL`, obligatorio con catálogo PostgreSQL).
  Un `.env` existente se completa a mano desde `.env.example`.
- **Nuevos:** `AnalyticalQueryPort` v1, `LakehouseAdminPort` v1 (reemplazan al `AnalyticalEnginePort`
  que describía `21` §3), formato de catálogo DuckLake **1.0**.
- DB Migration: sin cambios (la carpeta sigue vacía hasta el Paso 4).
- **Paso 2 — Config Schema v2 → v3**: secreto `transform.state-url` (`ATLASBI_TRANSFORM_STATE_URL`),
  obligatorio para `pnpm bootstrap` y `pnpm transform` (no para `pnpm dev`). Un `.env` existente
  se completa a mano desde `.env.example`.
- **Paso 2 — `LakehouseAdminPort` v1:** `LakehouseHealth` suma `lakehouseId` (aditivo, dentro de
  la misma versión sin publicar; la batería de contrato exige un UUID estable).
- **Paso 2 — primer resultado analítico:** `marts.mart_sales_orders` (lo que leerá la capa
  semántica en el Paso 3).

### Corrección

- **Puerto de lectura (encontrado en el Paso 2):** `SELECT * FROM ducklake_flush_inlined_data(…)`
  fallaba por `READ_ONLY`, pero después de escribir un archivo Parquet huérfano en la carpeta de
  datos. El puerto de lectura ahora solo admite las funciones `ducklake_*` de consulta
  (`docs/01` §6.7), con un test que verifica que ningún ataque deja archivos nuevos.
- Los tests unitarios del warehouse dejaban una carpeta temporal vacía por corrida; ahora
  reutilizan una sola.
- La nota de 0.1.1 anticipaba que el Paso 1 usaría `node:sqlite` para aprovisionar un catálogo
  SQLite. Finalmente no lo usa: se eligió el camino sin WAL (`docs/01` §6.6).

## 0.1.1 — seguridad del runtime (2026-09-24)

PATCH (`21-engineering-standards.md` §2.1: parche de seguridad, sin cambio de capacidad ni de
contrato). Independiente del Paso 1.

### Seguridad

- **Node.js fijado en 24.21.0** (antes 24.12.0, del 10/12/2025). La versión anterior no incluía
  cuatro _security releases_ de la línea 24: 24.13.0, 24.14.1, 24.17.0 y **24.18.1** (28/7/2026).
- Correcciones relevantes para este proyecto que ahora quedan incluidas:
  - **undici** actualizado a 7.29.x (el runtime reporta 7.29.1): es el cliente HTTP detrás de
    `fetch`, que usa la CLI de plataforma (health checks).
  - **CVE-2026-58041** (Medium): `node:sqlite` — un iterador de `SQLTagStore` podía re-ejecutar
    escrituras. Relevante porque el Paso 1 usará `node:sqlite` al aprovisionar un catálogo SQLite.
  - **llhttp** 9.4.3 (CVE-2026-58044, _request smuggling_ por truncado de cabeceras), y el resto
    del aviso de julio de 2026 (HTTP/2, HTTPS Agent, Permission Model, `dns`, `zlib`):
    <https://nodejs.org/en/blog/vulnerability/july-2026-security-releases>.
- Instalado desde el MSI oficial de nodejs.org con SHA-256 verificado contra `SHASUMS256.txt` y
  firma Authenticode válida de OpenJS Foundation (winget solo ofrecía hasta 24.19.0).

### Contratos

Sin cambios.

## 0.1.0 — bootstrap (2026-09-23)

Paso 0 del orden de construcción (`CLAUDE.md`): un entorno de desarrollo "equipo local mínimo"
que se reproduce desde cero con `pnpm install` + `pnpm bootstrap`.

### Agregado

- Monorepo pnpm 11 + Turborepo con versiones fijadas en un único `catalog`
  ([`docs/versions.md`](docs/versions.md) justifica cada una con evidencia).
- Infraestructura local en `compose.yaml` (Compose Spec, vía `podman compose`): PostgreSQL 17.11
  y OpenTelemetry Collector 0.161.0 (core), con puertos publicados solo en `127.0.0.1`.
- `@atlasbi/contracts`: puerto `SecretProvider` + batería de contract tests reutilizable que todo
  adaptador debe pasar.
- `@atlasbi/config`: configuración validada al arrancar (falla rápido listando todo lo que falta) y
  adaptador `EnvSecretProvider`.
- `@atlasbi/database`: `pg` + Kysely + Kysely Migrator con migraciones `.sql` forward-only
  (carpeta vacía hasta el Paso 4).
- `tools/platform-cli`: `pnpm preflight`, `bootstrap`, `dev`, `stack:up|down|logs`,
  `reset:local`, con una cadena de readiness que dice qué pieza falló y por qué.
- Selección del compose provider por proceso: la CLI elige el `docker-compose` standalone (salteando
  las copias de Docker Desktop) y lo pasa solo a sus propios `podman compose`, sin modificar el
  entorno global ni `containers.conf`; override opcional `ATLASBI_COMPOSE_PROVIDER` en `.env`.
- Calidad: ESLint 10 + typescript-eslint (reglas de nombres e imports solo por la entrada pública
  de cada paquete), Prettier, Vitest (39 unit tests, 5 de integración contra Postgres real).

### Contratos

| Contrato                        | Versión                              |
| ------------------------------- | ------------------------------------ |
| API Contract                    | — (llega en el Paso 5)               |
| Report Document `schemaVersion` | — (llega en el Paso 6)               |
| Config Schema                   | v1                                   |
| SecretProvider                  | v1                                   |
| DB Migration                    | ninguna aplicada (solo el mecanismo) |
