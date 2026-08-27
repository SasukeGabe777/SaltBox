/**
 * Wires real brand extraction (website-intelligence Chromium + safe asset
 * pipeline) into demo generation as an injectable BrandExtractor. Kept out
 * of generate.ts so tests and offline runs never touch Chromium.
 */

import type { Database } from "@saltbox/database/client";
import { analyzeBrandIntelligence, newBrandArtifactRef, type BrandLog } from "@saltbox/website-intelligence/brand";
import { persistBrandIntelligence } from "@saltbox/website-intelligence/brand/persistence";
import type { BrandExtractor } from "./generate.ts";
import type { DemoSourceFacts } from "./types.ts";

export interface CreateBrandExtractorOptions {
  /** Absolute directory holding all demo-asset runs (.data/demo-assets). */
  assetRoot: string;
  log?: BrandLog;
}

export function createBrandExtractor(db: Database, options: CreateBrandExtractorOptions): BrandExtractor {
  return async (facts: DemoSourceFacts) => {
    if (!facts.websiteUrl) throw new Error("Prospect has no website; brand extraction is not applicable.");
    if (!facts.websiteId) throw new Error("Prospect has no website identity row; cannot persist brand evidence.");
    const profile = await analyzeBrandIntelligence(facts.websiteUrl, {
      assetRoot: options.assetRoot,
      artifactRef: newBrandArtifactRef(facts.businessName),
      businessName: facts.businessName,
      category: facts.category,
      ...(options.log ? { log: options.log } : {}),
    });
    await persistBrandIntelligence(db, {
      businessId: facts.businessId,
      websiteId: facts.websiteId,
      profile,
    });
  };
}
