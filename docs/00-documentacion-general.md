# BI Moderno de Código Abierto — Documentación General

> Objetivo del proyecto: reemplazar Power BI en la totalidad de sus capas con herramientas open source modernas, cada una con responsabilidad única, comunicándose solo por contratos explícitos — no para igualar a Power BI, sino para superarlo donde su arquitectura lo permite y él estructuralmente no puede. Además, cada capa evalúa explícitamente qué rescatar de **otros líderes de BI** (Tableau, Looker, Qlik, ThoughtSpot, Sigma) — el objetivo no es "Power BI pero open source", es "lo mejor de cada líder del mercado, sin sus ataduras propietarias".

---

## 1. Filosofía y reglas fundamentales

1. **Reemplazar solo por algo objetivamente mejor.** Ninguna pieza se sustituye "porque sí" o "porque es más nueva" — cada reemplazo se justifica con una razón técnica concreta (rendimiento, ausencia de vendor lock-in, capacidad que Power BI no tiene).
2. **Responsabilidad única por capa.** Cada módulo hace una sola cosa y la hace bien. Si un módulo empieza a "saber" cosas de otra capa (el frontend conociendo el esquema del warehouse, por ejemplo), es una señal de diseño roto.
3. **Open source primero, siempre.** Sin SaaS propietario que reintroduzca el mismo problema de lock-in que tiene Power BI con Microsoft. Self-hosteable como requisito, no como opción.
4. **Comunicación solo por contrato (API o formato de archivo), nunca por acceso directo.** Ninguna capa lee la base de datos interna o importa el código fuente de otra.
5. **Todo en texto plano versionable en Git donde sea posible** (SQL, YAML, JSON). Es la corrección directa al defecto histórico de Power BI: el formato `.pbix` tradicional, atrapado en un binario opaco, difícil de diffear en un pull request. **Corrección de precisión (señalada por una revisión externa):** Power BI introdujo PBIP/PBIR/TMDL, que sí permiten un proyecto compuesto por archivos de texto amigables a Git/CI-CD — la afirmación "Power BI no se puede versionar" ya no es correcta sin matices. Lo que sigue siendo cierto, y es la comparación justa: en este proyecto, texto plano versionable es el formato **por defecto** de cada capa, no una opción avanzada que hay que activar y que convive con el resto del ecosistema pensado para el binario.
6. **Moderno, pero verificado en producción.** "De vanguardia" no es sinónimo de "experimental" — cada pieza elegida ya tiene adopción real, no es una apuesta.
7. **Gobernanza sobre riesgo de abandono, sin excepciones.** Nunca elegir una herramienta sostenida por una sola persona o un proyecto chico sin respaldo institucional real. Orden de preferencia: (1) fundación neutral (Apache Software Foundation, Linux Foundation, CNCF); (2) empresa con financiamiento real y adopción masiva en producción, cuando no exista alternativa de fundación en esa categoría; (3) nunca un mantenedor individual o un proyecto sostenido solo por sponsors/comunidad chica. Cuando se elige la opción (2), el riesgo residual se documenta explícitamente en el documento de esa capa.
8. **Rescatar lo mejor de todos los líderes de BI, no solo reemplazar Power BI.** Cada capa evalúa explícitamente qué hace mejor Tableau (visualización, Pulse proactivo), Looker (modelo como código), Qlik (exploración asociativa), ThoughtSpot (búsqueda en lenguaje natural como interfaz principal) y Sigma (planilla en vivo sobre el warehouse) — y lo incorpora si encaja con las reglas 1-7, sin romper la responsabilidad única de la capa que lo recibe.
9. **Protocolo estándar sobre API propietaria de un proveedor.** Ninguna capa de aplicación llama al SDK específico de un proveedor de nube (AWS, GCP, Azure, DigitalOcean). Toda pieza de infraestructura se consume por su protocolo estándar (API S3, protocolo de cable de Postgres, contenedor OCI) — el nombre de un proveedor concreto solo aparece en la configuración de infraestructura como código (capa 11), nunca en el código de aplicación. Esto es lo que permite que el mismo proyecto corra en modo portátil, local o nube sin reescribir una línea.

---

## 2. La analogía: corazón, columna vertebral y copiloto

| Función | En Power BI | Reemplazo |
| --- | --- | --- |
| 🫀 Corazón (motor que da vida/velocidad) | VertiPaq (motor columnar en memoria) | **DuckDB** (+ DuckLake, + MotherDuck opcional para escalar) |
| 🦴 Columna vertebral + cálculo (sostiene la estructura y calcula) | Modelo semántico + DAX (relaciones, jerarquías, medidas) | **Cube Core** — grafo de joins y medidas en YAML, compilado a SQL sobre DuckDB |
| 🤖 Copiloto conversacional (capa opcional, nunca el motor de cálculo) | Copilot de Power BI | Interfaz **`LLMProvider`** conectada a Cube Core vía un servidor MCP propio — **Claude es la implementación por defecto**, no una atadura estructural; apagable sin romper nada más |

