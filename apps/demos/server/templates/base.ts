/**
 * Shared primitives for the Phase 9 local-service compositions.
 *
 * Every composition assembles these same building blocks — theme resolution
 * (extracted brand palette with category fallback), brand mark, fact chips,
 * the non-submitting quote form, contact card, gallery, footer, and demo
 * indicator — so three meaningfully different layouts stay one renderer
 * with common, escaped-only rendering primitives.
 */

import type { DemoContent, DemoImage } from "@saltbox/demo-generation/content-model";
import { esc, mailtoHref, telHref } from "../html.ts";

export interface ResolvedTheme {
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  secondary: string;
  accent: string;
  accentDeep: string;
  onPrimary: string;
  onAccent: string;
  background: string;
  surface: string;
  text: string;
  /** True when the palette came from extracted brand evidence. */
  extracted: boolean;
}

const CATEGORY_THEMES: Record<string, Omit<ResolvedTheme, "extracted">> = {
  slate: theme("#1d3a5f", "#142a46", "#eef3f9", "#2c4d78", "#e8a33d", "#c98a26", "#ffffff", "#231a05"),
  ocean: theme("#0f4c5c", "#0a3641", "#ecf5f7", "#1a6478", "#2fa7c2", "#22869c", "#ffffff", "#04191e"),
  ember: theme("#7c2d26", "#571f1a", "#faf0ee", "#96453c", "#e98a15", "#c67210", "#ffffff", "#201101"),
  meadow: theme("#2e5d3a", "#20422a", "#eef6f0", "#3f7a4e", "#8bb944", "#719a33", "#ffffff", "#101a05"),
  amber: theme("#4a3f18", "#332b0f", "#f8f5ea", "#615325", "#d9a921", "#b78c15", "#ffffff", "#1c1503"),
};

function theme(
  primary: string,
  primaryDeep: string,
  primarySoft: string,
  secondary: string,
  accent: string,
  accentDeep: string,
  onPrimary: string,
  onAccent: string,
): Omit<ResolvedTheme, "extracted"> {
  return {
    primary,
    primaryDeep,
    primarySoft,
    secondary,
    accent,
    accentDeep,
    onPrimary,
    onAccent,
    background: "#ffffff",
    surface: "#f6f7f9",
    text: "#1c2430",
  };
}

/** Extracted palette wins; the deterministic category theme is the fallback. */
export function resolveTheme(content: DemoContent): ResolvedTheme {
  const palette = content.brand.palette;
  if (palette) {
    return {
      primary: palette.primary,
      primaryDeep: shade(palette.primary, 0.72),
      primarySoft: tint(palette.primary, 0.93),
      secondary: palette.secondary,
      accent: palette.accent,
      accentDeep: shade(palette.accent, 0.82),
      onPrimary: palette.onPrimary,
      onAccent: palette.onAccent,
      background: palette.background,
      surface: palette.surface,
      text: palette.text,
      extracted: true,
    };
  }
  const fallback = CATEGORY_THEMES[content.brand.themeKey] ?? CATEGORY_THEMES.slate!;
  return { ...fallback, extracted: false };
}

/** Deterministic hex shade (factor < 1 darkens toward black). */
export function shade(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHexColor(rgb.map((channel) => Math.round(channel * factor)) as [number, number, number]);
}

/** Deterministic hex tint (factor -> 1 approaches white). */
export function tint(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHexColor(rgb.map((channel) => Math.round(channel + (255 - channel) * factor)) as [number, number, number]);
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const raw = match[1]!;
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

function toHexColor(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.min(255, Math.max(0, channel)).toString(16).padStart(2, "0")).join("")}`;
}

export function themeCssVariables(resolved: ResolvedTheme): string {
  return [
    `--primary:${resolved.primary}`,
    `--primary-deep:${resolved.primaryDeep}`,
    `--primary-soft:${resolved.primarySoft}`,
    `--secondary:${resolved.secondary}`,
    `--accent:${resolved.accent}`,
    `--accent-deep:${resolved.accentDeep}`,
    `--on-primary:${resolved.onPrimary}`,
    `--on-accent:${resolved.onAccent}`,
    `--ink:${resolved.text}`,
    `--muted:#5b6472`,
    `--bg:${resolved.background}`,
    `--surface:${resolved.surface}`,
    `--border:#e4e7ec`,
  ].join(";");
}

// --- Icons -------------------------------------------------------------------

export const ICONS = {
  check:
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" opacity="0.35"></circle><path d="m8.5 12.2 2.4 2.4 4.6-4.9"></path></svg>',
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
  phone:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"></path></svg>',
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-10 7L2 7"></path></svg>',
  menu: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
} as const;

// --- Blocks ------------------------------------------------------------------

export function ctaHref(kind: "phone" | "email" | "contact", content: DemoContent): string {
  if (kind === "phone" && content.business.phone) return telHref(content.business.phone.e164);
  if (kind === "email" && content.business.email) return mailtoHref(content.business.email);
  return "#contact";
}

/** The business's real logo when available, else the initials mark. */
export function brandMark(content: DemoContent, options: { markClass?: string; logoClass?: string } = {}): string {
  const logo = content.brand.logo;
  if (logo) {
    const height = 44;
    const width = Math.max(24, Math.round((logo.width / Math.max(1, logo.height)) * height));
    return `<img class="${esc(options.logoClass ?? "brand-logo")}" data-qa="brand-mark" src="${esc(logo.url)}" alt="${esc(logo.alt)}" width="${width}" height="${height}">`;
  }
  return `<span class="${esc(options.markClass ?? "mark")}" data-qa="brand-mark" aria-hidden="true">${esc(content.brand.logotype)}</span>`;
}

export function heroFactChips(content: DemoContent): string {
  const business = content.business;
  const locationLine = [business.city, business.state].filter(Boolean).join(", ");
  const phone = business.phone;
  const chips = [
    phone ? `<span>${ICONS.phone}<a href="${telHref(phone.e164)}">${esc(phone.display)}</a></span>` : "",
    locationLine ? `<span>${ICONS.pin}${esc(locationLine)}</span>` : "",
    business.email ? `<span>${ICONS.mail}<a href="${mailtoHref(business.email)}">${esc(business.email)}</a></span>` : "",
  ].filter((chip) => chip !== "");
  return chips.length > 0 ? `<div class="fact-chips">${chips.join("")}</div>` : "";
}

