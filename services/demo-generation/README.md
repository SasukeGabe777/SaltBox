# @saltbox/demo-generation

Phase 8 deterministic demo generation: eligibility, fact collection,
DemoPlan, structured content, template selection, and append-only
Demo/DemoVersion persistence. Rendering lives separately in
[`apps/demos`](../../apps/demos/README.md) — this service never produces
HTML. Full architecture: [`docs/DEMO_GENERATION.md`](../../docs/DEMO_GENERATION.md).

```text
pnpm demo:generate --prospect <uuid>
pnpm demo:generate --latest-qualified [--category roofing] [--limit 1]
```

## Versioned contract

| Artifact | Version |
| --- | --- |
| Content input schema | `demo-content-v1` |
| Deterministic copy | `demo-copy-v1` |
| Plan schema | `demo-plan-v1` |
| Pipeline | `demo-generation-pipeline-v1` |
| Template | `local-service` @ `1.0.0` |
| Eligible policy | `qualification-policy-v2` |

## Module map

- `src/eligibility.ts` — default qualified-v2 rule; suppression and template
  availability are never overridable.
- `src/facts.ts` — deterministic facts from persisted state only (discovery
  provenance, contact methods, website identity, latest intelligence, latest
  qualification, active suppressions). No recrawling.
- `src/plan.ts` — deficiency derivation from intelligence findings and the
  inspectable DemoPlan.
- `src/content.ts` + `src/config/local-service-copy-v1.ts` — deterministic
  copy with provenance; stable-hash variant selection.
- `src/claims-guard.ts` — hard failure on any unsupported factual claim in
  generated copy.
- `src/generate.ts` — orchestration, idempotency (content hash), append-only
  DemoVersion, opaque locator, `demo_published` event.

## Behavior guarantees

- Rejected prospects are excluded by default; `--override-ineligible` is a
  recorded controlled-testing bypass that never clears suppression and never
  changes qualification or lifecycle history.
- Rerunning with unchanged inputs returns `unchanged` — no duplicate
  business, prospect, demo identity, or version. Changed inputs or
  `--force-regenerate` append the next version; old versions are immutable.
- Bounded generator metadata (size-guarded); large artifacts never enter
  PostgreSQL.
- No AI, no paid APIs, no network calls, no outreach.
