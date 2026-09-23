/**
 * Zero-cost pixel analysis for candidate photography (brand-intelligence-v2).
 *
 * Every downloaded photo is normalized IN MEMORY first — uniform borders and
 * letterboxing trimmed, EXIF orientation honored, bounded to PHOTO_MAX_WIDTH —
 * and measured: brightness (images pre-darkened to sit behind text), entropy
 * (flat graphics/text banners versus real photos), how much border was
 * trimmed, and a difference hash for near-duplicate detection. Only images
 * that later win a demo slot are written to the asset store.
 */

import sharp from "sharp";
import { AssetRejectedError, type FetchedAsset } from "./assets.ts";
import { MIN_PHOTO_HEIGHT, MIN_PHOTO_WIDTH, PHOTO_MAX_WIDTH, type ImageVisualMetrics } from "./types.ts";

export interface NormalizedPhoto {
  /** Normalized JPEG bytes, ready to write if the photo is selected. */
  jpeg: Buffer;
  metrics: ImageVisualMetrics;
}

/** Trim threshold: how far (0-255) a pixel may differ from the border color. */
const TRIM_THRESHOLD = 18;

export async function normalizeAndMeasurePhoto(asset: FetchedAsset): Promise<NormalizedPhoto> {
  if (asset.contentType === "image/svg+xml") {
    throw new AssetRejectedError("SVG is not accepted as photography", "disallowed_type");
  }
  let oriented: Buffer;
  let originalArea: number;
  try {
    const rotated = await sharp(asset.bytes, { animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toBuffer({ resolveWithObject: true });
    oriented = rotated.data;
    originalArea = rotated.info.width * rotated.info.height;
  } catch (error) {
    throw new AssetRejectedError(
      `photo could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      "undecodable",
    );
  }

  // Letterboxing/padding (white or black bands around the real photo).
  let trimmed = oriented;
  let trimmedArea = originalArea;
  try {
    const result = await sharp(oriented).trim({ threshold: TRIM_THRESHOLD }).toBuffer({ resolveWithObject: true });
    const area = result.info.width * result.info.height;
    // A trim that removes most of the image means it was a flat graphic.
    if (area >= originalArea * 0.25) {
      trimmed = result.data;
      trimmedArea = area;
    }
  } catch {
    /* sharp throws when the whole image is one color; keep the original */
  }
  const borderFraction = originalArea > 0 ? round(1 - trimmedArea / originalArea, 3) : 0;

  const bounded = sharp(trimmed).resize({ width: PHOTO_MAX_WIDTH, withoutEnlargement: true });
  const { data: jpeg, info } = await bounded
    .clone()
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  if (info.width < MIN_PHOTO_WIDTH || info.height < MIN_PHOTO_HEIGHT) {
    throw new AssetRejectedError(`photo is only ${info.width}x${info.height} after trimming borders`, "too_small");
  }

  const stats = await sharp(jpeg).stats();
  const [r, g, b] = stats.channels;
  const meanLuma = r && g && b ? 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean : 0;
  return {
    jpeg,
    metrics: {
      meanLuma: round(meanLuma, 1),
      entropy: round(stats.entropy, 2),
      borderFraction,
      width: info.width,
      height: info.height,
      dhash: await differenceHash(jpeg),
    },
  };
}

/** 64-bit dHash: compare adjacent pixels of a 9x8 grayscale thumbnail. */
export async function differenceHash(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += data[row * 9 + column]! < data[row * 9 + column + 1]! ? "1" : "0";
    }
  }
  let hex = "";
  for (let index = 0; index < 64; index += 4) hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

/** Hamming distance between two hex dHashes (0 = identical). */
export function hashDistance(a: string, b: string): number {
  let distance = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    let xor = parseInt(a[index]!, 16) ^ parseInt(b[index]!, 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
