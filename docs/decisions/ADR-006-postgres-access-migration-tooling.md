# ADR-006 — PostgreSQL Access and Migration Tooling

- **Status:** Accepted
- **Date:** 2026-08-26
- **Research date:** 2026-08-26

## Context

ADR-003 places SaltBox's initial server runtime on Cloudflare Workers. ADR-004 defines a relational current-state model plus append-oriented observations, feature sets, scores, decisions, events, experiment exposures, suppressions, costs, and commercial history. ADR-005 accepts PostgreSQL as the database technology, Neon as the initial provider, and a thin Cloudflare Hyperdrive adapter as the preferred production connection path.

The remaining decision is how TypeScript code will describe and query PostgreSQL and how schema changes will be created, reviewed, tested, and applied. This is not merely a CRUD ergonomics decision. SaltBox must preserve database-enforced invariants, issue PostgreSQL-native analytical and point-in-time queries, support multiple transactional workers, and keep a legible history of every schema change.

The tooling must work for Windows development with Node 24 and pnpm, but migration execution does not need to run inside a Worker. Migrations will run from trusted local, CI, or administrative Node tooling through a direct PostgreSQL connection.

## Decision

SaltBox will use this stack:

```text
Query builder:        Kysely
Runtime driver:       node-postgres (`pg`)
Migration runner:     node-pg-migrate
Migration format:     ordered PostgreSQL SQL files by default
Database types:       generated from a migrated disposable PostgreSQL database
Production transport: `pg` through Cloudflare Hyperdrive
```

The database schema's authoritative history is the ordered migration set, not an ORM model, a live Neon database, or generated TypeScript. Kysely provides type-safe query construction without replacing PostgreSQL semantics. `kysely-codegen`, which Kysely's documentation identifies as a production type-generation option, will derive the database interface from a disposable local/test database after the migrations have been applied.

Domain types remain separate from generated database row types. Repository functions translate between them. Neither Kysely, `pg`, Hyperdrive, nor Neon types may leak into domain-service contracts.

## Why this architecture fits SaltBox

SaltBox needs more than model-oriented create/read/update/delete operations. It will use joins, common table expressions, window functions, conditional upserts, `RETURNING`, row locks, exact numeric values, JSONB operators, partial/expression indexes, exclusion or check constraints where justified, cohort aggregations, and timestamp cutoffs. Kysely is a typed SQL query builder rather than an active-record or unit-of-work abstraction, and its `sql` template can express raw PostgreSQL fragments or complete statements when the builder becomes counterproductive.

The migration path deliberately remains separate from runtime query ergonomics:

- PostgreSQL SQL in Git makes constraints, indexes, lock implications, data backfills, and destructive operations visible during review.
- `node-pg-migrate` orders migrations, checks ordering, tracks applied versions, uses an advisory lock, and runs migrations transactionally by default.
- Exceptional PostgreSQL operations that cannot run in a transaction, such as `CREATE INDEX CONCURRENTLY`, require an isolated, explicitly non-transactional migration and additional review.
- Kysely types are derived from the database produced by those migrations, so TypeScript describes the real migrated schema rather than an independently maintained approximation.

## Sources of truth

There are three related artifacts with intentionally different authority:

1. **Ordered migration files** are the authoritative schema history and production change mechanism.
2. **The current PostgreSQL catalog** is the authoritative runtime schema after applying that history.
3. **Generated Kysely database types** are a reproducible compile-time projection of that catalog.

Generated database types are checked into Git for deterministic builds and review, but never edited manually. A mismatch is fixed by correcting or adding a migration and regenerating the types—not by editing the generated interface.

Application/domain validation remains useful at boundaries. It does not replace `NOT NULL`, foreign-key, unique, check, exclusion, or other database constraints required to preserve ADR-004 invariants.

## Candidate evaluation

### Kysely + node-pg-migrate — selected

