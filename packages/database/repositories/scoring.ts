/**
 * Scoring versions and immutable lead scores (ADR-004 invariant 7):
 * a recalculation appends a new score, never edits an old one.
 */

import type { Database } from "../client/kysely.ts";

export async function ensureScoringVersion(
  db: Database,
  input: { name: string; inputSchemaVersion: string; artifactVersion: string; description?: string }
): Promise<string> {
  await db
    .insertInto("scoring_version")
    .values({
      name: input.name,
      input_schema_version: input.inputSchemaVersion,
      artifact_version: input.artifactVersion,
      description: input.description ?? null,
    })
    .onConflict((oc) => oc.column("name").doNothing())
    .execute();
  const row = await db
    .selectFrom("scoring_version")
    .select("id")
    .where("name", "=", input.name)
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface ScoreComponentInput {
  dimension: "need" | "value" | "activity" | "reachability" | "overall" | "rule";
  componentKey: string;
  result?: number;
  direction?: "positive" | "negative" | "neutral";
  reasonCode: string;
  contributingFeatures?: Record<string, unknown>;
}

export interface CreateLeadScoreInput {
  prospectId: string;
  featureSetId: string;
  scoringVersionId: string;
  overallScore: number;
  needScore?: number;
  valueScore?: number;
  activityScore?: number;
  reachabilityScore?: number;
  components: ScoreComponentInput[];
}

export async function createLeadScore(db: Database, input: CreateLeadScoreInput): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const score = await trx
      .insertInto("lead_score")
      .values({
        prospect_id: input.prospectId,
        feature_set_id: input.featureSetId,
        scoring_version_id: input.scoringVersionId,
        overall_score: input.overallScore,
        need_score: input.needScore ?? null,
        value_score: input.valueScore ?? null,
        activity_score: input.activityScore ?? null,
        reachability_score: input.reachabilityScore ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const component of input.components) {
      await trx
        .insertInto("score_component")
        .values({
          lead_score_id: score.id,
          dimension: component.dimension,
          component_key: component.componentKey,
          result: component.result ?? null,
          direction: component.direction ?? null,
          reason_code: component.reasonCode,
          contributing_features: component.contributingFeatures
            ? JSON.stringify(component.contributingFeatures)
            : null,
        })
        .execute();
    }

    return score.id;
  });
}
