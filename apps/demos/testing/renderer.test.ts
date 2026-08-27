import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemoContent, buildDemoPlan } from "@saltbox/demo-generation";
import type { DemoSourceFacts } from "@saltbox/demo-generation/content-model";
import { renderLocalServiceV1 } from "../server/templates/local-service-v1.ts";
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
  assert.equal(resolveTemplateRenderer("local-service", "9.9.9"), undefined);
  assert.equal(resolveTemplateRenderer("unknown", "1.0.0"), undefined);
  const content = buildDemoContent(facts(), buildDemoPlan(facts()));
  assert.ok(asDemoContent(content as unknown as Record<string, unknown>));
  assert.equal(asDemoContent({ contentVersion: "other" }), undefined);
  assert.equal(asDemoContent(null), undefined);
});
