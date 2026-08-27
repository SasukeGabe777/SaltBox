# READ THIS FIRST BEFORE CONTINUING SALTBOX DEVELOPMENT.

## Handoff identity

- Prepared: 2026-08-27 on the Windows work PC in `C:\dev\SaltBox`.
- Branch: `main`.
- Authoritative completed Phase 7 commit: `2392601be49ad2971a6dd7c16ee82b0c46399d34` (`Implement deep-intelligence qualification v2`).
- This document is committed immediately after that implementation commit. Run `git rev-parse HEAD` and `git rev-parse origin/main` to verify the final handoff commit; a commit cannot contain its own hash.
- The committed repository is authoritative. This handoff is orientation, not a substitute for inspecting current code and history.

## Recent important commits

```text
2392601 Implement deep-intelligence qualification v2
1843b6e Improve website intelligence failure isolation
ae046b1 Implement website intelligence v2
2d4af41 Expand multi-source business discovery
97fb2a3 Implement real business discovery MVP
b0a7215 Implement prospect admin viewer
95aae81 Implement prospect qualification vertical slice
fff90a5 Implement core database foundation
dab572d Select PostgreSQL access and migration tooling
16750ec Select PostgreSQL and Neon persistence architecture
```

## Current architecture and completed phases

SaltBox is a pnpm/TypeScript monorepo with deterministic, local-first business discovery, qualification, and demo generation. No current workflow sends outreach, uses paid APIs or AI, or deploys production services.

Completed work includes:

- Preserved SaltBox marketing prototype and architecture/ADR foundation.
- PostgreSQL persistence, SQL migrations, Kysely access, repositories, provenance, append-only history, and point-in-time guarantees.
- Deterministic prospect qualification v1.
- Local read-only prospect admin viewer.
- Real OpenStreetMap discovery and bounded local Overture multi-source discovery.
- Deep Chromium/Lighthouse website intelligence with persisted evidence and local artifacts.
- Failure-isolated intelligence batches with structured DNS/network classifications.
- Phase 7 deep-intelligence qualification v2 and the orchestrated acquisition command.

Phase 7 is complete and pushed:

```text
2392601be49ad2971a6dd7c16ee82b0c46399d34
Implement deep-intelligence qualification v2
```

The preceding Phase 6 correction is also complete and pushed:

```text
1843b6e6228b65fd9bb0c908c33744505a67dbfc
Improve website intelligence failure isolation
```

## Applications, services, and packages

- `apps/website`: preserved Astro marketing prototype.
- `apps/admin`: local React Router 8/React 19 server-rendered, read-only operator viewer at `http://127.0.0.1:5174/`.
- `services/prospecting`: ingestion, lightweight website analysis, FeatureSet/score/policy v1, and lifecycle behavior.
- `services/discovery`: OpenStreetMap and Overture adapters, local extract tooling, conservative cross-source identity, legacy v1 discovery, and Phase 7 acquisition orchestration.
- `services/website-intelligence`: hardened Puppeteer/Chromium plus Lighthouse analysis, bounded crawling, evidence persistence, artifacts, and target/system failure classification. The persisted analyzer identifier remains `website-intelligence-v1`.
- `services/qualification`: Phase 7 v2 feature derivation, score configuration, decision policy, persistence, and lifecycle orchestration. It is separate to avoid a dependency cycle between prospecting, intelligence, and discovery.
- `packages/database`: PostgreSQL/Kysely client, generated types, SQL migrations, repositories, point-in-time queries, admin read models, Docker Compose, and database verification.

## Database state and architecture

- PostgreSQL is the authoritative local datastore; the Docker development instance uses PostgreSQL 18 on host port 5433.
- SQL files in `packages/database/migrations` are authoritative. Kysely generated types and repositories sit above them.
- Existing tables already support sources/source records, businesses, websites, contact methods, prospects/lifecycle, snapshots, analyses, observations, FeatureSets, LeadScores, Decisions, suppressions, events, and Demo/DemoVersion records.
- Phase 7 required no migration. It appends v2 FeatureSets, scores, and decisions without mutating v1 history or duplicating active business/prospect identity.
- ADR-004 point-in-time rules apply: a FeatureSet uses only evidence available by its calculation cutoff; later analysis creates new history and never changes an older FeatureSet, score, or decision.
- Large website-intelligence artifacts stay in git-ignored `.data/website-intelligence`; PostgreSQL stores structured evidence, summaries, lineage, and relative artifact references.
- The work-PC database contained the controlled Phase 7 smoke-test businesses and results when Phase 7 was completed. Database contents are machine-local and are not conveyed by Git, so verify rather than assume they survived any later local reset.

