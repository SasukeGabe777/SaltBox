/**
 * Deterministic demo-content builder (demo-content-v1 + demo-copy-v1).
 *
 * Observed facts are used verbatim; generated copy is a phrase-library
 * transformation of those facts; category-typical services are explicitly
 * placeholder-provenance and disclosed. Same inputs always produce the same
 * content (headline variants are selected by a stable hash of the business
 * identity, never by randomness).
 */

import { DEMO_CONTENT_VERSION, categoryLabel } from "./config/demo-v1.ts";
import {
  CTA_LABELS,
  GENERIC_LOCAL_SERVICE_COPY,
  LOCAL_SERVICE_COPY,
  TRUST_POINTS,
  type CategoryCopy,
} from "./config/local-service-copy-v1.ts";
import { assertNoUnsupportedClaims } from "./claims-guard.ts";
import type { DemoContent, DemoPlan, DemoSourceFacts, ProvenanceEntry } from "./types.ts";

export function buildDemoContent(facts: DemoSourceFacts, plan: DemoPlan): DemoContent {
  const category = facts.category ?? "contractor";
  const label = categoryLabel(category);
  const copy: CategoryCopy = LOCAL_SERVICE_COPY[category] ?? GENERIC_LOCAL_SERVICE_COPY;
  const region = facts.city ?? facts.state;
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

  const locationSuffix =
    facts.city !== undefined && facts.state !== undefined
      ? ` in ${facts.city}, ${facts.state}`
      : region !== undefined
        ? ` in ${region}`
        : "";
  const metaTitle = `${facts.businessName} | ${label}${locationSuffix}`;
  const metaDescription =
    `${facts.businessName} is a ${label.toLowerCase()} company${locationSuffix}. ` +
    `Request an estimate or get in touch today.`;
  note("meta", "generated", "demo-copy-v1 phrase library over observed facts");

  note("services", "placeholder", "demo-copy-v1 category-typical service list (disclosed demo presentation)");
  note("trust", "placeholder", "demo-copy-v1 claim-free presentation points");
  note("about", "generated", "demo-copy-v1 phrase library over observed facts");
  note("contact", "generated", "demo-copy-v1 phrase library over observed facts");
  if (region !== undefined) note("serviceArea", "generated", "demo-copy-v1 over observed location");

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
    },
    meta: { title: metaTitle, description: metaDescription },
    hero: {
      headline,
      subheadline: fill(copy.hero.subheadline),
      primaryCta: plan.ctaStrategy.primary,
      ...(plan.ctaStrategy.secondary ? { secondaryCta: plan.ctaStrategy.secondary } : {}),
    },
    services: {
      heading: `${label} Services`,
      intro: region !== undefined ? `What a complete ${label.toLowerCase()} site can present to ${region} homeowners.` : `What a complete ${label.toLowerCase()} site can present to homeowners.`,
      items: copy.services.map((item) => ({ title: item.title, description: item.description })),
      disclosure: `Typical ${label.toLowerCase()} services shown for demo presentation. Final services are confirmed with the business before anything goes live.`,
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
