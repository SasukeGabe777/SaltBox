/**
 * "Before" snapshots for the demo comparison slider.
 *
 * Website intelligence already captures the prospect's homepage at a fixed
 * desktop (1366x900) and mobile (390x844) viewport. Demo generation reuses
 * those exact captures — never a fresh visit — so the before/after slider
 * compares the site as it was analyzed against the demo at the same size.
 * Captures are re-encoded (JPEG) into the demo-asset store under the
 * intelligence run's own ref, so the same analysis always yields the same
 * asset URLs (stable content hashes) and publication ships them like any
 * other demo asset.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

/** Intelligence artifact refs share the demo-asset ref shape. */
const REF_PATTERN = /^[0-9]{14}-[a-z0-9-]{1,60}$/;

export interface ExportedSnapshot {
  /** Demo-asset run directory name (the intelligence run ref). */
  assetRef: string;
  fileName: string;
  width: number;
  height: number;
}

export interface ExportedSnapshots {
  desktop?: ExportedSnapshot;
  mobile?: ExportedSnapshot;
}

export async function exportBeforeSnapshots(input: {
  intelligenceRoot: string;
  demoAssetRoot: string;
  artifactRef: string;
}): Promise<ExportedSnapshots> {
  if (!REF_PATTERN.test(input.artifactRef)) return {};
  const result: ExportedSnapshots = {};
  for (const view of ["desktop", "mobile"] as const) {
    const source = resolve(input.intelligenceRoot, input.artifactRef, `${view}.png`);
    if (!existsSync(source)) continue;
    const fileName = `before-${view}.jpg`;
    const directory = resolve(input.demoAssetRoot, input.artifactRef);
    const { data, info } = await sharp(source).flatten({ background: "#ffffff" }).jpeg({ quality: 78, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, fileName), data);
    result[view] = { assetRef: input.artifactRef, fileName, width: info.width, height: info.height };
  }
  return result;
}