Relevant starting documents are `docs/ARCHITECTURE.md`, ADR-001 through ADR-006 in `docs/decisions`, `docs/QUALIFICATION_V2.md`, and the README files under the applications/services/packages above.

## Current operator commands

PowerShell may require `pnpm.cmd` instead of `pnpm` when the script execution policy blocks the `.ps1` shim.

```powershell
cd C:\dev\SaltBox
pnpm.cmd install
pnpm.cmd db:up
pnpm.cmd db:migrate
pnpm.cmd db:verify
pnpm.cmd admin:dev
```

Open `http://127.0.0.1:5174/`.

For Overture, build or reuse a bounded local extract:

```powershell
pnpm.cmd discovery:data --location "Ogden, UT" --radius-km 30
```

Run the complete safe Phase 7 pipeline:

```powershell
pnpm.cmd acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
```

Lower-level/debug commands remain available:

```powershell
pnpm.cmd discover --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 2
pnpm.cmd website:intelligence --category roofing --limit 3 --concurrency 1
pnpm.cmd prospect:qualify --fixture roofing-good
pnpm.cmd discovery:compare --location "Ogden, UT" --category roofing,plumbing --radius-km 15 --limit 20
```

## Discovery architecture

- A versioned provider adapter produces normalized discovery results. Current adapters are `openstreetmap` and `overture`.
- OSM uses small, bounded, operator-triggered Nominatim/Overpass requests. Overture queries a git-ignored, bounded regional GeoParquet extract under `.data/overture`.
- Provider identity is stable by `(source, external_id)`. Cross-source auto-linking is intentionally conservative: exactly one business must match an exact registrable website host or exact normalized phone. Ambiguity creates review candidates rather than a false merge.
- `pnpm discover` retains the legacy discovery -> ingestion -> lightweight analysis -> qualification-v1 path.
- `pnpm acquire` performs discovery -> ingestion -> deep website intelligence -> FeatureSet v2 -> LeadScore v2 -> policy v2 -> persisted result/admin state.
- Acquisition defaults are bounded (`limit 3`, concurrency 1) and caps are enforced. It never sends outreach.

## Website-intelligence architecture and failure behavior

- Website targets are treated as hostile: SSRF checks, public-DNS validation, redirect checks, host pinning, request interception, bounded navigation, an ephemeral browser, no form submissions, and no anti-bot evasion.
- Analysis selects at most five pages, runs a mobile Lighthouse lab pass, checks mobile/technical/SEO/conversion/content/platform signals and bounded link/asset health, then persists structured evidence and lineage.
- `completed` means the batch completed without target analyzer failure.
- `completed_with_target_failures` means independent targets completed while one or more target analyses failed. Normal operator execution exits 0 and prominently reports failures; `--strict` exits 2 for CI/debug workflows.
- `failed` is reserved for actual configuration/database/schema/global-Chromium/unrecoverable batch failures and exits non-zero.
- Target DNS/TLS/timeout/malformed-page/Lighthouse failures are persisted and isolated. `EAI_AGAIN` is `dns_transient` attempt evidence and must not become permanent no-website evidence. Confirmed `ENOTFOUND`/`ENODATA` is `dns_not_found` and may inform Need.

## Qualification v2 architecture

Persisted versions are:

- `prospect-qualification-features-v2`
- `qualification-v2` / artifact `2.0.0`
- `qualification-policy-v2`
- `deep-intelligence-qualification-pipeline-v2`

The deterministic heuristic is:

```text
score = round(Need * 0.45 + Value * 0.20 + Activity * 0.10 + Reachability * 0.25)
```

Each dimension is capped at 100. The qualification threshold is 60 inclusive. The score is an operator priority heuristic, never a conversion probability, and every weight remains an unvalidated hypothesis until outcome data exists.

