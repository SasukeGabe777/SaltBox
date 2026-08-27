# HISTORICAL PHASE 10 HANDOFF — SUPERSEDED AFTER PHASE 11.

For the current cross-machine state, read `docs/HOME_PC_HANDOFF.md` first.
The repository is now complete through Phase 11 at implementation commit
`69aaaf9c82687d422858fcc595e96937580f5b13`; this file is retained only as the
detailed Phase 10 handoff record.

# READ THIS FIRST BEFORE CONTINUING SALTBOX DEVELOPMENT.

Prepared 2026-08-27 on the Windows work PC in `C:\dev\SaltBox`, handing
development from Claude back to Codex. The committed repository is
authoritative; this document is orientation, not a substitute for reading the
code.

---

## CURRENT STATE

- Branch: `main`. Working tree clean. `HEAD` == `origin/main`.
- HEAD: `4dc295e4ae22719babee7744c4b9e1791ee4cacf`

```text
4dc295e Deploy the hosted demo renderer
9b60f10 Implement demo hosting and operator approval
ed20021 Improve demos with brand and asset intelligence
113b501 Implement automated demo generation
d821c27 Update Claude development handoff
2392601 Implement deep-intelligence qualification v2
1843b6e Improve website intelligence failure isolation
ae046b1 Implement website intelligence v2
2d4af41 Expand multi-source business discovery
97fb2a3 Implement real business discovery MVP
```

Completed phases: 3 (database foundation), 4 (qualification v1), 5A (admin
viewer), 5B/5C (OSM + Overture discovery), 6 (deep website intelligence),
7 (qualification v2 + `pnpm acquire`), 8 (automated demo generation),
9 (brand/asset intelligence), 10 (demo hosting + operator approval, including
the live Cloudflare deployment).

### Monorepo

```text
apps/website             preserved Astro marketing prototype
apps/admin               React Router 8 operator surface (loopback, :5174)
apps/demos               ONE demo renderer: Node server + Cloudflare Worker
services/prospecting     ingestion, lightweight analysis, qualification v1
services/discovery       OSM + Overture adapters, acquisition orchestration
services/website-intelligence  Chromium/Lighthouse analysis + brand extraction
services/qualification   qualification v2 features/score/policy
services/demo-generation plan/content/approval/QA/publication
services/operator        bounded operator runs + the local run worker
packages/database        PostgreSQL/Kysely, migrations, repositories, queries
packages/artifact-store  provider-neutral artifact storage (local | R2 | memory)
```

Key architecture documents: `docs/ARCHITECTURE.md`, ADR-001…006 in
`docs/decisions/`, `docs/QUALIFICATION_V2.md`, `docs/DEMO_GENERATION.md`,
`docs/BRAND_ASSET_INTELLIGENCE.md`, `docs/OPERATOR_APPROVAL.md`,
`docs/DEMO_HOSTING.md`, plus the README in each workspace.

---

## CURRENT WORKING PIPELINE

```text
business discovery (OpenStreetMap | Overture)
      ↓
deep website intelligence (hardened Chromium + Lighthouse)
      ↓
qualification v2 (features → score → policy, threshold 60)
      ↓
brand/asset intelligence (real logo, palette, photography, services)
      ↓
demo generation (deterministic plan → content → composition)
      ↓
automated QA (28 checks, desktop + mobile)
      ↓
OPERATOR APPROVAL (one exact DemoVersion)
      ↓
staging promotion + publication (assets → R2)
      ↓
public hosted demo (Cloudflare Worker, approved version only)
      ↓
READY FOR OUTREACH        ← the pipeline stops here; nothing is ever sent
```

---

## PHASE 10 LIVE INFRASTRUCTURE

Non-secret identifiers only. No credential, connection string, token, or
password appears in this repository.

| Resource | Value |
| --- | --- |
| Cloudflare Worker | `saltbox-demos` |
| Public origin | `https://saltbox-demos.saltbox-demos.workers.dev` |
| R2 bucket | `saltbox-demo-assets` (binding `DEMO_ASSETS`) |
| Hyperdrive config | `bd10802e4efb432085ada1ba17b8d2e9` (binding `HYPERDRIVE`, caching disabled) |
| Neon project | `saltbox-staging` |
| Neon database | `saltbox` |
| Engine | PostgreSQL 18 |
| Region | `aws-us-west-2` |

- All committed migrations (6) are applied to the hosted database.
- **Local Docker PostgreSQL 18 on port 5433 remains the development
  database.** Nothing in local development requires Neon or Cloudflare.
