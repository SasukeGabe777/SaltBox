import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail } from "@saltbox/database/queries/admin";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import { discoverAndAcquireV2 } from "../src/application/acquire-v2.ts";
import type { DiscoveryBatch, DiscoveryQuery, DiscoveryResult, DiscoverySourceAdapter, ResolvedLocation } from "../src/types.ts";

test("full v2 acquisition isolates target failures and persists admin-readable results", async () => {
  const ctx = await createTestDatabase();
  const adapter = new FixtureAdapter([
    candidate("good", "Good Local Roofing", "https://good.test/"),
    candidate("transient", "Transient Local Roofing", "https://transient.test/"),
    candidate("not-found", "Missing Domain Roofing", "https://not-found.test/"),
  ]);
  try {
    const run = await discoverAndAcquireV2(
      ctx.db,
      { category: "roofing", location: "Ogden, UT", radiusKm: 10, limit: 3, source: adapter.source },
      adapter,
      {
        concurrency: 2,
        currentYear: 2026,
        analyze: async (url) => {
          const target = url ?? "";
          if (target.includes("transient")) return fatalResult(target, "dns_transient", "EAI_AGAIN", true);
          if (target.includes("not-found")) return fatalResult(target, "dns_not_found", "ENOTFOUND", false);
          return completeResult(target);
        },
      },
    );
    assert.equal(run.status, "completed_with_target_failures");
    assert.deepEqual(
      { discovered: run.discovered, analyzed: run.analyzed, targetFailures: run.targetFailures, systemFailures: run.systemFailures },
      { discovered: 3, analyzed: 3, targetFailures: 2, systemFailures: 0 },
    );
    assert.ok(run.results.every((result) => result.status === "completed"));
    const transient = run.results.find((result) => result.candidate.externalId === "transient");
    assert.equal(transient?.status, "completed");
    if (transient?.status === "completed") {
      assert.equal(transient.outcome.intelligenceTransient, true);
      assert.ok(transient.outcome.reasons.includes("TRANSIENT_INTELLIGENCE_FAILURE_NO_PENALTY"));
      assert.ok(transient.outcome.reasons.includes("TRANSIENT_INTELLIGENCE_RETRY_REQUIRED"));
      assert.ok(!transient.outcome.reasons.includes("DNS_NOT_FOUND"));
      assert.equal(transient.outcome.lifecycleState, "evaluated");
    }
    for (const result of run.results) {
      if (result.status !== "completed") continue;
      const detail = await getProspectDetail(ctx.db, result.outcome.prospectId);
      assert.equal(detail?.scoreHistory[0]?.scoringVersion, "qualification-v2");
      assert.equal(detail?.scoreHistory[0]?.decisions[0]?.policyVersion, "qualification-policy-v2");
      assert.equal(detail?.scoreHistory[0]?.websiteAnalysis?.id, result.outcome.websiteAnalysisId);
    }
  } finally {
    await ctx.destroy();
  }
});

test("global Chromium initialization failure is a failed batch", async () => {
  const ctx = await createTestDatabase();
  const adapter = new FixtureAdapter([candidate("browser", "Browser Fixture Roofing", "https://browser.test/")]);
  try {
    const run = await discoverAndAcquireV2(
      ctx.db,
      { category: "roofing", location: "Ogden, UT", limit: 1, source: adapter.source },
      adapter,
      { analyze: async (url) => ({ ...fatalResult(url ?? "", "browser_unavailable", "CHROME_LAUNCH", false), fatal: { stage: "browser_unavailable", message: "Chromium launch failed", failureKind: "browser_unavailable", code: "CHROME_LAUNCH", transient: false } }) },
    );
    assert.equal(run.status, "failed");
    assert.equal(run.systemFailures, 0);
  } finally {
    await ctx.destroy();
  }
});

class FixtureAdapter implements DiscoverySourceAdapter {
  readonly source = "acquire_v2_fixture";
  readonly adapterVersion = "acquire-v2-fixture-v1";
  private readonly candidates: DiscoveryResult[];
  constructor(candidates: DiscoveryResult[]) { this.candidates = candidates; }
  async resolveLocation(location: string): Promise<ResolvedLocation> {
    return { query: location, displayName: "Ogden, Utah", latitude: 41.223, longitude: -111.974, city: "Ogden", state: "Utah", countryCode: "us", sourceLocator: "fixture://ogden" };
  }
  async discover(query: DiscoveryQuery, location: ResolvedLocation): Promise<DiscoveryBatch> {
    return { query, location, source: this.source, adapterVersion: this.adapterVersion, sourceDataTimestamp: "2026-08-27T12:00:00Z", candidates: this.candidates.slice(0, query.limit) };
  }
}

