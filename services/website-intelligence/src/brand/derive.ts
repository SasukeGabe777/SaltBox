/**
 * Pure deterministic derivation over collected brand evidence: logo-candidate
 * ranking, palette construction, photo selection, and service extraction.
 * No network, no browser, no randomness — fully unit-testable.
 */

import {
  colorDistance,
  contrastRatio,
  ensureContrastWithWhite,
  fromHsl,
  isBrandable,
  parseColor,
  readableTextOn,
  toHex,
  toHsl,
  type Rgb,
} from "./color.ts";
import {
  MAX_IMAGE_CANDIDATES,
  MAX_LOGO_CANDIDATES,
  MIN_ICON_LOGO_DIMENSION,
  MIN_LOGO_DIMENSION,
  MIN_PHOTO_HEIGHT,
  MIN_PHOTO_WIDTH,
  type BrandConfidence,
  type BrandPalette,
  type BrandPaletteColors,
  type BrandService,
  type ImagePageContext,
  type LogoCandidate,
  type PageBrandEvidence,
} from "./types.ts";

// --- Logo ranking ------------------------------------------------------------

const LOGO_FILENAME = /logo|brand|wordmark|masthead/i;
const NON_LOGO_FILENAME = /sprite|pixel|spacer|tracking|badge|payment|visa|mastercard|paypal|facebook|instagram|twitter|linkedin|youtube|tiktok|yelp|bbb|award|cert|guarantee/i;
const TRACKING_HOSTS = /doubleclick|googletag|google-analytics|facebook\.com\/tr|hotjar|clarity\.ms|wsimg\.com\/parking/i;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Rank logo candidates across pages; highest score first, deterministic ties. */
export function rankLogoCandidates(pages: PageBrandEvidence[], businessName: string): LogoCandidate[] {
  const nameTokens = normalizeName(businessName).split(" ").filter((token) => token.length > 2);
  const byUrl = new Map<string, LogoCandidate>();
  const seenOnPages = new Map<string, Set<string>>();

  const add = (candidate: LogoCandidate) => {
    const key = candidate.src;
    const pages = seenOnPages.get(key) ?? new Set<string>();
    pages.add(candidate.sourcePage);
    seenOnPages.set(key, pages);
    const existing = byUrl.get(key);
    if (!existing || candidate.score > existing.score) byUrl.set(key, candidate);
  };

  for (const page of pages) {
    // schema.org / OpenGraph declared identity.
    if (page.schemaLogo) {
      add({
        src: page.schemaLogo,
        kind: "schema",
        score: 60,
        reasons: ["declared as schema.org logo"],
        width: 0,
        height: 0,
        alt: "",
        sourcePage: page.url,
      });
    }

    for (const image of page.images) {
      if (TRACKING_HOSTS.test(image.src) || NON_LOGO_FILENAME.test(image.src)) continue;
      const maxDim = Math.max(image.naturalWidth, image.naturalHeight);
      const minDim = Math.min(image.naturalWidth, image.naturalHeight);
      if (maxDim > 0 && maxDim < MIN_LOGO_DIMENSION) continue;
      const aspect = minDim > 0 ? maxDim / minDim : 1;
      if (aspect > 10) continue;
      let score = 0;
      const reasons: string[] = [];
      const altNorm = normalizeName(image.alt);
      if (image.inHeader) {
        score += 30;
        reasons.push("placed in the site header");
      }
      if (image.linksToRoot) {
        score += 20;
        reasons.push("links to the homepage");
      }
      if (/logo/i.test(image.alt) || LOGO_FILENAME.test(image.src) || /logo/i.test(image.classHint)) {
        score += 25;
        reasons.push("named as a logo (alt/filename/class)");
      }
      if (nameTokens.length > 0 && nameTokens.some((token) => altNorm.includes(token))) {
        score += 15;
        reasons.push("alt text matches the business name");
      }
      if (image.documentTop < 200) {
        score += 8;
        reasons.push("appears at the very top of the page");
      }
      if (image.naturalWidth >= 500 && image.naturalHeight >= 500 && !image.inHeader) {
        score -= 15; // Large square content photos are rarely logos.
      }
      if (score <= 0) continue;
      add({
        src: image.src,
        kind: "image",
        score,
        reasons,
        width: image.naturalWidth,
        height: image.naturalHeight,
        alt: image.alt,
        sourcePage: page.url,
      });
    }

    for (const icon of page.icons) {
      const size = parseIconSize(icon.sizes);
      if (size !== null && size < MIN_ICON_LOGO_DIMENSION) continue;
      if (/\.ico$/i.test(icon.href.split("?")[0] ?? "")) continue;
      add({
        src: icon.href,
        kind: "icon",
        score: /apple-touch/i.test(icon.rel) ? 18 : 12,
        reasons: [`declared site icon (${icon.rel}${icon.sizes ? ` ${icon.sizes}` : ""})`],
        width: size ?? 0,
        height: size ?? 0,
        alt: "",
        sourcePage: page.url,
      });
    }
  }

  // Site-wide repetition is strong logo evidence.
  for (const [src, pageSet] of seenOnPages) {
    const candidate = byUrl.get(src);
    if (candidate && pageSet.size > 1) {
      candidate.score += 12;
      candidate.reasons.push(`repeated on ${pageSet.size} inspected pages`);
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score || a.src.localeCompare(b.src))
    .slice(0, MAX_LOGO_CANDIDATES);
}

/**
 * Larger renditions of the SAME logo file, best first. Site builders serve
 * resized copies from predictable URLs (Wix /v1/fill/w_90..., WordPress
 * -150x150.png, Squarespace ?format=100w), so the header thumbnail the
 * ranking picked usually has a full-size original one URL away. Only the
 * same asset is ever requested; callers fall back to the original src.
 */
export function logoSourceUpgrades(src: string): string[] {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return [];
  }
  const upgrades: string[] = [];
  // Wix: https://static.wixstatic.com/media/<id>~mv2.png/v1/fill/w_90,h_90,.../<name>.png
  if (/(^|\.)wixstatic\.com$/i.test(url.hostname)) {
    const match = url.pathname.match(/^(\/media\/[^/]+)\/v1\//);
    // A server-side 512px fit of the same media first (originals can be
    // many MB), then the original itself.
    const file = url.pathname.split("/").pop() ?? "logo.png";
    if (match) upgrades.push(`${url.origin}${match[1]}/v1/fit/w_512,h_512,al_c,q_90/${file}`, `${url.origin}${match[1]}`);
  }
  // WordPress-style size suffix: logo-150x150.png -> logo.png
  const sized = url.pathname.match(/^(.*)-\d{2,4}x\d{2,4}(\.(?:png|jpe?g|webp|gif))$/i);
  if (sized) upgrades.push(`${url.origin}${sized[1]}${sized[2]}${url.search}`);
  // Squarespace: ?format=100w -> ?format=1000w
  if (/squarespace-cdn\.com$/i.test(url.hostname) && url.searchParams.has("format")) {
    const larger = new URL(url.toString());
    larger.searchParams.set("format", "1000w");
    upgrades.push(larger.toString());
  }
  return upgrades.filter((candidate) => candidate !== src);
}

const TAGLINE_GENERIC = /^(welcome|home|services?|our services|contact( us)?|about( us)?|gallery|reviews?|testimonials|faq|menu|service areas?)\b/i;
const TAGLINE_CATEGORY_TOKENS = new Set(["plumbing", "roofing", "electric", "electrical", "hvac", "heating", "cooling", "landscaping", "construction", "services", "service", "company"]);

/**
 * The business's own slogan, if its homepage opens with one ("Fast!
 * Friendly! Froggy!"). Observed text only, never generated. Deliberately
 * strict: one of the first four headings, 2-7 words, no digits or contact
 * details, and it must read as a slogan (an exclamation or the brand's own
 * name), so section titles like "Plumbing Services in Utah" never qualify.
 */
export function extractTagline(headings: Array<{ level: number; text: string }>, brandNames: string[]): string | null {
  const nameTokens = new Set(
    brandNames
      .flatMap((name) => normalizeName(name).split(" "))
      .filter((token) => token.length > 3 && !TAGLINE_CATEGORY_TOKENS.has(token)),
  );
  for (const heading of headings.slice(0, 4)) {
    const text = heading.text.replace(/[\u200b\u00a0]/g, " ").replace(/\s+/g, " ").trim();
    const words = text.split(" ").filter((word) => word !== "");
    if (words.length < 2 || words.length > 7 || text.length > 48) continue;
    if (/\d|@|https?:|\.com\b/i.test(text) || TAGLINE_GENERIC.test(text)) continue;
    const normalized = normalizeName(text);
    const namesBrand = normalized.split(" ").some((token) => nameTokens.has(token));
    if (text.includes("!") || namesBrand) return text;
  }
  return null;
}

export function logoConfidenceFor(candidate: LogoCandidate): BrandConfidence {
  if (candidate.kind === "icon") return candidate.score >= 18 ? "low" : "none";
  if (candidate.score >= 55) return "high";
  if (candidate.score >= 35) return "medium";
  if (candidate.score >= 20) return "low";
  return "none";
}

function parseIconSize(sizes: string): number | null {
  const match = /(\d{2,4})x(\d{2,4})/.exec(sizes);
  return match ? Number(match[1]) : null;
}

// --- Palette -----------------------------------------------------------------

export interface ColorCandidate {
  color: Rgb;
  source: string;
  weight: number;
}

const CUSTOM_PROP_HINT = /color|primary|secondary|accent|brand|theme|main/i;

/** Gather weighted color candidates from CSS evidence across pages. */
export function deriveColorCandidates(pages: PageBrandEvidence[]): ColorCandidate[] {
  const candidates: ColorCandidate[] = [];
  const push = (raw: string | null | undefined, source: string, weight: number) => {
    if (!raw) return;
    const color = parseColor(raw);
    if (!color) return;
    candidates.push({ color, source, weight });
  };
  for (const page of pages) {
    push(page.metaThemeColor, "theme-color metadata", 40);
    push(page.colors.headerBackground, "header background", 32);
    for (const button of page.colors.buttonColors.slice(0, 8)) push(button, "button/CTA background", 26);
    push(page.colors.linkColor, "link color", 12);
    for (const [name, value] of Object.entries(page.colors.rootCustomProperties)) {
      if (!CUSTOM_PROP_HINT.test(name)) continue;
      const weight = /primary|brand|main/i.test(name) ? 34 : /accent|secondary/i.test(name) ? 24 : 10;
      push(value, `css custom property ${name}`, weight);
    }
  }
  return candidates;
}

export interface BuildPaletteInput {
  cssCandidates: ColorCandidate[];
  /** Dominant colors measured from the downloaded logo, strongest first. */
  logoColors?: Rgb[];
}

/**
 * Build a constrained, contrast-safe palette. Returns a fallback-status
 * palette when no defensible brand colors exist — never a broken one.
 */
export function buildBrandPalette(input: BuildPaletteInput): BrandPalette {
  const weighted: ColorCandidate[] = [
    ...(input.logoColors ?? []).map((color, index) => ({
      color,
      source: "logo dominant color",
      weight: 38 - index * 6,
    })),
    ...input.cssCandidates,
  ];

  // Aggregate near-identical colors, keeping the strongest label.
  const groups: Array<{ color: Rgb; weight: number; sources: Set<string> }> = [];
  for (const candidate of weighted) {
    if (!isBrandable(candidate.color)) continue;
    const group = groups.find((existing) => colorDistance(existing.color, candidate.color) < 34);
    if (group) {
      group.weight += candidate.weight;
      group.sources.add(candidate.source);
    } else {
      groups.push({ color: candidate.color, weight: candidate.weight, sources: new Set([candidate.source]) });
    }
  }
  groups.sort((a, b) => b.weight - a.weight || toHex(a.color).localeCompare(toHex(b.color)));

  const considered = weighted.length;
  const primaryGroup = groups[0];
  if (!primaryGroup || primaryGroup.weight < 26) {
    return {
      status: "fallback",
      confidence: "none",
      sources: [],
      candidatesConsidered: considered,
    };
  }

  const primary = ensureContrastWithWhite(primaryGroup.color);
  const accentGroup = groups.find(
    (group) =>
      group !== primaryGroup &&
      colorDistance(group.color, primaryGroup.color) >= 60 &&
      Math.abs(toHsl(group.color).h - toHsl(primaryGroup.color).h) % 360 > 18,
  );
  // Accent falls back to a deterministic lightened/rotated primary.
  const accentBase = accentGroup?.color ?? deriveAccentFrom(primaryGroup.color);
  const accent = ensureContrastWithWhite(accentBase);
  const secondary = ensureContrastWithWhite(
    groups.find((group) => group !== primaryGroup && group !== accentGroup)?.color ?? deepen(primaryGroup.color),
  );

  const colors: BrandPaletteColors = {
    primary: toHex(primary),
    secondary: toHex(secondary),
    accent: toHex(accent),
    background: "#ffffff",
    surface: "#f6f7f9",
    text: "#1c2430",
    onPrimary: toHex(readableTextOn(primary)),
    onAccent: toHex(readableTextOn(accent)),
  };

  const strongSources = primaryGroup.sources.size + (accentGroup?.sources.size ?? 0);
  const confidence: BrandConfidence =
    primaryGroup.weight >= 60 && accentGroup ? "high" : primaryGroup.weight >= 40 || strongSources >= 2 ? "medium" : "low";

  return {
    status: "extracted",
    confidence,
    colors,
    sources: [...new Set([...primaryGroup.sources, ...(accentGroup?.sources ?? [])])].slice(0, 6),
    candidatesConsidered: considered,
  };
}

/** Deterministic companion tone: warm-shift the hue and brighten slightly. */
function deriveAccentFrom(primary: Rgb): Rgb {
  const hsl = toHsl(primary);
  return fromHsl({ h: hsl.h + 36, s: Math.min(1, hsl.s + 0.15), l: Math.min(0.6, hsl.l + 0.12) });
}

function deepen(color: Rgb): Rgb {
  const hsl = toHsl(color);
  return fromHsl({ ...hsl, l: Math.max(0.12, hsl.l - 0.16) });
}

export function paletteContrastOk(colors: BrandPaletteColors): boolean {
  const primary = parseColor(colors.primary);
  const onPrimary = parseColor(colors.onPrimary);
  const accent = parseColor(colors.accent);
  const onAccent = parseColor(colors.onAccent);
  const text = parseColor(colors.text);
  const background = parseColor(colors.background);
  if (!primary || !onPrimary || !accent || !onAccent || !text || !background) return false;
  return (
    contrastRatio(primary, onPrimary) >= 4.5 &&
    contrastRatio(accent, onAccent) >= 4.5 &&
    contrastRatio(text, background) >= 7
  );
}

// --- Imagery -----------------------------------------------------------------

export interface ImageCandidate {
  src: string;
  sourcePage: string;
  width: number;
  height: number;
  alt: string;
  score: number;
  reasons: string[];
  /** v2 context of the winning occurrence ("unknown" for v1 evidence). */
  context: ImagePageContext;
  background: boolean;
  nearHeading: string | null;
  overlayTextChars: number;
}

/** Page blocks whose imagery decorates that block rather than showing the work. */
export const DECORATIVE_CONTEXTS: ReadonlySet<ImagePageContext> = new Set([
  "testimonial",
  "contact",
  "cta",
  "footer",
  "header",
  "partners",
  "blog",
]);

const NON_PHOTO_PATTERN = /sprite|icon|favicon|pixel|spacer|tracking|badge|payment|visa|mastercard|paypal|logo|avatar|emoji|captcha|qr[-_]?code|placeholder|stock-?photo-?watermark/i;
/**
 * Credential/association artwork (BBB seals, manufacturer badges, ratings)
 * is never selected as photography: it is claim-bearing graphics, not the
 * business's work, and demos must not amplify certification claims.
 */
const CREDENTIAL_BADGE_PATTERN = /\bbbb\b|accredit|certif|certainteed|shinglemaster|owens.?corning|gaf\b|master.?elite|associat|member(ship)?|rating|award|seal|guarantee|angie|houzz|homeadvisor|google.?review|five.?star|5.?star/i;
const SOCIAL_WIDGET_PATTERN = /facebook|instagram|twitter|linkedin|youtube|tiktok|gravatar|doubleclick|googletag|maps\.google|gstatic|trustpilot|yelp/i;

/** Rank real-photography candidates (logo/candidate URLs are excluded by caller). */
export function rankImageCandidates(pages: PageBrandEvidence[], excludeUrls: Set<string>): ImageCandidate[] {
  const byUrl = new Map<string, ImageCandidate>();
  for (const page of pages) {
    const fromImgTags = page.images.map((image) => ({
      src: image.src,
      width: image.naturalWidth,
      height: image.naturalHeight,
      alt: image.alt,
      documentTop: image.documentTop,
      displayedArea: image.displayedWidth * image.displayedHeight,
      background: false,
      context: image.context ?? "unknown",
      nearHeading: image.nearHeading ?? null,
      overlayTextChars: image.overlayTextChars ?? 0,
    }));
    const fromBackgrounds = page.backgroundImages.map((background) => ({
      src: background.src,
      width: background.elementWidth,
      height: background.elementHeight,
      alt: "",
      documentTop: background.documentTop,
      displayedArea: background.elementWidth * background.elementHeight,
      background: true,
      context: background.context ?? "unknown",
      nearHeading: background.nearHeading ?? null,
      overlayTextChars: background.overlayTextChars ?? 0,
    }));
    for (const image of [...fromImgTags, ...fromBackgrounds]) {
      if (excludeUrls.has(image.src)) continue;
      if (image.src.startsWith("data:")) continue;
      if (NON_PHOTO_PATTERN.test(image.src) || SOCIAL_WIDGET_PATTERN.test(image.src)) continue;
      if (CREDENTIAL_BADGE_PATTERN.test(image.src) || CREDENTIAL_BADGE_PATTERN.test(image.alt)) continue;
      if (image.width < MIN_PHOTO_WIDTH || image.height < MIN_PHOTO_HEIGHT) continue;
      const aspect = image.width / image.height;
      if (aspect < 0.5 || aspect > 3.4) continue;

      let score = 0;
      const reasons: string[] = [];
      const area = image.width * image.height;
      score += Math.min(40, Math.round(area / 40_000));
      reasons.push(`${image.width}x${image.height} natural size`);
      if (image.documentTop < 900) {
        score += 18;
        reasons.push("prominent above-the-fold placement");
      }
      if (image.background) {
        score += 10;
        reasons.push("used as a large background/hero image");
      }
      if (image.alt.trim().length > 4) {
        score += 8;
        reasons.push(`descriptive alt text ("${image.alt.trim().slice(0, 40)}")`);
      }
      if (image.displayedArea > 300_000) {
        score += 8;
        reasons.push("rendered large on the page");
      }
      if (image.context === "gallery" || image.context === "services") {
        score += 12;
        reasons.push(`sits in the site's ${image.context} section`);
      } else if (DECORATIVE_CONTEXTS.has(image.context)) {
        score -= 25;
        reasons.push(`decorates a ${image.context} block`);
      }
      const existing = byUrl.get(image.src);
      if (!existing || score > existing.score) {
        byUrl.set(image.src, {
          src: image.src,
          sourcePage: page.url,
          width: image.width,
          height: image.height,
          alt: image.alt.trim(),
          score,
          reasons,
          context: image.context,
          background: image.background,
          nearHeading: image.nearHeading,
          overlayTextChars: image.overlayTextChars,
        });
      }
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score || a.src.localeCompare(b.src))
    .slice(0, MAX_IMAGE_CANDIDATES);
}

// --- Services ----------------------------------------------------------------

interface ServicePattern {
  pattern: RegExp;
  canonical: string;
}

const SERVICE_LEXICON: Readonly<Record<string, ServicePattern[]>> = {
  roofing: [
    { pattern: /\broof(ing)?\s+replace|replace(ment)?\s+roof|re-?roof/i, canonical: "Roof Replacement" },
    { pattern: /\broof(ing)?\s+repair|repair(s)?\s+roof/i, canonical: "Roof Repair" },
    { pattern: /\bmetal\s+roof/i, canonical: "Metal Roofing" },
    { pattern: /\bcommercial\s+roof/i, canonical: "Commercial Roofing" },
    { pattern: /\bresidential\s+roof/i, canonical: "Residential Roofing" },
    { pattern: /\bflat\s+roof/i, canonical: "Flat Roofing" },
    { pattern: /\btile\s+roof/i, canonical: "Tile Roofing" },
    { pattern: /\bshingle/i, canonical: "Shingle Roofing" },
    { pattern: /\bsolar/i, canonical: "Solar" },
    { pattern: /\bgutter/i, canonical: "Gutters" },
    { pattern: /\broof\s+inspect|inspection/i, canonical: "Roof Inspections" },
    { pattern: /\bstorm|hail|wind\s+damage/i, canonical: "Storm Damage" },
    { pattern: /\bsiding/i, canonical: "Siding" },
    { pattern: /\bskylight/i, canonical: "Skylights" },
  ],
  plumbing: [
    { pattern: /\bwater\s+heater|tankless/i, canonical: "Water Heaters" },
    { pattern: /\bdrain\s+clean|unclog|clogged/i, canonical: "Drain Cleaning" },
    { pattern: /\bleak/i, canonical: "Leak Repair" },
    { pattern: /\brepipe|re-?piping|pipe\s+repair/i, canonical: "Pipe Repair" },
    { pattern: /\bsewer/i, canonical: "Sewer Service" },
    { pattern: /\bfixture|faucet|toilet/i, canonical: "Fixture Installation" },
    { pattern: /\bwater\s+soften/i, canonical: "Water Softeners" },
  ],
  hvac: [
    { pattern: /\bfurnace|heating/i, canonical: "Heating" },
    { pattern: /\bair\s+condition|\ba\/?c\b|cooling/i, canonical: "Air Conditioning" },
    { pattern: /\bheat\s+pump/i, canonical: "Heat Pumps" },
    { pattern: /\bduct/i, canonical: "Ductwork" },
    { pattern: /\bthermostat/i, canonical: "Thermostats" },
    { pattern: /\bindoor\s+air|air\s+quality/i, canonical: "Indoor Air Quality" },
  ],
  landscaping: [
    { pattern: /\blawn\s+(care|service|mow)/i, canonical: "Lawn Care" },
    { pattern: /\blandscap(e|ing)\s+design|design/i, canonical: "Landscape Design" },
    { pattern: /\birrigation|sprinkler/i, canonical: "Irrigation" },
    { pattern: /\bhardscap|patio|paver/i, canonical: "Hardscaping" },
    { pattern: /\btree|shrub/i, canonical: "Tree & Shrub Care" },
    { pattern: /\bsod\b/i, canonical: "Sod Installation" },
  ],
  electrical: [
    { pattern: /\bpanel/i, canonical: "Panel Upgrades" },
    { pattern: /\blighting/i, canonical: "Lighting" },
    { pattern: /\bev\s+charg/i, canonical: "EV Chargers" },
    { pattern: /\bwiring|rewir/i, canonical: "Wiring" },
    { pattern: /\bgenerator/i, canonical: "Generators" },
    { pattern: /\boutlet|switch/i, canonical: "Outlets & Switches" },
  ],
};

/** Canonical service names whose lexicon pattern matches the text (v2 image-to-service linking). */
export function matchServiceNames(text: string, category: string | null): string[] {
  const lexicon = category !== null ? SERVICE_LEXICON[category] ?? [] : [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned === "") return [];
  return lexicon.filter(({ pattern }) => pattern.test(cleaned)).map(({ canonical }) => canonical);
}

const LEGAL_SUFFIX_TOKENS = new Set(["llc", "inc", "co", "corp", "ltd", "company", "and", "the", "of"]);

/** True when the text is just the business's own name (identity, not a service listing). */
function isBusinessNameText(text: string, businessName: string | undefined): boolean {
  if (!businessName) return false;
  const nameTokens = new Set(normalizeName(businessName).split(" ").filter((token) => token !== ""));
  const textTokens = normalizeName(text).split(" ").filter((token) => token !== "");
  if (textTokens.length === 0) return false;
  return textTokens.every((token) => nameTokens.has(token) || LEGAL_SUFFIX_TOKENS.has(token));
}

/**
 * Extract evidence-backed services: real page text matched against a
 * category lexicon and normalized to canonical names. Nothing is invented —
 * text that matches no pattern contributes nothing, and text that is merely
 * the business's own name is identity evidence, not a service listing.
 */
export function extractServices(
  pages: PageBrandEvidence[],
  category: string | null,
  businessName?: string,
): {
  extracted: BrandService[];
  consideredCount: number;
} {
  const lexicon = category !== null ? SERVICE_LEXICON[category] ?? [] : [];
  if (lexicon.length === 0) return { extracted: [], consideredCount: 0 };
  const found = new Map<string, BrandService>();
  let considered = 0;
  const consider = (text: string, evidence: BrandService["evidence"], sourcePage: string) => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length < 3 || cleaned.length > 120) return;
    if (isBusinessNameText(cleaned, businessName)) return;
    considered += 1;
    for (const { pattern, canonical } of lexicon) {
      if (!pattern.test(cleaned)) continue;
      const existing = found.get(canonical);
      // Headings outrank nav labels outrank list items as evidence.
      const rank = { heading: 3, nav: 2, list: 1 } as const;
      if (!existing || rank[evidence] > rank[existing.evidence]) {
        found.set(canonical, { name: canonical, sourceText: cleaned.slice(0, 80), sourcePage, evidence });
      }
    }
  };
  for (const page of pages) {
    for (const heading of page.headings) consider(heading.text, "heading", page.url);
    for (const label of page.navLabels) consider(label, "nav", page.url);
    for (const item of page.listItems) consider(item, "list", page.url);
  }
  return {
    extracted: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8),
    consideredCount: considered,
  };
}
