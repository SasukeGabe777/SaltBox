import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import {
  INDUSTRY_VALUE_BANDS_V2,
  type TargetFitClassification,
  type ValueBandV2,
} from "../config/qualification-v2.ts";
import type {
  EvidenceRef,
  QualificationV2BusinessInput,
  QualificationV2Features,
} from "../types.ts";

export interface DeriveV2Options {
  currentYear?: number;
  evidenceByField?: Record<string, EvidenceRef[]>;
  websiteAnalysisId?: string;
}

export function deriveQualificationFeaturesV2(
  input: QualificationV2BusinessInput,
  intelligence: WebsiteIntelligenceResult | null,
  options: DeriveV2Options = {},
): QualificationV2Features {
  const currentYear = options.currentYear ?? new Date().getUTCFullYear();
  const values: Record<string, boolean | string | number> = {};
  const evidence: Record<string, EvidenceRef[]> = {};
  const analysisRef: EvidenceRef[] = options.websiteAnalysisId
    ? [{ kind: "website_analysis", id: options.websiteAnalysisId }]
    : [];
  const refs = (...fields: string[]) =>
    dedupeEvidence([
      ...fields.flatMap((field) => options.evidenceByField?.[field] ?? []),
      ...analysisRef,
    ]);
  const set = (name: string, value: boolean | string | number, sourceRefs: EvidenceRef[]) => {
    values[name] = value;
    evidence[name] = sourceRefs;
  };

  const discoveredEmail = Boolean(input.email?.trim());
  const discoveredPhone = Boolean(input.phone?.trim());
  const websiteMissing = !input.websiteUrl?.trim();
  set("website_missing", websiteMissing, refs("website_present"));
  set("discovered_email", discoveredEmail, refs("email_available"));
  set("discovered_phone", discoveredPhone, refs("phone_available"));

  const valueBand: ValueBandV2 =
    input.category === undefined ? "unknown" : (INDUSTRY_VALUE_BANDS_V2[input.category] ?? "unknown");
  set("industry_value_band", valueBand, refs("business_category"));

  const targetFit = classifyTargetFit(input);
  set("target_fit", targetFit, refs("business_name", "business_category"));

  let intelligenceStatus: QualificationV2Features["intelligenceStatus"] = websiteMissing
    ? "skipped_no_website"
    : "failed";
  let intelligenceFailureKind: string | null = null;
  let intelligenceTransient = false;

  if (intelligence) {
    const stageValues = Object.values(intelligence.stages).map((stage) => stage.status);
    intelligenceStatus = intelligence.fatal
      ? "failed"
      : stageValues.includes("failed") || stageValues.includes("partial")
        ? "partial"
        : "complete";
    intelligenceFailureKind = intelligence.fatal?.failureKind ?? null;
    intelligenceTransient = intelligence.fatal?.transient === true;
    if (intelligenceFailureKind) {
      set("website_failure_kind", intelligenceFailureKind, refs(
        "website.technical.analysis_failure_kind",
        "website.technical.analysis_failure_code",
      ));
    }

    if (!intelligence.fatal) {
      if (intelligence.technical) {
        set("https_problem", !intelligence.technical.https, refs("website.technical.https"));
        const errors = intelligence.technical.consoleErrors + intelligence.technical.failedRequests;
        set(
          "technical_error_band",
          errors >= 5 ? "high" : errors > 0 ? "some" : "none",
          refs("website.technical.console_errors", "website.technical.failed_requests"),
        );
      }
      if (intelligence.mobile) {
        if (intelligence.mobile.horizontalOverflow !== null) {
          set("mobile_overflow", intelligence.mobile.horizontalOverflow, refs("website.mobile.horizontal_overflow"));
        }
        set("viewport_missing", !intelligence.mobile.viewportMetaPresent, refs("website.mobile.viewport_meta_present"));
      }
      if (intelligence.lab) {
        const performance = intelligence.lab.performance;
        if (performance !== null) {
          set("lighthouse_performance", performance, refs("website.performance.lighthouse_performance"));
          set("performance_band", bandPerformance(performance), refs("website.performance.lighthouse_performance"));
        }
        if (intelligence.lab.largestContentfulPaintMs !== null) {
          set("lcp_band", bandLcp(intelligence.lab.largestContentfulPaintMs), refs("website.performance.lcp_ms"));
        }
        if (intelligence.lab.totalBlockingTimeMs !== null) {
          set("tbt_band", bandTbt(intelligence.lab.totalBlockingTimeMs), refs("website.performance.tbt_ms"));
        }
        if (intelligence.lab.cumulativeLayoutShift !== null) {
          set("cls_band", bandCls(intelligence.lab.cumulativeLayoutShift), refs("website.performance.cls"));
        }
      }
      if (intelligence.conversion) {
        set("cta_missing", !intelligence.conversion.prominentCtaPresent, refs(
          "website.conversion.quote_cta_present",
          "website.conversion.booking_cta_present",
        ));
        set("contact_form_missing", !intelligence.conversion.contactFormPresent, refs("website.conversion.contact_form_present"));
        set("website_email_link", intelligence.conversion.emailLinkPresent, refs("website.conversion.email_link_present"));
        set("website_phone_link", intelligence.conversion.phoneLinkPresent, refs("website.conversion.phone_link_present"));
        set("contact_form", intelligence.conversion.contactFormPresent, refs("website.conversion.contact_form_present"));
        set("contact_page", intelligence.conversion.contactPagePresent, refs("website.conversion.contact_page_present"));
        set(
          "quote_or_booking_cta",
          intelligence.conversion.quoteCtaPresent || intelligence.conversion.bookingCtaPresent,
          refs("website.conversion.quote_cta_present", "website.conversion.booking_cta_present"),
        );
      }
      if (intelligence.seo) {
        set("title_missing", !intelligence.seo.titlePresent, refs("website.seo.title_present"));
        set("meta_description_missing", !intelligence.seo.metaDescriptionPresent, refs("website.seo.meta_description_present"));
      }
      if (intelligence.links) {
        const meaningful = intelligence.links.checked >= 5 && intelligence.links.broken >= 2;
        set("broken_link_band", meaningful ? "meaningful" : intelligence.links.broken > 0 ? "minor" : "none", refs(
          "website.links.checked",
          "website.links.broken",
        ));
      }
      if (intelligence.content) {
        const year = intelligence.content.copyrightYear;
        const age = year === null ? null : Math.max(0, currentYear - year);
        set(
          "stale_copyright_band",
          age === null ? "unknown" : age >= 4 ? "stale" : age >= 2 ? "aging" : "current",
          refs("website.content.copyright_year"),
        );
        set(
          "copyright_recency",
          age === null ? "unknown" : age <= 1 ? "current" : age <= 3 ? "recent" : "stale",
          refs("website.content.copyright_year"),
        );
      }
      const meaningfulPages = intelligence.pages.filter(
        (page) => page.reachable && page.role !== "homepage" && ["contact", "services", "about", "locations"].includes(page.role),
      ).length;
      set("functioning_multi_page_site", meaningfulPages >= 2, analysisRef);
      set(
        "shallow_site",
        intelligence.stages.homepage.status === "ok" && meaningfulPages === 0,
        analysisRef,
      );
    }
  }
  set("intelligence_status", intelligenceStatus, analysisRef);

  const hasReachableContactPath =
    discoveredEmail ||
    discoveredPhone ||
    values["website_email_link"] === true ||
    values["website_phone_link"] === true ||
    values["contact_form"] === true ||
    values["contact_page"] === true;

  return {
    values,
    valueBand,
    targetFit,
    intelligenceStatus,
    intelligenceFailureKind,
    intelligenceTransient,
    hasReachableContactPath,
    evidence,
    stable: {
      ...(typeof values["mobile_overflow"] === "boolean"
        ? { mobilePass: values["mobile_overflow"] === false && values["viewport_missing"] === false }
        : {}),
      emailAvailable: discoveredEmail || values["website_email_link"] === true,
      ...(input.category ? { businessCategory: input.category } : {}),
      ...(typeof values["lighthouse_performance"] === "number"
        ? { websitePerformanceScore: values["lighthouse_performance"] }
        : {}),
    },
    intelligence,
  };
}

