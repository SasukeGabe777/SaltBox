/**
 * Operator mutations for the local admin (Phase 10).
 *
 * The admin stops being read-only here — but only for demo lifecycle actions
 * and bounded run submission. There are no generic CRUD controls for
 * businesses, prospects, scores, or decisions; those remain evidence.
 *
 * Every mutation:
 *   - is same-origin checked (the admin binds to loopback, but a browser page
 *     should still be unable to drive it from elsewhere);
 *   - carries an explicit operator actor identity;
 *   - goes through a domain service that enforces the approval invariant and
 *     writes audit history — never through ad-hoc SQL in a route.
 */

import { createDatabase, type Database } from "@saltbox/database/client";
import { getDemoForProspect } from "@saltbox/database/repositories/demos";
import {
  getOperatorDashboard,
  getOperatorRunView,
  listOperatorRunViews,
  type OperatorDashboardView,
  type OperatorRunView,
} from "@saltbox/database/queries/operator";
import { approveDemoVersion, rejectDemoVersion } from "@saltbox/demo-generation/approval";
import { enqueueOperatorRun } from "@saltbox/operator/enqueue";
import {
  parseAcquisitionParameters,
  parseDemoGenerateParameters,
  parseDemoPublishParameters,
  parseProspectScopedParameters,
  supportedAcquisitionCategories,
} from "@saltbox/operator/parameters";
import type { OperatorActionResult } from "./operator-types.ts";

export type { OperatorActionResult } from "./operator-types.ts";

const globalDatabase = globalThis as typeof globalThis & { __saltboxOperatorDatabase?: Database };
const database = globalDatabase.__saltboxOperatorDatabase ?? createDatabase({ maxConnections: 4 });
if (process.env.NODE_ENV !== "production") globalDatabase.__saltboxOperatorDatabase = database;

/**
 * The single local operator identity. A real authentication provider replaces
 * this later without changing any call site: everything downstream takes an
 * actor reference, not a session.
 */
export function operatorActorRef(): string {
  return process.env.SALTBOX_OPERATOR_REF?.trim() || "local-operator";
}

export function demosBaseUrlValue(): string {
  return (process.env.SALTBOX_DEMOS_BASE_URL ?? "http://127.0.0.1:5175").replace(/\/+$/, "");
}

/** Reject cross-origin form posts even on a loopback-only server. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) return; // Same-origin form posts may omit Origin in some clients.
  const host = request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Response("Malformed origin.", { status: 400 });
  }
  if (host === null || originHost !== host) {
    throw new Response("Cross-origin operator actions are not allowed.", { status: 403 });
  }
}

function fields(form: FormData): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) record[key] = typeof value === "string" ? value : undefined;
  return record;
}

/** Handle one operator intent from a route action. */
export async function handleOperatorAction(request: Request): Promise<OperatorActionResult> {
  assertSameOrigin(request);
  const form = await request.formData();
  return dispatchOperatorIntent(database, form, { actorRef: operatorActorRef() });
}

export interface DispatchOptions {
  actorRef: string;
  /** Tests enqueue without spawning a local worker process. */
  startWorker?: boolean;
}

/**
 * The mutation layer proper: explicit database, explicit actor, no request
 * concerns. Route actions and tests both go through this.
 */
