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
  /**
   * True when the mobile pass emulated a real phone (mobile UA + viewport).
   * v1 analyses used a desktop UA in a narrow viewport, which makes
   * UA-switched builders (Wix) report overflow no phone ever shows; claims
   * about mobile layout must only be made when this is true.
   */
  emulatedMobileDevice?: boolean;
  /**
   * The suffixed-UA phone pass saw overflow, so the page was re-measured once
   * exactly as a real iPhone requests it; the widths below are that result.
   */
  overflowVerifiedAsPlainDevice?: boolean;
  /** Phone-layout document width vs viewport width (px), when measured. */
  mobileScrollWidth?: number;
  mobileClientWidth?: number;
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
  /** A link to online booking/scheduling (booking platform or /book page). */
  bookingLinkPresent?: boolean;
  /**
   * Phone numbers the homepage links with tel: (desktop or phone layout),
   * E.164 where recognisable, most-linked first. The business's own site is
   * the best evidence of the number customers should call.
   */
  websitePhones?: string[];
  /** CTA labels actually seen on the homepage (desktop or mobile layout). */
  homepageCtaTexts?: string[];
  visibleAddressPresent: boolean;
}

export interface ContentSignals {
  homepageWordCount: number | null;
  servicesPagePresent: boolean;
  aboutPagePresent: boolean;
  /** The homepage itself has a services section (single-page sites). */
  servicesSectionPresent?: boolean;
  /** The homepage itself has an about / who-we-are section. */
  aboutSectionPresent?: boolean;
  /** Reachable crawled pages that are not home/contact/about (e.g. per-service pages). */
  otherContentPages?: number;
  /** The homepage is a builder/registrar error or parking page ("Site not found"). */
  unavailableNotice?: string | null;
  /** First ~600 visible characters of the homepage (identity/fit checks). */
  homepageExcerpt?: string;
  /** First homepage headings, verbatim (how the site describes itself). */
  leadHeadings?: string[];
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
    stage: "no_website" | "blocked_target" | "unreachable" | "access_denied" | "browser_unavailable" | "internal";
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
      /** The site refused automated access (WAF/bot protection); not a site deficiency. */
      | "access_denied"
      | "internal";
    code?: string;
    transient?: boolean;
  };
}
