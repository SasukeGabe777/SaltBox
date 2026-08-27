/**
 * local-service-premium, version 1.0.0 — the image-forward composition.
 *
 * Chosen when brand intelligence found hero-grade photography: full-bleed
 * photo hero with a dark gradient overlay and a dark header, serif display
 * headings, a real-work gallery, roomy elegant spacing, and refined service
 * cards. Degrades to a deep gradient hero if the photo is ever missing —
 * the layout never breaks.
 */

import type { DemoContent } from "@saltbox/demo-generation/content-model";
import {
  ICONS,
  baseCss,
  brandMark,
  contactInfoRows,
  ctaHref,
  demoIndicator,
  esc,
  footerBlock,
  heroFactChips,
  inlineScript,
  metaHead,
  quoteForm,
  resolveTheme,
  serviceEvidenceBadge,
  telHref,
  themeCssVariables,
} from "./base.ts";

export function renderLocalServicePremiumV1(content: DemoContent): string {
  const theme = resolveTheme(content);
  const business = content.business;
  const locationLine = [business.city, business.state].filter(Boolean).join(", ");
  const eyebrow = [business.categoryLabel, locationLine].filter((part) => part !== "").join(" · ");
  const phone = business.phone;
  const hero = content.imagery?.hero;
  const gallery = content.imagery?.gallery ?? [];

  return `<!doctype html>
<html lang="en">
<head>
${metaHead(content)}
<style>
:root{${themeCssVariables(theme)}}
${baseCss()}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--primary)}
.display{font-family:"Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;letter-spacing:-.01em}

.site-header{position:sticky;top:0;z-index:40;background:rgba(10,16,24,.9);backdrop-filter:blur(10px);color:#fff;border-bottom:1px solid rgba(255,255,255,.12)}
.header-row{display:flex;align-items:center;gap:16px;min-height:72px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:#fff;font-weight:600;font-size:1.05rem;min-width:0}
.brand .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}
.mark{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--on-accent);font-weight:700;font-size:.92rem;background:var(--accent)}
.brand-logo{background:rgba(255,255,255,.95);border-radius:8px;padding:4px 8px}
nav.site-nav{margin-left:auto;display:flex;align-items:center;gap:clamp(14px,2.2vw,32px)}
nav.site-nav a{color:rgba(255,255,255,.85);text-decoration:none;font-weight:500;font-size:.93rem;letter-spacing:.04em}
nav.site-nav a:hover{color:#fff}
.nav-toggle-label{border-color:rgba(255,255,255,.3)}
.nav-toggle-label svg{stroke:#fff}
.header-phone{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:#fff;text-decoration:none}
.header-phone svg{stroke:var(--accent)}

.hero{position:relative;color:#fff;min-height:min(88vh,760px);display:flex;align-items:center;overflow:hidden;background:linear-gradient(150deg,var(--primary-deep) 0%,var(--primary) 100%)}
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero-overlay{position:absolute;inset:0;z-index:1;background:linear-gradient(100deg,rgba(8,12,18,.82) 0%,rgba(8,12,18,.55) 55%,rgba(8,12,18,.25) 100%)}
.hero-content{position:relative;z-index:2;padding:clamp(90px,14vw,150px) 0 clamp(64px,9vw,110px)}
.hero .eyebrow{display:inline-block;font-size:.82rem;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.92);border-bottom:2px solid var(--accent);padding-bottom:6px;margin-bottom:20px}
.hero h1{font-size:clamp(2.5rem,5.8vw,4.2rem);line-height:1.06;max-width:18ch;font-weight:600}
.hero .sub{margin-top:22px;font-size:clamp(1.05rem,1.6vw,1.3rem);color:rgba(255,255,255,.92);max-width:50ch}
.hero .cta-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:34px}
.btn-ghost{background:rgba(255,255,255,.06);color:#fff;border-color:rgba(255,255,255,.6);backdrop-filter:blur(4px)}
.btn-ghost:hover{border-color:#fff;background:rgba(255,255,255,.14)}
.hero .fact-chips{margin-top:42px;padding-top:22px;border-top:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.9)}
.hero .fact-chips svg{stroke:rgba(255,255,255,.85)}
.hero .fact-chips a{color:#fff}

section{padding:clamp(56px,8vw,100px) 0}
.section-kicker{font-size:.78rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:12px}
h2{font-size:clamp(1.7rem,3.2vw,2.5rem);line-height:1.18;font-weight:600}
h2.display{font-weight:600}
.section-intro{margin-top:14px;color:var(--muted);max-width:58ch}

.services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:40px}
.service-card{background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:30px 26px;transition:box-shadow .15s ease}
.service-card:hover{box-shadow:0 14px 40px rgba(16,24,40,.08)}
.service-card .icon{color:var(--accent-deep);margin-bottom:16px}
.service-card h3{font-size:1.18rem;margin-bottom:8px;font-weight:600}
.service-card p{color:var(--muted);font-size:.97rem}
.services-disclosure{margin-top:24px;font-size:.85rem;color:var(--muted);font-style:italic;max-width:70ch}

.gallery{background:var(--surface)}
.gallery-grid img{height:280px}

.trust-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:0;margin-top:40px;border-left:1px solid var(--border)}
.trust-item{padding:6px 28px 6px;border-right:1px solid var(--border)}
.trust-item h3{font-size:1.1rem;margin-bottom:8px;font-weight:600}
.trust-item p{color:var(--muted);font-size:.96rem}

.split{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(28px,5vw,64px);align-items:start}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px}
.info-card h3{font-size:1.02rem;margin-bottom:14px;font-weight:600}
.prose{margin-top:16px;color:var(--muted);max-width:62ch;font-size:1.02rem}

.contact{background:linear-gradient(180deg,var(--bg) 0%,var(--primary-soft) 100%)}
.contact-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,4vw,56px);margin-top:40px;align-items:start}
.form-card{background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:clamp(24px,3vw,38px);box-shadow:0 18px 50px rgba(16,24,40,.09)}
.form-card h3{font-size:1.3rem;margin-bottom:18px;font-weight:600}
.contact-side .info-card{margin-bottom:18px}

@media (max-width:900px){
  .split,.contact-grid{grid-template-columns:1fr}
  .header-phone{display:none}
  .trust-grid{border-left:0}
  .trust-item{border-right:0;border-top:1px solid var(--border);padding:18px 4px}
  .nav-toggle-label{display:grid}
  nav.site-nav{position:absolute;left:0;right:0;top:100%;background:rgba(10,16,24,.97);border-bottom:1px solid rgba(255,255,255,.15);flex-direction:column;align-items:stretch;padding:10px 20px 18px;gap:4px;display:none}
  nav.site-nav a{padding:12px 4px;border-bottom:1px solid rgba(255,255,255,.08)}
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
      ${brandMark(content)}
      <span class="name">${esc(business.name)}</span>
    </a>
    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true">
    <label for="nav-toggle" class="nav-toggle-label" aria-label="Toggle navigation">${ICONS.menu}</label>
    <nav class="site-nav" aria-label="Main navigation">
      <a href="#services">Services</a>
      ${gallery.length > 0 || hero ? '<a href="#gallery">Gallery</a>' : ""}
      <a href="#about">About</a>
      <a href="#contact">Contact</a>
      ${phone ? `<a class="header-phone" href="${telHref(phone.e164)}" data-qa="phone-link">${ICONS.phone}${esc(phone.display)}</a>` : ""}
      <a class="btn btn-accent btn-sm" href="${esc(ctaHref(content.hero.primaryCta.kind, content))}" data-qa="header-cta">${esc(content.hero.primaryCta.label)}</a>
    </nav>
  </div>
</header>

<main id="main">
<section class="hero" id="top" data-section="hero">
  ${hero ? `<img class="hero-photo" src="${esc(hero.url)}" alt="${esc(hero.alt)}" width="${hero.width}" height="${hero.height}" fetchpriority="high" decoding="async">` : ""}
  <div class="hero-overlay" aria-hidden="true"></div>
  <div class="container hero-content">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}
    <h1 class="display">${esc(content.hero.headline)}</h1>
    <p class="sub">${esc(content.hero.subheadline)}</p>
    <div class="cta-row">
      <a class="btn btn-accent" href="${esc(ctaHref(content.hero.primaryCta.kind, content))}" data-qa="primary-cta">${esc(content.hero.primaryCta.label)}</a>
      ${content.hero.secondaryCta ? `<a class="btn btn-ghost" href="${esc(ctaHref(content.hero.secondaryCta.kind, content))}" data-qa="secondary-cta">${esc(content.hero.secondaryCta.label)}</a>` : ""}
    </div>
    ${heroFactChips(content)}
  </div>
</section>

<section id="services" data-section="services">
  <div class="container">
    <p class="section-kicker">Services</p>
    <h2 class="display">${esc(content.services.heading)}</h2>
    <p class="section-intro">${esc(content.services.intro)}</p>
    <div class="services-grid">
      ${content.services.items
        .map(
          (item) => `<article class="service-card">
        <div class="icon">${ICONS.check}</div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.description)}</p>
        ${serviceEvidenceBadge(item.evidence)}
      </article>`,
        )
        .join("\n      ")}
    </div>
    <p class="services-disclosure">${esc(content.services.disclosure)}</p>
  </div>
</section>

${
  gallery.length > 0
    ? `<section class="gallery" id="gallery" data-section="gallery">
  <div class="container">
    <p class="section-kicker">Their work</p>
    <h2 class="display">Recent work from ${esc(business.name)}</h2>
    <div class="gallery-grid">
      ${gallery
        .map(
          (image) =>
            `<figure><img src="${esc(image.url)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>`
    : ""
}

<section data-section="trust">
  <div class="container">
    <p class="section-kicker">Why it works</p>
    <h2 class="display">${esc(content.trust.heading)}</h2>
    <div class="trust-grid">
      ${content.trust.points
        .map(
          (point) => `<div class="trust-item">
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
      <h2 class="display">${esc(content.serviceArea.heading)}</h2>
      <p class="prose">${esc(content.serviceArea.description)}</p>
    </div>
    <aside class="info-card">
      <h3>Find ${esc(business.name)}</h3>
      ${contactInfoRows(content)}
    </aside>
  </div>
</section>`
    : ""
}

<section id="about" data-section="about">
  <div class="container">
    <p class="section-kicker">About</p>
    <h2 class="display">${esc(content.about.heading)}</h2>
    <p class="prose">${esc(content.about.body)}</p>
  </div>
</section>

<section class="contact" id="contact" data-section="contact">
  <div class="container">
    <p class="section-kicker">Get in touch</p>
    <h2 class="display">${esc(content.contact.heading)}</h2>
    <p class="section-intro">${esc(content.contact.intro)}</p>
    <div class="contact-grid">
      <div class="form-card">
        <h3>${esc(content.contact.formHeadline)}</h3>
        ${quoteForm(content)}
      </div>
      <aside class="contact-side">
        <div class="info-card">
          <h3>Reach ${esc(business.name)} directly</h3>
          ${contactInfoRows(content)}
        </div>
      </aside>
    </div>
  </div>
</section>
</main>

${footerBlock(content)}
${demoIndicator(content)}
${inlineScript()}
</body>
</html>
`;
}
