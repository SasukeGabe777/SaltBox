/**
 * Qualification v2 configuration.
 *
 * These weights and thresholds are explicit human hypotheses, not learned
 * conversion probabilities. A score is a 0-100 pursuit priority.
 */

export const FEATURE_SCHEMA_VERSION_V2 = "prospect-qualification-features-v2";
export const SCORING_VERSION_V2 = "qualification-v2";
export const SCORING_ARTIFACT_VERSION_V2 = "2.0.0";
export const DECISION_POLICY_VERSION_V2 = "qualification-policy-v2";
export const PIPELINE_VERSION_V2 = "deep-intelligence-qualification-pipeline-v2";
export const QUALIFICATION_THRESHOLD_V2 = 60;

export type ValueBandV2 = "high" | "medium" | "low" | "unknown";
export type TargetFitClassification =
  | "eligible"
  | "national_chain"
  | "government"
  | "education"
  | "major_institution"
  | "supplier_manufacturer"
  | "directory_aggregator";

export const DIMENSION_WEIGHTS_V2 = {
  need: 0.45,
  value: 0.2,
  activity: 0.1,
  reachability: 0.25,
} as const;

export interface FeatureRule {
  feature: string;
  equals: boolean | string | number;
  points: number;
  reasonCode: string;
  rationale: string;
}

export const NEED_RULES_V2: readonly FeatureRule[] = [
  { feature: "website_missing", equals: true, points: 90, reasonCode: "WEBSITE_MISSING", rationale: "no business website is recorded" },
  { feature: "website_failure_kind", equals: "dns_not_found", points: 75, reasonCode: "DNS_NOT_FOUND", rationale: "DNS returned a definitive not-found result" },
  { feature: "website_failure_kind", equals: "unreachable", points: 55, reasonCode: "WEBSITE_DEFINITIVELY_UNREACHABLE", rationale: "the website was definitively unreachable" },
  { feature: "website_failure_kind", equals: "invalid_target", points: 60, reasonCode: "INVALID_WEBSITE_TARGET", rationale: "the recorded website target is malformed" },
  { feature: "website_failure_kind", equals: "tls_failure", points: 30, reasonCode: "TLS_FAILURE", rationale: "the website failed TLS validation" },
  { feature: "https_problem", equals: true, points: 15, reasonCode: "HTTPS_PROBLEM", rationale: "the analyzed site is not served over HTTPS" },
  { feature: "mobile_overflow", equals: true, points: 20, reasonCode: "MOBILE_OVERFLOW", rationale: "the mobile viewport has horizontal overflow" },
  { feature: "viewport_missing", equals: true, points: 12, reasonCode: "MOBILE_VIEWPORT_MISSING", rationale: "the viewport metadata required for mobile layout is absent" },
  { feature: "performance_band", equals: "poor", points: 25, reasonCode: "LIGHTHOUSE_PERFORMANCE_POOR", rationale: "Lighthouse performance is below 30" },
  { feature: "performance_band", equals: "weak", points: 18, reasonCode: "LIGHTHOUSE_PERFORMANCE_WEAK", rationale: "Lighthouse performance is between 30 and 49" },
  { feature: "performance_band", equals: "fair", points: 10, reasonCode: "LIGHTHOUSE_PERFORMANCE_FAIR", rationale: "Lighthouse performance is between 50 and 69" },
  { feature: "lcp_band", equals: "poor", points: 15, reasonCode: "LCP_POOR", rationale: "lab LCP is at least 4 seconds" },
  { feature: "lcp_band", equals: "needs_improvement", points: 8, reasonCode: "LCP_NEEDS_IMPROVEMENT", rationale: "lab LCP is at least 2.5 seconds" },
  { feature: "tbt_band", equals: "poor", points: 10, reasonCode: "TBT_POOR", rationale: "lab total blocking time is at least 600 ms" },
  { feature: "tbt_band", equals: "needs_improvement", points: 5, reasonCode: "TBT_NEEDS_IMPROVEMENT", rationale: "lab total blocking time is at least 200 ms" },
  { feature: "cls_band", equals: "poor", points: 10, reasonCode: "CLS_POOR", rationale: "lab cumulative layout shift is above 0.25" },
  { feature: "cls_band", equals: "needs_improvement", points: 5, reasonCode: "CLS_NEEDS_IMPROVEMENT", rationale: "lab cumulative layout shift is above 0.1" },
  { feature: "cta_missing", equals: true, points: 12, reasonCode: "CTA_MISSING", rationale: "no prominent conversion call to action was detected" },
  { feature: "contact_form_missing", equals: true, points: 8, reasonCode: "CONTACT_FORM_MISSING", rationale: "no contact form was detected" },
  { feature: "title_missing", equals: true, points: 5, reasonCode: "TITLE_MISSING", rationale: "the homepage title is absent" },
  { feature: "meta_description_missing", equals: true, points: 5, reasonCode: "META_DESCRIPTION_MISSING", rationale: "the meta description is absent" },
  { feature: "technical_error_band", equals: "high", points: 8, reasonCode: "TECHNICAL_ERRORS_HIGH", rationale: "at least five console or failed-request errors were observed" },
  { feature: "technical_error_band", equals: "some", points: 4, reasonCode: "TECHNICAL_ERRORS_PRESENT", rationale: "browser console or request errors were observed" },
  { feature: "broken_link_band", equals: "meaningful", points: 10, reasonCode: "BROKEN_INTERNAL_LINKS", rationale: "multiple meaningful internal links are broken" },
  { feature: "stale_copyright_band", equals: "stale", points: 8, reasonCode: "COPYRIGHT_STALE", rationale: "the copyright signal is at least four years old" },
  { feature: "stale_copyright_band", equals: "aging", points: 4, reasonCode: "COPYRIGHT_AGING", rationale: "the copyright signal is two or three years old" },
  { feature: "shallow_site", equals: true, points: 8, reasonCode: "SHALLOW_SITE_STRUCTURE", rationale: "the functioning site exposes no meaningful service/about/contact structure" },
] as const;