- The hosted database contains **promoted demo state only** — one business,
  its prospect, qualification lineage, demo versions, QA, review history and
  the approval pointer. It is not a copy of the development database.
- `pnpm demos:stage` is deliberately the local → staging bridge.
- Expected recurring infrastructure cost is approximately **$0**: Workers,
  R2, Neon and Hyperdrive all sit far inside free tiers (2 objects, ~0.5 MB
  in R2; ~10 MB in Neon). Enabling R2 required a payment method on file.

Committed non-secret Cloudflare configuration lives in
`apps/demos/wrangler.toml`. Wrangler is a pinned devDependency of
`apps/demos`; use `pnpm exec wrangler …` from that directory.

---

## REAL ACCEPTANCE TARGET — RIVERFRONT ROOFING

```text
https://saltbox-demos.saltbox-demos.workers.dev/d/0z-T5ccKc4k2PEeV6v-2DTEf
```

- Qualified under `qualification-policy-v2` with score **69**.
- Bespoke **premium** (image-forward) composition, selected deterministically.
- Real extracted brand identity: their logo (high confidence), their palette
  (from CTA buttons + logo dominant colors), their roof photography as the
  hero, and seven services taken from their own website.
- **Approved DemoVersion v3** — approved by an operator, not by generation.
- **READY FOR OUTREACH** in the admin (qualified + approved + QA-clean +
  hosted + not suppressed).
- Hosted QA: **28/28** desktop and mobile against the live HTTPS origin.
- Live security probes: **19/19**.
- Approved-version pinning proven against the live origin: approving the
  older v2 made the same URL serve v2 while v3 remained current; withdrawing
  approval 404'd both the page and its R2 assets; re-approving restored them.

Two other demos exist locally only: Utah Roof and Solar
(`F-KUt2u_DQeDVYozejyZeU6d`, honest clean fallback — its site is a parked
lander) and Legacy Roofing (`7fWZE2qDx2RTOS2x77Uq_HGt`, bold composition,
approved and published locally).

---

## IMPORTANT INVARIANTS

Do not weaken any of these without an explicit operator decision.

1. **One renderer, many demos.** No per-prospect project, build, bucket, or
   deployment — in either runtime.
2. **Internal IDs never appear in demo URLs** or in a public payload. Locators
   are opaque `randomBytes(18)` base64url tokens.
3. **Only an explicitly approved DemoVersion may be prospect-facing.**
   Generation does not approve. A QA pass does not approve. "Latest" does not
   approve.
4. **Regeneration never silently changes the approved version.** The public
   URL keeps serving the approved version until an operator approves another.
5. **Unapproved demos are not publicly resolvable** — the public route returns
   the same 404 as an unknown token, and their assets 404 too.
6. Demos stay **`noindex, nofollow`** (meta + header), `robots.txt` disallows
   everything, and nothing enumerates demos.
7. **Forms never submit to a real business.** CSP `form-action 'none'`, no
   form action, no outbound request from a demo page.
8. **Suppression cannot be overridden by demo approval.** An actively
   suppressed business cannot be approved and can never be ready for outreach.
   Suppression effectiveness is evaluated with the DATABASE clock.
9. **Local development must not require Neon or Cloudflare.**
10. **PostgreSQL is authoritative**, and **SQL migrations are authoritative**
    (`packages/database/migrations`). Never edit an applied migration; never
    hand-edit `generated/db.ts` — add a migration and run `pnpm db:codegen`.
11. **Large assets stay outside PostgreSQL** — only metadata, hashes, and
    storage keys are stored.
12. **Deterministic-first, local-AI-first, paid-AI-last** (ADR-001). No AI is
    used anywhere in the current pipeline.
13. **No outreach has occurred.** SaltBox has never contacted a business.

Also: never `UPDATE prospect.lifecycle_state` directly — use
`transitionProspect`. The admin stays loopback-only and must never be hosted
next to the public renderer.

---

## IMPORTANT COMMANDS

PowerShell may need `pnpm.cmd` when the `.ps1` shim is blocked.

