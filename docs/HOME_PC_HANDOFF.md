# READ THIS FIRST WHEN RESUMING SALTBOX ON ANOTHER MACHINE.

Prepared 2026-08-27 after Phase 11 on the Windows work PC in
`C:\dev\SaltBox`. The committed repository and its ADRs are authoritative.
This is the current cross-machine operational handoff; older phase handoffs
are historical context only.

## Exact resume point

- Branch: `main`
- Phase 11 implementation commit:
  `69aaaf9c82687d422858fcc595e96937580f5b13`
- Commit subject: `Implement outreach send-ready foundations`
- At handoff preparation time, that commit was pushed and
  `HEAD == origin/main`.
- Completed phases: 3 through 11, including discovery, deep intelligence,
  qualification v2, deterministic demo generation, brand/asset intelligence,
  QA, operator approval, hosted demo delivery, and outreach SEND-READY
  foundations.

Recent major commits:

```text
69aaaf9 Implement outreach send-ready foundations
ab556df Update Codex development handoff
4dc295e Deploy the hosted demo renderer
9b60f10 Implement demo hosting and operator approval
ed20021 Improve demos with brand and asset intelligence
113b501 Implement automated demo generation
2392601 Implement deep-intelligence qualification v2
1843b6e Improve website intelligence failure isolation
ae046b1 Implement website intelligence v2
2d4af41 Expand multi-source business discovery
97fb2a3 Implement real business discovery MVP
```

After pulling, always confirm the actual handoff commit with:

```powershell
git rev-parse HEAD
git rev-parse origin/main
git status
```

## Current pipeline

```text
DISCOVERY
    -> WEBSITE INTELLIGENCE
    -> QUALIFICATION V2 / FIT SCORE
    -> BRAND + ASSET INTELLIGENCE
    -> DETERMINISTIC DEMO GENERATION
    -> AUTOMATED QA
    -> OPERATOR APPROVAL OF ONE EXACT DEMOVERSION
    -> LOCAL-TO-STAGING PROMOTION
    -> R2 ASSET PUBLICATION + CLOUDFLARE HOSTING
    -> READY FOR OUTREACH
    -> DETERMINISTIC EMAIL CONTACT SELECTION
    -> CURRENT OUTREACH ELIGIBILITY
    -> VERSIONED CAMPAIGN + SEQUENCE + MESSAGE INTENT
    -> EXACT APPROVED DEMOVERSION/PUBLICATION PIN
    -> FINAL SUPPRESSION + STALENESS + IDEMPOTENCY CHECK
    -> SEND-READY
```

The pipeline stops at SEND-READY. No email, SMS, form submission, or call has
been made by SaltBox.

## Monorepo map

```text
apps/website                  Astro marketing site / preserved prototype port
apps/admin                    loopback-only React Router operator surface (:5174)
apps/demos                    one Node/Cloudflare demo renderer for every demo
services/prospecting          ingestion, lightweight analysis, qualification v1
services/discovery            OpenStreetMap + Overture discovery/orchestration
services/website-intelligence hardened Chromium/Lighthouse + brand extraction
services/qualification       qualification v2 features, score, and policy
services/demo-generation     deterministic plan/content/QA/approval/publication
services/outreach            eligibility, contact selection, deterministic intent
services/operator            bounded local operator runs and worker
packages/database            PostgreSQL/Kysely migrations, repositories, queries
packages/artifact-store      local | R2 | memory artifact abstraction
```

Read `docs/ARCHITECTURE.md`, ADR-001, ADR-002, ADR-004, ADR-005, ADR-006,
`docs/QUALIFICATION_V2.md`, `docs/DEMO_GENERATION.md`,
`docs/BRAND_ASSET_INTELLIGENCE.md`, `docs/OPERATOR_APPROVAL.md`,
`docs/DEMO_HOSTING.md`, and `docs/OUTREACH_FOUNDATIONS.md` before changing a
domain boundary.

## Local versus cloud architecture

The split is deliberate:

