# ADR-005 — Persistence and Database Selection

- **Status:** Accepted
- **Date:** 2026-08-26
- **Research date:** 2026-08-26

## Context

ADR-004 requires one authoritative relational data foundation for current business state plus append-oriented observations, feature sets, scores, decisions, transitions, events, experiment exposures, message attempts, suppressions, costs, and commercial outcomes. SaltBox must enforce transactional invariants while also supporting historical joins, point-in-time learning datasets, cohort analysis, and economical export.

The initial database should cost nothing or nearly nothing before revenue, remain operationally simple, work from Cloudflare Workers, and avoid a preventable migration when SaltBox's first-party learning data becomes valuable. Cost matters, but the cheapest storage tier is not economical if it makes suppression safety, concurrent job claims, analytical queries, or future model extraction fragile.

Provider pricing and limits are dated findings, not permanent guarantees. This ADR separates the database technology from its initial managed provider.

## Decision

SaltBox will use:

```text
Database technology: PostgreSQL
Initial managed provider: Neon
Initial topology: one authoritative transactional database
```

The decision is **PostgreSQL semantics first and Neon hosting second**.

- Core schema, migrations, SQL, identifiers, constraints, and data-access contracts must remain portable PostgreSQL.
- Neon branching, serverless transport, and restore tooling are operational conveniences, not domain dependencies.
- Cloudflare Workers will reach PostgreSQL only through a server-side persistence adapter. Production should prefer standard PostgreSQL connectivity through Cloudflare Hyperdrive when transaction/driver validation succeeds; a Neon-specific serverless transport is an allowed adapter fallback, not an application-wide API.
- Hyperdrive query caching must be disabled or bypassed for authoritative reads that require read-after-write correctness because Hyperdrive does not invalidate cached reads after writes.
- Browsers, public Astro code, and client bundles never receive database credentials or direct authoritative database access.
- Large HTML captures, screenshots, images, and generated assets do not belong in PostgreSQL. The database stores structured facts, hashes, metadata, and object references; an object-storage provider remains undecided.
- SaltBox starts with no warehouse, event database, search service, or read replica. It earns those components through measured need.

This ADR does not select an ORM, query builder, migration tool, physical schema, object store, queue, or backup destination.

## Decision drivers

Priority order is:

1. Correct relational and transactional behavior for ADR-004 invariants.
2. Point-in-time learning and historical/analytical query quality.
3. Near-zero initial cost and predictable growth.
4. Provider and data portability.
5. Operational simplicity and safe recovery.
6. Cloudflare Workers and TypeScript compatibility.
7. A scaling path through one million discovered businesses without mandatory early sharding.

## Workload and size assumptions

SaltBox's write pattern is mixed OLTP and append-oriented history. Current-state updates are relatively small, while observations, events, audit records, decisions, feature sets, message attempts, and costs accumulate continuously. Reads range from indexed queue claims and prospect timelines to wide cohort joins and point-in-time training exports.

Exact query volume cannot be known before implementation. For capacity comparison only, assume structured relational data plus indexes averages roughly **25–200 KB per discovered business** over time. The lower bound represents lean discovery and analysis; the upper bound includes repeated observations, messaging, event history, decisions, and index overhead. This is a planning envelope, not a quota or promise.

| Phase | Businesses | Illustrative structured database size | Likely dominant records |
| --- | ---: | ---: | --- |
| A | `<10,000` | `0.25–2 GB` | Businesses, identifiers, initial observations/analyses, features |
| B | `10,000–100,000` | `2.5–20 GB` | Repeated observations, events, attempts, decisions, indexes |
| C | `100,000–1,000,000+` | `25–200+ GB` | Longitudinal events/observations, messages, feature lineage, costs |

Raw source payloads and web/media artifacts could dwarf these amounts. ADR-004's retention policy is therefore essential: normalize useful facts, retain only justified raw evidence, and move large artifacts to object storage rather than bloating the transactional database.

## PostgreSQL versus SQLite-family semantics

