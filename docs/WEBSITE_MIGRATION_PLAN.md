# SaltBox Website Migration Plan

## Document purpose and scope

This document inventories the original SaltBox marketing prototype and plans a future migration into `apps/website`. It does not select a framework, create a runtime, split the prototype into components, revise content, or implement production integrations.

The source reviewed for this plan was the repository-root `index.html`, imported on 2026-08-25 as `reference/marketing-prototype/index.html`. The file is a self-contained static document containing HTML, inline CSS, inline JavaScript, inline SVG iconography, and a data-URL noise texture. Google Fonts are its only page-level external asset dependency.

The review was performed against the complete source. A rendered browser inspection was attempted but could not be completed because the available local browser-control environment failed to connect. Consequently, exact visual regression baselines and device screenshots must be captured before the faithful port begins. The source-level inventory below is authoritative for declared values and behavior; any rendering-dependent observation should be validated in Phase 2.

## Current implementation summary

- One static `index.html`, 69,789 bytes at import.
- Semantic sectioning is partial: `header`, sections, `article`, and `footer` are used, but there is no `main` element and the quote UI is not a `form`.
- All site styling and animation keyframes are inline in one `style` block.
- All behavior is inline in two immediately invoked JavaScript functions.
- Content, prices, services, portfolio entries, demo businesses, tooltip claims, and contact details are hardcoded.
- No frontend framework, build system, package manager, server, API, or deployment configuration is present.

## Visible structure and customer journey

The actual prototype is organized as follows:

1. **Header navigation** — Saltbox wordmark, links to Services, Packages, How it works, Our work, and About; a “Get a free quote” CTA; and a mobile menu button.
2. **Hero** — “Websites worth showing off.” with a rotating final phrase, agency value proposition, quote/work CTAs, two proof points, and an animated browser mockup that cycles through fictional business demos.
3. **What we do** (`Services`) — three cards: Branding, Websites & stores, and Care & hosting.
4. **How it works** (`Story`) — a five-beat, scroll-driven sequence: Chat, Brand, Build, Launch, and Look after.
5. **Packages** — Starter, Standard, and Custom cards; per-feature information tooltips; a separate Keep-it-running plan; and pricing caveats.
6. **Our work** (`Portfolio`) — a pinned, horizontally moving filmstrip on desktop and a horizontal scroll-snap carousel on smaller screens.
7. **Who it’s for** (`About`) — audience positioning and three compact proof/service statements.
8. **Start here** (`Contact / Quote`) — contact details plus name, business, email, and needs fields; submission opens a prefilled email to SaltBox.
9. **Footer** — brand description, navigation links, email link, location-oriented copyright, and the 48-hour quote promise.

The current journey is a conventional inbound agency funnel: explain services, demonstrate a consultative five-step workflow, present packages and examples, then ask the visitor to request a quote.

## Visual design inventory

### Core palette

The prototype declares these primary custom properties:

| Token | Value | Current role |
| --- | --- | --- |
| `--ink` | `#0B0F0D` | Main near-black green background and deepest surfaces |
| `--ink-2` | `#121815` | Cards, browser frames, contact panel |
| `--ink-3` | `#1A221E` | Elevated/hover surfaces and browser chrome |
| `--salt` | `#F2EEE4` | Warm off-white primary text |
| `--salt-dim` | `#96A199` | Secondary text and subdued labels |
| `--line` | `rgba(242,238,228,.12)` | Low-contrast borders and separators |
| `--green` | `#2AE08A` | Primary SaltBox accent, CTAs, status, and emphasis |
| `--green-2` | `#16B86C` | Secondary green used in brand gradients |
| `--amber` | `#E9B24C` | Browser-window accent and selected decorative details |

Supporting values include deep CTA text `#06150D`, several translucent green borders/backgrounds, and contextual palettes for the fictional demos and portfolio gradients. The overall visual identity is a warm, tactile dark theme with vivid green status energy rather than a generic black-and-white agency site.

### Typography

- Display: **Bricolage Grotesque**, weights 400–800, with Inter/system fallbacks.
- Body: **Inter**, weights 400–600, with system fallbacks.
- Labels/status/data: **Space Mono**, weights 400 and 700, with monospace fallbacks.
- Headlines use heavy 700–800 weights, tight negative letter spacing (`-.02em` to `-.04em`), and compact line height around `.94`–`1.04`.
- Eyebrows, statuses, and package labels use small uppercase monospace text with `.1em`–`.2em` tracking.
- Fluid `clamp()` sizing is used for the hero, section headings, story headings, browser-demo heading, and portfolio tiles.

