# Demo Hosting — Phase 10

Phase 8/9 demos were only reachable at `http://127.0.0.1:5175`. Phase 10 gives
them a durable public home without changing the architecture that makes them
cheap: **one renderer, many demos**, no per-prospect project, build, bucket,
or deployment.

```text
Cloudflare Worker (apps/demos/worker)
        ↓ shared handler + templates (apps/demos/server)
        ↓ Kysely + pg                      (ADR-006 runtime boundary)
        ↓ Hyperdrive binding, cache off    (ADR-005: approval must not be stale)
        ↓ Neon PostgreSQL                  (authoritative demo metadata)
        ↓ R2 bucket binding                (durable demo assets)
```

The Node server (`server/app.ts`) and the Worker (`worker/index.ts`) are two
thin adapters over the same `handleDemoRequest`. Neither contains templates or
business rules, so a demo cannot render differently in the two runtimes.

## Resolution modes — the public-safety boundary

| Mode | Serves | Used by |
| --- | --- | --- |
| `preview` | the demo's **current** version | the local operator renderer (default) |
| `public` | the **approved** version only | the hosted Worker, and any local run with `SALTBOX_DEMOS_MODE=public` |

Consequences, all covered by tests:

- Before approval, the public locator returns 404 — the same response as an
  unknown, revoked, or expired token, so a visitor learns nothing about what
  exists.
- Regenerating does **not** change what the public URL serves. The prospect's
  link keeps showing the approved version until the operator approves the new
  one; then the same link switches. The locator never changes.
- Withdrawing approval takes the public demo (and its assets) offline again.

```powershell
# prove it locally, no cloud account required
$env:SALTBOX_DEMOS_MODE="public"; $env:SALTBOX_DEMOS_PORT="5177"; pnpm demos:start
```

## Artifact storage

`@saltbox/artifact-store` is a deliberately tiny provider-neutral boundary:
`put` / `get` / `has` over a validated key.

```text
demo publication -> ArtifactStore -> LocalArtifactStore (.data, development)
                                  -> R2ArtifactStore    (Cloudflare binding, hosted)
```

- Keys are `demo-assets/<run-ref>/<file>` — lowercase, ≤4 segments, no `..`,
  no absolute paths, no backslashes. Both stores validate before touching
  storage, and the local store re-checks the resolved path against its root.
- PostgreSQL stores only metadata (`demo_asset`): content type, byte size,
  SHA-256, storage provider, and key. **No blob ever enters the database.**
- `src/r2.ts` describes the R2 binding structurally and imports no Node APIs,
  so no Cloudflare types leak into SaltBox code and the module runs in workerd.

## Publication

