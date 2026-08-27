# SaltBox

SaltBox is intended to become an end-to-end autonomous website sales and fulfillment platform. It will discover businesses that lack an effective website, evaluate each opportunity, generate a personalized demo for qualified prospects, conduct outreach, and support the resulting customer relationship through production and ongoing service.

The goal is high automation with clear operator visibility. Important decisions, unusual cases, failures, and sensitive conversations must remain inspectable and capable of human escalation.

> [!IMPORTANT]
> The original SaltBox marketing prototype is preserved under `reference/marketing-prototype/` as the approved visual and interaction reference. Its first production port now lives in `apps/website/` as a static-first Astro application.

## Intelligence policy

**SaltBox must be deterministic-first, local-AI-first, and paid-AI-last.** It should always use the lowest reasonable intelligence level for a task:

```text
LEVEL 0 — DETERMINISTIC SOFTWARE
        ↓
LEVEL 1 — LIGHTWEIGHT LOCAL MODEL
        ↓
LEVEL 2 — STRONGER LOCAL MODEL
        ↓
LEVEL 3 — PAID FRONTIER MODEL
```

Ordinary software, parsers, crawlers, browser automation, structured metadata, analytics, rules, and scoring systems should perform work that does not materially benefit from an LLM. Local/self-hosted models are the first AI option when language understanding or generation is useful. Paid frontier inference is an explicitly authorized escalation for cases where expected economic value, customer intent, or quality requirements justify its cost; it must never silently become the default.

Two explicit architectural goals follow:

> SaltBox should be capable of discovering, analyzing, scoring, and rejecting 10,000 businesses with $0 in third-party LLM API charges.

> SaltBox should be capable of generating large batches of personalized demo websites using owned/self-hosted compute without requiring paid LLM inference.

This is not a claim that SaltBox has no operating costs. Hosting, domains, email, data providers, proxies, storage, electricity, and compliance-safe data acquisition may cost money. The goal is to avoid unnecessary per-request AI API charges at scale.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the future Model Router, inference budgets, structured-output rules, graceful degradation, and domain-specific design. The accepted decision is recorded in [ADR-001: Local-First Intelligence and Paid-AI Escalation](docs/decisions/ADR-001-local-first-intelligence.md).

## Learning and economic optimization

SaltBox must be designed as a learning system. Structured prospect features, strategy decisions, experiment exposures, costs, and observed outcomes should eventually improve discovery, qualification, scoring, demo selection, personalization, outreach, timing, pricing, conversion, acquisition cost, and profitability.

The objective is not maximum activity. Businesses scraped, demos generated, emails sent, opens, and raw replies are operational or intermediate metrics. Long-term optimization should move toward:

```text
Expected Profit Per Prospect

Net Profit Per 1,000 Businesses Discovered
```

SaltBox should measure before optimizing, preserve explainability and experiment integrity, and prefer profit over revenue and revenue over activity. Its own statistically meaningful outcomes should eventually outrank permanent human assumptions or generic benchmarks.

[ADR-002: Metrics, Experimentation & Continuous Learning](docs/decisions/ADR-002-metrics-experimentation-learning.md) defines the accepted learning-system decision. It complements ADR-001: expected value determines whether an action is worth taking, and local-first routing determines the cheapest sufficient way to perform it.

[ADR-003: Production Web Runtime and Frontend Architecture](docs/decisions/ADR-003-production-web-runtime.md) records the accepted Astro/React Router delivery-surface direction. [ADR-004: Core Data, CRM & Event Architecture](docs/decisions/ADR-004-core-data-crm-event-architecture.md) is the proposed provider-neutral data foundation awaiting review.

## Autonomous pipeline

```text
Business Discovery
        ↓
Public Data Enrichment
        ↓
Website Analysis
        ↓
Lead Scoring
        ↓
Qualified Prospect
        ↓
Demo Website Generation
        ↓
Demo Deployment
        ↓
Personalized Outreach
        ↓
Engagement Tracking
        ↓
AI Sales / Support
        ↓
Customer Conversion
        ↓
Full Website Production
        ↓
Approval
        ↓
Deployment / Ongoing Service
```

At maturity, SaltBox should track discovery and enrichment, analysis and scoring, demo generation and hosting, outreach delivery and engagement, conversations and conversion status, customer approval, billing, domains, deployment, and ongoing website management.

## Repository structure