### Layout, spacing, and hierarchy

- Main content width: `1320px` maximum.
- Desktop horizontal padding: `44px`; smaller-screen padding: `22px` (story uses `14px`).
- Desktop section spacing is generally `130px` vertically; major smaller-screen sections reduce to `74px`.
- The hero uses a near-even two-column grid and fills approximately the remaining viewport under the header.
- Cards rely on generous internal padding (typically 30–38px), clear eyebrow/heading/body hierarchy, and restrained borders.
- Desktop narrative sections deliberately consume multiple viewport heights: the story track is `480vh` and the portfolio track is `300vh`.

### Shape, surfaces, and depth

- Small browser/control details use 3–13px radii.
- Browser frames use 16px radii; portfolio cards 18px; service/care cards 20px; package cards 22px; contact panel 26px.
- CTAs, ribbons, badges, and status tags use fully rounded `999px` pills.
- Surfaces are mainly `--ink-2` with thin `--line` borders. Hover/elevated states move toward `--ink-3` or green-tinted borders.
- Shadows are concentrated around primary CTAs, the brand mark, featured package, browser frame, and tooltips. They use deep black or translucent green to create depth without changing the dark palette.

### Buttons, cards, links, and decoration

- Primary buttons are green pills with dark text and a green glow shadow; ghost buttons are transparent pills with a subtle border.
- Package buttons are full-width pills; the featured Standard action is green.
- Service cards lift 8px on hover. Portfolio cards lift 5px and shift their link color to green.
- Navigation links animate a green underline from right-origin to left-origin reveal.
- Tooltips use a dark elevated panel, green-tinted border, arrow, and fade/translate entrance.
- Icons are inline, outline-style SVGs with rounded strokes; feature checkmarks use a heavier stroke.
- The brand mark is CSS-generated: a rounded green-gradient square containing a smaller dark square.
- Browser chrome, URL bars, live/building indicators, wireframes, chat bubbles, and status panels communicate “sites being built” throughout.
- A subtle fixed fractal-noise texture adds grain; a large blurred color glow drifts behind the page and changes with the active hero demo.

## Responsive design inventory

The only width breakpoint is `max-width: 920px`; there is no separately tuned tablet and phone breakpoint. Fluid typography and flexible values provide some interpolation outside that boundary.

### Above 920px

- Full navigation links and quote CTA are visible.
- Hero is a two-column layout; the demo browser rests in a tilted 3D perspective and reacts to pointer movement.
- Services and packages use three columns.
- Story remains pinned for `480vh`, with text and browser visual side by side.
- Portfolio remains pinned for `300vh` and maps vertical scroll progress to horizontal filmstrip translation.
- About and contact use two columns; footer uses a three-column grid.

### At or below 920px

- Navigation links and the desktop CTA are replaced by a hamburger button. Opening it slides a fixed, full-screen overlay in from the right and morphs the hamburger into an X.
- Hero becomes one column, uses smaller fluid heading sizes, removes forced full-viewport height, disables browser tilt, and hides the scroll cue.
- Story preserves the pinned scroll narrative but reduces its track to `440vh`, stacks text above visual, reduces visual height, and tightens padding/type.
- Services and packages stack. The featured Standard plan is visually reordered first.
- Portfolio disables the pinned transform and becomes a native horizontal overflow carousel with `scroll-snap` cards sized to `80vw`; its hint is hidden.
- About and contact stack; the contact panel reduces padding.
- Footer becomes one primary column with link groups displayed side by side.
- About stats retain `flex-wrap: nowrap`, which should be tested at very narrow widths and with larger text.

### Reduced motion

`prefers-reduced-motion: reduce` disables CSS animations and transitions, exposes reveal content, and renders the first hero demo completed. This is valuable behavior to preserve. It is incomplete: programmatic smooth scrolling remains, the long pinned story remains, and the portfolio scroll handler does not explicitly skip reduced-motion users.

### Responsive preservation priorities

Preserve the mobile overlay’s visual character, hero/demo stacking, featured-plan prioritization, pinned mobile story concept, native mobile portfolio scroll-snap, fluid display typography, compact gutters, and the transition from immersive desktop storytelling to touch-friendly horizontal browsing.

## Motion and interaction inventory

