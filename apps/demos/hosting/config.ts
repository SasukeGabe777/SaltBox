/**
 * Minimal reader for the committed, non-secret wrangler configuration.
 *
 * Deliberately a small regex reader rather than a TOML dependency: SaltBox
 * needs four values (worker name, compatibility date, Hyperdrive id, bucket
 * name) and must be able to tell an operator exactly which placeholder is
 * still unfilled.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

export interface HostingConfig {
  path: string;
  workerName: string;
  compatibilityDate: string;
  hyperdriveId: string;
  bucketName: string;
  /** Config keys still holding a committed placeholder value. */
  placeholders: string[];
}

export function readHostingConfig(appDir: string): HostingConfig {
  const path = resolve(appDir, "wrangler.toml");
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Missing ${path}; the hosted renderer configuration is required.`);
  }
  const workerName = scalar(raw, "name") ?? "saltbox-demos";
  const compatibilityDate = scalar(raw, "compatibility_date") ?? "";
  const hyperdriveId = scalar(raw, "id") ?? "";
  const bucketName = scalar(raw, "bucket_name") ?? "saltbox-demo-assets";
  const placeholders: string[] = [];
  if (hyperdriveId.startsWith(PLACEHOLDER_PREFIX) || hyperdriveId === "") placeholders.push("hyperdrive.id");
  if (bucketName.startsWith(PLACEHOLDER_PREFIX)) placeholders.push("r2_buckets.bucket_name");
  return { path, workerName, compatibilityDate, hyperdriveId, bucketName, placeholders };
}

function scalar(raw: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(raw);
  return match?.[1];
}
