import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemoContent, buildDemoPlan } from "@saltbox/demo-generation";
import type { DemoContent, DemoSourceFacts } from "@saltbox/demo-generation/content-model";
import { renderLocalServiceV1 } from "../server/templates/local-service-v1.ts";
import { renderLocalServiceCleanV1 } from "../server/templates/local-service-clean-v1.ts";
import { renderLocalServiceBoldV1 } from "../server/templates/local-service-bold-v1.ts";
import { renderLocalServicePremiumV1 } from "../server/templates/local-service-premium-v1.ts";
import { asDemoContent, resolveTemplateRenderer } from "../server/templates/registry.ts";

function facts(overrides: Partial<DemoSourceFacts> = {}): DemoSourceFacts {
  return {
    prospectId: "11111111-1111-4111-8111-111111111111",
    businessId: "22222222-2222-4222-8222-222222222222",
    businessName: "Utah Roof and Solar",
    category: "roofing",
    lifecycleState: "qualified",
    phone: { display: "(801) 207-8222", e164: "+18012078222", contactMethodId: "cm-1" },
    email: { value: "support@utahroofandsolar.com", contactMethodId: "cm-2" },
    city: "Ogden",
    state: "UT",
    street: "238 25th St #5",
    postalCode: "84401",
    activeSuppressionIds: [],
    ...overrides,
  };
}

function renderFor(input: DemoSourceFacts): string {
  return renderLocalServiceV1(buildDemoContent(input, buildDemoPlan(input)));
}

test("the template renders a complete, noindex, self-contained website", () => {
  const html = renderFor(facts());
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<title>Utah Roof and Solar \| Roofing in Ogden, UT<\/title>/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<meta name="viewport"/);
  // Exactly one h1 with the deterministic headline.
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  // Click-to-call and mailto paths from observed facts.
  assert.match(html, /href="tel:\+18012078222"/);
  assert.match(html, /href="mailto:support@utahroofandsolar\.com"/);
  // Prominent CTA and demo-safe form.
  assert.match(html, /data-qa="primary-cta"/);
  assert.match(html, /Get a Quote/);
  assert.ok(!/<form[^>]*action=/.test(html), "the demo form must have no submission target");
  assert.match(html, /form-action 'none'|<form id="quote-form" novalidate>/);
  assert.match(html, /Demo preview — this form does not send messages\./);
  // Core sections and demo disclosure.
  for (const section of ["hero", "services", "trust", "service-area", "about", "contact"]) {
    assert.ok(html.includes(`data-section="${section}"`), `missing section ${section}`);
  }
  assert.match(html, /class="demo-indicator"/);
  assert.match(html, /SaltBox demo preview created for Utah Roof and Solar/);
  // Current footer year is rendered at view time (COPYRIGHT_STALE fix).
  assert.ok(html.includes(`&copy; ${new Date().getUTCFullYear()}`));
  // Self-contained: no external URLs beyond tel/mailto/https business links.
  assert.ok(!html.includes("<link rel"), "no external stylesheets");
  assert.ok(!/src="https?:/.test(html), "no external scripts or images");
});

test("prospect-derived text is escaped — markup cannot reach the page", () => {
  const hostile = facts({
    businessName: 'Roofing <script>alert("x")</script> Co',
    email: undefined as never,
  });
  const html = renderFor(hostile);
  assert.ok(!html.includes('<script>alert("x")</script>'), "raw prospect markup must never render");
  assert.ok(html.includes("Roofing &lt;script&gt;"), "markup is escaped as text");
});

test("missing optional fields render cleanly with no broken sections", () => {
  const sparse = facts({
    phone: undefined as never,
    email: undefined as never,
    city: undefined as never,
    state: undefined as never,
    street: undefined as never,
    postalCode: undefined as never,
  });
  const html = renderFor(sparse);
  assert.ok(!html.includes("undefined"), "no leaked undefined values");
  assert.ok(!html.includes('data-section="service-area"'), "service area is omitted without a location");
  assert.ok(!html.includes("tel:"), "no phone links without an observed phone");
  assert.match(html, /data-section="contact"/);
  assert.match(html, /data-qa="primary-cta"/);
});

