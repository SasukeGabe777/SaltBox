/**
 * Operator parameter validation: the admin submits a small form, never shell
 * arguments, and the same safe bounds the CLI enforces apply here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ACQUIRE_CONCURRENCY,
  DEFAULT_ACQUIRE_LIMIT,
  MAX_ACQUIRE_CONCURRENCY,
  MAX_ACQUIRE_LIMIT,
} from "@saltbox/discovery/acquire-v2";
import {
  DEFAULT_ACQUISITION_CONCURRENCY,
  DEFAULT_ACQUISITION_LIMIT,
  MAX_ACQUISITION_CONCURRENCY,
  MAX_ACQUISITION_LIMIT,
  parseAcquisitionParameters,
  parseDemoGenerateParameters,
  parseDemoPublishParameters,
  parseProspectScopedParameters,
  requestKeyFor,
  supportedAcquisitionCategories,
} from "../src/parameters.ts";

const PROSPECT = "0199a1f0-1111-7000-8000-000000000001";

test("acquisition bounds mirror the discovery pipeline's own limits", () => {
  assert.equal(MAX_ACQUISITION_LIMIT, MAX_ACQUIRE_LIMIT);
  assert.equal(MAX_ACQUISITION_CONCURRENCY, MAX_ACQUIRE_CONCURRENCY);
  assert.equal(DEFAULT_ACQUISITION_LIMIT, DEFAULT_ACQUIRE_LIMIT);
  assert.equal(DEFAULT_ACQUISITION_CONCURRENCY, DEFAULT_ACQUIRE_CONCURRENCY);
});

test("a valid acquisition request parses with safe defaults", () => {
  const parsed = parseAcquisitionParameters({ category: "Roofing", location: " Ogden, UT " });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    kind: "acquisition",
    category: "roofing",
    location: "Ogden, UT",
    radiusKm: 10,
    limit: DEFAULT_ACQUISITION_LIMIT,
    source: "overture",
    concurrency: DEFAULT_ACQUISITION_CONCURRENCY,
  });
  assert.ok(supportedAcquisitionCategories("all").includes("roofing"));
});

test("hard maximums and unsupported inputs are rejected before a run exists", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ category: "roofing", location: "Ogden, UT", limit: 50 }, "limit"],
    [{ category: "roofing", location: "Ogden, UT", radiusKm: 500 }, "radiusKm"],
    [{ category: "roofing", location: "Ogden, UT", concurrency: 8 }, "concurrency"],
    [{ category: "cryptocurrency", location: "Ogden, UT" }, "category"],
    [{ category: "roofing", location: "" }, "location"],
    [{ category: "roofing", location: "x".repeat(200) }, "location"],
    [{ category: "roofing", location: "Ogden, UT", source: "google" }, "source"],
    [{ category: "roofing", location: "Ogden, UT", limit: 2.5 }, "limit"],
  ];
  for (const [raw, field] of cases) {
    const parsed = parseAcquisitionParameters(raw);
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(raw)}`);
    if (parsed.ok) continue;
    assert.ok(
      parsed.errors.some((error) => error.field === field),
      `expected an error on "${field}", got ${JSON.stringify(parsed.errors)}`,
    );
  }
});

test("regeneration accepts only compositions from the committed library", () => {
  const auto = parseDemoGenerateParameters({ prospectId: PROSPECT, composition: "auto", forceRegenerate: "true" });
  assert.equal(auto.ok, true);
  if (auto.ok) {
    assert.equal(auto.value.composition, undefined);
    assert.equal(auto.value.forceRegenerate, true);
    assert.equal(auto.value.runQa, true, "generation is followed by QA by default");
  }

  const bold = parseDemoGenerateParameters({ prospectId: PROSPECT, composition: "bold" });
  assert.equal(bold.ok, true);
  if (bold.ok) assert.equal(bold.value.composition, "bold");

  const invented = parseDemoGenerateParameters({ prospectId: PROSPECT, composition: "neon-brutalist" });
  assert.equal(invented.ok, false);
  if (!invented.ok) assert.equal(invented.errors[0]?.field, "composition");

  const noProspect = parseDemoGenerateParameters({ prospectId: "not-a-uuid" });
  assert.equal(noProspect.ok, false);

  const longReason = parseDemoGenerateParameters({ prospectId: PROSPECT, reason: "x".repeat(500) });
  assert.equal(longReason.ok, false);
});

test("prospect-scoped and publication requests validate their inputs", () => {
  assert.equal(parseProspectScopedParameters("demo_qa", { prospectId: PROSPECT }).ok, true);
  assert.equal(parseProspectScopedParameters("retry_intelligence", { prospectId: "nope" }).ok, false);

  const hosted = parseDemoPublishParameters({ prospectId: PROSPECT, environment: "hosted" });
  assert.equal(hosted.ok, true);
  if (hosted.ok) assert.equal(hosted.value.environment, "hosted");

  assert.equal(parseDemoPublishParameters({ prospectId: PROSPECT, environment: "production" }).ok, false);
  assert.equal(
    parseDemoPublishParameters({ prospectId: PROSPECT, environment: "hosted", baseUrl: "javascript:alert(1)" }).ok,
    false,
  );
});

test("request keys are stable so a double-submitted form cannot start two runs", () => {
  const first = parseAcquisitionParameters({ category: "roofing", location: "Ogden, UT" });
  const second = parseAcquisitionParameters({ category: "roofing", location: "ogden, ut" });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(requestKeyFor(first.value), requestKeyFor(second.value));
  assert.notEqual(
    requestKeyFor(first.value),
    requestKeyFor({ ...first.value, location: "Provo, UT" }),
  );
  assert.equal(requestKeyFor({ kind: "demo_qa", prospectId: PROSPECT }), `demo_qa:${PROSPECT}`);
});