```text
saltbox/
├── apps/
│   ├── website/          # Astro production marketing website
│   ├── admin/            # Local React Router operator surface (viewer + demo lifecycle)
│   └── demos/            # One renderer serving many prospect demos (Node + Worker)
├── services/
│   ├── prospecting/
│   ├── discovery/
│   ├── website-intelligence/
│   ├── qualification/
│   ├── demo-generation/  # Demo planning/content/approval/publication (Phases 8–10)
│   ├── operator/         # Bounded operator runs started from the admin (Phase 10)
│   ├── website-analysis/
│   ├── lead-scoring/
│   ├── outreach/
│   ├── support/
│   └── learning/         # Future metrics, experiments, and learning domain
├── packages/
│   ├── database/
│   ├── artifact-store/   # Provider-neutral artifact storage (local | R2)
│   ├── ai/
│   ├── email/
│   ├── types/
│   └── shared/
├── assets/
│   └── brand/
├── reference/
│   └── marketing-prototype/ # Approved visual and interaction reference
├── docs/
├── scripts/
├── .env.example
├── .gitignore
├── .editorconfig
└── README.md
```

These folders describe product domains and intended ownership, not a commitment to separate deployments. In particular, `services/` does not imply a microservice architecture.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the proposed system boundaries, lifecycle, and operating principles.

## Development principles

1. Preserve the existing SaltBox website design when it is imported.
2. Do not rewrite working code solely to satisfy architectural preferences.
3. Refactor incrementally, guided by concrete needs.
4. Keep business logic separate from UI where practical.
5. Strongly type shared contracts once the project's language and framework are known.
6. Never expose secrets client-side or commit credentials.
7. Prefer boring, reliable infrastructure over unnecessary complexity.
8. Build for autonomous execution while maintaining operator visibility.
9. Make external automated actions observable and recoverable.
10. Avoid premature microservices; domain folders need not be independently deployed.
11. Solve tasks with deterministic software before introducing AI.
12. Treat local/self-hosted inference as a first-class capability and paid inference as an explicit escalation.
13. Prefer small, schema-validated outputs and minimal context over freeform generation.
14. Measure actual outcomes before optimizing behavior.
15. Preserve raw observations, provenance, decision versions, and explainability where practical.
16. Protect control groups and deterministic experiment assignments.
17. Prefer economic value and profit over activity metrics.
18. Treat targeting and strategy rules as hypotheses that must keep learning from evidence.

## Website development

The repository uses Node.js 24 LTS and pnpm workspaces. From the repository root:

```text
pnpm install
pnpm dev:website
pnpm check
pnpm build
```

`apps/website` is an Astro 6 + TypeScript faithful port of the approved marketing prototype. It builds to static HTML by default and contains no backend, analytics, CMS, deployment credentials, or Cloudflare account configuration. See [apps/website/README.md](apps/website/README.md) for app-specific guidance.

`apps/admin` is the local-only, read-only React Router 8 Framework Mode
prospect viewer. With PostgreSQL running, start it using `pnpm admin:dev` and
open `http://127.0.0.1:5174`. It reads through the SaltBox database query
boundary; production deployment is prohibited until authentication and
authorization are implemented. See [apps/admin/README.md](apps/admin/README.md).

The database foundation lives in [packages/database](packages/database/README.md) (`pnpm db:up`, `db:migrate`, `db:verify`). The deterministic prospect-qualification slice lives in [services/prospecting](services/prospecting/README.md); exercise it locally with `pnpm prospect:qualify --fixture roofing-good`.

Real-business discovery lives in [services/discovery](services/discovery/README.md)
with two sources behind one adapter boundary: OpenStreetMap (Phase 5B) and
Overture Maps places (Phase 5C, much stronger service-business coverage).
Build the local Overture extract once, then search either or both sources:

```text
pnpm discovery:data --location "Ogden, UT" --radius-km 30
pnpm discover --category roofing --location "Ogden, UT" --radius-km 10 --limit 5 --source all
pnpm discovery:compare --location "Ogden, UT" --category roofing --radius-km 15 --limit 20
```

Public OSM services are used only for bounded development searches; Overture
data is queried from a git-ignored local regional extract. Attribution and
production-use restrictions are documented with the service. Discovery
performs analysis and qualification only—it never sends outreach.

Phase 6 deep website intelligence lives in
[services/website-intelligence](services/website-intelligence/README.md):
a bounded, hardened Chromium + Lighthouse condition report (performance,
accessibility, SEO, mobile, conversion paths, link/asset health, platform)
persisted as versioned append-only evidence and shown in the admin case file.
The standalone analyzer remains available for targeted re-analysis:

