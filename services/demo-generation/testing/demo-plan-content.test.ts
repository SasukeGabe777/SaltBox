import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoUnsupportedClaims, findUnsupportedClaims } from "../src/claims-guard.ts";
import { LOCAL_SERVICE_CATEGORIES, selectDemoTemplate } from "../src/config/demo-v1.ts";
import { buildDemoContent, logotypeFor, pickDeterministic } from "../src/content.ts";
import { evaluateDemoEligibility } from "../src/eligibility.ts";
import { demoContentHash, stableStringify } from "../src/generate.ts";
import { buildDemoPlan, deriveDemoDeficiencies } from "../src/plan.ts";
import type { DemoContent, DemoSourceFacts } from "../src/types.ts";

function qualifiedFacts(overrides: Partial<DemoSourceFacts> = {}): DemoSourceFacts {
  return {
    prospectId: "11111111-1111-4111-8111-111111111111",
    businessId: "22222222-2222-4222-8222-222222222222",
    businessName: "Utah Roof and Solar",
    category: "roofing",
    lifecycleState: "qualified",
    phone: { display: "(801) 207-8222", e164: "+18012078222", contactMethodId: "cm-phone" },
    email: { value: "support@utahroofandsolar.com", contactMethodId: "cm-email" },
    city: "Ogden",
    state: "UT",
    street: "238 25th St #5",
    postalCode: "84401",
    websiteUrl: "https://www.utahroofandsolar.com/",
    discoverySourceRecordId: "sr-1",
    discoverySourceName: "overture",
    intelligence: {
      analysisId: "wa-1",
      analyzerVersion: "website-intelligence-v1",
      calculatedAt: "2026-08-27T17:10:04.312Z",
      findings: poorSiteFindings(),
    },
    latestQualification: {
      leadScoreId: "ls-1",
      featureSetId: "fs-1",
      decisionId: "d-1",
      decisionResult: "qualified",
      policyVersion: "qualification-policy-v2",
      scoringVersion: "qualification-v2",
      overallScore: 65,
      calculatedAt: "2026-08-27T17:10:05.000Z",
    },
    activeSuppressionIds: [],
    ...overrides,
  };
}

function poorSiteFindings(): Record<string, unknown> {
  return {
    kind: "website-intelligence",
    conversion: {
      phoneLinkPresent: false,
      emailLinkPresent: false,
      contactPagePresent: false,
      contactFormPresent: false,
      quoteCtaPresent: false,
      bookingCtaPresent: false,
      prominentCtaPresent: false,
      visibleAddressPresent: false,
    },
    seo: { titlePresent: false, metaDescriptionPresent: false, h1Count: 0 },
    mobile: { viewportMetaPresent: true, horizontalOverflow: false },
    lab: { performance: 73, largestContentfulPaintMs: 3895.33, cumulativeLayoutShift: 0.27 },
    content: { homepageWordCount: 70, servicesPagePresent: false, aboutPagePresent: false, copyrightYear: 1999 },
  };
}

test("qualified-v2 prospects are eligible; rejected, unsuppressed-policy, and suppressed cases are excluded correctly", () => {
  assert.deepEqual(evaluateDemoEligibility(qualifiedFacts()), { eligible: true, reasons: [], blocking: [] });

  const rejected = evaluateDemoEligibility(
    qualifiedFacts({
      latestQualification: { ...qualifiedFacts().latestQualification!, decisionResult: "rejected" },
    }),
  );
  assert.equal(rejected.eligible, false);
  assert.deepEqual(rejected.reasons.map((reason) => reason.code), ["NOT_QUALIFIED"]);
  assert.equal(rejected.reasons[0]?.overridable, true);

  const v1Policy = evaluateDemoEligibility(
    qualifiedFacts({
      latestQualification: { ...qualifiedFacts().latestQualification!, policyVersion: "qualification-policy-v1" },
    }),
  );
  assert.ok(v1Policy.reasons.some((reason) => reason.code === "POLICY_VERSION_MISMATCH"));

  const suppressed = evaluateDemoEligibility(qualifiedFacts({ activeSuppressionIds: ["sup-1"] }));
  assert.equal(suppressed.eligible, false);
  assert.equal(suppressed.reasons[0]?.code, "ACTIVELY_SUPPRESSED");
  assert.equal(suppressed.reasons[0]?.overridable, false);
  assert.equal(suppressed.blocking.length, 1);

  const noIntelligence = evaluateDemoEligibility(qualifiedFacts({ intelligence: undefined as never }));
  assert.ok(noIntelligence.reasons.some((reason) => reason.code === "INTELLIGENCE_MISSING" && reason.overridable));

  const noRun = evaluateDemoEligibility(qualifiedFacts({ latestQualification: undefined as never }));
  assert.ok(noRun.reasons.some((reason) => reason.code === "NO_QUALIFICATION_RUN"));
});

