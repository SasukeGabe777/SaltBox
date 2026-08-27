import { useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  DecisionReasonView,
  ObservationView,
  ProspectDemoView,
  WebsiteAnalysisView,
} from "@saltbox/database/queries/admin";
import type { Route } from "./+types/prospect-detail";
import { RefreshControl } from "../components/RefreshControl";
import { WebsiteIntelligencePanel } from "../components/WebsiteIntelligencePanel";
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
  "WEBSITE_MISSING",
  "DNS_NOT_FOUND",
  "WEBSITE_DEFINITIVELY_UNREACHABLE",
  "INVALID_WEBSITE_TARGET",
  "TLS_FAILURE",
  "HTTPS_PROBLEM",
  "MOBILE_OVERFLOW",
  "LIGHTHOUSE_PERFORMANCE_POOR",
  "LIGHTHOUSE_PERFORMANCE_WEAK",
  "LIGHTHOUSE_PERFORMANCE_FAIR",
  "LCP_POOR",
  "LCP_NEEDS_IMPROVEMENT",
  "TBT_POOR",
  "TBT_NEEDS_IMPROVEMENT",
  "CLS_POOR",
  "CLS_NEEDS_IMPROVEMENT",
  "CTA_MISSING",
  "CONTACT_FORM_MISSING",
  "TECHNICAL_ERRORS_HIGH",
  "TECHNICAL_ERRORS_PRESENT",
  "BROKEN_INTERNAL_LINKS",
  "COPYRIGHT_STALE",
  "COPYRIGHT_AGING",
  "SHALLOW_SITE_STRUCTURE",
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
  const { detail, loadedAt, demosBaseUrl } = loaderData;
  const [selectedScoreId, setSelectedScoreId] = useState(detail.currentScoreId ?? detail.scoreHistory[0]?.id ?? "");

  useEffect(() => {
    if (!detail.scoreHistory.some((run) => run.id === selectedScoreId)) {
      setSelectedScoreId(detail.currentScoreId ?? detail.scoreHistory[0]?.id ?? "");
    }
  }, [detail.currentScoreId, detail.scoreHistory, selectedScoreId]);

  const selectedRun = detail.scoreHistory.find((run) => run.id === selectedScoreId) ?? detail.scoreHistory[0] ?? null;
  const selectedDecision = selectedRun?.decisions[0] ?? null;
  const latestV1Run = detail.scoreHistory.find((run) => run.scoringVersion === "qualification-v1") ?? null;
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
          {selectedRun ? <span className="version-chip">{selectedRun.scoringVersion === "qualification-v2" ? "V2" : "V1"}</span> : null}
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
          {selectedRun?.scoringVersion === "qualification-v2" && latestV1Run ? (
            <small>Previous v1: {latestV1Run.overallScore}/100 · preserved</small>
          ) : null}
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
              {selectedRun && selectedRun.components.length > 0 ? (
                <details className="raw-details">
                  <summary>Feature contributions and evidence lineage</summary>
                  <ul>
                    {selectedRun.components.map((component) => (
                      <li key={component.id}>
                        <strong>{humanizeCode(component.reasonCode)}</strong>{" "}
                        <code>{component.dimension} / {component.componentKey} / {component.result ?? 0}</code>
                        {component.contributingFeatures ? <pre>{JSON.stringify(component.contributingFeatures, null, 2)}</pre> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
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

      <WebsiteIntelligencePanel runs={detail.websiteIntelligence} />

      <DemoPanel demo={detail.demo} demosBaseUrl={demosBaseUrl} />

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
                    {index === 0 ? "Latest · " : "Historical · "}{run.scoringVersion} · {run.overallScore} · {formatDateTime(run.calculatedAt)}
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
                <div><span>Source</span><strong>{sourceDisplayName(source.sourceName)}</strong></div>
                <div><span>Type</span><strong>{source.sourceType}</strong></div>
                <div><span>External ID</span><code>{source.externalId}</code></div>
                <div><span>Source-record ID</span><code>{source.sourceRecordId}</code></div>
                <div><span>Retrieved at</span><strong>{formatDateTime(source.retrievedAt)}</strong></div>
                <div><span>Recorded at</span><strong>{formatDateTime(source.recordedAt)}</strong></div>
                {source.sourceLocator ? (
                  <div><span>Source locator</span><a href={source.sourceLocator} target="_blank" rel="noreferrer">Open source record ↗</a></div>
                ) : null}
                {source.sourceName === "openstreetmap" ? (
                  <div className="source-attribution"><span>Attribution</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL 1.0</a></div>
                ) : null}
                {source.sourceName === "overture" ? (
                  <div className="source-attribution"><span>Attribution</span><a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">Overture Maps Foundation, overturemaps.org · CDLA-P 2.0 / Apache 2.0</a></div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DemoPanel({ demo, demosBaseUrl }: { demo: ProspectDemoView | null; demosBaseUrl: string }) {
  return (
    <section className="panel demo-panel">
      <div className="panel-heading split-heading">
        <div>
          <p className="section-kicker">PHASE 8 · GENERATED DEMO</p>
          <h2>Demo website</h2>
        </div>
        {demo?.currentVersion ? (
          <span className="version-chip">
            {demo.currentVersion.templateName}@{demo.currentVersion.templateVersion}
          </span>
        ) : null}
      </div>
      {!demo ? (
        <p className="panel-empty">
          No demo has been generated for this prospect. Qualified-v2 prospects are eligible via{" "}
          <code>pnpm demo:generate</code>.
        </p>
      ) : (
        <>
          <div className="demo-headline-row">
            <StatusBadge status={demo.status} />
            {demo.locatorToken && demo.currentVersion ? (
              <a
                className="view-demo-link"
                href={`${demosBaseUrl}/d/${demo.locatorToken}`}
                target="_blank"
                rel="noreferrer"
              >
                VIEW DEMO ↗
              </a>
            ) : (
              <span className="muted">No viewable version yet.</span>
            )}
            <small className="muted">Served by the local demo renderer ({demosBaseUrl}); start it with pnpm demos:dev.</small>
          </div>
          {demo.currentVersion ? (
            <dl className="fact-list demo-facts">
              <Fact label="Demo version" value={`v${demo.currentVersion.versionNumber}`} />
              <Fact label="Generated" value={formatDateTime(demo.currentVersion.createdAt)} />
              <Fact label="Content schema" value={demo.currentVersion.contentInputVersion ?? "Not recorded"} />
              <Fact label="Copy generator" value={demo.currentVersion.generatedContentVersion ?? "Not recorded"} />
              <Fact
                label="Source qualification"
                value={demo.sourceScoringVersion ? `${demo.sourceScoringVersion} · score ${demo.sourceScore ?? "—"}` : "Not recorded"}
              />
              <Fact label="Versions persisted" value={String(demo.versions.length)} />
            </dl>
          ) : null}
          {demo.planSummary ? <DemoPlanSummary summary={demo.planSummary} /> : null}
        </>
      )}
    </section>
  );
}

function DemoBrandSummary({ brand }: { brand: Record<string, unknown> }) {
  const logo = asStringRecord(brand.logo);
  const palette = asStringRecord(brand.palette);
  const swatchSource = asStringRecord(brand.paletteColors) ?? {};
  const paletteColors = ["primary", "secondary", "accent"]
    .map((key) => swatchSource[key])
    .filter((color): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color));
  const services = Array.isArray(brand.extractedServices)
    ? (brand.extractedServices as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const imageryCount = typeof brand.imageryCount === "number" ? brand.imageryCount : 0;
  return (
    <div className="demo-brand-summary">
      <h3>Brand intelligence</h3>
      <dl className="fact-list demo-facts">
        <Fact
          label="Logo"
          value={logo ? `${String(logo.status ?? "fallback")} · ${String(logo.confidence ?? "none")} confidence` : "fallback"}
        />
        <Fact
          label="Palette"
          value={palette ? `${String(palette.status ?? "fallback")} · ${String(palette.confidence ?? "none")} confidence` : "fallback"}
        />
        <Fact label="Usable imagery" value={`${imageryCount} photo${imageryCount === 1 ? "" : "s"}`} />
        <Fact label="Services from their site" value={services.length > 0 ? services.join(", ") : "None extracted"} />
      </dl>
      {paletteColors.length > 0 ? (
        <div className="demo-swatches" aria-label="Extracted brand colors">
          {paletteColors.map((color) => (
            <span key={color} className="demo-swatch" style={{ backgroundColor: color }} title={color} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function asStringRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function DemoPlanSummary({ summary }: { summary: Record<string, unknown> }) {
  const deficiencies = Array.isArray(summary.deficiencies)
    ? (summary.deficiencies as Array<{ code?: unknown; addressedBy?: unknown }>)
    : [];
  const fallbacks = Array.isArray(summary.fallbacks)
    ? (summary.fallbacks as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const override =
    typeof summary.override === "object" && summary.override !== null
      ? (summary.override as { note?: unknown })
      : null;
  const brand = asStringRecord(summary.brand);
  const template = asStringRecord(summary.template);
  const selectionReasons = Array.isArray(template?.selectionReasons)
    ? (template.selectionReasons as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  return (
    <div className="demo-plan-summary">
      {brand ? <DemoBrandSummary brand={brand} /> : null}
      {selectionReasons.length > 0 ? (
        <div className="demo-composition-reasons">
          <h3>Why this composition</h3>
          <ul>
            {selectionReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <h3>Demo-plan decisions</h3>
      {override ? (
        <p className="demo-override-note">
          Generated under an explicit operator override — this does not change qualification history.
          {typeof override.note === "string" ? ` ${override.note}` : ""}
        </p>
      ) : null}
      {deficiencies.length > 0 ? (
        <ul className="demo-deficiency-list">
          {deficiencies.map((deficiency, index) => (
            <li key={index}>
              <code>{typeof deficiency.code === "string" ? deficiency.code : "UNKNOWN"}</code>
              <span>{typeof deficiency.addressedBy === "string" ? deficiency.addressedBy : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No website deficiencies were recorded in the demo plan.</p>
      )}
      {fallbacks.length > 0 ? (
        <details className="raw-details">
          <summary>Fallback decisions ({fallbacks.length})</summary>
          <ul>
            {fallbacks.map((fallback, index) => (
              <li key={index}>{fallback}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function sourceDisplayName(sourceName: string): string {
  if (sourceName === "openstreetmap") return "OpenStreetMap";
  if (sourceName === "overture") return "Overture Maps";
  return sourceName;
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
