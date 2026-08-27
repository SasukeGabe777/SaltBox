/**
 * Development-only, NON-PERSISTING discovery coverage comparison.
 *
 * Queries each source for the same controlled query and reports counts plus
 * strong-signal overlap (exact normalized website host or phone). Nothing is
 * ingested and no database connection is opened. Overlap uses only strong
 * signals, so records without contact data may be reported as unique even
 * when they describe the same business — that imprecision is stated, not
 * hidden.
 *
 * Usage:
 *   pnpm discovery:compare --location "Ogden, UT" --category roofing
 *   pnpm discovery:compare --location "Ogden, UT" --category roofing,plumbing --radius-km 15 --limit 20
 */
import { parseArgs } from "node:util";
import {
  DEFAULT_DISCOVERY_USER_AGENT,
  OpenStreetMapOverpassAdapter,
} from "../src/adapters/openstreetmap.ts";
import { OvertureMapsPlacesAdapter } from "../src/adapters/overture.ts";
import { getOsmCategoryMapping } from "../src/config/osm-category-mapping-v1.ts";
import { getOvertureCategoryMapping } from "../src/config/overture-category-mapping-v1.ts";
import { DiscoverySourceError } from "../src/errors.ts";
import { NominatimResolver } from "../src/location/nominatim.ts";
import type { DiscoveryResult } from "../src/types.ts";

const OVERPASS_PAUSE_MS = 3_000;

const { values } = parseArgs({
  options: {
    category: { type: "string", short: "c" },
    location: { type: "string", short: "l" },
    "radius-km": { type: "string", default: "15" },
    limit: { type: "string", default: "20" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.category || !values.location) {
  console.error(
    'Usage: pnpm discovery:compare --location "Ogden, UT" --category roofing[,plumbing,...] [--radius-km 15] [--limit 20]',
  );
  process.exit(values.help ? 0 : 1);
}

const categories = values.category
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry !== "");
const radiusKm = Number(values["radius-km"]);
const limit = Number(values.limit);
if (!Number.isFinite(radiusKm) || !Number.isFinite(limit)) {
  console.error("--radius-km and --limit must be numeric.");
  process.exit(1);
}

const userAgent = process.env.SALTBOX_DISCOVERY_USER_AGENT ?? DEFAULT_DISCOVERY_USER_AGENT;
const resolver = new NominatimResolver({ userAgent });
const osm = new OpenStreetMapOverpassAdapter({ userAgent });
const overture = new OvertureMapsPlacesAdapter({ userAgent });

console.log("\nSALTBOX DISCOVERY COVERAGE COMPARISON (non-persisting)");
console.log(`${values.location} · radius ${radiusKm} km · limit ${limit} per source\n`);

const location = await resolver.resolveLocation(values.location);
console.log(`Location resolved: ${location.displayName}\n`);

let firstOverpassQuery = true;
for (const category of categories) {
  console.log(`CATEGORY: ${category}`);
  let osmResults: DiscoveryResult[] | string;
  let overtureResults: DiscoveryResult[] | string;

  if (!getOsmCategoryMapping(category)) {
    osmResults = "unsupported category";
  } else {
    if (!firstOverpassQuery) await new Promise((resolve) => setTimeout(resolve, OVERPASS_PAUSE_MS));
    firstOverpassQuery = false;
    osmResults = await runSource(() =>
      osm.discover({ category, location: values.location!, radiusKm, limit, source: "openstreetmap" }, location),
    );
  }
  if (!getOvertureCategoryMapping(category)) {
    overtureResults = "unsupported category";
  } else {
    overtureResults = await runSource(() =>
      overture.discover({ category, location: values.location!, radiusKm, limit, source: "overture" }, location),
    );
  }

  const osmCount = typeof osmResults === "string" ? osmResults : String(osmResults.length);
  const overtureCount = typeof overtureResults === "string" ? overtureResults : String(overtureResults.length);
  console.log(`  openstreetmap  ${osmCount}`);
  console.log(`  overture       ${overtureCount}`);

  if (Array.isArray(osmResults) && Array.isArray(overtureResults)) {
    const overlap = strongSignalOverlap(osmResults, overtureResults);
    console.log(`  strong-signal overlap (same website host or phone): ${overlap.count}`);
    for (const pair of overlap.examples.slice(0, 5)) console.log(`    ≈ ${pair}`);
    console.log(`  openstreetmap-only (no strong-signal match): ${osmResults.length - overlap.count}`);
    console.log(`  overture-only (no strong-signal match):      ${overtureResults.length - overlap.count}`);
  }
  console.log("");
}
console.log("Note: tiny exploratory benchmark; overlap uses strong signals only and");
console.log("records without website/phone may be the same business yet counted unique.");
console.log("Attribution: © OpenStreetMap contributors (ODbL 1.0) · Overture Maps Foundation, overturemaps.org");

async function runSource(run: () => Promise<{ candidates: DiscoveryResult[] }>): Promise<DiscoveryResult[] | string> {
  try {
    return (await run()).candidates;
  } catch (error) {
    if (error instanceof DiscoverySourceError) return `ERROR ${error.code}`;
    return `ERROR ${error instanceof Error ? error.message : "unknown"}`;
  }
}

function strongSignalOverlap(a: DiscoveryResult[], b: DiscoveryResult[]): { count: number; examples: string[] } {
  const keysOf = (result: DiscoveryResult): string[] => {
    const keys: string[] = [];
    if (result.websiteUrl) {
      try {
        keys.push(`host:${new URL(result.websiteUrl).hostname.toLowerCase().replace(/^www\./, "")}`);
      } catch {
        /* unparseable website is not a signal */
      }
    }
    if (result.phone) {
      const digits = result.phone.replace(/\D/g, "");
      if (digits.length >= 7) keys.push(`phone:${digits.slice(-10)}`);
    }
    return keys;
  };
  const bByKey = new Map<string, DiscoveryResult>();
  for (const result of b) for (const key of keysOf(result)) bByKey.set(key, result);
  const matchedB = new Set<string>();
  const examples: string[] = [];
  let count = 0;
  for (const result of a) {
    const match = keysOf(result)
      .map((key) => bByKey.get(key))
      .find((candidate) => candidate !== undefined && !matchedB.has(candidate.externalId));
    if (match) {
      matchedB.add(match.externalId);
      count += 1;
      examples.push(`"${result.name}" (osm) ↔ "${match.name}" (overture)`);
    }
  }
  return { count, examples };
}
