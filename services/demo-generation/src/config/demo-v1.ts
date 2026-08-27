/**
 * Phase 8 versioned demo-generation contract. Deterministic-first: no AI is
 * involved anywhere in this pipeline, and every value here is a reviewable
 * human decision, not a learned artifact.
 */

/** Phase 8 structured content schema (still rendered for old DemoVersions). */
export const DEMO_CONTENT_VERSION_V1 = "demo-content-v1";
/** Phase 9 structured content schema (brand palette/logo/imagery/services). */
export const DEMO_CONTENT_VERSION_V2 = "demo-content-v2";
/** Current content schema produced by generation. */
export const DEMO_CONTENT_VERSION = DEMO_CONTENT_VERSION_V2;
export const SUPPORTED_DEMO_CONTENT_VERSIONS: readonly string[] = [DEMO_CONTENT_VERSION_V1, DEMO_CONTENT_VERSION_V2];

/** Deterministic copy generator version persisted on demo_version. */
export const DEMO_COPY_VERSION = "demo-copy-v2";
/** Pre-render plan schema stored in generator metadata (v1 history preserved). */
export const DEMO_PLAN_VERSION = "demo-plan-v2";
/** Orchestration pipeline identifier for lineage/actor references. */
export const DEMO_PIPELINE_VERSION = "demo-generation-pipeline-v2";

/** The Phase 8 template, kept registered so existing DemoVersions render. */
export const LOCAL_SERVICE_TEMPLATE_NAME = "local-service";
export const LOCAL_SERVICE_TEMPLATE_VERSION = "1.0.0";
/** Renderer module id recorded as the template-version artifact reference. */
export const LOCAL_SERVICE_TEMPLATE_ARTIFACT_REF = "apps/demos/server/templates/local-service-v1";

/** Eligibility contract: only this policy's qualified decisions are demo-eligible by default. */
export const ELIGIBLE_POLICY_VERSION = "qualification-policy-v2";

export interface TemplateSelection {
  templateName: string;
  templateVersion: string;
  reason: string;
}

/**
 * Deterministic category -> template mapping. Simple and inspectable by
 * design (no AI selection). Categories outside the local-service family have
 * no Phase 8 template and are reported as ineligible rather than guessed at.
 */
export const LOCAL_SERVICE_CATEGORIES: ReadonlySet<string> = new Set([
  "roofing",
  "plumbing",
  "electrical",
  "hvac",
  "landscaping",
  "painting",
  "concrete",
  "flooring",
  "remodeling",
  "pest_control",
  "tree_service",
  "contractor",
  "handyman",
]);

export function selectDemoTemplate(category: string | null): TemplateSelection | undefined {
  if (category !== null && LOCAL_SERVICE_CATEGORIES.has(category)) {
    return {
      templateName: LOCAL_SERVICE_TEMPLATE_NAME,
      templateVersion: LOCAL_SERVICE_TEMPLATE_VERSION,
      reason: `category "${category}" is in the local-service template family (deterministic mapping demo-v1)`,
    };
  }
  return undefined;
}

// --- Phase 9 layout compositions ---------------------------------------------

/** Three meaningfully different local-service compositions (one renderer). */
export const COMPOSITIONS = {
  premium: { templateName: "local-service-premium", templateVersion: "1.0.0", artifactRef: "apps/demos/server/templates/local-service-premium-v1" },
  bold: { templateName: "local-service-bold", templateVersion: "1.0.0", artifactRef: "apps/demos/server/templates/local-service-bold-v1" },
  clean: { templateName: "local-service-clean", templateVersion: "1.0.0", artifactRef: "apps/demos/server/templates/local-service-clean-v1" },
} as const;

export type CompositionKey = keyof typeof COMPOSITIONS;

export interface CompositionEvidence {
  /** Width of the best usable hero photograph, when one exists. */
  heroImageWidth?: number;
  usableImageCount: number;
  logoConfidence: "high" | "medium" | "low" | "none";
  paletteConfidence: "high" | "medium" | "low" | "none";
  extractedServiceCount: number;
}

export interface CompositionSelection {
  key: CompositionKey;
  templateName: string;
  templateVersion: string;
  reasons: string[];
}

/**
 * Deterministic, inspectable composition selection (no AI):
 * - a strong hero photograph earns the image-forward premium layout;
 * - a confident extracted brand identity earns the bold layout;
 * - everything else gets the typography-led clean layout, which renders
 *   beautifully with zero brand assets (fallbacks are part of the product).
 */
export function selectComposition(evidence: CompositionEvidence): CompositionSelection {
  const reasons: string[] = [];
  if ((evidence.heroImageWidth ?? 0) >= 1000) {
    reasons.push(`usable hero photograph (${evidence.heroImageWidth}px wide) supports an image-forward layout`);
    if (evidence.usableImageCount > 1) reasons.push(`${evidence.usableImageCount} usable photos allow a gallery treatment`);
    if (evidence.logoConfidence === "high" || evidence.logoConfidence === "medium") {
      reasons.push(`logo confidence is ${evidence.logoConfidence}`);
    }
    return { key: "premium", ...pick("premium"), reasons };
  }
  const strongIdentity =
    (evidence.paletteConfidence === "high" || evidence.paletteConfidence === "medium") &&
    evidence.logoConfidence !== "none";
  if (strongIdentity) {
    reasons.push(
      `extracted palette confidence is ${evidence.paletteConfidence} and a logo was found (${evidence.logoConfidence}) but no hero-grade photograph exists`,
    );
    return { key: "bold", ...pick("bold"), reasons };
  }
  reasons.push(
    `no hero-grade photograph and brand extraction is weak (logo ${evidence.logoConfidence}, palette ${evidence.paletteConfidence}) — the typography-led layout needs no assets`,
  );
  return { key: "clean", ...pick("clean"), reasons };
}

function pick(key: CompositionKey): { templateName: string; templateVersion: string } {
  const composition = COMPOSITIONS[key];
  return { templateName: composition.templateName, templateVersion: composition.templateVersion };
}

/** Human-readable labels for supported categories. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  roofing: "Roofing",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "Heating & Cooling",
  landscaping: "Landscaping",
  painting: "Painting",
  concrete: "Concrete & Masonry",
  flooring: "Flooring",
  remodeling: "Remodeling",
  pest_control: "Pest Control",
  tree_service: "Tree Service",
  contractor: "General Contracting",
  handyman: "Handyman Services",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
