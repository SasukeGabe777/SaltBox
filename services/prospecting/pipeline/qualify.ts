/**
 * Phase 4 vertical-slice orchestrator:
 *
 *   ingest → analyze website → record observations → build FeatureSet
 *          → calculate LeadScore → make Decision → transition Prospect
 *
 * Error model (explicit): a broken or missing website is a NEGATIVE
 * OBSERVATION and the pipeline completes normally; infrastructure failures
 * (database unavailable, constraint violations) THROW and abort the run.
 *
 * Idempotency model (explicit): business/source/website/prospect IDENTITY is
 * idempotent — re-running a fixture reuses those rows. Snapshot, analysis,
 * observation, FeatureSet, LeadScore, and Decision records are APPEND-ONLY
 * HISTORY — each run adds a new dated evaluation, as ADR-004 requires.
 */

import type { Database } from "@saltbox/database/client";
import type { SubjectKind } from "@saltbox/database/generated";
import {
  openProspect,
  getProspectById,
  transitionProspect,
  findProspectForPursuit,
  TERMINAL_STATES,
  type ProspectRecord,
} from "@saltbox/database/repositories/prospects";
import { recordObservation, type ObservationValue } from "@saltbox/database/repositories/observations";
import { recordWebsiteSnapshot, recordWebsiteAnalysis } from "@saltbox/database/repositories/websites";
import { ensureFeatureDefinitions, createFeatureSet, type FeatureValue } from "@saltbox/database/repositories/features";
import { ensureScoringVersion, createLeadScore } from "@saltbox/database/repositories/scoring";
import { createDecision } from "@saltbox/database/repositories/decisions";
import { appendEvent } from "@saltbox/database/repositories/events";
import {
  ingestControlledBusiness,
  type BusinessIdentityDisposition,
  type ControlledBusinessInput,
  type IngestionResult,
} from "../ingestion/ingest.ts";
import { analyzeWebsite, type WebsiteAnalyzerOptions, type WebsiteCheckResult } from "../analysis/analyzer.ts";
import { deriveFeatures } from "../features/derive.ts";
import { calculateScore } from "../scoring/score.ts";
import { decideQualification } from "../decision/decide.ts";
import {
  FEATURE_SCHEMA_VERSION,
  SCORING_VERSION_NAME,
  SCORING_ARTIFACT_VERSION,
  DECISION_POLICY_VERSION,
  PIPELINE_VERSION,
  ANALYZER_VERSION,
  QUALIFICATION_THRESHOLD,
  FEATURE_DEFINITION_SPECS,
} from "../config/qualification-v1.ts";

export type PipelineLog = (stage: string, detail?: Record<string, unknown>) => void;

export interface QualifyOptions {
  analyzer?: WebsiteAnalyzerOptions;
  log?: PipelineLog;
  correlationId?: string;
}

export interface QualificationOutcome {
  correlationId: string;
  sourceRecordId: string;
  businessId: string;
  businessCreated: boolean;
  identityDisposition: BusinessIdentityDisposition;
  crossSourceSignals?: Record<string, string>;
  prospectId: string;
  featureSetId: string;
  leadScoreId: string;
  decisionId: string;
  websiteAnalysisId?: string;
  score: number;
  dimensions: { need: number; value: number; activity: number; reachability: number };
  decision: "qualified" | "rejected";
  reasons: string[];
  summary: string;
  lifecycleState: string;
  /** Non-fatal notes, e.g. skipped transitions on a reused closed pursuit. */
  notes: string[];
}

