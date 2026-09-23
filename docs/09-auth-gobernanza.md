# Capa 9: Autenticación y Gobernanza

> Reemplazo: **workspaces/roles de Power BI Service → better-auth + RLS a nivel de base de datos + security context de Cube (capa 4)**

---

## 1. Responsabilidad única de esta capa

Autenticar usuarios, emitir sesiones/tokens verificables, y definir qué rol tiene cada uno dentro de cada organización/espacio de trabajo. No contiene lógica de negocio ni de visualización — solo responde una pregunta: "¿quién sos, y qué rol tenés?".

**Esta capa NO debe saber:**
- Nada de cómo se calcula una métrica (capa 4) ni de qué filas puede ver un rol específico en términos de negocio — esta capa entrega el *rol*, la capa 4 decide qué filas corresponden a ese rol vía su security context.
- Nada de cómo se renderiza nada en el frontend.

Si esta capa empieza a decidir directamente "el usuario X puede ver la región Norte" en vez de "el usuario X tiene el rol `analista_norte`", el diseño está roto — esa traducción de rol a filas visibles es responsabilidad de la capa semántica (capa 4), no de auth.

---

## 2. Qué reemplazamos y por qué

El sistema de permisos de Power BI (workspaces, apps, roles de RLS) es un sistema atado al ecosistema Microsoft (Entra ID/Azure AD como identidad de base). En el `.pbix` tradicional, las reglas de RLS quedaban ocultas dentro del binario, sin forma de revisar un cambio de seguridad de fila en un pull request. **Corrección de precisión:** con TMDL/PBIP, Power BI ya permite guardar los roles de RLS como texto versionable — la diferencia real con esta capa no es "Power BI no puede", es que acá el modelo de permisos vive en una tabla propia de este proyecto (`workspace_membership`, sección 6.2) además de en better-auth, con revisión de pull request como flujo por defecto, no como una capacidad adicional del ecosistema Microsoft que hay que adoptar aparte.

---

## 3. Defectos concretos que eliminamos

| Defecto | Por qué es un problema real |
| --- | --- |
| Sistema de permisos atado al ecosistema Microsoft | Migrar de identidad implica migrar todo el modelo de permisos junto |
| Reglas de RLS ocultas dentro del `.pbix` tradicional (TMDL/PBIP ya lo resuelve parcialmente, ver arriba) | Sin ese flujo activado, no hay revisión en pull request de un cambio de seguridad de fila |
| Workspaces como unidad rígida de organización | Estructura de permisos fija, difícil de adaptar a jerarquías de organización distintas |

---

## 4. better-auth — con la corrección de gobernanza aplicada, y un giro reciente a favor

### 4.1 El chequeo de gobernanza (regla 7 de `CLAUDE.md`)

better-auth nació en 2024 como el proyecto de un solo desarrollador (Bereket Engida), y a mediados de 2025 se convirtió en una startup con una ronda semilla de USD 5M (Y Combinator, Peak XV, entre otros) — en ese momento, habría sido exactamente el mismo patrón de riesgo que ya se descartó en las capas 6 y 8 (una empresa chica). **Pero el panorama cambió con un evento posterior: Vercel adquirió Better Auth**, incorporando al fundador y al equipo core. Hoy el proyecto tiene más de 4,7 millones de descargas semanales en npm y más de 850 colaboradores — pasó de ser "una startup chica" a estar respaldado por una de las empresas más grandes del ecosistema de infraestructura web (la misma que sostiene Next.js), con un nivel de adopción que ya lo vuelve, de hecho, un estándar del ecosistema TypeScript.

**No es una fundación** — sigue siendo una sola empresa la que lo sostiene. Pero está en la misma categoría que tRPC (capa 6): adopción tan masiva que el proyecto tiene inercia propia más allá de cualquier decisión de una sola empresa, y ahora respaldado por una compañía consolidada, no una startup en etapa semilla.

### 4.2 La alternativa de máxima seguridad de gobernanza: Keycloak

