/**
 * Operator brand inspection:
 *
 *   pnpm demo:brand --prospect <uuid> [--refresh]
 *
 * Runs (or reuses) bounded brand/asset extraction for one prospect, persists
 * the profile as append-only evidence, and prints a readable summary. Never
 * generates a demo and never sends outreach.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { createBrandExtractor } from "../src/brand-extraction.ts";
import { brandViewFromFacts } from "../src/plan.ts";
import { collectDemoSourceFacts } from "../src/facts.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEMO_ASSET_ROOT = resolve(process.cwd(), "../../.data/demo-assets");

const { values } = parseArgs({
  options: {
    prospect: { type: "string", short: "p" },
    refresh: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.prospect || !UUID_PATTERN.test(values.prospect)) {
  console.error("Usage: pnpm demo:brand --prospect <uuid> [--refresh]");
  process.exit(values.help ? 0 : 1);
}

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error("Refusing to run brand inspection against a non-local database.");
  process.exit(1);
}

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 4 });
try {
  let facts = await collectDemoSourceFacts(db, values.prospect);
  if (!facts) {
    console.error("Prospect not found.");
    process.exitCode = 1;
  } else {
    console.log(`\nSALTBOX BRAND INSPECTION\n${facts.businessName} (${facts.category ?? "uncategorized"})`);
    if (!facts.websiteUrl) {
      console.log("No website on record — nothing to extract; demos use deterministic fallbacks.");
    } else {
      if (facts.brand === undefined || values.refresh) {
        console.log(`${values.refresh ? "Refreshing" : "Running"} bounded brand extraction for ${facts.websiteUrl} ...`);
        const extract = createBrandExtractor(db, {
          assetRoot: DEMO_ASSET_ROOT,
          log: (stage, detail) => console.log(`  ${stage}${detail ? ` ${JSON.stringify(detail)}` : ""}`),
        });
        await extract(facts);
        facts = (await collectDemoSourceFacts(db, values.prospect)) ?? facts;
      } else {
        console.log("Using the persisted brand profile (pass --refresh to re-extract).");
      }
      const view = brandViewFromFacts(facts);
      if (!view) {
        console.log("No usable brand profile is persisted.");
      } else {
        console.log(`\nProfile     ${view.profileVersion} (analysis ${view.analysisId}, ${view.collectedAt})`);
        console.log(`Logo        ${view.logoStatus} / ${view.logoConfidence}${view.logo ? ` <- ${view.logo.sourceUrl ?? "unknown"} (${view.logo.width}x${view.logo.height})` : ""}`);
        for (const reason of view.logoReasons.slice(0, 4)) console.log(`            - ${reason}`);
        console.log(`Palette     ${view.paletteStatus} / ${view.paletteConfidence}`);
        if (view.palette) {
          console.log(`            primary ${view.palette.primary} | secondary ${view.palette.secondary} | accent ${view.palette.accent}`);
          console.log(`            sources: ${view.paletteSources.join(", ") || "none"}`);
        }
        console.log(`Imagery     ${view.images.length} selected`);
        for (const image of view.images) {
          console.log(`            [${image.role}] ${image.width}x${image.height} <- ${image.sourceUrl}`);
        }
        console.log(`Services    ${view.services.length} extracted`);
        for (const service of view.services) {
          console.log(`            ${service.name} (${service.evidence}: "${service.sourceText}")`);
        }
        console.log(`Artifacts   ${view.artifactRef ? `.data/demo-assets/${view.artifactRef}/` : "none downloaded"}`);
        if (view.fallbacks.length > 0) {
          console.log("Fallbacks");
          for (const fallback of view.fallbacks) console.log(`            - ${fallback}`);
        }
      }
    }
  }
} finally {
  await db.destroy();
}
