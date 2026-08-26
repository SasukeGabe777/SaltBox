/**
 * Pure deterministic qualification logic (Phase 4 items 24–26 unit half):
 * feature derivation, scoring with explicit expected values, and the
 * decision policy. No database, no network, no hidden randomness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFeatures } from "../features/derive.ts";
import { calculateScore } from "../scoring/score.ts";
import { decideQualification } from "../decision/decide.ts";
import type { WebsiteCheckResult } from "../analysis/analyzer.ts";
import type { ControlledBusinessInput } from "../ingestion/ingest.ts";

const BASE_INPUT: ControlledBusinessInput = {
  name: "Summit Ridge Roofing",
  phone: "(801) 555-0142",
  email: "office@summitridgeroofing.example",
  industry: "roofing",
  source: "manual_fixture",
  externalId: "unit-test-001",
};

function poorSiteResult(): WebsiteCheckResult {
  return {
    attempted: true,
    requestedUrl: "http://example.test/",
    dnsResolved: true,
    reachable: true,
    finalUrl: "http://example.test/",
    httpStatus: 200,
    https: false,
    redirectChain: [],
    htmlRetrieved: true,
    signals: {
      titlePresent: true,
      metaDescriptionPresent: false,
      viewportPresent: false,
      contactFormPresent: false,
      phonePresent: false,
      emailPresent: false,
      ctaPresent: false,
      copyrightYear: 2019,
    },
  };
}

function noWebsiteResult(): WebsiteCheckResult {
  return { attempted: false, dnsResolved: false, reachable: false, redirectChain: [], htmlRetrieved: false };
}

test("features derive deterministically from analyzer output and input", () => {
  const features = deriveFeatures(BASE_INPUT, poorSiteResult());
  assert.deepEqual(features.need, {
    https_missing: true,
    viewport_missing: true,
    meta_description_missing: true,
    contact_form_missing: true,
    cta_missing: true,
  });
  assert.equal(features.valueBand, "high");
  assert.deepEqual(features.activity, { business_has_phone: true, business_has_email: true });
  assert.deepEqual(features.reachability, { email_available: true, phone_available: true });
  assert.equal(features.stable.mobilePass, false);

  // Same inputs → same features (determinism).
  assert.deepEqual(features, deriveFeatures(BASE_INPUT, poorSiteResult()));
});

test("the roofing poor-site case scores exactly 88 and qualifies", () => {
  const features = deriveFeatures(BASE_INPUT, poorSiteResult());
  const score = calculateScore(features);
  // NEED = 15+20+10+20+15 = 80; VALUE(high) = 80; ACTIVITY = 100; REACH = 100.
  assert.deepEqual(score.dimensions, { need: 80, value: 80, activity: 100, reachability: 100 });
  // OVERALL = round(80*0.4 + 80*0.2 + 100*0.15 + 100*0.25) = 88.
  assert.equal(score.overall, 88);

  const decision = decideQualification(features, score);
  assert.equal(decision.resultCode, "qualified");
  assert.ok(decision.reasons.some((r) => r.reasonCode === "MOBILE_VIEWPORT_MISSING"));
  assert.ok(decision.reasons.some((r) => r.reasonCode === "HIGH_VALUE_INDUSTRY"));
  assert.ok(decision.reasons.some((r) => r.reasonCode === "SCORE_ABOVE_THRESHOLD"));
  assert.match(decision.summary, /Qualified with score 88\/100/);
});

test("a healthy site in a low-value industry is rejected below threshold", () => {
  const goodSite: WebsiteCheckResult = {
    ...poorSiteResult(),
    signals: {
      titlePresent: true,
      metaDescriptionPresent: true,
      viewportPresent: true,
      contactFormPresent: true,
      phonePresent: true,
      emailPresent: true,
      ctaPresent: true,
      copyrightYear: 2026,
    },
  };
  const features = deriveFeatures({ ...BASE_INPUT, industry: "bakery" }, goodSite);
  const score = calculateScore(features);
  // NEED = 15 (https only); VALUE(low) = 30; ACTIVITY = 100; REACH = 100 → 52.
  assert.deepEqual(score.dimensions, { need: 15, value: 30, activity: 100, reachability: 100 });
  assert.equal(score.overall, 52);
  const decision = decideQualification(features, score);
  assert.equal(decision.resultCode, "rejected");
  assert.ok(decision.reasons.some((r) => r.reasonCode === "SCORE_BELOW_THRESHOLD"));
});

test("a missing website dominates the need dimension", () => {
  const features = deriveFeatures({ ...BASE_INPUT, industry: "landscaping" }, noWebsiteResult());
  assert.deepEqual(features.need, { website_missing: true });
  const score = calculateScore(features);
  // NEED = 70; VALUE(medium) = 55; ACTIVITY = 100; REACH = 100 → 79.
  assert.deepEqual(score.dimensions, { need: 70, value: 55, activity: 100, reachability: 100 });
  assert.equal(score.overall, 79);
  assert.equal(decideQualification(features, score).resultCode, "qualified");
});

test("zero reachability rejects regardless of score", () => {
  const input: ControlledBusinessInput = {
    name: "Quiet Wall Gallery",
    industry: "roofing", // even a high-value, high-need profile
    source: "manual_fixture",
    externalId: "unit-test-002",
  };
  const features = deriveFeatures(input, noWebsiteResult());
  const score = calculateScore(features);
  assert.equal(score.dimensions.reachability, 0);
  const decision = decideQualification(features, score);
  assert.equal(decision.resultCode, "rejected");
  assert.ok(decision.reasons.some((r) => r.reasonCode === "NO_CONTACT_PATH"));
});

test("the need dimension caps at 100", () => {
  const everythingWrong: WebsiteCheckResult = {
    ...poorSiteResult(),
    signals: {
      titlePresent: false,
      metaDescriptionPresent: false,
      viewportPresent: false,
      contactFormPresent: false,
      phonePresent: false,
      emailPresent: false,
      ctaPresent: false,
      copyrightYear: null,
    },
  };
  const score = calculateScore(deriveFeatures(BASE_INPUT, everythingWrong));
  assert.equal(score.dimensions.need, 90); // 15+20+10+10+20+15 = 90, under the cap
  const unreachable = calculateScore(
    deriveFeatures(BASE_INPUT, { ...noWebsiteResult(), attempted: true, requestedUrl: "http://x.test/" })
  );
  assert.equal(unreachable.dimensions.need, 60); // website_unreachable alone
});
