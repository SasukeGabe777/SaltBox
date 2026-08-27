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

## Provisioned environment

The first hosted environment is live. All identifiers below are non-secret;
the Neon connection string is held by Cloudflare (Hyperdrive) and, for local
operator tooling, in git-ignored `.data/neon-staging.url`.

| Resource | Value |
| --- | --- |
| Cloudflare account | `587c410c995716940542dfe4cd3cf6a9` |
| Worker | `saltbox-demos` |
| Origin | `https://saltbox-demos.saltbox-demos.workers.dev` |
| R2 bucket | `saltbox-demo-assets` (binding `DEMO_ASSETS`) |
| Hyperdrive | `bd10802e4efb432085ada1ba17b8d2e9` (binding `HYPERDRIVE`, caching disabled) |
| Database | Neon `saltbox-staging`, PostgreSQL 18, `aws-us-west-2`, database `saltbox` |

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

Wrangler is a pinned workspace devDependency, so `pnpm install` is enough —
no global install. First-time provisioning, performed once:

```powershell
pnpm exec wrangler login                            # interactive, ~2 minute window
pnpm exec wrangler r2 bucket create saltbox-demo-assets
pnpm dlx neonctl@2 auth                             # interactive
pnpm dlx neonctl@2 projects create --name saltbox-staging --database saltbox
# store the connection string in git-ignored .data/neon-staging.url, then:
$env:DATABASE_URL = (Get-Content .data\neon-staging.url -Raw).Trim(); pnpm db:migrate
pnpm exec wrangler hyperdrive create saltbox-demos `
  --connection-string="<neon-unpooled-url>" --caching-disabled
# paste the returned id into apps/demos/wrangler.toml, then:
pnpm demos:deploy
```

Enabling R2 on a Cloudflare account is a dashboard action with a payment
method on file; the free tier (10 GB storage, 1M writes/month) covers SaltBox
by orders of magnitude. Applying migrations to a remote database needs only
`DATABASE_URL` — it is forward-only DDL, not the disposable-database tooling
that `SALTBOX_ALLOW_REMOTE_DB_TOOLING=1` guards.

A newly registered `workers.dev` subdomain takes a few minutes to serve TLS;
until then the hostname resolves but the handshake fails.

## Getting a demo into a hosted environment

The hosted renderer reads its own database, so a demo must exist there:

```powershell
pnpm demos:stage --prospect <uuid> --target-url-file .data\neon-staging.url
$env:DATABASE_URL = (Get-Content .data\neon-staging.url -Raw).Trim()
pnpm demos:publish --demo <demo-id> --environment hosted --base-url https://...
pnpm demo:qa --token <locator> --mode public --base-url https://...   # hosted QA
pnpm demo:review --demo <demo-id>                                     # review/approve there
```

`demos:stage` copies the MINIMUM state for one approved demo — identity,
provenance, qualification lineage, every DemoVersion, the locator, QA
evidence, review history, and the approval pointer — preserving ids,
version numbers, and timestamps. It is not a database dump, it refuses a demo
with no approved version, it never deletes, and it deliberately copies no
suppression state so a target can never silently lose one.

`demo:review` is the same approval domain service the admin uses, for
environments the admin is not pointed at.

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

- Provisioning required interactive logins (Cloudflare, Neon) and a dashboard
  action to enable R2. Redeploys and publications are fully automated.
- Hosted publication uploads through the wrangler CLI; a non-interactive CI
  path would need R2 S3-API credentials, which SaltBox deliberately does not
  store yet.
- The hosted environment holds only promoted demos. Discovery, intelligence,
  and generation still run locally against Docker PostgreSQL; `demos:stage`
  is the bridge until a hosted pipeline is a deliberate decision.
- No custom domain, no cache/CDN tuning, no multi-region strategy.
- No backup policy yet for a remote database beyond the provider's own
  restore window — see the durability note in ADR-005. This must be decided
  before any non-reproducible customer data lives there.
