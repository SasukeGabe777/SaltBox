/**
 * Demo persistence over the existing ADR-004 schema (invariants 10 and 19):
 * one Demo identity per prospect pursuit, append-only DemoVersion history,
 * and opaque revocable public locators that are never derived from internal
 * identifiers. Regeneration appends a new version; it never mutates an old
 * one.
 */

import type { Database } from "../client/kysely.ts";

export interface EnsureDemoTemplateInput {
  name: string;
  description?: string;
  version: string;
  /** Module/artifact reference for the renderer implementation, never a filesystem path. */
  artifactRef?: string;
}

export interface DemoTemplateVersionRef {
  demoTemplateId: string;
  demoTemplateVersionId: string;
}

/** Idempotently register a template and one exact template version. */
export async function ensureDemoTemplateVersion(
  db: Database,
  input: EnsureDemoTemplateInput,
): Promise<DemoTemplateVersionRef> {
  await db
    .insertInto("demo_template")
    .values({ name: input.name, description: input.description ?? null })
    .onConflict((oc) => oc.column("name").doNothing())
    .execute();
  const template = await db
    .selectFrom("demo_template")
    .select("id")
    .where("name", "=", input.name)
    .executeTakeFirstOrThrow();
  await db
    .insertInto("demo_template_version")
    .values({
      demo_template_id: template.id,
      version: input.version,
      artifact_ref: input.artifactRef ?? null,
    })
    .onConflict((oc) => oc.columns(["demo_template_id", "version"]).doNothing())
    .execute();
  const templateVersion = await db
    .selectFrom("demo_template_version")
    .select("id")
    .where("demo_template_id", "=", template.id)
    .where("version", "=", input.version)
    .executeTakeFirstOrThrow();
  return { demoTemplateId: template.id, demoTemplateVersionId: templateVersion.id };
}

export type DemoStatus = "draft" | "generating" | "ready" | "published" | "archived" | "expired";

