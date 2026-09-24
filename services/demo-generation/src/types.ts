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

/** A processed local image asset served by the demo renderer. */
export interface DemoImage {
  /** Renderer-relative URL, e.g. "/demo-assets/<ref>/image-1.jpg". */
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** Contrast-safe extracted brand palette (demo-content-v2). */
export interface DemoPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  onPrimary: string;
  onAccent: string;
}

export interface DemoBrandContent {
  /** Deterministic category-based theme key understood by the template. */
  themeKey: string;
  /** Short mark rendered when no usable logo asset exists (e.g. initials). */
  logotype: string;
  /** Extracted brand palette (v2); templates fall back to the theme key. */
  palette?: DemoPalette;
  /** The business's actual logo, locally stored and validated (v2). */
  logo?: DemoImage;
  /**
   * The logo is a wide wordmark that already spells the name; the header
   * shows it alone instead of repeating (and truncating) the name beside it.
   */
  logoIsWordmark?: boolean;
}

/** Real business photography selected by brand intelligence (v2). */
export interface DemoImageryContent {
  hero?: DemoImage;
  gallery: DemoImage[];
  /** demo-content-v3: team/about-section photo. */
  about?: DemoImage;
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
  /**
   * Brand showcase (optional, demo-content-v3 superset): the business's own
   * logo featured large in the hero, with its own observed slogan. Set only
   * when a logo is confidently extracted at a size that stays crisp, so the
   * redesign never looks less "theirs" than the site it replaces. Absent on
   * older content, which therefore renders exactly as approved.
   */
  showcase?: { logo: DemoImage; tagline?: string };
}

export interface DemoServiceItem {
  title: string;
  description: string;
  /** True when the service name was extracted from the business's own site (v2). */
  evidence?: boolean;
  /** demo-content-v3: photo from the service's own card on the business's site. */
  image?: DemoImage;
  /** demo-content-v3: per-card call to action, e.g. "Ask about roof repair". */
  ctaLabel?: string;
}

export interface DemoServicesContent {
  heading: string;
  intro: string;
  items: DemoServiceItem[];
  /** Non-deceptive disclosure that items are typical category services. */
  disclosure: string;
}

/** demo-content-v3: customer-facing "how it works" steps (claim-free). */
export interface DemoProcessContent {
  heading: string;
  steps: Array<{ title: string; description: string }>;
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
  /** Real business photography (v2); absent content renders asset-free. */
  imagery?: DemoImageryContent;
  meta: DemoMetaContent;
  hero: DemoHeroContent;
  services: DemoServicesContent;
  trust: { heading: string; points: DemoTrustPoint[] };
  /** demo-content-v3. */
  process?: DemoProcessContent;
  /** demo-content-v3: owner-facing "what's improved" notes (evidence-backed). */
  improvements?: DemoImprovement[];
  /** demo-content-v3: before/after slider using their analyzed homepage captures. */
  comparison?: DemoComparison;
  serviceArea?: DemoServiceAreaContent;
  about: DemoAboutContent;
  testimonials?: DemoTestimonialsContent;
  contact: DemoContactContent;
  footer: DemoFooterContent;
  indicator: DemoIndicatorContent;
  provenance: ProvenanceEntry[];
}

/** Where on the demo page an improvement note's dot is pinned. */
export type DemoImprovementAnchor =
  | "header-cta"
  | "hero"
  | "hero-section"
  | "hero-contact"
  | "services"
  | "about"
  | "contact-form"
  | "footer";

/**
 * One owner-facing "what's improved" note. `before` states only what SaltBox
 * measured on the business's current site; `after` states what this demo does.
 */
export interface DemoImprovement {
  id: string;
  anchor: DemoImprovementAnchor;
  title: string;
  before: string;
  after: string;
  /** Deficiency code(s) the note is built from. */
  evidence: string[];
}

export interface DemoComparison {
  heading: string;
  intro: string;
  /** Human date the "before" captures were taken, e.g. "September 2026". */
  capturedLabel: string;
  /** Homepage capture at 1366x900. */
  desktop?: DemoImage;
  /** Homepage capture at 390x844. */
  mobile?: DemoImage;
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
  /** demo-plan-v2: full deterministic composition-selection reasoning. */
  selectionReasons?: string[];
}

/** demo-plan-v2: bounded summary of the brand intelligence used. */
export interface DemoPlanBrandSummary {
  analysisId: string;
  profileVersion: string;
  collectedAt: string;
  logo: { status: string; confidence: string; sourceUrl?: string };
  palette: { status: string; confidence: string; sources: string[] };
  /** Extracted swatches for read-only admin display. */
  paletteColors?: { primary: string; secondary: string; accent: string };
  imageryCount: number;
  extractedServices: string[];
  artifactRef: string | null;
  fallbacks: string[];
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
  /** demo-plan-v2: null when no brand intelligence exists (full fallback). */
  brand?: DemoPlanBrandSummary | null;
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

/** Persisted brand-intelligence result available to demo generation. */
export interface DemoBrandFacts {
  analysisId: string;
  calculatedAt: string;
  /** brand-profile-v1 structured findings (BrandProfile shape). */
  profile: Record<string, unknown>;
}

/** Deterministic facts gathered from persisted SaltBox state (never recrawled). */
export interface DemoSourceFacts {
  prospectId: string;
  businessId: string;
  websiteId?: string;
  businessName: string;
  category: string | null;
  /** Set when the listing's category was replaced by the trade the name states. */
  categoryCorrectedFrom?: string;
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
  /** Latest persisted brand-intelligence-v1 profile, when one exists. */
  brand?: DemoBrandFacts;
  activeSuppressionIds: string[];
}
