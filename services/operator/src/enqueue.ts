/**
 * Enqueueing operator runs.
 *
 * The admin never executes Lighthouse, Chromium, or discovery inside an HTTP
 * request. It validates a small form, writes a queued `operator_run`, and
 * starts a detached local worker process that claims the run and reports
 * progress back through the database. The admin then simply polls the run.
 *
 * This module stays dependency-light (database + node:child_process) so the
 * admin server can import it safely.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@saltbox/database/client";
import {
  createOperatorRun,
  type CreateOperatorRunResult,
  type OperatorRunKind,
} from "@saltbox/database/repositories/operator-runs";
import { appendEvent } from "@saltbox/database/repositories/events";
import { requestKeyFor, type OperatorRunParameters } from "./parameters.ts";

export interface EnqueueOperatorRunOptions {
  actorRef: string;
  prospectId?: string;
  businessId?: string;
  demoId?: string;
  correlationId?: string;
  /** Start the local worker process (default true). */
  startWorker?: boolean;
  /** Override the worker script path (tests, packaged deployments). */
  workerScript?: string;
}

export interface EnqueueOperatorRunResult extends CreateOperatorRunResult {
  workerStarted: boolean;
  workerError?: string;
}

export async function enqueueOperatorRun(
  db: Database,
  parameters: OperatorRunParameters,
  options: EnqueueOperatorRunOptions,
): Promise<EnqueueOperatorRunResult> {
  const prospectId =
    options.prospectId ?? ("prospectId" in parameters ? (parameters as { prospectId: string }).prospectId : undefined);
  const created = await createOperatorRun(db, {
    runKind: parameters.kind as OperatorRunKind,
    requestedParameters: parameters as unknown as Record<string, unknown>,
    actorType: "operator",
    actorRef: options.actorRef,
    requestKey: requestKeyFor(parameters),
    ...(prospectId ? { prospectId } : {}),
    ...(options.businessId ? { businessId: options.businessId } : {}),
    ...(options.demoId ? { demoId: options.demoId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  });

  if (!created.created) {
    // A run for this exact request is already queued or running; repeated form
    // submissions join it instead of starting a duplicate.
    return { ...created, workerStarted: false };
  }

  if (parameters.kind === "acquisition") {
    await appendEvent(db, {
      category: "audit",
      eventType: "acquisition_run_started",
      occurredAt: created.run.requestedAt,
      sourceProducer: "operator-runs-v1",
      actorType: "operator",
      actorRef: options.actorRef,
      idempotencyScope: "acquisition_run_started",
      idempotencyKey: created.run.id,
      properties: { ...parameters },
    });
  }
  if (parameters.kind === "retry_intelligence") {
    await appendEvent(db, {
      category: "audit",
      eventType: "retry_requested",
      occurredAt: created.run.requestedAt,
      sourceProducer: "operator-runs-v1",
      actorType: "operator",
      actorRef: options.actorRef,
      idempotencyScope: "retry_requested",
      idempotencyKey: created.run.id,
      ...(prospectId ? { prospectId } : {}),
      properties: { runKind: parameters.kind },
    });
  }

  if (options.startWorker === false) return { ...created, workerStarted: false };
  try {
    startRunWorker(created.run.id, options.workerScript);
    return { ...created, workerStarted: true };
  } catch (error) {
    return {
      ...created,
      workerStarted: false,
      workerError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Locate the local run worker script. */
export function resolveWorkerScript(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.SALTBOX_OPERATOR_WORKER,
    safeResolve("../scripts/worker.ts"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not locate the SaltBox operator run worker. Set SALTBOX_OPERATOR_WORKER to " +
      "<repo>/services/operator/scripts/worker.ts.",
  );
}

/**
 * Start the worker detached: the run survives an admin restart, and its
 * lifetime is not tied to the HTTP request that created it.
 */
export function startRunWorker(runId: string, workerScript?: string): void {
  const script = resolveWorkerScript(workerScript);
  const child = spawn(process.execPath, [script, "--run", runId], {
    // The worker resolves artifact roots relative to its package directory.
    cwd: resolve(dirname(script), ".."),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

function safeResolve(relative: string): string | undefined {
  try {
    return fileURLToPath(new URL(relative, import.meta.url));
  } catch {
    return undefined;
  }
}