| Interaction | Trigger | What changes and timing | Preservation intent |
| --- | --- | --- | --- |
| Page entrance | Initial script execution | Body gains `in`; hero elements rise/fade over `.85s`, staggered from `.10s` to `.58s`; demo stage uses a `1.05s` entrance | Preserve the quiet staged introduction |
| Ambient glow | Continuous | Background glow drifts/scales over `16s` alternate and changes color over `1.1s` with demo themes | Preserve ambient depth and theme connection |
| Status pulse/cursor blink | Continuous | Live dots pulse every `1.4s`; typed cursor blinks every `.8s` | Preserve “active build” energy without distracting excess |
| Kinetic hero phrase | Every `2600ms` when motion is allowed | Phrase exits upward with blur/fade over `.45s`, swaps after `460ms`, then enters over `.5s`; phrases are “showing off.”, “clicking.”, “bragging about.”, “coming back to.” | Preserve the rotating proposition and cadence unless copy is intentionally reviewed |
| Magnetic CTAs | Pointer movement on hover-capable devices | Button and inner label translate proportionally toward the pointer; reset on mouse leave | Preserve desktop personality; exclude touch and reduced motion |
| Hero browser tilt | Pointer movement over demo stage | Browser varies around resting `rotateY(-8deg) rotateX(3deg)` with `.25s` easing | Preserve the dimensional browser-frame feel; mobile correctly disables it |
| Fictional demo builder | Automatic loop | Cycles Birch & Bean, Ironside Barber Co., and Fern & Stone; themes update; heading types at `46ms` per character; cursor travels over `.65s`, clicks for `140ms`, status becomes LIVE, holds `2400ms`, fades about `.45s`, then repeats | This is a signature hero concept and should be faithfully recreated |
| Demo shimmer | Demo reaches built state | A highlight sweeps across the mock hero image for `1s` | Preserve as a finishing cue |
| Story progression | Scroll through pinned track | Progress bar maps continuously to track progress; five discrete beats cross-fade/scale over `.55s`; browser URL/status and visual change at each fifth | Preserve the five-step narrative and desktop/mobile pinned character; validate scroll comfort |
| Launch confetti | Launch beat becomes active | Three colored squares pop upward/fade over `.9s`, with small staggered delays | Preserve playful launch payoff |
| Section reveals | Intersection at 14% with `-8%` bottom root margin | Elements rise 32px and fade over `.85s`; siblings stagger by `.08s`; each reveals once | Preserve restrained scroll reveal behavior |
| Card/link hover | Pointer hover | Service lifts 8px; portfolio lifts 5px; borders, surfaces, or links move toward green | Preserve consistent green feedback and elevation language |
| Package tooltips | Hover, keyboard focus, or click/tap | Tooltip fades/translates over `.25s`; clicking elsewhere closes it | Preserve detail access, but improve semantics and mobile/keyboard behavior |
| Mobile navigation | Hamburger click/nav-link selection | Full-screen overlay slides in over `.4s`; bars morph over `.3s`; selecting a link closes it | Preserve overlay treatment while adding production focus behavior |
| Section CTAs | Button activation | JavaScript calls smooth `scrollIntoView()` | Preserve intent; respect reduced-motion preference in production |
| Quote action | Quote button activation | Reads four fields and opens a prefilled `mailto:hello@saltbox.design` URL | Preserve only as prototype behavior; replace for production |
| Portfolio filmstrip | Desktop vertical scroll | `300vh` pinned track translates filmstrip horizontally based on scroll progress | Preserve cinematic presentation; validate performance and keyboard access |
| Portfolio carousel | Touch/smaller screens | Native horizontal scrolling with snap alignment and momentum | Preserve touch-native behavior and card treatment |

The stylesheet defines a `.nav.scrolled` appearance, but no script applies the class. Treat this as an unused/proposed state until visual intent is confirmed.

## Content inventory

### Brand and primary proposition

- Brand rendering: “Saltbox” (lowercase “b” in displayed wordmark/title copy).
- Location/category eyebrow: “Web design & branding · Salt Lake City”.
- Hero construction: “Websites worth [showing off / clicking / bragging about / coming back to].”
- Lead: modern websites and branding for local shops, makers, and service pros, plus ongoing care; no agency runaround and no jargon.
- Primary CTAs: “Get a free quote” and “See our work”.
- Proof points: “Free quote in 48h” and “Branding + care in one place”.

### Services

- **Branding** — logo, colors, and type intended to make a business look established and distinctive.
- **Websites & stores** — modern, responsive, Google-discoverable sites intended to convert visitors.
- **Care & hosting** — optional ongoing updates after launch.

### Current workflow messaging

1. Chat — free, no-pressure discovery call.
2. Brand — logo, colors, and type.
3. Build — responsive, search-oriented site creation.
4. Launch — domain connection and Google setup.
5. Look after — optional hosting, backups, and content updates.

