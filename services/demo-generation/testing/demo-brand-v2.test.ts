import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnsupportedClaims } from "../src/claims-guard.ts";
import { parseBrandProfile } from "../src/brand-view.ts";
import { selectComposition } from "../src/config/demo-v1.ts";
import { buildDemoContent, similarServiceTitle } from "../src/content.ts";
import { buildDemoPlan } from "../src/plan.ts";
import type { DemoSourceFacts } from "../src/types.ts";

const ARTIFACT_REF = "20260827120000-utah-roof-and-solar";

function brandProfileRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "brand-intelligence",
    profileVersion: "brand-profile-v1",
    analyzerVersion: "brand-intelligence-v1",
    websiteUrl: "https://www.utahroofandsolar.com/",
    finalUrl: "https://www.utahroofandsolar.com/",
    collectedAt: "2026-08-27T18:00:00.000Z",
    durationMs: 20_000,
    pagesInspected: [{ url: "https://www.utahroofandsolar.com/", role: "homepage" }],
    artifactRef: ARTIFACT_REF,
    logo: {
      status: "selected",
      confidence: "high",
      sourceUrl: "https://www.utahroofandsolar.com/logo.png",
      assetFile: "logo.png",
      width: 320,
      height: 96,
      kind: "image",
      reasons: ["placed in the site header"],
      candidatesConsidered: 3,
    },
    palette: {
      status: "extracted",
      confidence: "high",
      colors: {
        primary: "#14395c",
        secondary: "#0f2c47",
        accent: "#c96f1e",
        background: "#ffffff",
        surface: "#f6f7f9",
        text: "#1c2430",
        onPrimary: "#ffffff",
        onAccent: "#ffffff",
      },
      sources: ["header background", "button/CTA background"],
      candidatesConsidered: 8,
    },
    imagery: {
      selected: [
        {
          role: "hero",
          sourceUrl: "https://www.utahroofandsolar.com/photos/roof.jpg",
          sourcePage: "https://www.utahroofandsolar.com/",
          assetFile: "image-1.jpg",
          width: 1600,
          height: 900,
          alt: "Completed roof in Ogden",
          reasons: ["prominent above-the-fold placement"],
        },
        {
          role: "gallery",
          sourceUrl: "https://www.utahroofandsolar.com/photos/crew.jpg",
          sourcePage: "https://www.utahroofandsolar.com/",
          assetFile: "image-2.jpg",
          width: 1200,
          height: 800,
          alt: "",
          reasons: ["descriptive placement"],
        },
      ],
      consideredCount: 5,
      rejectedExamples: [],
    },
    services: {
      extracted: [
        { name: "Roof Replacement", sourceText: "Roof Replacement", sourcePage: "https://www.utahroofandsolar.com/", evidence: "heading" },
        { name: "Solar", sourceText: "Solar installation", sourcePage: "https://www.utahroofandsolar.com/", evidence: "nav" },
      ],
      consideredCount: 12,
    },
    identity: { displayName: "Utah Roof and Solar", metaDescription: null },
    fallbacks: [],
    assetBytesDownloaded: 400_000,
    ...overrides,
  };
}

function brandedFacts(profileOverrides: Record<string, unknown> = {}): DemoSourceFacts {
  return {
    prospectId: "11111111-1111-4111-8111-111111111111",
    businessId: "22222222-2222-4222-8222-222222222222",
    websiteId: "33333333-3333-4333-8333-333333333333",
    businessName: "Utah Roof and Solar",
    category: "roofing",
    lifecycleState: "qualified",
    phone: { display: "(801) 207-8222", e164: "+18012078222", contactMethodId: "cm-1" },
    email: { value: "support@utahroofandsolar.com", contactMethodId: "cm-2" },
    city: "Ogden",
    state: "UT",
    websiteUrl: "https://www.utahroofandsolar.com/",
    brand: {
      analysisId: "brand-analysis-1",
      calculatedAt: "2026-08-27T18:00:00.000Z",
      profile: brandProfileRecord(profileOverrides),
    },
    activeSuppressionIds: [],
  };
}

test("parseBrandProfile validates shape, asset refs, and filenames defensively", () => {
  const view = parseBrandProfile("a-1", "2026-08-27T18:00:00.000Z", brandProfileRecord());
  assert.ok(view);
  assert.equal(view.logo?.assetUrl, `/demo-assets/${ARTIFACT_REF}/logo.png`);
  assert.equal(view.palette?.primary, "#14395c");
  assert.equal(view.images.length, 2);
  assert.equal(view.images[0]?.role, "hero");
  assert.deepEqual(view.services.map((service) => service.name), ["Roof Replacement", "Solar"]);

  assert.equal(parseBrandProfile("a-1", "t", { kind: "something-else" }), undefined);

  // Hostile refs/filenames can never form an asset URL.
  const traversal = parseBrandProfile(
    "a-1",
    "t",
    brandProfileRecord({ artifactRef: "../../etc" }),
  );
  assert.ok(traversal);
  assert.equal(traversal.logo, undefined, "invalid artifact ref invalidates asset URLs");
  const badFile = parseBrandProfile(
    "a-1",
    "t",
    brandProfileRecord({
      logo: { status: "selected", confidence: "high", assetFile: "../secret.png", width: 100, height: 100, reasons: [] },
    }),
  );
  assert.equal(badFile?.logo, undefined);

  // Malformed palette entries degrade to no palette, never a broken one.
  const badPalette = parseBrandProfile(
    "a-1",
    "t",
    brandProfileRecord({
      palette: { status: "extracted", confidence: "high", colors: { primary: 'url("x")' }, sources: [] },
    }),
  );
  assert.equal(badPalette?.palette, undefined);
});