export async function qualifyBusiness(
  db: Database,
  input: ControlledBusinessInput,
  options: QualifyOptions = {}
): Promise<QualificationOutcome> {
  const log: PipelineLog = options.log ?? (() => {});
  const notes: string[] = [];
  const correlationId = options.correlationId ?? crypto.randomUUID();

  const setup = await ensureQualificationSetup(db);

  const ingestion = await ingestControlledBusiness(db, input);
  log("ingested", { correlationId, businessId: ingestion.businessId, sourceRecordId: ingestion.sourceRecordId });

  const prospect = await ensureProspect(db, ingestion.businessId, notes, correlationId);
  log("prospect", { prospectId: prospect.id, lifecycleState: prospect.lifecycleState });

  await advanceIfInState(db, prospect.id, "discovered", "enriching", "enrichment.started", correlationId, notes);

  const website = await analyzeWebsite(input.websiteUrl, options.analyzer);
  log("website-analyzed", {
    attempted: website.attempted,
    reachable: website.reachable,
    httpStatus: website.httpStatus,
    failure: website.failure?.stage,
  });

  const observedAt = new Date();
  const evidence = await recordEvidence(db, ingestion, input, website, observedAt);
  log("observations-recorded", { count: evidence.observationIds.length, websiteAnalysisId: evidence.websiteAnalysisId });

  await advanceIfInState(db, prospect.id, "enriching", "evaluated", "analysis.complete", correlationId, notes);

  const features = deriveFeatures(input, website);
  const featureSetId = await createFeatureSet(db, {
    prospectId: prospect.id,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    asOf: observedAt,
    stable: {
      ...(features.stable.mobilePass !== undefined ? { mobilePass: features.stable.mobilePass } : {}),
      emailAvailable: features.stable.emailAvailable,
      ...(features.stable.businessCategory !== undefined
        ? { businessCategory: features.stable.businessCategory }
        : {}),
    },
    values: buildFeatureValues(features, setup.definitionIds),
    lineage: [
      ...evidence.observationIds.map((id) => ({ inputKind: "observation" as const, inputId: id })),
      ...(evidence.websiteAnalysisId
        ? [{ inputKind: "website_analysis" as const, inputId: evidence.websiteAnalysisId }]
        : []),
    ],
  });
  log("feature-set", { featureSetId });

  const score = calculateScore(features);
  const leadScoreId = await createLeadScore(db, {
    prospectId: prospect.id,
    featureSetId,
    scoringVersionId: setup.scoringVersionId,
    overallScore: score.overall,
    needScore: score.dimensions.need,
    valueScore: score.dimensions.value,
    activityScore: score.dimensions.activity,
    reachabilityScore: score.dimensions.reachability,
    components: score.components.map((c) => ({
      dimension: c.dimension,
      componentKey: c.componentKey,
      result: c.result,
      direction: c.direction,
      reasonCode: c.reasonCode,
    })),
  });
  log("scored", { leadScoreId, overall: score.overall, dimensions: score.dimensions });

  const decision = decideQualification(features, score);
  const decisionId = await createDecision(db, {
    decisionType: decision.decisionType,
    resultCode: decision.resultCode,
    resultDetail: {
      summary: decision.summary,
      threshold: QUALIFICATION_THRESHOLD,
      overallScore: score.overall,
    },
    policyVersion: DECISION_POLICY_VERSION,
    actorType: "system",
    actorRef: "prospecting.qualification-pipeline",
    businessId: ingestion.businessId,
    prospectId: prospect.id,
    featureSetId,
    leadScoreId,
    correlationId,
    reasons: decision.reasons,
  });
  log("decided", { decisionId, decision: decision.resultCode });

  const targetState = decision.resultCode === "qualified" ? "qualified" : "rejected";
  await advanceIfInState(
    db,
    prospect.id,
    "evaluated",
    targetState,
    `decision.${decision.resultCode}`,
    correlationId,
    notes,
    decisionId
  );

  if (decision.resultCode === "qualified") {
    await appendEvent(db, {
      category: "domain",
      eventType: "prospect_qualified",
      occurredAt: new Date(),
      sourceProducer: "prospecting.qualification-pipeline",
      actorType: "system",
      businessId: ingestion.businessId,
      prospectId: prospect.id,
      correlationId,
      idempotencyScope: "qualification.decision",
      idempotencyKey: decisionId,
    });
  }

  const finalProspect = await getProspectById(db, prospect.id);

  const outcome: QualificationOutcome = {
    correlationId,
    sourceRecordId: ingestion.sourceRecordId,
    businessId: ingestion.businessId,
    businessCreated: ingestion.businessCreated,
    identityDisposition: ingestion.identityDisposition,
    ...(ingestion.crossSourceSignals !== undefined ? { crossSourceSignals: ingestion.crossSourceSignals } : {}),
    prospectId: prospect.id,
    featureSetId,
    leadScoreId,
    decisionId,
    score: score.overall,
    dimensions: score.dimensions,
    decision: decision.resultCode,
    reasons: decision.reasons.map((r) => r.reasonCode),
    summary: decision.summary,
    lifecycleState: finalProspect?.lifecycleState ?? "unknown",
    notes,
  };
  if (evidence.websiteAnalysisId !== undefined) {
    outcome.websiteAnalysisId = evidence.websiteAnalysisId;
  }
  log("complete", { decision: outcome.decision, score: outcome.score, lifecycleState: outcome.lifecycleState });
  return outcome;
}

