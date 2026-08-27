export * from "./types.ts";
export * from "./config/demo-v1.ts";
export { buildDemoPlan, brandViewFromFacts, deriveDemoDeficiencies } from "./plan.ts";
export {
  parseBrandProfile,
  sanitizeText,
  DEMO_ASSET_URL_PREFIX,
  type BrandProfileView,
  type BrandLogoView,
  type BrandImageView,
} from "./brand-view.ts";
export { buildDemoContent, pickDeterministic, logotypeFor, similarServiceTitle } from "./content.ts";
export { assertNoUnsupportedClaims, findUnsupportedClaims } from "./claims-guard.ts";
export { evaluateDemoEligibility, type DemoEligibility, type EligibilityReason } from "./eligibility.ts";
export { collectDemoSourceFacts, formatPhoneDisplay } from "./facts.ts";
export {
  generateDemoForProspect,
  demoContentHash,
  stableStringify,
  newLocatorToken,
  DEFAULT_DEMOS_BASE_URL,
  type BrandExtractor,
  type GenerateDemoOptions,
  type GenerateDemoResult,
  type GeneratedDemoSummary,
} from "./generate.ts";
