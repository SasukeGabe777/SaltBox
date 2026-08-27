# @saltbox/admin

The SaltBox operator surface. Originally a read-only Phase 5A viewer, extended
through Phase 7 (qualification v2 evidence) and Phase 10, where it becomes the
place the demo lifecycle is actually run: review, approval, regeneration,
publication, and bounded acquisition runs. See
[`docs/OPERATOR_APPROVAL.md`](../../docs/OPERATOR_APPROVAL.md).

## Architecture

- React Router 8 Framework Mode with TypeScript and server-side rendering
- React 19
- Server-only reads through `@saltbox/database/queries/admin`
- Kysely over the existing local PostgreSQL connection
- Plain CSS using the established SaltBox visual language; no UI framework

Route loaders return deliberate read models. React components do not issue SQL,
and PostgreSQL credentials never enter browser JavaScript.

Phase 10 adds a deliberately narrow mutation surface: demo review/approval and
bounded operator runs, and nothing else. There are still no generic CRUD
controls for businesses, prospects, scores, or decisions — that history stays
evidence. Every mutation is same-origin checked, carries the operator actor
identity (`SALTBOX_OPERATOR_REF`, default `local-operator`), and goes through a
domain service that enforces the approval invariant and writes audit history.
Long work never runs inside a request: the admin queues an `operator_run` and a
detached local worker executes it.

> [!IMPORTANT]
> This application is local-only and intentionally has no authentication in
> Phase 5A. **PRODUCTION DEPLOYMENT REQUIRES AUTHENTICATION AND AUTHORIZATION.**
> Do not deploy or expose it beyond the local development machine in its
> current form.

## Prerequisites

From the repository root:

```text
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:verify
```

On Windows PowerShell, use `pnpm.cmd` if the PowerShell `pnpm.ps1` shim is
blocked by execution policy.

## Start the viewer

```text
pnpm admin:dev
```

Open:

```text
http://127.0.0.1:5174
```

The development server binds to loopback only and refuses to select another
port silently.

## Populate it with local fixtures

Terminal 1:

```text
pnpm admin:dev
```

Terminal 2:

```text
pnpm prospect:qualify --fixture roofing-good
pnpm prospect:qualify --fixture bakery-strong-site
pnpm prospect:qualify --fixture plumbing-broken-site
pnpm prospect:qualify --fixture landscaping-no-website
pnpm prospect:qualify --fixture gallery-no-contact
```

Existing fixture data appears immediately. New append-only runs appear on the
next automatic refresh.

## What the viewer displays

- Total, qualified, rejected, and analyzed prospect counts
- Recent activity derived only from persisted lifecycle, website-analysis,
  score, and decision records
- Prospect list with latest score dimensions, source, website, lifecycle,
  decision, and analysis time
- Business-name, decision, and score-range filters
- Case-file detail with structured decision reasons and raw reason codes
- Need, Value, Activity, and Reachability meters explicitly labeled as a
  heuristic priority score—not conversion probability
- Deterministic website-analysis findings and ordinary failure observations
- Append-only score, FeatureSet, Decision, and policy/version history
- Clear v1/v2 current-versus-historical labels, prior v1 score, v2 feature
  contributions, reason codes, and persisted evidence lineage
- Deep-intelligence completion/partial/failure state and versioned v2 activity
- Point-in-time observations with distinct `observed_at` and `recorded_at`
- Source records/provenance and chronological prospect lifecycle transitions

## What the operator can do (Phase 10)

- **START ACQUISITION** — a bounded discovery → intelligence → qualification
  run with policy-enforced limits, watched live on `/runs`.
- **GENERATE / REGENERATE DEMO** — optionally forcing one of the committed
  compositions or re-extracting brand assets; QA runs automatically afterwards
  and the new version returns to review.
- **RUN QA** — re-record automated QA evidence for the current version.
- **APPROVE / REJECT / WITHDRAW APPROVAL** — move or clear the approved
  version. Approval pins one exact DemoVersion, is audited, is blocked by
  critical QA failures without a written override, and can never be given to a
  suppressed business.
- **PUBLISH (LOCAL / HOSTED)** — publish the approved version's assets.
- **RETRY INTELLIGENCE** — a narrow, audited retry after a transient failure.

The prospect case file also shows readiness (with explicit blockers), the
version history with per-viewport QA, review/publication history, and the
hosted URL when one exists.

## Refresh behavior

Dashboard and detail routes revalidate every three seconds while the browser
tab is visible. A visible **Refresh now** control triggers the same safe loader
revalidation. No WebSocket, queue, Redis, or external real-time service is used.

## Commands

```text
pnpm admin:dev
pnpm admin:check
pnpm admin:build
pnpm admin:test
```

Workspace-wide `pnpm check`, `pnpm build`, and `pnpm test` include the admin
application where appropriate.

## Known limitations and intentionally deferred work

- Local-only; no authentication, authorization, or deployment. The admin is
  NOT hosted alongside the public demo renderer, and must not be.
- Mutations are limited to demo review/approval and bounded runs; no lifecycle
  edits, suppression changes, outreach, or deletes exist
- Phase 4 does not persist fixture city/state fields, so location displays as
  “Not observed” unless future source metadata supplies them
- Recent activity is a bounded operator feed, not a streaming event system
- No discovery, demo generation, outreach, billing, AI, or product mutations
- No speculative schema migration or index was added for Phase 5A
