import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail } from "@saltbox/database/queries/admin";
import { resolveDemoByLocator } from "@saltbox/database/queries/demos";
import { activateSuppression } from "@saltbox/database/repositories/suppressions";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { qualifyBusinessV2 } from "@saltbox/qualification/pipeline";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import { generateDemoForProspect } from "../src/generate.ts";

/**
 * Mirrors the persisted Utah Roof and Solar profile: reachable business
 * identity with a thin, CTA-free, metadata-free site — qualifies under
 * qualification-policy-v2.
 */
function poorSiteIntelligence(url: string): WebsiteIntelligenceResult {
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
    mobile: { viewportMetaPresent: true, horizontalOverflow: false, contentWiderThanViewport: false, navigationPresent: false },
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
    content: { homepageWordCount: 70, servicesPagePresent: false, aboutPagePresent: false, copyrightYear: 1999, lastModifiedHeader: null },
    links: { checked: 1, working: 1, redirecting: 0, broken: 0, timedOut: 0, blocked: 0, brokenExamples: [] },
    assets: { failedImages: 0, failedStylesheets: 0, failedScripts: 0, otherFailed: 11, examples: [] },
    platform: { platform: "GoDaddy Website Builder", confidence: "medium", evidence: [] },
    social: { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, googleMaps: null, other: [] },
    artifacts: null,
  };
}

async function seedQualifiedProspect(ctx: TestDatabase, name: string, externalId: string) {
  const url = `https://${externalId}.test/`;
  const outcome = await qualifyBusinessV2(
    ctx.db,
    {
      name,
      source: "demo_generation_fixture",
      externalId,
      industry: "roofing",
      websiteUrl: url,
      phone: "+1 801 555 0123",
      email: `hello@${externalId}.test`,
      sourceMetadata: { city: "Ogden", state: "UT", street: "238 25th St #5", postalCode: "84401" },
    },
    { analyze: async () => poorSiteIntelligence(url), currentYear: 2026 },
  );
  return outcome;
}

test("full generation: qualified v2 prospect -> plan -> content -> Demo -> DemoVersion -> locator -> admin state", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Demo Ready Roofing", "demo-ready");
    assert.equal(outcome.decision, "qualified", `fixture must qualify, got ${outcome.decision} (${outcome.score})`);

    const result = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(result.status, "generated");
    if (result.status !== "generated") return;
    const summary = result.summary;
    assert.equal(summary.versionNumber, 1);
    assert.equal(summary.templateName, "local-service");
    assert.equal(summary.templateVersion, "1.0.0");
    assert.ok(summary.deficiencyCodes.includes("CTA_MISSING"));
    assert.ok(summary.deficiencyCodes.includes("CONTACT_FORM_MISSING"));
    assert.match(summary.url, /^http:\/\/127\.0\.0\.1:5175\/d\/[A-Za-z0-9_-]{20,}$/);
    assert.ok(!summary.url.includes(summary.demoId), "public URL must not expose internal ids");
    assert.ok(!summary.url.includes(outcome.prospectId));

    // Persisted rows: one demo, one version, current pointer, ready status.
    const demoRow = await ctx.db
      .selectFrom("demo")
      .selectAll()
      .where("prospect_id", "=", outcome.prospectId)
      .executeTakeFirstOrThrow();
    assert.equal(demoRow.status, "ready");
    assert.equal(demoRow.current_demo_version_id, summary.demoVersionId);
    const versionRow = await ctx.db
      .selectFrom("demo_version")
      .selectAll()
      .where("id", "=", summary.demoVersionId)
      .executeTakeFirstOrThrow();
    assert.equal(versionRow.content_input_version, "demo-content-v1");
    assert.equal(versionRow.generated_content_version, "demo-copy-v1");
    assert.equal(versionRow.feature_set_id, outcome.featureSetId);
    assert.ok(versionRow.published_at !== null);

    // demo_published domain event is appended and idempotent by version.
    const events = await ctx.db
      .selectFrom("event")
      .select(["event_type", "demo_version_id"])
      .where("event_type", "=", "demo_published")
      .execute();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.demo_version_id, summary.demoVersionId);

    // Public locator resolves to the current version; unknown tokens do not.
    const resolved = await resolveDemoByLocator(ctx.db, summary.locatorToken);
    assert.ok(resolved);
    assert.equal(resolved.version.demoVersionId, summary.demoVersionId);
    assert.equal(resolved.version.content?.contentVersion, "demo-content-v1");
    assert.equal(await resolveDemoByLocator(ctx.db, "unknown-token-000000000000"), undefined);

    // Admin read model exposes the demo with plan summary and lineage.
    const detail = await getProspectDetail(ctx.db, outcome.prospectId);
    assert.ok(detail?.demo);
    assert.equal(detail.demo.status, "ready");
    assert.equal(detail.demo.locatorToken, summary.locatorToken);
    assert.equal(detail.demo.currentVersion?.versionNumber, 1);
    assert.equal(detail.demo.sourceScoringVersion, "qualification-v2");
    assert.equal(detail.demo.sourceScore, outcome.score);
    assert.ok(Array.isArray(detail.demo.planSummary?.deficiencyCodes));
  } finally {
    await ctx.destroy();
  }
});

