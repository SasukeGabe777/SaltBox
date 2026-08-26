/**
 * Deterministic website analyzer tests against local HTTP servers
 * (Phase 4 items 6, 7, 23). No external network dependency.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { analyzeWebsite } from "../analysis/analyzer.ts";
import { serveLocalSite, htmlHandler, type LocalSite } from "./fixture-server.ts";
import { GOOD_SITE_HTML, POOR_SITE_HTML } from "../fixtures/fixtures.ts";

const LOCAL = { allowPrivateNetworks: true, timeoutMs: 3000 };
const sites: LocalSite[] = [];

async function site(handler: Parameters<typeof serveLocalSite>[0]): Promise<LocalSite> {
  const s = await serveLocalSite(handler);
  sites.push(s);
  return s;
}

after(async () => {
  await Promise.all(sites.map((s) => s.close()));
});

test("a healthy HTML page yields full positive signals", async () => {
  const s = await site(htmlHandler(GOOD_SITE_HTML));
  const result = await analyzeWebsite(s.url, LOCAL);
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.https, false); // local fixture server is plain HTTP
  assert.equal(result.htmlRetrieved, true);
  assert.ok(result.contentHash);
  assert.deepEqual(result.signals, {
    titlePresent: true,
    metaDescriptionPresent: true,
    viewportPresent: true,
    contactFormPresent: true,
    phonePresent: true,
    emailPresent: true,
    ctaPresent: true,
    copyrightYear: 2026,
  });
});

test("a bare-bones page yields the expected missing signals", async () => {
  const s = await site(htmlHandler(POOR_SITE_HTML));
  const result = await analyzeWebsite(s.url, LOCAL);
  assert.equal(result.htmlRetrieved, true);
  assert.equal(result.signals?.titlePresent, true);
  assert.equal(result.signals?.metaDescriptionPresent, false);
  assert.equal(result.signals?.viewportPresent, false);
  assert.equal(result.signals?.contactFormPresent, false);
  assert.equal(result.signals?.ctaPresent, false);
  assert.equal(result.signals?.copyrightYear, 2019);
});

test("redirects are followed with the chain recorded", async () => {
  const target = await site(htmlHandler(GOOD_SITE_HTML));
  const redirecting = await site((req, res) => {
    if (req.url === "/") {
      res.writeHead(302, { location: target.url });
      res.end();
    } else {
      res.writeHead(404).end();
    }
  });
  const result = await analyzeWebsite(redirecting.url, LOCAL);
  assert.equal(result.reachable, true);
  assert.equal(result.finalUrl, target.url);
  assert.deepEqual(result.redirectChain, [target.url]);
  assert.equal(result.htmlRetrieved, true);
});

test("a redirect loop stops at the redirect limit", async () => {
  const looping = await site((_req, res) => {
    res.writeHead(302, { location: "/" });
    res.end();
  });
  const result = await analyzeWebsite(looping.url, { ...LOCAL, maxRedirects: 2 });
  assert.equal(result.failure?.stage, "too_many_redirects");
});

test("a hanging server times out as an observation, not a hang", async () => {
  const slow = await site(() => {
    /* never respond */
  });
  const result = await analyzeWebsite(slow.url, { ...LOCAL, timeoutMs: 400 });
  assert.equal(result.reachable, false);
  assert.equal(result.failure?.stage, "timeout");
});

test("DNS failure on a nonexistent host is a dns observation", async () => {
  const result = await analyzeWebsite("https://saltbox-phase4-test.invalid/", {
    timeoutMs: 3000,
    lookup: async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    },
  });
  assert.equal(result.dnsResolved, false);
  assert.equal(result.reachable, false);
  assert.equal(result.failure?.stage, "dns");
});

test("oversized bodies are rejected by the size guard", async () => {
  const big = await site((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body>${"x".repeat(64 * 1024)}</body></html>`);
  });
  const result = await analyzeWebsite(big.url, { ...LOCAL, maxBodyBytes: 8 * 1024 });
  assert.equal(result.reachable, true);
  assert.equal(result.htmlRetrieved, false);
  assert.equal(result.failure?.stage, "content_too_large");
});

test("non-HTML content types are reachable but yield no HTML signals", async () => {
  const json = await site((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"hello":"world"}');
  });
  const result = await analyzeWebsite(json.url, LOCAL);
  assert.equal(result.reachable, true);
  assert.equal(result.htmlRetrieved, false);
  assert.equal(result.signals, undefined);
  assert.match(result.contentType ?? "", /application\/json/);
});

test("HTTP error statuses are recorded as http failures", async () => {
  const broken = await site((_req, res) => {
    res.writeHead(500, { "content-type": "text/html" });
    res.end("<html><body>boom</body></html>");
  });
  const result = await analyzeWebsite(broken.url, LOCAL);
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 500);
  assert.equal(result.failure?.stage, "http");
});

test("a missing URL is not attempted at all", async () => {
  const result = await analyzeWebsite(undefined, LOCAL);
  assert.equal(result.attempted, false);
  assert.equal(result.failure, undefined);
});
