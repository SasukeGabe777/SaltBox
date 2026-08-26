/**
 * Contact methods (ADR-004: attributable communication endpoints).
 * Rediscovery of the same normalized endpoint reuses the existing row.
 */

import type { Database } from "../client/kysely.ts";
import type { ContactChannel } from "../generated/db.ts";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, preserving a leading '+' for international numbers. */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export interface UpsertContactMethodInput {
  businessId: string;
  channel: ContactChannel;
  normalizedValue: string;
  displayValue?: string;
  contactId?: string;
}

/** Idempotent per (business, channel, normalized value); returns the method id. */
export async function upsertContactMethod(db: Database, input: UpsertContactMethodInput): Promise<string> {
  const row = await db
    .insertInto("contact_method")
    .values({
      business_id: input.businessId,
      contact_id: input.contactId ?? null,
      channel: input.channel,
      normalized_value: input.normalizedValue,
      display_value: input.displayValue ?? null,
    })
    .onConflict((oc) =>
      oc.constraint("contact_method_business_value_uq").doUpdateSet({ updated_at: new Date() })
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
