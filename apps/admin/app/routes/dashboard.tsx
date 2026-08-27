import { Form, Link, useNavigate } from "react-router";
import type { ProspectListItem } from "@saltbox/database/queries/admin";
import type { Route } from "./+types/dashboard";
import { EmptyState } from "../components/EmptyState";
import { RefreshControl } from "../components/RefreshControl";
import { StatusBadge } from "../components/StatusBadge";
import { OperatorMessage } from "../components/OperatorMessage";
import { RunProgress } from "../components/RunProgress";
import {
  loadDashboardRequest,
  rethrowAsOperatorResponse,
} from "../data/admin-loaders.server";
import {
  acquisitionCategories,
  demosBaseUrlValue,
  handleOperatorAction,
  loadOperatorDashboard,
} from "../data/operator.server";
import { formatClockTime, formatDateTime, formatLocation } from "../utils/format";

export function meta() {
  return [
    { title: "Prospect Intelligence · SaltBox" },
    { name: "description", content: "Local prospect intelligence and demo operations for SaltBox operators." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const [base, operator] = await Promise.all([loadDashboardRequest(request), loadOperatorDashboard()]);
    return { ...base, operator, categories: acquisitionCategories(), demosBaseUrl: demosBaseUrlValue() };
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    return await handleOperatorAction(request);
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export default function Dashboard({ loaderData, actionData }: Route.ComponentProps) {
  const { overview, filters, operator, categories, demosBaseUrl } = loaderData;
  const hasFilters = Boolean(
    filters.search ||
      filters.source ||
      filters.category ||
      filters.intelligence ||
      (filters.status && filters.status !== "all") ||
      filters.minimumScore !== undefined ||
      filters.maximumScore !== undefined
  );

  return (
    <main id="main-content" className="app-shell dashboard-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">PROSPECT INTELLIGENCE</p>
          <h1>See the pipeline think.</h1>
          <p className="page-intro">
            Read-only visibility into SaltBox qualification evidence, priority scores, and lifecycle history.
          </p>
        </div>
        <RefreshControl updatedAt={overview.generatedAt} />
      </section>

      <section className="metric-grid" aria-label="Prospect totals">
        <Metric label="Total prospects" value={overview.summary.total} accent="default" />
        <Metric label="Qualified" value={overview.summary.qualified} accent="positive" />
        <Metric label="Awaiting demo review" value={operator.awaitingReview.length} accent="review" />
        <Metric label="Ready for outreach" value={operator.readyForOutreach.filter((item) => item.readyForOutreach).length} accent="info" />
      </section>

      <section className="panel operator-panel">
        <div className="panel-heading split-heading">
          <div>
            <p className="section-kicker">OPERATOR CONTROL</p>
            <h2>Start an acquisition run</h2>
          </div>
          <Link className="button button-quiet" to="/runs">
            All runs{operator.activeRunCount > 0 ? ` · ${operator.activeRunCount} active` : ""}
          </Link>
        </div>
        <OperatorMessage result={actionData ?? null} />
        <Form method="post" className="operator-form" aria-label="Start acquisition">
          <input type="hidden" name="intent" value="start-acquisition" />
          <label>
            <span>Category</span>
            <select name="category" defaultValue="roofing">
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="operator-field-wide">
            <span>Location</span>
            <input name="location" defaultValue="Ogden, UT" placeholder="Ogden, UT" required maxLength={120} />
          </label>
          <label>
            <span>Radius (km)</span>
            <input name="radiusKm" type="number" min={1} max={25} defaultValue={10} />
          </label>
          <label>
            <span>Limit</span>
            <input name="limit" type="number" min={1} max={10} defaultValue={3} />
          </label>
          <label>
            <span>Source</span>
            <select name="source" defaultValue="overture">
              <option value="overture">Overture</option>
              <option value="openstreetmap">OpenStreetMap</option>
              <option value="all">Both</option>
            </select>
          </label>
          <label>
            <span>Concurrency</span>
            <input name="concurrency" type="number" min={1} max={2} defaultValue={1} />
          </label>
          <button className="button button-primary" type="submit">START ACQUISITION</button>
        </Form>
        <p className="operator-note">
          Bounded by policy: at most 10 businesses per source, 25 km, and deep-analysis concurrency 2. Runs execute
          in a local worker process and never send outreach.
        </p>
      </section>

      <section className="dashboard-grid operator-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">REVIEW QUEUE</p>
              <h2>Demos awaiting review</h2>
            </div>
          </div>
          {operator.awaitingReview.length === 0 ? (
            <p className="panel-empty">Every generated demo version has been reviewed.</p>
          ) : (
            <ul className="review-queue">
              {operator.awaitingReview.map((item) => (
                <li key={item.demoId}>
                  <Link to={`/prospects/${item.prospectId}`}>{item.businessName}</Link>
                  <span className="review-meta">
                    v{item.currentVersionNumber ?? "—"} · {item.composition ?? "composition unknown"}
                    {item.approvedVersionNumber ? ` · approved v${item.approvedVersionNumber}` : " · never approved"}
                  </span>
                  <span className={`qa-chip qa-${item.qaStatus ?? "none"}`}>
                    {item.qaStatus ? `QA ${item.qaStatus}` : "QA not run"}
                    {item.qaCriticalFailures ? ` · ${item.qaCriticalFailures} critical` : ""}
                  </span>
                  {item.locatorToken ? (
                    <a href={`${demosBaseUrl}/d/${item.locatorToken}`} target="_blank" rel="noreferrer">
                      preview ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">APPROVED</p>
              <h2>Ready for outreach</h2>
            </div>
          </div>
          {operator.readyForOutreach.length === 0 ? (
            <p className="panel-empty">No demo version has been approved yet.</p>
          ) : (
            <ul className="review-queue">
              {operator.readyForOutreach.map((item) => (
                <li key={item.demoId}>
                  <Link to={`/prospects/${item.prospectId}`}>{item.businessName}</Link>
                  <span className="review-meta">
                    approved v{item.approvedVersionNumber} · {item.hostingStatus.replaceAll("_", " ")}
                    {item.suppressed ? " · SUPPRESSED" : ""}
                  </span>
                  <span className={`qa-chip ${item.readyForOutreach ? "qa-passed" : "qa-none"}`}>
                    {item.readyForOutreach ? "READY FOR OUTREACH" : "not ready"}
                  </span>
                  {item.hostedUrl ? (
                    <a href={item.hostedUrl} target="_blank" rel="noreferrer">
                      hosted demo ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="operator-note">Ready for outreach means "may be used later" — SaltBox still sends nothing.</p>
        </div>
      </section>

      <section className="dashboard-grid operator-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">OPERATOR RUNS</p>
              <h2>Recent runs</h2>
            </div>
            <Link className="button button-quiet" to="/runs">View all</Link>
          </div>
          {operator.recentRuns.length === 0 ? (
            <p className="panel-empty">No operator run has been started from the admin yet.</p>
          ) : (
            <ul className="run-list">
              {operator.recentRuns.slice(0, 5).map((run) => (
                <li key={run.runId}>
                  <Link to={`/runs/${run.runId}`}>{run.runKind.replaceAll("_", " ")}</Link>
                  <RunProgress run={run} compact />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">ISOLATED FAILURES</p>
              <h2>Target failures</h2>
            </div>
          </div>
          {operator.targetFailures.length === 0 ? (
            <p className="panel-empty">No target failed in a recent run.</p>
          ) : (
            <ul className="failure-list">
              {operator.targetFailures.map((target) => (
                <li key={target.targetId}>
                  <strong>{target.label}</strong>
                  <span className="failure-kind">
                    {target.failureKind ?? "unknown"}
                    {target.failureCode ? ` (${target.failureCode})` : ""}
                    {target.transient ? " · transient" : ""}
                  </span>
                  {target.prospectId ? (
                    <Link to={`/prospects/${target.prospectId}`}>open case file</Link>
                  ) : (
                    <span className="muted">not persisted as a prospect</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="operator-note">A target failure never fails the whole run — retry it from its case file.</p>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">LIVE LEDGER</p>
              <h2>Recent activity</h2>
            </div>
            <span className="persisted-label">Persisted records</span>
          </div>
          {overview.recentActivity.length === 0 ? (
            <p className="panel-empty">No persisted pipeline activity yet.</p>
          ) : (
            <ol className="activity-list">
              {overview.recentActivity.map((entry) => (
                <li key={entry.id}>
                  <time dateTime={entry.occurredAt}>{formatClockTime(entry.occurredAt)}</time>
                  <span className={`activity-icon activity-${entry.kind}`} aria-hidden="true" />
                  <div>
                    <Link to={`/prospects/${entry.prospectId}`}>{entry.businessName}</Link>
                    <strong>{entry.label}</strong>
                    {entry.detail ? <small>{entry.detail}</small> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="panel signal-panel">
          <p className="section-kicker">SCORING CONTRACT</p>
          <h2>Heuristic priority, not probability.</h2>
          <p>
            Need, Value, Activity, and Reachability are deterministic operator signals. An 88 is a priority
            score—not an 88% chance of conversion.
          </p>
          <div className="signal-legend">
            <span><i className="legend-dot legend-need" />Need</span>
            <span><i className="legend-dot legend-value" />Value</span>
            <span><i className="legend-dot legend-activity" />Activity</span>
            <span><i className="legend-dot legend-reach" />Reachability</span>
          </div>
        </aside>
      </section>

      <section className="prospects-section">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">CASE QUEUE</p>
            <h2>Prospects</h2>
          </div>
          <p>{overview.prospects.length} visible · newest score first</p>
        </div>

        <Form method="get" className="filter-bar" aria-label="Filter prospects">
          <label className="filter-search">
            <span>Business search</span>
            <input name="search" type="search" defaultValue={filters.search ?? ""} placeholder="Search by name…" />
          </label>
          <label>
            <span>Decision</span>
            <select name="status" defaultValue={filters.status ?? "all"}>
              <option value="all">All</option>
              <option value="qualified">Qualified</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            <span>Source</span>
            <input name="source" defaultValue={filters.source ?? ""} placeholder="OpenStreetMap" />
          </label>
          <label>
            <span>Category</span>
            <input name="category" defaultValue={filters.category ?? ""} placeholder="roofing" />
          </label>
          <label>
            <span>Intelligence</span>
            <select name="intelligence" defaultValue={filters.intelligence ?? ""}>
              <option value="">All</option>
              <option value="analyzed">Analyzed</option>
              <option value="none">Not analyzed</option>
            </select>
          </label>
          <label>
            <span>Minimum score</span>
            <input name="minScore" type="number" min="0" max="100" defaultValue={filters.minimumScore ?? ""} placeholder="0" />
          </label>
          <label>
            <span>Maximum score</span>
            <input name="maxScore" type="number" min="0" max="100" defaultValue={filters.maximumScore ?? ""} placeholder="100" />
          </label>
          <button className="button button-primary" type="submit">Apply filters</button>
          {hasFilters ? <Link className="button button-quiet" to="/">Clear</Link> : null}
        </Form>

        {overview.prospects.some((prospect) => prospect.sourceName?.toLowerCase() === "openstreetmap") ? (
          <p className="osm-attribution">
            Discovery data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL 1.0
          </p>
        ) : null}
        {overview.prospects.some((prospect) => prospect.sourceName?.toLowerCase() === "overture") ? (
          <p className="osm-attribution">
            Discovery data from <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation, overturemaps.org</a> · CDLA-P 2.0 / Apache 2.0
          </p>
        ) : null}

        {overview.summary.total === 0 ? (
          <EmptyState />
        ) : overview.prospects.length === 0 ? (
          <div className="empty-state compact-empty">
            <h2>No matching prospects</h2>
            <p>Adjust the current filters to return to the case queue.</p>
            <Link className="button button-quiet" to="/">Clear filters</Link>
          </div>
        ) : (
          <div className="table-shell">
            <table className="prospect-table">
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col" className="column-source">Source</th>
                  <th scope="col">Score</th>
                  <th scope="col">Need</th>
                  <th scope="col">Value</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Reach</th>
                  <th scope="col">Status</th>
                  <th scope="col">Intel</th>
                  <th scope="col">Analyzed</th>
                </tr>
              </thead>
              <tbody>
                {overview.prospects.map((prospect) => <ProspectRow key={prospect.prospectId} prospect={prospect} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className={`metric-card metric-${accent}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <i aria-hidden="true" />
    </article>
  );
}

function ProspectRow({ prospect }: { prospect: ProspectListItem }) {
  const navigate = useNavigate();
  const href = `/prospects/${prospect.prospectId}`;
  return (
    <tr
      className="clickable-row"
      onClick={(event) => {
        if (!(event.target instanceof HTMLAnchorElement)) void navigate(href);
      }}
    >
      <td>
        <Link className="business-link" to={href}>{prospect.businessName}</Link>
        <span className="business-meta">
          {prospect.domain ?? "No website"} · {formatLocation(prospect.city, prospect.state)}
        </span>
      </td>
      <td className="column-source">
        <span>{prospect.sourceName ?? "Unknown"}</span>
        <small>{prospect.category?.replaceAll("_", " ") ?? "Uncategorized"}</small>
      </td>
      <td className="score-cell"><strong>{prospect.overallScore ?? "—"}</strong><span>/100</span></td>
      <td>{prospect.needScore ?? "—"}</td>
      <td>{prospect.valueScore ?? "—"}</td>
      <td>{prospect.activityScore ?? "—"}</td>
      <td>{prospect.reachabilityScore ?? "—"}</td>
      <td><StatusBadge status={prospect.decision ?? prospect.lifecycleState} /></td>
      <td className="intel-cell">{prospect.intelligenceAnalyzed ? <span className="intel-flag">analyzed</span> : <span className="intel-none">—</span>}</td>
      <td className="date-cell">{formatDateTime(prospect.analyzedAt)}</td>
    </tr>
  );
}
