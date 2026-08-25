# ADR-003 — Production Web Runtime and Frontend Architecture

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

SaltBox needs a production web architecture for three materially different surfaces:

1. A public marketing website whose dominant concerns are SEO, Core Web Vitals, visual fidelity, and very low cost.
2. A high-volume personalized-demo delivery surface whose pages are generated from structured prospect data and need dynamic lookup, attribution, privacy controls, caching, and expiration.
3. A future authenticated internal application with tables, filters, CRM state, queues, analytics, experiments, support workflows, and system health.

The approved marketing prototype at `reference/marketing-prototype/index.html` is fundamentally static content plus focused CSS and browser-native JavaScript. Its hero builder, browser mockups, scroll story, portfolio filmstrip, mobile states, and reduced-motion branch prove that visual fidelity does not require a site-wide SPA runtime or a heavy animation library.

ADR-001 requires deterministic software before AI and reusable templates driven by structured data rather than a separately generated application for every prospect. ADR-002 requires first-party, attributable events, deterministic experiment assignment, versioned exposures, and canonical learning data owned by SaltBox.

The initial platform cost should be approximately zero before revenue, but free-tier convenience must not move core business rules or canonical data irreversibly into one provider.

## Decision drivers

In priority order, the architecture must support:

- Near-zero initial infrastructure cost and low marginal cost.
- Static or server-rendered HTML, excellent SEO, and strong Core Web Vitals.
- Faithful reproduction of the approved animation-heavy prototype.
- Minimal browser JavaScript outside explicitly interactive regions.
- Dynamic, cacheable, unlisted or private personalized demos without per-prospect application deployments.
- Secure lead capture, event ingestion, API integration, and future authentication.
- A capable future admin application without imposing admin complexity on public pages.
- TypeScript contracts shared across applications and SaltBox-owned backend boundaries.
- Mature tooling, predictable conventions, Windows development, testing, and reliable coding-agent support.
- Straightforward GitHub deployment and credible movement among edge, serverless, Node, or static hosts.

## Decision

SaltBox will use a **multi-application, shared-contract architecture**:

```text
apps/
├── website/       Astro; public marketing, static-first with selective on-demand routes
├── demo-sites/    Astro; one template-driven demo renderer, not one app per prospect
└── admin/         React Router Framework Mode; future authenticated operations UI

packages/
├── types/         framework-neutral TypeScript contracts
└── shared/        portable validation and cross-application utilities where justified

services/
└── ...            SaltBox-owned APIs and domain services
```

### Public website

`apps/website` will use **Astro with TypeScript**.

- Pre-render marketing pages by default.
- Use Astro components for document structure and visual primitives.
- Use scoped browser scripts, CSS, Web Animations API, `IntersectionObserver`, `ResizeObserver`, and `requestAnimationFrame` for prototype interactions.
- Introduce client islands only for components that actually require hydration.
- Do not add React, Svelte, Vue, GSAP, Framer Motion, or another animation/runtime dependency by default. Add a dependency only when a measured requirement cannot be met cleanly with platform APIs.
- Use on-demand Astro routes or endpoints only for request-time needs such as lead submission, experiment assignment, or server-mediated API calls.

