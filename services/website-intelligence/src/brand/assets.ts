/**
 * Safe asset acquisition for demo generation.
 *
 * Selected images are fetched ONCE through the same SSRF boundary as every
 * other outbound request (public-DNS validation per redirect hop), validated
 * (MIME allowlist, byte cap, decodable by sharp), normalized (resized,
 * re-encoded, SVG rasterized — raw SVG is never stored), and written into
 * the git-ignored local demo-asset store. Rendered demos reference only
 * these local artifacts — prospect sites are never hotlinked.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { checkNavigationTarget, type UrlSafetyOptions } from "../url-safety.ts";
import { INTELLIGENCE_HTTP_UA, MAX_REDIRECT_HOPS } from "../version.ts";
import { ASSET_FETCH_TIMEOUT_MS, LOGO_MAX_WIDTH, MAX_ASSET_BYTES, PHOTO_MAX_WIDTH } from "./types.ts";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchedAsset {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
}

export type AssetRejectionReason =
  | "blocked_target"
  | "http_error"
  | "disallowed_type"
  | "too_large"
  | "timeout"
  | "unreachable"
  | "undecodable"
  | "too_small";

export class AssetRejectedError extends Error {
  readonly reason: AssetRejectionReason;

  constructor(message: string, reason: AssetRejectionReason) {
    super(message);
    this.name = "AssetRejectedError";
    this.reason = reason;
  }
}

/** Fetch one remote image with per-hop SSRF validation and a hard byte cap. */
export async function fetchImageAsset(url: string, safety: UrlSafetyOptions = {}): Promise<FetchedAsset> {
  const fetchImpl = safety.fetchImpl ?? fetch;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new AssetRejectedError(`"${url}" is not a valid URL`, "blocked_target");
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const verdict = await checkNavigationTarget(current, safety);
    if (!verdict.ok) {
      throw new AssetRejectedError(verdict.reason ?? "blocked asset target", "blocked_target");
    }
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS),
        headers: { "user-agent": INTELLIGENCE_HTTP_UA, accept: "image/*" },
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new AssetRejectedError(
        timedOut ? "asset request timed out" : `asset request failed: ${error instanceof Error ? error.message : String(error)}`,
        timedOut ? "timeout" : "unreachable",
      );
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new AssetRejectedError(`redirect ${response.status} without Location`, "unreachable");
      try {
        current = new URL(location, current);
      } catch {
        throw new AssetRejectedError("redirect contained an invalid Location", "unreachable");
      }
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new AssetRejectedError(`asset responded ${response.status}`, "http_error");
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel();
      throw new AssetRejectedError(`disallowed content-type "${contentType}"`, "disallowed_type");
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_ASSET_BYTES) {
      await response.body?.cancel();
      throw new AssetRejectedError(`declared size ${declared} exceeds the ${MAX_ASSET_BYTES}-byte cap`, "too_large");
    }
    const bytes = await readCapped(response, MAX_ASSET_BYTES);
    return { bytes, contentType, finalUrl: current.toString() };
  }
  throw new AssetRejectedError(`more than ${MAX_REDIRECT_HOPS} redirects`, "unreachable");
}

async function readCapped(response: Response, cap: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new AssetRejectedError(`asset exceeded the ${cap}-byte cap while streaming`, "too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface ProcessedImage {
  file: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Normalize a fetched logo: decode (SVG is rasterized — never stored raw),
 * bound to LOGO_MAX_WIDTH, preserve transparency, write as PNG.
 */
export async function processLogoAsset(
  asset: FetchedAsset,
  directory: string,
  baseName: string,
  minDimension: number,
): Promise<ProcessedImage> {
  const input =
    asset.contentType === "image/svg+xml" ? sharp(asset.bytes, { density: 300 }) : sharp(asset.bytes, { animated: false });
  let pipeline;
  try {
    const metadata = await input.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (Math.max(width, height) < minDimension) {
      throw new AssetRejectedError(`logo is only ${width}x${height}`, "too_small");
    }
    pipeline = input.resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_WIDTH, fit: "inside", withoutEnlargement: true }).png();
  } catch (error) {
    if (error instanceof AssetRejectedError) throw error;
    throw new AssetRejectedError(
      `logo could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      "undecodable",
    );
  }
  return writeProcessed(pipeline, directory, `${baseName}.png`);
}

/** Normalize a photo: decode, bound to PHOTO_MAX_WIDTH, re-encode as JPEG. */
export async function processPhotoAsset(
  asset: FetchedAsset,
  directory: string,
  baseName: string,
): Promise<ProcessedImage> {
  if (asset.contentType === "image/svg+xml") {
    throw new AssetRejectedError("SVG is not accepted as photography", "disallowed_type");
  }
  let pipeline;
  try {
    await sharp(asset.bytes, { animated: false }).metadata();
    pipeline = sharp(asset.bytes, { animated: false })
      .rotate() // honor EXIF orientation deterministically
      .resize({ width: PHOTO_MAX_WIDTH, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, mozjpeg: true });
  } catch (error) {
    throw new AssetRejectedError(
      `photo could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      "undecodable",
    );
  }
  return writeProcessed(pipeline, directory, `${baseName}.jpg`);
}

async function writeProcessed(pipeline: sharp.Sharp, directory: string, fileName: string): Promise<ProcessedImage> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, fileName);
  if (!path.startsWith(resolve(directory) + sep) && path !== resolve(directory, fileName)) {
    throw new AssetRejectedError("asset path escaped the artifact directory", "blocked_target");
  }
  writeFileSync(path, data);
  return { file: fileName, width: info.width, height: info.height, bytes: data.byteLength };
}

/** Dominant brand-usable colors from a decoded logo (strongest first, max 3). */
export async function extractLogoColors(bytes: Buffer): Promise<Array<{ r: number; g: number; b: number }>> {
  const { data, info } = await sharp(bytes, { animated: false })
    .resize(48, 48, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = data[index + 3]!;
    if (alpha < 128) continue;
    const r = data[index]!;
    const g = data[index + 1]!;
    const b = data[index + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip near-white/near-black/grey pixels — they are rarely the brand color.
    if (max > 235 && min > 215) continue;
    if (max < 40) continue;
    if (max - min < 24) continue;
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = counts.get(key);
    if (bucket) {
      bucket.count += 1;
    } else {
      counts.set(key, { r, g, b, count: 1 });
    }
  }
  const total = info.width * info.height;
  return [...counts.values()]
    .filter((bucket) => bucket.count >= Math.max(8, total * 0.01))
    .sort((a, b) => b.count - a.count || a.r - b.r || a.g - b.g)
    .slice(0, 3)
    .map(({ r, g, b }) => ({ r, g, b }));
}