/** Demo-only quote form: no action, CSP form-action 'none', JS interception. */
export function quoteForm(content: DemoContent): string {
  return `<form id="quote-form" novalidate>
    <div class="field">
      <label for="qf-name">Name</label>
      <input id="qf-name" name="name" type="text" autocomplete="name">
    </div>
    <div class="field">
      <label for="qf-phone">Phone</label>
      <input id="qf-phone" name="phone" type="tel" autocomplete="tel">
    </div>
    <div class="field">
      <label for="qf-details">What does your project need?</label>
      <textarea id="qf-details" name="details" rows="4"></textarea>
    </div>
    <button class="btn btn-accent" type="submit" data-qa="form-submit">${esc(content.contact.formHeadline)}</button>
    <p class="form-demo-note">${esc(content.contact.formDemoNotice)}</p>
    <p id="quote-confirmation" class="form-confirmation" role="status" hidden>Demo preview — no message was sent.</p>
  </form>`;
}

export function contactInfoRows(content: DemoContent): string {
  const business = content.business;
  const phone = business.phone;
  return [
    phone
      ? `<div class="info-row">${ICONS.phone}<div><span class="label">Call</span><a href="${telHref(phone.e164)}" data-qa="contact-phone">${esc(phone.display)}</a></div></div>`
      : "",
    business.email
      ? `<div class="info-row">${ICONS.mail}<div><span class="label">Email</span><a href="${mailtoHref(business.email)}">${esc(business.email)}</a></div></div>`
      : "",
    content.contact.addressLine
      ? `<div class="info-row">${ICONS.pin}<div><span class="label">Address</span>${esc(content.contact.addressLine)}</div></div>`
      : "",
  ].join("");
}

/** Real-photo gallery strip; below-the-fold images lazy-load with set dimensions. */
export function galleryStrip(images: DemoImage[], heading: string): string {
  if (images.length === 0) return "";
  return `<section class="gallery" data-section="gallery">
  <div class="container">
    <p class="section-kicker">Their work</p>
    <h2>${esc(heading)}</h2>
    <div class="gallery-grid">
      ${images
        .map(
          (image) =>
            `<figure><img src="${esc(image.url)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
}

export function serviceEvidenceBadge(evidence: boolean | undefined): string {
  return evidence === true ? '<span class="service-evidence">From their current site</span>' : "";
}

export function metaHead(content: DemoContent): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(content.meta.title)}</title>
<meta name="description" content="${esc(content.meta.description)}">
<link rel="icon" href="${faviconDataUri(content)}">`;
}

/** Deterministic branded tab icon: primary color + first initial, no request. */
export function faviconDataUri(content: DemoContent): string {
  const color = resolveTheme(content).primary;
  const initial = (content.brand.logotype[0] ?? "S").toUpperCase().replace(/[^A-Z0-9]/, "S");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${color}"/>` +
    `<text x="16" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#ffffff">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function footerBlock(content: DemoContent): string {
  return `<footer>
  <div class="container">
    <div class="footer-row">
      <span class="footer-brand">${brandMark(content, { markClass: "mark footer-mark", logoClass: "brand-logo footer-logo" })}<span>${esc(content.footer.line)}</span></span>
      <span>&copy; ${new Date().getUTCFullYear()} ${esc(content.business.name)}</span>
    </div>
    <p class="footer-disclosure" data-qa="demo-disclosure">${esc(content.footer.demoDisclosure)}</p>
  </div>
</footer>`;
}

export function demoIndicator(content: DemoContent): string {
  return content.indicator.enabled
    ? `<div class="demo-indicator" aria-hidden="true">${esc(content.indicator.label)}</div>`
    : "";
}

/** Form interception + mobile-nav close behavior (inline, self-contained). */
export function inlineScript(): string {
  return `<script>
(function () {
  var form = document.getElementById("quote-form");
  var confirmation = document.getElementById("quote-confirmation");
  if (form && confirmation) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      confirmation.hidden = false;
    });
  }
  var toggle = document.getElementById("nav-toggle");
  if (toggle) {
    document.querySelectorAll("nav.site-nav a").forEach(function (link) {
      link.addEventListener("click", function () { toggle.checked = false; });
    });
  }
})();
</script>`;
}

/** Shared base CSS every composition builds on (layout-neutral primitives). */
export function baseCss(): string {
  return `*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
