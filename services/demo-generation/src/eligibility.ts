/**
 * Demo eligibility (Phase 8).
 *
 * Default rule: the latest persisted qualification run must be a
 * qualification-policy-v2 "qualified" decision, the business must not be
 * actively suppressed, deep intelligence must exist, and the category must
 * map to a Phase 8 template.
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
  | "BUSINESS_IDENTITY_UNUSABLE";

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

  if (!facts.intelligence) {
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
