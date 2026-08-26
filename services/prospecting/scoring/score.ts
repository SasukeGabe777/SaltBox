/**
 * Deterministic qualification scoring (qualification-v1).
 *
 * Dimension scores are 0–100 heuristic priorities, not probabilities:
 *   NEED         = min(100, Σ weights of triggered deficiencies)
 *   VALUE        = configured industry band score
 *   ACTIVITY     = Σ weights of present activity signals
 *   REACHABILITY = Σ weights of available contact paths
 *   OVERALL      = round(Σ dimension × dimension-weight)
 */

import type { QualificationFeatures } from "../features/derive.ts";
import {
  NEED_FEATURES,
  ACTIVITY_FEATURES,
  REACHABILITY_FEATURES,
  VALUE_BAND_SCORES,
  VALUE_BAND_REASON_CODES,
  DIMENSION_WEIGHTS,
} from "../config/qualification-v1.ts";

export interface ScoreComponent {
  dimension: "need" | "value" | "activity" | "reachability";
  componentKey: string;
  result: number;
  direction: "positive" | "negative" | "neutral";
  reasonCode: string;
  explanation: string;
}

export interface QualificationScore {
  overall: number;
  dimensions: {
    need: number;
    value: number;
    activity: number;
    reachability: number;
  };
  components: ScoreComponent[];
}

export function calculateScore(features: QualificationFeatures): QualificationScore {
  const components: ScoreComponent[] = [];

  let need = 0;
  for (const config of NEED_FEATURES) {
    if (features.need[config.feature] === true) {
      need += config.weight;
      components.push({
        dimension: "need",
        componentKey: config.feature,
        result: config.weight,
        direction: "positive", // a deficiency raises SaltBox's interest
        reasonCode: config.reasonCode,
        explanation: config.explanation,
      });
    }
  }
  need = Math.min(100, need);

  const value = VALUE_BAND_SCORES[features.valueBand];
  components.push({
    dimension: "value",
    componentKey: "industry_value_band",
    result: value,
    direction: "neutral",
    reasonCode: VALUE_BAND_REASON_CODES[features.valueBand],
    explanation: `industry value band is ${features.valueBand}`,
  });

  let activity = 0;
  for (const config of ACTIVITY_FEATURES) {
    if (features.activity[config.feature] === true) {
      activity += config.weight;
      components.push({
        dimension: "activity",
        componentKey: config.feature,
        result: config.weight,
        direction: "positive",
        reasonCode: config.reasonCode,
        explanation: config.explanation,
      });
    }
  }

  let reachability = 0;
  for (const config of REACHABILITY_FEATURES) {
    if (features.reachability[config.feature] === true) {
      reachability += config.weight;
      components.push({
        dimension: "reachability",
        componentKey: config.feature,
        result: config.weight,
        direction: "positive",
        reasonCode: config.reasonCode,
        explanation: config.explanation,
      });
    }
  }

  const overall = Math.round(
    need * DIMENSION_WEIGHTS.need +
      value * DIMENSION_WEIGHTS.value +
      activity * DIMENSION_WEIGHTS.activity +
      reachability * DIMENSION_WEIGHTS.reachability
  );

  return { overall, dimensions: { need, value, activity, reachability }, components };
}
