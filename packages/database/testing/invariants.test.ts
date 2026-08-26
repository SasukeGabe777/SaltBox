/**
 * Database-enforced ADR-004 invariants: uniqueness, checks, and idempotency
 * constraints must hold even if application code misbehaves.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createTestDatabase,
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
  PG_CHECK_VIOLATION,
  PG_FK_VIOLATION,
  type TestDatabase,
} from "./harness.ts";
import { createBusiness } from "../repositories/businesses.ts";
import { appendEvent } from "../repositories/events.ts";
import { activateSuppression, revokeSuppression, checkOutreachEligibility } from "../repositories/suppressions.ts";

let ctx: TestDatabase;

before(async () => {
  ctx = await createTestDatabase();
});

after(async () => {
  await ctx.destroy();
});

async function expectPgError(promise: Promise<unknown>, code: string, label: string) {
  try {
    await promise;
    assert.fail(`${label}: expected PostgreSQL error ${code}, but the statement succeeded`);
  } catch (error) {
    assert.equal(pgErrorCode(error), code, `${label}: wrong error: ${String(error)}`);
  }
}

test("invariant 3: source external IDs are unique within their source namespace", async () => {
  const source = await ctx.db
    .insertInto("source")
    .values({ name: "test-directory", source_type: "directory" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await ctx.db.insertInto("source_record").values({ source_id: source.id, external_id: "biz-1" }).execute();
  await expectPgError(
    ctx.db.insertInto("source_record").values({ source_id: source.id, external_id: "biz-1" }).execute(),
    PG_UNIQUE_VIOLATION,
    "duplicate source_record"
  );
});

test("observations carry exactly one typed value", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Two Values LLC" });
  const source = await ctx.db
    .insertInto("source")
    .values({ name: "test-manual", source_type: "manual" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await expectPgError(
    ctx.db
      .insertInto("observation")
      .values({
        subject_kind: "business",
        subject_id: business.id,
        field_key: "review_count",
        value_number: 12,
        value_text: "twelve",
        source_id: source.id,
        observed_at: new Date("2026-01-01T00:00:00Z"),
      })
      .execute(),
    PG_CHECK_VIOLATION,
    "observation with two values"
  );
});

test("a business cannot be 'merged' without a merge target", async () => {
  await expectPgError(
    ctx.db
      .insertInto("business")
      .values({ canonical_name: "Broken Merge", normalized_name: "broken merge", status: "merged" })
      .execute(),
    PG_CHECK_VIOLATION,
    "merged business without target"
  );
});

test("invariant 12–13: suppression scope and revocation constraints hold", async () => {
  // Scope requires its reference.
  await expectPgError(
    ctx.db
      .insertInto("suppression")
      .values({
        scope: "business",
        suppression_type: "do_not_contact",
        reason: "missing business ref",
        actor_type: "operator",
      })
      .execute(),
    PG_CHECK_VIOLATION,
    "business-scope suppression without business_id"
  );

  // Revocation demands attributable separate authorization.
  const business = await createBusiness(ctx.db, { canonicalName: "Suppressed Inc" });
  const suppressionId = await activateSuppression(ctx.db, {
    scope: "business",
    suppressionType: "do_not_contact",
    reason: "owner requested no contact",
    actorType: "operator",
    actorRef: "op:test",
    businessId: business.id,
  });
  await expectPgError(
    ctx.db.updateTable("suppression").set({ status: "revoked" }).where("id", "=", suppressionId).execute(),
    PG_CHECK_VIOLATION,
    "revocation without authorization evidence"
  );

  // Eligibility respects active suppression, and revocation preserves history.
  const before = await checkOutreachEligibility(ctx.db, { businessId: business.id, channel: "email" });
  assert.equal(before.eligible, false);
  assert.deepEqual(before.blockingSuppressionIds, [suppressionId]);

  const revoked = await revokeSuppression(ctx.db, {
    suppressionId,
    revokedByActorRef: "op:supervisor",
    authorizationRef: "ticket:123",
  });
  assert.equal(revoked, true);

  const after = await checkOutreachEligibility(ctx.db, { businessId: business.id, channel: "email" });
  assert.equal(after.eligible, true);
  const record = await ctx.db
    .selectFrom("suppression")
    .select(["status", "revoked_at"])
    .where("id", "=", suppressionId)
    .executeTakeFirstOrThrow();
  assert.equal(record.status, "revoked");
  assert.notEqual(record.revoked_at, null);
});

test("invariant 11: at most one accepted successful send per message", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Mail Target" });
  const message = await ctx.db
    .insertInto("message")
    .values({
      direction: "outbound",
      channel: "email",
      business_id: business.id,
      idempotency_key: "send-1",
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await ctx.db
    .insertInto("message_attempt")
    .values({ message_id: message.id, attempt_number: 1, status: "sent" })
    .execute();
  await expectPgError(
    ctx.db
      .insertInto("message_attempt")
      .values({ message_id: message.id, attempt_number: 2, status: "delivered" })
      .execute(),
    PG_UNIQUE_VIOLATION,
    "second successful attempt"
  );
  // Failed attempts remain recordable.
  await ctx.db
    .insertInto("message_attempt")
    .values({ message_id: message.id, attempt_number: 3, status: "failed", failure_class: "timeout" })
    .execute();
});

test("invariant 15: event idempotency keys are unique within their scope, and appendEvent deduplicates", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Event Emitter" });
  const first = await appendEvent(ctx.db, {
    category: "analytics",
    eventType: "demo_view",
    occurredAt: new Date("2026-02-01T10:00:00Z"),
    sourceProducer: "test",
    actorType: "system",
    businessId: business.id,
    idempotencyScope: "test-producer",
    idempotencyKey: "evt-1",
  });
  const replay = await appendEvent(ctx.db, {
    category: "analytics",
    eventType: "demo_view",
    occurredAt: new Date("2026-02-01T10:00:00Z"),
    sourceProducer: "test",
    actorType: "system",
    businessId: business.id,
    idempotencyScope: "test-producer",
    idempotencyKey: "evt-1",
  });
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.eventId, first.eventId);
});

test("the event envelope category must match the registered event type", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Category Mismatch" });
  await expectPgError(
    appendEvent(ctx.db, {
      category: "domain", // demo_view is registered as analytics
      eventType: "demo_view",
      occurredAt: new Date(),
      sourceProducer: "test",
      actorType: "system",
      businessId: business.id,
      idempotencyScope: "test-producer",
      idempotencyKey: "evt-mismatch",
    }),
    PG_FK_VIOLATION,
    "event with wrong category"
  );
});

test("invariant 16: money round-trips exactly with explicit currency and cost classes", async () => {
  const business = await createBusiness(ctx.db, { canonicalName: "Exact Money Co" });
  const prospect = await ctx.db
    .insertInto("prospect")
    .values({ business_id: business.id })
    .returning("id")
    .executeTakeFirstOrThrow();

  // Sub-cent inference cost: numeric(18,6) must round-trip without drift.
  const cost = await ctx.db
    .insertInto("cost_entry")
    .values({
      amount: "0.000123",
      currency: "USD",
      cost_class: "estimated",
      category: "local_inference_estimate",
      prospect_id: prospect.id,
      occurred_at: new Date("2026-02-01T00:00:00Z"),
    })
    .returning(["amount", "currency", "cost_class"])
    .executeTakeFirstOrThrow();
  assert.equal(cost.amount, "0.000123");
  assert.equal(cost.currency, "USD");
  assert.equal(cost.cost_class, "estimated");

  // All three ADR-004 cost classifications are representable.
  for (const costClass of ["actual", "allocated"] as const) {
    await ctx.db
      .insertInto("cost_entry")
      .values({
        amount: "1.50",
        currency: "USD",
        cost_class: costClass,
        category: "email",
        prospect_id: prospect.id,
        occurred_at: new Date("2026-02-01T00:00:00Z"),
      })
      .execute();
  }

  // Purchases/refunds use integer minor units: a large exact amount survives.
  const customer = await ctx.db
    .insertInto("customer")
    .values({ business_id: business.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  const purchase = await ctx.db
    .insertInto("purchase")
    .values({
      customer_id: customer.id,
      offer_ref: "site-package-v1",
      amount_minor: 999999999999999n, // beyond Number.MAX_SAFE_INTEGER cents territory
      currency: "USD",
      provider: "stripe",
      provider_ref: "pi_roundtrip",
      status: "succeeded",
      occurred_at: new Date("2026-02-02T00:00:00Z"),
    })
    .returning(["id", "amount_minor"])
    .executeTakeFirstOrThrow();
  assert.equal(purchase.amount_minor, "999999999999999");
});

test("invariant 17: a refund must reference an existing purchase", async () => {
  await expectPgError(
    ctx.db
      .insertInto("refund")
      .values({
        purchase_id: "00000000-0000-7000-8000-000000000000",
        amount_minor: 5000n,
        currency: "USD",
        provider: "stripe",
        occurred_at: new Date(),
      })
      .execute(),
    PG_FK_VIOLATION,
    "refund without purchase"
  );
});
