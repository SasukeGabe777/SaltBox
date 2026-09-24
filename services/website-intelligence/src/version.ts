/**
 * Versioned analyzer identity persisted with every analysis (ADR-004).
 * v2: the mobile pass emulates a real phone (mobile user agent, not just a
 * narrow viewport), CTA/booking detection covers "Call or Text Us" and
 * booking-platform links, and homepage services/about SECTIONS are recorded
 * so single-page sites are not reported as missing them.
 */
export const WEBSITE_INTELLIGENCE_VERSION = "website-intelligence-v2";
export const FINDINGS_SCHEMA_VERSION = 1;

/** Honest bot identity appended to the real Chrome UA (declares automation). */
export const INTELLIGENCE_UA_SUFFIX = "SaltBoxWebsiteIntelligence/1.0 (+https://github.com/SasukeGabe777/SaltBox)";
/** UA used for plain HTTP checks (robots.txt, redirect resolution, link health). */
export const INTELLIGENCE_HTTP_UA = "SaltBoxWebsiteIntelligence/1.0 (+https://github.com/SasukeGabe777/SaltBox)";

/** Bounded-crawl limits (documented in the service README). */
export const MAX_PAGES_PER_SITE = 5;
export const MAX_LINKS_CHECKED = 25;
export const NAVIGATION_TIMEOUT_MS = 25_000;
export const LIGHTHOUSE_TIMEOUT_MS = 75_000;
export const SITE_TIME_BUDGET_MS = 240_000;
export const LINK_CHECK_TIMEOUT_MS = 8_000;
export const HTTP_FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECT_HOPS = 5;

export const DEFAULT_BATCH_LIMIT = 5;
export const MAX_BATCH_LIMIT = 25;
export const DEFAULT_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 2;

/** Desktop and mobile analysis viewports. */
export const DESKTOP_VIEWPORT = { width: 1366, height: 900 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * Mobile Safari UA for the mobile pass. Site builders (Wix, some Squarespace
 * and GoDaddy themes) choose their mobile layout from the user agent, so a
 * desktop UA in a narrow viewport measures a page no real phone ever sees.
 * The honest automation suffix is still appended.
 */
export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
