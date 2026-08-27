/**
 * local-service template, version 1.0.0.
 *
 * One reusable server-rendered template for local service businesses. It
 * consumes the demo-content-v1 contract only — never database rows — and
 * produces a complete, self-contained HTML document: inline CSS, a system
 * font stack, no external requests, no tracking, and a demo-only contact
 * form that never submits anywhere.
 *
 * Every dynamic value is escaped; prospect-derived text is plain text by
 * contract and treated as untrusted anyway.
 */

import type { DemoContent } from "@saltbox/demo-generation/content-model";
import { esc, mailtoHref, telHref } from "../html.ts";

interface Theme {
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  accent: string;
  accentDeep: string;
  accentInk: string;
}

const THEMES: Record<string, Theme> = {
  slate: {
    primary: "#1d3a5f",
    primaryDeep: "#142a46",
    primarySoft: "#eef3f9",
    accent: "#e8a33d",
    accentDeep: "#c98a26",
    accentInk: "#231a05",
  },
  ocean: {
    primary: "#0f4c5c",
    primaryDeep: "#0a3641",
    primarySoft: "#ecf5f7",
    accent: "#2fa7c2",
    accentDeep: "#22869c",
    accentInk: "#04191e",
  },
  ember: {
    primary: "#7c2d26",
    primaryDeep: "#571f1a",
    primarySoft: "#faf0ee",
    accent: "#e98a15",
    accentDeep: "#c67210",
    accentInk: "#201101",
  },
  meadow: {
    primary: "#2e5d3a",
    primaryDeep: "#20422a",
    primarySoft: "#eef6f0",
    accent: "#8bb944",
    accentDeep: "#719a33",
    accentInk: "#101a05",
  },
  amber: {
    primary: "#4a3f18",
    primaryDeep: "#332b0f",
    primarySoft: "#f8f5ea",
    accent: "#d9a921",
    accentDeep: "#b78c15",
    accentInk: "#1c1503",
  },
};

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" opacity="0.35"></circle><path d="m8.5 12.2 2.4 2.4 4.6-4.9"></path></svg>';
const PIN_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
const PHONE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"></path></svg>';
const MAIL_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-10 7L2 7"></path></svg>';

function ctaHref(kind: "phone" | "email" | "contact", content: DemoContent): string {
  if (kind === "phone" && content.business.phone) return telHref(content.business.phone.e164);
  if (kind === "email" && content.business.email) return mailtoHref(content.business.email);
  return "#contact";
}

export function renderLocalServiceV1(content: DemoContent): string {
  const theme = THEMES[content.brand.themeKey] ?? THEMES.slate!;
  const business = content.business;
  const locationLine = [business.city, business.state].filter(Boolean).join(", ");
  const eyebrow = [business.categoryLabel, locationLine].filter((part) => part !== "").join(" · ");
  const primaryHref = ctaHref(content.hero.primaryCta.kind, content);
  const secondary = content.hero.secondaryCta;
  const phone = business.phone;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(content.meta.title)}</title>