function classifyTargetFit(input: QualificationV2BusinessInput): TargetFitClassification {
  const name = input.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const context = `${name} ${input.category ?? ""} ${metadataCategory(input.sourceMetadata)}`;
  if (/^(the )?(home depot|lowes|lowe s|walmart|costco wholesale)( |$)/.test(name)) return "national_chain";
  if (/\b(city of|county of|state of|department of|municipal|government)\b/.test(context)) return "government";
  if (/\b(school district|elementary school|middle school|high school|university|community college)\b/.test(context)) return "education";
  if (/\b(hospital|medical center|health system)\b/.test(context)) return "major_institution";
  if (/\b(directory|marketplace|lead service|business listings)\b/.test(context)) return "directory_aggregator";
  if (/\b(manufacturing|manufacturer|wholesale|distributor|roofing supply|plumbing supply|hvac supply)\b/.test(context)) {
    return "supplier_manufacturer";
  }
  return "eligible";
}

function metadataCategory(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "";
  return ["category", "primaryCategory", "primary_category", "categories"]
    .map((key) => metadata[key])
    .filter((value) => typeof value === "string" || Array.isArray(value))
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function bandPerformance(value: number): string {
  return value < 30 ? "poor" : value < 50 ? "weak" : value < 70 ? "fair" : "good";
}
function bandLcp(value: number): string {
  return value >= 4000 ? "poor" : value >= 2500 ? "needs_improvement" : "good";
}
function bandTbt(value: number): string {
  return value >= 600 ? "poor" : value >= 200 ? "needs_improvement" : "good";
}
function bandCls(value: number): string {
  return value > 0.25 ? "poor" : value > 0.1 ? "needs_improvement" : "good";
}
function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