Astro defaults pages and endpoints to build-time pre-rendering, permits individual routes to opt into on-demand rendering, and maintains official Node, Cloudflare, Netlify, and Vercel adapters. Its islands model emits static HTML by default and hydrates only explicitly marked interactive components. These properties directly match the preserved prototype and the public-site performance requirements. See [Astro islands](https://docs.astro.build/en/concepts/islands/), [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/), and the [Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/).

### Personalized demos

`apps/demo-sites` will also use **Astro with TypeScript**, but as a separate logical application and deployment boundary when demo delivery is implemented.

- A reusable, versioned set of templates/components will render structured `Demo` data.
- A request will resolve an opaque public demo identifier to a minimal safe demo payload through a SaltBox API.
- SaltBox will not build or deploy a separate framework application for each prospect.
- Responses should be cached where privacy and freshness allow. Popular, approved, or archived demos may later be materialized as static artifacts without changing the data contract.
- Demos will be unlisted and `noindex` by default unless an explicit policy says otherwise; they will be excluded from public sitemaps.
- Expired demos will return an intentional expired, `404`, or `410` response according to later product policy.
- Internal prospect IDs, lead scores, enrichment data, and private CRM fields will never be used as public identifiers or included in the browser payload.

Separating the demo renderer from the public website allows independent caching, traffic, privacy, and lifecycle policies while retaining one runtime and template ecosystem. It does not imply one deployment per prospect.

### Future admin application

`apps/admin` will use **React Router Framework Mode with TypeScript** when admin implementation is authorized.

React Router is a better fit than Astro for a large authenticated application with nested data routes, mutations, pending states, filters, tables, and extensive React ecosystem needs. Framework Mode supports SSR, static pre-rendering, route loaders/actions, code splitting, and route-derived types. It can deploy to Node/Docker or managed adapters; Cloudflare maintains an official Workers path. See [React Router modes](https://reactrouter.com/start/modes), [rendering strategies](https://reactrouter.com/start/framework/rendering), and [deployment targets](https://reactrouter.com/start/framework/deploying).

The admin does not need to share view components or rendering behavior with the public website. Sharing contracts and domain semantics is more valuable than forcing unrelated UIs into one framework.

### Backend boundary

Frontend framework server features may implement thin HTTP adapters or backend-for-frontend endpoints, but SaltBox business rules will live behind SaltBox-owned service interfaces.

- The public and demo apps may validate a request, read safe configuration, set attribution, and call a SaltBox API.
- CRM transitions, authoritative pricing, prospect state, experiment records, customer actions, and canonical event storage must not exist only inside an Astro action, React Router action, or hosting-provider binding.
- The admin communicates with the same authenticated SaltBox API/domain services rather than using the marketing application as its backend.
- Prefer standard `Request`, `Response`, `fetch`, HTTP, JSON, and framework-neutral TypeScript modules at boundaries.
- A small colocated endpoint is acceptable at the beginning when it removes unnecessary deployment complexity, provided domain logic remains extractable and testable.

Database, authentication, billing, and email-provider selections remain separate decisions.

## Why one full-stack application was rejected

A single Next.js, React Router, SvelteKit, or Astro application could technically serve all three surfaces. It would reduce the number of frameworks, but it would create the wrong coupling:

- The public website would inherit application hydration, routing, caching, and authentication concerns that its content does not require.
- Demo traffic and privacy policy would share a release and failure boundary with the main marketing site.
- The admin's component ecosystem and state needs would influence a performance-critical public page.
- A vulnerability or deployment mistake would have a larger blast radius.

The selected split uses only two frontend ecosystems, with Astro reused for both public-facing surfaces. That is enough separation to gain meaningful performance and security benefits without creating three unrelated stacks.

## Candidate evaluation

### Astro

**Strengths**

- Static HTML and zero client JavaScript by default.
- Selective islands and ordinary browser scripts suit the prototype.
- Per-route pre-rendering or on-demand rendering.
- Strong content, metadata, sitemap, structured-data, and performance fit.
- Official Cloudflare, Node, Netlify, and Vercel adapters provide credible portability.
- One Astro template system can support public pages and structured demos.

**Limitations**

- Less suitable than React for a large data-heavy admin.
- A smaller ecosystem and agent training footprint than Next.js/React.
- Dynamic Cloudflare routes run in `workerd`; incompatible Node-only dependencies require replacement, isolation, or a different adapter.

### Next.js App Router

**Strengths**

- Excellent static and dynamic rendering, metadata, route handlers, Server Actions, Server Components, streaming, and authentication ecosystem.
- Strongest general-purpose React ecosystem and coding-agent familiarity.
- A single framework could cover marketing, demos, portal, and admin.
- Official self-hosting supports Node and Docker. See [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) and the [production checklist](https://nextjs.org/docs/app/guides/production-checklist).

**Limitations**

- More rendering, caching, and client/server boundary complexity than the marketing prototype needs.
- It is easy to ship unnecessary client React or framework-specific behavior to a static marketing page.
- Vercel is the smoothest operational path, but Vercel Hobby is restricted to non-commercial use; SaltBox would need a paid plan. See [Vercel fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines).
- On Cloudflare, the current recommended path is `vinext`, a beta Vite reimplementation of the Next.js API surface; OpenNext remains an adapter path for existing applications. That compatibility layer is a material risk for a new provider-portable system. See [Next.js on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) and [OpenNext on Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/).

Next.js is the strongest single-framework alternative, but SaltBox should not accept its public-site overhead and Cloudflare adaptation risk merely to reuse the admin framework.

### React Router Framework Mode

**Strengths**

- Mature React ecosystem with route loaders/actions, pending states, SSR, pre-rendering, code splitting, and route-derived TypeScript types.
- Excellent fit for the future admin and customer portal.
- Portable Node/Docker deployments and maintained integrations for major hosts.
- Strong coding-agent familiarity and official documentation distributed for agent use in current releases.

**Limitations**

- A full React application is less naturally static-islands-oriented than Astro for the marketing site.
- Public-page hydration and client navigation would need careful control.
- Cloudflare's current Vite-plugin integration does not support SPA mode or pre-rendering, although SSR is supported. This does not block the selected authenticated-admin use case. See [React Router on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/).

### SvelteKit

**Strengths**

- Strong SSR, pre-rendering, form actions, endpoints, compact compiled client output, and official adapters.
- Good Cloudflare, Node, Netlify, Vercel, and static deployment options.
- Capable of serving all three surfaces with less client overhead than a conventional React SPA.

**Limitations**

- Smaller ecosystem, hiring pool, agent familiarity, and generated-code reliability than React.
- Using Svelte for the admin would give up the deepest table/dashboard ecosystem; using React for admin would still create two frameworks without Astro's stronger content/islands advantage.
- It offers no decisive SaltBox-specific advantage over Astro for public/demo surfaces or React Router for admin. See the official [Svelte package and adapter catalog](https://svelte.dev/packages), [page rendering options](https://svelte.dev/docs/kit/page-options), and [form actions](https://svelte.dev/docs/kit/form-actions).

### Framework-free static site plus separate API

**Strengths**

- Minimal runtime, maximum static-host portability, excellent raw performance, and a direct conceptual match for the prototype.
- Server concerns remain clearly separated.

**Limitations**

- SaltBox would have to invent component composition, content/data conventions, route generation, metadata tooling, preview behavior, and dynamic-demo rendering conventions.
- The separate API becomes mandatory immediately.
- It does not define an admin architecture.

Astro retains nearly the same static result while providing maintainable components, routing, TypeScript, and selective server rendering.

## Weighted decision matrix

Weights were set before scoring. They reflect SaltBox's stated priorities: cost, marketing performance, and SEO receive the largest combined emphasis; demo/server/admin capability still matters; ecosystem and portability prevent a locally optimal but fragile choice. Scores are 1–10. The weighted total is `sum(score × weight) / 100`.

| Criterion | Weight | Astro | Next.js | React Router | SvelteKit | Static + API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial Cost | 12 | 10 | 8 | 9 | 9 | 10 |
| SEO | 9 | 10 | 10 | 9 | 9 | 9 |
| Performance | 10 | 10 | 8 | 8 | 9 | 10 |
| Marketing-Site Fit | 10 | 10 | 8 | 7 | 8 | 9 |
| Dynamic Demo Fit | 8 | 9 | 10 | 9 | 9 | 6 |
| Server Capability | 8 | 8 | 10 | 9 | 9 | 7 |
| Admin Fit | 7 | 5 | 10 | 10 | 8 | 3 |
| Developer Experience | 7 | 9 | 9 | 9 | 9 | 6 |
| Agent/Codex Reliability | 8 | 8 | 10 | 9 | 7 | 8 |
| TypeScript Ecosystem | 6 | 9 | 10 | 10 | 9 | 7 |
| Deployment Simplicity | 5 | 9 | 7 | 8 | 9 | 8 |
| Provider Portability | 5 | 8 | 6 | 9 | 9 | 10 |
| Long-Term Maintainability | 5 | 9 | 8 | 9 | 8 | 6 |
| **Weighted total** | **100** | **8.92** | **8.84** | **8.78** | **8.62** | **7.84** |

The close totals matter: all four frameworks are credible. Astro wins the public/demo decision because its advantage occurs exactly where SaltBox has an approved static-first design. React Router's admin score justifies using it only where its application strengths produce value. Next.js is the fallback if maintaining two ecosystems proves more expensive than expected.

## Marketing rendering and animation architecture

The public website should pre-render ordinary marketing routes to HTML. Only behavior that needs browser state should hydrate, and each island should be scoped to the smallest useful interaction. On-demand rendering is reserved for request-dependent routes and endpoints; it is not the default for content that can be built ahead of time.

The faithful port should first use CSS animations, transitions, `IntersectionObserver`, `requestAnimationFrame`, and other standard browser APIs. The prototype already demonstrates that its hero build sequence, browser mockups, scroll reveals, portfolio motion, responsive states, and reduced-motion mode do not inherently require a large animation runtime. An animation package may be introduced later only for an interaction whose requirements cannot be met clearly and reliably with native facilities.

Visual regression baselines, interaction timing, responsive behavior, and `prefers-reduced-motion` behavior are acceptance criteria. Componentization must not alter the Visual Preservation Contract.

## SEO and demo indexing

Public marketing routes will emit complete server/static HTML with route-specific titles, descriptions, canonical URLs, Open Graph and social metadata, structured data, and sitemap inclusion as appropriate. The architecture must preserve semantic heading and landmark structure, useful alternative text, and fast rendering without requiring client JavaScript for indexable content.

Personalized demos are a different indexing class. They should default to unlisted and `noindex`, be omitted from public sitemaps, and use both document metadata and an HTTP `X-Robots-Tag` where practical. A demo renderer must be able to return an explicit not-found or gone response for unknown, expired, or archived demos. Any future decision to index a class of demos must be intentional and separate from the default.

## First-party analytics and experimentation

The browser may emit a small, versioned event envelope for events such as `landing_view`, `cta_click`, `pricing_view`, `contact_started`, `contact_submitted`, `demo_view`, `demo_engaged`, and `sales_intent`. A SaltBox-controlled server endpoint will validate, rate-limit, timestamp, enrich, and persist accepted events. Client claims about identity, price, experiment assignment, or conversion are untrusted input.

Experiment assignment should be deterministic from a stable, privacy-appropriate subject key plus experiment version, with exposure recorded separately from outcome. Message, CTA, pricing, demo, and experiment version identifiers must survive the path from page render through downstream conversion. Third-party analytics may supplement operational visibility, but cannot be the canonical learning store required by ADR-002.

Cloudflare Analytics Engine could later provide inexpensive edge telemetry, but business events must pass through a portable SaltBox interface and remain exportable to the future canonical data store. Its use is optional, not part of this decision.

## TypeScript and shared contracts

TypeScript is the default language for future SaltBox application code. Framework-neutral contracts should eventually cover entities such as `Business`, `Prospect`, `WebsiteAnalysis`, `LeadScore`, `Demo`, `Experiment`, `Outreach`, `Customer`, `Event`, and `Pricing`.

Those contracts may live under `packages/types/`, with portable validation and domain utilities under a separate shared package if warranted. Static TypeScript types do not validate network input, so API boundaries will also require runtime schemas. Shared packages must not import an Astro, React Router, database, or hosting-provider runtime. Visual components should be shared only when doing so is genuinely cheaper than maintaining surface-specific components.

No contracts or packages are created by this ADR.

## Security boundaries

- AI, email, database, enrichment, billing, and other privileged credentials remain server-only.
- Browser bundles receive minimum-purpose response models, never internal CRM records or unneeded prospect data.
- Public demo locators use opaque, non-sequential identifiers or signed locators; they do not expose canonical internal prospect IDs.
- Unlisted is not equivalent to authorized. Any demo that contains sensitive material will require a real access-control policy.
- Lead, event, demo, and future authenticated endpoints require input validation, abuse controls, safe error responses, and appropriate CSRF/origin protections.
- Future authentication must support secure server sessions and least-privilege authorization, but the provider and session design are deliberately deferred.
- Security headers, content security policy, dependency review, secret scanning, and log redaction are production requirements.
- Experiment, pricing, entitlement, and conversion decisions cannot trust client-side state alone.

## Deployment decision

### Initial deployment

Deploy the Astro public website to **Cloudflare Workers with Static Assets** using GitHub integration. Static requests should be served without invoking Worker code; only forms, event ingestion, and request-dependent routes should execute server code. Use preview deployments for pull requests once the application exists.

Cloudflare Pages is not the primary target for a new full-stack Astro application. Cloudflare currently directs new framework projects toward Workers, and Astro's current Cloudflare adapter targets the Workers runtime. Pages remains a possible static-output host or migration option, not the selected deployment primitive.

When needed, deploy the demo renderer and admin as separate Workers/applications with independent routing, release cadence, and resource limits. Whether demos use a path or subdomain remains undecided. A separate deployment does not mean one deployment per prospect.

### Cloudflare capability boundaries

| Capability | Intended role | Decision boundary |
| --- | --- | --- |
| Workers Static Assets | Primary delivery for pre-rendered HTML, CSS, JavaScript, fonts, and optimized images | Selected for initial hosting |
| Workers | Thin request handling for forms, events, dynamic lookup, and later API/BFF needs | Selected, but business logic stays portable |
| Pages | Possible static fallback or legacy deployment path | Not the primary new-project target |
| KV | Cache, low-churn feature configuration, or non-authoritative lookup acceleration | Not a canonical mutable business store; global propagation is eventually consistent |
| D1 | Possible future data-store candidate | Database selection is out of scope |
| R2 | Possible generated asset or snapshot storage | Deferred; access through a portable storage interface |
| Queues | Possible asynchronous buffering for event or workflow processing | Deferred; not required for launch |
| Analytics Engine | Possible high-volume operational/event telemetry | Optional accelerator, never the sole canonical outcome store |
| Custom domains | Public website and later demo/admin routing | Supported; exact domain topology is deferred |

Cloudflare's workerd runtime is not identical to a general Node.js server. Dependencies must be checked for runtime compatibility, and provider bindings should be isolated in adapter modules. If an essential dependency requires unrestricted Node APIs, a Node deployment remains a supported escape path.

## Cost analysis

Prices and limits below are a dated planning snapshot, not a budget guarantee. Database, email, domain registration, AI, billing, and generated-asset storage are outside ADR-003.

| Stage/provider | Cost assessment | Material considerations |
| --- | --- | --- |
| Local development | No direct infrastructure charge | Open-source frameworks; maintaining Astro and React ecosystems has human cost |
| Cloudflare initial production | Near-zero: expected **$0 hosting/platform cost** while within the Workers Free limits | Static assets are free and unlimited; the free Worker allowance is currently 100,000 requests/day with 10 ms CPU per invocation |
| Cloudflare moderate scale | Low, usage-based: likely starts with the Workers Paid minimum, currently **$5/month/account**, then measured usage | Paid includes 10 million requests and 30 million CPU milliseconds monthly; storage, queues, and other products are separate |
| Vercel | Excellent Next.js workflow, but not the near-zero commercial default | Hobby is restricted to non-commercial personal use; a commercial SaltBox deployment would need a paid plan |
| Netlify | Viable portable alternative | Current free tier uses a credit allowance and hard-pauses at its limit; paid tiers add predictable capacity |
| GitHub Pages | Not suitable | Static-only and its terms/limits do not make it an appropriate host for a commercial SaaS or server endpoints |
| Self-hosted Node/container | Portable fallback, not the initial choice | Adds a continuously billed server plus patching, monitoring, TLS, scaling, and incident-response work |

Build-time image optimization and correctly sized source assets should be preferred initially. Runtime image-transformation products should be adopted only when their measured benefit justifies their cost and coupling.

High demo volume must increase data and request volume, not build count or deployment count. Rendering thousands of prospects as thousands of independent applications would create unnecessary build minutes, cache churn, operational overhead, and inconsistent releases.

## Provider portability

SaltBox will use standard HTTP, `Request`/`Response`, `fetch`, environment configuration, and framework-supported adapters wherever practical. Core lead, event, demo, experiment, pricing, and customer rules belong in framework- and provider-neutral modules or backend services. Direct Cloudflare bindings belong in thin infrastructure adapters.

Astro has maintained adapters for several server targets and can emit static output; React Router can deploy to standard Node/Docker-style environments as well as supported edge platforms. Moving providers would still require deployment work and replacement adapters, but should not require rewriting SaltBox's business model.

The architecture accepts useful provider integration at the edges while rejecting provider-specific business logic as the system of record.

## Consequences

### Benefits

- The public site starts from the lowest-JavaScript architecture that naturally fits the approved prototype.
- Marketing, demos, and admin can scale and release independently without making the homepage an application shell.
- One data-driven demo renderer supports large prospect volume at low marginal cost.
- TypeScript and React remain available where their mature application ecosystem has the highest value.
- Cloudflare offers a credible zero-cost start and low-cost edge scaling without making it impossible to move to Node or another host.
- SEO, index control, first-party events, and server-side lead handling are first-class architecture concerns.

### Tradeoffs and risks

- SaltBox will maintain two frontend ecosystems, Astro and React Router, including different conventions and upgrade paths.
- Cross-application visual primitives will not automatically be reusable across framework boundaries.
- Cloudflare Workers compatibility and Astro/adapter evolution require active dependency review.
- A split application topology adds deployment and observability surfaces compared with a single application.
- Astro's admin ecosystem is weaker than React's, while React Router's marketing-island model is less direct than Astro's; the decision deliberately accepts specialization.
- Next.js has the broadest full-stack React mindshare and coding-agent familiarity, so the selected split sacrifices some uniformity and generated-code predictability.

The largest architectural risk is **boundary erosion**: putting canonical business rules directly into Cloudflare bindings or framework route handlers would turn an inexpensive host into a migration constraint. Thin adapters, shared contracts, and API-level tests are the mitigation.

## Revisit triggers

Revisit ADR-003 if any of the following becomes true:

- Most public pages become authenticated, highly stateful application UI or require broad hydration.
- Maintaining two frontend ecosystems measurably slows delivery more than the performance separation helps.
- Shared interactive UI between public, demo, and admin surfaces becomes a dominant requirement.
- The demo renderer requires stateful editing, streaming, or dependency capabilities that Astro cannot support cleanly.
- An essential dependency is incompatible with Workers, or Cloudflare pricing, limits, reliability, or product direction changes materially.
- Astro's Cloudflare support, React Router's deployment support, or their agent/tooling reliability deteriorates.
- Measured Core Web Vitals, SEO output, build time, or demo-serving economics fail the stated requirements.
- A single-runtime alternative demonstrates lower total operating and development cost with equivalent visual fidelity and performance.

## Deferred decisions and implementation boundary

This ADR does **not** select a package manager, workspace tool, exact framework versions, database, authentication provider, email provider, analytics vendor, billing provider, object store, demo URL structure, or final API topology.

It authorizes no implementation. No application scaffold, package manifest, dependency installation, hosting configuration, component, endpoint, contract, or deployment is part of this task.

## Research snapshot

Official documentation reviewed on 2026-08-25:

- [Astro islands](https://docs.astro.build/en/concepts/islands/), [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/), and [Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [production guidance](https://nextjs.org/docs/app/guides/production-checklist), and [Next.js on Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [React Router modes](https://reactrouter.com/start/modes), [rendering](https://reactrouter.com/start/framework/rendering), [deployment](https://reactrouter.com/start/framework/deploying), and [Cloudflare deployment](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
- [SvelteKit adapters](https://svelte.dev/packages), [page options](https://svelte.dev/docs/kit/page-options), [form actions](https://svelte.dev/docs/kit/form-actions), and [Cloudflare deployment](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/), and [Pages framework guidance](https://developers.cloudflare.com/pages/framework-guides/)
- [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/), and [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Vercel Hobby terms](https://vercel.com/docs/limits/fair-use-guidelines), [Netlify pricing](https://www.netlify.com/pricing/), and [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
