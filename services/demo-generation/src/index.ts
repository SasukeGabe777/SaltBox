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
  approveDemoVersion,
  rejectDemoVersion,
  evaluateQaGate,
  DEMO_APPROVAL_POLICY_VERSION,
  type ApprovalBlocker,
  type ApproveDemoVersionResult,
  type RejectDemoVersionResult,
} from "./approval.ts";
export {
  evaluateDemoQaReport,
  persistDemoQaResult,
  CRITICAL_QA_CHECKS,
  DEMO_QA_RUNNER_VERSION,
  type DemoQaCheck,
  type DemoQaEvaluation,
  type DemoQaReport,
} from "./qa.ts";
export {
  publishDemo,
  collectDemoAssetReferences,
  DEMO_PUBLICATION_VERSION,
  type PublishDemoInput,
  type PublishDemoResult,
} from "./publish.ts";
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
