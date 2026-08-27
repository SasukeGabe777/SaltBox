/**
 * DemoPlan (demo-plan-v1): the deterministic, inspectable decision record
 * produced before any rendering. It captures which persisted intelligence
 * deficiencies the demo visibly addresses, which template was selected and
 * why, the CTA/contact strategy, and every fallback taken for missing data.
 */

import { DEMO_PLAN_VERSION, selectDemoTemplate, type TemplateSelection } from "./config/demo-v1.ts";
import { CTA_LABELS } from "./config/local-service-copy-v1.ts";
import type { DemoCta, DemoDeficiency, DemoPlan, DemoSourceFacts } from "./types.ts";

/**
 * Derive addressable deficiencies from persisted website-intelligence
 * structured findings. Each deficiency states how the demo answers it —
 * the demo must visibly solve identified problems, not merely reskin.
 */
export function deriveDemoDeficiencies(facts: DemoSourceFacts): DemoDeficiency[] {
  const intelligence = facts.intelligence;
  if (!intelligence) return [];
  const findings = intelligence.findings;
  const ref = intelligence.analysisId;
  const conversion = asRecord(findings.conversion);
  const seo = asRecord(findings.seo);
  const mobile = asRecord(findings.mobile);
  const lab = asRecord(findings.lab);
  const content = asRecord(findings.content);
  const deficiencies: DemoDeficiency[] = [];
  const add = (code: string, detail: string, addressedBy: string) =>
    deficiencies.push({ code, detail, addressedBy, evidenceRef: ref });

  if (conversion && conversion.prominentCtaPresent === false && conversion.quoteCtaPresent === false) {
    add("CTA_MISSING", "No prominent or quote call-to-action was found.", 'Prominent hero and header "Get a Quote" CTAs plus a closing contact CTA.');
  }
  if (conversion && conversion.contactFormPresent === false) {
    add("CONTACT_FORM_MISSING", "No contact form was found.", "A clear quote/contact form section (demo mode, non-submitting).");
  }
  if (conversion && conversion.phoneLinkPresent === false && facts.phone) {
    add("PHONE_LINK_MISSING", "The site never links its phone number.", "Click-to-call tel: links in the header, hero, and contact section.");
  }
  if (conversion && conversion.contactPagePresent === false) {
    add("CONTACT_PATH_MISSING", "No contact page was found.", "An always-visible contact section with every observed contact method.");
  }
  if (seo && seo.titlePresent === false) {
    add("TITLE_MISSING", "The homepage has no <title>.", "A strong deterministic page title naming the business, trade, and location.");
  }
  if (seo && seo.metaDescriptionPresent === false) {
    add("META_DESCRIPTION_MISSING", "The homepage has no meta description.", "A deterministic meta description built from observed facts.");
  }
  if (seo && typeof seo.h1Count === "number" && seo.h1Count === 0) {
    add("H1_MISSING", "The homepage has no <h1>.", "A semantic heading hierarchy starting at one clear <h1>.");
  }
  if (mobile && mobile.viewportMetaPresent === false) {
    add("MOBILE_VIEWPORT_MISSING", "No mobile viewport meta tag.", "A responsive mobile-first layout with a proper viewport.");
  }
  if (mobile && mobile.horizontalOverflow === true) {
    add("MOBILE_OVERFLOW", "The site overflows horizontally on mobile.", "A layout verified to render without horizontal overflow.");
  }
  const lcp = numberOrNull(lab?.largestContentfulPaintMs);
  if (lcp !== null && lcp > 2500) {
    add("SLOW_LCP", `Lab LCP was ${Math.round(lcp)} ms.`, "A lightweight single-request page with no heavy scripts or remote assets.");
  }
  const performance = numberOrNull(lab?.performance);
  if (performance !== null && performance < 80) {
    add("PERFORMANCE_WEAK", `Lab performance score was ${performance}.`, "A fast, dependency-free replacement page.");
  }
  const cls = numberOrNull(lab?.cumulativeLayoutShift);
  if (cls !== null && cls > 0.25) {
    add("CLS_POOR", `Lab CLS was ${cls}.`, "A stable layout with no shifting content.");
  }
  const words = numberOrNull(content?.homepageWordCount);
  if (words !== null && words < 150) {
    add("THIN_CONTENT", `The homepage has only ~${words} words.`, "Substantive services, trust, about, and contact sections.");
  }
  if (content && content.servicesPagePresent === false) {
    add("SERVICES_CONTENT_MISSING", "No services page was found.", "A structured services section (typical category services, disclosed).");
  }
  if (content && content.aboutPagePresent === false) {
    add("ABOUT_CONTENT_MISSING", "No about page was found.", "A business introduction built from observed identity facts.");
  }
  const copyrightYear = numberOrNull(content?.copyrightYear);
  const analysisYear = new Date(intelligence.calculatedAt).getUTCFullYear();
  if (copyrightYear !== null && analysisYear - copyrightYear >= 2) {
    add("COPYRIGHT_STALE", `The site's copyright year is ${copyrightYear}.`, "A current footer year rendered at view time.");
  }
  return deficiencies;
}