- Need uses disciplined evidence for missing/definitively unreachable websites, HTTPS/TLS, mobile overflow/viewport, Lighthouse performance and selected web vitals, CTA/forms, metadata, technical errors, meaningful broken links, copyright recency, and site depth.
- Value retains transparent industry bands; it does not invent revenue, employee count, spend, size, or purchasing power.
- Activity is intentionally sparse: defensible copyright-recency and functioning multi-page signals only.
- Reachability uses discovered email/phone and verified website mailto/tel, contact forms/pages, and quote/booking paths.
- Narrow, explainable target-fit rules cover only strong national-chain, government, education, major-institution, supplier/manufacturer, and directory/aggregator evidence.
- Hard rejection applies to active suppression, no realistic contact path, or strong non-target evidence. A high Need score cannot override these rules.
- Transient intelligence failure is score-neutral and uses retry-required reasoning. Existing advanced/terminal lifecycle state is not force-reopened.
- Every v2 feature carries observed value, evidence source/lineage, dimension, contribution, reason code, version, and rationale. Re-analysis appends history and preserves all v1 artifacts.

## Admin capabilities

The local viewer is observational only. It auto-refreshes every three seconds and provides:

- Dashboard totals, filters, recent meaningful activity, source information, and prospect lifecycle state.
- Latest/current score and scoring version, prior v1 score, v1/v2 history, v2 dimension breakdown, policy/result, major reason codes, feature contributions, and evidence lineage.
- Deep-intelligence completed/partial/failed state, target-failure evidence, screenshots and local Lighthouse artifacts through a validated read-only route.
- Prospect detail with observations, analyses, decisions, score/FeatureSet history, source provenance, and lifecycle transitions.

There are no UI start/retry/edit/delete/outreach controls, authentication, or production deployment. Phase 7 acquisition is CLI-only.

## Last verification and smoke result

The complete Phase 7 gate set passed before commit:

```text
pnpm check
pnpm build
pnpm db:verify
pnpm test
```

Tests: 122 passed across database, admin, prospecting, website intelligence, qualification, and discovery workspaces. The deterministic suite does not depend on arbitrary public websites.

Preserved marketing prototype SHA-256:

```text
67E36EFA8D096F96A65C98CCBB8C6AA4C97E772EFFE9D03259BF5D0B45C2352F
```

The final three-target real smoke run took about 130 seconds and returned `completed_with_target_failures` with process exit 0:

- Legacy Roofing: intelligence completed in about 67.9 seconds; v2 score 57; rejected.
- Bear Creek Roofing Services: isolated `dns_transient` / `EAI_AGAIN` in about 0.2 seconds; v2 score 22 with retry-required reasoning; batch continued.
- Utah Roof and Solar: intelligence completed in about 58.5 seconds; v2 score 65; qualified.

All persisted results were readable through the live admin route.

## Machine-local requirements

- Windows PowerShell, Git, Node.js `>=24 <25`, and pnpm `>=11.24 <12` (repository pins pnpm 11.24.0).
- Docker Desktop for local PostgreSQL; ensure the engine is running before `pnpm db:up`.
- Puppeteer's managed Chrome for Testing and Lighthouse dependencies installed by `pnpm install`.
- A valid server-side database configuration; never expose PostgreSQL credentials to browser code.
- Overture extracts and website-intelligence artifacts are local, git-ignored data and may need rebuilding on another machine.
- The admin binds to loopback only and must not be exposed externally without authentication and authorization.

## Known limitations

- Scoring weights and threshold are hypotheses, not trained probabilities; no outcome-learning loop exists yet.
- Activity evidence remains weak by design. Target-fit detection is narrow to avoid false positives.
- Lighthouse is lab evidence, analysis can take roughly a minute per target, and execution is bounded local concurrency rather than distributed work.
- Public OSM infrastructure has no production SLA; Overture coverage depends on the locally prepared extract and pinned release.
- Bot challenges are recorded as served and never evaded; they are not automatically treated as verified business deficiencies.
- The system remains local-only, read-only in the admin, without UI orchestration, authentication, outreach, demos, billing, paid enrichment, or production deployment.

## Phase 8 — Automated Demo Generation (COMPLETE)

Phase 8 is implemented, tested, and documented in
`docs/DEMO_GENERATION.md`. Summary:

- `services/demo-generation`: eligibility (latest qualified
  `qualification-policy-v2` decision, no active suppression, intelligence
  present, local-service category), deterministic facts/DemoPlan
  (`demo-plan-v1`) / content (`demo-content-v1`, `demo-copy-v1`) with a
  claims guard and full provenance, append-only Demo/DemoVersion
  persistence over the existing schema (no migration), opaque locators, and
  a `demo_published` domain event.
