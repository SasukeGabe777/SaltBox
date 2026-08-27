/**
 * Security tests for the local artifact resource route: only well-formed
 * run references and allow-listed filenames inside the artifact root may be
 * read; everything else — traversal, absolute paths, unknown files — is 404.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadIntelligenceArtifact } from "../app/data/intelligence-artifacts.server.ts";

const ARTIFACT_ROOT = resolve(process.cwd(), "../../.data/website-intelligence");
const TEST_REF = "20990101000000-artifact-route-test";

async function requestArtifact(ref: string, file: string): Promise<number> {
  try {
    return loadIntelligenceArtifact(ref, file).status;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

test("artifact route serves only allow-listed files under a valid run reference", async () => {
  const dir = resolve(ARTIFACT_ROOT, TEST_REF);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "desktop.png"), Buffer.from("89504e47", "hex"));
  writeFileSync(resolve(dir, "secret.txt"), "must never be served");
  try {
    assert.equal(await requestArtifact(TEST_REF, "desktop.png"), 200);
    // Existing file with a non-allow-listed name is still refused.
    assert.equal(await requestArtifact(TEST_REF, "secret.txt"), 404);
    // Allow-listed name that does not exist on disk.
    assert.equal(await requestArtifact(TEST_REF, "mobile.png"), 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("artifact route rejects traversal, absolute paths, and malformed references", async () => {
  const cases: Array<[string, string]> = [
    ["../../package.json", "desktop.png"],
    ["..", "desktop.png"],
    ["20990101000000-ok/../..", "desktop.png"],
    ["C:\\Windows", "desktop.png"],
    ["/etc", "desktop.png"],
    ["20990101000000-UPPER", "desktop.png"], // uppercase not in the ref grammar
    ["not-a-ref", "desktop.png"],
    ["", "desktop.png"],
    [TEST_REF, "../../../package.json"],
    [TEST_REF, "..\\..\\pnpm-lock.yaml"],
    [TEST_REF, "lighthouse.json/../secret.txt"],
    [TEST_REF, ""],
  ];
  for (const [ref, file] of cases) {
    assert.equal(await requestArtifact(ref, file), 404, `ref="${ref}" file="${file}" must be refused`);
  }
});
