/**
 * Read models for the demo renderer and the read-only admin.
 *
 * The public resolver answers exactly one question — "which persisted demo
 * version does this opaque locator serve?" — and never exposes internal
 * identifiers beyond what the renderer needs. Unknown, revoked, and expired
 * locators all resolve to nothing.
 */

import type { Database } from "../client/kysely.ts";
import type { JsonValue } from "../generated/db.ts";

/** Opaque public token shape (base64url); validated before any query. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface PublicDemoVersionView {
  demoVersionId: string;
  versionNumber: number;
  templateName: string;
  templateVersion: string;
  contentInputVersion: string | null;
  generatedContentVersion: string | null;
  createdAt: string;
  publishedAt: string | null;
  /** demo-content-v1 rendering contract persisted at generation time. */
  content: Record<string, unknown> | null;
}

export interface PublicDemoView {
  demoId: string;
  demoStatus: string;
  version: PublicDemoVersionView;
}

/** Resolve an opaque locator to its demo's current persisted version. */
export async function resolveDemoByLocator(db: Database, token: string): Promise<PublicDemoView | undefined> {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const now = new Date();
  const row = await db
    .selectFrom("demo_public_locator as loc")
    .innerJoin("demo", "demo.id", "loc.demo_id")
    .innerJoin("demo_version as dv", "dv.id", "demo.current_demo_version_id")
    .innerJoin("demo_template_version as dtv", "dtv.id", "dv.demo_template_version_id")
    .innerJoin("demo_template as dt", "dt.id", "dtv.demo_template_id")
    .select([
      "demo.id as demo_id",
      "demo.status as demo_status",
      "demo.expires_at as demo_expires_at",
      "dv.id as demo_version_id",
      "dv.version_number",
      "dv.content_input_version",
      "dv.generated_content_version",
      "dv.generator_metadata",
      "dv.created_at",
      "dv.published_at",
      "dt.name as template_name",
      "dtv.version as template_version",
    ])
    .where("loc.token", "=", token)
    .where("loc.status", "=", "active")
    .where((eb) => eb.or([eb("loc.expires_at", "is", null), eb("loc.expires_at", ">", now)]))
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.demo_status === "archived" || row.demo_status === "expired") return undefined;
  if (row.demo_expires_at !== null && row.demo_expires_at <= now) return undefined;
  const metadata = asRecord(row.generator_metadata);
  return {
    demoId: row.demo_id,
    demoStatus: row.demo_status,
    version: {
      demoVersionId: row.demo_version_id,
      versionNumber: row.version_number,
      templateName: row.template_name,
      templateVersion: row.template_version,
      contentInputVersion: row.content_input_version,
      generatedContentVersion: row.generated_content_version,
      createdAt: toIso(row.created_at),
      publishedAt: row.published_at ? toIso(row.published_at) : null,
      content: asRecord(metadata?.content),
    },
  };
}

export interface ProspectDemoVersionSummary {
  demoVersionId: string;
  versionNumber: number;
  templateName: string;
  templateVersion: string;
  contentInputVersion: string | null;
  generatedContentVersion: string | null;
  contentHash: string;
  createdAt: string;
  publishedAt: string | null;
  isCurrent: boolean;
}

export interface ProspectDemoView {
  demoId: string;
  status: string;
  concept: string | null;
  createdAt: string;
  updatedAt: string;
  /** Active public locator token, if one exists. */
  locatorToken: string | null;
  currentVersion: ProspectDemoVersionSummary | null;
  versions: ProspectDemoVersionSummary[];
  /** Bounded demo-plan summary persisted with the current version. */
  planSummary: Record<string, unknown> | null;
  /** Qualification lineage of the current version. */
  sourceFeatureSetId: string | null;
  sourceScore: number | null;
  sourceScoringVersion: string | null;
}

/** Admin read model: the prospect's live demo with append-only version history. */
export async function getProspectDemoView(db: Database, prospectId: string): Promise<ProspectDemoView | null> {
  const demo = await db
    .selectFrom("demo")
    .select(["id", "status", "concept", "current_demo_version_id", "created_at", "updated_at"])
    .where("prospect_id", "=", prospectId)
    .where("status", "not in", ["archived", "expired"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!demo) return null;

  const now = new Date();
  const [versions, locator] = await Promise.all([
    db
      .selectFrom("demo_version as dv")
      .innerJoin("demo_template_version as dtv", "dtv.id", "dv.demo_template_version_id")
      .innerJoin("demo_template as dt", "dt.id", "dtv.demo_template_id")
      .select([
        "dv.id",
        "dv.version_number",
        "dv.content_input_version",
        "dv.generated_content_version",
        "dv.content_hash",
        "dv.generator_metadata",
        "dv.feature_set_id",
        "dv.created_at",
        "dv.published_at",
        "dt.name as template_name",
        "dtv.version as template_version",
      ])
      .where("dv.demo_id", "=", demo.id)
      .orderBy("dv.version_number", "desc")
      .execute(),
    db
      .selectFrom("demo_public_locator")
      .select("token")
      .where("demo_id", "=", demo.id)
      .where("status", "=", "active")
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", now)]))
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);

  const summaries = versions.map(
    (row): ProspectDemoVersionSummary => ({
      demoVersionId: row.id,
      versionNumber: row.version_number,
      templateName: row.template_name,
      templateVersion: row.template_version,
      contentInputVersion: row.content_input_version,
      generatedContentVersion: row.generated_content_version,
      contentHash: row.content_hash,
      createdAt: toIso(row.created_at),
      publishedAt: row.published_at ? toIso(row.published_at) : null,
      isCurrent: row.id === demo.current_demo_version_id,
    }),
  );
  const currentRow = versions.find((row) => row.id === demo.current_demo_version_id);
  const currentMetadata = asRecord(currentRow?.generator_metadata);

  let sourceScore: number | null = null;
  let sourceScoringVersion: string | null = null;
  if (currentRow?.feature_set_id) {
    const score = await db
      .selectFrom("lead_score as ls")
      .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
      .select(["ls.overall_score", "sv.name"])
      .where("ls.feature_set_id", "=", currentRow.feature_set_id)
      .orderBy("ls.calculated_at", "desc")
      .limit(1)
      .executeTakeFirst();
    sourceScore = score?.overall_score ?? null;
    sourceScoringVersion = score?.name ?? null;
  }

  return {
    demoId: demo.id,
    status: demo.status,
    concept: demo.concept,
    createdAt: toIso(demo.created_at),
    updatedAt: toIso(demo.updated_at),
    locatorToken: locator?.token ?? null,
    currentVersion: summaries.find((summary) => summary.isCurrent) ?? null,
    versions: summaries,
    planSummary: asRecord(currentMetadata?.planSummary),
    sourceFeatureSetId: currentRow?.feature_set_id ?? null,
    sourceScore,
    sourceScoringVersion,
  };
}

function asRecord(value: JsonValue | unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