**Corrección de nomenclatura (aplicada en las capas 4 y 5):** la versión inicial de este documento llamaba "Cerebro" a la capa de IA, lo que sugería erróneamente que ahí vivía el cálculo. El cálculo (lo que hacía DAX) vive enteramente en la capa 4 (Cube Core), que corre sin depender de ningún servicio de IA ni de internet. La capa 5 es un copiloto conversacional *sobre* ese cálculo ya resuelto — ver `05-cerebro-ia.md`, sección 0, para el detalle completo de por qué esta separación es un requisito de diseño, no un detalle.

Cada una de estas piezas se analiza en profundidad en su propio documento de capa (ver índice al final).

---

## 3. Qué eliminamos de Power BI (defectos estructurales, no cosméticos)

- **Formato binario opaco (`.pbix` tradicional)** — difícil de versionar en Git de forma útil, difícil de diffear, difícil de revisar en un pull request. **Corrección de precisión:** Power BI ya ofrece PBIP/PBIR/TMDL como alternativa de archivos de texto para control de versiones — la comparación justa no es "Power BI no puede" sino "en este proyecto, el texto plano versionable es el formato por defecto de cada capa, no una alternativa que hay que elegir activamente". Se reemplaza por una carpeta de archivos de texto sueltos (`.sql`, `.yml`, `.py`, `.ts`, `.svelte`), cada uno con su propia responsabilidad — ver la sección 6.
- **DAX como único punto de entrada al modelo** — contexto de fila/contexto de filtro implícito es una fuente probada de errores silenciosos incluso para usuarios avanzados.
- **Relaciones bidireccionales ambiguas** — cuando hay múltiples caminos de join activos/inactivos, los números pueden "no cuadrar" sin ningún error visible.
- **Licenciamiento por usuario + capacidad Premium/Fabric** — el costo escala con el uso, no con el valor entregado, y crea fricción para escalar el acceso dentro de una organización.
- **Arquitectura cliente-servidor obligatoria** — sin analítica offline real, sin ejecución local-first.
- **Sandbox de iframe con WebGL deshabilitado** en custom visuals — limita técnicamente lo que un desarrollador puede construir dentro del ecosistema.
- **Edición de un solo usuario a la vez** — no hay colaboración en tiempo real tipo Figma/Google Docs sobre un mismo reporte.
- **Gateway on-premises** como pieza operativa adicional solo para conectar datos internos.
- **Motor de refresco rígido** ("cada X horas") sin manejo real de dependencias, reintentos o alertas granulares.
- **Licencias que dejaron de ser abiertas a mitad de camino** (Terraform/HashiCorp bajo IBM, Airbyte Core bajo ELv2) — el proyecto evita depender de herramientas con este patrón de riesgo, no solo de Microsoft.

## 4. Qué agregamos que Power BI no ofrece hoy bajo su modelo arquitectónico actual

- **Ejecución local-first / offline real** vía DuckDB-WASM corriendo en el navegador del usuario, con persistencia nativa vía OPFS (soportada desde el 18 de septiembre de 2026 — ver `08-frontend.md`, sección 6, incluida la salvedad de fijar una versión específica de la librería por un bug conocido en la build "latest").
- **Colaboración en tiempo real multi-usuario** sobre el mismo dashboard (tipo Figma), con el estado del canvas sincronizado vía ElectricSQL — ver `10-colaboracion-realtime.md` para por qué el alcance de "conflicto a resolver" se acotó deliberadamente en vez de sumar una librería CRDT de gobernanza riesgosa.
- **Copiloto conversacional grounded en el modelo semántico**, no en SQL libre — con evidencia cualitativa (un benchmark de 2026, con las salvedades de tamaño de muestra documentadas en `05-cerebro-ia.md`, sección 4.2) de que esta arquitectura reduce específicamente el tipo de error más peligroso: un número incorrecto servido con confianza, en vez de un rechazo explícito.
- **Versionado y revisión de código real** en cada capa (pull requests sobre SQL, YAML, JSON, TypeScript).
- **Cero costo de licenciamiento por usuario** — el costo escala con infraestructura, no con headcount.
- **Total libertad de self-hosting**, con tres niveles de despliegue reales (portátil, local, nube) que comparten el mismo código de aplicación — ver sección 8.
- **Interoperabilidad nativa con formatos abiertos** (Parquet, catálogo DuckLake compatible con SQLite/DuckDB/Postgres/MySQL) sin pasos de importación.
- **Visualización analítica premium como diferenciador — aspiración de producto, no una afirmación de superioridad actual.** Un Visualization Engine propio con contrato propio (`VisualSpec`), Visual Intelligence sobre el modelo semántico, defaults excelentes, Motion System, interacción unificada entre todos los visuales, y extensibilidad en todo el espectro: desde drag & drop hasta componentes propios en HTML + CSS + Vanilla JS (aislados y seguros) y un Custom Visual SDK. Los renderers (ECharts hoy) son infraestructura intercambiable — ver `22-visualization-engine.md`, con los atributos medibles que convierten "premium" en criterios verificables.
- **Ideas incorporadas de otros líderes de BI, no solo de Power BI** — pendiente de definir en detalle capa por capa (ver sección 11): entrega proactiva de insights al estilo Tableau Pulse, exploración asociativa al estilo Qlik, y un modo de consulta SQL exploratoria para power users al estilo del "SQL personalizado" de Tableau.

