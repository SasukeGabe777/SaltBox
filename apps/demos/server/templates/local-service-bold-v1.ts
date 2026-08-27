/**
 * local-service-bold, version 1.0.0 — the high-contrast trade composition.
 *
 * Chosen for a confident extracted brand identity (logo + palette) without
 * hero-grade photography: accent top bar, dark split hero with the quote
 * panel embedded beside a huge condensed headline, dense bordered service
 * rows, and a dark numeral trust band. The brand colors do the visual work.
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
  galleryStrip,
  heroFactChips,
  inlineScript,
  metaHead,
  quoteForm,
  resolveTheme,
  serviceEvidenceBadge,
  telHref,
  themeCssVariables,
} from "./base.ts";

export function renderLocalServiceBoldV1(content: DemoContent): string {
  const theme = resolveTheme(content);
  const business = content.business;
  const locationLine = [business.city, business.state].filter(Boolean).join(", ");
  const eyebrow = [business.categoryLabel, locationLine].filter((part) => part !== "").join(" — ");
  const phone = business.phone;
  const gallery = content.imagery ? [content.imagery.hero, ...content.imagery.gallery].filter((i) => i !== undefined) : [];

  return `<!doctype html>
<html lang="en">
<head>
${metaHead(content)}
<style>
:root{${themeCssVariables(theme)}}
${baseCss()}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--primary)}

.top-bar{background:var(--accent);color:var(--on-accent);font-size:.85rem;font-weight:700;letter-spacing:.05em;padding:7px 0}
.top-bar .container{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.top-bar a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:8px}

.site-header{position:sticky;top:0;z-index:40;background:var(--primary-deep);color:#fff}
.header-row{display:flex;align-items:center;gap:16px;min-height:74px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:#fff;font-weight:800;font-size:1.08rem;text-transform:uppercase;letter-spacing:.04em;min-width:0}
.brand .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mark{flex:none;width:42px;height:42px;border-radius:6px;display:grid;place-items:center;color:var(--on-accent);font-weight:800;font-size:1rem;background:var(--accent)}
.brand-logo{background:#ffffff;border-radius:6px;padding:4px 8px}
nav.site-nav{margin-left:auto;display:flex;align-items:center;gap:clamp(12px,2vw,26px)}
nav.site-nav a{color:rgba(255,255,255,.85);text-decoration:none;font-weight:700;font-size:.9rem;text-transform:uppercase;letter-spacing:.06em}
nav.site-nav a:hover{color:#fff}
.nav-toggle-label{border-color:rgba(255,255,255,.3)}
.nav-toggle-label svg{stroke:#fff}

.hero{background:linear-gradient(120deg,var(--primary-deep) 0%,var(--primary) 100%);color:#fff;padding:clamp(48px,7vw,84px) 0}
.hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:clamp(28px,5vw,64px);align-items:center}
.hero .eyebrow{display:inline-block;font-size:.82rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.9);margin-bottom:16px}
.hero h1{font-size:clamp(2.4rem,5.6vw,4rem);line-height:.98;letter-spacing:-.015em;font-weight:800;text-transform:uppercase;max-width:15ch}
.hero h1 .underline{display:inline-block;border-bottom:6px solid var(--accent);padding-bottom:4px}
.hero .sub{margin-top:20px;font-size:clamp(1.02rem,1.5vw,1.18rem);color:rgba(255,255,255,.88);max-width:46ch}
.hero .cta-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:28px}
.btn-ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
.btn-ghost:hover{border-color:#fff;background:rgba(255,255,255,.08)}
.hero .fact-chips{margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.85)}
.hero .fact-chips svg{stroke:rgba(255,255,255,.85)}
.hero .fact-chips a{color:#fff}
.hero-panel{background:var(--bg);color:var(--ink);border-radius:14px;padding:clamp(22px,2.5vw,30px);box-shadow:0 24px 60px rgba(0,0,0,.35)}
.hero-panel h2{font-size:1.25rem;font-weight:800;margin-bottom:14px;text-transform:uppercase;letter-spacing:.03em}

section{padding:clamp(48px,7vw,84px) 0}
.section-kicker{font-size:.78rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:10px}
h2{font-size:clamp(1.6rem,3vw,2.3rem);line-height:1.15;letter-spacing:-.01em;font-weight:800;text-transform:uppercase}
.section-intro{margin-top:12px;color:var(--muted);max-width:60ch}

.services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:34px}
.service-card{background:var(--surface);border-left:6px solid var(--accent);border-radius:0 10px 10px 0;padding:22px 22px 20px}
.service-card h3{font-size:1.05rem;font-weight:800;text-transform:uppercase;letter-spacing:.02em;margin-bottom:8px;display:flex;align-items:center;gap:10px}
.service-card h3 svg{stroke:var(--accent-deep);flex:none}
.service-card p{color:var(--muted);font-size:.95rem}
.services-disclosure{margin-top:22px;font-size:.85rem;color:var(--muted);font-style:italic;max-width:70ch}

.trust{background:var(--primary-deep);color:#fff}
.trust .section-kicker{color:var(--accent)}
.trust h2{color:#fff}
.trust-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:30px;margin-top:36px}
.trust-item .num{font-size:2.8rem;font-weight:800;color:var(--accent);line-height:1}
.trust-item h3{margin:12px 0 6px;font-size:1.05rem;font-weight:800;text-transform:uppercase}
.trust-item p{color:rgba(255,255,255,.75);font-size:.95rem}

.split{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(28px,5vw,64px);align-items:start}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}
.info-card h3{font-size:1rem;font-weight:800;text-transform:uppercase;margin-bottom:14px}
.prose{margin-top:16px;color:var(--muted);max-width:62ch}

.gallery{background:var(--surface)}

.contact{background:linear-gradient(180deg,var(--bg) 0%,var(--primary-soft) 100%)}
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,48px);margin-top:34px;align-items:start}
.contact .form-card{background:var(--bg);border-top:6px solid var(--accent);border-radius:0 0 12px 12px;padding:clamp(22px,3vw,32px);box-shadow:0 12px 34px rgba(16,24,40,.1)}
.contact .form-card h3{font-size:1.2rem;font-weight:800;text-transform:uppercase;margin-bottom:16px}
.call-block{background:var(--primary-deep);color:#fff;border-radius:12px;padding:26px;margin-bottom:18px}
.call-block .label{font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.call-block a{display:block;color:#fff;text-decoration:none;font-size:clamp(1.5rem,3vw,2rem);font-weight:800;margin-top:6px}

@media (max-width:900px){
  .hero-grid,.split,.contact-grid{grid-template-columns:1fr}
  .nav-toggle-label{display:grid}
  nav.site-nav{position:absolute;left:0;right:0;top:100%;background:var(--primary-deep);border-bottom:1px solid rgba(255,255,255,.15);flex-direction:column;align-items:stretch;padding:10px 20px 18px;gap:4px;display:none}
  nav.site-nav a{padding:12px 4px;border-bottom:1px solid rgba(255,255,255,.08)}
  nav.site-nav .btn{margin-top:10px}
  .nav-toggle:checked ~ nav.site-nav{display:flex}
}
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="top-bar">
  <div class="container">
    <span>${esc(eyebrow || business.categoryLabel)}</span>
    ${phone ? `<a href="${telHref(phone.e164)}">${ICONS.phone}${esc(phone.display)}</a>` : `<span>${esc(content.hero.primaryCta.label)} below</span>`}
  </div>
</div>
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
      <a href="#about">About</a>
      <a href="#contact">Contact</a>
      <a class="btn btn-accent btn-sm" href="${esc(ctaHref(content.hero.primaryCta.kind, content))}" data-qa="header-cta">${esc(content.hero.primaryCta.label)}</a>
    </nav>
  </div>
</header>

<main id="main">
<section class="hero" id="top" data-section="hero">
  <div class="container hero-grid">
    <div>
      ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}
      <h1><span class="underline">${esc(content.hero.headline)}</span></h1>
      <p class="sub">${esc(content.hero.subheadline)}</p>
      <div class="cta-row">
        <a class="btn btn-accent" href="${esc(ctaHref(content.hero.primaryCta.kind, content))}" data-qa="primary-cta">${esc(content.hero.primaryCta.label)}</a>
        ${content.hero.secondaryCta ? `<a class="btn btn-ghost" href="${esc(ctaHref(content.hero.secondaryCta.kind, content))}" data-qa="secondary-cta">${esc(content.hero.secondaryCta.label)}</a>` : ""}
      </div>
      ${heroFactChips(content)}
    </div>
    <aside class="hero-panel" aria-label="Request an estimate">
      <h2>${esc(content.contact.formHeadline)}</h2>
      ${quoteForm(content)}
    </aside>
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
        <h3>${ICONS.check}${esc(item.title)}</h3>
        <p>${esc(item.description)}</p>
        ${serviceEvidenceBadge(item.evidence)}
      </article>`,
        )
        .join("\n      ")}
    </div>
    <p class="services-disclosure">${esc(content.services.disclosure)}</p>
  </div>
</section>

${galleryStrip(gallery, `Work from ${business.name}`)}

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
      ${contactInfoRows(content)}
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

<section class="contact" id="contact" data-section="contact">
  <div class="container">
    <p class="section-kicker">Get in touch</p>
    <h2>${esc(content.contact.heading)}</h2>
    <p class="section-intro">${esc(content.contact.intro)}</p>
    <div class="contact-grid">
      <div class="form-card">
        <h3>${esc(content.contact.formHeadline)}</h3>
        ${quoteForm(content).replace('id="quote-form"', 'id="quote-form-secondary"').replace('id="qf-name"', 'id="qf2-name"').replace('for="qf-name"', 'for="qf2-name"').replace('id="qf-phone"', 'id="qf2-phone"').replace('for="qf-phone"', 'for="qf2-phone"').replace('id="qf-details"', 'id="qf2-details"').replace('for="qf-details"', 'for="qf2-details"').replace('id="quote-confirmation"', 'id="quote-confirmation-secondary"')}
      </div>
      <aside>
        ${phone ? `<div class="call-block"><span class="label">Prefer to talk?</span><a href="${telHref(phone.e164)}" data-qa="contact-phone">${esc(phone.display)}</a></div>` : ""}
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
<script>
(function () {
  var form = document.getElementById("quote-form-secondary");
  var confirmation = document.getElementById("quote-confirmation-secondary");
  if (form && confirmation) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      confirmation.hidden = false;
    });
  }
})();
</script>
</body>
</html>
`;
}
