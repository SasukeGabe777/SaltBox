/**
 * In-page brand evidence collection. One bounded page.evaluate per visited
 * page returns plain JSON (PageBrandEvidence) — nothing executable ever
 * leaves the browser sandbox, and every array is capped in-page so a hostile
 * site cannot flood the collector.
 */

import type { Page } from "puppeteer";
import type { PageBrandEvidence } from "./types.ts";

export async function collectPageBrandEvidence(page: Page, url: string, role: string): Promise<PageBrandEvidence> {
  const evidence = await page.evaluate(() => {
    const cap = <T>(items: T[], limit: number) => items.slice(0, limit);
    const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const absolute = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      try {
        return new URL(raw, document.baseURI).toString();
      } catch {
        return null;
      }
    };

    const meta = (selector: string) =>
      document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;

    // schema.org Organization/LocalBusiness logo from JSON-LD.
    let schemaLogo: string | null = null;
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 6)) {
      try {
        const parsed = JSON.parse(script.textContent ?? "");
        const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [])];
        for (const node of nodes) {
          const logo = node?.logo;
          const candidate = typeof logo === "string" ? logo : typeof logo?.url === "string" ? logo.url : null;
          if (candidate) {
            schemaLogo = absolute(candidate);
            break;
          }
        }
      } catch {
        /* malformed JSON-LD is ignored */
      }
      if (schemaLogo) break;
    }

    const icons = cap(
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')),
      8,
    )
      .map((link) => ({
        href: absolute(link.getAttribute("href")) ?? "",
        rel: link.rel,
        sizes: link.getAttribute("sizes") ?? "",
      }))
      .filter((icon) => icon.href !== "");

    // ---- v2 image context ---------------------------------------------------
    // Ordered: the first matching rule wins, so specific blocks (testimonial,
    // contact, CTA) beat broad ones (hero/banner, services).
    const CONTEXT_RULES: Array<[string, RegExp]> = [
      ["testimonial", /testimonial|review|quote(?!-?form)|feedback|what[- ]?(our )?(customers|clients|homeowners)[- ]?say/i],
      ["contact", /contact|get[- ]?in[- ]?touch|request[- ]?(a[- ]?)?(quote|estimate)|free[- ]?estimate|estimate[- ]?form|quote[- ]?form/i],
      ["cta", /\bcta\b|call[- ]?to[- ]?action|financ|coupon|special[- ]?offer|promo/i],
      ["team", /\bteam\b|\bstaff\b|meet[- ]?(the|our)|our[- ]?people|employee/i],
      ["partners", /partner|manufacturer|certif|affiliat|brands?[- ]?we|as[- ]?seen/i],
      // Not bare "post"/"article": WordPress wraps whole pages in
      // <article class="post-123 page">, which says nothing about a block.
      ["blog", /\bblog\b|\bnews\b|\bposts\b|\bpost-(list|grid|card|item|feed)\b|related-(posts|articles)|latest-(posts|articles)/i],
      ["gallery", /gallery|portfolio|project|our[- ]?work|recent[- ]?work|before[- ]?(and[- ]?)?after/i],
      ["hero", /hero|slider|carousel|jumbotron|masthead|banner/i],
      ["about", /about/i],
      ["services", /service|what[- ]?we[- ]?do|solution|product/i],
    ];
    const describe = (element: Element): string => {
      const html = element as HTMLElement;
      const className = typeof html.className === "string" ? html.className : "";
      return `${element.tagName.toLowerCase()} ${html.id ?? ""} ${className} ${element.getAttribute("aria-label") ?? ""}`;
    };
    /** Page-level wrappers describe the whole page (body classes, WP article shells), not a block. */
    const isPageWrapper = (element: Element): boolean =>
      /^(html|body|main)$/i.test(element.tagName) ||
      /^post-\d+$/.test((element as HTMLElement).id ?? "") ||
      element.getBoundingClientRect().height > Math.max(2400, document.documentElement.scrollHeight * 0.6);
    const sectionHeadingOf = (element: Element): string => {
      let current: Element | null = element.parentElement;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        if (isPageWrapper(current)) break;
        if (current.getBoundingClientRect().height < 160) continue;
        const heading = current.querySelector("h1, h2, h3");
        if (heading) return text(heading.textContent);
      }
      return "";
    };
    const contextOf = (element: Element): string => {
      if (element.closest("footer, [role='contentinfo']")) return "footer";
      if (element.closest("header, [role='banner'], nav")) return "header";
      let current: Element | null = element;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        if (isPageWrapper(current)) break;
        const descriptor = describe(current);
        for (const [context, pattern] of CONTEXT_RULES) {
          if (pattern.test(descriptor)) return context;
        }
      }
      const heading = sectionHeadingOf(element);
      for (const [context, pattern] of CONTEXT_RULES) {
        if (heading && pattern.test(heading)) return context;
      }
      return "unknown";
    };
    /** Nearest heading in the image's own card (links images to services). */
    const nearHeadingOf = (element: Element): string | null => {
      let current: Element | null = element.parentElement;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
        const heading = current.querySelector("h2, h3, h4, h5");
        if (heading) return text(heading.textContent).slice(0, 80) || null;
      }
      return null;
    };
    /** Visible text whose box substantially overlaps the image's box. */
    const overlayTextCharsOf = (element: Element, rect: DOMRect): number => {
      if (rect.width < 1 || rect.height < 1) return 0;
      // Overlaid captions/CTAs live within a few ancestors of the image.
      let container: Element | null = element.parentElement;
      for (let depth = 0; depth < 2 && container?.parentElement; depth += 1) container = container.parentElement;
      if (!container) return 0;
      let chars = 0;
      for (const node of Array.from(container.querySelectorAll("h1, h2, h3, h4, p, blockquote, a.btn, a.button, button")).slice(0, 40)) {
        if (node.contains(element)) continue;
        const box = node.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(box.right, rect.right) - Math.max(box.left, rect.left));
        const overlapY = Math.max(0, Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top));
        const area = box.width * box.height;
        if (area > 0 && (overlapX * overlapY) / area > 0.6) chars += text(node.textContent).length;
      }
      return Math.min(chars, 2000);
    };

    const header = document.querySelector("header, [role='banner'], .header, #header, nav");
    const images = cap(Array.from(document.querySelectorAll("img")), 60)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const anchor = img.closest("a");
        let linksToRoot = false;
        if (anchor) {
          try {
            const target = new URL(anchor.getAttribute("href") ?? "", document.baseURI);
            linksToRoot = target.origin === location.origin && (target.pathname === "/" || target.pathname === "");
          } catch {
            linksToRoot = false;
          }
        }
        const src = absolute(img.currentSrc || img.getAttribute("src"));
        return src === null
          ? null
          : {
              src,
              alt: text(img.getAttribute("alt")),
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              displayedWidth: Math.round(rect.width),
              displayedHeight: Math.round(rect.height),
              inHeader: header !== null && header.contains(img),
              linksToRoot,
              classHint: text(img.className && typeof img.className === "string" ? img.className : "").slice(0, 80),
              documentTop: Math.round(rect.top + window.scrollY),
              context: contextOf(img),
              nearHeading: nearHeadingOf(img),
              linkHref: anchor ? (anchor.getAttribute("href") ?? null) : null,
              overlayTextChars: overlayTextCharsOf(img, rect),
            };
      })
      .filter((image): image is NonNullable<typeof image> => image !== null);

    // Large elements painted with a CSS background image (common hero pattern).
    const backgroundImages: Array<{
      src: string;
      elementWidth: number;
      elementHeight: number;
      documentTop: number;
      context: string;
      nearHeading: string | null;
      overlayTextChars: number;
    }> = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body, body *")).slice(0, 400)) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 500 || rect.height < 260) continue;
      const background = getComputedStyle(element).backgroundImage;
      const match = /url\(["']?([^"')]+)["']?\)/.exec(background);
      if (!match) continue;
      const src = absolute(match[1]);
      if (!src || src.startsWith("data:")) continue;
      backgroundImages.push({
        src,
        elementWidth: Math.round(rect.width),
        elementHeight: Math.round(rect.height),
        documentTop: Math.round(rect.top + window.scrollY),
        context: contextOf(element),
        nearHeading: element.querySelector("h1, h2, h3") ? text(element.querySelector("h1, h2, h3")!.textContent).slice(0, 80) : null,
        overlayTextChars: Math.min(((element as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().length, 2000),
      });
      if (backgroundImages.length >= 10) break;
    }

    const styleOf = (element: Element | null) => (element ? getComputedStyle(element) : null);
    const headerStyle = styleOf(header);
    const buttonColors = cap(
      Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a.button, a.btn, [class*="btn-"], [class*="button"], input[type="submit"]'),
      ),
      20,
    )
      .map((element) => getComputedStyle(element).backgroundColor)
      .filter((color) => color !== "" && color !== "rgba(0, 0, 0, 0)" && color !== "transparent");

    const rootStyle = getComputedStyle(document.documentElement);
    const rootCustomProperties: Record<string, string> = {};
    let propCount = 0;
    for (let index = 0; index < rootStyle.length && propCount < 24; index += 1) {
      const name = rootStyle.item(index);
      if (!name.startsWith("--")) continue;
      const value = rootStyle.getPropertyValue(name).trim();
      if (/^(#|rgb)/i.test(value)) {
        rootCustomProperties[name] = value;
        propCount += 1;
      }
    }
    const firstLink = document.querySelector("main a[href], body a[href]");

    const headings = cap(Array.from(document.querySelectorAll("h1, h2, h3")), 30)
      .map((heading) => ({ level: Number(heading.tagName.slice(1)), text: text(heading.textContent) }))
      .filter((heading) => heading.text.length > 0);
    const navLabels = cap(Array.from(document.querySelectorAll("nav a, header a")), 30)
      .map((anchor) => text(anchor.textContent))
      .filter((label) => label.length > 0 && label.length <= 60);
    const listItems = cap(Array.from(document.querySelectorAll("main li, section li, ul li")), 80)
      .map((item) => text(item.textContent))
      .filter((item) => item.length > 2 && item.length <= 120);

    const internalHrefs = cap(Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")), 120)
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href !== "");

    return {
      title: document.title ? text(document.title) : null,
      metaDescription: meta('meta[name="description"]'),
      metaThemeColor: meta('meta[name="theme-color"]'),
      ogImage: absolute(meta('meta[property="og:image"]')),
      schemaLogo,
      icons,
      images,
      backgroundImages,
      colors: {
        headerBackground:
          headerStyle && headerStyle.backgroundColor !== "rgba(0, 0, 0, 0)" ? headerStyle.backgroundColor : null,
        headerText: headerStyle ? headerStyle.color : null,
        buttonColors,
        linkColor: firstLink ? getComputedStyle(firstLink).color : null,
        rootCustomProperties,
      },
      headings,
      navLabels: [...new Set(navLabels)],
      listItems,
      internalHrefs,
    };
  });

  // In-page context strings come from the fixed CONTEXT_RULES vocabulary.
  return { url, role, ...evidence } as PageBrandEvidence;
}
