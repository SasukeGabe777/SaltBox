# @saltbox/database

The authoritative persistence boundary for SaltBox (ADR-004 model, ADR-005
PostgreSQL/Neon, ADR-006 Kysely + `pg` + node-pg-migrate).

## Layout

```text
migrations/       authoritative ordered PostgreSQL SQL history (the schema's source of truth)
generated/        Kysely database interface generated from the migrated catalog; never hand-edited
client/           Kysely construction over pg (Node direct; Workers/Hyperdrive adapter comes later)
queries/          reusable query modules (point-in-time cutoff extraction, ...)
repositories/     domain-facing persistence operations and transaction boundaries
testing/          disposable-database harness and migration/invariant/transaction tests
scripts/          trusted local/CI tooling (migrate, codegen/verify)
```

## Development workflow

All commands run from the repository root with Node 24 and pnpm:

```text
pnpm db:up              start local PostgreSQL 18 (Docker, port 5433, saltbox/saltbox)
pnpm db:migrate         apply the ordered migration history to the local database
pnpm db:migrate:create  scaffold a new ordered SQL migration (pass the slug as an argument)
pnpm db:codegen         rebuild generated/db.ts from a disposable migrated database
pnpm db:verify          fail if generated/db.ts no longer matches the migrations
pnpm -r check           type-check (includes this package)
pnpm test               run the database test suite (requires db:up)
pnpm db:down            stop and delete the local database volume
```

`DATABASE_URL` overrides the default local connection string. Tooling that
creates and drops disposable databases (codegen/verify and the test harness)
refuses non-local hosts unless `SALTBOX_ALLOW_REMOTE_DB_TOOLING=1` is set
deliberately. Migrations are applied only by these scripts or CI — never by
application startup or a Worker request (ADR-006). `db:migrate down` exists as
a single-step convenience for local development only; shared-database repair is
forward-only (new migrations plus restore).

## Schema change workflow

1. Scaffold a new ordered `.sql` file with `pnpm db:migrate:create <slug>`
   (UTC-timestamp prefix; applied migrations are immutable — corrections are
   new forward migrations). Migrations run inside a transaction with an
   advisory lock by default; PostgreSQL DDL that cannot run transactionally
   (e.g. `CREATE INDEX CONCURRENTLY`) requires an isolated TypeScript
   migration calling `pgm.noTransaction()` plus extra review (ADR-006).
2. `pnpm db:migrate` against a disposable/local database and review the SQL.
3. `pnpm db:codegen` to regenerate `generated/db.ts`; commit both together.
4. `pnpm db:verify` and `pnpm test` must pass; CI treats a stale generated
   interface as a failure.

## Boundaries

- Repositories expose explicit input/result shapes and map them from generated
  row types; Kysely, `pg`, Hyperdrive, and Neon types never leak upward.
  A dedicated domain-model package is deliberately deferred until the first
  application service needs one; until then the repository modules own their
  domain-facing shapes.
- Prospect lifecycle state changes only through
  `repositories/prospects.ts#transitionProspect` (allowed-transition map,
  optimistic revision, appended transition, same-transaction domain event).
- Suppression checks (`repositories/suppressions.ts`) must run before any
  outreach action; positive eligibility never overrides an active suppression.
- Events append through `repositories/events.ts#appendEvent` with a stable
  idempotency scope/key; duplicate deliveries return the recorded event.
- Point-in-time learning queries (`queries/point-in-time.ts`) always apply
  both the fact-time and recorded/availability-time cutoffs.

## Deliberately not here yet

Neon provisioning, Cloudflare Hyperdrive/Worker adapters, backup jobs, object
storage, and any production credentials or data. Those require the separate
authorization ADR-005/006 call for.