export interface BuildDemoPlanOptions {
  override?: { flag: string; note: string };
}

export function buildDemoPlan(facts: DemoSourceFacts, options: BuildDemoPlanOptions = {}): DemoPlan {
  const template = selectDemoTemplate(facts.category);
  if (!template) {
    throw new Error(`No demo template is available for category "${facts.category ?? "unknown"}".`);
  }
  const deficiencies = deriveDemoDeficiencies(facts);
  const fallbacks: string[] = [];

  const phoneAvailable = facts.phone !== undefined;
  const emailAvailable = facts.email !== undefined;
  const primaryCta: DemoCta = { label: CTA_LABELS.quote, kind: "contact" };
  const secondaryCta: DemoCta | undefined = phoneAvailable ? { label: CTA_LABELS.call, kind: "phone" } : undefined;
  if (!phoneAvailable) fallbacks.push("no observed phone: click-to-call omitted; contact CTA leads to the demo form");
  if (!emailAvailable) fallbacks.push("no observed email: email row omitted from the contact section");
  if (facts.city === undefined && facts.state === undefined) {
    fallbacks.push("no observed city/state: service-area section omitted and copy avoids location claims");
  }
  fallbacks.push("no verified review content: testimonials omitted (never fabricated)");

  const sections = [
    "header",
    "hero",
    "services",
    "trust",
    ...(facts.city !== undefined || facts.state !== undefined ? ["service-area"] : []),
    "about",
    "contact",
    "footer",
  ];

  const plan: DemoPlan = {
    planVersion: DEMO_PLAN_VERSION,
    prospectId: facts.prospectId,
    businessId: facts.businessId,
    qualification: facts.latestQualification
      ? {
          scoringVersion: facts.latestQualification.scoringVersion,
          policyVersion: facts.latestQualification.policyVersion,
          score: facts.latestQualification.overallScore,
          featureSetId: facts.latestQualification.featureSetId,
          leadScoreId: facts.latestQualification.leadScoreId,
          decisionId: facts.latestQualification.decisionId,
        }
      : null,
    intelligence: facts.intelligence
      ? {
          analysisId: facts.intelligence.analysisId,
          analyzerVersion: facts.intelligence.analyzerVersion,
          calculatedAt: facts.intelligence.calculatedAt,
        }
      : null,
    deficiencies,
    template: templateSelectionView(template),
    sections,
    ctaStrategy: {
      primary: primaryCta,
      ...(secondaryCta ? { secondary: secondaryCta } : {}),
      rationale: phoneAvailable
        ? "Quote CTA leads to the contact form; the observed phone number backs a click-to-call secondary CTA."
        : "Quote CTA leads to the contact form; no phone was observed, so no call CTA is shown.",
    },
    contactStrategy: {
      phoneAvailable,
      emailAvailable,
      clickToCall: phoneAvailable,
      demoForm: true,
      rationale:
        "The demo form is presentation-only and never submits anywhere; observed contact methods are surfaced verbatim.",
    },
    factsAvailable: {
      phone: phoneAvailable,
      email: emailAvailable,
      city: facts.city !== undefined,
      state: facts.state !== undefined,
      street: facts.street !== undefined,
      websiteUrl: facts.websiteUrl !== undefined,
    },
    fallbacks,
    ...(options.override ? { override: options.override } : {}),
  };
  return plan;
}

function templateSelectionView(selection: TemplateSelection) {
  return {
    templateName: selection.templateName,
    templateVersion: selection.templateVersion,
    reason: selection.reason,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
