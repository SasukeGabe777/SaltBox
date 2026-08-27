/**
 * In-memory artifact store for tests and dry runs. Validates keys exactly
 * like the real implementations so a test cannot pass with a key that the
 * local or R2 store would reject.
 */

import {
  assertArtifactKey,
  hashArtifact,
  type ArtifactMetadata,
  type ArtifactStore,
  type StoredArtifact,
} from "./index.ts";

export class MemoryArtifactStore implements ArtifactStore {
  readonly provider: string;
  readonly #objects = new Map<string, { body: Uint8Array; contentType: string }>();

  constructor(provider = "memory") {
    this.provider = provider;
  }

  get size(): number {
    return this.#objects.size;
  }

  keys(): string[] {
    return [...this.#objects.keys()].sort();
  }

  async put(key: string, body: Uint8Array, options: { contentType: string }): Promise<ArtifactMetadata> {
    assertArtifactKey(key);
    this.#objects.set(key, { body: new Uint8Array(body), contentType: options.contentType });
    return { key, contentType: options.contentType, byteSize: body.byteLength, contentHash: await hashArtifact(body) };
  }

  async get(key: string): Promise<StoredArtifact | undefined> {
    try {
      assertArtifactKey(key);
    } catch {
      return undefined;
    }
    const object = this.#objects.get(key);
    if (!object) return undefined;
    return {
      key,
      contentType: object.contentType,
      byteSize: object.body.byteLength,
      contentHash: await hashArtifact(object.body),
      body: object.body,
    };
  }

  async has(key: string): Promise<boolean> {
    return this.#objects.has(key);
  }
}
