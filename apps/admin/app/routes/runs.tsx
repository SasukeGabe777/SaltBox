import { Link } from "react-router";
import type { Route } from "./+types/runs";
import { RefreshControl } from "../components/RefreshControl";
import { RunProgress } from "../components/RunProgress";
import { rethrowAsOperatorResponse } from "../data/admin-loaders.server";
import { loadOperatorRuns } from "../data/operator.server";

export function meta() {
  return [
    { title: "Operator runs · SaltBox" },
    { name: "description", content: "Bounded local acquisition, demo, QA, and publication runs." },
  ];
}

export async function loader() {
  try {
    return { runs: await loadOperatorRuns(25), loadedAt: new Date().toISOString() };
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export default function RunsPage({ loaderData }: Route.ComponentProps) {
  const { runs, loadedAt } = loaderData;
  return (
    <main id="main-content" className="app-shell dashboard-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Prospect Intelligence</Link>
        <span aria-hidden="true">/</span>
        <span>Operator runs</span>
      </nav>

      <section className="page-heading">
        <div>
          <p className="eyebrow">OPERATOR RUNS</p>
          <h1>Work SaltBox is doing for you.</h1>
          <p className="page-intro">
            Acquisition, demo generation, QA, publication, and retries execute in a local worker process and report
            progress here. Nothing in this list contacts a prospect.
          </p>
        </div>
        <RefreshControl updatedAt={loadedAt} />
      </section>

      {runs.length === 0 ? (
        <div className="empty-state compact-empty">
          <h2>No runs yet</h2>
          <p>Start a bounded acquisition run from the dashboard.</p>
          <Link className="button button-quiet" to="/">Back to the dashboard</Link>
        </div>
      ) : (
        <section className="panel">
          <ul className="run-list run-list-full">
            {runs.map((run) => (
              <li key={run.runId}>
                <div className="run-headline">
                  <Link to={`/runs/${run.runId}`}>{run.runKind.replaceAll("_", " ")}</Link>
                  <span className="muted">{describeParameters(run.requestedParameters)}</span>
                </div>
                <RunProgress run={run} />
                {run.failureMessage ? <p className="run-failure">{run.failureMessage}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export function describeParameters(parameters: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["category", "location", "limit", "source", "environment", "composition"]) {
    const value = parameters[key];
    if (typeof value === "string" || typeof value === "number") parts.push(`${key} ${value}`);
  }
  return parts.join(" · ");
}
