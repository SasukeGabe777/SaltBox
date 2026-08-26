# @saltbox/prospecting

The prospect-qualification domain (Phase 4 vertical slice): a controlled
business input becomes a fully traceable, deterministic, explainable
qualification decision.

```text
SOURCE → BUSINESS → WEBSITE → OBSERVATIONS → FEATURE SET → LEAD SCORE → DECISION
```

## Deterministic-only rule

This service is ADR-001 **Level 0 only**: no LLMs (local or paid), no paid
APIs, no browser automation. Every decision is reproducible from recorded
observations, the feature-set version, the scoring version, and the decision
policy version. The website analyzer lives here as a module for now and can
graduate to `services/website-analysis` when heavier analysis (Lighthouse,
rendering) justifies the split.

## Versions

| Artifact | Version |
| --- | --- |
| Feature schema | `prospect-qualification-features-v1` |
| Scoring | `qualification-v1` (artifact 1.0.0) |
| Decision policy | `qualification-policy-v1` (provisional threshold 60) |
| Analyzer | `deterministic-website-analyzer-v1` |
| Pipeline | `prospecting-pipeline-v1` |

All weights, industry value bands, and the threshold live in
`config/qualification-v1.ts` and are explicitly **initial human hypotheses**
(ADR-002), not statistically derived values. Scores are 0–100 heuristic
priorities per dimension (NEED/VALUE/ACTIVITY/REACHABILITY), combined as a
weighted mean — an 82 is a priority, not a conversion probability.

## Fixture runner

With the local database running (`pnpm db:up` from the root):

```text
pnpm prospect:qualify --fixture roofing-good
```

Run without a fixture to list all five (strong target, weak target, broken
website, no website, no contact path). Fixtures with HTML are served from an
ephemeral local HTTP server, so the runner needs no internet access; it
refuses non-local database targets.

## Behavior notes

- **Idempotent identity, append-only history:** re-running an input reuses
  the business, source record, contact methods, domain, website, and prospect
  (database constraints, not in-memory dedupe), while each run appends new
  snapshot/analysis/observation/feature-set/score/decision records — that is
  ADR-004's history model, not a bug. A closed pursuit is never silently
  reopened; new evaluations attach to it with a note.
- **Error model:** a missing, broken, or unreachable website is a negative
  *observation* and the pipeline completes; infrastructure failures (database
  down) throw and abort the run.
- **Network safety:** the analyzer resolves hostnames before connecting and
  refuses loopback/private/link-local/CGNAT/metadata destinations, with
  timeouts, a redirect limit, a body-size cap, and content-type checks.
  Tests and the fixture runner opt into loopback explicitly. Known limit:
  check-then-fetch resolves DNS twice, so sub-second-TTL rebinding is not
  fully defended; a pinned-dial transport belongs to the discovery phase.
- Temporarily fetched HTML is hashed and discarded after signal extraction —
  no HTML blobs are stored in PostgreSQL.

## Known limitations (intentional in Phase 4)

Phase 4 does **not** know: Google review counts, review velocity, social
activity, ad activity, employee count, revenue, real owner identity,
decision-maker verification, Lighthouse performance, or visual design age.
ACTIVITY therefore uses only input-provided signals (phone/email listed) and
overlaps with REACHABILITY until enrichment exists. Value bands cover a
handful of industries. These arrive with enrichment and analyzer expansion —
nothing here pretends otherwise.

## Intentionally deferred

Internet-scale discovery, scraping, paid data sources, local AI, demo
generation, outreach, admin UI, Neon, and Cloudflare deployment.
