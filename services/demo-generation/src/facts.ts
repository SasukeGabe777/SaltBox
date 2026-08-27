/**
 * Deterministic fact collection for demo generation.
 *
 * Everything comes from persisted SaltBox state — discovery provenance,
 * contact methods, website identity, and the latest deep-intelligence
 * analysis. Nothing here recrawls the internet; Phase 6/7 evidence is the
 * source of truth, and each fact keeps a reference to where it came from.
 */

import type { Database } from "@saltbox/database/client";
import { activeQualificationSuppressions } from "@saltbox/database/repositories/suppressions";
import type { DemoSourceFacts } from "./types.ts";

export async function collectDemoSourceFacts(db: Database, prospectId: string): Promise<DemoSourceFacts | undefined> {
  const header = await db
    .selectFrom("prospect")
    .innerJoin("business", "business.id", "prospect.business_id")
    .select([
      "prospect.id as prospect_id",
      "prospect.lifecycle_state",
      "business.id as business_id",
      "business.canonical_name",
      "business.category",
      "business.status as business_status",
    ])
    .where("prospect.id", "=", prospectId)
    .executeTakeFirst();
  if (!header) return undefined;

  const [contacts, discoveryRecord, website, intelligence, brand, qualification, suppressionIds] = await Promise.all([
    db
      .selectFrom("contact_method")
      .select(["id", "channel", "normalized_value", "display_value"])
      .where("business_id", "=", header.business_id)
      .orderBy("created_at", "asc")
      .execute(),
    db
      .selectFrom("source_record as sr")
      .innerJoin("source as src", "src.id", "sr.source_id")
      .select(["sr.id", "sr.provider_metadata", "src.name as source_name"])
      .where("sr.business_id", "=", header.business_id)
      .where("src.source_type", "!=", "crawl")
      .orderBy("sr.retrieved_at", (order) => order.desc().nullsLast())
      .orderBy("sr.created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("business_website as bw")
      .innerJoin("website as web", "web.id", "bw.website_id")
      .select(["web.id", "web.canonical_url"])
      .where("bw.business_id", "=", header.business_id)
      .orderBy("bw.is_primary", "desc")
      .orderBy("bw.created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("website_analysis as wa")
      .innerJoin("business_website as bw", "bw.website_id", "wa.website_id")
      .select(["wa.id", "wa.analyzer_version", "wa.calculated_at", "wa.structured_findings"])
      .where("bw.business_id", "=", header.business_id)
      .where("wa.analyzer_version", "like", "website-intelligence-%")
      .orderBy("wa.calculated_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("website_analysis as wa")
      .innerJoin("business_website as bw", "bw.website_id", "wa.website_id")
      .select(["wa.id", "wa.calculated_at", "wa.structured_findings"])
      .where("bw.business_id", "=", header.business_id)
      .where("wa.analyzer_version", "=", "brand-intelligence-v1")
      .orderBy("wa.calculated_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("lead_score as ls")
      .innerJoin("scoring_version as sv", "sv.id", "ls.scoring_version_id")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("decision as dec")
            .select(["dec.id as decision_id", "dec.result_code", "dec.policy_version"])
            .whereRef("dec.prospect_id", "=", "ls.prospect_id")
            .whereRef("dec.lead_score_id", "=", "ls.id")
            .orderBy("dec.decided_at", "desc")
            .orderBy("dec.id", "desc")
            .limit(1)
            .as("latest_decision"),
        (join) => join.onTrue(),
      )
      .select([
        "ls.id as lead_score_id",
        "ls.feature_set_id",
        "ls.overall_score",
        "ls.calculated_at",
        "sv.name as scoring_version",
        "latest_decision.decision_id",
        "latest_decision.result_code",
        "latest_decision.policy_version",
      ])
      .where("ls.prospect_id", "=", prospectId)
      .orderBy("ls.calculated_at", "desc")
      .orderBy("ls.id", "desc")
      .limit(1)
      .executeTakeFirst(),
    activeQualificationSuppressions(db, header.business_id),
  ]);

  const phone = contacts.find((contact) => contact.channel === "phone");
  const email = contacts.find((contact) => contact.channel === "email");
  const metadata = asRecord(discoveryRecord?.provider_metadata);

  const facts: DemoSourceFacts = {
    prospectId: header.prospect_id,
    businessId: header.business_id,
    businessName: header.canonical_name,
    category: header.category,
    lifecycleState: header.lifecycle_state,
    activeSuppressionIds: suppressionIds,
  };
  if (phone) {
    facts.phone = {
      display: formatPhoneDisplay(phone.display_value ?? phone.normalized_value),
      e164: phone.normalized_value,
      contactMethodId: phone.id,
    };
  }
  if (email) facts.email = { value: email.display_value ?? email.normalized_value, contactMethodId: email.id };
  const city = stringOrUndefined(metadata?.city);
  const state = stringOrUndefined(metadata?.state);
  const street = stringOrUndefined(metadata?.street);
  const postalCode = stringOrUndefined(metadata?.postalCode);
  if (city !== undefined) facts.city = city;
  if (state !== undefined) facts.state = state;
  if (street !== undefined) facts.street = street;
  if (postalCode !== undefined) facts.postalCode = postalCode;
  if (website?.canonical_url) facts.websiteUrl = website.canonical_url;
  if (website) facts.websiteId = website.id;
  if (discoveryRecord) {
    facts.discoverySourceRecordId = discoveryRecord.id;
    facts.discoverySourceName = discoveryRecord.source_name;
  }
  if (intelligence) {
    facts.intelligence = {
      analysisId: intelligence.id,
      analyzerVersion: intelligence.analyzer_version,
      calculatedAt: toIso(intelligence.calculated_at),
      findings: asRecord(intelligence.structured_findings) ?? {},
    };
  }
  const brandProfile = asRecord(brand?.structured_findings);
  if (brand && brandProfile && brandProfile.kind === "brand-intelligence") {
    facts.brand = {
      analysisId: brand.id,
      calculatedAt: toIso(brand.calculated_at),
      profile: brandProfile,
    };
  }
  if (qualification && qualification.decision_id && qualification.result_code && qualification.policy_version) {
    facts.latestQualification = {
      leadScoreId: qualification.lead_score_id,
      featureSetId: qualification.feature_set_id,
      decisionId: qualification.decision_id,
      decisionResult: qualification.result_code,
      policyVersion: qualification.policy_version,
      scoringVersion: qualification.scoring_version,
      overallScore: qualification.overall_score,
      calculatedAt: toIso(qualification.calculated_at),
    };
  }
  return facts;
}

/** Deterministic display formatting for NANP numbers; other shapes pass through. */
export function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(digits);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