- `apps/demos`: ONE loopback renderer (port 5175) serving MANY demos at
  `/d/<locator>` with `noindex`, strict CSP (`form-action 'none'`), escaped
  plain-text-only rendering, and the `local-service` @ `1.0.0` template.
- Admin prospect detail shows a read-only demo section with VIEW DEMO.
- Operator commands: `pnpm demos:dev`, `pnpm demo:generate --prospect <id>`
  (or `--latest-qualified`), `pnpm demo:qa --token <locator>`.
- Regeneration is idempotent on unchanged inputs and append-only otherwise;
  overrides (`--override-ineligible`) never clear suppression or alter
  qualification/lifecycle history. No outreach exists anywhere.
- Real smoke: Utah Roof and Solar (qualified v2, score 65) generated demo
  versions 1 and 2 on this machine; renderer returned HTTP 200; 16/16
  desktop/mobile Chromium QA checks passed; the live admin rendered VIEW
  DEMO. The 141-test suite, `pnpm check`, `pnpm build`, and `pnpm db:verify`
  are green. Demo rows are machine-local; regenerate on another machine.

## Phase 9 — Brand + Asset Intelligence / Bespoke Demo Quality (COMPLETE)

Documented in `docs/BRAND_ASSET_INTELLIGENCE.md`. Summary:

- `services/website-intelligence/src/brand/`: bounded deterministic brand
  extraction (`brand-intelligence-v1` / `brand-profile-v1`) over the Phase 6
  SSRF boundary — ≤3 pages, logo ranking + safe download (SVG rasterized),
  contrast-safe palette from CSS evidence + logo dominant colors (sharp),
  credential-badge-filtered photography (≤4, resized ≤1600px), lexicon-based
  service extraction. Persisted as append-only website_analysis rows (no
  migration); binaries in git-ignored `.data/demo-assets/<ref>/`.
- `services/demo-generation`: demo-plan-v2 / demo-content-v2 / demo-copy-v2;
  deterministic composition selection (premium: hero photo; bold: strong
  identity; clean: fallback) with persisted reasons; evidence-backed services
  lead with "From their current site" badges; claims guard skips extracted
  names but still guards generated text; brand extraction is an injectable
  hook (`--skip-brand` / `--refresh-brand`; failure never fatal).
- `apps/demos`: three compositions over shared primitives + frozen Phase 8
  template (old DemoVersions still render; v1+v2 content accepted);
  validated `/demo-assets/` route; CSP `img-src 'self' data:`; inline SVG
  favicon; QA expanded to 28 checks (lazy-load scroll, image loads, brand
  mark, disclosure, noindex, no external scripts).
- Admin demo panel shows brand intelligence (logo/palette/swatches/imagery/
  extracted services) and composition reasons. CLI adds `pnpm demo:brand`.
- Real smoke on this machine: Utah Roof and Solar regenerated on the SAME
  demo + locator (`F-KUt2u_DQeDVYozejyZeU6d`, v4 — honest clean fallback,
  its site is a parked lander) and Riverfront Roofing (qualified 69 in a new
  acquire run) got the full showcase: real logo (high), extracted palette
  (high), real shingle-photo hero, 7 extracted services, premium composition
  (`0z-T5ccKc4k2PEeV6v-2DTEf`, v3). Both 28/28 QA. 158 tests green.

## Current roadmap

Phase 10 is not started and is not authorized to start automatically.
Candidate directions (operator decision required): outreach foundations
(consent/suppression-first message intent without sending), an operator
demo approval flow, additional template families beyond local-service, or
review/social enrichment for testimonials.

## FOR CLAUDE: FIRST ACTIONS

1. Read this entire handoff.
2. Inspect the current repository; committed code is authoritative over this summary and over stale chat history.
3. Read the relevant architecture documents, ADRs, service READMEs, database migrations/repositories, and tests before designing Phase 8.
4. Verify branch/HEAD/origin/clean status plus Git, Node, pnpm, Docker, PostgreSQL, migrations, and relevant machine-local data.
5. Do not assume stale handoffs or chat descriptions override committed code.
6. Only after verification, proceed with Phase 8 — Automated Demo Generation.

The expected full gate set remains:

```text
pnpm check
pnpm build
pnpm db:verify
pnpm test
```

Reverify the marketing prototype SHA-256 shown above before committing Phase 8.
