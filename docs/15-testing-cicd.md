# Documento de implementación: testing y CI/CD del conjunto

> Cada capa ya menciona su propio mecanismo de test (audits de SQLMesh, unit tests de Cube, etc.), pero nadie definió cómo se prueba que las 12 capas siguen funcionando **juntas** después de un cambio. Este documento lo resuelve, apoyado en la estructura de monorepo (pnpm + Turborepo) ya definida en `00-documentacion-general.md`.

---

## 1. La pirámide de testing de este proyecto

```
                    ▲
                   /E2E\           ← pocos, lentos, todo el stack real (sección 4)
                  /------\
                 /Contrato\        ← por par de capas, el contrato de CLAUDE.md (sección 3)
                /----------\
               /   Unit     \      ← muchos, rápidos, por paquete (sección 2)
              /--------------\
```

**Regla general: cuanto más cerca de la base, más tests y más rápido tienen que correr.** Un cambio en `packages/transform` no debería esperar 10 minutos de E2E para saber si rompió algo — debería fallar en segundos con un unit test local.

---

## 2. Tests unitarios, por paquete (ya parcialmente documentados, acá se consolidan)

| Paquete | Mecanismo | Ya documentado en |
| --- | --- | --- |
| `packages/transform` | *Unit tests* de SQLMesh (`tests/*.yaml`, contra fixtures, DuckDB en memoria) + linter con la regla propia de §6.1.2 + *audits* (`not_null`, `unique_values`, `accepted_values`) + test de alerta del parche temporal de DuckLake — todo en `pnpm test`; `plan`/`run`/`audit` contra lakehouses descartables con los dos catálogos en `pnpm test:integration` | `02-transformacion.md` §6.4–6.5 |
| `packages/ingestion` | `pytest` sobre cada `@dlt.resource`, con la fuente real mockeada (nunca pegarle a la API real en CI) | `03-ingesta.md` (implícito, formalizado acá) |
| `packages/semantic` | **Implementado en el Paso 3.** En `pnpm test`, contra un Cube falso: el módulo de conexión al lakehouse (el mismo `.cjs` que carga Cube, probado tal cual), la sonda de salud y la firma de *tokens*. En `pnpm test:integration`, con un Cube y un Cube Store propios por suite, en la red interna del stack, sobre un lakehouse descartable: <br>• números idénticos a los que lee el puerto de lectura de la plataforma, incluidos inteligencia de tiempo, join y pre-agregación sin escribir en el lago; <br>• autenticación del SQL API, la batería de *pushdown* y los tests de alerta de `17` §3.2.2; <br>• modos de falla (catálogo o S3 con credenciales incorrectas, error genérico al cliente, logs sin secretos) y la ausencia de ruta a Internet; <br>• desde el Paso 4, la RLS: los recortes de cada usuario (con los números del puerto de lectura), sobre la pre-agregación y el join, tokens rechazados por REST y por SQL, y una conexión SQL que no sobrevive a su token. <br>`cube validate` no se adoptó: el modelo compila en el Cube real de cada suite de integración | `04-semantico.md` §6.6, `17-self-service-calculations.md` §3.2.2 |
| `packages/api-gateway` | Tests de cada procedimiento tRPC con un cliente de prueba, mockeando Cube | Nuevo |
| `apps/web` | Tests de componente (Vitest + Testing Library) para lógica de `InteractionState`/`CommandStack` (`14-interaction-state-engine.md`) | Nuevo |
| `packages/auth` | **Implementado en el Paso 4.** En `pnpm test`: el armado del security context (denegar por defecto, filas inconsistentes descartadas, el rol nunca decide filas), los *claims* del token de identidad (cualquier *claim* extra lo invalida) y la configuración mínima de better-auth. En `pnpm test:integration`, contra bases descartables con las migraciones reales: <br>• contrato del esquema (lo commiteado es exactamente lo que emite el planificador de better-auth, y no pide nada más); <br>• usuarios, contraseñas (errores indistinguibles, sin ecos), sesiones y el token de identidad (*payload* exacto, adulterado, sin firmar, de otro despliegue, después de cerrar sesión), sin ninguna llamada de red; <br>• rol por workspace, mismo rol con datos distintos, denegar por defecto, cruce de organizaciones y las restricciones de la base; <br>• el seed de accesos demo | `09-auth-gobernanza.md` §6–§8 |