```powershell
# Database (local development)
pnpm db:up                 # Docker PostgreSQL 18 on :5433
pnpm db:migrate            # apply the ordered migration history
pnpm db:codegen            # regenerate Kysely types after a new migration
pnpm db:verify             # fail if generated types drift (LOCAL disposable DB only)

# Admin (operator surface, loopback)
pnpm admin:dev             # http://127.0.0.1:5174/

# Acquisition (also startable from the admin)
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
pnpm discovery:data --location "Ogden, UT" --radius-km 30    # build an Overture extract
pnpm operator:worker -- --run <uuid>    # execute one queued operator run
pnpm operator:worker -- --drain         # execute everything queued

# Demo generation
pnpm demos:dev                                   # renderer on http://127.0.0.1:5175/
pnpm demo:generate --prospect <uuid> [--force-regenerate] [--refresh-brand]
pnpm demo:brand --prospect <uuid> [--refresh]

# QA
pnpm demo:qa --token <locator>                             # local, records evidence
pnpm demo:qa --token <locator> --mode public --base-url <https origin>   # hosted QA

# Review / approval (same domain service the admin uses)
pnpm demo:review --demo <uuid>
pnpm demo:review --demo <uuid> --version <n> --approve [--note "..."] [--qa-override "..."]
pnpm demo:review --demo <uuid> --version <n> --reject  [--note "..."]

# Staging promotion and publication
pnpm demos:stage --prospect <uuid> --target-url-file .data\neon-staging.url
$env:DATABASE_URL = (Get-Content .data\neon-staging.url -Raw).Trim()
pnpm demos:publish --demo <uuid> --environment hosted --base-url <https origin>
Remove-Item Env:DATABASE_URL

# Deployment
pnpm demos:deploy:check    # preflight; no network or account required
pnpm demos:deploy          # deploy the Worker (needs an authenticated session)

# Gates
pnpm check ; pnpm build ; pnpm db:verify ; pnpm test
```

`.data/neon-staging.url` is git-ignored and holds the hosted connection
string. It is intentionally NOT an environment default, so local tooling can
never accidentally target the hosted database.

---

## CURRENT ADMIN

`http://127.0.0.1:5174/` — evidence viewer plus a deliberately narrow
mutation surface (demo lifecycle and bounded runs only; no generic CRUD).

- **Acquisition controls**: a START ACQUISITION form (category, location,
  radius, limit, source, concurrency) validated against hard bounds (≤10
  businesses per source, ≤25 km, concurrency ≤2, adapter-supported categories
  only) before any run row exists. Repeated submission joins the active run.
- **Progress visibility**: `/runs` and `/runs/:runId` show run status, stage,
  and per-target progress, refreshed by the existing three-second
  revalidation. Long work executes in a detached local worker process, never
  inside an HTTP request.
- **Failure inspection and retry**: isolated target failures appear with their
  DNS/TLS/timeout classification and transient flag; RETRY INTELLIGENCE
  re-runs analysis and qualification for one prospect and is audited.
- **Demo version review**: the prospect case file lists every DemoVersion with
  composition, plan version, creation time, per-viewport QA, and which version
  is current versus approved.
- **QA**: RUN QA re-records evidence; critical failures are shown explicitly.
- **Approve / reject / regenerate**: APPROVE (with an audited QA-override
  field when the gate blocks), REJECT, WITHDRAW APPROVAL, and REGENERATE with
  an optional composition choice and brand re-extraction.
- **Hosted URL**: VIEW DEMO (local preview, current version) and VIEW HOSTED
  DEMO (the approved version) plus a hosting-status chip
  (`local only` / `publishing` / `hosted` / `publication failed`).
- **READY FOR OUTREACH**: derived on read, with every blocker listed when it
  is not ready.

---

## CLOUD / LOCAL DISTINCTION

This split is **intentional**, not unfinished migration work:

- Discovery, website intelligence, qualification, brand extraction, demo
  generation, and QA all run **locally** against Docker PostgreSQL. They need
  Chromium, Lighthouse, and a local artifact store, and they never need cloud
  access.
- An approved demo is **promoted** to staging with `pnpm demos:stage`, then
  published (`pnpm demos:publish --environment hosted`), which uploads its
  assets to R2 and records the durable URL.
- **Cloudflare serves approved demos**; **R2 serves approved demo assets**;
  **Neon stores hosted demo metadata and approval state**.
- The hosted Worker is read-only: `GET`/`HEAD` only, approved versions only,
  no mutation route, and the admin is not hosted.

Moving the whole pipeline into the cloud would be a deliberate decision with
real cost implications — it is not a pending task.

---

## TEST / GATE STATE

At the end of the Phase 10 bootstrap, on `4dc295e`:

```text
pnpm check      PASS
pnpm build      PASS
pnpm db:verify  PASS   (generated/db.ts matches the migrated schema)
pnpm test       PASS   190 tests
```

Test distribution: database 30, prospecting 31, website-intelligence 35,
qualification 7, discovery 23, demo-generation 29, demos 11, operator 9,
admin 12, artifact-store 3.

Preserved marketing prototype SHA-256 (reverify before every commit):

