/**
 * Prospect lifecycle domain service (ADR-004 invariant 9): allowed
 * transitions, optimistic concurrency, appended history, and same-transaction
 * domain events.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgErrorCode, PG_UNIQUE_VIOLATION, type TestDatabase } from "./harness.ts";
import { createBusiness } from "../repositories/businesses.ts";
import { openProspect, transitionProspect, getProspectById, ProspectTransitionError } from "../repositories/prospects.ts";

let ctx: TestDatabase;

before(async () => {
  ctx = await createTestDatabase();
});

after(async () => {
  await ctx.destroy();
});

test("opening a prospect records the creation transition", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Birch & Bean" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  assert.equal(prospect.lifecycleState, "discovered");
  assert.equal(prospect.revision, 1);

  const transitions = await ctx.db
    .selectFrom("prospect_state_transition")
    .selectAll()
    .where("prospect_id", "=", prospect.id)
    .execute();
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.from_state, null);
  assert.equal(transitions[0]!.to_state, "discovered");
});

test("a valid transition chain appends history and emits domain events", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Cedar Dental" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  const first = await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: 1,
    toState: "enriching",
    reasonCode: "enrichment.started",
    actorType: "worker",
  });
  assert.equal(first.revision, 2);

  const second = await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: 2,
    toState: "evaluated",
    reasonCode: "analysis.complete",
    actorType: "worker",
  });
  const third = await transitionProspect(ctx.db, {
    prospectId: prospect.id,
    expectedRevision: 3,
    toState: "qualified",
    reasonCode: "decision.qualified",
    actorType: "system",
  });
  assert.equal(third.fromState, "evaluated");

  const current = await getProspectById(ctx.db, prospect.id);
  assert.equal(current?.lifecycleState, "qualified");
  assert.equal(current?.revision, 4);

  const transitions = await ctx.db
    .selectFrom("prospect_state_transition")
    .select(["from_state", "to_state"])
    .where("prospect_id", "=", prospect.id)
    .orderBy("occurred_at")
    .execute();
  assert.deepEqual(
    transitions.map((t) => t.to_state),
    ["discovered", "enriching", "evaluated", "qualified"]
  );

  const events = await ctx.db
    .selectFrom("event")
    .select(["event_type", "idempotency_key"])
    .where("prospect_id", "=", prospect.id)
    .where("event_type", "=", "prospect_state_changed")
    .execute();
  assert.equal(events.length, 3);
  assert.equal(second.eventId.length > 0, true);
});

test("disallowed transitions are rejected without mutating state", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Skipahead Corp" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  await assert.rejects(
    transitionProspect(ctx.db, {
      prospectId: prospect.id,
      expectedRevision: 1,
      toState: "qualified",
      reasonCode: "cheating",
      actorType: "system",
    }),
    (error: unknown) => error instanceof ProspectTransitionError && error.code === "invalid_transition"
  );

  const unchanged = await getProspectById(ctx.db, prospect.id);
  assert.equal(unchanged?.lifecycleState, "discovered");
  assert.equal(unchanged?.revision, 1);
});

test("stale revisions are rejected, including under concurrency", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Race Condition Bakery" });
  const prospect = await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  // Two workers race the same transition with the same expected revision.
  const results = await Promise.allSettled([
    transitionProspect(ctx.db, {
      prospectId: prospect.id,
      expectedRevision: 1,
      toState: "enriching",
      reasonCode: "worker.a",
      actorType: "worker",
    }),
    transitionProspect(ctx.db, {
      prospectId: prospect.id,
      expectedRevision: 1,
      toState: "enriching",
      reasonCode: "worker.b",
      actorType: "worker",
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one racer must win");
  assert.equal(rejected.length, 1);
  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ProspectTransitionError);
  assert.equal(loser.reason.code, "stale_revision");

  const current = await getProspectById(ctx.db, prospect.id);
  assert.equal(current?.lifecycleState, "enriching");
  assert.equal(current?.revision, 2);
  const transitions = await ctx.db
    .selectFrom("prospect_state_transition")
    .select("id")
    .where("prospect_id", "=", prospect.id)
    .execute();
  assert.equal(transitions.length, 2, "creation + exactly one racer transition");
});

test("only one active pursuit per business and scope is possible", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Twice Pursued LLC" });
  await openProspect(ctx.db, {
    businessId: business.id,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });

  try {
    await openProspect(ctx.db, {
      businessId: business.id,
      actorType: "system",
      reasonCode: "prospecting.discovered",
    });
    assert.fail("expected a unique violation for the second active pursuit");
  } catch (error) {
    assert.equal(pgErrorCode(error), PG_UNIQUE_VIOLATION);
  }
});
