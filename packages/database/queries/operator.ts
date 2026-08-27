/**
 * Phase 10 operator read models: the demo review queue, approved/ready-for-
 * outreach demos, acquisition runs with per-target progress, and isolated
 * target failures that deserve an operator retry.
 *
 * These are read models only. Every mutation goes through a repository/domain
 * service so the approval invariant and audit history cannot be bypassed by a
 * convenient query.
 */

import type { Database } from "../client/kysely.ts";

export interface DemoReviewQueueItem {
  prospectId: string;
  businessId: string;
  businessName: string;
  category: string | null;
  demoId: string;
  demoStatus: string;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  approvedVersionId: string | null;
  approvedVersionNumber: number | null;
  composition: string | null;
  locatorToken: string | null;
  qaStatus: string | null;
  qaCriticalFailures: number | null;
  generatedAt: string | null;
  score: number | null;
}

export interface ReadyForOutreachItem {
  prospectId: string;
  businessId: string;
  businessName: string;
  demoId: string;
  approvedVersionNumber: number;
  approvedAt: string;
  hostedUrl: string | null;
  hostingStatus: string;
  suppressed: boolean;
  readyForOutreach: boolean;
}

export interface OperatorRunView {
  runId: string;
  runKind: string;
  status: string;
  requestedParameters: Record<string, unknown>;
  progress: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  failureMessage: string | null;
  prospectId: string | null;
  actorRef: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  targets: OperatorRunTargetView[];
}

export interface OperatorRunTargetView {
  targetId: string;
  position: number;
  label: string;
  status: string;
  stage: string | null;
  prospectId: string | null;
  outcome: Record<string, unknown> | null;
  failureKind: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  transient: boolean | null;
  completedAt: string | null;
}

export interface OperatorDashboardView {
  awaitingReview: DemoReviewQueueItem[];
  readyForOutreach: ReadyForOutreachItem[];
  recentRuns: OperatorRunView[];
  activeRunCount: number;
  targetFailures: OperatorRunTargetView[];
}

/** Demos whose current version is not the approved one (or has none). */
export async function listDemosAwaitingReview(db: Database, limit = 12): Promise<DemoReviewQueueItem[]> {
  const rows = await db
    .selectFrom("demo")
    .innerJoin("prospect as p", "p.id", "demo.prospect_id")
    .innerJoin("business as b", "b.id", "p.business_id")
    .leftJoin("demo_version as cur", "cur.id", "demo.current_demo_version_id")
    .leftJoin("demo_version as app", "app.id", "demo.approved_demo_version_id")
    .leftJoin("demo_template_version as dtv", "dtv.id", "cur.demo_template_version_id")
    .leftJoin("demo_template as dt", "dt.id", "dtv.demo_template_id")
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("demo_public_locator as loc")
          .select(["loc.token"])
          .whereRef("loc.demo_id", "=", "demo.id")
          .where("loc.status", "=", "active")
          .orderBy("loc.created_at", "desc")
          .limit(1)
          .as("locator"),
      (join) => join.onTrue(),
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("demo_version_qa_result as qa")
          .select(["qa.status", "qa.critical_failure_count"])
          .whereRef("qa.demo_version_id", "=", "demo.current_demo_version_id")
          .orderBy("qa.completed_at", "desc")
          .limit(1)
          .as("qa"),
      (join) => join.onTrue(),
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("lead_score as ls")
          .select(["ls.overall_score"])
          .whereRef("ls.prospect_id", "=", "p.id")
          .orderBy("ls.calculated_at", "desc")
          .limit(1)
          .as("latest_score"),
      (join) => join.onTrue(),
    )
    .select([
      "p.id as prospect_id",
      "b.id as business_id",
      "b.canonical_name",
      "b.category",
      "demo.id as demo_id",
      "demo.status as demo_status",
      "demo.current_demo_version_id",
      "demo.approved_demo_version_id",
      "cur.version_number as current_version_number",
      "cur.created_at as current_created_at",
      "app.version_number as approved_version_number",
      "dt.name as composition",
      "locator.token",
      "qa.status as qa_status",
      "qa.critical_failure_count",
      "latest_score.overall_score",
    ])
    .where("demo.status", "not in", ["archived", "expired"])
    .where("demo.current_demo_version_id", "is not", null)
    .where((eb) =>
      eb.or([
        eb("demo.approved_demo_version_id", "is", null),
        eb(eb.ref("demo.approved_demo_version_id"), "!=", eb.ref("demo.current_demo_version_id")),
      ]),
    )
    .orderBy("cur.created_at", "desc")
    .limit(Math.min(Math.max(limit, 1), 50))
    .execute();

  return rows.map((row) => ({
    prospectId: row.prospect_id,
    businessId: row.business_id,
    businessName: row.canonical_name,
    category: row.category,
    demoId: row.demo_id,
    demoStatus: row.demo_status,
    currentVersionId: row.current_demo_version_id,
    currentVersionNumber: row.current_version_number,
    approvedVersionId: row.approved_demo_version_id,
    approvedVersionNumber: row.approved_version_number,
    composition: row.composition,
    locatorToken: row.token,
    qaStatus: row.qa_status,
    qaCriticalFailures: row.critical_failure_count,
    generatedAt: row.current_created_at ? toIso(row.current_created_at) : null,
    score: row.overall_score,
  }));
}