### Existing prototype pricing — requires business review before production launch.

Pricing and inclusions are transcribed as represented by the prototype and must not be assumed final.

#### Starter — `$900 to start`

- “Get found online.”
- 4-page website (Home, About, Services & Contact).
- Custom logo (600×600) + brand colors.
- Web & mobile responsive.
- Email & phone integration (contact form + tap-to-call).
- Google Analytics + Business Profile.

#### Standard — `$2,400 to start`

- “Bring in more customers.”
- Marked “Most popular”.
- Everything in Starter, plus three site pages (seven total).
- Logo Suite — four logo variations.
- Brand style guide.
- Photo/work gallery.
- Online booking or small shop setup (up to 15 items).
- Local SEO.
- Three free months of small updates.

#### Custom — `Let’s talk`

- “Built exactly how you want.”
- Everything in Standard, plus unlimited pages.
- Fully custom design.
- Full online store.
- Custom features (booking, memberships, integrations).
- Advanced SEO + analytics.
- Priority updates included.

#### Keep-it-running plan — `$150/month`

- Labeled “For Saltbox clients only”.
- Available after SaltBox has built or taken over the site.
- New photos, prices, and hours handled by SaltBox, plus hosting and daily backups.
- Cancel anytime.

The prototype states that prices are starting points, final quotes depend on scope, payment splitting may be available, and every project begins with a free, no-pressure call.

### Hero example businesses

These are explicitly described in JavaScript as fictional demos:

- **Birch & Bean** (`birchandbean.co`) — neighborhood roastery; “Mornings, sorted.”; “See the menu”.
- **Ironside Barber Co.** (`ironsidebarber.co`) — cuts and straight-razor shaves; “Sharp looks. No fuss.”; “Book a chair”.
- **Fern & Stone** (`fernandstone.shop`) — plant shop and studio; “Bring the outside in.”; “Shop plants”.

Their displayed domains are demo text, not anchors.

### Portfolio/example businesses

The section claims “Real businesses, already live.” Each card is an external link opening in a new tab with `rel=noopener`. No network requests were made during this review, so availability and ownership were not verified.

| Business | Prototype category | URL classification |
| --- | --- | --- |
| Comet Painting | Custom build · Service | External Netlify site: `https://cometpaintingutah.netlify.app/` |
| iRaveBabe | Online store · Apparel | External custom domain: `https://www.iravebabe.com` |
| Everly Keepsakes | Online store · Gifts | External custom domain: `https://everlykeepsakes.com/` |
| SLC TCG | Store & events · Trading cards | External custom domain: `https://slctcg.com/` |
| MCTeams | Custom build · Gaming | External custom domain: `https://www.mcteams.com` |
| Must Be Nuts | Online store · Food | External custom domain: `https://mustbenuts.com/` |

### Audience, contact, and footer

- Audience: one-person shops through established growing businesses.
- Proof/service statements: 48-hour quote turnaround, one place for branding/web/care, and ongoing post-launch availability.
- Email: `hello@saltbox.design`.
- Location: Salt Lake City, UT.
- Quote fields: name, business name, email, and “What do you need?”.
- Footer description: websites, branding, and care for local shops, makers, and service pros, built in Salt Lake City.
- Footer copyright: 2026 Saltbox · Salt Lake City.

The package tooltips contain numerous hardcoded marketing/statistical claims. Each needs source, date, legal/marketing review, and an intentional decision to keep, revise, or remove it before launch.

## Product-positioning mismatches and future review

The current site explains a traditional inbound agency funnel: visitors discover SaltBox, compare services/packages, request a call, and then SaltBox learns about the business. The evolved product reverses much of that sequence: SaltBox discovers and evaluates a prospect, creates a personalized demo, reaches out with “I built you a website,” lets the business see the result first, and converts demonstrated interest.

Future review should consider, without automatically exposing internal automation:

- Making **“See what your new website could look like before paying SaltBox”** the clearest differentiated promise.
- Deciding whether the hero’s live-build concept should shift from generic examples toward an explanation or entry point for personalized demos.
- Supporting a known prospect arriving from outreach: the public site may need to orient them back to their personalized demo instead of forcing a generic quote funnel.
- Reconsidering “We start with a chat” because qualified outbound prospects may see a demo before any conversation.
- Reframing package/quote CTAs around demo review, expressing interest, claiming a concept, or moving into production.
- Distinguishing public inbound and personalized outbound-demo paths while retaining one coherent brand.
- Ensuring “free,” “before paying,” ownership, customization, expiration, and privacy claims are accurate and unambiguous.
- Testing new promises and CTAs through ADR-002 measurement discipline rather than changing several variables without attribution.

