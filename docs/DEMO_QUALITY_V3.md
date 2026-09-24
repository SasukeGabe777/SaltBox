# Demo Quality v3 — Customer-Facing Copy + Image Intelligence

Phase 12a (prep for outreach at scale). Two problems made demos unsafe to
send in volume:

1. **Demos read like a critique of the prospect's site**, not like their site:
   "From their current site" badges, "What This Site Gets Right", "This page
   shows how a modern website can present the business", disclosure notes
   under the services, a floating "Demo preview" pill.
2. **Photos landed in the wrong places**: darkened testimonial backgrounds in
   the gallery, a distributor's branded truck photo, whole brands taken from a
   site that redirected to a different company.

Both are fixed with zero per-demo cost (no paid API).

## Copy: demo-content-v3 / demo-copy-v3

- Written as the business, to its customers: real service descriptions, a
  per-card "Ask about …" CTA, "Why Work With {name}", a 3-step "How It Works",
  an about section in the business's voice.
- Demo status is disclosed once, in the footer ("Preview website designed by
  SaltBox for {name} …"), plus the form's post-submit "wasn't sent" notice.
- Category-typical services only top up a site where fewer than 3 were found.
- Every rule of the claims guard still applies; new fields (process steps,
  CTAs) are guarded, and fallback descriptions/CTAs never echo extracted site
  text that contains banned claims (e.g. "24/7 Emergency Roof Repair").
- Rendered by new `local-service-{premium,bold,clean}@2.0.0` compositions.
  The frozen `@1.0.0` layouts stay registered, so every existing and approved
  DemoVersion renders byte-for-byte as reviewed.

## Images: brand-intelligence-v2 / brand-profile-v2

```text
DOM evidence per image: page-section context (hero / gallery / services /
about / team / testimonial / contact / cta / footer / header / partners /
blog), nearest card heading, overlaid text
      -> up to 12 candidates downloaded and normalized IN MEMORY
         (letterbox trim, brightness, entropy, dHash)
      -> local CLIP classification (optional, $0, ~50 ms/image)
      -> pure slot assignment: hero / service:<name> / gallery / about
      -> only winners written to .data/demo-assets
```

- `select-imagery.ts` is pure and unit-tested. Decorative contexts, dark,
  flat-graphic, text-overlaid, and non-work (person/vehicle/graphic/logo)
  photos never fill work slots; people photos only fill `about` from a
  team/about block; near-duplicates collapse; every rejection keeps reasons
  (`imagery.rejected` in the profile).
- Service photos come only from the service's own card (heading/alt match).
- **Foreign-redirect guard**: a website that lands on a different company's
  domain (roofersutah.com -> srsdistribution.com) yields no logo, palette,
  photos, or services from that site (`identity.foreignRedirect`).
- CLIP: `Xenova/clip-vit-base-patch32` via `@huggingface/transformers`, model
  cached in git-ignored `.data/models`. Injectable `ImageClassifier`; if it
  fails to load, selection runs on heuristics and records why. A paid vision
  model could implement the same interface later, but is not needed today.
- `sharp` must stay on the same version transformers.js uses (0.35.x): two
  libvips builds in one Windows process fail with ERR_DLOPEN_FAILED.
- v1 profiles remain readable (`READABLE_BRAND_INTELLIGENCE_VERSIONS`); run
  `pnpm demo:generate --prospect <id> --refresh-brand` to re-extract.

## Batch-testing fixes (same phase)

A 20-business test batch (plumbing, HVAC, landscaping, electrical, roofing)
surfaced these, all fixed and tested:

- **Blocked sites** (`src/access-block.ts`): a 401/403/407/429/503 or a
  bot-protection interstitial with < 200 words is "could not evaluate".
  Website intelligence records `fatal.failureKind = "access_denied"`,
  qualification rejects with `WEBSITE_BLOCKS_AUTOMATED_ANALYSIS` (no invented
  deficiencies), and brand extraction records `identity.accessBlocked`.
  SaltBox never tries to evade bot protection. Vargas Brothers and Utah Roof
  and Solar had previously been qualified from their 403 pages.
- **Target fit** (qualification scoring artifact `2.1.0`): national franchise
  brands (Weed Man, DaBella, Roto-Rooter, ...), location pages on brand
  domains (`/location/<city>`, `/en-us/<city>`), and trade suppliers
  ("Roofers Supply", "... Plumbing Supply", "Wholesale") are not targets.
- **No-website businesses** get demos built from listing facts
  (`WEBSITE_MISSING` deficiency, clean layout, typical services). Outreach
  uses `outreach-subject-built-v1` / `outreach-body-new-site-v1`:
  "I built a website for {name}", never "rebuilt".
- **Display name**: a trailing " - Ogden" / " | Ogden, UT" suffix matching
  the observed city/state is dropped on the page and in outreach.
- **Place names**: shouting listing data ("OGDEN") is title-cased.
- **Claims guard**: the business's own name is exempt ("Utah's Best Heating &
  Cooling" is a name, not a superlative); generated text around it is not.
- **Team photos**: a photo the business names as its team/crew/staff may fill
  About even when CLIP sees its branded trucks.
- **Discovery**: `pnpm acquire ... --new-only` skips businesses already held
  (looks up to 25 deep); `--category electrical` aliases `electrician`.
- Copy: "an electrical company" (article agreement).

## Owner layer: "what's improved" notes + before/after slider

The demo must show the owner WHY it beats their site, immediately.

- `services/demo-generation/src/improvements.ts` turns the plan's measured
  deficiencies into at most 6 owner-facing notes ("Your site today" /
  "In the redesign"). No deficiency, no note. Detection-based findings are
  phrased as what SaltBox found ("We didn't find a quote button"), because
  detection can miss image buttons. Notes are claims-guarded.
- `comparison`: the homepage captures website intelligence already took
  (1366x900 desktop, 390x844 phone) are exported into the demo-asset store as
  `before-desktop.jpg` / `before-mobile.jpg` under the intelligence run ref
  (`@saltbox/website-intelligence/snapshots`, wired via
  `createBeforeSnapshotProvider`), so publication ships them like any asset.
- Renderer (`improvementsLayer` in `templates/base.ts`, 2.0.0 compositions):
  first visit opens the slider (their capture clipped over the LIVE redesign
  in a same-origin frame at the identical viewport, phone view first), then a
  guided tour of numbered red dots pinned to `data-improve-anchor` elements.
  Dismissible; a floating bar re-opens it; state in localStorage.
- Tour visuals: the active note dims the page except its element (SVG mask
  with holes), rings it in red, dashes related elements
  (`data-improve-also="<note id>"`, e.g. every quote CTA), and places the
  note beside the element. The mobile note shows their phone capture next to
  the redesign in a mini phone frame.
- Slider flow: the handle wiggles once; after 7 s or ~60% of drag travel a
  "See the N improvements" card appears over the slider.
- Close: after the last note, "That's N improvements. Want this site live for
  {name}?" with SaltBox's offer (`apps/demos/server/offer.ts`, env
  `SALTBOX_OFFER_BOOKING_URL` / `_PHONE` / `_EMAIL`, Worker vars when hosted;
  invalid values dropped; nothing configured -> "reply to the email"). The
  offer is renderer config, so it never changes an approved DemoVersion.
