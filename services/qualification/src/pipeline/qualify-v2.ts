/**
 * Qualification v2 append-only pipeline:
 * ingest -> deep intelligence -> features v2 -> score v2 -> policy v2.
 */

import type { Database } from "@saltbox/database/client";
import type { ProspectLifecycleState, SubjectKind } from "@saltbox/database/generated";
import { createDecision } from "@saltbox/database/repositories/decisions";
import { ensureFeatureDefinitions, createFeatureSet, type FeatureValue } from "@saltbox/database/repositories/features";
import { recordObservation, type ObservationValue } from "@saltbox/database/repositories/observations";
import {
  findProspectForPursuit,
  getProspectById,
  openProspect,
  TERMINAL_STATES,
  transitionProspect,
  type ProspectRecord,
} from "@saltbox/database/repositories/prospects";
import { createLeadScore, ensureScoringVersion } from "@saltbox/database/repositories/scoring";
import { activeQualificationSuppressions } from "@saltbox/database/repositories/suppressions";
import {
  ingestControlledBusiness,
  type BusinessIdentityDisposition,
  type ControlledBusinessInput,
  type IngestionResult,
} from "@saltbox/prospecting/ingestion";
import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import {
  analyzeWebsiteIntelligence,
  type AnalyzeWebsiteOptions,
} from "@saltbox/website-intelligence/analyzer";
import {
  intelligenceObservations,
  persistIntelligenceRun,
  type PersistedIntelligence,
} from "@saltbox/website-intelligence/persistence";
import {
  DECISION_POLICY_VERSION_V2,
  FEATURE_DEFINITION_SPECS_V2,
  FEATURE_SCHEMA_VERSION_V2,
  PIPELINE_VERSION_V2,
  QUALIFICATION_THRESHOLD_V2,
  SCORING_ARTIFACT_VERSION_V2,
  SCORING_VERSION_V2,
} from "../config/qualification-v2.ts";
import { decideQualificationV2 } from "../decision/decide-v2.ts";
import { deriveQualificationFeaturesV2 } from "../features/derive-v2.ts";
import { calculateQualificationScoreV2 } from "../scoring/score-v2.ts";
import type { EvidenceRef, QualificationV2Features } from "../types.ts";

export type PipelineV2Log = (stage: string, detail?: Record<string, unknown>) => void;
export type AnalyzeWebsite = typeof analyzeWebsiteIntelligence;

export interface QualifyV2Options {
  analyzer?: AnalyzeWebsiteOptions;
  analyze?: AnalyzeWebsite;
  artifactRef?: string;
  log?: PipelineV2Log;
  correlationId?: string;
  currentYear?: number;
}

export interface QualificationV2Outcome {
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
  intelligenceStatus: QualificationV2Features["intelligenceStatus"];
  intelligenceFailureKind?: string;
  intelligenceFailureCode?: string;
  intelligenceFatalStage?: string;
  intelligenceTransient: boolean;
  targetFailure: boolean;
  score: number;
  dimensions: { need: number; value: number; activity: number; reachability: number };
  decision: "qualified" | "rejected";
  reasons: string[];
  summary: string;
  lifecycleState: string;
  notes: string[];
}

