import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeBatch, type TargetBatchOutcome } from "../src/batch-result.ts";
import { intelligenceObservations } from "../src/persist.ts";
import type { WebsiteIntelligenceResult } from "../src/types.ts";
import { resolveHomepage } from "../src/url-safety.ts";

function outcome(
  index: number,
  status: TargetBatchOutcome["status"],
  extra: Partial<TargetBatchOutcome> = {},
): TargetBatchOutcome {
  return {
    index,
    businessName: `Business ${index + 1}`,
    prospectId: `prospect-${index + 1}`,
    status,
    failedStages: [],
    ...extra,
  };
}

test("mixed target results complete successfully and report target failures", () => {
  const summary = summarizeBatch(
    [
      outcome(0, "complete"),
      outcome(1, "failed", {
        fatalStage: "unreachable",
        failureKind: "dns_transient",
        failureCode: "EAI_AGAIN",
        transient: true,
      }),
      outcome(2, "complete"),
    ],
    false,
  );
  assert.equal(summary.status, "completed_with_target_failures");
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.complete, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.targetFailures[0]?.failureCode, "EAI_AGAIN");
});

test("--strict returns non-zero for target and partial-stage failures", () => {
  const summary = summarizeBatch(
    [outcome(0, "complete"), outcome(1, "partial", { failedStages: ["lighthouse"] })],
    true,
  );
  assert.equal(summary.status, "completed_with_target_failures");
  assert.equal(summary.exitCode, 2);
  assert.equal(summary.partial, 1);
});

test("no-website skips are completed work, not target failures", () => {
  const summary = summarizeBatch([outcome(0, "skipped_no_website")], false);
  assert.equal(summary.status, "completed");
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.targetFailures.length, 0);
});

test("Chromium unavailable for every analyzable target is a system batch failure", () => {
  const summary = summarizeBatch(
    [
      outcome(0, "failed", { fatalStage: "browser_unavailable", failureKind: "browser_unavailable" }),
      outcome(1, "failed", { fatalStage: "browser_unavailable", failureKind: "browser_unavailable" }),
    ],
    false,
  );
  assert.equal(summary.status, "failed");
  assert.equal(summary.exitCode, 1);
  assert.match(summary.systemFailure ?? "", /Chromium/);
});

test("EAI_AGAIN is transient while ENOTFOUND is a definitive DNS not-found result", async () => {
  const failingLookup = (code: string) => async () => {
    throw Object.assign(new Error(`lookup failed: ${code}`), { code });
  };
  const temporary = await resolveHomepage("https://temporary.example/", {
    lookup: failingLookup("EAI_AGAIN"),
  });
  assert.equal(temporary.ok, false);
  assert.equal(temporary.failureKind, "dns_transient");
  assert.equal(temporary.failureCode, "EAI_AGAIN");
  assert.equal(temporary.transient, true);

  const missing = await resolveHomepage("https://missing.example/", {
    lookup: failingLookup("ENOTFOUND"),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.failureKind, "dns_not_found");
  assert.equal(missing.failureCode, "ENOTFOUND");
  assert.equal(missing.transient, false);
});

test("fatal target evidence is typed and never asserts that the website is absent", () => {
  const result = {
    fatal: {
      stage: "unreachable",
      message: "getaddrinfo EAI_AGAIN temporary.example",
      failureKind: "dns_transient",
      code: "EAI_AGAIN",
      transient: true,
    },
    lab: null,
    mobile: null,
    technical: null,
    seo: null,
    conversion: null,
    content: null,
    links: null,
    assets: null,
    platform: null,
  } as unknown as WebsiteIntelligenceResult;
  const rows = new Map(intelligenceObservations(result));
  assert.deepEqual(rows.get("website.technical.analysis_failure_kind"), {
    kind: "text",
    value: "dns_transient",
  });
  assert.deepEqual(rows.get("website.technical.analysis_failure_transient"), {
    kind: "boolean",
    value: true,
  });
  assert.equal([...rows.keys()].some((key) => /website_present|no_website/.test(key)), false);
});