- `?view=bare` renders a demo without the owner layer (the slider's frame).
  The Worker now forwards the query string. CSP allows same-origin framing
  only: `frame-src 'self'; frame-ancestors 'self'`.
- Display name: when the listing name is a legal/owner name ("JC Plumbing
  LLC") and the business's own site is `froggyplumbing.com` whose title
  confirms it, the demo and outreach use "Froggy Plumbing".

## Accuracy fix: claims must survive the owner's own check (2026-09-24)

The Froggy Plumbing preview told the owner their phone layout overflowed,
that they had no quote button, no services list, and no way to reach them
without calling. All four were false (the owner checked on their phone):

| Claim | Reality | Cause |
|---|---|---|
| Phone layout overflows | Fits at 320px | Mobile pass used a desktop UA; Wix served its 1080px desktop layout |
| No quote button | "Call or Text Us", "Book Online" | CTA pattern too narrow; "Book Online" exists only in the phone layout |
| No services | Homepage "Our Plumbing Services" section | Only a separate /services page counted |
| Customers have to call | Online booking (dispatch.me) | Booking links were not considered |

Fix: `website-intelligence-v2` (see services/website-intelligence/README.md)
plus one shared claim rule set (`claims.ts`) used by the demo plan and the
outreach observation. Speed notes now say the number comes from Lighthouse's
simulated phone connection (an owner on fast wifi will see a faster load; the
lab LCP also varies between runs: 5.8 s then 3.7 s for the same site).
Re-measured, Froggy's demo keeps only true notes (missing search description
and main heading; slow simulated-phone load). Regression tests encode the
case: `testing/claims.test.ts` and the UA-switching fixture in
`testing/browser-analyzer.test.ts`.

## Known follow-ups

- Few sites expose many usable photos; typography-led layouts carry most demos.
- A previously approved DemoVersion keeps its v2 copy until an operator
  approves a regenerated v3 version.
- 503 responses with tiny pages count as blocked; a genuinely down site is
  therefore "cannot evaluate" rather than a need signal (conservative).
- Prospect lifecycle never moves backward: a prospect re-rejected by the new
  rules keeps `lifecycle_state = qualified`, but its latest decision is
  `rejected`, which is what demo/outreach eligibility read.
