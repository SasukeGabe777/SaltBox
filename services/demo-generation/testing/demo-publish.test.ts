/**
 * Phase 10 publication tests: only an approved version is publishable, only
 * its own assets become publicly retrievable, and PostgreSQL — not the
 * filesystem or the bucket — decides what a hosted request may serve.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryArtifactStore } from "@saltbox/artifact-store/memory";
import { demoAssetKey } from "@saltbox/artifact-store";
import {
  findPublishedDemoAsset,
  getLiveDemoPublication,
  listDemoAssets,
} from "@saltbox/database/repositories/demo-hosting";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { persistBrandIntelligence } from "@saltbox/website-intelligence/brand/persistence";
import type { BrandProfile } from "@saltbox/website-intelligence/brand/types";
import { approveDemoVersion, rejectDemoVersion } from "../src/approval.ts";
import { collectDemoSourceFacts } from "../src/facts.ts";
import { generateDemoForProspect } from "../src/generate.ts";
import { persistDemoQaResult } from "../src/qa.ts";
import { collectDemoAssetReferences, publishDemo } from "../src/publish.ts";
import { qaReport, seedQualifiedProspect } from "./fixtures.ts";

const ARTIFACT_REF = "20260827180000-publishable-roofing";
const OPERATOR = "test-operator";

function brandProfile(): BrandProfile {
  return {
    kind: "brand-intelligence",
    profileVersion: "brand-profile-v1",
    analyzerVersion: "brand-intelligence-v1",
    websiteUrl: "https://publishable.test/",
    finalUrl: "https://publishable.test/",
    collectedAt: "2026-08-27T18:00:00.000Z",
    durationMs: 15_000,
    pagesInspected: [{ url: "https://publishable.test/", role: "homepage" }],
    logo: {
      status: "selected",
      confidence: "high",
      sourceUrl: "https://publishable.test/logo.png",
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
          sourceUrl: "https://publishable.test/photos/roof.jpg",
          sourcePage: "https://publishable.test/",
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
        {
          name: "Roof Replacement",
          sourceText: "Roof Replacement",
          sourcePage: "https://publishable.test/",
          evidence: "heading",
        },
      ],
      consideredCount: 8,
    },
    identity: { displayName: "Publishable Roofing", metaDescription: null },
    artifactRef: ARTIFACT_REF,
    fallbacks: [],
    assetBytesDownloaded: 250_000,
  };
}

async function seedApprovedDemo(ctx: TestDatabase, source: MemoryArtifactStore) {
  const outcome = await seedQualifiedProspect(ctx, "Publishable Roofing", "publishable-roofing");
  const facts = await collectDemoSourceFacts(ctx.db, outcome.prospectId);
  assert.ok(facts?.websiteId);
  await persistBrandIntelligence(ctx.db, {
    businessId: outcome.businessId,
    websiteId: facts.websiteId,
    profile: brandProfile(),
  });
  for (const file of ["logo.png", "image-1.jpg"]) {
    await source.put(demoAssetKey(ARTIFACT_REF, file), new Uint8Array([1, 2, 3, 4]), {
      contentType: file.endsWith(".png") ? "image/png" : "image/jpeg",
    });
  }
  const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
  assert.equal(generated.status, "generated");
  if (generated.status !== "generated") throw new Error("fixture generation failed");
  await persistDemoQaResult(ctx.db, {
    report: qaReport(generated.summary.demoVersionId, generated.summary.locatorToken),
  });
  return { outcome, summary: generated.summary };
}

test("asset collection accepts only well-formed local demo-asset URLs", () => {
  const references = collectDemoAssetReferences({
    contentVersion: "demo-content-v2",
    brand: { logo: { url: "/demo-assets/20260827180000-x/logo.png" } },
    imagery: {
      hero: { url: "/demo-assets/20260827180000-x/image-1.jpg" },
      gallery: [
        { url: "/demo-assets/20260827180000-x/image-2.jpg" },
        // Hostile or non-local shapes must never be published.
        { url: "https://evil.example/tracker.png" },
        { url: "/demo-assets/../../etc/passwd" },
        { url: "/intelligence-artifacts/20260827180000-x/lighthouse.json" },
        { url: "/demo-assets/20260827180000-x/script.js" },
      ],
    },
  });
  assert.deepEqual(
    references.map((reference) => reference.fileName),
    ["image-1.jpg", "image-2.jpg", "logo.png"],
  );
  assert.ok(references.every((reference) => reference.assetRef === "20260827180000-x"));
});

test("publication refuses a demo with no approved version", async () => {
  const ctx = await createTestDatabase();
  const source = new MemoryArtifactStore("local");
  try {
    const { summary } = await seedApprovedDemo(ctx, source);
    const result = await publishDemo(ctx.db, {
      demoId: summary.demoId,
      environment: "hosted",
      source,
      destination: new MemoryArtifactStore("cloudflare-r2"),
      publicBaseUrl: "https://demos.example.workers.dev",
      actorRef: OPERATOR,
    });
    assert.equal(result.status, "not_approved");
    assert.equal(await getLiveDemoPublication(ctx.db, summary.demoId, "hosted"), undefined);
  } finally {
    await ctx.destroy();
  }
});

test("publishing an approved version uploads its assets and records the durable URL", async () => {
  const ctx = await createTestDatabase();
  const source = new MemoryArtifactStore("local");
  const destination = new MemoryArtifactStore("cloudflare-r2");
  try {
    const { outcome, summary } = await seedApprovedDemo(ctx, source);
    await approveDemoVersion(ctx.db, {
      demoId: summary.demoId,
      demoVersionId: summary.demoVersionId,
      actor: { actorRef: OPERATOR },
    });

    const result = await publishDemo(ctx.db, {
      demoId: summary.demoId,
      environment: "hosted",
      source,
      destination,
      publicBaseUrl: "https://demos.example.workers.dev/",
      actorRef: OPERATOR,
    });
    assert.equal(result.status, "published");
    if (result.status !== "published") return;
    assert.equal(result.summary.publishedAssets, 2);
    assert.equal(result.summary.publicUrl, `https://demos.example.workers.dev/d/${summary.locatorToken}`);
    assert.deepEqual(destination.keys(), [
      demoAssetKey(ARTIFACT_REF, "image-1.jpg"),
      demoAssetKey(ARTIFACT_REF, "logo.png"),
    ]);

    const assets = await listDemoAssets(ctx.db, summary.demoId);
    assert.equal(assets.length, 2);
    assert.ok(assets.every((asset) => asset.storageProvider === "cloudflare-r2" && asset.publishedAt !== null));
    assert.ok(assets.every((asset) => asset.contentHash.length === 64), "content hashes are persisted");

    const publication = await getLiveDemoPublication(ctx.db, summary.demoId, "hosted");
    assert.equal(publication?.status, "published");
    assert.equal(publication?.demoVersionId, summary.demoVersionId);

    // Hosted asset resolution is authorised by the database, not the bucket.
    const published = await findPublishedDemoAsset(ctx.db, ARTIFACT_REF, "logo.png");
    assert.ok(published);
    assert.equal(published.contentType, "image/png");
    assert.equal(await findPublishedDemoAsset(ctx.db, ARTIFACT_REF, "unknown.png"), undefined);
    assert.equal(await findPublishedDemoAsset(ctx.db, "20260101000000-other", "logo.png"), undefined);

    const publishedEvent = await ctx.db
      .selectFrom("event")
      .select(["properties", "prospect_id"])
      .where("event_type", "=", "demo_published")
      .executeTakeFirst();
    assert.ok(publishedEvent);
    assert.equal(publishedEvent.prospect_id, outcome.prospectId);

    // Withdrawing approval immediately stops hosted asset resolution too.
    await rejectDemoVersion(ctx.db, {
      demoId: summary.demoId,
      demoVersionId: summary.demoVersionId,
      actor: { actorRef: OPERATOR },
      note: "pulled",
    });
    assert.equal(
      await findPublishedDemoAsset(ctx.db, ARTIFACT_REF, "logo.png"),
      undefined,
      "assets of an unapproved demo are not publicly retrievable",
    );
  } finally {
    await ctx.destroy();
  }
});

test("a missing source asset fails the publication instead of publishing a broken demo", async () => {
  const ctx = await createTestDatabase();
  const source = new MemoryArtifactStore("local");
  try {
    const { summary } = await seedApprovedDemo(ctx, source);
    await approveDemoVersion(ctx.db, {
      demoId: summary.demoId,
      demoVersionId: summary.demoVersionId,
      actor: { actorRef: OPERATOR },
    });
    const empty = new MemoryArtifactStore("local");
    const result = await publishDemo(ctx.db, {
      demoId: summary.demoId,
      environment: "hosted",
      source: empty,
      destination: new MemoryArtifactStore("cloudflare-r2"),
      publicBaseUrl: "https://demos.example.workers.dev",
      actorRef: OPERATOR,
    });
    assert.equal(result.status, "failed");
    if (result.status !== "failed") return;
    assert.match(result.message, /Missing demo asset/);
    assert.equal(await getLiveDemoPublication(ctx.db, summary.demoId, "hosted"), undefined);
    assert.equal(await findPublishedDemoAsset(ctx.db, ARTIFACT_REF, "logo.png"), undefined);
  } finally {
    await ctx.destroy();
  }
});