These are recommendations only. Do not rewrite current copy until product, sales, legal, measurement, and visual-review stakeholders approve the new journey.

## Technical debt and prototype limitations

| Area | Observation | Classification |
| --- | --- | --- |
| Lead capture | Quote action relies on the visitor’s local email client through `mailto:`; no guaranteed submission, receipt, validation, spam protection, consent record, or recovery | **Critical for production** |
| Security/privacy | A real form requires server-side validation, abuse controls, privacy/consent decisions, secure configuration, and retention rules | **Critical for production** |
| Analytics/attribution | No analytics or funnel events; demo/outreach/campaign attribution is absent | **Critical for production** for SaltBox’s learning model |
| Demo integration | No personalized prospect routes, access policy, demo ownership, expiry, attribution, or conversion state | **Critical for production** for the evolved proposition |
| SEO foundation | Only title, viewport, charset, and dark color-scheme metadata exist; canonical/social/structured discovery data is absent | **Critical for production** before public launch |
| Accessibility | Unassociated form labels, absent form semantics, incomplete navigation focus/state, limited focus styles, and incomplete reduced-motion handling | **Critical for production** |
| Content integrity | Pricing, services, portfolio, contact data, proof claims, and copyright are hardcoded; package statistics are unsourced | **Should fix during migration** |
| Architecture | HTML, CSS, behavior, and content are coupled in one 69KB file | **Prototype-only / expected**, then **Should fix during migration** |
| Styling | Global selectors, repeated rules (including `.eyebrow`), inline values, and theme mutation through CSS properties create coupling | **Should fix during migration** |
| JavaScript | Two scripts share broad DOM responsibilities; update logic is duplicated; timer loop is perpetual; no lifecycle boundary exists | **Should fix during migration** |
| Scroll performance | Story and portfolio read layout and write visuals on scroll; RAF calls are requested per event without a shared scheduling guard | **Should fix during migration**, preserving appearance |
| Responsive model | One breakpoint carries phone/tablet layouts; narrow widths, text zoom, landscape, and extreme heights are not explicitly covered | **Should fix during migration** after baseline capture |
| Navigation | `.nav.scrolled` is styled but never applied; mobile menu lacks `aria-expanded`, Escape handling, focus management/trap, and scroll locking | **Should fix during migration** |
| Tooltips | Most controls have labels/focus display, but open-state semantics are absent; the inline information glyph is a non-interactive span | **Should fix during migration** |
| Forms | Labels lack `for`; fields lack `name`, autocomplete, required state, errors, or success state; fields are not inside a form | **Critical for production** |
| Icons | Inline SVGs are consistent but decorative icons are not consistently hidden from accessibility APIs | **Should fix during migration** |
| Motion | Reduced-motion CSS exists, but smooth scripted scroll, long pinned regions, and portfolio behavior are not fully adapted | **Should fix during migration** |
| External fonts | Rendering depends on Google Fonts/network; privacy, performance, caching, and fallback need a production decision | **Should fix during migration** |
| Media/assets | Mockups and portfolio tiles are CSS abstractions rather than screenshots/images | **Prototype-only / expected**; retain unless approved otherwise |
| Browser compatibility | Sticky scenes, backdrop filters, scroll mapping, and dynamic measurements need a supported-browser matrix | **Should fix during migration** |
| Progressive enhancement | Core text exists without JS, but reveals begin hidden and navigation/tooltips/quote/story depend on script | **Should fix during migration** |
| Testing | No visual baselines, interaction tests, accessibility tests, or performance budgets | **Should fix during migration** |
| Deployment | No build, headers, caching, CSP, error handling, observability, robots, sitemap, or release process | **Should fix during migration** after runtime selection |
| Featured-plan ordering | Standard is visually reordered first on mobile while DOM order remains Starter, Standard, Custom | **Can defer** to faithful-port QA |
| Logo source | Prototype uses a CSS-generated mark rather than the repository logo suite | **Can defer** until visual comparison determines whether substitution is faithful |

## SEO and discoverability review

### Current status

- `lang=en`, UTF-8 charset, responsive viewport, dark `color-scheme`, and title “Saltbox Web Design” are present.
- Section headings and descriptive visible copy give search engines indexable text.
- Portfolio links are ordinary anchors.
- There is no meta description, canonical URL, Open Graph data, Twitter/social card data, robots policy, sitemap reference/file, JSON-LD, favicon link, or explicit theme color.
- No bitmap images are used, so traditional image alt text is largely inapplicable; meaningful inline visuals still need accessibility treatment.