export async function qualifyBusinessV2(
  db: Database,
  input: ControlledBusinessInput,
  options: QualifyV2Options = {},
): Promise<QualificationV2Outcome> {
  const log = options.log ?? (() => {});
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const notes: string[] = [];
  const setup = await ensureQualificationV2Setup(db);

  const ingestion = await ingestControlledBusiness(db, input);
  log("DISCOVERED", { businessId: ingestion.businessId, name: input.name });
  const prospect = await ensureProspect(db, ingestion.businessId, correlationId, notes);
  await advanceIfInState(db, prospect.id, "discovered", "enriching", "qualification-v2.intelligence-started", correlationId, notes);

  const observedAt = new Date();
  const baseEvidence = await recordBaseEvidence(db, ingestion, input, observedAt);
  const evidenceByField = new Map<string, EvidenceRef[]>();
  for (const observation of baseEvidence) addEvidence(evidenceByField, observation.fieldKey, { kind: "observation", id: observation.id, field: observation.fieldKey });

  let intelligence: WebsiteIntelligenceResult | null = null;
  let persisted: PersistedIntelligence | undefined;
  if (input.websiteUrl?.trim()) {
    log("ANALYZING", { websiteUrl: input.websiteUrl });
    intelligence = await (options.analyze ?? analyzeWebsiteIntelligence)(input.websiteUrl, options.analyzer);
    if (ingestion.websiteId) {
      persisted = await persistIntelligenceRun(db, {
        businessId: ingestion.businessId,
        websiteId: ingestion.websiteId,
        result: intelligence,
        ...(options.artifactRef ? { artifactRef: options.artifactRef } : {}),
      });
      for (const observation of persisted.observations) {
        addEvidence(evidenceByField, observation.fieldKey, { kind: "observation", id: observation.id, field: observation.fieldKey });
      }
    } else if (intelligence.fatal) {
      // Invalid URLs cannot own a website row, but their analyzer evidence is
      // still persisted against the business and remains available for lineage.
      for (const [fieldKey, value] of intelligenceObservations(intelligence)) {
        const id = await recordObservation(db, {
          subjectKind: "business",
          subjectId: ingestion.businessId,
          fieldKey,
          value,
          sourceId: ingestion.sourceId,
          sourceRecordId: ingestion.sourceRecordId,
          observedAt,
          confidence: "verified",
          verificationMethod: intelligence.analyzerVersion,
        });
        addEvidence(evidenceByField, fieldKey, { kind: "observation", id, field: fieldKey });
      }
    }
    log("INTELLIGENCE COMPLETE", {
      status: intelligenceStatus(intelligence),
      failureKind: intelligence.fatal?.failureKind,
      durationMs: intelligence.durationMs,
    });
  } else {
    log("INTELLIGENCE COMPLETE", { status: "skipped_no_website" });
  }

  const cutoff = new Date();
  await advanceIfInState(db, prospect.id, "enriching", "evaluated", "qualification-v2.intelligence-complete", correlationId, notes);

  const features = deriveQualificationFeaturesV2(
    {
      name: input.name,
      ...(input.industry ? { category: input.industry } : {}),
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
    },
    intelligence,
    {
      evidenceByField: Object.fromEntries(evidenceByField),
      ...(options.currentYear !== undefined ? { currentYear: options.currentYear } : {}),
      ...(persisted ? { websiteAnalysisId: persisted.analysisId } : {}),
    },
  );
  const featureSetId = await createFeatureSet(db, {
    prospectId: prospect.id,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION_V2,
    pipelineVersion: PIPELINE_VERSION_V2,
    asOf: cutoff,
    stable: features.stable,
    values: buildFeatureValues(features, setup.definitionIds),
    lineage: buildLineage(features.evidence, persisted?.analysisId),
  });
  log("SCORING V2", { featureSetId, featureCount: Object.keys(features.values).length });

  const score = calculateQualificationScoreV2(features);
  const leadScoreId = await createLeadScore(db, {
    prospectId: prospect.id,
    featureSetId,
    scoringVersionId: setup.scoringVersionId,
    overallScore: score.overall,
    needScore: score.dimensions.need,
    valueScore: score.dimensions.value,
    activityScore: score.dimensions.activity,
    reachabilityScore: score.dimensions.reachability,
    components: score.components.map((component) => ({
      dimension: component.dimension,
      componentKey: component.componentKey,
      result: component.result,
      direction: component.direction,
      reasonCode: component.reasonCode,
      contributingFeatures: {
        observedValue: component.observedValue,
        explanation: component.explanation,
        evidence: component.evidence,
        scoringVersion: SCORING_VERSION_V2,
      },
    })),
  });

  const suppressionIds = await activeQualificationSuppressions(db, ingestion.businessId);
  const decision = decideQualificationV2(features, score, { activeSuppressionIds: suppressionIds });
  const decisionId = await createDecision(db, {
    decisionType: decision.decisionType,
    resultCode: decision.resultCode,
    resultDetail: {
      summary: decision.summary,
      threshold: QUALIFICATION_THRESHOLD_V2,
      overallScore: score.overall,
      dimensions: score.dimensions,
      featureSetAsOf: cutoff.toISOString(),
      intelligenceStatus: features.intelligenceStatus,
      scoringVersion: SCORING_VERSION_V2,
    },
    policyVersion: DECISION_POLICY_VERSION_V2,
    actorType: "system",
    actorRef: "qualification.deep-intelligence-v2",
    businessId: ingestion.businessId,
    prospectId: prospect.id,
    featureSetId,
    leadScoreId,
    correlationId,
    reasons: decision.reasons.map((reason) => ({
      reasonCode: reason.reasonCode,
      contribution: reason.contribution,
      explanation: reason.explanation,
      ...(reason.featureRef ? { featureRef: reason.featureRef } : {}),
      ...(reason.evidence ? { evidenceKind: reason.evidence.kind, evidenceId: reason.evidence.id } : {}),
    })),
  });

  const targetState = decision.resultCode === "qualified" ? "qualified" : "rejected";
  if (features.intelligenceTransient) {
    const current = await getProspectById(db, prospect.id);
    notes.push(
      current?.lifecycleState === "evaluated"
        ? "kept lifecycle evaluated after transient intelligence failure; retry can append a conclusive v2 result"
        : `transient intelligence failure did not alter existing lifecycle ${current?.lifecycleState ?? "unknown"}; retry can append a conclusive v2 result`,
    );
  } else {
    await advanceIfInState(
      db,
      prospect.id,
      "evaluated",
      targetState,
      `qualification-v2.${decision.resultCode}`,
      correlationId,
      notes,
      decisionId,
    );
  }
  const finalProspect = await getProspectById(db, prospect.id);
  const targetFailure = isTargetFailure(intelligence);
  log(decision.resultCode === "qualified" ? "QUALIFIED" : "REJECTED", {
    score: score.overall,
    prospectId: prospect.id,
    targetFailure,
  });

  return {
    correlationId,
    sourceRecordId: ingestion.sourceRecordId,
    businessId: ingestion.businessId,
    businessCreated: ingestion.businessCreated,
    identityDisposition: ingestion.identityDisposition,
    ...(ingestion.crossSourceSignals ? { crossSourceSignals: ingestion.crossSourceSignals } : {}),
    prospectId: prospect.id,
    featureSetId,
    leadScoreId,
    decisionId,
    ...(persisted ? { websiteAnalysisId: persisted.analysisId } : {}),
    intelligenceStatus: features.intelligenceStatus,
    ...(intelligence?.fatal?.failureKind ? { intelligenceFailureKind: intelligence.fatal.failureKind } : {}),
    ...(intelligence?.fatal?.code ? { intelligenceFailureCode: intelligence.fatal.code } : {}),
    ...(intelligence?.fatal?.stage ? { intelligenceFatalStage: intelligence.fatal.stage } : {}),
    intelligenceTransient: features.intelligenceTransient,
    targetFailure,
    score: score.overall,
    dimensions: score.dimensions,
    decision: decision.resultCode,
    reasons: decision.reasons.map((reason) => reason.reasonCode),
    summary: decision.summary,
    lifecycleState: finalProspect?.lifecycleState ?? "unknown",
    notes,
  };
}