```text
67E36EFA8D096F96A65C98CCBB8C6AA4C97E772EFFE9D03259BF5D0B45C2352F
```

---

## REAL DEPLOYMENT BUGS ALREADY FIXED

Do not rediscover these:

- **pnpm `deploy` collision** — `pnpm --filter <pkg> deploy` invokes pnpm's
  own `deploy` command, not the package script. Root scripts now use
  `pnpm --filter <pkg> run <script>`.
- **UTF-8 BOM** — PowerShell's `Set-Content -Encoding utf8` writes a BOM.
  pnpm rejects a BOM in `package.json` outright ("Invalid package.json").
  BOMs were stripped from 14 tracked files. Write files with
  `[System.IO.File]::WriteAllText(path, text, [System.Text.UTF8Encoding]::new($false))`.
- **Wrangler is pinned** as a devDependency of `apps/demos` (with `workerd`
  in `pnpm-workspace.yaml`'s `allowBuilds`); tooling resolves that binary
  instead of assuming a global install.
- **`pnpm demos:stage`** promotes one approved demo into another
  environment's database — minimal and verbatim, refuses an unapproved demo,
  never deletes, and deliberately copies no suppression state.
- **`pnpm demo:review`** is the approval CLI for environments the admin is not
  pointed at; it calls the same domain service.
- **`pnpm demo:qa --base-url`** runs the existing 28 checks against a hosted
  origin and records evidence against the version that origin serves.

Other environment notes: `wrangler login` and `neonctl auth` have short
(~2 minute) interactive OAuth windows; `pnpm dlx neonctl@2` needs `--org-id`
or it prompts interactively; a freshly registered `workers.dev` subdomain
takes a few minutes before it serves TLS; PowerShell 5.1's TLS stack cannot
reach Cloudflare — use Node `fetch` or `curl.exe`; React Router index-route
actions require `POST /?index`.

---

## NEXT PHASE

### PHASE 11 — OUTREACH FOUNDATIONS / SAFETY

**Phase 11 must NOT send real cold email.** Its purpose is to build the
send-ready foundation around an already-approved, already-hosted demo:

```text
READY FOR OUTREACH
      ↓
contact selection
      ↓
outreach eligibility
      ↓
campaign / sequence
      ↓
personalized email content
      ↓
stable approved demo URL
      ↓
suppression / idempotency checks
      ↓
SEND-READY
```

The ADR-004 schema already contains `outreach_campaign`,
`outreach_sequence(_version)`, `campaign_enrollment`, `conversation`,
`message` (intent) and `message_attempt` (transport, with a single-success
invariant) — Phase 11 should use them rather than invent parallel structures.

Longer-term outreach concept to preserve:

```text
FIT SCORE  +  INTENT SCORE  →  prioritized human follow-up
```

Intent should eventually favour reliable **hosted-demo engagement** —
verified demo visit, return session, meaningful time on page, multiple
sections viewed, CTA/contact interest — rather than depending heavily on
noisy email-open tracking. The hosted renderer already resolves a concrete
`demo_version_id` per request and the event registry already contains
`demo_view`, `demo_engaged`, and `demo_cta_click`, so this can be recorded
against the exact artifact a prospect saw without changing the architecture.
Phase 10 deliberately records none of it: no visitor events, no cookies, no
fingerprinting, no third-party analytics.

High-intent prospects should eventually generate **prioritized human call
tasks** — not blind calling of everyone, and not mass AI calling.

**Do not implement Phase 11 from this handoff. Wait for the Phase 11 prompt.**

---

## FOR CODEX — FIRST ACTIONS

1. Read this file completely.
2. Inspect the current repository — committed code is authoritative over this
   document and over any chat history.
3. Read the relevant ADRs and docs: ADR-003 (web runtime), ADR-004 (data/CRM/
   events), ADR-005 (persistence/Neon), ADR-006 (Postgres access/migrations),
   `docs/OPERATOR_APPROVAL.md`, `docs/DEMO_HOSTING.md`.
4. Verify the environment: Node `>=24 <25`, pnpm `>=11.24 <12`, Docker
   Desktop running, `pnpm db:up && pnpm db:migrate && pnpm db:verify`, and
   `git status` / `git rev-parse HEAD origin/main`.
5. Verify cloud configuration **without exposing secrets**: read
   `apps/demos/wrangler.toml`, run `pnpm demos:deploy:check`, and fetch the
   public demo URL. Never print a connection string or token.
6. Confirm you understand the current architecture — especially the approval
   invariant and the intentional local/cloud split.
7. Then **wait for the Phase 11 prompt**. Do not start Phase 11 on your own.
