/** One operator-facing discovery -> deep-intelligence qualification v2 run. */

import type { Database } from "@saltbox/database/client";
import {
  qualifyBusinessV2,
  type QualifyV2Options,
  type QualificationV2Outcome,
} from "@saltbox/qualification/pipeline";
import type { BatchStatus } from "@saltbox/website-intelligence/batch-result";
import {
  normalizeDiscoveryQuery,
  type DiscoveryQuery,
  type DiscoveryQueryInput,
  type DiscoveryResult,
  type DiscoverySourceAdapter,
  type ResolvedLocation,
} from "../types.ts";

export const DEFAULT_ACQUIRE_LIMIT = 3;
export const MAX_ACQUIRE_LIMIT = 10;
export const DEFAULT_ACQUIRE_CONCURRENCY = 1;
export const MAX_ACQUIRE_CONCURRENCY = 2;

export type AcquireLog = (event: string, detail: Record<string, unknown>) => void;

export interface AcquireV2Options {
  concurrency?: number;
  analyzer?: QualifyV2Options["analyzer"];
  analyze?: QualifyV2Options["analyze"];
  artifactForCandidate?: (candidate: DiscoveryResult, index: number) => { artifactDir: string; artifactRef: string } | undefined;
  log?: AcquireLog;
  correlationId?: string;
  currentYear?: number;
}

export type AcquireCandidateResult =
  | { status: "completed"; index: number; candidate: DiscoveryResult; outcome: QualificationV2Outcome }
  | { status: "failed"; index: number; candidate: DiscoveryResult; errorClass: "pipeline_system_failure"; message: string };

export interface AcquireV2RunResult {
  status: BatchStatus;
  correlationId: string;
  query: DiscoveryQuery;
  resolvedLocation: ResolvedLocation;
  source: string;
  adapterVersion: string;
  elapsedMs: number;
  discovered: number;
  analyzed: number;
  newBusinesses: number;
  rediscovered: number;
  crossSourceLinked: number;
  ambiguousMatches: number;
  qualified: number;
  rejected: number;
  targetFailures: number;
  systemFailures: number;
  results: AcquireCandidateResult[];
}

export async function discoverAndAcquireV2(
  db: Database,
  input: DiscoveryQueryInput,
  adapter: DiscoverySourceAdapter,
  options: AcquireV2Options = {},
): Promise<AcquireV2RunResult> {
  const startedAt = Date.now();
  const query = normalizeDiscoveryQuery(input);
  if (query.source !== adapter.source) throw new Error(`Discovery source "${query.source}" does not match adapter "${adapter.source}".`);
  if (query.limit > MAX_ACQUIRE_LIMIT) throw new Error(`Acquire limit must be between 1 and ${MAX_ACQUIRE_LIMIT}.`);
  const concurrency = options.concurrency ?? DEFAULT_ACQUIRE_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_ACQUIRE_CONCURRENCY) {
    throw new Error(`Deep-intelligence concurrency must be between 1 and ${MAX_ACQUIRE_CONCURRENCY}.`);
  }
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const log = options.log ?? (() => {});

  log("run-started", { correlationId, source: adapter.source, query });
  const resolvedLocation = await adapter.resolveLocation(query.location);
  log("location-resolved", { location: resolvedLocation.displayName, latitude: resolvedLocation.latitude, longitude: resolvedLocation.longitude });
  const batch = await adapter.discover(query, resolvedLocation);
  log("candidates-discovered", { candidateCount: batch.candidates.length, sourceDataTimestamp: batch.sourceDataTimestamp });

  const results: Array<AcquireCandidateResult | undefined> = new Array(batch.candidates.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      const candidate = batch.candidates[index];
      if (!candidate) return;
      const artifact = options.artifactForCandidate?.(candidate, index);
      const candidateStarted = Date.now();
      log("candidate-started", { index: index + 1, candidateCount: batch.candidates.length, businessName: candidate.name, externalId: candidate.externalId });
      try {
        const outcome = await qualifyBusinessV2(
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
            correlationId,
            ...(options.analyze ? { analyze: options.analyze } : {}),
            ...(options.currentYear !== undefined ? { currentYear: options.currentYear } : {}),
            ...(artifact ? { artifactRef: artifact.artifactRef } : {}),
            analyzer: {
              ...options.analyzer,
              ...(artifact ? { artifactDir: artifact.artifactDir } : {}),
              log: (message) => log("intelligence-progress", { index: index + 1, businessName: candidate.name, message }),
            },
            log: (stage, detail) => log("pipeline-stage", { index: index + 1, businessName: candidate.name, stage, ...(detail ?? {}) }),
          },
        );
        results[index] = { status: "completed", index: index + 1, candidate, outcome };
        log("candidate-completed", {
          index: index + 1,
          businessName: candidate.name,
          businessId: outcome.businessId,
          prospectId: outcome.prospectId,
          score: outcome.score,
          decision: outcome.decision,
          intelligenceStatus: outcome.intelligenceStatus,
          targetFailure: outcome.targetFailure,
          elapsedMs: Date.now() - candidateStarted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results[index] = { status: "failed", index: index + 1, candidate, errorClass: "pipeline_system_failure", message };
        log("candidate-failed", { index: index + 1, businessName: candidate.name, errorClass: "pipeline_system_failure", message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, batch.candidates.length)) }, () => worker()));

  const completed = results.filter((result): result is AcquireCandidateResult => result !== undefined);
  const successes = completed.filter((result): result is Extract<AcquireCandidateResult, { status: "completed" }> => result.status === "completed");
  const systemFailures = completed.filter((result) => result.status === "failed").length;
  const targetFailures = successes.filter((result) => result.outcome.targetFailure).length;
  const analyzable = successes.filter((result) => result.candidate.websiteUrl !== null);
  const globallyUnavailable = analyzable.length > 0 && analyzable.every((result) => result.outcome.intelligenceFatalStage === "browser_unavailable");
  const status: BatchStatus = systemFailures > 0 || globallyUnavailable
    ? "failed"
    : targetFailures > 0
      ? "completed_with_target_failures"
      : "completed";
  const run: AcquireV2RunResult = {
    status,
    correlationId,
    query,
    resolvedLocation,
    source: batch.source,
    adapterVersion: batch.adapterVersion,
    elapsedMs: Date.now() - startedAt,
    discovered: batch.candidates.length,
    analyzed: successes.length,
    newBusinesses: successes.filter((result) => result.outcome.businessCreated).length,
    rediscovered: successes.filter((result) => !result.outcome.businessCreated && result.outcome.identityDisposition !== "cross_source_linked").length,
    crossSourceLinked: successes.filter((result) => result.outcome.identityDisposition === "cross_source_linked").length,
    ambiguousMatches: successes.filter((result) => result.outcome.identityDisposition === "created_ambiguous").length,
    qualified: successes.filter((result) => result.outcome.decision === "qualified").length,
    rejected: successes.filter((result) => result.outcome.decision === "rejected").length,
    targetFailures,
    systemFailures,
    results: completed,
  };
  log("run-completed", { status, elapsedMs: run.elapsedMs, discovered: run.discovered, qualified: run.qualified, rejected: run.rejected, targetFailures, systemFailures });
  return run;
}