**Keycloak** es un proyecto **CNCF Incubating** desde abril de 2023 (Cloud Native Computing Foundation, bajo el paraguas de la Linux Foundation), con desarrollo activo de Red Hat y más de 12.000 colaboradores en el ecosistema — es, sin ninguna duda, la opción de gobernanza más sólida que existe en autenticación open source hoy.

El costo es real y concreto: Keycloak es un servidor de identidad completo, corre en la JVM (vía Quarkus), necesita su propia base de datos relacional, y en producción típica requiere 2-4 GB de RAM solo para el servicio de auth — es una pieza de infraestructura pesada, pensada para IAM empresarial complejo (multi-realm, federación LDAP/Active Directory, broker de identidades entre organizaciones). Para una plataforma de BI self-hosteada que ya tiene una arquitectura deliberadamente liviana (DuckDB embebido, servicios Node.js), levantar un servidor Java aparte solo para resolver login y roles es una desproporción real de complejidad operativa.

### 4.3 Comparación técnica directa

| Aspecto | better-auth | Keycloak |
| --- | --- | --- |
| Gobernanza | Vercel (empresa grande, no fundación) + adopción masiva (4,7M descargas/semana) | **CNCF Incubating**, Red Hat, máxima seguridad institucional |
| Arquitectura | Librería TypeScript embebida en la propia app (Node.js) | Servidor Java aparte, con su propia base de datos y proceso |
| Footprint operativo | Ninguno adicional — corre donde ya corre el resto del backend TS | Un servicio JVM completo, 2-4 GB de RAM mínimo |
| Encaje con el stack de este proyecto | Alto — TypeScript nativo, mismo lenguaje que la capa 6 y 8 | Bajo — introduce Java como lenguaje/runtime nuevo solo para esta capa |
| RBAC / organizaciones | Plugin `organization` maduro: roles, permisos, `hasPermission()`, control de acceso configurable | Nativo, con soporte de LDAP/SAML/OIDC completo, pensado para IAM de gran escala |
| Cuándo tiene sentido | Self-hosted, TypeScript-first, sin requerimiento de SSO empresarial complejo | Cuando ya existe una organización con LDAP/Active Directory/SAML que hay que federar |

### 4.4 Decisión para este proyecto: better-auth

1. **La gobernanza ya no es el riesgo que era** — la adquisición por Vercel resuelve exactamente la objeción que hizo caer a oRPC y LayerChart en capas anteriores.
2. **Coherencia total con el resto del stack de aplicación** (capas 6 y 8, ambas TypeScript) — no introduce un lenguaje ni un runtime nuevo solo para resolver login.
3. **El plugin de organizaciones, junto con una tabla propia de membresía por workspace, resuelve el equivalente funcional a workspaces/roles de Power BI** (ver la corrección de la sección 6.2 — `team` de better-auth no da roles propios por equipo de fábrica, así que el rol por workspace se modela aparte): usuarios pertenecen a una organización (better-auth) y a uno o más workspaces con un rol propio en cada uno (tabla `workspace_membership` de este proyecto), verificado antes de armar el security context — como código, versionado, no oculto en un binario.

**Cuándo sí Keycloak:** si la organización que adopte esta plataforma ya tiene una identidad corporativa federada (Active Directory, SAML de otro proveedor) y necesita que este BI se integre a ese sistema existente en vez de tener su propio directorio de usuarios, Keycloak es la elección correcta — el costo operativo se justifica porque ya es una pieza estándar de la infraestructura de identidad de la empresa, no una nueva.

---

## 5. Qué agregamos que Power BI no tiene

- **Permisos como código, versionados en Git** junto al resto del proyecto, no ocultos en un `.pbix`.
- **Auditoría propia y completamente controlada** — el log de quién hizo qué vive en la base de datos propia del proyecto, no en un servicio externo.
- **Independencia de un proveedor de identidad único**: better-auth soporta múltiples proveedores OAuth/OIDC sin atar la plataforma a Microsoft Entra ID como única puerta de entrada.

