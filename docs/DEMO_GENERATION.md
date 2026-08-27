# Demo Generation — Phases 8 & 9

> [!IMPORTANT]
> Phase 10 adds the lifecycle around generation: operator review and approval
> ([`OPERATOR_APPROVAL.md`](OPERATOR_APPROVAL.md)) and durable hosting
> ([`DEMO_HOSTING.md`](DEMO_HOSTING.md)). Generating a version no longer makes
> it usable — an operator must approve one exact `DemoVersion` first, and the
> public URL serves only that one.

Phase 8 takes a qualified-v2 prospect and automatically builds a personalized,
viewable website demo. It crosses SaltBox from "finds good prospects" to
"builds something sellable for them" — without outreach, AI, paid APIs, or
fabricated claims. Phase 9 layers deterministic brand/asset intelligence on
top (see [BRAND_ASSET_INTELLIGENCE.md](BRAND_ASSET_INTELLIGENCE.md)): the
business's real logo, colors, photography, and services drive one of three
layout compositions, so the demo reads as a redesign of THEIR site.

```text
qualified-v2 prospect
  -> demo eligibility
  -> brand/asset intelligence (brand-intelligence-v1, Phase 9)
  -> DemoPlan (demo-plan-v2)
  -> structured business/demo content (demo-content-v2, demo-copy-v2)
  -> deterministic composition selection (premium | bold | clean)
  -> persisted Demo + append-only DemoVersion + demo_published event
  -> opaque public locator (stable across regenerations)
  -> one renderer serving many demos (apps/demos, /d/<locator>)
  -> admin VIEW DEMO link + brand panel
```

Phase 8's `demo-plan-v1`/`demo-content-v1` versions remain persisted history
and stay renderable through the frozen `local-service@1.0.0` template.

## One renderer, many demos

There is exactly one demo application, [`apps/demos`](../apps/demos/README.md).
It is a lightweight loopback HTTP server that resolves
`/d/<public-locator>` to the demo's persisted current `DemoVersion` and
renders it through a reusable template. No per-prospect projects, builds, or
deployments exist. A demo is:

```text
reusable template/components + structured prospect data + versioned demo configuration
```

## Operator flow

```powershell
pnpm db:up

# Terminal 1 — read-only admin (http://127.0.0.1:5174/)
pnpm admin:dev

# Terminal 2 — demo renderer (http://127.0.0.1:5175/, loopback only)
pnpm demos:dev

# Terminal 3 — generate a demo
pnpm demo:generate --latest-qualified --limit 1
# or target one prospect
pnpm demo:generate --prospect <prospect-uuid>

# optional visual QA (desktop/mobile Chromium checks + screenshots)
pnpm demo:qa --token <public-locator>
```

The CLI prints the demo URL; the admin prospect page shows a read-only demo
section with a `VIEW DEMO` link once a version exists. CLI flags:
`--prospect`, `--latest-qualified`, `--category`, `--limit` (max 5),
`--force-regenerate`, `--override-ineligible <note>`, `--base-url`.

## Eligibility

Default rule — all of:

- latest persisted decision uses `qualification-policy-v2` and is `qualified`;
- the business is not actively suppressed (global or business scope);
- persisted deep website-intelligence exists;
- the category maps to a Phase 8 template (local-service family);
- the business identity is usable.

Rejected prospects are never demoed by default. The explicit
`--override-ineligible <note>` flag exists for controlled testing only: it can
bypass the qualification/intelligence requirements, is recorded in the
DemoPlan and admin, and **never** bypasses suppression, never renders a
template-less category, and never changes lifecycle or decision history. An
overridden demo does not make a prospect qualified.

## DemoPlan (demo-plan-v1)

Generation first produces a deterministic, inspectable plan persisted in the
DemoVersion's generator metadata: qualification lineage (FeatureSet,
LeadScore, Decision), the intelligence analysis used, the deficiencies the
demo addresses, template selection with its reason, section list, CTA and
contact strategy, available facts, and every fallback taken. The admin shows
a bounded plan summary.

## Intelligence drives the demo

Deficiencies derived from persisted `website-intelligence-v1` findings map to
visible fixes:

