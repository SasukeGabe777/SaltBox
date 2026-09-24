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
      bookingLinkPresent: false,
      visibleAddressPresent: false,
    },
    seo: { titlePresent: false, metaDescriptionPresent: false, h1Count: 0 },
    mobile: { viewportMetaPresent: true, horizontalOverflow: false },
    lab: { performance: 73, largestContentfulPaintMs: 3895.33, cumulativeLayoutShift: 0.27 },
    content: { homepageWordCount: 70, servicesPagePresent: false, servicesSectionPresent: false, otherContentPages: 0, aboutPagePresent: false, aboutSectionPresent: false, copyrightYear: 1999 },
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
  // A business with no website at all needs no website intelligence: its demo
  // is built from listing facts (the clearest "I built you a website" case).
  const noWebsite = evaluateDemoEligibility(qualifiedFacts({ intelligence: undefined as never, websiteUrl: undefined as never }));
  assert.deepEqual(noWebsite, { eligible: true, reasons: [], blocking: [] });

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
    "COPYRIGHT_STALE",
  ]) {
    assert.ok(codes.includes(expected), `expected ${expected} in ${codes.join(",")}`);
  }
  for (const deficiency of deficiencies) {
    assert.ok(deficiency.addressedBy.length > 0, `${deficiency.code} must state how the demo addresses it`);
    assert.equal(deficiency.evidenceRef, "wa-1");
  }

  const plan = buildDemoPlan(facts);
  assert.equal(plan.planVersion, "demo-plan-v2");
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
  assert.equal(first.contact.formDemoNotice.includes("wasn't sent"), true);
  // Observed facts pass through verbatim.
  assert.equal(first.business.phone?.e164, "+18012078222");
  assert.equal(first.business.email, "support@utahroofandsolar.com");
  assert.equal(first.serviceArea?.description.includes("Ogden"), true);
  // Testimonials are never fabricated.
  assert.equal(first.testimonials, undefined);
  // Category-typical services only top up, carry no evidence flag, and the
  // page discloses its preview status once, in the footer.
  assert.ok(first.services.items.every((item) => item.evidence !== true));
  assert.match(first.footer.demoDisclosure, /shown for preview/);

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

test("no-website businesses get a WEBSITE_MISSING plan and clean listing-fact content", () => {
  const facts = qualifiedFacts({ intelligence: undefined as never, websiteUrl: undefined as never });
  const plan = buildDemoPlan(facts);
  assert.deepEqual(plan.deficiencies.map((deficiency) => deficiency.code), ["WEBSITE_MISSING"]);
  assert.equal(plan.template.templateName, "local-service-bold");
  assert.ok(plan.fallbacks.some((fallback) => fallback.startsWith("no website exists")));
  const content = buildDemoContent(facts, plan);
  assert.ok(content.services.items.length >= 3, "typical services fill the page");
  assert.deepEqual(findUnsupportedClaims(content), []);
});

test("listing location suffixes are dropped from the displayed name only when they match the location", async () => {
  const { displayBusinessName } = await import("../src/content.ts");
  assert.equal(displayBusinessName("Genuine Comfort Heating & Air - Ogden", "Ogden", "UT"), "Genuine Comfort Heating & Air");
  assert.equal(displayBusinessName("Weed Man | Ogden, UT", "Ogden", "UT"), "Weed Man");
  assert.equal(displayBusinessName("Smith - Jones Plumbing", "Ogden", "UT"), "Smith - Jones Plumbing");
  const facts = qualifiedFacts({ businessName: "Genuine Comfort Heating & Air - Ogden" });
  const content = buildDemoContent(facts, buildDemoPlan(facts));
  assert.equal(content.business.name, "Genuine Comfort Heating & Air");
  assert.ok(!JSON.stringify(content.about).includes("- Ogden"));
  assert.equal(content.provenance.find((entry) => entry.field === "business.displayName")?.kind, "generated");
});

test("a business name containing a banned word is an observed fact, not a generated claim", () => {
  const facts = qualifiedFacts({ businessName: "Utah's Best Heating & Cooling", category: "hvac" });
  const content = buildDemoContent(facts, buildDemoPlan(facts));
  assert.deepEqual(findUnsupportedClaims(content), []);
  // Generated copy around the name is still guarded.
  const tampered = { ...content, about: { ...content.about, body: `${content.about.body} The best in town.` } };
  assert.ok(findUnsupportedClaims(tampered).some((claim) => claim.field === "about.body"));
});

test("shouting listing place names are shown in title case", async () => {
  const { tidyPlaceName } = await import("../src/content.ts");
  assert.equal(tidyPlaceName("OGDEN"), "Ogden");
  assert.equal(tidyPlaceName("north salt lake"), "North Salt Lake");
  assert.equal(tidyPlaceName("McCall"), "McCall");
  const facts = qualifiedFacts({ city: "OGDEN" });
  const content = buildDemoContent(facts, buildDemoPlan(facts));
  assert.equal(content.business.city, "Ogden");
  assert.ok(!content.hero.headline.includes("OGDEN") && !content.about.body.includes("OGDEN"));
});

