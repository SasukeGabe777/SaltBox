/** Controlled-ingestion idempotency (Phase 4 items 4, 5, 22). */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { ingestControlledBusiness, type ControlledBusinessInput } from "../ingestion/ingest.ts";

let ctx: TestDatabase;

before(async () => {
  ctx = await createTestDatabase();
});

after(async () => {
  await ctx.destroy();
});

const INPUT: ControlledBusinessInput = {
  name: "Summit Ridge Roofing",
  websiteUrl: "http://summitridge.example/",
  phone: "(801) 555-0142",
  email: "Office@SummitRidgeRoofing.example",
  city: "Ogden",
  state: "UT",
  industry: "roofing",
  source: "manual_fixture",
  externalId: "fixture-roofing-001",
};

test("first ingestion creates business, provenance, contacts, and website identity", async () => {
  const result = await ingestControlledBusiness(ctx.db, INPUT);

  const business = await ctx.db
    .selectFrom("business")
    .selectAll()
    .where("id", "=", result.businessId)
    .executeTakeFirstOrThrow();
  assert.equal(business.canonical_name, "Summit Ridge Roofing");
  assert.equal(business.category, "roofing");

  const identifier = await ctx.db
    .selectFrom("business_identifier")
    .selectAll()
    .where("business_id", "=", result.businessId)
    .executeTakeFirstOrThrow();
  assert.equal(identifier.provider, "manual_fixture");
  assert.equal(identifier.value, "fixture-roofing-001");

  const sourceRecord = await ctx.db
    .selectFrom("source_record")
    .selectAll()
    .where("id", "=", result.sourceRecordId)
    .executeTakeFirstOrThrow();
  assert.equal(sourceRecord.business_id, result.businessId);

  const methods = await ctx.db
    .selectFrom("contact_method")
    .select(["channel", "normalized_value"])
    .where("business_id", "=", result.businessId)
    .orderBy("channel")
    .execute();
  assert.deepEqual(
    methods.map((m) => [m.channel, m.normalized_value]),
    [
      ["email", "office@summitridgeroofing.example"],
      ["phone", "8015550142"],
    ]
  );

  assert.ok(result.websiteId);
  const association = await ctx.db
    .selectFrom("business_website")
    .selectAll()
    .where("business_id", "=", result.businessId)
    .executeTakeFirstOrThrow();
  assert.equal(association.website_id, result.websiteId);
  assert.equal(association.is_primary, true);
});

test("re-ingestion is idempotent: identical ids, no duplicate rows", async () => {
  const first = await ingestControlledBusiness(ctx.db, INPUT);
  const second = await ingestControlledBusiness(ctx.db, INPUT);

  assert.equal(second.businessId, first.businessId);
  assert.equal(second.sourceRecordId, first.sourceRecordId);
  assert.equal(second.websiteId, first.websiteId);
  assert.equal(second.domainId, first.domainId);
  assert.equal(second.emailContactMethodId, first.emailContactMethodId);
  assert.equal(second.phoneContactMethodId, first.phoneContactMethodId);

  const counts = await Promise.all([
    ctx.db.selectFrom("business").select(ctx.db.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ctx.db.selectFrom("source_record").select(ctx.db.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ctx.db.selectFrom("contact_method").select(ctx.db.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ctx.db.selectFrom("website").select(ctx.db.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ctx.db.selectFrom("domain").select(ctx.db.fn.countAll().as("n")).executeTakeFirstOrThrow(),
  ]);
  assert.deepEqual(
    counts.map((c) => Number(c.n)),
    [1, 1, 2, 1, 1]
  );
});

test("a differently-cased email normalizes to the same contact method", async () => {
  const result = await ingestControlledBusiness(ctx.db, {
    ...INPUT,
    email: "OFFICE@summitridgeroofing.EXAMPLE",
  });
  const emails = await ctx.db
    .selectFrom("contact_method")
    .select("id")
    .where("business_id", "=", result.businessId)
    .where("channel", "=", "email")
    .execute();
  assert.equal(emails.length, 1);
});
