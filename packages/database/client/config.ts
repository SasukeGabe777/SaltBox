/**
 * Connection configuration for SaltBox PostgreSQL access.
 *
 * The default URL targets the local docker-compose PostgreSQL on port 5433
 * (see docker-compose.yml). It is a development convenience, never a
 * production credential. Production connection strings arrive through
 * server-side configuration (Worker secrets / Hyperdrive binding per
 * ADR-005/006) and are never bundled into client code.
 */

export const DEFAULT_LOCAL_DATABASE_URL = "postgres://saltbox:saltbox@localhost:5433/saltbox";

export function resolveDatabaseUrl(explicit?: string): string {
  return explicit ?? process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
}
