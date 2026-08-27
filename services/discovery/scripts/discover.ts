import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { discoverAndQualify, type DiscoveryRunResult } from "../src/application/discover-and-qualify.ts";
import {
  DEFAULT_DISCOVERY_USER_AGENT,
  OpenStreetMapOverpassAdapter,
} from "../src/adapters/openstreetmap.ts";
import { OvertureMapsPlacesAdapter } from "../src/adapters/overture.ts";
import {
  getOsmCategoryMapping,
  supportedDiscoveryCategories,
} from "../src/config/osm-category-mapping-v1.ts";
import {
  getOvertureCategoryMapping,
  supportedOvertureCategories,
} from "../src/config/overture-category-mapping-v1.ts";
import { DiscoverySourceError } from "../src/errors.ts";
import type { DiscoverySourceAdapter } from "../src/types.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SUPPORTED_SOURCES = ["openstreetmap", "overture", "all"] as const;

const { values } = parseArgs({
  options: {
    category: { type: "string", short: "c" },
    location: { type: "string", short: "l" },
    "radius-km": { type: "string", default: "10" },
    limit: { type: "string", default: "10" },
    source: { type: "string", default: "openstreetmap" },
    concurrency: { type: "string", default: "2" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.category || !values.location) {
  printUsage();
  process.exit(values.help ? 0 : 1);
}

const source = values.source!.trim().toLowerCase();
if (!(SUPPORTED_SOURCES as readonly string[]).includes(source)) {
  console.error(`Unsupported source "${source}". Supported: ${SUPPORTED_SOURCES.join(", ")}.`);
  process.exit(1);
}
const category = values.category.trim().toLowerCase();
const supportsOsm = getOsmCategoryMapping(category) !== undefined;
const supportsOverture = getOvertureCategoryMapping(category) !== undefined;
if (source === "openstreetmap" && !supportsOsm) {
  console.error(`Category "${category}" is not supported by openstreetmap. Supported: ${supportedDiscoveryCategories().join(", ")}`);
  process.exit(1);
}
if (source === "overture" && !supportsOverture) {
  console.error(`Category "${category}" is not supported by overture. Supported: ${supportedOvertureCategories().join(", ")}`);
  process.exit(1);
}
if (source === "all" && !supportsOsm && !supportsOverture) {
  console.error(
    `Category "${category}" is not supported by any source. ` +
      `openstreetmap: ${supportedDiscoveryCategories().join(", ")} · overture: ${supportedOvertureCategories().join(", ")}`,
  );
  process.exit(1);
}

const radiusKm = parseNumericOption("radius-km", values["radius-km"]!);
const limit = parseNumericOption("limit", values.limit!);
const concurrency = parseNumericOption("concurrency", values.concurrency!);
const databaseUrl = resolveDatabaseUrl();
const host = new URL(databaseUrl).hostname;
if (!LOCAL_HOSTS.has(host) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error(
    `Refusing to run local discovery against non-local database host "${host}". ` +
      "Phase 5B/5C are local development only.",
  );
  process.exit(1);
}

const userAgent = process.env.SALTBOX_DISCOVERY_USER_AGENT ?? DEFAULT_DISCOVERY_USER_AGENT;
const adapters: DiscoverySourceAdapter[] = [];
if ((source === "openstreetmap" || source === "all") && supportsOsm) {
  adapters.push(new OpenStreetMapOverpassAdapter({ userAgent }));
}
if ((source === "overture" || source === "all") && supportsOverture) {
  adapters.push(new OvertureMapsPlacesAdapter({ userAgent }));
}
if (source === "all") {
  if (!supportsOsm) console.log(`Note: category "${category}" is not mapped for openstreetmap; skipping that source.`);
  if (!supportsOverture) console.log(`Note: category "${category}" is not mapped for overture; skipping that source.`);
}

console.log("\nSALTBOX DISCOVERY");
console.log(`${values.location} · ${category}`);
console.log(`Sources: ${adapters.map((adapter) => adapter.source).join(" + ")}`);
console.log(`Radius: ${radiusKm} km · Limit: ${limit} per source · Website concurrency: ${concurrency}`);
console.log("Cost: $0 · Outreach: disabled\n");

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 8 });
const runs: DiscoveryRunResult[] = [];
let sourceFailures = 0;

try {
  for (const adapter of adapters) {
    console.log(`── SOURCE: ${adapter.source} ${"─".repeat(Math.max(1, 40 - adapter.source.length))}\n`);
    try {
      const run = await discoverAndQualify(
        db,
        { category, location: values.location, radiusKm, limit, source: adapter.source },
        adapter,
        {
          concurrency,
          log: (event, detail) => {
            console.error(JSON.stringify({ event, ...detail }));
            if (event === "location-resolved") console.log(`Location resolved: ${String(detail.location)}`);
            if (event === "candidates-discovered") console.log(`Found ${String(detail.candidateCount)} candidates\n`);
            if (event === "candidate-started") {
              console.log(
                `[${String(detail.index)}/${String(detail.candidateCount)}] ${String(detail.businessName)}\n` +
                  `       source identity: ${String(detail.externalId)}\n` +
                  `       website: ${detail.websitePresent ? "found; analyzing" : "none; recording missing-site evidence"}`,
              );
            }
            if (event === "candidate-completed") {
              console.log(`       score: ${String(detail.score)} · ${String(detail.decision).toUpperCase()}\n`);
            }
            if (event === "candidate-failed") {
              console.log(`       ERROR: ${String(detail.message)}\n`);
            }
          },
        },
      );
      runs.push(run);
      printRunSummary(run);
      if (run.failed > 0) process.exitCode = 2;
    } catch (error) {
      sourceFailures += 1;
      if (error instanceof DiscoverySourceError) {
        console.error(
          JSON.stringify({
            event: "source-failed",
            source: error.source,
            errorClass: "discovery_source_failure",
            code: error.code,
            status: error.status,
            message: error.message,
          }),
        );
        console.log(`SOURCE FAILURE (${error.source} · ${error.code}): ${error.message}\n`);
      } else {
        console.error(
          JSON.stringify({
            event: "run-failed",
            errorClass: "pipeline_system_failure",
            message: error instanceof Error ? error.message : "Unknown system failure",
          }),
        );
        console.log(`SYSTEM FAILURE: ${error instanceof Error ? error.message : "Unknown failure"}\n`);
      }
      process.exitCode = 1;
    }
  }

  if (runs.length > 1) {
    console.log("── COMBINED " + "─".repeat(34) + "\n");
    const total = (pick: (run: DiscoveryRunResult) => number) => runs.reduce((sum, run) => sum + pick(run), 0);
    const uniqueBusinessIds = new Set(
      runs.flatMap((run) =>
        run.results.filter((result) => result.status === "completed").map((result) => result.outcome.businessId),
      ),
    );
    console.log(`Discovered (all sources)   ${total((run) => run.discovered)}`);
    console.log(`Unique businesses          ${uniqueBusinessIds.size}`);
    console.log(`New businesses             ${total((run) => run.newBusinesses)}`);
    console.log(`Rediscovered               ${total((run) => run.rediscovered)}`);
    console.log(`Cross-source linked        ${total((run) => run.crossSourceLinked)}`);
    console.log(`Possible duplicates (pending review) ${total((run) => run.ambiguousMatches)}`);
    console.log(`Qualified                  ${total((run) => run.qualified)}`);
    console.log(`Rejected                   ${total((run) => run.rejected)}`);
    console.log(`Errors                     ${total((run) => run.failed)}\n`);
  }
  console.log(JSON.stringify(runs.length === 1 ? runs[0] : runs, null, 2));
  if (runs.length === 0 && sourceFailures > 0) {
    console.log("\nNo source completed.");
  }
} finally {
  await db.destroy();
}

function printRunSummary(run: DiscoveryRunResult) {
  console.log("SUMMARY\n");
  console.log(`Source           ${run.source}`);
  console.log(`Discovered       ${run.discovered}`);
  console.log(`New businesses   ${run.newBusinesses}`);
  console.log(`Rediscovered     ${run.rediscovered}`);
  console.log(`Cross-src linked ${run.crossSourceLinked}`);
  console.log(`Ambiguous dupes  ${run.ambiguousMatches}`);
  console.log(`Analyzed         ${run.analyzed}`);
  console.log(`Qualified        ${run.qualified}`);
  console.log(`Rejected         ${run.rejected}`);
  console.log(`Errors           ${run.failed}\n`);
}

function parseNumericOption(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    console.error(`--${name} must be numeric.`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  console.error(
    "Usage: pnpm discover --category <category> --location <location> " +
      "[--radius-km 10] [--limit 10] [--source openstreetmap|overture|all] [--concurrency 2]\n\n" +
      `openstreetmap categories: ${supportedDiscoveryCategories().join(", ")}\n` +
      `overture categories:      ${supportedOvertureCategories().join(", ")}\n\n` +
      "Local-only discovery and analysis. It never sends outreach.\n" +
      'Overture requires a local extract: pnpm discovery:data --location "Ogden, UT" --radius-km 30',
  );
}
