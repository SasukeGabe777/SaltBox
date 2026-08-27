# @saltbox/admin

The SaltBox Admin Prospect Viewer is the local, read-only operator surface for
Originally Phase 5A, now extended for Phase 7. It makes persisted v1 and v2
qualification history inspectable in
a browser without creating a second write path.

## Architecture

- React Router 8 Framework Mode with TypeScript and server-side rendering
- React 19
- Server-only reads through `@saltbox/database/queries/admin`
- Kysely over the existing local PostgreSQL connection
- Plain CSS using the established SaltBox visual language; no UI framework

Route loaders return deliberate read models. React components do not issue SQL,
and PostgreSQL credentials never enter browser JavaScript. There are no route
actions, mutation endpoints, or operator controls that change SaltBox state.

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

- Local-only; no authentication, authorization, deployment, or Neon connection
- Read-only; no edits, transitions, retries, suppression, outreach, or deletes
- Phase 4 does not persist fixture city/state fields, so location displays as
  “Not observed” unless future source metadata supplies them
- Recent activity is a bounded operator feed, not a streaming event system
- No discovery, demo generation, outreach, billing, AI, or product mutations
- No speculative schema migration or index was added for Phase 5A
