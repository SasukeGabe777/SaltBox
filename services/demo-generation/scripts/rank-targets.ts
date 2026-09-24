/**
 * Rank prospects by "most obvious wins": how many evidence-backed
 * "what's improved" notes their demo would carry. Uses the exact plan and
 * note builders the demo uses, so the ranking can never promise a win the
 * demo would not (or could not truthfully) show. Read-only; $0.
 *
 *   pnpm demo:rank [--category plumbing] [--min-notes 2] [--all]
 *
 * By default only demo-eligible prospects are listed. Prospects whose latest
 * website analysis predates website-intelligence-v2 are flagged: their
 * absence claims are withheld until re-analyzed (pnpm website:intelligence).
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { LOCAL_SERVICE_CATEGORIES } from "../src/config/demo-v1.ts";
import { evaluateDemoEligibility } from "../src/eligibility.ts";
import { collectDemoSourceFacts } from "../src/facts.ts";
import { buildImprovements } from "../src/improvements.ts";
import { buildDemoPlan } from "../src/plan.ts";

const { values } = parseArgs({
  options: {
    category: { type: "string" },
    "min-notes": { type: "string", default: "0" },
    all: { type: "boolean", default: false },
  },
  strict: true,
});
const minNotes = Number(values["min-notes"]);

const db = createDatabase({ connectionString: resolveDatabaseUrl(), maxConnections: 4 });
try {
  let query = db
    .selectFrom("prospect as p")
    .innerJoin("business as b", "b.id", "p.business_id")
    .select(["p.id", "b.category"])
    .where("b.category", "in", [...LOCAL_SERVICE_CATEGORIES]);
  if (values.category) query = query.where("b.category", "=", values.category);
  const prospects = await query.execute();

  const rows: Array<{ id: string; name: string; category: string; site: string; notes: string[]; eligible: boolean; stale: boolean; demo: string }> = [];
  for (const prospect of prospects) {
    const facts = await collectDemoSourceFacts(db, prospect.id);
    if (!facts) continue;
    const eligibility = evaluateDemoEligibility(facts);
    if (!eligibility.eligible && !values.all) continue;
    let notes: string[] = [];
    try {
      const plan = buildDemoPlan(facts);
      notes = buildImprovements(facts, plan, facts.businessName).map((note) => note.title);
    } catch (error) {
      notes = [`(plan failed: ${error instanceof Error ? error.message : String(error)})`];
    }
    const demo = await db
      .selectFrom("demo")
      .select(["approved_demo_version_id"])
      .where("prospect_id", "=", prospect.id)
      .executeTakeFirst();
    rows.push({
      id: prospect.id,
      name: facts.businessName,
      category: prospect.category ?? "",
      site: facts.websiteUrl ?? "(no website)",
      notes,
      eligible: eligibility.eligible,
      stale: facts.intelligence !== undefined && facts.intelligence.analyzerVersion !== "website-intelligence-v2",
      demo: demo ? (demo.approved_demo_version_id ? "approved" : "generated") : "-",
    });
  }

  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.notes.length - a.notes.length || a.name.localeCompare(b.name));
  console.log(`\nSALTBOX TARGET RANKING — most obvious wins first (${rows.length} prospects)\n`);
  for (const row of rows.filter((entry) => entry.notes.length >= minNotes)) {
    const flags = [row.eligible ? "" : "INELIGIBLE", row.stale ? "STALE-ANALYSIS" : "", `demo:${row.demo}`].filter(Boolean).join(" ");
    console.log(`${String(row.notes.length).padStart(2)} wins  ${row.name} [${row.category}] ${row.site}  ${flags}`);
    console.log(`          ${row.id}`);
    if (row.notes.length > 0) console.log(`          ${row.notes.join(" · ")}`);
  }
} finally {
  await db.destroy();
}
