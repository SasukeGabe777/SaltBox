// Shared environment defaults for SaltBox database tooling.
//
// The default URL targets the local docker-compose PostgreSQL (port 5433).
// Real deployments always provide DATABASE_URL explicitly; nothing here is a
// production credential.

export const DEFAULT_LOCAL_DATABASE_URL = "postgres://saltbox:saltbox@localhost:5433/saltbox";

export function databaseUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
}

/** Replace the database name in a PostgreSQL URL (for admin/disposable DBs). */
export function withDatabaseName(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Guard for tooling that creates and drops disposable databases (codegen,
 * tests). It must never point at a shared or production server by accident;
 * a deliberate remote run requires SALTBOX_ALLOW_REMOTE_DB_TOOLING=1.
 */
export function assertDisposableDatabaseTarget(url) {
  const host = new URL(url).hostname;
  if (LOCAL_HOSTS.has(host) || process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING === "1") {
    return;
  }
  throw new Error(
    `Refusing to run disposable-database tooling against non-local host "${host}". ` +
      "This command creates and drops databases. Point DATABASE_URL at the local " +
      "docker-compose PostgreSQL, or set SALTBOX_ALLOW_REMOTE_DB_TOOLING=1 if this is intentional."
  );
}