---

## 5. Mapa completo de capas (corregido)

| # | Capa | Qué hace | Reemplazo confirmado | Riesgo de gobernanza documentado | Documento |
| --- | --- | --- | --- | --- | --- |
| 1 | Motor de almacenamiento (el "corazón") | Compresión columnar, consultas analíticas rápidas | DuckDB + DuckLake (+ MotherDuck opcional) | Bajo (DuckDB Foundation + DuckDB Labs) | `01-motor-almacenamiento.md` |
| 2 | Transformación | Limpieza y modelado de datos | **SQLMesh** (dbt OSS como alternativa aceptada) | Bajo (Linux Foundation) | `02-transformacion.md` |
| 3 | Ingesta | Trae datos de fuentes externas | **dlt** + ADBC como estándar de conectividad | Medio, documentado (dltHub Inc., sin fundación equivalente disponible en esta categoría) | `03-ingesta.md` |
| 4 | Modelo semántico y cálculo (columna vertebral) | Relaciones, medidas, RLS — reemplaza el rol de DAX como capa de cálculo gobernado (no equivalencia funcional 1:1, ver `04-semantico.md` sección 6.4) | **Cube Core** | Medio, documentado (Cube Dev Inc.; mitigado por el estándar Apache Ossie en incubación) | `04-semantico.md` |
| 5 | Copiloto conversacional (IA) — capa opcional | Lenguaje natural sobre el cálculo ya resuelto, nunca el cálculo en sí | API de Claude + servidor MCP propio sobre Cube Core | N/A (Anthropic; riesgo es de disponibilidad de API, no de abandono — capa diseñada para apagarse sin romper nada más) | `05-cerebro-ia.md` |
| 6 | API Gateway | Expone el semántico al frontend, más una API pública OpenAPI para consumidores externos | **tRPC** (BFF interno) + **OpenAPI 3.x** (contrato público) | Adopción masiva mitiga la falta de fundación (tRPC) | `06-api-gateway.md` |
| 7 | Orquestación | Programa y encadena pipelines | **Apache Airflow** | Bajo (Apache Software Foundation) | `07-orquestacion.md` |
| 8 | Frontend / visualización | Dashboards y charts | SvelteKit + Svelte 5 + **Apache ECharts** | Bajo (Apache Software Foundation) | `08-frontend.md` |
| 9 | Autenticación y gobernanza | Permisos, RLS, auditoría | **better-auth** (Vercel) — Keycloak (CNCF) si se necesita federar identidad corporativa existente | Bajo tras adquisición por Vercel | `09-auth-gobernanza.md` |
| 10 | Colaboración en tiempo real | Multiplayer sobre el mismo dashboard | **ElectricSQL** (Databricks) — sin librería CRDT de terceros para el caso principal | Bajo tras adquisición por Databricks | `10-colaboracion-realtime.md` |
| 11 | Hosting e infraestructura | Dónde y cómo corre todo | **Podman + OpenTofu + Edge Connector Agent** (WireGuard/mTLS como transporte) | Bajo (Red Hat / Linux Foundation-CNCF / kernel de Linux) | `11-infraestructura.md` |
| 12 | Metadata, catálogo y lineage | Qué existe, de dónde viene, quién lo certificó, qué se rompe si cambia | **OpenMetadata** | Medio, documentado (Collate Inc.; sin alternativa de fundación en esta categoría — DataHub y Amundsen tienen el mismo o peor perfil) | `12-metadata-gobernanza.md` |

*(Las 12 capas ya están documentadas a fondo, incluida la ronda de gobernanza, la ronda de ideas de otros líderes de BI, una auditoría externa completa con dos revisiones independientes, y un análisis de producto dedicado que sumó la Capa 12 y profundizó el Authoring Engine de la Capa 8 — ver sección 15.)*

---

## 5.1 Plan de implementación: separar el producto de la infraestructura

**Principio rector, aportado por un análisis de producto independiente y que vale la pena dejar explícito:** DuckDB, SQLMesh, Cube, dlt, Airflow y OpenMetadata son piezas **ya resueltas** — este proyecto no las reimplementa, las conecta. El valor real de este proyecto, y donde debería concentrarse el esfuerzo de ingeniería real, está en la capa que las une:

