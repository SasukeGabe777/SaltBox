import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { detectForeignRedirect, registrableDomain } from "../src/brand/analyze-brand.ts";
import type { ImageCandidate } from "../src/brand/derive.ts";
import { interpretScores, labelsFor } from "../src/brand/image-classifier.ts";
import { hashDistance, normalizeAndMeasurePhoto } from "../src/brand/image-analysis.ts";
import { flagsFor, selectImagery, type AnalyzedPhoto } from "../src/brand/select-imagery.ts";
import type { ImageClassification, ImageVisualMetrics } from "../src/brand/types.ts";

let hashCounter = 0;
/** Distinct, far-apart dHashes so fixtures never collapse as duplicates. */
function uniqueHash(): string {
  hashCounter += 1;
  const patterns = ["0000000000000000", "ffffffffffffffff", "00ff00ff00ff00ff", "ff00ff00ff00ff00", "0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0", "3333333333333333", "cccccccccccccccc", "5555555555555555", "aaaaaaaaaaaaaaaa"];
  return patterns[hashCounter % patterns.length]!;
}

function photo(
  overrides: {
    candidate?: Partial<ImageCandidate>;
    visual?: Partial<ImageVisualMetrics>;
    classification?: Partial<ImageClassification> | null;
  } = {},
): AnalyzedPhoto {
  const classification =
    overrides.classification === null
      ? undefined
      : { model: "stub", kind: "work" as const, topLabel: "roofers working on a roof", topScore: 0.8, relevance: 0.9, ...overrides.classification };
  return {
    candidate: {
      src: `https://example-roofing.test/photo-${hashCounter}.jpg`,
      sourcePage: "https://example-roofing.test/",
      width: 1600,
      height: 900,
      alt: "",
      score: 50,
      reasons: ["fixture"],
      context: "unknown",
      background: false,
      nearHeading: null,
      overlayTextChars: 0,
      ...overrides.candidate,
    },
    visual: { meanLuma: 130, entropy: 7.2, borderFraction: 0, width: 1600, height: 900, dhash: uniqueHash(), ...overrides.visual },
    ...(classification ? { classification } : {}),
  };
}

const roles = (selection: ReturnType<typeof selectImagery>) =>
  selection.selected.map((entry) => (entry.serviceName ? `${entry.index}:${entry.role}:${entry.serviceName}` : `${entry.index}:${entry.role}`));

