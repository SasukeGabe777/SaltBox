/**
 * Phase 10 demo hosting persistence.
 *
 * PostgreSQL stores artifact METADATA only — hashes, sizes, content types, and
 * a provider-neutral storage key. The bytes live in the artifact store (local
 * .data directory in development, Cloudflare R2 when hosted).
 *
 * Hosted asset routes resolve exclusively through `demo_asset`: an artifact
 * that was never published for a demo is not reachable, so the public surface
 * can never expose arbitrary evidence, screenshots, or intelligence artifacts.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType } from "../generated/db.ts";

export interface DemoAssetInput {
  demoId: string;
  assetRef: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentHash: string;
  storageProvider: string;
  storageKey: string;
  firstUsedByDemoVersionId?: string;
  publishedAt?: Date | null;
}

export interface DemoAssetRecord {
  id: string;
  demoId: string;
  assetRef: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentHash: string;
  storageProvider: string;
  storageKey: string;
  publishedAt: Date | null;
}

const ASSET_COLUMNS = [
  "id",
  "demo_id",
  "asset_ref",
  "file_name",
  "content_type",
  "byte_size",
  "content_hash",
  "storage_provider",
  "storage_key",
  "published_at",
] as const;

/** Idempotent per (demo, ref, file): re-publishing refreshes storage metadata. */
export async function upsertDemoAsset(db: Database, input: DemoAssetInput): Promise<DemoAssetRecord> {
  const row = await db
    .insertInto("demo_asset")
    .values({
      demo_id: input.demoId,
      asset_ref: input.assetRef,
      file_name: input.fileName,
      content_type: input.contentType,
      byte_size: input.byteSize,
      content_hash: input.contentHash,
      storage_provider: input.storageProvider,
      storage_key: input.storageKey,
      first_used_by_demo_version_id: input.firstUsedByDemoVersionId ?? null,
      published_at: input.publishedAt === undefined ? null : input.publishedAt,
    })
    .onConflict((oc) =>
      oc.columns(["demo_id", "asset_ref", "file_name"]).doUpdateSet({
        content_type: input.contentType,
        byte_size: input.byteSize,
        content_hash: input.contentHash,
        storage_provider: input.storageProvider,
        storage_key: input.storageKey,
        published_at: input.publishedAt === undefined ? null : input.publishedAt,
      }),
    )
    .returning(ASSET_COLUMNS)
    .executeTakeFirstOrThrow();
  return mapAssetRow(row);
}

export async function listDemoAssets(db: Database, demoId: string): Promise<DemoAssetRecord[]> {
  const rows = await db
    .selectFrom("demo_asset")
    .select(ASSET_COLUMNS)
    .where("demo_id", "=", demoId)
    .orderBy("asset_ref")
    .orderBy("file_name")
    .execute();
  return rows.map(mapAssetRow);
}

/**
 * Public asset resolution: only a published asset belonging to a demo that has
 * an approved version is retrievable. Unapproved and unpublished artifacts
 * are simply not found.
 */
export async function findPublishedDemoAsset(
  db: Database,
  assetRef: string,
  fileName: string,
): Promise<DemoAssetRecord | undefined> {
  const row = await db
    .selectFrom("demo_asset as a")
    .innerJoin("demo", "demo.id", "a.demo_id")
    .select([
      "a.id",
      "a.demo_id",
      "a.asset_ref",
      "a.file_name",
      "a.content_type",
      "a.byte_size",
      "a.content_hash",
      "a.storage_provider",
      "a.storage_key",
      "a.published_at",
    ])
    .where("a.asset_ref", "=", assetRef)
    .where("a.file_name", "=", fileName)
    .where("a.published_at", "is not", null)
    .where("demo.approved_demo_version_id", "is not", null)
    .where("demo.status", "not in", ["archived", "expired"])
    .limit(1)
    .executeTakeFirst();
  return row ? mapAssetRow(row) : undefined;
}

export type DemoPublicationStatus = "publishing" | "published" | "failed" | "superseded";
export type DemoPublicationEnvironment = "local" | "hosted";

