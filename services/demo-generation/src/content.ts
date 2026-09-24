/**
 * Deterministic demo-content builder (demo-content-v3 + demo-copy-v3).
 *
 * The demo reads as the business's own customer-facing website: services
 * with real descriptions, per-card photos, and calls to action; why-us
 * points; a how-it-works process; and an about section in the business's
 * voice. Demo status is disclosed once in the footer (plus the form's
 * "not sent" confirmation) instead of badges and notes through the page.
 *
 * Observed facts are used verbatim; generated copy is a phrase-library
 * transformation of those facts; category-typical services only top up a
 * site where fewer than three were found. Same inputs always produce the
 * same content (variants use a stable hash, never randomness).
 */

import { brandViewFromFacts } from "./plan.ts";
import { sanitizeText, type BrandImageView } from "./brand-view.ts";
import { DEMO_CONTENT_VERSION, categoryLabel } from "./config/demo-v1.ts";
import {
  AUDIENCE_SERVICE_NAMES,
  CTA_LABELS_V3,
  GENERIC_LOCAL_SERVICE_COPY_V3,
  LOCAL_SERVICE_COPY_V3,
  SERVICE_DESCRIPTIONS_V3,
  fallbackServiceDescription,
  type CategoryCopyV3,
} from "./config/local-service-copy-v3.ts";
import { assertNoUnsupportedClaims, containsUnsupportedClaim } from "./claims-guard.ts";
import { buildImprovements } from "./improvements.ts";
import type {
  DemoContent,
  DemoImage,
  DemoImageryContent,
  DemoPlan,
  DemoServiceItem,
  DemoSourceFacts,
  DemoTrustPoint,
  ProvenanceEntry,
} from "./types.ts";

/** Captures of the business's current homepage, exported by the generation IO layer. */
export interface BeforeSnapshots {
  desktop?: DemoImage;
  mobile?: DemoImage;
}

export interface BuildDemoContentExtras {
  beforeSnapshots?: BeforeSnapshots;
}

/** Fewer extracted services than this are topped up with typical ones. */
const MIN_SERVICES = 3;
const MAX_SERVICES = 6;
/** Smallest logo side (px) that still looks crisp featured large in the hero. */
const SHOWCASE_MIN_LOGO_PX = 160;

