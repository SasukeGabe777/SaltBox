import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpenStreetMapOverpassAdapter,
  type OpenStreetMapAdapterOptions,
} from "../src/adapters/openstreetmap.ts";
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
  radiusKm: 15,
  limit: 2,
  source: "openstreetmap",
};

test("location resolution uses identifying headers and caches one successful lookup per run", async () => {
  const calls: Array<{ url: string; userAgent: string | null }> = [];
  const adapter = new OpenStreetMapOverpassAdapter({
    fetch: (async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), userAgent: headers.get("user-agent") });
      return jsonResponse([
        {
          place_id: 123,
          osm_type: "relation",
          osm_id: 987,
          lat: "41.223",
          lon: "-111.9738",
          display_name: LOCATION.displayName,
          address: { city: "Ogden", state: "Utah", country_code: "us" },
        },
      ]);
    }) as typeof fetch,
    userAgent: "SaltBox-Test/1.0 (+https://example.test/contact)",
  });

  const first = await adapter.resolveLocation("Ogden, UT");
  const second = await adapter.resolveLocation("  OGDEN, UT  ");
  assert.equal(first.latitude, LOCATION.latitude);
  assert.equal(first.city, "Ogden");
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userAgent, "SaltBox-Test/1.0 (+https://example.test/contact)");
  assert.match(calls[0]?.url ?? "", /limit=1/);
});

test("location resolution reports a missing location as a source failure", async () => {
  const adapter = adapterWithResponse(jsonResponse([]));
  await assert.rejects(
    adapter.resolveLocation("Not A Real Place"),
    (error: unknown) => error instanceof DiscoverySourceError && error.code === "location_not_found",
  );
});

test("Overpass normalizes stable identities, bounded metadata, deduplicates, and enforces the result limit", async () => {
  let postedBody = "";
  const adapter = new OpenStreetMapOverpassAdapter({
    fetch: (async (_input, init) => {
      postedBody = String(init?.body ?? "");
      return jsonResponse({
        osm3s: { timestamp_osm_base: "2026-08-26T23:00:00Z" },
        elements: [
          {
            type: "node",
            id: 101,
            lat: 41.22,
            lon: -111.97,
            tags: {
              name: "Alpha Roofing",
              craft: "roofer",
              website: "alpha.example",
              phone: "+1 801 555 0101",
              "addr:city": "Ogden",
              irrelevant_giant_provider_field: "x".repeat(10_000),
            },
          },
          { type: "node", id: 101, lat: 41.22, lon: -111.97, tags: { name: "Duplicate Alpha" } },
          {
            type: "way",
            id: 202,
            center: { lat: 41.23, lon: -111.98 },
            tags: { name: "Beta Roofing", craft: "roofer", "contact:email": "info@beta.example" },
          },
          { type: "relation", id: 303, center: { lat: 41.24, lon: -111.99 }, tags: { name: "Over Limit" } },
        ],
      });
    }) as typeof fetch,
    maxOverpassRetries: 0,
  });

  const batch = await adapter.discover(QUERY, LOCATION);
  assert.equal(batch.candidates.length, 2);
  assert.deepEqual(batch.candidates.map((candidate) => candidate.externalId), ["node/101", "way/202"]);
  assert.equal(batch.candidates[0]?.websiteUrl, "https://alpha.example/");
  assert.equal(batch.candidates[0]?.city, "Ogden");
  assert.equal(batch.candidates[0]?.metadata.irrelevant_giant_provider_field, undefined);
  assert.equal(batch.candidates[0]?.metadata.adapterVersion, "openstreetmap-overpass-v1");
  const postedQuery = new URLSearchParams(postedBody).get("data") ?? "";
  assert.match(postedQuery, /craft/);
  assert.match(postedQuery, /around:15000/);
  assert.match(postedQuery, /out center 2/);
  // Regression: a small [maxsize:...] starves Overpass of working memory and it
  // reports "runtime error ... out of memory" with an empty elements array.
  assert.doesNotMatch(postedQuery, /maxsize/);
});

test("an Overpass runtime-error remark with an empty elements array is a source failure, not an empty batch", async () => {
  // Exact live failure shape observed for restaurant/Ogden: HTTP 200, empty
  // elements, and the error reported only through the "remark" field.
  const adapter = adapterWithResponse(
    jsonResponse({
      osm3s: { timestamp_osm_base: "2026-08-27T01:50:01Z" },
      remark: 'runtime error: Query ran out of memory in "query" at line 2. It would need at least 2 MB of RAM to continue.',
      elements: [],
    }),
  );
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) =>
      error instanceof DiscoverySourceError &&
      error.code === "provider_server_error" &&
      /out of memory/.test(error.message),
  );
});

test("an Overpass timed-out remark is classified as a provider timeout", async () => {
  const adapter = adapterWithResponse(
    jsonResponse({
      remark: 'runtime error: Query timed out in "query" at line 2 after 26 seconds.',
      elements: [],
    }),
  );
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) => error instanceof DiscoverySourceError && error.code === "provider_timeout",
  );
});

test("Overpass returns a valid empty batch for no matching source records", async () => {
  const adapter = adapterWithResponse(jsonResponse({ elements: [], osm3s: {} }));
  const batch = await adapter.discover(QUERY, LOCATION);
  assert.deepEqual(batch.candidates, []);
});

test("malformed individual source records are ignored without inventing identity", async () => {
  const adapter = adapterWithResponse(
    jsonResponse({
      elements: [
        { type: "node", id: 1, lat: 1, lon: 2, tags: {} },
        { type: "node", id: "not-numeric", lat: 1, lon: 2, tags: { name: "Bad ID" } },
        { type: "unknown", id: 2, lat: 1, lon: 2, tags: { name: "Bad Type" } },
      ],
    }),
  );
  assert.deepEqual((await adapter.discover(QUERY, LOCATION)).candidates, []);
});

test("a malformed provider envelope is a source failure", async () => {
  const adapter = adapterWithResponse(jsonResponse({ unexpected: true }));
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) => error instanceof DiscoverySourceError && error.code === "malformed_response",
  );
});

test("provider timeout is classified separately", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const adapter = new OpenStreetMapOverpassAdapter({
    fetch: (async () => Promise.reject(timeout)) as typeof fetch,
    maxOverpassRetries: 0,
  });
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) => error instanceof DiscoverySourceError && error.code === "provider_timeout",
  );
});

test("HTTP 429 is classified as rate limiting without rotating providers", async () => {
  const adapter = adapterWithResponse(new Response("slow down", { status: 429 }));
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) =>
      error instanceof DiscoverySourceError && error.code === "rate_limited" && error.status === 429,
  );
});

test("provider server failures are classified separately", async () => {
  const adapter = adapterWithResponse(new Response("unavailable", { status: 503 }));
  await assert.rejects(
    adapter.discover(QUERY, LOCATION),
    (error: unknown) =>
      error instanceof DiscoverySourceError && error.code === "provider_server_error" && error.status === 503,
  );
});

function adapterWithResponse(response: Response, options: OpenStreetMapAdapterOptions = {}) {
  return new OpenStreetMapOverpassAdapter({
    ...options,
    fetch: (async () => response.clone()) as typeof fetch,
    maxOverpassRetries: 0,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
