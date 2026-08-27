/**
 * Operator run tracking: queue -> claim -> progress -> terminal state, with
 * isolated target failures and no duplicate run from a repeated submission.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getOperatorRunView, listRecentTargetFailures } from "@saltbox/database/queries/operator";
import {
  claimOperatorRun,
  completeOperatorRun,
  getOperatorRun,
  updateOperatorRunProgress,
  upsertOperatorRunTarget,
} from "@saltbox/database/repositories/operator-runs";
import { createBusiness } from "@saltbox/database/repositories/businesses";
import { openProspect } from "@saltbox/database/repositories/prospects";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import { enqueueOperatorRun } from "../src/enqueue.ts";
import { parseAcquisitionParameters } from "../src/parameters.ts";

function acquisition() {
  const parsed = parseAcquisitionParameters({ category: "roofing", location: "Ogden, UT", limit: 2 });
  if (!parsed.ok) throw new Error("fixture parameters must be valid");
  return parsed.value;
}

test("a queued run is claimed once, reports progress, and ends with target-failure semantics", async () => {
  const ctx = await createTestDatabase();
  try {
    const enqueued = await enqueueOperatorRun(ctx.db, acquisition(), {
      actorRef: "test-operator",
      startWorker: false,
    });
    assert.equal(enqueued.created, true);
    assert.equal(enqueued.run.status, "queued");
    assert.equal(enqueued.workerStarted, false);
    assert.equal(enqueued.run.actorRef, "test-operator");

    // Repeated submission of the identical request joins the active run.
    const duplicate = await enqueueOperatorRun(ctx.db, acquisition(), {
      actorRef: "test-operator",
      startWorker: false,
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.run.id, enqueued.run.id);

    // Starting a run is audited.
    const started = await ctx.db
      .selectFrom("event")
      .select(["id", "properties"])
      .where("event_type", "=", "acquisition_run_started")
      .execute();
    assert.equal(started.length, 1, "only the accepted submission emits a start event");

    const claimed = await claimOperatorRun(ctx.db, enqueued.run.id);
    assert.equal(claimed?.status, "running");
    assert.equal(await claimOperatorRun(ctx.db, enqueued.run.id), undefined, "a run is claimed exactly once");

    await updateOperatorRunProgress(ctx.db, {
      runId: enqueued.run.id,
      progress: { stage: "analyzing", message: "Legacy Roofing", total: 2, completed: 0 },
    });
    await upsertOperatorRunTarget(ctx.db, {
      operatorRunId: enqueued.run.id,
      position: 1,
      label: "Legacy Roofing",
      status: "running",
      stage: "ANALYZING",
      startedAt: new Date(),
    });
    await upsertOperatorRunTarget(ctx.db, {
      operatorRunId: enqueued.run.id,
      position: 1,
      label: "Legacy Roofing",
      status: "completed",
      stage: "rejected",
      outcome: { score: 57, decision: "rejected" },
      completedAt: new Date(),
    });
    await upsertOperatorRunTarget(ctx.db, {
      operatorRunId: enqueued.run.id,
      position: 2,
      label: "Bear Creek Roofing",
      status: "target_failed",
      failureKind: "dns_transient",
      failureCode: "EAI_AGAIN",
      transient: true,
      completedAt: new Date(),
    });

    await completeOperatorRun(ctx.db, {
      runId: enqueued.run.id,
      status: "completed_with_target_failures",
      summary: { discovered: 2, qualified: 0, rejected: 1, targetFailures: 1 },
    });

    const view = await getOperatorRunView(ctx.db, enqueued.run.id);
    assert.ok(view);
    assert.equal(view.status, "completed_with_target_failures");
    assert.equal(view.targets.length, 2, "target rows are upserted by position, not duplicated");
    assert.equal(view.targets[0]?.status, "completed");
    assert.equal(view.targets[0]?.outcome?.decision, "rejected");
    assert.equal(view.targets[1]?.status, "target_failed");
    assert.equal(view.targets[1]?.transient, true);
    assert.equal(view.summary?.targetFailures, 1);
    assert.equal(view.progress?.stage, "analyzing");

    const failures = await listRecentTargetFailures(ctx.db);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.failureCode, "EAI_AGAIN");

    // A terminal run is never completed twice.
    assert.equal(
      await completeOperatorRun(ctx.db, { runId: enqueued.run.id, status: "completed" }),
      undefined,
    );

    // With the previous run finished, an identical request starts a new one.
    const next = await enqueueOperatorRun(ctx.db, acquisition(), { actorRef: "test-operator", startWorker: false });
    assert.equal(next.created, true);
    assert.notEqual(next.run.id, enqueued.run.id);
  } finally {
    await ctx.destroy();
  }
});

test("a genuine system failure is recorded as failed with its message", async () => {
  const ctx = await createTestDatabase();
  try {
    const enqueued = await enqueueOperatorRun(ctx.db, acquisition(), {
      actorRef: "test-operator",
      startWorker: false,
    });
    await claimOperatorRun(ctx.db, enqueued.run.id);
    await completeOperatorRun(ctx.db, {
      runId: enqueued.run.id,
      status: "failed",
      failureMessage: "Chromium is unavailable on this machine.",
    });
    const run = await getOperatorRun(ctx.db, enqueued.run.id);
    assert.equal(run?.status, "failed");
    assert.match(run?.failureMessage ?? "", /Chromium is unavailable/);
    assert.ok(run?.completedAt instanceof Date);
  } finally {
    await ctx.destroy();
  }
});

test("a retry request is audited when it is enqueued", async () => {
  const ctx = await createTestDatabase();
  try {
    const business = await createBusiness(ctx.db, { canonicalName: "Retry Roofing", category: "roofing" });
    const prospect = await openProspect(ctx.db, {
      businessId: business.id,
      actorType: "system",
      actorRef: "operator-run-test",
      reasonCode: "test.seed",
    });
    const prospectId = prospect.id;
    await enqueueOperatorRun(
      ctx.db,
      { kind: "retry_intelligence", prospectId },
      { actorRef: "test-operator", startWorker: false },
    );
    const event = await ctx.db
      .selectFrom("event")
      .select(["event_type", "properties"])
      .where("event_type", "=", "retry_requested")
      .executeTakeFirst();
    assert.ok(event, "an operator retry is auditable");
  } finally {
    await ctx.destroy();
  }
});
