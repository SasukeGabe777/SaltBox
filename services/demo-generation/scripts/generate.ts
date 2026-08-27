/**
 * Operator CLI: generate personalized demos for qualified-v2 prospects.
 *
 *   pnpm demo:generate --prospect <uuid>
 *   pnpm demo:generate --latest-qualified [--category roofing] [--limit 1]
 *
 * Defaults are conservative (one prospect). Generation is local-only, uses
 * no AI or paid APIs, and never sends outreach.
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { listProspects } from "@saltbox/database/queries/admin";
import { ELIGIBLE_POLICY_VERSION } from "../src/config/demo-v1.ts";
import {
  DEFAULT_DEMOS_BASE_URL,
  generateDemoForProspect,
  type GenerateDemoResult,
} from "../src/generate.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    prospect: { type: "string", short: "p" },
    "latest-qualified": { type: "boolean", default: false },
    category: { type: "string" },
    limit: { type: "string", default: String(DEFAULT_LIMIT) },
    "force-regenerate": { type: "boolean", default: false },
    "override-ineligible": { type: "string" },
    "base-url": { type: "string", default: process.env.SALTBOX_DEMOS_BASE_URL ?? DEFAULT_DEMOS_BASE_URL },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || (!values.prospect && !values["latest-qualified"])) {
  printUsage();
  process.exit(values.help ? 0 : 1);
}
if (values.prospect && !UUID_PATTERN.test(values.prospect)) fail(`--prospect must be a UUID, got "${values.prospect}".`);
if (values["override-ineligible"] !== undefined && !values.prospect) {
  fail("--override-ineligible requires an explicit --prospect target.");
}
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
  fail(`--limit must be an integer between 1 and ${MAX_LIMIT}.`);
}

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  fail("Refusing to run demo generation against a non-local database.");
}

console.log("\nSALTBOX DEMO GENERATION - PHASE 8");
console.log("Deterministic local-service demos | Cost: $0 | AI: none | Outreach: disabled\n");

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 4 });
let failures = 0;
try {
  const prospectIds: string[] = [];
  if (values.prospect) {
    prospectIds.push(values.prospect);
  } else {
    const filters = {
      status: "qualified" as const,
      ...(values.category !== undefined ? { category: values.category } : {}),
    };
    const qualified = (await listProspects(db, filters)).filter(
      (item) => item.decision === "qualified" && item.policyVersion === ELIGIBLE_POLICY_VERSION,
    );
    for (const item of qualified.slice(0, limit)) prospectIds.push(item.prospectId);
    if (prospectIds.length === 0) {
      console.log(`No prospects with a latest qualified ${ELIGIBLE_POLICY_VERSION} decision matched.`);
    }
  }

  for (const prospectId of prospectIds) {
    console.log(`PROSPECT ${prospectId}`);
    try {
      const result = await generateDemoForProspect(db, prospectId, {
        ...(values["force-regenerate"] ? { forceRegenerate: true } : {}),
        ...(values["override-ineligible"] !== undefined
          ? { overrideIneligible: { note: values["override-ineligible"] || "operator controlled-testing override" } }
          : {}),
        baseUrl: values["base-url"]!,
        log: (stage, detail) => console.log(`  ${stage}${detail ? ` ${JSON.stringify(detail)}` : ""}`),
      });
      printResult(result);
      if (result.status === "ineligible" || result.status === "not_found") failures += 1;
    } catch (error) {
      failures += 1;
      console.error(`  FAILED | ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("");
  }
} finally {
  await db.destroy();
}
process.exitCode = failures > 0 ? 1 : 0;

function printResult(result: GenerateDemoResult) {
  if (result.status === "not_found") {
    console.log("  RESULT   not found");
    return;
  }
  if (result.status === "ineligible") {
    console.log("  RESULT   ineligible");
    for (const reason of result.eligibility.reasons) {
      console.log(`           ${reason.code}${reason.overridable ? " (overridable)" : ""}: ${reason.detail}`);
    }
    return;
  }
  const { summary } = result;
  console.log(`  RESULT   ${result.status === "generated" ? "demo generated" : "unchanged (existing version reused)"}`);
  console.log(`  BUSINESS ${summary.businessName}`);
  console.log(`  TEMPLATE ${summary.templateName}@${summary.templateVersion}`);
  console.log(`  VERSION  ${summary.versionNumber} (${summary.demoVersionId})`);
  console.log(`  FIXES    ${summary.deficiencyCodes.length > 0 ? summary.deficiencyCodes.join(", ") : "none recorded"}`);
  console.log(`  URL      ${summary.url}`);
  console.log("           (start the renderer with: pnpm demos:dev)");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.error(
    "Usage:\n" +
      "  pnpm demo:generate --prospect <uuid> [--force-regenerate] [--override-ineligible [note]]\n" +
      `  pnpm demo:generate --latest-qualified [--category <category>] [--limit ${DEFAULT_LIMIT}]\n\n` +
      `Safe limits: max ${MAX_LIMIT} demos per run. Only latest ${ELIGIBLE_POLICY_VERSION} qualified prospects\n` +
      "are eligible by default; --override-ineligible is a controlled-testing bypass that never\n" +
      "clears suppression and never changes qualification history. No outreach is ever sent.",
  );
}
