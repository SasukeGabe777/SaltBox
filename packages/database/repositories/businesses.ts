/**
 * Business identity persistence (ADR-004: authoritative current state).
 *
 * Repository results are explicit domain-facing shapes, not generated row
 * types; the mapping layer is intentionally visible.
 */

import type { Database } from "../client/kysely.ts";

export interface BusinessRecord {
  id: string;
  canonicalName: string;
  normalizedName: string;
  status: string;
  category: string | null;
  localTimezone: string | null;
  revision: number;
}

export interface CreateBusinessInput {
  canonicalName: string;
  normalizedName?: string;
  category?: string;
  localTimezone?: string;
}

/** Lowercase, collapse whitespace, strip punctuation commonly noisy in names. */
export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"&()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createBusiness(db: Database, input: CreateBusinessInput): Promise<BusinessRecord> {
  const row = await db
    .insertInto("business")
    .values({
      canonical_name: input.canonicalName,
      normalized_name: input.normalizedName ?? normalizeBusinessName(input.canonicalName),
      category: input.category ?? null,
      local_timezone: input.localTimezone ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapBusiness(row);
}

export async function getBusinessById(db: Database, id: string): Promise<BusinessRecord | undefined> {
  const row = await db.selectFrom("business").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? mapBusiness(row) : undefined;
}

/** Exact namespaced external-identifier lookup (ADR-004 entity resolution step 2). */
export async function findBusinessByExternalIdentifier(
  db: Database,
  input: { provider: string; dataset?: string; identifierType: string; value: string }
): Promise<BusinessRecord | undefined> {
  let query = db
    .selectFrom("business_identifier")
    .innerJoin("business", "business.id", "business_identifier.business_id")
    .selectAll("business")
    .where("business_identifier.provider", "=", input.provider)
    .where("business_identifier.identifier_type", "=", input.identifierType)
    .where("business_identifier.value", "=", input.value);
  query =
    input.dataset === undefined
      ? query.where("business_identifier.dataset", "is", null)
      : query.where("business_identifier.dataset", "=", input.dataset);
  const row = await query.executeTakeFirst();
  return row ? mapBusiness(row) : undefined;
}

interface BusinessRow {
  id: string;
  canonical_name: string;
  normalized_name: string;
  status: string;
  category: string | null;
  local_timezone: string | null;
  revision: number;
}

function mapBusiness(row: BusinessRow): BusinessRecord {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedName: row.normalized_name,
    status: row.status,
    category: row.category,
    localTimezone: row.local_timezone,
    revision: row.revision,
  };
}
