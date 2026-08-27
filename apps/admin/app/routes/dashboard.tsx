import { Form, Link, useNavigate } from "react-router";
import type { ProspectListItem } from "@saltbox/database/queries/admin";
import type { Route } from "./+types/dashboard";
import { EmptyState } from "../components/EmptyState";
import { RefreshControl } from "../components/RefreshControl";
import { StatusBadge } from "../components/StatusBadge";
import {
  loadDashboardRequest,
  rethrowAsOperatorResponse,
} from "../data/admin-loaders.server";
import { formatClockTime, formatDateTime, formatLocation } from "../utils/format";

export function meta() {
  return [
    { title: "Prospect Intelligence · SaltBox" },
    { name: "description", content: "Local read-only prospect intelligence for SaltBox operators." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    return await loadDashboardRequest(request);
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { overview, filters } = loaderData;
  const hasFilters = Boolean(
    filters.search ||
      filters.source ||
      filters.category ||
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
        <Metric label="Rejected" value={overview.summary.rejected} accent="negative" />
        <Metric label="Analyzed" value={overview.summary.analyzed} accent="info" />
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
      <td className="date-cell">{formatDateTime(prospect.analyzedAt)}</td>
    </tr>
  );
}
