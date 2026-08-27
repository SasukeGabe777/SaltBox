import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import {
  ingestControlledBusiness,
  CROSS_SOURCE_IDENTITY_POLICY_VERSION,
  type ControlledBusinessInput,
} from "../../prospecting/ingestion/ingest.ts";

function candidate(overrides: Partial<ControlledBusinessInput> & Pick<ControlledBusinessInput, "source" | "externalId" | "name">): ControlledBusinessInput {
  return {
    industry: "roofing",
    city: "Ogden",
    state: "Utah",
    sourceType: "map_dataset",
    ...overrides,
  };
}

test("cross-source identity: strong signals link, weak signals never merge (policy cross-source-identity-v1)", async () => {
  const ctx = await createTestDatabase();
  try {
    // A. Same business rediscovered from the SAME source → same identity.
    const first = await ingestControlledBusiness(
      ctx.db,
      candidate({
        source: "openstreetmap",
        externalId: "node/9001",
        name: "Wasatch Roofing LLC",
        websiteUrl: "https://wasatch-roofing.example/",
        phone: "+1 801 555 0201",
      }),
    );
    assert.equal(first.identityDisposition, "created");
    const rerun = await ingestControlledBusiness(
      ctx.db,
      candidate({
        source: "openstreetmap",
        externalId: "node/9001",
        name: "Wasatch Roofing LLC",
        websiteUrl: "https://wasatch-roofing.example/",
        phone: "+1 801 555 0201",
      }),
    );
    assert.equal(rerun.businessId, first.businessId);
    assert.equal(rerun.businessCreated, false);
    assert.equal(rerun.identityDisposition, "existing_source_identity");

    // B. Same normalized website domain from a SECOND source → deterministic
    // auto-link to the one existing business; both source records preserved.
    const linked = await ingestControlledBusiness(
      ctx.db,
      candidate({
        source: "overture",
        externalId: "08f2b00000000000000000000000b001",
        name: "Wasatch Roofing",
        websiteUrl: "https://wasatch-roofing.example/contact",
        phone: "+1 (801) 555-0201",
      }),
    );
    assert.equal(linked.businessId, first.businessId);
    assert.equal(linked.businessCreated, false);
    assert.equal(linked.identityDisposition, "cross_source_linked");
    assert.deepEqual(Object.keys(linked.crossSourceSignals ?? {}).sort(), ["domain", "phone"]);
    const autoLink = await ctx.db
      .selectFrom("entity_match_candidate")
      .selectAll()
      .where("subject_id", "=", linked.sourceRecordId)
      .executeTakeFirstOrThrow();
    assert.equal(autoLink.status, "auto_linked");
    assert.equal(autoLink.candidate_business_id, first.businessId);
    assert.equal(autoLink.resolution_policy_version, CROSS_SOURCE_IDENTITY_POLICY_VERSION);
    assert.equal(autoLink.resolved_by_actor_type, "system");
    const sourceRecords = await ctx.db
      .selectFrom("source_record")
      .select(["business_id"])
      .where("business_id", "=", first.businessId)
      .execute();
    assert.equal(sourceRecords.length, 2);
    const identifiers = await ctx.db
      .selectFrom("business_identifier")
      .select(["provider", "value"])
      .where("business_id", "=", first.businessId)
      .orderBy("provider")
      .execute();
    assert.deepEqual(
      identifiers.map((row) => row.provider),
      ["openstreetmap", "overture"],
    );

    // C. Similar name but CONFLICTING strong identity → separate business,
    // nothing linked, no candidates.
    const conflicting = await ingestControlledBusiness(
      ctx.db,
      candidate({
        source: "overture",
        externalId: "08f2b00000000000000000000000c001",
        name: "Wasatch Roofing Co",
        websiteUrl: "https://wasatch-roofing-co.example/",
        phone: "+1 801 555 0299",
      }),
    );
    assert.notEqual(conflicting.businessId, first.businessId);
    assert.equal(conflicting.identityDisposition, "created");
    assert.equal(
      (await ctx.db
        .selectFrom("entity_match_candidate")
        .select(({ fn }) => fn.countAll().as("count"))
        .where("subject_id", "=", conflicting.businessId)
        .executeTakeFirstOrThrow()).count,
      "0",
    );

    // D. AMBIGUOUS strong signals (domain of one business, phone of another)
    // → new separate business plus pending review candidates; never a merge.
    const ambiguous = await ingestControlledBusiness(
      ctx.db,
      candidate({
        source: "overture",
        externalId: "08f2b00000000000000000000000d001",
        name: "Wasatch Exteriors",
        websiteUrl: "https://wasatch-roofing.example/",
        phone: "+1 801 555 0299",
      }),
    );
    assert.equal(ambiguous.identityDisposition, "created_ambiguous");
    assert.equal(ambiguous.businessCreated, true);
    assert.notEqual(ambiguous.businessId, first.businessId);
    assert.notEqual(ambiguous.businessId, conflicting.businessId);
    const pending = await ctx.db
      .selectFrom("entity_match_candidate")
      .selectAll()
      .where("subject_kind", "=", "business")
      .where("subject_id", "=", ambiguous.businessId)
      .orderBy("candidate_business_id")
      .execute();
    assert.equal(pending.length, 2);
    assert.ok(pending.every((row) => row.status === "pending" && row.confidence === "medium"));
    assert.deepEqual(
      pending.map((row) => row.candidate_business_id).sort(),
      [first.businessId, conflicting.businessId].sort(),
    );

    // Loopback/IP hosts are never identity signals (fixtures use 127.0.0.1).
    const loopbackA = await ingestControlledBusiness(
      ctx.db,
      candidate({ source: "manual_fixture", externalId: "fx-1", name: "Fixture A", websiteUrl: "http://127.0.0.1:5099/" }),
    );
    const loopbackB = await ingestControlledBusiness(
      ctx.db,
      candidate({ source: "manual_fixture", externalId: "fx-2", name: "Fixture B", websiteUrl: "http://127.0.0.1:5100/" }),
    );
    assert.notEqual(loopbackA.businessId, loopbackB.businessId);
    assert.equal(loopbackB.identityDisposition, "created");
  } finally {
    await ctx.destroy();
  }
});
