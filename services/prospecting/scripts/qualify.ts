/**
 * Developer-only fixture runner for the Phase 4 qualification slice.
 *
 * Usage (from the repository root, with `pnpm db:up` running):
 *   pnpm prospect:qualify --fixture roofing-good
 *
 * Writes to the LOCAL development database only; non-local DATABASE_URL
 * targets are refused unless SALTBOX_ALLOW_REMOTE_DB_TOOLING=1.
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { FIXTURES, getFixture } from "../fixtures/fixtures.ts";
import { qualifyBusiness } from "../pipeline/qualify.ts";
import { serveLocalSite, htmlHandler } from "../testing/fixture-server.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const { values } = parseArgs({ options: { fixture: { type: "string", short: "f" } } });
const key = values.fixture;

if (key === undefined) {
  console.error("Usage: pnpm prospect:qualify --fixture <key>\n\nAvailable fixtures:");
  for (const fixture of FIXTURES) {
    console.error(`  ${fixture.key.padEnd(24)} ${fixture.description}`);
  }
  process.exit(1);
}

const fixture = getFixture(key);
if (fixture === undefined) {
  console.error(`Unknown fixture "${key}". Available: ${FIXTURES.map((f) => f.key).join(", ")}`);
  process.exit(1);
}

const databaseUrl = resolveDatabaseUrl();
const host = new URL(databaseUrl).hostname;
if (!LOCAL_HOSTS.has(host) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error(
    `Refusing to run the fixture pipeline against non-local database host "${host}". ` +
      "Fixtures belong in local development databases only."
  );
  process.exit(1);
}

const site = fixture.html !== undefined ? await serveLocalSite(htmlHandler(fixture.html)) : undefined;
const input = { ...fixture.input, ...(site ? { websiteUrl: site.url } : {}) };

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 5 });
try {
  const outcome = await qualifyBusiness(db, input, {
    analyzer: { allowPrivateNetworks: true },
    log: (stage, detail) => console.error(JSON.stringify({ stage, ...detail })),
  });
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.decision !== fixture.expectedDecision) {
    console.error(`NOTE: fixture expected "${fixture.expectedDecision}" but pipeline produced "${outcome.decision}".`);
  }
} finally {
  await db.destroy();
  await site?.close();
}
