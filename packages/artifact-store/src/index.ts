/**
 * Provider-neutral artifact storage (ADR-003/005: provider bindings live in
 * adapters, never in domain code).
 *
 * Demo generation and publication say "store these bytes under this key" and
 * never "write this to R2". The interface is intentionally tiny — put, get,
 * has — because SaltBox needs durable demo assets, not a storage framework.
 *
 *   local development : LocalArtifactStore  (.data/demo-assets)
 *   hosted            : R2ArtifactStore     (Cloudflare R2 binding)
 */

/** Keys are `<segment>/<segment>[/...]`, lowercase, no traversal, no absolutes. */
const KEY_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_KEY_SEGMENTS = 4;

export class ArtifactKeyError extends Error {
  constructor(key: string, detail: string) {
    super(`Invalid artifact key "${key}": ${detail}`);
    this.name = "ArtifactKeyError";
  }
}

/** Validate an artifact key. Throws rather than silently normalizing. */
export function assertArtifactKey(key: string): void {
  if (key.length === 0 || key.length > 320) throw new ArtifactKeyError(key, "length must be 1..320 characters");
  if (key.includes("\\") || key.includes("//")) throw new ArtifactKeyError(key, "invalid separators");
  const segments = key.split("/");
  if (segments.length > MAX_KEY_SEGMENTS) throw new ArtifactKeyError(key, `at most ${MAX_KEY_SEGMENTS} segments`);
  for (const segment of segments) {
    if (segment === "." || segment === "..") throw new ArtifactKeyError(key, "relative segments are not allowed");
    if (!KEY_SEGMENT.test(segment)) throw new ArtifactKeyError(key, `segment "${segment}" is not allowed`);
  }
}

export function isValidArtifactKey(key: string): boolean {
  try {
    assertArtifactKey(key);
    return true;
  } catch {
    return false;
  }
}

export interface ArtifactMetadata {
  key: string;
  contentType: string;
  byteSize: number;
  /** Lowercase hex SHA-256 of the stored bytes. */
  contentHash: string;
}

export interface StoredArtifact extends ArtifactMetadata {
  body: Uint8Array;
}

export interface ArtifactStore {
  /** Stable provider identifier persisted with the artifact metadata. */
  readonly provider: string;
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<ArtifactMetadata>;
  get(key: string): Promise<StoredArtifact | undefined>;
  has(key: string): Promise<boolean>;
}

/** SHA-256 over the Web Crypto API (works in Node and in workerd). */
export async function hashArtifact(body: Uint8Array): Promise<string> {
  const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The demo-asset key convention shared by every environment. */
export function demoAssetKey(assetRef: string, fileName: string): string {
  const key = `demo-assets/${assetRef}/${fileName}`;
  assertArtifactKey(key);
  return key;
}