export interface DemoPublicationRecord {
  id: string;
  demoId: string;
  demoVersionId: string;
  environment: DemoPublicationEnvironment;
  status: DemoPublicationStatus;
  publicUrl: string | null;
  assetCount: number;
  failureMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

const PUBLICATION_COLUMNS = [
  "id",
  "demo_id",
  "demo_version_id",
  "environment",
  "status",
  "public_url",
  "asset_count",
  "failure_message",
  "started_at",
  "completed_at",
] as const;

/**
 * Start a publication attempt. Any live publication for the same demo and
 * environment becomes 'superseded' history first — a published record always
 * describes the version currently served there.
 */
export async function startDemoPublication(
  db: Database,
  input: {
    demoId: string;
    demoVersionId: string;
    environment: DemoPublicationEnvironment;
    actorType: ActorType;
    actorRef?: string;
  },
): Promise<DemoPublicationRecord> {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("demo_publication")
      .set({ status: "superseded", completed_at: new Date() })
      .where("demo_id", "=", input.demoId)
      .where("environment", "=", input.environment)
      .where("status", "in", ["publishing", "published"])
      .execute();
    const row = await trx
      .insertInto("demo_publication")
      .values({
        demo_id: input.demoId,
        demo_version_id: input.demoVersionId,
        environment: input.environment,
        status: "publishing",
        actor_type: input.actorType,
        actor_ref: input.actorRef ?? null,
      })
      .returning(PUBLICATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return mapPublicationRow(row);
  });
}

export async function completeDemoPublication(
  db: Database,
  input: { publicationId: string; publicUrl: string; assetCount: number; detail?: Record<string, unknown> },
): Promise<DemoPublicationRecord> {
  const row = await db
    .updateTable("demo_publication")
    .set({
      status: "published",
      public_url: input.publicUrl,
      asset_count: input.assetCount,
      detail: input.detail === undefined ? null : JSON.stringify(input.detail),
      completed_at: new Date(),
    })
    .where("id", "=", input.publicationId)
    .returning(PUBLICATION_COLUMNS)
    .executeTakeFirstOrThrow();
  return mapPublicationRow(row);
}

export async function failDemoPublication(
  db: Database,
  input: { publicationId: string; failureMessage: string },
): Promise<DemoPublicationRecord> {
  const row = await db
    .updateTable("demo_publication")
    .set({ status: "failed", failure_message: input.failureMessage, completed_at: new Date() })
    .where("id", "=", input.publicationId)
    .returning(PUBLICATION_COLUMNS)
    .executeTakeFirstOrThrow();
  return mapPublicationRow(row);
}

/** The publication currently describing this environment, if any. */
export async function getLiveDemoPublication(
  db: Database,
  demoId: string,
  environment: DemoPublicationEnvironment,
): Promise<DemoPublicationRecord | undefined> {
  const row = await db
    .selectFrom("demo_publication")
    .select(PUBLICATION_COLUMNS)
    .where("demo_id", "=", demoId)
    .where("environment", "=", environment)
    .where("status", "in", ["publishing", "published"])
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? mapPublicationRow(row) : undefined;
}

export async function listDemoPublications(db: Database, demoId: string): Promise<DemoPublicationRecord[]> {
  const rows = await db
    .selectFrom("demo_publication")
    .select(PUBLICATION_COLUMNS)
    .where("demo_id", "=", demoId)
    .orderBy("started_at", "desc")
    .execute();
  return rows.map(mapPublicationRow);
}

function mapAssetRow(row: {
  id: string;
  demo_id: string;
  asset_ref: string;
  file_name: string;
  content_type: string;
  byte_size: string | number | bigint;
  content_hash: string;
  storage_provider: string;
  storage_key: string;
  published_at: Date | null;
}): DemoAssetRecord {
  return {
    id: row.id,
    demoId: row.demo_id,
    assetRef: row.asset_ref,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    contentHash: row.content_hash,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    publishedAt: row.published_at,
  };
}

function mapPublicationRow(row: {
  id: string;
  demo_id: string;
  demo_version_id: string;
  environment: string;
  status: string;
  public_url: string | null;
  asset_count: number;
  failure_message: string | null;
  started_at: Date;
  completed_at: Date | null;
}): DemoPublicationRecord {
  return {
    id: row.id,
    demoId: row.demo_id,
    demoVersionId: row.demo_version_id,
    environment: row.environment as DemoPublicationEnvironment,
    status: row.status as DemoPublicationStatus,
    publicUrl: row.public_url,
    assetCount: row.asset_count,
    failureMessage: row.failure_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