export async function dispatchOperatorIntent(
  db: Database,
  form: FormData,
  options: DispatchOptions,
): Promise<OperatorActionResult> {
  const intent = String(form.get("intent") ?? "");
  const raw = fields(form);
  const actorRef = options.actorRef;
  const enqueueOptions = { actorRef, ...(options.startWorker === false ? { startWorker: false } : {}) };

  switch (intent) {
    case "approve-version": {
      const demoId = String(form.get("demoId") ?? "");
      const demoVersionId = String(form.get("demoVersionId") ?? "");
      const note = String(form.get("note") ?? "").trim();
      const overrideReason = String(form.get("qaOverrideReason") ?? "").trim();
      const result = await approveDemoVersion(db, {
        demoId,
        demoVersionId,
        actor: { actorRef },
        ...(note !== "" ? { note } : {}),
        ...(overrideReason !== "" ? { qaOverrideReason: overrideReason } : {}),
      });
      if (result.status === "blocked") {
        return {
          ok: false,
          intent,
          message: "Approval was blocked.",
          detail: result.blockers.map((blocker) => `${blocker.code}: ${blocker.detail}`),
        };
      }
      return {
        ok: true,
        intent,
        message:
          result.status === "already_approved"
            ? `Version ${result.summary.versionNumber} was already the approved version.`
            : `Approved version ${result.summary.versionNumber}${result.summary.qaOverride ? " with an audited QA override" : ""}.`,
      };
    }

    case "reject-version": {
      const demoId = String(form.get("demoId") ?? "");
      const demoVersionId = String(form.get("demoVersionId") ?? "");
      const note = String(form.get("note") ?? "").trim();
      const result = await rejectDemoVersion(db, {
        demoId,
        demoVersionId,
        actor: { actorRef },
        ...(note !== "" ? { note } : {}),
      });
      if (result.status === "blocked") {
        return {
          ok: false,
          intent,
          message: "Rejection was blocked.",
          detail: result.blockers.map((blocker) => `${blocker.code}: ${blocker.detail}`),
        };
      }
      return {
        ok: true,
        intent,
        message: result.approvalCleared
          ? "Version rejected; the demo now has no approved version."
          : "Version rejected. The approved version is unchanged.",
      };
    }

    case "regenerate-demo": {
      const parsed = parseDemoGenerateParameters({ ...raw, forceRegenerate: "true", runQa: "true" });
      if (!parsed.ok) return { ok: false, intent, message: "Invalid regeneration request.", errors: parsed.errors };
      const enqueued = await enqueueOperatorRun(db, parsed.value, enqueueOptions);
      return runResult(intent, enqueued, "Regeneration queued; the new version will return to review.");
    }

    case "run-qa": {
      const parsed = parseProspectScopedParameters("demo_qa", raw);
      if (!parsed.ok) return { ok: false, intent, message: "Invalid QA request.", errors: parsed.errors };
      const enqueued = await enqueueOperatorRun(db, parsed.value, enqueueOptions);
      return runResult(intent, enqueued, "QA queued for the current demo version.");
    }

    case "publish-demo": {
      const parsed = parseDemoPublishParameters(raw);
      if (!parsed.ok) return { ok: false, intent, message: "Invalid publication request.", errors: parsed.errors };
      const enqueued = await enqueueOperatorRun(db, parsed.value, enqueueOptions);
      return runResult(intent, enqueued, `Publication queued (${parsed.value.environment}).`);
    }

    case "retry-intelligence": {
      const parsed = parseProspectScopedParameters("retry_intelligence", raw);
      if (!parsed.ok) return { ok: false, intent, message: "Invalid retry request.", errors: parsed.errors };
      const enqueued = await enqueueOperatorRun(db, parsed.value, enqueueOptions);
      return runResult(intent, enqueued, "Intelligence retry queued.");
    }

    case "start-acquisition": {
      const parsed = parseAcquisitionParameters(raw);
      if (!parsed.ok) return { ok: false, intent, message: "Invalid acquisition request.", errors: parsed.errors };
      const enqueued = await enqueueOperatorRun(db, parsed.value, enqueueOptions);
      return runResult(
        intent,
        enqueued,
        `Acquisition queued: ${parsed.value.limit} × ${parsed.value.category} near ${parsed.value.location}.`,
      );
    }

    default:
      return { ok: false, intent, message: `Unknown operator action "${intent}".` };
  }
}

function runResult(
  intent: string,
  enqueued: { run: { id: string }; created: boolean; workerStarted: boolean; workerError?: string },
  message: string,
): OperatorActionResult {
  if (!enqueued.created) {
    return {
      ok: true,
      intent,
      runId: enqueued.run.id,
      message: "An identical run is already queued or running; showing that run.",
    };
  }
  if (enqueued.workerError !== undefined) {
    return {
      ok: false,
      intent,
      runId: enqueued.run.id,
      message: "The run was queued but the local worker could not be started.",
      detail: [
        enqueued.workerError ?? "Unknown worker error.",
        "Run it manually: pnpm --filter @saltbox/operator worker -- --run " + enqueued.run.id,
      ],
    };
  }
  return { ok: true, intent, runId: enqueued.run.id, message };
}

export async function loadOperatorDashboard(): Promise<OperatorDashboardView> {
  return getOperatorDashboard(database);
}

export async function loadOperatorRuns(limit = 25): Promise<OperatorRunView[]> {
  return listOperatorRunViews(database, { limit });
}

export async function loadOperatorRun(runId: string): Promise<OperatorRunView | undefined> {
  return getOperatorRunView(database, runId);
}

export async function loadProspectRuns(prospectId: string, limit = 5): Promise<OperatorRunView[]> {
  return listOperatorRunViews(database, { prospectId, limit });
}

export async function loadProspectDemoId(prospectId: string): Promise<string | undefined> {
  const demo = await getDemoForProspect(database, prospectId);
  return demo?.id;
}

export function acquisitionCategories(): string[] {
  return supportedAcquisitionCategories("all");
}
