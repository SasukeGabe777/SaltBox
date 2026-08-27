/**
 * Read models for the demo renderer and the operator admin.
 *
 * The resolver answers exactly one question — "which persisted demo version
 * does this opaque locator serve?" — and never exposes internal identifiers
 * beyond what the renderer needs. Unknown, revoked, and expired locators all
 * resolve to nothing.
 *
 * Phase 10 makes the answer mode-dependent:
 *
 * - `preview` (local operator renderer): the demo's CURRENT version, so the
 *   operator can review what was just generated.
 * - `public` (hosted, prospect-facing): the APPROVED version only. Before an
 *   operator approves anything the public locator is intentionally not-ready,
 *   and after a regeneration it keeps serving the approved version until the
 *   operator approves the new one.
 */

import type { Database } from "../client/kysely.ts";
import type { JsonValue } from "../generated/db.ts";
import { activeQualificationSuppressions } from "../repositories/suppressions.ts";

/** Opaque public token shape (base64url); validated before any query. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type DemoResolutionMode = "preview" | "public";

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
  /** Which pointer resolved this response. */
  resolvedFrom: DemoResolutionMode;
  version: PublicDemoVersionView;
}

/**
 * Resolve an opaque locator. `preview` (default) serves the demo's current
 * version; `public` serves only the operator-approved version, so an
 * unapproved or newly regenerated demo is never exposed publicly.
 */