export function buildDemoContent(facts: DemoSourceFacts, plan: DemoPlan, extras: BuildDemoContentExtras = {}): DemoContent {
  const category = facts.category ?? "contractor";
  const label = categoryLabel(category);
  const labelLower = label.toLowerCase();
  const copy: CategoryCopyV3 = LOCAL_SERVICE_COPY_V3[category] ?? GENERIC_LOCAL_SERVICE_COPY_V3;
  // Listing data sometimes shouts ("OGDEN"); show place names in title case.
  const city = facts.city !== undefined ? tidyPlaceName(facts.city) : undefined;
  const region = city ?? facts.state;
  const brand = brandViewFromFacts(facts);
  // The name as shown on the page: listing names often carry a location
  // suffix ("Genuine Comfort Heating & Air - Ogden") that reads badly as a
  // brand. Only a suffix equal to the observed city/state is removed.
  const websiteBrand = websiteBrandName(facts.businessName, facts.websiteUrl, brand?.siteTitle);
  const name = websiteBrand ?? displayBusinessName(facts.businessName, city, facts.state);
  const provenance: ProvenanceEntry[] = [];
  const observedSource = facts.discoverySourceName
    ? `${facts.discoverySourceName} source record`
    : "discovery source record";
  const note = (field: string, kind: ProvenanceEntry["kind"], source: string, ref?: string) =>
    provenance.push({ field, kind, source, ...(ref !== undefined ? { ref } : {}) });

  note("business.name", "observed", observedSource, facts.discoverySourceRecordId);
  if (facts.categoryCorrectedFrom) {
    note("business.categoryKey", "generated", `trade stated in the business name ("${facts.businessName}") over the listing category "${facts.categoryCorrectedFrom}"`);
  }
  if (websiteBrand) {
    note("business.displayName", "extracted", `brand name from the business's own website domain (listing name "${facts.businessName}")`, brand?.analysisId);
  } else if (name !== facts.businessName) {
    note("business.displayName", "generated", `observed name "${facts.businessName}" without its location suffix`);
  }
  note("business.category", "observed", observedSource, facts.discoverySourceRecordId);
  if (facts.phone) note("business.phone", "observed", "contact_method", facts.phone.contactMethodId);
  if (facts.email) note("business.email", "observed", "contact_method", facts.email.contactMethodId);
  if (city !== undefined || facts.state !== undefined) {
    note("business.location", "observed", observedSource, facts.discoverySourceRecordId);
  }
  if (facts.websiteUrl !== undefined) note("business.websiteUrl", "observed", "website identity");

  const fill = (pattern: string) =>
    pattern
      .replaceAll("{name}", name)
      .replaceAll("{labelLower}", labelLower)
      .replaceAll("{label}", label)
      .replaceAll("{region}", region ?? "")
      .replaceAll("{city}", city ?? "")
      .replaceAll("{state}", facts.state ?? "")
      .replace(/\s{2,}/g, " ")
      .trim();

  // ---- Services -------------------------------------------------------------
  // Evidence-backed services from the business's own site, action services
  // first; audience descriptors ("Residential Roofing") last.
  const extracted = [...(brand?.services ?? [])]
    .map((service, index) => ({ service, index }))
    .sort(
      (a, b) =>
        Number(AUDIENCE_SERVICE_NAMES.has(a.service.name)) - Number(AUDIENCE_SERVICE_NAMES.has(b.service.name)) ||
        a.index - b.index,
    )
    .map(({ service }) => service)
    .slice(0, MAX_SERVICES);
  const serviceImages = new Map<string, BrandImageView>();
  for (const image of brand?.images ?? []) {
    if (image.role === "service" && image.serviceName !== undefined && !serviceImages.has(image.serviceName)) {
      serviceImages.set(image.serviceName, image);
    }
  }
  const serviceItem = (title: string, evidence: boolean): DemoServiceItem => {
    const image = serviceImages.get(title);
    return {
      title,
      description: SERVICE_DESCRIPTIONS_V3[title] ?? fallbackServiceDescription(title),
      ...(evidence ? { evidence: true } : {}),
      ...(image ? { image: demoImage(image, `${title} — ${name}`) } : {}),
      // Extracted names are the business's own words and may carry claims the
      // guard bans in generated copy; the CTA never repeats those.
      ctaLabel: containsUnsupportedClaim(title) ? "Ask about this service" : `Ask about ${title.toLowerCase()}`,
    };
  };
  const serviceItems: DemoServiceItem[] = extracted.map((service) => serviceItem(service.name, true));
  if (serviceItems.length < MIN_SERVICES) {
    for (const title of copy.typicalServices) {
      if (serviceItems.length >= MIN_SERVICES + 1) break;
      if (serviceItems.some((existing) => similarServiceTitle(existing.title, title))) continue;
      serviceItems.push(serviceItem(title, false));
    }
  }
  const actionNames = extracted.map((service) => service.name).filter((name) => !AUDIENCE_SERVICE_NAMES.has(name));
  for (const service of extracted) {
    note(
      `services.${service.name}`,
      "extracted",
      `found on the business's website (${service.evidence}: "${service.sourceText}")`,
      brand?.analysisId,
    );
  }
  if (serviceItems.some((item) => item.evidence !== true)) {
    note("services", "placeholder", "demo-copy-v3 category-typical services topping up a site with fewer than 3 found (footer-disclosed preview)");
  }
  for (const item of serviceItems) {
    if (item.image) note(`services.${item.title}.image`, "extracted", "photo from this service's own card on the business's website", brand?.analysisId);
  }

  // ---- Hero & meta ----------------------------------------------------------
  const headline =
    region !== undefined ? fill(pickDeterministic(copy.hero.headlines, facts.businessId)) : `${label}, Done Right`;
  const subheadline =
    actionNames.length >= 2
      ? `${capitalize(listJoin(actionNames.slice(0, 3).map((name) => name.toLowerCase())))} for homes${region !== undefined ? ` across ${region}` : ""}. Tell us about your project and get a clear estimate.`
      : region !== undefined
        ? fill(copy.hero.subheadline)
        : "Tell us about your project and get a clear estimate.";
  note("hero", "generated", "demo-copy-v3 phrase library over observed facts");

  const locationSuffix =
    city !== undefined && facts.state !== undefined
      ? ` in ${city}, ${facts.state}`
      : region !== undefined
        ? ` in ${region}`
        : "";
  const metaTitle = `${name} | ${label}${locationSuffix}`;
  const metaDescription =
    actionNames.length >= 2
      ? `${name} is ${article(labelLower)} ${labelLower} company${locationSuffix} offering ${listJoin(actionNames.slice(0, 3).map((name) => name.toLowerCase()))}. Request an estimate today.`
      : `${name} is ${article(labelLower)} ${labelLower} company${locationSuffix}. Request an estimate or get in touch today.`;
  note("meta", "generated", "demo-copy-v3 phrase library over observed facts");

  // ---- Why us, process, service area, about --------------------------------
  const phone = facts.phone ? displayPhone(facts.phone.display) : undefined;
  const whyPoints: DemoTrustPoint[] = [
    {
      title: "Clear Estimates",
      description: "You'll know the scope, the options, and what to expect before any work starts.",
    },
    city !== undefined
      ? { title: `Local to ${city}`, description: `We're based in ${city} and work with ${copy.audience} throughout the area.` }
      : { title: "Straight Answers", description: "Questions about your project get plain-language answers." },
    {
      title: "Easy to Reach",
      description: phone
        ? `Call ${phone} or send a message, whichever is easier for you.`
        : "Send a message anytime and we'll follow up.",
    },
  ];
  note("trust", "generated", "demo-copy-v3 claim-free customer-facing points over observed facts");

  const process = {
    heading: "How It Works",
    steps: [
      {
        title: "Tell us about your project",
        description: phone ? `Call ${phone} or send a few details about what you need.` : "Send a few details about what you need.",
      },
      { title: "Get a clear estimate", description: "We'll look at the job and walk you through the scope and your options." },
      { title: "Get it scheduled", description: "Pick a time that works for you, and we'll take it from there." },
    ],
  };
  note("process", "generated", "demo-copy-v3 claim-free process steps");

  const serviceAreaDescription =
    city !== undefined && facts.state !== undefined
      ? `Based in ${city}, ${facts.state}, ${name} works with ${copy.audience} throughout ${city} and the surrounding area.`
      : region !== undefined
        ? `${name} is based in ${region}.`
        : undefined;
  if (serviceAreaDescription !== undefined) note("serviceArea", "generated", "demo-copy-v3 over observed location");

  const basedIn =
    city !== undefined && facts.state !== undefined
      ? ` based in ${city}, ${facts.state}`
      : region !== undefined
        ? ` based in ${region}`
        : "";
  const helpsWith =
    actionNames.length >= 2
      ? `We help ${copy.audience}${region !== undefined ? ` around ${region}` : ""} with ${listJoin(actionNames.slice(0, 4).map((name) => name.toLowerCase()))}.`
      : `We help ${copy.audience}${region !== undefined ? ` around ${region}` : ""} with ${labelLower} projects big and small.`;
  const aboutBody = `${name} is ${article(labelLower)} ${labelLower} company${basedIn}. ${helpsWith} Have a question or a project in mind? ${
    phone ? `Call ${phone} or send us a message` : "Send us a message"
  } and we'll get back to you.`;
  note("about", "generated", "demo-copy-v3 phrase library over observed facts");
  note("contact", "generated", "demo-copy-v3 phrase library over observed facts");

  // ---- Brand assets ---------------------------------------------------------
  // Brand showcase: feature their own logo (and slogan) in the hero when the
  // logo is confident and large enough to stay crisp at hero size.
  const showcaseLogo =
    brand?.logo && brand.logoConfidence !== "low" && brand.logoConfidence !== "none" && Math.min(brand.logo.width, brand.logo.height) >= SHOWCASE_MIN_LOGO_PX
      ? brand.logo
      : undefined;
  if (showcaseLogo) {
    note("hero.showcase", "extracted", `their own logo featured in the hero (${showcaseLogo.width}x${showcaseLogo.height})`, brand?.analysisId);
    if (brand?.tagline) note("hero.showcase.tagline", "observed", "slogan observed verbatim on their homepage", brand.analysisId);
  }
  if (brand?.logo) {
    note("brand.logo", "extracted", `logo from ${brand.logo.sourceUrl ?? "the business's website"}`, brand.analysisId);
  }
  if (brand?.palette) {
    note("brand.palette", "extracted", `colors from ${brand.paletteSources.join(", ") || "the business's website"}`, brand.analysisId);
  }
  if (brand?.foreignRedirect) {
    note(
      "brand",
      "placeholder",
      `website forwards to another company's domain (${brand.foreignRedirect.finalHost}); category theme and logotype used instead`,
      brand.analysisId,
    );
  }
  const heroImage = brand?.images.find((image) => image.role === "hero");
  const galleryImages = (brand?.images ?? []).filter((image) => image.role === "gallery").slice(0, 4);
  const aboutImage = brand?.images.find((image) => image.role === "about");
  const imagery: DemoImageryContent | undefined =
    heroImage || galleryImages.length > 0 || aboutImage
      ? {
          ...(heroImage ? { hero: demoImage(heroImage, `${name} — ${labelLower}`) } : {}),
          gallery: galleryImages.map((image) => demoImage(image, `${labelLower} project photo — ${name}`)),
          ...(aboutImage ? { about: demoImage(aboutImage, `The ${name} team`) } : {}),
        }
      : undefined;
  if (imagery) {
    note("imagery", "extracted", "photography from the business's own website, slot-matched by page context and local visual classification", brand?.analysisId);
  }

  // ---- "What's improved" notes and the before/after comparison -------------
  const improvements = buildImprovements(facts, plan, name);
  if (improvements.length > 0) {
    note("improvements", "generated", "demo-improvements-v1 notes over measured website-intelligence deficiencies", facts.intelligence?.analysisId);
  }
  const snapshots = extras.beforeSnapshots;
  const comparison =
    snapshots && (snapshots.desktop || snapshots.mobile) && facts.intelligence
      ? {
          heading: "Your website today, and the redesign",
          intro: "Drag the handle to compare your current homepage with this preview.",
          capturedLabel: monthYear(facts.intelligence.calculatedAt),
          ...(snapshots.desktop ? { desktop: snapshots.desktop } : {}),
          ...(snapshots.mobile ? { mobile: snapshots.mobile } : {}),
        }
      : undefined;
  if (comparison) {
    note("comparison", "extracted", "homepage captures taken during website analysis (unchanged)", facts.intelligence?.analysisId);
  }

  const content: DemoContent = {
    contentVersion: DEMO_CONTENT_VERSION,
    business: {
      name: name,
      categoryKey: category,
      categoryLabel: label,
      ...(facts.phone ? { phone: { display: displayPhone(facts.phone.display), e164: facts.phone.e164 } } : {}),
      ...(facts.email ? { email: facts.email.value } : {}),
      ...(city !== undefined ? { city: city } : {}),
      ...(facts.state !== undefined ? { state: facts.state } : {}),
      ...(facts.street !== undefined ? { street: facts.street } : {}),
      ...(facts.postalCode !== undefined ? { postalCode: facts.postalCode } : {}),
      ...(facts.websiteUrl !== undefined ? { websiteUrl: facts.websiteUrl } : {}),
    },
    brand: {
      themeKey: copy.themeKey,
      logotype: logotypeFor(name),
      ...(brand?.palette ? { palette: brand.palette } : {}),
      ...(brand?.logo
        ? {
            logo: {
              url: brand.logo.assetUrl,
              width: brand.logo.width,
              height: brand.logo.height,
              alt: `${name} logo`,
            },
          }
        : {}),
    },
    ...(imagery ? { imagery } : {}),
    meta: { title: metaTitle, description: metaDescription },
    hero: {
      headline,
      subheadline,
      primaryCta: plan.ctaStrategy.primary,
      ...(plan.ctaStrategy.secondary ? { secondaryCta: plan.ctaStrategy.secondary } : {}),
      ...(showcaseLogo
        ? {
            showcase: {
              logo: { url: showcaseLogo.assetUrl, width: showcaseLogo.width, height: showcaseLogo.height, alt: `${name} logo` },
              ...(brand?.tagline ? { tagline: brand.tagline } : {}),
            },
          }
        : {}),
    },
    services: {
      heading: `${label} Services`,
      intro: `Here's how ${name} helps ${copy.audience}${region !== undefined ? ` around ${region}` : ""}. Reach out about any of these for an estimate.`,
      items: serviceItems,
      // Kept for provenance/admin; v2 compositions disclose once, in the footer.
      disclosure: "Services are shown for preview and confirmed with the business before launch.",
    },
    trust: { heading: `Why Work With ${name}`, points: whyPoints },
    process,
    ...(improvements.length > 0 ? { improvements } : {}),
    ...(comparison ? { comparison } : {}),
    ...(serviceAreaDescription !== undefined
      ? { serviceArea: { heading: "Service Area", description: serviceAreaDescription } }
      : {}),
    about: { heading: `About ${name}`, body: aboutBody },
    contact: {
      heading: "Request an Estimate",
      intro: facts.phone
        ? `Tell us a little about your project, or call ${phone} to talk it through.`
        : "Tell us a little about your project and we'll follow up.",
      formHeadline: CTA_LABELS_V3.quote,
      formDemoNotice: "Thanks! This is a preview site, so your message wasn't sent.",
      ...(facts.street !== undefined && city !== undefined && facts.state !== undefined
        ? {
            addressLine: `${facts.street}, ${city}, ${facts.state}${facts.postalCode !== undefined ? ` ${facts.postalCode}` : ""}`,
          }
        : {}),
    },
    footer: {
      line: name,
      demoDisclosure: `Preview website designed by SaltBox for ${name}. Wording, services, and photos are shown for preview and would be confirmed with ${name} before launch.`,
    },
    indicator: { enabled: false, label: "Preview" },
    provenance,
  };

  assertNoUnsupportedClaims(content);
  return content;
}

