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

/** Attach a namespaced external identifier; a rediscovered identity is a no-op. */
export async function addBusinessIdentifier(
  db: Database,
  input: { businessId: string; provider: string; dataset?: string; identifierType: string; value: string }
): Promise<void> {
  await db
    .insertInto("business_identifier")
    .values({
      business_id: input.businessId,
      provider: input.provider,
      dataset: input.dataset ?? null,
      identifier_type: input.identifierType,
      value: input.value,
    })
    .onConflict((oc) => oc.constraint("business_identifier_namespace_uq").doNothing())
    .execute();
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

/**
 * Businesses currently associated with a website on the exact normalized
 * domain host (cross-source strong signal; ADR-004 entity resolution step 1).
 */
export async function findBusinessIdsByDomainHost(db: Database, host: string): Promise<string[]> {
  const rows = await db
    .selectFrom("domain")
    .innerJoin("website_domain", "website_domain.domain_id", "domain.id")
    .innerJoin("business_website", "business_website.website_id", "website_domain.website_id")
    .select("business_website.business_id")
    .distinct()
    .where("domain.host", "=", host.trim().toLowerCase())
    .orderBy("business_website.business_id")
    .execute();
  return rows.map((row) => row.business_id);
}

/**
 * Businesses with the exact same phone number (strong signal). Numbers with
 * ten or more digits compare on their final ten digits so a country-code
 * prefix ("+1 801…" vs "(801) …") cannot defeat an exact-number match;
 * shorter numbers require an exact normalized match.
 */
export async function findBusinessIdsByPhone(db: Database, normalizedPhone: string): Promise<string[]> {
  const digits = normalizedPhone.replace(/\D/g, "");
  let query = db
    .selectFrom("contact_method")
    .select("business_id")
    .distinct()
    .where("channel", "=", "phone");
  query =
    digits.length >= 10
      ? query.where(
          (eb) => eb.fn("right", [eb.fn("regexp_replace", [eb.ref("normalized_value"), eb.val("[^0-9]"), eb.val(""), eb.val("g")]), eb.val(10)]),
          "=",
          digits.slice(-10),
        )
      : query.where("normalized_value", "=", normalizedPhone);
  const rows = await query.orderBy("business_id").execute();
  return rows.map((row) => row.business_id);
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