`pnpm demos:publish --prospect <uuid> [--environment local|hosted]` (or the
admin's PUBLISH buttons) collects every asset the **approved** version renders,
copies it into that environment's store, records `demo_asset` rows with
`published_at`, and completes a `demo_publication` row with the durable URL.

- Publication refuses any demo without an approved version.
- Only well-formed local `/demo-assets/<ref>/<file>` URLs are published; a
  remote URL, a traversal attempt, or a non-image reference inside persisted
  content is ignored, never fetched.
- A missing source asset fails the publication instead of publishing a demo
  with broken images.
- Hosted asset requests resolve through PostgreSQL, not the bucket: an asset
  is retrievable only when it is recorded as published **and** its demo still
  has an approved version. Website-intelligence artifacts, Lighthouse reports,
  screenshots, and anything else under `.data` are unreachable by construction.

Hosted uploads use the operator's existing `wrangler login` rather than
long-lived R2 access keys, so SaltBox stores no additional standing
credentials. The hosted renderer itself never shells out to anything — it
reads R2 through its binding.

## Deployment

```powershell
pnpm demos:deploy:check   # preflight: no network, no account needed
pnpm demos:deploy         # requires an authenticated Cloudflare session
```

The preflight reports **every** blocker at once (missing wrangler, missing
login, unreplaced configuration placeholders) with the exact one-time command
that clears each one, and exits 0 in `--check` mode so it is safe in CI.

`apps/demos/wrangler.toml` is committed, non-secret configuration: worker name,
pinned compatibility date, `nodejs_compat`, the Hyperdrive binding, and the R2
bucket. Connection strings and API tokens are Worker secrets or provider
bindings and never appear in the repository. Deployment never runs migrations
(ADR-006 prohibits migration-on-start); migrations are applied from Node
tooling against the database directly.

First-time provisioning, all one-time operator actions:

```powershell
wrangler login
wrangler r2 bucket create saltbox-demo-assets
neonctl projects create --name saltbox-staging      # or the Neon console
pnpm --filter @saltbox/database db:migrate          # with DATABASE_URL + SALTBOX_ALLOW_REMOTE_DB_TOOLING=1
wrangler hyperdrive create saltbox-demos --connection-string "<neon-unpooled-url>"
# paste the returned id into apps/demos/wrangler.toml, then:
pnpm demos:deploy
```

The resulting URL is `https://saltbox-demos.<account>.workers.dev/d/<locator>`.
A custom domain is deliberately not required.

## Database environments

Local development is unchanged and stays offline-capable: Docker PostgreSQL 18
on port 5433, the local artifact store, the admin dev server, and the demo dev
renderer. Nothing in the local workflow depends on a cloud resource.

The hosted renderer needs its own PostgreSQL (ADR-005 selected Neon). It is a
SaltBox development/staging database built from the same committed migrations —
never a hand-crafted schema. The disposable-database verification path
(`pnpm db:verify`, the test harness) refuses non-local hosts unless
`SALTBOX_ALLOW_REMOTE_DB_TOOLING=1` is set explicitly, so remote state cannot
be dropped by routine tooling.

Demo rows, locators, and artifacts are machine-local until they are published
to a shared environment; regenerate rather than copy them between machines.

## Security posture

- Public routes are read-only: `GET`/`HEAD` only, `405` otherwise. No mutation
  endpoint exists on the demo surface, and the mutable admin is **not hosted**.
- `noindex, nofollow` on every response (meta + `X-Robots-Tag`), `robots.txt`
  disallowing everything, no sitemap, and no page that enumerates demos.
- Locators are `crypto.randomBytes(18)` base64url tokens, never derived from
  internal identifiers; internal ids never appear in a public payload.
- CSP stays `default-src 'none'` with `form-action 'none'` — the demo quote
  form cannot submit anywhere in any environment, and no contact reaches the
  business. Click-to-call `tel:` links use the business's own observed number.
- Templates render escaped plain text only; no prospect HTML, script, or
  remotely hosted asset ever reaches a demo page.
- The renderer performs no outbound requests, so it has no SSRF surface;
  hostile fetching remains confined to the Phase 6 intelligence boundary.

## Analytics boundary (future)

`demo_view`, `demo_engaged`, and `demo_cta_click` already exist in the event
registry, and every hosted request resolves a concrete `demo_version_id`, so a
future intent signal can be recorded against the exact artifact a prospect saw
without changing this architecture. Phase 10 records none of it: no visitor
events, no cookies, no fingerprinting, no third-party analytics.

## Cost

Free/near-$0 by construction: one Worker, one R2 bucket, one small PostgreSQL,
no paid AI, no image CDN, no analytics vendor, and no per-prospect resources.
Local development costs nothing at all.

## Known limitations

- Hosted deployment requires a one-time interactive Cloudflare login; the
  preflight reports this cleanly rather than pretending.
- Hosted publication uploads through the wrangler CLI; a non-interactive CI
  path would need R2 S3-API credentials, which SaltBox deliberately does not
  store yet.
- No custom domain, no cache/CDN tuning, no multi-region strategy.
- No backup policy yet for a remote database beyond the provider's own
  restore window — see the durability note in ADR-005. This must be decided
  before any non-reproducible customer data lives there.