test("hero goes to the best wide work photo, never a darkened testimonial background", () => {
  const photos = [
    photo({ candidate: { context: "testimonial", background: true, score: 90 }, visual: { meanLuma: 40 } }),
    photo({ candidate: { context: "hero", score: 60 } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: [] });
  assert.deepEqual(roles(selection), ["1:hero"]);
  const rejected = selection.rejected.find((entry) => entry.index === 0)!;
  assert.ok(rejected.reasons.includes("dark"), rejected.reasons.join(", "));
  assert.ok(rejected.reasons.includes("decorative-context:testimonial"));
});

test("vehicles, people, and text graphics never fill work slots", () => {
  const photos = [
    photo({ candidate: { context: "hero" } }),
    photo({ classification: { kind: "vehicle", topLabel: "a photo of a truck or delivery vehicle", topScore: 0.91, relevance: 0.03 } }),
    photo({ classification: { kind: "person", topLabel: "a portrait photo of a smiling person", topScore: 0.7, relevance: 0.1 } }),
    photo({ candidate: { overlayTextChars: 240 } }),
    photo({ visual: { entropy: 3.1 } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: [] });
  assert.deepEqual(roles(selection), ["0:hero"], "nothing else qualifies, and a lone leftover is not a gallery");
  assert.ok(selection.rejected.find((entry) => entry.index === 1)!.reasons.some((reason) => reason.includes("vehicle")));
  assert.ok(selection.rejected.find((entry) => entry.index === 3)!.reasons.includes("text-overlay"));
  assert.ok(selection.rejected.find((entry) => entry.index === 4)!.reasons.includes("flat-graphic"));
});

test("contact-section images never land in service or gallery slots", () => {
  const photos = [
    photo({ candidate: { context: "hero" } }),
    photo({ candidate: { context: "contact", nearHeading: "Roof Repair Estimates" } }),
    photo({ candidate: { context: "cta", nearHeading: "Roof Repair" } }),
    photo({ candidate: { context: "services", nearHeading: "Roof Repair" } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: ["Roof Repair"] });
  assert.deepEqual(roles(selection), ["0:hero", "3:service:Roof Repair"]);
});

test("service images match the photo's own card heading or alt text", () => {
  const photos = [
    photo({ candidate: { context: "hero" } }),
    photo({ candidate: { context: "services", nearHeading: "Gutter Installation" } }),
    photo({ candidate: { context: "services", alt: "Metal roof on a cabin" } }),
    photo({ candidate: { context: "gallery" } }),
    photo({ candidate: { context: "gallery" } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: ["Gutters", "Metal Roofing", "Roof Repair"] });
  assert.deepEqual(roles(selection), ["0:hero", "1:service:Gutters", "2:service:Metal Roofing", "3:gallery", "4:gallery"]);
});

test("near-duplicates collapse and every photo is used at most once", () => {
  const photos = [
    photo({ candidate: { context: "hero", score: 80 }, visual: { dhash: "0123456789abcdef" } }),
    photo({ candidate: { context: "gallery", score: 40 }, visual: { dhash: "0123456789abcdee" } }),
    photo({ candidate: { context: "gallery" } }),
    photo({ candidate: { context: "gallery" } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: [] });
  const used = selection.selected.map((entry) => entry.index);
  assert.equal(new Set(used).size, used.length);
  assert.ok(!used.includes(1), "the smaller duplicate is dropped");
  assert.match(selection.rejected.find((entry) => entry.index === 1)!.reasons[0]!, /near-duplicate/);
});

test("team photos only fill the about slot", () => {
  const photos = [
    photo({ candidate: { context: "hero" } }),
    photo({ candidate: { context: "team" }, classification: { kind: "person", topLabel: "a group of people posing for a photo", topScore: 0.8, relevance: 0.05 } }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: [] });
  assert.deepEqual(roles(selection), ["0:hero", "1:about"]);
});

test("without a classifier, heuristics alone still gate slots", () => {
  const photos = [
    photo({ candidate: { context: "hero" }, classification: null }),
    photo({ candidate: { context: "gallery" }, classification: null }),
    photo({ candidate: { context: "gallery" }, classification: null }),
    photo({ candidate: { context: "footer" }, classification: null }),
  ];
  const selection = selectImagery(photos, { category: "roofing", services: [] });
  assert.deepEqual(roles(selection), ["0:hero", "1:gallery", "2:gallery"]);
  assert.deepEqual(flagsFor(photos[3]!), ["decorative-context:footer"]);
});

test("CLIP scores map to a coarse kind and summed work relevance", () => {
  const { work } = labelsFor("roofing");
  const truck = interpretScores("stub", "roofing", [
    { label: "a photo of a truck or delivery vehicle", score: 0.91 },
    { label: work[0]!, score: 0.05 },
    { label: work[1]!, score: 0.04 },
  ]);
  assert.equal(truck.kind, "vehicle");
  assert.equal(truck.relevance, 0.09);
  const roof = interpretScores("stub", "roofing", [
    { label: work[1]!, score: 0.6 },
    { label: work[2]!, score: 0.3 },
    { label: "a company logo", score: 0.1 },
  ]);
  assert.equal(roof.kind, "work");
  assert.equal(roof.relevance, 0.9);
  assert.equal(labelsFor("unknown-trade").work.length > 0, true, "generic labels cover other categories");
});

test("a redirect to another company's domain is detected; same-site and rebrands are not", () => {
  assert.deepEqual(detectForeignRedirect("https://roofersutah.com/", "https://www.srsdistribution.com/en/markets/find-a-branch/", "Roofers Supply"), {
    requestedHost: "roofersutah.com",
    finalHost: "www.srsdistribution.com",
  });
  assert.equal(detectForeignRedirect("https://dabella.us/location/ogden-ut/", "https://dabella.us/location/ogden/", "DaBella"), null);
  assert.equal(detectForeignRedirect("http://riverfront-roofing.com/", "https://www.riverfront-roofing.com/", "Riverfront Roofing"), null);
  assert.equal(detectForeignRedirect("https://oldname.com/", "https://riverfrontroofs.com/", "Riverfront Roofing"), null, "rebrand keeps the name");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("www.example.com"), "example.com");
});

async function jpegOf(image: ReturnType<typeof sharp>): Promise<Buffer> {
  return image.jpeg().toBuffer();
}

test("pixel analysis trims letterboxing and measures darkness", async () => {
  // A noisy "photo" padded with thick white bands.
  const noise = Buffer.alloc(900 * 520 * 3);
  for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 7919) % 251;
  const inner = await sharp(noise, { raw: { width: 900, height: 520, channels: 3 } }).png().toBuffer();
  const padded = await jpegOf(
    sharp(inner).extend({ top: 200, bottom: 200, left: 250, right: 250, background: "#ffffff" }),
  );
  const measured = await normalizeAndMeasurePhoto({ bytes: padded, contentType: "image/jpeg", finalUrl: "https://x.test/a.jpg" });
  assert.ok(measured.metrics.borderFraction > 0.4, `border fraction ${measured.metrics.borderFraction}`);
  assert.ok(Math.abs(measured.metrics.width - 900) <= 4 && Math.abs(measured.metrics.height - 520) <= 4, "trimmed to the real photo");
  assert.ok(measured.metrics.entropy > 5.5, `noisy photo entropy ${measured.metrics.entropy}`);

  const dark = await jpegOf(
    sharp(noise, { raw: { width: 900, height: 520, channels: 3 } }).linear(0.2, 0),
  );
  const darkMeasured = await normalizeAndMeasurePhoto({ bytes: dark, contentType: "image/jpeg", finalUrl: "https://x.test/b.jpg" });
  assert.ok(darkMeasured.metrics.meanLuma < 70, `dark luma ${darkMeasured.metrics.meanLuma}`);
  assert.ok(hashDistance(measured.metrics.dhash, measured.metrics.dhash) === 0);
});

test("a crew photo the business names as its team fills About, even when CLIP sees trucks", () => {
  const photos = [
    photo({ candidate: { context: "hero" } }),
    photo({
      candidate: { src: "https://genuine.test/uploads/Genuine-Comfort-HVAC-Team-Centerville.jpg" },
      classification: { kind: "vehicle", topLabel: "a photo of a truck or delivery vehicle", topScore: 0.7, relevance: 0.1 },
    }),
    photo({
      candidate: { src: "https://other.test/uploads/fleet-truck.jpg" },
      classification: { kind: "vehicle", topLabel: "a photo of a truck or delivery vehicle", topScore: 0.9, relevance: 0.02 },
    }),
  ];
  const selection = selectImagery(photos, { category: "hvac", services: [] });
  assert.deepEqual(roles(selection), ["0:hero", "1:about"], "an unnamed truck photo stays out");
});

test("block pages are recognized; real homepages are not", async () => {
  const { detectAccessBlock } = await import("../src/access-block.ts");
  assert.match(detectAccessBlock({ status: 403, title: "403 Forbidden", wordCount: 11 }) ?? "", /HTTP 403/);
  assert.match(detectAccessBlock({ status: 200, title: "Just a moment...", wordCount: 30 }) ?? "", /interstitial/);
  assert.match(detectAccessBlock({ status: 200, title: "Service unavailable", wordCount: 5 }) ?? "", /interstitial/);
  assert.equal(detectAccessBlock({ status: 200, title: "Same Day Plumbers for Ogden", wordCount: 900 }), null);
  assert.equal(detectAccessBlock({ status: 403, title: "Acme Roofing", wordCount: 1200 }), null, "a full page is the site");
});
