import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import { decideQualificationV2 } from "../src/decision/decide-v2.ts";
import { deriveQualificationFeaturesV2 } from "../src/features/derive-v2.ts";
import { calculateQualificationScoreV2 } from "../src/scoring/score-v2.ts";

test("v2 derives exact deep-intelligence features and weighted dimensions", () => {
  const result = intelligenceFixture({
    pages: [{
      url: "https://local-roofer.test/", finalUrl: "https://local-roofer.test/", role: "homepage",
      selectedBecause: "entry", httpStatus: 200, reachable: true, contentHash: "hash", title: null,
      wordCount: 30, consoleErrorCount: 3, failedRequestCount: 3,
    }],
    lab: {
      performance: 42, accessibility: 80, seo: 70, bestPractices: 65,
      firstContentfulPaintMs: 1800, largestContentfulPaintMs: 4500, totalBlockingTimeMs: 350,
      cumulativeLayoutShift: 0.3, speedIndexMs: 3000, accessibilityFailures: [],
    },
    mobile: { viewportMetaPresent: false, horizontalOverflow: true, contentWiderThanViewport: true, navigationPresent: false },
    technical: {
      https: false, httpStatus: 200, redirectChain: [], canonicalUrl: null, faviconPresent: false,
      mixedContentRequests: 0, consoleErrors: 3, consoleErrorExamples: [], failedRequests: 3,
      failedRequestExamples: [], requestCount: 10, transferredBytes: 1000, robotsTxtPresent: false, sitemapPresent: false,
    },
    seo: {
      titlePresent: false, titleLength: 0, metaDescriptionPresent: false, metaDescriptionLength: 0,
      canonicalPresent: false, robotsMeta: null, h1Count: 0, headingOrderValid: false, langPresent: false,
      openGraphPresent: false, structuredDataPresent: false, schemaTypes: [], indexable: true,
    },
    conversion: {
      phoneLinkPresent: false, emailLinkPresent: false, contactPagePresent: false, contactFormPresent: false,
      formFieldCount: 0, formHasSubmit: false, quoteCtaPresent: false, bookingCtaPresent: false,
      prominentCtaPresent: false, visibleAddressPresent: false,
    },
    content: { homepageWordCount: 30, servicesPagePresent: false, aboutPagePresent: false, copyrightYear: 2020, lastModifiedHeader: null },
    links: { checked: 8, working: 5, redirecting: 0, broken: 3, timedOut: 0, blocked: 0, brokenExamples: [] },
  });
  const features = deriveQualificationFeaturesV2(
    { name: "Local Roofer", category: "roofing", websiteUrl: result.websiteUrl, phone: "801-555-0100", email: "hello@test.local" },
    result,
    { currentYear: 2026, websiteAnalysisId: "analysis-1" },
  );
  assert.equal(features.values.performance_band, "weak");
  assert.equal(features.values.lcp_band, "poor");
  assert.equal(features.values.tbt_band, "needs_improvement");
  assert.equal(features.values.cls_band, "poor");
  assert.equal(features.values.technical_error_band, "high");
  assert.equal(features.values.broken_link_band, "meaningful");
  assert.equal(features.values.stale_copyright_band, "stale");
  assert.equal(features.values.shallow_site, true);
  const score = calculateQualificationScoreV2(features);
  assert.deepEqual(score.dimensions, { need: 100, value: 80, activity: 0, reachability: 65 });
  assert.equal(score.overall, 77);
  assert.equal(decideQualificationV2(features, score).resultCode, "qualified");
  assert.ok(score.components.every((component) => component.reasonCode && component.explanation));
});

test("dns_transient is target failure evidence but never permanent Need evidence", () => {
  const result = intelligenceFixture({
    fatal: {
      stage: "unreachable",
      message: "getaddrinfo EAI_AGAIN transient.test",
      failureKind: "dns_transient",
      code: "EAI_AGAIN",
      transient: true,
    },
  });
  const features = deriveQualificationFeaturesV2(
    { name: "Transient Roofing", category: "roofing", websiteUrl: result.websiteUrl, phone: "801-555-0101" },
    result,
  );
  const score = calculateQualificationScoreV2(features);
  assert.equal(features.intelligenceTransient, true);
  assert.equal(features.values.website_failure_kind, "dns_transient");
  assert.equal(score.dimensions.need, 0);
  assert.ok(score.components.some((component) => component.reasonCode === "TRANSIENT_INTELLIGENCE_FAILURE_NO_PENALTY"));
  assert.ok(!score.components.some((component) => component.reasonCode === "DNS_NOT_FOUND"));
  assert.ok(decideQualificationV2(features, score).reasons.some((reason) => reason.reasonCode === "TRANSIENT_INTELLIGENCE_RETRY_REQUIRED"));
});

