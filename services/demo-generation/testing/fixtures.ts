/**
 * Shared Phase 10 test fixtures: a deterministic "weak site" intelligence
 * result and a helper that seeds a genuinely qualified-v2 prospect through
 * the real pipeline (no hand-written qualification rows).
 */

import type { TestDatabase } from "@saltbox/database/testing/harness";
import { qualifyBusinessV2 } from "@saltbox/qualification/pipeline";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import type { DemoQaCheck, DemoQaReport } from "../src/qa.ts";

export function weakSiteIntelligence(url: string): WebsiteIntelligenceResult {
  return {
    analyzerVersion: "website-intelligence-v1",
    websiteUrl: url,
    finalHomepageUrl: url,
    startedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:58.000Z",
    durationMs: 58_000,
    pages: [
      {
        url,
        finalUrl: url,
        role: "homepage",
        selectedBecause: "entry",
        httpStatus: 200,
        reachable: true,
        contentHash: "home",
        title: null,
        wordCount: 70,
        consoleErrorCount: 4,
        failedRequestCount: 11,
      },
    ],
    stages: {
      homepage: { status: "ok" },
      pageSelection: { status: "ok" },
      subPages: { status: "ok" },
      lighthouse: { status: "ok" },
      mobile: { status: "ok" },
      linkHealth: { status: "ok" },
      screenshots: { status: "skipped" },
    },
    lab: {
      performance: 73,
      accessibility: 83,
      seo: 73,
      bestPractices: 73,
      firstContentfulPaintMs: 1760,
      largestContentfulPaintMs: 3895,
      totalBlockingTimeMs: 96,
      cumulativeLayoutShift: 0.27,
      speedIndexMs: 1760,
      accessibilityFailures: [],
    },
    mobile: {
      viewportMetaPresent: true,
      horizontalOverflow: false,
      contentWiderThanViewport: false,
      navigationPresent: false,
    },
    technical: {
      https: true,
      httpStatus: 200,
      redirectChain: [],
      canonicalUrl: null,
      faviconPresent: true,
      mixedContentRequests: 0,
      consoleErrors: 4,
      consoleErrorExamples: [],
      failedRequests: 11,
      failedRequestExamples: [],
      requestCount: 68,
      transferredBytes: 940_537,
      robotsTxtPresent: true,
      sitemapPresent: true,
    },
    seo: {
      titlePresent: false,
      titleLength: 0,
      metaDescriptionPresent: false,
      metaDescriptionLength: 0,
      canonicalPresent: false,
      robotsMeta: null,
      h1Count: 0,
      headingOrderValid: true,
      langPresent: true,
      openGraphPresent: false,
      structuredDataPresent: false,
      schemaTypes: [],
      indexable: true,
    },
    conversion: {
      phoneLinkPresent: false,
      emailLinkPresent: false,
      contactPagePresent: false,
      contactFormPresent: false,
      formFieldCount: 0,
      formHasSubmit: false,
      quoteCtaPresent: false,
      bookingCtaPresent: false,
      prominentCtaPresent: false,
      visibleAddressPresent: false,
    },
    content: {
      homepageWordCount: 70,
      servicesPagePresent: false,
      aboutPagePresent: false,
      copyrightYear: 1999,
      lastModifiedHeader: null,
    },
    links: { checked: 1, working: 1, redirecting: 0, broken: 0, timedOut: 0, blocked: 0, brokenExamples: [] },
    assets: { failedImages: 0, failedStylesheets: 0, failedScripts: 0, otherFailed: 11, examples: [] },
    platform: { platform: "GoDaddy Website Builder", confidence: "medium", evidence: [] },
    social: { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, googleMaps: null, other: [] },
    artifacts: null,
  };
}

export async function seedQualifiedProspect(
  ctx: TestDatabase,
  name: string,
  externalId: string,
  phone = "+1 801 555 0123",
) {
  const url = `https://${externalId}.test/`;
  return qualifyBusinessV2(
    ctx.db,
    {
      name,
      source: "demo_lifecycle_fixture",
      externalId,
      industry: "roofing",
      websiteUrl: url,
      phone,
      email: `hello@${externalId}.test`,
      sourceMetadata: { city: "Ogden", state: "UT", street: "238 25th St #5", postalCode: "84401" },
    },
    { analyze: async () => weakSiteIntelligence(url), currentYear: 2026 },
  );
}

const QA_CHECK_NAMES = [
  "HTTP 200",
  "no horizontal overflow",
  "hero section present",
  "services section present",
  "contact section present",
  "CTA visible",
  "contact path present",
  "brand mark renders",
  "all images load",
  "services visible",
  "demo disclosure present",
  "noindex directive",
  "no external scripts",
  "no console errors",
] as const;

/** A complete QA report, optionally failing named checks on both viewports. */
export function qaReport(demoVersionId: string, locatorToken: string, failing: string[] = []): DemoQaReport {
  const checks: DemoQaCheck[] = [];
  for (const viewport of ["desktop", "mobile"]) {
    for (const name of QA_CHECK_NAMES) {
      checks.push({ viewport, name, passed: !failing.includes(name) });
    }
  }
  return {
    runnerVersion: "demo-qa-v2",
    demoVersionId,
    locatorToken,
    checks,
    artifactRef: `demos/qa/${locatorToken}`,
    startedAt: "2026-08-27T13:00:00.000Z",
    completedAt: "2026-08-27T13:00:30.000Z",
  };
}
