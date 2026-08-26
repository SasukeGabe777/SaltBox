// Apply the ordered SQL migration history (ADR-006).
//
// Usage: node scripts/migrate.mjs [up|down] [--url <databaseUrl>]
//
// Never runs from application startup or a Worker; this is trusted local/CI
// tooling with a direct PostgreSQL connection.

import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { databaseUrl } from "./env.mjs";

const args = process.argv.slice(2);
const direction = args[0] === "down" ? "down" : "up";
const urlFlag = args.indexOf("--url");
const url = urlFlag >= 0 ? args[urlFlag + 1] : databaseUrl();

const migrations = await runner({
  databaseUrl: url,
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
  direction,
  migrationsTable: "pgmigrations",
  // Down is deliberately limited to one step; history repair is forward-only.
  count: direction === "up" ? Infinity : 1,
  checkOrder: true,
  verbose: true,
});

console.log(`${direction}: applied ${migrations.length} migration(s).`);