```text
pnpm website:intelligence --category roofing --limit 5
```

Phase 7 adds versioned deep-intelligence qualification v2 while preserving all
v1 history. The normal bounded operator flow performs discovery, deep analysis,
v2 feature derivation, scoring, policy, and persistence in one run:

```text
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
```

See [docs/QUALIFICATION_V2.md](docs/QUALIFICATION_V2.md) and
[services/qualification/README.md](services/qualification/README.md). Target
analysis failures are `completed_with_target_failures` and exit 0 by default;
`--strict` makes them non-zero for CI/debugging.

Phases 8–9 automated demo generation turn a qualified-v2 prospect into a
personalized, viewable website demo — deterministic copy, no AI, no outreach,
no fabricated claims. Phase 9 brand/asset intelligence extracts the
business's real logo, colors, photography, and services through the hardened
website-intelligence boundary and selects one of three polished layout
compositions deterministically. One renderer serves every demo at an
unguessable `noindex` locator URL, and the admin shows a read-only
`VIEW DEMO` link plus the brand evidence used:

```text
pnpm demos:dev                                   # demo renderer on http://127.0.0.1:5175/
pnpm demo:generate --latest-qualified --limit 1  # or --prospect <uuid>
pnpm demo:brand --prospect <uuid>                # inspect brand/asset extraction
pnpm demo:qa --token <public-locator>            # 28 Chromium desktop/mobile checks + screenshots
```

See [docs/DEMO_GENERATION.md](docs/DEMO_GENERATION.md),
[docs/BRAND_ASSET_INTELLIGENCE.md](docs/BRAND_ASSET_INTELLIGENCE.md),
[services/demo-generation/README.md](services/demo-generation/README.md), and
[apps/demos/README.md](apps/demos/README.md).

Phase 10 turns that into an operated lifecycle. The admin becomes the place
work is started and demos are reviewed, and an approved demo gets a durable
hosted URL:

```text
discovery -> qualification -> bespoke demo -> automated QA
   -> OPERATOR REVIEW -> approve -> hosted URL -> READY FOR OUTREACH
```

**Only an approved DemoVersion may later be used for outreach.** Generation,
a QA pass, and "latest" are all explicitly insufficient; regenerating never
moves approval, and the public URL keeps serving the approved version until an
operator approves a new one. `READY FOR OUTREACH` sends nothing — outreach is
a later phase.

```text
pnpm admin:dev                                   # start/watch runs, review and approve demos
pnpm operator:worker -- --drain                  # execute queued runs by hand if needed
pnpm demos:publish --prospect <uuid>             # publish the APPROVED version's assets
pnpm demos:deploy:check                          # hosted deploy preflight (no account needed)
pnpm demos:deploy                                # deploy the Worker (needs `wrangler login`)
```

See [docs/OPERATOR_APPROVAL.md](docs/OPERATOR_APPROVAL.md),
[docs/DEMO_HOSTING.md](docs/DEMO_HOSTING.md),
[services/operator/README.md](services/operator/README.md), and
[packages/artifact-store/README.md](packages/artifact-store/README.md).

## Fresh-machine bootstrap

Prerequisites:

1. **Node.js 24 LTS** (the workspace pins `>=24.0.0 <25`; install from nodejs.org, nvm, or winget) with pnpm 11.24+ via Corepack: `corepack enable`.
2. **Docker Desktop** running (WSL2 backend on Windows) for the local PostgreSQL 18 container.
3. Git access to this repository.

Then, from a clone (or after `git pull`):

```text
pnpm install
pnpm db:up          # start local PostgreSQL 18 (Docker, port 5433)
pnpm db:migrate     # apply the ordered SQL migration history
pnpm db:verify      # regenerate types from a disposable DB; must match generated/db.ts
pnpm check          # type-check every workspace package
pnpm test           # database + prospecting suites (requires db:up)
pnpm prospect:qualify --fixture roofing-good   # run the Phase 4 pipeline visibly
```

The local PostgreSQL Docker volume is intentionally **machine-local and
disposable**: every machine rebuilds its database from the committed
migrations (`pnpm db:up && pnpm db:migrate`). No database dump or copied
volume is ever needed — do not transfer one between machines. `DATABASE_URL`
defaults to the local container and only needs setting for non-default
setups (see `.env.example`).

Copy `.env.example` to an appropriate local environment file only after an application defines required configuration. Never place real secrets in `.env.example`.
