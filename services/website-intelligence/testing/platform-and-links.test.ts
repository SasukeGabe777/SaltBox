import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPlatform } from "../src/platform.ts";
import { checkLinkHealth, collectInternalLinks } from "../src/link-health.ts";

test("two independent WordPress fingerprints yield high confidence with recorded evidence", () => {
  const detection = detectPlatform({
    html: '<link rel="stylesheet" href="/wp-content/themes/x/style.css">',
    generatorMeta: "WordPress 6.5",
    resourceUrls: ["https://site.test/wp-includes/js/jquery.js"],
  });
  assert.equal(detection.platform, "WordPress");
  assert.equal(detection.confidence, "high");
  assert.ok(detection.evidence.length >= 2);
});

test("a single weak marker is only medium confidence and no marker stays unknown", () => {
  const single = detectPlatform({ html: "<html></html>", generatorMeta: null, resourceUrls: ["https://img1.wsimg.com/x.png"] });
  assert.equal(single.platform, "GoDaddy Website Builder");
  assert.equal(single.confidence, "medium");
  const none = detectPlatform({ html: "<html>plain</html>", generatorMeta: null, resourceUrls: [] });
  assert.equal(none.platform, null);
  assert.equal(none.confidence, "unknown");
});

test("internal link collection dedupes, stays same-site, and caps at 25", () => {
  const homepage = new URL("https://site.test/");
  const hrefs = Array.from({ length: 40 }, (_value, index) => `/page-${index}`)
    .concat(["https://other.test/x", "/page-1", "mailto:a@b.c"]);
  const links = collectInternalLinks(["https://site.test/"], [hrefs], homepage);
  assert.equal(links.length, 25);
  assert.ok(links.every((link) => link.startsWith("https://site.test/")));
});

test("link health classifies broken, redirecting, working, timeouts, and HEAD 405 falls back to GET", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/broken")) return new Response(null, { status: 404 });
    if (url.endsWith("/moved")) return new Response(null, { status: 301, headers: { location: "/new" } });
    if (url.endsWith("/head-hostile")) {
      return method === "HEAD" ? new Response(null, { status: 405 }) : new Response(null, { status: 200 });
    }
    if (url.endsWith("/slow")) {
      const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
      throw timeoutError;
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const health = await checkLinkHealth(
    [
      "https://site.test/ok",
      "https://site.test/broken",
      "https://site.test/moved",
      "https://site.test/head-hostile",
      "https://site.test/slow",
    ],
    { fetchImpl, lookup: async () => [{ address: "203.0.113.9", family: 4 }], sleep: async () => {} },
  );
  assert.deepEqual(
    { checked: health.checked, working: health.working, redirecting: health.redirecting, broken: health.broken, timedOut: health.timedOut },
    { checked: 5, working: 2, redirecting: 1, broken: 1, timedOut: 1 },
  );
  assert.deepEqual(health.brokenExamples, ["https://site.test/broken"]);
  assert.ok(calls.some((call) => call.url.endsWith("/head-hostile") && call.method === "GET"));
});

test("link health counts blocked targets without requesting them", async () => {
  let fetched = 0;
  const fetchImpl = (async () => {
    fetched += 1;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const health = await checkLinkHealth(["http://127.0.0.1:9/"], { fetchImpl, sleep: async () => {} });
  assert.equal(health.blocked, 1);
  assert.equal(fetched, 0);
});
