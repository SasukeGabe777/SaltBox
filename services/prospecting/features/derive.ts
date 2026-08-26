/**
 * Deterministic feature derivation: analyzer result + controlled input →
 * the prospect-qualification-features-v1 feature vector. Pure function; the
 * same inputs always produce the same features.
 */

import type { WebsiteCheckResult } from "../analysis/analyzer.ts";
import type { ControlledBusinessInput } from "../ingestion/ingest.ts";
import { INDUSTRY_VALUE_BANDS, type ValueBand } from "../config/qualification-v1.ts";

export interface QualificationFeatures {
  /** NEED deficiencies; a key is present only when the deficiency applies. */
  need: Record<string, boolean>;
  valueBand: ValueBand;
  activity: Record<string, boolean>;
  reachability: Record<string, boolean>;
  /** Stable feature-contract column values (ADR-004). */
  stable: {
    mobilePass: boolean | undefined;
    emailAvailable: boolean;
    businessCategory: string | undefined;
  };
}

export function deriveFeatures(
  input: ControlledBusinessInput,
  website: WebsiteCheckResult
): QualificationFeatures {
  const hasEmail = input.email !== undefined && input.email.trim() !== "";
  const hasPhone = input.phone !== undefined && input.phone.trim() !== "";

  const need: Record<string, boolean> = {};
  if (!website.attempted) {
    need["website_missing"] = true;
  } else if (!website.reachable || !website.htmlRetrieved) {
    // Reachable-but-not-HTML and every failure mode count as "unreachable as
    // a usable website" for qualification purposes.
    need["website_unreachable"] = true;
  } else {
    const signals = website.signals!;
    if (website.https === false) need["https_missing"] = true;
    if (!signals.viewportPresent) need["viewport_missing"] = true;
    if (!signals.titlePresent) need["title_missing"] = true;
    if (!signals.metaDescriptionPresent) need["meta_description_missing"] = true;
    if (!signals.contactFormPresent) need["contact_form_missing"] = true;
    if (!signals.ctaPresent) need["cta_missing"] = true;
  }

  const valueBand: ValueBand =
    input.industry !== undefined ? (INDUSTRY_VALUE_BANDS[input.industry] ?? "unknown") : "unknown";

  return {
    need,
    valueBand,
    activity: {
      business_has_phone: hasPhone,
      business_has_email: hasEmail,
    },
    reachability: {
      email_available: hasEmail,
      phone_available: hasPhone,
    },
    stable: {
      mobilePass: website.signals ? website.signals.viewportPresent : undefined,
      emailAvailable: hasEmail,
      businessCategory: input.industry,
    },
  };
}
