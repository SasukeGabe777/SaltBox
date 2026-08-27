import {
  DECISION_POLICY_VERSION_V2,
  QUALIFICATION_THRESHOLD_V2,
  TARGET_FIT_REASON_CODES,
} from "../config/qualification-v2.ts";
import type {
  EvidenceRef,
  QualificationV2Features,
  QualificationV2Score,
} from "../types.ts";

export interface QualificationV2DecisionReason {
  reasonCode: string;
  contribution: "supports" | "opposes" | "neutral";
  explanation: string;
  featureRef?: string;
  evidence?: EvidenceRef;
}

export interface QualificationV2Decision {
  decisionType: "qualify" | "reject";
  resultCode: "qualified" | "rejected";
  policyVersion: typeof DECISION_POLICY_VERSION_V2;
  reasons: QualificationV2DecisionReason[];
  summary: string;
}

export function decideQualificationV2(
  features: QualificationV2Features,
  score: QualificationV2Score,
  options: { activeSuppressionIds?: string[] } = {},
): QualificationV2Decision {
  const reasons: QualificationV2DecisionReason[] = score.components.map((component) => ({
    reasonCode: component.reasonCode,
    contribution: component.direction === "negative" ? "opposes" : component.direction === "neutral" ? "neutral" : "supports",
    explanation: component.explanation,
    featureRef: `qualification_v2.${component.componentKey}`,
    ...(component.evidence[0] ? { evidence: component.evidence[0] } : {}),
  }));

  let blocker: QualificationV2DecisionReason | null = null;
  if (features.targetFit !== "eligible") {
    blocker = {
      reasonCode: TARGET_FIT_REASON_CODES[features.targetFit],
      contribution: "opposes",
      explanation: `hard exclusion: business is classified as ${features.targetFit}`,
      featureRef: "qualification_v2.target_fit",
      ...(features.evidence["target_fit"]?.[0] ? { evidence: features.evidence["target_fit"][0] } : {}),
    };
  } else if ((options.activeSuppressionIds?.length ?? 0) > 0) {
    blocker = {
      reasonCode: "ACTIVE_SUPPRESSION",
      contribution: "opposes",
      explanation: "an active global or business suppression blocks qualification",
    };
  } else if (!features.hasReachableContactPath) {
    blocker = {
      reasonCode: "NO_REACHABLE_CONTACT_PATH",
      contribution: "opposes",
      explanation: "no discovered or website-derived contact path exists",
      featureRef: "qualification_v2.reachability",
    };
  } else if (features.intelligenceTransient) {
    blocker = {
      reasonCode: "TRANSIENT_INTELLIGENCE_RETRY_REQUIRED",
      contribution: "neutral",
      explanation: "Qualification cannot be confirmed from a transient analyzer/network failure; retry without treating it as a website deficiency",
      featureRef: "qualification_v2.intelligence_status",
      ...(features.evidence["website_failure_kind"]?.[0] ? { evidence: features.evidence["website_failure_kind"][0] } : {}),
    };
  }

  const qualified = blocker === null && score.overall >= QUALIFICATION_THRESHOLD_V2;
  reasons.push(
    blocker ?? {
      reasonCode: qualified ? "SCORE_V2_ABOVE_THRESHOLD" : "SCORE_V2_BELOW_THRESHOLD",
      contribution: qualified ? "supports" : "opposes",
      explanation: `score ${score.overall} is ${qualified ? "at or above" : "below"} threshold ${QUALIFICATION_THRESHOLD_V2}`,
    },
  );
  const resultCode = qualified ? "qualified" : "rejected";
  return {
    decisionType: qualified ? "qualify" : "reject",
    resultCode,
    policyVersion: DECISION_POLICY_VERSION_V2,
    reasons,
    summary:
      `${qualified ? "Qualified" : "Rejected"} under qualification v2 with score ${score.overall}/100 ` +
      `(Need ${score.dimensions.need}, Value ${score.dimensions.value}, Activity ${score.dimensions.activity}, Reachability ${score.dimensions.reachability}). ` +
      (blocker ? blocker.explanation : `Threshold is ${QUALIFICATION_THRESHOLD_V2}.`),
  };
}