- Local Docker PostgreSQL 18 on port 5433 is the development database.
- Discovery, intelligence, qualification, brand extraction, generation, QA,
  approval, admin mutations, and Phase 11 outreach preparation run locally.
- `pnpm demos:stage` is the explicit local -> staging promotion boundary for
  one approved demo. It does not copy the development database.
- Neon staging stores the promoted public-demo identity, lineage, approval,
  QA, locator, and publication metadata needed by the hosted renderer.
- R2 stores demo assets; large blobs never enter PostgreSQL.
- The Cloudflare Worker is read-only (`GET`/`HEAD`), serves only the currently
  approved version, never enumerates demos, and does not host the admin.
- A home PC does not recreate any cloud resource. Existing provider resources
  continue to serve the public demo.

Non-secret live resource identifiers:

| Resource | Value |
| --- | --- |
| Cloudflare Worker | `saltbox-demos` |
| Public origin | `https://saltbox-demos.saltbox-demos.workers.dev` |
| R2 bucket | `saltbox-demo-assets` (`DEMO_ASSETS`) |
| Hyperdrive | `bd10802e4efb432085ada1ba17b8d2e9` (`HYPERDRIVE`, caching disabled) |
| Neon project | `saltbox-staging` |
| Neon database | `saltbox` |
| PostgreSQL | 18 |
| Neon region | `aws-us-west-2` |

The work-PC local database has all seven committed migrations. The Neon
staging database remains on the six Phase 10 migrations because Phase 11 is a
local, no-send foundation and its migration was intentionally not applied to
the hosted read-only renderer. Do not point ordinary local commands at Neon.
Before Phase 12 writes outreach state to staging, plan and execute that schema
promotion deliberately.

## Approval and hosting invariants

- Generation and QA never approve a demo.
- Only the one exact operator-approved `DemoVersion` can be public or used in
  outreach.
- Regeneration never moves the approval pointer.
- The stable public URL follows the approval pointer, but a prepared message
  also pins the version, review, approval timestamp, locator, publication, and
  URL. A stable URL alone is not proof that preparation is current.
- Withdrawing or changing approval immediately makes an existing preparation
  ineligible. Unapproved/unknown demos and their R2 assets resolve as 404.
- Demos remain `noindex, nofollow`; forms cannot submit to a real business.
- Active suppression wins over fit, approval, hosting, campaign, and a
  previously prepared message.

## Live acceptance target: Riverfront Roofing

Public demo:

```text
https://saltbox-demos.saltbox-demos.workers.dev/d/0z-T5ccKc4k2PEeV6v-2DTEf
```

- Qualified under `qualification-policy-v2`, Fit Score 69.
- Premium bespoke composition with persisted brand evidence.
- Operator-approved DemoVersion v3, QA-clean, hosted, and publicly live.
- Phase 10 hosted QA: 28/28; security probes: 19/19.
- Phase 11 work-PC local acceptance selected the real persisted address
  `trent@riverfront-roofing.com` and prepared one SEND-READY intent.
- Subject: `I rebuilt the Riverfront Roofing website`
- The persisted message pins approved v3 and the hosted publication.
- Provider attempts: 0. No email was sent.

The local Docker volume is machine-specific and is not committed. A fresh home
database therefore will not automatically contain Riverfront or its prepared
message; this does not affect the already-live hosted demo. Never copy a
database volume or connection secret through Git.

## Phase 11 outreach configuration

| Boundary | Version/value |
| --- | --- |
| Eligibility policy | `outreach-eligibility-v1` |
| Campaign | `SaltBox Demo Outreach — Local Services v1` |
| Campaign status | `draft` configuration, never a mass-send job |
| Sequence | `saltbox-demo-outreach`, version `1` |
| Prepared step | `initial_demo_email`, step 1 |
| Future model-only steps | follow-up at 4 days; final follow-up at 7 days |
| Content version | `saltbox-demo-email-v1` |
| Subject template | `outreach-subject-rebuilt-v1` |
| Body template | `outreach-body-demo-v1` |
| Sender profile | `saltbox-sender-v1` |
| Bulk preparation cap | 10 |
| Recent-outreach guard | 30 days |

