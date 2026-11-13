# Repository Guidelines

## Project Overview
Multi-tenant backend REST API built with [Bun](https://bun.sh), [Elysia](https://elysiajs.com), [Drizzle ORM](https://orm.drizzle.team), and PostgreSQL. Provides authentication, tenant provisioning, JWT session management, and Scalar OpenAPI documentation.

## Architecture & Data Flow
Layered module architecture with unidirectional data flow:

```
HTTP Request
  └─► Elysia Router (src/routes.ts -> src/modules/*/index.ts)
        ├─► Schema Validation (TypeBox schema.ts)
        ├─► Route Hooks & Guards (beforeHandle / JwtUtil.isAuthenticated)
        └─► Controller / Module Router
              └─► Service Layer (src/modules/*/service.ts)
                    ├─► Password / JWT Utilities (src/utils/*)
                    └─► Repository Layer (src/database/repository/*.ts)
                          └─► Drizzle ORM + PostgreSQL (src/database/entity/*.ts)
```

- **Global Handling**: `src/index.ts` traps `AppError` subclasses, Elysia `VALIDATION`, and `NOT_FOUND` errors, normalizing responses to `{ status: boolean, message: string, ... }`.
- **Swagger / OpenAPI**: Mounted at `/docs` (Scalar provider) when `NODE_ENV === "development"`.

## Key Directories
- `src/config/`: Runtime environment parser and default fallback configs.
- `src/database/entity/`: Drizzle schema definitions and table relations (`*.entity.ts`).
- `src/database/repository/`: Abstract base client (`repository.ts`) and entity-level data access classes (`*.repository.ts`).
- `src/database/migration/`: Drizzle Kit migration SQL files and schema metadata snapshots.
- `src/modules/auth/`: Auth domain containing routing (`index.ts`), business logic (`service.ts`), and request schemas (`schema.ts`).
- `src/utils/`: Shared cross-cutting modules for errors (`error/`), JWT tokens (`jwt/`), and hashing (`password/`).

## Development Commands
- **Run dev server**: `bun run dev` (runs `src/index.ts` with hot reloading).
- **Generate migrations**: `bun run db:generate` (`drizzle-kit generate`).
- **Push schema to DB**: `bun run db:push` (`drizzle-kit push`).
- **Open Drizzle Studio**: `bun run db:studio` (`drizzle-kit studio`).
- **Run tests**: `bun test` (native Bun runner).

## Code Conventions & Common Patterns
- **Naming Conventions**:
  - Entities: `[Name]Entity` and `[Name]Relationship` in `src/database/entity/[name].entity.ts`.
  - Repositories: `[Name]Repository` in `src/database/repository/[name].repository.ts`.
  - Modules: Grouped by feature under `src/modules/[feature]/` with `index.ts`, `service.ts`, `schema.ts`.
  - Utilities: `[Name]Util` in `src/utils/[name]/index.ts`.
- **Validation**: Declarative TypeBox schema definitions using Elysia `t.Object(...)` inside `schema.ts`. Infer payload types via `UnwrapSchema<typeof Schema[key]>`.
- **Error Handling**: Throw typed `AppError` subclasses from `src/utils/error/` (`BadRequestError`, `UnauthorizedError`, `ConflictError`, `NotFoundError`, `ForbiddenError`). Never return ad-hoc error status objects inside services.
- **Dependency & State Management**:
  - Elysia plugins use `.derive()` and `.decorate()` to inject context (e.g. `JwtUtil.isAuthenticated`, `authService`).
  - Repositories inherit from `DatabaseRepository` for database connection access.
- **Path Aliasing**: Use `@/*` pointing to `./src/*` for all internal imports.

## Important Files
- `src/index.ts`: Application entrypoint, global error filters, middleware, and HTTP listener.
- `src/routes.ts`: Master route aggregator mounting module sub-routers under `/api`.
- `src/config/index.ts`: Environment variable mapping and defaults.
- `drizzle.config.ts`: Drizzle CLI configuration (PostgreSQL dialect, schema glob, output directory).
- `src/database/repository/repository.ts`: Database client pool instantiation and base repository class.
- `.env.example`: Template for required environment variables.

## Runtime/Tooling Preferences
- **Runtime**: Bun (>= 1.1) is mandatory. Do not use Node.js or npm/yarn/pnpm.
- **Package Manager**: `bun install` / `bun add`.
- **Crypto & Password**: Uses native `Bun.password` with `bcrypt`.
- **Database Driver**: `postgres` (postgres.js) with `drizzle-orm/postgres-js`.

## Testing & QA
- **Test Runner**: Native Bun test runner (`bun test`).
- **Test Locations**: Place unit and integration tests alongside modules as `*.test.ts` or inside `tests/`.
- **Route Smoke Testing**: Test Elysia endpoints directly via `app.handle(new Request(...))` without spinning up a live network port.
