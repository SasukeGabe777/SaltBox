import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkNavigationTarget,
  isObviouslyForbiddenHost,
  resolveHomepage,
} from "../src/url-safety.ts";

const publicLookup = async () => [{ address: "203.0.113.10", family: 4 }];
const privateLookup = async () => [{ address: "10.1.2.3", family: 4 }];

test("localhost and blocked hostnames are rejected as navigation targets", async () => {
  const verdict = await checkNavigationTarget(new URL("http://localhost:8080/"), { lookup: publicLookup });
  assert.equal(verdict.ok, false);
  const metadata = await checkNavigationTarget(new URL("http://metadata.google.internal/computeMetadata/v1/"), {
    lookup: publicLookup,
  });
  assert.equal(metadata.ok, false);
});

test("private IPv4 and IPv6 literals are rejected", async () => {
  for (const target of [
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.9.9/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:10.0.0.1]/",
  ]) {
    const verdict = await checkNavigationTarget(new URL(target), { lookup: publicLookup });
    assert.equal(verdict.ok, false, `${target} must be blocked`);
  }
});

test("a public hostname resolving to a private address is rejected", async () => {
  const verdict = await checkNavigationTarget(new URL("https://rebind.example/"), { lookup: privateLookup });
  assert.equal(verdict.ok, false);
});

test("non-http protocols are rejected", async () => {
  const verdict = await checkNavigationTarget(new URL("ftp://example.com/"), { lookup: publicLookup });
  assert.equal(verdict.ok, false);
});

test("homepage resolution blocks a redirect into a private host", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://public.example/")) {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
    }
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const resolved = await resolveHomepage("https://public.example/", { lookup: publicLookup, fetchImpl });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason ?? "", /private|blocked|reserved/i);
});

test("homepage resolution follows a safe public redirect and pins both hosts", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "http://public.example/") {
      return new Response(null, { status: 301, headers: { location: "https://www.public.example/" } });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const resolved = await resolveHomepage("http://public.example/", { lookup: publicLookup, fetchImpl });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.finalUrl?.toString(), "https://www.public.example/");
  assert.deepEqual([...resolved.pinnedHosts.keys()].sort(), ["public.example", "www.public.example"]);
});

test("the request-interception screen rejects private IP literals and blocked hosts without DNS", () => {
  assert.equal(isObviouslyForbiddenHost("127.0.0.1"), true);
  assert.equal(isObviouslyForbiddenHost("10.20.30.40"), true);
  assert.equal(isObviouslyForbiddenHost("169.254.169.254"), true);
  assert.equal(isObviouslyForbiddenHost("localhost"), true);
  assert.equal(isObviouslyForbiddenHost("metadata.google.internal"), true);
  assert.equal(isObviouslyForbiddenHost("::1"), true);
  assert.equal(isObviouslyForbiddenHost("example.com"), false);
});
