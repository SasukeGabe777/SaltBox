import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { DEFAULT_DISCOVERY_USER_AGENT, OpenStreetMapOverpassAdapter } from "../src/adapters/openstreetmap.ts";
import { OvertureMapsPlacesAdapter } from "../src/adapters/overture.ts";
import {
  DEFAULT_ACQUIRE_CONCURRENCY,
  DEFAULT_ACQUIRE_LIMIT,
  MAX_ACQUIRE_CONCURRENCY,
  MAX_ACQUIRE_LIMIT,
  discoverAndAcquireV2,
  type AcquireV2RunResult,
} from "../src/application/acquire-v2.ts";
import { getOsmCategoryMapping, supportedDiscoveryCategories } from "../src/config/osm-category-mapping-v1.ts";
import { getOvertureCategoryMapping, supportedOvertureCategories } from "../src/config/overture-category-mapping-v1.ts";
import type { DiscoveryResult, DiscoverySourceAdapter } from "../src/types.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SUPPORTED_SOURCES = ["openstreetmap", "overture", "all"] as const;
const ARTIFACT_ROOT = resolve(process.cwd(), "../../.data/website-intelligence");

const { values } = parseArgs({
  options: {
    category: { type: "string", short: "c" },
    location: { type: "string", short: "l" },
    "radius-km": { type: "string", default: "10" },
    limit: { type: "string", default: String(DEFAULT_ACQUIRE_LIMIT) },
    source: { type: "string", default: "overture" },
    concurrency: { type: "string", default: String(DEFAULT_ACQUIRE_CONCURRENCY) },
    strict: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.category || !values.location) {
  printUsage();
  process.exit(values.help ? 0 : 1);
}

const source = values.source!.trim().toLowerCase();
const category = values.category.trim().toLowerCase();
if (!(SUPPORTED_SOURCES as readonly string[]).includes(source)) fail(`Unsupported --source ${source}.`);
const radiusKm = integerOption("radius-km", values["radius-km"]!, 1, 25);
const limit = integerOption("limit", values.limit!, 1, MAX_ACQUIRE_LIMIT);
const concurrency = integerOption("concurrency", values.concurrency!, 1, MAX_ACQUIRE_CONCURRENCY);

const supportsOsm = getOsmCategoryMapping(category) !== undefined;
const supportsOverture = getOvertureCategoryMapping(category) !== undefined;
if (source === "openstreetmap" && !supportsOsm) fail(`Unsupported OpenStreetMap category ${category}.`);
if (source === "overture" && !supportsOverture) fail(`Unsupported Overture category ${category}.`);
if (source === "all" && !supportsOsm && !supportsOverture) fail(`Category ${category} is unsupported by both sources.`);

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  fail("Refusing to run acquisition against a non-local database.");
}

const adapters: DiscoverySourceAdapter[] = [];
if ((source === "openstreetmap" || source === "all") && supportsOsm) {
  adapters.push(new OpenStreetMapOverpassAdapter({ userAgent: process.env.SALTBOX_DISCOVERY_USER_AGENT ?? DEFAULT_DISCOVERY_USER_AGENT }));
}
if ((source === "overture" || source === "all") && supportsOverture) adapters.push(new OvertureMapsPlacesAdapter());

console.log("\nSALTBOX ACQUIRE - DEEP-INTELLIGENCE QUALIFICATION V2");
console.log(`${values.location} | ${category}`);
console.log(`Sources: ${adapters.map((adapter) => adapter.source).join(" + ")}`);
console.log(`Radius: ${radiusKm} km | Limit: ${limit} per source | Deep concurrency: ${concurrency}`);
console.log("Cost: $0 | Outreach: disabled\n");

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 8 });
const runs: AcquireV2RunResult[] = [];
let systemFailure = false;
try {
  for (const adapter of adapters) {
    console.log(`SOURCE: ${adapter.source}\n`);
    try {
      const run = await discoverAndAcquireV2(
        db,
        { category, location: values.location, radiusKm, limit, source: adapter.source },
        adapter,
        {
          concurrency,
          artifactForCandidate: artifactLocation,
          log: operatorLog,
        },
      );
      runs.push(run);
      printSummary(run);
      if (run.status === "failed") systemFailure = true;
    } catch (error) {
      systemFailure = true;
      console.error(`SYSTEM/BATCH FAILURE (${adapter.source}): ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }

  const targetFailures = runs.reduce((sum, run) => sum + run.targetFailures, 0);
  const status = systemFailure || runs.length === 0
    ? "failed"
    : targetFailures > 0
      ? "completed_with_target_failures"
      : "completed";
  console.log(`\nBATCH RESULT\n${status}`);
  if (targetFailures > 0) {
    console.log("\nTARGET FAILURES");
    for (const result of runs.flatMap((run) => run.results)) {
      if (result.status !== "completed" || !result.outcome.targetFailure) continue;
      console.log(
        `[${result.index}] ${result.candidate.name}: ${result.outcome.intelligenceFailureKind ?? result.outcome.intelligenceStatus}` +
          `${result.outcome.intelligenceFailureCode ? ` (${result.outcome.intelligenceFailureCode})` : ""}` +
          `${result.outcome.intelligenceTransient ? " [transient]" : ""}`,
      );
    }
  }
  console.log(JSON.stringify(runs, null, 2));
  process.exitCode = systemFailure || runs.length === 0 ? 1 : values.strict && targetFailures > 0 ? 2 : 0;
  if (values.strict && targetFailures > 0) console.log("--strict enabled: target failures produce a non-zero exit.");
} finally {
  await db.destroy();
}

function operatorLog(event: string, detail: Record<string, unknown>) {
  console.error(JSON.stringify({ event, ...detail }));
  if (event === "location-resolved") console.log(`Location resolved: ${String(detail.location)}`);
  if (event === "candidates-discovered") console.log(`DISCOVERED ${String(detail.candidateCount)} candidates\n`);
  if (event === "candidate-started") console.log(`[${String(detail.index)}/${String(detail.candidateCount)}] DISCOVERED | ${String(detail.businessName)}`);
  if (event === "pipeline-stage") {
    const stage = String(detail.stage);
    if (["ANALYZING", "INTELLIGENCE COMPLETE", "SCORING V2", "QUALIFIED", "REJECTED"].includes(stage)) {
      const suffix = detail.score === undefined ? "" : ` | score ${String(detail.score)}`;
      console.log(`       ${stage}${suffix}`);
    }
  }
  if (event === "intelligence-progress") console.log(`       ${String(detail.message)}`);
  if (event === "candidate-completed") console.log(`       DONE | ${(Number(detail.elapsedMs) / 1000).toFixed(1)}s\n`);
  if (event === "candidate-failed") console.log(`       SYSTEM FAILURE | ${String(detail.message)}\n`);
}

function artifactLocation(candidate: DiscoveryResult) {
  const slug = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const artifactRef = `${stamp}-${slug || candidate.externalId.slice(0, 8)}`;
  return { artifactRef, artifactDir: resolve(ARTIFACT_ROOT, artifactRef) };
}

function printSummary(run: AcquireV2RunResult) {
  console.log("SUMMARY");
  console.log(`Status             ${run.status}`);
  console.log(`Discovered         ${run.discovered}`);
  console.log(`Analyzed           ${run.analyzed}`);
  console.log(`Qualified          ${run.qualified}`);
  console.log(`Rejected           ${run.rejected}`);
  console.log(`Target failures    ${run.targetFailures}`);
  console.log(`System failures    ${run.systemFailures}`);
  console.log(`Elapsed            ${(run.elapsedMs / 1000).toFixed(1)}s\n`);
}

function integerOption(name: string, raw: string, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) fail(`--${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function fail(message: string): never {
  console.error(message);
  console.error("\nBATCH RESULT\nfailed");
  process.exit(1);
}

function printUsage() {
  console.error(
    "Usage: pnpm acquire --category <category> --location <location> " +
      `[--radius-km 10] [--limit ${DEFAULT_ACQUIRE_LIMIT}] [--source overture|openstreetmap|all] ` +
      `[--concurrency ${DEFAULT_ACQUIRE_CONCURRENCY}] [--strict]\n\n` +
      `Safe limits: max ${MAX_ACQUIRE_LIMIT} per source, deep concurrency max ${MAX_ACQUIRE_CONCURRENCY}.\n` +
      `OpenStreetMap: ${supportedDiscoveryCategories().join(", ")}\n` +
      `Overture: ${supportedOvertureCategories().join(", ")}\n` +
      "Runs discovery, deep website intelligence, qualification v2, and persistence. Never sends outreach.",
  );
}
