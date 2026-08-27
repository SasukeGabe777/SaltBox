# @saltbox/website-intelligence

Phase 6 deterministic website-intelligence: a bounded, hardened browser
analysis that produces a deep condition report for a real business website.

This service records individual measured dimensions and does not own a
composite quality score. `qualification-v1` remains unchanged. Phase 7's
separate `@saltbox/qualification` service consumes a documented subset of
this evidence for `qualification-v2`; remaining metrics stay operator context.

```text
business website
  → safe HTTP discovery (SSRF-checked redirect resolution)
  → robots.txt etiquette for the automated sub-pages
  → hardened ephemeral Chromium
  → homepage + ≤4 deterministic sub-pages (contact/services/about/locations)
  → Lighthouse lab run (mobile emulation)
  → mobile viewport pass, screenshots
  → bounded link/asset health
  → structured observations + versioned website_analysis
  → SaltBox admin case file
```

## Analyzer version

`website-intelligence-v1` is persisted on every `website_analysis`,
`website_snapshot` (capture tool), and observation (verification method).
Future analyzers append new versions; history is never rewritten.

## Tooling decision

**puppeteer 25 (Chrome for Testing) + lighthouse 13.** Lighthouse is the
standard for lab performance/accessibility/SEO/best-practice measurement and
officially supports running against a Puppeteer page (its documented
integration path). Playwright has no first-class Lighthouse integration and
would be a second browser stack for no additional capability, so exactly one
browser stack is installed. Chrome downloads once via puppeteer's approved
postinstall (`allowBuilds` in `pnpm-workspace.yaml`).

## Security model

Every website is treated as hostile:

- Phase 4's `net-safety` SSRF baseline is reused: every navigation and
  link-check hostname is DNS-resolved first and every address must be public
  (loopback, RFC1918, link-local/metadata, CGNAT, multicast, IPv4-mapped
  IPv6 — including the hex-normalized form — all blocked).
- The homepage redirect chain is resolved over plain HTTP with per-hop checks
  BEFORE the browser exists; a redirect into private space aborts the run.
- Validated site hosts are IP-pinned into Chrome via `--host-resolver-rules`,
  so DNS rebinding cannot re-point the main origin mid-analysis.
- Request interception blocks navigations to unvalidated hosts (resolved and
  checked on demand) and any request addressed to a private IP literal or
  blocked hostname. Documented residual: a public-DNS subresource host could
  rebind mid-session; the Lighthouse page runs without interception but only
  navigates the already-validated, IP-pinned homepage.
- Fresh headless browser per site: no profile, no persisted cookies, no
  extensions, downloads denied, bounded time budget. Never the operator's
  Chrome.
- GET/HEAD inspection only. No form submission, no clicks on communication
  actions, no CAPTCHA solving, no anti-bot evasion, no proxies.

## Crawl etiquette

- Honest identity: the real Chrome UA plus
  `SaltBoxWebsiteIntelligence/1.0 (+https://github.com/SasukeGabe777/SaltBox)`;
  plain HTTP checks use the bot token alone. No Googlebot/Chrome-user
  impersonation.
- robots.txt is fetched and applied to the ADDITIONAL automated pages
  (the homepage itself is one operator-triggered direct check). Supported:
  agent groups, Allow/Disallow, `*`, `$`, longest-match.
- Bounds: max 5 pages/site, max 25 link checks (sequential, 150 ms apart),
  navigation timeout 25 s, Lighthouse timeout 75 s, site budget 240 s.
- Batch: default 5 targets, hard max 25; concurrency default 1, max 2.

## Page selection (deterministic)

From same-site homepage links: `contact` → `services` (incl. trade keywords)
→ `about` → `locations` → shortest other internal page, capped at 5 total.
External links, mailto/tel, downloads, logins, checkout, and booking actions
are never followed. Selection reasons and URLs persist as evidence.

## What is measured

- **Lab metrics** (Lighthouse, mobile emulation — explicitly NOT CrUX/field
  data): performance, accessibility, SEO, best-practices scores; FCP, LCP,
  TBT, CLS, Speed Index; top accessibility audit failures (automated checks,
  not a WCAG compliance audit).
- **Mobile:** viewport meta, horizontal overflow, navigation presence.
- **Technical:** HTTPS, status/redirects, console/runtime errors, failed
  requests, mixed content, request count/bytes, favicon, robots.txt, sitemap.
