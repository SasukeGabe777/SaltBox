/**
 * Template registry: one renderer serves many demos by mapping the persisted
 * (template name, version) pair to a render function over demo-content-v1.
 * Unknown template identities fail loudly rather than guessing.
 */

import type { DemoContent } from "@saltbox/demo-generation/content-model";
import { DEMO_CONTENT_VERSION } from "@saltbox/demo-generation/config";
import { renderLocalServiceV1 } from "./local-service-v1.ts";

export type TemplateRenderer = (content: DemoContent) => string;

const RENDERERS: Record<string, TemplateRenderer> = {
  "local-service@1.0.0": renderLocalServiceV1,
};

export function resolveTemplateRenderer(templateName: string, templateVersion: string): TemplateRenderer | undefined {
  return RENDERERS[`${templateName}@${templateVersion}`];
}

/** Validate that persisted content is a demo-content-v1 document. */
export function asDemoContent(value: Record<string, unknown> | null): DemoContent | undefined {
  if (!value || value.contentVersion !== DEMO_CONTENT_VERSION) return undefined;
  return value as unknown as DemoContent;
}