`services/outreach` provides:

- a structured eligibility service with stable reason codes;
- deterministic persisted-email selection and syntax normalization;
- obvious non-recipient rejection (`noreply@`, `donotreply@`, and similar);
- deterministic, evidence-backed subject/body rendering without AI;
- exact demo-version, approval, locator, and publication pinning;
- idempotent preparation keyed by prospect, sequence version, step, selected
  contact method, and approved DemoVersion;
- prospect/business/contact-method DO NOT CONTACT suppression;
- versioned events for eligibility, intent, preparation, SEND-READY, and
  suppression;
- queue states for ready, prepared, send-ready, suppressed, needs contact,
  needs approval, retry, and stale preparation.

`message` remains provider-neutral intent. `message_attempt` remains transport
history. Phase 11 creates statuses through `send_ready` only and creates no
attempt, provider ID, fake cost, delivery status, or sent event.

## Absolute no-send status

Phase 11 is architecturally incapable of external delivery:

- `OUTREACH_SENDING_ENABLED` is the literal `false`;
- no email-provider adapter, provider credential shape, SMTP client, or send
  method exists;
- the admin has PREPARE and DO NOT CONTACT actions, but no SEND action,
  endpoint, or button;
- bounded bulk work prepares at most 10 intents and schedules nothing;
- tests assert zero `message_attempt` records through the full flow.

The non-negotiable future rule is: no provider I/O and no new send attempt
until the same eligibility boundary runs again immediately before send.

## Current admin capabilities

Start with `pnpm admin:dev`, then open `http://127.0.0.1:5174/`.

- Bounded acquisition, progress, target failures, and intentional retry.
- Prospect evidence, feature/score/decision history, and lifecycle timeline.
- Demo regeneration, QA, review, approval, rejection/withdrawal, local and
  hosted preview, and exact approved-version status.
- Prospect OUTREACH panel with selected contact, structured eligibility,
  campaign/sequence, exact persisted email preview, demo pin, template
  versions, preparation timestamp, provider-attempt count, and Phase 12 sender
  requirements.
- PREPARE OUTREACH and scoped DO NOT CONTACT actions.
- `/outreach` controlled SEND-READY queue and hard-capped batch preparation.
- Explicit NO SEND CAPABILITY indicator; no send endpoint/button exists.

The admin is loopback-only and unauthenticated. Do not deploy it publicly.

## Home-PC prerequisites

1. Git access to `https://github.com/SasukeGabe777/SaltBox.git`.
2. Node.js 24 LTS (`>=24.0.0 <25`; verified on work PC with v24.19.0).
3. pnpm 11.24 (`corepack enable`; verified with 11.24.0).
4. Docker Desktop running with the WSL2 backend on Windows.
5. Chromium dependencies are installed by `pnpm install`; intelligence/QA
   tests need enough memory to launch the browser.

Secrets are never committed. `.env.example` contains placeholders only.
Cloudflare/Neon operations use the operator's authenticated CLI session and a
git-ignored `.data\neon-staging.url`; ordinary local development needs neither.

Sender email, reply-to, and real business mailing address intentionally have
no default. They are Phase 12 operator requirements and must not be invented.

## Exact home-PC bootstrap

For an existing clone:

```powershell
cd C:\dev\SaltBox
git switch main
git pull --ff-only origin main
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:verify
pnpm check
pnpm test
pnpm admin:dev
```

For a fresh clone, replace the first three commands with:

```powershell
git clone https://github.com/SasukeGabe777/SaltBox.git C:\dev\SaltBox
cd C:\dev\SaltBox
```

Then open `http://127.0.0.1:5174/`; the outreach queue is at
`http://127.0.0.1:5174/outreach`.

## Important operator commands