- **SEO structure:** title/meta/canonical/robots meta, H1s and heading order,
  lang, Open Graph, JSON-LD presence + schema types, indexability.
- **Conversion:** tel/mailto links, contact page, contact form (markup-level:
  a form with fields + submit is recorded as present; it is never submitted,
  so actual delivery is unverified), quote/booking CTAs, visible address.
- **Content:** homepage word count, services/about presence, copyright year,
  Last-Modified header.
- **Link/asset health:** ≤25 internal links (working/redirect/broken/timeout/
  blocked), failed images/stylesheets/scripts with examples.
- **Platform:** conservative CMS fingerprints (WordPress, Wix, Squarespace,
  Shopify, Webflow, GoDaddy, Duda, Drupal, Joomla) with recorded evidence;
  `unknown` is a first-class answer.
- **Social links:** presence/URLs of major profiles; never crawled.

## Persistence (no schema migration)

- Source `website_intelligence` (type `crawl`) + one `source_record` per run.
- One `website_snapshot` per analyzed page; one versioned `website_analysis`
  per run with a bounded structured summary linked to exactly its snapshots.
- Typed observations, subject = website, namespaced:
  `website.performance.*`, `website.accessibility.*`, `website.seo.*`,
  `website.mobile.*`, `website.technical.*`, `website.links.*`,
  `website.assets.*`, `website.conversion.*`, `website.content.*`,
  `website.structured_data.*`, `website.platform.*`.
- Fatal target runs persist typed failure evidence under
  `website.technical.analysis_failure_*` (stage, kind, code, transient).
  This evidence describes one analysis attempt; it never changes the stored
  website identity or asserts that the business has no website.
- Screenshots + raw Lighthouse JSON live in the git-ignored
  `.data/website-intelligence/<run-ref>/`; the analysis stores only the
  relative reference. The admin serves them through a strictly validated
  read-only route.

## Failure model

`WEBSITE NEGATIVE SIGNAL` (404 page, broken link) is an observation.
`TARGET FAILURE` (DNS/TLS/unreachable/timeout/malformed target, or an
isolated Lighthouse/stage failure) persists the run and its available
evidence, does not stop other targets, and is prominent in the final target
list. `SYSTEM/BATCH FAILURE` (database/schema/configuration failure,
Chromium unavailable for every analyzable target, or an unrecoverable
exception) produces a failed batch and a non-zero process exit.

Every terminal batch has one explicit result:

- `completed`: selected targets reached terminal outcomes with no target
  analysis failures (a known no-website skip is not an analyzer failure).
- `completed_with_target_failures`: the batch itself completed and one or
  more targets/stages failed. Normal operator execution exits 0 so pnpm does
  not misreport the completed batch as an ELIFECYCLE failure.
- `failed`: the batch/system could not complete safely; exits non-zero.

`--strict` changes `completed_with_target_failures` to exit code 2 for CI
and debugging, without changing persistence or the displayed batch status.

DNS failures preserve resolver semantics where Node exposes them:
`EAI_AGAIN` (plus timeout/service/refused resolver errors) is recorded as
`dns_transient`; `ENOTFOUND`/`ENODATA` is recorded as
`dns_not_found`. A temporary DNS error is evidence about that attempt only
and is never converted into permanent "no website" evidence.

**Known limitation — bot protection:** some hosts serve challenge or
"Access Denied" pages to repeated same-hour automated visits. SaltBox records
whatever the site actually served (and the screenshot shows it) and never
evades the protection; re-analysis should be spaced by days. A challenge is
not treated as a verified website deficiency merely because it was observed.

## CLI

```text
pnpm website:intelligence --prospect <prospect-id>
pnpm website:intelligence --business <business-id>
pnpm website:intelligence --category roofing --limit 5
pnpm website:intelligence --status qualified --limit 10 --concurrency 2
pnpm website:intelligence --category roofing --limit 5 --strict
```

The Phase 7 `pnpm acquire` command attaches intelligence to discovery before
v2 scoring. This standalone command remains for targeted reruns and debugging.

## Testing

`pnpm test` is offline-deterministic: pure logic tests plus real-Chromium
integration tests against 127.0.0.1 fixture sites with a stubbed Lighthouse
runner. Real Lighthouse against real sites is a separately invoked smoke via
the CLI, never part of the normal suite.
