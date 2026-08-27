import { useState } from "react";
import type { WebsiteIntelligenceView } from "@saltbox/database/queries/admin";
import { formatDateTime } from "../utils/format";

/**
 * Phase 6 WEBSITE INTELLIGENCE case-file section. Renders the selected
 * analysis run's findings exactly as persisted — selecting an older run shows
 * only that run's evidence (append-only history, no cross-run mixing).
 * Website-intelligence metrics are informational condition measurements and
 * are intentionally separate from the qualification score.
 */

interface Findings {
  stages?: Record<string, { status?: string; error?: string }>;
  pages?: Array<{ url?: string; role?: string; httpStatus?: number | null; reachable?: boolean; title?: string | null; wordCount?: number | null }>;
  lab?: {
    performance?: number | null;
    accessibility?: number | null;
    seo?: number | null;
    bestPractices?: number | null;
    firstContentfulPaintMs?: number | null;
    largestContentfulPaintMs?: number | null;
    totalBlockingTimeMs?: number | null;
    cumulativeLayoutShift?: number | null;
    speedIndexMs?: number | null;
    accessibilityFailures?: Array<{ id?: string; title?: string }>;
  } | null;
  mobile?: { viewportMetaPresent?: boolean; horizontalOverflow?: boolean | null; navigationPresent?: boolean | null } | null;
  technical?: {
    https?: boolean;
    httpStatus?: number | null;
    consoleErrors?: number;
    consoleErrorExamples?: string[];
    failedRequests?: number;
    mixedContentRequests?: number;
    robotsTxtPresent?: boolean | null;
    sitemapPresent?: boolean | null;
    faviconPresent?: boolean;
    requestCount?: number | null;
    transferredBytes?: number | null;
  } | null;
  seo?: {
    titlePresent?: boolean;
    titleLength?: number;
    metaDescriptionPresent?: boolean;
    canonicalPresent?: boolean;
    h1Count?: number;
    headingOrderValid?: boolean;
    langPresent?: boolean;
    openGraphPresent?: boolean;
    structuredDataPresent?: boolean;
    schemaTypes?: string[];
    indexable?: boolean;
  } | null;
  conversion?: {
    phoneLinkPresent?: boolean;
    emailLinkPresent?: boolean;
    contactPagePresent?: boolean;
    contactFormPresent?: boolean;
    quoteCtaPresent?: boolean;
    bookingCtaPresent?: boolean;
    prominentCtaPresent?: boolean;
    visibleAddressPresent?: boolean;
  } | null;
  links?: { checked?: number; working?: number; redirecting?: number; broken?: number; timedOut?: number; blocked?: number; brokenExamples?: string[] } | null;
  assets?: { failedImages?: number; failedStylesheets?: number; failedScripts?: number; otherFailed?: number; examples?: string[] } | null;
  platform?: { platform?: string | null; confidence?: string; evidence?: string[] } | null;
  social?: Record<string, string | string[] | null> | null;
  artifacts?: { ref?: string; desktopScreenshot?: string | null; mobileScreenshot?: string | null; lighthouseReport?: string | null };
  fatal?: { stage?: string; message?: string; failureKind?: string; code?: string; transient?: boolean };
  finalHomepageUrl?: string | null;
  durationMs?: number;
}

