/**
 * Rebuild the exact discovery input for an already-known business so an
 * operator can retry a transient intelligence failure.
 *
 * Faithfulness matters: qualification v2 derives reachability from observed
 * contact facts, so a retry must present the same identity, provenance, and
 * contact evidence the original discovery did. Identity stays stable because
 * ingestion is keyed by (source, external_id) — a retry appends new evidence
 * and never creates a second business.
 */

import type { Database } from "@saltbox/database/client";
import type { ControlledBusinessInput } from "@saltbox/prospecting/ingestion";

export interface ReconstructedIngestion {
  businessId: string;
  business: ControlledBusinessInput;
}

export async function reconstructIngestionInput(
  db: Database,
  prospectId: string,
): Promise<ReconstructedIngestion | undefined> {
  const header = await db
    .selectFrom("prospect")
    .innerJoin("business", "business.id", "prospect.business_id")
    .select(["business.id as business_id", "business.canonical_name", "business.category"])
    .where("prospect.id", "=", prospectId)
    .executeTakeFirst();
  if (!header) return undefined;

  const [record, website, contacts] = await Promise.all([
    db
      .selectFrom("source_record as sr")
      .innerJoin("source as src", "src.id", "sr.source_id")
      .select([
        "sr.external_id",
        "sr.source_locator",
        "sr.provider_metadata",
        "sr.retrieved_at",
        "sr.content_hash",
        "src.name as source_name",
        "src.source_type",
        "src.description",
        "src.retention_class",
      ])
      .where("sr.business_id", "=", header.business_id)
      .where("src.source_type", "!=", "crawl")
      .orderBy("sr.retrieved_at", (order) => order.desc().nullsLast())
      .orderBy("sr.created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("business_website as bw")
      .innerJoin("website as web", "web.id", "bw.website_id")
      .select(["web.canonical_url"])
      .where("bw.business_id", "=", header.business_id)
      .orderBy("bw.is_primary", "desc")
      .orderBy("bw.created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("contact_method")
      .select(["channel", "normalized_value", "display_value"])
      .where("business_id", "=", header.business_id)
      .orderBy("created_at", "asc")
      .execute(),
  ]);
  if (!record) return undefined;

  const metadata = asRecord(record.provider_metadata);
  const phone = contacts.find((contact) => contact.channel === "phone");
  const email = contacts.find((contact) => contact.channel === "email");
  const city = stringOrUndefined(metadata?.city);
  const state = stringOrUndefined(metadata?.state);

  const business: ControlledBusinessInput = {
    name: header.canonical_name,
    source: record.source_name,
    externalId: record.external_id,
    ...(record.source_type ? { sourceType: record.source_type } : {}),
    ...(record.description ? { sourceDescription: record.description } : {}),
    ...(record.retention_class ? { sourceRetentionClass: record.retention_class } : {}),
    ...(record.source_locator ? { sourceLocator: record.source_locator } : {}),
    ...(record.retrieved_at ? { sourceRetrievedAt: new Date(record.retrieved_at) } : {}),
    ...(record.content_hash ? { sourceContentHash: record.content_hash } : {}),
    ...(metadata ? { sourceMetadata: metadata } : {}),
    ...(header.category ? { industry: header.category } : {}),
    ...(website?.canonical_url ? { websiteUrl: website.canonical_url } : {}),
    ...(phone ? { phone: phone.normalized_value } : {}),
    ...(email ? { email: email.display_value ?? email.normalized_value } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(state !== undefined ? { state } : {}),
  };
  return { businessId: header.business_id, business };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