<meta name="description" content="${esc(content.meta.description)}">
<style>
:root{
  --primary:${theme.primary};--primary-deep:${theme.primaryDeep};--primary-soft:${theme.primarySoft};
  --accent:${theme.accent};--accent-deep:${theme.accentDeep};--accent-ink:${theme.accentInk};
  --ink:#1c2430;--muted:#5b6472;--bg:#ffffff;--surface:#f7f8fa;--border:#e4e7ec;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
img,svg{display:block;max-width:100%}
a{color:var(--primary)}
.container{max-width:1120px;margin:0 auto;padding:0 clamp(16px,4vw,32px)}
.skip-link{position:absolute;left:-999px;top:0;background:var(--primary);color:#fff;padding:8px 16px;z-index:60}
.skip-link:focus{left:8px;top:8px}
:where(a,button,input,textarea,summary):focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}

/* Header */
.site-header{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.header-row{display:flex;align-items:center;gap:16px;min-height:68px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);font-weight:700;font-size:1.05rem;min-width:0}
.brand span.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mark{flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:.95rem;letter-spacing:.5px;background:linear-gradient(135deg,var(--primary) 0%,var(--primary-deep) 100%)}
.nav-toggle{display:none}
.nav-toggle-label{display:none;margin-left:auto;width:44px;height:44px;border:1px solid var(--border);border-radius:10px;cursor:pointer;place-items:center}
.nav-toggle-label svg{stroke:var(--ink)}
nav.site-nav{margin-left:auto;display:flex;align-items:center;gap:clamp(12px,2vw,28px)}
nav.site-nav a{color:var(--ink);text-decoration:none;font-weight:500;font-size:.95rem}
nav.site-nav a:hover{color:var(--primary)}
.header-phone{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--primary);text-decoration:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 22px;font-size:1rem;border:2px solid transparent;cursor:pointer;transition:transform .12s ease,background .12s ease}
.btn:active{transform:translateY(1px)}
.btn-accent{background:var(--accent);color:var(--accent-ink)}
.btn-accent:hover{background:var(--accent-deep)}
.btn-ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
.btn-ghost:hover{border-color:#fff;background:rgba(255,255,255,.08)}
.btn-sm{padding:9px 16px;font-size:.92rem;border-radius:8px}

/* Hero */
.hero{background:radial-gradient(1100px 480px at 82% -10%,rgba(255,255,255,.14),transparent 60%),linear-gradient(140deg,var(--primary) 0%,var(--primary-deep) 78%);color:#fff;padding:clamp(56px,9vw,104px) 0 clamp(48px,7vw,88px)}
.hero .eyebrow{display:inline-block;font-size:.85rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.hero h1{font-size:clamp(2.1rem,5vw,3.4rem);line-height:1.12;letter-spacing:-.01em;max-width:17ch}
.hero .sub{margin-top:18px;font-size:clamp(1.05rem,1.6vw,1.25rem);color:rgba(255,255,255,.88);max-width:52ch}
.hero .cta-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:30px}
.hero .fact-chips{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:34px;padding-top:22px;border-top:1px solid rgba(255,255,255,.18)}
.hero .fact-chips span{display:inline-flex;align-items:center;gap:8px;color:rgba(255,255,255,.85);font-size:.95rem}
.hero .fact-chips svg{stroke:var(--accent)}
.hero .fact-chips a{color:#fff;text-decoration:none;font-weight:600}

/* Sections */
section{padding:clamp(48px,7vw,84px) 0}
.section-kicker{font-size:.8rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:10px}
h2{font-size:clamp(1.6rem,3vw,2.2rem);line-height:1.2;letter-spacing:-.01em}
.section-intro{margin-top:12px;color:var(--muted);max-width:60ch}

.services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;margin-top:36px}
.service-card{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:26px 24px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.service-card .icon{color:var(--accent-deep);margin-bottom:14px}
.service-card h3{font-size:1.1rem;margin-bottom:8px}
.service-card p{color:var(--muted);font-size:.97rem}
.services-disclosure{margin-top:22px;font-size:.86rem;color:var(--muted);font-style:italic;max-width:70ch}

.trust{background:var(--primary-soft)}
.trust-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:28px;margin-top:36px}
.trust-item .num{font-size:2rem;font-weight:800;color:var(--primary);opacity:.35;line-height:1}
.trust-item h3{margin:10px 0 6px;font-size:1.08rem}
.trust-item p{color:var(--muted);font-size:.97rem}

.split{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(28px,5vw,64px);align-items:start}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:26px}
.info-card h3{font-size:1.02rem;margin-bottom:14px}
.info-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)}
.info-row:first-of-type{border-top:0}
.info-row svg{flex:none;margin-top:4px;stroke:var(--primary)}
.info-row a{font-weight:600;text-decoration:none;word-break:break-word}
.info-row .label{display:block;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.prose{margin-top:16px;color:var(--muted);max-width:62ch}

/* Contact */
.contact{background:linear-gradient(180deg,var(--bg) 0%,var(--primary-soft) 100%)}
.contact-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,4vw,48px);margin-top:36px;align-items:start}
.form-card{background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:clamp(22px,3vw,34px);box-shadow:0 10px 30px rgba(16,24,40,.08)}
.form-card h3{font-size:1.25rem;margin-bottom:18px}
.field{margin-bottom:16px}
.field label{display:block;font-weight:600;font-size:.92rem;margin-bottom:6px}
.field input,.field textarea{width:100%;border:1px solid var(--border);border-radius:10px;padding:12px 14px;font:inherit;background:var(--bg);color:var(--ink)}
.field input:focus,.field textarea:focus{border-color:var(--primary)}
.form-demo-note{margin-top:12px;font-size:.85rem;color:var(--muted)}
.form-confirmation{margin-top:14px;padding:12px 16px;border-radius:10px;background:var(--primary-soft);border:1px solid var(--border);color:var(--primary);font-weight:600}
.contact-side .btn{width:100%}