export function WebsiteIntelligencePanel({ runs }: { runs: WebsiteIntelligenceView[] }) {
  const [selectedId, setSelectedId] = useState(runs[0]?.analysisId ?? "");
  if (runs.length === 0) {
    return (
      <section className="panel intelligence-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">WEBSITE INTELLIGENCE</p>
            <h2>No intelligence run yet</h2>
          </div>
        </div>
        <p className="panel-empty">
          Run <code>pnpm website:intelligence --prospect &lt;id&gt;</code> to collect a deep website condition report.
        </p>
      </section>
    );
  }

  const selected = runs.find((run) => run.analysisId === selectedId) ?? runs[0]!;
  const findings = selected.structuredFindings as Findings;
  const isLatest = selected.analysisId === runs[0]!.analysisId;
  const artifactRef = findings.artifacts?.ref;

  return (
    <section className="panel intelligence-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">WEBSITE INTELLIGENCE</p>
          <h2>Deep condition report</h2>
          <p className="intelligence-meta">
            {findings.finalHomepageUrl ?? "—"} · {selected.analyzerVersion} · {formatDateTime(selected.calculatedAt)}
            {typeof findings.durationMs === "number" ? ` · ${(findings.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
        </div>
        {runs.length > 1 ? (
          <label className="intelligence-run-picker">
            <span>Inspect run</span>
            <select value={selected.analysisId} onChange={(event) => setSelectedId(event.target.value)}>
              {runs.map((run, index) => (
                <option key={run.analysisId} value={run.analysisId}>
                  {index === 0 ? "Latest" : "Historical"} · {formatDateTime(run.calculatedAt)} · {run.analyzerVersion}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {!isLatest ? <p className="historical-banner">HISTORICAL WEBSITE ANALYSIS — showing only evidence from this run.</p> : null}
      {findings.fatal ? (
        <p className="intelligence-fatal">
          Analysis failed (
          {[findings.fatal.stage, findings.fatal.failureKind, findings.fatal.code, findings.fatal.transient ? "transient" : null]
            .filter(Boolean)
            .join(" · ")}
          ): {findings.fatal.message}
        </p>
      ) : null}

      <p className="intelligence-disclaimer">
        Lab measurements (mobile emulation), not real-user data. Informational only — not part of the qualification score.
      </p>

      {findings.lab ? (
        <div className="lab-score-grid">
          <LabScore label="Performance" value={findings.lab.performance} />
          <LabScore label="Accessibility" value={findings.lab.accessibility} />
          <LabScore label="SEO" value={findings.lab.seo} />
          <LabScore label="Best practices" value={findings.lab.bestPractices} />
        </div>
      ) : null}

      <div className="intelligence-grid">
        {findings.lab ? (
          <article>
            <h3>Performance (lab)</h3>
            <Fact label="LCP" value={ms(findings.lab.largestContentfulPaintMs)} />
            <Fact label="FCP" value={ms(findings.lab.firstContentfulPaintMs)} />
            <Fact label="TBT" value={ms(findings.lab.totalBlockingTimeMs)} />
            <Fact label="CLS" value={findings.lab.cumulativeLayoutShift ?? null} />
            <Fact label="Speed Index" value={ms(findings.lab.speedIndexMs)} />
          </article>
        ) : null}
        {findings.mobile ? (
          <article>
            <h3>Mobile</h3>
            <Flag label="Viewport meta" good={findings.mobile.viewportMetaPresent === true} />
            <Flag label="No horizontal overflow" good={findings.mobile.horizontalOverflow === false} unknown={findings.mobile.horizontalOverflow === null || findings.mobile.horizontalOverflow === undefined} />
            <Flag label="Navigation present" good={findings.mobile.navigationPresent === true} />
          </article>
        ) : null}
        {findings.seo ? (
          <article>
            <h3>SEO structure</h3>
            <Flag label="Title" good={findings.seo.titlePresent === true} />
            <Flag label="Meta description" good={findings.seo.metaDescriptionPresent === true} />
            <Flag label="Canonical" good={findings.seo.canonicalPresent === true} />
            <Fact label="H1 count" value={findings.seo.h1Count ?? null} />
            <Flag label="Indexable" good={findings.seo.indexable === true} />
            <Flag label="Structured data" good={findings.seo.structuredDataPresent === true} />
            {findings.seo.schemaTypes && findings.seo.schemaTypes.length > 0 ? (
              <Fact label="Schema types" value={findings.seo.schemaTypes.join(", ")} />
            ) : null}
          </article>
        ) : null}
        {findings.technical ? (
          <article>
            <h3>Technical health</h3>
            <Flag label="HTTPS" good={findings.technical.https === true} />
            <Fact label="Console errors" value={findings.technical.consoleErrors ?? null} warnWhenPositive />
            <Fact label="Failed requests" value={findings.technical.failedRequests ?? null} warnWhenPositive />
            <Fact label="Mixed content" value={findings.technical.mixedContentRequests ?? null} warnWhenPositive />
            <Flag label="robots.txt" good={findings.technical.robotsTxtPresent === true} unknown={findings.technical.robotsTxtPresent == null} />
            <Flag label="Sitemap" good={findings.technical.sitemapPresent === true} unknown={findings.technical.sitemapPresent == null} />
          </article>
        ) : null}
        {findings.conversion ? (
          <article>
            <h3>Conversion paths</h3>
            <Flag label="Phone link" good={findings.conversion.phoneLinkPresent === true} />
            <Flag label="Email link" good={findings.conversion.emailLinkPresent === true} />
            <Flag label="Contact page" good={findings.conversion.contactPagePresent === true} />
            <Flag label="Contact form" good={findings.conversion.contactFormPresent === true} />
            <Flag label="Quote CTA" good={findings.conversion.quoteCtaPresent === true} />
            <Flag label="Booking CTA" good={findings.conversion.bookingCtaPresent === true} />
            <Flag label="Visible address" good={findings.conversion.visibleAddressPresent === true} />
          </article>
        ) : null}
        {findings.links ? (
          <article>
            <h3>Link health</h3>
            <Fact label="Checked" value={findings.links.checked ?? null} />
            <Fact label="Working" value={findings.links.working ?? null} />
            <Fact label="Redirecting" value={findings.links.redirecting ?? null} />
            <Fact label="Broken" value={findings.links.broken ?? null} warnWhenPositive />
            <Fact label="Timed out" value={findings.links.timedOut ?? null} warnWhenPositive />
          </article>
        ) : null}
        {findings.assets ? (
          <article>
            <h3>Asset health</h3>
            <Fact label="Failed images" value={findings.assets.failedImages ?? null} warnWhenPositive />
            <Fact label="Failed stylesheets" value={findings.assets.failedStylesheets ?? null} warnWhenPositive />
            <Fact label="Failed scripts" value={findings.assets.failedScripts ?? null} warnWhenPositive />
          </article>
        ) : null}
        {findings.platform ? (
          <article>
            <h3>Platform</h3>
            <Fact label="Detected" value={findings.platform.platform ?? "unknown"} />
            <Fact label="Confidence" value={findings.platform.confidence ?? "unknown"} />
            {(findings.platform.evidence ?? []).slice(0, 2).map((evidence, index) => (
              <small key={`${index}-${evidence}`} className="intelligence-evidence">{evidence}</small>
            ))}
          </article>
        ) : null}
      </div>

      {artifactRef && (findings.artifacts?.desktopScreenshot || findings.artifacts?.mobileScreenshot) ? (
        <div className="screenshot-row">
          {findings.artifacts?.desktopScreenshot ? (
            <a href={`/intelligence-artifacts/${artifactRef}/desktop.png`} target="_blank" rel="noreferrer">
              <img src={`/intelligence-artifacts/${artifactRef}/desktop.png`} alt="Homepage desktop screenshot" loading="lazy" />
              <span>Desktop</span>
            </a>
          ) : null}
          {findings.artifacts?.mobileScreenshot ? (
            <a href={`/intelligence-artifacts/${artifactRef}/mobile.png`} target="_blank" rel="noreferrer">
              <img src={`/intelligence-artifacts/${artifactRef}/mobile.png`} alt="Homepage mobile screenshot" loading="lazy" />
              <span>Mobile</span>
            </a>
          ) : null}
        </div>
      ) : null}

      <details className="intelligence-details">
        <summary>Pages analyzed, stages, and audit findings</summary>
        <div className="intelligence-details-body">
          <h4>Pages analyzed ({(findings.pages ?? []).length})</h4>
          <ul>
            {(findings.pages ?? []).map((page, index) => (
              <li key={`${index}-${page.url}`}>
                <code>{page.role}</code> {page.url} — {page.reachable ? `HTTP ${page.httpStatus}` : "unreachable"}
                {typeof page.wordCount === "number" ? ` · ${page.wordCount} words` : ""}
              </li>
            ))}
          </ul>
          <h4>Stage results</h4>
          <ul>
            {Object.entries(findings.stages ?? {}).map(([stage, outcome]) => (
              <li key={stage}>
                <code>{stage}</code> {outcome.status}
                {outcome.error ? ` — ${outcome.error}` : ""}
              </li>
            ))}
          </ul>
          {findings.lab?.accessibilityFailures && findings.lab.accessibilityFailures.length > 0 ? (
            <>
              <h4>Accessibility audit findings (automated checks, not a WCAG compliance audit)</h4>
              <ul>
                {findings.lab.accessibilityFailures.map((failure, index) => (
                  <li key={`${index}-${failure.id}`}>{failure.title}</li>
                ))}
              </ul>
            </>
          ) : null}
          {findings.technical?.consoleErrorExamples && findings.technical.consoleErrorExamples.length > 0 ? (
            <>
              <h4>Console error examples</h4>
              <ul>
                {findings.technical.consoleErrorExamples.map((example, index) => (
                  <li key={`${index}-${example.slice(0, 40)}`}><code>{example}</code></li>
                ))}
              </ul>
            </>
          ) : null}
          {findings.links?.brokenExamples && findings.links.brokenExamples.length > 0 ? (
            <>
              <h4>Broken links</h4>
              <ul>
                {findings.links.brokenExamples.map((link, index) => (
                  <li key={`${index}-${link.slice(0, 60)}`}><code>{link}</code></li>
                ))}
              </ul>
            </>
          ) : null}
          {artifactRef && findings.artifacts?.lighthouseReport ? (
            <p>
              <a href={`/intelligence-artifacts/${artifactRef}/lighthouse.json`} target="_blank" rel="noreferrer">
                Raw Lighthouse report ↗
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function LabScore({ label, value }: { label: string; value: number | null | undefined }) {
  const numeric = typeof value === "number" ? value : null;
  const band = numeric === null ? "unknown" : numeric >= 90 ? "good" : numeric >= 50 ? "mid" : "poor";
  return (
    <div className={`lab-score lab-score-${band}`}>
      <strong>{numeric ?? "—"}</strong>
      <span>{label}</span>
    </div>
  );
}

function Fact({ label, value, warnWhenPositive }: { label: string; value: number | string | null; warnWhenPositive?: boolean }) {
  const warn = warnWhenPositive === true && typeof value === "number" && value > 0;
  return (
    <div className="intelligence-fact">
      <span>{label}</span>
      <strong className={warn ? "fact-warn" : undefined}>{value ?? "—"}</strong>
    </div>
  );
}

function Flag({ label, good, unknown }: { label: string; good: boolean; unknown?: boolean }) {
  return (
    <div className="intelligence-fact">
      <span>{label}</span>
      <strong className={unknown ? "fact-unknown" : good ? "fact-good" : "fact-warn"}>
        {unknown ? "—" : good ? "YES" : "NO"}
      </strong>
    </div>
  );
}

function ms(value: number | null | undefined): string | null {
  return typeof value === "number" ? `${Math.round(value)} ms` : null;
}
