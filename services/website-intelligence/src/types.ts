/** Shared result shapes for the Phase 6 website-intelligence analyzer. */

export type StageStatus = "ok" | "partial" | "failed" | "skipped";

export interface StageOutcome {
  status: StageStatus;
  /** Present when status is partial/failed: what went wrong, briefly. */
  error?: string;
}

export interface AnalyzedPage {
  url: string;
  finalUrl: string | null;
  role: "homepage" | "contact" | "services" | "about" | "locations" | "other";
  selectedBecause: string;
  httpStatus: number | null;
  reachable: boolean;
  contentHash: string | null;
  title: string | null;
  wordCount: number | null;
  consoleErrorCount: number;
  failedRequestCount: number;
}

export interface LabMetrics {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  /** Milliseconds / unitless lab measurements (mobile emulation), not CrUX. */
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  totalBlockingTimeMs: number | null;
  cumulativeLayoutShift: number | null;
  speedIndexMs: number | null;
  accessibilityFailures: Array<{ id: string; title: string }>;
}

export interface MobileSignals {
  viewportMetaPresent: boolean;
  horizontalOverflow: boolean | null;
  contentWiderThanViewport: boolean | null;
  navigationPresent: boolean | null;
}

export interface TechnicalSignals {
  https: boolean;
  httpStatus: number | null;
  redirectChain: string[];
  canonicalUrl: string | null;
  faviconPresent: boolean;
  mixedContentRequests: number;
  consoleErrors: number;
  consoleErrorExamples: string[];
  failedRequests: number;
  failedRequestExamples: string[];
  requestCount: number | null;
  transferredBytes: number | null;
  robotsTxtPresent: boolean | null;
  sitemapPresent: boolean | null;
}

export interface SeoSignals {
  titlePresent: boolean;
  titleLength: number;
  metaDescriptionPresent: boolean;
  metaDescriptionLength: number;
  canonicalPresent: boolean;
  robotsMeta: string | null;
  h1Count: number;
  headingOrderValid: boolean;
  langPresent: boolean;
  openGraphPresent: boolean;
  structuredDataPresent: boolean;
  schemaTypes: string[];
  indexable: boolean;
}

export interface ConversionSignals {
  phoneLinkPresent: boolean;
  emailLinkPresent: boolean;
  contactPagePresent: boolean;
  contactFormPresent: boolean;
  formFieldCount: number;
  formHasSubmit: boolean;
  quoteCtaPresent: boolean;
  bookingCtaPresent: boolean;
  prominentCtaPresent: boolean;
  visibleAddressPresent: boolean;
}

export interface ContentSignals {
  homepageWordCount: number | null;
  servicesPagePresent: boolean;
  aboutPagePresent: boolean;
  copyrightYear: number | null;
  lastModifiedHeader: string | null;
}

export interface LinkHealth {
  checked: number;
  working: number;
  redirecting: number;
  broken: number;
  timedOut: number;
  blocked: number;
  brokenExamples: string[];
}

export interface AssetHealth {
  failedImages: number;
  failedStylesheets: number;
  failedScripts: number;
  otherFailed: number;
  examples: string[];
}

export interface PlatformSignal {
  platform: string | null;
  confidence: "high" | "medium" | "unknown";
  evidence: string[];
}

export interface SocialLinks {
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  x: string | null;
  googleMaps: string | null;
  other: string[];
}

export interface ArtifactRefs {
  /** Relative directory under the intelligence artifact root. */
  directory: string;
  desktopScreenshot: string | null;
  mobileScreenshot: string | null;
  lighthouseReport: string | null;
}

export interface WebsiteIntelligenceResult {
  analyzerVersion: string;
  websiteUrl: string;
  finalHomepageUrl: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pages: AnalyzedPage[];
  stages: {
    homepage: StageOutcome;
    pageSelection: StageOutcome;
    subPages: StageOutcome;
    lighthouse: StageOutcome;
    mobile: StageOutcome;
    linkHealth: StageOutcome;
    screenshots: StageOutcome;
  };
  lab: LabMetrics | null;
  mobile: MobileSignals | null;
  technical: TechnicalSignals | null;
  seo: SeoSignals | null;
  conversion: ConversionSignals | null;
  content: ContentSignals | null;
  links: LinkHealth | null;
  assets: AssetHealth | null;
  platform: PlatformSignal | null;
  social: SocialLinks | null;
  artifacts: ArtifactRefs | null;
  /** Fatal-only: set when the site could not be analyzed at all. */
  fatal?: {
    stage: "no_website" | "blocked_target" | "unreachable" | "browser_unavailable" | "internal";
    message: string;
    failureKind?:
      | "invalid_target"
      | "blocked_target"
      | "dns_transient"
      | "dns_not_found"
      | "dns_failure"
      | "tls_failure"
      | "timeout"
      | "unreachable"
      | "browser_unavailable"
      | "internal";
    code?: string;
    transient?: boolean;
  };
}
