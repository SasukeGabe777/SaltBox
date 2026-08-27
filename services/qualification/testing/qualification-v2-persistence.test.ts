import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail, getProspectOverview } from "@saltbox/database/queries/admin";
import { recordObservation } from "@saltbox/database/repositories/observations";
import { ensureSource } from "@saltbox/database/repositories/sources";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import { qualifyBusiness } from "@saltbox/prospecting/pipeline";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import { qualifyBusinessV2 } from "../src/pipeline/qualify-v2.ts";

test("v2 preserves v1, appends rescoring history, lineage, and admin-readable latest selection", async () => {
  const ctx = await createTestDatabase();
  const identity = {
    name: "Append Only Roofing",
    source: "qualification_v2_fixture",
    externalId: "append-only-1",
    industry: "roofing",
    phone: "+1 801 555 0199",
    email: "hello@append-only.test",
  };
  try {
    const v1 = await qualifyBusiness(ctx.db, identity, { correlationId: "11111111-1111-4111-8111-111111111117" });
    const intelligence = successfulIntelligence();
    const v2 = await qualifyBusinessV2(
      ctx.db,
      { ...identity, websiteUrl: intelligence.websiteUrl },
      {
        correlationId: "22222222-2222-4222-8222-222222222227",
        analyze: async () => intelligence,
        currentYear: 2026,
      },
    );
    assert.equal(v2.businessId, v1.businessId);
    assert.equal(v2.prospectId, v1.prospectId);
    assert.ok(v2.notes.some((note) => note.includes("skipped transition")));

    const versions = await ctx.db
      .selectFrom("lead_score as ls")
      .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
      .select(["ls.id", "sv.name"])
      .where("ls.prospect_id", "=", v1.prospectId)
      .orderBy("ls.calculated_at")
      .execute();
    assert.deepEqual(versions.map((row) => row.name), ["qualification-v1", "qualification-v2"]);

    const lineage = await ctx.db
      .selectFrom("feature_set_lineage")
      .select(["input_kind", "input_id", "transformation"])
      .where("feature_set_id", "=", v2.featureSetId)
      .execute();
    assert.ok(lineage.some((row) => row.input_kind === "website_analysis" && row.input_id === v2.websiteAnalysisId));
    assert.ok(lineage.some((row) => row.input_kind === "observation"));
    assert.ok(lineage.every((row) => row.transformation === "qualification-v2:derive"));

    const sourceId = await ensureSource(ctx.db, { name: "later_evidence", sourceType: "manual" });
    const laterObservationId = await recordObservation(ctx.db, {
      subjectKind: "business",
      subjectId: v2.businessId,
      fieldKey: "later.correction",
      value: { kind: "boolean", value: true },
      sourceId,
      observedAt: new Date(Date.now() + 60_000),
    });
    const retroactive = await ctx.db
      .selectFrom("feature_set_lineage")
      .select("input_id")
      .where("feature_set_id", "=", v2.featureSetId)
      .where("input_id", "=", laterObservationId)
      .executeTakeFirst();
    assert.equal(retroactive, undefined);

    const rerun = await qualifyBusinessV2(ctx.db, { ...identity, websiteUrl: intelligence.websiteUrl }, { analyze: async () => intelligence });
    assert.notEqual(rerun.featureSetId, v2.featureSetId);
    assert.notEqual(rerun.leadScoreId, v2.leadScoreId);
    assert.notEqual(rerun.decisionId, v2.decisionId);
    assert.equal(Number((await ctx.db.selectFrom("lead_score").select(({ fn }) => fn.countAll().as("count")).where("prospect_id", "=", v1.prospectId).executeTakeFirstOrThrow()).count), 3);

    const detail = await getProspectDetail(ctx.db, v1.prospectId);
    assert.ok(detail);
    assert.equal(detail.scoreHistory[0]?.scoringVersion, "qualification-v2");
    assert.ok(detail.scoreHistory.some((score) => score.scoringVersion === "qualification-v1"));
    assert.equal(detail.scoreHistory[0]?.decisions[0]?.policyVersion, "qualification-policy-v2");
    assert.ok(detail.scoreHistory[0]?.components.some((component) => component.contributingFeatures?.scoringVersion === "qualification-v2"));
    assert.equal(detail.scoreHistory[0]?.websiteAnalysis?.id, rerun.websiteAnalysisId);
    const overview = await getProspectOverview(ctx.db);
    assert.equal(overview.prospects.find((prospect) => prospect.prospectId === v1.prospectId)?.sourceName, "qualification_v2_fixture");

    const linkedReasons = await ctx.db
      .selectFrom("decision_reason")
      .select(["evidence_kind", "evidence_id"])
      .where("decision_id", "=", v2.decisionId)
      .execute();
    assert.ok(linkedReasons.some((reason) => reason.evidence_kind !== null && reason.evidence_id !== null));
  } finally {
    await ctx.destroy();
  }
});

