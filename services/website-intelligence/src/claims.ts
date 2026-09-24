/**
 * Which "your current site lacks X" claims a persisted analysis can back up.
 *
 * Every customer-facing statement about a prospect's site (demo "what's
 * improved" notes, outreach observations) goes through here, so the demo and
 * the email can never disagree and neither can say something a visitor would
 * see is false. Pure over the persisted structured-findings JSON; no browser.
 *
 * Rule: an ABSENCE claim is only made when the analysis positively measured
 * the thing and found it missing. Fields a check did not record (older
 * analyzer versions, failed stages) mean "don't know", never "missing".
 *
 * Why this exists: website-intelligence-v1 told a real business its phone
 * layout overflowed (it measured Wix's desktop layout with a desktop UA), that
 * it had no quote button (it had "Call or Text Us" and "Book Online"), and
 * that it listed no services (its homepage has a services section).
 */

export type SiteClaimCode =
  | "WEBSITE_BROKEN"
  | "CTA_MISSING"
  | "CONTACT_FORM_MISSING"
  | "CONTACT_PATH_MISSING"
  | "MOBILE_OVERFLOW"
  | "MOBILE_VIEWPORT_MISSING"
  | "SERVICES_CONTENT_MISSING"
  | "ABOUT_CONTENT_MISSING";

export interface ClaimContext {
  /** Services the brand extractor found on the site (any page). */
  extractedServiceCount?: number;
}

/** The subset of absence claims the findings positively support. */
export function supportedSiteClaims(findings: unknown, context: ClaimContext = {}): Set<SiteClaimCode> {
  const root = record(findings);
  const conversion = record(root?.conversion);
  const mobile = record(root?.mobile);
  const content = record(root?.content);
  const claims = new Set<SiteClaimCode>();

  // A "Site not found"/parked page, or a domain that confirmed does not
  // exist (non-transient DNS NXDOMAIN), is evidence of exactly one thing:
  // the site is down. Every absence claim would be about an error page.
  const fatal = record(root?.fatal);
  const domainGone = fatal?.failureKind === "dns_not_found" && fatal.transient === false;
  if (domainGone || (typeof content?.unavailableNotice === "string" && content.unavailableNotice !== "")) {
    claims.add("WEBSITE_BROKEN");
    return claims;
  }

  // "No way to ask for work": no CTA label of any kind AND no booking link.
  // bookingLinkPresent only exists from v2 on; without it we can't rule out a
  // booking button the v1 CTA pattern didn't recognise.
  const noCta =
    conversion?.prominentCtaPresent === false &&
    conversion.quoteCtaPresent === false &&
    conversion.bookingCtaPresent === false &&
    conversion.bookingLinkPresent === false;
  if (noCta) claims.add("CTA_MISSING");

  // "Customers have to call": only if there is no form, no online booking,
  // and no email link either.
  const noOnlineContact =
    conversion?.contactFormPresent === false &&
    conversion.bookingLinkPresent === false &&
    conversion.bookingCtaPresent === false &&
    conversion.emailLinkPresent === false;
  if (noOnlineContact) claims.add("CONTACT_FORM_MISSING");
  if (noOnlineContact && conversion?.contactPagePresent === false) claims.add("CONTACT_PATH_MISSING");

  // Overflow is only real if we looked with an actual phone profile, and
  // only worth claiming ("visitors scroll sideways, some of it is cut off")
  // when it is substantial: a carousel poking out 15px is not that.
  // (Overflow is re-confirmed with a plain device UA before it is recorded:
  // UA-sniffing builders serve bots a tablet layout.)
  if (mobile?.emulatedMobileDevice === true && mobile.overflowVerifiedAsPlainDevice === true && mobile.horizontalOverflow === true && substantialOverflow(mobile)) {
    claims.add("MOBILE_OVERFLOW");
  }
  if (mobile?.viewportMetaPresent === false) claims.add("MOBILE_VIEWPORT_MISSING");

  // Services: a single-page site with a services section, or a site with
  // per-service pages ("Floor Coatings", "General Painting"), is not
  // "missing services". Require every check to have run and come up empty.
  const servicesExtracted = (context.extractedServiceCount ?? 0) >= 3;
  if (
    content?.servicesPagePresent === false &&
    content.servicesSectionPresent === false &&
    content.otherContentPages === 0 &&
    !servicesExtracted
  ) {
    claims.add("SERVICES_CONTENT_MISSING");
  }
  // ABOUT_CONTENT_MISSING is never claimed: whether a site "introduces the
  // business" is a judgment ("Experienced Team... 30 years") that headings
  // cannot prove, and an owner can too easily point at the copy.
  return claims;
}

/** At least 8% of the screen (and 24px) wider than the phone viewport. */
export function substantialOverflow(mobile: Record<string, unknown>): boolean {
  const scroll = mobile.mobileScrollWidth;
  const client = mobile.mobileClientWidth;
  if (typeof scroll !== "number" || typeof client !== "number" || client <= 0) return false;
  return scroll - client >= Math.max(24, client * 0.08);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
