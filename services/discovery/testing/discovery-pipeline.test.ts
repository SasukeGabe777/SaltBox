import assert from "node:assert/strict";
import { test } from "node:test";
import { getProspectDetail, getProspectOverview } from "@saltbox/database/queries/admin";
import { createTestDatabase } from "@saltbox/database/testing/harness";
import { htmlHandler, serveLocalSite } from "../../prospecting/testing/fixture-server.ts";
import { discoverAndQualify } from "../src/application/discover-and-qualify.ts";
import type {
  DiscoveryBatch,
  DiscoveryQuery,
  DiscoveryResult,
  DiscoverySourceAdapter,
  ResolvedLocation,
} from "../src/types.ts";

test("mock discovery reaches mixed decisions and reruns with stable identity and append-only history", async () => {
  const ctx = await createTestDatabase();
  const weakSite = await serveLocalSite(htmlHandler("<!doctype html><html><head><title>Roofing</title></head><body>Old site</body></html>"));
  const strongSite = await serveLocalSite(
    htmlHandler(
      "<!doctype html><html><head><title>Restaurant</title>" +
        '<meta name="description" content="Dinner"><meta name="viewport" content="width=device-width"></head>' +
        '<body><a href="mailto:hello@example.test">Email</a><a href="tel:+18015550102">Call now</a>' +
        '<form><input name="name"><button>Book a table</button></form><footer>© 2026</footer></body></html>',
    ),
  );

  try {
    const adapter = new MockDiscoveryAdapter([
      candidate({
        externalId: "node/1001",
        name: "Wasatch Test Roofing",
        category: "roofing",
        websiteUrl: weakSite.url,
        phone: "+1 801 555 0101",
        email: "hello@wasatch.test",
      }),
      candidate({
        externalId: "way/1002",
        name: "Golden Test Restaurant",
        category: "restaurant",
        websiteUrl: strongSite.url,
        phone: "+1 801 555 0102",
        email: "hello@golden.test",
      }),
      candidate({
        externalId: "relation/1003",
        name: "Northern Test Landscaping",
        category: "landscaping",
        websiteUrl: null,
        phone: "+1 801 555 0103",
        email: "hello@northern.test",
      }),
    ]);
    const query = {
      category: "roofing",
      location: "Ogden, UT",
      radiusKm: 10,
      limit: 5,
      source: adapter.source,
    };

    const first = await discoverAndQualify(ctx.db, query, adapter, {
      concurrency: 2,
      correlationId: "11111111-1111-4111-8111-111111111111",
      analyzer: { allowPrivateNetworks: true },
    });
    assert.deepEqual(
      {
        discovered: first.discovered,
        newBusinesses: first.newBusinesses,
        rediscovered: first.rediscovered,
        qualified: first.qualified,
        rejected: first.rejected,
        failed: first.failed,
      },
      { discovered: 3, newBusinesses: 3, rediscovered: 0, qualified: 2, rejected: 1, failed: 0 },
    );
    const successfulFirst = first.results.filter((result) => result.status === "completed");
    const restaurant = successfulFirst.find((result) => result.candidate.externalId === "way/1002");
    assert.equal(restaurant?.outcome.decision, "rejected");
    assert.equal(restaurant?.outcome.score, 52);

    const sourceRowsBefore = await ctx.db
      .selectFrom("source_record")
      .select(["id", "external_id", "business_id"])
      .orderBy("external_id")
      .execute();
    assert.equal(sourceRowsBefore.length, 3);
    assert.equal(new Set(sourceRowsBefore.map((row) => row.business_id)).size, 3);
    assert.equal(Number((await ctx.db.selectFrom("business").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 3);
    assert.equal(Number((await ctx.db.selectFrom("prospect").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 3);

    const overview = await getProspectOverview(ctx.db, { source: adapter.source });
    assert.equal(overview.prospects.length, 3);
    assert.ok(overview.prospects.some((prospect) => prospect.decision === "qualified"));
    assert.ok(overview.prospects.some((prospect) => prospect.decision === "rejected"));

    for (const result of successfulFirst) {
      const detail = await getProspectDetail(ctx.db, result.outcome.prospectId);
      assert.ok(detail);
      assert.equal(detail.provenance[0]?.sourceRecordId, result.outcome.sourceRecordId);
      assert.equal(detail.scoreHistory[0]?.featureSetId, result.outcome.featureSetId);
      assert.equal(detail.scoreHistory[0]?.decisions[0]?.id, result.outcome.decisionId);
      const lineage = await ctx.db
        .selectFrom("feature_set_lineage")
        .select(["input_kind", "input_id"])
        .where("feature_set_id", "=", result.outcome.featureSetId)
        .execute();
      assert.ok(lineage.some((row) => row.input_kind === "observation"));
      if (result.candidate.websiteUrl !== null) {
        assert.ok(lineage.some((row) => row.input_kind === "website_analysis"));
        assert.equal(detail.scoreHistory[0]?.websiteAnalysis?.id, result.outcome.websiteAnalysisId);
      }
    }

    const second = await discoverAndQualify(ctx.db, query, adapter, {
      concurrency: 2,
      correlationId: "22222222-2222-4222-8222-222222222222",
      analyzer: { allowPrivateNetworks: true },
    });
    assert.deepEqual(
      {
        discovered: second.discovered,
        newBusinesses: second.newBusinesses,
        rediscovered: second.rediscovered,
        qualified: second.qualified,
        rejected: second.rejected,
        failed: second.failed,
      },
      { discovered: 3, newBusinesses: 0, rediscovered: 3, qualified: 2, rejected: 1, failed: 0 },
    );

    const sourceRowsAfter = await ctx.db
      .selectFrom("source_record")
      .select(["id", "external_id", "business_id"])
      .orderBy("external_id")
      .execute();
    assert.deepEqual(sourceRowsAfter, sourceRowsBefore);
    assert.equal(Number((await ctx.db.selectFrom("business").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 3);
    assert.equal(Number((await ctx.db.selectFrom("prospect").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 3);
    assert.equal(Number((await ctx.db.selectFrom("lead_score").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 6);
    assert.equal(Number((await ctx.db.selectFrom("decision").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow()).count), 6);
  } finally {
    await weakSite.close();
    await strongSite.close();
    await ctx.destroy();
  }
});

class MockDiscoveryAdapter implements DiscoverySourceAdapter {
  readonly source = "mock_discovery";
  readonly adapterVersion = "mock-discovery-v1";
  private readonly candidates: DiscoveryResult[];

  constructor(candidates: DiscoveryResult[]) {
    this.candidates = candidates;
  }

  async resolveLocation(location: string): Promise<ResolvedLocation> {
    return {
      query: location,
      displayName: "Ogden, Utah",
      latitude: 41.223,
      longitude: -111.9738,
      city: "Ogden",
      state: "Utah",
      countryCode: "us",
      sourceLocator: "mock://location/ogden",
    };
  }

  async discover(query: DiscoveryQuery, location: ResolvedLocation): Promise<DiscoveryBatch> {
    return {
      query,
      location,
      source: this.source,
      adapterVersion: this.adapterVersion,
      sourceDataTimestamp: "2026-08-26T23:00:00Z",
      candidates: this.candidates.slice(0, query.limit),
    };
  }
}

function candidate(input: {
  externalId: string;
  name: string;
  category: string;
  websiteUrl: string | null;
  phone: string;
  email: string;
}): DiscoveryResult {
  return {
    source: "mock_discovery",
    sourceType: "map_dataset",
    sourceDescription: "Deterministic mocked discovery source.",
    sourceRetentionClass: "test",
    externalId: input.externalId,
    name: input.name,
    category: input.category,
    latitude: 41.22,
    longitude: -111.97,
    street: "100 Test Street",
    city: "Ogden",
    state: "Utah",
    postalCode: "84401",
    phone: input.phone,
    email: input.email,
    websiteUrl: input.websiteUrl,
    sourceLocator: `https://example.test/${input.externalId}`,
    retrievedAt: "2026-08-26T23:00:00.000Z",
    contentHash: input.externalId.padEnd(64, "0").slice(0, 64),
    metadata: { city: "Ogden", state: "Utah", adapterVersion: "mock-discovery-v1" },
  };
}