async function ensureQualificationV2Setup(db: Database) {
  const scoringVersionId = await ensureScoringVersion(db, {
    name: SCORING_VERSION_V2,
    inputSchemaVersion: FEATURE_SCHEMA_VERSION_V2,
    artifactVersion: SCORING_ARTIFACT_VERSION_V2,
    description: "Deterministic deep-intelligence qualification hypotheses; a priority score, not a conversion probability.",
  });
  const definitionIds = await ensureFeatureDefinitions(db, [...FEATURE_DEFINITION_SPECS_V2]);
  return { scoringVersionId, definitionIds };
}

async function ensureProspect(db: Database, businessId: string, correlationId: string, notes: string[]): Promise<ProspectRecord> {
  const existing = await findProspectForPursuit(db, { businessId });
  if (existing) {
    if (TERMINAL_STATES.includes(existing.lifecycleState)) {
      notes.push(`reusing closed prospect ${existing.id} (${existing.lifecycleState}); v2 history is appended without reopening it`);
    }
    return existing;
  }
  return openProspect(db, {
    businessId,
    actorType: "system",
    actorRef: "qualification.deep-intelligence-v2",
    reasonCode: "qualification-v2.discovered",
    correlationId,
  });
}

async function advanceIfInState(
  db: Database,
  prospectId: string,
  fromState: ProspectLifecycleState,
  toState: "enriching" | "evaluated" | "qualified" | "rejected",
  reasonCode: string,
  correlationId: string,
  notes: string[],
  decisionId?: string,
) {
  const current = await getProspectById(db, prospectId);
  if (!current) throw new Error(`Prospect ${prospectId} disappeared mid-pipeline.`);
  if (current.lifecycleState !== fromState) {
    notes.push(`skipped transition ${fromState} -> ${toState}: prospect is in ${current.lifecycleState}`);
    return;
  }
  await transitionProspect(db, {
    prospectId,
    expectedRevision: current.revision,
    toState,
    reasonCode,
    actorType: "system",
    actorRef: "qualification.deep-intelligence-v2",
    correlationId,
    ...(decisionId ? { decisionId } : {}),
  });
}

