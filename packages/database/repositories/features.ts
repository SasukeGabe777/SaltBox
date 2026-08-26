/**
 * Feature definitions and immutable feature sets (ADR-004 learning inputs).
 * Feature sets are point-in-time snapshots: there is deliberately no update
 * operation in this module.
 */

import type { Database } from "../client/kysely.ts";

export interface FeatureDefinitionSpec {
  name: string;
  dataType: "text" | "number" | "boolean" | "timestamp" | "json";
  description: string;
  unit?: string;
}

/** Register feature definitions idempotently and return name → id. */
export async function ensureFeatureDefinitions(
  db: Database,
  specs: FeatureDefinitionSpec[]
): Promise<Map<string, string>> {
  for (const spec of specs) {
    await db
      .insertInto("feature_definition")
      .values({
        name: spec.name,
        data_type: spec.dataType,
        description: spec.description,
        unit: spec.unit ?? null,
      })
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();
  }
  const rows = await db
    .selectFrom("feature_definition")
    .select(["id", "name"])
    .where("name", "in", specs.map((s) => s.name))
    .execute();
  return new Map(rows.map((r) => [r.name, r.id]));
}

export type FeatureValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number };

export interface CreateFeatureSetInput {
  prospectId: string;
  featureSchemaVersion: string;
  pipelineVersion: string;
  asOf: Date;
  /** Stable typed feature-contract columns (ADR-004). */
  stable?: {
    mobilePass?: boolean;
    emailAvailable?: boolean;
    businessCategory?: string;
  };
  /** Governed extension features against the feature_definition registry. */
  values: { definitionId: string; value: FeatureValue }[];
  lineage: { inputKind: "observation" | "website_analysis" | "feature_set"; inputId: string; transformation?: string }[];
}

export async function createFeatureSet(db: Database, input: CreateFeatureSetInput): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const featureSet = await trx
      .insertInto("feature_set")
      .values({
        prospect_id: input.prospectId,
        feature_schema_version: input.featureSchemaVersion,
        pipeline_version: input.pipelineVersion,
        as_of: input.asOf,
        mobile_pass: input.stable?.mobilePass ?? null,
        email_available: input.stable?.emailAvailable ?? null,
        business_category: input.stable?.businessCategory ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const { definitionId, value } of input.values) {
      await trx
        .insertInto("feature_set_value")
        .values({
          feature_set_id: featureSet.id,
          feature_definition_id: definitionId,
          value_boolean: value.kind === "boolean" ? value.value : null,
          value_text: value.kind === "text" ? value.value : null,
          value_number: value.kind === "number" ? value.value : null,
        })
        .execute();
    }

    for (const entry of input.lineage) {
      await trx
        .insertInto("feature_set_lineage")
        .values({
          feature_set_id: featureSet.id,
          input_kind: entry.inputKind,
          input_id: entry.inputId,
          transformation: entry.transformation ?? null,
        })
        .execute();
    }

    return featureSet.id;
  });
}