| SaltBox concern | PostgreSQL | SQLite family (D1/Turso) |
| --- | --- | --- |
| Relationships and constraints | Rich types, foreign keys, unique/check constraints, mature planner | Capable relational model and constraints, but looser typing unless disciplined/STRICT |
| Transactions | Multi-statement interactive transactions and standard isolation levels | Correct ACID transactions; managed APIs may emphasize atomic batches and shorter transactions |
| Concurrent workers | MVCC permits concurrent readers/writers and row-level contention control | Many readers but traditionally one writer per database; managed variants queue/forward writes |
| Job claiming | Conditional updates, row locks, uniqueness, and transaction isolation support natural claims | Possible with compare-and-set/unique constraints, but writer serialization and API shape narrow options |
| Historical joins | Strong optimizer, window functions, aggregates, materialization options | SQL joins/window functions work, but large scans and managed limits become material sooner |
| Learning exports | Natural fit for wide relational extracts, snapshots, and future statistical tooling | Feasible at modest size; large cross-history extraction is more likely to require export or another system |
| JSON | Native `jsonb`, validation plus GIN/expression indexing | JSON functions over text/binary representation; fewer indexing/operator choices |
| Search | Built-in full-text types and GIN/GiST path before adding a search service | Basic indexed lookup is good; FTS capabilities and managed-provider support need provider-specific validation |
| Money | Exact `numeric`/`decimal` or integer minor units | Integer minor units are the safe portable choice; no equivalent native arbitrary-precision decimal storage class |
| Time | Native timezone-aware timestamps stored unambiguously | UTC integer/text conventions plus checks are application/schema responsibilities |
| Schema evolution | Mature transactional DDL and migration ecosystem | Simple locally, but some table changes require rebuild patterns and managed import constraints |
| Portability | Standard protocol and broad managed/self-hosted ecosystem | SQLite files are highly portable; D1/libSQL service APIs and extensions are not identical to local SQLite |
| Local development | Local PostgreSQL or isolated remote branch with strong production parity | Extremely easy local file/emulator workflow |

PostgreSQL wins for SaltBox because ADR-004 is not merely a key/value or page-delivery workload. It is a connected historical dataset whose value depends on concurrent transactional writes, exact semantics, complex cohort queries, and point-in-time feature extraction. PostgreSQL's MVCC allows reads and writes to proceed without the database-wide writer bottleneck of conventional SQLite, and its native JSONB, exact numeric, timezone-aware timestamp, UUID, and full-text facilities reduce application-level conventions. [PostgreSQL documents MVCC and transaction isolation](https://www.postgresql.org/docs/18/mvcc-intro.html), [exact numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html), [timezone-aware timestamps](https://www.postgresql.org/docs/current/datatype-datetime.html), [JSONB indexing](https://www.postgresql.org/docs/16/datatype-json.html), and [full-text indexes](https://www.postgresql.org/docs/current/textsearch-tables.html).

SQLite remains an excellent local/embedded technology and could operate early SaltBox phases. Its simplicity does not outweigh the likelihood that one shared SaltBox database will need richer concurrency and analytics. SQLite itself permits multiple readers but only one simultaneous write transaction. [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html) makes that boundary explicit.

## Candidate evaluation

### Cloudflare D1

D1 is the strongest operational-simplicity candidate. It is Workers-native, SQLite-compatible, scale-to-zero, has no egress charge, and uses a credential-free Worker binding rather than an Internet database password.

Current official limits and pricing:

- Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total account storage, but only 500 MB per database.
- Workers Paid: first 25 billion rows read/month, 50 million rows written/month, and 5 GB storage included; excess is currently `$0.001/million` rows read, `$1.00/million` rows written, and `$0.75/GB-month`.
- A paid D1 database has a non-increasable 10 GB maximum. Each database is single-threaded and processes queries one at a time; overload is queued and can eventually error.
- Query duration is limited to 30 seconds, with additional statement, row, parameter, and per-invocation query limits.

These figures come from Cloudflare's current [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

D1 enforces foreign keys and supports indexes and JSON query functions. Its Worker API is auto-commit oriented; `batch()` executes statements sequentially as one atomic transaction and rolls the batch back on failure. That is sufficient for many ADR-004 operations when combined with conditional updates and unique constraints, but it is less expressive than a normal PostgreSQL interactive transaction for workflows that read, decide, and write several related records. See Cloudflare's [foreign-key guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [JSON support](https://developers.cloudflare.com/d1/sql-api/query-json/), and [`D1Database` batch/session API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