img,svg{display:block;max-width:100%}
.container{max-width:1120px;margin:0 auto;padding:0 clamp(16px,4vw,32px)}
.skip-link{position:absolute;left:-999px;top:0;background:var(--primary);color:var(--on-primary);padding:8px 16px;z-index:60}
.skip-link:focus{left:8px;top:8px}
:where(a,button,input,textarea,summary):focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;text-decoration:none;border-radius:10px;padding:13px 24px;font-size:1rem;border:2px solid transparent;cursor:pointer;transition:transform .12s ease,background .12s ease,border-color .12s ease}
.btn:active{transform:translateY(1px)}
.btn-accent{background:var(--accent);color:var(--on-accent)}
.btn-accent:hover{background:var(--accent-deep)}
.btn-sm{padding:9px 16px;font-size:.92rem;border-radius:8px}
.brand-logo{height:44px;width:auto}
.footer-logo{height:34px;background:#ffffff;border-radius:6px;padding:3px 6px}
.fact-chips{display:flex;flex-wrap:wrap;gap:10px 22px}
.fact-chips span{display:inline-flex;align-items:center;gap:8px;font-size:.95rem}
.fact-chips a{text-decoration:none;font-weight:600;color:inherit}
.field{margin-bottom:16px}
.field label{display:block;font-weight:600;font-size:.92rem;margin-bottom:6px}
.field input,.field textarea{width:100%;border:1px solid var(--border);border-radius:10px;padding:12px 14px;font:inherit;background:var(--bg);color:var(--ink)}
.field input:focus,.field textarea:focus{border-color:var(--primary)}
.form-demo-note{margin-top:12px;font-size:.85rem;color:var(--muted)}
.form-confirmation{margin-top:14px;padding:12px 16px;border-radius:10px;background:var(--primary-soft);border:1px solid var(--border);color:var(--primary);font-weight:600}
.info-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)}
.info-row:first-of-type{border-top:0}
.info-row svg{flex:none;margin-top:4px;stroke:var(--primary)}
.info-row a{font-weight:600;text-decoration:none;word-break:break-word;color:inherit}
.info-row .label{display:block;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.service-evidence{display:inline-block;margin-top:10px;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-deep);background:var(--primary-soft);border-radius:999px;padding:4px 10px}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:30px}
.gallery-grid figure{border-radius:12px;overflow:hidden;background:var(--surface)}
.gallery-grid img{width:100%;height:240px;object-fit:cover}
footer{background:var(--primary-deep);color:rgba(255,255,255,.85);padding:44px 0 36px;font-size:.95rem}
.footer-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;justify-content:space-between}
.footer-brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:700}
.footer-mark{width:34px;height:34px;border-radius:8px;font-size:.85rem;display:grid;place-items:center;background:rgba(255,255,255,.16);color:#fff;font-weight:800}
.footer-disclosure{margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.16);font-size:.84rem;color:rgba(255,255,255,.62)}
.demo-indicator{position:fixed;left:14px;bottom:14px;z-index:50;background:rgba(20,26,34,.82);color:#fff;font-size:.78rem;font-weight:600;letter-spacing:.06em;padding:7px 13px;border-radius:999px;pointer-events:none;text-transform:uppercase}
.nav-toggle{display:none}
.nav-toggle-label{display:none;margin-left:auto;width:44px;height:44px;border:1px solid var(--border);border-radius:10px;cursor:pointer;place-items:center}`;
}

// --- 2.0.0 composition blocks (demo-content-v3) -------------------------------
// Additive only: the frozen 1.0.0 compositions above keep their exact output.

/**
 * Demo-only quote form for 2.0.0 compositions: no action attribute, CSP
 * form-action 'none', and JS interception. The "not sent" confirmation
 * appears only after a submit, instead of a standing note under the button.
 */
export function quoteFormV2(content: DemoContent, idPrefix = "qf", improveAnchor?: string): string {
  const id = (name: string) => `${idPrefix}-${name}`;
  return `<form class="quote-form" id="${id("form")}"${improveAnchor ? ` data-improve-anchor="${esc(improveAnchor)}"` : ""} novalidate>
    <div class="field">
      <label for="${id("name")}">Name</label>
      <input id="${id("name")}" name="name" type="text" autocomplete="name">
    </div>
    <div class="field">
      <label for="${id("phone")}">Phone</label>
      <input id="${id("phone")}" name="phone" type="tel" autocomplete="tel">
    </div>
    <div class="field">
      <label for="${id("details")}">How can we help?</label>
      <textarea id="${id("details")}" name="details" rows="4"></textarea>
    </div>
    <button class="btn btn-accent" type="submit" data-qa="form-submit">${esc(content.contact.formHeadline)}</button>
    <p class="form-confirmation" role="status" hidden>${esc(content.contact.formDemoNotice)}</p>
  </form>`;
}

/** Photo for a service card, when the business's site had one for it. */
export function serviceThumb(item: DemoContent["services"]["items"][number], className = "thumb"): string {
  const image = item.image;
  return image
    ? `<div class="${esc(className)}"><img src="${esc(image.url)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></div>`
    : "";
}

/** Per-card call to action that leads to the estimate form. */
export function serviceLink(item: DemoContent["services"]["items"][number]): string {
  return item.ctaLabel
    ? `<a class="service-link" href="#contact" data-improve-also="quote">${esc(item.ctaLabel)} <span aria-hidden="true">&rarr;</span></a>`
    : "";
}

/** Numbered "how it works" steps. */
export function processSteps(content: DemoContent): string {
  const process = content.process;
  if (!process || process.steps.length === 0) return "";
  return `<ol class="process-steps">
      ${process.steps
        .map(
          (step, index) => `<li class="process-step">
        <span class="step-num" aria-hidden="true">${index + 1}</span>
        <h3>${esc(step.title)}</h3>
        <p>${esc(step.description)}</p>
      </li>`,
        )
        .join("\n      ")}
    </ol>`;
}

/** Real-photo gallery for 2.0.0 compositions (customer-facing labels). */
export function galleryStripV2(images: DemoImage[]): string {
  if (images.length === 0) return "";
  return `<section class="gallery" id="gallery" data-section="gallery">
  <div class="container">
    <p class="section-kicker">Gallery</p>
    <h2>Project Gallery</h2>
    <div class="gallery-grid">
      ${images
        .map(
          (image) =>
            `<figure><img src="${esc(image.url)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;
}

/** Form interception for every .quote-form + mobile-nav close behavior. */
export function inlineScriptV2(): string {
  return `<script>
(function () {
  document.querySelectorAll("form.quote-form").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var confirmation = form.querySelector(".form-confirmation");
      if (confirmation) confirmation.hidden = false;
    });
  });
  var toggle = document.getElementById("nav-toggle");
  if (toggle) {
    document.querySelectorAll("nav.site-nav a").forEach(function (link) {
      link.addEventListener("click", function () { toggle.checked = false; });
    });
  }
})();
</script>`;
}

/** Shared CSS for the 2.0.0 blocks (compositions layer their own styling). */
/**
 * Brand showcase: the business's own logo, large, with its own slogan. Only
 * rendered when content.hero.showcase exists (newer content), so approved
 * versions without it render byte-for-byte as before.
 */
export function heroShowcase(content: DemoContent): string {
  const showcase = content.hero.showcase;
  if (!showcase) return "";
  const height = 168;
  const width = Math.max(48, Math.round((showcase.logo.width / Math.max(1, showcase.logo.height)) * height));
  return `<div class="showcase" data-qa="hero-showcase">
        <img src="${esc(showcase.logo.url)}" alt="${esc(showcase.logo.alt)}" width="${width}" height="${height}">
        ${showcase.tagline ? `<p class="tagline">${esc(showcase.tagline)}</p>` : ""}
      </div>`;
}