**Regla de CI**: Turborepo ya sabe qué paquetes cambiaron en un PR (`turbo run test --filter=...[origin/main]`) — solo se corren los tests de los paquetes afectados y sus dependientes, no el monorepo entero en cada push.

---

## 3. Tests de contrato — el nivel que faltaba, y el más importante de agregar

**Qué prueban:** que el contrato explícito de `CLAUDE.md` (la tabla de "qué consume/qué expone" de cada capa) se sigue cumpliendo — no la lógica interna de una capa, sino la frontera entre dos.

| Contrato a probar | Cómo |
| --- | --- |
| `mart_*` de SQLMesh tiene el esquema que Cube espera | Test que corre `sqlmesh plan` (dry-run) contra una base de prueba y valida que las columnas que el YAML de Cube referencia existen |
| El modelo de Cube compila sin errores | `cube validate` (el CLI actual de Cube trae este comando específicamente para CI — corrección: la versión anterior de este documento mencionaba `cube.js test`, que no es el mecanismo vigente; verificar la sintaxis exacta contra la documentación de Cube al momento de implementar, dado que su CLI está en evolución activa) |
| Una medida devuelve el número correcto | Test de integración: cargar datos fijos conocidos en el warehouse de prueba, consultar la métrica vía la API de Cube, comparar contra el resultado esperado (`expect(await queryMetric('ventas.total_ventas')).toEqual(12345.67)`) — esto prueba lo que realmente importa, no que el YAML "compile" |
| El *security context* que arma la Capa 6 tiene la forma que Cube necesita | Test de `resolveSecurityContext` + `getMetric`, verificando la forma del objeto, no solo que no explote |
| El adaptador de la Capa 6 traduce correctamente al formato real de Cube | Test de `toCubeQuery()` (`13-recorrido-end-to-end.md`, paso 4) — el contrato propio (`{ metric, dimensions }`) siempre debe traducirse a `{ measures: [...], dimensions: [...] }`, nunca pasar directo |
| SQL Lab nunca puede tocar `mart_*` directo | Test que intenta ejecutar `SELECT * FROM mart_ventas` vía el procedimiento de SQL Lab con un usuario sin `sql_lab_access`, y espera un rechazo explícito |
| Los tipos de tRPC no se rompieron | Ya lo da gratis TypeScript — un `tsc --noEmit` en CI alcanza, no hace falta un test dedicado |
| Un modelo Python de SQLMesh no hace una llamada de red | Lint estático: un chequeo simple (grep o AST) que rechaza `import requests`/`httpx`/`urllib` dentro de `packages/transform` |

Estos tests viven en un paquete propio, `packages/contracts` (el mismo que `00-documentacion-general.md` ya reserva para tipos compartidos) — ahí tiene sentido que también vivan los tests que verifican que esos contratos se cumplen.

---

## 4. Tests end-to-end — el recorrido de `13-recorrido-end-to-end.md`, automatizado

El documento 13 describe a mano el camino "Salesforce → dlt → SQLMesh → Cube → chart". Ese mismo camino, corrido contra el **modo equipo local mínimo** (ver `16-mvp-definicion-terminado.md` para la corrección sobre qué significa "portátil" vs. este modo), es el test E2E de referencia:

1. Levantar el stack completo de test (un `podman compose up` de test, no el de producción).
2. **Corrección: nunca reemplazar la fuente por un CSV que "simula" la respuesta de Salesforce — eso deja de probar exactamente la frontera que más vale la pena probar.** Un CSV en vez de la fuente real prueba SQLMesh/Cube/frontend, pero no prueba que `salesforce_source()` (el código del verified source, paso 1 de `13-recorrido-end-to-end.md`) siga funcionando — autenticación, paginación, mapeo de campos. En vez de eso: levantar un **servidor HTTP de prueba** (un stub liviano, tipo `msw` o un servidor Express minimalista) que responde con la misma forma que la API real de Salesforce, y apuntar `salesforce_source()` a esa URL de prueba en vez de a `my.salesforce.com`. Así el código que corre en CI es exactamente el mismo que corre en producción — solo cambia el extremo de la red, nunca a internet real.
3. Correr el pipeline completo (ingesta → transformación → refresco semántico) una vez, sin esperar al cronograma de Airflow.
4. Consultar la métrica vía la Capa 6 y verificar el número exacto esperado.
5. (Opcional, más caro) un test de Playwright que abre el frontend, ve el chart, y verifica que el valor mostrado coincide.

