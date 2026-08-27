# Operator Review and Approval — Phase 10

Phase 8 built demos. Phase 9 made them look like the business. Phase 10 makes
the demo **lifecycle** something an operator runs from the browser, and
introduces the invariant everything downstream depends on:

> **Only an APPROVED DemoVersion may later be used for outreach.**
> Generation does not imply approval. A QA pass does not imply approval.
> "Latest" does not imply approval.

```text
discovery -> qualification -> bespoke demo -> automated QA
   -> OPERATOR REVIEW -> approve / regenerate / reject
   -> approved DemoVersion -> durable hosted URL -> READY FOR OUTREACH
```

Nothing in Phase 10 contacts a prospect. `READY FOR OUTREACH` is the end of
the pipeline, not the start of a send.

## The objects

| Concept | Meaning |
| --- | --- |
| `Demo` | The long-lived identity for this prospect's pursuit, and the owner of the public locator. |
| `DemoVersion` | One immutable generated version. Append-only; never edited. |
| Approval | `demo.approved_demo_version_id` — one exact version, moved only by an operator decision. |
| `demo_version_review` | Append-only audit history of every approval and rejection. |
| `demo_version_qa_result` | Append-only automated QA evidence for one exact version. |
| `demo_publication` | One attempt to make an approved version available in an environment. |

A demo can therefore be in the state the operator actually cares about:

```text
v1 generated -> QA passed -> v1 approved
v2 generated (regeneration)          <- approval is STILL v1
v3 generated                          <- approval is STILL v1
v3 approved                           <- now, and only now, v3
```

There is deliberately no separate "state machine" column duplicating this.
Generated / qa_passed / qa_failed / needs_review / approved / rejected are all
derivable from evidence that already exists, and derived states cannot drift
away from the evidence that justifies them.

## The QA gate

`pnpm demo:qa` (and the admin's RUN QA / regeneration flow) records a
`demo_version_qa_result` against the exact version rendered: 14 checks per
viewport, desktop and mobile.

Ten of those are **critical** — they make a demo unusable or unsafe in front
of a business owner:

```text
HTTP 200 · no horizontal overflow · no console errors · CTA visible
contact path present · all images load · brand mark renders
noindex directive · no external scripts · demo disclosure present
```

Approval is blocked when the latest QA result for that version is missing, has
critical failures, or did not pass. An operator may still approve by supplying
a written override reason, which is recorded on the review, referenced by the
decision, and emitted as an `operator_override` audit event. Suppression is
the one blocker that is **never** overridable.

## Ready for outreach

Derived on read (`getProspectDemoView().readiness`), never stored:

1. the prospect has a current `qualification-policy-v2` **qualified** decision;
2. no active suppression covers the business (global or business scope);
3. an operator has approved a specific DemoVersion;
4. that version's QA recorded no critical failures;
5. that exact version is published at a durable hosted URL.

The admin shows the blockers, not just the verdict. A suppressed prospect keeps
its demo and its history, and can never be ready — approval cannot override
suppression, and approving a suppressed business is refused outright.

## Operator actions in the admin

The admin is no longer read-only, but its mutation surface is deliberately
narrow — demo lifecycle and bounded run submission only. There are no generic
CRUD controls for businesses, prospects, scores, or decisions.

| Action | Effect |
| --- | --- |
| START ACQUISITION | Queues a bounded discovery → intelligence → qualification run. |
| GENERATE / REGENERATE DEMO | Queues generation (optionally forcing a composition or re-extracting brand assets), then QA. The new version returns to review. |
| RUN QA | Re-runs QA against the current version and records new evidence. |
| APPROVE / REJECT / WITHDRAW APPROVAL | Moves or clears the approved pointer, with audit history. |
| PUBLISH (LOCAL / HOSTED) | Publishes the **approved** version's assets to that environment. |
| RETRY INTELLIGENCE | Re-runs website intelligence and qualification v2 for one prospect after a transient failure. |

Every mutation is same-origin checked, carries the operator actor identity
(`SALTBOX_OPERATOR_REF`, default `local-operator`), and goes through a domain
service — never ad-hoc SQL in a route.

## Operator identity

Phase 10 remains a single-operator local system. The actor is an explicit
`operator` actor reference recorded on decisions, reviews, publications, runs,
and events. When authentication arrives it replaces where that string comes
from; no call site changes, because everything downstream already takes an
actor reference rather than a session.

The admin still binds to loopback and must not be exposed publicly.

## Operator runs

Long work never runs inside an HTTP request. The admin validates a small form,
writes a queued `operator_run`, and spawns a detached local worker
(`services/operator/scripts/worker.ts`) that claims the run and reports
progress back through the database. The admin polls with its existing
three-second revalidation — the simplest robust mechanism at this scale.

```powershell
pnpm operator:worker -- --run <uuid>    # recover a run whose worker died
pnpm operator:worker -- --drain         # execute everything queued
```

Bounds are enforced before a run row exists: at most 10 businesses per source,
25 km radius, deep-analysis concurrency 2, and only categories a discovery
adapter actually supports. A repeated submission of the same request joins the
active run instead of starting a second one.

Phase 6/7 failure semantics are preserved end to end: an isolated target
failure completes the run as `completed_with_target_failures` and appears in
the admin's target-failure list with its DNS/TLS/timeout classification, ready
for a narrow, audited retry. Only configuration, database, or global-browser
problems make a run `failed`.

## Events

```text
demo_generated · demo_regenerated · demo_qa_passed · demo_qa_failed
demo_approved · demo_rejected · demo_published (publication, not generation)
acquisition_run_started · acquisition_run_completed · retry_requested
operator_override (audited QA override)
```

`demo_published` now means what its registry description always said — a demo
version became publicly visible. Generation emits `demo_generated` /
`demo_regenerated` instead. Events from Phase 8/9 remain untouched history.

## What Phase 10 still does not do

No outreach, no email, no reply processing, no billing, no customer login, no
production website deployment for customers, no custom prospect domains, no
CRM beyond the operator case file, no distributed queues, no AI calling, and
no learned intent score. See [DEMO_HOSTING.md](DEMO_HOSTING.md) for the
hosting side and its known limitations.
