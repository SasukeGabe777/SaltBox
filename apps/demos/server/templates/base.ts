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

export { esc, mailtoHref, telHref };