export const ACTIVITY_RULES_V2: readonly FeatureRule[] = [
  { feature: "copyright_recency", equals: "current", points: 40, reasonCode: "COPYRIGHT_CURRENT", rationale: "the website copyright is current or one year old" },
  { feature: "copyright_recency", equals: "recent", points: 25, reasonCode: "COPYRIGHT_RECENT", rationale: "the website copyright is two or three years old" },
  { feature: "functioning_multi_page_site", equals: true, points: 30, reasonCode: "FUNCTIONING_MULTI_PAGE_SITE", rationale: "multiple meaningful website pages are functioning" },
] as const;

export const REACHABILITY_RULES_V2: readonly FeatureRule[] = [
  { feature: "discovered_email", equals: true, points: 40, reasonCode: "EMAIL_AVAILABLE", rationale: "discovery supplied an email address" },
  { feature: "discovered_phone", equals: true, points: 25, reasonCode: "PHONE_AVAILABLE", rationale: "discovery supplied a phone number" },
  { feature: "website_email_link", equals: true, points: 20, reasonCode: "WEBSITE_EMAIL_LINK", rationale: "the website exposes an email link" },
  { feature: "website_phone_link", equals: true, points: 15, reasonCode: "WEBSITE_PHONE_LINK", rationale: "the website exposes a phone link" },
  { feature: "contact_form", equals: true, points: 20, reasonCode: "CONTACT_FORM_AVAILABLE", rationale: "a usable contact form is present" },
  { feature: "contact_page", equals: true, points: 10, reasonCode: "CONTACT_PAGE_AVAILABLE", rationale: "a contact page is present" },
  { feature: "quote_or_booking_cta", equals: true, points: 10, reasonCode: "QUOTE_PATH_AVAILABLE", rationale: "a quote or booking path is present" },
] as const;

export const INDUSTRY_VALUE_BANDS_V2: Readonly<Record<string, ValueBandV2>> = {
  roofing: "high",
  hvac: "high",
  plumbing: "high",
  electrical: "high",
  dental: "high",
  landscaping: "medium",
  auto_repair: "medium",
  cleaning: "medium",
  salon: "low",
  bakery: "low",
  restaurant: "low",
};

export const VALUE_BAND_SCORES_V2: Readonly<Record<ValueBandV2, number>> = {
  high: 80,
  medium: 55,
  low: 30,
  unknown: 40,
};

export const VALUE_REASON_CODES_V2: Readonly<Record<ValueBandV2, string>> = {
  high: "HIGH_VALUE_INDUSTRY",
  medium: "MEDIUM_VALUE_INDUSTRY",
  low: "LOW_VALUE_INDUSTRY",
  unknown: "UNKNOWN_VALUE_INDUSTRY",
};

export const TARGET_FIT_REASON_CODES: Readonly<Record<Exclude<TargetFitClassification, "eligible">, string>> = {
  national_chain: "NON_TARGET_NATIONAL_CHAIN",
  government: "NON_TARGET_GOVERNMENT",
  education: "NON_TARGET_EDUCATION",
  major_institution: "NON_TARGET_MAJOR_INSTITUTION",
  supplier_manufacturer: "NON_TARGET_SUPPLIER_MANUFACTURER",
  directory_aggregator: "NON_TARGET_DIRECTORY_AGGREGATOR",
};

export const FEATURE_DEFINITION_SPECS_V2 = [
  ...[
    "website_missing", "https_problem", "mobile_overflow", "viewport_missing", "cta_missing",
    "contact_form_missing", "title_missing", "meta_description_missing", "shallow_site",
    "functioning_multi_page_site", "discovered_email", "discovered_phone", "website_email_link",
    "website_phone_link", "contact_form", "contact_page", "quote_or_booking_cta",
  ].map((name) => ({ name: `qualification_v2.${name}`, dataType: "boolean" as const, description: `${FEATURE_SCHEMA_VERSION_V2}: ${name}` })),
  ...[
    "website_failure_kind", "performance_band", "lcp_band", "tbt_band", "cls_band",
    "technical_error_band", "broken_link_band", "stale_copyright_band", "copyright_recency",
    "industry_value_band", "target_fit", "intelligence_status",
  ].map((name) => ({ name: `qualification_v2.${name}`, dataType: "text" as const, description: `${FEATURE_SCHEMA_VERSION_V2}: ${name}` })),
  { name: "qualification_v2.lighthouse_performance", dataType: "number" as const, description: `${FEATURE_SCHEMA_VERSION_V2}: raw Lighthouse performance score` },
] as const;
