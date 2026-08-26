/**
 * Web-evidence persistence (ADR-004: domain identity, logical website,
 * immutable snapshots, versioned analyses). Identity is idempotent; snapshots
 * and analyses are append-only history.
 */

import type { Database } from "../client/kysely.ts";
import type { ConfidenceBand } from "../generated/db.ts";

export async function ensureDomain(db: Database, host: string): Promise<string> {
  const normalized = host.trim().toLowerCase();
  await db
    .insertInto("domain")
    .values({ host: normalized, registrable_domain: normalized })
    .onConflict((oc) => oc.column("host").doNothing())
    .execute();
  const row = await db.selectFrom("domain").select("id").where("host", "=", normalized).executeTakeFirstOrThrow();
  return row.id;
}

export interface EnsureBusinessWebsiteInput {
  businessId: string;
  domainId: string;
  canonicalUrl: string;
}

/**
 * Find the website already associated with the domain, or create the
 * website + domain association + business association. The business/website
 * primary flags are set only when no primary exists yet.
 */
export async function ensureBusinessWebsite(db: Database, input: EnsureBusinessWebsiteInput): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("website_domain")
      .select("website_id")
      .where("domain_id", "=", input.domainId)
      .executeTakeFirst();

    let websiteId: string;
    if (existing) {
      websiteId = existing.website_id;
    } else {
      const website = await trx
        .insertInto("website")
        .values({ canonical_url: input.canonicalUrl })
        .returning("id")
        .executeTakeFirstOrThrow();
      websiteId = website.id;
      const hasPrimaryDomain = await trx
        .selectFrom("website_domain")
        .select("website_id")
        .where("website_id", "=", websiteId)
        .where("is_primary", "=", true)
        .executeTakeFirst();
      await trx
        .insertInto("website_domain")
        .values({
          website_id: websiteId,
          domain_id: input.domainId,
          is_primary: hasPrimaryDomain === undefined,
        })
        .execute();
    }

    const linked = await trx
      .selectFrom("business_website")
      .select("website_id")
      .where("business_id", "=", input.businessId)
      .where("website_id", "=", websiteId)
      .executeTakeFirst();
    if (!linked) {
      const hasPrimary = await trx
        .selectFrom("business_website")
        .select("website_id")
        .where("business_id", "=", input.businessId)
        .where("is_primary", "=", true)
        .executeTakeFirst();
      await trx
        .insertInto("business_website")
        .values({
          business_id: input.businessId,
          website_id: websiteId,
          is_primary: hasPrimary === undefined,
        })
        .execute();
    }

    return websiteId;
  });
}

export interface RecordSnapshotInput {
  websiteId: string;
  requestedUrl: string;
  finalUrl?: string;
  crawlScope?: string;
  httpStatus?: number;
  httpsOk?: boolean;
  redirectChain?: string[];
  contentHash?: string;
  observedAt: Date;
  captureToolVersion: string;
}

/** Append an immutable capture manifest. HTML itself is never stored here. */
export async function recordWebsiteSnapshot(db: Database, input: RecordSnapshotInput): Promise<string> {
  const row = await db
    .insertInto("website_snapshot")
    .values({
      website_id: input.websiteId,
      requested_url: input.requestedUrl,
      final_url: input.finalUrl ?? null,
      ...(input.crawlScope !== undefined ? { crawl_scope: input.crawlScope } : {}),
      http_status: input.httpStatus ?? null,
      https_ok: input.httpsOk ?? null,
      redirect_chain: input.redirectChain ? JSON.stringify(input.redirectChain) : null,
      content_hash: input.contentHash ?? null,
      observed_at: input.observedAt,
      capture_tool_version: input.captureToolVersion,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface RecordAnalysisInput {
  websiteId: string;
  analyzerVersion: string;
  findingsSchemaVersion: number;
  structuredFindings: Record<string, unknown>;
  confidence?: ConfidenceBand;
  snapshotIds: string[];
}

/** Append a versioned analysis linked to the snapshots it was derived from. */
export async function recordWebsiteAnalysis(db: Database, input: RecordAnalysisInput): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const analysis = await trx
      .insertInto("website_analysis")
      .values({
        website_id: input.websiteId,
        analyzer_version: input.analyzerVersion,
        findings_schema_version: input.findingsSchemaVersion,
        structured_findings: JSON.stringify(input.structuredFindings),
        confidence: input.confidence ?? "high",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const snapshotId of input.snapshotIds) {
      await trx
        .insertInto("website_analysis_snapshot")
        .values({ website_analysis_id: analysis.id, website_snapshot_id: snapshotId })
        .execute();
    }
    return analysis.id;
  });
}
