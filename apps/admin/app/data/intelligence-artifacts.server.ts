/**
 * Read-only access to local website-intelligence artifacts (screenshots, raw
 * Lighthouse JSON) in the git-ignored .data/website-intelligence directory.
 * The run reference and filename are strictly validated against the known
 * artifact naming scheme — no traversal, no absolute paths, no reads outside
 * the artifact root.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const ARTIFACT_ROOT = resolve(process.cwd(), "../../.data/website-intelligence");
const REF_PATTERN = /^[0-9]{14}-[a-z0-9-]{1,60}$/;
const ALLOWED_FILES: Record<string, string> = {
  "desktop.png": "image/png",
  "mobile.png": "image/png",
  "lighthouse.json": "application/json",
};

export function loadIntelligenceArtifact(ref: string | undefined, file: string | undefined): Response {
  const safeRef = ref ?? "";
  const safeFile = file ?? "";
  const contentType = ALLOWED_FILES[safeFile];
  if (!REF_PATTERN.test(safeRef) || contentType === undefined) {
    throw new Response("Unknown artifact.", { status: 404 });
  }
  const path = resolve(ARTIFACT_ROOT, safeRef, safeFile);
  if (!path.startsWith(ARTIFACT_ROOT + sep) || !existsSync(path)) {
    throw new Response("Artifact not found.", { status: 404 });
  }
  return new Response(readFileSync(path), {
    headers: { "content-type": contentType, "cache-control": "private, max-age=300" },
  });
}