| Evidence | Demo behavior |
| --- | --- |
| `CTA_MISSING` | Prominent header + hero "Get a Quote" CTAs and a closing contact CTA |
| `CONTACT_FORM_MISSING` | Strong quote/contact form section (demo mode) |
| `PHONE_LINK_MISSING` + observed phone | Click-to-call `tel:` links throughout |
| `TITLE_MISSING` / `META_DESCRIPTION_MISSING` | Strong deterministic title/meta |
| `H1_MISSING` | Semantic heading hierarchy with one `<h1>` |
| `MOBILE_OVERFLOW` / `MOBILE_VIEWPORT_MISSING` | Responsive layout verified overflow-free |
| `SLOW_LCP` / `PERFORMANCE_WEAK` / `CLS_POOR` | Single-request, dependency-free, stable page |
| `THIN_CONTENT` / missing services/about pages | Substantive structured sections |
| `COPYRIGHT_STALE` | Footer year rendered at view time |

## Content model and provenance

`demo-content-v1` is the rendering contract: plain-text structured content
(business identity, brand theme, meta, hero, services, trust, service area,
about, contact, footer, demo indicator) plus a provenance ledger. Every field
records whether it is **observed** (discovery/contact/website identity),
**extracted** (website intelligence), **generated** (deterministic marketing
transformation of observed facts), or **placeholder** (disclosed demo
scaffolding), with evidence references — so "where did this statement come
from?" stays answerable.

Copy is produced by the `demo-copy-v1` phrase library: deterministic slots for
the observed name/category/location only, with variant selection by a stable
hash of the business identity. A claims guard hard-fails generation if any
generated/placeholder text asserts licensing, certification, insurance,
awards, warranties, guarantees, tenure, reviews, ratings, financing,
emergency/24-7 availability, pricing, superlatives, ownership, or
partnerships. Category-typical service lists are explicitly disclosed as demo
presentation. Testimonials render only from verified review content, which
Phase 8 does not have — so they are always omitted, never invented. The
architecture leaves a clean seam for a future local-model content enhancer:
it would produce a better `demo-content-v1` document; the renderer does not
change.

## Persistence and versioning

Existing ADR-004 tables only — no migration:

- `demo_template` / `demo_template_version`: `local-service` @ `1.0.0`
  (artifact ref `apps/demos/server/templates/local-service-v1`), seeded
  idempotently.
- `demo`: one identity per prospect (`draft` → `generating` → `ready`).
- `demo_version`: append-only; `content_input_version=demo-content-v1`,
  `generated_content_version=demo-copy-v1`, FeatureSet lineage, a stable
  content hash, and bounded generator metadata (plan + content, size-guarded —
  large artifacts stay out of PostgreSQL).
- `demo_public_locator`: opaque `randomBytes(18)` base64url token, revocable,
  never derived from internal IDs.
- `event`: a `demo_published` domain event per version (idempotent by version).

Regeneration with unchanged inputs and template is a no-op (`unchanged`);
`--force-regenerate` or changed inputs append the next `DemoVersion` and move
the current pointer. Old versions and their hashes are never mutated. The
locator is stable across regenerations. Prospect lifecycle is never touched by
demo generation.

## Security and public-safety posture

- Extracted content is untrusted: templates render escaped plain text only —
  no prospect HTML, scripts, or proxied assets ever reach a demo page.
- Renderer CSP: `default-src 'none'`, inline style/script only, `img-src
  data:`, **`form-action 'none'`** — the demo quote form cannot submit
  anywhere, and submission is also intercepted client-side with a demo-only
  confirmation. No message is ever sent to the business or anyone else.
- Every demo response carries `noindex, nofollow` (meta and `X-Robots-Tag`),
  `no-store`, and `frame-ancestors 'none'`. The index page never enumerates
  demos; only known persisted active locators resolve.
- The renderer binds to loopback and must not be exposed externally without
  authentication. A subtle fixed "Demo preview" indicator plus footer
  disclosure mark every page as a SaltBox demo, not a live business site.
- No SSRF surface: rendering performs no outbound requests at all.

## Artifacts

QA screenshots land in git-ignored `.data/demos/qa/<locator>/`. Structured
plan/content stay as bounded JSONB on the DemoVersion; nothing large is stored
in PostgreSQL. No production object storage is provisioned in Phase 8.

## Known limitations

- Generation never approves and never publishes; those are Phase 10 operator
  actions (`docs/OPERATOR_APPROVAL.md`).
- No AI copywriting or image generation; copy is phrase-library deterministic
  and intentionally conservative.
- One template family (local service businesses); other categories are
  ineligible rather than poorly served.
- No brand/logo/color extraction yet — themes are deterministic category
  palettes (the content model reserves the brand slot).
- No review/social enrichment; testimonials are always omitted.
- No customer approval flow, outreach, public deployment, custom domains,
  billing, or automatic form delivery.
- `sent` semantics belong to future outreach phases; Phase 10 stops at
  `READY FOR OUTREACH`.
