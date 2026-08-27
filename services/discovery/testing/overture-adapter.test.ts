import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OvertureMapsPlacesAdapter, radiusBoundingBox } from "../src/adapters/overture.ts";
import { OVERTURE_EXTRACT_SCHEMA_VERSION } from "../src/duckdb/overture-local-dataset.ts";
import { DiscoverySourceError } from "../src/errors.ts";
import type { DiscoveryQuery, ResolvedLocation } from "../src/types.ts";

const LOCATION: ResolvedLocation = {
  query: "Ogden, UT",
  displayName: "Ogden, Weber County, Utah, United States",
  latitude: 41.223,
  longitude: -111.9738,
  city: "Ogden",
  state: "Utah",
  countryCode: "us",
  sourceLocator: "https://nominatim.example/search?q=Ogden",
};

const QUERY: DiscoveryQuery = {
  category: "roofing",
  location: "Ogden, UT",
  radiusKm: 10,
  limit: 2,
  source: "overture",
};

function extractRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    external_id: "08f2a5b1234567890abcdef012345678",
    name: "Test Roofing",
    lat: 41.22,
    lon: -111.97,
    category_primary: "roofing",
    confidence: 0.77,
    operating_status: null,
    websites_json: JSON.stringify(["https://test-roofing.example/"]),
    phones_json: JSON.stringify(["+1 801 555 0100"]),
    emails_json: JSON.stringify(["office@test-roofing.example"]),
    address_json: JSON.stringify({ freeform: "100 Main St", locality: "Ogden", region: "UT", postcode: "84401" }),
    sources_json: JSON.stringify([{ property: "", dataset: "meta", record_id: "meta:123" }]),
    ...overrides,
  };
}

/** dataDir with one manifest+parquet stub covering the Ogden query bbox. */
function stubDataDir(): { dataDir: string; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "saltbox-overture-"));
  const bbox = radiusBoundingBox(LOCATION.latitude, LOCATION.longitude, 40);
  writeFileSync(
    join(dataDir, "ogden-test.manifest.json"),
    JSON.stringify({
      schemaVersion: OVERTURE_EXTRACT_SCHEMA_VERSION,
      release: "2026-08-19.0",
      area: "ogden-test",
      bbox,
      rowCount: 4,
      retrievedAt: "2026-08-26T20:00:00.000Z",
    }),
  );
  writeFileSync(join(dataDir, "ogden-test.parquet"), "stub");
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

function adapterWithRows(
  rows: Array<Record<string, unknown>>,
  dataDir: string,
  captured?: { sql?: string },
): OvertureMapsPlacesAdapter {
  return new OvertureMapsPlacesAdapter({
    dataDir,
    executor: {
      async queryRows(sql: string) {
        if (captured) captured.sql = sql;
        return rows;
      },
    },
  });
}

test("overture rows normalize to stable GERS identity with bounded provenance metadata", async () => {
  const stub = stubDataDir();
  try {
    const captured: { sql?: string } = {};
    const adapter = adapterWithRows(
      [
        extractRow({}),
        extractRow({ external_id: "08f2a5b1234567890abcdef012345678", name: "Duplicate Row" }),
        extractRow({
          external_id: "08f2c0ffee4567890abcdef012345678",
          name: "No Contact Roofing",
          lat: 41.24,
          lon: -111.99,
          websites_json: JSON.stringify([]),
          phones_json: JSON.stringify([]),
          emails_json: JSON.stringify(["not-an-email"]),
          address_json: null,
        }),
      ],
      stub.dataDir,
      captured,
    );

    const batch = await adapter.discover(QUERY, LOCATION);
    assert.equal(batch.candidates.length, 2);
    const [first, second] = batch.candidates;
    assert.equal(first?.externalId, "08f2a5b1234567890abcdef012345678");
    assert.equal(first?.name, "Test Roofing");
    assert.equal(first?.websiteUrl, "https://test-roofing.example/");
    assert.equal(first?.phone, "+1 801 555 0100");
    assert.equal(first?.email, "office@test-roofing.example");
    assert.equal(first?.street, "100 Main St");
    assert.equal(first?.city, "Ogden");
    assert.equal(first?.state, "UT");
    assert.equal(first?.category, "roofing");
    assert.equal(first?.metadata.release, "2026-08-19.0");
    assert.equal(first?.metadata.attribution, "Overture Maps Foundation, overturemaps.org");
    assert.equal(first?.metadata.confidence, 0.77);
    // Row without provider address/contact falls back to the resolved location.
    assert.equal(second?.externalId, "08f2c0ffee4567890abcdef012345678");
    assert.equal(second?.websiteUrl, null);
    assert.equal(second?.email, null);
    assert.equal(second?.city, "Ogden");
    assert.equal(second?.state, "Utah");
    // The generated query targets the local extract with mapped category codes.
    assert.match(captured.sql ?? "", /read_parquet\('.*ogden-test\.parquet'\)/);
    assert.match(captured.sql ?? "", /'roofing'/);
    assert.match(captured.sql ?? "", /'ceiling_and_roofing_repair_and_service'/);
    assert.match(captured.sql ?? "", /LIMIT 2000/);
  } finally {
    stub.cleanup();
  }
});

