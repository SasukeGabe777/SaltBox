/**
 * Wires real brand extraction (website-intelligence Chromium + safe asset
 * pipeline) into demo generation as an injectable BrandExtractor. Kept out
 * of generate.ts so tests and offline runs never touch Chromium.
 *
 * Photo selection gets the zero-cost local CLIP classifier by default; its
 * model is downloaded once into a git-ignored cache beside the asset store
 * (.data/models). If it cannot load, extraction continues on heuristics.
 */

import { resolve } from "node:path";

import type { Database } from "@saltbox/database/client";
import { analyzeBrandIntelligence, newBrandArtifactRef, type BrandLog } from "@saltbox/website-intelligence/brand";
import { createClipClassifier, type ImageClassifier } from "@saltbox/website-intelligence/brand/image-classifier";
import { persistBrandIntelligence } from "@saltbox/website-intelligence/brand/persistence";
import type { BrandExtractor } from "./generate.ts";
import type { DemoSourceFacts } from "./types.ts";

export interface CreateBrandExtractorOptions {
  /** Absolute directory holding all demo-asset runs (.data/demo-assets). */
  assetRoot: string;
  log?: BrandLog;
  /** Override the visual classifier; `null` disables it (heuristics only). */
  imageClassifier?: ImageClassifier | null;
}

export function createBrandExtractor(db: Database, options: CreateBrandExtractorOptions): BrandExtractor {
  // One lazily loaded model per extractor, shared across prospects in a run.
  const imageClassifier =
    options.imageClassifier === undefined
      ? createClipClassifier({ cacheDir: resolve(options.assetRoot, "..", "models") })
      : options.imageClassifier;
  return async (facts: DemoSourceFacts) => {
    if (!facts.websiteUrl) throw new Error("Prospect has no website; brand extraction is not applicable.");
    if (!facts.websiteId) throw new Error("Prospect has no website identity row; cannot persist brand evidence.");
    const profile = await analyzeBrandIntelligence(facts.websiteUrl, {
      assetRoot: options.assetRoot,
      artifactRef: newBrandArtifactRef(facts.businessName),
      businessName: facts.businessName,
      category: facts.category,
      ...(options.log ? { log: options.log } : {}),
      ...(imageClassifier ? { imageClassifier } : {}),
    });
    await persistBrandIntelligence(db, {
      businessId: facts.businessId,
      websiteId: facts.websiteId,
      profile,
    });
  };
}
