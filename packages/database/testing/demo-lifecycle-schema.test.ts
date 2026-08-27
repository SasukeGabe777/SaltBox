/**
 * Phase 10 schema invariants.
 *
 * These are database-level guarantees, not application conventions: the
 * approval pointer cannot be half-written, an audited override cannot be
 * noteless, a demo cannot have two live publications in one environment, and
 * a repeated operator submission cannot create a second active run.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createBusiness } from "../repositories/businesses.ts";
import { createDecision } from "../repositories/decisions.ts";
import {
  appendDemoVersion,
  createDemo,
  ensureDemoTemplateVersion,
} from "../repositories/demos.ts";
import { openProspect } from "../repositories/prospects.ts";
import { createTestDatabase, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, type TestDatabase } from "./harness.ts";

async function seed(ctx: TestDatabase) {
  const business = await createBusiness(ctx.db, { canonicalName: "Schema Roofing", category: "roofing" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    actorRef: "phase10-schema-test",
    reasonCode: "test.seed",
  });
  const template = await ensureDemoTemplateVersion(ctx.db, { name: "local-service-clean", version: "1.0.0" });
  const demo = await createDemo(ctx.db, { prospectId: prospect.id });
  const version = await appendDemoVersion(ctx.db, {
    demoId: demo.id,
    demoTemplateVersionId: template.demoTemplateVersionId,
    contentHash: "hash-1",
  });
  return { business, prospect, demo, version };
}

test("the approved-version pointer cannot be half-written", async () => {
  const ctx = await createTestDatabase();
  try {
    const { demo, version } = await seed(ctx);
    await assert.rejects(
      () =>
        ctx.db
          .updateTable("demo")
          .set({ approved_demo_version_id: version.id })
          .where("id", "=", demo.id)
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      "approving must record who approved it and when",
    );
    await ctx.db
      .updateTable("demo")
      .set({ approved_demo_version_id: version.id, approved_at: new Date(), approved_by_actor_ref: "local-operator" })
      .where("id", "=", demo.id)
      .execute();
    const row = await ctx.db
      .selectFrom("demo")
      .select(["approved_demo_version_id", "approved_by_actor_ref"])
      .where("id", "=", demo.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.approved_demo_version_id, version.id);
    assert.equal(row.approved_by_actor_ref, "local-operator");
  } finally {
    await ctx.destroy();
  }
});

test("an audited QA override must carry a written reason, and demo review decisions are first-class", async () => {
  const ctx = await createTestDatabase();
  try {
    const { business, prospect, demo, version } = await seed(ctx);
    await assert.rejects(
      () =>
        ctx.db
          .insertInto("demo_version_review")
          .values({
            demo_id: demo.id,
            demo_version_id: version.id,
            action: "approved",
            qa_override: true,
            actor_type: "operator",
            actor_ref: "local-operator",
            reason_code: "OPERATOR_APPROVED_WITH_QA_OVERRIDE",
          })
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
    );

    await assert.rejects(
      () =>
        ctx.db
          .insertInto("demo_version_review")
          .values({
            demo_id: demo.id,
            demo_version_id: version.id,
            action: "deleted",
            actor_type: "operator",
            actor_ref: "local-operator",
            reason_code: "X",
          })
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      "only approved/rejected are review actions",
    );

    // The decision registry accepts the Phase 10 demo review decisions.
    const decisionId = await createDecision(ctx.db, {
      decisionType: "approve_demo",
      resultCode: "approved",
      policyVersion: "demo-approval-policy-v1",
      actorType: "operator",
      actorRef: "local-operator",
      actionRef: version.id,
      businessId: business.id,
      prospectId: prospect.id,
      reasons: [{ reasonCode: "OPERATOR_APPROVED", contribution: "supports" }],
    });
    const decision = await ctx.db
      .selectFrom("decision")
      .select(["decision_type", "action_ref"])
      .where("id", "=", decisionId)
      .executeTakeFirstOrThrow();
    assert.equal(decision.decision_type, "approve_demo");
    assert.equal(decision.action_ref, version.id, "the decision names the exact version it acted on");
  } finally {
    await ctx.destroy();
  }
});

test("a demo has at most one live publication per environment, and published rows carry a URL", async () => {
  const ctx = await createTestDatabase();
  try {
    const { demo, version } = await seed(ctx);
    await ctx.db
      .insertInto("demo_publication")
      .values({
        demo_id: demo.id,
        demo_version_id: version.id,
        environment: "hosted",
        status: "published",
        public_url: "https://demos.example.workers.dev/d/token",
        completed_at: new Date(),
        actor_type: "operator",
      })
      .execute();

    await assert.rejects(
      () =>
        ctx.db
          .insertInto("demo_publication")
          .values({
            demo_id: demo.id,
            demo_version_id: version.id,
            environment: "hosted",
            status: "publishing",
            actor_type: "operator",
          })
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_UNIQUE_VIOLATION,
    );

    await assert.rejects(
      () =>
        ctx.db
          .insertInto("demo_publication")
          .values({
            demo_id: demo.id,
            demo_version_id: version.id,
            environment: "local",
            status: "published",
            actor_type: "operator",
          })
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      "a published row without a URL would claim availability it cannot prove",
    );
  } finally {
    await ctx.destroy();
  }
});

test("QA results and demo assets stay internally consistent", async () => {
  const ctx = await createTestDatabase();
  try {
    const { demo, version } = await seed(ctx);
    await assert.rejects(
      () =>
        ctx.db
          .insertInto("demo_version_qa_result")
          .values({ demo_version_id: version.id, runner_version: "demo-qa-v2", status: "passed", checks_total: 4, checks_passed: 9 })
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
    );

    const asset = {
      demo_id: demo.id,
      asset_ref: "20260827180000-schema",
      file_name: "logo.png",
      content_type: "image/png",
      byte_size: 512,
      content_hash: "b".repeat(64),
      storage_provider: "local",
      storage_key: "demo-assets/20260827180000-schema/logo.png",
    };
    await ctx.db.insertInto("demo_asset").values(asset).execute();
    await assert.rejects(
      () => ctx.db.insertInto("demo_asset").values(asset).execute(),
      (error: unknown) => pgErrorCode(error) === PG_UNIQUE_VIOLATION,
    );
    await assert.rejects(
      () => ctx.db.insertInto("demo_asset").values({ ...asset, file_name: "empty.png", byte_size: 0 }).execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
    );
  } finally {
    await ctx.destroy();
  }
});

test("one active operator run per request key, but history keeps every completed run", async () => {
  const ctx = await createTestDatabase();
  try {
    const values = {
      run_kind: "acquisition",
      requested_parameters: JSON.stringify({ category: "roofing" }),
      request_key: "acquisition:overture:roofing:ogden, ut:10:3",
      actor_type: "operator" as const,
      actor_ref: "local-operator",
    };
    const first = await ctx.db.insertInto("operator_run").values(values).returning("id").executeTakeFirstOrThrow();
    await assert.rejects(
      () => ctx.db.insertInto("operator_run").values(values).execute(),
      (error: unknown) => pgErrorCode(error) === PG_UNIQUE_VIOLATION,
    );

    await ctx.db
      .updateTable("operator_run")
      .set({ status: "completed", completed_at: new Date() })
      .where("id", "=", first.id)
      .execute();
    const second = await ctx.db.insertInto("operator_run").values(values).returning("id").executeTakeFirstOrThrow();
    assert.notEqual(second.id, first.id, "a finished run does not block the next one");

    await assert.rejects(
      () =>
        ctx.db
          .updateTable("operator_run")
          .set({ status: "queued", completed_at: new Date() })
          .where("id", "=", second.id)
          .execute(),
      (error: unknown) => pgErrorCode(error) === PG_CHECK_VIOLATION,
      "a run cannot be both queued and completed",
    );
  } finally {
    await ctx.destroy();
  }
});
