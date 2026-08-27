export * from "./types.ts";
export * from "./config/demo-v1.ts";
export { buildDemoPlan, deriveDemoDeficiencies } from "./plan.ts";
export { buildDemoContent, pickDeterministic, logotypeFor } from "./content.ts";
export { assertNoUnsupportedClaims, findUnsupportedClaims } from "./claims-guard.ts";
export { evaluateDemoEligibility, type DemoEligibility, type EligibilityReason } from "./eligibility.ts";
export { collectDemoSourceFacts, formatPhoneDisplay } from "./facts.ts";
export {
  generateDemoForProspect,
  demoContentHash,
  stableStringify,
  newLocatorToken,
  DEFAULT_DEMOS_BASE_URL,
  type GenerateDemoOptions,
  type GenerateDemoResult,
  type GeneratedDemoSummary,
} from "./generate.ts";
