import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { analyzeWebsiteIntelligence } from "../src/analyze-website.ts";
import { persistIntelligenceRun } from "../src/persist.ts";
import { targetByBusiness, targetByProspect, targetsByFilters, type IntelligenceTarget } from "../src/select-targets.ts";
import {
  DEFAULT_BATCH_LIMIT,
  DEFAULT_CONCURRENCY,
  MAX_BATCH_LIMIT,
  MAX_CONCURRENCY,
  WEBSITE_INTELLIGENCE_VERSION,
} from "../src/version.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const ARTIFACT_ROOT = resolve(process.cwd(), "../../.data/website-intelligence");

const { values } = parseArgs({
  options: {
    prospect: { type: "string" },
    business: { type: "string" },
    category: { type: "string", short: "c" },
    status: { type: "string" },
    limit: { type: "string", default: String(DEFAULT_BATCH_LIMIT) },
    concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || (!values.prospect && !values.business && !values.category && !values.status)) {
  console.error(
    "Usage:\n" +
      "  pnpm website:intelligence --prospect <prospect-id>\n" +
      "  pnpm website:intelligence --business <business-id>\n" +
      "  pnpm website:intelligence --category roofing --limit 5\n" +
      "  pnpm website:intelligence --status qualified --limit 5\n\n" +
      `Batch limit default ${DEFAULT_BATCH_LIMIT}, max ${MAX_BATCH_LIMIT}. Concurrency default ${DEFAULT_CONCURRENCY}, max ${MAX_CONCURRENCY}.\n` +
      "Analysis is bounded (max 5 pages, 25 link checks per site) and never sends outreach.",
  );
  process.exit(values.help ? 0 : 1);
}

const limit = Number(values.limit);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
  console.error(`--limit must be an integer between 1 and ${MAX_BATCH_LIMIT}.`);
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
  console.error(`--concurrency must be 1 or ${MAX_CONCURRENCY}.`);
  process.exit(1);
}
if (values.status !== undefined && values.status !== "qualified" && values.status !== "rejected") {
  console.error('--status must be "qualified" or "rejected".');
  process.exit(1);
}

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error("Refusing to run website intelligence against a non-local database. Phase 6 is local development only.");
  process.exit(1);
}

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 4 });

try {
  let targets: IntelligenceTarget[];
  if (values.prospect) {
    const target = await targetByProspect(db, values.prospect);
    if (!target) {
      console.error(`Prospect ${values.prospect} was not found.`);
      process.exit(1);
    }
    targets = [target];
  } else if (values.business) {
    const target = await targetByBusiness(db, values.business);
    if (!target) {
      console.error(`Business ${values.business} was not found.`);
      process.exit(1);
    }
    targets = [target];
  } else {
    targets = await targetsByFilters(db, {
      ...(values.category !== undefined ? { category: values.category } : {}),
      ...(values.status !== undefined ? { status: values.status as "qualified" | "rejected" } : {}),
      limit,
    });
  }

  console.log("\nSALTBOX WEBSITE INTELLIGENCE");
  console.log(`Analyzer: ${WEBSITE_INTELLIGENCE_VERSION} · Targets: ${targets.length} · Concurrency: ${concurrency}`);
  console.log("Bounded analysis · no outreach · no form submission\n");

  let completed = 0;
  let partial = 0;
  let failed = 0;
  let skippedNoSite = 0;
  const durations: number[] = [];

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      if (!target) return;
      const label = `[${index + 1}/${targets.length}] ${target.businessName}`;
      if (!target.websiteUrl || !target.websiteId) {
        console.log(`${label}\n       NO WEBSITE TO ANALYZE\n`);
        skippedNoSite += 1;
        continue;
      }
      console.log(`${label}\n       ${target.websiteUrl}`);
      const slug = target.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const artifactRef = `${stamp}-${slug || target.businessId.slice(0, 8)}`;
      const artifactDir = resolve(ARTIFACT_ROOT, artifactRef);

      const result = await analyzeWebsiteIntelligence(target.websiteUrl, {
        artifactDir,
        log: (message) => console.log(`       ${message}`),
      });
      durations.push(result.durationMs);

      if (result.fatal) {
        console.log(`       FATAL (${result.fatal.stage}): ${result.fatal.message}`);
      } else {
        if (result.lab) {
          console.log(
            `       performance: ${result.lab.performance ?? "—"} · accessibility: ${result.lab.accessibility ?? "—"} · SEO: ${result.lab.seo ?? "—"} · best practices: ${result.lab.bestPractices ?? "—"}`,
          );
        }
        if (result.links) console.log(`       links checked: ${result.links.checked} · broken: ${result.links.broken}`);
        if (result.conversion) {
          console.log(
            `       contact form: ${result.conversion.contactFormPresent ? "yes" : "NO"} · quote CTA: ${result.conversion.quoteCtaPresent ? "yes" : "NO"} · phone link: ${result.conversion.phoneLinkPresent ? "yes" : "no"}`,
          );
        }
        if (result.platform?.platform) console.log(`       platform: ${result.platform.platform} (${result.platform.confidence})`);
      }

      const persisted = await persistIntelligenceRun(db, {
        businessId: target.businessId,
        websiteId: target.websiteId,
        result,
        artifactRef,
      });
      const stageValues = Object.values(result.stages).map((stage) => stage.status);
      const status = result.fatal
        ? "failed"
        : stageValues.includes("failed") || stageValues.includes("partial")
          ? "partial"
          : "complete";
      if (status === "failed") failed += 1;
      else if (status === "partial") partial += 1;
      else completed += 1;
      console.log(
        `       ${status} in ${(result.durationMs / 1000).toFixed(1)}s · analysis ${persisted.analysisId.slice(0, 8)} · ${persisted.snapshotIds.length} pages · ${persisted.observationCount} observations\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, () => worker()));

  console.log("SUMMARY\n");
  console.log(`Targets            ${targets.length}`);
  console.log(`Complete           ${completed}`);
  console.log(`Partial            ${partial}`);
  console.log(`Failed             ${failed}`);
  console.log(`No website         ${skippedNoSite}`);
  if (durations.length > 0) {
    const sorted = [...durations].sort((a, b) => a - b);
    const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    console.log(`Average duration   ${(average / 1000).toFixed(1)}s`);
    console.log(`Median duration    ${((sorted[Math.floor(sorted.length / 2)] ?? 0) / 1000).toFixed(1)}s`);
    console.log(`Slowest            ${((sorted[sorted.length - 1] ?? 0) / 1000).toFixed(1)}s`);
  }
  if (failed > 0) process.exitCode = 2;
} finally {
  await db.destroy();
}