test("overture results outside the requested radius and permanently closed places are excluded", async () => {
  const stub = stubDataDir();
  try {
    const adapter = adapterWithRows(
      [
        extractRow({ external_id: "08f2aaaa000000000000000000000001", name: "In Radius" }),
        // ~28 km north of Ogden: inside the extract bbox, outside the 10 km query.
        extractRow({ external_id: "08f2aaaa000000000000000000000002", name: "Too Far", lat: 41.48, lon: -111.97 }),
        extractRow({
          external_id: "08f2aaaa000000000000000000000003",
          name: "Closed Roofing",
          operating_status: "permanently_closed",
        }),
      ],
      stub.dataDir,
    );
    const batch = await adapter.discover({ ...QUERY, limit: 10 }, LOCATION);
    assert.deepEqual(
      batch.candidates.map((candidate) => candidate.name),
      ["In Radius"],
    );
  } finally {
    stub.cleanup();
  }
});

test("an empty extract result is a valid empty batch", async () => {
  const stub = stubDataDir();
  try {
    const adapter = adapterWithRows([], stub.dataDir);
    const batch = await adapter.discover(QUERY, LOCATION);
    assert.deepEqual(batch.candidates, []);
    assert.equal(batch.sourceDataTimestamp, "2026-08-26T20:00:00.000Z");
  } finally {
    stub.cleanup();
  }
});

test("malformed extract rows are skipped without inventing identity", async () => {
  const stub = stubDataDir();
  try {
    const adapter = adapterWithRows(
      [
        extractRow({ external_id: "" }),
        extractRow({ external_id: "short" }),
        extractRow({ name: "" }),
        extractRow({ lat: "not-a-number" }),
      ],
      stub.dataDir,
    );
    assert.deepEqual((await adapter.discover(QUERY, LOCATION)).candidates, []);
  } finally {
    stub.cleanup();
  }
});

test("a missing local extract is a dataset failure, never an empty result", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "saltbox-overture-empty-"));
  try {
    const adapter = adapterWithRows([extractRow({})], dataDir);
    await assert.rejects(
      adapter.discover(QUERY, LOCATION),
      (error: unknown) =>
        error instanceof DiscoverySourceError &&
        error.code === "dataset_unavailable" &&
        /discovery:data/.test(error.message),
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a DuckDB query failure is a source failure, never an empty result", async () => {
  const stub = stubDataDir();
  try {
    const adapter = new OvertureMapsPlacesAdapter({
      dataDir: stub.dataDir,
      executor: {
        async queryRows() {
          throw new Error("IO Error: parquet footer corrupt");
        },
      },
    });
    await assert.rejects(
      adapter.discover(QUERY, LOCATION),
      (error: unknown) =>
        error instanceof DiscoverySourceError &&
        error.code === "provider_request_failed" &&
        /parquet footer corrupt/.test(error.message),
    );
  } finally {
    stub.cleanup();
  }
});

test("an unmapped category is rejected before any dataset access", async () => {
  const adapter = new OvertureMapsPlacesAdapter({
    dataDir: "does-not-exist",
    executor: {
      async queryRows() {
        throw new Error("must not be called");
      },
    },
  });
  await assert.rejects(
    adapter.discover({ ...QUERY, category: "submarine_repair" }, LOCATION),
    (error: unknown) => error instanceof DiscoverySourceError && error.code === "unsupported_category",
  );
});
