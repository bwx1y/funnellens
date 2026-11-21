# Repository Guidelines

## Project Overview
Multi-tenant backend REST API built with [Bun](https://bun.sh), [Elysia](https://elysiajs.com), [Drizzle ORM](https://orm.drizzle.team), and PostgreSQL. Provides authentication, tenant provisioning, JWT session management, and Scalar OpenAPI documentation.

## Architecture & Data Flow
Modular Monolith layered architecture with unidirectional dependency rule:
- `modules/` may import `infra/` and `shared/`.
- `infra/` and `shared/` must never import from `modules/`.
- All database queries and schema access are centralized under `src/infra/database/`.

```
HTTP Request
  └─► Elysia Router (src/routes.ts -> src/modules/*/index.ts)
        ├─► Schema Validation (TypeBox schema.ts)
        ├─► Route Hooks & Guards (beforeHandle / JwtUtil.isAuthenticated)
        └─► Controller / Module Router
              └─► Service Layer (src/modules/*/service.ts)
                    ├─► Shared Utilities (@shared/*: password, jwt, errors, logger)
                    └─► Repositories (@db/repositories/*.ts)
                          └─► Drizzle ORM + PostgreSQL Schema (@db/schema/**)
```

- **Global Handling**: `src/index.ts` traps `AppError` subclasses, Elysia `VALIDATION`, and `NOT_FOUND` errors, normalizing responses to `{ status: boolean, message: string, ... }`.
- **Swagger / OpenAPI**: Mounted at `/docs` (Scalar provider) when `NODE_ENV === "development"`.

## Key Directories
- `src/config/`: Runtime environment parser and default fallback configs (`@config/*`).
- `src/shared/`: Pure stateless helpers (`@shared/*`: `errors.ts`, `jwt.ts`, `logger.ts`, `password.ts`).
- `src/infra/`: Stateful services and external infrastructure integrations (`@infra/*`):
  - `ai/`: AI adapters (e.g. Gemini).
  - `mail/`: Email client & HTML templates (`templates/`).
  - `queue/`: Queue and worker manager with BullMQ.
  - `redis/`: Redis connection client.
  - `database/`: Database client, migrations, schemas, and repositories (`@db/*`).
    - `schema/`: Drizzle schemas organized by domain (`core/`, `ads/`, `wa/`, `enums.ts`).
    - `repositories/`: Centralized database repositories (`base.repository.ts`, `*.repository.ts`).
    - `migration/`: Drizzle Kit migration SQL files and metadata snapshots.
- `src/modules/`: Feature domain modules (`@modules/*`): `auth/`, `campaign/`, `meta/`, `profile/`, `user/`, `wa/`.
- `scripts/`: Operational/maintenance scripts (e.g. `scripts/db-drop.ts`).
- `playground/`: Sandbox testing scripts and HTML/PHP utilities.

## Development Commands
- **Run dev server**: `bun run dev` (runs `src/index.ts` with hot reloading).
- **Generate migrations**: `bun run db:generate` (`drizzle-kit generate`).
- **Push schema to DB**: `bun run db:push` (`drizzle-kit push`).
- **Drop DB schema**: `bun run db:drop` (`bun run scripts/db-drop.ts`).
- **Reset DB**: `bun run db:reset` (`bun run scripts/db-drop.ts && drizzle-kit push --force`).
- **Open Drizzle Studio**: `bun run db:studio` (`drizzle-kit studio`).
- **Run tests**: `bun test` (native Bun runner).

## Code Conventions & Common Patterns
- **Naming Conventions**:
  - Entities: `[Name]Entity` and `[Name]Relationship` in `src/infra/database/schema/[domain]/[name].entity.ts`.
  - Repositories: `[Name]Repository` in `src/infra/database/repositories/[name].repository.ts`.
  - Modules: Grouped by feature under `src/modules/[feature]/` with `index.ts`, `service.ts`, `schema.ts`.
  - Utilities: Helper functions and static classes in `src/shared/`.
- **Validation**: Declarative TypeBox schema definitions using Elysia `t.Object(...)` inside `schema.ts`. Infer payload types via `UnwrapSchema<typeof Schema[key]>`.
- **Error Handling**: Throw typed `AppError` subclasses from `@shared/errors` (`BadRequestError`, `UnauthorizedError`, `ConflictError`, `NotFoundError`, `ForbiddenError`). Never return ad-hoc error status objects inside services.
- **Dependency & State Management**:
  - Elysia plugins use `.derive()` and `.decorate()` to inject context (e.g. `JwtUtil.isAuthenticated`, `authService`).
  - Repositories inherit from `DatabaseRepository` (`@db/repositories/base.repository`) for database connection access.
- **Path Aliasing**:
  - `@/*` -> `./src/*`
  - `@config/*` -> `./src/config/*`
  - `@infra/*` -> `./src/infra/*`
  - `@db/*` -> `./src/infra/database/*`
  - `@shared/*` -> `./src/shared/*`
  - `@modules/*` -> `./src/modules/*`

## Important Files
- `src/index.ts`: Application entrypoint, global error filters, middleware, and HTTP listener.
- `src/routes.ts`: Master route aggregator mounting module sub-routers under `/api`.
- `src/config/index.ts`: Environment variable mapping and defaults.
- `drizzle.config.ts`: Drizzle CLI configuration (PostgreSQL dialect, schema glob, output directory).
- `src/infra/database/index.ts`: Database client pool instantiation (`db`, `queryClient`).
- `src/infra/database/repositories/base.repository.ts`: Base repository class.
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

## Git Commit Rules
- **Commit after every finished task**: once a task's changes are verified (typecheck + relevant tests), commit them before reporting done. Never leave a verified task uncommitted.
- Commit only the files changed by the task; never `git add -A` or stage unrelated work-in-progress.
- When creating git commits, NEVER add `Co-Authored-By` trailers or mention OpenCode/AI in the commit message.
- Do NOT override `user.name` or `user.email` in git config or via `-c` flags.
- Group changes logically by feature and create separate commits for each feature.
- Use clean, standard commit messages describing only the implemented features.