/**
 * Source and source-record provenance (ADR-004: origin, retrieval unit,
 * namespaced external identity). Identity operations are idempotent through
 * database constraints, not in-memory dedupe.
 */

import type { Database } from "../client/kysely.ts";

export async function ensureSource(
  db: Database,
  input: { name: string; sourceType: string; description?: string; retentionClass?: string }
): Promise<string> {
  await db
    .insertInto("source")
    .values({
      name: input.name,
      source_type: input.sourceType,
      description: input.description ?? null,
      ...(input.retentionClass !== undefined ? { retention_class: input.retentionClass } : {}),
    })
    .onConflict((oc) => oc.column("name").doNothing())
    .execute();
  const row = await db
    .selectFrom("source")
    .select("id")
    .where("name", "=", input.name)
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface UpsertSourceRecordInput {
  sourceId: string;
  externalId: string;
  retrievedAt?: Date;
  sourceLocator?: string;
  contentHash?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface SourceRecordRef {
  id: string;
  businessId: string | null;
}

/**
 * Idempotent per (source, external_id): reprocessing the same provider record
 * refreshes retrieval metadata but never creates a duplicate identity row.
 */
export async function upsertSourceRecord(db: Database, input: UpsertSourceRecordInput): Promise<SourceRecordRef> {
  const row = await db
    .insertInto("source_record")
    .values({
      source_id: input.sourceId,
      external_id: input.externalId,
      retrieved_at: input.retrievedAt ?? new Date(),
      source_locator: input.sourceLocator ?? null,
      content_hash: input.contentHash ?? null,
      provider_metadata: input.providerMetadata ? JSON.stringify(input.providerMetadata) : null,
    })
    .onConflict((oc) =>
      oc.constraint("source_record_source_external_uq").doUpdateSet((eb) => ({
        retrieved_at: eb.ref("excluded.retrieved_at"),
        content_hash: eb.ref("excluded.content_hash"),
      }))
    )
    .returning(["id", "business_id"])
    .executeTakeFirstOrThrow();
  return { id: row.id, businessId: row.business_id };
}

/**
 * Resolve a source record to a business. Linking to a different business than
 * an existing resolution is an identity conflict and fails loudly — silent
 * re-linking would be a silent merge (ADR-004 entity-resolution rule 4).
 */
export async function linkSourceRecordToBusiness(
  db: Database,
  sourceRecordId: string,
  businessId: string
): Promise<void> {
  const result = await db
    .updateTable("source_record")
    .set({ business_id: businessId })
    .where("id", "=", sourceRecordId)
    .where((eb) => eb.or([eb("business_id", "is", null), eb("business_id", "=", businessId)]))
    .executeTakeFirst();
  if (result.numUpdatedRows !== 1n) {
    throw new Error(
      `Source record ${sourceRecordId} is already resolved to a different business; ` +
        "re-linking requires an explicit entity-resolution decision."
    );
  }
}