test("template selection is a deterministic category mapping with a recorded reason", () => {
  for (const category of LOCAL_SERVICE_CATEGORIES) {
    const selection = selectDemoTemplate(category);
    assert.ok(selection, `expected a template for ${category}`);
    assert.equal(selection.templateName, "local-service");
    assert.equal(selection.templateVersion, "1.0.0");
    assert.match(selection.reason, /deterministic mapping/);
  }
  assert.equal(selectDemoTemplate("bakery"), undefined);
  assert.equal(selectDemoTemplate("restaurant"), undefined);
  assert.equal(selectDemoTemplate(null), undefined);
  const eligibility = evaluateDemoEligibility(qualifiedFacts({ category: "bakery" }));
  assert.ok(eligibility.blocking.some((reason) => reason.code === "TEMPLATE_UNAVAILABLE"));
});

test("deficiencies derive from persisted intelligence and the plan addresses each one", () => {
  const facts = qualifiedFacts();
  const deficiencies = deriveDemoDeficiencies(facts);
  const codes = deficiencies.map((deficiency) => deficiency.code);
  for (const expected of [
    "CTA_MISSING",
    "CONTACT_FORM_MISSING",
    "PHONE_LINK_MISSING",
    "CONTACT_PATH_MISSING",
    "TITLE_MISSING",
    "META_DESCRIPTION_MISSING",
    "H1_MISSING",
    "SLOW_LCP",
    "PERFORMANCE_WEAK",
    "CLS_POOR",
    "THIN_CONTENT",
    "SERVICES_CONTENT_MISSING",
    "ABOUT_CONTENT_MISSING",
    "COPYRIGHT_STALE",
  ]) {
    assert.ok(codes.includes(expected), `expected ${expected} in ${codes.join(",")}`);
  }
  for (const deficiency of deficiencies) {
    assert.ok(deficiency.addressedBy.length > 0, `${deficiency.code} must state how the demo addresses it`);
    assert.equal(deficiency.evidenceRef, "wa-1");
  }

  const plan = buildDemoPlan(facts);
  assert.equal(plan.planVersion, "demo-plan-v1");
  assert.equal(plan.qualification?.score, 65);
  assert.equal(plan.intelligence?.analysisId, "wa-1");
  assert.equal(plan.ctaStrategy.primary.kind, "contact");
  assert.equal(plan.ctaStrategy.secondary?.kind, "phone");
  assert.ok(plan.contactStrategy.clickToCall);
  assert.ok(plan.sections.includes("service-area"));
  assert.ok(plan.fallbacks.some((fallback) => fallback.includes("testimonials omitted")));
});

