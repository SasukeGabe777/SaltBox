/**
 * Phase 10 demo review persistence: append-only automated QA evidence,
 * append-only operator review history, and the authoritative approved-version
 * pointer.
 *
 * Product invariant: approval pins ONE exact DemoVersion. Generating a new
 * version never moves it; only an explicit operator approval does.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType } from "../generated/db.ts";

export type DemoQaStatus = "passed" | "failed" | "error";

export interface RecordDemoQaResultInput {
  demoVersionId: string;
  runnerVersion: string;
  status: DemoQaStatus;
  checksTotal: number;
  checksPassed: number;
  criticalFailures: string[];
  summary?: Record<string, unknown>;
  artifactRef?: string;
  failureMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface DemoQaResultRecord {
  id: string;
  demoVersionId: string;
  runnerVersion: string;
  status: DemoQaStatus;
  checksTotal: number;
  checksPassed: number;
  criticalFailureCount: number;
  criticalFailures: string[];
  artifactRef: string | null;
  failureMessage: string | null;
  completedAt: Date;
}

/** Bounded QA payload guard: structured summaries, never screenshot bytes. */
const MAX_QA_SUMMARY_BYTES = 64 * 1024;

export async function recordDemoQaResult(
  db: Database,
  input: RecordDemoQaResultInput,
): Promise<DemoQaResultRecord> {
  const summaryJson = input.summary === undefined ? null : JSON.stringify(input.summary);
  if (summaryJson !== null && Buffer.byteLength(summaryJson, "utf8") > MAX_QA_SUMMARY_BYTES) {
    throw new Error(
      `Demo QA summary exceeds the ${MAX_QA_SUMMARY_BYTES}-byte bound; screenshots and raw output ` +
        "belong in the git-ignored QA artifact directory, not PostgreSQL.",
    );
  }
  const row = await db
    .insertInto("demo_version_qa_result")
    .values({
      demo_version_id: input.demoVersionId,
      runner_version: input.runnerVersion,
      status: input.status,
      checks_total: input.checksTotal,
      checks_passed: input.checksPassed,
      critical_failure_count: input.criticalFailures.length,
      critical_failures: JSON.stringify(input.criticalFailures),
      summary: summaryJson,
      artifact_ref: input.artifactRef ?? null,
      failure_message: input.failureMessage ?? null,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? new Date(),
    })
    .returning([
      "id",
      "demo_version_id",
      "runner_version",
      "status",
      "checks_total",
      "checks_passed",
      "critical_failure_count",
      "critical_failures",
      "artifact_ref",
      "failure_message",
      "completed_at",
    ])
    .executeTakeFirstOrThrow();
  return mapQaRow(row);
}

const QA_COLUMNS = [
  "id",
  "demo_version_id",
  "runner_version",
  "status",
  "checks_total",
  "checks_passed",
  "critical_failure_count",
  "critical_failures",
  "artifact_ref",
  "failure_message",
  "completed_at",
] as const;