### Production needs

- Define route-specific titles and meta descriptions, including personalized-demo indexing policy.
- Add canonical handling and prevent prospect-specific/private demos from producing duplicate or leaked search results.
- Add Open Graph/social metadata with approved share imagery and safe fallbacks.
- Define `robots.txt`, XML sitemap generation, and indexing rules for marketing, demo, admin, authentication, and transient routes.
- Add appropriate structured data only from verified facts: likely `Organization`, `ProfessionalService` or another suitable local/business type, `WebSite`, and possibly service/offer data. Do not mark fictional demos as real businesses.
- Preserve one clear primary heading and improve mockup heading semantics so decorative demo content does not confuse the document outline.
- If portfolio imagery is introduced, provide accurate alt text and intrinsic dimensions.
- Establish performance budgets around fonts, JavaScript, animation, long scroll scenes, and above-the-fold rendering.
- Measure Core Web Vitals, especially LCP, INP, and CLS, on real devices and representative networks.
- Validate local discoverability claims, business name/casing, address/service area, contact facts, and NAP consistency before publishing schema.

## Lightweight accessibility review

### What the prototype already does well

- Declares document language and uses native buttons/anchors for primary navigation and CTAs.
- Uses `header`, `section`, `article`, and `footer` elements and a generally understandable h1 → h2 → h3 visual hierarchy.
- Mobile menu button has an accessible name.
- Most package tooltip buttons have an accessible name and support `:focus-visible` display.
- External portfolio links use `rel=noopener`.
- Inputs have visible nearby labels and clear focus border changes.
- No bitmap images are present with missing alt text.
- Includes a meaningful `prefers-reduced-motion` branch and skips pointer-magnetic/tilt behavior for touch or reduced-motion users.

### Issues to address in a faithful production port

- Wrap primary content in `main` and provide a skip link.
- Associate labels using `for`/`id`, and implement a real form with names, autocomplete, validation, error relationships, submission status, and keyboard-compatible outcomes.
- Decide required fields and expose that state programmatically rather than relying on placeholders.
- Give mobile navigation `aria-expanded`/`aria-controls`; close on Escape; manage focus, background inertness/scroll lock, and focus return.
- Ensure all links/buttons have visible high-contrast focus styles, not hover-only feedback.
- Add tooltip open-state semantics and robust keyboard/touch dismissal. Do not communicate essential claims only on hover.
- Mark decorative SVGs/status dots appropriately; name only icons that convey information.
- Treat hero/story visuals as decorative with equivalent prose, or as a named region with concise status. Avoid announcing continuous animation changes.
- Review nested demo headings so the document outline represents the SaltBox page, not simulated sites.
- Provide accessible alternatives to pinned/horizontal scroll storytelling and predictable keyboard access to portfolio links.
- Complete reduced-motion support by disabling smooth scrolling, avoiding forced long tracks where appropriate, and stopping nonessential auto-cycling.
- Test `--salt-dim`, placeholders, translucent borders, green text, and contextual demo themes for WCAG contrast at actual sizes/weights.
- Test at 200%/400% zoom, increased text spacing, high contrast/forced colors, screen readers, keyboard-only use, and assistive touch.

## Visual Preservation Contract

The production migration must preserve the following unless an intentional visual change is explicitly reviewed and approved:

- Overall visual identity.
- SaltBox color language.
- Typography character.
- Hero concept.
- Browser/demo visual treatment.
- Animation personality.
- Spacing and density.
- General card language.
- Interaction style.
- Responsive character.
- Portfolio presentation.
- Brand personality.

The production implementation may change implementation details substantially while keeping the visual result substantially faithful. Componentization, type safety, server rendering, data extraction, performance work, and accessibility improvements should reproduce the approved design rather than silently reinterpret it.

> **Implementation modernization is not permission for visual redesign.**

Before migration begins, capture agreed desktop, tablet, mobile, reduced-motion, menu-open, package-tooltip, story-beat, hero-demo, and portfolio-scroll reference states. Faithful-port review should compare both static appearance and timing/interaction character.

## Conceptual future component boundaries

No framework is implied by these boundaries.

