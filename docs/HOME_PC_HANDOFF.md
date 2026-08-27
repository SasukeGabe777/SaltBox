# READ THIS FIRST WHEN RESUMING SALTBOX ON A NEW MACHINE.

Operational handoff for continuing SaltBox development on another machine.
Authoritative architecture lives in `docs/decisions/` — this file is a resume
checklist, not a substitute for the ADRs.

## Where the project stands

- **Current phase:** Phase 7 — Deep-Intelligence Qualification V2 is complete.
  The current repository and `git log` are authoritative.
- **Approved architecture:** ADR-001 (local-first intelligence), ADR-002
  (metrics/learning), ADR-003 (web runtime), ADR-004 (core data/CRM/events),
  ADR-005 (PostgreSQL + Neon), ADR-006 (Kysely + pg + node-pg-migrate). All
  accepted. Neon is NOT provisioned; nothing is deployed.
- **Operational capability:** real OSM + Overture discovery, conservative
  cross-source identity, deep Chromium/Lighthouse intelligence, v1 and v2
  append-only qualification history, and the local read-only admin viewer.
- **Normal command:** `pnpm acquire --category roofing --location "Ogden, UT"
  --radius-km 10 --limit 3 --source overture --concurrency 1`.

## What the current pipeline does

`services/prospecting` preserves qualification v1. Phase 7 performs:

```text
real discovery → ingestion → deep website intelligence
  → FeatureSet (prospect-qualification-features-v2)
  → LeadScore (qualification-v2)
  → Decision (qualification-policy-v2)
  → lifecycle/result → read-only admin
```

Identity is idempotent; evidence and results are append-only. V1 history is
preserved. Deep analysis is bounded, SSRF-hardened, and deterministic. Target
failures do not fail normal operator batches; system failures do. See
`docs/QUALIFICATION_V2.md` for the scoring contract and limitations.

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
pnpm test           # complete deterministic workspace suite; needs db:up
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

## Phase 7 operator smoke

```text
pnpm discovery:data --location "Ogden, UT" --radius-km 30
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
pnpm admin:dev
```

Open `http://127.0.0.1:5174/`. Target failures are listed but exit 0 by
default; `--strict` makes them non-zero for CI/debugging. No outreach runs.

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

Phase 8 should add authenticated/local operator controls and run visibility to
the admin: start a bounded acquisition, validate inputs, show stage progress,
inspect target failures, and request intentional retries. Keep the admin
read-only with respect to authoritative business/score/decision history until
each mutation has a governed service boundary. Do not add outreach.