---

## 6. Arquitectura interna de esta capa

```mermaid
flowchart LR
    A[Usuario] -->|login| B[better-auth]
    B -->|sesion/JWT: SOLO user_id + organization_id| C[API Gateway - capa 6]
    C -->|consulta| M[(workspace_membership: que puede HACER)]
    C -->|consulta| N[(data_entitlements: que datos puede VER)]
    C -->|firma un JWT corto con CUBEJS_API_SECRET| D["Authorization: JWT header hacia Cube"]
    D --> F["Cube Core - capa 4: decodifica el JWT, arma su propio securityContext, aplica RLS"]
    F --> G["Postgres: RLS nativo sobre tablas operativas, si aplica"]
```

### 6.1 De identidad a filas visibles: dos preguntas separadas, nunca una — corregido

**Segunda corrección sobre este mismo flujo, más profunda que la anterior — señalada por una revisión externa.** La corrección previa ya separó "quién sos" (better-auth) de "qué rol tenés en este workspace" (`workspace_membership`, resuelto por request). Pero seguía quedando una mezcla real: el `workspace_role` se traducía **directo** a un filtro de fila (`WHERE region = 'Norte'`) — como si "ser viewer" implicara automáticamente "ver solo la región Norte". Eso no es cierto en general: dos usuarios pueden tener el mismo `workspace_role` (`viewer`) y necesitar ver **datos distintos** (Juan ve Norte, Pedro ve Sur) — con un solo campo de rol, la única forma de resolver eso es inventando roles combinados (`viewer_norte`, `viewer_sur`), que es exactamente lo que se quiere evitar.

**La corrección: separar en dos preguntas, con dos tablas distintas, combinadas recién en el security context final.**

1. **`workspace_role`** (`workspace_membership`, ya definida en la sección 6.2) responde **qué puede hacer** alguien — ver, editar, certificar, administrar. Nunca decide qué filas ve.
2. **`data_entitlements`** (tabla nueva, esta sección) responde **qué datos puede ver** — independiente del rol:

```sql
CREATE TABLE data_entitlements (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    dimension    TEXT NOT NULL,   -- 'region', 'area', etc. — coincide con una dimensión real de Cube
    values       TEXT[] NOT NULL, -- ['Norte'] o ['La Paz', 'El Alto']
    PRIMARY KEY (user_id, workspace_id, dimension)
);

-- Juan y Pedro son los dos 'viewer' en workspace_membership, pero ven datos distintos:
-- (juan_id, 'comercial', 'region', ARRAY['Norte'])
-- (pedro_id, 'comercial', 'region', ARRAY['Sur'])
```

**El flujo completo, corregido:**

1. **better-auth** autentica y certifica identidad y tenant únicamente: `{ user_id, organization_id }` — nunca un rol, nunca un entitlement.
2. **La API Gateway (capa 6)**, en cada request, resuelve **las dos cosas por separado**: `workspace_role` desde `workspace_membership`, y `data_entitlements` desde la tabla de arriba, ambas para el `workspace_id` de la solicitud concreta.
3. La Gateway arma el security context combinado: `{ user_id, organization_id, workspace_id, workspace_role, entitlements: { region: ['Norte'] } }`.
4. **La Gateway firma un JWT corto** (con `CUBEJS_API_SECRET`, la clave que Cube ya usa para verificar tokens) conteniendo ese security context como payload, y lo envía en el header `Authorization` de la llamada a Cube — **nunca como un campo `securityContext` suelto dentro de las opciones de `load()`**. Es el mecanismo de autenticación de **REST/GraphQL** (`checkAuth`, JWT verificado, no un parámetro de conveniencia) — el **SQL API** (`/v1/cubesql`, usado por el Editor de SQL avanzado, `17-self-service-calculations.md`) usa un mecanismo distinto (`checkSqlAuth`), pendiente de validar empíricamente antes de darlo por implementado — no generalizar "JWT en Authorization" como si aplicara a las dos superficies de Cube por igual.
5. **Cube Core (capa 4)** usa `entitlements.region` (no `workspace_role`) dentro de su YAML para el filtro de fila real — el rol nunca entra en esa ecuación. `workspace_role` sí puede usarse en Cube para decidir qué medidas/dimensiones están permitidas (control de qué puede *hacer*), pero es una regla separada de la de filas.
6. Si además hay tablas operativas consultadas directo (fuera del camino de Cube), **RLS nativo de Postgres** aplica la misma lógica de `entitlements`, no de `workspace_role`, como capa adicional de defensa.

