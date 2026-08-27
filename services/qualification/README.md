# @saltbox/qualification

Phase 7 deterministic deep-intelligence qualification. This service sits
between discovery and the existing website-intelligence package so v1 remains
unchanged and package dependencies stay acyclic.

```text
discovery -> ingestion -> website-intelligence-v1
          -> prospect-qualification-features-v2
          -> qualification-v2
          -> qualification-policy-v2
          -> append-only decision and lifecycle/result
```

The operator entry point is at the repository root:

```text
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
```

Defaults are intentionally bounded: limit 3 per source and deep concurrency
1. Hard maxima are 10 and 2. `--strict` returns non-zero when target analysis
fails; normal target failures produce `completed_with_target_failures` and
exit successfully. Database/configuration errors and globally unavailable
Chromium produce `failed` and a non-zero exit. No command sends outreach.

## Versioned contract

| Artifact | Version |
| --- | --- |
| Feature schema | `prospect-qualification-features-v2` |
| Scoring | `qualification-v2` / artifact `2.0.0` |
| Decision policy | `qualification-policy-v2` |
| Pipeline | `deep-intelligence-qualification-pipeline-v2` |
| Deep analyzer input | `website-intelligence-v1` |

All configuration is in `src/config/qualification-v2.ts`. These values are
human hypotheses, not learned weights or conversion probabilities.

## Formula

Each dimension is capped at 100, then:

```text
overall = round(Need * 0.45 + Value * 0.20 + Activity * 0.10 + Reachability * 0.25)
```

The qualification threshold is inclusive at 60. Policy hard-rejects active
global/business suppression, no genuine contact path, and strong deterministic
non-target classifications regardless of score.

Need uses documented bands for confirmed missing/unreachable websites, HTTPS,
mobile overflow/viewport, Lighthouse performance, LCP/TBT/CLS, CTA/form,
title/meta, browser errors, meaningful broken links, stale copyright, and
shallow structure. Definitive `dns_not_found` contributes Need; transient
`dns_transient` contributes zero and emits
`TRANSIENT_INTELLIGENCE_FAILURE_NO_PENALTY`. Missing metrics after a partial
run do not become negative evidence. A transient fatal run records a rejected
decision with `TRANSIENT_INTELLIGENCE_RETRY_REQUIRED` but deliberately leaves
the lifecycle at `evaluated`, so a retry can append a conclusive result rather
than converting temporary DNS evidence into a terminal website rejection.

Value retains the small explicit v1 industry bands. Unknown is explicit.
SaltBox does not infer revenue, staff, purchasing power, ad spend, or volume.

Activity is deliberately limited to current/recent copyright evidence and a
functioning multi-page site. It does not equate technical quality with company
activity and remains the least mature dimension.

Reachability uses discovered phone/email and observed website phone/email
links, a contact form/page, and quote/booking paths. A business with none is a
policy rejection even if Need is high.

Narrow, explainable name/category rules identify obvious national chains,
government, education, major institutions, supplier/manufacturers, and
directories/aggregators. Ambiguous businesses remain eligible.

## Evidence deliberately excluded

Accessibility and SEO aggregate scores, best-practices score, FCP/Speed Index,
platform/CMS, social links, robots/sitemap/favicon, asset counts, request bytes,
visible address, structured-data types, and raw word count do not affect v2.
They remain operator context. No review, revenue, employee, ad, or owner facts
are invented when unavailable.

## History and point in time

Every run appends FeatureSet, LeadScore, Decision, reasons, observations, and
website analysis. v1 records are never updated. FeatureSet `as_of` is taken
after this run's deep evidence is persisted, and lineage points to the exact
observations/analysis used. Later evidence never changes an earlier result.
Rediscovery/requalification reuses business/prospect identity and appends v2
history. A terminal or already-advanced lifecycle is not force-reopened; the
new decision remains qualification history and the skipped transition is
reported.
