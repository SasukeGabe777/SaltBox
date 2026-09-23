/**
 * Brand/asset intelligence contracts (Phase 9).
 *
 * PageBrandEvidence is the raw, bounded, JSON-safe evidence one hardened
 * page visit collects. BrandProfile (brand-profile-v1) is the deterministic
 * derivation persisted as an append-only website_analysis row under analyzer
 * `brand-intelligence-v1`. Every selection carries reasons and source URLs
 * so "where did this logo/photo/color come from?" stays answerable.
 */

export const BRAND_INTELLIGENCE_VERSION = "brand-intelligence-v2";
export const BRAND_PROFILE_VERSION = "brand-profile-v2";
/** Every analyzer version whose profiles demo generation may read (newest first). */
export const READABLE_BRAND_INTELLIGENCE_VERSIONS = ["brand-intelligence-v2", "brand-intelligence-v1"] as const;

/** Bounded-crawl limits for the brand pass. */
export const MAX_BRAND_PAGES = 3;
export const MAX_LOGO_CANDIDATES = 12;
export const MAX_IMAGE_CANDIDATES = 24;
export const MAX_SELECTED_IMAGES = 4;
/** v2: photo candidates downloaded and analyzed before slot assignment. */
export const MAX_ANALYZED_IMAGES = 12;
/** v2: most gallery images one demo shows. */
export const MAX_GALLERY_IMAGES = 4;
/** v2: most per-service card images one demo shows. */
export const MAX_SERVICE_IMAGES = 6;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024;
export const ASSET_FETCH_TIMEOUT_MS = 15_000;
export const LOGO_MAX_WIDTH = 512;
export const PHOTO_MAX_WIDTH = 1600;
export const MIN_PHOTO_WIDTH = 500;
export const MIN_PHOTO_HEIGHT = 320;
export const MIN_LOGO_DIMENSION = 40;
export const MIN_ICON_LOGO_DIMENSION = 64;

/**
 * v2: what part of the source page an image sat in, inferred from ancestor
 * tags/ids/classes/aria labels and the nearest section heading. Images from
 * testimonial, contact, CTA, footer, team, partner, and blog blocks are
 * decoration for *that* block, not photography of the business's work.
 */
export type ImagePageContext =
  | "hero"
  | "gallery"
  | "services"
  | "about"
  | "team"
  | "testimonial"
  | "contact"
  | "cta"
  | "footer"
  | "header"
  | "partners"
  | "blog"
  | "unknown";

export interface EvidenceImage {
  /** Absolute URL. */
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  inHeader: boolean;
  linksToRoot: boolean;
  classHint: string;
  /** Distance from the top of the document in px (layout position). */
  documentTop: number;
  /** v2 page-section context (absent on v1 evidence). */
  context?: ImagePageContext;
  /** v2: nearest card/section heading text (links an image to a service). */
  nearHeading?: string | null;
  /** v2: href of the enclosing link, when the image is a link. */
  linkHref?: string | null;
  /** v2: characters of visible text laid over the image's box. */
  overlayTextChars?: number;
}

export interface EvidenceBackgroundImage {
  src: string;
  elementWidth: number;
  elementHeight: number;
  documentTop: number;
  context?: ImagePageContext;
  nearHeading?: string | null;
  /** v2: visible text inside the painted element (text-over-background). */
  overlayTextChars?: number;
}

export interface EvidenceIcon {
  href: string;
  rel: string;
  sizes: string;
}

export interface EvidenceColors {
  headerBackground: string | null;
  headerText: string | null;
  buttonColors: string[];
  linkColor: string | null;
  rootCustomProperties: Record<string, string>;
}

export interface PageBrandEvidence {
  url: string;
  role: string;
  title: string | null;
  metaDescription: string | null;
  metaThemeColor: string | null;
  ogImage: string | null;
  schemaLogo: string | null;
  icons: EvidenceIcon[];
  images: EvidenceImage[];
  backgroundImages: EvidenceBackgroundImage[];
  colors: EvidenceColors;
  headings: Array<{ level: number; text: string }>;
  navLabels: string[];
  listItems: string[];
  internalHrefs: string[];
}

export type BrandConfidence = "high" | "medium" | "low" | "none";

export interface LogoCandidate {
  src: string;
  kind: "image" | "schema" | "icon" | "og";
  score: number;
  reasons: string[];
  width: number;
  height: number;
  alt: string;
  sourcePage: string;
}

