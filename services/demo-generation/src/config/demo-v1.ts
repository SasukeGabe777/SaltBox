/**
 * Phase 8 versioned demo-generation contract. Deterministic-first: no AI is
 * involved anywhere in this pipeline, and every value here is a reviewable
 * human decision, not a learned artifact.
 */

/** Structured content input schema persisted on demo_version. */
export const DEMO_CONTENT_VERSION = "demo-content-v1";
/** Deterministic copy generator version persisted on demo_version. */
export const DEMO_COPY_VERSION = "demo-copy-v1";
/** Pre-render plan schema stored in generator metadata. */
export const DEMO_PLAN_VERSION = "demo-plan-v1";
/** Orchestration pipeline identifier for lineage/actor references. */
export const DEMO_PIPELINE_VERSION = "demo-generation-pipeline-v1";

/** The first reusable template family: local service businesses. */
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
