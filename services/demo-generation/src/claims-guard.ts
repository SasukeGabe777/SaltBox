/**
 * Hard safety net against unsupported factual claims in generated demo copy.
 *
 * SaltBox has no evidence for licenses, certifications, insurance, awards,
 * warranties, tenure, reviews, ratings, financing, emergency availability,
 * pricing, or partnerships — so generated/placeholder copy must never assert
 * them. Observed values (the business's own name and contact facts) are
 * exempt: SaltBox reports those verbatim with provenance.
 */

import type { DemoContent } from "./types.ts";

export interface UnsupportedClaim {
  field: string;
  text: string;
  pattern: string;
}

const BANNED_CLAIM_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\blicen[cs]ed?\b/i, label: "licensing claim" },
  { pattern: /\bcertif(?:ied|ication)/i, label: "certification claim" },
  { pattern: /\binsured\b|\binsurance\b|\bbonded\b/i, label: "insurance/bonding claim" },
  { pattern: /\baward/i, label: "award claim" },
  { pattern: /\bwarrant(?:y|ies|ied)\b/i, label: "warranty claim" },
  { pattern: /\bguarantee/i, label: "guarantee claim" },
  { pattern: /\b\d+\s*\+?\s*years?\b/i, label: "tenure claim" },
  { pattern: /\bsince\s+\d{4}\b/i, label: "tenure claim" },
  { pattern: /\byears\s+(?:of\s+experience|in\s+business)\b/i, label: "tenure claim" },
  { pattern: /\breview(?:s|ed)?\b/i, label: "review claim" },
  { pattern: /\brated\b|\bstars?\b|\b5-star\b/i, label: "rating claim" },
  { pattern: /\btestimonial/i, label: "testimonial claim" },
  { pattern: /\bfinanc/i, label: "financing claim" },
  { pattern: /\b24[/ ]?7\b|\bemergency\b|\bsame[- ]day\b/i, label: "availability claim" },
  { pattern: /\bfree\b|\bno[- ]cost\b|\bcheapest\b|\blowest price\b/i, label: "pricing claim" },
  { pattern: /\b#\s?1\b|\bbest\b|\btop[- ]rated\b|\baward[- ]winning\b/i, label: "superlative claim" },
  { pattern: /\btrusted\b|\breputable\b/i, label: "reputation claim" },
  { pattern: /\bexperts?\b|\bexpertise\b|\bexperienced\b|\bmaster\b/i, label: "expertise claim" },
  { pattern: /\bfamily[- ]owned\b|\blocally[- ]owned\b|\bveteran[- ]owned\b/i, label: "ownership claim" },
  { pattern: /\bpartner(?:s|ed|ship)?\b|\bauthorized dealer\b/i, label: "partnership claim" },
];

/**
 * Scan every generated/placeholder text field. Returns each violation so
 * callers can fail generation loudly instead of shipping an invented claim.
 */
export function findUnsupportedClaims(content: DemoContent): UnsupportedClaim[] {
  const violations: UnsupportedClaim[] = [];
  const check = (field: string, text: string | undefined) => {
    if (text === undefined) return;
    for (const { pattern, label } of BANNED_CLAIM_PATTERNS) {
      if (pattern.test(text)) violations.push({ field, text, pattern: label });
    }
  };

  check("meta.title", content.meta.title);
  check("meta.description", content.meta.description);
  check("hero.headline", content.hero.headline);
  check("hero.subheadline", content.hero.subheadline);
  check("hero.primaryCta.label", content.hero.primaryCta.label);
  check("hero.secondaryCta.label", content.hero.secondaryCta?.label);
  check("services.heading", content.services.heading);
  check("services.intro", content.services.intro);
  content.services.items.forEach((item, index) => {
    // Evidence-backed service names are the business's own site text
    // (extracted provenance), not generated claims; descriptions are still
    // generated and stay guarded.
    if (item.evidence !== true) check(`services.items[${index}].title`, item.title);
    check(`services.items[${index}].description`, item.description);
  });
  check("trust.heading", content.trust.heading);
  content.trust.points.forEach((point, index) => {
    check(`trust.points[${index}].title`, point.title);
    check(`trust.points[${index}].description`, point.description);
  });
  check("serviceArea.heading", content.serviceArea?.heading);
  check("serviceArea.description", content.serviceArea?.description);
  check("about.heading", content.about.heading);
  check("about.body", content.about.body);
  check("contact.heading", content.contact.heading);
  check("contact.intro", content.contact.intro);
  check("contact.formHeadline", content.contact.formHeadline);
  return violations;
}

export function assertNoUnsupportedClaims(content: DemoContent): void {
  const violations = findUnsupportedClaims(content);
  if (violations.length > 0) {
    const summary = violations
      .map((violation) => `${violation.field} (${violation.pattern}): "${violation.text}"`)
      .join("; ");
    throw new Error(`Generated demo copy contains unsupported claims: ${summary}`);
  }
}