test("content is deterministic, claim-safe, provenance-tracked, and addresses detected deficiencies", () => {
  const facts = qualifiedFacts();
  const plan = buildDemoPlan(facts);
  const first = buildDemoContent(facts, plan);
  const second = buildDemoContent(facts, plan);
  assert.deepEqual(first, second, "same inputs must produce identical content");
  assert.equal(
    demoContentHash(first, "local-service", "1.0.0"),
    demoContentHash(second, "local-service", "1.0.0"),
  );

  // Addresses TITLE_MISSING / META_DESCRIPTION_MISSING with strong metadata.
  assert.match(first.meta.title, /Utah Roof and Solar/);
  assert.match(first.meta.title, /Roofing/);
  assert.match(first.meta.title, /Ogden/);
  assert.ok(first.meta.description.length > 40);
  // Addresses CTA_MISSING / PHONE_LINK_MISSING / CONTACT_FORM_MISSING.
  assert.equal(first.hero.primaryCta.label, "Get a Quote");
  assert.equal(first.hero.secondaryCta?.kind, "phone");
  assert.equal(first.contact.formDemoNotice.includes("does not send"), true);
  // Observed facts pass through verbatim.
  assert.equal(first.business.phone?.e164, "+18012078222");
  assert.equal(first.business.email, "support@utahroofandsolar.com");
  assert.equal(first.serviceArea?.description.includes("Ogden"), true);
  // Testimonials are never fabricated.
  assert.equal(first.testimonials, undefined);
  // Category-typical services are disclosed and never presented as verified offerings.
  assert.match(first.services.disclosure, /demo presentation/i);

  assert.deepEqual(findUnsupportedClaims(first), []);
  const provenanceFields = first.provenance.map((entry) => entry.field);
  for (const field of ["business.name", "business.phone", "business.email", "hero", "meta", "services", "about"]) {
    assert.ok(provenanceFields.includes(field), `missing provenance for ${field}`);
  }
  assert.equal(first.provenance.find((entry) => entry.field === "services")?.kind, "placeholder");
  assert.equal(first.provenance.find((entry) => entry.field === "business.phone")?.kind, "observed");
});

test("missing optional facts degrade to safe fallbacks instead of broken sections", () => {
  const sparse = qualifiedFacts({
    phone: undefined as never,
    email: undefined as never,
    city: undefined as never,
    state: undefined as never,
    street: undefined as never,
    postalCode: undefined as never,
    businessName: "Plain Roofing",
  });
  const plan = buildDemoPlan(sparse);
  assert.equal(plan.ctaStrategy.secondary, undefined);
  assert.equal(plan.contactStrategy.clickToCall, false);
  assert.ok(!plan.sections.includes("service-area"));
  assert.ok(plan.fallbacks.some((fallback) => fallback.includes("no observed phone")));

  const content = buildDemoContent(sparse, plan);
  assert.equal(content.business.phone, undefined);
  assert.equal(content.serviceArea, undefined);
  assert.equal(content.contact.addressLine, undefined);
  assert.ok(content.hero.headline.length > 0);
  assert.ok(!content.hero.headline.includes("{"), "no unfilled slots may leak");
  assert.ok(!content.about.body.includes("{"));
  assert.deepEqual(findUnsupportedClaims(content), []);
});

test("the claims guard rejects unsupported factual claims in generated copy", () => {
  const facts = qualifiedFacts();
  const plan = buildDemoPlan(facts);
  const content = buildDemoContent(facts, plan);
  const poisoned: DemoContent = {
    ...content,
    about: { ...content.about, body: "Licensed and insured with 25 years of experience." },
  };
  assert.throws(() => assertNoUnsupportedClaims(poisoned), /unsupported claims/);
  const claims = findUnsupportedClaims(poisoned);
  assert.ok(claims.some((claim) => claim.pattern === "licensing claim"));
  assert.ok(claims.some((claim) => claim.pattern === "tenure claim"));
});

test("deterministic helpers: stable stringify, variant picking, and logotypes", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const options = ["one", "two", "three"] as const;
  assert.equal(pickDeterministic(options, "seed-a"), pickDeterministic(options, "seed-a"));
  assert.equal(logotypeFor("Utah Roof and Solar"), "UR");
  assert.equal(logotypeFor("Acme"), "A");
  assert.equal(logotypeFor("The Plumbing Co"), "P");
});
