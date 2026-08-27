/**
 * Operator run execution.
 *
 * This is the only place that turns a queued `operator_run` into real work:
 * bounded acquisition, demo generation (followed by QA), standalone QA,
 * publication, or a narrow intelligence retry. It runs in a separate local
 * process — never inside an HTTP request — and reports progress by updating
 * the run and its targets so the admin can simply poll.
 *
 * Phase 6/7 failure semantics are preserved: an isolated target failure
 * completes the run as `completed_with_target_failures`; only configuration,
 * database, or global-browser problems make a run `failed`.
 */

import { resolve } from "node:path";
import type { Database } from "@saltbox/database/client";
import { appendEvent } from "@saltbox/database/repositories/events";
import { getDemoForProspect } from "@saltbox/database/repositories/demos";
import {
  claimOperatorRun,
  completeOperatorRun,
  updateOperatorRunProgress,
  upsertOperatorRunTarget,
  type OperatorRunRecord,
  type OperatorRunStatus,
} from "@saltbox/database/repositories/operator-runs";
import { LocalArtifactStore } from "@saltbox/artifact-store/local";
import { createBrandExtractor } from "@saltbox/demo-generation/brand-extraction";
import { generateDemoForProspect } from "@saltbox/demo-generation/generate";
import { persistDemoQaResult } from "@saltbox/demo-generation/qa";
import { publishDemo } from "@saltbox/demo-generation/publish";
import { runDemoQa } from "@saltbox/demos/qa";
import { WranglerR2ArtifactStore } from "@saltbox/demos/hosting/r2";
import {
  DEFAULT_DISCOVERY_USER_AGENT,
  OpenStreetMapOverpassAdapter,
} from "@saltbox/discovery/openstreetmap";
import { OvertureMapsPlacesAdapter } from "@saltbox/discovery/overture";
import { discoverAndAcquireV2 } from "@saltbox/discovery/acquire-v2";
import { getOsmCategoryMapping } from "@saltbox/discovery/osm-categories";
import { getOvertureCategoryMapping } from "@saltbox/discovery/overture-categories";
import type { DiscoveryResult, DiscoverySourceAdapter } from "@saltbox/discovery";
import { qualifyBusinessV2 } from "@saltbox/qualification/pipeline";
import type { OperatorRunParameters } from "./parameters.ts";
import { reconstructIngestionInput } from "./reingest.ts";

export const OPERATOR_RUN_VERSION = "operator-runs-v1";

export interface ExecuteOperatorRunOptions {
  /** Repository root-relative data directory; defaults to <repo>/.data. */
  dataRoot?: string;
  demosBaseUrl?: string;
  log?: (stage: string, detail?: Record<string, unknown>) => void;
}

export type TerminalRunStatus = Exclude<OperatorRunStatus, "queued" | "running">;

export interface ExecuteOperatorRunResult {
  status: TerminalRunStatus;
  summary: Record<string, unknown>;
}

export async function executeOperatorRun(
  db: Database,
  runId: string,
  options: ExecuteOperatorRunOptions = {},
): Promise<ExecuteOperatorRunResult | undefined> {
  const log = options.log ?? (() => {});
  const run = await claimOperatorRun(db, runId);
  if (!run) {
    log("run-not-claimable", { runId });
    return undefined;
  }
  const parameters = run.requestedParameters as unknown as OperatorRunParameters;
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), "../../.data");
  const context: RunContext = {
    db,
    run,
    dataRoot,
    demosBaseUrl: (options.demosBaseUrl ?? process.env.SALTBOX_DEMOS_BASE_URL ?? "http://127.0.0.1:5175").replace(
      /\/+$/,
      "",
    ),
    log,
  };

  try {
    const result = await dispatch(context, parameters);
    await completeOperatorRun(db, { runId, status: result.status, summary: result.summary });
    if (parameters.kind === "acquisition") {
      await appendEvent(db, {
        category: "audit",
        eventType: "acquisition_run_completed",
        occurredAt: new Date(),
        sourceProducer: OPERATOR_RUN_VERSION,
        actorType: "operator",
        actorRef: run.actorRef,
        idempotencyScope: "acquisition_run_completed",
        idempotencyKey: run.id,
        properties: { status: result.status, ...result.summary },
      });
    }
    log("run-completed", { runId, status: result.status });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeOperatorRun(db, { runId, status: "failed", failureMessage: message });
    log("run-failed", { runId, message });
    return { status: "failed", summary: { message } };
  }
}

