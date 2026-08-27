/**
 * Brand/asset intelligence contracts (Phase 9).
 *
 * PageBrandEvidence is the raw, bounded, JSON-safe evidence one hardened
 * page visit collects. BrandProfile (brand-profile-v1) is the deterministic
 * derivation persisted as an append-only website_analysis row under analyzer
 * `brand-intelligence-v1`. Every selection carries reasons and source URLs
 * so "where did this logo/photo/color come from?" stays answerable.
 */

export const BRAND_INTELLIGENCE_VERSION = "brand-intelligence-v1";
export const BRAND_PROFILE_VERSION = "brand-profile-v1";

/** Bounded-crawl limits for the brand pass. */
export const MAX_BRAND_PAGES = 3;
export const MAX_LOGO_CANDIDATES = 12;
export const MAX_IMAGE_CANDIDATES = 24;
export const MAX_SELECTED_IMAGES = 4;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024;
export const ASSET_FETCH_TIMEOUT_MS = 15_000;
export const LOGO_MAX_WIDTH = 512;
export const PHOTO_MAX_WIDTH = 1600;
export const MIN_PHOTO_WIDTH = 500;
export const MIN_PHOTO_HEIGHT = 320;
export const MIN_LOGO_DIMENSION = 40;
export const MIN_ICON_LOGO_DIMENSION = 64;

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
}

export interface EvidenceBackgroundImage {
  src: string;
  elementWidth: number;
  elementHeight: number;
  documentTop: number;
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

export interface BrandImage {
  role: "hero" | "gallery";
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
  };
  services: {
    extracted: BrandService[];
    consideredCount: number;
  };
  identity: {
    displayName: string | null;
    metaDescription: string | null;
  };
  /** Run directory name under .data/demo-assets (null when nothing downloaded). */
  artifactRef: string | null;
  fallbacks: string[];
  assetBytesDownloaded: number;
  /** Set when the site could not be inspected at all; profile is all-fallback. */
  fatal?: { stage: string; message: string; transient: boolean };
}
