/**
 * Prospect lifecycle domain service (ADR-004 invariant 9).
 *
 * Lifecycle state changes happen only here: allowed transition + optimistic
 * revision check + appended ProspectStateTransition + domain event, all in one
 * transaction. Nothing else may UPDATE prospect.lifecycle_state.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType, ProspectLifecycleState } from "../generated/db.ts";

export const TERMINAL_STATES: readonly ProspectLifecycleState[] = ["rejected", "won", "lost"];

/**
 * The ADR-004 lifecycle chart. `paused` may resume to any nonterminal state;
 * the transition record's from/to pair preserves what actually happened.
 */
export const ALLOWED_TRANSITIONS: Record<ProspectLifecycleState, readonly ProspectLifecycleState[]> = {
  discovered: ["enriching", "paused"],
  enriching: ["evaluated", "paused"],
  evaluated: ["qualified", "rejected", "paused"],
  qualified: ["outreach_active", "paused"],
  outreach_active: ["engaged", "paused"],
  engaged: ["sales_active", "paused"],
  sales_active: ["won", "lost", "paused"],
  paused: ["discovered", "enriching", "evaluated", "qualified", "outreach_active", "engaged", "sales_active"],
  rejected: [],
  won: [],
  lost: [],
};

export type ProspectTransitionErrorCode = "not_found" | "invalid_transition" | "stale_revision";

export class ProspectTransitionError extends Error {
  readonly code: ProspectTransitionErrorCode;

  constructor(code: ProspectTransitionErrorCode, message: string) {
    super(message);
    this.name = "ProspectTransitionError";
    this.code = code;
  }
}

export interface ProspectRecord {
  id: string;
  businessId: string;
  marketScope: string;
  offerScope: string;
  lifecycleState: ProspectLifecycleState;
  revision: number;
}

export interface OpenProspectInput {
  businessId: string;
  marketScope?: string;
  offerScope?: string;
  actorType: ActorType;
  actorRef?: string;
  reasonCode: string;
  correlationId?: string;
}

/** Create a prospect in `discovered` with its creation transition recorded. */
export async function openProspect(db: Database, input: OpenProspectInput): Promise<ProspectRecord> {
  return db.transaction().execute(async (trx) => {
    const prospect = await trx
      .insertInto("prospect")
      .values({
        business_id: input.businessId,
        market_scope: input.marketScope ?? "default",
        offer_scope: input.offerScope ?? "default",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("prospect_state_transition")
      .values({
        prospect_id: prospect.id,
        from_state: null,
        to_state: "discovered",
        prior_revision: 0,
        reason_code: input.reasonCode,
        actor_type: input.actorType,
        actor_ref: input.actorRef ?? null,
        correlation_id: input.correlationId ?? null,
      })
      .execute();

    return mapProspect(prospect);
  });
}

export async function getProspectById(db: Database, id: string): Promise<ProspectRecord | undefined> {
  const row = await db.selectFrom("prospect").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? mapProspect(row) : undefined;
}

export interface TransitionProspectInput {
  prospectId: string;
  expectedRevision: number;
  toState: ProspectLifecycleState;
  reasonCode: string;
  reasonNote?: string;
  triggerKind?: string;
  decisionId?: string;
  actorType: ActorType;
  actorRef?: string;
  correlationId?: string;
}

export interface TransitionResult {
  prospectId: string;
  fromState: ProspectLifecycleState;
  toState: ProspectLifecycleState;
  revision: number;
  transitionId: string;
  eventId: string;
}

export async function transitionProspect(db: Database, input: TransitionProspectInput): Promise<TransitionResult> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom("prospect")
      .select(["id", "business_id", "lifecycle_state", "revision"])
      .where("id", "=", input.prospectId)
      .forUpdate()
      .executeTakeFirst();

    if (!current) {
      throw new ProspectTransitionError("not_found", `Prospect ${input.prospectId} does not exist.`);
    }
    if (current.revision !== input.expectedRevision) {
      throw new ProspectTransitionError(
        "stale_revision",
        `Prospect ${input.prospectId} is at revision ${current.revision}, expected ${input.expectedRevision}.`
      );
    }
    if (!ALLOWED_TRANSITIONS[current.lifecycle_state].includes(input.toState)) {
      throw new ProspectTransitionError(
        "invalid_transition",
        `Transition ${current.lifecycle_state} → ${input.toState} is not allowed.`
      );
    }

    const nextRevision = current.revision + 1;
    const terminal = TERMINAL_STATES.includes(input.toState);
    const now = new Date();

    const updated = await trx
      .updateTable("prospect")
      .set({
        lifecycle_state: input.toState,
        state_changed_at: now,
        closed_at: terminal ? now : null,
        updated_at: now,
        revision: nextRevision,
      })
      .where("id", "=", input.prospectId)
      .where("revision", "=", input.expectedRevision)
      .executeTakeFirst();

    if (updated.numUpdatedRows !== 1n) {
      throw new ProspectTransitionError(
        "stale_revision",
        `Prospect ${input.prospectId} changed concurrently during the transition.`
      );
    }

    const transition = await trx
      .insertInto("prospect_state_transition")
      .values({
        prospect_id: input.prospectId,
        from_state: current.lifecycle_state,
        to_state: input.toState,
        prior_revision: input.expectedRevision,
        trigger_kind: input.triggerKind ?? null,
        decision_id: input.decisionId ?? null,
        reason_code: input.reasonCode,
        reason_note: input.reasonNote ?? null,
        actor_type: input.actorType,
        actor_ref: input.actorRef ?? null,
        correlation_id: input.correlationId ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Same-transaction domain event (ADR-004 canonical event architecture).
    // The revision-based idempotency key makes an accidental replay collide.
    const event = await trx
      .insertInto("event")
      .values({
        category: "domain",
        event_type: "prospect_state_changed",
        occurred_at: now,
        business_id: current.business_id,
        prospect_id: input.prospectId,
        source_producer: "prospect-domain-service",
        actor_type: input.actorType,
        actor_ref: input.actorRef ?? null,
        correlation_id: input.correlationId ?? null,
        idempotency_scope: "prospect_state_transition",
        idempotency_key: `${input.prospectId}:${nextRevision}`,
        properties: JSON.stringify({
          from_state: current.lifecycle_state,
          to_state: input.toState,
          reason_code: input.reasonCode,
        }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return {
      prospectId: input.prospectId,
      fromState: current.lifecycle_state,
      toState: input.toState,
      revision: nextRevision,
      transitionId: transition.id,
      eventId: event.id,
    };
  });
}

interface ProspectRow {
  id: string;
  business_id: string;
  market_scope: string;
  offer_scope: string;
  lifecycle_state: ProspectLifecycleState;
  revision: number;
}

function mapProspect(row: ProspectRow): ProspectRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    marketScope: row.market_scope,
    offerScope: row.offer_scope,
    lifecycleState: row.lifecycle_state,
    revision: row.revision,
  };
}
