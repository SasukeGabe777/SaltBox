# @saltbox/operator

Bounded operator work started from the admin instead of PowerShell (Phase 10).
Lifecycle and rules: [`docs/OPERATOR_APPROVAL.md`](../../docs/OPERATOR_APPROVAL.md).

```text
admin form -> parameters.ts (hard bounds) -> operator_run (queued)
           -> detached worker process     -> execute.ts
           -> progress + per-target rows   -> admin polls
```

- `src/parameters.ts` — validation and the safe limits (≤10 businesses per
  source, ≤25 km, concurrency ≤2, adapter-supported categories only, only the
  committed composition keys). Dependency-light so the admin can import it
  inside a request. A test asserts the bounds equal the discovery pipeline's.
- `src/enqueue.ts` — writes the queued run, emits the audit event, and spawns
  the local worker detached so the run outlives the HTTP request.
- `src/execute.ts` — the only place that performs the work: acquisition,
  demo generation followed by QA, standalone QA, publication, and a narrow
  intelligence retry. Preserves Phase 6/7 target-failure isolation.
- `src/reingest.ts` — faithfully rebuilds a discovery input from persisted
  provenance so a retry re-analyses the same identity with the same observed
  contact evidence (identity stays stable by `(source, external_id)`).

```powershell
pnpm operator:worker -- --run <uuid>   # execute one queued run
pnpm operator:worker -- --drain        # execute everything queued
```

The worker refuses a non-local database like every other SaltBox operator
tool, and never sends outreach.
