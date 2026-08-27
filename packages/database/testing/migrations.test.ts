/**
 * Migration replay: the full ordered history builds an empty database and
 * produces the expected schema surface.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "kysely";
import { createTestDatabase, type TestDatabase } from "./harness.ts";

let ctx: TestDatabase;

before(async () => {
  ctx = await createTestDatabase();
});

after(async () => {
  await ctx.destroy();
});

const EXPECTED_TABLES = [
  "business",
  "business_identifier",
  "contact",
  "contact_method",
  "source",
  "source_record",
  "observation",
  "operator_override",
  "resolved_fact",
  "entity_match_candidate",
  "merge_record",
  "domain",
  "website",
  "website_domain",
  "business_website",
  "website_snapshot",
  "website_analysis",
  "website_analysis_snapshot",
  "prospect",
  "prospect_state_transition",
  "feature_definition",
  "feature_set",
  "feature_set_value",
  "feature_set_lineage",
  "scoring_version",
  "lead_score",
  "score_component",
  "decision",
  "decision_reason",
  "demo_template",
  "demo_template_version",
  "demo",
  "demo_version",
  "demo_public_locator",
  "outreach_campaign",
  "outreach_sequence",
  "outreach_sequence_version",
  "campaign_enrollment",
  "conversation",
  "message",
  "message_attempt",
  "suppression",
  "experiment",
  "variant",
  "experiment_assignment",
  "experiment_exposure",
  "customer",
  "subscription",
  "purchase",
  "refund",
  "cost_entry",
  "event_type",
  "event",
  // Phase 10 demo lifecycle, hosting, and operator runs.
  "demo_version_qa_result",
  "demo_version_review",
  "demo_asset",
  "demo_publication",
  "operator_run",
  "operator_run_target",
];

test("replaying the migration history creates every ADR-004 table", async () => {
  const result = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `.execute(ctx.db);
  const tables = new Set(result.rows.map((r) => r.tablename));
  for (const table of EXPECTED_TABLES) {
    assert.ok(tables.has(table), `missing table: ${table}`);
  }
  assert.equal(tables.size, EXPECTED_TABLES.length + 1, "unexpected extra tables (beyond pgmigrations)");
});

test("the initial canonical event registry is seeded", async () => {
  const rows = await ctx.db.selectFrom("event_type").select(["name", "category"]).execute();
  assert.equal(rows.length, 39);
  const byName = new Map(rows.map((r) => [r.name, r.category]));
  assert.equal(byName.get("demo_view"), "analytics");
  assert.equal(byName.get("email_delivered"), "domain");
  assert.equal(byName.get("suppression_removed"), "audit");
  // Phase 10 demo lifecycle events.
  assert.equal(byName.get("demo_generated"), "domain");
  assert.equal(byName.get("demo_approved"), "domain");
  assert.equal(byName.get("demo_rejected"), "domain");
  assert.equal(byName.get("demo_qa_failed"), "audit");
  assert.equal(byName.get("acquisition_run_started"), "audit");
  assert.equal(byName.get("retry_requested"), "audit");
});