export async function resolveDemoByLocator(
  db: Database,
  token: string,
  options: { mode?: DemoResolutionMode } = {},
): Promise<PublicDemoView | undefined> {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const mode: DemoResolutionMode = options.mode ?? "preview";
  const now = new Date();
  const row = await db
    .selectFrom("demo_public_locator as loc")
    .innerJoin("demo", "demo.id", "loc.demo_id")
    .innerJoin(
      "demo_version as dv",
      "dv.id",
      mode === "public" ? "demo.approved_demo_version_id" : "demo.current_demo_version_id",
    )
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
    resolvedFrom: mode,
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

export interface DemoQaSummaryView {
  qaResultId: string;
  status: string;
  runnerVersion: string;
  checksTotal: number;
  checksPassed: number;
  criticalFailures: string[];
  artifactRef: string | null;
  failureMessage: string | null;
  completedAt: string;
  /** Bounded per-viewport digest recorded by the QA runner. */
  viewports: Array<{ viewport: string; passed: number; total: number; failures: string[] }>;
}

export interface DemoReviewView {
  reviewId: string;
  demoVersionId: string;
  versionNumber: number | null;
  action: string;
  actorRef: string;
  reasonCode: string;
  qaOverride: boolean;
  note: string | null;
  createdAt: string;
}

export interface DemoPublicationView {
  publicationId: string;
  demoVersionId: string;
  versionNumber: number | null;
  environment: string;
  status: string;
  publicUrl: string | null;
  assetCount: number;
  failureMessage: string | null;
  startedAt: string;
  completedAt: string | null;
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
  /** True only for the exact version an operator approved. */
  isApproved: boolean;
  /** Composition recorded in this version's plan, when present. */
  composition: string | null;
  planVersion: string | null;
  brandProfileVersion: string | null;
  sourceScore: number | null;
  sourceScoringVersion: string | null;
  qa: DemoQaSummaryView | null;
}

/**
 * Why this prospect is (or is not) ready for outreach. Derived on read from
 * qualification, approval, QA, hosting, and suppression state — never a
 * separate lifecycle state that could drift out of agreement with them.
 */
export interface DemoReadinessView {
  readyForOutreach: boolean;
  blockers: string[];
  qualified: boolean;
  suppressed: boolean;
  approvedVersionNumber: number | null;
  hostedUrl: string | null;
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
  approvedVersion: ProspectDemoVersionSummary | null;
  approvedAt: string | null;
  approvedByActorRef: string | null;
  versions: ProspectDemoVersionSummary[];
  reviews: DemoReviewView[];
  publications: DemoPublicationView[];
  hostingStatus: "local_only" | "publishing" | "hosted" | "publication_failed";
  hostedUrl: string | null;
  readiness: DemoReadinessView;
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
    .select([
      "id",
      "status",
      "concept",
      "current_demo_version_id",
      "approved_demo_version_id",
      "approved_at",
      "approved_by_actor_ref",
      "created_at",
      "updated_at",
    ])
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

  const versionIds = versions.map((row) => row.id);
  const [qaRows, reviewRows, publicationRows, scoreRows, readinessRow] = await Promise.all([
    versionIds.length === 0
      ? []
      : db
          .selectFrom("demo_version_qa_result")
          .select([
            "id",
            "demo_version_id",
            "status",
            "runner_version",
            "checks_total",
            "checks_passed",
            "critical_failures",
            "summary",
            "artifact_ref",
            "failure_message",
            "completed_at",
          ])
          .where("demo_version_id", "in", versionIds)
          .orderBy("completed_at", "desc")
          .orderBy("id", "desc")
          .execute(),
    db
      .selectFrom("demo_version_review")
      .select([
        "id",
        "demo_version_id",
        "action",
        "actor_ref",
        "reason_code",
        "qa_override",
        "note",
        "created_at",
      ])
      .where("demo_id", "=", demo.id)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(20)
      .execute(),
    db
      .selectFrom("demo_publication")
      .select([
        "id",
        "demo_version_id",
        "environment",
        "status",
        "public_url",
        "asset_count",
        "failure_message",
        "started_at",
        "completed_at",
      ])
      .where("demo_id", "=", demo.id)
      .orderBy("started_at", "desc")
      .limit(10)
      .execute(),
    db
      .selectFrom("lead_score as ls")
      .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
      .select(["ls.feature_set_id", "ls.overall_score", "sv.name as scoring_version", "ls.calculated_at"])
      .where("ls.prospect_id", "=", prospectId)
      .orderBy("ls.calculated_at", "desc")
      .execute(),
    db
      .selectFrom("prospect as p")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("lead_score as ls")
            .select(["ls.id as score_id"])
            .whereRef("ls.prospect_id", "=", "p.id")
            .orderBy("ls.calculated_at", "desc")
            .orderBy("ls.id", "desc")
            .limit(1)
            .as("latest_score"),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("decision as dec")
            .select(["dec.result_code", "dec.policy_version"])
            .whereRef("dec.prospect_id", "=", "p.id")
            .whereRef("dec.lead_score_id", "=", "latest_score.score_id")
            .orderBy("dec.decided_at", "desc")
            .orderBy("dec.id", "desc")
            .limit(1)
            .as("latest_decision"),
        (join) => join.onTrue(),
      )
      .select(["p.business_id", "latest_decision.result_code", "latest_decision.policy_version"])
      .where("p.id", "=", prospectId)
      .executeTakeFirst(),
  ]);

  // One suppression predicate for the whole system (repositories/suppressions).
  const activeSuppressions = readinessRow
    ? await activeQualificationSuppressions(db, readinessRow.business_id)
    : [];

  const latestQaByVersion = new Map<string, (typeof qaRows)[number]>();
  for (const row of qaRows) {
    if (!latestQaByVersion.has(row.demo_version_id)) latestQaByVersion.set(row.demo_version_id, row);
  }
  const scoreByFeatureSet = new Map<string, { score: number; scoringVersion: string }>();
  for (const row of scoreRows) {
    if (!scoreByFeatureSet.has(row.feature_set_id)) {
      scoreByFeatureSet.set(row.feature_set_id, { score: row.overall_score, scoringVersion: row.scoring_version });
    }
  }

  const summaries = versions.map((row): ProspectDemoVersionSummary => {
    const metadata = asRecord(row.generator_metadata);
    const planSummary = asRecord(metadata?.planSummary);
    const template = asRecord(planSummary?.template);
    const brand = asRecord(planSummary?.brand);
    const lineage = row.feature_set_id ? scoreByFeatureSet.get(row.feature_set_id) : undefined;
    return {
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
      isApproved: row.id === demo.approved_demo_version_id,
      composition: typeof template?.templateName === "string" ? template.templateName : row.template_name,
      planVersion: typeof planSummary?.planVersion === "string" ? planSummary.planVersion : null,
      brandProfileVersion: typeof brand?.profileVersion === "string" ? brand.profileVersion : null,
      sourceScore: lineage?.score ?? null,
      sourceScoringVersion: lineage?.scoringVersion ?? null,
      qa: mapQaSummary(latestQaByVersion.get(row.id)),
    };
  });

  const versionNumberById = new Map(versions.map((row) => [row.id, row.version_number]));
  const currentRow = versions.find((row) => row.id === demo.current_demo_version_id);
  const currentMetadata = asRecord(currentRow?.generator_metadata);
  const currentLineage = currentRow?.feature_set_id ? scoreByFeatureSet.get(currentRow.feature_set_id) : undefined;

  const publications = publicationRows.map(
    (row): DemoPublicationView => ({
      publicationId: row.id,
      demoVersionId: row.demo_version_id,
      versionNumber: versionNumberById.get(row.demo_version_id) ?? null,
      environment: row.environment,
      status: row.status,
      publicUrl: row.public_url,
      assetCount: row.asset_count,
      failureMessage: row.failure_message,
      startedAt: toIso(row.started_at),
      completedAt: row.completed_at ? toIso(row.completed_at) : null,
    }),
  );

  const approvedVersion = summaries.find((summary) => summary.isApproved) ?? null;
  const hostedPublication = publications.find(
    (publication) =>
      publication.environment === "hosted" &&
      (publication.status === "published" || publication.status === "publishing" || publication.status === "failed"),
  );
  const hostedLive =
    hostedPublication?.status === "published" &&
    approvedVersion !== null &&
    hostedPublication.demoVersionId === approvedVersion.demoVersionId;
  const hostingStatus: ProspectDemoView["hostingStatus"] = hostedLive
    ? "hosted"
    : hostedPublication?.status === "publishing"
      ? "publishing"
      : hostedPublication?.status === "failed"
        ? "publication_failed"
        : "local_only";
  const hostedUrl = hostedLive ? (hostedPublication?.publicUrl ?? null) : null;

  const qualified =
    readinessRow?.result_code === "qualified" && readinessRow.policy_version === "qualification-policy-v2";
  const suppressed = activeSuppressions.length > 0;
  const blockers: string[] = [];
  if (!qualified) blockers.push("The prospect has no current qualification-policy-v2 qualified decision.");
  if (suppressed) blockers.push("An active suppression forbids outreach to this business.");
  if (!approvedVersion) blockers.push("No demo version has been approved by an operator.");
  else if (approvedVersion.qa === null) blockers.push("The approved version has no recorded QA result.");
  else if (approvedVersion.qa.criticalFailures.length > 0) {
    blockers.push("The approved version has unresolved critical QA failures.");
  }
  if (!hostedUrl) blockers.push("The approved version is not hosted at a durable public URL yet.");

  return {
    demoId: demo.id,
    status: demo.status,
    concept: demo.concept,
    createdAt: toIso(demo.created_at),
    updatedAt: toIso(demo.updated_at),
    locatorToken: locator?.token ?? null,
    currentVersion: summaries.find((summary) => summary.isCurrent) ?? null,
    approvedVersion,
    approvedAt: demo.approved_at ? toIso(demo.approved_at) : null,
    approvedByActorRef: demo.approved_by_actor_ref,
    versions: summaries,
    reviews: reviewRows.map(
      (row): DemoReviewView => ({
        reviewId: row.id,
        demoVersionId: row.demo_version_id,
        versionNumber: versionNumberById.get(row.demo_version_id) ?? null,
        action: row.action,
        actorRef: row.actor_ref,
        reasonCode: row.reason_code,
        qaOverride: row.qa_override,
        note: row.note,
        createdAt: toIso(row.created_at),
      }),
    ),
    publications,
    hostingStatus,
    hostedUrl,
    readiness: {
      readyForOutreach: blockers.length === 0,
      blockers,
      qualified,
      suppressed,
      approvedVersionNumber: approvedVersion?.versionNumber ?? null,
      hostedUrl,
    },
    planSummary: asRecord(currentMetadata?.planSummary),
    sourceFeatureSetId: currentRow?.feature_set_id ?? null,
    sourceScore: currentLineage?.score ?? null,
    sourceScoringVersion: currentLineage?.scoringVersion ?? null,
  };
}

