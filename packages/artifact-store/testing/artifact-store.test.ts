import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { assertArtifactKey, demoAssetKey, hashArtifact, isValidArtifactKey } from "../src/index.ts";
import { LocalArtifactStore } from "../src/local.ts";
import { MemoryArtifactStore } from "../src/memory.ts";

test("artifact keys reject traversal, absolutes, and hostile shapes", () => {
  assert.equal(isValidArtifactKey("demo-assets/20260827180000-riverfront/logo.png"), true);
  for (const key of [
    "",
    "/etc/passwd",
    "demo-assets/../../secrets.png",
    "demo-assets/./logo.png",
    "demo-assets\\20260827180000-x\\logo.png",
    "demo-assets//logo.png",
    "demo-assets/UPPER/logo.png",
    "a/b/c/d/e",
    `demo-assets/${"x".repeat(200)}/logo.png`,
  ]) {
    assert.equal(isValidArtifactKey(key), false, `key must be rejected: ${key}`);
  }
  assert.throws(() => assertArtifactKey("demo-assets/../x.png"), /Invalid artifact key/);
  assert.equal(demoAssetKey("20260827180000-riverfront", "image-1.jpg"), "demo-assets/20260827180000-riverfront/image-1.jpg");
});

test("local store round-trips bytes, hashes them, and never escapes its root", async () => {
  const root = mkdtempSync(join(tmpdir(), "saltbox-store-"));
  try {
    const store = new LocalArtifactStore(root);
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const key = demoAssetKey("20260827180000-fixture", "logo.png");
    const written = await store.put(key, body, { contentType: "image/png" });
    assert.equal(written.byteSize, 5);
    assert.equal(written.contentHash, await hashArtifact(body));
    assert.deepEqual(new Uint8Array(readFileSync(resolve(root, "demo-assets/20260827180000-fixture/logo.png"))), body);

    const read = await store.get(key);
    assert.ok(read);
    assert.deepEqual(read.body, body);
    assert.equal(read.contentType, "image/png");
    assert.equal(await store.has(key), true);

    // A secret next to the root must be unreachable through any key.
    const outside = resolve(root, "..", "outside-secret.png");
    mkdirSync(resolve(root, ".."), { recursive: true });
    writeFileSync(outside, "secret");
    assert.equal(await store.get("demo-assets/../../outside-secret.png"), undefined);
    assert.equal(await store.has("../outside-secret.png"), false);
    rmSync(outside, { force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory store enforces the same key rules as the real stores", async () => {
  const store = new MemoryArtifactStore();
  await store.put(demoAssetKey("20260827180000-fixture", "image-1.jpg"), new Uint8Array([9]), {
    contentType: "image/jpeg",
  });
  assert.deepEqual(store.keys(), ["demo-assets/20260827180000-fixture/image-1.jpg"]);
  await assert.rejects(() => store.put("../escape.png", new Uint8Array([1]), { contentType: "image/png" }));
  assert.equal(await store.get("../escape.png"), undefined);
});
