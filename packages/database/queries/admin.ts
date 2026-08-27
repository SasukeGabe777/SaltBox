/**
 * Read-only operator/admin query models for Phase 5A.
 *
 * These queries deliberately return framework-neutral presentation shapes.
 * They never mutate authoritative state, and generated database row types do
 * not escape this module.
 */

import { sql } from "kysely";
import type { Database } from "../client/kysely.ts";
import type { JsonValue, ProspectLifecycleState } from "../generated/db.ts";

export type QualificationResult = "qualified" | "rejected";
export type ProspectStatusFilter = "all" | QualificationResult;

export interface ProspectListFilters {
  status?: ProspectStatusFilter;
  search?: string;
  source?: string;
  category?: string;
  /** Phase 6 website-intelligence presence filter. */
  intelligence?: "analyzed" | "none";
  minimumScore?: number;
  maximumScore?: number;
}

export interface DashboardSummary {
  total: number;
  qualified: number;
  rejected: number;
  analyzed: number;
}

export interface ProspectListItem {
  prospectId: string;
  businessId: string;
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  websiteUrl: string | null;
  domain: string | null;
  sourceName: string | null;
  sourceType: string | null;
  lifecycleState: ProspectLifecycleState;
  overallScore: number | null;
  needScore: number | null;
  valueScore: number | null;
  activityScore: number | null;
  reachabilityScore: number | null;
  decision: QualificationResult | null;
  scoringVersion: string | null;
  policyVersion: string | null;
  analyzedAt: string | null;
  /** True when at least one website-intelligence analysis exists for the business. */
  intelligenceAnalyzed: boolean;
}

export type ActivityKind =
  | "lifecycle"
  | "website_analysis"
  | "lead_score"
  | "qualification_decision";

export interface RecentActivityEntry {
  id: string;
  prospectId: string;
  businessName: string;
  kind: ActivityKind;
  label: string;
  detail: string | null;
  occurredAt: string;
  source: "persisted_record";
}

export interface ProspectOverview {
  summary: DashboardSummary;
  prospects: ProspectListItem[];
  recentActivity: RecentActivityEntry[];
  generatedAt: string;
}

export interface DecisionReasonView {
  id: string;
  code: string;
  contribution: string | null;
  explanation: string | null;
  featureRef: string | null;
  evidenceKind: string | null;
  evidenceId: string | null;
}

export interface ScoreComponentView {
  id: string;
  dimension: string;
  componentKey: string;
  result: number | null;
  direction: string | null;
  reasonCode: string;
}

export interface DecisionHistoryView {
  id: string;
  decisionType: string;
  result: string;
  policyVersion: string;
  decidedAt: string;
  actorType: string;
  actorRef: string | null;
  summary: string | null;
  reasons: DecisionReasonView[];
}

export interface WebsiteSignalsView {
  titlePresent: boolean | null;
  metaDescriptionPresent: boolean | null;
  viewportPresent: boolean | null;
  contactFormPresent: boolean | null;
  ctaPresent: boolean | null;
  emailPresent: boolean | null;
  phonePresent: boolean | null;
  copyrightYear: number | null;
}

export interface WebsiteFailureView {
  stage: string;
  code: string | null;
  message: string | null;
}

export interface WebsiteAnalysisView {
  id: string;
  featureSetId: string;
  analyzerVersion: string;
  calculatedAt: string;
  observedAt: string | null;
  requestedUrl: string | null;
  finalUrl: string | null;
  reachable: boolean | null;
  httpStatus: number | null;
  https: boolean | null;
  latencyMs: number | null;
  contentType: string | null;
  htmlRetrieved: boolean | null;
  redirectChain: string[];
  signals: WebsiteSignalsView | null;
  failure: WebsiteFailureView | null;
}

export interface ScoreHistoryEntry {
  id: string;
  featureSetId: string;
  overallScore: number;
  needScore: number | null;
  valueScore: number | null;
  activityScore: number | null;
  reachabilityScore: number | null;
  calculatedAt: string;
  scoringVersion: string;
  scoringArtifactVersion: string;
  featureSchemaVersion: string;
  pipelineVersion: string;
  featureAsOf: string;
  components: ScoreComponentView[];
  decisions: DecisionHistoryView[];
  websiteAnalysis: WebsiteAnalysisView | null;
  isLatest: boolean;
}

