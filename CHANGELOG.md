# Changelog

Versionado del producto según [`docs/21-engineering-standards.md`](docs/21-engineering-standards.md)
§2: SemVer `0.MINOR.PATCH` hasta 1.0; los contratos (API, Report Schema, Config Schema, DB
Migration…) versionan por separado y se listan en cada release.

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