```
TU PLATAFORMA
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   Authoring      Semantic      AI Agent
     Engine          UX           Engine
       │             │             │
       └─────────────┼─────────────┘
                     │
              Metadata Graph (capa 12)
                     │
────────────────────────────────────────
     componentes OSS intercambiables
────────────────────────────────────────
dlt │ SQLMesh │ Cube │ DuckDB │ Airflow
```

**Distribución aproximada de esfuerzo real de ingeniería** (orden de magnitud, no presupuesto fijo — depende de cuánto authoring visual completo se construya desde el día uno vs. progresivamente):

| Área | % aproximado del esfuerzo | Por qué |
| --- | --- | --- |
| Frontend + Authoring Engine (capa 8) | 30-35% | Canvas, drag & drop, matriz, interacciones, formatting — es donde se construye "el Power BI" en sí |
| Modelo semántico + query engine (capa 4) | 15-18% | Métricas, jerarquías, calendario fiscal, RLS, traducción intención→consulta |
| Metadata/catálogo/lineage (capa 12) | 10-12% | Transversal, esencial para una plataforma empresarial |
| Integración entre todas las capas | 10-12% | Contratos, errores, versiones, observabilidad |
| IA/copiloto (capa 5) | 8-10% | Se construye al final, sobre contratos ya estables — no antes |
| Ingesta/conectores (capa 3) | 7-10% | Puede crecer mucho si se escriben muchos conectores propios |
| Auth y permisos (capa 9) | 5-7% | Workspaces, RBAC, RLS, auditoría |
| Orquestación (capa 7) | 3-4% | Airflow ya resuelve casi todo — el trabajo es integración |
| Motor de almacenamiento (capa 1) | 3-4% | El motor ya existe, no se construye |
| Infraestructura (capa 11) | 3-4% | OpenTofu/Podman ya dan los bloques |
| Colaboración en tiempo real (capa 10) | 2-4% | Puede posponerse — no es requisito para demostrar el producto |

**Por qué no invertir de más en IA al principio, aunque suene contraintuitivo:** una IA conversando sobre un catálogo/semántico mediocre produce, en el mejor de los casos, un chatbot pegado a dashboards. Una IA sobre un catálogo (capa 12), un semántico (capa 4) y un authoring engine (capa 8) genuinamente completos puede pasar de "chatbot" a "agente de BI" real — capaz de construir un dashboard completo a partir de una descripción, no solo responder una pregunta puntual. El orden de construcción de la sección 7 ya refleja esto (IA en el paso 9 de 10) — no es un error, es la secuencia correcta.

---

## 6. Estructura de monorepo

```
bi-platform/                 # pnpm workspace + Turborepo
├── apps/
│   └── web/                 # SvelteKit + Svelte 5: dashboards, ECharts, SQL Lab exploratorio
├── packages/
│   ├── ingestion/           # dlt: definiciones de fuentes (Python)
│   ├── transform/           # SQLMesh: modelos SQL, tests/audits de datos (Python + SQL)
│   ├── warehouse/           # Infra as code de DuckDB/DuckLake (catálogo SQLite/Postgres según nivel)
│   ├── semantic/            # Cube Core: métricas, dimensiones, RLS (YAML)
│   ├── api-gateway/         # tRPC: expone el semántico y el copiloto al frontend (TypeScript)
│   ├── orchestrator/        # DAGs de Apache Airflow (Python)
│   ├── auth/                # better-auth + políticas de permisos (TypeScript)
│   ├── realtime/            # ElectricSQL: estado del canvas colaborativo (TypeScript)
│   └── ai-copilot/          # Servidor MCP propio + integración con la API de Claude (TypeScript)
├── infra/                   # OpenTofu: hosting, redes, secretos, por proveedor
└── docs/                    # Esta documentación, ADRs, contratos entre capas
```

**Regla de oro:** ningún paquete importa el código fuente de otro. Si dos capas necesitan compartir un tipo, ese tipo vive en `packages/contracts/`, versionado como dependencia — nunca como import directo.

---

## 7. Orden de construcción recomendado

1. **Motor de almacenamiento** (DuckDB/DuckLake) — sin esto nada más tiene sentido.
2. **Transformación** (SQLMesh) — sobre una fuente real, no un CSV de prueba.
3. **Modelo semántico** (Cube Core) — valida la API antes de tocar frontend.
4. **API Gateway** (tRPC) — casi gratis si el semántico ya expone API propia.
5. **Frontend mínimo** (SvelteKit + ECharts) — 2-3 charts reales.
6. **Ingesta** (dlt) — recién acá conectas una fuente externa de verdad.
7. **Orquestación** (Airflow) — automatiza el pipeline completo.
8. **Auth y gobernanza** (better-auth) — cuando haya más de un usuario tocando el sistema.
9. **Copiloto/IA** (Claude + MCP propio) — se integra al final, sobre contratos ya estables.
10. **Colaboración en tiempo real** (ElectricSQL) — la última milla, cuando el resto es sólido.
11. **Infraestructura formal** (Podman + OpenTofu + Edge Connector Agent) — se formaliza en paralelo desde el paso 1 en modo portátil/local, y se activa el modo nube cuando el proyecto lo requiera.
12. **Metadata y catálogo** (OpenMetadata) — se alimenta de las capas 2, 3, 4, 7 y 9 ya construidas; no tiene sentido antes de que existan.

