/**
 * Promote ONE approved demo into another SaltBox environment.
 *
 *   pnpm demos:stage --prospect <uuid> --target-url-file <path> [--dry-run]
 *
 * The hosted renderer reads its own database, so a demo has to exist there
 * before it can be served. This copies the MINIMUM legitimate state for one
 * demo — identity, provenance, qualification lineage, the demo and its
 * append-only versions, QA evidence, review history, and the approval pointer
 * — preserving every id, version number, locator, and timestamp. It is not a
 * database dump: nothing outside the selected prospect is touched.
 *
 * Safety:
 *   - refuses a demo with no operator-approved version;
 *   - inserts only (ON CONFLICT DO NOTHING) and updates only the target
 *     demo's pointers — it never deletes or overwrites unrelated rows;
 *   - reads the target connection string from a file so no credential is
 *     passed on a command line or committed;
 *   - copies no suppression state, so the target cannot silently "lose" a
 *     suppression that exists in the source.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    prospect: { type: "string" },
    "target-url-file": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.prospect || !values["target-url-file"]) {
  console.error("Usage: pnpm demos:stage --prospect <uuid> --target-url-file <path> [--dry-run]");
  process.exit(values.help ? 0 : 1);
}
if (!UUID.test(values.prospect)) {
  console.error("--prospect must be a UUID.");
  process.exit(1);
}

const sourceUrl = process.env.DATABASE_URL ?? "postgres://saltbox:saltbox@localhost:5433/saltbox";
const targetUrl = readFileSync(values["target-url-file"], "utf8").trim();
if (targetUrl === "") {
  console.error("The target URL file is empty.");
  process.exit(1);
}

const source = new pg.Client({ connectionString: sourceUrl });
const target = new pg.Client({ connectionString: targetUrl });
await source.connect();
await target.connect();

const copied: string[] = [];

try {
  const demo = await one<{
    demo_id: string;
    prospect_id: string;
    business_id: string;
    approved_demo_version_id: string | null;
    current_demo_version_id: string | null;
    approved_at: Date | null;
    approved_by_actor_ref: string | null;
    approval_review_id: string | null;
  }>(
    source,
    `SELECT d.id AS demo_id, p.id AS prospect_id, p.business_id, d.approved_demo_version_id,
            d.current_demo_version_id, d.approved_at, d.approved_by_actor_ref, d.approval_review_id
       FROM demo d JOIN prospect p ON p.id = d.prospect_id
      WHERE d.prospect_id = $1 AND d.status NOT IN ('archived','expired')
      ORDER BY d.created_at DESC LIMIT 1`,
    [values.prospect],
  );
  if (!demo) throw new Error(`Prospect ${values.prospect} has no live demo.`);
  if (demo.approved_demo_version_id === null) {
    throw new Error("This demo has no operator-approved version; only approved demos are promoted.");
  }

  console.log(`\nSALTBOX DEMO PROMOTION${values["dry-run"] ? " (dry run)" : ""}`);
  console.log(`demo ${demo.demo_id}\napproved version ${demo.approved_demo_version_id}\n`);

  // Identity and provenance --------------------------------------------------
  await copy("source", `SELECT * FROM source WHERE id IN (SELECT source_id FROM source_record WHERE business_id = $1)`, [demo.business_id]);
  await copy("business", `SELECT * FROM business WHERE id = $1`, [demo.business_id]);
  await copy("domain", `SELECT * FROM domain WHERE id IN (
      SELECT wd.domain_id FROM website_domain wd
       JOIN business_website bw ON bw.website_id = wd.website_id WHERE bw.business_id = $1)`, [demo.business_id]);
  await copy("website", `SELECT * FROM website WHERE id IN (SELECT website_id FROM business_website WHERE business_id = $1)`, [demo.business_id]);
  await copy("website_domain", `SELECT * FROM website_domain WHERE website_id IN (SELECT website_id FROM business_website WHERE business_id = $1)`, [demo.business_id]);
  await copy("business_website", `SELECT * FROM business_website WHERE business_id = $1`, [demo.business_id]);
  await copy("source_record", `SELECT * FROM source_record WHERE business_id = $1`, [demo.business_id]);
  await copy("contact", `SELECT * FROM contact WHERE business_id = $1`, [demo.business_id]);
  await copy("contact_method", `SELECT * FROM contact_method WHERE business_id = $1`, [demo.business_id]);
  await copy("website_analysis", `SELECT * FROM website_analysis WHERE website_id IN (SELECT website_id FROM business_website WHERE business_id = $1)`, [demo.business_id]);

  // Qualification lineage ----------------------------------------------------
  await copy("prospect", `SELECT * FROM prospect WHERE id = $1`, [demo.prospect_id]);
  await copy("scoring_version", `SELECT * FROM scoring_version WHERE id IN (SELECT scoring_version_id FROM lead_score WHERE prospect_id = $1)`, [demo.prospect_id]);
  await copy("feature_set", `SELECT * FROM feature_set WHERE prospect_id = $1`, [demo.prospect_id]);
  await copy("lead_score", `SELECT * FROM lead_score WHERE prospect_id = $1`, [demo.prospect_id]);
  await copy("decision", `SELECT * FROM decision WHERE prospect_id = $1`, [demo.prospect_id]);
  await copy("decision_reason", `SELECT * FROM decision_reason WHERE decision_id IN (SELECT id FROM decision WHERE prospect_id = $1)`, [demo.prospect_id]);

  // The demo itself. Pointers are attached last so the FK order holds.
  await copy("demo_template", `SELECT * FROM demo_template WHERE id IN (
      SELECT dtv.demo_template_id FROM demo_template_version dtv
       JOIN demo_version dv ON dv.demo_template_version_id = dtv.id WHERE dv.demo_id = $1)`, [demo.demo_id]);
  await copy("demo_template_version", `SELECT * FROM demo_template_version WHERE id IN (
      SELECT demo_template_version_id FROM demo_version WHERE demo_id = $1)`, [demo.demo_id]);
  await copy(
    "demo",
    `SELECT * FROM demo WHERE id = $1`,
    [demo.demo_id],
    // Pointers are set after the versions and the review row exist.
    { null: ["current_demo_version_id", "approved_demo_version_id", "approved_at", "approved_by_actor_ref", "approval_review_id"] },
  );
  await copy("demo_version", `SELECT * FROM demo_version WHERE demo_id = $1 ORDER BY version_number`, [demo.demo_id]);
  await copy("demo_public_locator", `SELECT * FROM demo_public_locator WHERE demo_id = $1`, [demo.demo_id]);
  await copy("demo_version_qa_result", `SELECT * FROM demo_version_qa_result WHERE demo_version_id IN (
      SELECT id FROM demo_version WHERE demo_id = $1)`, [demo.demo_id]);
  await copy("demo_version_review", `SELECT * FROM demo_version_review WHERE demo_id = $1 ORDER BY created_at`, [demo.demo_id]);

  if (!values["dry-run"]) {
    await target.query(
      `UPDATE demo SET current_demo_version_id = $2, approved_demo_version_id = $3, approved_at = $4,
                       approved_by_actor_ref = $5, approval_review_id = $6, updated_at = now()
        WHERE id = $1`,
      [
        demo.demo_id,
        demo.current_demo_version_id,
        demo.approved_demo_version_id,
        demo.approved_at,
        demo.approved_by_actor_ref,
        demo.approval_review_id,
      ],
    );
    console.log("  demo pointers: current + approved version attached");
  }

  console.log(`\nPROMOTED\n${copied.join("\n")}`);
  console.log(
    values["dry-run"]
      ? "\nDry run: nothing was written."
      : "\nNext: pnpm demos:publish --demo <id> --environment hosted (against the same target).",
  );
} finally {
  await source.end();
  await target.end();
}

async function one<T>(client: pg.Client, sql: string, params: unknown[]): Promise<T | undefined> {
  const result = await client.query(sql, params);
  return result.rows[0] as T | undefined;
}

/** Copy rows verbatim, preserving every column value (ids, timestamps, JSONB). */
async function copy(
  table: string,
  sql: string,
  params: unknown[],
  options: { null?: string[] } = {},
): Promise<void> {
  const rows = await source.query(sql, params);
  if (rows.rowCount === 0) {
    copied.push(`  ${table}: 0`);
    return;
  }
  const columns = rows.fields.map((field) => field.name);
  if (!values["dry-run"]) {
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      const payload = columns.map((column) => (options.null?.includes(column) ? null : row[column]));
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      await target.query(
        `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
         VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        payload,
      );
    }
  }
  copied.push(`  ${table}: ${rows.rowCount}`);
}
