/**
 * Test harness: one disposable PostgreSQL database per test file, built by
 * replaying the full committed migration history against the local
 * docker-compose server (pnpm --filter @saltbox/database db:up).
 */

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";
import { createDatabase, type Database } from "../client/kysely.ts";
import { resolveDatabaseUrl } from "../client/config.ts";

export interface TestDatabase {
  db: Database;
  url: string;
  destroy: () => Promise<void>;
}

function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Tests create and drop databases; refuse non-local servers unless overridden. */
function assertDisposableDatabaseTarget(url: string): void {
  const host = new URL(url).hostname;
  if (LOCAL_HOSTS.has(host) || process.env.SALTBOX_ALLOW_REMOTE_DB_TOOLING === "1") {
    return;
  }
  throw new Error(
    `Refusing to run database tests against non-local host "${host}". ` +
      "Point DATABASE_URL at the local docker-compose PostgreSQL, or set " +
      "SALTBOX_ALLOW_REMOTE_DB_TOOLING=1 if this is intentional."
  );
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = resolveDatabaseUrl();
  assertDisposableDatabaseTarget(baseUrl);
  const adminUrl = withDatabaseName(baseUrl, "postgres");
  const name = `saltbox_test_${randomBytes(6).toString("hex")}`;
  const url = withDatabaseName(baseUrl, name);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  await runner({
    databaseUrl: url,
    dir: fileURLToPath(new URL("../migrations", import.meta.url)),
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    checkOrder: true,
    logger: { info: () => {}, warn: console.warn, error: console.error },
  });

  const db = createDatabase({ connectionString: url, maxConnections: 5 });

  return {
    db,
    url,
    destroy: async () => {
      await db.destroy();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name]
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${name}`);
      await cleanup.end();
    },
  };
}

/** PostgreSQL error code helper for constraint assertions. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_FK_VIOLATION = "23503";
export const PG_NOT_NULL_VIOLATION = "23502";
