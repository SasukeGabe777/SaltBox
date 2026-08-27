/**
 * Admin mutation tests (Phase 10).
 *
 * The admin is no longer read-only, so its mutation layer is tested directly
 * — not through component rendering: same-origin enforcement, the approval
 * and rejection intents, bounded run submission, and rejection of invalid
 * parameters before any run row exists.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getApprovedDemoVersion } from "@saltbox/database/repositories/demo-review";
import { listOperatorRuns } from "@saltbox/database/repositories/operator-runs";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { generateDemoForProspect } from "@saltbox/demo-generation/generate";
import { approveDemoVersion } from "@saltbox/demo-generation/approval";
import { persistDemoQaResult } from "@saltbox/demo-generation/qa";
import { qaReport, seedQualifiedProspect } from "../../../services/demo-generation/testing/fixtures.ts";
import { assertSameOrigin, dispatchOperatorIntent } from "../app/data/operator.server.ts";

const ACTOR = { actorRef: "test-operator", startWorker: false as const };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function seedDemo(ctx: TestDatabase) {
  const outcome = await seedQualifiedProspect(ctx, "Admin Action Roofing", "admin-action-roofing");
  const generated = await generateDemoForProspect(ctx.db, outcome.prospectId);
  if (generated.status !== "generated") throw new Error("fixture generation failed");
  await persistDemoQaResult(ctx.db, {
    report: qaReport(generated.summary.demoVersionId, generated.summary.locatorToken),
  });
  return { outcome, summary: generated.summary };
}

test("cross-origin operator actions are refused", () => {
  const good = new Request("http://127.0.0.1:5174/", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5174", host: "127.0.0.1:5174" },
  });
  assert.doesNotThrow(() => assertSameOrigin(good));

  const evil = new Request("http://127.0.0.1:5174/", {
    method: "POST",
    headers: { origin: "https://evil.example", host: "127.0.0.1:5174" },
  });
  assert.throws(
    () => assertSameOrigin(evil),
    (error: unknown) => error instanceof Response && error.status === 403,
  );
});

test("the approve intent enforces the approval invariant and reports blockers", async () => {
  const ctx = await createTestDatabase();
  try {
    const { summary } = await seedDemo(ctx);

    const approved = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "approve-version", demoId: summary.demoId, demoVersionId: summary.demoVersionId, note: "ship it" }),
      ACTOR,
    );
    assert.equal(approved.ok, true);
    assert.match(approved.message, /Approved version 1/);
    assert.equal((await getApprovedDemoVersion(ctx.db, summary.demoId))?.versionNumber, 1);

    const repeated = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "approve-version", demoId: summary.demoId, demoVersionId: summary.demoVersionId }),
      ACTOR,
    );
    assert.equal(repeated.ok, true);
    assert.match(repeated.message, /already the approved version/);

    const bogus = await dispatchOperatorIntent(
      ctx.db,
      form({
        intent: "approve-version",
        demoId: summary.demoId,
        demoVersionId: "00000000-0000-0000-0000-000000000000",
      }),
      ACTOR,
    );
    assert.equal(bogus.ok, false);
    assert.ok(bogus.detail?.some((line) => line.startsWith("VERSION_NOT_FOUND")));

    const rejected = await dispatchOperatorIntent(
      ctx.db,
      form({
        intent: "reject-version",
        demoId: summary.demoId,
        demoVersionId: summary.demoVersionId,
        note: "wrong photo",
      }),
      ACTOR,
    );
    assert.equal(rejected.ok, true);
    assert.match(rejected.message, /no approved version/);
    assert.equal(await getApprovedDemoVersion(ctx.db, summary.demoId), undefined);
  } finally {
    await ctx.destroy();
  }
});

test("run intents queue bounded work and refuse invalid parameters", async () => {
  const ctx = await createTestDatabase();
  try {
    const { outcome } = await seedDemo(ctx);

    const started = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "start-acquisition", category: "roofing", location: "Ogden, UT", limit: "2" }),
      ACTOR,
    );
    assert.equal(started.ok, true);
    assert.ok(started.runId);

    const overLimit = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "start-acquisition", category: "roofing", location: "Ogden, UT", limit: "500" }),
      ACTOR,
    );
    assert.equal(overLimit.ok, false);
    assert.ok(overLimit.errors?.some((error) => error.field === "limit"));

    const badCategory = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "start-acquisition", category: "casino", location: "Ogden, UT" }),
      ACTOR,
    );
    assert.equal(badCategory.ok, false);

    const regenerate = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "regenerate-demo", prospectId: outcome.prospectId, composition: "bold", reason: "try bold" }),
      ACTOR,
    );
    assert.equal(regenerate.ok, true);

    const retry = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "retry-intelligence", prospectId: outcome.prospectId }),
      ACTOR,
    );
    assert.equal(retry.ok, true);

    const unknown = await dispatchOperatorIntent(ctx.db, form({ intent: "delete-everything" }), ACTOR);
    assert.equal(unknown.ok, false);

    const runs = await listOperatorRuns(ctx.db, { limit: 20 });
    assert.deepEqual(
      runs.map((run) => run.runKind).sort(),
      ["acquisition", "demo_generate", "retry_intelligence"],
      "only valid submissions created runs",
    );
    assert.ok(runs.every((run) => run.status === "queued" && run.actorRef === "test-operator"));
  } finally {
    await ctx.destroy();
  }
});

test("outreach intents prepare and suppress without exposing a send action", async () => {
  const ctx = await createTestDatabase();
  try {
    const { outcome, summary } = await seedDemo(ctx);
    await approveDemoVersion(ctx.db, { demoId: summary.demoId, demoVersionId: summary.demoVersionId, actor: { actorRef: ACTOR.actorRef } });
    await ctx.db.insertInto("demo_publication").values({
      demo_id: summary.demoId,
      demo_version_id: summary.demoVersionId,
      environment: "hosted",
      status: "published",
      public_url: `https://saltbox-demos.example.test/d/${summary.locatorToken}`,
      actor_type: "operator",
      actor_ref: ACTOR.actorRef,
      completed_at: new Date(),
    }).execute();

    const prepared = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "prepare-outreach", prospectId: outcome.prospectId }),
      ACTOR,
    );
    assert.equal(prepared.ok, true);
    assert.match(prepared.message, /SEND-READY/);
    assert.match(prepared.message, /No email was sent/);
    const message = await ctx.db.selectFrom("message").select(["id", "status"]).where("prospect_id", "=", outcome.prospectId).executeTakeFirstOrThrow();
    assert.equal(message.status, "send_ready");
    assert.equal(await ctx.db.selectFrom("message_attempt").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 0);

    const suppressed = await dispatchOperatorIntent(
      ctx.db,
      form({ intent: "suppress-outreach", prospectId: outcome.prospectId, scope: "prospect", reason: "Operator requested no contact" }),
      ACTOR,
    );
    assert.equal(suppressed.ok, true);
    assert.match(suppressed.message, /DO NOT CONTACT/);
    assert.equal((await ctx.db.selectFrom("message").select("status").where("id", "=", message.id).executeTakeFirstOrThrow()).status, "suppressed");

    const send = await dispatchOperatorIntent(ctx.db, form({ intent: "send-outreach", prospectId: outcome.prospectId }), ACTOR);
    assert.equal(send.ok, false);
    assert.match(send.message, /Unknown operator action/);
    assert.equal(await ctx.db.selectFrom("message_attempt").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow().then((row) => Number(row.n)), 0);
  } finally {
    await ctx.destroy();
  }
});
