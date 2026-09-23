/**
 * SaltBox's own sales offer, shown after the owner finishes the improvement
 * tour ("Want this site live? Book a 15-minute call").
 *
 * This is renderer configuration, not demo content: it is the same for every
 * demo, can change without regenerating or re-approving any DemoVersion, and
 * is read from the environment (local server) or Worker vars (hosted). Nothing
 * is invented: an unset or invalid value simply disappears from the panel, and
 * with nothing configured the panel asks the owner to reply to the email.
 */

export interface SalesOffer {
  /** https booking page (Cal.com, Calendly, ...). */
  bookingUrl?: string;
  phone?: { display: string; e164: string };
  email?: string;
}

export interface SalesOfferEnv {
  SALTBOX_OFFER_BOOKING_URL?: string;
  SALTBOX_OFFER_PHONE?: string;
  SALTBOX_OFFER_EMAIL?: string;
}

export function offerFromEnv(env: SalesOfferEnv): SalesOffer {
  const offer: SalesOffer = {};
  const booking = env.SALTBOX_OFFER_BOOKING_URL?.trim();
  if (booking) {
    try {
      const url = new URL(booking);
      if (url.protocol === "https:" && !url.username && !url.password) offer.bookingUrl = url.toString();
    } catch {
      /* invalid URLs are ignored, never rendered */
    }
  }
  const digits = (env.SALTBOX_OFFER_PHONE ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    offer.phone = {
      display: `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`,
      e164: `+1${national}`,
    };
  }
  const email = env.SALTBOX_OFFER_EMAIL?.trim();
  if (email && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email)) offer.email = email;
  return offer;
}
