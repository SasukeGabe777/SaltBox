import type { OperatorRunView } from "@saltbox/database/queries/operator";
import { formatDateTime } from "../utils/format";

/**
 * Live run progress. The worker writes `progress` and per-target rows to the
 * database; the admin polls through its normal revalidation, which is the
 * simplest robust mechanism at this scale (no websockets required).
 */
export function RunProgress({ run, compact = false }: { run: OperatorRunView; compact?: boolean }) {
  const progress = run.progress ?? {};
  const stage = typeof progress.stage === "string" ? progress.stage : run.status;
  const message = typeof progress.message === "string" ? progress.message : "";
  const total = typeof progress.total === "number" ? progress.total : run.targets.length;
  const completed =
    typeof progress.completed === "number"
      ? progress.completed
      : run.targets.filter((target) => target.status !== "pending" && target.status !== "running").length;

  return (
    <div className={`run-progress ${compact ? "is-compact" : ""}`}>
      <span className={`run-status run-${run.status}`}>{run.status.replaceAll("_", " ")}</span>
      <span className="run-stage">
        {stage}
        {message ? ` — ${message}` : ""}
      </span>
      {total > 0 ? (
        <span className="run-count">
          {completed}/{total}
        </span>
      ) : null}
      {!compact ? <span className="run-time">{formatDateTime(run.requestedAt)}</span> : null}
    </div>
  );
}