/* Footer */
footer{background:var(--primary-deep);color:rgba(255,255,255,.82);padding:44px 0 36px;font-size:.95rem}
.footer-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;justify-content:space-between}
.footer-brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:700}
.footer-brand .mark{width:34px;height:34px;border-radius:8px;font-size:.85rem;background:rgba(255,255,255,.14)}
.footer-disclosure{margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.16);font-size:.84rem;color:rgba(255,255,255,.6)}

/* Demo indicator */
.demo-indicator{position:fixed;left:14px;bottom:14px;z-index:50;background:rgba(20,26,34,.82);color:#fff;font-size:.78rem;font-weight:600;letter-spacing:.06em;padding:7px 13px;border-radius:999px;pointer-events:none;text-transform:uppercase}

@media (max-width:860px){
  .split,.contact-grid{grid-template-columns:1fr}
  .header-phone{display:none}
  .nav-toggle-label{display:grid}
  nav.site-nav{position:absolute;left:0;right:0;top:100%;background:var(--bg);border-bottom:1px solid var(--border);flex-direction:column;align-items:stretch;padding:10px 20px 18px;gap:4px;display:none}
  nav.site-nav a{padding:12px 4px;border-bottom:1px solid var(--surface)}
  nav.site-nav .btn{margin-top:10px}
  .nav-toggle:checked ~ nav.site-nav{display:flex}
}
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container header-row">
    <a class="brand" href="#top" aria-label="${esc(business.name)} home">
      <span class="mark" aria-hidden="true">${esc(content.brand.logotype)}</span>
      <span class="name">${esc(business.name)}</span>
    </a>
    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true">
    <label for="nav-toggle" class="nav-toggle-label" aria-label="Toggle navigation">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
    </label>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="#services">Services</a>
      <a href="#about">About</a>
      <a href="#contact">Contact</a>
      ${phone ? `<a class="header-phone" href="${telHref(phone.e164)}" data-qa="phone-link">${PHONE_ICON}${esc(phone.display)}</a>` : ""}
      <a class="btn btn-accent btn-sm" href="${esc(primaryHref)}" data-qa="header-cta">${esc(content.hero.primaryCta.label)}</a>
    </nav>
  </div>
</header>

<main id="main">
<section class="hero" id="top" data-section="hero">
  <div class="container">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}
    <h1>${esc(content.hero.headline)}</h1>
    <p class="sub">${esc(content.hero.subheadline)}</p>
    <div class="cta-row">
      <a class="btn btn-accent" href="${esc(primaryHref)}" data-qa="primary-cta">${esc(content.hero.primaryCta.label)}</a>
      ${secondary ? `<a class="btn btn-ghost" href="${esc(ctaHref(secondary.kind, content))}" data-qa="secondary-cta">${esc(secondary.label)}</a>` : ""}
    </div>
    <div class="fact-chips">
      ${phone ? `<span>${PHONE_ICON}<a href="${telHref(phone.e164)}">${esc(phone.display)}</a></span>` : ""}
      ${locationLine ? `<span>${PIN_ICON}${esc(locationLine)}</span>` : ""}
      ${business.email ? `<span>${MAIL_ICON}<a href="${mailtoHref(business.email)}">${esc(business.email)}</a></span>` : ""}
    </div>
  </div>
</section>

