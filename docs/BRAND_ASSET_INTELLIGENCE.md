# Brand + Asset Intelligence — Phase 9

Phase 9 makes SaltBox demos feel like they belong to the actual business:
its real logo, its real colors, its real photography, and the services its
own website actually talks about — extracted deterministically, stored with
full provenance, and rendered through one of three polished layout
compositions selected by inspectable rules. No AI is involved anywhere.

```text
qualified-v2 prospect
  -> bounded brand/asset extraction (brand-intelligence-v1)
       logo · palette · photography · services · identity
  -> persisted BrandProfile (append-only website_analysis, no migration)
  -> DemoPlan v2 (demo-plan-v2) with deterministic composition selection
  -> demo-content-v2 (brand palette, logo, imagery, evidence-backed services)
  -> new DemoVersion on the SAME Demo and SAME public locator
  -> one renderer, three compositions, local validated assets
```

## Where it lives

- **Extraction** is part of `services/website-intelligence`
  (`src/brand/`) because that service owns hostile-site fetching: the brand
  pass reuses the exact Phase 6 SSRF boundary (public-DNS validation per
  redirect hop, IP-pinned hardened Chromium, request interception,
  robots.txt gating for sub-pages) and visits at most **3 pages** per site.
- **Consumption** is part of `services/demo-generation`: a defensive typed
  view over the persisted profile feeds DemoPlan v2, content v2, and
  composition selection. A malformed profile degrades to fallbacks — it can
  never break generation.
- **Serving** is part of `apps/demos`: validated local assets only, via
  `/demo-assets/<run-ref>/<file>` with strict pattern checks.

## BrandProfile (brand-profile-v1)

Persisted as an append-only `website_analysis` row under analyzer
`brand-intelligence-v1` with a per-run `source_record` (source
`brand_intelligence`). It records: pages inspected, the selected logo
(source URL, confidence, reasons, local artifact), the extracted palette
(colors, confidence, evidence sources), selected imagery (source URL/page,
dimensions, alt, reasons), evidence-backed services (canonical name + the
exact site text + page + evidence kind), identity hints, every fallback
taken, and byte/duration budgets. Every selection stays answerable:
*where did this come from and why was it chosen?*

## Logo selection

Deterministic candidate ranking over collected evidence: schema.org logo
declarations, header placement, homepage-linking images, alt/filename/class
naming, top-of-page position, site-wide repetition, sane aspect ratios and
minimum sizes. Icons (apple-touch) are weak fallback candidates; `.ico` is
rejected. Candidates are downloaded through the safe asset pipeline until
one validates; SVG is rasterized to PNG (raw SVG is never stored), sizes are
bounded to 512px, transparency is preserved. Weak confidence falls back to
the Phase 8 initials logotype — a questionable image is never chosen just to
avoid the fallback.

## Palette extraction

Weighted color candidates from `theme-color` metadata, header/nav computed
backgrounds, button/CTA backgrounds, color-suggesting CSS custom properties,
link color, and the downloaded logo's measured dominant colors (sharp pixel
quantization). Near-duplicates merge; transparent/near-white/near-black/grey
values are rejected. The result is a constrained palette (primary,
secondary, accent, background, surface, text) with deterministic contrast
repair: any color used under white text is deepened until WCAG AA holds, and
`onPrimary`/`onAccent` are computed. Weak evidence falls back to the
deterministic category theme.

## Imagery selection

Real photography only: `<img>` elements and large CSS background images are
ranked by natural size, above-the-fold prominence, rendered size, and alt
text. Hard-excluded: icons, sprites, pixels, avatars, payment marks, social
widgets, tracking hosts, extreme aspect ratios, anything under 500x320 — and
**credential/association artwork** (BBB seals, manufacturer badges, awards,
ratings): those are claim-bearing graphics, not the business's work, and
demos never amplify certification claims. At most 4 images are downloaded,
resized to ≤1600px, EXIF-rotated, re-encoded as JPEG (~80), and stored
locally. The rendered demo never hotlinks the business's site.

## Service extraction

Real page text (headings > nav labels > list items) matched against a
per-category service lexicon and normalized to canonical names ("Roof
Repairs" / "Roof Repair Services" / "Residential Roof Repair" → one entry).
Text that matches nothing contributes nothing; text that is merely the
business's own name is identity, not a service. Each extracted service keeps
its exact source text and page. In content, extracted services lead the
services section with a "From their current site" badge and get claim-free
generated descriptions; category-typical items (disclosed) fill the grid.

## Asset policy and security

- Every fetch passes the same SSRF boundary as Phase 6 (per-hop public-DNS
  validation, redirect caps, timeouts).
- MIME allowlist (png/jpeg/webp/gif/svg-for-rasterization), 8 MB per asset,
  24 MB per run, streaming byte caps, sharp decode validation.
- Assets live in git-ignored `.data/demo-assets/<run-ref>/`; PostgreSQL
  stores only relative references. The renderer serves them read-only with
  strict ref/filename patterns (no traversal) and `img-src 'self' data:` —
  no other origin is reachable from a demo page.
- All extracted text is sanitized plain text; prospect HTML/JS never renders.
- Demos remain private, `noindex`, locator-addressed sales previews of the
  business's own public identity — never production hosting, and never a
  claim that SaltBox owns the assets.

## Compositions (one renderer, three layouts)

| Composition | Selected when | Character |
| --- | --- | --- |
| `local-service-premium@1.0.0` | a hero-grade photograph (≥1000px) exists | full-bleed photo hero, dark header, serif display headings, gallery |
| `local-service-bold@1.0.0` | confident palette + logo but no hero photo | accent top bar, dark split hero with embedded quote panel, dense bordered services, numeral trust band |
| `local-service-clean@1.0.0` | weak/no brand evidence | typography-led centered hero, numbered service rows, hairline rules — needs zero assets |

Selection is deterministic and every reason is persisted (plan + admin).
The compositions assemble shared primitives (`apps/demos/server/templates/base.ts`):
theme resolution, brand mark, fact chips, quote form, contact rows, gallery,
footer, indicator. Phase 8's `local-service@1.0.0` stays registered so every
existing DemoVersion keeps rendering; `demo-content-v2` is a backward-
compatible superset of v1 and both versions are accepted by the renderer.

## Regeneration semantics

Brand enhancement appends a **new DemoVersion on the same Demo and the same
public locator** — reloading an existing demo link shows the enhanced
version. Brand extraction runs automatically when no profile exists
(`--skip-brand` disables, `--refresh-brand` re-extracts); a re-extraction is
new append-only evidence, so regeneration after it appends a new version
with the new lineage. Extraction failure is never fatal: generation
proceeds on fallbacks.

## Operator commands

```text
pnpm demo:generate --prospect <id> [--skip-brand] [--refresh-brand] [--force-regenerate]
pnpm demo:brand   --prospect <id> [--refresh]     # inspect/persist brand intelligence only
pnpm demo:qa      --token <locator>               # 28 desktop/mobile Chromium checks + screenshots
```

## Limitations

- No AI copywriting, design generation, or image generation; no review or
  social enrichment; no customer approval workflow; no outreach; no
  production hosting, domains, billing, or form delivery.
- Layouts are three curated compositions, not arbitrary bespoke designs.
- Typography extraction is limited to style-neutral system/serif stacks.
- Data-URI images and font files are not extracted; icon-only sites fall
  back to the logotype. Brand artifacts are machine-local (`.data/`) and
  rebuild via `--refresh-brand` on another machine.
