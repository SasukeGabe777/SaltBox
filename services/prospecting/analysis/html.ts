/**
 * Deterministic HTML signal extraction (ADR-001 Level 0). A parsed DOM keeps
 * the checks maintainable where raw regex over full documents would not.
 */

import { parse } from "node-html-parser";

export interface HtmlSignals {
  titlePresent: boolean;
  metaDescriptionPresent: boolean;
  viewportPresent: boolean;
  contactFormPresent: boolean;
  phonePresent: boolean;
  emailPresent: boolean;
  ctaPresent: boolean;
  copyrightYear: number | null;
}

const CTA_TEXT = /\b(get|request|book|schedule|contact|quote|estimate|call now|start|free|hire)\b/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(\+?\d[\d\s().-]{7,}\d)/;
const COPYRIGHT_PATTERN = /(?:©|&copy;|copyright)[^0-9]{0,40}((?:19|20)\d{2})/gi;

export function extractHtmlSignals(html: string): HtmlSignals {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const text = root.text;

  const title = root.querySelector("title")?.text.trim() ?? "";
  const metaDescription =
    root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const viewport = root.querySelector('meta[name="viewport"]') !== null;

  const forms = root.querySelectorAll("form");
  const contactFormPresent = forms.some(
    (form) => form.querySelector("input, textarea, select, button") !== null
  );

  const phonePresent = root.querySelector('a[href^="tel:"]') !== null || PHONE_PATTERN.test(text);
  const emailPresent = root.querySelector('a[href^="mailto:"]') !== null || EMAIL_PATTERN.test(text);

  const clickables = [
    ...root.querySelectorAll("a, button"),
    ...root.querySelectorAll('input[type="submit"]'),
  ];
  const ctaPresent = clickables.some((el) => {
    const label = el.tagName === "INPUT" ? (el.getAttribute("value") ?? "") : el.text;
    return CTA_TEXT.test(label.trim());
  });

  let copyrightYear: number | null = null;
  for (const match of text.matchAll(COPYRIGHT_PATTERN)) {
    const year = Number(match[1]);
    if (copyrightYear === null || year > copyrightYear) copyrightYear = year;
  }

  return {
    titlePresent: title.length > 0,
    metaDescriptionPresent: metaDescription.length > 0,
    viewportPresent: viewport,
    contactFormPresent,
    phonePresent,
    emailPresent,
    ctaPresent,
    copyrightYear,
  };
}
