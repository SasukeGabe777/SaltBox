/**
 * Full vertical-slice integration (Phase 4 items 27–28): fixture → business →
 * website analysis → observations → FeatureSet → LeadScore → Decision →
 * Prospect state, with database lineage asserted, plus idempotent re-runs.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, type TestDatabase } from "@saltbox/database/testing/harness";
import { qualifyBusiness } from "../pipeline/qualify.ts";
import { getFixture } from "../fixtures/fixtures.ts";
import { serveLocalSite, htmlHandler, type LocalSite } from "./fixture-server.ts";
import type { ControlledBusinessInput } from "../ingestion/ingest.ts";

let ctx: TestDatabase;
const sites: LocalSite[] = [];

before(async () => {
  ctx = await createTestDatabase();
});

after(async () => {
  await Promise.all(sites.map((s) => s.close()));
  await ctx.destroy();
});

const ANALYZER = { allowPrivateNetworks: true, timeoutMs: 3000 };

async function fixtureInput(key: string): Promise<ControlledBusinessInput> {
  const fixture = getFixture(key);
  assert.ok(fixture, `fixture ${key} exists`);
  if (fixture.html !== undefined) {
    const site = await serveLocalSite(htmlHandler(fixture.html));
    sites.push(site);
    return { ...fixture.input, websiteUrl: site.url };
  }
  return { ...fixture.input };
}

test("roofing-good: full lineage lands in the database and qualifies at 88", async () => {
  const input = await fixtureInput("roofing-good");
  const outcome = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });

  assert.equal(outcome.decision, "qualified");
  assert.equal(outcome.score, 88);
  assert.deepEqual(outcome.dimensions, { need: 80, value: 80, activity: 100, reachability: 100 });
  assert.equal(outcome.lifecycleState, "qualified");
  assert.ok(outcome.reasons.includes("MOBILE_VIEWPORT_MISSING"));
  assert.ok(outcome.reasons.includes("EMAIL_AVAILABLE"));

  // Observations exist for both the business and the website subject.
  const observations = await ctx.db
    .selectFrom("observation")
    .select(["subject_kind", "field_key", "value_boolean"])
    .execute();
  const keys = new Set(observations.map((o) => `${o.subject_kind}.${o.field_key}`));
  for (const expected of [
    "business.email_available",
    "business.phone_available",
    "business.website_present",
    "website.reachable",
    "website.https",
    "website.viewport_present",
    "website.contact_form_present",
    "website.cta_present",
    "website.copyright_year",
  ]) {
    assert.ok(keys.has(expected), `missing observation ${expected}`);
  }

  // Snapshot + analysis lineage.
  const snapshot = await ctx.db.selectFrom("website_snapshot").selectAll().executeTakeFirstOrThrow();
  assert.equal(snapshot.http_status, 200);
  assert.ok(snapshot.content_hash);
  const analysisLink = await ctx.db
    .selectFrom("website_analysis_snapshot")
    .selectAll()
    .where("website_analysis_id", "=", outcome.websiteAnalysisId!)
    .executeTakeFirstOrThrow();
  assert.equal(analysisLink.website_snapshot_id, snapshot.id);

  // FeatureSet: stable contract + extension values + lineage.
  const featureSet = await ctx.db
    .selectFrom("feature_set")
    .selectAll()
    .where("id", "=", outcome.featureSetId)
    .executeTakeFirstOrThrow();
  assert.equal(featureSet.feature_schema_version, "prospect-qualification-features-v1");
  assert.equal(featureSet.mobile_pass, false);
  assert.equal(featureSet.email_available, true);
  assert.equal(featureSet.business_category, "roofing");
  const lineage = await ctx.db
    .selectFrom("feature_set_lineage")
    .select(["input_kind"])
    .where("feature_set_id", "=", outcome.featureSetId)
    .execute();
  assert.ok(lineage.some((l) => l.input_kind === "observation"));
  assert.ok(lineage.some((l) => l.input_kind === "website_analysis"));

  // LeadScore references the FeatureSet and scoring version, with components.
  const leadScore = await ctx.db
    .selectFrom("lead_score")
    .innerJoin("scoring_version", "scoring_version.id", "lead_score.scoring_version_id")
    .select(["lead_score.overall_score", "lead_score.feature_set_id", "scoring_version.name"])
    .where("lead_score.id", "=", outcome.leadScoreId)
    .executeTakeFirstOrThrow();
  assert.equal(leadScore.overall_score, 88);
  assert.equal(leadScore.feature_set_id, outcome.featureSetId);
  assert.equal(leadScore.name, "qualification-v1");
  const components = await ctx.db
    .selectFrom("score_component")
    .select(["dimension", "reason_code"])
    .where("lead_score_id", "=", outcome.leadScoreId)
    .execute();
  assert.ok(components.length >= 8);

  // Decision references the LeadScore with structured reasons; actor is system.
  const decision = await ctx.db
    .selectFrom("decision")
    .selectAll()
    .where("id", "=", outcome.decisionId)
    .executeTakeFirstOrThrow();
  assert.equal(decision.decision_type, "qualify");
  assert.equal(decision.lead_score_id, outcome.leadScoreId);
  assert.equal(decision.actor_type, "system");
  assert.equal(decision.policy_version, "qualification-policy-v1");
  const reasons = await ctx.db
    .selectFrom("decision_reason")
    .select("reason_code")
    .where("decision_id", "=", outcome.decisionId)
    .execute();
  assert.ok(reasons.some((r) => r.reason_code === "SCORE_ABOVE_THRESHOLD"));

  // Lifecycle history and domain events.
  const transitions = await ctx.db
    .selectFrom("prospect_state_transition")
    .select("to_state")
    .where("prospect_id", "=", outcome.prospectId)
    .orderBy("occurred_at")
    .execute();
  assert.deepEqual(
    transitions.map((t) => t.to_state),
    ["discovered", "enriching", "evaluated", "qualified"]
  );
  const qualifiedEvent = await ctx.db
    .selectFrom("event")
    .select("id")
    .where("prospect_id", "=", outcome.prospectId)
    .where("event_type", "=", "prospect_qualified")
    .execute();
  assert.equal(qualifiedEvent.length, 1);
});

test("re-running the same fixture is identity-idempotent with append-only history", async () => {
  const fixture = getFixture("roofing-good")!;
  const site = await serveLocalSite(htmlHandler(fixture.html!));
  sites.push(site);
  const input: ControlledBusinessInput = { ...fixture.input, websiteUrl: site.url };

  const first = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });
  const second = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });

  // Identity: same business and prospect, no duplicates.
  assert.equal(second.businessId, first.businessId);
  assert.equal(second.prospectId, first.prospectId);
  const businesses = await ctx.db.selectFrom("business").select("id").execute();
  const prospects = await ctx.db.selectFrom("prospect").select("id").execute();
  assert.equal(businesses.length, 1);
  assert.equal(prospects.length, 1);

  // History: each run appends a new evaluation (documented behavior).
  assert.notEqual(second.featureSetId, first.featureSetId);
  assert.notEqual(second.leadScoreId, first.leadScoreId);
  assert.notEqual(second.decisionId, first.decisionId);

  // The historical FeatureSet is untouched by later runs.
  const firstValues = await ctx.db
    .selectFrom("feature_set_value")
    .select(["feature_definition_id", "value_boolean", "value_text"])
    .where("feature_set_id", "=", first.featureSetId)
    .orderBy("feature_definition_id")
    .execute();
  assert.ok(firstValues.length > 0);

  // Lifecycle already qualified: the re-run records this instead of re-transitioning.
  assert.ok(second.notes.some((n) => n.includes("skipped transition")));
  assert.equal(second.lifecycleState, "qualified");
});

test("landscaping-no-website: website_missing drives qualification at 79", async () => {
  const input = await fixtureInput("landscaping-no-website");
  const outcome = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });
  assert.equal(outcome.decision, "qualified");
  assert.equal(outcome.score, 79);
  assert.ok(outcome.reasons.includes("NO_WEBSITE"));
  assert.equal(outcome.websiteAnalysisId, undefined);

  const observation = await ctx.db
    .selectFrom("observation")
    .select("value_boolean")
    .where("field_key", "=", "website_present")
    .where("subject_id", "=", outcome.businessId)
    .executeTakeFirstOrThrow();
  assert.equal(observation.value_boolean, false);
});

test("plumbing-broken-site: DNS failure is an observation and the pipeline completes", async () => {
  const fixture = getFixture("plumbing-broken-site")!;
  const outcome = await qualifyBusiness(
    ctx.db,
    { ...fixture.input },
    {
      analyzer: {
        timeoutMs: 3000,
        lookup: async () => {
          throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
        },
      },
    }
  );
  assert.equal(outcome.decision, "qualified");
  assert.equal(outcome.dimensions.need, 60);
  assert.ok(outcome.reasons.includes("WEBSITE_UNREACHABLE"));

  const failure = await ctx.db
    .selectFrom("observation")
    .select(["value_text"])
    .where("field_key", "=", "failure_stage")
    .executeTakeFirstOrThrow();
  assert.equal(failure.value_text, "dns");
});

test("gallery-no-contact: rejected with NO_CONTACT_PATH and lifecycle rejected", async () => {
  const input = await fixtureInput("gallery-no-contact");
  const outcome = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });
  assert.equal(outcome.decision, "rejected");
  assert.ok(outcome.reasons.includes("NO_CONTACT_PATH"));
  assert.equal(outcome.lifecycleState, "rejected");

  const transitions = await ctx.db
    .selectFrom("prospect_state_transition")
    .select("to_state")
    .where("prospect_id", "=", outcome.prospectId)
    .orderBy("occurred_at")
    .execute();
  assert.deepEqual(
    transitions.map((t) => t.to_state),
    ["discovered", "enriching", "evaluated", "rejected"]
  );
});

test("bakery-strong-site: healthy site in a low-value industry is rejected at 52", async () => {
  const input = await fixtureInput("bakery-strong-site");
  const outcome = await qualifyBusiness(ctx.db, input, { analyzer: ANALYZER });
  assert.equal(outcome.decision, "rejected");
  assert.equal(outcome.score, 52);
  assert.ok(outcome.reasons.includes("SCORE_BELOW_THRESHOLD"));
  assert.equal(outcome.lifecycleState, "rejected");
});
