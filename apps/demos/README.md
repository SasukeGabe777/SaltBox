# @saltbox/demos

The SaltBox demo renderer: **one** renderer serving **many** prospect demos,
in two runtimes — a local Node server and a Cloudflare Worker — over the same
handler and templates. Architecture and safety posture:
[`docs/DEMO_GENERATION.md`](../../docs/DEMO_GENERATION.md) and
[`docs/DEMO_HOSTING.md`](../../docs/DEMO_HOSTING.md).

```powershell
pnpm demos:dev                            # http://127.0.0.1:5175/ (loopback, preview mode)
pnpm demo:qa --token <public-locator>     # 28 desktop/mobile checks, persisted as QA evidence
pnpm demos:publish --prospect <uuid>      # publish the APPROVED version's assets
pnpm demos:deploy:check                   # hosted deploy preflight (no account needed)
pnpm demos:deploy                         # deploy the Worker (needs `wrangler login`)
```

- `server/handler.ts` — the runtime-neutral request handler. No Node or
  Cloudflare APIs; both adapters supply the same two ports.
- `server/app.ts` — Node adapter (Kysely + the local artifact store).
- `worker/index.ts` — Cloudflare Worker adapter (Hyperdrive + R2 bindings).
- `qa/run-qa.ts` — the reusable QA runner the CLI and the admin both use.
- `hosting/` — committed non-secret wrangler config reader and the
  operator-tool R2 uploader.

Resolution mode is the public-safety boundary. `preview` (default) serves the
demo's current version for operator review; `public` — always used by the
hosted Worker, and available locally via `SALTBOX_DEMOS_MODE=public` — serves
**only** the operator-approved version, and only assets recorded as published
for an approved demo.

- `GET /d/<public-locator>` resolves an opaque locator to a persisted version
  and renders it with the registered composition (`local-service-premium/bold/
  clean`, or the frozen Phase 8 `local-service` template for old versions).
  Internal IDs never appear in URLs and nothing enumerates demos.
- `GET /demo-assets/<run-ref>/<file>` serves validated brand assets only
  (strict ref/filename patterns, allowlisted image types, no traversal). In
  public mode PostgreSQL is the authority on what is retrievable. Prospect
  sites are never hotlinked.
- Every response is `noindex, nofollow` + `no-store` with a strict CSP
  (`default-src 'none'`, `form-action 'none'`, `img-src 'self' data:`) — the
  demo contact form cannot submit anywhere and no external origin is
  reachable. `robots.txt` disallows everything.
- Templates consume the versioned demo-content contract only (escaped plain
  text; v1 and v2 both render); no database rows or prospect HTML reach
  rendering code.
- Configuration: `SALTBOX_DEMOS_PORT` (default 5175), `SALTBOX_DEMOS_MODE`
  (`preview` | `public`); the admin builds VIEW DEMO links from
  `SALTBOX_DEMOS_BASE_URL`.
- The Node server binds to 127.0.0.1. The hosted Worker is public by design
  but read-only: `GET`/`HEAD` only, approved versions only, no mutation route.

QA screenshots are written to git-ignored `.data/demos/qa/<locator>/`.