**Por qué el rol (ni los entitlements) pueden vivir en el JWT de sesión de better-auth (paso 1):** un usuario puede tener rol y entitlements distintos en cada workspace — el JWT de sesión es una verdad estática de identidad, válida mientras dura la sesión; el rol y los entitlements son datos de negocio que dependen de *qué* workspace se está consultando ahora mismo, y se resuelven en cada request (paso 2), nunca de antemano.

### 6.2 `organization` ≠ `workspace` — corrección de un error real de modelado, en dos rondas

**Corrección de un error nuevo, señalado por una revisión externa posterior a la primera corrección de esta sección.** La primera ronda dijo "usar `team` de better-auth como workspace, con un rol propio por equipo" — pero **better-auth no da un rol independiente por `team` de fábrica**. Verificado contra el código y la documentación del proyecto: la tabla `teamMember` solo tiene `teamId` y `userId` como columnas de identidad — no tiene una columna de rol propia. Los roles viven a nivel de **miembro de la organización** (`member`, con `organizationRole`/`hasPermission()`), no a nivel de equipo. De hecho, hay una discusión abierta en el propio repositorio de better-auth ("Multiple teams and multiple roles") donde alguien está prototipando, a mano, agregar un campo de rol a `teamMember` — porque hoy no existe.

**Esto significa que el ejemplo que este documento daba como ya resuelto no sale del modelo real:**

```
Delapaz
├── Comercial
│   └── Juan = admin      ← esto NO lo da better-auth de fábrica
└── Finanzas
    └── Juan = viewer     ← el rol de Juan en better-auth es uno solo, a nivel de organización
```

**La corrección real: `team` sigue sirviendo para *agrupar* miembros (es útil, y se mantiene), pero el rol por workspace se modela con una tabla propia, encima de better-auth, no dentro de él:**

| Capa | Qué resuelve |
| --- | --- |
| `organization` de better-auth | Identidad/tenant — a qué empresa pertenece el usuario |
| `team` de better-auth | Agrupación de miembros dentro de la organización (útil para invitaciones, listados) — pero sin rol propio |
| **`workspace_membership` (tabla propia de este proyecto)** | `user_id`, `workspace_id`, `role` — acá vive el rol real por workspace |

```sql
-- Tabla propia, no una extensión de better-auth
CREATE TABLE workspace_membership (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    role         TEXT NOT NULL,  -- 'admin' | 'editor' | 'analyst' | 'viewer' — nunca 'data_steward' acá, ver sección 9.1
    PRIMARY KEY (user_id, workspace_id)
);

-- Permisos de gobernanza: independientes del rol, otorgables uno por uno (sección 9.1)
CREATE TABLE workspace_permissions (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    permission   TEXT NOT NULL,  -- 'certify_metric' | 'sql_lab_access' | 'manage_glossary' | 'manage_quality'
    PRIMARY KEY (user_id, workspace_id, permission)
);

-- Ejemplo: Juan es admin en Comercial y viewer en Finanzas,
-- y además tiene el permiso de certificar métricas en Finanzas sin ser admin ahí
-- workspace_membership:  (123, 'comercial', 'admin'), (123, 'finanzas', 'viewer')
-- workspace_permissions: (123, 'finanzas', 'certify_metric')
```

better-auth sigue haciendo lo que hace bien: autenticar y administrar la pertenencia a la organización. Los permisos de contenido por workspace — que es exactamente el problema que Power BI, Tableau y Looker resuelven con un modelo de autorización más rico que "member de un team" — los controla este proyecto con su propia tabla, consultada por la Capa 6 (API Gateway) antes de armar el security context que se le pasa a Cube (capa 4).

