/**
 * Demo renderer entry point. Binds to loopback only — like the admin, this
 * process must never be exposed externally without authentication in front
 * of it.
 */

import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { createDemosServer } from "./app.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const databaseUrl = resolveDatabaseUrl();
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname) && process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING !== "1") {
  console.error("Refusing to serve demos from a non-local database.");
  process.exit(1);
}

const host = "127.0.0.1";
const port = Number(process.env.SALTBOX_DEMOS_PORT ?? 5175);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid SALTBOX_DEMOS_PORT "${process.env.SALTBOX_DEMOS_PORT}".`);
  process.exit(1);
}

const rawMode = process.env.SALTBOX_DEMOS_MODE ?? "preview";
if (rawMode !== "preview" && rawMode !== "public") {
  console.error(`Invalid SALTBOX_DEMOS_MODE "${rawMode}"; expected "preview" or "public".`);
  process.exit(1);
}
const mode = rawMode;

const db = createDatabase({ connectionString: databaseUrl, maxConnections: 6 });
const server = createDemosServer({
  db,
  mode,
  log: (message, detail) => console.error(JSON.stringify({ message, ...(detail ?? {}) })),
});

server.listen(port, host, () => {
  console.log(`SaltBox demo renderer listening on http://${host}:${port}/ (loopback only, noindex).`);
  console.log(
    mode === "public"
      ? "Mode: public — only operator-APPROVED demo versions resolve."
      : "Mode: preview — the current version of each demo resolves for operator review.",
  );
  console.log("Demos are reachable only through their private /d/<locator> links.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void db.destroy().finally(() => process.exit(0));
    });
  });
}
