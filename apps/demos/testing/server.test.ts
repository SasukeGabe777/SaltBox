import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemoContent, buildDemoPlan, newLocatorToken } from "@saltbox/demo-generation";
import type { DemoSourceFacts } from "@saltbox/demo-generation/content-model";
import { createBusiness } from "@saltbox/database/repositories/businesses";
import {
  appendDemoVersion,
  createDemo,
  ensureActiveDemoLocator,
  ensureDemoTemplateVersion,
  revokeDemoLocator,
  updateDemo,
} from "@saltbox/database/repositories/demos";
import { openProspect } from "@saltbox/database/repositories/prospects";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { createDemosServer } from "../server/app.ts";

async function seedRenderableDemo(ctx: TestDatabase) {
  const business = await createBusiness(ctx.db, { canonicalName: "Server Test Roofing", category: "roofing" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    actorRef: "demos-server-test",
    reasonCode: "test.seed",
  });
  const facts: DemoSourceFacts = {
    prospectId: prospect.id,
    businessId: business.id,
    businessName: "Server Test Roofing",
    category: "roofing",
    lifecycleState: "discovered",
    phone: { display: "(801) 555-0100", e164: "+18015550100", contactMethodId: "cm-1" },
    city: "Ogden",
    state: "UT",
    activeSuppressionIds: [],
  };
  const plan = buildDemoPlan(facts);
  const content = buildDemoContent(facts, plan);
  const template = await ensureDemoTemplateVersion(ctx.db, { name: "local-service", version: "1.0.0" });
  const demo = await createDemo(ctx.db, { prospectId: prospect.id });
  const version = await appendDemoVersion(ctx.db, {
    demoId: demo.id,
    demoTemplateVersionId: template.demoTemplateVersionId,
    contentInputVersion: "demo-content-v1",
    generatedContentVersion: "demo-copy-v1",
    contentHash: "hash-1",
    publishedAt: new Date(),
    generatorMetadata: { content: content as unknown as Record<string, unknown> },
  });
  await updateDemo(ctx.db, { demoId: demo.id, expectedRevision: demo.revision, status: "ready", currentDemoVersionId: version.id });
  const locator = await ensureActiveDemoLocator(ctx.db, { demoId: demo.id, token: newLocatorToken() });
  return { demo, version, locator };
}

test("one renderer serves persisted demos by opaque locator with public-safe headers", async () => {
  const ctx = await createTestDatabase();
  const server = createDemosServer({ db: ctx.db });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const { locator, demo } = await seedRenderableDemo(ctx);

    const ok = await fetch(`${base}/d/${locator.token}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(ok.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(ok.headers.get("content-security-policy") ?? "", /form-action 'none'/);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const html = await ok.text();
    assert.match(html, /Server Test Roofing/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(!html.includes(demo.id), "internal demo id never appears in the page");

    // Unknown, malformed, and revoked locators resolve to nothing.
    assert.equal((await fetch(`${base}/d/completely-unknown-token-000`)).status, 404);
    assert.equal((await fetch(`${base}/d/short`)).status, 404);
    assert.equal((await fetch(`${base}/d/${locator.token}/../escape`)).status, 404);
    await revokeDemoLocator(ctx.db, locator.id);
    assert.equal((await fetch(`${base}/d/${locator.token}`)).status, 404);

    // The index never enumerates demos, and writes are rejected.
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.ok(!(await index.text()).includes(locator.token));
    assert.equal((await fetch(`${base}/d/${locator.token}`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await ctx.destroy();
  }
});

test("a demo without a renderable current version returns a controlled error, not a crash", async () => {
  const ctx = await createTestDatabase();
  const server = createDemosServer({ db: ctx.db });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const business = await createBusiness(ctx.db, { canonicalName: "No Content Roofing", category: "roofing" });
    const prospect = await openProspect(ctx.db, {
      businessId: business.id,
      actorType: "system",
      actorRef: "demos-server-test",
      reasonCode: "test.seed",
    });
    const template = await ensureDemoTemplateVersion(ctx.db, { name: "unknown-template", version: "0.0.1" });
    const demo = await createDemo(ctx.db, { prospectId: prospect.id });
    const version = await appendDemoVersion(ctx.db, {
      demoId: demo.id,
      demoTemplateVersionId: template.demoTemplateVersionId,
      contentHash: "hash-x",
    });
    await updateDemo(ctx.db, { demoId: demo.id, expectedRevision: demo.revision, status: "ready", currentDemoVersionId: version.id });
    const locator = await ensureActiveDemoLocator(ctx.db, { demoId: demo.id, token: newLocatorToken() });
    const response = await fetch(`${base}/d/${locator.token}`);
    assert.equal(response.status, 500);
    assert.match(await response.text(), /cannot be rendered/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await ctx.destroy();
  }
});
