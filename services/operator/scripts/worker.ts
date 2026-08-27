/**
 * The local operator run worker.
 *
 *   node scripts/worker.ts --run <uuid>          # execute one queued run
 *   node scripts/worker.ts --drain [--max 5]     # execute everything queued
 *
 * The admin spawns this detached; it can also be run by hand to recover a run
 * whose worker was killed. It refuses non-local databases like every other
 * SaltBox operator tool.
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { listOperatorRuns } from "@saltbox/database/repositories/operator-runs";
import { executeOperatorRun } from "../src/execute.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    drain: { type: "boolean", default: false },
    max: { type: "string", default: "5" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || (!values.run && !values.drain)) {
  console.error("Usage: node scripts/worker.ts (--run <uuid> | --drain [--max 5])");
  process.exit(values.help ? 0 : 1);
}
if (values.run !== undefined && !UUID.test(values.run)) {
  console.error("--run must be a UUID.");
  process.exit(1);
}

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error("Refusing to run operator work against a non-local database.");
  process.exit(1);
}

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 8 });
const log = (stage: string, detail?: Record<string, unknown>) =>
  console.error(JSON.stringify({ stage, ...(detail ?? {}) }));

try {
  if (values.run) {
    const result = await executeOperatorRun(db, values.run, { log });
    console.log(result ? `RUN ${values.run}: ${result.status}` : `RUN ${values.run}: not claimable (already running)`);
    if (result?.status === "failed") process.exitCode = 1;
  } else {
    const max = Math.min(Math.max(Number(values.max) || 5, 1), 25);
    const queued = (await listOperatorRuns(db, { limit: max })).filter((run) => run.status === "queued");
    console.log(`Draining ${queued.length} queued run(s).`);
    for (const run of queued) {
      const result = await executeOperatorRun(db, run.id, { log });
      console.log(`RUN ${run.id} (${run.runKind}): ${result?.status ?? "skipped"}`);
    }
  }
} finally {
  await db.destroy();
}