async function recordBaseEvidence(
  db: Database,
  ingestion: IngestionResult,
  input: ControlledBusinessInput,
  observedAt: Date,
): Promise<Array<{ id: string; fieldKey: string }>> {
  const rows: Array<{ id: string; fieldKey: string }> = [];
  const observe = async (subjectKind: SubjectKind, subjectId: string, fieldKey: string, value: ObservationValue) => {
    const id = await recordObservation(db, {
      subjectKind,
      subjectId,
      fieldKey,
      value,
      sourceId: ingestion.sourceId,
      sourceRecordId: ingestion.sourceRecordId,
      observedAt,
      confidence: "verified",
      verificationMethod: "deterministic-discovery-ingestion",
    });
    rows.push({ id, fieldKey });
  };
  await observe("business", ingestion.businessId, "email_available", { kind: "boolean", value: Boolean(input.email?.trim()) });
  await observe("business", ingestion.businessId, "phone_available", { kind: "boolean", value: Boolean(input.phone?.trim()) });
  await observe("business", ingestion.businessId, "website_present", { kind: "boolean", value: Boolean(input.websiteUrl?.trim()) });
  await observe("business", ingestion.businessId, "business_name", { kind: "text", value: input.name });
  await observe("business", ingestion.businessId, "business_category", { kind: "text", value: input.industry ?? "unknown" });
  return rows;
}

function buildFeatureValues(features: QualificationV2Features, definitionIds: Map<string, string>) {
  const values: Array<{ definitionId: string; value: FeatureValue }> = [];
  for (const [name, rawValue] of Object.entries(features.values)) {
    const definitionId = definitionIds.get(`qualification_v2.${name}`);
    if (!definitionId) throw new Error(`Feature definition qualification_v2.${name} is not registered.`);
    const value: FeatureValue = typeof rawValue === "boolean"
      ? { kind: "boolean", value: rawValue }
      : typeof rawValue === "number"
        ? { kind: "number", value: rawValue }
        : { kind: "text", value: rawValue };
    values.push({ definitionId, value });
  }
  return values;
}

function buildLineage(evidenceByFeature: Record<string, EvidenceRef[]>, analysisId?: string) {
  const seen = new Set<string>();
  const rows: Array<{ inputKind: "observation" | "website_analysis"; inputId: string; transformation: string }> = [];
  for (const refs of Object.values(evidenceByFeature)) {
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ inputKind: ref.kind, inputId: ref.id, transformation: "qualification-v2:derive" });
    }
  }
  if (analysisId && !seen.has(`website_analysis:${analysisId}`)) {
    rows.push({ inputKind: "website_analysis", inputId: analysisId, transformation: "qualification-v2:derive" });
  }
  return rows;
}

function addEvidence(map: Map<string, EvidenceRef[]>, field: string, ref: EvidenceRef) {
  map.set(field, [...(map.get(field) ?? []), ref]);
}

function intelligenceStatus(result: WebsiteIntelligenceResult): QualificationV2Features["intelligenceStatus"] {
  if (result.fatal) return "failed";
  return Object.values(result.stages).some((stage) => stage.status === "failed" || stage.status === "partial")
    ? "partial"
    : "complete";
}

function isTargetFailure(result: WebsiteIntelligenceResult | null): boolean {
  if (!result) return false;
  if (result.fatal) return true;
  return Object.values(result.stages).some((stage) => stage.status === "failed" || stage.status === "partial");
}
