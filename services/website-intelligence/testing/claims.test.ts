/**
 * Absence-claim rules (claims.ts). The Froggy Plumbing case is encoded
 * verbatim: its website-intelligence-v1 findings produced three claims the
 * owner could disprove on their own phone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { supportedSiteClaims } from "../src/claims.ts";

/** froggyplumbing.com as persisted by website-intelligence-v1 (2026-09-23). */
const FROGGY_V1 = {
  mobile: { navigationPresent: true, horizontalOverflow: true, viewportMetaPresent: true, contentWiderThanViewport: true },
  content: { copyrightYear: 2025, aboutPagePresent: false, homepageWordCount: 242, servicesPagePresent: false },
  conversion: {
    formHasSubmit: false,
    quoteCtaPresent: false,
    emailLinkPresent: false,
    phoneLinkPresent: true,
    bookingCtaPresent: false,
    contactFormPresent: false,
    contactPagePresent: false,
    prominentCtaPresent: false,
  },
};

/** The same site re-measured by v2 (phone UA, broader CTA/booking/section checks). */
const FROGGY_V2 = {
  mobile: { ...FROGGY_V1.mobile, horizontalOverflow: false, contentWiderThanViewport: false, emulatedMobileDevice: true },
  content: { ...FROGGY_V1.content, servicesSectionPresent: true, aboutSectionPresent: true },
  conversion: {
    ...FROGGY_V1.conversion,
    prominentCtaPresent: true,
    bookingCtaPresent: true,
    bookingLinkPresent: true,
    homepageCtaTexts: ["Call or Text Us", "Book Online"],
  },
};

/** A genuinely weak site, fully measured by v2. */
const WEAK_V2 = {
  mobile: { viewportMetaPresent: false, horizontalOverflow: true, emulatedMobileDevice: true },
  content: { servicesPagePresent: false, servicesSectionPresent: false, aboutPagePresent: false, aboutSectionPresent: false },
  conversion: {
    prominentCtaPresent: false,
    quoteCtaPresent: false,
    bookingCtaPresent: false,
    bookingLinkPresent: false,
    contactFormPresent: false,
    emailLinkPresent: false,
    contactPagePresent: false,
  },
};

test("v1 findings cannot support mobile, CTA, services, or about absence claims", () => {
  const claims = supportedSiteClaims(FROGGY_V1, { extractedServiceCount: 5 });
  assert.deepEqual([...claims], []);
});

test("the re-measured Froggy site supports none of the claims its owner disproved", () => {
  assert.deepEqual([...supportedSiteClaims(FROGGY_V2, { extractedServiceCount: 5 })], []);
});

test("a genuinely weak, fully measured site still gets every claim", () => {
  assert.deepEqual(
    [...supportedSiteClaims(WEAK_V2)].sort(),
    [
      "ABOUT_CONTENT_MISSING",
      "CONTACT_FORM_MISSING",
      "CONTACT_PATH_MISSING",
      "CTA_MISSING",
      "MOBILE_OVERFLOW",
      "MOBILE_VIEWPORT_MISSING",
      "SERVICES_CONTENT_MISSING",
    ],
  );
});

test("each piece of counter-evidence withdraws exactly its own claim", () => {
  const withBooking = { ...WEAK_V2, conversion: { ...WEAK_V2.conversion, bookingLinkPresent: true } };
  const claims = supportedSiteClaims(withBooking);
  assert.equal(claims.has("CTA_MISSING"), false, "a booking link is a way to ask for work");
  assert.equal(claims.has("CONTACT_FORM_MISSING"), false, "online booking means customers need not call");

  const withEmail = { ...WEAK_V2, conversion: { ...WEAK_V2.conversion, emailLinkPresent: true } };
  assert.equal(supportedSiteClaims(withEmail).has("CONTACT_FORM_MISSING"), false);

  const withSection = { ...WEAK_V2, content: { ...WEAK_V2.content, servicesSectionPresent: true } };
  assert.equal(supportedSiteClaims(withSection).has("SERVICES_CONTENT_MISSING"), false);
  assert.equal(supportedSiteClaims(WEAK_V2, { extractedServiceCount: 4 }).has("SERVICES_CONTENT_MISSING"), false);

  const desktopUaOverflow = { ...WEAK_V2, mobile: { ...WEAK_V2.mobile, emulatedMobileDevice: undefined } };
  assert.equal(supportedSiteClaims(desktopUaOverflow).has("MOBILE_OVERFLOW"), false);
});

test("malformed or empty findings support nothing", () => {
  for (const findings of [null, undefined, "x", [], {}, { conversion: [] }]) {
    assert.deepEqual([...supportedSiteClaims(findings)], []);
  }
});

test("website tel: links rank into E.164 numbers, most-linked first", async () => {
  const { rankPhones } = await import("../src/analyze-website.ts");
  assert.deepEqual(
    rankPhones(["tel:435-681-5665", "tel:4356815665", "tel:+1 (385) 837-1902", "tel:4356815665", "tel:12", "TEL:1-801-555-0100"]),
    ["+14356815665", "+13858371902", "+18015550100"],
  );
  assert.deepEqual(rankPhones([]), []);
});
