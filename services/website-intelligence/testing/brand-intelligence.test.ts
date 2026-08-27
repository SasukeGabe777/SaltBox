import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  contrastRatio,
  ensureContrastWithWhite,
  parseColor,
  readableTextOn,
  toHex,
} from "../src/brand/color.ts";
import {
  buildBrandPalette,
  deriveColorCandidates,
  extractServices,
  logoConfidenceFor,
  paletteContrastOk,
  rankImageCandidates,
  rankLogoCandidates,
} from "../src/brand/derive.ts";
import {
  AssetRejectedError,
  extractLogoColors,
  fetchImageAsset,
  processLogoAsset,
  processPhotoAsset,
} from "../src/brand/assets.ts";
import type { PageBrandEvidence } from "../src/brand/types.ts";

function pageEvidence(overrides: Partial<PageBrandEvidence> = {}): PageBrandEvidence {
  return {
    url: "https://example-roofing.test/",
    role: "homepage",
    title: "Example Roofing",
    metaDescription: null,
    metaThemeColor: null,
    ogImage: null,
    schemaLogo: null,
    icons: [],
    images: [],
    backgroundImages: [],
    colors: { headerBackground: null, headerText: null, buttonColors: [], linkColor: null, rootCustomProperties: {} },
    headings: [],
    navLabels: [],
    listItems: [],
    internalHrefs: [],
    ...overrides,
  };
}

const HEADER_LOGO = {
  src: "https://example-roofing.test/assets/example-logo.png",
  alt: "Example Roofing logo",
  naturalWidth: 320,
  naturalHeight: 96,
  displayedWidth: 200,
  displayedHeight: 60,
  inHeader: true,
  linksToRoot: true,
  classHint: "site-logo",
  documentTop: 12,
};

test("logo ranking: named header logo beats content photos, icons, and tracking assets", () => {
  const evidence = pageEvidence({
    images: [
      HEADER_LOGO,
      {
        src: "https://example-roofing.test/photos/crew.jpg",
        alt: "Crew installing shingles",
        naturalWidth: 1600,
        naturalHeight: 900,
        displayedWidth: 1200,
        displayedHeight: 675,
        inHeader: false,
        linksToRoot: false,
        classHint: "",
        documentTop: 700,
      },
      {
        src: "https://tracking.doubleclick.test/pixel.png",
        alt: "",
        naturalWidth: 1,
        naturalHeight: 1,
        displayedWidth: 1,
        displayedHeight: 1,
        inHeader: false,
        linksToRoot: false,
        classHint: "",
        documentTop: 0,
      },
    ],
    icons: [{ href: "https://example-roofing.test/apple-touch-icon.png", rel: "apple-touch-icon", sizes: "180x180" }],
  });
  const second = pageEvidence({ url: "https://example-roofing.test/contact", role: "contact", images: [HEADER_LOGO] });
  const ranked = rankLogoCandidates([evidence, second], "Example Roofing");
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0]!.src, HEADER_LOGO.src);
  assert.equal(logoConfidenceFor(ranked[0]!), "high");
  assert.ok(ranked[0]!.reasons.some((reason) => reason.includes("repeated on 2")));
  assert.ok(!ranked.some((candidate) => candidate.src.includes("doubleclick")));
  const icon = ranked.find((candidate) => candidate.kind === "icon");
  assert.ok(icon, "sized apple-touch icon is a (weak) candidate");
  assert.equal(logoConfidenceFor(icon), "low");
});

test("logo ranking: a bare content image yields no credible candidate (fallback path)", () => {
  const evidence = pageEvidence({
    images: [
      {
        src: "https://example-roofing.test/banner.jpg",
        alt: "",
        naturalWidth: 1200,
        naturalHeight: 500,
        displayedWidth: 1200,
        displayedHeight: 500,
        inHeader: false,
        linksToRoot: false,
        classHint: "",
        documentTop: 400,
      },
    ],
  });
  const ranked = rankLogoCandidates([evidence], "Example Roofing");
  assert.ok(ranked.every((candidate) => logoConfidenceFor(candidate) === "none" || candidate.kind === "icon"));
});

