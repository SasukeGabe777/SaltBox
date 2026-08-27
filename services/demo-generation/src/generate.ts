/**
 * Demo generation orchestration (demo-generation-pipeline-v2):
 *
 *   eligibility -> facts -> DemoPlan -> DemoContent -> composition selection
 *   -> Demo identity -> append-only DemoVersion -> public locator
 *
 * Regeneration is idempotent for unchanged inputs (same content hash + same
 * template version = no new version unless forced) and append-only when
 * anything changed. Old versions are never mutated.
 *
 * Phase 10: generation NEVER approves. A newly generated version becomes the
 * demo's current version for operator review, while the approved-version
 * pointer stays exactly where the operator last put it. No outreach is ever
 * triggered from here.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@saltbox/database/client";
import {
  appendDemoVersion,
  createDemo,
  ensureActiveDemoLocator,
  ensureDemoTemplateVersion,
  getDemoById,
  getDemoForProspect,
  getLatestDemoVersion,
  updateDemo,
  type DemoRecord,
} from "@saltbox/database/repositories/demos";
import { appendEvent } from "@saltbox/database/repositories/events";
import {
  COMPOSITIONS,
  DEMO_CONTENT_VERSION,
  DEMO_COPY_VERSION,
  DEMO_PIPELINE_VERSION,
  type CompositionKey,
} from "./config/demo-v1.ts";
import { buildDemoContent } from "./content.ts";
import { evaluateDemoEligibility, type DemoEligibility } from "./eligibility.ts";
import { collectDemoSourceFacts } from "./facts.ts";
import { buildDemoPlan } from "./plan.ts";
import type { DemoContent, DemoPlan, DemoSourceFacts } from "./types.ts";

export const DEFAULT_DEMOS_BASE_URL = "http://127.0.0.1:5175";

export type GenerateDemoLog = (stage: string, detail?: Record<string, unknown>) => void;

/**
 * Runs brand extraction for a prospect and persists the profile. Injected by
 * the CLI (real Chromium extraction) or by tests; generation itself never
 * touches the network.
 */
export type BrandExtractor = (facts: DemoSourceFacts) => Promise<void>;

export interface GenerateDemoOptions {
  /** Append a new version even when content and template are unchanged. */
  forceRegenerate?: boolean;
  /**
   * Explicit controlled-testing override for overridable eligibility
   * failures. Never clears suppression or template availability, and never
   * implies the prospect became qualified.
   */
  overrideIneligible?: { note: string };
  /** Base URL used only for reporting the viewable demo URL. */
  baseUrl?: string;
  /** Runs and persists brand intelligence when none exists (or when refreshing). */
  brandExtractor?: BrandExtractor;
  /** Re-run brand extraction even when a persisted profile exists. */
  refreshBrand?: boolean;
  /**
   * Phase 10 operator regeneration intent: force one of the committed Phase 9
   * compositions instead of the deterministic choice. Recorded in the plan.
   */
  composition?: CompositionKey;
  /** Free-text operator reason recorded with a regeneration. */
  regenerationReason?: string;
  /** Operator identity recorded on generation events (defaults to the pipeline). */
  actorRef?: string;
  log?: GenerateDemoLog;
}

export interface GeneratedDemoSummary {
  prospectId: string;
  businessId: string;
  businessName: string;
  demoId: string;
  demoStatus: string;
  demoVersionId: string;
  versionNumber: number;
  templateName: string;
  templateVersion: string;
  contentHash: string;
  locatorToken: string;
  url: string;
  deficiencyCodes: string[];
  plan: DemoPlan;
  /** The demo's approved version, which generation never changes (Phase 10). */
  approvedDemoVersionId: string | null;
  /** True when this exact version is the approved one. */
  isApproved: boolean;
}

export type GenerateDemoResult =
  | { status: "generated"; summary: GeneratedDemoSummary }
  | { status: "unchanged"; summary: GeneratedDemoSummary }
  | { status: "ineligible"; prospectId: string; eligibility: DemoEligibility }
  | { status: "not_found"; prospectId: string };