```powershell
# Local database
pnpm db:up
pnpm db:migrate
pnpm db:codegen          # only after adding a new migration
pnpm db:verify

# Admin and workers
pnpm admin:dev
pnpm operator:worker -- --run <uuid>
pnpm operator:worker -- --drain

# Discovery and acquisition
pnpm discovery:data --location "Ogden, UT" --radius-km 30
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1

# Demo generation, brand, QA, and review
pnpm demos:dev
pnpm demo:generate --prospect <uuid> [--force-regenerate] [--refresh-brand]
pnpm demo:brand --prospect <uuid> [--refresh]
pnpm demo:qa --token <locator>
pnpm demo:qa --token <locator> --mode public --base-url <https-origin>
pnpm demo:review --demo <uuid>
pnpm demo:review --demo <uuid> --version <n> --approve [--note "..."] [--qa-override "..."]
pnpm demo:review --demo <uuid> --version <n> --reject [--note "..."]

# Explicit local -> staging promotion and publication; never set DATABASE_URL
# globally or in a persistent local profile.
pnpm demos:stage --prospect <uuid> --target-url-file .data\neon-staging.url
$env:DATABASE_URL = (Get-Content .data\neon-staging.url -Raw).Trim()
pnpm demos:publish --demo <uuid> --environment hosted --base-url <https-origin>
Remove-Item Env:DATABASE_URL

# Hosted renderer verification/deployment
pnpm demos:deploy:check
pnpm demos:deploy

# Complete gates
pnpm check
pnpm build
pnpm db:verify
pnpm test
```

## Current test and verification state

At Phase 11 commit `69aaaf9c82687d422858fcc595e96937580f5b13`:

```text
pnpm check      PASS
pnpm build      PASS
pnpm db:verify  PASS
pnpm test       PASS — 200 tests
```

Test distribution: artifact-store 3, database 30, prospecting 31,
website-intelligence 35, qualification 7, demo-generation 29, discovery 23,
outreach 9, demos 11, operator 9, admin 13.

Admin HTTP acceptance passed for `/outreach` and Riverfront's prospect page.
The live Riverfront URL returned HTTP 200 with the expected business and
`noindex` content. The in-app browser was unavailable on the work PC, so the
server-rendered routes were verified directly over HTTP.

The preserved prototype must remain byte-for-byte unchanged:

```text
reference/marketing-prototype/index.html
SHA-256 67E36EFA8D096F96A65C98CCBB8C6AA4C97E772EFFE9D03259BF5D0B45C2352F
```

## Known limitations after Phase 11

There is intentionally no real email sending, provider credential or adapter,
SMTP, automated follow-up/scheduling, reply ingestion, bounce handling,
unsubscribe HTTP endpoint, preference center, demo-engagement tracking,
Intent Score, human call queue, AI calling, SMS, billing, or AI-generated copy.

Email validation proves local syntax/domain syntax only. It does not probe,
perform DNS/MX checks, confirm a mailbox, or infer an owner. Sender email,
reply-to, mailing address/footer, provider choice, and a real opt-out route
remain unresolved operator inputs for Phase 12.

## Next intended phase — do not start without its prompt

Phase 12 is **CONTROLLED OUTREACH SENDING + DELIVERY/REPLY SAFETY**:

```text
SEND-READY
    -> immediate final eligibility check
    -> approved provider adapter
    -> tiny operator-controlled send/batch
    -> provider MessageAttempt + provider identifier
    -> delivery/failure/bounce handling
    -> real unsubscribe -> immediate suppression
    -> reply -> stop automation + human attention
    -> hosted-demo engagement instrumentation
    -> eventual Intent Score
```

Start with tiny, explicitly operator-controlled sends, never 10,000-recipient
execution. Preserve the strategy:

```text
FIT SCORE + RELIABLE INTENT SCORE -> HUMAN FOLLOW-UP PRIORITY
```

Intent should prioritize verified hosted-demo visits, repeat meaningful
sessions, engagement time/sections, CTA/contact interest, and replies. Email
opens are noisy and should remain weak evidence if used at all. Do not call
everyone who receives email; replies and high-fit/high-intent prospects should
enter a future human sales queue. Do not implement AI or robocalling.

Do not begin Phase 12 from this handoff alone. Wait for the explicit Phase 12
prompt and re-read the repository first.