export function blocksCssV2(): string {
  return `.showcase{display:flex;align-items:center;gap:clamp(14px,2vw,22px);margin-bottom:22px}
.showcase img{flex:none;height:clamp(136px,13vw,168px);width:auto;max-width:60%;object-fit:contain;background:#ffffff;border-radius:20px;padding:10px;box-shadow:0 12px 32px rgba(0,0,0,.22)}
.showcase .tagline{font-weight:800;font-style:italic;font-size:clamp(1.15rem,2.2vw,1.5rem);line-height:1.2;letter-spacing:.01em;max-width:14ch}
.service-link{display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-weight:600;font-size:.95rem;color:var(--primary);text-decoration:none}
.service-link:hover{text-decoration:underline}
.thumb{overflow:hidden;background:var(--surface)}
.thumb img{width:100%;height:100%;object-fit:cover}
.process-steps{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;margin-top:40px;counter-reset:step}
.process-step{position:relative;padding:26px 24px;border:1px solid var(--border);border-radius:14px;background:var(--bg)}
.process-step .step-num{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--on-accent);font-weight:800;margin-bottom:14px}
.process-step h3{font-size:1.08rem;margin-bottom:6px}
.process-step p{color:var(--muted);font-size:.96rem}
.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,56px);align-items:center}
.about-photo{border-radius:16px;overflow:hidden}
.about-photo img{width:100%;height:100%;max-height:420px;object-fit:cover}
@media (max-width:860px){.about-grid{grid-template-columns:1fr}}`;
}

/** About section; splits into text + photo when an about photo exists. */
export function aboutSectionV2(content: DemoContent, headingClass = ""): string {
  const photo = content.imagery?.about;
  const text = `<div>
      <p class="section-kicker">About</p>
      <h2${headingClass ? ` class="${esc(headingClass)}"` : ""} data-improve-anchor="about">${esc(content.about.heading)}</h2>
      <p class="prose">${esc(content.about.body)}</p>
    </div>`;
  return `<section id="about" data-section="about">
  <div class="container${photo ? " about-grid" : ""}">
    ${text}
    ${photo ? `<figure class="about-photo"><img src="${esc(photo.url)}" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></figure>` : ""}
  </div>
</section>`;
}

// --- "What's improved" notes + before/after slider (demo-content-v3) ---------

export interface RenderOffer {
  bookingUrl?: string;
  phone?: { display: string; e164: string };
  email?: string;
}

export interface RenderOptions {
  /** The page without owner notes: used inside the comparison slider frame. */
  bare?: boolean;
  /** SaltBox's own call to action after the tour (renderer configuration). */
  offer?: RenderOffer;
}

/**
 * Owner-facing demonstration layer, in three steps:
 *
 *   1. Before/after slider: their analyzed homepage capture clipped over the
 *      LIVE redesign (same-origin frame, identical viewport). The handle
 *      wiggles once to teach dragging; after a few seconds or some dragging,
 *      a prominent "See what we changed" card leads into step 2.
 *   2. Guided tour: numbered red dots pinned to the elements that fix what
 *      SaltBox measured. The active note dims the page except its element
 *      (plus related elements, e.g. every "Get a Quote"), rings it in red,
 *      and places the note beside it rather than on top of it.
 *   3. Close: after the last note, "Want this site live?" with SaltBox's
 *      configured booking link / phone / email (or "reply to the email").
 *
 * Dismissible and re-openable; progress kept in localStorage. Everything is
 * inline and self-contained (CSP: no external requests).
 */
