/**
 * Phase 10 QA contract and persistence.
 *
 * The QA runner lives with the renderer (apps/demos) because it drives a real
 * browser; this module owns the *contract* it produces, which checks are
 * critical, and how a result is persisted as append-only evidence against one
 * exact DemoVersion.
 *
 * A critical failure blocks approval unless an operator records an audited
 * override — see approval.ts.
 */

import type { Database } from "@saltbox/database/client";
import { recordDemoQaResult, type DemoQaResultRecord } from "@saltbox/database/repositories/demo-review";
import { appendEvent } from "@saltbox/database/repositories/events";

export const DEMO_QA_RUNNER_VERSION = "demo-qa-v2";

/**
 * Checks that make a demo unusable or unsafe in front of a business owner.
 * Everything else is quality signal recorded for the operator to weigh.
 */
export const CRITICAL_QA_CHECKS: ReadonlySet<string> = new Set([
  "HTTP 200",
  "no horizontal overflow",
  "no console errors",
  "CTA visible",
  "contact path present",
  "all images load",
  "brand mark renders",
  "noindex directive",
  "no external scripts",
  "demo disclosure present",
]);

export interface DemoQaCheck {
  viewport: string;
  name: string;
  passed: boolean;
  detail?: string;
}

export interface DemoQaReport {
  runnerVersion: string;
  demoVersionId: string;
  locatorToken: string;
  checks: DemoQaCheck[];
  artifactRef?: string;
  /** Set when the run itself could not complete (browser/renderer failure). */
  errorMessage?: string;
  startedAt: string;
  completedAt: string;
}

export interface DemoQaEvaluation {
  status: "passed" | "failed" | "error";
  checksTotal: number;
  checksPassed: number;
  /** "<viewport>: <check>" for every failed critical check. */
  criticalFailures: string[];
  viewports: Array<{ viewport: string; passed: number; total: number; failures: string[] }>;
}

export function evaluateDemoQaReport(report: DemoQaReport): DemoQaEvaluation {
  const checksTotal = report.checks.length;
  const checksPassed = report.checks.filter((check) => check.passed).length;
  const criticalFailures = report.checks
    .filter((check) => !check.passed && CRITICAL_QA_CHECKS.has(check.name))
    .map((check) => `${check.viewport}: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);

  const viewportNames = [...new Set(report.checks.map((check) => check.viewport))];
  const viewports = viewportNames.map((viewport) => {
    const checks = report.checks.filter((check) => check.viewport === viewport);
    return {
      viewport,
      passed: checks.filter((check) => check.passed).length,
      total: checks.length,
      failures: checks.filter((check) => !check.passed).map((check) => check.name),
    };
  });

  const status: DemoQaEvaluation["status"] =
    report.errorMessage !== undefined || checksTotal === 0
      ? "error"
      : checksPassed === checksTotal
        ? "passed"
        : "failed";
  return { status, checksTotal, checksPassed, criticalFailures, viewports };
}

export interface PersistDemoQaResultInput {
  report: DemoQaReport;
  prospectId?: string;
  businessId?: string;
  actorRef?: string;
  correlationId?: string;
}

/** Persist QA evidence for one exact version and emit the audit event. */
export async function persistDemoQaResult(
  db: Database,
  input: PersistDemoQaResultInput,
): Promise<{ result: DemoQaResultRecord; evaluation: DemoQaEvaluation }> {
  const evaluation = evaluateDemoQaReport(input.report);
  const completedAt = new Date(input.report.completedAt);
  const result = await recordDemoQaResult(db, {
    demoVersionId: input.report.demoVersionId,
    runnerVersion: input.report.runnerVersion,
    status: evaluation.status,
    checksTotal: evaluation.checksTotal,
    checksPassed: evaluation.checksPassed,
    criticalFailures: evaluation.criticalFailures,
    summary: {
      viewports: evaluation.viewports,
      locatorToken: input.report.locatorToken,
      failures: input.report.checks
        .filter((check) => !check.passed)
        .slice(0, 40)
        .map((check) => ({
          viewport: check.viewport,
          name: check.name,
          ...(check.detail !== undefined ? { detail: check.detail } : {}),
          critical: CRITICAL_QA_CHECKS.has(check.name),
        })),
    },
    ...(input.report.artifactRef !== undefined ? { artifactRef: input.report.artifactRef } : {}),
    ...(input.report.errorMessage !== undefined ? { failureMessage: input.report.errorMessage } : {}),
    startedAt: new Date(input.report.startedAt),
    completedAt,
  });

  await appendEvent(db, {
    category: "audit",
    eventType: evaluation.status === "passed" ? "demo_qa_passed" : "demo_qa_failed",
    occurredAt: completedAt,
    sourceProducer: input.report.runnerVersion,
    actorType: "system",
    actorRef: input.actorRef ?? "demo-qa",
    idempotencyScope: "demo_qa_result",
    idempotencyKey: result.id,
    ...(input.businessId ? { businessId: input.businessId } : {}),
    ...(input.prospectId ? { prospectId: input.prospectId } : {}),
    demoVersionId: input.report.demoVersionId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    properties: {
      status: evaluation.status,
      checksPassed: evaluation.checksPassed,
      checksTotal: evaluation.checksTotal,
      criticalFailureCount: evaluation.criticalFailures.length,
    },
  });

  return { result, evaluation };
}
