/**
 * First-class decisions with structured reasons (ADR-004 invariant 8).
 * Decisions are append-only; recalculation appends a new decision.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType, ConfidenceBand } from "../generated/db.ts";

export interface DecisionReasonInput {
  reasonCode: string;
  contribution?: "supports" | "opposes" | "neutral";
  explanation?: string;
  featureRef?: string;
  evidenceKind?: string;
  evidenceId?: string;
}

export interface CreateDecisionInput {
  decisionType: string;
  resultCode: string;
  resultDetail?: Record<string, unknown>;
  policyVersion: string;
  actorType: ActorType;
  actorRef?: string;
  businessId?: string;
  prospectId?: string;
  featureSetId?: string;
  leadScoreId?: string;
  confidence?: ConfidenceBand;
  correlationId?: string;
  reasons: DecisionReasonInput[];
}

export async function createDecision(db: Database, input: CreateDecisionInput): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const decision = await trx
      .insertInto("decision")
      .values({
        decision_type: input.decisionType,
        result_code: input.resultCode,
        result_detail: input.resultDetail ? JSON.stringify(input.resultDetail) : null,
        policy_version: input.policyVersion,
        actor_type: input.actorType,
        actor_ref: input.actorRef ?? null,
        business_id: input.businessId ?? null,
        prospect_id: input.prospectId ?? null,
        feature_set_id: input.featureSetId ?? null,
        lead_score_id: input.leadScoreId ?? null,
        confidence: input.confidence ?? null,
        correlation_id: input.correlationId ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const reason of input.reasons) {
      await trx
        .insertInto("decision_reason")
        .values({
          decision_id: decision.id,
          reason_code: reason.reasonCode,
          contribution: reason.contribution ?? null,
          explanation: reason.explanation ?? null,
          feature_ref: reason.featureRef ?? null,
          evidence_kind: reason.evidenceKind ?? null,
          evidence_id: reason.evidenceId ?? null,
        })
        .execute();
    }

    return decision.id;
  });
}