interface RunContext {
  db: Database;
  run: OperatorRunRecord;
  dataRoot: string;
  demosBaseUrl: string;
  log: (stage: string, detail?: Record<string, unknown>) => void;
}

async function dispatch(
  context: RunContext,
  parameters: OperatorRunParameters,
): Promise<ExecuteOperatorRunResult> {
  switch (parameters.kind) {
    case "acquisition":
      return runAcquisition(context, parameters);
    case "demo_generate":
      return runDemoGeneration(context, parameters);
    case "demo_qa":
      return runQaOnly(context, parameters);
    case "demo_publish":
      return runPublication(context, parameters);
    case "retry_intelligence":
      return runIntelligenceRetry(context, parameters);
    default:
      throw new Error(`Unsupported operator run kind "${(parameters as { kind: string }).kind}".`);
  }
}

async function progress(context: RunContext, progressPatch: Record<string, unknown>): Promise<void> {
  await updateOperatorRunProgress(context.db, {
    runId: context.run.id,
    progress: { updatedAt: new Date().toISOString(), ...progressPatch },
  });
}

// --- Acquisition -------------------------------------------------------------

async function runAcquisition(
  context: RunContext,
  parameters: Extract<OperatorRunParameters, { kind: "acquisition" }>,
): Promise<ExecuteOperatorRunResult> {
  const adapters: DiscoverySourceAdapter[] = [];
  const supportsOsm = getOsmCategoryMapping(parameters.category) !== undefined;
  const supportsOverture = getOvertureCategoryMapping(parameters.category) !== undefined;
  if ((parameters.source === "openstreetmap" || parameters.source === "all") && supportsOsm) {
    adapters.push(
      new OpenStreetMapOverpassAdapter({
        userAgent: process.env.SALTBOX_DISCOVERY_USER_AGENT ?? DEFAULT_DISCOVERY_USER_AGENT,
      }),
    );
  }
  if ((parameters.source === "overture" || parameters.source === "all") && supportsOverture) {
    adapters.push(new OvertureMapsPlacesAdapter());
  }
  if (adapters.length === 0) {
    throw new Error(`No discovery adapter supports category "${parameters.category}" for source "${parameters.source}".`);
  }

  const artifactRoot = resolve(context.dataRoot, "website-intelligence");
  let positionOffset = 0;
  let discovered = 0;
  let qualified = 0;
  let rejected = 0;
  let targetFailures = 0;
  let systemFailures = 0;

  await progress(context, { stage: "starting", message: `${parameters.category} · ${parameters.location}` });

  for (const adapter of adapters) {
    const offset = positionOffset;
    const run = await discoverAndAcquireV2(
      context.db,
      {
        category: parameters.category,
        location: parameters.location,
        radiusKm: parameters.radiusKm,
        limit: parameters.limit,
        source: adapter.source,
      },
      adapter,
      {
        concurrency: parameters.concurrency,
        ...(context.run.correlationId ? { correlationId: context.run.correlationId } : {}),
        artifactForCandidate: (candidate) => artifactLocation(candidate, artifactRoot),
        log: (event, detail) => {
          void handleAcquisitionEvent(context, event, detail, offset).catch(() => {});
        },
      },
    );
    positionOffset += run.discovered;
    discovered += run.discovered;
    qualified += run.qualified;
    rejected += run.rejected;
    targetFailures += run.targetFailures;
    systemFailures += run.systemFailures;
  }

  const status: TerminalRunStatus =
    systemFailures > 0 ? "failed" : targetFailures > 0 ? "completed_with_target_failures" : "completed";
  await progress(context, {
    stage: "completed",
    message: `${qualified} qualified, ${rejected} rejected`,
    discovered,
    completed: discovered,
    total: discovered,
  });
  return {
    status,
    summary: {
      category: parameters.category,
      location: parameters.location,
      sources: adapters.map((adapter) => adapter.source),
      discovered,
      qualified,
      rejected,
      targetFailures,
      systemFailures,
    },
  };
}

