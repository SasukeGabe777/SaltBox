/**
 * In-page DOM signal extraction. `extractDomSignals` is serialized into the
 * page via page.evaluate, so it must be self-contained: DOM APIs only, no
 * imports, no closure captures. Everything it returns is bounded.
 */

export interface DomSignals {
  title: string | null;
  metaDescription: string | null;
  generatorMeta: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  viewportMeta: string | null;
  faviconPresent: boolean;
  openGraphPresent: boolean;
  h1Count: number;
  headingLevels: number[];
  wordCount: number;
  links: string[];
  navPresent: boolean;
  phoneLinks: string[];
  emailLinks: string[];
  forms: Array<{ fieldCount: number; hasSubmit: boolean; looksLikeContact: boolean }>;
  ctaTexts: string[];
  jsonLdTypes: string[];
  jsonLdPresent: boolean;
  socialLinks: string[];
  addressSignal: boolean;
  copyrightYear: number | null;
  horizontalOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
}

export function extractDomSignals(): DomSignals {
  const text = (element: Element | null): string | null => {
    const value = element?.getAttribute("content") ?? element?.textContent ?? null;
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed.slice(0, 500);
  };

  const bodyText = document.body?.innerText ?? "";
  const words = bodyText.split(/\s+/).filter((word) => word !== "");

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const hrefs: string[] = [];
  const phoneLinks: string[] = [];
  const emailLinks: string[] = [];
  const socialLinks: string[] = [];
  const socialHosts = [
    "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com",
    "twitter.com", "x.com", "maps.google.", "google.com/maps", "g.page", "maps.app.goo.gl",
  ];
  for (const anchor of anchors.slice(0, 500)) {
    const href = anchor.getAttribute("href") ?? "";
    if (href.toLowerCase().startsWith("tel:")) phoneLinks.push(href.slice(0, 60));
    else if (href.toLowerCase().startsWith("mailto:")) emailLinks.push(href.slice(0, 100));
    else {
      hrefs.push(href.slice(0, 500));
      const lower = href.toLowerCase();
      if (socialHosts.some((host) => lower.includes(host))) socialLinks.push(href.slice(0, 200));
    }
  }

  const forms = Array.from(document.querySelectorAll("form"))
    .slice(0, 10)
    .map((form) => {
      const fields = form.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select");
      const hasSubmit = form.querySelector("button, input[type=submit]") !== null;
      const formText = ((form.textContent ?? "") + " " + (form.getAttribute("action") ?? "") + " " + (form.id ?? "") + " " + (form.className ?? "")).toLowerCase();
      const hasSearchOnly = fields.length === 1 && /search/.test(formText);
      const looksLikeContact =
        !hasSearchOnly &&
        fields.length >= 2 &&
        (/contact|quote|estimate|message|enquir|inquir|appointment|schedule|request/.test(formText) ||
          form.querySelector("textarea") !== null);
      return { fieldCount: fields.length, hasSubmit, looksLikeContact };
    });

  const ctaPattern = /(get|request|free)\s+(a\s+)?(quote|estimate|consultation)|book\s+(now|online|an appointment)|schedule\s+(service|now|appointment|a call)|call\s+(us\s+)?(now|today)|contact\s+us|get\s+started|request\s+service/i;
  const ctaTexts: string[] = [];
  const clickable = Array.from(document.querySelectorAll("a, button"));
  for (const element of clickable.slice(0, 600)) {
    const label = (element.textContent ?? "").trim().replace(/\s+/g, " ");
    if (label.length > 0 && label.length <= 60 && ctaPattern.test(label)) {
      ctaTexts.push(label);
      if (ctaTexts.length >= 10) break;
    }
  }

  const jsonLdTypes: string[] = [];
  let jsonLdPresent = false;
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
    jsonLdPresent = true;
    try {
      const parsed = JSON.parse(script.textContent ?? "null") as unknown;
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === "object") {
          const type = (node as Record<string, unknown>)["@type"];
          if (typeof type === "string") jsonLdTypes.push(type.slice(0, 60));
          else if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && jsonLdTypes.push(t.slice(0, 60)));
          const graph = (node as Record<string, unknown>)["@graph"];
          if (Array.isArray(graph)) graph.forEach(collect);
        }
      };
      collect(parsed);
    } catch {
      /* malformed JSON-LD is itself just absence of parseable data */
    }
  }

  const yearMatches = bodyText.match(/(?:©|\(c\)|copyright)[^\d]{0,20}(\d{4})/i);
  const copyrightYear = yearMatches ? Number(yearMatches[1]) : null;

  const headingLevels: number[] = [];
  for (const heading of Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).slice(0, 100)) {
    headingLevels.push(Number(heading.tagName.slice(1)));
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement;

  return {
    title: document.title?.trim().slice(0, 300) || null,
    metaDescription: text(document.querySelector('meta[name="description"]')),
    generatorMeta: text(document.querySelector('meta[name="generator"]')),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.slice(0, 500) ?? null,
    robotsMeta: text(document.querySelector('meta[name="robots"]')),
    lang: document.documentElement.getAttribute("lang"),
    viewportMeta: text(document.querySelector('meta[name="viewport"]')),
    faviconPresent: document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]') !== null,
    openGraphPresent: document.querySelector('meta[property^="og:"]') !== null,
    h1Count: document.querySelectorAll("h1").length,
    headingLevels,
    wordCount: words.length,
    links: hrefs.slice(0, 300),
    navPresent: document.querySelector("nav, [role=navigation], header a[href]") !== null,
    phoneLinks: phoneLinks.slice(0, 10),
    emailLinks: emailLinks.slice(0, 10),
    forms,
    ctaTexts,
    jsonLdTypes: Array.from(new Set(jsonLdTypes)).slice(0, 15),
    jsonLdPresent,
    socialLinks: Array.from(new Set(socialLinks)).slice(0, 20),
    addressSignal:
      /\d{1,6}\s+[A-Za-z0-9.\- ]{3,40}\s(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway)\b/i.test(bodyText) ||
      document.querySelector("address") !== null,
    copyrightYear: copyrightYear !== null && copyrightYear >= 1990 && copyrightYear <= 2100 ? copyrightYear : null,
    horizontalOverflow: scrollingElement.scrollWidth > scrollingElement.clientWidth + 2,
    scrollWidth: scrollingElement.scrollWidth,
    clientWidth: scrollingElement.clientWidth,
  };
}