export interface DemoRecord {
  id: string;
  prospectId: string;
  concept: string | null;
  status: DemoStatus;
  currentDemoVersionId: string | null;
  /** The operator-approved version (Phase 10); never moved by generation. */
  approvedDemoVersionId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapDemoRow(row: {
  id: string;
  prospect_id: string;
  concept: string | null;
  status: string;
  current_demo_version_id: string | null;
  approved_demo_version_id: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}): DemoRecord {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    concept: row.concept,
    status: row.status as DemoStatus,
    currentDemoVersionId: row.current_demo_version_id,
    approvedDemoVersionId: row.approved_demo_version_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEMO_COLUMNS = [
  "id",
  "prospect_id",
  "concept",
  "status",
  "current_demo_version_id",
  "approved_demo_version_id",
  "revision",
  "created_at",
  "updated_at",
] as const;

/** The prospect's live demo identity (archived/expired demos are history). */
export async function getDemoForProspect(db: Database, prospectId: string): Promise<DemoRecord | undefined> {
  const row = await db
    .selectFrom("demo")
    .select(DEMO_COLUMNS)
    .where("prospect_id", "=", prospectId)
    .where("status", "not in", ["archived", "expired"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? mapDemoRow(row) : undefined;
}

export async function getDemoById(db: Database, demoId: string): Promise<DemoRecord | undefined> {
  const row = await db.selectFrom("demo").select(DEMO_COLUMNS).where("id", "=", demoId).executeTakeFirst();
  return row ? mapDemoRow(row) : undefined;
}

export async function createDemo(
  db: Database,
  input: { prospectId: string; concept?: string; status?: DemoStatus },
): Promise<DemoRecord> {
  const row = await db
    .insertInto("demo")
    .values({
      prospect_id: input.prospectId,
      concept: input.concept ?? null,
      status: input.status ?? "draft",
    })
    .returning(DEMO_COLUMNS)
    .executeTakeFirstOrThrow();
  return mapDemoRow(row);
}

/** Optimistic-concurrency status/current-version update; false when stale. */
export async function updateDemo(
  db: Database,
  input: {
    demoId: string;
    expectedRevision: number;
    status?: DemoStatus;
    currentDemoVersionId?: string;
    concept?: string;
  },
): Promise<boolean> {
  const result = await db
    .updateTable("demo")
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.currentDemoVersionId !== undefined ? { current_demo_version_id: input.currentDemoVersionId } : {}),
      ...(input.concept !== undefined ? { concept: input.concept } : {}),
      revision: input.expectedRevision + 1,
      updated_at: new Date(),
    })
    .where("id", "=", input.demoId)
    .where("revision", "=", input.expectedRevision)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface AppendDemoVersionInput {
  demoId: string;
  demoTemplateVersionId: string;
  /** FeatureSet of the qualification run this demo was generated from. */
  featureSetId?: string;
  contentInputRef?: string;
  contentInputVersion?: string;
  generatedContentVersion?: string;
  /** Bounded structured metadata: DemoPlan, DemoContent, generation info. */
  generatorMetadata?: Record<string, unknown>;
  contentHash: string;
  publishedAt?: Date;
}

export interface DemoVersionRecord {
  id: string;
  demoId: string;
  versionNumber: number;
  demoTemplateVersionId: string;
  featureSetId: string | null;
  contentHash: string;
  contentInputRef: string | null;
  contentInputVersion: string | null;
  generatedContentVersion: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

/** Bounded persisted-metadata guard: structured content, never large artifacts. */
const MAX_GENERATOR_METADATA_BYTES = 192 * 1024;

/** Append-only: the next version number is allocated inside a transaction. */
export async function appendDemoVersion(db: Database, input: AppendDemoVersionInput): Promise<DemoVersionRecord> {
  const metadataJson = input.generatorMetadata === undefined ? null : JSON.stringify(input.generatorMetadata);
  if (metadataJson !== null && Buffer.byteLength(metadataJson, "utf8") > MAX_GENERATOR_METADATA_BYTES) {
    throw new Error(
      `Demo generator metadata exceeds the ${MAX_GENERATOR_METADATA_BYTES}-byte bound; ` +
        "large artifacts belong in the git-ignored artifact directory, not PostgreSQL.",
    );
  }
  return db.transaction().execute(async (trx) => {
    const latest = await trx
      .selectFrom("demo_version")
      .select("version_number")
      .where("demo_id", "=", input.demoId)
      .orderBy("version_number", "desc")
      .limit(1)
      .executeTakeFirst();
    const row = await trx
      .insertInto("demo_version")
      .values({
        demo_id: input.demoId,
        version_number: (latest?.version_number ?? 0) + 1,
        demo_template_version_id: input.demoTemplateVersionId,
        feature_set_id: input.featureSetId ?? null,
        content_input_ref: input.contentInputRef ?? null,
        content_input_version: input.contentInputVersion ?? null,
        generated_content_version: input.generatedContentVersion ?? null,
        generator_metadata: metadataJson,
        content_hash: input.contentHash,
        published_at: input.publishedAt ?? null,
      })
      .returning([
        "id",
        "demo_id",
        "version_number",
        "demo_template_version_id",
        "feature_set_id",
        "content_hash",
        "content_input_ref",
        "content_input_version",
        "generated_content_version",
        "created_at",
        "published_at",
      ])
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      demoId: row.demo_id,
      versionNumber: row.version_number,
      demoTemplateVersionId: row.demo_template_version_id,
      featureSetId: row.feature_set_id,
      contentHash: row.content_hash,
      contentInputRef: row.content_input_ref,
      contentInputVersion: row.content_input_version,
      generatedContentVersion: row.generated_content_version,
      createdAt: row.created_at,
      publishedAt: row.published_at,
    };
  });
}

export async function getLatestDemoVersion(db: Database, demoId: string): Promise<DemoVersionRecord | undefined> {
  const row = await db
    .selectFrom("demo_version")
    .select([
      "id",
      "demo_id",
      "version_number",
      "demo_template_version_id",
      "feature_set_id",
      "content_hash",
      "content_input_ref",
      "content_input_version",
      "generated_content_version",
      "created_at",
      "published_at",
    ])
    .where("demo_id", "=", demoId)
    .orderBy("version_number", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    demoId: row.demo_id,
    versionNumber: row.version_number,
    demoTemplateVersionId: row.demo_template_version_id,
    featureSetId: row.feature_set_id,
    contentHash: row.content_hash,
    contentInputRef: row.content_input_ref,
    contentInputVersion: row.content_input_version,
    generatedContentVersion: row.generated_content_version,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export interface DemoLocatorRecord {
  id: string;
  demoId: string;
  token: string;
  created: boolean;
}

/**
 * Reuse the demo's active locator or create one with the supplied opaque
 * token (invariant 19: never derived from internal identifiers).
 */
export async function ensureActiveDemoLocator(
  db: Database,
  input: { demoId: string; token: string },
): Promise<DemoLocatorRecord> {
  const now = new Date();
  const existing = await db
    .selectFrom("demo_public_locator")
    .select(["id", "token"])
    .where("demo_id", "=", input.demoId)
    .where("status", "=", "active")
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", now)]))
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (existing) return { id: existing.id, demoId: input.demoId, token: existing.token, created: false };
  const row = await db
    .insertInto("demo_public_locator")
    .values({ demo_id: input.demoId, token: input.token })
    .returning(["id", "token"])
    .executeTakeFirstOrThrow();
  return { id: row.id, demoId: input.demoId, token: row.token, created: true };
}

/** Revoke one locator; the row is preserved as history. */
export async function revokeDemoLocator(db: Database, locatorId: string): Promise<boolean> {
  const result = await db
    .updateTable("demo_public_locator")
    .set({ status: "revoked", revoked_at: new Date() })
    .where("id", "=", locatorId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