test("palette: strong CSS evidence produces an extracted, contrast-safe palette; junk falls back", () => {
  const strong = pageEvidence({
    metaThemeColor: "#0f4c8c",
    colors: {
      headerBackground: "rgb(15, 76, 140)",
      headerText: "#ffffff",
      buttonColors: ["rgb(232, 132, 20)", "rgb(232, 132, 20)"],
      linkColor: "#0f4c8c",
      rootCustomProperties: { "--brand-primary": "#0f4c8c", "--irrelevant-width": "12px" },
    },
  });
  const candidates = deriveColorCandidates([strong]);
  assert.ok(candidates.length >= 4);
  const palette = buildBrandPalette({ cssCandidates: candidates });
  assert.equal(palette.status, "extracted");
  assert.notEqual(palette.confidence, "none");
  assert.ok(palette.colors);
  assert.ok(paletteContrastOk(palette.colors));
  // Primary derives from the dominant blue family, accent from the orange.
  assert.ok(palette.sources.some((source) => source.includes("header background") || source.includes("theme-color") || source.includes("--brand-primary")));

  const junk = pageEvidence({
    colors: {
      headerBackground: "rgba(0, 0, 0, 0)",
      headerText: null,
      buttonColors: ["transparent", "#ffffff", "#fefefe", "#111111"],
      linkColor: "#f8f8f8",
      rootCustomProperties: {},
    },
  });
  const weak = buildBrandPalette({ cssCandidates: deriveColorCandidates([junk]) });
  assert.equal(weak.status, "fallback");
  assert.equal(weak.colors, undefined);
});

test("color utilities: parsing, contrast repair, and readable text selection are deterministic", () => {
  assert.deepEqual(parseColor("#0f4c8c"), { r: 15, g: 76, b: 140 });
  assert.deepEqual(parseColor("rgb(15, 76, 140)"), { r: 15, g: 76, b: 140 });
  assert.equal(parseColor("rgba(15, 76, 140, 0.2)"), null);
  assert.equal(parseColor("transparent"), null);
  assert.equal(parseColor("linear-gradient(#fff, #000)"), null);
  const brightened = parseColor("#7ec8f7")!;
  const repaired = ensureContrastWithWhite(brightened);
  assert.ok(contrastRatio(repaired, { r: 255, g: 255, b: 255 }) >= 4.5);
  assert.equal(toHex(readableTextOn(parseColor("#0f2c4c")!)), "#ffffff");
});