export interface ObservationView {
  id: string;
  subjectKind: string;
  field: string;
  valueType: "boolean" | "number" | "text" | "timestamp" | "json" | "unknown";
  value: boolean | number | string | JsonValue | null;
  unit: string | null;
  confidence: string;
  observedAt: string;
  recordedAt: string;
  retrievedAt: string | null;
  sourceName: string;
  sourceRecordId: string | null;
  evidenceSummary: string | null;
  evidenceRef: string | null;
}

export interface ProvenanceView {
  sourceRecordId: string;
  sourceName: string;
  sourceType: string;
  externalId: string;
  sourceLocator: string | null;
  retrievedAt: string | null;
  recordedAt: string;
  retrievalStatus: string;
  contentHash: string | null;
}

export interface TimelineEntry {
  id: string;
  fromState: ProspectLifecycleState | null;
  toState: ProspectLifecycleState;
  occurredAt: string;
  reasonCode: string;
  reasonNote: string | null;
  actorType: string;
  actorRef: string | null;
  decisionId: string | null;
  correlationId: string | null;
}

export interface ContactMethodView {
  id: string;
  channel: string;
  displayValue: string;
  confidence: string;
  validationStatus: string;
}

export interface IntelligenceSnapshotView {
  id: string;
  requestedUrl: string;
  crawlScope: string | null;
  httpStatus: number | null;
}

export interface WebsiteIntelligenceView {
  analysisId: string;
  websiteId: string;
  analyzerVersion: string;
  calculatedAt: string;
  structuredFindings: Record<string, unknown>;
  snapshots: IntelligenceSnapshotView[];
}

export interface ProspectDetail {
  prospectId: string;
  businessId: string;
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  lifecycleState: ProspectLifecycleState;
  openedAt: string;
  stateChangedAt: string;
  websiteId: string | null;
  websiteUrl: string | null;
  domain: string | null;
  currentScoreId: string | null;
  contacts: ContactMethodView[];
  provenance: ProvenanceView[];
  observations: ObservationView[];
  scoreHistory: ScoreHistoryEntry[];
  timeline: TimelineEntry[];
  websiteIntelligence: WebsiteIntelligenceView[];
}

export async function getProspectOverview(
  db: Database,
  filters: ProspectListFilters = {}
): Promise<ProspectOverview> {
  const [summary, prospects, recentActivity] = await Promise.all([
    getDashboardSummary(db),
    listProspects(db, filters),
    getRecentActivity(db),
  ]);
  return { summary, prospects, recentActivity, generatedAt: new Date().toISOString() };
}