export function improvementsLayer(content: DemoContent, options: RenderOptions = {}): string {
  const notes = content.improvements ?? [];
  const comparison = content.comparison;
  if (options.bare || (notes.length === 0 && !comparison)) return "";
  const offer = options.offer ?? {};
  const data = {
    name: content.business.name,
    notes: notes.map((note, index) => ({
      n: index + 1,
      id: note.id,
      anchor: note.anchor,
      title: note.title,
      before: note.before,
      after: note.after,
    })),
    hasCompare: Boolean(comparison && (comparison.mobile || comparison.desktop)),
    ...(comparison?.mobile ? { mobileBefore: comparison.mobile.url } : {}),
    offer: {
      ...(offer.bookingUrl ? { bookingUrl: offer.bookingUrl } : {}),
      ...(offer.phone ? { phone: offer.phone } : {}),
      ...(offer.email ? { email: offer.email } : {}),
    },
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const views = comparison
    ? (["mobile", "desktop"] as const).filter((view) => comparison[view] !== undefined)
    : [];
  const exploreLabel = notes.length > 0 ? `See the ${notes.length} improvements` : "Explore the new site";
  const compareModal =
    comparison && views.length > 0
      ? `<div class="sb-compare" id="sb-compare" role="dialog" aria-modal="true" aria-labelledby="sb-compare-title" hidden>
  <div class="sb-compare-card">
    <button type="button" class="sb-x" data-sb="close-compare" aria-label="Close comparison">&times;</button>
    <h2 id="sb-compare-title">${esc(comparison.heading)}</h2>
    <p class="sb-compare-intro">${esc(comparison.intro)} <span>Your site as we saw it in ${esc(comparison.capturedLabel)}.</span></p>
    ${
      views.length > 1
        ? `<div class="sb-tabs" role="tablist">${views
            .map(
              (view, index) =>
                `<button type="button" role="tab" data-sb-view="${view}" aria-selected="${index === 0 ? "true" : "false"}">${view === "mobile" ? "On a phone" : "On a computer"}</button>`,
            )
            .join("")}</div>`
        : ""
    }
    ${views
      .map((view, index) => {
        const image = comparison[view]!;
        const width = view === "mobile" ? 390 : 1366;
        const height = view === "mobile" ? 844 : 900;
        return `<div class="sb-stage" data-sb-stage="${view}" data-w="${width}" data-h="${height}"${index === 0 ? "" : " hidden"}>
      <div class="sb-scale">
        <iframe class="sb-after" title="The redesign" data-src="?view=bare" width="${width}" height="${height}" scrolling="no" tabindex="-1" aria-hidden="true"></iframe>
        <div class="sb-before"><img src="${esc(image.url)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}"></div>
      </div>
      <span class="sb-tag sb-tag-before">Today</span><span class="sb-tag sb-tag-after">Redesign</span>
      <div class="sb-handle" aria-hidden="true"><span></span></div>
      <input class="sb-range" type="range" min="0" max="100" value="50" aria-label="Drag to compare your current site with the redesign">
      <div class="sb-nudge" hidden>
        <p>That's the difference at a glance.</p>
        <button type="button" class="sb-go sb-go-big" data-sb="explore">${esc(exploreLabel)} <span aria-hidden="true">&rarr;</span></button>
      </div>
    </div>`;
      })
      .join("\n    ")}
  </div>
</div>`
      : "";
  return `<style>
.sb-dot{position:absolute;z-index:72;width:30px;height:30px;border-radius:50%;background:#e5484d;color:#fff;font:700 14px/26px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 4px 14px rgba(229,72,77,.45);cursor:pointer;padding:0}
.sb-dot.sb-fixed{position:fixed}
.sb-dot::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(229,72,77,.55);animation:sb-pulse 1.8s ease-out infinite}
.sb-dot[aria-expanded="true"]{background:#b4232a;transform:scale(1.12)}
@keyframes sb-pulse{from{transform:scale(.8);opacity:1}to{transform:scale(1.5);opacity:0}}
.sb-dim{position:fixed;inset:0;width:100%;height:100%;z-index:70;pointer-events:none}
.sb-ring{position:fixed;z-index:71;pointer-events:none;border-radius:12px;border:3px solid #e5484d;box-shadow:0 0 0 4px rgba(229,72,77,.25),0 0 30px rgba(229,72,77,.45);transition:all .2s ease}
.sb-ring.sb-also{border-width:2px;border-style:dashed;box-shadow:0 0 18px rgba(229,72,77,.35)}
.sb-bubble{position:fixed;z-index:73;width:min(340px,calc(100vw - 24px));background:#fff;color:#1c2430;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:16px 18px 14px;font:15px/1.5 system-ui,sans-serif;border-top:4px solid #e5484d}
.sb-bubble h4{font-size:1.02rem;margin:0 26px 8px 0}
.sb-bubble p{margin:0 0 8px}
.sb-k{display:block;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.sb-was .sb-k{color:#b4232a}
.sb-now .sb-k{color:#1a7f47}
.sb-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:.85rem;color:#5b6472}
.sb-bubble button,.sb-bar button{font:600 14px system-ui,sans-serif;cursor:pointer;border-radius:999px}
.sb-next{background:#e5484d;color:#fff;border:0;padding:8px 16px}
.sb-x{position:absolute;top:8px;right:10px;background:none;border:0;font-size:22px;line-height:1;color:#5b6472;cursor:pointer}
.sb-bar{position:fixed;right:16px;bottom:16px;z-index:74;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:calc(100vw - 32px)}
.sb-bar button,.sb-bar a{border:0;padding:11px 16px;box-shadow:0 10px 30px rgba(16,24,40,.25);text-decoration:none;border-radius:999px;font:600 14px system-ui,sans-serif}
.sb-bar .sb-primary{background:#e5484d;color:#fff}
.sb-bar .sb-secondary{background:#fff;color:#1c2430}
.sb-compare,.sb-final{position:fixed;inset:0;z-index:80;background:rgba(10,14,20,.8);display:grid;place-items:center;padding:12px;overflow:auto}
.sb-compare[hidden],.sb-final[hidden]{display:none}
.sb-compare-card,.sb-final-card{position:relative;background:#fff;color:#1c2430;border-radius:18px;padding:22px 22px 18px;max-width:1180px;width:100%;text-align:center;font:15px/1.5 system-ui,sans-serif}
.sb-compare-card h2,.sb-final-card h2{font:800 clamp(1.15rem,2.4vw,1.6rem)/1.25 system-ui,sans-serif;text-transform:none;letter-spacing:normal;color:#1c2430;margin:0 30px 6px}
.sb-bubble h4{font-family:system-ui,sans-serif;text-transform:none;letter-spacing:normal}
.sb-bubble.sb-wide{width:min(400px,calc(100vw - 24px))}
.sb-visual{display:flex;gap:12px;justify-content:center;margin:2px 0 12px}
.sb-visual figure{margin:0;text-align:center;font:700 11px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.sb-visual figure:first-child figcaption{color:#b4232a}
.sb-visual figure:last-child figcaption{color:#1a7f47}
.sb-phone{width:128px;height:246px;border-radius:16px;overflow:hidden;border:4px solid #1c2430;position:relative;background:#fff;margin-bottom:5px}
.sb-phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.sb-phone iframe{position:absolute;top:0;left:0;width:390px;height:750px;border:0;transform:scale(.3077);transform-origin:0 0;pointer-events:none}
.sb-compare-intro{color:#5b6472;margin:0 0 12px}
.sb-compare-intro span{white-space:nowrap}
.sb-tabs{display:inline-flex;gap:4px;background:#eef0f3;border-radius:999px;padding:4px;margin-bottom:12px}
.sb-tabs button{border:0;background:none;padding:7px 14px;border-radius:999px;font:600 14px system-ui,sans-serif;cursor:pointer;color:#5b6472}
.sb-tabs button[aria-selected="true"]{background:#fff;color:#1c2430;box-shadow:0 1px 4px rgba(16,24,40,.15)}
.sb-stage{position:relative;margin:0 auto;overflow:hidden;border-radius:12px;box-shadow:0 0 0 1px #d7dbe1;background:#f5f6f8;--pos:50%}
.sb-stage[hidden]{display:none}
.sb-scale{position:absolute;top:0;left:0;transform-origin:0 0}
.sb-after{display:block;border:0;background:#fff;pointer-events:none}
.sb-before{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--pos)) 0 0);background:#fff}
.sb-before img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.sb-handle{position:absolute;top:0;bottom:0;left:var(--pos);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none}
.sb-handle span{position:absolute;top:50%;left:50%;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;background:#e5484d;border:3px solid #fff;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.sb-handle span::before{content:"\\2194";color:#fff;font:700 20px/36px system-ui,sans-serif;display:block;text-align:center}
.sb-range{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.sb-tag{position:absolute;top:10px;padding:4px 10px;border-radius:999px;font:700 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;pointer-events:none}
.sb-tag-before{left:10px;background:#1c2430;color:#fff}
.sb-tag-after{right:10px;background:#e5484d;color:#fff}
.sb-go{margin-top:14px;border:0;border-radius:999px;background:#e5484d;color:#fff;padding:14px 26px;font:700 16px system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 26px rgba(229,72,77,.4);animation:sb-breathe 2.4s ease-in-out infinite}
.sb-go:hover{background:#cf3a40}
@keyframes sb-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
.sb-nudge{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);z-index:3;width:min(360px,86%);background:rgba(255,255,255,.96);border-radius:16px;padding:16px 16px 18px;box-shadow:0 20px 50px rgba(0,0,0,.35);animation:sb-rise .35s ease-out}
.sb-nudge[hidden]{display:none}
.sb-nudge p{margin:0 0 4px;font-weight:600}
.sb-go-big{margin-top:6px;width:100%;font-size:17px;padding:15px 18px}
@keyframes sb-rise{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}
.sb-final-card{max-width:480px;padding:30px 26px 24px}
.sb-final-card .sb-lead{color:#5b6472;margin:0 0 20px}
.sb-final-card .sb-cta{display:inline-block;background:#e5484d;color:#fff;text-decoration:none;border-radius:999px;padding:15px 28px;font:700 17px system-ui,sans-serif;box-shadow:0 10px 26px rgba(229,72,77,.4)}
.sb-final-card .sb-alt{margin:14px 0 0;color:#5b6472}
.sb-final-card .sb-alt a{color:#1c2430;font-weight:700}
.sb-final-card .sb-keep{margin-top:18px;background:none;border:0;color:#5b6472;font:600 14px system-ui,sans-serif;cursor:pointer;text-decoration:underline}
.sb-final-card .sb-check{width:54px;height:54px;border-radius:50%;background:#e8f6ee;color:#1a7f47;display:grid;place-items:center;margin:0 auto 12px;font:800 26px system-ui,sans-serif}
@media (prefers-reduced-motion:reduce){.sb-dot::after,.sb-go,.sb-nudge{animation:none}.sb-ring{transition:none}}
</style>
<script type="application/json" id="sb-data">${json}</script>
${compareModal}
<div class="sb-final" id="sb-final" role="dialog" aria-modal="true" aria-labelledby="sb-final-title" hidden>
  <div class="sb-final-card">
    <button type="button" class="sb-x" data-sb="close-final" aria-label="Close">&times;</button>
    <div class="sb-check" aria-hidden="true">&#10003;</div>
    <h2 id="sb-final-title"></h2>
    <p class="sb-lead"></p>
    <div class="sb-actions"></div>
    <button type="button" class="sb-keep" data-sb="close-final">Keep exploring the site</button>
  </div>
</div>
<div class="sb-bar" id="sb-bar"></div>
<script>
(function () {
  var data;
  try { data = JSON.parse(document.getElementById("sb-data").textContent); } catch (e) { return; }
  var KEY = "saltbox-notes";
  var store = { get: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
                set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} } };
  var SVG = "http://www.w3.org/2000/svg";
  var dots = [], active = -1, bubble = null, dim = null, rings = [], frame = 0, tourDone = store.get() === "done";
  var bar = document.getElementById("sb-bar");
  var modal = document.getElementById("sb-compare");
  var finalBox = document.getElementById("sb-final");

  // ---- anchors -------------------------------------------------------------
  function visible(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function anchorFor(note) {
    var el = document.querySelector('[data-improve-anchor="' + note.anchor + '"]');
    if (!visible(el)) el = document.querySelector('[data-qa="primary-cta"]');
    return el;
  }
  function relatedFor(note, primary) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-improve-also~="' + note.id + '"]'), function (el) {
      return el !== primary && visible(el);
    });
  }
  function inHeader(el) { return !!(el && el.closest(".site-header")); }

  // ---- dots ----------------------------------------------------------------
  function placeDots() {
    var perAnchor = {};
    dots.forEach(function (dot) {
      var el = anchorFor(dot.note);
      if (!el) { dot.el.hidden = true; return; }
      var r = el.getBoundingClientRect();
      var slot = perAnchor[dot.note.anchor] = (perAnchor[dot.note.anchor] || 0) + 1;
      dot.fixed = inHeader(el);
      dot.el.classList.toggle("sb-fixed", dot.fixed);
      var x = r.left - 15 + (slot - 1) * 34, y = r.top - 15;
      if (!dot.fixed) { x += window.scrollX; y += window.scrollY; }
      dot.el.style.left = Math.max(4, x) + "px";
      dot.el.style.top = Math.max(4, y) + "px";
    });
  }
  function showDots() {
    removeDots();
    data.notes.forEach(function (note, i) {
      var el = document.createElement("button");
      el.type = "button"; el.className = "sb-dot"; el.textContent = String(note.n);
      el.setAttribute("aria-label", "Improvement " + note.n + ": " + note.title);
      el.setAttribute("aria-expanded", "false");
      el.onclick = function () { if (active === i) endNote(); else openNote(i); };
      document.body.appendChild(el);
      dots.push({ el: el, note: note, fixed: false });
    });
    placeDots();
  }
  function removeDots() { dots.forEach(function (d) { d.el.remove(); }); dots = []; }

  // ---- spotlight -----------------------------------------------------------
  function ensureDim() {
    if (dim) return;
    dim = document.createElementNS(SVG, "svg");
    dim.setAttribute("class", "sb-dim");
    dim.setAttribute("aria-hidden", "true");
    dim.innerHTML = '<defs><mask id="sb-mask"><rect width="100%" height="100%" fill="white"></rect></mask></defs>' +
      '<rect width="100%" height="100%" fill="rgba(10,14,20,0.55)" mask="url(#sb-mask)"></rect>';
    document.body.appendChild(dim);
  }
  function hole(mask, r, pad) {
    var rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", r.left - pad); rect.setAttribute("y", r.top - pad);
    rect.setAttribute("width", r.width + pad * 2); rect.setAttribute("height", r.height + pad * 2);
    rect.setAttribute("rx", 12); rect.setAttribute("fill", "black");
    mask.appendChild(rect);
  }
  function ring(r, pad, also) {
    var el = document.createElement("div");
    el.className = "sb-ring" + (also ? " sb-also" : "");
    el.style.left = (r.left - pad) + "px"; el.style.top = (r.top - pad) + "px";
    el.style.width = (r.width + pad * 2) + "px"; el.style.height = (r.height + pad * 2) + "px";
    document.body.appendChild(el);
    rings.push(el);
  }
  function drawSpotlight() {
    var note = data.notes[active]; if (!note) return;
    var primary = anchorFor(note); if (!primary) return;
    ensureDim();
    var mask = dim.querySelector("mask");
    while (mask.childNodes.length > 1) mask.removeChild(mask.lastChild);
    rings.forEach(function (el) { el.remove(); }); rings = [];
    var pr = primary.getBoundingClientRect();
    hole(mask, pr, 10); ring(pr, 10, false);
    relatedFor(note, primary).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      hole(mask, r, 6); ring(r, 6, true);
    });
    placeBubble(pr);
    placeDots();
  }
  function placeBubble(target) {
    if (!bubble) return;
    var w = bubble.offsetWidth, h = bubble.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 18;
    var clampX = function (x) { return Math.min(Math.max(12, x), vw - w - 12); };
    var clampY = function (y) { return Math.min(Math.max(12, y), vh - h - 12); };
    var spots = [
      { ok: target.right + gap + w < vw - 8, x: target.right + gap, y: clampY(target.top) },
      { ok: target.left - gap - w > 8, x: target.left - gap - w, y: clampY(target.top) },
      { ok: target.bottom + gap + h < vh - 8, x: clampX(target.left), y: target.bottom + gap },
      { ok: target.top - gap - h > 8, x: clampX(target.left), y: target.top - gap - h },
    ];
    var pick = spots.filter(function (s) { return s.ok; })[0] || { x: clampX(target.left), y: vh - h - 12 };
    bubble.style.left = pick.x + "px"; bubble.style.top = pick.y + "px";
  }
  function loop() { drawSpotlight(); frame = window.requestAnimationFrame(loop); }

  // ---- tour ----------------------------------------------------------------
  function openNote(i) {
    endNote(true);
    var note = data.notes[i]; if (!note) return;
    active = i;
    if (dots[i]) dots[i].el.setAttribute("aria-expanded", "true");
    var last = i === data.notes.length - 1;
    bubble = document.createElement("div");
    bubble.className = "sb-bubble"; bubble.setAttribute("role", "dialog");
    var showPhones = note.id === "mobile" && data.mobileBefore;
    if (showPhones) bubble.className += " sb-wide";
    bubble.innerHTML = '<button type="button" class="sb-x" aria-label="Close note">&times;</button><h4></h4>' +
      (showPhones ? '<div class="sb-visual"><figure><div class="sb-phone"><img alt="Your homepage today on a phone"></div><figcaption>Today</figcaption></figure>' +
        '<figure><div class="sb-phone"><iframe title="The redesign on a phone" tabindex="-1" aria-hidden="true" scrolling="no"></iframe></div><figcaption>Redesign</figcaption></figure></div>' : "") +
      '<p class="sb-was"><span class="sb-k">Your site today</span><span class="t1"></span></p>' +
      '<p class="sb-now"><span class="sb-k">In the redesign</span><span class="t2"></span></p>' +
      '<div class="sb-row"><span>' + (i + 1) + ' of ' + data.notes.length + '</span><button type="button" class="sb-next">' + (last ? "Finish" : "Next &rarr;") + '</button></div>';
    bubble.querySelector("h4").textContent = note.n + ". " + note.title;
    if (showPhones) {
      bubble.querySelector(".sb-phone img").src = data.mobileBefore;
      bubble.querySelector(".sb-phone iframe").src = "?view=bare";
    }
    bubble.querySelector(".t1").textContent = note.before;
    bubble.querySelector(".t2").textContent = note.after;
    bubble.querySelector(".sb-x").onclick = function () { endNote(); };
    bubble.querySelector(".sb-next").onclick = function () { if (last) finishTour(); else openNote(i + 1); };
    document.body.appendChild(bubble);
    var target = anchorFor(note);
    if (target && !inHeader(target)) target.scrollIntoView({ behavior: "smooth", block: "center" });
    cancelAnimationFrame(frame); loop();
  }
  function endNote(keepLoop) {
    cancelAnimationFrame(frame);
    if (bubble) { bubble.remove(); bubble = null; }
    rings.forEach(function (el) { el.remove(); }); rings = [];
    if (dim) { dim.remove(); dim = null; }
    if (active >= 0 && dots[active]) dots[active].el.setAttribute("aria-expanded", "false");
    active = -1;
  }
  function startTour() { showDots(); renderBar("tour"); if (data.notes.length) openNote(0); else finishTour(); }
  function finishTour() {
    endNote();
    tourDone = true; store.set("done");
    renderBar("done");
    openFinal();
  }

  // ---- final call to action -----------------------------------------------
  function openFinal() {
    var count = data.notes.length;
    finalBox.querySelector("h2").textContent = count ? "That's " + count + " improvement" + (count === 1 ? "" : "s") + "." : "That's the redesign.";
    finalBox.querySelector(".sb-lead").textContent = "Want this site live for " + data.name + "?";
    var actions = finalBox.querySelector(".sb-actions");
    actions.innerHTML = "";
    var offer = data.offer || {};
    if (offer.bookingUrl) {
      var a = document.createElement("a");
      a.className = "sb-cta"; a.href = offer.bookingUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = "Book a 15-minute call \\u2192";
      actions.appendChild(a);
    }
    var alt = [];
    if (offer.phone) alt.push({ label: (offer.bookingUrl ? "or call/text " : "Call or text "), text: offer.phone.display, href: "tel:" + offer.phone.e164 });
    if (offer.email) alt.push({ label: (offer.bookingUrl || offer.phone ? "or email " : "Email "), text: offer.email, href: "mailto:" + offer.email });
    alt.forEach(function (item) {
      var p = document.createElement("p"); p.className = "sb-alt";
      p.appendChild(document.createTextNode(item.label));
      var link = document.createElement("a"); link.href = item.href; link.textContent = item.text;
      p.appendChild(link); actions.appendChild(p);
    });
    if (!offer.bookingUrl && !offer.phone && !offer.email) {
      var reply = document.createElement("p"); reply.className = "sb-alt";
      reply.textContent = "Just reply to the email we sent you, and we'll take it from there.";
      actions.appendChild(reply);
    }
    finalBox.hidden = false;
  }
  finalBox.querySelectorAll('[data-sb="close-final"]').forEach(function (b) { b.onclick = function () { finalBox.hidden = true; }; });
  finalBox.addEventListener("click", function (event) { if (event.target === finalBox) finalBox.hidden = true; });

  // ---- floating bar --------------------------------------------------------
  function renderBar(state) {
    bar.innerHTML = "";
    function button(label, cls, fn) {
      var b = document.createElement("button"); b.type = "button"; b.className = cls; b.innerHTML = label; b.onclick = fn; bar.appendChild(b);
    }
    if (data.hasCompare) button("&harr; Compare", "sb-secondary", openCompare);
    if (state === "tour") button("Hide notes &times;", "sb-secondary", function () { endNote(); removeDots(); renderBar(tourDone ? "done" : "idle"); });
    else if (data.notes.length) button("&#9679; What's improved (" + data.notes.length + ")", tourDone ? "sb-secondary" : "sb-primary", startTour);
    if (tourDone) button("Get this site", "sb-primary", openFinal);
  }

  // ---- before/after slider -------------------------------------------------
  var nudgeTimer = 0, travel = 0, wiggled = false;
  function fit(stage) {
    var w = +stage.getAttribute("data-w"), h = +stage.getAttribute("data-h");
    var card = modal.querySelector(".sb-compare-card");
    var aw = Math.min(card.clientWidth - 44, w), ah = Math.max(260, window.innerHeight - 250);
    var s = Math.min(1, aw / w, ah / h);
    stage.style.width = Math.round(w * s) + "px"; stage.style.height = Math.round(h * s) + "px";
    var inner = stage.querySelector(".sb-scale");
    inner.style.width = w + "px"; inner.style.height = h + "px"; inner.style.transform = "scale(" + s + ")";
  }
  function setPos(stage, value) {
    stage.style.setProperty("--pos", value + "%");
    stage.querySelector(".sb-range").value = String(value);
  }
  function wiggle(stage) {
    if (wiggled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    wiggled = true;
    var keys = [50, 28, 72, 50], start = performance.now(), each = 520;
    (function step(now) {
      var t = (now - start) / each, i = Math.floor(t);
      if (i >= keys.length - 1 || travel > 0) { if (travel === 0) setPos(stage, 50); return; }
      var f = t - i, e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      setPos(stage, keys[i] + (keys[i + 1] - keys[i]) * e);
      requestAnimationFrame(step);
    })(start);
  }
  function showNudge() {
    clearTimeout(nudgeTimer);
    modal.querySelectorAll(".sb-stage:not([hidden]) .sb-nudge").forEach(function (n) { n.hidden = false; });
  }
  function showStage(view) {
    modal.querySelectorAll(".sb-stage").forEach(function (stage) {
      var on = stage.getAttribute("data-sb-stage") === view;
      stage.hidden = !on;
      if (on) {
        var frameEl = stage.querySelector("iframe");
        if (!frameEl.getAttribute("src")) frameEl.setAttribute("src", frameEl.getAttribute("data-src"));
        fit(stage);
        setTimeout(function () { wiggle(stage); }, 700);
      }
    });
    modal.querySelectorAll("[data-sb-view]").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-sb-view") === view ? "true" : "false");
    });
    if (travel >= 60) showNudge();
  }
  function openCompare() {
    if (!modal) return;
    endNote();
    finalBox.hidden = true;
    modal.hidden = false;
    var first = modal.querySelector("[data-sb-view][aria-selected='true']") || modal.querySelector("[data-sb-view]");
    showStage(first ? first.getAttribute("data-sb-view") : modal.querySelector(".sb-stage").getAttribute("data-sb-stage"));
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(showNudge, 7000);
  }
  function closeCompare(tour) {
    if (!modal) return;
    clearTimeout(nudgeTimer);
    modal.hidden = true;
    if (tour) startTour();
  }
  if (modal) {
    modal.querySelectorAll(".sb-range").forEach(function (range) {
      var stage = range.closest(".sb-stage"), last = 50;
      range.addEventListener("input", function () {
        var value = +range.value;
        travel += Math.abs(value - last); last = value;
        stage.style.setProperty("--pos", value + "%");
        if (travel >= 60) showNudge();
      });
    });
    modal.querySelectorAll("[data-sb-view]").forEach(function (tab) {
      tab.onclick = function () { showStage(tab.getAttribute("data-sb-view")); };
    });
    modal.querySelector('[data-sb="close-compare"]').onclick = function () { closeCompare(false); };
    modal.querySelectorAll('[data-sb="explore"]').forEach(function (b) { b.onclick = function () { closeCompare(true); }; });
    modal.addEventListener("click", function (event) { if (event.target === modal) closeCompare(false); });
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (modal && !modal.hidden) closeCompare(false);
    else if (!finalBox.hidden) finalBox.hidden = true;
    else if (active >= 0) endNote();
  });

  window.addEventListener("resize", function () {
    placeDots();
    if (modal && !modal.hidden) modal.querySelectorAll(".sb-stage:not([hidden])").forEach(fit);
  });
  window.addEventListener("scroll", function () { if (active < 0 && dots.some(function (d) { return d.fixed; })) placeDots(); }, { passive: true });
  window.addEventListener("load", placeDots);

  // First visit: the comparison (or the tour) starts by itself. Returning
  // visitors get the bar, with "Get this site" once they've seen the tour.
  if (tourDone) renderBar("done");
  else if (data.hasCompare) { renderBar("idle"); openCompare(); }
  else startTour();
})();
</script>`;
}

export { esc, mailtoHref, telHref };
