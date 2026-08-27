/**
 * Read-only serving of locally stored demo assets (logos and photos the
 * brand pipeline downloaded, validated, and re-encoded). The run reference
 * and filename are strictly validated against the known naming scheme — no
 * traversal, no absolute paths, no reads outside the asset root, and only
 * the image types the pipeline produces.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

export const DEMO_ASSET_REF_PATTERN = /^[0-9]{14}-[a-z0-9-]{1,60}$/;
const FILE_PATTERN = /^[a-z0-9-]{1,40}\.(png|jpg|jpeg|webp)$/;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface DemoAssetResponse {
  status: number;
  contentType?: string;
  body?: Buffer;
}

export function loadDemoAsset(assetRoot: string, ref: string, file: string): DemoAssetResponse {
  if (!DEMO_ASSET_REF_PATTERN.test(ref) || !FILE_PATTERN.test(file)) return { status: 404 };
  const extension = file.split(".").pop()!;
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) return { status: 404 };
  const root = resolve(assetRoot);
  const path = resolve(root, ref, file);
  if (!path.startsWith(root + sep) || !existsSync(path)) return { status: 404 };
  return { status: 200, contentType, body: readFileSync(path) };
}