Cada paso es demostrable por separado: al terminar el paso 5 ya hay algo enseñable, aunque el resto no exista todavía.

---

## 8. Niveles de despliegue: portátil, local y nube, sin reescribir código

El proyecto soporta tres niveles de despliegue reales, posibles porque cada componente habla un protocolo estándar (regla 9) en vez de la API de un proveedor específico:

| Nivel | Catálogo (DuckLake) | Datos (Parquet) | Multi-usuario | Cuándo |
| --- | --- | --- | --- | --- |
| **1. Portátil** | SQLite (un archivo) | Carpeta local | No | Tablet, laptop, desarrollo en solitario, sin servidor de ningún tipo |
| **2. Equipo local** | Postgres en un container (Podman) | Carpeta local o MinIO self-hosteado | Sí (sin colaboración en tiempo real de capa 10) | Un servidor propio, varias personas en la misma red |
| **3. Nube/producción** | Postgres gestionado, misma región que el storage | Bucket S3-compatible (cualquier proveedor) | Sí, con capa 10 activa | Producción real, multi-usuario remoto |

**Camino de promoción entre niveles:** migrar de portátil a nube es copiar datos (volcado SQLite → Postgres, sincronización de archivos al bucket), nunca reescribir código de aplicación — el detalle completo, incluyendo el comando de promoción propuesto, está en `11-infraestructura.md`, sección 4.4 y siguientes. OpenTofu es la pieza que garantiza que el catálogo y el storage terminen en la misma región cuando se despliega en nube — ver el mismo documento para el ejemplo de código.

---

## 9. Lenguajes de programación recomendados por capa

| Capa | Lenguaje principal | Por qué |
| --- | --- | --- |
| Motor/transformación/ingesta | **SQL** (siempre) + **Python** | SQL es el lenguaje nativo de SQLMesh/DuckDB; Python domina el ecosistema de ingesta (dlt) y orquestación (Airflow es Python-first) |
| Semántico | **YAML** (declarativo) | Cube Core usa YAML — no es un lenguaje de propósito general, y esa es la ventaja frente a DAX |
| API gateway + Frontend | **TypeScript** | Con SvelteKit + tRPC, TypeScript comparte tipos end-to-end entre servidor y cliente sin generar código aparte |
| Auth | **TypeScript** | better-auth es TS-nativo |
| Piezas de alto rendimiento (extensiones/conectores propios) | **Rust** | El motor de DuckDB, Apache Arrow y ADBC están escritos en Rust/C++ — es el lenguaje del ecosistema si se necesita extender el motor, no una opción exótica |
| Infraestructura como código | **HCL** (OpenTofu) | Estándar de facto para IaC declarativo, ahora bajo gobernanza de fundación |

**Regla práctica:** el grueso del proyecto se escribe en SQL + Python (capas de datos) y TypeScript (capas de aplicación). Rust solo entra si se construye una extensión de DuckDB o un conector ADBC propio.

---

## 10. Correcciones de gobernanza aplicadas (registro histórico)

Durante la construcción de las capas 6 a 11 se aplicó, en retrospectiva, la regla 7 (gobernanza) con el mismo rigor a decisiones ya tomadas. Este registro existe para que quede explícito qué cambió y por qué, sin tener que releer cada documento de capa:

| Capa | Se descartó | Se reemplazó por | Motivo |
| --- | --- | --- | --- |
| 4 | MetricFlow como opción intercambiable con Cube | Cube Core como único candidato | MetricFlow depende de un proyecto dbt; el proyecto usa SQLMesh (capa 2) |
| 6 | oRPC | tRPC | oRPC sostenido por sponsors individuales, sin empresa ni comunidad de escala |
| 7 | Kestra | Apache Airflow | Kestra es una sola empresa (VC-funded); Airflow es ASF, además más coherente en lenguaje (Python) con el resto del stack |
| 8 | LayerChart | Apache ECharts | LayerChart sostenido por un solo mantenedor, sin empresa ni fundación |
| 9 | (ninguno — better-auth se reafirma) | — | better-auth pasó de startup en etapa semilla a estar respaldada por Vercel |
| 10 | Yjs | ElectricSQL + concurrencia optimista con `version` en Postgres (nunca last-write-wins ciego, ver `10-colaboracion-realtime.md` §6.1) | Yjs es, por su propia descripción oficial, sostenido por un individuo |
| 11 | Terraform | OpenTofu | Terraform se relicenció bajo BSL (no-OSI) en 2023; HashiCorp fue adquirida por IBM en 2025 |
| 11 | Docker (como producto de empresa) | Podman | Podman (Red Hat) es más seguro por diseño (sin daemon root) y usa el mismo formato de archivo |
| 11 | Cloudflare Tunnel / Tailscale | WireGuard como transporte, dentro de un Edge Connector Agent propio (no un reemplazo 1:1 — ver corrección en `11-infraestructura.md`, sección 4.3) | Ambos tienen un plano de control cerrado y comercial; además WireGuard por sí solo resuelve solo el túnel de red, no el resto de lo que hace un Gateway (ejecución de conectores, credenciales, HA) |

