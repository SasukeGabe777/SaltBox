/**
 * SaltBox qualification configuration, version 1.
 *
 * EVERY weight, band, and threshold in this file is an INITIAL HUMAN
 * HYPOTHESIS (ADR-002): none of it is statistically derived or validated
 * against observed conversions yet. The point of versioning it explicitly is
 * that future evidence can replace these numbers in a qualification-v2
 * without rewriting history produced under v1.
 *
 * Scores are heuristic priority values on a 0–100 range per dimension.
 * An overall score of 82 does NOT mean an 82% conversion probability.
 */

export const FEATURE_SCHEMA_VERSION = "prospect-qualification-features-v1";
export const SCORING_VERSION_NAME = "qualification-v1";
export const SCORING_ARTIFACT_VERSION = "1.0.0";
export const DECISION_POLICY_VERSION = "qualification-policy-v1";
export const PIPELINE_VERSION = "prospecting-pipeline-v1";
export const ANALYZER_VERSION = "deterministic-website-analyzer-v1";

export type ValueBand = "high" | "medium" | "low" | "unknown";

export interface NeedFeatureConfig {
  /** Feature name in the feature_definition registry. */
  feature: string;
  /** Contribution to the NEED dimension when the deficiency is present. */
  weight: number;
  reasonCode: string;
  explanation: string;
}

/**
 * NEED: deficiencies in the business's web presence. The dimension score is
 * the sum of triggered weights, capped at 100. A missing or unreachable
 * website dominates by design — that is SaltBox's core target profile.
 */
export const NEED_FEATURES: readonly NeedFeatureConfig[] = [
  { feature: "website_missing", weight: 70, reasonCode: "NO_WEBSITE", explanation: "no website found" },
  { feature: "website_unreachable", weight: 60, reasonCode: "WEBSITE_UNREACHABLE", explanation: "website is unreachable" },
  { feature: "https_missing", weight: 15, reasonCode: "HTTPS_MISSING", explanation: "site is not served over HTTPS" },
  { feature: "viewport_missing", weight: 20, reasonCode: "MOBILE_VIEWPORT_MISSING", explanation: "no mobile viewport configuration" },
  { feature: "title_missing", weight: 10, reasonCode: "TITLE_MISSING", explanation: "page title is missing" },
  { feature: "meta_description_missing", weight: 10, reasonCode: "META_DESCRIPTION_MISSING", explanation: "meta description is missing" },
  { feature: "contact_form_missing", weight: 20, reasonCode: "NO_CONTACT_FORM", explanation: "no contact form" },
  { feature: "cta_missing", weight: 15, reasonCode: "NO_CTA", explanation: "no clear call to action" },
];

/**
 * VALUE: a deliberately small, explicit industry band map. Industries not
 * listed fall back to "unknown". This is a placeholder for evidence-based
 * value modeling, not market research.
 */
export const INDUSTRY_VALUE_BANDS: Readonly<Record<string, ValueBand>> = {
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

export const VALUE_BAND_SCORES: Readonly<Record<ValueBand, number>> = {
  high: 80,
  medium: 55,
  low: 30,
  unknown: 40,
};

export const VALUE_BAND_REASON_CODES: Readonly<Record<ValueBand, string>> = {
  high: "HIGH_VALUE_INDUSTRY",
  medium: "MEDIUM_VALUE_INDUSTRY",
  low: "LOW_VALUE_INDUSTRY",
  unknown: "UNKNOWN_VALUE_INDUSTRY",
};

/**
 * ACTIVITY: Phase 4 has no review/social enrichment, so activity uses only
 * signals actually present in the controlled input. This is documented as a
 * known limitation; review velocity is NOT fabricated.
 */
export const ACTIVITY_FEATURES = [
  { feature: "business_has_phone", weight: 50, reasonCode: "PHONE_LISTED", explanation: "a phone number is listed" },
  { feature: "business_has_email", weight: 50, reasonCode: "EMAIL_LISTED", explanation: "an email address is listed" },
] as const;

/** REACHABILITY: can SaltBox actually contact this business? */
export const REACHABILITY_FEATURES = [
  { feature: "email_available", weight: 60, reasonCode: "EMAIL_AVAILABLE", explanation: "reachable by email" },
  { feature: "phone_available", weight: 40, reasonCode: "PHONE_AVAILABLE", explanation: "reachable by phone" },
] as const;

/**
 * Overall = round(Σ dimension_score × weight). Need dominates because website
 * deficiency is the product's reason to exist; reachability outweighs
 * activity because an unreachable prospect has no acquisition path.
 */
export const DIMENSION_WEIGHTS = {
  need: 0.4,
  value: 0.2,
  activity: 0.15,
  reachability: 0.25,
} as const;

/**
 * PROVISIONAL decision threshold. 60 was chosen so that a high-need,
 * reachable business qualifies even in a low-value industry, while a
 * business with a healthy website does not. It must be revisited once real
 * outcome data exists (ADR-002).
 */
export const QUALIFICATION_THRESHOLD = 60;

/** A prospect with zero reachability is rejected regardless of score. */
export const REASON_NO_CONTACT_PATH = "NO_CONTACT_PATH";
export const REASON_SCORE_ABOVE_THRESHOLD = "SCORE_ABOVE_THRESHOLD";
export const REASON_SCORE_BELOW_THRESHOLD = "SCORE_BELOW_THRESHOLD";

/** Registry specs for every extension feature this schema version writes. */
export const FEATURE_DEFINITION_SPECS = [
  ...NEED_FEATURES.map((f) => ({
    name: f.feature,
    dataType: "boolean" as const,
    description: `NEED signal: ${f.explanation} (${FEATURE_SCHEMA_VERSION})`,
  })),
  {
    name: "industry_value_band",
    dataType: "text" as const,
    description: `VALUE signal: configured industry value band (${FEATURE_SCHEMA_VERSION})`,
  },
  ...ACTIVITY_FEATURES.map((f) => ({
    name: f.feature,
    dataType: "boolean" as const,
    description: `ACTIVITY signal: ${f.explanation} (${FEATURE_SCHEMA_VERSION})`,
  })),
  ...REACHABILITY_FEATURES.map((f) => ({
    name: f.feature,
    dataType: "boolean" as const,
    description: `REACHABILITY signal: ${f.explanation} (${FEATURE_SCHEMA_VERSION})`,
  })),
];