interface QualificationSetup {
  scoringVersionId: string;
  definitionIds: Map<string, string>;
}

async function ensureQualificationSetup(db: Database): Promise<QualificationSetup> {
  const scoringVersionId = await ensureScoringVersion(db, {
    name: SCORING_VERSION_NAME,
    inputSchemaVersion: FEATURE_SCHEMA_VERSION,
    artifactVersion: SCORING_ARTIFACT_VERSION,
    description: "Initial deterministic qualification heuristics (human hypotheses, not statistically derived).",
  });
  const definitionIds = await ensureFeatureDefinitions(db, FEATURE_DEFINITION_SPECS);
  return { scoringVersionId, definitionIds };
}

async function ensureProspect(
  db: Database,
  businessId: string,
  notes: string[],
  correlationId: string
): Promise<ProspectRecord> {
  const existing = await findProspectForPursuit(db, { businessId });
  if (existing) {
    if (TERMINAL_STATES.includes(existing.lifecycleState)) {
      notes.push(
        `reusing closed prospect ${existing.id} (${existing.lifecycleState}); ` +
          "new evaluation history is appended but the closed lifecycle is not reopened"
      );
    }
    return existing;
  }
  return openProspect(db, {
    businessId,
    actorType: "system",
    actorRef: "prospecting.qualification-pipeline",
    reasonCode: "prospecting.discovered",
    correlationId,
  });
}

async function advanceIfInState(
  db: Database,
  prospectId: string,
  fromState: string,
  toState: "enriching" | "evaluated" | "qualified" | "rejected",
  reasonCode: string,
  correlationId: string,
  notes: string[],
  decisionId?: string
): Promise<void> {
  const current = await getProspectById(db, prospectId);
  if (!current) throw new Error(`Prospect ${prospectId} disappeared mid-pipeline.`);
  if (current.lifecycleState !== fromState) {
    notes.push(`skipped transition ${fromState} → ${toState}: prospect is in ${current.lifecycleState}`);
    return;
  }
  await transitionProspect(db, {
    prospectId,
    expectedRevision: current.revision,
    toState,
    reasonCode,
    actorType: "system",
    actorRef: "prospecting.qualification-pipeline",
    correlationId,
    ...(decisionId !== undefined ? { decisionId } : {}),
  });
}

interface EvidenceRecord {
  observationIds: string[];
  websiteSnapshotId?: string;
  websiteAnalysisId?: string;
}