/** Demos with an approved version, and whether they may be used for outreach. */
export async function listApprovedDemos(db: Database, limit = 12): Promise<ReadyForOutreachItem[]> {
  const rows = await db
    .selectFrom("demo")
    .innerJoin("prospect as p", "p.id", "demo.prospect_id")
    .innerJoin("business as b", "b.id", "p.business_id")
    .innerJoin("demo_version as app", "app.id", "demo.approved_demo_version_id")
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("demo_publication as pub")
          .select(["pub.status", "pub.public_url", "pub.demo_version_id"])
          .whereRef("pub.demo_id", "=", "demo.id")
          .where("pub.environment", "=", "hosted")
          .where("pub.status", "in", ["publishing", "published"])
          .orderBy("pub.started_at", "desc")
          .limit(1)
          .as("hosted"),
      (join) => join.onTrue(),
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("suppression as s")
          .select(["s.id"])
          .where("s.status", "=", "active")
          .where((inner) =>
            inner.or([inner("s.scope", "=", "global"), inner(inner.ref("s.business_id"), "=", inner.ref("b.id"))]),
          )
          .limit(1)
          .as("suppression"),
      (join) => join.onTrue(),
    )
    .select([
      "p.id as prospect_id",
      "b.id as business_id",
      "b.canonical_name",
      "demo.id as demo_id",
      "demo.approved_at",
      "demo.approved_demo_version_id",
      "app.version_number as approved_version_number",
      "hosted.status as hosted_status",
      "hosted.public_url",
      "hosted.demo_version_id as hosted_version_id",
      "suppression.id as suppression_id",
    ])
    .where("demo.status", "not in", ["archived", "expired"])
    .orderBy("demo.approved_at", "desc")
    .limit(Math.min(Math.max(limit, 1), 50))
    .execute();

  return rows.map((row) => {
    const hostedLive = row.hosted_status === "published" && row.hosted_version_id === row.approved_demo_version_id;
    const suppressed = row.suppression_id !== null;
    return {
      prospectId: row.prospect_id,
      businessId: row.business_id,
      businessName: row.canonical_name,
      demoId: row.demo_id,
      approvedVersionNumber: row.approved_version_number,
      approvedAt: row.approved_at ? toIso(row.approved_at) : "",
      hostedUrl: hostedLive ? row.public_url : null,
      hostingStatus: hostedLive
        ? "hosted"
        : row.hosted_status === "publishing"
          ? "publishing"
          : row.hosted_status === "published"
            ? "hosted_stale"
            : "local_only",
      suppressed,
      readyForOutreach: hostedLive && !suppressed,
    };
  });
}