/**
 * Removes a trailing location suffix (" - Ogden", " | Ogden, UT", " (Utah)")
 * when it matches the observed city or state. Anything else is kept verbatim.
 */
export function displayBusinessName(observed: string, city?: string, state?: string): string {
  const match = /^(.*?\S)\s*(?:[-–—|:]\s*|\()\s*([^()|]+?)\)?\s*$/.exec(observed);
  if (!match) return observed;
  const [, base, suffix] = match;
  const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const locations = new Set([norm(city), norm(state), norm(`${city ?? ""}${state ?? ""}`), norm(STATE_NAMES[state ?? ""])].filter(Boolean));
  return base!.trim().length >= 3 && locations.has(norm(suffix)) ? base!.trim() : observed;
}

const STATE_NAMES: Readonly<Record<string, string>> = { UT: "Utah", ID: "Idaho", NV: "Nevada", AZ: "Arizona", CO: "Colorado", WY: "Wyoming" };

/** "4354123182" / "+14354123182" -> "(435) 412-3182"; anything else is shown as observed. */
export function displayPhone(observed: string): string {
  const digits = observed.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const bare = /^\+?[\d\s]*$/.test(observed.trim());
  return bare && national.length === 10 ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}` : observed;
}

function demoImage(image: BrandImageView, fallbackAlt: string): DemoImage {
  const cleaned = sanitizeText(image.alt, 120);
  return { url: image.url, width: image.width, height: image.height, alt: cleaned.length >= 5 ? cleaned : fallbackAlt };
}

/** Stable FNV-1a selection so variants are deterministic per business. */
export function pickDeterministic<T>(options: readonly T[], seed: string): T {
  if (options.length === 0) throw new Error("Cannot pick from an empty option list.");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return options[hash % options.length]!;
}

/** Generic words plus trade nouns: "Roof Repair" and "Roof Replacement" are different services. */
const SERVICE_TITLE_STOPWORDS = new Set([
  "services",
  "service",
  "and",
  "the",
  "for",
  "your",
  "roof",
  "roofing",
  "plumbing",
  "electrical",
  "landscape",
  "landscaping",
]);

/** True when two service titles share a meaningful word (dedupe typical vs extracted). */
export function similarServiceTitle(a: string, b: string): boolean {
  const tokens = (title: string) =>
    new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2 && !SERVICE_TITLE_STOPWORDS.has(token))
        .map((token) => token.replace(/s$/, "")),
    );
  const ta = tokens(a);
  for (const token of tokens(b)) if (ta.has(token)) return true;
  return false;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Trade words a business domain is typically built from ("froggy" + "plumbing"). */
const DOMAIN_TRADE_WORDS = [
  "plumbing", "plumbers", "plumber", "roofing", "roofers", "roofer", "electrical", "electric", "electrician",
  "heating", "cooling", "hvac", "air", "landscaping", "landscape", "lawncare", "lawn", "services", "service",
  "company", "construction", "contracting", "pros", "solar", "gutters",
];
const GENERIC_NAME_WORDS = new Set([...DOMAIN_TRADE_WORDS, "llc", "inc", "co", "corp", "the", "and", "of"]);

/**
 * The brand a business actually uses, when its listing name is a legal or
 * owner name ("JC Plumbing LLC") but its own website is "froggyplumbing.com".
 * Deliberately narrow: the domain must read as <one distinctive word> + trade
 * word(s), the listing name must share no distinctive word with it, and the
 * site's own title must contain the domain name. Otherwise returns undefined.
 */
export function websiteBrandName(listingName: string, websiteUrl: string | undefined, siteTitle: string | undefined): string | undefined {
  if (!websiteUrl || !siteTitle) return undefined;
  let host: string;
  try {
    host = new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  const label = host.split(".")[0] ?? "";
  if (!/^[a-z]{6,40}$/.test(label)) return undefined;
  const words: string[] = [];
  let rest = label;
  // Peel trade words off the end: "froggyplumbing" -> "froggy" + "plumbing".
  for (let guard = 0; guard < 3; guard += 1) {
    const trade = DOMAIN_TRADE_WORDS.find((word) => rest.endsWith(word) && rest.length > word.length);
    if (!trade) break;
    words.unshift(trade);
    rest = rest.slice(0, -trade.length);
  }
  if (words.length === 0 || rest.length < 3 || DOMAIN_TRADE_WORDS.includes(rest)) return undefined;
  const listingTokens = listingName.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !GENERIC_NAME_WORDS.has(token));
  if (listingTokens.some((token) => label.includes(token))) return undefined;
  if (!siteTitle.toLowerCase().replace(/[^a-z]/g, "").includes(label)) return undefined;
  return [rest, ...words].map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

/** "OGDEN" / "ogden" -> "Ogden"; mixed-case names ("McCall") are kept as observed. */
export function tidyPlaceName(place: string): string {
  const trimmed = place.trim();
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

function monthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "a recent check"
    : date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "a roofing company", "an electrical company". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

const LOGOTYPE_STOPWORDS = new Set(["and", "of", "the", "llc", "inc", "co", "company", "&"]);

/** Deterministic initials mark used when no usable logo asset exists. */
export function logotypeFor(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word.length > 0 && !LOGOTYPE_STOPWORDS.has(word.toLowerCase()));
  const initials = words.slice(0, 2).map((word) => word[0]!.toUpperCase());
  return initials.length > 0 ? initials.join("") : name.slice(0, 2).toUpperCase();
}