```text
Website
├── HeaderNavigation
│   └── MobileNavigationOverlay
├── Hero
│   ├── KineticPhrase
│   └── DemoBuildAnimation
│       └── BrowserFrame
├── Services
│   └── ServiceCard
├── ProcessStory
│   ├── StoryProgress
│   ├── ProcessBeat
│   └── ProcessVisualization
│       └── BrowserFrame
├── Pricing
│   ├── PricingCard
│   ├── FeatureTooltip
│   └── CarePlanStrip
├── Portfolio
│   └── PortfolioCard
├── AudienceAbout
├── QuoteContact
│   └── LeadCaptureForm
└── Footer
```

Likely reusable view primitives include `Button`, `Container`, `Section`, `SectionHeading`, `Eyebrow`, `Card`, `BrowserFrame`, `Badge`, `StatusIndicator`, `BrandMark`, `Icon`, `Tooltip`, `PricingCard`, and `PortfolioCard`. Motion concerns may deserve reusable boundaries such as reveal-on-view, reduced-motion policy, and scroll-progress mapping, but those abstractions should emerge from the faithful port rather than becoming a general animation framework prematurely.

Keep business/integration boundaries separate from view components: lead submission, analytics emission, pricing resolution, experiment assignment, and demo-route resolution should not live inside presentational components.

## Future data boundaries

The following should eventually become validated, typed/configured data rather than duplicated markup:

- **Navigation items** — keeps header, mobile overlay, and footer destinations consistent.
- **Services** — allows copy/icon association to be reviewed without restructuring layout.
- **Process beats** — keeps labels, headings, descriptions, visual type, URL/status state, and order synchronized.
- **Pricing plans and care plan** — avoids divergent prices/inclusions across marketing, sales, checkout, and admin; requires an authoritative source and effective-version rules.
- **Pricing feature tooltips/proof claims** — supports citations, review dates, jurisdiction/legal status, and controlled retirement.
- **Portfolio projects** — separates title, category, description, destination, visual treatment, publication, and verification status.
- **Fictional hero demo businesses** — binds copy, theme tokens, timing inputs, and clear fictional/demo status.
- **Contact/location details** — prevents inconsistent business facts and supports environment-specific routing without exposing secrets.
- **CTA definitions/experiments** — permits measured copy/destination variants while preserving deterministic assignment and attribution.
- **SEO metadata/structured facts** — enables route-specific output and verified source ownership.
- **FAQs/testimonials** — none currently exist; if introduced later, they should be evidence-backed data.

Extract data during or immediately before the faithful port, not as a speculative content platform. Preserve stable identifiers so analytics and experiments can compare behavior across revisions.

## Future SaltBox integration points

### Lead capture

Replace `mailto:` with a server-mediated SaltBox submission capability. It should validate inputs, handle abuse and consent, return accessible outcomes, generate an idempotent record, and avoid exposing provider credentials.

### CRM and lifecycle

Create or associate the lead/prospect with the authoritative CRM state machine. Preserve source, campaign, personalized-demo identity, experiment exposure, consent/evidence, and timestamps. Known outbound prospects and anonymous inbound leads may enter differently but should converge on auditable states.

### Analytics and attribution

Emit stable events for meaningful behavior: landing, CTA activation, portfolio selection, package interest, form start, validation failure, lead submission, personalized demo visit/engagement/return, contact initiation, checkout start, and purchase. Definitions, identifiers, consent, and attribution windows must align with ADR-002. Decorative animation progress is not business success.

### Experimentation

Support ADR-002-controlled tests for messaging, CTAs, package presentation, hero variants, and demo entry points. Assignment should be deterministic, exposure explicit, guardrails defined, and tests isolated enough for causal interpretation. The approved prototype is the initial visual control, not an undocumented casualty of migration.

### Personalized demo system

The public site may eventually link to or host conceptual routes such as `/demo/{prospect}`, but this document does not choose a final URL shape. Architecture must support safe identifiers, access/indexing policy, versioned content, expiry/retention, attribution, responsive rendering, and handoff to conversion.

### Customer conversion

Connect qualified interest to an appropriate sales or checkout flow. Package/offer identity and price must be authoritative and versioned; conversion should be attributable to prospect, demo, outreach, and experiment without trusting browser-only state.

### Authentication and authorization

Public marketing should remain low-friction. Future customer/admin access, demo claiming, approvals, content management, or billing may require authentication, but those concerns should not be embedded in static marketing components prematurely. Admin routes and private customer data need explicit authorization boundaries.

### Pricing configuration

Move prices and entitlements to authoritative, validated configuration shared by relevant sales, checkout, CRM, and display layers. Marketing may present prices, but must not become a second source of truth.

## Alignment with ADR-001 and ADR-002