/** Translate acquire-v2 log events into persisted run/target progress. */
async function handleAcquisitionEvent(
  context: RunContext,
  event: string,
  detail: Record<string, unknown>,
  offset: number,
): Promise<void> {
  const index = typeof detail.index === "number" ? detail.index : undefined;
  const position = index === undefined ? undefined : offset + index;
  const label = typeof detail.businessName === "string" ? detail.businessName : "candidate";

  if (event === "location-resolved") {
    await progress(context, { stage: "location", message: String(detail.location ?? "") });
    return;
  }
  if (event === "candidates-discovered") {
    await progress(context, {
      stage: "discovered",
      message: `discovered ${String(detail.candidateCount ?? 0)} candidates`,
      total: Number(detail.candidateCount ?? 0) + offset,
      completed: offset,
    });
    return;
  }
  if (position === undefined) return;

  if (event === "candidate-started") {
    await upsertOperatorRunTarget(context.db, {
      operatorRunId: context.run.id,
      position,
      label,
      status: "running",
      stage: "discovered",
      startedAt: new Date(),
    });
    await progress(context, { stage: "analyzing", message: label, completed: position - 1 });
    return;
  }
  if (event === "pipeline-stage" || event === "intelligence-progress") {
    const stage = String(detail.stage ?? detail.message ?? "");
    if (stage === "") return;
    await upsertOperatorRunTarget(context.db, {
      operatorRunId: context.run.id,
      position,
      label,
      status: "running",
      stage,
    });
    await progress(context, { stage: "analyzing", message: `${label} — ${stage}`, completed: position - 1 });
    return;
  }
  if (event === "candidate-completed") {
    const targetFailure = detail.targetFailure === true;
    await upsertOperatorRunTarget(context.db, {
      operatorRunId: context.run.id,
      position,
      label,
      status: targetFailure ? "target_failed" : "completed",
      stage: String(detail.decision ?? detail.intelligenceStatus ?? "completed"),
      ...(typeof detail.prospectId === "string" ? { prospectId: detail.prospectId } : {}),
      ...(typeof detail.businessId === "string" ? { businessId: detail.businessId } : {}),
      outcome: {
        score: detail.score ?? null,
        decision: detail.decision ?? null,
        intelligenceStatus: detail.intelligenceStatus ?? null,
        elapsedMs: detail.elapsedMs ?? null,
      },
      ...(targetFailure
        ? {
            failureKind: String(detail.intelligenceFailureKind ?? detail.intelligenceStatus ?? "target_failure"),
            ...(typeof detail.intelligenceFailureCode === "string"
              ? { failureCode: detail.intelligenceFailureCode }
              : {}),
            transient: detail.intelligenceTransient === true,
          }
        : {}),
      completedAt: new Date(),
    });
    await progress(context, {
      stage: "analyzed",
      message: `${label} — ${String(detail.decision ?? "analyzed")}`,
      completed: position,
    });
    return;
  }
  if (event === "candidate-failed") {
    await upsertOperatorRunTarget(context.db, {
      operatorRunId: context.run.id,
      position,
      label,
      status: "failed",
      failureKind: String(detail.errorClass ?? "pipeline_system_failure"),
      failureMessage: String(detail.message ?? ""),
      completedAt: new Date(),
    });
  }
}

function artifactLocation(candidate: DiscoveryResult, artifactRoot: string) {
  const slug = candidate.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const artifactRef = `${stamp}-${slug || candidate.externalId.slice(0, 8)}`;
  return { artifactRef, artifactDir: resolve(artifactRoot, artifactRef) };
}

// --- Demo generation + QA ----------------------------------------------------

