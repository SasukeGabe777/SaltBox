/**
 * Resolve which businesses/websites an intelligence run should analyze.
 * Selection reuses the tested admin list query for category/status filters;
 * the primary website is resolved per business. A missing website is a valid
 * target state ("NO WEBSITE TO ANALYZE"), never an error.
 */

import type { Database } from "@saltbox/database/client";
import { listProspects, type ProspectListFilters } from "@saltbox/database/queries/admin";

export interface IntelligenceTarget {
  businessId: string;
  prospectId: string | null;
  businessName: string;
  category: string | null;
  websiteId: string | null;
  websiteUrl: string | null;
  qualificationScore: number | null;
  decision: string | null;
}

export async function targetsByFilters(
  db: Database,
  filters: { category?: string; status?: "qualified" | "rejected"; limit: number },
): Promise<IntelligenceTarget[]> {
  const listFilters: ProspectListFilters = {
    ...(filters.category !== undefined ? { category: filters.category } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : { status: "all" }),
  };
  const rows = await listProspects(db, listFilters);
  const targets: IntelligenceTarget[] = [];
  for (const row of rows.slice(0, filters.limit)) {
    targets.push({
      businessId: row.businessId,
      prospectId: row.prospectId,
      businessName: row.businessName,
      category: row.category,
      websiteId: await primaryWebsiteId(db, row.businessId),
      websiteUrl: row.websiteUrl,
      qualificationScore: row.overallScore,
      decision: row.decision,
    });
  }
  return targets;
}

export async function targetByProspect(db: Database, prospectId: string): Promise<IntelligenceTarget | null> {
  const row = await db
    .selectFrom("prospect")
    .innerJoin("business", "business.id", "prospect.business_id")
    .select(["prospect.id as prospect_id", "business.id as business_id", "business.canonical_name", "business.category"])
    .where("prospect.id", "=", prospectId)
    .executeTakeFirst();
  if (!row) return null;
  return hydrate(db, row.business_id, row.prospect_id, row.canonical_name, row.category);
}

export async function targetByBusiness(db: Database, businessId: string): Promise<IntelligenceTarget | null> {
  const row = await db
    .selectFrom("business")
    .select(["id", "canonical_name", "category"])
    .where("id", "=", businessId)
    .executeTakeFirst();
  if (!row) return null;
  return hydrate(db, row.id, null, row.canonical_name, row.category);
}

async function hydrate(
  db: Database,
  businessId: string,
  prospectId: string | null,
  businessName: string,
  category: string | null,
): Promise<IntelligenceTarget> {
  const website = await primaryWebsite(db, businessId);
  return {
    businessId,
    prospectId,
    businessName,
    category,
    websiteId: website?.id ?? null,
    websiteUrl: website?.canonicalUrl ?? null,
    qualificationScore: null,
    decision: null,
  };
}

async function primaryWebsite(db: Database, businessId: string): Promise<{ id: string; canonicalUrl: string } | null> {
  const row = await db
    .selectFrom("business_website")
    .innerJoin("website", "website.id", "business_website.website_id")
    .select(["website.id", "website.canonical_url"])
    .where("business_website.business_id", "=", businessId)
    .orderBy("business_website.is_primary", "desc")
    .orderBy("website.created_at")
    .executeTakeFirst();
  return row && row.canonical_url !== null ? { id: row.id, canonicalUrl: row.canonical_url } : null;
}

async function primaryWebsiteId(db: Database, businessId: string): Promise<string | null> {
  return (await primaryWebsite(db, businessId))?.id ?? null;
}
