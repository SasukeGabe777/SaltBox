/** SSRF / local-network safety baseline (Phase 4 item 8). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, checkHostSafety } from "../analysis/net-safety.ts";
import { analyzeWebsite } from "../analysis/analyzer.ts";

test("private and reserved addresses are recognized", () => {
  const priv = [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "fd12:3456::1",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1", // IPv4-mapped private
  ];
  for (const address of priv) {
    assert.equal(isPrivateAddress(address), true, `${address} should be private`);
  }
  const pub = ["8.8.8.8", "93.184.216.34", "2001:4860:4860::8888", "::ffff:8.8.8.8"];
  for (const address of pub) {
    assert.equal(isPrivateAddress(address), false, `${address} should be public`);
  }
});

test("blocked hostnames and private IP literals are refused", async () => {
  assert.equal((await checkHostSafety("localhost")).ok, false);
  assert.equal((await checkHostSafety("metadata.google.internal")).ok, false);
  assert.equal((await checkHostSafety("127.0.0.1")).ok, false);
  assert.equal((await checkHostSafety("169.254.169.254")).ok, false);
  assert.equal((await checkHostSafety("8.8.8.8")).ok, true);
});

test("hostnames resolving to private addresses are refused", async () => {
  const result = await checkHostSafety("internal.corp.example", async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "private_address");
});

test("DNS failure is reported as dns_failure, not a crash", async () => {
  const result = await checkHostSafety("nope.example", async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND nope.example"), { code: "ENOTFOUND" });
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "dns_failure");
});

test("the analyzer refuses loopback targets by default", async () => {
  const result = await analyzeWebsite("http://127.0.0.1:9/", { timeoutMs: 1000 });
  assert.equal(result.reachable, false);
  assert.equal(result.failure?.stage, "blocked_target");
});

test("the analyzer refuses hostnames that resolve to private space", async () => {
  const result = await analyzeWebsite("http://internal.corp.example/", {
    timeoutMs: 1000,
    lookup: async () => [{ address: "192.168.0.10", family: 4 }],
  });
  assert.equal(result.failure?.stage, "blocked_target");
});