async function runDemoGeneration(
  context: RunContext,
  parameters: Extract<OperatorRunParameters, { kind: "demo_generate" }>,
): Promise<ExecuteOperatorRunResult> {
  const assetRoot = resolve(context.dataRoot, "demo-assets");
  await progress(context, { stage: "generating", message: "building the demo" });

  const result = await generateDemoForProspect(context.db, parameters.prospectId, {
    forceRegenerate: parameters.forceRegenerate,
    refreshBrand: parameters.refreshBrand,
    ...(parameters.composition ? { composition: parameters.composition } : {}),
    ...(parameters.reason ? { regenerationReason: parameters.reason } : {}),
    actorRef: context.run.actorRef,
    baseUrl: context.demosBaseUrl,
    brandExtractor: createBrandExtractor(context.db, {
      assetRoot,
      log: (stage, detail) => context.log(`brand:${stage}`, detail),
    }),
    log: (stage, detail) => {
      void progress(context, { stage: "generating", message: stage, ...(detail ?? {}) }).catch(() => {});
    },
  });

  if (result.status === "ineligible") {
    return {
      status: "completed",
      summary: {
        outcome: "ineligible",
        reasons: result.eligibility.reasons.map((reason) => reason.code),
      },
    };
  }
  if (result.status === "not_found") {
    throw new Error(`Prospect ${parameters.prospectId} does not exist.`);
  }

  const summary: Record<string, unknown> = {
    outcome: result.status,
    demoId: result.summary.demoId,
    demoVersionId: result.summary.demoVersionId,
    versionNumber: result.summary.versionNumber,
    composition: result.summary.templateName,
    url: result.summary.url,
    // Approval never moves on generation; the new version awaits review.
    approvedDemoVersionId: result.summary.approvedDemoVersionId,
    awaitingReview: !result.summary.isApproved,
  };

  if (parameters.runQa) {
    await progress(context, { stage: "qa", message: "running automated QA" });
    const qa = await runQaForToken(context, {
      token: result.summary.locatorToken,
      prospectId: parameters.prospectId,
      businessId: result.summary.businessId,
    });
    summary.qaStatus = qa.status;
    summary.qaChecks = `${qa.checksPassed}/${qa.checksTotal}`;
    summary.qaCriticalFailures = qa.criticalFailures;
  }

  await progress(context, { stage: "completed", message: `v${result.summary.versionNumber} ready for review` });
  return { status: "completed", summary };
}

async function runQaOnly(
  context: RunContext,
  parameters: Extract<OperatorRunParameters, { kind: "demo_qa" }>,
): Promise<ExecuteOperatorRunResult> {
  const demo = await getDemoForProspect(context.db, parameters.prospectId);
  if (!demo) throw new Error(`Prospect ${parameters.prospectId} has no live demo.`);
  const locator = await context.db
    .selectFrom("demo_public_locator")
    .select("token")
    .where("demo_id", "=", demo.id)
    .where("status", "=", "active")
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!locator) throw new Error(`Demo ${demo.id} has no active locator.`);

  await progress(context, { stage: "qa", message: "running automated QA" });
  const qa = await runQaForToken(context, { token: locator.token, prospectId: parameters.prospectId });
  await progress(context, { stage: "completed", message: `QA ${qa.status}` });
  return {
    status: "completed",
    summary: {
      outcome: "qa",
      demoId: demo.id,
      qaStatus: qa.status,
      qaChecks: `${qa.checksPassed}/${qa.checksTotal}`,
      qaCriticalFailures: qa.criticalFailures,
    },
  };
}

async function runQaForToken(
  context: RunContext,
  input: { token: string; prospectId: string; businessId?: string },
): Promise<{ status: string; checksPassed: number; checksTotal: number; criticalFailures: string[] }> {
  const { report, prospectId, businessId } = await runDemoQa({
    db: context.db,
    token: input.token,
    assetRoot: resolve(context.dataRoot, "demo-assets"),
    artifactRoot: resolve(context.dataRoot, "demos/qa"),
    log: (line) => context.log("qa", { line }),
  });
  if (report.demoVersionId === "") {
    return { status: "error", checksPassed: 0, checksTotal: 0, criticalFailures: ["locator did not resolve"] };
  }
  const { evaluation } = await persistDemoQaResult(context.db, {
    report,
    prospectId: prospectId ?? input.prospectId,
    ...(businessId ?? input.businessId ? { businessId: (businessId ?? input.businessId)! } : {}),
    actorRef: context.run.actorRef,
    ...(context.run.correlationId ? { correlationId: context.run.correlationId } : {}),
  });
  return {
    status: evaluation.status,
    checksPassed: evaluation.checksPassed,
    checksTotal: evaluation.checksTotal,
    criticalFailures: evaluation.criticalFailures,
  };
}

// --- Publication -------------------------------------------------------------

