import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail } from "@saltbox/database/queries/admin";
import { resolveDemoByLocator } from "@saltbox/database/queries/demos";
import { activateSuppression } from "@saltbox/database/repositories/suppressions";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { qualifyBusinessV2 } from "@saltbox/qualification/pipeline";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import { persistBrandIntelligence } from "@saltbox/website-intelligence/brand/persistence";
import type { BrandProfile } from "@saltbox/website-intelligence/brand/types";
import { collectDemoSourceFacts } from "../src/facts.ts";
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

async function seedQualifiedProspect(ctx: TestDatabase, name: string, externalId: string, phone = "+1 801 555 0123") {
  const url = `https://${externalId}.test/`;
  const outcome = await qualifyBusinessV2(
    ctx.db,
    {
      name,
      source: "demo_generation_fixture",
      externalId,
      industry: "roofing",
      websiteUrl: url,
      phone,
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
    assert.equal(summary.templateName, "local-service-clean", "no brand evidence: typography-led composition");
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
    assert.equal(versionRow.content_input_version, "demo-content-v2");
    assert.equal(versionRow.generated_content_version, "demo-copy-v2");
    assert.equal(versionRow.feature_set_id, outcome.featureSetId);
    assert.ok(versionRow.published_at !== null);

    // Generation announces a version awaiting review (Phase 10). Becoming
    // publicly visible is a separate later event emitted by publication, so
    // demo_published must NOT be emitted here.
    const events = await ctx.db
      .selectFrom("event")
      .select(["event_type", "demo_version_id"])
      .where("event_type", "in", ["demo_generated", "demo_published"])
      .execute();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event_type, "demo_generated");
    assert.equal(events[0]?.demo_version_id, summary.demoVersionId);

    // Public locator resolves to the current version; unknown tokens do not.
    const resolved = await resolveDemoByLocator(ctx.db, summary.locatorToken);
    assert.ok(resolved);
    assert.equal(resolved.version.demoVersionId, summary.demoVersionId);
    assert.equal(resolved.version.content?.contentVersion, "demo-content-v2");
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

function testBrandProfile(): BrandProfile {
  return {
    kind: "brand-intelligence",
    profileVersion: "brand-profile-v1",
    analyzerVersion: "brand-intelligence-v1",
    websiteUrl: "https://brand-enhanced.test/",
    finalUrl: "https://brand-enhanced.test/",
    collectedAt: "2026-08-27T18:00:00.000Z",
    durationMs: 15_000,
    pagesInspected: [{ url: "https://brand-enhanced.test/", role: "homepage" }],
    logo: {
      status: "selected",
      confidence: "high",
      sourceUrl: "https://brand-enhanced.test/logo.png",
      assetFile: "logo.png",
      width: 320,
      height: 96,
      kind: "image",
      reasons: ["placed in the site header"],
      candidatesConsidered: 2,
    },
    palette: {
      status: "extracted",
      confidence: "high",
      colors: {
        primary: "#14395c",
        secondary: "#0f2c47",
        accent: "#c96f1e",
        background: "#ffffff",
        surface: "#f6f7f9",
        text: "#1c2430",
        onPrimary: "#ffffff",
        onAccent: "#ffffff",
      },
      sources: ["header background"],
      candidatesConsidered: 5,
    },
    imagery: {
      selected: [
        {
          role: "hero",
          sourceUrl: "https://brand-enhanced.test/photos/roof.jpg",
          sourcePage: "https://brand-enhanced.test/",
          assetFile: "image-1.jpg",
          width: 1600,
          height: 900,
          alt: "Completed roof",
          reasons: ["prominent above-the-fold placement"],
        },
      ],
      consideredCount: 3,
      rejectedExamples: [],
    },
    services: {
      extracted: [
        { name: "Roof Replacement", sourceText: "Roof Replacement", sourcePage: "https://brand-enhanced.test/", evidence: "heading" },
        { name: "Solar", sourceText: "Solar", sourcePage: "https://brand-enhanced.test/", evidence: "nav" },
      ],
      consideredCount: 8,
    },
    identity: { displayName: "Brand Enhanced Roofing", metaDescription: null },
    artifactRef: "20260827180000-brand-enhanced-roofing",
    fallbacks: [],
    assetBytesDownloaded: 250_000,
  };
}

test("brand-enhanced regeneration: same Demo identity and locator, new v2 version with premium composition", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Brand Enhanced Roofing", "brand-enhanced");
    // Phase-8-style generation first (no brand profile persisted yet).
    const before = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(before.status, "generated");
    if (before.status !== "generated") return;
    assert.equal(before.summary.templateName, "local-service-clean", "no brand evidence selects the clean composition");

    // Persist brand intelligence (as the extractor would) and regenerate.
    const facts = await collectDemoSourceFacts(ctx.db, outcome.prospectId);
    assert.ok(facts?.websiteId);
    await persistBrandIntelligence(ctx.db, {
      businessId: outcome.businessId,
      websiteId: facts.websiteId,
      profile: testBrandProfile(),
    });
    const after = await generateDemoForProspect(ctx.db, outcome.prospectId);
    assert.equal(after.status, "generated", "brand evidence changes the content hash, so a new version appends");
    if (after.status !== "generated") return;

    // Acceptance: same business, prospect, Demo, and public locator — new version.
    assert.equal(after.summary.demoId, before.summary.demoId);
    assert.equal(after.summary.locatorToken, before.summary.locatorToken);
    assert.equal(after.summary.versionNumber, before.summary.versionNumber + 1);
    assert.equal(after.summary.templateName, "local-service-premium", "hero photography selects the image-forward composition");
    assert.equal(after.summary.plan.planVersion, "demo-plan-v2");
    assert.equal(after.summary.plan.brand?.logo.confidence, "high");
    assert.deepEqual(after.summary.plan.brand?.extractedServices, ["Roof Replacement", "Solar"]);

    // The locator resolves the NEW current version with v2 content and assets.
    const resolved = await resolveDemoByLocator(ctx.db, after.summary.locatorToken);
    assert.ok(resolved);
    assert.equal(resolved.version.demoVersionId, after.summary.demoVersionId);
    assert.equal(resolved.version.templateName, "local-service-premium");
    assert.equal(resolved.version.content?.contentVersion, "demo-content-v2");
    const brandBlock = resolved.version.content?.brand as { logo?: { url?: string } } | undefined;
    assert.match(brandBlock?.logo?.url ?? "", /^\/demo-assets\/20260827180000-brand-enhanced-roofing\/logo\.png$/);

    // The old version is untouched history and still renderable content.
    const versions = await ctx.db
      .selectFrom("demo_version")
      .select(["id", "version_number", "content_hash"])
      .where("demo_id", "=", before.summary.demoId)
      .orderBy("version_number")
      .execute();
    assert.equal(versions.length, 2);
    assert.equal(versions[0]?.content_hash, before.summary.contentHash);

    // Admin exposes the brand plan summary.
    const detail = await getProspectDetail(ctx.db, outcome.prospectId);
    const planBrand = (detail?.demo?.planSummary as { brand?: { imageryCount?: number } } | null)?.brand;
    assert.equal(planBrand?.imageryCount, 1);
  } finally {
    await ctx.destroy();
  }
});