**Frecuencia:** en cada PR que toque más de una capa de datos (2, 3, 4) — no en cada commit. En cada merge a `main`, siempre.

---

## 5. CI/CD — qué corre en cada etapa, con los comandos correctos de SQLMesh

**Corrección importante: `sqlmesh apply` no existe como comando independiente — nunca escribirlo así en un pipeline de CI.** El CLI real de SQLMesh tiene `plan`, `run`, `test`, `audit` — no `apply`. Un cambio de modelo se aplica **dentro** de `sqlmesh plan` (con `--auto-apply` en un entorno no interactivo, o de forma interactiva en desarrollo); la ejecución programada de un modelo ya desplegado es `sqlmesh run`, un comando distinto (ver `13-recorrido-end-to-end.md`, paso 6, para el detalle de por qué esto no es solo nomenclatura).

```
PR abierto
   │
   ├─ lint + format + typecheck (todo el monorepo, rápido)
   ├─ unit tests (solo paquetes afectados, vía Turborepo)
   ├─ integration tests (contra el Postgres/servicios reales del compose de test)
   ├─ tests de contrato (si el PR toca packages/transform, semantic, api-gateway o auth)
   ├─ sqlmesh plan dev --explain (evalúa el impacto del cambio, clasifica breaking/non-breaking — no despliega)
   ├─ sqlmesh test (unit tests de los modelos afectados)
   └─ E2E (solo si el PR toca más de una capa de datos)

Merge a main
   │
   ├─ todo lo de arriba, sin excepciones
   ├─ sqlmesh plan staging --auto-apply (acá sí se aplica — entorno de staging, no producción)
   ├─ despliegue de preview del frontend
   └─ actualización del catálogo de OpenMetadata (capa 12) desde staging

Release a producción (manual, con aprobación)
   │
   ├─ tofu plan (revisión humana del diff de infraestructura)
   ├─ tofu apply
   ├─ sqlmesh plan prod --auto-apply (despliega los cambios de modelo aprobados a producción)
   └─ smoke test post-deploy (una versión mínima del E2E de la sección 4, contra producción real)

Operación diaria (fuera de CI, disparado por Airflow — capa 7)
   │
   └─ sqlmesh run prod (procesa los intervalos de datos pendientes de los modelos YA desplegados)
```

**Herramientas fijadas al implementar el Paso 0:** "lint" es **ESLint** (OpenJS Foundation, flat config) + **typescript-eslint** con reglas que usan tipos, y hace cumplir por máquina parte de `21-engineering-standards.md` — convenciones de nombres (§8) e imports solo por la entrada pública de otro paquete (regla 2 de `CLAUDE.md`); "format" es **Prettier** (`pnpm format:check`); "typecheck" es `tsc --noEmit` por paquete vía Turborepo. TypeScript queda en 6.0.x mientras typescript-eslint no soporte TypeScript 7 (ver `versions.md`). Unit tests (`pnpm test`) nunca necesitan infraestructura; los que sí la necesitan viven en `test/integration/` y corren con `pnpm test:integration`.

**Por qué `sqlmesh plan --auto-apply` (no un `apply` suelto) nunca corre en CI de PR, solo en staging/producción con aprobación:** aplicar cambios de esquema contra un warehouse compartido desde CI automático sin revisión es exactamente el tipo de escritura no supervisada que este proyecto evita en otras capas (Input Tables, SQL Lab). `sqlmesh plan dev --explain` en el PR es información (clasifica el impacto); `sqlmesh plan staging/prod --auto-apply` es una acción, y las acciones sobre datos reales llevan un paso de merge/aprobación humana antes de correr — nunca en el momento de abrir el PR.

**SQLMesh ya tiene una integración oficial de CI/CD para GitHub** (el "GitHub Actions CI/CD Bot": tests automáticos por PR, entornos de PR, categorización y backfill automático de modelos cambiados, deploy a producción con prevención de gaps de datos) — no es obligatorio usarla, pero vale la pena evaluarla antes de construir el pipeline de arriba a mano, para no reinventar algo que SQLMesh ya resuelve.

---

## 6. Lo que este documento no resuelve, a propósito

Testing de carga/performance (cuántos usuarios concurrentes soporta el stack en modo nube) y testing de seguridad dedicado (penetration testing del Edge Connector Agent, capa 11) quedan fuera de este documento — son disciplinas propias, a definir cuando haya una versión desplegada real contra la cual medir, no contra un diseño en papel.
