// One documented command for database-type generation (ADR-006 mitigation):
// build a disposable PostgreSQL database, apply the full migration history,
// generate the Kysely database interface from the migrated catalog, and either
// write it (default) or verify the checked-in artifact matches (--verify).
//
// Usage:
//   node scripts/codegen.mjs           # regenerate generated/db.ts
//   node scripts/codegen.mjs --verify  # fail if regeneration differs

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import pg from "pg";
import { runner } from "node-pg-migrate";
import { databaseUrl, withDatabaseName, assertDisposableDatabaseTarget } from "./env.mjs";

const verify = process.argv.includes("--verify");
const require = createRequire(import.meta.url);

const baseUrl = databaseUrl();
assertDisposableDatabaseTarget(baseUrl);
const adminUrl = withDatabaseName(baseUrl, "postgres");
const disposableName = `saltbox_codegen_${randomBytes(6).toString("hex")}`;
const disposableUrl = withDatabaseName(baseUrl, disposableName);

const outFile = fileURLToPath(new URL("../generated/db.ts", import.meta.url));
const verifyFile = fileURLToPath(new URL("../generated/.verify.db.ts", import.meta.url));

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${disposableName}`);

let failed = false;
try {
  await runner({
    databaseUrl: disposableUrl,
    dir: fileURLToPath(new URL("../migrations", import.meta.url)),
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    checkOrder: true,
    logger: { info: () => {}, warn: console.warn, error: console.error },
  });

  const bin = require.resolve("kysely-codegen/package.json").replace(/package\.json$/, "dist/cli/bin.js");
  const target = verify ? verifyFile : outFile;
  const result = spawnSync(
    process.execPath,
    [
      bin,
      "--dialect", "postgres",
      "--url", disposableUrl,
      "--out-file", target,
      "--exclude-pattern", "pgmigrations",
      "--log-level", "error",
    ],
    { stdio: "inherit" }
  );
  if (result.status !== 0) throw new Error(`kysely-codegen exited with status ${result.status}`);

  if (verify) {
    const expected = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
    const actual = readFileSync(verifyFile, "utf8");
    if (normalize(expected) !== normalize(actual)) {
      console.error(
        "generated/db.ts is stale: regenerating from the migrated schema produced a different interface.\n" +
          "Run `pnpm --filter @saltbox/database db:codegen` and review the diff. Never edit generated/db.ts by hand."
      );
      failed = true;
    } else {
      console.log("generated/db.ts matches the migrated schema.");
    }
  } else {
    // kysely-codegen writes LF output; keep it byte-stable regardless of git
    // checkout settings by normalizing explicitly.
    writeFileSync(outFile, normalize(readFileSync(outFile, "utf8")));
    console.log(`wrote ${outFile}`);
  }
} finally {
  rmSync(verifyFile, { force: true });
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [disposableName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${disposableName}`);
  await admin.end();
}

if (failed) process.exit(1);

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}