function mapQaSummary(
  row:
    | {
        id: string;
        status: string;
        runner_version: string;
        checks_total: number;
        checks_passed: number;
        critical_failures: JsonValue | unknown;
        summary: JsonValue | unknown;
        artifact_ref: string | null;
        failure_message: string | null;
        completed_at: Date | string;
      }
    | undefined,
): DemoQaSummaryView | null {
  if (!row) return null;
  const summary = asRecord(row.summary);
  const rawViewports = Array.isArray(summary?.viewports) ? summary.viewports : [];
  return {
    qaResultId: row.id,
    status: row.status,
    runnerVersion: row.runner_version,
    checksTotal: row.checks_total,
    checksPassed: row.checks_passed,
    criticalFailures: Array.isArray(row.critical_failures)
      ? row.critical_failures.filter((item): item is string => typeof item === "string")
      : [],
    artifactRef: row.artifact_ref,
    failureMessage: row.failure_message,
    completedAt: toIso(row.completed_at),
    viewports: rawViewports.flatMap((entry) => {
      const record = asRecord(entry);
      if (!record || typeof record.viewport !== "string") return [];
      return [
        {
          viewport: record.viewport,
          passed: typeof record.passed === "number" ? record.passed : 0,
          total: typeof record.total === "number" ? record.total : 0,
          failures: Array.isArray(record.failures)
            ? record.failures.filter((item): item is string => typeof item === "string")
            : [],
        },
      ];
    }),
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
