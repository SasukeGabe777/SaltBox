/**
 * Controlled Phase 4 fixtures. These exist ONLY for tests and the local
 * developer runner; nothing seeds them into a shared or production database.
 *
 * Fixtures with `html` are served from an ephemeral local HTTP server by the
 * runner/tests (which is also why their sites are plain HTTP — the missing-
 * HTTPS need signal on those fixtures is expected and deterministic).
 */

import type { ControlledBusinessInput } from "../ingestion/ingest.ts";

export interface QualificationFixture {
  key: string;
  description: string;
  /** Input WITHOUT websiteUrl when html is provided — the runner injects the local URL. */
  input: Omit<ControlledBusinessInput, "websiteUrl"> & { websiteUrl?: string };
  /** Deterministic HTML served by a local test server. */
  html?: string;
  expectedDecision: "qualified" | "rejected";
}

/** Bare-bones site: title only — no viewport, meta description, form, or CTA. */
export const POOR_SITE_HTML = `<!doctype html>
<html>
<head><title>Summit Ridge Roofing</title></head>
<body>
  <h1>Summit Ridge Roofing</h1>
  <p>We do roofs. Established 2009.</p>
  <p>&copy; 2019 Summit Ridge Roofing</p>
</body>
</html>`;

/** Healthy site: viewport, meta description, contact form, CTA, email, phone. */
export const GOOD_SITE_HTML = `<!doctype html>
<html>
<head>
  <title>Golden Crumb Bakery — Fresh Daily</title>
  <meta name="description" content="Artisan breads and pastries baked fresh every morning in Ogden, Utah.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <h1>Golden Crumb Bakery</h1>
  <a class="btn" href="/order">Order fresh bread today</a>
  <form action="/contact" method="post">
    <input type="text" name="name">
    <input type="email" name="email">
    <textarea name="message"></textarea>
    <button type="submit">Contact us</button>
  </form>
  <p>Call <a href="tel:+18015550188">(801) 555-0188</a> or email
     <a href="mailto:hello@goldencrumb.example">hello@goldencrumb.example</a></p>
  <p>&copy; 2026 Golden Crumb Bakery</p>
</body>
</html>`;

export const FIXTURES: readonly QualificationFixture[] = [
  {
    key: "roofing-good",
    description: "Strong target: active high-value service business with a poor website.",
    input: {
      name: "Summit Ridge Roofing",
      phone: "(801) 555-0142",
      email: "office@summitridgeroofing.example",
      city: "Ogden",
      state: "UT",
      industry: "roofing",
      source: "manual_fixture",
      externalId: "fixture-roofing-001",
    },
    html: POOR_SITE_HTML,
    expectedDecision: "qualified",
  },
  {
    key: "bakery-strong-site",
    description: "Weak target: low-value industry with a healthy website (low need).",
    input: {
      name: "Golden Crumb Bakery",
      phone: "(801) 555-0188",
      email: "hello@goldencrumb.example",
      city: "Ogden",
      state: "UT",
      industry: "bakery",
      source: "manual_fixture",
      externalId: "fixture-bakery-001",
    },
    html: GOOD_SITE_HTML,
    expectedDecision: "rejected",
  },
  {
    key: "plumbing-broken-site",
    description: "Broken website: DNS failure recorded as an observation; pipeline completes.",
    input: {
      name: "Wasatch Flow Plumbing",
      websiteUrl: "https://wasatch-flow-plumbing.invalid/",
      phone: "(801) 555-0170",
      email: "service@wasatchflow.example",
      city: "Ogden",
      state: "UT",
      industry: "plumbing",
      source: "manual_fixture",
      externalId: "fixture-plumbing-001",
    },
    expectedDecision: "qualified",
  },
  {
    key: "landscaping-no-website",
    description: "No website at all: the classic SaltBox target profile.",
    input: {
      name: "Bench View Landscaping",
      phone: "(801) 555-0129",
      email: "crew@benchviewlandscaping.example",
      city: "Ogden",
      state: "UT",
      industry: "landscaping",
      source: "manual_fixture",
      externalId: "fixture-landscaping-001",
    },
    expectedDecision: "qualified",
  },
  {
    key: "gallery-no-contact",
    description: "No contact path: rejected regardless of score (NO_CONTACT_PATH).",
    input: {
      name: "Quiet Wall Gallery",
      city: "Ogden",
      state: "UT",
      industry: "art_gallery",
      source: "manual_fixture",
      externalId: "fixture-gallery-001",
    },
    html: POOR_SITE_HTML,
    expectedDecision: "rejected",
  },
];

export function getFixture(key: string): QualificationFixture | undefined {
  return FIXTURES.find((fixture) => fixture.key === key);
}