export async function listOperatorRunViews(
  db: Database,
  options: { limit?: number; prospectId?: string } = {},
): Promise<OperatorRunView[]> {
  let query = db
    .selectFrom("operator_run")
    .select([
      "id",
      "run_kind",
      "status",
      "requested_parameters",
      "progress",
      "summary",
      "failure_message",
      "prospect_id",
      "actor_ref",
      "requested_at",
      "started_at",
      "completed_at",
    ]);
  if (options.prospectId) query = query.where("prospect_id", "=", options.prospectId);
  const runs = await query
    .orderBy("requested_at", "desc")
    .limit(Math.min(Math.max(options.limit ?? 10, 1), 50))
    .execute();
  if (runs.length === 0) return [];
  const targets = await db
    .selectFrom("operator_run_target")
    .select([
      "id",
      "operator_run_id",
      "position",
      "label",
      "status",
      "stage",
      "prospect_id",
      "outcome",
      "failure_kind",
      "failure_code",
      "failure_message",
      "transient",
      "completed_at",
    ])
    .where(
      "operator_run_id",
      "in",
      runs.map((run) => run.id),
    )
    .orderBy("position")
    .execute();

  return runs.map((run) => ({
    runId: run.id,
    runKind: run.run_kind,
    status: run.status,
    requestedParameters: asRecord(run.requested_parameters) ?? {},
    progress: asRecord(run.progress),
    summary: asRecord(run.summary),
    failureMessage: run.failure_message,
    prospectId: run.prospect_id,
    actorRef: run.actor_ref,
    requestedAt: toIso(run.requested_at),
    startedAt: run.started_at ? toIso(run.started_at) : null,
    completedAt: run.completed_at ? toIso(run.completed_at) : null,
    targets: targets.filter((target) => target.operator_run_id === run.id).map(mapTargetView),
  }));
}

export async function getOperatorRunView(db: Database, runId: string): Promise<OperatorRunView | undefined> {
  const run = await db
    .selectFrom("operator_run")
    .select([
      "id",
      "run_kind",
      "status",
      "requested_parameters",
      "progress",
      "summary",
      "failure_message",
      "prospect_id",
      "actor_ref",
      "requested_at",
      "started_at",
      "completed_at",
    ])
    .where("id", "=", runId)
    .executeTakeFirst();
  if (!run) return undefined;
  const targets = await db
    .selectFrom("operator_run_target")
    .select([
      "id",
      "operator_run_id",
      "position",
      "label",
      "status",
      "stage",
      "prospect_id",
      "outcome",
      "failure_kind",
      "failure_code",
      "failure_message",
      "transient",
      "completed_at",
    ])
    .where("operator_run_id", "=", runId)
    .orderBy("position")
    .execute();
  return {
    runId: run.id,
    runKind: run.run_kind,
    status: run.status,
    requestedParameters: asRecord(run.requested_parameters) ?? {},
    progress: asRecord(run.progress),
    summary: asRecord(run.summary),
    failureMessage: run.failure_message,
    prospectId: run.prospect_id,
    actorRef: run.actor_ref,
    requestedAt: toIso(run.requested_at),
    startedAt: run.started_at ? toIso(run.started_at) : null,
    completedAt: run.completed_at ? toIso(run.completed_at) : null,
    targets: targets.map(mapTargetView),
  };
}

/** Isolated target failures from recent runs — never whole-run failures. */
export async function listRecentTargetFailures(db: Database, limit = 8): Promise<OperatorRunTargetView[]> {
  const rows = await db
    .selectFrom("operator_run_target")
    .select([
      "id",
      "operator_run_id",
      "position",
      "label",
      "status",
      "stage",
      "prospect_id",
      "outcome",
      "failure_kind",
      "failure_code",
      "failure_message",
      "transient",
      "completed_at",
    ])
    .where("status", "in", ["target_failed", "failed"])
    .orderBy("updated_at", "desc")
    .limit(Math.min(Math.max(limit, 1), 50))
    .execute();
  return rows.map(mapTargetView);
}

export async function getOperatorDashboard(db: Database): Promise<OperatorDashboardView> {
  const [awaitingReview, readyForOutreach, recentRuns, targetFailures, activeRuns] = await Promise.all([
    listDemosAwaitingReview(db),
    listApprovedDemos(db),
    listOperatorRunViews(db, { limit: 8 }),
    listRecentTargetFailures(db),
    db
      .selectFrom("operator_run")
      .select("id")
      .where("status", "in", ["queued", "running"])
      .limit(50)
      .execute(),
  ]);
  return {
    awaitingReview,
    readyForOutreach,
    recentRuns,
    activeRunCount: activeRuns.length,
    targetFailures,
  };
}

function mapTargetView(row: {
  id: string;
  position: number;
  label: string;
  status: string;
  stage: string | null;
  prospect_id: string | null;
  outcome: unknown;
  failure_kind: string | null;
  failure_code: string | null;
  failure_message: string | null;
  transient: boolean | null;
  completed_at: Date | string | null;
}): OperatorRunTargetView {
  return {
    targetId: row.id,
    position: row.position,
    label: row.label,
    status: row.status,
    stage: row.stage,
    prospectId: row.prospect_id,
    outcome: asRecord(row.outcome),
    failureKind: row.failure_kind,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    transient: row.transient,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