The production website should follow ADR-001 by keeping public-page rendering, navigation, validation, accessibility behavior, analytics emission, and other ordinary frontend work deterministic. Personalized demo content may be produced by upstream SaltBox capabilities, but the marketing frontend must not make paid inference a page-rendering dependency, expose model/provider credentials, or bypass the local-first and explicitly authorized escalation policy.

The website should follow ADR-002 by emitting stable, attributable funnel events; retaining version identifiers for demo, message, CTA, pricing, and experiment variants; preserving deterministic experiment assignment and control groups; and measuring downstream conversion and economic outcomes. The approved prototype is the initial visual baseline, and future changes should be evaluated as explicit, measurable hypotheses rather than bundled into implementation modernization.

## Production Frontend Requirements — framework decision recorded

[ADR-003 — Production Web Runtime and Frontend Architecture](decisions/ADR-003-production-web-runtime.md) records the evidence-based runtime decision. It evaluated candidates against:

- Reliable SEO output and metadata control.
- Fast marketing delivery, Core Web Vitals, caching, and minimal client JavaScript.
- Faithful animation, sticky-scroll, responsive, and reduced-motion behavior.
- Dynamic personalized-demo routes with safe indexing/access policy.
- Server-side lead submission and API interaction.
- Authentication needs for future customer/admin access without coupling all public pages to auth.
- Experiment assignment, analytics, attribution, and stable identifiers.
- Deployment, preview environments, observability, headers, secrets, and rollback.
- Compatibility with the future admin application and SaltBox backend boundaries.
- Shared TypeScript contracts without forcing shared UI/deployment coupling.
- Package-manager/workspace fit, developer experience, testing, reproducibility, cost, operational complexity, and maintainability.

ADR-003 selected the architecture against these requirements rather than framework popularity, and it does not assume the marketing site, admin application, and demo delivery surface must use the same rendering or deployment strategy.

## Recommended migration phases

### Phase 1 — Preserve

- Keep the `reference/marketing-prototype` import intact.
- Record hashes and provenance.
- Capture rendered desktop/tablet/mobile and interaction baselines when browser tooling is available.
- Establish the Visual Preservation Contract as an acceptance criterion.
- Runtime selection is decided by [ADR-003](decisions/ADR-003-production-web-runtime.md); no runtime has been implemented.

### Phase 2 — Establish Runtime (not started)

- When separately authorized, establish the runtime and deployment foundation accepted in [ADR-003](decisions/ADR-003-production-web-runtime.md) without changing the Visual Preservation Contract.

### Phase 3 — Faithful Port

- Reproduce the approved prototype in maintainable components and explicit content boundaries.
- Keep content, design tokens, layout, responsive behavior, browser treatments, animation timing/personality, portfolio presentation, and CTA intent faithful.
- Build visual regression and interaction tests around captured baselines.
- Make accessibility improvements that preserve the intended look and behavior.

### Phase 4 — Productionize

- Add complete SEO/social/discovery metadata and indexing controls.
- Finish accessibility, reduced-motion, keyboard, screen-reader, zoom, and contrast work.
- Replace mailto capture with a secure real submission path.
- Add analytics/events, attribution, CRM association, and consent/privacy behavior.
- Establish authoritative content/configuration boundaries, tests, performance budgets, security headers, monitoring, and deployment/rollback.

### Phase 5 — SaltBox Product Integration

- Connect personalized demos, prospect journeys, CRM lifecycle, outreach attribution, customer conversion, experimentation, and SaltBox backend capabilities.
- Add safe demo routing/access/indexing, versioning, expiry, and customer handoff.
- Connect authoritative pricing/offers and any approved checkout or sales flow.

### Phase 6 — Evidence-Based Optimization

- Use ADR-002-governed data to improve messaging, CTAs, pricing presentation, demo experiences, and conversion.
- Preserve control groups, stable assignments, guardrails, and the ability to explain why performance changed.
- Approve intentional visual changes explicitly; do not smuggle redesign into technical optimization.

## Acceptance criteria for the future faithful port

- Reference file remains unchanged and available for comparison.
- Approved viewport screenshots and interaction recordings are substantially faithful.
- Content/pricing differences are absent or explicitly approved and versioned.
- Desktop and smaller-screen story/portfolio behavior retains the prototype’s character.
- Keyboard, reduced-motion, screen-reader, and zoom paths remain usable without hiding essential content.
- Real lead submission is secure, observable, and associated with correct CRM/attribution context.
- SEO metadata, indexing policy, performance budgets, and analytics contracts are verified.
- No framework-specific rewrite is treated as permission to change brand, density, motion, or customer journey without review.
