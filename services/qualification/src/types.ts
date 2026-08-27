import type { WebsiteIntelligenceResult } from "@saltbox/website-intelligence";
import type { TargetFitClassification, ValueBandV2 } from "./config/qualification-v2.ts";

export interface QualificationV2BusinessInput {
  name: string;
  category?: string;
  websiteUrl?: string;
  email?: string;
  phone?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface EvidenceRef {
  kind: "observation" | "website_analysis";
  id: string;
  field?: string;
}

export interface QualificationV2Features {
  values: Record<string, boolean | string | number>;
  valueBand: ValueBandV2;
  targetFit: TargetFitClassification;
  intelligenceStatus: "complete" | "partial" | "failed" | "skipped_no_website";
  intelligenceFailureKind: string | null;
  intelligenceTransient: boolean;
  hasReachableContactPath: boolean;
  evidence: Record<string, EvidenceRef[]>;
  stable: {
    mobilePass?: boolean;
    emailAvailable: boolean;
    businessCategory?: string;
    websitePerformanceScore?: number;
  };
  intelligence: WebsiteIntelligenceResult | null;
}

export interface QualificationV2ScoreComponent {
  dimension: "need" | "value" | "activity" | "reachability" | "rule";
  componentKey: string;
  result: number;
  direction: "positive" | "negative" | "neutral";
  reasonCode: string;
  explanation: string;
  observedValue: boolean | string | number | null;
  evidence: EvidenceRef[];
}

export interface QualificationV2Score {
  overall: number;
  dimensions: { need: number; value: number; activity: number; reachability: number };
  components: QualificationV2ScoreComponent[];
}