test("confirmed DNS not found raises Need while strong non-target rules hard reject", () => {
  const missing = intelligenceFixture({
    fatal: { stage: "unreachable", message: "NXDOMAIN", failureKind: "dns_not_found", code: "ENOTFOUND", transient: false },
  });
  const eligibleFeatures = deriveQualificationFeaturesV2(
    { name: "Independent Roofing", category: "roofing", websiteUrl: missing.websiteUrl, phone: "801-555-0102" },
    missing,
  );
  assert.equal(calculateQualificationScoreV2(eligibleFeatures).dimensions.need, 75);

  const chainFeatures = deriveQualificationFeaturesV2(
    { name: "Home Depot Ogden", category: "roofing", websiteUrl: missing.websiteUrl, phone: "801-555-0103" },
    missing,
  );
  const chainDecision = decideQualificationV2(chainFeatures, calculateQualificationScoreV2(chainFeatures));
  assert.equal(chainFeatures.targetFit, "national_chain");
  assert.equal(chainDecision.resultCode, "rejected");
  assert.ok(chainDecision.reasons.some((reason) => reason.reasonCode === "NON_TARGET_NATIONAL_CHAIN"));
});

test("reachability uses genuine contact paths and policy hard rejects their absence or suppression", () => {
  const result = intelligenceFixture({
    conversion: {
      phoneLinkPresent: false, emailLinkPresent: false, contactPagePresent: true, contactFormPresent: true,
      formFieldCount: 3, formHasSubmit: true, quoteCtaPresent: true, bookingCtaPresent: false,
      prominentCtaPresent: true, visibleAddressPresent: false,
    },
  });
  const reachable = deriveQualificationFeaturesV2({ name: "Form Roofing", category: "roofing", websiteUrl: result.websiteUrl }, result);
  assert.equal(reachable.hasReachableContactPath, true);
  assert.equal(calculateQualificationScoreV2(reachable).dimensions.reachability, 40);

  const unreachable = deriveQualificationFeaturesV2({ name: "Silent Roofing", category: "roofing", websiteUrl: result.websiteUrl }, intelligenceFixture());
  assert.equal(decideQualificationV2(unreachable, calculateQualificationScoreV2(unreachable)).reasons.at(-1)?.reasonCode, "NO_REACHABLE_CONTACT_PATH");
  assert.equal(decideQualificationV2(reachable, calculateQualificationScoreV2(reachable), { activeSuppressionIds: ["suppression-1"] }).reasons.at(-1)?.reasonCode, "ACTIVE_SUPPRESSION");
});

test("policy threshold is inclusive and target-fit rules remain narrow and deterministic", () => {
  const features = deriveQualificationFeaturesV2(
    { name: "Current Local Roofing", category: "roofing", websiteUrl: "https://current.test/", phone: "801-555-0104" },
    intelligenceFixture({
      pages: [
        { url: "https://current.test/", finalUrl: "https://current.test/", role: "homepage", selectedBecause: "entry", httpStatus: 200, reachable: true, contentHash: "h", title: "Home", wordCount: 20, consoleErrorCount: 0, failedRequestCount: 0 },
        { url: "https://current.test/contact", finalUrl: "https://current.test/contact", role: "contact", selectedBecause: "contact", httpStatus: 200, reachable: true, contentHash: "c", title: "Contact", wordCount: 20, consoleErrorCount: 0, failedRequestCount: 0 },
        { url: "https://current.test/services", finalUrl: "https://current.test/services", role: "services", selectedBecause: "services", httpStatus: 200, reachable: true, contentHash: "s", title: "Services", wordCount: 20, consoleErrorCount: 0, failedRequestCount: 0 },
      ],
      content: { homepageWordCount: 20, servicesPagePresent: true, aboutPagePresent: false, copyrightYear: 2026, lastModifiedHeader: null },
    }),
    { currentYear: 2026 },
  );
  assert.equal(calculateQualificationScoreV2(features).dimensions.activity, 70);
  const baseScore = calculateQualificationScoreV2(features);
  assert.equal(decideQualificationV2(features, { ...baseScore, overall: 60 }).resultCode, "qualified");
  assert.equal(decideQualificationV2(features, { ...baseScore, overall: 59 }).resultCode, "rejected");

  assert.equal(deriveQualificationFeaturesV2({ name: "City of Ogden Public Works", category: "roofing", phone: "1" }, null).targetFit, "government");
  assert.equal(deriveQualificationFeaturesV2({ name: "Wasatch Roofing Supply", category: "roofing", phone: "1" }, null).targetFit, "supplier_manufacturer");
  assert.equal(deriveQualificationFeaturesV2({ name: "Ogden School District", category: "roofing", phone: "1" }, null).targetFit, "education");
});

test("a website that refuses automated analysis is never scored as a deficient site", () => {
  const result = intelligenceFixture({
    fatal: {
      stage: "access_denied",
      message: 'homepage answered HTTP 403 ("403 Forbidden") to automated analysis',
      failureKind: "access_denied",
      transient: false,
    },
  });
  const features = deriveQualificationFeaturesV2(
    { name: "Blocked Plumbing", category: "plumbing", websiteUrl: result.websiteUrl, phone: "801-555-0101", email: "a@b.test" },
    result,
  );
  const score = calculateQualificationScoreV2(features);
  const decision = decideQualificationV2(features, score);
  assert.equal(decision.resultCode, "rejected");
  assert.ok(decision.reasons.some((reason) => reason.reasonCode === "WEBSITE_BLOCKS_AUTOMATED_ANALYSIS"));
  assert.ok(!score.components.some((component) => component.reasonCode === "CTA_MISSING"), "no invented deficiencies");
});

