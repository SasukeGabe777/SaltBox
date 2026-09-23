/**
 * Wires website-intelligence homepage captures into demo generation as the
 * "before" side of the comparison slider. Kept out of generate.ts (like brand
 * extraction) so tests and offline runs stay free of file-system coupling.
 */

import { exportBeforeSnapshots } from "@saltbox/website-intelligence/snapshots";
import { DEMO_ASSET_URL_PREFIX } from "./brand-view.ts";
import type { BeforeSnapshots } from "./content.ts";
import type { DemoSourceFacts } from "./types.ts";

export type BeforeSnapshotProvider = (facts: DemoSourceFacts) => Promise<BeforeSnapshots | undefined>;

export function createBeforeSnapshotProvider(options: {
  /** Directory holding website-intelligence run artifacts (.data/website-intelligence). */
  intelligenceRoot: string;
  /** Directory holding demo-asset runs (.data/demo-assets). */
  demoAssetRoot: string;
}): BeforeSnapshotProvider {
  return async (facts) => {
    const artifacts = facts.intelligence?.findings.artifacts;
    const ref =
      typeof artifacts === "object" && artifacts !== null && typeof (artifacts as { ref?: unknown }).ref === "string"
        ? (artifacts as { ref: string }).ref
        : undefined;
    if (!ref) return undefined;
    const exported = await exportBeforeSnapshots({
      intelligenceRoot: options.intelligenceRoot,
      demoAssetRoot: options.demoAssetRoot,
      artifactRef: ref,
    });
    const image = (entry: typeof exported.desktop, alt: string) =>
      entry ? { url: `${DEMO_ASSET_URL_PREFIX}/${entry.assetRef}/${entry.fileName}`, width: entry.width, height: entry.height, alt } : undefined;
    const desktop = image(exported.desktop, `${facts.businessName} homepage today, on a desktop screen`);
    const mobile = image(exported.mobile, `${facts.businessName} homepage today, on a phone`);
    if (!desktop && !mobile) return undefined;
    return { ...(desktop ? { desktop } : {}), ...(mobile ? { mobile } : {}) };
  };
}
