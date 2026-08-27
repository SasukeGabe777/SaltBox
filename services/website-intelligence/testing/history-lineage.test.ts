/**
 * Persistence history/lineage tests (no browser): every intelligence run is
 * append-only, references only its own snapshots, and never cross-attributes
 * evidence between different websites/prospects — the regression class found
 * during Phase 5A.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail } from "@saltbox/database/queries/admin";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import { htmlHandler, serveLocalSite } from "../../prospecting/testing/fixture-server.ts";
import { qualifyBusiness } from "../../prospecting/pipeline/qualify.ts";
import { createBusiness } from "@saltbox/database/repositories/businesses";
import { openProspect } from "@saltbox/database/repositories/prospects";
import { ensureBusinessWebsite, ensureDomain } from "@saltbox/database/repositories/websites";
import { persistIntelligenceRun } from "../src/persist.ts";
import type { WebsiteIntelligenceResult } from "../src/types.ts";
import { WEBSITE_INTELLIGENCE_VERSION } from "../src/version.ts";

function syntheticResult(input: {
  websiteUrl: string;
  startedAt: string;
  pages: string[];
  performance: number;
}): WebsiteIntelligenceResult {
  const ok = { status: "ok" as const };
  return {
    analyzerVersion: WEBSITE_INTELLIGENCE_VERSION,
    websiteUrl: input.websiteUrl,
    finalHomepageUrl: input.websiteUrl,
    startedAt: input.startedAt,
    completedAt: input.startedAt,
    durationMs: 1234,
    pages: input.pages.map((url, index) => ({
      url,
      finalUrl: url,
      role: index === 0 ? "homepage" : "other",
      selectedBecause: index === 0 ? "entry page" : "additional internal page",
      httpStatus: 200,
      reachable: true,
      contentHash: `hash-${index}-${input.performance}`,
      title: `Page ${index}`,
      wordCount: 100 + index,
      consoleErrorCount: 0,
      failedRequestCount: 0,
    })),
    stages: { homepage: ok, pageSelection: ok, subPages: ok, lighthouse: ok, mobile: ok, linkHealth: ok, screenshots: { status: "skipped" } },
    lab: {
      performance: input.performance,
      accessibility: 90,
      seo: 80,
      bestPractices: 70,
      firstContentfulPaintMs: 1000,
      largestContentfulPaintMs: 2000,
      totalBlockingTimeMs: 100,
      cumulativeLayoutShift: 0.01,
      speedIndexMs: 1500,
      accessibilityFailures: [],
    },
    mobile: { viewportMetaPresent: true, horizontalOverflow: false, contentWiderThanViewport: false, navigationPresent: true },
    technical: {
      https: false,
      httpStatus: 200,
      redirectChain: [],
      canonicalUrl: null,
      faviconPresent: false,
      mixedContentRequests: 0,
      consoleErrors: 0,
      consoleErrorExamples: [],
      failedRequests: 0,
      failedRequestExamples: [],
      requestCount: 5,
      transferredBytes: 10_000,
      robotsTxtPresent: false,
      sitemapPresent: null,
    },
    seo: {
      titlePresent: true,
      titleLength: 10,
      metaDescriptionPresent: false,
      metaDescriptionLength: 0,
      canonicalPresent: false,
      robotsMeta: null,
      h1Count: 1,
      headingOrderValid: true,
      langPresent: true,
      openGraphPresent: false,
      structuredDataPresent: false,
      schemaTypes: [],
      indexable: true,
    },
    conversion: {
      phoneLinkPresent: true,
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
    content: { homepageWordCount: 100, servicesPagePresent: false, aboutPagePresent: false, copyrightYear: 2020, lastModifiedHeader: null },
    links: { checked: 2, working: 2, redirecting: 0, broken: 0, timedOut: 0, blocked: 0, brokenExamples: [] },
    assets: { failedImages: 0, failedStylesheets: 0, failedScripts: 0, otherFailed: 0, examples: [] },
    platform: { platform: null, confidence: "unknown", evidence: [] },
    social: { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, googleMaps: null, other: [] },
    artifacts: null,
  };
}

test("two intelligence runs persist append-only with per-run snapshot isolation and correct latest selection", async () => {
  const ctx = await createTestDatabase();
  const site = await serveLocalSite(htmlHandler("<!doctype html><html><head><title>A</title></head><body>A</body></html>"));
  try {
    const outcome = await qualifyBusiness(
      ctx.db,
      { name: "History Roofing", source: "manual_fixture", externalId: "hist-1", websiteUrl: site.url, industry: "roofing" },
      { analyzer: { allowPrivateNetworks: true } },
    );
    const detailBefore = await getProspectDetail(ctx.db, outcome.prospectId);
    const websiteId = detailBefore?.websiteId;
    assert.ok(websiteId);

    const run1 = await persistIntelligenceRun(ctx.db, {
      businessId: outcome.businessId,
      websiteId,
      result: syntheticResult({ websiteUrl: site.url, startedAt: "2026-08-27T01:00:00.000Z", pages: [site.url, `${site.url}contact`], performance: 40 }),
      artifactRef: "20260827010000-history-roofing",
    });
    const run2 = await persistIntelligenceRun(ctx.db, {
      businessId: outcome.businessId,
      websiteId,
      result: syntheticResult({
        websiteUrl: site.url,
        startedAt: "2026-08-27T02:00:00.000Z",
        pages: [site.url, `${site.url}contact`, `${site.url}about`],
        performance: 65,
      }),
      artifactRef: "20260827020000-history-roofing",
    });
    assert.notEqual(run1.analysisId, run2.analysisId);
    assert.equal(run1.snapshotIds.length, 2);
    assert.equal(run2.snapshotIds.length, 3);
    assert.equal(new Set([...run1.snapshotIds, ...run2.snapshotIds]).size, 5);

    const detail = await getProspectDetail(ctx.db, outcome.prospectId);
    assert.ok(detail);
    assert.equal(detail.websiteIntelligence.length, 2);
    // Newest run first; each run carries only its own snapshots.
    assert.equal(detail.websiteIntelligence[0]?.analysisId, run2.analysisId);
    assert.equal(detail.websiteIntelligence[1]?.analysisId, run1.analysisId);
    assert.deepEqual(detail.websiteIntelligence[0]?.snapshots.map((snapshot) => snapshot.id).sort(), [...run2.snapshotIds].sort());
    assert.deepEqual(detail.websiteIntelligence[1]?.snapshots.map((snapshot) => snapshot.id).sort(), [...run1.snapshotIds].sort());

    // Older analysis remains immutable: its stored findings still show run 1's values.
    const olderFindings = detail.websiteIntelligence[1]?.structuredFindings as { lab?: { performance?: number }; artifacts?: { ref?: string } };
    assert.equal(olderFindings.lab?.performance, 40);
    assert.equal(olderFindings.artifacts?.ref, "20260827010000-history-roofing");
    const newerFindings = detail.websiteIntelligence[0]?.structuredFindings as { lab?: { performance?: number } };
    assert.equal(newerFindings.lab?.performance, 65);

    // Observations attribute to the website_intelligence source with per-run source records.
    const observations = await ctx.db
      .selectFrom("observation as obs")
      .innerJoin("source as src", "src.id", "obs.source_id")
      .select(["obs.field_key", "obs.source_record_id"])
      .where("src.name", "=", "website_intelligence")
      .execute();
    assert.ok(observations.length > 0);
    assert.equal(new Set(observations.map((row) => row.source_record_id)).size, 2);
  } finally {
    await site.close();
    await ctx.destroy();
  }
});

test("intelligence evidence never cross-attributes between different websites/prospects", async () => {
  const ctx = await createTestDatabase();
  try {
    // Two businesses with DISTINCT website identities (real hostnames, no
    // network access needed because the analysis result is synthetic).
    const makeBusinessWithSite = async (name: string, host: string) => {
      const business = await createBusiness(ctx.db, { canonicalName: name, category: "roofing" });
      const domainId = await ensureDomain(ctx.db, host);
      const websiteId = await ensureBusinessWebsite(ctx.db, {
        businessId: business.id,
        domainId,
        canonicalUrl: `https://${host}/`,
      });
      const prospect = await openProspect(ctx.db, {
        businessId: business.id,
        actorType: "system",
        reasonCode: "TEST_SETUP",
      });
      return { businessId: business.id, websiteId, prospectId: prospect.id, url: `https://${host}/` };
    };
    const alpha = await makeBusinessWithSite("Alpha Website Co", "alpha-roofing.example");
    const beta = await makeBusinessWithSite("Beta Website Co", "beta-plumbing.example");
    assert.notEqual(alpha.websiteId, beta.websiteId);

    const runA = await persistIntelligenceRun(ctx.db, {
      businessId: alpha.businessId,
      websiteId: alpha.websiteId,
      result: syntheticResult({ websiteUrl: alpha.url, startedAt: "2026-08-27T01:00:00.000Z", pages: [alpha.url], performance: 30 }),
      artifactRef: "20260827010000-alpha",
    });

    const detailA = await getProspectDetail(ctx.db, alpha.prospectId);
    const detailB = await getProspectDetail(ctx.db, beta.prospectId);
    assert.equal(detailA?.websiteIntelligence.length, 1);
    assert.equal(detailA?.websiteIntelligence[0]?.analysisId, runA.analysisId);
    // Beta's case file must not show Alpha's analysis, snapshots, or artifacts.
    assert.equal(detailB?.websiteIntelligence.length, 0);

    // Alpha's observations are attached to Alpha's website subject only.
    const observationSubjects = await ctx.db
      .selectFrom("observation as obs")
      .innerJoin("source as src", "src.id", "obs.source_id")
      .select(["obs.subject_id"])
      .where("src.name", "=", "website_intelligence")
      .execute();
    assert.ok(observationSubjects.length > 0);
    assert.ok(observationSubjects.every((row) => row.subject_id === alpha.websiteId));
  } finally {
    await ctx.destroy();
  }
});
