/**
 * Template registry: one renderer serves many demos by mapping the persisted
 * (template name, version) pair to a render function over the versioned
 * demo-content contract. Phase 8 demo-content-v1 versions keep rendering
 * through the frozen local-service@1.0.0 template; Phase 9 compositions
 * consume demo-content-v2 (a backward-compatible superset). Unknown template
 * identities fail loudly rather than guessing.
 */

import type { DemoContent } from "@saltbox/demo-generation/content-model";
import { SUPPORTED_DEMO_CONTENT_VERSIONS } from "@saltbox/demo-generation/config";
import { renderLocalServiceV1 } from "./local-service-v1.ts";
import { renderLocalServiceCleanV1 } from "./local-service-clean-v1.ts";
import { renderLocalServiceBoldV1 } from "./local-service-bold-v1.ts";
import { renderLocalServicePremiumV1 } from "./local-service-premium-v1.ts";

export type TemplateRenderer = (content: DemoContent) => string;

const RENDERERS: Record<string, TemplateRenderer> = {
  "local-service@1.0.0": renderLocalServiceV1,
  "local-service-clean@1.0.0": renderLocalServiceCleanV1,
  "local-service-bold@1.0.0": renderLocalServiceBoldV1,
  "local-service-premium@1.0.0": renderLocalServicePremiumV1,
};

export function resolveTemplateRenderer(templateName: string, templateVersion: string): TemplateRenderer | undefined {
  return RENDERERS[`${templateName}@${templateVersion}`];
}

/** Validate that persisted content is a supported demo-content document. */
export function asDemoContent(value: Record<string, unknown> | null): DemoContent | undefined {
  if (!value || typeof value.contentVersion !== "string") return undefined;
  if (!SUPPORTED_DEMO_CONTENT_VERSIONS.includes(value.contentVersion)) return undefined;
  return value as unknown as DemoContent;
}
