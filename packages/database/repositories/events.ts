/**
 * Canonical event envelope persistence (ADR-004 invariant 15).
 *
 * At-least-once producers call appendEvent with a stable idempotency scope and
 * key; a duplicate delivery returns the already-recorded event instead of
 * appending twice.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType, EventCategory } from "../generated/db.ts";

export interface AppendEventInput {
  category: EventCategory;
  eventType: string;
  occurredAt: Date;
  sourceProducer: string;
  actorType: ActorType;
  idempotencyScope: string;
  idempotencyKey: string;
  schemaVersion?: number;
  actorRef?: string;
  businessId?: string;
  prospectId?: string;
  customerId?: string;
  contactId?: string;
  demoVersionId?: string;
  messageId?: string;
  outreachCampaignId?: string;
  purchaseId?: string;
  experimentExposureId?: string;
  correlationId?: string;
  causationId?: string;
  runId?: string;
  jobId?: string;
  externalRef?: string;
  properties?: Record<string, unknown>;
}

export interface AppendEventResult {
  eventId: string;
  /** True when this delivery was a replay of an already-recorded event. */
  duplicate: boolean;
}

export async function appendEvent(db: Database, input: AppendEventInput): Promise<AppendEventResult> {
  const inserted = await db
    .insertInto("event")
    .values({
      category: input.category,
      event_type: input.eventType,
      schema_version: input.schemaVersion ?? 1,
      occurred_at: input.occurredAt,
      business_id: input.businessId ?? null,
      prospect_id: input.prospectId ?? null,
      customer_id: input.customerId ?? null,
      contact_id: input.contactId ?? null,
      demo_version_id: input.demoVersionId ?? null,
      message_id: input.messageId ?? null,
      outreach_campaign_id: input.outreachCampaignId ?? null,
      purchase_id: input.purchaseId ?? null,
      experiment_exposure_id: input.experimentExposureId ?? null,
      source_producer: input.sourceProducer,
      actor_type: input.actorType,
      actor_ref: input.actorRef ?? null,
      correlation_id: input.correlationId ?? null,
      causation_id: input.causationId ?? null,
      run_id: input.runId ?? null,
      job_id: input.jobId ?? null,
      external_ref: input.externalRef ?? null,
      idempotency_scope: input.idempotencyScope,
      idempotency_key: input.idempotencyKey,
      properties: JSON.stringify(input.properties ?? {}),
    })
    .onConflict((oc) => oc.columns(["idempotency_scope", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();

  if (inserted) {
    return { eventId: inserted.id, duplicate: false };
  }

  const existing = await db
    .selectFrom("event")
    .select("id")
    .where("idempotency_scope", "=", input.idempotencyScope)
    .where("idempotency_key", "=", input.idempotencyKey)
    .executeTakeFirstOrThrow();
  return { eventId: existing.id, duplicate: true };
}
