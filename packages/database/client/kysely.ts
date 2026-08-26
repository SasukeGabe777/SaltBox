/**
 * Kysely construction over node-postgres (ADR-006 runtime boundary).
 *
 * Node/local/admin tooling passes a direct PostgreSQL connection string;
 * the future Workers adapter passes a Hyperdrive connection string. Nothing
 * above this module may depend on pg, Neon, or Hyperdrive types.
 */

import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "../generated/db.ts";
import { resolveDatabaseUrl } from "./config.ts";

export type Database = Kysely<DB>;

export interface CreateDatabaseOptions {
  /** PostgreSQL connection string; defaults to DATABASE_URL or the local dev URL. */
  connectionString?: string;
  /** Maximum pool size (default 10). */
  maxConnections?: number;
}

export function createDatabase(options: CreateDatabaseOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString: resolveDatabaseUrl(options.connectionString),
    max: options.maxConnections ?? 10,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