function candidate(externalId: string, name: string, websiteUrl: string): DiscoveryResult {
  const phoneSuffix = externalId === "good" ? "01" : externalId === "transient" ? "02" : "03";
  return {
    source: "acquire_v2_fixture", sourceType: "manual", sourceDescription: "Controlled v2 integration fixture", sourceRetentionClass: "test",
    externalId, name, category: "roofing", latitude: 41.22, longitude: -111.97, street: null, city: "Ogden", state: "Utah", postalCode: null,
    phone: `+1 801 555 01${phoneSuffix}`, email: null, websiteUrl,
    sourceLocator: `fixture://${externalId}`, retrievedAt: "2026-08-27T12:00:00.000Z", contentHash: externalId.padEnd(64, "0").slice(0, 64), metadata: { category: "roofing" },
  };
}

function baseResult(url: string): WebsiteIntelligenceResult {
  return {
    analyzerVersion: "website-intelligence-v1", websiteUrl: url, finalHomepageUrl: null,
    startedAt: "2026-08-27T12:00:00.000Z", completedAt: "2026-08-27T12:00:01.000Z", durationMs: 1000,
    pages: [], stages: { homepage: { status: "failed" }, pageSelection: { status: "skipped" }, subPages: { status: "skipped" }, lighthouse: { status: "skipped" }, mobile: { status: "skipped" }, linkHealth: { status: "skipped" }, screenshots: { status: "skipped" } },
    lab: null, mobile: null, technical: null, seo: null, conversion: null, content: null, links: null, assets: null, platform: null, social: null, artifacts: null,
  };
}

function fatalResult(url: string, failureKind: "dns_transient" | "dns_not_found" | "browser_unavailable", code: string, transient: boolean): WebsiteIntelligenceResult {
  return { ...baseResult(url), fatal: { stage: failureKind === "browser_unavailable" ? "browser_unavailable" : "unreachable", message: `${failureKind} fixture`, failureKind, code, transient } };
}

function completeResult(url: string): WebsiteIntelligenceResult {
  return {
    ...baseResult(url), finalHomepageUrl: url,
    pages: [{ url, finalUrl: url, role: "homepage", selectedBecause: "entry", httpStatus: 200, reachable: true, contentHash: "hash", title: "Roofing", wordCount: 30, consoleErrorCount: 0, failedRequestCount: 0 }],
    stages: { homepage: { status: "ok" }, pageSelection: { status: "ok" }, subPages: { status: "ok" }, lighthouse: { status: "ok" }, mobile: { status: "ok" }, linkHealth: { status: "ok" }, screenshots: { status: "skipped" } },
    lab: { performance: 35, accessibility: 75, seo: 60, bestPractices: 65, firstContentfulPaintMs: 1500, largestContentfulPaintMs: 4200, totalBlockingTimeMs: 300, cumulativeLayoutShift: 0.2, speedIndexMs: 2500, accessibilityFailures: [] },
    mobile: { viewportMetaPresent: false, horizontalOverflow: true, contentWiderThanViewport: true, navigationPresent: false },
    technical: { https: true, httpStatus: 200, redirectChain: [], canonicalUrl: null, faviconPresent: false, mixedContentRequests: 0, consoleErrors: 2, consoleErrorExamples: [], failedRequests: 1, failedRequestExamples: [], requestCount: 12, transferredBytes: 1000, robotsTxtPresent: false, sitemapPresent: false },
    seo: { titlePresent: true, titleLength: 7, metaDescriptionPresent: false, metaDescriptionLength: 0, canonicalPresent: false, robotsMeta: null, h1Count: 1, headingOrderValid: true, langPresent: false, openGraphPresent: false, structuredDataPresent: false, schemaTypes: [], indexable: true },
    conversion: { phoneLinkPresent: true, emailLinkPresent: false, contactPagePresent: false, contactFormPresent: false, formFieldCount: 0, formHasSubmit: false, quoteCtaPresent: false, bookingCtaPresent: false, prominentCtaPresent: false, visibleAddressPresent: false },
    content: { homepageWordCount: 30, servicesPagePresent: false, aboutPagePresent: false, copyrightYear: 2020, lastModifiedHeader: null },
    links: { checked: 6, working: 4, redirecting: 0, broken: 2, timedOut: 0, blocked: 0, brokenExamples: [] },
  };
}