test("the registry resolves exactly the persisted template identity and validates content versions", () => {
  assert.equal(resolveTemplateRenderer("local-service", "1.0.0"), renderLocalServiceV1);
  assert.equal(resolveTemplateRenderer("local-service-clean", "1.0.0"), renderLocalServiceCleanV1);
  assert.equal(resolveTemplateRenderer("local-service-bold", "1.0.0"), renderLocalServiceBoldV1);
  assert.equal(resolveTemplateRenderer("local-service-premium", "1.0.0"), renderLocalServicePremiumV1);
  assert.equal(resolveTemplateRenderer("local-service", "9.9.9"), undefined);
  assert.equal(resolveTemplateRenderer("unknown", "1.0.0"), undefined);
  const content = buildDemoContent(facts(), buildDemoPlan(facts()));
  assert.ok(asDemoContent(content as unknown as Record<string, unknown>));
  // Backward compatibility: Phase 8 demo-content-v1 documents stay renderable.
  assert.ok(asDemoContent({ ...(content as unknown as Record<string, unknown>), contentVersion: "demo-content-v1" }));
  assert.equal(asDemoContent({ contentVersion: "other" }), undefined);
  assert.equal(asDemoContent(null), undefined);
});

function brandedContent(): DemoContent {
  const base = buildDemoContent(facts(), buildDemoPlan(facts()));
  return {
    ...base,
    brand: {
      ...base.brand,
      palette: {
        primary: "#14395c",
        secondary: "#0f2c47",
        accent: "#c96f1e",
        background: "#ffffff",
        surface: "#f6f7f9",
        text: "#1c2430",
        onPrimary: "#ffffff",
        onAccent: "#ffffff",
      },
      logo: { url: "/demo-assets/20260827120000-utah-roof-and-solar/logo.png", width: 320, height: 96, alt: "Utah Roof and Solar logo" },
    },
    imagery: {
      hero: { url: "/demo-assets/20260827120000-utah-roof-and-solar/image-1.jpg", width: 1600, height: 900, alt: "Completed roof" },
      gallery: [
        { url: "/demo-assets/20260827120000-utah-roof-and-solar/image-2.jpg", width: 1200, height: 800, alt: "Crew at work" },
      ],
    },
    services: {
      ...base.services,
      items: [
        { title: "Roof Replacement", description: "Full replacement planning.", evidence: true },
        ...base.services.items.slice(0, 3),
      ],
    },
  };
}

test("all three Phase 9 compositions render the brand assets and stay demo-safe", () => {
  const content = brandedContent();
  const rendered = [
    { name: "clean", html: renderLocalServiceCleanV1(content) },
    { name: "bold", html: renderLocalServiceBoldV1(content) },
    { name: "premium", html: renderLocalServicePremiumV1(content) },
  ];
  for (const { name, html } of rendered) {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, `${name}: noindex`);
    assert.ok(html.includes('data-qa="brand-mark"'), `${name}: brand mark`);
    assert.ok(html.includes("/demo-assets/20260827120000-utah-roof-and-solar/logo.png"), `${name}: real logo`);
    assert.ok(html.includes("--primary:#14395c"), `${name}: extracted palette drives the theme`);
    assert.ok(html.includes('data-qa="primary-cta"'), `${name}: CTA`);
    assert.ok(html.includes('data-qa="demo-disclosure"'), `${name}: disclosure`);
    assert.ok(html.includes("From their current site"), `${name}: evidence badge on extracted services`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${name}: exactly one h1`);
    assert.ok(!/<form[^>]*action=/.test(html), `${name}: no form submission target`);
    assert.ok(!/src="https?:/.test(html), `${name}: no external assets`);
    assert.ok(!html.includes("undefined"), `${name}: no leaked undefined`);
  }
  // The compositions are meaningfully different, not palette swaps.
  assert.ok(rendered[2]!.html.includes('class="hero-photo"'), "premium uses the full-bleed photo hero");
  assert.ok(!rendered[0]!.html.includes('class="hero-photo"'), "clean is typography-led");
  assert.ok(rendered[1]!.html.includes('class="hero-panel"'), "bold embeds the quote panel in the hero");
  assert.ok(rendered[0]!.html.includes('class="service-rows"'), "clean lists services as numbered rows");
  assert.ok(rendered[1]!.html.includes('class="top-bar"'), "bold has the accent top bar");
  // Gallery imagery is lazy-loaded with explicit dimensions (POOR_LCP-safe).
  assert.match(rendered[2]!.html, /image-2\.jpg" alt="[^"]*" width="1200" height="800" loading="lazy"/);
});

test("premium never breaks without a hero photo, and missing brand falls back to category theme", () => {
  const noHero: DemoContent = { ...brandedContent(), imagery: { gallery: [] } };
  const html = renderLocalServicePremiumV1(noHero);
  assert.ok(!html.includes('<img class="hero-photo"'), "no broken image element");
  assert.ok(html.includes('data-section="hero"'), "gradient hero still renders");
  const plain = buildDemoContent(facts(), buildDemoPlan(facts()));
  const fallbackHtml = renderLocalServiceCleanV1(plain);
  assert.ok(fallbackHtml.includes("--primary:#1d3a5f"), "category theme drives the fallback palette");
  assert.ok(fallbackHtml.includes('data-qa="brand-mark"'), "logotype mark renders without a logo");
});