**Por qué esto no es "reinventar auth"**: la parte difícil y sensible (contraseñas, sesiones, OAuth, tokens) la sigue resolviendo better-auth entero, sin tocar nada de eso. Lo que se construye a mano es una tabla de autorización de negocio — el mismo tipo de tabla que cualquier plataforma con workspaces termina necesitando, esté o no basada en better-auth.



---

### 6.3 SQL Lab (capa 8): restringido por rol de confianza, no por un chequeo de texto

**Corrección de una solución insuficiente, señalada por una revisión externa.** DuckDB no tiene row-level security nativo, y validar por texto qué tablas referencia una consulta no es una barrera de seguridad real cuando se permite SQL arbitrario contra el mismo proceso (un `read_parquet()` con ruta directa, un `ATTACH`, o una extensión de red pueden saltarse esa validación sin pasar por el `FROM`/`JOIN` revisado). La corrección para el MVP: **SQL Lab queda habilitado solo para quien tenga el permiso de gobernanza `sql_lab_access`** (otorgable a un `analyst` o `admin` puntual, no un rol nuevo — sección 9.1) — nunca por defecto para un `viewer` común — hasta que exista un servicio de consulta aislado (proceso separado, extensiones deshabilitadas, límites de recursos) que sí sea una frontera de seguridad real. El detalle completo, incluida la fase futura, está en `08-frontend.md`, sección 10.3.

---

## 7. Contrato de esta capa (qué expone, qué consume)

- **Consume**: credenciales del usuario (email/password, OAuth) para autenticar.
- **Expone**: una sesión/JWT verificable con claims de **identidad y organización únicamente** (`user_id`, `organization_id`) — nunca un rol de workspace, que se resuelve por request contra `workspace_membership` (sección 6.1), no en el token.
- **No expone**: ninguna noción de qué filas de datos son visibles — eso lo resuelve la Gateway a partir de `data_entitlements` (sección 6.1), nunca del `workspace_role`, y nunca de un dato certificado de antemano en el token.
- **El API Gateway (capa 6) valida la identidad del token localmente** (sin preguntarle a esta capa por cada request) **y consulta `workspace_membership` (qué puede hacer) y `data_entitlements` (qué puede ver) por separado para resolver el security context de ese workspace específico** — dos preguntas distintas, dos tablas distintas, nunca una combinada en un solo campo de rol.

---

## 8. Por dónde empezar a construir (paso a paso concreto)

1. `pnpm add better-auth` dentro de `packages/auth`.
2. Configurar un solo proveedor (email/password) y confirmar login/logout básico antes de sumar OAuth.
3. Agregar el plugin `organization`, crear una organización de prueba, y una tabla propia `workspace_membership` (`user_id`, `workspace_id`, `role`) — dos workspaces de prueba (`comercial`, `finanzas`) con roles distintos para el mismo usuario, confirmando que el rol de uno no se filtra al otro.
4. Conectar la validación de token en la API Gateway (capa 6), reemplazando el stub que se usó en esa capa mientras esta no existía.
5. Definir el primer security context real en Cube Core (capa 4): un `data_entitlements` de prueba (ej. `region = 'Norte'`) que filtre una métrica ya existente — nunca mapeando el rol `viewer` directo a un filtro, para no repetir el error ya corregido en la sección 6.1. Confirmar además que un segundo usuario, con el mismo `workspace_role` pero un `data_entitlements` distinto, ve un recorte de filas diferente.
6. Recién con ese flujo probado de punta a punta, evaluar si hace falta sumar SSO/SAML vía un proveedor adicional o, si la organización ya tiene identidad federada, migrar esta capa a Keycloak.

---

## 9. Idea rescatada de otro líder de BI: certificación de datos (Tableau)