export async function generateDemoForProspect(
  db: Database,
  prospectId: string,
  options: GenerateDemoOptions = {},
): Promise<GenerateDemoResult> {
  const log = options.log ?? (() => {});
  const baseUrl = (options.baseUrl ?? DEFAULT_DEMOS_BASE_URL).replace(/\/+$/, "");

  let facts = await collectDemoSourceFacts(db, prospectId);
  if (!facts) return { status: "not_found", prospectId };
  log("FACTS", { businessName: facts.businessName, category: facts.category, brand: facts.brand !== undefined });

  // Brand intelligence: run once when missing (or when explicitly refreshed).
  // Failure is never fatal — generation proceeds on deterministic fallbacks.
  if (options.brandExtractor && facts.websiteUrl && (facts.brand === undefined || options.refreshBrand === true)) {
    try {
      log("BRAND EXTRACTION", { websiteUrl: facts.websiteUrl, refresh: options.refreshBrand === true });
      await options.brandExtractor(facts);
      facts = (await collectDemoSourceFacts(db, prospectId)) ?? facts;
    } catch (error) {
      log("BRAND EXTRACTION FAILED", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  const eligibility = evaluateDemoEligibility(facts);
  let override: { flag: string; note: string } | undefined;
  if (!eligibility.eligible) {
    const canOverride = options.overrideIneligible !== undefined && eligibility.blocking.length === 0;
    if (!canOverride) {
      log("INELIGIBLE", { reasons: eligibility.reasons.map((reason) => reason.code) });
      return { status: "ineligible", prospectId, eligibility };
    }
    override = {
      flag: "override-ineligible",
      note: `${options.overrideIneligible!.note} (bypassed: ${eligibility.reasons.map((reason) => reason.code).join(", ")}; qualification history is unchanged)`,
    };
    log("OVERRIDE", { bypassed: eligibility.reasons.map((reason) => reason.code) });
  }

  const plan = buildDemoPlan(facts, {
    ...(override ? { override } : {}),
    ...(options.composition ? { compositionOverride: options.composition } : {}),
  });
  const content = buildDemoContent(facts, plan);
  log("PLANNED", {
    template: plan.template.templateName,
    deficiencies: plan.deficiencies.length,
    sections: plan.sections.length,
  });

  const compositionEntry = Object.values(COMPOSITIONS).find(
    (composition) => composition.templateName === plan.template.templateName,
  );
  const template = await ensureDemoTemplateVersion(db, {
    name: plan.template.templateName,
    description: "Reusable local-service-business demo composition (Phase 9).",
    version: plan.template.templateVersion,
    ...(compositionEntry ? { artifactRef: compositionEntry.artifactRef } : {}),
  });
  const contentHash = demoContentHash(content, plan.template.templateName, plan.template.templateVersion);

  let demo = await getDemoForProspect(db, prospectId);
  if (!demo) {
    demo = await createDemo(db, {
      prospectId,
      concept: `${plan.template.templateName} demo (${facts.category ?? "uncategorized"})`,
    });
    log("DEMO CREATED", { demoId: demo.id });
  }

  const latest = await getLatestDemoVersion(db, demo.id);
  const unchanged =
    latest !== undefined &&
    latest.contentHash === contentHash &&
    latest.demoTemplateVersionId === template.demoTemplateVersionId &&
    options.forceRegenerate !== true;

  if (unchanged) {
    // Repair pointers if a previous run was interrupted, then report as-is.
    if (demo.currentDemoVersionId !== latest.id || demo.status !== "ready") {
      await updateDemo(db, {
        demoId: demo.id,
        expectedRevision: demo.revision,
        status: "ready",
        currentDemoVersionId: latest.id,
      });
      demo = (await getDemoById(db, demo.id)) ?? demo;
    }
    const locator = await ensureActiveDemoLocator(db, { demoId: demo.id, token: newLocatorToken() });
    log("UNCHANGED", { demoId: demo.id, versionNumber: latest.versionNumber });
    return {
      status: "unchanged",
      summary: buildSummary(facts, demo, latest.id, latest.versionNumber, plan, contentHash, locator.token, baseUrl),
    };
  }

  const generating = await updateDemo(db, { demoId: demo.id, expectedRevision: demo.revision, status: "generating" });
  if (!generating) throw new Error(`Demo ${demo.id} was modified concurrently; rerun generation.`);
  const generatingRevision = demo.revision + 1;

  try {
    const generatedAt = new Date();
    const version = await appendDemoVersion(db, {
      demoId: demo.id,
      demoTemplateVersionId: template.demoTemplateVersionId,
      ...(facts.latestQualification ? { featureSetId: facts.latestQualification.featureSetId } : {}),
      contentInputVersion: DEMO_CONTENT_VERSION,
      generatedContentVersion: DEMO_COPY_VERSION,
      contentHash,
      publishedAt: generatedAt,
      generatorMetadata: {
        pipelineVersion: DEMO_PIPELINE_VERSION,
        generatedAt: generatedAt.toISOString(),
        ...(options.regenerationReason ? { regenerationReason: options.regenerationReason } : {}),
        ...(options.composition ? { requestedComposition: options.composition } : {}),
        plan,
        planSummary: planSummary(plan),
        content,
      },
    });
    const finalized = await updateDemo(db, {
      demoId: demo.id,
      expectedRevision: generatingRevision,
      status: "ready",
      currentDemoVersionId: version.id,
    });
    if (!finalized) throw new Error(`Demo ${demo.id} was modified concurrently while finalizing.`);
    const locator = await ensureActiveDemoLocator(db, { demoId: demo.id, token: newLocatorToken() });
    // Phase 10: generation announces a version awaiting review. Becoming
    // publicly visible is a separate, later event emitted by publication.
    const regeneration = latest !== undefined;
    await appendEvent(db, {
      category: "domain",
      eventType: regeneration ? "demo_regenerated" : "demo_generated",
      occurredAt: generatedAt,
      sourceProducer: DEMO_PIPELINE_VERSION,
      actorType: options.actorRef ? "operator" : "system",
      actorRef: options.actorRef ?? "demo-generation.local-service-v1",
      idempotencyScope: regeneration ? "demo_regenerated" : "demo_generated",
      idempotencyKey: version.id,
      businessId: facts.businessId,
      prospectId,
      demoVersionId: version.id,
      properties: {
        versionNumber: version.versionNumber,
        templateName: plan.template.templateName,
        templateVersion: plan.template.templateVersion,
        contentHash,
        // Explicitly recorded so the audit trail shows approval did not move.
        approvedDemoVersionId: demo.approvedDemoVersionId,
        approvalMoved: false,
        ...(options.regenerationReason ? { regenerationReason: options.regenerationReason } : {}),
      },
    });
    const refreshed = (await getDemoById(db, demo.id)) ?? demo;
    log("GENERATED", { demoId: demo.id, demoVersionId: version.id, versionNumber: version.versionNumber });
    return {
      status: "generated",
      summary: buildSummary(facts, refreshed, version.id, version.versionNumber, plan, contentHash, locator.token, baseUrl),
    };
  } catch (error) {
    // Best-effort: return the demo to draft so a failed run is visible and retryable.
    const current = await getDemoById(db, demo.id);
    if (current && current.status === "generating") {
      await updateDemo(db, { demoId: demo.id, expectedRevision: current.revision, status: "draft" });
    }
    throw error;
  }
}

function buildSummary(
  facts: DemoSourceFacts,
  demo: DemoRecord,
  demoVersionId: string,
  versionNumber: number,
  plan: DemoPlan,
  contentHash: string,
  locatorToken: string,
  baseUrl: string,
): GeneratedDemoSummary {
  return {
    prospectId: facts.prospectId,
    businessId: facts.businessId,
    businessName: facts.businessName,
    demoId: demo.id,
    demoStatus: demo.status,
    demoVersionId,
    versionNumber,
    templateName: plan.template.templateName,
    templateVersion: plan.template.templateVersion,
    contentHash,
    locatorToken,
    url: `${baseUrl}/d/${locatorToken}`,
    deficiencyCodes: plan.deficiencies.map((deficiency) => deficiency.code),
    plan,
    approvedDemoVersionId: demo.approvedDemoVersionId,
    isApproved: demo.approvedDemoVersionId === demoVersionId,
  };
}

/** Bounded plan digest surfaced to the read-only admin. */
function planSummary(plan: DemoPlan): Record<string, unknown> {
  return {
    planVersion: plan.planVersion,
    template: plan.template,
    deficiencyCodes: plan.deficiencies.map((deficiency) => deficiency.code),
    deficiencies: plan.deficiencies.map((deficiency) => ({
      code: deficiency.code,
      addressedBy: deficiency.addressedBy,
    })),
    ...(plan.brand !== undefined ? { brand: plan.brand } : {}),
    sections: plan.sections,
    ctaRationale: plan.ctaStrategy.rationale,
    fallbacks: plan.fallbacks,
    ...(plan.override ? { override: plan.override } : {}),
  };
}

/** Stable content hash: same content + template => same hash across runs. */
export function demoContentHash(content: DemoContent, templateName: string, templateVersion: string): string {
  return createHash("sha256")
    .update(stableStringify({ templateName, templateVersion, content }))
    .digest("hex");
}

/** Deterministic JSON with sorted object keys. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Opaque, unguessable, URL-safe locator token (invariant 19). */
export function newLocatorToken(): string {
  return randomBytes(18).toString("base64url");
}

export { collectDemoSourceFacts } from "./facts.ts";
export { evaluateDemoEligibility } from "./eligibility.ts";