test("the injected brand extractor runs only when needed and its failure is never fatal", async () => {
  const ctx = await createTestDatabase();
  try {
    const outcome = await seedQualifiedProspect(ctx, "Extractor Roofing", "extractor-roofing");
    let calls = 0;
    const extractor = async () => {
      calls += 1;
      const facts = await collectDemoSourceFacts(ctx.db, outcome.prospectId);
      await persistBrandIntelligence(ctx.db, {
        businessId: outcome.businessId,
        websiteId: facts!.websiteId!,
        profile: testBrandProfile(),
      });
    };
    const first = await generateDemoForProspect(ctx.db, outcome.prospectId, { brandExtractor: extractor });
    assert.equal(first.status, "generated");
    assert.equal(calls, 1, "extractor runs when no profile exists");
    if (first.status !== "generated") return;
    assert.equal(first.summary.templateName, "local-service-premium", "the fresh profile is used in the same run");

    const second = await generateDemoForProspect(ctx.db, outcome.prospectId, { brandExtractor: extractor });
    assert.equal(second.status, "unchanged");
    assert.equal(calls, 1, "a persisted profile is reused without re-extraction");

    const third = await generateDemoForProspect(ctx.db, outcome.prospectId, {
      brandExtractor: extractor,
      refreshBrand: true,
    });
    assert.equal(calls, 2, "--refresh-brand forces re-extraction");
    // The re-extracted profile is a NEW evidence row, so provenance lineage
    // changes and history appends — append-only evidence semantics.
    assert.equal(third.status, "generated");
    if (third.status === "generated" && second.status === "unchanged") {
      assert.equal(third.summary.versionNumber, second.summary.versionNumber + 1);
      assert.equal(third.summary.locatorToken, second.summary.locatorToken);
    }

    // A failing extractor degrades to fallback generation instead of failing.
    const failing = await generateDemoForProspect(ctx.db, "99999999-9999-4999-8999-999999999999", {
      brandExtractor: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(failing.status, "not_found");
    // A distinct phone keeps this a separate business identity (the shared
    // fixture phone would legitimately cross-source-link it to the first).
    const outcome2 = await seedQualifiedProspect(ctx, "Extractor Fallback Roofing", "extractor-fallback", "+1 801 555 0177");
    const degraded = await generateDemoForProspect(ctx.db, outcome2.prospectId, {
      brandExtractor: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(degraded.status, "generated", "extractor failure still yields a high-quality fallback demo");
    if (degraded.status !== "generated") return;
    assert.equal(degraded.summary.templateName, "local-service-clean");
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
