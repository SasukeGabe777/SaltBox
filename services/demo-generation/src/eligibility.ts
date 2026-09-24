/**
 * Demo eligibility (Phase 8).
 *
 * Default rule: the latest persisted qualification run must be a
 * qualification-policy-v2 "qualified" decision, the business must not be
 * actively suppressed, deep intelligence must exist for a business that HAS
 * a website (a business with no website is the clearest case for a demo and
 * is built from its listing facts), and the category must map to a template.
 *
 * A controlled-testing override may bypass the qualification/intelligence
 * requirements, but it NEVER bypasses suppression or template availability,
 * and it never changes lifecycle or decision history — an overridden demo
 * does not make a prospect "qualified".
 */

import { ELIGIBLE_POLICY_VERSION, selectDemoTemplate } from "./config/demo-v1.ts";
import type { DemoSourceFacts } from "./types.ts";

export type EligibilityReasonCode =
  | "NO_QUALIFICATION_RUN"
  | "NOT_QUALIFIED"
  | "POLICY_VERSION_MISMATCH"
  | "ACTIVELY_SUPPRESSED"
  | "INTELLIGENCE_MISSING"
  | "TEMPLATE_UNAVAILABLE"
  | "BUSINESS_IDENTITY_UNUSABLE"
  | "SITE_IDENTITY_MISMATCH";

export interface EligibilityReason {
  code: EligibilityReasonCode;
  detail: string;
  /** True when an explicit operator override may bypass this reason. */
  overridable: boolean;
}

export interface DemoEligibility {
  eligible: boolean;
  reasons: EligibilityReason[];
  /** Reasons an override would still not clear. */
  blocking: EligibilityReason[];
}

const IDENTITY_STOPWORDS = new Set([
  "llc", "inc", "corp", "company", "services", "service", "the", "and", "utah", "plumbing", "roofing", "electric",
  "electrical", "heating", "cooling", "hvac", "landscaping", "painting", "concrete", "flooring", "construction",
  "contractors", "contractor", "systems", "solutions", "group", "home", "homes", "pros", "professional",
]);

/**
 * A homepage that never mentions the business (by a distinctive name word
 * or its own domain) is not evidence about that business: expired domains
 * get taken over (a flooring company's domain serving a gambling site).
 * Returns why, or null when it matches or cannot be judged.
 */
export function siteIdentityMismatch(facts: DemoSourceFacts): string | null {
  const content = facts.intelligence?.findings.content as Record<string, unknown> | undefined;
  const pages = facts.intelligence?.findings.pages;
  if (!content || typeof content.homepageExcerpt !== "string") return null;
  if (typeof content.unavailableNotice === "string" && content.unavailableNotice !== "") return null;
  const title = Array.isArray(pages) && typeof (pages[0] as Record<string, unknown>)?.title === "string" ? String((pages[0] as Record<string, unknown>).title) : "";
  const headings = Array.isArray(content.leadHeadings) ? content.leadHeadings.join(" ") : "";
  const haystack = `${title} ${headings} ${content.homepageExcerpt}`.toLowerCase();
  const compact = haystack.replace(/[^a-z0-9]/g, "");
  // Apostrophes join words ("Amp'd" -> "ampd"); other punctuation separates.
  const nameTokens = facts.businessName.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !IDENTITY_STOPWORDS.has(token));
  let domainLabel = "";
  try {
    domainLabel = new URL(facts.websiteUrl ?? "").hostname.replace(/^www\./, "").split(".")[0] ?? "";
  } catch {
    domainLabel = "";
  }
  const domainCompact = domainLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domainTokens = domainLabel.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !IDENTITY_STOPWORDS.has(token));
  const candidates = [...nameTokens, ...(domainCompact.length >= 5 ? [domainCompact] : []), ...domainTokens];
  if (candidates.length === 0) return null;
  if (candidates.some((token) => haystack.includes(token) || compact.includes(token))) return null;
  return `The homepage at ${facts.websiteUrl} never mentions "${facts.businessName}" or its domain; it may not be the business's site (expired or taken-over domain).`;
}

export function evaluateDemoEligibility(facts: DemoSourceFacts): DemoEligibility {
  const reasons: EligibilityReason[] = [];

  if (facts.businessName.trim() === "") {
    reasons.push({
      code: "BUSINESS_IDENTITY_UNUSABLE",
      detail: "The business has no usable canonical name.",
      overridable: false,
    });
  }

  if (!selectDemoTemplate(facts.category)) {
    reasons.push({
      code: "TEMPLATE_UNAVAILABLE",
      detail: `No Phase 8 template exists for category "${facts.category ?? "unknown"}"; only the local-service family is supported.`,
      overridable: false,
    });
  }

  if (facts.activeSuppressionIds.length > 0) {
    reasons.push({
      code: "ACTIVELY_SUPPRESSED",
      detail: `Active suppression(s) ${facts.activeSuppressionIds.join(", ")} block demo generation.`,
      overridable: false,
    });
  }

  const qualification = facts.latestQualification;
  if (!qualification) {
    reasons.push({
      code: "NO_QUALIFICATION_RUN",
      detail: "No persisted qualification run exists for this prospect.",
      overridable: true,
    });
  } else {
    if (qualification.policyVersion !== ELIGIBLE_POLICY_VERSION) {
      reasons.push({
        code: "POLICY_VERSION_MISMATCH",
        detail: `Latest decision uses ${qualification.policyVersion}; Phase 8 requires ${ELIGIBLE_POLICY_VERSION}.`,
        overridable: true,
      });
    }
    if (qualification.decisionResult !== "qualified") {
      reasons.push({
        code: "NOT_QUALIFIED",
        detail: `Latest ${qualification.policyVersion} decision is "${qualification.decisionResult}", not "qualified".`,
        overridable: true,
      });
    }
  }

  const mismatch = siteIdentityMismatch(facts);
  if (mismatch) {
    reasons.push({ code: "SITE_IDENTITY_MISMATCH", detail: mismatch, overridable: true });
  }

  if (!facts.intelligence && facts.websiteUrl !== undefined) {
    reasons.push({
      code: "INTELLIGENCE_MISSING",
      detail: "No persisted deep website-intelligence analysis exists for this business.",
      overridable: true,
    });
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    blocking: reasons.filter((reason) => !reason.overridable),
  };
}
