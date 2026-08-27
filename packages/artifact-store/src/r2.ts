/**
 * Cloudflare R2 artifact store.
 *
 * The R2 binding is described structurally so no Cloudflare package or type
 * leaks into SaltBox code: the adapter needs put/get/head and nothing else.
 * This module imports no Node APIs and runs unchanged in workerd.
 */

import {
  assertArtifactKey,
  hashArtifact,
  type ArtifactMetadata,
  type ArtifactStore,
  type StoredArtifact,
} from "./index.ts";

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string } | undefined;
  size?: number | undefined;
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<unknown | null>;
}

export class R2ArtifactStore implements ArtifactStore {
  readonly provider = "cloudflare-r2";
  readonly #bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.#bucket = bucket;
  }

  async put(key: string, body: Uint8Array, options: { contentType: string }): Promise<ArtifactMetadata> {
    assertArtifactKey(key);
    const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    await this.#bucket.put(key, buffer, { httpMetadata: { contentType: options.contentType } });
    return {
      key,
      contentType: options.contentType,
      byteSize: body.byteLength,
      contentHash: await hashArtifact(body),
    };
  }

  async get(key: string): Promise<StoredArtifact | undefined> {
    try {
      assertArtifactKey(key);
    } catch {
      return undefined;
    }
    const object = await this.#bucket.get(key);
    if (object === null) return undefined;
    const body = new Uint8Array(await object.arrayBuffer());
    return {
      key,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      byteSize: body.byteLength,
      contentHash: await hashArtifact(body),
      body,
    };
  }

  async has(key: string): Promise<boolean> {
    try {
      assertArtifactKey(key);
    } catch {
      return false;
    }
    return (await this.#bucket.head(key)) !== null;
  }
}
