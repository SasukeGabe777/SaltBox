/**
 * Visual/behavioural QA for a generated demo:
 *
 *   pnpm demo:qa --token <public-locator> [--mode preview|public] [--no-persist]
 *
 * The checks live in qa/run-qa.ts so the admin can run exactly the same pass.
 * By default the result is persisted as append-only QA evidence against the
 * exact DemoVersion that was rendered, which is what the approval gate reads.
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { persistDemoQaResult } from "@saltbox/demo-generation/qa";
import { QA_TOKEN_PATTERN, runDemoQa } from "../qa/run-qa.ts";

const { values } = parseArgs({
  options: {
    token: { type: "string", short: "t" },
    mode: { type: "string", default: "preview" },
    "no-persist": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
if (values.help || !values.token || !QA_TOKEN_PATTERN.test(values.token)) {
  console.error("Usage: pnpm demo:qa --token <public-locator> [--mode preview|public] [--no-persist]");
  process.exit(values.help ? 0 : 1);
}
const mode = values.mode === "public" ? "public" : "preview";

const db = createDatabase({ connectionString: resolveDatabaseUrl(), maxConnections: 3 });
console.log(`\nSALTBOX DEMO QA (${mode} resolution)\n`);

try {
  const { report, prospectId, businessId } = await runDemoQa({
    db,
    token: values.token,
    mode,
    log: (line) => console.log(line),
  });

  const failed = report.checks.filter((check) => !check.passed);
  if (report.demoVersionId === "") {
    console.error("\nThis locator did not resolve to a demo version; nothing was persisted.");
    process.exitCode = 1;
  } else if (values["no-persist"]) {
    console.log("\n--no-persist: QA evidence was NOT recorded.");
  } else {
    const { result, evaluation } = await persistDemoQaResult(db, {
      report,
      ...(prospectId ? { prospectId } : {}),
      ...(businessId ? { businessId } : {}),
      actorRef: "demo-qa-cli",
    });
    console.log(`\nRecorded QA result ${result.id} (${evaluation.status}).`);
    if (evaluation.criticalFailures.length > 0) {
      console.log("CRITICAL FAILURES (block approval without an audited override):");
      for (const failure of evaluation.criticalFailures) console.log(`  - ${failure}`);
    }
  }

  console.log(
    `\nQA RESULT: ${failed.length === 0 ? "PASS" : "FAIL"} (${report.checks.length - failed.length}/${report.checks.length} checks)`,
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  await db.destroy();
}
