/**
 * Local filesystem artifact store — the development implementation.
 *
 * Every key is validated before it touches the filesystem and the resolved
 * path is re-checked against the root, so a hostile key can never escape the
 * store directory.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  assertArtifactKey,
  hashArtifact,
  type ArtifactMetadata,
  type ArtifactStore,
  type StoredArtifact,
} from "./index.ts";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class LocalArtifactStore implements ArtifactStore {
  readonly provider = "local";
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  get root(): string {
    return this.#root;
  }

  async put(key: string, body: Uint8Array, options: { contentType: string }): Promise<ArtifactMetadata> {
    const path = this.#resolveKey(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return {
      key,
      contentType: options.contentType,
      byteSize: body.byteLength,
      contentHash: await hashArtifact(body),
    };
  }

  async get(key: string): Promise<StoredArtifact | undefined> {
    let path: string;
    try {
      path = this.#resolveKey(key);
    } catch {
      return undefined;
    }
    let body: Buffer;
    try {
      body = readFileSync(path);
    } catch {
      return undefined;
    }
    const bytes = new Uint8Array(body);
    return {
      key,
      contentType: contentTypeFor(key),
      byteSize: bytes.byteLength,
      contentHash: await hashArtifact(bytes),
      body: bytes,
    };
  }

  async has(key: string): Promise<boolean> {
    try {
      return statSync(this.#resolveKey(key)).isFile();
    } catch {
      return false;
    }
  }

  #resolveKey(key: string): string {
    assertArtifactKey(key);
    const path = resolve(this.#root, ...key.split("/"));
    if (!path.startsWith(this.#root + sep)) {
      throw new Error(`Artifact key "${key}" resolved outside the artifact root.`);
    }
    return path;
  }
}

export function contentTypeFor(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
