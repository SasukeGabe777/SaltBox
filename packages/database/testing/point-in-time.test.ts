/**
 * Point-in-time availability-cutoff rules (ADR-004): a historical view may
 * only use facts that were both observed and durably recorded by the cutoff.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, type TestDatabase } from "./harness.ts";
import { createBusiness } from "../repositories/businesses.ts";
import { openProspect } from "../repositories/prospects.ts";
import { recordObservation } from "../repositories/observations.ts";
import { observationsAvailableAt, latestFeatureSetAvailableAt } from "../queries/point-in-time.ts";

let ctx: TestDatabase;
let businessId: string;
let prospectId: string;
let sourceId: string;

before(async () => {
  ctx = await createTestDatabase();
  const business = await createBusiness(ctx.db, { canonicalName: "Chrono Cafe" });
  businessId = business.id;
  const prospect = await openProspect(ctx.db, {
    businessId,
    actorType: "system",
    reasonCode: "prospecting.discovered",
  });
  prospectId = prospect.id;
  const source = await ctx.db
    .insertInto("source")
    .values({ name: "test-registry", source_type: "registry" })
    .returning("id")
    .executeTakeFirstOrThrow();
  sourceId = source.id;
});

after(async () => {
  await ctx.destroy();
});

test("late-recorded backfills are excluded from a historical cutoff view", async () => {
  // Promptly recorded observation.
  await recordObservation(ctx.db, {
    subjectKind: "business",
    subjectId: businessId,
    fieldKey: "review_count",
    value: { kind: "number", value: 100 },
    sourceId,
    observedAt: new Date("2026-01-10T00:00:00Z"),
    recordedAt: new Date("2026-01-10T01:00:00Z"),
  });
  // Backfill: observed before the cutoff, but SaltBox only learned it later.
  await recordObservation(ctx.db, {
    subjectKind: "business",
    subjectId: businessId,
    fieldKey: "review_count",
    value: { kind: "number", value: 137 },
    sourceId,
    observedAt: new Date("2026-01-20T00:00:00Z"),
    recordedAt: new Date("2026-03-01T00:00:00Z"),
  });

  const historical = await observationsAvailableAt(ctx.db, {
    subjectKind: "business",
    subjectId: businessId,
    cutoff: new Date("2026-02-01T00:00:00Z"),
  });
  assert.equal(historical.length, 1);
  assert.equal(historical[0]!.valueNumber, "100");

  const current = await observationsAvailableAt(ctx.db, {
    subjectKind: "business",
    subjectId: businessId,
    cutoff: new Date("2026-04-01T00:00:00Z"),
  });
  assert.equal(current.length, 1);
  assert.equal(current[0]!.valueNumber, "137");
});

test("feature sets respect both as_of and calculated_at cutoffs", async () => {
  await ctx.db
    .insertInto("feature_set")
    .values({
      prospect_id: prospectId,
      feature_schema_version: "features-v1",
      pipeline_version: "pipeline-v1",
      as_of: new Date("2026-01-15T00:00:00Z"),
      calculated_at: new Date("2026-01-15T02:00:00Z"),
      review_count: 100,
    })
    .execute();
  // Later snapshot, calculated after the cutoff (e.g. retrospective rebuild).
  await ctx.db
    .insertInto("feature_set")
    .values({
      prospect_id: prospectId,
      feature_schema_version: "features-v1",
      pipeline_version: "pipeline-v2",
      as_of: new Date("2026-01-25T00:00:00Z"),
      calculated_at: new Date("2026-03-02T00:00:00Z"),
      review_count: 137,
    })
    .execute();

  const historical = await latestFeatureSetAvailableAt(ctx.db, {
    prospectId,
    cutoff: new Date("2026-02-01T00:00:00Z"),
  });
  assert.ok(historical);
  assert.equal(historical.asOf.toISOString(), "2026-01-15T00:00:00.000Z");

  const current = await latestFeatureSetAvailableAt(ctx.db, {
    prospectId,
    cutoff: new Date("2026-04-01T00:00:00Z"),
  });
  assert.ok(current);
  assert.equal(current.asOf.toISOString(), "2026-01-25T00:00:00.000Z");
});
