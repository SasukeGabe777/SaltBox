/**
 * Append-oriented typed observations (ADR-004 provenance model).
 *
 * Exactly one typed value per observation; conflicting source claims append
 * new observations instead of overwriting anything.
 */

import type { Database } from "../client/kysely.ts";
import type { ConfidenceBand, SubjectKind } from "../generated/db.ts";

export type ObservationValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; unit?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "timestamp"; value: Date }
  | { kind: "json"; value: Record<string, unknown> };

export interface RecordObservationInput {
  subjectKind: SubjectKind;
  subjectId: string;
  fieldKey: string;
  value: ObservationValue;
  sourceId: string;
  observedAt: Date;
  sourceRecordId?: string;
  retrievedAt?: Date;
  /** Defaults to now; passed explicitly by imports/backfills. */
  recordedAt?: Date;
  schemaVersion?: number;
  confidence?: ConfidenceBand;
  verificationMethod?: string;
  freshnessPolicy?: string;
  expiresAt?: Date;
  evidenceRef?: string;
  evidenceHash?: string;
  evidenceSummary?: string;
}

export async function recordObservation(db: Database, input: RecordObservationInput): Promise<string> {
  const value = input.value;
  const row = await db
    .insertInto("observation")
    .values({
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      field_key: input.fieldKey,
      schema_version: input.schemaVersion ?? 1,
      value_text: value.kind === "text" ? value.value : null,
      value_number: value.kind === "number" ? value.value : null,
      value_boolean: value.kind === "boolean" ? value.value : null,
      value_at: value.kind === "timestamp" ? value.value : null,
      value_json: value.kind === "json" ? JSON.stringify(value.value) : null,
      unit: value.kind === "number" ? (value.unit ?? null) : null,
      source_id: input.sourceId,
      source_record_id: input.sourceRecordId ?? null,
      observed_at: input.observedAt,
      retrieved_at: input.retrievedAt ?? null,
      ...(input.recordedAt !== undefined ? { recorded_at: input.recordedAt } : {}),
      confidence: input.confidence ?? "unknown",
      verification_method: input.verificationMethod ?? null,
      freshness_policy: input.freshnessPolicy ?? null,
      expires_at: input.expiresAt ?? null,
      evidence_ref: input.evidenceRef ?? null,
      evidence_hash: input.evidenceHash ?? null,
      evidence_summary: input.evidenceSummary ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