async function recordEvidence(
  db: Database,
  ingestion: IngestionResult,
  input: ControlledBusinessInput,
  website: WebsiteCheckResult,
  observedAt: Date
): Promise<EvidenceRecord> {
  const observationIds: string[] = [];
  const observe = async (subjectKind: SubjectKind, subjectId: string, fieldKey: string, value: ObservationValue) => {
    observationIds.push(
      await recordObservation(db, {
        subjectKind,
        subjectId,
        fieldKey,
        value,
        sourceId: ingestion.sourceId,
        sourceRecordId: ingestion.sourceRecordId,
        observedAt,
        confidence: "verified",
        verificationMethod: "deterministic-check",
      })
    );
  };

  const hasEmail = input.email !== undefined && input.email.trim() !== "";
  const hasPhone = input.phone !== undefined && input.phone.trim() !== "";
  await observe("business", ingestion.businessId, "email_available", { kind: "boolean", value: hasEmail });
  await observe("business", ingestion.businessId, "phone_available", { kind: "boolean", value: hasPhone });
  await observe("business", ingestion.businessId, "website_present", {
    kind: "boolean",
    value: website.attempted,
  });

  const result: EvidenceRecord = { observationIds };
  if (!website.attempted || ingestion.websiteId === undefined) {
    return result;
  }

  const websiteId = ingestion.websiteId;
  result.websiteSnapshotId = await recordWebsiteSnapshot(db, {
    websiteId,
    requestedUrl: website.requestedUrl!,
    ...(website.finalUrl !== undefined ? { finalUrl: website.finalUrl } : {}),
    ...(website.httpStatus !== undefined ? { httpStatus: website.httpStatus } : {}),
    ...(website.https !== undefined ? { httpsOk: website.https } : {}),
    ...(website.redirectChain.length > 0 ? { redirectChain: website.redirectChain } : {}),
    ...(website.contentHash !== undefined ? { contentHash: website.contentHash } : {}),
    observedAt,
    captureToolVersion: ANALYZER_VERSION,
  });

  result.websiteAnalysisId = await recordWebsiteAnalysis(db, {
    websiteId,
    analyzerVersion: ANALYZER_VERSION,
    findingsSchemaVersion: 1,
    structuredFindings: {
      reachable: website.reachable,
      httpStatus: website.httpStatus ?? null,
      https: website.https ?? null,
      latencyMs: website.latencyMs ?? null,
      contentType: website.contentType ?? null,
      htmlRetrieved: website.htmlRetrieved,
      redirectChain: website.redirectChain,
      signals: website.signals ?? null,
      failure: website.failure ?? null,
    },
    snapshotIds: [result.websiteSnapshotId],
  });

  await observe("website", websiteId, "reachable", { kind: "boolean", value: website.reachable });
  if (website.failure) {
    await observe("website", websiteId, "failure_stage", { kind: "text", value: website.failure.stage });
  }
  if (website.httpStatus !== undefined) {
    await observe("website", websiteId, "http_status", { kind: "number", value: website.httpStatus });
  }
  if (website.https !== undefined) {
    await observe("website", websiteId, "https", { kind: "boolean", value: website.https });
  }
  if (website.latencyMs !== undefined) {
    await observe("website", websiteId, "response_latency", {
      kind: "number",
      value: website.latencyMs,
      unit: "ms",
    });
  }
  if (website.signals) {
    const s = website.signals;
    await observe("website", websiteId, "title_present", { kind: "boolean", value: s.titlePresent });
    await observe("website", websiteId, "meta_description_present", {
      kind: "boolean",
      value: s.metaDescriptionPresent,
    });
    await observe("website", websiteId, "viewport_present", { kind: "boolean", value: s.viewportPresent });
    await observe("website", websiteId, "contact_form_present", { kind: "boolean", value: s.contactFormPresent });
    await observe("website", websiteId, "cta_present", { kind: "boolean", value: s.ctaPresent });
    await observe("website", websiteId, "phone_present_on_site", { kind: "boolean", value: s.phonePresent });
    await observe("website", websiteId, "email_present_on_site", { kind: "boolean", value: s.emailPresent });
    if (s.copyrightYear !== null) {
      await observe("website", websiteId, "copyright_year", { kind: "number", value: s.copyrightYear });
    }
  }

  return result;
}

function buildFeatureValues(
  features: ReturnType<typeof deriveFeatures>,
  definitionIds: Map<string, string>
): { definitionId: string; value: FeatureValue }[] {
  const values: { definitionId: string; value: FeatureValue }[] = [];
  const push = (name: string, value: FeatureValue) => {
    const definitionId = definitionIds.get(name);
    if (definitionId === undefined) {
      throw new Error(`Feature definition "${name}" is not registered; setup is incomplete.`);
    }
    values.push({ definitionId, value });
  };

  for (const [name, triggered] of Object.entries(features.need)) {
    push(name, { kind: "boolean", value: triggered });
  }
  push("industry_value_band", { kind: "text", value: features.valueBand });
  for (const [name, present] of Object.entries(features.activity)) {
    push(name, { kind: "boolean", value: present });
  }
  for (const [name, present] of Object.entries(features.reachability)) {
    push(name, { kind: "boolean", value: present });
  }
  return values;
}