test("franchise brands, brand location pages, and trade suppliers are not target fits", () => {
  const fit = (name: string, websiteUrl?: string) =>
    deriveQualificationFeaturesV2({ name, category: "roofing", phone: "1", ...(websiteUrl ? { websiteUrl } : {}) }, null).targetFit;
  assert.equal(fit("Weed Man Lawn Care"), "national_chain");
  assert.equal(fit("DaBella"), "national_chain");
  assert.equal(fit("Acme Lawn Co", "https://www.acmelawn.com/en-us/ogden"), "national_chain");
  assert.equal(fit("Some Roofing", "https://brand.example/location/ogden-ut/"), "national_chain");
  assert.equal(fit("Roofers Supply"), "supplier_manufacturer");
  assert.equal(fit("Standard Plumbing Supply"), "supplier_manufacturer");
  assert.equal(fit("Riverfront Roofing", "https://riverfront-roofing.com/"), "eligible");
  assert.equal(fit("Riverfront Roofing", "https://riverfront-roofing.com/services/roof-repair"), "eligible", "deep service pages are fine");
  assert.equal(fit("Carpenter Furnace Company", "https://www.carpenterfurnace.com/"), "eligible");
});

function intelligenceFixture(overrides: Partial<WebsiteIntelligenceResult> = {}): WebsiteIntelligenceResult {
  return {
    analyzerVersion: "website-intelligence-v1",
    websiteUrl: "https://fixture.test/",
    finalHomepageUrl: "https://fixture.test/",
    startedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:01.000Z",
    durationMs: 1000,
    pages: [],
    stages: {
      homepage: { status: "ok" }, pageSelection: { status: "ok" }, subPages: { status: "ok" },
      lighthouse: { status: "skipped" }, mobile: { status: "ok" }, linkHealth: { status: "ok" }, screenshots: { status: "skipped" },
    },
    lab: null,
    mobile: null,
    technical: null,
    seo: null,
    conversion: null,
    content: null,
    links: null,
    assets: null,
    platform: null,
    social: null,
    artifacts: null,
    ...overrides,
  };
}

test("2.2.0: a site that calls itself a supplier is a supplier, whatever its name", () => {
  const content = (leadHeadings: string[]) => ({
    homepageWordCount: 400, servicesPagePresent: true, aboutPagePresent: true, copyrightYear: null, lastModifiedHeader: null, leadHeadings,
  });
  const jerrys = intelligenceFixture({ content: content(["Ogden's Oldest Independent Plumbing Supplier", "In-Stock Guarantee"]) });
  assert.equal(
    deriveQualificationFeaturesV2({ name: "Jerry's Plumbing Specialties", category: "plumbing", phone: "1", websiteUrl: "https://jps.test/" }, jerrys).targetFit,
    "supplier_manufacturer",
  );
  const contractor = intelligenceFixture({ content: content(["Fast! Friendly! Froggy!", "Our Plumbing Services"]) });
  assert.equal(
    deriveQualificationFeaturesV2({ name: "JC Plumbing LLC", category: "plumbing", phone: "1", websiteUrl: "https://froggy.test/" }, contractor).targetFit,
    "eligible",
  );
});

test("2.2.0: only substantial real-phone overflow scores as a mobile problem", () => {
  const mobile = (scroll: number) => ({
    viewportMetaPresent: true, horizontalOverflow: true, contentWiderThanViewport: true, navigationPresent: true,
    emulatedMobileDevice: true, overflowVerifiedAsPlainDevice: true, mobileScrollWidth: scroll, mobileClientWidth: 390,
  });
  const input = { name: "Some HVAC", category: "hvac", phone: "1", websiteUrl: "https://hvac.test/" };
  assert.equal(deriveQualificationFeaturesV2(input, intelligenceFixture({ mobile: mobile(405) })).values["mobile_overflow"], false);
  assert.equal(deriveQualificationFeaturesV2(input, intelligenceFixture({ mobile: mobile(980) })).values["mobile_overflow"], true);
});

test("2.3.0: commercial-only contractors are not a fit; mixed or residential ones are", () => {
  const withHeadings = (leadHeadings: string[]) => intelligenceFixture({
    content: { homepageWordCount: 400, servicesPagePresent: true, aboutPagePresent: true, copyrightYear: null, lastModifiedHeader: null, leadHeadings },
  });
  const fit = (headings: string[]) =>
    deriveQualificationFeaturesV2({ name: "Some Electric", category: "electrical", phone: "1", websiteUrl: "https://e.test/" }, withHeadings(headings)).targetFit;
  assert.equal(fit(["Utah's Commercial Electrical Contractor", "Our Commercial Electrical Projects"]), "commercial_only");
  assert.equal(fit(["Commercial & Residential Roofing"]), "eligible");
  assert.equal(fit(["Electricians for Salt Lake City Homes"]), "eligible");
  assert.equal(fit(["Fast! Friendly! Froggy!"]), "eligible");
});
