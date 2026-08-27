/**
 * HTML rendering primitives for the demo renderer.
 *
 * Every dynamic value passes through esc() — demo content is plain text by
 * contract, and even then it is never trusted: no prospect-supplied HTML or
 * scripts can reach the page.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Escape for use inside a URL attribute; only http(s), tel:, mailto:, and fragments survive. */
export function safeHref(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("mailto:") ||
    /^https?:\/\//i.test(trimmed)
  ) {
    return esc(trimmed);
  }
  return "#";
}

/** tel: href from an E.164 number; digits and + only. */
export function telHref(e164: string): string {
  return `tel:${e164.replace(/[^\d+]/g, "")}`;
}

export function mailtoHref(email: string): string {
  return `mailto:${esc(email)}`;
}
