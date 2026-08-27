/**
 * Suppression safety state (ADR-004 invariants 12–13).
 *
 * Eligibility is computed across every applicable scope; positive eligibility
 * never overrides an active stronger suppression. Revocation is a separately
 * authorized action that preserves the record.
 */

import { sql } from "kysely";
import type { Database } from "../client/kysely.ts";
import type { ActorType, ContactChannel, SuppressionScope, SuppressionType } from "../generated/db.ts";

/**
 * Effectiveness is evaluated against the DATABASE clock, never the caller's.
 * `effective_at` defaults to the server's now(); comparing it to a client
 * timestamp can hide a just-activated suppression whenever the two clocks
 * disagree (a container and its host routinely do), and a missed suppression
 * is exactly the failure SaltBox must never have.
 */
const databaseNow = () => sql<Date>`now()`;

export interface ActivateSuppressionInput {
  scope: SuppressionScope;
  suppressionType: SuppressionType;
  reason: string;
  actorType: ActorType;
  actorRef?: string;
  businessId?: string;
  contactId?: string;
  contactMethodId?: string;
  channel?: ContactChannel;
  addressPattern?: string;
  sourceRef?: string;
  evidenceRef?: string;
  expiresAt?: Date;
}

export async function activateSuppression(db: Database, input: ActivateSuppressionInput): Promise<string> {
  const row = await db
    .insertInto("suppression")
    .values({
      scope: input.scope,
      suppression_type: input.suppressionType,
      reason: input.reason,
      actor_type: input.actorType,
      actor_ref: input.actorRef ?? null,
      business_id: input.businessId ?? null,
      contact_id: input.contactId ?? null,
      contact_method_id: input.contactMethodId ?? null,
      channel: input.channel ?? null,
      address_pattern: input.addressPattern ?? null,
      source_ref: input.sourceRef ?? null,
      evidence_ref: input.evidenceRef ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface RevokeSuppressionInput {
  suppressionId: string;
  revokedByActorRef: string;
  authorizationRef: string;
}

/** Revoke an active suppression; the record itself is never deleted. */
export async function revokeSuppression(db: Database, input: RevokeSuppressionInput): Promise<boolean> {
  const result = await db
    .updateTable("suppression")
    .set({
      status: "revoked",
      revoked_at: new Date(),
      revoked_by_actor_ref: input.revokedByActorRef,
      revoke_authorization_ref: input.authorizationRef,
    })
    .where("id", "=", input.suppressionId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface OutreachEligibilityInput {
  businessId: string;
  channel: ContactChannel;
  contactId?: string;
  contactMethodId?: string;
  /** Normalized address (e.g. lowercase email) for address-pattern scopes. */
  normalizedAddress?: string;
}

export interface OutreachEligibility {
  eligible: boolean;
  blockingSuppressionIds: string[];
}

/** Qualification hard-stop scope: active global or business suppression. */
export async function activeQualificationSuppressions(
  db: Database,
  businessId: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom("suppression")
    .select("id")
    .where("status", "=", "active")
    .where("effective_at", "<=", databaseNow())
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", databaseNow())]))
    .where((eb) =>
      eb.or([
        eb("scope", "=", "global"),
        eb.and([eb("scope", "=", "business"), eb("business_id", "=", businessId)]),
      ]),
    )
    .execute();
  return rows.map((row) => row.id);
}

/**
 * A contact action is eligible only when no active, effective suppression
 * matches any applicable scope. Address-pattern matching is exact for now;
 * richer pattern semantics are a versioned policy decision.
 */
export async function checkOutreachEligibility(
  db: Database,
  input: OutreachEligibilityInput
): Promise<OutreachEligibility> {
  const rows = await db
    .selectFrom("suppression")
    .select(["id"])
    .where("status", "=", "active")
    .where("effective_at", "<=", databaseNow())
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", databaseNow())]))
    .where((eb) => {
      const scopes = [
        eb("scope", "=", "global" as const),
        eb.and([eb("scope", "=", "business" as const), eb("business_id", "=", input.businessId)]),
        eb.and([eb("scope", "=", "channel" as const), eb("channel", "=", input.channel)]),
      ];
      if (input.contactId !== undefined) {
        scopes.push(eb.and([eb("scope", "=", "contact" as const), eb("contact_id", "=", input.contactId)]));
      }
      if (input.contactMethodId !== undefined) {
        scopes.push(
          eb.and([eb("scope", "=", "contact_method" as const), eb("contact_method_id", "=", input.contactMethodId)])
        );
      }
      if (input.normalizedAddress !== undefined) {
        scopes.push(
          eb.and([eb("scope", "=", "address_pattern" as const), eb("address_pattern", "=", input.normalizedAddress)])
        );
      }
      return eb.or(scopes);
    })
    .execute();

  return { eligible: rows.length === 0, blockingSuppressionIds: rows.map((r) => r.id) };
}