Kysely is a type-safe TypeScript SQL query builder. It infers selected columns, joins, aliases, subqueries, and common table expressions while retaining a parameterized `sql` template for arbitrary SQL. Its PostgreSQL dialect uses `pg`, and Cloudflare currently lists Kysely as supported by Hyperdrive. See the [Kysely introduction](https://www.kysely.dev/docs/intro), [raw SQL guidance](https://www.kysely.dev/docs/recipes/raw-sql), and [Cloudflare PostgreSQL driver guidance](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/).

Kysely requires a database schema type. Its official documentation recommends generating that definition for production applications and lists `kysely-codegen` as an introspection-based option. SaltBox will generate against a disposable PostgreSQL database built entirely from the committed migrations, never by introspecting production as the normal development workflow. See [Kysely type generation](https://www.kysely.dev/docs/generating-types).

Kysely includes a capable migrator with database locking and ordered TypeScript migrations. SaltBox will not select it as the primary migration path because its standard files are executable TypeScript schema-builder programs rather than SQL-first review artifacts, and its optional CLI is outside the core. See [Kysely migrations](https://www.kysely.dev/docs/migrations).

`node-pg-migrate` is PostgreSQL-specific, uses `pg`, supports ordered SQL/TypeScript migrations, checks ordering, records applied migrations, takes a PostgreSQL advisory lock, and uses transactions by default. It also supports constraints, indexes, functions, views, types, policies, extensions, and explicit non-transactional migrations. See its [CLI reference](https://salsita.github.io/node-pg-migrate/cli), [migration behavior](https://salsita.github.io/node-pg-migrate/migrations/), and [SQL migration loading](https://salsita.github.io/node-pg-migrate/migration-loading-strategies).

The selected tools run as ordinary Node tooling and fit the repository's Node 24/pnpm environment. They do not require a migration binary inside Workers. A single documented pnpm command should hide platform-neutral path/config details from Windows developers and coding agents while still printing the actual migration actions and failures.

**Assessment:** strongest combination of TypeScript query safety, SQL transparency, PostgreSQL fidelity, migration control, low runtime overhead, and provider portability. Its cost is a multi-tool workflow and a generated-type verification step.

### Drizzle ORM + Drizzle Kit

Drizzle is a thin TypeScript schema/query layer with PostgreSQL-native column, index, and constraint support. Its query builder and parameterized `sql` template are suitable for complex queries, and it supports transactions, savepoints, isolation configuration, and raw SQL. Cloudflare has an official Drizzle + Hyperdrive example using `pg`, while Drizzle also supports Neon's serverless driver. See [Drizzle SQL](https://orm.drizzle.team/docs/sql), [transactions](https://orm.drizzle.team/docs/transactions), [indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints), and [Cloudflare's Drizzle guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/).

Drizzle Kit can compare TypeScript schema snapshots and generate checked-in SQL migrations. It supports custom SQL migrations and tracks applied files. This is materially better than automatic schema synchronization. See [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate), [custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations), and [`drizzle-kit migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate).

SaltBox would still need to treat generated SQL and snapshot metadata as a second schema representation and establish additional migration-history controls. Drizzle also exposes `drizzle-kit push`, which updates a live schema without producing migration files. That workflow is useful for disposable prototypes but is prohibited for every shared, test, staging, and production SaltBox database. See [`drizzle-kit push`](https://orm.drizzle.team/docs/drizzle-kit-push).

**Assessment:** best integrated runner-up and simpler for ordinary application tables. It loses because SaltBox values an explicitly PostgreSQL-first migration history more than a single TypeScript schema DSL, and because its migration workflow needs more guardrails for the long-lived learning dataset.

### SQL-first `pg` + node-pg-migrate

This option uses parameterized `pg` queries directly and the same selected SQL-first migration runner. It has maximum PostgreSQL fidelity, minimal runtime overhead, excellent Hyperdrive compatibility, and no query abstraction to outgrow. Cloudflare currently recommends `pg` for PostgreSQL through Hyperdrive. `pg` also exposes explicit client-scoped transactions and parameterized queries. See [Cloudflare's supported-driver guidance](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/), [node-postgres queries](https://node-postgres.com/features/queries), and [transactions](https://node-postgres.com/features/transactions).

The weakness is systematic TypeScript maintenance. Every row, insert, update, alias, nullable outer join, and analytical result either needs a hand-authored type, validation, or an additional SQL-code-generation tool. With ADR-004's entity count, that creates repetitive drift risk and reduces the value of compiler-guided changes for coding agents.

**Assessment:** excellent fallback and always available below Kysely. It loses because Kysely adds substantial compile-time query safety without obscuring SQL or changing the driver and migration foundation.

### Prisma + Prisma Migrate

Prisma provides excellent generated TypeScript client ergonomics and a mature ecosystem. Prisma Migrate produces customizable SQL migration files, supports a development/production command split, uses advisory locking, and supports raw SQL and TypedSQL. Cloudflare documents Prisma with Hyperdrive through `@prisma/adapter-pg`. See [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate), [development and production workflows](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production), [raw queries](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries), and [Cloudflare's Prisma guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/).

Prisma's model/client abstraction is optimized for model-centric application queries. SaltBox's historical cutoffs, cohort queries, locking/claim patterns, advanced indexes, and analytical SQL would use escape hatches frequently. The generated client plus driver-adapter layer is also more runtime and conceptual machinery than Kysely over `pg`, and the Prisma schema becomes another abstraction that must represent PostgreSQL-specific design.

**Assessment:** strongest high-level ORM candidate, but a poor default abstraction boundary for a system whose correctness and learning value depend on visible PostgreSQL behavior.

## Weighted decision matrix

Scores are 1–10, where 10 is best. Weights were fixed from SaltBox's stated priorities before totals were calculated. Migration quality receives the largest weight because a faulty change can damage the non-reproducible learning asset. PostgreSQL fidelity and SQL transparency follow because constraints and historical queries are correctness mechanisms. TypeScript, Workers, custom queries, transactions, and agent reliability carry the next tier; runtime cost, maintainability, maturity, and portability distinguish otherwise capable options.

| Criterion | Weight | Kysely + node-pg-migrate | Drizzle | SQL-first `pg` | Prisma |
| --- | ---: | ---: | ---: | ---: | ---: |
| PostgreSQL fidelity | 10 | 10 | 9 | 10 | 7 |
| TypeScript ergonomics | 8 | 9 | 9 | 5 | 10 |
| SQL transparency | 10 | 10 | 9 | 10 | 6 |
| Migration quality | 12 | 10 | 8 | 9 | 9 |
| Workers compatibility | 8 | 9 | 10 | 10 | 8 |
| Neon/Hyperdrive compatibility | 7 | 9 | 10 | 10 | 8 |
| Custom-query capability | 8 | 10 | 9 | 10 | 7 |
| Transaction support | 7 | 10 | 9 | 10 | 9 |
| Runtime overhead | 6 | 10 | 10 | 10 | 6 |
| Agent/developer reliability | 8 | 8 | 9 | 7 | 9 |
| Maintainability | 7 | 9 | 9 | 6 | 8 |
| Ecosystem maturity | 5 | 8 | 8 | 10 | 10 |
| Vendor portability | 4 | 10 | 9 | 10 | 7 |
| **Weighted total** | **100** | **9.44** | **9.04** | **8.96** | **7.99** |

The narrow gaps are credible: all four can connect to PostgreSQL and ship production systems. Kysely wins specifically because it combines SQL-level control with strong inferred query types while allowing the migration system to remain PostgreSQL-first. Drizzle is the runner-up because it offers the best integrated TypeScript schema experience, but integration is less valuable than an independently reviewable, robust migration history for SaltBox.

## Runtime driver and Cloudflare strategy

`pg` is the selected runtime driver below Kysely. Cloudflare currently recommends `pg` for Hyperdrive and lists Kysely, Drizzle, and Postgres.js as supported. Current Workers documentation requires Node.js compatibility for database drivers; for compatibility dates from 2026-08-04, the compatibility layers are enabled by default, while older projects must opt into `nodejs_compat`. SaltBox will use a current compatibility date and verify the exact deployed runtime rather than assuming local Node behavior. See [Cloudflare's PostgreSQL connection guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/).

The runtime boundary is:

```text
domain/application service
          ↓
repository/query interface
          ↓
Kysely
          ↓
Kysely PostgresDialect + pg
          ↓
Workers: Hyperdrive connection string
Node/local/admin: direct PostgreSQL connection string
```

The Workers adapter owns client construction, request-scoped lifecycle, timeouts, error normalization, and transaction entry. Hyperdrive owns the pooled origin connections. Application code does not instantiate Neon clients or consume Neon-specific result types.

Migrations, bulk maintenance, backups, and long-running analytical exports connect directly to PostgreSQL from Node tooling. They do not run through a Worker or Hyperdrive.

If a measured incompatibility makes Hyperdrive unsuitable for a required transaction or streaming operation, a separate adapter may use Neon's serverless driver. That is a transport fallback, not permission to change repositories or domain interfaces.

## Query conventions and raw SQL

Kysely's builder is the default for inserts, updates, deletes, ordinary joins, conditional filters, and composable repository queries. Raw SQL is an intentional first-class escape hatch, not a failure.

Raw or partially raw SQL is appropriate for:

- recursive or complex common table expressions;
- window functions and cohort/experiment aggregations;
- point-in-time feature and outcome extraction;
- PostgreSQL locking and job-claim patterns;
- `ON CONFLICT` forms not cleanly expressed by the builder;
- JSONB, array, full-text, range, or extension-specific operators;
- complex bulk inserts or `COPY`-adjacent administrative paths;
- query-plan experiments and carefully optimized hot paths; and
- maintenance or migration SQL.

Runtime SQL must remain parameterized through Kysely's `sql` tag or `pg` parameter arrays. Unescaped concatenation of untrusted values is prohibited. Dynamic identifiers require a closed allowlist because bind parameters cannot represent table or column names.

Analytical queries may return purpose-built result types rather than pretending they are persisted entities. Complex SQL belongs in named query modules with tests and `EXPLAIN`/plan inspection where performance matters.

## Migration strategy

### Authoring

- Migration names use monotonically ordered UTC timestamps plus a descriptive slug.
- Plain PostgreSQL `.sql` migrations are the default.
- Every migration has an explicit up path. A down path is included only when reversal is safe and honest; restore or a forward repair is preferred for destructive/data-dependent changes.
- A TypeScript migration is allowed only when runner control is required, such as calling `pgm.noTransaction()` for PostgreSQL DDL that cannot run in a transaction. The database change inside it remains explicit SQL where practical.
- Migrations are frozen historical artifacts and may not import current application, domain, repository, or generated database-type modules.
- Schema changes and required data backfills are separated when that reduces locks or deployment risk.
- Constraint and index names are explicit and stable.
- Applied migrations are immutable. Corrections are new forward migrations.

### Review

Every migration review must consider:

- data loss, table rewrites, and irreversible changes;
- lock level and expected lock duration;
- nullable-to-required transitions and backfill order;
- index build strategy and duplicate-index risk;
- foreign-key validation strategy for large tables;
- uniqueness/idempotency invariants from ADR-004;
- timestamp, money, and JSONB semantics;
- query-plan effects on historical and operational queries; and
- compatibility with the currently deployed application during rollout.

Generated or tool-assisted SQL is never accepted without human/agent review of the actual statements.

### Verification

Before a migration is eligible for production:

1. Apply the complete ordered history to an empty local/test PostgreSQL database.
2. Apply only the new migrations to a database representing the previous application version.
3. Run schema, repository, invariant, transaction, and representative point-in-time query tests.
4. Generate the Kysely database types from the resulting database.
5. Run the generator's verification mode and fail if regenerated types differ from the checked-in generated artifact.
6. Inspect migration status/order and, for risky changes, rehearse against production-like data volume.

The implementation phase should add an explicit schema fingerprint or catalog assertion if type generation alone proves insufficient to detect drift.

### Application

- Development uses the same migration runner against disposable local PostgreSQL databases.
- CI or a separately authorized administrative release step applies production migrations with a direct database connection and a migration-capable role.
- `node-pg-migrate` ordering checks and advisory locking remain enabled.
- Transactional execution remains the default. A non-transactional migration is isolated and requires explicit release approval and recovery instructions.
- Application startup and Worker request handlers never apply migrations.
- Production deploys must not silently infer or synchronize schema changes.

## Prohibited workflows

The following are prohibited for any shared, test, staging, or production database:

- `drizzle-kit push`, `prisma db push`, or an equivalent direct model-to-database synchronization command;
- automatically applying migrations when a Worker starts or receives a request;
- running unreviewed generated SQL;
- editing or deleting an already-applied migration;
- manually editing generated Kysely database types;
- introspecting production and treating the result as the new schema authority;
- placing production credentials in repository files, client bundles, or migration definitions;
- bypassing database constraints because application validation exists; and
- using ORM relation helpers as a substitute for explicit transaction and query-plan design.

Rapid experiments may use a disposable developer database, but any change intended to survive must be represented by an ordered migration before it is shared.

## Repository boundary after approval

The next implementation phase should converge on a boundary like:

```text
packages/database/
├── migrations/       authoritative ordered SQL; rare controlled TS migration
├── generated/        generated Kysely database interface; never hand-edited
├── client/           Kysely construction and pg/Hyperdrive adapters
├── queries/          reusable SQL/query-builder operations
├── repositories/     domain-facing persistence interfaces and mapping
└── testing/          migration, invariant, transaction, and fixture utilities
```

There is intentionally no second hand-maintained `schema/` DSL. The migration history defines the schema; the generated database interface projects it into TypeScript. Domain models live outside this package.

Repositories own aggregate and transaction boundaries, not one class per table. A prospect-history query may join Business, Prospect, Observation, FeatureSet, LeadScore, Decision, Event, and CostEntry without being forced through a chain of model objects. Cross-repository transactions receive an explicit transaction-scoped database context.

## Point-in-time and analytical queries

Kysely must not hide the timestamp predicates required by ADR-004. Query modules will explicitly distinguish event/observation time from SaltBox recording/availability time and apply the historical cutoff before joining outcomes. Reusable helpers may reduce repetition, but they cannot infer a cutoff from current state.

Training exports, cohort analysis, CAC calculations, and experiment evaluation may use SQL views, materialized views, or raw queries only after those physical choices are separately reviewed. The initial authoritative database remains one PostgreSQL database; this ADR does not add a warehouse or analytics ORM.

## Risks and mitigations

### Biggest risk: generated-type drift and multi-tool complexity

The selected approach uses migrations, a migration runner, a type generator, Kysely, and `pg` rather than one integrated ORM. A developer or coding agent could forget to regenerate types or could generate them from the wrong database.

Mitigations:

- one documented command builds a disposable database, migrates it, generates types, and verifies a clean diff;
- generated files carry a do-not-edit header and deterministic formatting;
- CI verifies generation from a fresh migration replay;
- no manual database changes are part of the normal workflow; and
- runtime repositories depend only on the generated interface and explicit domain mappings.

### Migration safety risk

Even explicit SQL can lock a large table or destroy data. Reviewability is not correctness. Risky migrations require production-like rehearsal, lock/statement timeouts, staged expand/backfill/contract changes, and recovery instructions. Those operational policies are implementation work, not automatic features of the selected runner.

### Type-system limits

Generated table types do not prove arbitrary raw SQL result types at runtime. Raw-query boundaries require explicit result types and runtime validation when data crosses a trust boundary or type mismatch would be material.

## Conditions for reconsideration

Revisit Kysely or the migration stack if any of these occurs:

- Kysely cannot express or safely parameterize a recurring core query without pervasive untyped casts;
- generated database-type verification remains nondeterministic or causes repeated schema/type drift incidents;
- Cloudflare removes reliable `pg`/Kysely Hyperdrive support or measured runtime overhead becomes material;
- `node-pg-migrate` cannot support a required PostgreSQL migration or fails migration-order/locking expectations in rehearsal;
- two migration incidents within six months are attributable to tooling behavior rather than migration design;
- migration replay for a fresh database exceeds ten minutes and tooling, rather than schema/data volume, is the measured bottleneck;
- Drizzle reaches demonstrably stronger migration-history controls while eliminating the selected stack's multi-tool failure modes; or
- raw `pg` queries become more than roughly one third of non-analytical repository queries, indicating Kysely is providing too little value.

A provider change from Neon does not itself trigger reconsideration because the selected stack uses standard PostgreSQL and `pg`.

## High-level implementation plan

After ADR-006 is reviewed and accepted, the next task should be:

1. Create `packages/database`.
2. Add the selected dependencies.
3. Establish the local PostgreSQL/development connection strategy.
4. Implement the ADR-004 physical schema.
5. Create the first ordered migration.
6. Implement database constraints and invariants.
7. Build the Kysely persistence adapter and repository boundary.
8. Write migration, repository, transaction, and invariant tests.
9. Provision Neon only after local schema validation.
10. Validate Cloudflare Worker and Hyperdrive integration.

None of those steps is authorized by this proposed ADR.

## Consequences

### Benefits

- PostgreSQL SQL and constraints remain visible and authoritative.
- Kysely supplies strong TypeScript query inference without imposing model-centric persistence.
- `pg` follows Cloudflare's recommended Hyperdrive path and remains provider-portable.
- SQL-first migrations are reviewable, replayable, lockable, and usable from Windows/Node CI tooling.
- Raw SQL remains natural for historical, analytical, and concurrency-sensitive operations.
- Generated types make schema changes compiler-visible without creating a competing hand-maintained schema source.

### Tradeoffs

- The workflow has more components than Drizzle or Prisma alone.
- Type generation requires a migrated PostgreSQL database, not just source-file parsing.
- Relationships and domain mapping are explicit; there is no identity map or automatic graph persistence.
- Developers and coding agents must understand PostgreSQL and migration safety rather than relying on ORM defaults.

## Intentionally deferred

This ADR does not create a package, dependency, database, schema, migration, repository, client, environment variable, credential, Neon project, Hyperdrive configuration, Worker binding, API, test database, CI workflow, or production data. Exact package versions, PostgreSQL version, local container/process choice, type-generation command, migration configuration, schema design, and deployment workflow will be pinned during the separately authorized implementation task.

## Research snapshot

Official documentation reviewed on 2026-08-26:

- Kysely: [introduction](https://www.kysely.dev/docs/intro), [raw SQL](https://www.kysely.dev/docs/recipes/raw-sql), [migrations](https://www.kysely.dev/docs/migrations), [transactions API](https://kysely-org.github.io/kysely-apidoc/classes/TransactionBuilder.html), and [type generation](https://www.kysely.dev/docs/generating-types).
- node-pg-migrate: [CLI](https://salsita.github.io/node-pg-migrate/cli), [migration behavior](https://salsita.github.io/node-pg-migrate/migrations/), [SQL loaders](https://salsita.github.io/node-pg-migrate/migration-loading-strategies), and [programmatic API](https://salsita.github.io/node-pg-migrate/api).
- Drizzle: [SQL escape hatch](https://orm.drizzle.team/docs/sql), [transactions](https://orm.drizzle.team/docs/transactions), [constraints/indexes](https://orm.drizzle.team/docs/indexes-constraints), [`generate`](https://orm.drizzle.team/docs/drizzle-kit-generate), [`migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate), and [`push`](https://orm.drizzle.team/docs/drizzle-kit-push).
- Prisma: [Migrate](https://www.prisma.io/docs/orm/prisma-migrate), [development/production workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production), [raw SQL](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries), and [driver adapters](https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers).
- Cloudflare: [PostgreSQL/Hyperdrive drivers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/), [Drizzle](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/), and [Prisma](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/).
- Neon: [serverless driver and ORM/query-builder compatibility](https://neon.com/docs/serverless/serverless-driver).
- node-postgres: [queries](https://node-postgres.com/features/queries), [transactions](https://node-postgres.com/features/transactions), and [pooling](https://node-postgres.com/features/pooling).