export async function getDashboardSummary(db: Database): Promise<DashboardSummary> {
  const result = await sql<{
    total: number;
    qualified: number;
    rejected: number;
    analyzed: number;
  }>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE COALESCE(latest_decision.result_code, p.lifecycle_state::text) = 'qualified'
      )::int AS qualified,
      COUNT(*) FILTER (
        WHERE COALESCE(latest_decision.result_code, p.lifecycle_state::text) = 'rejected'
      )::int AS rejected,
      COUNT(*) FILTER (WHERE latest_score.id IS NOT NULL)::int AS analyzed
    FROM prospect p
    LEFT JOIN LATERAL (
      SELECT ls.id
      FROM lead_score ls
      WHERE ls.prospect_id = p.id
      ORDER BY ls.calculated_at DESC, ls.id DESC
      LIMIT 1
    ) latest_score ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.result_code
      FROM decision d
      WHERE d.prospect_id = p.id
        AND d.lead_score_id = latest_score.id
      ORDER BY d.decided_at DESC, d.id DESC
      LIMIT 1
    ) latest_decision ON TRUE
  `.execute(db);
  return result.rows[0] ?? { total: 0, qualified: 0, rejected: 0, analyzed: 0 };
}

function latestProspectQuery(db: Database) {
  return db
    .selectFrom("prospect")
    .innerJoin("business", "business.id", "prospect.business_id")
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("lead_score as ls")
          .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
          .select([
            "ls.id as score_id",
            "ls.overall_score",
            "ls.need_score",
            "ls.value_score",
            "ls.activity_score",
            "ls.reachability_score",
            "ls.calculated_at",
            "sv.name as scoring_version",
          ])
          .whereRef("ls.prospect_id", "=", "prospect.id")
          .orderBy("ls.calculated_at", "desc")
          .orderBy("ls.id", "desc")
          .limit(1)
          .as("latest_score"),
      (join) => join.onTrue()
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("decision as dec")
          .select(["dec.result_code", "dec.policy_version"])
          .whereRef("dec.prospect_id", "=", "prospect.id")
          .whereRef("dec.lead_score_id", "=", "latest_score.score_id")
          .orderBy("dec.decided_at", "desc")
          .orderBy("dec.id", "desc")
          .limit(1)
          .as("latest_decision"),
      (join) => join.onTrue()
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("source_record as sr")
          .innerJoin("source as src", "src.id", "sr.source_id")
          .select([
            "src.name as source_name",
            "src.source_type",
            "sr.provider_metadata",
          ])
          .whereRef("sr.business_id", "=", "business.id")
          .orderBy("sr.retrieved_at", (order) => order.desc().nullsLast())
          .orderBy("sr.created_at", "desc")
          .limit(1)
          .as("latest_source"),
      (join) => join.onTrue()
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom("business_website as bw")
          .innerJoin("website as web", "web.id", "bw.website_id")
          .leftJoin("website_domain as wd", (join) =>
            join.onRef("wd.website_id", "=", "web.id").on("wd.is_primary", "=", true)
          )
          .leftJoin("domain as dom", "dom.id", "wd.domain_id")
          .select(["web.id as website_id", "web.canonical_url", "dom.host as domain"])
          .whereRef("bw.business_id", "=", "business.id")
          .orderBy("bw.is_primary", "desc")
          .orderBy("bw.created_at", "desc")
          .limit(1)
          .as("primary_website"),
      (join) => join.onTrue()
    )
    .select([
      "prospect.id as prospect_id",
      "prospect.lifecycle_state",
      "prospect.opened_at",
      "prospect.state_changed_at",
      "business.id as business_id",
      "business.canonical_name",
      "business.category",
      "latest_score.score_id",
      "latest_score.overall_score",
      "latest_score.need_score",
      "latest_score.value_score",
      "latest_score.activity_score",
      "latest_score.reachability_score",
      "latest_score.calculated_at",
      "latest_score.scoring_version",
      "latest_decision.result_code",
      "latest_decision.policy_version",
      "latest_source.source_name",
      "latest_source.source_type",
      "latest_source.provider_metadata",
      "primary_website.website_id",
      "primary_website.canonical_url",
      "primary_website.domain",
    ]);
}

export async function listProspects(
  db: Database,
  filters: ProspectListFilters = {}
): Promise<ProspectListItem[]> {
  let query = latestProspectQuery(db);
  const search = filters.search?.trim();
  if (search) query = query.where("business.canonical_name", "ilike", `%${search}%`);
  const source = filters.source?.trim();
  if (source) query = query.where("latest_source.source_name", "ilike", `%${source}%`);
  const category = filters.category?.trim();
  if (category) query = query.where("business.category", "ilike", `%${category}%`);
  if (filters.status && filters.status !== "all") {
    query = query.where("latest_decision.result_code", "=", filters.status);
  }
  if (filters.minimumScore !== undefined) {
    query = query.where("latest_score.overall_score", ">=", filters.minimumScore);
  }
  if (filters.maximumScore !== undefined) {
    query = query.where("latest_score.overall_score", "<=", filters.maximumScore);
  }
  if (filters.intelligence === "analyzed") {
    query = query.where(({ exists, selectFrom }) =>
      exists(
        selectFrom("business_website as ibw")
          .innerJoin("website_analysis as iwa", "iwa.website_id", "ibw.website_id")
          .select("iwa.id")
          .whereRef("ibw.business_id", "=", "business.id")
          .where("iwa.analyzer_version", "like", "website-intelligence-%"),
      ),
    );
  }
  if (filters.intelligence === "none") {
    query = query.where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("business_website as ibw")
            .innerJoin("website_analysis as iwa", "iwa.website_id", "ibw.website_id")
            .select("iwa.id")
            .whereRef("ibw.business_id", "=", "business.id")
            .where("iwa.analyzer_version", "like", "website-intelligence-%"),
        ),
      ),
    );
  }
  query = query.select(({ exists, selectFrom }) =>
    exists(
      selectFrom("business_website as ibw")
        .innerJoin("website_analysis as iwa", "iwa.website_id", "ibw.website_id")
        .select("iwa.id")
        .whereRef("ibw.business_id", "=", "business.id")
        .where("iwa.analyzer_version", "like", "website-intelligence-%"),
    ).as("intelligence_analyzed"),
  );

  const rows = await query
    .orderBy("latest_score.calculated_at", (order) => order.desc().nullsLast())
    .orderBy("business.canonical_name", "asc")
    .execute();

  return rows.map(mapProspectListRow);
}

export async function getRecentActivity(db: Database, limit = 14): Promise<RecentActivityEntry[]> {
  const perType = Math.max(limit, 10);
  const [transitions, analyses, scores, decisions] = await Promise.all([
    db
      .selectFrom("prospect_state_transition as pst")
      .innerJoin("prospect as p", "p.id", "pst.prospect_id")
      .innerJoin("business as b", "b.id", "p.business_id")
      .select([
        "pst.id",
        "pst.prospect_id",
        "pst.to_state",
        "pst.reason_code",
        "pst.occurred_at",
        "b.canonical_name",
      ])
      .orderBy("pst.occurred_at", "desc")
      .limit(perType)
      .execute(),
    db
      .selectFrom("website_analysis as wa")
      .innerJoin("feature_set_lineage as fsl", (join) =>
        join
          .onRef("fsl.input_id", "=", "wa.id")
          .on("fsl.input_kind", "=", "website_analysis"),
      )
      .innerJoin("feature_set as fs", "fs.id", "fsl.feature_set_id")
      .innerJoin("prospect as p", "p.id", "fs.prospect_id")
      .innerJoin("business as b", "b.id", "p.business_id")
      .select([
        "wa.id",
        "fs.id as feature_set_id",
        "wa.calculated_at",
        "wa.analyzer_version",
        "p.id as prospect_id",
        "b.canonical_name",
      ])
      .orderBy("wa.calculated_at", "desc")
      .limit(perType)
      .execute(),
    db
      .selectFrom("lead_score as ls")
      .innerJoin("prospect as p", "p.id", "ls.prospect_id")
      .innerJoin("business as b", "b.id", "p.business_id")
      .select(["ls.id", "ls.calculated_at", "ls.overall_score", "ls.prospect_id", "b.canonical_name"])
      .orderBy("ls.calculated_at", "desc")
      .limit(perType)
      .execute(),
    db
      .selectFrom("decision as dec")
      .innerJoin("prospect as p", "p.id", "dec.prospect_id")
      .innerJoin("business as b", "b.id", "p.business_id")
      .select(["dec.id", "dec.decided_at", "dec.result_code", "dec.prospect_id", "b.canonical_name"])
      .orderBy("dec.decided_at", "desc")
      .limit(perType)
      .execute(),
  ]);

  return [
    ...transitions.map((row): RecentActivityEntry => ({
      id: `transition:${row.id}`,
      prospectId: row.prospect_id,
      businessName: row.canonical_name,
      kind: "lifecycle",
      label: lifecycleActivityLabel(row.to_state),
      detail: row.reason_code,
      occurredAt: toIso(row.occurred_at),
      source: "persisted_record",
    })),
    ...analyses.map((row): RecentActivityEntry => ({
      id: `analysis:${row.id}:${row.feature_set_id}`,
      prospectId: row.prospect_id,
      businessName: row.canonical_name,
      kind: "website_analysis",
      label: "Website analyzed",
      detail: row.analyzer_version,
      occurredAt: toIso(row.calculated_at),
      source: "persisted_record",
    })),
    ...scores.map((row): RecentActivityEntry => ({
      id: `score:${row.id}`,
      prospectId: row.prospect_id,
      businessName: row.canonical_name,
      kind: "lead_score",
      label: `Score calculated: ${row.overall_score}`,
      detail: "Heuristic priority score",
      occurredAt: toIso(row.calculated_at),
      source: "persisted_record",
    })),
    ...decisions.map((row): RecentActivityEntry => ({
      id: `decision:${row.id}`,
      prospectId: row.prospect_id!,
      businessName: row.canonical_name,
      kind: "qualification_decision",
      label: row.result_code === "qualified" ? "Prospect qualified" : "Prospect rejected",
      detail: row.result_code,
      occurredAt: toIso(row.decided_at),
      source: "persisted_record",
    })),
  ]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}

export async function getProspectDetail(db: Database, prospectId: string): Promise<ProspectDetail | undefined> {
  const header = await latestProspectQuery(db).where("prospect.id", "=", prospectId).executeTakeFirst();
  if (!header) return undefined;

  const [contacts, provenanceRows, observationRows, scoreRows, decisionRows, timelineRows] = await Promise.all([
    db
      .selectFrom("contact_method")
      .select(["id", "channel", "display_value", "normalized_value", "confidence", "validation_status"])
      .where("business_id", "=", header.business_id)
      .orderBy("channel", "asc")
      .execute(),
    db
      .selectFrom("source_record as sr")
      .innerJoin("source as src", "src.id", "sr.source_id")
      .select([
        "sr.id",
        "sr.external_id",
        "sr.source_locator",
        "sr.retrieved_at",
        "sr.created_at",
        "sr.retrieval_status",
        "sr.content_hash",
        "sr.provider_metadata",
        "src.name as source_name",
        "src.source_type",
      ])
      .where("sr.business_id", "=", header.business_id)
      .orderBy("sr.created_at", "desc")
      .execute(),
    db
      .selectFrom("observation as obs")
      .innerJoin("feature_set_lineage as fsl", (join) =>
        join
          .onRef("fsl.input_id", "=", "obs.id")
          .on("fsl.input_kind", "=", "observation"),
      )
      .innerJoin("feature_set as linked_fs", "linked_fs.id", "fsl.feature_set_id")
      .innerJoin("source as src", "src.id", "obs.source_id")
      .select([
        "obs.id",
        "obs.subject_kind",
        "obs.field_key",
        "obs.value_boolean",
        "obs.value_number",
        "obs.value_text",
        "obs.value_at",
        "obs.value_json",
        "obs.unit",
        "obs.confidence",
        "obs.observed_at",
        "obs.recorded_at",
        "obs.retrieved_at",
        "obs.source_record_id",
        "obs.evidence_summary",
        "obs.evidence_ref",
        "src.name as source_name",
      ])
      .where("linked_fs.prospect_id", "=", prospectId)
      .distinct()
      .orderBy("obs.recorded_at", "desc")
      .execute(),
    db
      .selectFrom("lead_score as ls")
      .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
      .innerJoin("feature_set as fs", "fs.id", "ls.feature_set_id")
      .select([
        "ls.id",
        "ls.feature_set_id",
        "ls.overall_score",
        "ls.need_score",
        "ls.value_score",
        "ls.activity_score",
        "ls.reachability_score",
        "ls.calculated_at",
        "sv.name as scoring_version",
        "sv.artifact_version",
        "fs.feature_schema_version",
        "fs.pipeline_version",
        "fs.as_of",
      ])
      .where("ls.prospect_id", "=", prospectId)
      .orderBy("ls.calculated_at", "desc")
      .orderBy("ls.id", "desc")
      .execute(),
    db
      .selectFrom("decision as dec")
      .select([
        "dec.id",
        "dec.lead_score_id",
        "dec.decision_type",
        "dec.result_code",
        "dec.result_detail",
        "dec.policy_version",
        "dec.decided_at",
        "dec.actor_type",
        "dec.actor_ref",
      ])
      .where("dec.prospect_id", "=", prospectId)
      .orderBy("dec.decided_at", "desc")
      .execute(),
    db
      .selectFrom("prospect_state_transition")
      .select([
        "id",
        "from_state",
        "to_state",
        "occurred_at",
        "reason_code",
        "reason_note",
        "actor_type",
        "actor_ref",
        "decision_id",
        "correlation_id",
      ])
      .where("prospect_id", "=", prospectId)
      .orderBy("occurred_at", "asc")
      .orderBy("prior_revision", "asc")
      .execute(),
  ]);

  const scoreIds = scoreRows.map((row) => row.id);
  const decisionIds = decisionRows.map((row) => row.id);
  const featureSetIds = scoreRows.map((row) => row.feature_set_id);
  const [componentRows, reasonRows, analysisRows] = await Promise.all([
    scoreIds.length === 0
      ? []
      : db
          .selectFrom("score_component")
          .selectAll()
          .where("lead_score_id", "in", scoreIds)
          .orderBy("dimension", "asc")
          .execute(),
    decisionIds.length === 0
      ? []
      : db
          .selectFrom("decision_reason")
          .selectAll()
          .where("decision_id", "in", decisionIds)
          .execute(),
    featureSetIds.length === 0
      ? []
      : db
          .selectFrom("feature_set_lineage as fsl")
          .innerJoin("website_analysis as wa", "wa.id", "fsl.input_id")
          .leftJoin("website_analysis_snapshot as was", "was.website_analysis_id", "wa.id")
          .leftJoin("website_snapshot as ws", "ws.id", "was.website_snapshot_id")
          .select([
            "fsl.feature_set_id",
            "wa.id",
            "wa.analyzer_version",
            "wa.calculated_at",
            "wa.structured_findings",
            "ws.observed_at",
            "ws.requested_url",
            "ws.final_url",
          ])
          .where("fsl.input_kind", "=", "website_analysis")
          .where("fsl.feature_set_id", "in", featureSetIds)
          .orderBy("wa.calculated_at", "desc")
          .execute(),
  ]);

  const decisions = decisionRows.map((row): DecisionHistoryView & { leadScoreId: string | null } => {
    const detail = asRecord(row.result_detail);
    return {
      id: row.id,
      leadScoreId: row.lead_score_id,
      decisionType: row.decision_type,
      result: row.result_code,
      policyVersion: row.policy_version,
      decidedAt: toIso(row.decided_at),
      actorType: row.actor_type,
      actorRef: row.actor_ref,
      summary: typeof detail?.summary === "string" ? detail.summary : null,
      reasons: reasonRows
        .filter((reason) => reason.decision_id === row.id)
        .map((reason) => ({
          id: reason.id,
          code: reason.reason_code,
          contribution: reason.contribution,
          explanation: reason.explanation,
          featureRef: reason.feature_ref,
          evidenceKind: reason.evidence_kind,
          evidenceId: reason.evidence_id,
        })),
    };
  });

  const analyses = analysisRows.map((row) => mapWebsiteAnalysis(row));
  const scoreHistory = scoreRows.map((row, index): ScoreHistoryEntry => ({
    id: row.id,
    featureSetId: row.feature_set_id,
    overallScore: row.overall_score,
    needScore: row.need_score,
    valueScore: row.value_score,
    activityScore: row.activity_score,
    reachabilityScore: row.reachability_score,
    calculatedAt: toIso(row.calculated_at),
    scoringVersion: row.scoring_version,
    scoringArtifactVersion: row.artifact_version,
    featureSchemaVersion: row.feature_schema_version,
    pipelineVersion: row.pipeline_version,
    featureAsOf: toIso(row.as_of),
    components: componentRows
      .filter((component) => component.lead_score_id === row.id)
      .map((component) => ({
        id: component.id,
        dimension: component.dimension,
        componentKey: component.component_key,
        result: component.result === null ? null : Number(component.result),
        direction: component.direction,
        reasonCode: component.reason_code,
      })),
    decisions: decisions
      .filter((decision) => decision.leadScoreId === row.id)
      .map(({ leadScoreId: _leadScoreId, ...decision }) => decision),
    websiteAnalysis: analyses.find((analysis) => analysis.featureSetId === row.feature_set_id) ?? null,
    isLatest: index === 0,
  }));

  const metadataLocation = findLocation(provenanceRows.map((row) => row.provider_metadata));
  const headerLocation = findLocation([header.provider_metadata]);
  const location = metadataLocation.city || metadataLocation.state ? metadataLocation : headerLocation;

  // Phase 6 website-intelligence runs for THIS business's websites only
  // (append-only history, newest first). Snapshots are joined per analysis so
  // an older run can never borrow a newer run's evidence.
  const intelligenceRows = await db
    .selectFrom("website_analysis as wa")
    .innerJoin("business_website as bw", "bw.website_id", "wa.website_id")
    .select(["wa.id", "wa.website_id", "wa.analyzer_version", "wa.calculated_at", "wa.structured_findings"])
    .where("bw.business_id", "=", header.business_id)
    .where("wa.analyzer_version", "like", "website-intelligence-%")
    .orderBy("wa.calculated_at", "desc")
    .limit(12)
    .execute();
  const intelligenceSnapshots =
    intelligenceRows.length === 0
      ? []
      : await db
          .selectFrom("website_analysis_snapshot as was")
          .innerJoin("website_snapshot as ws", "ws.id", "was.website_snapshot_id")
          .select(["was.website_analysis_id", "ws.id", "ws.requested_url", "ws.crawl_scope", "ws.http_status"])
          .where("was.website_analysis_id", "in", intelligenceRows.map((row) => row.id))
          .orderBy("ws.recorded_at")
          .execute();
  const websiteIntelligence: WebsiteIntelligenceView[] = intelligenceRows.map((row) => ({
    analysisId: row.id,
    websiteId: row.website_id,
    analyzerVersion: row.analyzer_version,
    calculatedAt: toIso(row.calculated_at),
    structuredFindings:
      typeof row.structured_findings === "object" && row.structured_findings !== null && !Array.isArray(row.structured_findings)
        ? (row.structured_findings as Record<string, unknown>)
        : {},
    snapshots: intelligenceSnapshots
      .filter((snapshot) => snapshot.website_analysis_id === row.id)
      .map((snapshot) => ({
        id: snapshot.id,
        requestedUrl: snapshot.requested_url,
        crawlScope: snapshot.crawl_scope,
        httpStatus: snapshot.http_status,
      })),
  }));

  return {
    prospectId: header.prospect_id,
    businessId: header.business_id,
    businessName: header.canonical_name,
    category: header.category,
    city: location.city,
    state: location.state,
    lifecycleState: header.lifecycle_state,
    openedAt: toIso(header.opened_at),
    stateChangedAt: toIso(header.state_changed_at),
    websiteId: header.website_id,
    websiteUrl: header.canonical_url,
    domain: header.domain,
    currentScoreId: header.score_id,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      channel: contact.channel,
      displayValue: contact.display_value ?? contact.normalized_value,
      confidence: contact.confidence,
      validationStatus: contact.validation_status,
    })),
    provenance: provenanceRows.map((row) => ({
      sourceRecordId: row.id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      externalId: row.external_id,
      sourceLocator: row.source_locator,
      retrievedAt: row.retrieved_at ? toIso(row.retrieved_at) : null,
      recordedAt: toIso(row.created_at),
      retrievalStatus: row.retrieval_status,
      contentHash: row.content_hash,
    })),
    observations: observationRows.map(mapObservation),
    scoreHistory,
    timeline: timelineRows.map((row) => ({
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      occurredAt: toIso(row.occurred_at),
      reasonCode: row.reason_code,
      reasonNote: row.reason_note,
      actorType: row.actor_type,
      actorRef: row.actor_ref,
      decisionId: row.decision_id,
      correlationId: row.correlation_id,
    })),
    websiteIntelligence,
  };
}

function mapProspectListRow(row: Awaited<ReturnType<ReturnType<typeof latestProspectQuery>["execute"]>>[number]): ProspectListItem {
  const location = findLocation([row.provider_metadata]);
  return {
    prospectId: row.prospect_id,
    businessId: row.business_id,
    businessName: row.canonical_name,
    category: row.category,
    city: location.city,
    state: location.state,
    websiteUrl: row.canonical_url,
    domain: row.domain,
    sourceName: row.source_name,
    sourceType: row.source_type,
    lifecycleState: row.lifecycle_state,
    overallScore: row.overall_score,
    needScore: row.need_score,
    valueScore: row.value_score,
    activityScore: row.activity_score,
    reachabilityScore: row.reachability_score,
    decision:
      row.result_code === "qualified" || row.result_code === "rejected" ? row.result_code : null,
    scoringVersion: row.scoring_version,
    policyVersion: row.policy_version,
    analyzedAt: row.calculated_at ? toIso(row.calculated_at) : null,
    intelligenceAnalyzed: Boolean((row as { intelligence_analyzed?: boolean }).intelligence_analyzed),
  };
}

function mapObservation(row: {
  id: string;
  subject_kind: string;
  field_key: string;
  value_boolean: boolean | null;
  value_number: string | null;
  value_text: string | null;
  value_at: Date | null;
  value_json: JsonValue | null;
  unit: string | null;
  confidence: string;
  observed_at: Date;
  recorded_at: Date;
  retrieved_at: Date | null;
  source_record_id: string | null;
  evidence_summary: string | null;
  evidence_ref: string | null;
  source_name: string;
}): ObservationView {
  let valueType: ObservationView["valueType"] = "unknown";
  let value: ObservationView["value"] = null;
  if (row.value_boolean !== null) {
    valueType = "boolean";
    value = row.value_boolean;
  } else if (row.value_number !== null) {
    valueType = "number";
    value = Number(row.value_number);
  } else if (row.value_text !== null) {
    valueType = "text";
    value = row.value_text;
  } else if (row.value_at !== null) {
    valueType = "timestamp";
    value = toIso(row.value_at);
  } else if (row.value_json !== null) {
    valueType = "json";
    value = row.value_json;
  }
  return {
    id: row.id,
    subjectKind: row.subject_kind,
    field: row.field_key,
    valueType,
    value,
    unit: row.unit,
    confidence: row.confidence,
    observedAt: toIso(row.observed_at),
    recordedAt: toIso(row.recorded_at),
    retrievedAt: row.retrieved_at ? toIso(row.retrieved_at) : null,
    sourceName: row.source_name,
    sourceRecordId: row.source_record_id,
    evidenceSummary: row.evidence_summary,
    evidenceRef: row.evidence_ref,
  };
}

function mapWebsiteAnalysis(row: {
  feature_set_id: string;
  id: string;
  analyzer_version: string;
  calculated_at: Date;
  structured_findings: JsonValue;
  observed_at: Date | null;
  requested_url: string | null;
  final_url: string | null;
}): WebsiteAnalysisView {
  const findings = asRecord(row.structured_findings);
  const signals = asRecord(findings?.signals);
  const failure = asRecord(findings?.failure);
  const redirectChain = Array.isArray(findings?.redirectChain)
    ? findings.redirectChain.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: row.id,
    featureSetId: row.feature_set_id,
    analyzerVersion: row.analyzer_version,
    calculatedAt: toIso(row.calculated_at),
    observedAt: row.observed_at ? toIso(row.observed_at) : null,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url,
    reachable: booleanOrNull(findings?.reachable),
    httpStatus: numberOrNull(findings?.httpStatus),
    https: booleanOrNull(findings?.https),
    latencyMs: numberOrNull(findings?.latencyMs),
    contentType: stringOrNull(findings?.contentType),
    htmlRetrieved: booleanOrNull(findings?.htmlRetrieved),
    redirectChain,
    signals: signals
      ? {
          titlePresent: booleanOrNull(signals.titlePresent),
          metaDescriptionPresent: booleanOrNull(signals.metaDescriptionPresent),
          viewportPresent: booleanOrNull(signals.viewportPresent),
          contactFormPresent: booleanOrNull(signals.contactFormPresent),
          ctaPresent: booleanOrNull(signals.ctaPresent),
          emailPresent: booleanOrNull(signals.emailPresent),
          phonePresent: booleanOrNull(signals.phonePresent),
          copyrightYear: numberOrNull(signals.copyrightYear),
        }
      : null,
    failure: failure
      ? {
          stage: stringOrNull(failure.stage) ?? "unknown",
          code: stringOrNull(failure.code),
          message: stringOrNull(failure.message),
        }
      : null,
  };
}

function lifecycleActivityLabel(state: ProspectLifecycleState): string {
  const labels: Record<ProspectLifecycleState, string> = {
    discovered: "Business discovered",
    enriching: "Enrichment started",
    evaluated: "Prospect evaluated",
    qualified: "Prospect qualified",
    rejected: "Prospect rejected",
    outreach_active: "Outreach activated",
    engaged: "Prospect engaged",
    sales_active: "Sales activity started",
    won: "Prospect won",
    lost: "Prospect lost",
    paused: "Prospect paused",
  };
  return labels[state];
}

function findLocation(values: Array<JsonValue | null | undefined>): { city: string | null; state: string | null } {
  for (const value of values) {
    const record = asRecord(value);
    if (!record) continue;
    const city = stringOrNull(record.city);
    const state = stringOrNull(record.state);
    if (city || state) return { city, state };
  }
  return { city: null, state: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