Tableau permite que un "data steward" marque una fuente de datos o un dashboard como **certificado** — una insignia verde visible en toda la plataforma, con una nota de por qué se puede confiar en ese contenido, quién lo certificó y cuándo. Los recursos certificados aparecen primero en las búsquedas. Es exactamente la señal de confianza que le falta a un catálogo grande de métricas: no toda tabla ni todo dashboard tiene el mismo nivel de revisión, y hoy nada en este proyecto distingue "esto lo revisó alguien" de "esto lo armó alguien ayer a la tarde".

### 9.1 Por qué es gobernanza, no una función de la Capa 8

**Corrección de un modelo de roles que mezclaba dos cosas distintas, señalada por una revisión externa.** La versión anterior trataba `data_steward` como si fuera un rol de workspace más, al mismo nivel que `admin`/`analista`/`viewer` — eso obliga a inventar combinaciones cada vez más específicas (¿`data_steward_analista`? ¿`data_steward_admin`?) a medida que aparecen más capacidades especiales. La corrección: separar **rol de workspace** (qué tan amplio es el acceso day-to-day de alguien) de **permiso de gobernanza** (una capacidad puntual, otorgable a cualquier rol):

| Nivel | Ejemplos | Dónde vive |
| --- | --- | --- |
| Rol de organización (better-auth, nativo) | `owner`, `admin`, `member` | Identidad/tenant — quién administra la cuenta de la empresa |
| Rol de workspace (`workspace_membership`, tabla propia) | `admin`, `editor`, `analyst`, `viewer` | Cuánto acceso day-to-day tiene alguien dentro de un workspace específico |
| **Permiso de gobernanza** (otorgable, independiente del rol) | `certify_metric`, `sql_lab_access`, `manage_glossary`, `manage_quality` | Una tabla propia (`workspace_permissions`: `user_id`, `workspace_id`, `permission`) — no un rol nuevo por cada capacidad |

Con esto, un `analyst` puede tener el permiso `certify_metric` sin ser `admin` — no hace falta inventar un rol combinado para cada combinación posible, y otorgar/revocar una capacidad puntual es una fila más en una tabla, no un cambio de rol completo.

- **Quién puede certificar**: cualquier usuario con el permiso `certify_metric` en ese workspace — no un rol fijo llamado "data steward".
- **Qué se certifica**: una tabla `mart_*` (capa 2) o una métrica de Cube (capa 4) — nunca una tabla `stg_*`/`int_*` interna, porque esas no son parte del contrato público de ninguna capa.
- **El registro de auditoría**: una tabla propia (`gobernanza.certificaciones`: recurso, certificado_por, nota, fecha, estado), versionada como cualquier otro dato de esta capa — quién certificó qué y por qué queda escrito, no en la memoria de una persona.

### 9.2 Una mejora real sobre el original: certificación continua, no una insignia que se olvida

Tableau certifica una vez y la insignia queda ahí indefinidamente, aunque la fuente de datos se rompa después. Este proyecto puede hacerlo mejor sin esfuerzo adicional, porque ya tiene la pieza que lo resuelve: los *audits* de SQLMesh (capa 2) ya corren en cada `plan`/`apply`. Si el audit de una tabla certificada empieza a fallar, el mismo pipeline (orquestado por Airflow, capa 7) marca automáticamente esa certificación como `revocada` — sin esperar a que alguien con el permiso `certify_metric` se acuerde de revisarla a mano.

### 9.3 Conexión con el "SQL Lab" de la Capa 8

Cuando una consulta exploratoria de SQL Lab se repite seguido y se promueve a una medida oficial en Cube (capa 8, sección 10.3), la certificación es el paso natural que cierra ese flujo: alguien con el permiso `certify_metric` revisa el pull request, lo aprueba, y de paso certifica la métrica resultante — quedando visible para todo el mundo que ese número, a diferencia de una exploración suelta, ya pasó por revisión.

---

**Siguiente documento:** `10-colaboracion-realtime.md` — ElectricSQL para colaboración multiplayer sobre el mismo dashboard.
