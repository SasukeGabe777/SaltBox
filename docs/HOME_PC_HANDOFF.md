# READ THIS FIRST WHEN RESUMING SALTBOX ON A NEW MACHINE.

Operational handoff for continuing SaltBox development on another machine.
Authoritative architecture lives in `docs/decisions/` — this file is a resume
checklist, not a substitute for the ADRs.

## Where the project stands

- **Current phase:** Phase 4 — Prospect Qualification Vertical Slice is
  complete and approved. Phase 5 has NOT started.
- **Approved architecture:** ADR-001 (local-first intelligence), ADR-002
  (metrics/learning), ADR-003 (web runtime), ADR-004 (core data/CRM/events),
  ADR-005 (PostgreSQL + Neon), ADR-006 (Kysely + pg + node-pg-migrate). All
  accepted. Neon is NOT provisioned; nothing is deployed.
- **Latest commit:** the Phase 4 commit `Implement prospect qualification
  vertical slice` (this file ships inside it — confirm with
  `git log --oneline -3`). Its parent is `fff90a5` (Phase 3 database
  foundation).

## What Phase 4 does

`services/prospecting` turns a controlled business input (fixtures only — no
scraping, no paid data) into a traceable qualification decision:

```text
source → business → website → deterministic observations
       → FeatureSet (prospect-qualification-features-v1)
       → LeadScore (qualification-v1)
       → qualify/reject Decision (qualification-policy-v1, threshold 60, provisional)
       → prospect lifecycle transition (discovered → enriching → evaluated → qualified|rejected)
```

Identity (business/source record/website/prospect) is idempotent via database
constraints; snapshots, observations, feature sets, scores, and decisions are
append-only history. The website analyzer is deterministic HTTP + HTML parsing
with SSRF guards (private/loopback/metadata destinations refused), timeouts,
redirect and body-size limits.

## Machine prerequisites

1. **Node.js 24 LTS** (`>=24.0.0 <25` is pinned) + pnpm 11.24 via `corepack enable`.
2. **Docker Desktop** running (WSL2 backend on Windows).
3. Git access to https://github.com/SasukeGabe777/SaltBox.git

## Bootstrap (fresh clone or after pull)

```text
git clone https://github.com/SasukeGabe777/SaltBox.git   # or: git pull
cd SaltBox
pnpm install
pnpm db:up          # local PostgreSQL 18 in Docker, port 5433 (saltbox/saltbox)
pnpm db:migrate     # apply the ordered SQL migration history from empty
pnpm db:verify      # generated/db.ts must match a fresh migration replay
pnpm check          # type-check all workspace packages
pnpm build          # website build
pnpm test           # database (18) + prospecting (31) suites; needs db:up
```

The Docker/Postgres volume is **machine-local and disposable**. Never copy a
volume or dump between machines — every machine rebuilds identically from the
committed migrations.

## Phase 4 smoke test (expected outcomes)

```text
pnpm prospect:qualify --fixture roofing-good        # → qualified, score 88
pnpm prospect:qualify --fixture bakery-strong-site  # → rejected,  score 52
```

Run `pnpm prospect:qualify` with no arguments to list all five fixtures.

## Prototype integrity

`reference/marketing-prototype/index.html` is immutable. SHA-256 must remain:

```text
67E36EFA8D096F96A65C98CCBB8C6AA4C97E772EFFE9D03259BF5D0B45C2352F
```

## Architectural constraints (do not violate)

- **Deterministic-first, local-AI-first, paid-AI-last** (ADR-001). Phase 4 is
  Level 0 only; paid AI stays disabled by default everywhere.
- **Ordered SQL migrations are the schema authority** (ADR-006). Never edit
  applied migrations, never hand-edit `generated/db.ts`, never let an app or
  Worker apply migrations. New schema = new migration + `pnpm db:codegen`.
- **Never bypass the prospect lifecycle service**
  (`packages/database/repositories/prospects.ts#transitionProspect`). No code
  may UPDATE `prospect.lifecycle_state` directly.
- **Preserve provenance and point-in-time correctness** (ADR-004): raw
  observations before derived scores; `observed_at`/`recorded_at` cutoffs;
  rescoring appends, never rewrites; decisions carry structured reason codes
  and version references.
- Secrets are server-side only; `.env.example` holds placeholders, never real
  values.

## Known Phase 4 limitations (intentional)

No review counts/velocity, social or ad activity, employee/revenue data,
owner identity, Lighthouse, or visual-age scoring. ACTIVITY uses only
input-provided phone/email signals and overlaps REACHABILITY until enrichment
exists. Industry value bands are a small explicit heuristic map. All scoring
weights are provisional human hypotheses (ADR-002).

## Recommended next phase

Widen the input from controlled fixtures to real discovery sources
(compliance-safe business discovery + enrichment), per the phase plan. Before
changing any architecture, read the relevant ADRs in `docs/decisions/` —
especially ADR-004 before touching data shapes and ADR-006 before touching
schema/tooling — and record significant new decisions as new ADRs rather than
editing accepted ones.