<section id="services" data-section="services">
  <div class="container">
    <p class="section-kicker">Services</p>
    <h2>${esc(content.services.heading)}</h2>
    <p class="section-intro">${esc(content.services.intro)}</p>
    <div class="services-grid">
      ${content.services.items
        .map(
          (item) => `<article class="service-card">
        <div class="icon">${CHECK_ICON}</div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.description)}</p>
      </article>`,
        )
        .join("\n      ")}
    </div>
    <p class="services-disclosure">${esc(content.services.disclosure)}</p>
  </div>
</section>

<section class="trust" data-section="trust">
  <div class="container">
    <p class="section-kicker">Why it works</p>
    <h2>${esc(content.trust.heading)}</h2>
    <div class="trust-grid">
      ${content.trust.points
        .map(
          (point, index) => `<div class="trust-item">
        <div class="num" aria-hidden="true">0${index + 1}</div>
        <h3>${esc(point.title)}</h3>
        <p>${esc(point.description)}</p>
      </div>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>

${
  content.serviceArea
    ? `<section id="service-area" data-section="service-area">
  <div class="container split">
    <div>
      <p class="section-kicker">Where we work</p>
      <h2>${esc(content.serviceArea.heading)}</h2>
      <p class="prose">${esc(content.serviceArea.description)}</p>
    </div>
    <aside class="info-card">
      <h3>Find ${esc(business.name)}</h3>
      ${locationLine ? `<div class="info-row">${PIN_ICON}<div><span class="label">Location</span>${esc(content.contact.addressLine ?? locationLine)}</div></div>` : ""}
      ${phone ? `<div class="info-row">${PHONE_ICON}<div><span class="label">Phone</span><a href="${telHref(phone.e164)}">${esc(phone.display)}</a></div></div>` : ""}
    </aside>
  </div>
</section>`
    : ""
}

<section id="about" data-section="about">
  <div class="container">
    <p class="section-kicker">About</p>
    <h2>${esc(content.about.heading)}</h2>
    <p class="prose">${esc(content.about.body)}</p>
  </div>
</section>

${
  content.testimonials
    ? `<section data-section="testimonials">
  <div class="container">
    <p class="section-kicker">Feedback</p>
    <h2>${esc(content.testimonials.heading)}</h2>
    <div class="trust-grid">
      ${content.testimonials.items
        .map(
          (item) => `<figure class="service-card"><blockquote>${esc(item.quote)}</blockquote><figcaption>${esc(item.attribution)}</figcaption></figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}

<section class="contact" id="contact" data-section="contact">
  <div class="container">
    <p class="section-kicker">Get in touch</p>
    <h2>${esc(content.contact.heading)}</h2>
    <p class="section-intro">${esc(content.contact.intro)}</p>
    <div class="contact-grid">
      <div class="form-card">
        <h3>${esc(content.contact.formHeadline)}</h3>
        <form id="quote-form" novalidate>
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
        </form>
      </div>
      <aside class="contact-side">
        <div class="info-card">
          <h3>Reach ${esc(business.name)} directly</h3>
          ${phone ? `<div class="info-row">${PHONE_ICON}<div><span class="label">Call</span><a href="${telHref(phone.e164)}" data-qa="contact-phone">${esc(phone.display)}</a></div></div>` : ""}
          ${business.email ? `<div class="info-row">${MAIL_ICON}<div><span class="label">Email</span><a href="${mailtoHref(business.email)}">${esc(business.email)}</a></div></div>` : ""}
          ${content.contact.addressLine ? `<div class="info-row">${PIN_ICON}<div><span class="label">Address</span>${esc(content.contact.addressLine)}</div></div>` : ""}
        </div>
      </aside>
    </div>
  </div>
</section>
</main>

<footer>
  <div class="container">
    <div class="footer-row">
      <span class="footer-brand"><span class="mark" aria-hidden="true">${esc(content.brand.logotype)}</span>${esc(content.footer.line)}</span>
      <span>&copy; ${new Date().getUTCFullYear()} ${esc(business.name)}</span>
    </div>
    <p class="footer-disclosure">${esc(content.footer.demoDisclosure)}</p>
  </div>
</footer>

${content.indicator.enabled ? `<div class="demo-indicator" aria-hidden="true">${esc(content.indicator.label)}</div>` : ""}

<script>
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
</script>
</body>
</html>
`;
}
