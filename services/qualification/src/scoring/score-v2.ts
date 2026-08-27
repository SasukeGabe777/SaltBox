import {
  ACTIVITY_RULES_V2,
  DIMENSION_WEIGHTS_V2,
  NEED_RULES_V2,
  REACHABILITY_RULES_V2,
  TARGET_FIT_REASON_CODES,
  VALUE_BAND_SCORES_V2,
  VALUE_REASON_CODES_V2,
  type FeatureRule,
} from "../config/qualification-v2.ts";
import type {
  QualificationV2Features,
  QualificationV2Score,
  QualificationV2ScoreComponent,
} from "../types.ts";

export function calculateQualificationScoreV2(features: QualificationV2Features): QualificationV2Score {
  const components: QualificationV2ScoreComponent[] = [];
  const need = scoreRules("need", NEED_RULES_V2, features, components);
  const activity = scoreRules("activity", ACTIVITY_RULES_V2, features, components);
  const reachability = scoreRules("reachability", REACHABILITY_RULES_V2, features, components);
  const value = VALUE_BAND_SCORES_V2[features.valueBand];
  components.push({
    dimension: "value",
    componentKey: "industry_value_band",
    result: value,
    direction: "neutral",
    reasonCode: VALUE_REASON_CODES_V2[features.valueBand],
    explanation: `industry value band is ${features.valueBand}`,
    observedValue: features.valueBand,
    evidence: features.evidence["industry_value_band"] ?? [],
  });

  if (features.intelligenceTransient) {
    components.push({
      dimension: "rule",
      componentKey: "intelligence_failure",
      result: 0,
      direction: "neutral",
      reasonCode: "TRANSIENT_INTELLIGENCE_FAILURE_NO_PENALTY",
      explanation: `${features.intelligenceFailureKind ?? "transient failure"} is temporary evidence and contributes no Need points`,
      observedValue: features.intelligenceFailureKind,
      evidence: features.evidence["website_failure_kind"] ?? [],
    });
  } else if (features.intelligenceStatus === "partial") {
    components.push({
      dimension: "rule",
      componentKey: "intelligence_status",
      result: 0,
      direction: "neutral",
      reasonCode: "PARTIAL_INTELLIGENCE_NO_AUTOMATIC_PENALTY",
      explanation: "one or more analyzer stages failed; missing metrics contribute no deficiency points",
      observedValue: "partial",
      evidence: features.evidence["intelligence_status"] ?? [],
    });
  }

  if (features.targetFit !== "eligible") {
    components.push({
      dimension: "rule",
      componentKey: "target_fit",
      result: 0,
      direction: "negative",
      reasonCode: TARGET_FIT_REASON_CODES[features.targetFit],
      explanation: `strong deterministic target-fit rule classified the business as ${features.targetFit}`,
      observedValue: features.targetFit,
      evidence: features.evidence["target_fit"] ?? [],
    });
  }

  const overall = Math.round(
    need * DIMENSION_WEIGHTS_V2.need +
      value * DIMENSION_WEIGHTS_V2.value +
      activity * DIMENSION_WEIGHTS_V2.activity +
      reachability * DIMENSION_WEIGHTS_V2.reachability,
  );
  return { overall, dimensions: { need, value, activity, reachability }, components };
}

function scoreRules(
  dimension: "need" | "activity" | "reachability",
  rules: readonly FeatureRule[],
  features: QualificationV2Features,
  components: QualificationV2ScoreComponent[],
): number {
  let score = 0;
  for (const rule of rules) {
    const observed = features.values[rule.feature];
    if (observed !== rule.equals) continue;
    score += rule.points;
    components.push({
      dimension,
      componentKey: rule.feature,
      result: rule.points,
      direction: "positive",
      reasonCode: rule.reasonCode,
      explanation: rule.rationale,
      observedValue: observed ?? null,
      evidence: features.evidence[rule.feature] ?? [],
    });
  }
  return Math.min(100, score);
}