/** Most recent QA evidence for one exact version (never for "the demo"). */
export async function getLatestDemoQaResult(
  db: Database,
  demoVersionId: string,
): Promise<DemoQaResultRecord | undefined> {
  const row = await db
    .selectFrom("demo_version_qa_result")
    .select(QA_COLUMNS)
    .where("demo_version_id", "=", demoVersionId)
    .orderBy("completed_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? mapQaRow(row) : undefined;
}

export async function listDemoQaResultsForDemo(db: Database, demoId: string): Promise<DemoQaResultRecord[]> {
  const rows = await db
    .selectFrom("demo_version_qa_result as qa")
    .innerJoin("demo_version as dv", "dv.id", "qa.demo_version_id")
    .select([
      "qa.id",
      "qa.demo_version_id",
      "qa.runner_version",
      "qa.status",
      "qa.checks_total",
      "qa.checks_passed",
      "qa.critical_failure_count",
      "qa.critical_failures",
      "qa.artifact_ref",
      "qa.failure_message",
      "qa.completed_at",
    ])
    .where("dv.demo_id", "=", demoId)
    .orderBy("qa.completed_at", "desc")
    .execute();
  return rows.map(mapQaRow);
}

export type DemoReviewAction = "approved" | "rejected";

export interface AppendDemoReviewInput {
  demoId: string;
  demoVersionId: string;
  action: DemoReviewAction;
  actorType: ActorType;
  actorRef: string;
  reasonCode: string;
  previousApprovedDemoVersionId?: string;
  decisionId?: string;
  qaResultId?: string;
  qaOverride?: boolean;
  note?: string;
  correlationId?: string;
}

export interface DemoReviewRecord {
  id: string;
  demoId: string;
  demoVersionId: string;
  action: DemoReviewAction;
  previousApprovedDemoVersionId: string | null;
  qaResultId: string | null;
  qaOverride: boolean;
  actorRef: string;
  reasonCode: string;
  note: string | null;
  createdAt: Date;
}

export async function appendDemoVersionReview(
  db: Database,
  input: AppendDemoReviewInput,
): Promise<DemoReviewRecord> {
  const row = await db
    .insertInto("demo_version_review")
    .values({
      demo_id: input.demoId,
      demo_version_id: input.demoVersionId,
      action: input.action,
      previous_approved_demo_version_id: input.previousApprovedDemoVersionId ?? null,
      decision_id: input.decisionId ?? null,
      qa_result_id: input.qaResultId ?? null,
      qa_override: input.qaOverride ?? false,
      actor_type: input.actorType,
      actor_ref: input.actorRef,
      reason_code: input.reasonCode,
      note: input.note ?? null,
      correlation_id: input.correlationId ?? null,
    })
    .returning([
      "id",
      "demo_id",
      "demo_version_id",
      "action",
      "previous_approved_demo_version_id",
      "qa_result_id",
      "qa_override",
      "actor_ref",
      "reason_code",
      "note",
      "created_at",
    ])
    .executeTakeFirstOrThrow();
  return mapReviewRow(row);
}

export async function listDemoVersionReviews(db: Database, demoId: string): Promise<DemoReviewRecord[]> {
  const rows = await db
    .selectFrom("demo_version_review")
    .select([
      "id",
      "demo_id",
      "demo_version_id",
      "action",
      "previous_approved_demo_version_id",
      "qa_result_id",
      "qa_override",
      "actor_ref",
      "reason_code",
      "note",
      "created_at",
    ])
    .where("demo_id", "=", demoId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map(mapReviewRow);
}

/**
 * Move (or clear) the approved-version pointer under optimistic concurrency.
 * The caller must have already appended the review record that authorizes it.
 */
export async function setApprovedDemoVersion(
  db: Database,
  input: {
    demoId: string;
    expectedRevision: number;
    demoVersionId: string | null;
    actorRef: string | null;
    reviewId: string | null;
    approvedAt?: Date;
  },
): Promise<boolean> {
  const approving = input.demoVersionId !== null;
  const result = await db
    .updateTable("demo")
    .set({
      approved_demo_version_id: input.demoVersionId,
      approved_at: approving ? (input.approvedAt ?? new Date()) : null,
      approved_by_actor_ref: approving ? input.actorRef : null,
      approval_review_id: approving ? input.reviewId : null,
      revision: input.expectedRevision + 1,
      updated_at: new Date(),
    })
    .where("id", "=", input.demoId)
    .where("revision", "=", input.expectedRevision)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

/** The demo's approved version, if any (the only outreach-usable version). */
export async function getApprovedDemoVersion(
  db: Database,
  demoId: string,
): Promise<{ demoVersionId: string; versionNumber: number; approvedAt: Date; approvedByActorRef: string } | undefined> {
  const row = await db
    .selectFrom("demo")
    .innerJoin("demo_version as dv", "dv.id", "demo.approved_demo_version_id")
    .select(["dv.id as demo_version_id", "dv.version_number", "demo.approved_at", "demo.approved_by_actor_ref"])
    .where("demo.id", "=", demoId)
    .executeTakeFirst();
  if (!row || row.approved_at === null || row.approved_by_actor_ref === null) return undefined;
  return {
    demoVersionId: row.demo_version_id,
    versionNumber: row.version_number,
    approvedAt: row.approved_at,
    approvedByActorRef: row.approved_by_actor_ref,
  };
}

function mapQaRow(row: {
  id: string;
  demo_version_id: string;
  runner_version: string;
  status: string;
  checks_total: number;
  checks_passed: number;
  critical_failure_count: number;
  critical_failures: unknown;
  artifact_ref: string | null;
  failure_message: string | null;
  completed_at: Date;
}): DemoQaResultRecord {
  return {
    id: row.id,
    demoVersionId: row.demo_version_id,
    runnerVersion: row.runner_version,
    status: row.status as DemoQaStatus,
    checksTotal: row.checks_total,
    checksPassed: row.checks_passed,
    criticalFailureCount: row.critical_failure_count,
    criticalFailures: Array.isArray(row.critical_failures)
      ? row.critical_failures.filter((item): item is string => typeof item === "string")
      : [],
    artifactRef: row.artifact_ref,
    failureMessage: row.failure_message,
    completedAt: row.completed_at,
  };
}

function mapReviewRow(row: {
  id: string;
  demo_id: string;
  demo_version_id: string;
  action: string;
  previous_approved_demo_version_id: string | null;
  qa_result_id: string | null;
  qa_override: boolean;
  actor_ref: string;
  reason_code: string;
  note: string | null;
  created_at: Date;
}): DemoReviewRecord {
  return {
    id: row.id,
    demoId: row.demo_id,
    demoVersionId: row.demo_version_id,
    action: row.action as DemoReviewAction,
    previousApprovedDemoVersionId: row.previous_approved_demo_version_id,
    qaResultId: row.qa_result_id,
    qaOverride: row.qa_override,
    actorRef: row.actor_ref,
    reasonCode: row.reason_code,
    note: row.note,
    createdAt: row.created_at,
  };
}