D1 local development through Wrangler is easy and persists a local SQLite-compatible database. Sequential migrations and SQL export are built in. Production concurrency, query limits, and binding behavior still require remote tests; a local SQLite file cannot simulate single-database queue saturation. [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [SQL import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) are well documented.

Recovery is unusually strong at its price: always-on Time Travel retains 7 days on Free and 30 days on Paid at no added D1 charge. Restores currently overwrite the database in place, and longer-lived independent exports still matter. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

**SaltBox assessment:** excellent for Phase A operations, but a 500 MB free per-database cap, 10 GB paid hard cap, serialized execution, row-scan billing, and 30-second query ceiling make a single D1 database a likely migration or sharding problem during Phase B/C learning. Sharding by tenant/business would directly harm cross-business cohorts, suppression checks, entity resolution, and model-training exports.

### Neon Postgres

Neon provides standard PostgreSQL with independent storage and scale-to-zero compute. It preserves PostgreSQL protocol, SQL, roles, migrations, `pg_dump`/`pg_restore`, and logical-replication escape paths.

Current official pricing:

- Free: 0.5 GB storage per project, 100 CU-hours/month per project, compute up to 2 CU, automatic scale-to-zero after inactivity, branching/read replicas, and a restore window up to 6 hours or 1 GB of changes.
- Launch: usage-based with no fixed monthly minimum in the current model, `$0.106/CU-hour`, `$0.35/GB-month`, and up to 7 days of restore history. Neon publishes a typical intermittent 1 GB workload estimate around `$15/month`, not a guarantee.
- Scale extends compute, operational controls, and restore history to 30 days at higher compute rates.

See Neon's current [pricing page](https://neon.com/pricing) and [usage-based pricing explanation](https://neon.com/blog/new-usage-based-pricing).

Neon supports ordinary multi-statement PostgreSQL transactions, MVCC concurrency, constraints, exact numeric/time types, JSONB, search, and analytical SQL. Branches are copy-on-write development/test environments, while local PostgreSQL remains available for offline development and CI. A local PostgreSQL database gives better semantic parity than substituting SQLite for a PostgreSQL production schema; remote Neon branches can validate provider transport and extensions where necessary. See Neon's [branching guide](https://neon.com/docs/guides/branching-intro).

Cloudflare Workers can connect through Neon's HTTP/WebSocket serverless driver or through Cloudflare Hyperdrive using a standard PostgreSQL driver and Neon's unpooled origin connection. Hyperdrive supports Neon and provides edge connection pooling; it currently allows 100,000 queries/day on Workers Free and unlimited queries on Workers Paid. Hyperdrive operates in transaction-pooling mode and does not automatically invalidate cached reads after writes, so authoritative paths must use cache-disabled behavior. See the [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [Hyperdrive overview](https://developers.cloudflare.com/hyperdrive/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), and [Hyperdrive connection/caching behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/).

Recovery is the main free-tier weakness. Six hours is not enough long-term protection for SaltBox's learning asset. Once non-reproducible production data exists, SaltBox must combine Neon restore history with scheduled provider-independent logical exports and restore drills; upgrading to Launch supplies a seven-day window. Standard `pg_dump`/`pg_restore` and logical replication provide a credible provider exit. See Neon's [Postgres migration/export workflow](https://neon.com/docs/import/migrate-from-neon).

**SaltBox assessment:** best balance of durable technology semantics, zero-cost start, Workers compatibility, and low-exit-cost scaling. The 0.5 GB free storage limit may trigger paid usage relatively early, but upgrading capacity is materially safer than migrating database families.

### Supabase Postgres

Supabase provides a full managed PostgreSQL database. SaltBox could ignore its Auth, Storage, Realtime, Data API, and Edge Functions and use standard PostgreSQL connections only; bundled features receive no score unless SaltBox needs them later.

Current official pricing and recovery:

- Free: 500 MB database size, two active projects, 5 GB egress, and project pausing after roughly one week of low activity.
- Free does not include automatic downloadable backups or PITR; Supabase recommends regular off-site logical exports.
- Pro starts at `$25/month`, includes 8 GB disk per project, then `$0.125/GB-month`, prevents inactivity pausing, and retains seven days of daily backups.
- PITR is currently a separate add-on starting around `$100/month` per seven days of retention.

See [Supabase pricing](https://supabase.com/pricing), [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database backups](https://supabase.com/docs/guides/platform/backups), and [database/disk-size behavior](https://supabase.com/docs/guides/platform/database-size).

Workers/serverless traffic can use Supavisor's transaction-mode pooler; direct PostgreSQL connections remain appropriate for migrations, dumps, and long-lived tools. This is standard PostgreSQL at the data layer, but connection mode affects session features, prepared statements, and advisory locks. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

**SaltBox assessment:** technically excellent and the scorecard runner-up. It loses as the initial provider because its free tier can pause and lacks automatic backups, while the production step begins at `$25/month` and strong PITR is disproportionately expensive for SaltBox's current stage. The wider platform adds operational surface SaltBox has not selected. Its PostgreSQL foundation nevertheless makes it a credible future destination.

### Turso / libSQL

Turso is the strongest cost and local-development SQLite-family alternative. It offers a fetch-compatible edge client, local SQLite/libSQL workflows, branching, database tokens, and portable dumps/files.

Current official pricing:

- Free: 100 databases, 5 GB storage, 500 million rows read/month, 10 million rows written/month, and one day of PITR.
- Developer: `$5.99/month`, 9 GB included storage then `$0.75/GB`, 2.5 billion rows read then `$1/billion`, 25 million rows written then `$1/million`, and ten days of PITR.
- Scaler: `$29/month`, 24 GB included, larger read/write allowances, and 30 days of PITR.

See [Turso pricing](https://turso.tech/pricing?frequency=monthly) and [usage/billing semantics](https://docs.turso.tech/help/usage-and-billing). Row charging counts rows scanned, so missing indexes and analytical aggregates can consume allowances even when result sets are small.

Turso batches are atomic. The established libSQL path supports interactive transactions, but a write transaction locks the database for writing and has a five-second timeout. Turso's next-generation engine and concurrent-write capability are evolving; the current Cloud documentation describes libSQL as the production service and the next engine as alpha, so this ADR does not score preview concurrency as production capability. See the [TypeScript transaction reference](https://docs.turso.tech/sdk/ts/reference) and [current Turso Cloud architecture](https://docs.turso.tech/turso-cloud).

Local development is excellent: use a SQLite file or local libSQL server, and export a remote database as SQL or a SQLite snapshot. PITR creates a new database and can have a gap of up to 15 seconds before the selected time, so connection/token cutover is part of restore. See [local development/export](https://docs.turso.tech/local-development), [database export](https://docs.turso.tech/cli/db/export), and [PITR](https://docs.turso.tech/features/point-in-time-recovery).

**SaltBox assessment:** the generous free tier could serve Phase A and some Phase B workloads. It loses because a single shared SaltBox learning database does not benefit from database-per-tenant distribution, while serialized production writes, scan-priced analytics, SQLite typing/time conventions, and an evolving engine increase long-term correctness and migration risk.

## ADR-004 query and transaction fit

### Representative query fit

| Requirement | PostgreSQL providers | D1 | Turso |
| --- | --- | --- | --- |
| Qualified prospects awaiting demos | Natural indexed anti-join/`NOT EXISTS` pattern | Straightforward with indexes | Straightforward with indexes |
| Outreach eligibility across suppressions | Strong join/planner support and concurrent claims | Correct but must minimize round trips and serialize claims | Correct, with writer-lock sensitivity |
| Complete prospect history | Good joins, unions, windows, pagination | Good at moderate volume; 30-second/row-read constraints later | Good at moderate volume; scan quotas matter |
| Historical features before decision `T` | Composite/partial indexes, lateral/window queries, stable snapshots | Composite indexes work; large extraction has less headroom | Composite indexes work; large scans are quota-sensitive |
| Cohorts by industry/version/source/template/variant | Strong aggregate/window functionality | Feasible early; repeated wide scans incur row reads | Feasible early; row-scan billing encourages projections |
| CAC, revenue, profit per 1,000 | Exact numeric/integer, joins, grouped aggregates | Integer minor units and disciplined SQL | Integer minor units and disciplined SQL |
| Experiment exposure outcomes | Natural multi-table historical join | Feasible with indexes | Feasible with indexes |
| Entity-resolution candidates/search | Expression/GIN/trigram or later extension path; normalized exact matching first | Normalized exact/prefix matching; advanced search path narrower | Normalized matching; SQLite search/provider features need validation |
| Training export | Strong bulk/streaming and analytical ecosystem | Export/scan practical only while one database remains modest | Dump/scan practical, but cross-database analytics is awkward |

### Transactional workflows

| ADR-004 workflow | PostgreSQL suitability | D1 suitability | Turso suitability |
| --- | --- | --- | --- |
| Decision + lifecycle transition + event | Excellent multi-statement transaction with optimistic version check | Atomic batch works if expressed as deterministic conditional statements | Atomic batch/transaction works; keep short |
| Claim outreach work + create attempt | Row-level locking or conditional update plus unique idempotency constraint | Compare-and-set plus atomic batch; all writers share one execution lane | Compare-and-set works; writer lock may queue workers |
| Suppression + prevent pending outreach | Natural transaction across suppression and pending work | Atomic batch, but broad cancellation can increase serialized work | Correct transaction; keep below timeout and contention limits |
| Conversion + commercial records | Strong constraints and exact numeric types | Correct with integer money and atomic batch | Correct with integer money and transaction |
| Entity merge | Rich interactive transaction and deferred constraints; still must be bounded | Possible but complex/large merges may hit statement, batch, and duration limits | Possible, but long write transaction is risky |
| Experiment exposure uniqueness | Unique constraint plus insert/upsert in transaction | Strong fit through uniqueness/idempotent insert | Strong fit through uniqueness/idempotent insert |

PostgreSQL's default Read Committed level, Repeatable Read, Serializable isolation, row locks, and uniqueness give SaltBox several correct implementation options. The implementation must still retry serialization/deadlock failures and must not hold transactions open across external calls.

## Data types, identifiers, JSON, time, money, and search

- Use opaque application-generated UUID/ULID-style identifiers. PostgreSQL has a native UUID type; portability rules must not require a provider-specific generator extension. SQLite-family candidates can store canonical text or bytes.
- Use exact constrained `numeric`/`decimal` or integer minor units for money in PostgreSQL. Currency remains an explicit field. Never use floating-point types. Cross-provider portability may favor integer minor units for ordinary charges and exact numeric for rates/allocations.
- Use PostgreSQL timezone-aware timestamps for authoritative instants and store business-local IANA timezone separately. SQLite-family implementations would require canonical UTC integer/text encodings and validation conventions.
- Use relational columns for identifiers, timestamps, state, event type/version, foreign keys, money, and common query dimensions. PostgreSQL `jsonb` is limited to bounded, versioned event properties and supporting metadata; important JSON paths may receive deliberate expression/GIN indexes later.
- Start search with normalized indexed business names, domains, emails, phones, and admin filters. PostgreSQL full-text search is sufficient for early notes/messages if needed. Do not add Elasticsearch or another search service now.

## Point-in-time learning design

PostgreSQL supports ADR-004's historical cutoff with ordinary relational indexes and snapshots. Physical design should later consider composite indexes beginning with subject/prospect and ending with `observed_at`/`recorded_at`, direct Decision → FeatureSet references, and immutable feature-set identifiers. Dataset queries must apply both event time and SaltBox availability cutoff.

The database's provider Time Travel/PITR is **not** the same as point-in-time learning. PITR recovers storage after failure; ADR-002 datasets reconstruct which rows were available at historical decision time from application timestamps and version references. Every candidate can express those predicates, but PostgreSQL has more headroom for joining and extracting them across large populations.

## Concurrency and append-oriented writes

Append-heavy observations, events, decisions, attempts, audits, and costs are natural PostgreSQL inserts. Index count and write amplification must be measured; not every analytical dimension deserves an index at launch. Time-based partitioning is deferred until table size and maintenance measurements justify it.

Multiple workers will use:

- unique constraints and idempotency keys for duplicate prevention;
- optimistic record versions for CRM state;
- short transactions for state plus history/event writes;
- conditional claims or row-level locking for queued work; and
- an outbox/inbox pattern when database commits and external side effects cannot be atomic.

No worker holds a database transaction while waiting on crawling, inference, email, billing, or another external provider.

## Development, migrations, and production parity

Development and CI should run the same major PostgreSQL version and required extensions as production, using a local PostgreSQL instance/container or isolated Neon branch. Windows developers and coding agents must have a documented, non-production local path; routine tests must not require access to the production database.

Neon branches are useful for integration and migration rehearsal but do not replace checked-in, forward-only migrations. Migration tooling must support transactional PostgreSQL migrations where PostgreSQL permits, explicit non-transactional steps when required, status/history inspection, and repeatable creation of an empty database. Rollback is primarily a tested forward repair plus restore capability, not an assumption that every migration can be reversed automatically.

The next implementation decision must evaluate Drizzle, Kysely, Prisma, and raw SQL against:

- strong TypeScript result/input types;
- transparent SQL and query-plan access;
- reliable PostgreSQL migration support;
- Cloudflare Workers and Hyperdrive/driver compatibility;
- transaction and streaming/bulk-export support;
- low runtime overhead; and
- no requirement to use Neon-only APIs.

This ADR deliberately does not select that tool.

## Backup, recovery, and data ownership

SaltBox will require two recovery layers once production contains non-reproducible data:

1. Provider-managed point-in-time restore for fast operational recovery.
2. Automated, encrypted, provider-independent PostgreSQL logical backups/exports stored outside the database provider, with periodic restore verification.

Neon Free's six-hour history is acceptable only for pre-revenue validation when paired with disciplined exports. Launch's seven-day restore window is the expected first paid recovery level. Backup frequency, destination, encryption/key management, RPO, and RTO are implementation decisions, but the first production-data milestone must define them before autonomous collection/outreach begins.

PostgreSQL's standard dump/restore and logical replication make every SaltBox dataset exportable without a proprietary data API. The application must not depend on Neon Auth, Data API, branching metadata, or proprietary stored features to interpret business data.

## Cloudflare Workers integration

Recommended production path:

```text
Astro / React Router / Worker application service
                    ↓
provider-neutral repository/domain boundary
                    ↓
Workers PostgreSQL adapter
                    ↓
Cloudflare Hyperdrive (cache disabled for authoritative reads)
                    ↓
standard unpooled Neon PostgreSQL endpoint
```

Hyperdrive is connection infrastructure, not the system of record. Local Node processes and maintenance tools connect directly to local/managed PostgreSQL. If Hyperdrive cannot support a required driver or transaction pattern, the Workers adapter may use Neon's serverless HTTP/WebSocket driver until a portable path is validated; domain services and SQL contracts must not change.

Secrets are server-side Worker secrets or platform bindings. Use least-privilege PostgreSQL roles for application runtime, migrations, read-only analysis/export, and operators. TLS verification is mandatory. Neon requires SSL/TLS connections and supports PostgreSQL roles; stronger network restrictions such as IP allow lists are plan-dependent. See [Neon's security overview](https://neon.com/docs/security/security-overview).

Hyperdrive read caching is opt-in only for explicitly stale-tolerant reference/read models. Suppression, eligibility, state, job claim, purchase, and post-write reads must be uncached.

## Cost model

### Recommended Neon path

The storage component on Launch at the researched `$0.35/GB-month` would be approximately:

| Scale | Illustrative data size | Storage-only planning range | Compute/transport expectation |
| --- | ---: | ---: | --- |
| 10,000 businesses | `0.25–2 GB` | Free while within 0.5 GB; otherwise about `$0.09–$0.70/month` | `$0` while Free compute/transfer limits fit; otherwise intermittent usage is expected to be low-single-digits to low-tens |
| 100,000 businesses | `2.5–20 GB` | About `$0.88–$7/month` | Likely low-tens/month initially, but active CU-hours and analytical bursts dominate |
| 1,000,000 businesses | `25–200+ GB` | About `$8.75–$70+/month` | Tens to hundreds/month depending continuous workers, exports, and query tuning |

These are transparent capacity envelopes, not fabricated bills. Total cost depends on active compute (`$0.106/CU-hour` on Launch at research time), branch history, network transfer, query efficiency, and workload duty cycle. SaltBox must record actual database cost as an operational CostEntry/allocation rather than optimize from guesses.

### Candidate cost progression

| Candidate | Phase A | Phase B | Phase C pressure |
| --- | --- | --- | --- |
| Neon | `$0` while 0.5 GB/compute limits fit; usage-based Launch thereafter | Add storage/compute without changing database family | Scale compute/storage; consider read replica or analytical export only after measurement |
| Supabase | `$0`, but pausing and no free automatic backup weaken production use | `$25/month` Pro baseline; 8 GB included, then disk overage | Larger compute/disk and potentially costly PITR |
| D1 | `$0` only while the one authoritative DB stays under 500 MB and daily quotas | Workers Paid minimum around `$5`; 10 GB per-DB ceiling may force partition/migration | Cross-database sharding conflicts with global learning queries |
| Turso | `$0` up to 5 GB and monthly row quotas | `$5.99` Developer or `$29` Scaler depending storage/write/restore need | Plan/storage growth plus serialized-write and cross-dataset analytics pressure |

Neon's free database is not the largest. It wins because a paid capacity upgrade preserves PostgreSQL semantics and avoids a SQLite-to-PostgreSQL migration at the moment SaltBox begins accumulating valuable history.

## Weighted decision matrix

Scores are 1–10, where 10 is best. For “Vendor Lock-In,” 10 means **least** lock-in. Weights were fixed from ADR-004 requirements before totals were calculated.

| Criterion | Weight | Neon | Supabase | D1 | Turso |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial Cost | 9 | 8 | 7 | 10 | 10 |
| Cost Predictability | 5 | 7 | 7 | 9 | 8 |
| Relational Capability | 9 | 10 | 10 | 7 | 7 |
| Transactions | 8 | 10 | 10 | 7 | 7 |
| Concurrency | 6 | 10 | 9 | 5 | 5 |
| Historical/Event Workload | 7 | 9 | 9 | 8 | 8 |
| Analytical Queries | 8 | 10 | 10 | 6 | 6 |
| Point-in-Time Learning Fit | 8 | 10 | 10 | 7 | 7 |
| Backup/Recovery | 7 | 7 | 7 | 9 | 8 |
| Cloudflare Workers Fit | 6 | 8 | 7 | 10 | 9 |
| Local Development | 5 | 8 | 7 | 9 | 9 |
| TypeScript Ecosystem | 3 | 9 | 9 | 8 | 8 |
| Portability | 7 | 10 | 9 | 6 | 7 |
| Scaling Path | 4 | 9 | 8 | 5 | 7 |
| Operational Simplicity | 6 | 8 | 7 | 10 | 8 |
| Vendor Lock-In (10 = least) | 2 | 9 | 8 | 5 | 6 |
| **Weighted total** | **100** | **8.96** | **8.51** | **7.68** | **7.55** |

The close Neon/Supabase technology scores reflect that both are PostgreSQL. Neon wins the provider decision on scale-to-zero and usage-based entry cost. D1 wins Workers fit and simplicity but loses where ADR-004 is hardest: concurrent transactional workers, large historical analytics, and a single database scaling path.

## Risk analysis

| Candidate | Biggest technical risk | Biggest cost risk | Biggest lock-in risk | Biggest migration risk |
| --- | --- | --- | --- | --- |
| Neon | Edge connection/cold-start behavior or driver/Hyperdrive transaction mismatch | Active compute and history may cost more than sparse estimates | Neon driver, branches, and restore workflow leak into core code | Low within PostgreSQL; extensions/version/roles still require planning |
| Supabase | Shared pooler/session limitations and unnecessary platform processes on small compute | `$25` floor plus `$100` PITR add-on before scale | Data API/Auth/RLS/platform roles become accidental application contracts | Low-to-medium via PostgreSQL dump/restore; unwind Supabase-specific roles/extensions |
| D1 | Single-threaded database and 10 GB hard cap undermine multi-worker history/analytics | Row writes and row scans make enrichment/event bursts or aggregates unexpectedly expensive | Worker binding/API, D1 sessions/bookmarks, and Cloudflare SQL limits spread into data layer | High: SQLite dialect/types/time/JSON and sharded data must be transformed to PostgreSQL |
| Turso | Current libSQL writer serialization and evolving next-generation engine semantics | Scan/write quotas and plan jumps as history grows | libSQL clients, replication, tokens, and many-database patterns enter core architecture | Medium to PostgreSQL: export is easy, semantic/type/query conversion is not |

The opposite risk is real: PostgreSQL and an external provider add network/pooling complexity that D1 would avoid. SaltBox mitigates it by choosing scale-to-zero Neon, one database, no supplemental Neon platform features, local PostgreSQL, and one thin Workers adapter. If measured workload remains small and D1 would have been sufficient, the cost of this choice is modest operational complexity—not a distributed system or a standing large database bill.

## Escape and migration paths

### Neon → another PostgreSQL provider or self-hosted PostgreSQL

Use `pg_dump`/`pg_restore` for ordinary moves and logical replication for larger low-downtime moves. Recreate roles, extensions, network configuration, and provider operational tooling. Difficulty is low-to-medium if core SQL remains portable and Neon-only APIs stay outside domain code.

### Supabase → vanilla PostgreSQL

Use direct PostgreSQL connection plus `pg_dump`/`pg_restore` or logical replication. Audit Supabase-managed schemas, extensions, roles, RLS, triggers, and platform services; application code that uses only SaltBox repositories should need only connection-adapter changes. Difficulty is low-to-medium.

### D1 → PostgreSQL

Export SQL, transform SQLite types/defaults/DDL and timestamp/JSON/money conventions, load in dependency order, rebuild indexes/constraints, verify identities and counts, then cut the persistence adapter over. Multiple D1 shards would require a merge/deduplication phase. Difficulty is medium at small scale and high after sharding or extensive D1-specific SQL.

### Turso → SQLite/libSQL or PostgreSQL

Export a synchronized SQLite file or SQL dump for another SQLite/libSQL deployment. Moving to PostgreSQL additionally requires type/DDL/query transformation and validation similar to D1, though the single file/dump provides a clear extraction path. Difficulty is low within SQLite-family and medium-to-high across families.

## Provider-coupling rules

1. Business/domain services depend on repository operations and PostgreSQL semantics, never Neon SDK objects.
2. Provider connection strings, Hyperdrive bindings, and credentials live in server-only infrastructure adapters.
3. Migrations are checked-in PostgreSQL migrations and can build an empty local PostgreSQL database.
4. Do not use Neon Auth, Data API, proprietary branching metadata, or provider-generated IDs as domain truth.
5. Provider-specific performance features require an adapter and documented fallback.
6. Maintain regular standard-format exports and a tested restore to non-Neon PostgreSQL.
7. Browser applications call SaltBox-owned server boundaries; they never connect to PostgreSQL or expose credentials.

## Concrete revisit triggers

Revisit the **provider** before the database technology when any trigger persists after ordinary indexing/query/connection tuning:

- measured Neon plus connection-layer cost exceeds `$100/month` for three consecutive months and a comparable PostgreSQL provider is projected to reduce total cost by at least 30%;
- provider-caused availability falls below 99.9% over a rolling 90-day production window or two critical provider incidents occur within 90 days;
- a restore drill cannot meet the defined production RPO/RTO, or required restore history exceeds the selected plan economically;
- Cloudflare-to-Neon p95 database latency for core indexed operations exceeds 250 ms for seven consecutive days;
- Hyperdrive/serverless transport cannot support a required transaction, streaming export, TLS, or least-privilege access pattern;
- region, private-networking, residency, or security requirements cannot be met on an economically appropriate Neon plan; or
- a provider exit rehearsal cannot restore a usable database from standard exports.

Revisit **PostgreSQL topology/technology** only when:

- the authoritative database exceeds roughly 100 GB and measured maintenance/analytical workloads materially interfere with transactional work;
- correctly indexed analytical/training queries repeatedly exceed 30 seconds or exhaust production resources;
- write contention/serialization retries exceed 1% of write jobs for seven days;
- event/observation retention creates sustained growth that cannot meet budget after policy-driven pruning and object separation; or
- measured scale demonstrates a need for a warehouse, read replica, partitioning, or separate event ingestion path.

Crossing Neon's 0.5 GB Free limit is an upgrade trigger, not an architectural reconsideration.

## High-level implementation sequence

After this ADR is reviewed and accepted, the next implementation phase should be:

```text
select migration and query tooling
        ↓
create the packages/database boundary
        ↓
translate ADR-004 into a reviewed physical PostgreSQL schema
        ↓
establish local PostgreSQL and isolated development/test workflows
        ↓
create and rehearse the first migration
        ↓
implement provider-neutral repositories and transaction boundaries
        ↓
validate invariants, concurrency, point-in-time queries, backup, and restore
        ↓
provision production only after separate authorization
```

No step in that sequence is authorized by this proposed ADR.

## Consequences

### Benefits

- ADR-004's relational invariants and multi-worker transactions fit the database naturally.
- Historical cohorts, point-in-time extracts, exact economics, bounded JSON, and early full-text search remain in one database.
- Neon permits a genuine `$0` start and scale-to-zero while preserving a standard PostgreSQL exit.
- One authoritative database keeps operations simple; object storage and analytical systems remain deferred.
- Local PostgreSQL and provider branches provide credible development/production parity.

### Tradeoffs

- The Workers path needs a connection strategy and careful transaction/pooling tests that D1 would avoid.
- Neon Free's 0.5 GB storage and six-hour restore window are small; meaningful production history may require paid usage early.
- PostgreSQL local development is heavier than a SQLite file.
- Off-provider backups and restore rehearsals add work but are necessary for data ownership.
- PostgreSQL can still be misused through excessive JSON, indexes, long transactions, or unbounded event retention.

## Intentionally deferred

This ADR does not create or authorize a Neon account/project, PostgreSQL database, D1 database, Supabase/Turso resource, Cloudflare binding, Hyperdrive configuration, schema, SQL migration, ORM, query builder, driver dependency, environment variable, credential, API, repository implementation, backup job, object store, event queue, search service, warehouse, or production data.

## Research snapshot

Official documentation reviewed on 2026-08-26:

- Cloudflare: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/), [transactions/API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [migrations](https://developers.cloudflare.com/d1/reference/migrations/), [local development](https://developers.cloudflare.com/d1/best-practices/local-development/), and [import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
- Cloudflare Workers/PostgreSQL: [Hyperdrive overview](https://developers.cloudflare.com/hyperdrive/), [pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), and [connection pooling/cache behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/).
- Neon: [pricing](https://neon.com/pricing), [serverless driver](https://neon.com/docs/serverless/serverless-driver), [branching](https://neon.com/docs/guides/branching-intro), [security](https://neon.com/docs/security/security-overview), and [PostgreSQL migration/export](https://neon.com/docs/import/migrate-from-neon).
- Supabase: [pricing](https://supabase.com/pricing), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [backups](https://supabase.com/docs/guides/platform/backups), [database size](https://supabase.com/docs/guides/platform/database-size), and [PostgreSQL connections/pooling](https://supabase.com/docs/guides/database/connecting-to-postgres).
- Turso: [pricing](https://turso.tech/pricing?frequency=monthly), [usage/billing](https://docs.turso.tech/help/usage-and-billing), [TypeScript/transaction reference](https://docs.turso.tech/sdk/ts/reference), [local development](https://docs.turso.tech/local-development), [export](https://docs.turso.tech/cli/db/export), and [PITR](https://docs.turso.tech/features/point-in-time-recovery).
- Database engines: PostgreSQL [MVCC](https://www.postgresql.org/docs/18/mvcc-intro.html), [numeric](https://www.postgresql.org/docs/current/datatype-numeric.html), [date/time](https://www.postgresql.org/docs/current/datatype-datetime.html), [JSON](https://www.postgresql.org/docs/16/datatype-json.html), and [full-text search](https://www.postgresql.org/docs/current/textsearch-tables.html); SQLite [transactions](https://www.sqlite.org/lang_transaction.html), [JSON](https://www.sqlite.org/json1.html), [STRICT tables](https://www.sqlite.org/stricttables.html), and [FTS5](https://www.sqlite.org/fts5.html).
