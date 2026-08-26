/**
 * Point-in-time extraction queries (ADR-004 availability-cutoff rules).
 *
 * The cutoff applies to BOTH the fact's own time (observed_at / as_of) and
 * SaltBox's availability time (recorded_at / calculated_at): late-recorded
 * backfills must never enter a historical decision's input view. Helpers take
 * the cutoff explicitly; nothing here infers it from current state.
 */

import type { Database } from "../client/kysely.ts";
import type { ConfidenceBand, SubjectKind } from "../generated/db.ts";

export interface AvailableObservation {
  id: string;
  fieldKey: string;
  observedAt: Date;
  recordedAt: Date;
  confidence: ConfidenceBand;
  valueText: string | null;
  valueNumber: string | null;
  valueBoolean: boolean | null;
  valueAt: Date | null;
}

/**
 * The latest observation per field for a subject, using only observations
 * that were both observed and durably recorded no later than the cutoff.
 */
export async function observationsAvailableAt(
  db: Database,
  input: { subjectKind: SubjectKind; subjectId: string; cutoff: Date }
): Promise<AvailableObservation[]> {
  const rows = await db
    .selectFrom("observation")
    .distinctOn("field_key")
    .select([
      "id",
      "field_key",
      "observed_at",
      "recorded_at",
      "confidence",
      "value_text",
      "value_number",
      "value_boolean",
      "value_at",
    ])
    .where("subject_kind", "=", input.subjectKind)
    .where("subject_id", "=", input.subjectId)
    .where("observed_at", "<=", input.cutoff)
    .where("recorded_at", "<=", input.cutoff)
    .where("superseded_by_observation_id", "is", null)
    .orderBy("field_key")
    .orderBy("observed_at", "desc")
    .orderBy("recorded_at", "desc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    fieldKey: row.field_key,
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
    confidence: row.confidence,
    valueText: row.value_text,
    valueNumber: row.value_number,
    valueBoolean: row.value_boolean,
    valueAt: row.value_at,
  }));
}

/**
 * The feature set a decision at `cutoff` was allowed to use: the newest
 * snapshot whose as_of and calculated_at both precede the cutoff.
 */
export async function latestFeatureSetAvailableAt(
  db: Database,
  input: { prospectId: string; cutoff: Date }
): Promise<{ id: string; asOf: Date; calculatedAt: Date; featureSchemaVersion: string } | undefined> {
  const row = await db
    .selectFrom("feature_set")
    .select(["id", "as_of", "calculated_at", "feature_schema_version"])
    .where("prospect_id", "=", input.prospectId)
    .where("as_of", "<=", input.cutoff)
    .where("calculated_at", "<=", input.cutoff)
    .orderBy("as_of", "desc")
    .orderBy("calculated_at", "desc")
    .limit(1)
    .executeTakeFirst();

  return row
    ? { id: row.id, asOf: row.as_of, calculatedAt: row.calculated_at, featureSchemaVersion: row.feature_schema_version }
    : undefined;
}