**Casos donde se aceptó un riesgo residual, documentado explícitamente, por ausencia de alternativa de fundación:** capa 3 (dlt, dltHub Inc.) y capa 4 (Cube Core, Cube Dev Inc.) — ambos mitigados por adopción masiva y, en el caso de Cube, por el estándar Apache Ossie en incubación desde junio 2026.

---

## 11. Ideas de otros líderes de BI incorporadas (ronda completa, cerrada)

Líderes actuales del mercado (Gartner Magic Quadrant de Analytics & BI, junio 2026): Microsoft Power BI, Salesforce Tableau, Google Looker, Qlik, ThoughtSpot, y Sigma Computing (Visionario). Se revisaron las 11 capas, una por una, con la misma exigencia que el resto del proyecto (investigación real, no una lista de deseos). Resultado final:

| Capa | Idea | De quién | Resultado |
| --- | --- | --- | --- |
| 1 | Motor en memoria (Hyper) / motor asociativo (Qlik) | Tableau / Qlik | **Nada que agregar** — DuckDB ya es la misma generación de tecnología que Hyper, abierta; el patrón asociativo se resuelve en capa 4/8, no acá |
| 2 | Escritura directa al warehouse desde una planilla ("Input Tables") | Sigma | **Incorporado** — nuevo tipo de fuente escribible (`raw_input_*`) que SQLMesh trata como cualquier otra fuente cruda |
| 3 | Replicación en tiempo real (CDC) | Qlik (Replicate) | **Incorporado, sin herramienta nueva** — dlt ya trae `pg_replication` (WAL de Postgres), el mismo mecanismo que ElectricSQL (capa 10) |
| 4 | Modelo semántico como código, versionado en Git | Looker (LookML) | **Ya estaba incorporado** — Cube Core llega a la misma conclusión por otro camino |
| 4 | Exploración asociativa (seleccionado/asociado/excluido) | Qlik | **Incorporado** — *disjunctive faceting* sobre el grafo de joins ya explícito de Cube, sin reintroducir ambigüedad |
| 5 | Entrega proactiva de insights ("digest"), sin esperar la pregunta | Tableau (Pulse) | **Incorporado** — suscripciones a métricas + DAG de digest en Airflow, reutilizando `query_metric` y el job de anomalías ya construidos |
| 6 | — (cierre de pendientes de otras capas) | Sigma / Looker | **Incorporado** — procedimiento de escritura (Input Tables) + Action Hub abierto inspirado en Looker Actions (protocolo HTTP simple, self-hosteable) |
| 7 | Recálculo disparado por cambio de datos, no solo por horario | Looker (datagroups) | **Nada que agregar** — el scheduling basado en eventos de Airflow 3.0 ya resuelve lo mismo, de forma más capaz (eventos reales, no polling) |
| 8 | Renderizado blanco/gris de la exploración asociativa | Qlik | **Incorporado** — la mitad visual de lo ya resuelto en capa 4 |
| 8 | Interfaz de planilla de cálculo | Sigma | **Incorporado** — vista de grilla sobre resultados de Cube, con celdas editables solo donde la capa 6 lo habilite; librería concreta pendiente de la misma auditoría de gobernanza que el resto del stack |
| 8 | SQL exploratorio de solo lectura, fuera del camino gobernado | Tableau / DirectQuery | **Incorporado como "SQL Lab"** — con la regla de que una consulta repetida es la señal para promoverla a medida oficial |
| 8 | Búsqueda en lenguaje natural como interfaz principal | ThoughtSpot | **Incorporado, adaptado** — barra de búsqueda prominente *encima* de los dashboards, nunca en su lugar, para no romper la regla de la capa 5 (el copiloto debe poder apagarse sin romper nada más) |
| 9 | Certificación de datos ("badge" de confianza) | Tableau | **Incorporado, mejorado** — certificación revocable automáticamente si un audit de SQLMesh falla, en vez de una insignia que nadie revisa |
| 10 | Comentarios anclados a un dato específico | Tableau / Looker / ThoughtSpot / Sigma | **Incorporado, sin mecanismo nuevo** — misma sincronización de ElectricSQL ya construida, aplicada a una tabla de comentarios |
| 11 | Agente de conexión on-premise sin abrir puertos | Tableau (Bridge) | **Corrección posterior: sí hacía falta agregar algo** — WireGuard por sí solo resuelve el túnel de red, no la ejecución de conectores/gestión de credenciales que hace un Gateway real. Se agregó el Edge Connector Agent propio (ver `11-infraestructura.md`, sección 4.3) |