test("composition selection is deterministic with inspectable reasons", () => {
  const premium = selectComposition({
    heroImageWidth: 1600,
    usableImageCount: 2,
    logoConfidence: "high",
    paletteConfidence: "high",
    extractedServiceCount: 2,
  });
  assert.equal(premium.key, "premium");
  assert.equal(premium.templateName, "local-service-premium");
  assert.ok(premium.reasons.some((reason) => reason.includes("hero photograph")));

  const bold = selectComposition({
    usableImageCount: 0,
    logoConfidence: "medium",
    paletteConfidence: "high",
    extractedServiceCount: 0,
  });
  assert.equal(bold.key, "bold");
  assert.ok(bold.reasons.some((reason) => reason.includes("palette confidence")));

  const clean = selectComposition({
    usableImageCount: 0,
    logoConfidence: "none",
    paletteConfidence: "none",
    extractedServiceCount: 0,
  });
  assert.equal(clean.key, "clean");
  assert.ok(clean.reasons.some((reason) => reason.includes("typography-led")));

  // A small image (below hero grade) does not force premium.
  const smallImage = selectComposition({
    heroImageWidth: 700,
    usableImageCount: 1,
    logoConfidence: "none",
    paletteConfidence: "none",
    extractedServiceCount: 0,
  });
  assert.equal(smallImage.key, "clean");
});

test("demo-plan-v2 carries brand summary, composition reasoning, and gallery section", () => {
  const facts = brandedFacts();
  const plan = buildDemoPlan(facts);
  assert.equal(plan.planVersion, "demo-plan-v2");
  assert.equal(plan.template.templateName, "local-service-premium");
  assert.ok((plan.template.selectionReasons ?? []).length > 0);
  assert.ok(plan.brand);
  assert.equal(plan.brand.logo.confidence, "high");
  assert.equal(plan.brand.paletteColors?.primary, "#14395c");
  assert.equal(plan.brand.imageryCount, 2);
  assert.deepEqual(plan.brand.extractedServices, ["Roof Replacement", "Solar"]);
  assert.ok(plan.sections.includes("gallery"));

  const withoutBrand: DemoSourceFacts = { ...facts, brand: undefined as never };
  const fallbackPlan = buildDemoPlan(withoutBrand);
  assert.equal(fallbackPlan.template.templateName, "local-service-clean");
  assert.equal(fallbackPlan.brand, null);
  assert.ok(fallbackPlan.fallbacks.some((fallback) => fallback.includes("no brand intelligence")));
});

test("demo-content-v2 maps brand palette/logo/imagery and merges real services without duplication", () => {
  const facts = brandedFacts();
  const plan = buildDemoPlan(facts);
  const content = buildDemoContent(facts, plan);
  assert.equal(content.contentVersion, "demo-content-v2");
  assert.equal(content.brand.palette?.primary, "#14395c");
  assert.equal(content.brand.logo?.url, `/demo-assets/${ARTIFACT_REF}/logo.png`);
  assert.equal(content.imagery?.hero?.url, `/demo-assets/${ARTIFACT_REF}/image-1.jpg`);
  assert.equal(content.imagery?.gallery.length, 1);
  assert.ok(content.imagery?.gallery[0]!.alt.length > 0, "empty alt gets a safe deterministic fallback");

  // Extracted services lead with evidence flags; typical items fill without duplicates.
  const titles = content.services.items.map((item) => item.title);
  assert.equal(titles[0], "Roof Replacement");
  assert.equal(titles[1], "Solar");
  assert.equal(content.services.items[0]?.evidence, true);
  assert.equal(titles.filter((title) => similarServiceTitle(title, "Roof Replacement")).length, 1);
  assert.ok(content.services.items.some((item) => item.evidence !== true), "typical items still fill the grid");
  assert.match(content.services.disclosure, /found on the business's own website/);

  // Copy references the real services and stays claim-free.
  assert.match(content.hero.subheadline, /roof replacement.*solar|solar.*roof replacement/i);
  assert.match(content.meta.description, /offering/);
  assert.deepEqual(findUnsupportedClaims(content), []);

  // Provenance answers "where did this come from?" for every brand element.
  const fields = content.provenance.map((entry) => entry.field);
  assert.ok(fields.includes("brand.logo"));
  assert.ok(fields.includes("brand.palette"));
  assert.ok(fields.includes("imagery"));
  assert.ok(fields.includes("services.Roof Replacement"));
  assert.equal(content.provenance.find((entry) => entry.field === "brand.logo")?.kind, "extracted");

  // Determinism holds for the enriched pipeline too.
  assert.deepEqual(buildDemoContent(facts, plan), content);
});

test("the claims guard skips extracted service names but still guards their generated descriptions", () => {
  const facts = brandedFacts({
    services: {
      extracted: [
        // Site text with a word the guard bans in GENERATED copy; as extracted
        // evidence it renders verbatim with provenance instead of being invented.
        { name: "Emergency Roof Repair", sourceText: "24/7 Emergency Roof Repair", sourcePage: "https://x.test/", evidence: "heading" },
      ],
      consideredCount: 1,
    },
  });
  const plan = buildDemoPlan(facts);
  const content = buildDemoContent(facts, plan);
  const claims = findUnsupportedClaims(content);
  assert.deepEqual(claims, [], "extracted names are evidence, not generated claims");
  const item = content.services.items.find((entry) => entry.title === "Emergency Roof Repair");
  assert.ok(item);
  assert.equal(item.evidence, true);
  assert.ok(!/emergency/i.test(item.description), "the generated description never amplifies the claim");
});