test("idempotent regeneration: unchanged inputs reuse identity and version; force appends append-only history", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Idempotent Roofing", "idempotent-roofing");
    const first = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(first.status, "generated");
    if (first.status !== "generated") return;

    const second = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(second.status, "unchanged");
    if (second.status !== "unchanged") return;
    assert.equal(second.summary.demoId, first.summary.demoId);
    assert.equal(second.summary.demoVersionId, first.summary.demoVersionId);
    assert.equal(second.summary.locatorToken, first.summary.locatorToken, "locator is stable across reruns");

    const forced = await generateDemoForProspect(ctx.db, outcome.prospectId, { forceRegenerate: true });
    assert.equal(forced.status, "generated");
    if (forced.status !== "generated") return;
    assert.equal(forced.summary.demoId, first.summary.demoId, "demo identity is stable");
    assert.notEqual(forced.summary.demoVersionId, first.summary.demoVersionId);
    assert.equal(forced.summary.versionNumber, 2);
    assert.equal(forced.summary.locatorToken, first.summary.locatorToken);

    // No duplicate business/prospect/demo identity; old version untouched.
    const demoCount = await ctx.db
      .selectFrom("demo")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("prospect_id", "=", outcome.prospectId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(demoCount.count), 1);
    const versions = await ctx.db
      .selectFrom("demo_version")
      .select(["id", "version_number", "content_hash"])
      .where("demo_id", "=", first.summary.demoId)
      .orderBy("version_number")
      .execute();
    assert.deepEqual(versions.map((row) => row.version_number), [1, 2]);
    assert.equal(versions[0]?.id, first.summary.demoVersionId);
    assert.equal(versions[0]?.content_hash, first.summary.contentHash, "old versions are never mutated");
    const current = await ctx.db
      .selectFrom("demo")
      .select("current_demo_version_id")
      .where("id", "=", first.summary.demoId)
      .executeTakeFirstOrThrow();
    assert.equal(current.current_demo_version_id, forced.summary.demoVersionId);
  } finally {
    await ctx.destroy();
  }
});

test("rejected prospects are excluded by default; the explicit override generates without touching qualification history", async () => {
  const ctx = await createTestDatabase();
  try {
    // No contact path at all -> policy hard reject (NO_CONTACT_PATH).
    const url = "https://rejected-roofing.test/";
    const rejected = await qualifyBusinessV2(
      ctx.db,
      { name: "Rejected Roofing", source: "demo_generation_fixture", externalId: "rejected-roofing", industry: "roofing", websiteUrl: url },
      { analyze: async () => poorSiteIntelligence(url), currentYear: 2026 },
    );
    assert.equal(rejected.decision, "rejected");

    const refused = await generateDemoForProspect(ctx.db, rejected.prospectId);
    assert.equal(refused.status, "ineligible");
    if (refused.status !== "ineligible") return;
    assert.ok(refused.eligibility.reasons.some((reason) => reason.code === "NOT_QUALIFIED"));

    const decisionsBefore = await ctx.db
      .selectFrom("decision")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("prospect_id", "=", rejected.prospectId)
      .executeTakeFirstOrThrow();
    const overridden = await generateDemoForProspect(ctx.db, rejected.prospectId, {
      overrideIneligible: { note: "controlled test" },
    });
    assert.equal(overridden.status, "generated");
    if (overridden.status !== "generated") return;
    assert.equal(overridden.summary.plan.override?.flag, "override-ineligible");

    // The override changed nothing about qualification or lifecycle.
    const decisionsAfter = await ctx.db
      .selectFrom("decision")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("prospect_id", "=", rejected.prospectId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(decisionsAfter.count), Number(decisionsBefore.count));
    const prospect = await ctx.db
      .selectFrom("prospect")
      .select("lifecycle_state")
      .where("id", "=", rejected.prospectId)
      .executeTakeFirstOrThrow();
    assert.equal(prospect.lifecycle_state, "rejected");
  } finally {
    await ctx.destroy();
  }
});

test("active suppression blocks generation even with the override", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Suppressed Roofing", "suppressed-roofing");
    await activateSuppression(ctx.db, {
      scope: "business",
      businessId: outcome.businessId,
      suppressionType: "do_not_contact",
      reason: "operator request",
      actorType: "operator",
    });
    const refused = await generateDemoForProspect(ctx.db, outcome.prospectId, {
      overrideIneligible: { note: "must not work" },
    });
    assert.equal(refused.status, "ineligible");
    if (refused.status !== "ineligible") return;
    assert.ok(refused.eligibility.blocking.some((reason) => reason.code === "ACTIVELY_SUPPRESSED"));
    const demos = await ctx.db
      .selectFrom("demo")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("prospect_id", "=", outcome.prospectId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(demos.count), 0);
  } finally {
    await ctx.destroy();
  }
});

test("unknown prospect ids report not_found", async () => {
  const ctx = await createTestDatabase();
  try {
    const result = await generateDemoForProspect(ctx.db, "99999999-9999-4999-8999-999999999999");
    assert.equal(result.status, "not_found");
  } finally {
    await ctx.destroy();
  }
});
