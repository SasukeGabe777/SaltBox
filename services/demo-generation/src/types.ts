/**
 * Phase 8 demo domain types.
 *
 * DemoContent is the versioned rendering contract (demo-content-v1): the one
 * renderer consumes exactly this structure and nothing else. Templates are
 * never coupled to database rows, and every rendered string is plain text —
 * the renderer escapes it; no prospect HTML or scripts ever pass through.
 *
 * Every piece of content carries provenance so "where did this statement
 * come from?" stays answerable later (ADR-004 discipline applied to demos).
 */

/** How a piece of demo content came to exist. */
export type ContentProvenanceKind =
  /** Directly observed business fact (discovery record, contact method, website identity). */
  | "observed"
  /** Extracted from the business's public website by deterministic intelligence. */
  | "extracted"
  /** Deterministic marketing transformation of observed facts (no new factual claims). */
  | "generated"
  /** Neutral demo scaffolding with no relationship to the business's facts. */
  | "placeholder";

export interface ProvenanceEntry {
  /** Dot path of the content field, e.g. "hero.headline". */
  field: string;
  kind: ContentProvenanceKind;
  /** Producer, e.g. "overture source record", "website-intelligence-v1", "demo-copy-v1". */
  source: string;
  /** Persisted evidence reference (source_record id, website_analysis id, ...). */
  ref?: string;
}

export interface ObservedText {
  value: string;
  provenance: ContentProvenanceKind;
}

export interface DemoBusinessContent {
  name: string;
  categoryKey: string;
  categoryLabel: string;
  phone?: { display: string; e164: string };
  email?: string;
  city?: string;
  state?: string;
  street?: string;
  postalCode?: string;
  /** The business's existing website (context only; never rendered as raw HTML). */
  websiteUrl?: string;
}

export interface DemoBrandContent {
  /** Deterministic category-based theme key understood by the template. */
  themeKey: string;
  /** Short mark rendered when no usable logo asset exists (e.g. initials). */
  logotype: string;
}

export interface DemoCta {
  label: string;
  /** "phone" renders tel:, "email" renders mailto:, "contact" anchors to the contact section. */
  kind: "phone" | "email" | "contact";
}

export interface DemoHeroContent {
  headline: string;
  subheadline: string;
  primaryCta: DemoCta;
  secondaryCta?: DemoCta;
}

export interface DemoServiceItem {
  title: string;
  description: string;
}

export interface DemoServicesContent {
  heading: string;
  intro: string;
  items: DemoServiceItem[];
  /** Non-deceptive disclosure that items are typical category services. */
  disclosure: string;
}

export interface DemoTrustPoint {
  title: string;
  description: string;
}

export interface DemoServiceAreaContent {
  heading: string;
  description: string;
}

export interface DemoAboutContent {
  heading: string;
  body: string;
}

export interface DemoTestimonialItem {
  quote: string;
  attribution: string;
}

/**
 * Testimonials render ONLY when verified review content exists. Phase 8 has
 * no review enrichment, so generation always omits this section and records
 * the fallback in the plan. Fabricating reviews is prohibited.
 */
export interface DemoTestimonialsContent {
  heading: string;
  mode: "verified";
  items: DemoTestimonialItem[];
}

export interface DemoContactContent {
  heading: string;
  intro: string;
  formHeadline: string;
  /** Rendered on/near the demo form: submissions go nowhere. */
  formDemoNotice: string;
  addressLine?: string;
}

export interface DemoFooterContent {
  line: string;
  /** Subtle disclosure that this is a SaltBox demo preview, not a live site. */
  demoDisclosure: string;
}

export interface DemoMetaContent {
  /** Strong deterministic page title (addresses TITLE_MISSING). */
  title: string;
  /** Strong deterministic meta description (addresses META_DESCRIPTION_MISSING). */
  description: string;
}

export interface DemoIndicatorContent {
  enabled: boolean;
  label: string;
}

export interface DemoContent {
  contentVersion: string;
  business: DemoBusinessContent;
  brand: DemoBrandContent;
  meta: DemoMetaContent;
  hero: DemoHeroContent;
  services: DemoServicesContent;
  trust: { heading: string; points: DemoTrustPoint[] };
  serviceArea?: DemoServiceAreaContent;
  about: DemoAboutContent;
  testimonials?: DemoTestimonialsContent;
  contact: DemoContactContent;
  footer: DemoFooterContent;
  indicator: DemoIndicatorContent;
  provenance: ProvenanceEntry[];
}

/** A website deficiency the demo visibly addresses. */
export interface DemoDeficiency {
  code: string;
  detail: string;
  /** How the demo answers it, e.g. "prominent hero quote CTA". */
  addressedBy: string;
  /** Persisted evidence: website_analysis id the signal came from. */
  evidenceRef?: string;
}

export interface DemoPlanQualification {
  scoringVersion: string;
  policyVersion: string;
  score: number;
  featureSetId: string;
  leadScoreId: string;
  decisionId: string;
}

export interface DemoPlanTemplateSelection {
  templateName: string;
  templateVersion: string;
  reason: string;
}

/** Deterministic, inspectable pre-render plan (demo-plan-v1). */
export interface DemoPlan {
  planVersion: string;
  prospectId: string;
  businessId: string;
  qualification: DemoPlanQualification | null;
  intelligence: { analysisId: string; analyzerVersion: string; calculatedAt: string } | null;
  deficiencies: DemoDeficiency[];
  template: DemoPlanTemplateSelection;
  sections: string[];
  ctaStrategy: { primary: DemoCta; secondary?: DemoCta; rationale: string };
  contactStrategy: {
    phoneAvailable: boolean;
    emailAvailable: boolean;
    clickToCall: boolean;
    demoForm: boolean;
    rationale: string;
  };
  factsAvailable: {
    phone: boolean;
    email: boolean;
    city: boolean;
    state: boolean;
    street: boolean;
    websiteUrl: boolean;
  };
  fallbacks: string[];
  /** Present only when an explicit operator override generated this demo. */
  override?: { flag: string; note: string };
}

/** Deterministic facts gathered from persisted SaltBox state (never recrawled). */
export interface DemoSourceFacts {
  prospectId: string;
  businessId: string;
  businessName: string;
  category: string | null;
  lifecycleState: string;
  phone?: { display: string; e164: string; contactMethodId: string };
  email?: { value: string; contactMethodId: string };
  city?: string;
  state?: string;
  street?: string;
  postalCode?: string;
  websiteUrl?: string;
  discoverySourceRecordId?: string;
  discoverySourceName?: string;
  intelligence?: {
    analysisId: string;
    analyzerVersion: string;
    calculatedAt: string;
    findings: Record<string, unknown>;
  };
  latestQualification?: {
    leadScoreId: string;
    featureSetId: string;
    decisionId: string;
    decisionResult: string;
    policyVersion: string;
    scoringVersion: string;
    overallScore: number;
    calculatedAt: string;
  };
  activeSuppressionIds: string[];
}
