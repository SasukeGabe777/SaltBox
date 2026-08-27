/**
 * Brand-intelligence persistence: append-only website_analysis rows under
 * analyzer `brand-intelligence-v1` with the full BrandProfile as structured
 * findings, plus a per-run source_record for provenance. Reuses the Phase 3
 * schema — no migration. Large binaries stay in .data/demo-assets; the
 * database stores only relative artifact references.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@saltbox/database/client";
import { ensureSource, linkSourceRecordToBusiness, upsertSourceRecord } from "@saltbox/database/repositories/sources";
import { recordWebsiteAnalysis } from "@saltbox/database/repositories/websites";
import { BRAND_INTELLIGENCE_VERSION, type BrandProfile } from "./types.ts";

export const BRAND_SOURCE_NAME = "brand_intelligence";

export interface PersistedBrandIntelligence {
  analysisId: string;
  sourceRecordId: string;
}

export async function persistBrandIntelligence(
  db: Database,
  input: { businessId: string; websiteId: string; profile: BrandProfile },
): Promise<PersistedBrandIntelligence> {
  const { profile } = input;
  const sourceId = await ensureSource(db, {
    name: BRAND_SOURCE_NAME,
    sourceType: "crawl",
    description: "Bounded deterministic brand/asset extraction from the business's public website (Phase 9).",
    retentionClass: "website-evidence",
  });
  const sourceRecord = await upsertSourceRecord(db, {
    sourceId,
    externalId: `run-${randomUUID()}`,
    retrievedAt: new Date(profile.collectedAt),
    sourceLocator: profile.finalUrl ?? profile.websiteUrl,
    providerMetadata: {
      analyzerVersion: profile.analyzerVersion,
      pagesInspected: profile.pagesInspected.map((page) => page.url),
      durationMs: profile.durationMs,
      assetBytesDownloaded: profile.assetBytesDownloaded,
    },
  });
  await linkSourceRecordToBusiness(db, sourceRecord.id, input.businessId);

  const analysisId = await recordWebsiteAnalysis(db, {
    websiteId: input.websiteId,
    analyzerVersion: BRAND_INTELLIGENCE_VERSION,
    findingsSchemaVersion: 1,
    structuredFindings: profile as unknown as Record<string, unknown>,
    confidence: profile.fatal ? "low" : "high",
    snapshotIds: [],
  });
  return { analysisId, sourceRecordId: sourceRecord.id };
}

/** Latest persisted brand profile for a business's websites, if any. */
export async function getLatestBrandProfile(
  db: Database,
  businessId: string,
): Promise<{ analysisId: string; calculatedAt: Date; profile: BrandProfile } | undefined> {
  const row = await db
    .selectFrom("website_analysis as wa")
    .innerJoin("business_website as bw", "bw.website_id", "wa.website_id")
    .select(["wa.id", "wa.calculated_at", "wa.structured_findings"])
    .where("bw.business_id", "=", businessId)
    .where("wa.analyzer_version", "=", BRAND_INTELLIGENCE_VERSION)
    .orderBy("wa.calculated_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  const findings = row.structured_findings;
  if (typeof findings !== "object" || findings === null || Array.isArray(findings)) return undefined;
  if ((findings as { kind?: unknown }).kind !== "brand-intelligence") return undefined;
  return {
    analysisId: row.id,
    calculatedAt: row.calculated_at,
    profile: findings as unknown as BrandProfile,
  };
}