test("image ranking filters icons/social/tiny assets and prefers prominent large photography", () => {
  const evidence = pageEvidence({
    images: [
      { src: "https://example-roofing.test/photos/roof-hero.jpg", alt: "Completed roof in Ogden", naturalWidth: 1800, naturalHeight: 1000, displayedWidth: 1365, displayedHeight: 700, inHeader: false, linksToRoot: false, classHint: "hero", documentTop: 90 },
      { src: "https://example-roofing.test/photos/crew.jpg", alt: "", naturalWidth: 900, naturalHeight: 600, displayedWidth: 450, displayedHeight: 300, inHeader: false, linksToRoot: false, classHint: "", documentTop: 1600 },
      { src: "https://example-roofing.test/icons/star.svg", alt: "", naturalWidth: 48, naturalHeight: 48, displayedWidth: 24, displayedHeight: 24, inHeader: false, linksToRoot: false, classHint: "", documentTop: 300 },
      { src: "https://cdn.facebook.test/social-photo.jpg", alt: "", naturalWidth: 1200, naturalHeight: 800, displayedWidth: 300, displayedHeight: 200, inHeader: false, linksToRoot: false, classHint: "", documentTop: 2400 },
      { src: "https://example-roofing.test/img/visa-badge.png", alt: "", naturalWidth: 600, naturalHeight: 400, displayedWidth: 120, displayedHeight: 80, inHeader: false, linksToRoot: false, classHint: "", documentTop: 2600 },
      { src: "https://example-roofing.test/assets/x7fh2.png", alt: "BBB A+ Accredited Business", naturalWidth: 666, naturalHeight: 375, displayedWidth: 300, displayedHeight: 170, inHeader: false, linksToRoot: false, classHint: "", documentTop: 2000 },
      { src: "https://example-roofing.test/assets/certainteed-x.png", alt: "", naturalWidth: 600, naturalHeight: 600, displayedWidth: 200, displayedHeight: 200, inHeader: false, linksToRoot: false, classHint: "", documentTop: 2100 },
      { src: "https://example-roofing.test/assets/urca.png", alt: "Utah Roofing Contractors Association", naturalWidth: 1920, naturalHeight: 1234, displayedWidth: 300, displayedHeight: 190, inHeader: false, linksToRoot: false, classHint: "", documentTop: 2200 },
      { src: "https://example-roofing.test/tall-banner.jpg", alt: "", naturalWidth: 600, naturalHeight: 2400, displayedWidth: 300, displayedHeight: 1200, inHeader: false, linksToRoot: false, classHint: "", documentTop: 1000 },
    ],
    backgroundImages: [
      { src: "https://example-roofing.test/photos/hero-bg.jpg", elementWidth: 1365, elementHeight: 640, documentTop: 0 },
    ],
  });
  const ranked = rankImageCandidates([evidence], new Set());
  const sources = ranked.map((candidate) => candidate.src);
  assert.ok(sources.includes("https://example-roofing.test/photos/roof-hero.jpg"));
  assert.ok(sources.includes("https://example-roofing.test/photos/hero-bg.jpg"));
  assert.ok(sources.includes("https://example-roofing.test/photos/crew.jpg"));
  assert.ok(!sources.some((source) => source.includes("star.svg")), "icons excluded");
  assert.ok(!sources.some((source) => source.includes("facebook")), "social hosts excluded");
  assert.ok(!sources.some((source) => source.includes("visa")), "payment badges excluded");
  assert.ok(!sources.some((source) => source.includes("x7fh2")), "credential badges excluded by alt text");
  assert.ok(!sources.some((source) => source.includes("certainteed")), "manufacturer badges excluded by filename");
  assert.ok(!sources.some((source) => source.includes("urca")), "association artwork excluded");
  assert.ok(!sources.some((source) => source.includes("tall-banner")), "extreme aspect ratios excluded");
  assert.equal(ranked[0]!.src, "https://example-roofing.test/photos/roof-hero.jpg", "prominent above-fold photo wins");
});

test("service extraction normalizes real site text against the category lexicon and invents nothing", () => {
  const evidence = pageEvidence({
    headings: [
      { level: 2, text: "Roof Replacement" },
      { level: 2, text: "Residential Roof Repairs" },
      { level: 3, text: "Our Financing Options" },
    ],
    navLabels: ["Metal Roofing", "Roof Repair Services", "Contact"],
    listItems: ["Solar panel installation", "Gutter cleaning and installation", "Free consultations"],
  });
  const { extracted } = extractServices([evidence], "roofing", "Example Roofing");
  const names = extracted.map((service) => service.name);
  assert.deepEqual(names, ["Gutters", "Metal Roofing", "Residential Roofing", "Roof Repair", "Roof Replacement", "Solar"]);
  // "Roof Repairs"/"Roof Repair Services"/"Residential Roof Repair" collapse to one.
  assert.equal(names.filter((name) => name.includes("Repair")).length, 1);
  const repair = extracted.find((service) => service.name === "Roof Repair")!;
  assert.equal(repair.evidence, "heading", "heading evidence outranks nav");
  assert.ok(!names.some((name) => /financ|consult/i.test(name)), "non-service text contributes nothing");
  assert.deepEqual(extractServices([evidence], "bakery").extracted, [], "no lexicon, no extraction");

  // The business's own name is identity, never a service listing.
  const nameOnly = pageEvidence({ listItems: ["Utah Roof And Solar Llc"], headings: [{ level: 2, text: "Solar Installation" }] });
  const guarded = extractServices([nameOnly], "roofing", "Utah Roof and Solar");
  assert.deepEqual(guarded.extracted.map((service) => service.name), ["Solar"]);
  assert.equal(guarded.extracted[0]?.sourceText, "Solar Installation", "evidence comes from real service text, not the name");
  const onlyName = extractServices([pageEvidence({ listItems: ["Utah Roof And Solar Llc"] })], "roofing", "Utah Roof and Solar");
  assert.deepEqual(onlyName.extracted, []);
});

