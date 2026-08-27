/**
 * Phase 10 hosted-surface tests.
 *
 * The renderer runs in `public` mode when it faces prospects: it resolves the
 * APPROVED version and nothing else, serves only assets recorded as published
 * for an approved demo, never enumerates, and never accepts a mutation.
 *
 * These tests drive the same handler the Cloudflare Worker uses, through the
 * Node adapter, so both runtimes are exercising one implementation.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildDemoContent, buildDemoPlan, newLocatorToken } from "@saltbox/demo-generation";
import type { DemoSourceFacts } from "@saltbox/demo-generation/content-model";
import { createBusiness } from "@saltbox/database/repositories/businesses";
import {
  appendDemoVersion,
  createDemo,
  ensureActiveDemoLocator,
  ensureDemoTemplateVersion,
  updateDemo,
} from "@saltbox/database/repositories/demos";
import { setApprovedDemoVersion } from "@saltbox/database/repositories/demo-review";
import { upsertDemoAsset } from "@saltbox/database/repositories/demo-hosting";
import { openProspect } from "@saltbox/database/repositories/prospects";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { createDemosServer } from "../server/app.ts";

const ASSET_REF = "20260827120000-hosted-test";

async function seedDemoWithTwoVersions(ctx: TestDatabase) {
  const business = await createBusiness(ctx.db, { canonicalName: "Hosted Test Roofing", category: "roofing" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    actorRef: "demos-hosting-test",
    reasonCode: "test.seed",
  });
  const facts: DemoSourceFacts = {
    prospectId: prospect.id,
    businessId: business.id,
    businessName: "Hosted Test Roofing",
    category: "roofing",
    lifecycleState: "discovered",
    phone: { display: "(801) 555-0100", e164: "+18015550100", contactMethodId: "cm-1" },
    city: "Ogden",
    state: "UT",
    activeSuppressionIds: [],
  };
  const plan = buildDemoPlan(facts);
  const template = await ensureDemoTemplateVersion(ctx.db, {
    name: plan.template.templateName,
    version: plan.template.templateVersion,
  });
  const demo = await createDemo(ctx.db, { prospectId: prospect.id });

  const versions = [];
  for (const headline of ["FIRST VERSION HEADLINE", "SECOND VERSION HEADLINE"]) {
    const content = buildDemoContent(facts, plan);
    content.hero.headline = headline;
    const version = await appendDemoVersion(ctx.db, {
      demoId: demo.id,
      demoTemplateVersionId: template.demoTemplateVersionId,
      contentInputVersion: content.contentVersion,
      generatedContentVersion: "demo-copy-v2",
      contentHash: `hash-${headline}`,
      publishedAt: new Date(),
      generatorMetadata: { content: content as unknown as Record<string, unknown> },
    });
    versions.push(version);
  }
  const current = await ctx.db
    .selectFrom("demo")
    .select("revision")
    .where("id", "=", demo.id)
    .executeTakeFirstOrThrow();
  await updateDemo(ctx.db, {
    demoId: demo.id,
    expectedRevision: current.revision,
    status: "ready",
    currentDemoVersionId: versions[1]!.id,
  });
  const locator = await ensureActiveDemoLocator(ctx.db, { demoId: demo.id, token: newLocatorToken() });
  return { demo, prospect, versions, locator };
}

async function withServer<T>(
  ctx: TestDatabase,
  options: { mode: "preview" | "public"; assetRoot?: string },
  run: (base: string) => Promise<T>,
): Promise<T> {
  const server = createDemosServer({
    db: ctx.db,
    mode: options.mode,
    ...(options.assetRoot !== undefined ? { assetRoot: options.assetRoot } : {}),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  }
}

test("the public surface serves the approved version only, and the same URL follows approval", async () => {
  const ctx = await createTestDatabase();
  try {
    const { demo, versions, locator } = await seedDemoWithTwoVersions(ctx);

    await withServer(ctx, { mode: "public" }, async (base) => {
      // No approval yet: the public URL is intentionally not ready.
      const notReady = await fetch(`${base}/d/${locator.token}`);
      assert.equal(notReady.status, 404);
      assert.match(await notReady.text(), /unknown, revoked, or expired/);
    });

    // The operator approves v1 — not the latest version.
    const before = await ctx.db.selectFrom("demo").select("revision").where("id", "=", demo.id).executeTakeFirstOrThrow();
    await setApprovedDemoVersion(ctx.db, {
      demoId: demo.id,
      expectedRevision: before.revision,
      demoVersionId: versions[0]!.id,
      actorRef: "test-operator",
      reviewId: null,
    });

    await withServer(ctx, { mode: "public" }, async (base) => {
      const response = await fetch(`${base}/d/${locator.token}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /FIRST VERSION HEADLINE/, "the approved version is served, not the latest");
      assert.ok(!html.includes("SECOND VERSION HEADLINE"));
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
      assert.match(response.headers.get("content-security-policy") ?? "", /form-action 'none'/);
      assert.ok(!html.includes(demo.id), "internal identifiers never appear publicly");
      assert.ok(!html.includes(versions[0]!.id));

      // Nothing enumerates demos, and robots.txt disallows everything.
      const index = await fetch(`${base}/`);
      assert.ok(!(await index.text()).includes(locator.token));
      const robots = await fetch(`${base}/robots.txt`);
      assert.match(await robots.text(), /Disallow: \//);

      // Public routes accept no mutations.
      assert.equal((await fetch(`${base}/d/${locator.token}`, { method: "POST" })).status, 405);
      assert.equal((await fetch(`${base}/d/${locator.token}`, { method: "DELETE" })).status, 405);
      assert.equal((await fetch(`${base}/d/unknown-token-aaaaaaaaaaaa`)).status, 404);

      // The demo form cannot deliver anywhere: no action, and CSP forbids one.
      assert.match(html, /<form id="quote-form"/);
      assert.ok(!/<form[^>]+action=/.test(html), "the demo form has no action target");
    });

    // Preview mode still shows the operator the newest version at the same URL.
    await withServer(ctx, { mode: "preview" }, async (base) => {
      const preview = await fetch(`${base}/d/${locator.token}`);
      assert.match(await preview.text(), /SECOND VERSION HEADLINE/);
    });

    // Approving v2 switches the public URL to v2 — same locator throughout.
    const after = await ctx.db.selectFrom("demo").select("revision").where("id", "=", demo.id).executeTakeFirstOrThrow();
    await setApprovedDemoVersion(ctx.db, {
      demoId: demo.id,
      expectedRevision: after.revision,
      demoVersionId: versions[1]!.id,
      actorRef: "test-operator",
      reviewId: null,
    });
    await withServer(ctx, { mode: "public" }, async (base) => {
      const response = await fetch(`${base}/d/${locator.token}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /SECOND VERSION HEADLINE/);
    });
  } finally {
    await ctx.destroy();
  }
});

test("public asset resolution requires a published asset of an approved demo", async () => {
  const ctx = await createTestDatabase();
  const assetRoot = mkdtempSync(join(tmpdir(), "saltbox-hosted-assets-"));
  mkdirSync(join(assetRoot, ASSET_REF), { recursive: true });
  writeFileSync(join(assetRoot, ASSET_REF, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(assetRoot, ASSET_REF, "unpublished.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const { demo, versions, locator } = await seedDemoWithTwoVersions(ctx);

    // On disk but not recorded as published: not retrievable publicly.
    await withServer(ctx, { mode: "public", assetRoot }, async (base) => {
      assert.equal((await fetch(`${base}/demo-assets/${ASSET_REF}/logo.png`)).status, 404);
    });

    const revision = await ctx.db.selectFrom("demo").select("revision").where("id", "=", demo.id).executeTakeFirstOrThrow();
    await setApprovedDemoVersion(ctx.db, {
      demoId: demo.id,
      expectedRevision: revision.revision,
      demoVersionId: versions[0]!.id,
      actorRef: "test-operator",
      reviewId: null,
    });
    await upsertDemoAsset(ctx.db, {
      demoId: demo.id,
      assetRef: ASSET_REF,
      fileName: "logo.png",
      contentType: "image/png",
      byteSize: 4,
      contentHash: "a".repeat(64),
      storageProvider: "local",
      storageKey: `demo-assets/${ASSET_REF}/logo.png`,
      publishedAt: new Date(),
    });

    await withServer(ctx, { mode: "public", assetRoot }, async (base) => {
      const ok = await fetch(`${base}/demo-assets/${ASSET_REF}/logo.png`);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("content-type"), "image/png");
      // A file that exists locally but was never published stays unreachable.
      assert.equal((await fetch(`${base}/demo-assets/${ASSET_REF}/unpublished.png`)).status, 404);
      assert.equal((await fetch(`${base}/demo-assets/${ASSET_REF}/..%2F..%2Fsecret.png`)).status, 404);
      assert.ok(locator.token.length >= 20, "locators keep high entropy");
    });

    // The local preview surface still serves what is on disk for review.
    await withServer(ctx, { mode: "preview", assetRoot }, async (base) => {
      assert.equal((await fetch(`${base}/demo-assets/${ASSET_REF}/unpublished.png`)).status, 200);
    });
  } finally {
    rmSync(assetRoot, { recursive: true, force: true });
    await ctx.destroy();
  }
});
