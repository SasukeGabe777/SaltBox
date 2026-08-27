# Qualification v2 — Phase 7

Phase 7 connects SaltBox's deep website evidence to deterministic prospect
qualification. The implementation and scoring contract are documented in
[`services/qualification`](../services/qualification/README.md).

## Operator flow

```text
pnpm db:up
pnpm db:migrate
pnpm admin:dev

# another terminal
pnpm discovery:data --location "Ogden, UT" --radius-km 30
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
```

Open `http://127.0.0.1:5174/`. The viewer refreshes every three seconds and
shows deep intelligence, v2 dimensions/reasons, versioned score/decision
history, evidence lineage, and preserved v1 history where present.

Individual `pnpm discover`, `pnpm website:intelligence`, and
`pnpm prospect:qualify` commands remain available for comparison, targeted
re-analysis, and v1 regression/debugging.

## Result and exit behavior

- `completed`: all selected targets completed without target analyzer failure.
- `completed_with_target_failures`: every candidate reached a persisted v2
  result but at least one DNS/TLS/timeout/page/Lighthouse analysis failed.
  Normal operator execution exits 0 and prominently lists targets.
- `failed`: configuration, database, schema, discovery-source, unrecoverable
  application, or global Chromium initialization failure; exits non-zero.
- `--strict`: makes target failures exit 2 for CI/debug use without changing
  persisted results.

`EAI_AGAIN`/`dns_transient` is attempt-level neutral evidence. Confirmed
`ENOTFOUND`/`dns_not_found` may contribute Need. Neither failure rewrites the
business's website identity.

## Limitations

Weights and the threshold are unvalidated hypotheses. Lighthouse is lab data,
not field-user data. Activity evidence is sparse. Target-fit rules recognize
only strong cases. Browser analysis remains relatively slow and bounded rather
than distributed. Phase 7 has no UI controls, outreach, AI, paid API, demo
generation, authentication, or production deployment.