test("asset pipeline: SSRF-safe fetch, type/size rejection, resize, SVG rasterization, and logo colors", async () => {
  const bigPhoto = await sharp({
    create: { width: 2400, height: 1400, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  const logoPng = await sharp({
    create: { width: 300, height: 100, channels: 4, background: { r: 200, g: 60, b: 20, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const svgLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#1d3a5f"/></svg>');

  const server = createServer((req, res) => {
    if (req.url === "/photo.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(bigPhoto);
    } else if (req.url === "/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(logoPng);
    } else if (req.url === "/logo.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(svgLogo);
    } else if (req.url === "/huge.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(64 * 1024 * 1024) });
      res.end(Buffer.alloc(1024));
    } else if (req.url === "/page.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    } else if (req.url === "/broken.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("this is not an image"));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const safety = { allowPrivateNetworks: true };
  const dir = mkdtempSync(join(tmpdir(), "saltbox-brand-assets-"));
  try {
    // Default safety refuses loopback targets outright (SSRF boundary).
    await assert.rejects(
      () => fetchImageAsset(`${base}/logo.png`, {}),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === "blocked_target",
    );
    // Type and size caps hold.
    await assert.rejects(
      () => fetchImageAsset(`${base}/page.html`, safety),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === "disallowed_type",
    );
    await assert.rejects(
      () => fetchImageAsset(`${base}/huge.jpg`, safety),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === "too_large",
    );
    // Malformed payloads are rejected at decode time, not stored.
    const broken = await fetchImageAsset(`${base}/broken.png`, safety);
    await assert.rejects(
      () => processLogoAsset(broken, dir, "broken", 40),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === "undecodable",
    );
    // Photos are resized to the width cap and re-encoded.
    const photo = await fetchImageAsset(`${base}/photo.jpg`, safety);
    const processedPhoto = await processPhotoAsset(photo, dir, "image-1");
    assert.equal(processedPhoto.width, 1600, "oversized photos are bounded");
    assert.equal(processedPhoto.file, "image-1.jpg");
    // Logos keep their size (within cap) and become PNG.
    const logo = await fetchImageAsset(`${base}/logo.png`, safety);
    const processedLogo = await processLogoAsset(logo, dir, "logo", 40);
    assert.equal(processedLogo.width, 300);
    assert.equal(processedLogo.file, "logo.png");
    // SVG is rasterized — raw SVG is never stored.
    const svg = await fetchImageAsset(`${base}/logo.svg`, safety);
    const processedSvg = await processLogoAsset(svg, dir, "logo-svg", 40);
    assert.equal(processedSvg.file, "logo-svg.png");
    assert.ok(processedSvg.width >= 200);
    // Dominant logo color measurement feeds the palette.
    const colors = await extractLogoColors(logo.bytes);
    assert.ok(colors.length >= 1);
    const dominant = colors[0]!;
    assert.ok(dominant.r > 150 && dominant.g < 120 && dominant.b < 90, `expected the red-orange fill, got ${JSON.stringify(dominant)}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(dir, { recursive: true, force: true });
  }
});