async function runPublication(
  context: RunContext,
  parameters: Extract<OperatorRunParameters, { kind: "demo_publish" }>,
): Promise<ExecuteOperatorRunResult> {
  const demo = await getDemoForProspect(context.db, parameters.prospectId);
  if (!demo) throw new Error(`Prospect ${parameters.prospectId} has no live demo.`);
  const source = new LocalArtifactStore(context.dataRoot);
  const destination =
    parameters.environment === "hosted"
      ? new WranglerR2ArtifactStore({
          bucket: process.env.SALTBOX_R2_BUCKET ?? "saltbox-demo-assets",
          cwd: resolve(context.dataRoot, "../apps/demos"),
        })
      : source;
  const publicBaseUrl =
    parameters.baseUrl ??
    (parameters.environment === "hosted" ? process.env.SALTBOX_DEMOS_PUBLIC_BASE_URL : undefined) ??
    context.demosBaseUrl;

  await progress(context, { stage: "publishing", message: parameters.environment });
  const result = await publishDemo(context.db, {
    demoId: demo.id,
    environment: parameters.environment,
    source,
    destination,
    publicBaseUrl,
    actorRef: context.run.actorRef,
    ...(context.run.correlationId ? { correlationId: context.run.correlationId } : {}),
    log: (stage, detail) => context.log(`publish:${stage}`, detail),
  });

  if (result.status === "published") {
    await progress(context, { stage: "completed", message: result.summary.publicUrl });
    return { status: "completed", summary: { outcome: "published", ...result.summary } };
  }
  if (result.status === "not_approved") {
    return {
      status: "completed",
      summary: { outcome: "not_approved", message: "Approve a demo version before publishing." },
    };
  }
  throw new Error(result.status === "not_found" ? "The demo no longer exists." : result.message);
}

// --- Retry -------------------------------------------------------------------

async function runIntelligenceRetry(
  context: RunContext,
  parameters: Extract<OperatorRunParameters, { kind: "retry_intelligence" }>,
): Promise<ExecuteOperatorRunResult> {
  const input = await reconstructIngestionInput(context.db, parameters.prospectId);
  if (!input) throw new Error(`Prospect ${parameters.prospectId} cannot be retried: no discovery provenance exists.`);

  await upsertOperatorRunTarget(context.db, {
    operatorRunId: context.run.id,
    position: 1,
    label: input.business.name,
    status: "running",
    stage: "retrying intelligence",
    prospectId: parameters.prospectId,
    businessId: input.businessId,
    startedAt: new Date(),
  });
  await progress(context, { stage: "analyzing", message: input.business.name, total: 1, completed: 0 });

  const artifactRoot = resolve(context.dataRoot, "website-intelligence");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const artifactRef = `${stamp}-retry-${input.business.externalId.slice(0, 12).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const outcome = await qualifyBusinessV2(context.db, input.business, {
    ...(context.run.correlationId ? { correlationId: context.run.correlationId } : {}),
    artifactRef,
    analyzer: { artifactDir: resolve(artifactRoot, artifactRef) },
    log: (stage, detail) => {
      void progress(context, { stage: "analyzing", message: stage, ...(detail ?? {}) }).catch(() => {});
    },
  });

  await upsertOperatorRunTarget(context.db, {
    operatorRunId: context.run.id,
    position: 1,
    label: input.business.name,
    status: outcome.targetFailure ? "target_failed" : "completed",
    stage: outcome.decision,
    prospectId: outcome.prospectId,
    businessId: outcome.businessId,
    outcome: { score: outcome.score, decision: outcome.decision, intelligenceStatus: outcome.intelligenceStatus },
    ...(outcome.targetFailure
      ? {
          failureKind: outcome.intelligenceFailureKind ?? outcome.intelligenceStatus,
          ...(outcome.intelligenceFailureCode ? { failureCode: outcome.intelligenceFailureCode } : {}),
          transient: outcome.intelligenceTransient,
        }
      : {}),
    completedAt: new Date(),
  });
  await progress(context, { stage: "completed", message: `${outcome.decision} (${outcome.score})`, completed: 1 });

  return {
    status: outcome.targetFailure ? "completed_with_target_failures" : "completed",
    summary: {
      outcome: "retried",
      prospectId: outcome.prospectId,
      score: outcome.score,
      decision: outcome.decision,
      intelligenceStatus: outcome.intelligenceStatus,
      targetFailure: outcome.targetFailure,
    },
  };
}
