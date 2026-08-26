/**
 * Deterministic qualification decision policy (qualification-policy-v1).
 *
 * Rules:
 *   1. Zero reachability → reject (no acquisition path exists).
 *   2. Overall score >= threshold → qualify; otherwise reject.
 *
 * The threshold is provisional (see config/qualification-v1.ts). The human-
 * readable summary is assembled from structured reason codes — prose is
 * derived, never the authority.
 */

import type { QualificationFeatures } from "../features/derive.ts";
import type { QualificationScore } from "../scoring/score.ts";
import {
  QUALIFICATION_THRESHOLD,
  REASON_NO_CONTACT_PATH,
  REASON_SCORE_ABOVE_THRESHOLD,
  REASON_SCORE_BELOW_THRESHOLD,
} from "../config/qualification-v1.ts";

export interface DecisionReason {
  reasonCode: string;
  contribution: "supports" | "opposes" | "neutral";
  explanation: string;
}

export interface QualificationDecision {
  decisionType: "qualify" | "reject";
  resultCode: "qualified" | "rejected";
  reasons: DecisionReason[];
  summary: string;
}

export function decideQualification(
  features: QualificationFeatures,
  score: QualificationScore
): QualificationDecision {
  const reasons: DecisionReason[] = [];

  // Every score component becomes an inspectable decision reason.
  for (const component of score.components) {
    reasons.push({
      reasonCode: component.reasonCode,
      contribution: component.dimension === "value" ? "neutral" : "supports",
      explanation: component.explanation,
    });
  }

  if (score.dimensions.reachability === 0) {
    reasons.push({
      reasonCode: REASON_NO_CONTACT_PATH,
      contribution: "opposes",
      explanation: "no email or phone contact path exists",
    });
    return {
      decisionType: "reject",
      resultCode: "rejected",
      reasons,
      summary: buildSummary("rejected", score, reasons),
    };
  }

  const qualified = score.overall >= QUALIFICATION_THRESHOLD;
  reasons.push({
    reasonCode: qualified ? REASON_SCORE_ABOVE_THRESHOLD : REASON_SCORE_BELOW_THRESHOLD,
    contribution: qualified ? "supports" : "opposes",
    explanation: `overall score ${score.overall} is ${qualified ? "at or above" : "below"} the provisional threshold ${QUALIFICATION_THRESHOLD}`,
  });

  return {
    decisionType: qualified ? "qualify" : "reject",
    resultCode: qualified ? "qualified" : "rejected",
    reasons,
    summary: buildSummary(qualified ? "qualified" : "rejected", score, reasons),
  };
}

function buildSummary(outcome: string, score: QualificationScore, reasons: DecisionReason[]): string {
  const needParts = score.components
    .filter((c) => c.dimension === "need")
    .map((c) => c.explanation);
  const contactParts = score.components
    .filter((c) => c.dimension === "reachability")
    .map((c) => c.explanation);
  const valuePart = score.components.find((c) => c.dimension === "value")?.explanation;
  const blocker = reasons.find((r) => r.reasonCode === REASON_NO_CONTACT_PATH);

  const sections: string[] = [
    `${outcome[0]!.toUpperCase()}${outcome.slice(1)} with score ${score.overall}/100` +
      ` (need ${score.dimensions.need}, value ${score.dimensions.value},` +
      ` activity ${score.dimensions.activity}, reachability ${score.dimensions.reachability})`,
  ];
  if (blocker) sections.push(blocker.explanation);
  if (needParts.length > 0) sections.push(`need signals: ${needParts.join(", ")}`);
  if (valuePart) sections.push(valuePart);
  if (contactParts.length > 0) sections.push(contactParts.join(", "));
  return `${sections.join("; ")}.`;
}