**Regla aplicada en cada caso:** copiar la idea nunca significó copiar la implementación propietaria — cada incorporación se tradujo a una herramienta ya elegida en este proyecto (Airflow, SQLMesh, Cube, ElectricSQL, tRPC), sin sumar dependencias nuevas fuera de los casos donde una librería de UI (grilla tipo planilla) todavía está pendiente de elegir con la misma regla de gobernanza que el resto del stack.

---

## 12. Costo real (TCO) — honestidad sobre lo que "cero licenciamiento" no incluye

**Corrección de un marco de comparación incompleto, señalado por dos revisiones externas.** Este documento repite varias veces "cero costo de licenciamiento por usuario" como ventaja frente a Power BI. Es verdad — y a la vez, sola, es una comparación engañosa si no se dice el resto.

Power BI Pro cuesta un monto fijo por usuario por mes, previsible, sin necesidad de nadie que lo administre más allá de una cuenta de Microsoft 365. Esta plataforma reemplaza esa factura por **costo de infraestructura + costo de operación**: alguien tiene que levantar y mantener Cube+Cube Store, Airflow, Postgres, Electric, la capa de auth, los tokens de la API de Claude a escala de uso, y hacer la ronda de gobernanza de las 11 piezas cuando una licencia o una empresa cambia de manos (algo que, como quedó documentado en la sección 10, ya pasó varias veces en la vida de este proyecto y va a seguir pasando).

**Dónde este proyecto gana en costo, de verdad:** a partir de cierta escala de usuarios (el punto exacto depende de la organización), el costo por usuario de Power BI Pro/Premium crece linealmente con la cantidad de gente, mientras que el costo de operar esta plataforma crece con la infraestructura, no con el headcount — una organización de 500 usuarios paga muchísimo menos por usuario acá que en licencias, si ya tiene el conocimiento operativo para mantener el stack.

**Dónde Power BI gana en costo, y hay que decirlo:** para una empresa chica (decenas de usuarios, sin equipo de plataforma dedicado), el costo de las horas de alguien manteniendo 11 piezas open source puede superar fácilmente el costo de la licencia de Microsoft — "cero costo de licenciamiento" no es lo mismo que "cero costo". Este proyecto tiene sentido económico real a partir de la escala donde el ahorro en licencias supera el costo de operación — no antes.

## 13. Migración desde Power BI existente — el hueco más grande que falta llenar

**Señalado por dos revisiones externas como una omisión seria, y con razón: en la práctica, migrar medidas, reportes y usuarios ya existentes suele ser el 80% del costo real de "reemplazar Power BI"** — no construir la plataforma nueva. Este documento, hasta ahora, le dio menos espacio a esto que al wrapper de ECharts (capa 8).

**Lo que ya existe, disperso en varios documentos de capa, y que se puede juntar en una guía de migración real más adelante:**
- Traducción de medidas DAX simples y de time-intelligence a Cube (`04-semantico.md`, ejemplos de `time_shift`).
- Traducción de una medida DAX compleja con iteración fila-por-fila a un modelo SQLMesh + conteo en Cube (`02-transformacion.md`/conversación de diseño — el patrón de "precalcular en SQLMesh, contar en Cube").
- El camino de promoción de infraestructura de portátil a nube (`11-infraestructura.md`, sección 4.4 en adelante) — relevante para migrar datos existentes, no medidas.

**Lo que falta, y queda como trabajo pendiente explícito, no resuelto todavía:**
- Un inventario de qué construcciones de DAX no tienen traducción directa a Cube (calculation groups, relaciones activas/inactivas, semi-aditividad, jerarquías padre-hijo tipo organigrama) y qué hacer en cada caso — precalcular en SQLMesh, aceptar la limitación, o evaluar si esa medida puntual necesita Cube Cloud (MDX/DAX, ver `04-semantico.md`).
- Un plan concreto para migrar usuarios y permisos existentes (de Entra ID/Azure AD hacia better-auth) sin interrumpir el acceso durante la transición.
- Un plan de convivencia: cómo corren Power BI y esta plataforma en paralelo mientras se migra reporte por reporte, en vez de un corte total de un día para el otro.

Este documento no resuelve esos tres puntos todavía — los deja anotados como la continuación lógica de este proyecto, una vez que las 12 capas estén implementadas y no solo documentadas.

---

