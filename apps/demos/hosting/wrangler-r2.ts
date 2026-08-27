/**
 * Operator-tool R2 store: uploads demo assets to a Cloudflare R2 bucket using
 * the wrangler CLI and the operator's existing Cloudflare login.
 *
 * Why not the S3 API: that would require long-lived R2 access keys stored on
 * this machine. Publication is a rare, operator-initiated action, so reusing
 * the same one-time `wrangler login` the deploy uses keeps SaltBox at zero
 * additional standing credentials.
 *
 * This adapter is used by operator tooling only. The hosted renderer reads R2
 * through its binding (`packages/artifact-store/src/r2.ts`) and never shells
 * out to anything.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveWranglerCommand } from "./config.ts";
import {
  assertArtifactKey,
  hashArtifact,
  type ArtifactMetadata,
  type ArtifactStore,
  type StoredArtifact,
} from "@saltbox/artifact-store";

export interface WranglerR2Options {
  bucket: string;
  /** wrangler executable; defaults to `wrangler` on PATH. */
  command?: string;
  /** Directory containing wrangler.toml. */
  cwd?: string;
}

export class WranglerUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WranglerUnavailableError";
  }
}

export class WranglerR2ArtifactStore implements ArtifactStore {
  readonly provider = "cloudflare-r2";
  readonly #options: Required<WranglerR2Options>;

  constructor(options: WranglerR2Options) {
    this.#options = {
      bucket: options.bucket,
      command: options.command ?? resolveWranglerCommand(options.cwd ?? process.cwd()),
      cwd: options.cwd ?? process.cwd(),
    };
  }

  async put(key: string, body: Uint8Array, options: { contentType: string }): Promise<ArtifactMetadata> {
    assertArtifactKey(key);
    const directory = mkdtempSync(join(tmpdir(), "saltbox-r2-"));
    const file = resolve(directory, "artifact.bin");
    try {
      writeFileSync(file, body);
      const result = spawnSync(
        this.#options.command,
        [
          "r2",
          "object",
          "put",
          `${this.#options.bucket}/${key}`,
          `--file=${file}`,
          `--content-type=${options.contentType}`,
          "--remote",
        ],
        { cwd: this.#options.cwd, encoding: "utf8", shell: process.platform === "win32" },
      );
      if (result.error !== undefined || result.status === null) {
        throw new WranglerUnavailableError(
          `wrangler could not be executed (${result.error?.message ?? "no exit status"}). ` +
            "Install it and run `wrangler login` first.",
        );
      }
      if (result.status !== 0) {
        throw new Error(`wrangler r2 object put failed (exit ${result.status}): ${result.stderr.trim()}`);
      }
      return { key, contentType: options.contentType, byteSize: body.byteLength, contentHash: await hashArtifact(body) };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  get(_key: string): Promise<StoredArtifact | undefined> {
    return Promise.reject(
      new Error("Reading from R2 is not supported by the operator tool; the hosted renderer reads through its binding."),
    );
  }

  has(_key: string): Promise<boolean> {
    return Promise.reject(
      new Error("Existence checks are not supported by the operator tool; publication always uploads."),
    );
  }
}
