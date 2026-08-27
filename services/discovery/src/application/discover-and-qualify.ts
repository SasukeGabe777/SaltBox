import type { Database } from "@saltbox/database/client";
import {
  qualifyBusiness,
  type QualifyOptions,
  type QualificationOutcome,
} from "@saltbox/prospecting/pipeline";
import {
  DEFAULT_QUALIFICATION_CONCURRENCY,
  MAX_QUALIFICATION_CONCURRENCY,
  normalizeDiscoveryQuery,
  type DiscoveryQuery,
  type DiscoveryQueryInput,
  type DiscoveryResult,
  type DiscoverySourceAdapter,
  type ResolvedLocation,
} from "../types.ts";

export type DiscoveryRunLog = (event: string, detail: Record<string, unknown>) => void;

export interface DiscoverAndQualifyOptions {
  concurrency?: number;
  analyzer?: QualifyOptions["analyzer"];
  log?: DiscoveryRunLog;
  correlationId?: string;
}

export interface DiscoveryQualificationSuccess {
  status: "completed";
  index: number;
  candidate: DiscoveryResult;
  outcome: QualificationOutcome;
}

export interface DiscoveryQualificationFailure {
  status: "failed";
  index: number;
  candidate: DiscoveryResult;
  errorClass: "pipeline_system_failure";
  message: string;
}

export type DiscoveryQualificationResult = DiscoveryQualificationSuccess | DiscoveryQualificationFailure;

export interface DiscoveryRunResult {
  correlationId: string;
  query: DiscoveryQuery;
  resolvedLocation: ResolvedLocation;
  source: string;
  adapterVersion: string;
  discovered: number;
  newBusinesses: number;
  rediscovered: number;
  analyzed: number;
  qualified: number;
  rejected: number;
  failed: number;
  results: DiscoveryQualificationResult[];
}

export async function discoverAndQualify(
  db: Database,
  input: DiscoveryQueryInput,
  adapter: DiscoverySourceAdapter,
  options: DiscoverAndQualifyOptions = {},
): Promise<DiscoveryRunResult> {
  const query = normalizeDiscoveryQuery(input);
  if (query.source !== adapter.source) {
    throw new Error(`Discovery source "${query.source}" does not match adapter "${adapter.source}".`);
  }
  const concurrency = options.concurrency ?? DEFAULT_QUALIFICATION_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_QUALIFICATION_CONCURRENCY) {
    throw new Error(`Qualification concurrency must be between 1 and ${MAX_QUALIFICATION_CONCURRENCY}.`);
  }

  const correlationId = options.correlationId ?? crypto.randomUUID();
  const log: DiscoveryRunLog = options.log ?? (() => {});
  log("run-started", { correlationId, source: adapter.source, query });

  const resolvedLocation = await adapter.resolveLocation(query.location);
  log("location-resolved", {
    correlationId,
    source: adapter.source,
    location: resolvedLocation.displayName,
    latitude: resolvedLocation.latitude,
    longitude: resolvedLocation.longitude,
  });

  const batch = await adapter.discover(query, resolvedLocation);
  log("candidates-discovered", {
    correlationId,
    source: adapter.source,
    query,
    candidateCount: batch.candidates.length,
    sourceDataTimestamp: batch.sourceDataTimestamp,
  });

  const results: Array<DiscoveryQualificationResult | undefined> = new Array(batch.candidates.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const candidate = batch.candidates[index];
      if (!candidate) return;
      log("candidate-started", {
        correlationId,
        source: candidate.source,
        index: index + 1,
        candidateCount: batch.candidates.length,
        externalId: candidate.externalId,
        businessName: candidate.name,
        websitePresent: candidate.websiteUrl !== null,
      });
      try {
        const outcome = await qualifyBusiness(
          db,
          {
            name: candidate.name,
            source: candidate.source,
            externalId: candidate.externalId,
            sourceType: candidate.sourceType,
            sourceDescription: candidate.sourceDescription,
            sourceRetentionClass: candidate.sourceRetentionClass,
            sourceLocator: candidate.sourceLocator,
            sourceRetrievedAt: new Date(candidate.retrievedAt),
            sourceContentHash: candidate.contentHash,
            sourceMetadata: candidate.metadata,
            industry: candidate.category,
            ...(candidate.websiteUrl !== null ? { websiteUrl: candidate.websiteUrl } : {}),
            ...(candidate.phone !== null ? { phone: candidate.phone } : {}),
            ...(candidate.email !== null ? { email: candidate.email } : {}),
            ...(candidate.city !== null ? { city: candidate.city } : {}),
            ...(candidate.state !== null ? { state: candidate.state } : {}),
          },
          {
            ...(options.analyzer !== undefined ? { analyzer: options.analyzer } : {}),
            correlationId,
            log: (stage, detail) =>
              log("pipeline-stage", {
                correlationId,
                source: candidate.source,
                externalId: candidate.externalId,
                businessName: candidate.name,
                stage,
                ...(detail ?? {}),
              }),
          },
        );
        results[index] = { status: "completed", index: index + 1, candidate, outcome };
        log("candidate-completed", {
          correlationId,
          source: candidate.source,
          index: index + 1,
          externalId: candidate.externalId,
          businessName: candidate.name,
          businessId: outcome.businessId,
          prospectId: outcome.prospectId,
          score: outcome.score,
          decision: outcome.decision,
          businessCreated: outcome.businessCreated,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown qualification failure";
        results[index] = {
          status: "failed",
          index: index + 1,
          candidate,
          errorClass: "pipeline_system_failure",
          message,
        };
        log("candidate-failed", {
          correlationId,
          source: candidate.source,
          index: index + 1,
          externalId: candidate.externalId,
          businessName: candidate.name,
          errorClass: "pipeline_system_failure",
          message,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(batch.candidates.length, 1)) }, () => worker()),
  );
  const completedResults = results.filter((result): result is DiscoveryQualificationResult => result !== undefined);
  const successes = completedResults.filter(
    (result): result is DiscoveryQualificationSuccess => result.status === "completed",
  );
  const run: DiscoveryRunResult = {
    correlationId,
    query,
    resolvedLocation,
    source: batch.source,
    adapterVersion: batch.adapterVersion,
    discovered: batch.candidates.length,
    newBusinesses: successes.filter((result) => result.outcome.businessCreated).length,
    rediscovered: successes.filter((result) => !result.outcome.businessCreated).length,
    analyzed: successes.length,
    qualified: successes.filter((result) => result.outcome.decision === "qualified").length,
    rejected: successes.filter((result) => result.outcome.decision === "rejected").length,
    failed: completedResults.filter((result) => result.status === "failed").length,
    results: completedResults,
  };
  log("run-completed", {
    correlationId,
    source: batch.source,
    discovered: run.discovered,
    newBusinesses: run.newBusinesses,
    rediscovered: run.rediscovered,
    analyzed: run.analyzed,
    qualified: run.qualified,
    rejected: run.rejected,
    failed: run.failed,
  });
  return run;
}
