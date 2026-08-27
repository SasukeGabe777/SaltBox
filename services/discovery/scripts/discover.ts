import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { discoverAndQualify } from "../src/application/discover-and-qualify.ts";
import {
  DEFAULT_DISCOVERY_USER_AGENT,
  OpenStreetMapOverpassAdapter,
} from "../src/adapters/openstreetmap.ts";
import {
  getOsmCategoryMapping,
  supportedDiscoveryCategories,
} from "../src/config/osm-category-mapping-v1.ts";
import { DiscoverySourceError } from "../src/errors.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
if (source !== "openstreetmap") {
  console.error(`Unsupported source "${source}". Phase 5B supports only "openstreetmap".`);
  process.exit(1);
}
if (!getOsmCategoryMapping(values.category.trim().toLowerCase())) {
  console.error(
    `Unsupported category "${values.category}". Supported: ${supportedDiscoveryCategories().join(", ")}`,
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
      "Phase 5B is local development only.",
  );
  process.exit(1);
}

console.log("\nSALTBOX DISCOVERY");
console.log(`${values.location} · ${values.category}`);
console.log("Source: OpenStreetMap");
console.log(`Radius: ${radiusKm} km · Limit: ${limit} · Website concurrency: ${concurrency}`);
console.log("Cost: $0 · Outreach: disabled\n");

const adapter = new OpenStreetMapOverpassAdapter({
  userAgent: process.env.SALTBOX_DISCOVERY_USER_AGENT ?? DEFAULT_DISCOVERY_USER_AGENT,
});
const db = createDatabase({ connectionString: databaseUrl, maxConnections: 8 });

try {
  const run = await discoverAndQualify(
    db,
    {
      category: values.category,
      location: values.location,
      radiusKm,
      limit,
      source,
    },
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

  console.log("SUMMARY\n");
  console.log(`Discovered       ${run.discovered}`);
  console.log(`New businesses   ${run.newBusinesses}`);
  console.log(`Rediscovered     ${run.rediscovered}`);
  console.log(`Analyzed         ${run.analyzed}`);
  console.log(`Qualified        ${run.qualified}`);
  console.log(`Rejected         ${run.rejected}`);
  console.log(`Errors           ${run.failed}\n`);
  console.log(JSON.stringify(run, null, 2));
  if (run.failed > 0) process.exitCode = 2;
} catch (error) {
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
    console.error(`\nSOURCE FAILURE: ${error.message}`);
  } else {
    console.error(
      JSON.stringify({
        event: "run-failed",
        errorClass: "pipeline_system_failure",
        message: error instanceof Error ? error.message : "Unknown system failure",
      }),
    );
    console.error(`\nSYSTEM FAILURE: ${error instanceof Error ? error.message : "Unknown failure"}`);
  }
  process.exitCode = 1;
} finally {
  await db.destroy();
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
      "[--radius-km 10] [--limit 10] [--source openstreetmap] [--concurrency 2]\n\n" +
      `Supported categories: ${supportedDiscoveryCategories().join(", ")}\n\n` +
      "Phase 5B is local-only discovery and analysis. It never sends outreach.",
  );
}
