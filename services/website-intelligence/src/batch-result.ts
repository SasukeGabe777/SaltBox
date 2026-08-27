export type BatchStatus = "completed" | "completed_with_target_failures" | "failed";
export type TargetExecutionStatus = "complete" | "partial" | "failed" | "skipped_no_website";

export interface TargetBatchOutcome {
  index: number;
  businessName: string;
  prospectId: string | null;
  status: TargetExecutionStatus;
  failedStages: string[];
  fatalStage?: string;
  failureKind?: string;
  failureCode?: string;
  transient?: boolean;
  message?: string;
}

export interface BatchSummary {
  status: BatchStatus;
  exitCode: number;
  complete: number;
  partial: number;
  failed: number;
  skippedNoWebsite: number;
  targetFailures: TargetBatchOutcome[];
  systemFailure?: string;
}

/**
 * Classify a batch only after every selected target has reached a terminal
 * outcome. Target failures are successful operator batches by default;
 * --strict makes them non-zero for CI/debugging.
 */
export function summarizeBatch(outcomes: TargetBatchOutcome[], strict: boolean): BatchSummary {
  const complete = outcomes.filter((outcome) => outcome.status === "complete").length;
  const partial = outcomes.filter((outcome) => outcome.status === "partial").length;
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  const skippedNoWebsite = outcomes.filter((outcome) => outcome.status === "skipped_no_website").length;
  const targetFailures = outcomes.filter((outcome) => outcome.status === "partial" || outcome.status === "failed");

  const browserUnavailable = outcomes.some((outcome) => outcome.fatalStage === "browser_unavailable");
  const browserInitializedForAnyTarget = outcomes.some(
    (outcome) => outcome.status === "complete" || outcome.status === "partial",
  );
  if (browserUnavailable && !browserInitializedForAnyTarget) {
    return {
      status: "failed",
      exitCode: 1,
      complete,
      partial,
      failed,
      skippedNoWebsite,
      targetFailures,
      systemFailure: "Chromium could not initialize for any analyzable target.",
    };
  }

  const status: BatchStatus = targetFailures.length > 0 ? "completed_with_target_failures" : "completed";
  return {
    status,
    exitCode: strict && targetFailures.length > 0 ? 2 : 0,
    complete,
    partial,
    failed,
    skippedNoWebsite,
    targetFailures,
  };
}
