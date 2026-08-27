/**
 * Entity-match candidates (ADR-004 entity resolution): conservative,
 * evidence-carrying records of cross-source identity conclusions. Auto-links
 * record who/what resolved them; ambiguous candidates stay pending for
 * review. Uncertainty never merges businesses silently.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType, ConfidenceBand } from "../generated/db.ts";

export interface CreateEntityMatchCandidateInput {
  subjectKind: "source_record" | "business";
  subjectId: string;
  candidateBusinessId: string;
  signals: Record<string, unknown>;
  confidence: ConfidenceBand;
  resolutionPolicyVersion: string;
  status?: "pending" | "auto_linked";
  resolutionReason?: string;
  resolvedByActorType?: ActorType;
  resolvedByActorRef?: string;
}

export async function createEntityMatchCandidate(
  db: Database,
  input: CreateEntityMatchCandidateInput
): Promise<string> {
  const status = input.status ?? "pending";
  const row = await db
    .insertInto("entity_match_candidate")
    .values({
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      candidate_business_id: input.candidateBusinessId,
      signals: JSON.stringify(input.signals),
      confidence: input.confidence,
      resolution_policy_version: input.resolutionPolicyVersion,
      status,
      ...(status !== "pending"
        ? {
            resolved_at: new Date(),
            resolved_by_actor_type: input.resolvedByActorType ?? "system",
            resolved_by_actor_ref: input.resolvedByActorRef ?? null,
            resolution_reason: input.resolutionReason ?? "Automatic resolution.",
          }
        : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface EntityMatchCandidateRecord {
  id: string;
  subjectKind: string;
  subjectId: string;
  candidateBusinessId: string;
  status: string;
  confidence: ConfidenceBand;
  resolutionPolicyVersion: string;
}

export async function listEntityMatchCandidatesForSubject(
  db: Database,
  subjectKind: "source_record" | "business",
  subjectId: string
): Promise<EntityMatchCandidateRecord[]> {
  const rows = await db
    .selectFrom("entity_match_candidate")
    .select(["id", "subject_kind", "subject_id", "candidate_business_id", "status", "confidence", "resolution_policy_version"])
    .where("subject_kind", "=", subjectKind)
    .where("subject_id", "=", subjectId)
    .orderBy("created_at")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    candidateBusinessId: row.candidate_business_id,
    status: row.status,
    confidence: row.confidence,
    resolutionPolicyVersion: row.resolution_policy_version,
  }));
}
