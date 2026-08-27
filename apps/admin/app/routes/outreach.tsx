import { Form, Link } from "react-router";
import type { Route } from "./+types/outreach";
import { OperatorMessage } from "../components/OperatorMessage";
import { RefreshControl } from "../components/RefreshControl";
import { handleOperatorAction, loadOutreachQueue } from "../data/operator.server";
import { rethrowAsOperatorResponse } from "../data/admin-loaders.server";
import { formatDateTime } from "../utils/format";

export function meta() {
  return [
    { title: "Outreach Queue · SaltBox" },
    { name: "description", content: "Local SEND-READY outreach preparation queue. No sending capability exists." },
  ];
}

export async function loader() {
  try {
    return { queue: await loadOutreachQueue(50), loadedAt: new Date().toISOString() };
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

export default function OutreachQueuePage({ loaderData, actionData }: Route.ComponentProps) {
  const counts = new Map<string, number>();
  for (const item of loaderData.queue) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return (
    <main id="main-content" className="app-shell outreach-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Prospect Intelligence</Link>
        <span aria-hidden="true">/</span>
        <span>Outreach</span>
      </nav>

      <section className="detail-heading">
        <div>
          <p className="eyebrow">OUTREACH FOUNDATIONS</p>
          <h1>SEND-READY queue</h1>
          <p className="page-intro">Prepare exact deterministic email intents. This application has no send endpoint or provider adapter.</p>
        </div>
        <RefreshControl updatedAt={loaderData.loadedAt} />
      </section>

      <section className="metric-grid" aria-label="Outreach queue totals">
        <Metric label="Ready" value={counts.get("READY_FOR_OUTREACH") ?? 0} />
        <Metric label="Send-ready" value={counts.get("SEND_READY") ?? 0} />
        <Metric label="Needs contact" value={counts.get("NEEDS_CONTACT") ?? 0} />
        <Metric label="Suppressed" value={counts.get("SUPPRESSED") ?? 0} />
      </section>

      <section className="panel outreach-control-panel">
        <div className="panel-heading split-heading">
          <div>
            <p className="section-kicker">BOUNDED PREPARATION</p>
            <h2>Prepare eligible prospects</h2>
          </div>
          <span className="no-send-chip">NO SEND CAPABILITY</span>
        </div>
        <OperatorMessage result={actionData ?? null} />
        <Form method="post" className="operator-form">
          <input type="hidden" name="intent" value="prepare-outreach-batch" />
          <label>
            <span>Maximum drafts</span>
            <input name="limit" type="number" min={1} max={10} defaultValue={3} />
          </label>
          <button className="button button-primary" type="submit">PREPARE OUTREACH</button>
        </Form>
        <p className="operator-note">Hard-capped at 10. Preparation rechecks current qualification, approval, hosting, contact, suppression, recent outreach, and idempotency. Nothing is scheduled or sent.</p>
      </section>

      <section className="panel outreach-queue-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">CONTROLLED QUEUE</p>
            <h2>Prospect outreach state</h2>
          </div>
        </div>
        {loaderData.queue.length === 0 ? (
          <p className="panel-empty">No qualified prospects are available.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Business</th><th>Fit</th><th>Status</th><th>Contact</th><th>Demo</th><th>Prepared</th><th>Blockers</th></tr></thead>
              <tbody>
                {loaderData.queue.map((item) => (
                  <tr key={item.prospectId}>
                    <td><Link to={`/prospects/${item.prospectId}`}>{item.businessName}</Link></td>
                    <td>{item.fitScore ?? "—"}</td>
                    <td><span className={`outreach-status status-${item.status.toLowerCase().replaceAll("_", "-")}`}>{item.status.replaceAll("_", " ")}</span></td>
                    <td>{item.contact ?? "Needs contact"}</td>
                    <td>{item.demoVersionNumber ? `Approved v${item.demoVersionNumber}` : "Not ready"}</td>
                    <td>{item.preparedAt ? formatDateTime(item.preparedAt) : "—"}</td>
                    <td>{item.reasonCodes.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong></article>;
}
