/**
 * Phase 10 operator runs: bounded local work the operator starts from the
 * admin instead of PowerShell.
 *
 * A long analysis never executes inside an HTTP request. The admin enqueues a
 * run; a separate local worker process claims it, reports per-target progress
 * here, and records a terminal status. Phase 6/7 semantics are preserved: an
 * isolated target failure is `completed_with_target_failures`, not `failed`.
 */

import type { Database } from "../client/kysely.ts";
import type { ActorType } from "../generated/db.ts";

export type OperatorRunKind =
  | "acquisition"
  | "demo_generate"
  | "demo_qa"
  | "demo_publish"
  | "retry_intelligence";

export type OperatorRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_target_failures"
  | "failed"
  | "cancelled";

export type OperatorRunTargetStatus =
  | "pending"
  | "running"
  | "completed"
  | "target_failed"
  | "failed"
  | "skipped";

export interface OperatorRunRecord {
  id: string;
  runKind: OperatorRunKind;
  status: OperatorRunStatus;
  requestedParameters: Record<string, unknown>;
  requestKey: string | null;
  progress: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  failureMessage: string | null;
  prospectId: string | null;
  demoId: string | null;
  actorRef: string;
  correlationId: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  revision: number;
}

export interface OperatorRunTargetRecord {
  id: string;
  operatorRunId: string;
  position: number;
  label: string;
  status: OperatorRunTargetStatus;
  stage: string | null;
  prospectId: string | null;
  businessId: string | null;
  outcome: Record<string, unknown> | null;
  failureKind: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  transient: boolean | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

const RUN_COLUMNS = [
  "id",
  "run_kind",
  "status",
  "requested_parameters",
  "request_key",
  "progress",
  "summary",
  "failure_message",
  "prospect_id",
  "demo_id",
  "actor_ref",
  "correlation_id",
  "requested_at",
  "started_at",
  "completed_at",
  "updated_at",
  "revision",
] as const;

const TARGET_COLUMNS = [
  "id",
  "operator_run_id",
  "position",
  "label",
  "status",
  "stage",
  "prospect_id",
  "business_id",
  "outcome",
  "failure_kind",
  "failure_code",
  "failure_message",
  "transient",
  "started_at",
  "completed_at",
  "updated_at",
] as const;

export interface CreateOperatorRunInput {
  runKind: OperatorRunKind;
  requestedParameters: Record<string, unknown>;
  actorType: ActorType;
  actorRef: string;
  /** Dedupe key; a second submission while one is active returns the active run. */
  requestKey?: string;
  prospectId?: string;
  businessId?: string;
  demoId?: string;
  correlationId?: string;
}

export interface CreateOperatorRunResult {
  run: OperatorRunRecord;
  /** False when an equivalent run was already queued or running. */
  created: boolean;
}

/** Bounded parameter payload; operator forms, not arbitrary blobs. */
const MAX_PARAMETERS_BYTES = 16 * 1024;

export async function createOperatorRun(
  db: Database,
  input: CreateOperatorRunInput,
): Promise<CreateOperatorRunResult> {
  const parameters = JSON.stringify(input.requestedParameters);
  if (Buffer.byteLength(parameters, "utf8") > MAX_PARAMETERS_BYTES) {
    throw new Error(`Operator run parameters exceed the ${MAX_PARAMETERS_BYTES}-byte bound.`);
  }
  const inserted = await db
    .insertInto("operator_run")
    .values({
      run_kind: input.runKind,
      status: "queued",
      requested_parameters: parameters,
      request_key: input.requestKey ?? null,
      actor_type: input.actorType,
      actor_ref: input.actorRef,
      prospect_id: input.prospectId ?? null,
      business_id: input.businessId ?? null,
      demo_id: input.demoId ?? null,
      correlation_id: input.correlationId ?? null,
    })
    .onConflict((oc) => oc.doNothing())
    .returning(RUN_COLUMNS)
    .executeTakeFirst();
  if (inserted) return { run: mapRunRow(inserted), created: true };
  if (input.requestKey === undefined) {
    throw new Error("Operator run insert was rejected without a request key; this should be unreachable.");
  }

  const existing = await db
    .selectFrom("operator_run")
    .select(RUN_COLUMNS)
    .where("request_key", "=", input.requestKey)
    .where("status", "in", ["queued", "running"])
    .orderBy("requested_at", "desc")
    .limit(1)
    .executeTakeFirstOrThrow();
  return { run: mapRunRow(existing), created: false };
}

export async function getOperatorRun(db: Database, runId: string): Promise<OperatorRunRecord | undefined> {
  const row = await db.selectFrom("operator_run").select(RUN_COLUMNS).where("id", "=", runId).executeTakeFirst();
  return row ? mapRunRow(row) : undefined;
}

export async function listOperatorRuns(
  db: Database,
  options: { limit?: number; runKind?: OperatorRunKind; prospectId?: string } = {},
): Promise<OperatorRunRecord[]> {
  let query = db.selectFrom("operator_run").select(RUN_COLUMNS);
  if (options.runKind) query = query.where("run_kind", "=", options.runKind);
  if (options.prospectId) query = query.where("prospect_id", "=", options.prospectId);
  const rows = await query
    .orderBy("requested_at", "desc")
    .limit(Math.min(Math.max(options.limit ?? 20, 1), 100))
    .execute();
  return rows.map(mapRunRow);
}

/** Claim a queued run for execution; false when another worker won the race. */
export async function claimOperatorRun(db: Database, runId: string): Promise<OperatorRunRecord | undefined> {
  const row = await db
    .updateTable("operator_run")
    .set({ status: "running", started_at: new Date(), updated_at: new Date() })
    .where("id", "=", runId)
    .where("status", "=", "queued")
    .returning(RUN_COLUMNS)
    .executeTakeFirst();
  return row ? mapRunRow(row) : undefined;
}

export async function updateOperatorRunProgress(
  db: Database,
  input: { runId: string; progress: Record<string, unknown> },
): Promise<void> {
  await db
    .updateTable("operator_run")
    .set({ progress: JSON.stringify(input.progress), updated_at: new Date() })
    .where("id", "=", input.runId)
    .execute();
}

export async function completeOperatorRun(
  db: Database,
  input: {
    runId: string;
    status: Exclude<OperatorRunStatus, "queued" | "running">;
    summary?: Record<string, unknown>;
    failureMessage?: string;
  },
): Promise<OperatorRunRecord | undefined> {
  const row = await db
    .updateTable("operator_run")
    .set({
      status: input.status,
      summary: input.summary === undefined ? null : JSON.stringify(input.summary),
      failure_message: input.failureMessage ?? null,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where("id", "=", input.runId)
    .where("status", "in", ["queued", "running"])
    .returning(RUN_COLUMNS)
    .executeTakeFirst();
  return row ? mapRunRow(row) : undefined;
}

export async function upsertOperatorRunTarget(
  db: Database,
  input: {
    operatorRunId: string;
    position: number;
    label: string;
    status: OperatorRunTargetStatus;
    stage?: string;
    prospectId?: string;
    businessId?: string;
    outcome?: Record<string, unknown>;
    failureKind?: string;
    failureCode?: string;
    failureMessage?: string;
    transient?: boolean;
    startedAt?: Date;
    completedAt?: Date;
  },
): Promise<OperatorRunTargetRecord> {
  const values = {
    operator_run_id: input.operatorRunId,
    position: input.position,
    label: input.label,
    status: input.status,
    stage: input.stage ?? null,
    prospect_id: input.prospectId ?? null,
    business_id: input.businessId ?? null,
    outcome: input.outcome === undefined ? null : JSON.stringify(input.outcome),
    failure_kind: input.failureKind ?? null,
    failure_code: input.failureCode ?? null,
    failure_message: input.failureMessage ?? null,
    transient: input.transient ?? null,
    started_at: input.startedAt ?? null,
    completed_at: input.completedAt ?? null,
    updated_at: new Date(),
  };
  const row = await db
    .insertInto("operator_run_target")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["operator_run_id", "position"]).doUpdateSet({
        label: values.label,
        status: values.status,
        stage: values.stage,
        prospect_id: values.prospect_id,
        business_id: values.business_id,
        outcome: values.outcome,
        failure_kind: values.failure_kind,
        failure_code: values.failure_code,
        failure_message: values.failure_message,
        transient: values.transient,
        started_at: values.started_at,
        completed_at: values.completed_at,
        updated_at: values.updated_at,
      }),
    )
    .returning(TARGET_COLUMNS)
    .executeTakeFirstOrThrow();
  return mapTargetRow(row);
}

export async function listOperatorRunTargets(db: Database, runId: string): Promise<OperatorRunTargetRecord[]> {
  const rows = await db
    .selectFrom("operator_run_target")
    .select(TARGET_COLUMNS)
    .where("operator_run_id", "=", runId)
    .orderBy("position")
    .execute();
  return rows.map(mapTargetRow);
}

function mapRunRow(row: {
  id: string;
  run_kind: string;
  status: string;
  requested_parameters: unknown;
  request_key: string | null;
  progress: unknown;
  summary: unknown;
  failure_message: string | null;
  prospect_id: string | null;
  demo_id: string | null;
  actor_ref: string;
  correlation_id: string | null;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
  revision: number;
}): OperatorRunRecord {
  return {
    id: row.id,
    runKind: row.run_kind as OperatorRunKind,
    status: row.status as OperatorRunStatus,
    requestedParameters: asRecord(row.requested_parameters) ?? {},
    requestKey: row.request_key,
    progress: asRecord(row.progress),
    summary: asRecord(row.summary),
    failureMessage: row.failure_message,
    prospectId: row.prospect_id,
    demoId: row.demo_id,
    actorRef: row.actor_ref,
    correlationId: row.correlation_id,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

function mapTargetRow(row: {
  id: string;
  operator_run_id: string;
  position: number;
  label: string;
  status: string;
  stage: string | null;
  prospect_id: string | null;
  business_id: string | null;
  outcome: unknown;
  failure_kind: string | null;
  failure_code: string | null;
  failure_message: string | null;
  transient: boolean | null;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}): OperatorRunTargetRecord {
  return {
    id: row.id,
    operatorRunId: row.operator_run_id,
    position: row.position,
    label: row.label,
    status: row.status as OperatorRunTargetStatus,
    stage: row.stage,
    prospectId: row.prospect_id,
    businessId: row.business_id,
    outcome: asRecord(row.outcome),
    failureKind: row.failure_kind,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    transient: row.transient,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
