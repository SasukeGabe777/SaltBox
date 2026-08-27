/**
 * Deterministic demo-content builder (demo-content-v1 + demo-copy-v1).
 *
 * Observed facts are used verbatim; generated copy is a phrase-library
 * transformation of those facts; category-typical services are explicitly
 * placeholder-provenance and disclosed. Same inputs always produce the same
 * content (headline variants are selected by a stable hash of the business
 * identity, never by randomness).
 */

import { brandViewFromFacts } from "./plan.ts";
import { sanitizeText, type BrandProfileView } from "./brand-view.ts";
import { DEMO_CONTENT_VERSION, categoryLabel } from "./config/demo-v1.ts";
import {
  CTA_LABELS,
  GENERIC_LOCAL_SERVICE_COPY,
  LOCAL_SERVICE_COPY,
  TRUST_POINTS,
  type CategoryCopy,
} from "./config/local-service-copy-v1.ts";
import { assertNoUnsupportedClaims } from "./claims-guard.ts";
import type {
  DemoContent,
  DemoImageryContent,
  DemoPlan,
  DemoServiceItem,
  DemoSourceFacts,
  ProvenanceEntry,
} from "./types.ts";

export function buildDemoContent(facts: DemoSourceFacts, plan: DemoPlan): DemoContent {
  const category = facts.category ?? "contractor";
  const label = categoryLabel(category);
  const copy: CategoryCopy = LOCAL_SERVICE_COPY[category] ?? GENERIC_LOCAL_SERVICE_COPY;
  const region = facts.city ?? facts.state;
  const brand = brandViewFromFacts(facts);
  const provenance: ProvenanceEntry[] = [];
  const observedSource = facts.discoverySourceName
    ? `${facts.discoverySourceName} source record`
    : "discovery source record";
  const note = (field: string, kind: ProvenanceEntry["kind"], source: string, ref?: string) =>
    provenance.push({ field, kind, source, ...(ref !== undefined ? { ref } : {}) });

  note("business.name", "observed", observedSource, facts.discoverySourceRecordId);
  note("business.category", "observed", observedSource, facts.discoverySourceRecordId);
  if (facts.phone) note("business.phone", "observed", "contact_method", facts.phone.contactMethodId);
  if (facts.email) note("business.email", "observed", "contact_method", facts.email.contactMethodId);
  if (facts.city !== undefined || facts.state !== undefined) {
    note("business.location", "observed", observedSource, facts.discoverySourceRecordId);
  }
  if (facts.websiteUrl !== undefined) note("business.websiteUrl", "observed", "website identity");

  const fill = (pattern: string) =>
    pattern
      .replaceAll("{name}", facts.businessName)
      .replaceAll("{labelLower}", label.toLowerCase())
      .replaceAll("{label}", label)
      .replaceAll("{region}", region ?? "")
      .replaceAll("{city}", facts.city ?? "")
      .replaceAll("{state}", facts.state ?? "")
      .replace(/\s{2,}/g, " ")
      .trim();

  const headline =
    region !== undefined
      ? fill(pickDeterministic(copy.hero.headlines, facts.businessId))
      : `${label}, Done Right`;
  note("hero", "generated", "demo-copy-v1 phrase library over observed facts");

  // Evidence-backed services from the business's own site, topped up with
  // clearly disclosed category-typical items. Nothing is invented.
  const extractedServices = (brand?.services ?? []).slice(0, 6);
  const serviceItems: DemoServiceItem[] = extractedServices.map((service) => ({
    title: service.name,
    description: extractedServiceDescription(service.name),
    evidence: true,
  }));
  for (const item of copy.services) {
    if (serviceItems.length >= 6) break;
    if (serviceItems.some((existing) => similarServiceTitle(existing.title, item.title))) continue;
    serviceItems.push({ title: item.title, description: item.description });
  }
  const extractedNames = extractedServices.map((service) => service.name);

  const locationSuffix =
    facts.city !== undefined && facts.state !== undefined
      ? ` in ${facts.city}, ${facts.state}`
      : region !== undefined
        ? ` in ${region}`
        : "";
  const metaTitle = `${facts.businessName} | ${label}${locationSuffix}`;
  const metaDescription =
    extractedNames.length >= 2
      ? `${facts.businessName} is a ${label.toLowerCase()} company${locationSuffix} offering ${listJoin(extractedNames.slice(0, 3).map((name) => name.toLowerCase()))}. Request an estimate today.`
      : `${facts.businessName} is a ${label.toLowerCase()} company${locationSuffix}. ` +
        `Request an estimate or get in touch today.`;
  note("meta", "generated", "demo-copy-v2 phrase library over observed facts");

  const subheadline =
    extractedNames.length >= 2
      ? `Explore ${listJoin(extractedNames.slice(0, 3).map((name) => name.toLowerCase()))} from ${facts.businessName} — with a clear way to get an estimate.`
      : fill(copy.hero.subheadline);

  if (extractedServices.length > 0) {
    for (const service of extractedServices) {
      note(
        `services.${service.name}`,
        "extracted",
        `found on the business's website (${service.evidence}: "${service.sourceText}")`,
        brand?.analysisId,
      );
    }
  }
  if (serviceItems.some((item) => item.evidence !== true)) {
    note("services", "placeholder", "demo-copy-v2 category-typical service list (disclosed demo presentation)");
  }
  note("trust", "placeholder", "demo-copy-v2 claim-free presentation points");
  note("about", "generated", "demo-copy-v2 phrase library over observed facts");
  note("contact", "generated", "demo-copy-v2 phrase library over observed facts");
  if (region !== undefined) note("serviceArea", "generated", "demo-copy-v2 over observed location");

  // Brand assets: locally stored, validated, provenance-tracked.
  if (brand?.logo) {
    note("brand.logo", "extracted", `logo from ${brand.logo.sourceUrl ?? "the business's website"}`, brand.analysisId);
  }
  if (brand?.palette) {
    note("brand.palette", "extracted", `colors from ${brand.paletteSources.join(", ") || "the business's website"}`, brand.analysisId);
  }
  const heroImage = brand?.images.find((image) => image.role === "hero");
  const galleryImages = (brand?.images ?? []).filter((image) => image.role === "gallery").slice(0, 3);
  const imagery: DemoImageryContent | undefined =
    heroImage || galleryImages.length > 0
      ? {
          ...(heroImage
            ? {
                hero: {
                  url: heroImage.url,
                  width: heroImage.width,
                  height: heroImage.height,
                  alt: imageAlt(heroImage.alt, facts.businessName),
                },
              }
            : {}),
          gallery: galleryImages.map((image) => ({
            url: image.url,
            width: image.width,
            height: image.height,
            alt: imageAlt(image.alt, facts.businessName),
          })),
        }
      : undefined;
  if (imagery) {
    note("imagery", "extracted", "photography from the business's own website (locally stored copies)", brand?.analysisId);
  }

  const content: DemoContent = {
    contentVersion: DEMO_CONTENT_VERSION,
    business: {
      name: facts.businessName,
      categoryKey: category,
      categoryLabel: label,
      ...(facts.phone ? { phone: { display: facts.phone.display, e164: facts.phone.e164 } } : {}),
      ...(facts.email ? { email: facts.email.value } : {}),
      ...(facts.city !== undefined ? { city: facts.city } : {}),
      ...(facts.state !== undefined ? { state: facts.state } : {}),
      ...(facts.street !== undefined ? { street: facts.street } : {}),
      ...(facts.postalCode !== undefined ? { postalCode: facts.postalCode } : {}),
      ...(facts.websiteUrl !== undefined ? { websiteUrl: facts.websiteUrl } : {}),
    },
    brand: {
      themeKey: copy.themeKey,
      logotype: logotypeFor(facts.businessName),
      ...(brand?.palette ? { palette: brand.palette } : {}),
      ...(brand?.logo
        ? {
            logo: {
              url: brand.logo.assetUrl,
              width: brand.logo.width,
              height: brand.logo.height,
              alt: `${facts.businessName} logo`,
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
    },
    services: {
      heading: `${label} Services`,
      intro:
        extractedNames.length >= 2
          ? region !== undefined
            ? `The work ${facts.businessName} already talks about, presented clearly for ${region} homeowners.`
            : `The work ${facts.businessName} already talks about, presented clearly.`
          : region !== undefined
            ? `What a complete ${label.toLowerCase()} site can present to ${region} homeowners.`
            : `What a complete ${label.toLowerCase()} site can present to homeowners.`,
      items: serviceItems,
      disclosure: servicesDisclosure(label, extractedNames.length, serviceItems.length),
    },
    trust: {
      heading: "What This Site Gets Right",
      points: TRUST_POINTS.map((point) => ({ title: point.title, description: point.description })),
    },
    ...(region !== undefined
      ? {
          serviceArea: {
            heading: "Service Area",
            description:
              facts.city !== undefined && facts.state !== undefined
                ? `${facts.businessName} is based in ${facts.city}, ${facts.state}, serving homeowners in and around ${facts.city}.`
                : `${facts.businessName} is based in ${region}.`,
          },
        }
      : {}),
    about: {
      heading: `About ${facts.businessName}`,
      body: fill(copy.aboutBody.replaceAll("{region}", region ?? "the area")),
    },
    contact: {
      heading: "Request an Estimate",
      intro: facts.phone
        ? `Describe your project below, or call ${facts.phone.display} to talk it through.`
        : "Describe your project below and the business will follow up.",
      formHeadline: CTA_LABELS.quote,
      formDemoNotice: "Demo preview — this form does not send messages.",
      ...(facts.street !== undefined && facts.city !== undefined && facts.state !== undefined
        ? {
            addressLine: `${facts.street}, ${facts.city}, ${facts.state}${facts.postalCode !== undefined ? ` ${facts.postalCode}` : ""}`,
          }
        : {}),
    },
    footer: {
      line: facts.businessName,
      demoDisclosure: `SaltBox demo preview created for ${facts.businessName}. This is not the business's live website.`,
    },
    indicator: { enabled: true, label: "Demo preview" },
    provenance,
  };

  assertNoUnsupportedClaims(content);
  return content;
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

/** Claim-free generic descriptions for evidence-backed service names. */
const EXTRACTED_SERVICE_DESCRIPTIONS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /replace/i, description: "Full replacement planning with a clear scope before work begins." },
  { pattern: /repair/i, description: "Targeted repairs that address the actual problem." },
  { pattern: /inspect/i, description: "A structured look at the current condition." },
  { pattern: /storm|damage/i, description: "An assessment of impact after severe weather." },
  { pattern: /solar/i, description: "Solar options planned alongside the rest of the project." },
  { pattern: /gutter|drain/i, description: "Keeping water moving where it should go." },
  { pattern: /metal|tile|shingle|flat/i, description: "Material options explained in plain terms." },
  { pattern: /commercial/i, description: "Work scoped for commercial properties." },
  { pattern: /residential/i, description: "Work scoped for homes." },
  { pattern: /heat|furnace|cool|air|hvac/i, description: "Comfort systems serviced and planned properly." },
  { pattern: /water|pipe|sewer|fixture/i, description: "Plumbing work done cleanly and explained clearly." },
  { pattern: /lawn|landscape|irrigation|tree/i, description: "Outdoor work planned for your property." },
  { pattern: /panel|wiring|lighting|electric|generator|charger/i, description: "Electrical work planned and completed carefully." },
];

function extractedServiceDescription(name: string): string {
  for (const { pattern, description } of EXTRACTED_SERVICE_DESCRIPTIONS) {
    if (pattern.test(name)) return description;
  }
  return `Ask about ${name.toLowerCase()} for your project.`;
}

const SERVICE_TITLE_STOPWORDS = new Set(["services", "service", "and", "the", "for", "your"]);

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

function imageAlt(original: string, businessName: string): string {
  const cleaned = sanitizeText(original, 120);
  return cleaned.length >= 5 ? cleaned : `${businessName} — photography from the business's website`;
}

function servicesDisclosure(label: string, extractedCount: number, totalCount: number): string {
  const lower = label.toLowerCase();
  if (extractedCount === 0) {
    return `Typical ${lower} services shown for demo presentation. Final services are confirmed with the business before anything goes live.`;
  }
  if (extractedCount >= totalCount) {
    return `Services drawn from the business's own website. Final content is confirmed with the business before anything goes live.`;
  }
  return `Highlighted services were found on the business's own website; the rest are typical ${lower} services shown for demo presentation. Final content is confirmed with the business before anything goes live.`;
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
