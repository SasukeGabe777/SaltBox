# Website Intelligence Benchmark — Phase 6

- **Date:** 2026-08-26
- **Analyzer:** `website-intelligence-v1` (puppeteer 25 / Chrome for Testing 152 + Lighthouse 13, mobile-emulated lab runs)
- **Sample:** 15 real SaltBox businesses with websites (roofing, plumbing, restaurant/coffee) plus 8 no-website prospects, drawn from the Phase 5B/5C discoveries. Qualification scores/decisions are unchanged `qualification-v1` outputs — **no scoring was tuned from this table.**

Lab values are Lighthouse laboratory measurements under mobile emulation, not
real-user Core Web Vitals. "Form/CTA" are markup-level detections; forms are
never submitted.

## Results (best complete run per business)

| Business | Cat | Qual score | Decision | Perf | A11y | SEO | LCP (lab) | Mobile ovf | Broken links | Console err | Contact form | Quote CTA | Platform | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Utah Roof and Solar | roofing | 86 | qualified | 86 | 83 | 73 | 4.0s | no | 0/1 | 4 | no | no | GoDaddy | complete |
| Riverfront Roofing | roofing | 70 | qualified | 61 | 93 | 100 | 7.7s | no | 0/25 | 0 | yes | no | — | complete |
| Lomeli Exterior Solutions | roofing | 56 | rejected | 85 | 95 | 100 | 4.3s | no | 0/6 | 0 | yes | yes | — | complete |
| Legacy Roofing | roofing | 42 | rejected | 67 | 95 | 100 | 3.7s | no | 0/25 | 1 | yes | yes | — | complete |
| Roofers Supply | roofing | 56 | rejected | 32 | — | — | 24.5s | no | 0/25 | 3 | no | no | — | partial |
| DaBella | roofing | 34 | rejected | 25 | 84 | 92 | 18.8s | no | 0/25 | 10 | yes | yes | WordPress | complete |
| Black Diamond Rain Gutter | roofing | 34 | rejected | — | — | — | — | — | — | — | — | — | — | unreachable |
| Bear Creek Roofing | roofing | 58 | rejected | — | — | — | — | — | — | — | — | — | — | unreachable (DNS SERVFAIL) |
| JC Plumbing LLC | plumbing | 74 | qualified | 76 | 100 | 92 | 4.9s | **YES** | 0/0 | 0 | no | no | Wix | complete |
| Standard Plumbing Supply | plumbing | 80 | qualified | — | — | — | — | no | 0/1 | 3 | no | no | — | partial |
| Vargas Brothers Plumbing | plumbing | 64 | qualified | — | — | — | — | no | 0/0 | 5 | no | no | — | partial |
| Mike Bachman Plumbing | plumbing | 42 | rejected | 48 | 79 | 85 | 11.6s | no | 0/25 | 4 | yes | yes | WordPress | complete |
| Pitcher Plumbing | plumbing | 58 | rejected | — | — | — | — | no | 0/14 | 0 | yes | yes | Squarespace | partial |
| Ruby River | restaurant | 32 | rejected | 59 | 87 | 100 | 8.3s | no | 0/6 | 6 | no | no | WordPress | complete |
| Starbucks (chain locator) | restaurant | 46 | rejected | 31 | 100 | 100 | 14.4s | no | 0/25 | 0 | no | no | — | complete |

No-website prospects (Beans & Brews, Sapori, Scooter's Coffee, Pizza Hut*,
ABC Mandarin, Dolittle's Deli, Javier's, Wasatch Flow fixture) reported
`NO WEBSITE TO ANALYZE` cleanly (\*Pizza Hut fell outside the batch limit).
The two 127.0.0.1 fixture prospects were **blocked by the SSRF boundary**, as
designed. Copyright years: Utah Roof and Solar shows **© 1999**; most others
show 2025/2026.

## Runtime

| Batch | Sites | Avg | Median | Slowest | Complete/Partial/Failed |
| --- | --- | --- | --- | --- | --- |
| roofing (conc. 2) | 9 | 42.3s | 52.8s | 79.8s | 5 / 2 / 2 |
| plumbing (conc. 2) | 5 | 24.1s | 19.9s | 48.2s | 3 / 2 / 0 |
| restaurant (conc. 2) | 3 | 90.4s | 101.0s | 139.8s | 1 / 2 / 0 |

Roughly ~45s/site typical (Lighthouse dominates); heavy corporate sites run
100–140s. Local resource use: two headless Chromes + Lighthouse peak around
1.5–2 GB RAM combined — automatic per-discovery enrichment is plausible later
but should stay operator-triggered until repeat-visit etiquette (below) is
addressed.

## Observations only — no tuning performed

**Interesting patterns**

- **Phase 4's "need" heuristics invert against deep evidence in several
  cases.** Lomeli (rejected, 56) has an objectively strong site: perf 85,
  a11y 95, SEO 100, LCP 4.3s, contact form AND quote CTA. Meanwhile qualified
  Utah Roof and Solar (86) has NO contact form, NO CTA, SEO 73 — and a
  **© 1999 copyright** — a far better "needs help" candidate than its
  qualification suggests.
- **Slow-and-broken is measurable now:** DaBella's LCP is 18.8s with 10
  console errors; Roofers Supply's LCP is 24.5s. Phase 4 could not see any of
  this — both simply "had a website".
- **Mobile overflow exists in the wild:** JC Plumbing (Wix) overflows
  horizontally on a phone — a concrete pitch-able defect.
- **Chain/supplier detection matters:** Starbucks' locator page and Roofers
  Supply (a supplier, not a contractor) look nothing like owner-operated
  small-business sites; a11y/SEO 100 + perf ~31 is a big-brand signature.
- **Dead web presences are real:** Bear Creek's domain SERVFAILs at DNS —
  a business Overture lists whose site is effectively gone. Genuinely
  valuable "need" evidence.

**Promising signals for a future scoring v2** (evidence-based, not yet used):
Lighthouse performance / LCP; contact-form + quote-CTA presence (direct
conversion-readiness); mobile horizontal overflow; console-error count;
copyright-year staleness; unreachable/dead-domain status; platform (builder
sites correlate with the "weak site" segment SaltBox targets).

**Noisy / weak signals in this sample:** broken internal links (0 across
every site — modern builders rarely ship broken nav links; may only matter on
old hand-made sites); failed-asset counts (near-zero, and intermittent
third-party trackers dominate); robots/sitemap presence (uniform); schema
types (sparse among small businesses); "visible address" regex (misses
address-in-image/footer-widget cases).

**Operational finding — repeat-visit etiquette:** a third same-hour visit to
one GoDaddy-hosted site returned "Access Denied" pages (bot protection
reacting to repeated automated visits; the honest bot UA is kept and nothing
is evaded). Several rerun rows above are "partial" for this reason: the
FIRST visit of the day produces the best data. Future automation must space
re-analysis by days, not minutes — another reason enrichment stays manual in
Phase 6.

**Data quirks:** the same Starbucks location exists as two prospects (same
website; pre-dedupe discovery rows), and supplier businesses appear under
trade categories (already noted in the Phase 5C report).
