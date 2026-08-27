# @saltbox/demo-generation

Deterministic demo generation and lifecycle (Phases 8–10): eligibility, fact collection,
brand-profile consumption, DemoPlan v2, structured content v2, deterministic
composition selection, and append-only Demo/DemoVersion persistence.
Rendering lives separately in [`apps/demos`](../../apps/demos/README.md) —
this service never produces HTML. Full architecture:
[`docs/DEMO_GENERATION.md`](../../docs/DEMO_GENERATION.md),
[`docs/BRAND_ASSET_INTELLIGENCE.md`](../../docs/BRAND_ASSET_INTELLIGENCE.md),
and [`docs/OPERATOR_APPROVAL.md`](../../docs/OPERATOR_APPROVAL.md).

```text
pnpm demo:generate --prospect <uuid> [--skip-brand] [--refresh-brand]
pnpm demo:generate --latest-qualified [--category roofing] [--limit 1]
pnpm demo:brand --prospect <uuid> [--refresh]
pnpm demo:qa --token <public-locator>            # records QA evidence (apps/demos)
pnpm demos:publish --prospect <uuid>             # publishes the APPROVED version
```

## Versioned contract

| Artifact | Version |
| --- | --- |
| Content input schema | `demo-content-v2` (v1 history stays renderable) |
| Deterministic copy | `demo-copy-v2` |
| Plan schema | `demo-plan-v2` (v1 history preserved) |
| Pipeline | `demo-generation-pipeline-v2` |
| Compositions | `local-service-premium/bold/clean` @ `1.0.0` (+ frozen `local-service` @ `1.0.0`) |
| Brand input | `brand-intelligence-v1` / `brand-profile-v1` |
| Eligible policy | `qualification-policy-v2` |
| Approval policy | `demo-approval-policy-v1` |
| QA runner | `demo-qa-v2` |
| Publication | `demo-publication-v1` |

## Module map

- `src/eligibility.ts` — default qualified-v2 rule; suppression and template
  availability are never overridable.
- `src/facts.ts` — deterministic facts from persisted state only (discovery
  provenance, contact methods, website identity, latest intelligence, latest
  brand profile, latest qualification, active suppressions). No recrawling.
- `src/brand-view.ts` — defensive typed view over persisted brand-profile-v1
  JSON; malformed data degrades to fallbacks, never breaks generation.
- `src/brand-extraction.ts` — wires the real website-intelligence brand
  extractor (Chromium + safe asset pipeline) as an injectable hook.
- `src/plan.ts` — deficiency derivation, brand summary, and deterministic
  composition selection with persisted reasons.
- `src/content.ts` + `src/config/local-service-copy-v1.ts` — deterministic
  copy with provenance; evidence-backed services lead, typical items fill
  (disclosed); stable-hash variant selection.
- `src/claims-guard.ts` — hard failure on any unsupported factual claim in
  generated copy (extracted site text is evidence, not a generated claim).
- `src/generate.ts` — orchestration, idempotency (content hash), append-only
  DemoVersion, opaque locator (stable across regenerations), the optional
  brand-extraction hook, the optional composition override, and the
  `demo_generated` / `demo_regenerated` events. Generation NEVER approves.
- `src/qa.ts` — the QA report contract, which checks are critical, and
  append-only QA persistence with `demo_qa_passed` / `demo_qa_failed`.
- `src/approval.ts` — the Phase 10 approval invariant: one exact approved
  DemoVersion, the QA gate, audited overrides, non-overridable suppression,
  first-class decisions and append-only review history.
- `src/publish.ts` — publication of the approved version's assets through the
  provider-neutral artifact store, recording `demo_asset` metadata and the
  durable URL (`demo_published`).

## Behavior guarantees

- Rejected prospects are excluded by default; `--override-ineligible` is a
  recorded controlled-testing bypass that never clears suppression and never
  changes qualification or lifecycle history.
- Rerunning with unchanged inputs returns `unchanged` — no duplicate
  business, prospect, demo identity, or version. Changed inputs or
  `--force-regenerate` append the next version; old versions are immutable.
- Bounded generator metadata (size-guarded); large artifacts never enter
  PostgreSQL.
- Generating a version never approves it and never moves an existing approval;
  publication is only ever of the approved version.
- No AI, no paid APIs, no outreach. Generation itself performs no network
  calls; the injectable brand extractor does, through the Phase 6 boundary.