test("malformed target URL persists analyzer evidence without becoming a system failure", async () => {
  const ctx = await createTestDatabase();
  try {
    const invalid = {
      ...successfulIntelligence(),
      websiteUrl: "not a url",
      finalHomepageUrl: null,
      pages: [],
      fatal: { stage: "unreachable" as const, message: "Invalid URL", failureKind: "invalid_target" as const, code: "ERR_INVALID_URL", transient: false },
    };
    const outcome = await qualifyBusinessV2(
      ctx.db,
      { name: "Malformed Roofing", source: "qualification_v2_fixture", externalId: "malformed-1", industry: "roofing", phone: "+1 801 555 0188", websiteUrl: "not a url" },
      { analyze: async () => invalid },
    );
    assert.equal(outcome.targetFailure, true);
    assert.equal(outcome.intelligenceFailureKind, "invalid_target");
    assert.equal(outcome.websiteAnalysisId, undefined);
    assert.ok(outcome.reasons.includes("INVALID_WEBSITE_TARGET"));
    const evidence = await ctx.db
      .selectFrom("observation")
      .select(["subject_kind", "field_key", "value_text"])
      .where("subject_id", "=", outcome.businessId)
      .where("field_key", "=", "website.technical.analysis_failure_kind")
      .executeTakeFirstOrThrow();
    assert.deepEqual(evidence, { subject_kind: "business", field_key: "website.technical.analysis_failure_kind", value_text: "invalid_target" });
  } finally {
    await ctx.destroy();
  }
});

function successfulIntelligence(): WebsiteIntelligenceResult {
  return {
    analyzerVersion: "website-intelligence-v1",
    websiteUrl: "https://append-only.test/",
    finalHomepageUrl: "https://append-only.test/",
    startedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:01.000Z",
    durationMs: 1000,
    pages: [
      { url: "https://append-only.test/", finalUrl: "https://append-only.test/", role: "homepage", selectedBecause: "entry", httpStatus: 200, reachable: true, contentHash: "home", title: "Roofing", wordCount: 50, consoleErrorCount: 0, failedRequestCount: 0 },
      { url: "https://append-only.test/contact", finalUrl: "https://append-only.test/contact", role: "contact", selectedBecause: "contact", httpStatus: 200, reachable: true, contentHash: "contact", title: "Contact", wordCount: 40, consoleErrorCount: 0, failedRequestCount: 0 },
      { url: "https://append-only.test/services", finalUrl: "https://append-only.test/services", role: "services", selectedBecause: "services", httpStatus: 200, reachable: true, contentHash: "services", title: "Services", wordCount: 80, consoleErrorCount: 0, failedRequestCount: 0 },
    ],
    stages: {
      homepage: { status: "ok" }, pageSelection: { status: "ok" }, subPages: { status: "ok" },
      lighthouse: { status: "ok" }, mobile: { status: "ok" }, linkHealth: { status: "ok" }, screenshots: { status: "skipped" },
    },
    lab: { performance: 45, accessibility: 80, seo: 75, bestPractices: 70, firstContentfulPaintMs: 1800, largestContentfulPaintMs: 4200, totalBlockingTimeMs: 250, cumulativeLayoutShift: 0.05, speedIndexMs: 2600, accessibilityFailures: [] },
    mobile: { viewportMetaPresent: true, horizontalOverflow: true, contentWiderThanViewport: true, navigationPresent: true },
    technical: { https: true, httpStatus: 200, redirectChain: [], canonicalUrl: null, faviconPresent: true, mixedContentRequests: 0, consoleErrors: 0, consoleErrorExamples: [], failedRequests: 0, failedRequestExamples: [], requestCount: 20, transferredBytes: 2000, robotsTxtPresent: true, sitemapPresent: true },
    seo: { titlePresent: true, titleLength: 7, metaDescriptionPresent: false, metaDescriptionLength: 0, canonicalPresent: false, robotsMeta: null, h1Count: 1, headingOrderValid: true, langPresent: true, openGraphPresent: false, structuredDataPresent: false, schemaTypes: [], indexable: true },
    conversion: { phoneLinkPresent: true, emailLinkPresent: false, contactPagePresent: true, contactFormPresent: false, formFieldCount: 0, formHasSubmit: false, quoteCtaPresent: false, bookingCtaPresent: false, prominentCtaPresent: false, visibleAddressPresent: true },
    content: { homepageWordCount: 50, servicesPagePresent: true, aboutPagePresent: false, copyrightYear: 2026, lastModifiedHeader: null },
    links: { checked: 8, working: 8, redirecting: 0, broken: 0, timedOut: 0, blocked: 0, brokenExamples: [] },
    assets: { failedImages: 0, failedStylesheets: 0, failedScripts: 0, otherFailed: 0, examples: [] },
    platform: { platform: null, confidence: "unknown", evidence: [] },
    social: { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, googleMaps: null, other: [] },
    artifacts: null,
  };
}