export interface BrandLogo {
  status: "selected" | "fallback";
  confidence: BrandConfidence;
  sourceUrl?: string;
  /** Relative artifact path under the run directory, e.g. "logo.png". */
  assetFile?: string;
  width?: number;
  height?: number;
  kind?: LogoCandidate["kind"];
  reasons: string[];
  candidatesConsidered: number;
}

export interface BrandPaletteColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  /** Text color that passes contrast on primary. */
  onPrimary: string;
  /** Text color that passes contrast on accent. */
  onAccent: string;
}

export interface BrandPalette {
  status: "extracted" | "fallback";
  confidence: BrandConfidence;
  colors?: BrandPaletteColors;
  /** Where the accepted colors came from (evidence labels). */
  sources: string[];
  candidatesConsidered: number;
}

/** v2 pixel measurements of a normalized photo. */
export interface ImageVisualMetrics {
  /** Mean Rec. 601 luma, 0-255. */
  meanLuma: number;
  /** Mean per-channel Shannon entropy (photos are typically > 6). */
  entropy: number;
  /** Fraction of the original area removed as uniform borders/letterboxing. */
  borderFraction: number;
  width: number;
  height: number;
  /** 64-bit difference hash (hex) for near-duplicate detection. */
  dhash: string;
}

/** v2 zero-shot visual classification (local CLIP; absent when unavailable). */
export interface ImageClassification {
  model: string;
  /** Coarse kind derived from the winning label. */
  kind: "work" | "person" | "vehicle" | "graphic" | "logo" | "interior" | "other";
  topLabel: string;
  topScore: number;
  /** Summed probability of the category's "real work" labels, 0-1. */
  relevance: number;
}

export interface ImageAnalysis {
  context: ImagePageContext;
  background: boolean;
  overlayTextChars: number;
  nearHeading: string | null;
  visual: ImageVisualMetrics;
  classification?: ImageClassification;
  /** Machine-readable quality flags, e.g. "dark", "letterboxed", "text-overlay". */
  flags: string[];
}

export type BrandImageRole = "hero" | "gallery" | "service" | "about";

export interface BrandImage {
  role: BrandImageRole;
  /** v2: the extracted service this image illustrates (role "service"). */
  serviceName?: string;
  /** v2: why this image was accepted and how it scored. */
  analysis?: ImageAnalysis;
  sourceUrl: string;
  sourcePage: string;
  /** Relative artifact path under the run directory. */
  assetFile: string;
  width: number;
  height: number;
  alt: string;
  reasons: string[];
}

export interface BrandService {
  /** Canonical normalized service name. */
  name: string;
  /** The exact site text that evidenced it. */
  sourceText: string;
  sourcePage: string;
  evidence: "heading" | "nav" | "list";
}

export interface BrandProfile {
  kind: "brand-intelligence";
  profileVersion: typeof BRAND_PROFILE_VERSION;
  analyzerVersion: typeof BRAND_INTELLIGENCE_VERSION;
  websiteUrl: string;
  finalUrl: string | null;
  collectedAt: string;
  durationMs: number;
  pagesInspected: Array<{ url: string; role: string }>;
  logo: BrandLogo;
  palette: BrandPalette;
  imagery: {
    selected: BrandImage[];
    consideredCount: number;
    rejectedExamples: string[];
    /** v2: analyzed-but-rejected photos with structured reasons. */
    rejected?: Array<{ sourceUrl: string; reasons: string[] }>;
    /** v2: whether the local visual classifier ran. */
    classifier?: { status: "used" | "unavailable"; model?: string; detail?: string };
  };
  services: {
    extracted: BrandService[];
    consideredCount: number;
  };
  identity: {
    displayName: string | null;
    metaDescription: string | null;
    /**
     * v2: the website redirected to a different company's domain (e.g. a
     * dealer site forwarding to a national distributor). Nothing collected
     * there is the business's brand, so every brand asset falls back.
     */
    foreignRedirect?: { requestedHost: string; finalHost: string };
    /** v2: the homepage served a bot-protection/WAF page instead of the site. */
    accessBlocked?: string;
  };
  /** Run directory name under .data/demo-assets (null when nothing downloaded). */
  artifactRef: string | null;
  fallbacks: string[];
  assetBytesDownloaded: number;
  /** Set when the site could not be inspected at all; profile is all-fallback. */
  fatal?: { stage: string; message: string; transient: boolean };
}
