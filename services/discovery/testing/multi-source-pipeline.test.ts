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

test("two mocked sources with overlap dedupe safely end to end without evidence contamination", async () => {
  const ctx = await createTestDatabase();
  const site = await serveLocalSite(
    htmlHandler("<!doctype html><html><head><title>Roofing</title></head><body>Site</body></html>"),
  );
  try {
    // Shared business "Peak Roofing" appears in BOTH sources with the same
    // public phone but different provider identities; each source also has a
    // unique business.
    const sourceA = new MockAdapter("mock_osm", [
      makeCandidate("mock_osm", {
        externalId: "node/7001",
        name: "Peak Roofing",
        phone: "+1 801 555 0331",
        websiteUrl: null,
      }),
      makeCandidate("mock_osm", {
        externalId: "node/7002",
        name: "Canyon Exteriors",
        phone: "+1 801 555 0332",
        websiteUrl: site.url,
      }),
    ]);
    const sourceB = new MockAdapter("mock_overture", [
      makeCandidate("mock_overture", {
        externalId: "08f2e2e000000000000000000000e001",
        name: "Peak Roofing LLC",
        phone: "(801) 555-0331",
        websiteUrl: null,
      }),
      makeCandidate("mock_overture", {
        externalId: "08f2e2e000000000000000000000e002",
        name: "Bench Top Gutters",
        phone: "+1 801 555 0333",
        websiteUrl: null,
      }),
    ]);
    const baseQuery = { category: "roofing", location: "Ogden, UT", radiusKm: 10, limit: 5 };

    const runA = await discoverAndQualify(ctx.db, { ...baseQuery, source: "mock_osm" }, sourceA, {
      concurrency: 2,
      correlationId: "33333333-3333-4333-8333-333333333333",
      analyzer: { allowPrivateNetworks: true },
    });
    assert.deepEqual(
      { discovered: runA.discovered, newBusinesses: runA.newBusinesses, crossSourceLinked: runA.crossSourceLinked },
      { discovered: 2, newBusinesses: 2, crossSourceLinked: 0 },
    );

    const runB = await discoverAndQualify(ctx.db, { ...baseQuery, source: "mock_overture" }, sourceB, {
      concurrency: 2,
      correlationId: "44444444-4444-4444-8444-444444444444",
      analyzer: { allowPrivateNetworks: true },
    });
    assert.deepEqual(
      {
        discovered: runB.discovered,
        newBusinesses: runB.newBusinesses,
        rediscovered: runB.rediscovered,
        crossSourceLinked: runB.crossSourceLinked,
        ambiguousMatches: runB.ambiguousMatches,
        failed: runB.failed,
      },
      { discovered: 2, newBusinesses: 1, rediscovered: 0, crossSourceLinked: 1, ambiguousMatches: 0, failed: 0 },
    );

    // Three real businesses, three prospects — the overlap did not duplicate a pursuit.
    const businessCount = await ctx.db.selectFrom("business").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow();
    const prospectCount = await ctx.db.selectFrom("prospect").select(({ fn }) => fn.countAll().as("count")).executeTakeFirstOrThrow();
    assert.equal(Number(businessCount.count), 3);
    assert.equal(Number(prospectCount.count), 3);

    // The linked business carries BOTH provider identities and both source records.
    const linkedOutcome = runB.results
      .filter((result) => result.status === "completed")
      .find((result) => result.outcome.identityDisposition === "cross_source_linked");
    assert.ok(linkedOutcome);
    const peakBusinessId = linkedOutcome.outcome.businessId;
    const peakFromA = runA.results.filter((r) => r.status === "completed").find((r) => r.candidate.externalId === "node/7001");
    assert.equal(peakFromA?.outcome.businessId, peakBusinessId);
    const detail = await getProspectDetail(ctx.db, linkedOutcome.outcome.prospectId);
    assert.ok(detail);
    assert.equal(detail.provenance.length, 2);
    assert.deepEqual(detail.provenance.map((entry) => entry.sourceName).sort(), ["mock_osm", "mock_overture"]);

    // Website evidence stays on the business that owns the website: the
    // linked no-website business must have no website analysis in history.
    assert.ok(detail.scoreHistory.every((run) => run.websiteAnalysis === undefined || run.websiteAnalysis === null));
    const canyon = runA.results.filter((r) => r.status === "completed").find((r) => r.candidate.externalId === "node/7002");
    assert.ok(canyon?.outcome.websiteAnalysisId);

    // Both sources remain visible in the admin overview; the linked business
    // surfaces once per prospect with its latest provenance intact.
    const overview = await getProspectOverview(ctx.db, {});
    assert.equal(overview.prospects.length, 3);
    const bySource = await getProspectOverview(ctx.db, { source: "mock_overture" });
    assert.ok(bySource.prospects.length >= 1);
  } finally {
    await site.close();
    await ctx.destroy();
  }
});

class MockAdapter implements DiscoverySourceAdapter {
  readonly adapterVersion = "mock-v1";
  readonly source: string;
  private readonly candidates: DiscoveryResult[];

  constructor(source: string, candidates: DiscoveryResult[]) {
    this.source = source;
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

function makeCandidate(
  source: string,
  input: { externalId: string; name: string; phone: string; websiteUrl: string | null },
): DiscoveryResult {
  return {
    source,
    sourceType: "map_dataset",
    sourceDescription: "Deterministic mocked discovery source.",
    sourceRetentionClass: "test",
    externalId: input.externalId,
    name: input.name,
    category: "roofing",
    latitude: 41.22,
    longitude: -111.97,
    street: "100 Test Street",
    city: "Ogden",
    state: "Utah",
    postalCode: "84401",
    phone: input.phone,
    email: null,
    websiteUrl: input.websiteUrl,
    sourceLocator: `https://example.test/${input.externalId}`,
    retrievedAt: "2026-08-26T23:00:00.000Z",
    contentHash: input.externalId.padEnd(64, "0").slice(0, 64),
    metadata: { city: "Ogden", state: "Utah", adapterVersion: "mock-v1" },
  };
}
