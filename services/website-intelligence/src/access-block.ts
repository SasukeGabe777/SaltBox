/**
 * Detects a homepage that refused our automated visit (bot protection, WAF,
 * rate limiting) instead of showing the business's site.
 *
 * A "403 Forbidden" or "Just a moment..." interstitial is not evidence about
 * the business's website: scoring it would invent deficiencies (no CTA, no
 * meta description, 11 words) and brand extraction would find nothing. Both
 * analyzers treat it as "could not evaluate". SaltBox honors the refusal — it
 * never tries to evade bot protection.
 */

const BLOCKING_STATUSES = new Set([401, 403, 407, 429, 503]);
const BLOCK_PAGE_TITLE =
  /^\s*(40[13]|429|50[23])\b|forbidden|access denied|service unavailable|just a moment|attention required|are you (a )?(robot|human)|verify(ing)? you are (a )?human|request (was )?blocked|security check|not acceptable|too many requests|ddos protection/i;
/** Real homepages carry more text than any interstitial. */
const MAX_BLOCK_PAGE_WORDS = 200;

export function detectAccessBlock(input: {
  status: number | null | undefined;
  title: string | null | undefined;
  wordCount: number | null | undefined;
}): string | null {
  const words = input.wordCount ?? 0;
  if (words >= MAX_BLOCK_PAGE_WORDS) return null;
  const title = (input.title ?? "").trim();
  if (input.status !== null && input.status !== undefined && BLOCKING_STATUSES.has(input.status)) {
    return `homepage answered HTTP ${input.status}${title ? ` ("${title.slice(0, 60)}")` : ""} to automated analysis`;
  }
  if (title !== "" && BLOCK_PAGE_TITLE.test(title)) {
    return `homepage served a block/interstitial page ("${title.slice(0, 60)}") to automated analysis`;
  }
  return null;
}
