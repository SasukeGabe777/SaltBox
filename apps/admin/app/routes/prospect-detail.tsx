import { useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  DecisionReasonView,
  ObservationView,
  WebsiteAnalysisView,
} from "@saltbox/database/queries/admin";
import type { Route } from "./+types/prospect-detail";
import { RefreshControl } from "../components/RefreshControl";
import { ScoreBars } from "../components/ScoreBars";
import { StatusBadge } from "../components/StatusBadge";
import {
  loadProspectRequest,
  rethrowAsOperatorResponse,
} from "../data/admin-loaders.server";
import {
  formatDateTime,
  formatLocation,
  formatObservationValue,
  humanizeCode,
} from "../utils/format";

const NEED_REASON_CODES = new Set([
  "NO_WEBSITE",
  "WEBSITE_UNREACHABLE",
  "HTTPS_MISSING",
  "MOBILE_VIEWPORT_MISSING",
  "TITLE_MISSING",
  "META_DESCRIPTION_MISSING",
  "NO_CONTACT_FORM",
  "NO_CTA",
]);

export async function loader({ params }: Route.LoaderArgs) {
  try {
    return await loadProspectRequest(params.prospectId);
  } catch (error) {
    rethrowAsOperatorResponse(error);
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.detail.businessName ?? "Prospect";
  return [
    { title: `${name} · SaltBox Prospect Intelligence` },
    { name: "description", content: `Read-only qualification case file for ${name}.` },
  ];
}

export default function ProspectDetailPage({ loaderData }: Route.ComponentProps) {
  const { detail, loadedAt } = loaderData;
  const [selectedScoreId, setSelectedScoreId] = useState(detail.currentScoreId ?? detail.scoreHistory[0]?.id ?? "");

  useEffect(() => {
    if (!detail.scoreHistory.some((run) => run.id === selectedScoreId)) {
      setSelectedScoreId(detail.currentScoreId ?? detail.scoreHistory[0]?.id ?? "");
    }
  }, [detail.currentScoreId, detail.scoreHistory, selectedScoreId]);

  const selectedRun = detail.scoreHistory.find((run) => run.id === selectedScoreId) ?? detail.scoreHistory[0] ?? null;
  const selectedDecision = selectedRun?.decisions[0] ?? null;
  const displayStatus = selectedDecision?.result ?? detail.lifecycleState;
  const isHistorical = selectedRun ? !selectedRun.isLatest : false;

  return (
    <main id="main-content" className="app-shell detail-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Prospect Intelligence</Link>
        <span aria-hidden="true">/</span>
        <span>{detail.businessName}</span>
      </nav>

      <section className="detail-heading">
        <div>
          <p className="eyebrow">PROSPECT CASE FILE</p>
          <h1>{detail.businessName}</h1>
          <div className="detail-meta">
            <span>{detail.category?.replaceAll("_", " ") ?? "Uncategorized"}</span>
            <span>{formatLocation(detail.city, detail.state)}</span>
            <span>{detail.domain ?? "No website on record"}</span>
          </div>
        </div>
        <RefreshControl updatedAt={loadedAt} />
      </section>

      <section className={`score-hero ${displayStatus === "rejected" ? "score-hero-rejected" : ""}`}>
        <div className="score-primary">
          <StatusBadge status={displayStatus} />
          <strong>{selectedRun?.overallScore ?? "—"}</strong>
          <span>/ 100</span>
          <p>HEURISTIC PRIORITY SCORE</p>
        </div>
        <div className="score-breakdown">
          {selectedRun ? (
            <ScoreBars
              scores={{
                need: selectedRun.needScore,
                value: selectedRun.valueScore,
                activity: selectedRun.activityScore,
                reachability: selectedRun.reachabilityScore,
              }}
            />
          ) : (
            <p className="panel-empty">No score has been calculated for this prospect.</p>
          )}
        </div>
        <div className="score-contract">
          <span>SCORING</span>
          <strong>{selectedRun?.scoringVersion ?? "Not recorded"}</strong>
          <span>POLICY</span>
          <strong>{selectedDecision?.policyVersion ?? "Not recorded"}</strong>
          <small>Priority signal only · never conversion probability</small>
        </div>
      </section>

      {isHistorical ? (
        <div className="historical-banner" role="status">
          <strong>Historical run selected</strong>
          <span>This is preserved point-in-time evidence, not the latest qualification result.</span>
        </div>
      ) : null}

      <section className="case-grid">
        <article className="panel reason-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">DECISION EXPLANATION</p>
              <h2>Why SaltBox scored it this way</h2>
            </div>
          </div>
          {selectedDecision ? (
            <>
              {selectedDecision.summary ? <p className="decision-summary">{selectedDecision.summary}</p> : null}
              <ReasonGroup title="Needs improvement" reasons={selectedDecision.reasons.filter((reason) => NEED_REASON_CODES.has(reason.code))} />
              <ReasonGroup
                title="Positive and policy signals"
                reasons={selectedDecision.reasons.filter((reason) => !NEED_REASON_CODES.has(reason.code))}
              />
            </>
          ) : (
            <p className="panel-empty">No qualification decision is linked to this score.</p>
          )}
        </article>

        <article className="panel identity-panel">
          <p className="section-kicker">CURRENT RECORD</p>
          <h2>Identity & reachability</h2>
          <dl className="fact-list">
            <Fact label="Lifecycle" value={humanizeCode(detail.lifecycleState)} />
            <Fact label="Opened" value={formatDateTime(detail.openedAt)} />
            <Fact label="State changed" value={formatDateTime(detail.stateChangedAt)} />
            <Fact label="Website" value={detail.websiteUrl ?? "Not observed"} />
          </dl>
          <div className="contact-list">
            <h3>Contact methods</h3>
            {detail.contacts.length === 0 ? (
              <p className="muted">No contact method is recorded.</p>
            ) : (
              detail.contacts.map((contact) => (
                <div key={contact.id}>
                  <span>{contact.channel}</span>
                  <strong>{contact.displayValue}</strong>
                  <small>{contact.confidence} confidence · {contact.validationStatus}</small>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="panel website-panel">
        <div className="panel-heading split-heading">
          <div>
            <p className="section-kicker">DETERMINISTIC EVIDENCE</p>
            <h2>Website analysis</h2>
          </div>
          {selectedRun?.websiteAnalysis ? <span className="version-chip">{selectedRun.websiteAnalysis.analyzerVersion}</span> : null}
        </div>
        <WebsiteAnalysis analysis={selectedRun?.websiteAnalysis ?? null} fallbackUrl={detail.websiteUrl} />
      </section>

      <section className="panel history-panel">
        <div className="panel-heading split-heading">
          <div>
            <p className="section-kicker">APPEND-ONLY HISTORY</p>
            <h2>Qualification runs</h2>
          </div>
          {detail.scoreHistory.length > 0 ? (
            <label className="run-selector">
              <span>Inspect run</span>
              <select value={selectedScoreId} onChange={(event) => setSelectedScoreId(event.target.value)}>
                {detail.scoreHistory.map((run, index) => (
                  <option value={run.id} key={run.id}>
                    {index === 0 ? "Latest · " : "Historical · "}{run.overallScore} · {formatDateTime(run.calculatedAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {detail.scoreHistory.length === 0 ? (
          <p className="panel-empty">No qualification runs have been persisted.</p>
        ) : (
          <div className="table-shell">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Score</th>
                  <th scope="col">Scoring version</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Policy version</th>
                </tr>
              </thead>
              <tbody>
                {detail.scoreHistory.map((run, index) => {
                  const decision = run.decisions[0];
                  return (
                    <tr className={run.id === selectedScoreId ? "selected-run" : ""} key={run.id} onClick={() => setSelectedScoreId(run.id)}>
                      <td>{index === 0 ? <span className="latest-label">LATEST</span> : "Historical"}</td>
                      <td>{formatDateTime(run.calculatedAt)}</td>
                      <td><strong>{run.overallScore}</strong></td>
                      <td>{run.scoringVersion}</td>
                      <td><StatusBadge status={decision?.result ?? null} /></td>
                      <td>{decision?.policyVersion ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {selectedRun ? (
          <div className="run-metadata">
            <span>Feature schema <strong>{selectedRun.featureSchemaVersion}</strong></span>
            <span>Pipeline <strong>{selectedRun.pipelineVersion}</strong></span>
            <span>Feature cutoff <strong>{formatDateTime(selectedRun.featureAsOf)}</strong></span>
            <span>Scoring artifact <strong>{selectedRun.scoringArtifactVersion}</strong></span>
          </div>
        ) : null}
      </section>

      <section className="panel timeline-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">AUTHORITATIVE WORKFLOW</p>
            <h2>Lifecycle timeline</h2>
          </div>
        </div>
        {detail.timeline.length === 0 ? (
          <p className="panel-empty">No lifecycle transitions have been recorded.</p>
        ) : (
          <ol className="timeline">
            {detail.timeline.map((entry) => (
              <li key={entry.id}>
                <span className="timeline-node" aria-hidden="true" />
                <div>
                  <strong>{humanizeCode(entry.toState)}</strong>
                  <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                  <code>{entry.reasonCode}</code>
                  <details>
                    <summary>Transition metadata</summary>
                    <dl className="mini-facts">
                      <Fact label="From" value={entry.fromState ? humanizeCode(entry.fromState) : "Opened"} />
                      <Fact label="Actor" value={[entry.actorType, entry.actorRef].filter(Boolean).join(" · ")} />
                      <Fact label="Decision ref" value={entry.decisionId ?? "None"} />
                      <Fact label="Correlation" value={entry.correlationId ?? "None"} />
                    </dl>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel observations-panel">
        <div className="panel-heading split-heading">
          <div>
            <p className="section-kicker">POINT-IN-TIME FACTS</p>
            <h2>Observations</h2>
          </div>
          <span className="persisted-label">{detail.observations.length} records</span>
        </div>
        <p className="section-note">
          <strong>Observed at</strong> is when the fact was measured. <strong>Recorded at</strong> is when SaltBox durably accepted it.
        </p>
        {detail.observations.length === 0 ? (
          <p className="panel-empty">No observations are linked to this case.</p>
        ) : (
          <div className="table-shell">
            <table className="observation-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Value</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Observed at</th>
                  <th scope="col">Recorded at</th>
                  <th scope="col">Source</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {detail.observations.map((observation) => <ObservationRow key={observation.id} observation={observation} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel provenance-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">SOURCE / PROVENANCE</p>
            <h2>Where this case came from</h2>
          </div>
        </div>
        {detail.provenance.length === 0 ? (
          <p className="panel-empty">No source record is linked to this business.</p>
        ) : (
          <div className="provenance-grid">
            {detail.provenance.map((source) => (
              <article key={source.sourceRecordId}>
                <div><span>Source</span><strong>{source.sourceName}</strong></div>
                <div><span>Type</span><strong>{source.sourceType}</strong></div>
                <div><span>External ID</span><code>{source.externalId}</code></div>
                <div><span>Source-record ID</span><code>{source.sourceRecordId}</code></div>
                <div><span>Retrieved at</span><strong>{formatDateTime(source.retrievedAt)}</strong></div>
                <div><span>Recorded at</span><strong>{formatDateTime(source.recordedAt)}</strong></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ReasonGroup({ title, reasons }: { title: string; reasons: DecisionReasonView[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="reason-group">
      <h3>{title}</h3>
      <ul>
        {reasons.map((reason) => (
          <li key={reason.id}>
            <span className={reason.contribution === "opposes" ? "reason-mark reason-negative" : "reason-mark"} aria-hidden="true" />
            <div>
              <strong>{reason.explanation ?? humanizeCode(reason.code)}</strong>
              <code>{reason.code}</code>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebsiteAnalysis({ analysis, fallbackUrl }: { analysis: WebsiteAnalysisView | null; fallbackUrl: string | null }) {
  if (!analysis) {
    return (
      <div className="website-empty">
        <strong>{fallbackUrl ? "Analysis not yet recorded" : "No website provided"}</strong>
        <p>{fallbackUrl ? "The website identity exists, but no linked deterministic analysis is available for this run." : "Website absence is preserved as a business observation and contributes to Need."}</p>
      </div>
    );
  }
  return (
    <>
      {analysis.failure ? (
        <div className="analysis-failure">
          <span>WEBSITE OBSERVATION</span>
          <strong>{humanizeCode(analysis.failure.stage)}</strong>
          <p>{analysis.failure.message ?? analysis.failure.code ?? "The deterministic analyzer could not retrieve a usable website."}</p>
        </div>
      ) : null}
      <div className="website-facts">
        <Fact label="URL" value={analysis.finalUrl ?? analysis.requestedUrl ?? fallbackUrl ?? "Not recorded"} />
        <Fact label="Reachable" value={yesNo(analysis.reachable)} tone={analysis.reachable === false ? "bad" : "good"} />
        <Fact label="HTTP" value={analysis.httpStatus?.toString() ?? "Not recorded"} />
        <Fact label="HTTPS" value={yesNo(analysis.https)} tone={analysis.https === false ? "bad" : "good"} />
        <Fact label="Latency" value={analysis.latencyMs === null ? "Not recorded" : `${analysis.latencyMs} ms`} />
        <Fact label="HTML retrieved" value={yesNo(analysis.htmlRetrieved)} />
        <Fact label="Redirect" value={analysis.redirectChain.length ? analysis.redirectChain.join(" → ") : "None"} />
        <Fact label="Content type" value={analysis.contentType ?? "Not recorded"} />
      </div>
      {analysis.signals ? (
        <div className="website-signals">
          <Signal label="Title" value={analysis.signals.titlePresent} />
          <Signal label="Meta description" value={analysis.signals.metaDescriptionPresent} />
          <Signal label="Mobile viewport" value={analysis.signals.viewportPresent} />
          <Signal label="Contact form" value={analysis.signals.contactFormPresent} />
          <Signal label="Clear CTA" value={analysis.signals.ctaPresent} />
          <Signal label="Email on site" value={analysis.signals.emailPresent} />
          <Signal label="Phone on site" value={analysis.signals.phonePresent} />
          <Signal label="Copyright signal" value={analysis.signals.copyrightYear !== null} detail={analysis.signals.copyrightYear?.toString()} />
        </div>
      ) : null}
    </>
  );
}

function ObservationRow({ observation }: { observation: ObservationView }) {
  const structured = observation.valueType === "json" && typeof observation.value === "object";
  return (
    <tr>
      <td><strong>{humanizeCode(observation.field)}</strong><small>{observation.subjectKind}</small></td>
      <td>
        {formatObservationValue(observation.value, observation.unit)}
        {structured ? (
          <details className="raw-details">
            <summary>Raw details</summary>
            <pre>{JSON.stringify(observation.value, null, 2)}</pre>
          </details>
        ) : null}
      </td>
      <td><span className="confidence-chip">{observation.confidence}</span></td>
      <td>{formatDateTime(observation.observedAt)}</td>
      <td>{formatDateTime(observation.recordedAt)}</td>
      <td>{observation.sourceName}</td>
      <td>{observation.evidenceSummary ?? observation.evidenceRef ?? "—"}</td>
    </tr>
  );
}

function Signal({ label, value, detail }: { label: string; value: boolean | null; detail?: string }) {
  return (
    <div className={value === false ? "signal signal-off" : value === true ? "signal signal-on" : "signal"}>
      <span>{label}</span>
      <strong>{detail ?? yesNo(value)}</strong>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={tone ? `fact fact-${tone}` : "fact"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function yesNo(value: boolean | null): string {
  return value === null ? "Not recorded" : value ? "YES" : "NO";
}