test("a listing's legal name gives way to the brand on the business's own website, narrowly", async () => {
  const { websiteBrandName } = await import("../src/content.ts");
  assert.equal(websiteBrandName("JC Plumbing LLC", "http://froggyplumbing.com/", "HOME | FroggyplumbingCom"), "Froggy Plumbing");
  assert.equal(websiteBrandName("Riverfront Roofing", "https://riverfront-roofing.com/", "Riverfront Roofing | Honest Roof Inspections"), undefined, "names already match");
  assert.equal(websiteBrandName("Royal Plumbing Heating & Air Conditioning", "https://royalhomeservices.com/", "Royal Total Home Services"), undefined, "shares 'royal'");
  assert.equal(websiteBrandName("JC Plumbing LLC", "http://froggyplumbing.com/", "Welcome"), undefined, "site title must confirm the domain");
  assert.equal(websiteBrandName("JC Plumbing LLC", "http://jcp-utah.com/", "JCP"), undefined, "domain must be <word> + trade");
});

test("improvement notes come only from measured deficiencies, and the comparison only from real captures", async () => {
  const { buildImprovements } = await import("../src/improvements.ts");
  const facts = qualifiedFacts();
  const plan = buildDemoPlan(facts);
  const notes = buildImprovements(facts, plan, "Utah Roof and Solar");
  const deficiencyCodes = new Set(plan.deficiencies.map((deficiency) => deficiency.code));
  assert.ok(notes.length > 0 && notes.length <= 6);
  for (const note of notes) {
    assert.ok(note.evidence.every((code) => deficiencyCodes.has(code)), `${note.id} is backed by a detected deficiency`);
  }
  const none = buildImprovements(facts, { ...plan, deficiencies: [] }, "Utah Roof and Solar");
  assert.deepEqual(none, [], "no deficiency, no note");
  const noSite = qualifiedFacts({ intelligence: undefined as never, websiteUrl: undefined as never });
  assert.deepEqual(buildImprovements(noSite, buildDemoPlan(noSite), "Utah Roof and Solar").map((note) => note.id), ["website"]);

  const snapshots = {
    desktop: { url: "/demo-assets/20260923181008-utah-roof-and-solar/before-desktop.jpg", width: 1366, height: 900, alt: "today" },
    mobile: { url: "/demo-assets/20260923181008-utah-roof-and-solar/before-mobile.jpg", width: 390, height: 844, alt: "today" },
  };
  const content = buildDemoContent(facts, plan, { beforeSnapshots: snapshots });
  assert.equal(content.comparison?.mobile?.url, snapshots.mobile.url);
  assert.ok(content.improvements && content.improvements.length > 0);
  assert.deepEqual(findUnsupportedClaims(content), []);
  assert.equal(buildDemoContent(facts, plan).comparison, undefined, "no captures, no slider");
});

test("a listing category contradicted by the business name gives way to the named trade", async () => {
  const { categoryFromName } = await import("../src/facts.ts");
  assert.deepEqual(categoryFromName("Wilson & Sons Painting", "flooring"), { category: "painting", categoryCorrectedFrom: "flooring" });
  assert.deepEqual(categoryFromName("Northmen Concrete", "flooring"), { category: "concrete", categoryCorrectedFrom: "flooring" });
  assert.deepEqual(categoryFromName("Royal Plumbing Heating & Air Conditioning", "hvac"), { category: "hvac" }, "name states the listed trade too");
  assert.deepEqual(categoryFromName("Positive Power LLC", "electrical"), { category: "electrical" }, "no trade in the name");
  assert.deepEqual(categoryFromName("Carpet & Paint Pros", "flooring"), { category: "flooring" }, "listed trade is named");
});

test("a homepage that never mentions the business is not evidence about it", async () => {
  const { siteIdentityMismatch } = await import("../src/eligibility.ts");
  const withSite = (excerpt: string, title: string, name: string, websiteUrl: string) =>
    qualifiedFacts({
      businessName: name,
      websiteUrl,
      intelligence: {
        analysisId: "wa-x", analyzerVersion: "website-intelligence-v2", calculatedAt: "2026-09-24T00:00:00.000Z",
        findings: { pages: [{ title }], content: { homepageExcerpt: excerpt, leadHeadings: [] } },
      },
    });
  assert.ok(siteIdentityMismatch(withSite("Musangwin slot gacor malam ini", "MUSANGWIN", "Technical Building Systems", "http://saveandsmile.com/")));
  assert.equal(siteIdentityMismatch(withSite("Fast! Friendly! Froggy! Plumbing in Northern Utah", "HOME | FroggyplumbingCom", "JC Plumbing LLC", "http://froggyplumbing.com/")), null);
  assert.equal(siteIdentityMismatch(withSite("Painting in Layton", "Wilson And Sons Painting", "Wilson & Sons Painting", "http://www.wilsonandsonsut.com/")), null);
});

test("a dead website gets one true note and no absence claims", () => {
  const facts = qualifiedFacts({
    intelligence: {
      analysisId: "wa-d", analyzerVersion: "website-intelligence-v2", calculatedAt: "2026-09-24T00:00:00.000Z",
      findings: {
        content: { unavailableNotice: "Site not found", homepageWordCount: 27, servicesPagePresent: false, servicesSectionPresent: false, otherContentPages: 0 },
        conversion: { prominentCtaPresent: false, quoteCtaPresent: false, bookingCtaPresent: false, bookingLinkPresent: false, contactFormPresent: false, emailLinkPresent: false },
        seo: { titlePresent: false, metaDescriptionPresent: false, h1Count: 0 },
      },
    },
  });
  const plan = buildDemoPlan(facts);
  assert.deepEqual(plan.deficiencies.map((deficiency) => deficiency.code), ["WEBSITE_BROKEN"]);
  const content = buildDemoContent(facts, plan);
  assert.equal(content.improvements?.length, 1);
  assert.match(content.improvements?.[0]?.before ?? "", /Site not found/);
});