## 15. Registro: análisis de producto de dos chats externos (ChatGPT), incorporado

Además de la auditoría de gobernanza/hechos (sección 10) y la ronda de ideas de otros BI (sección 11), se revisaron dos análisis de estrategia de producto independientes, que aportaron:

- **La Capa 12 (Metadata/Catálogo/Lineage)** — señalada como hueco por tres fuentes independientes en total (las dos auditorías + este análisis), resuelta con OpenMetadata; riesgo de gobernanza corregido en una ronda posterior (ver `12-metadata-gobernanza.md`, sección 3.0 — no es un proyecto de la Linux Foundation, es Collate Inc. la que se unió como miembro corporativo, riesgo residual documentado igual que dlt y Cube).
- **El plan de implementación de la sección 5.1** — separación producto/infraestructura y la distribución de esfuerzo, adaptada como guía, no copiada como presupuesto fijo.
- **El desglose completo del Authoring Engine** en `08-frontend.md`, sección 11 — Canvas (GridStack.js, riesgo documentado), componentes base (shadcn-svelte + Tailwind v4, sin riesgo — código copiado, no dependencia viva), sidebar colapsable a íconos con árbol de jerarquías propio, command palette, principios de diseño Linear/Vercel/Figma, y el backlog explícito de lo que todavía falta (Interaction Engine, State Engine, modos de uso).
- **Los conceptos semánticos faltantes** en `04-semantico.md`, sección 6.4 — jerarquías, calendario fiscal, parámetros, y la honestidad sobre lo que no tiene traducción directa (calculation groups, semi-aditividad).

## 16. Índice de documentos de capa

- [x] `01-motor-almacenamiento.md`
- [x] `02-transformacion.md` — + Input Tables (Sigma)
- [x] `03-ingesta.md` — + CDC en tiempo real (Qlik)
- [x] `04-semantico.md` — + exploración asociativa (Qlik) + conceptos semánticos faltantes (jerarquías, calendario fiscal, parámetros)
- [x] `05-cerebro-ia.md` — + entrega proactiva de insights (Tableau Pulse)
- [x] `06-api-gateway.md` — + escritura + Action Hub (Looker)
- [x] `07-orquestacion.md`
- [x] `08-frontend.md` — + Qlik, Sigma, SQL Lab, ThoughtSpot + Authoring Engine completo (Canvas, componentes, sidebar, diseño)
- [x] `09-auth-gobernanza.md` — + certificación de datos (Tableau)
- [x] `10-colaboracion-realtime.md` — + comentarios anclados (varios)
- [x] `11-infraestructura.md`
- [x] `12-metadata-gobernanza.md` — capa nueva, OpenMetadata

**Estado del proyecto:** las 12 capas están documentadas a fondo, con exigencia real aplicada a cada elección (comparación honesta, gobernanza sin excepciones, lo mejor de cada líder de BI del mercado, dos rondas de auditoría externa con hallazgos verificados y corregidos, y un análisis de producto que definió dónde poner el esfuerzo real de ingeniería).

## 17. Documentos de implementación (no son capas nuevas — resuelven huecos identificados en la auditoría)

- [x] `IMPLEMENTATION.md` — referencia compacta y accionable, para leer antes que la narrativa.
- [x] `13-recorrido-end-to-end.md` — un dato real de punta a punta, con nombres de archivo reales.
- [x] `14-interaction-state-engine.md` — diseño de cross-filter/drill-down/drill-through y undo/redo, backlog que quedaba sin resolver en la capa 8.
- [x] `15-testing-cicd.md` — estrategia de testing por capa, tests de contrato entre capas, y pipeline de CI/CD del monorepo.
- [x] `16-mvp-definicion-terminado.md` — qué entra y qué no entra en la primera versión, con checklist y script de demo de aceptación.
- [x] `17-self-service-calculations.md` — cómo el usuario que arma un dashboard crea sus propias medidas (Visual Builder + Semantic SQL de Cube Core + IA), sin aprender un lenguaje nuevo.
- [x] `18-first-class-citizens.md` — capacidades de plataforma vs. herramientas que las implementan hoy.
- [x] `19-operabilidad-runtime.md` — topología, `pnpm dev`, migraciones, seed, health checks, Report Document Model.
- [x] `20-product-ui-ux.md` — arquitectura de experiencia y anatomía del Report Builder.
- [x] `21-engineering-standards.md` — normativo: inglés en el código, versionado por contrato, Puertos y Adaptadores.
- [x] `22-visualization-engine.md` — visualización analítica premium como diferenciador: Visualization Engine, Visual Intelligence, Design System, Motion, Custom Component Studio (HTML + CSS + Vanilla JS) y Custom Visual SDK. Visión y contratos; no entra en el MVP.

**Con estos cinco documentos, el proyecto pasa de "arquitectura decidida" a "listo para que alguien empiece a programar".** Listo para pasar a Claude Code.
