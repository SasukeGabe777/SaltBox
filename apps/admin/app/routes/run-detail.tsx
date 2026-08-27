import { Link } from "react-router";
import type { Route } from "./+types/run-detail";
import { RefreshControl } from "../components/RefreshControl";
import { RunProgress } from "../components/RunProgress";
import { isUuid, rethrowAsOperatorResponse } from "../data/admin-loaders.server";
import { loadOperatorRun } from "../data/operator.server";
import { formatDateTime } from "../utils/format";

export function meta() {
  return [{ title: "Operator run · SaltBox" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  try {
    if (!params.runId || !isUuid(params.runId)) {
      throw new Response("Malformed run identifier.", { status: 400, statusText: "Invalid run ID" });
    }
    const run = await loadOperatorRun(params.runId);
    if (!run) throw new Response("Run not found.", { status: 404, statusText: "Run not found" });
    return { run, loadedAt: new Date().toISOString() };
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export default function RunDetailPage({ loaderData }: Route.ComponentProps) {
  const { run, loadedAt } = loaderData;
  const active = run.status === "queued" || run.status === "running";

  return (
    <main id="main-content" className="app-shell detail-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Prospect Intelligence</Link>
        <span aria-hidden="true">/</span>
        <Link to="/runs">Operator runs</Link>
        <span aria-hidden="true">/</span>
        <span>{run.runKind.replaceAll("_", " ")}</span>
      </nav>

      <section className="detail-heading">
        <div>
          <p className="eyebrow">OPERATOR RUN</p>
          <h1>{run.runKind.replaceAll("_", " ")}</h1>
          <div className="detail-meta">
            <span>{run.actorRef}</span>
            <span>requested {formatDateTime(run.requestedAt)}</span>
            {run.completedAt ? <span>completed {formatDateTime(run.completedAt)}</span> : null}
          </div>
        </div>
        <RefreshControl updatedAt={loadedAt} intervalMs={active ? 2000 : 8000} />
      </section>

      <section className="panel">
        <RunProgress run={run} />
        {run.failureMessage ? <p className="run-failure">{run.failureMessage}</p> : null}
        <dl className="fact-list demo-facts">
          {Object.entries(run.requestedParameters).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
        {run.summary ? (
          <>
            <h3>Result</h3>
            <dl className="fact-list demo-facts">
              {Object.entries(run.summary).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">TARGETS</p>
            <h2>Per-business progress</h2>
          </div>
        </div>
        {run.targets.length === 0 ? (
          <p className="panel-empty">No targets have been recorded for this run yet.</p>
        ) : (
          <ol className="target-list">
            {run.targets.map((target) => (
              <li key={target.targetId}>
                <span className={`run-status run-${target.status}`}>{target.status.replaceAll("_", " ")}</span>
                <div>
                  <strong>{target.label}</strong>
                  <span className="muted">{target.stage ?? ""}</span>
                  {target.outcome ? (
                    <span className="target-outcome">
                      {["score", "decision", "intelligenceStatus"]
                        .map((key) => (target.outcome?.[key] === null || target.outcome?.[key] === undefined ? null : `${key} ${String(target.outcome[key])}`))
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {target.failureKind ? (
                    <span className="failure-kind">
                      {target.failureKind}
                      {target.failureCode ? ` (${target.failureCode})` : ""}
                      {target.transient ? " · transient" : ""}
                      {target.failureMessage ? ` — ${target.failureMessage}` : ""}
                    </span>
                  ) : null}
                </div>
                {target.prospectId ? <Link to={`/prospects/${target.prospectId}`}>case file</Link> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map((item) => String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
