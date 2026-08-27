/**
 * local-service-clean, version 1.0.0 — the typography-led composition.
 *
 * Chosen when brand extraction is weak: centered editorial hero on white,
 * generous whitespace, hairline rules, numbered service rows instead of
 * cards, and a narrow centered contact block. Renders beautifully with zero
 * brand assets; an extracted logo/palette simply refines it.
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

export function renderLocalServiceCleanV1(content: DemoContent): string {
  const theme = resolveTheme(content);
  const business = content.business;
  const locationLine = [business.city, business.state].filter(Boolean).join(", ");
  const eyebrow = [business.categoryLabel, locationLine].filter((part) => part !== "").join(" · ");
  const phone = business.phone;
  const gallery = content.imagery ? [content.imagery.hero, ...content.imagery.gallery].filter((i) => i !== undefined) : [];

  return `<!doctype html>
<html lang="en">
<head>
${metaHead(content)}
<style>
:root{${themeCssVariables(theme)}}
${baseCss()}
body{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65;-webkit-font-smoothing:antialiased;letter-spacing:.005em}
a{color:var(--primary)}

.site-header{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.97);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.header-row{display:flex;align-items:center;gap:16px;min-height:66px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);font-weight:600;font-size:1rem;min-width:0}
.brand .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.mark{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--on-primary);font-weight:700;font-size:.9rem;background:var(--primary)}
nav.site-nav{margin-left:auto;display:flex;align-items:center;gap:clamp(14px,2.4vw,34px)}
nav.site-nav a{color:var(--muted);text-decoration:none;font-weight:500;font-size:.92rem;letter-spacing:.02em}
nav.site-nav a:hover{color:var(--primary)}
nav.site-nav a.btn{color:var(--on-accent)}
.nav-toggle-label svg{stroke:var(--ink)}

.hero{padding:clamp(72px,11vw,132px) 0 clamp(56px,8vw,96px);text-align:center;border-bottom:1px solid var(--border)}
.hero .eyebrow{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:22px}
.hero h1{font-size:clamp(2.3rem,5.5vw,3.9rem);line-height:1.08;letter-spacing:-.015em;font-weight:650;max-width:20ch;margin:0 auto}
.hero .sub{margin:22px auto 0;font-size:clamp(1.05rem,1.6vw,1.22rem);color:var(--muted);max-width:54ch}
.hero .cta-row{display:flex;justify-content:center;flex-wrap:wrap;gap:14px;margin-top:34px}
.btn-outline{background:transparent;color:var(--primary);border-color:var(--primary)}
.btn-outline:hover{background:var(--primary-soft)}
.hero .fact-chips{justify-content:center;margin-top:40px;color:var(--muted)}
.hero .fact-chips svg{stroke:var(--accent-deep)}

section{padding:clamp(52px,8vw,92px) 0}
.section-kicker{font-size:.78rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:12px}
h2{font-size:clamp(1.55rem,3vw,2.15rem);line-height:1.2;letter-spacing:-.012em;font-weight:650}
.section-intro{margin-top:12px;color:var(--muted);max-width:58ch}

.service-rows{margin-top:38px;border-top:1px solid var(--border)}
.service-row{display:grid;grid-template-columns:64px 1fr 2fr;gap:clamp(14px,3vw,40px);align-items:baseline;padding:26px 0;border-bottom:1px solid var(--border)}
.service-row .num{font-size:.9rem;font-weight:700;color:var(--accent-deep);letter-spacing:.08em}
.service-row h3{font-size:1.12rem;font-weight:650}
.service-row p{color:var(--muted);font-size:.98rem}
.services-disclosure{margin-top:22px;font-size:.85rem;color:var(--muted);font-style:italic;max-width:70ch}

.trust{background:var(--surface)}
.trust-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:34px;margin-top:36px}
.trust-item{border-top:2px solid var(--primary);padding-top:18px}
.trust-item h3{font-size:1.05rem;margin-bottom:6px;font-weight:650}
.trust-item p{color:var(--muted);font-size:.96rem}

.split{display:grid;grid-template-columns:1.2fr .8fr;gap:clamp(28px,5vw,64px);align-items:start}
.info-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:26px}
.info-card h3{font-size:1rem;margin-bottom:14px;font-weight:650}
.prose{margin-top:16px;color:var(--muted);max-width:62ch}

.gallery{border-top:1px solid var(--border)}

.contact{border-top:1px solid var(--border)}
.contact-inner{max-width:760px;margin:0 auto;text-align:center}
.contact .form-card{margin-top:38px;background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:clamp(22px,3vw,36px);text-align:left;box-shadow:0 14px 40px rgba(16,24,40,.06)}
.contact-direct{margin-top:26px;display:flex;flex-wrap:wrap;justify-content:center;gap:12px 30px;color:var(--muted)}
.contact-direct a{display:inline-flex;align-items:center;gap:8px;color:var(--primary);font-weight:600;text-decoration:none}

@media (max-width:860px){
  .split{grid-template-columns:1fr}
  .service-row{grid-template-columns:44px 1fr;grid-template-rows:auto auto}
  .service-row p{grid-column:2}
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
  <div class="container">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}
    <h1>${esc(content.hero.headline)}</h1>
    <p class="sub">${esc(content.hero.subheadline)}</p>
    <div class="cta-row">
      <a class="btn btn-accent" href="${esc(ctaHref(content.hero.primaryCta.kind, content))}" data-qa="primary-cta">${esc(content.hero.primaryCta.label)}</a>
      ${content.hero.secondaryCta ? `<a class="btn btn-outline" href="${esc(ctaHref(content.hero.secondaryCta.kind, content))}" data-qa="secondary-cta">${esc(content.hero.secondaryCta.label)}</a>` : ""}
    </div>
    ${heroFactChips(content)}
  </div>
</section>

<section id="services" data-section="services">
  <div class="container">
    <p class="section-kicker">Services</p>
    <h2>${esc(content.services.heading)}</h2>
    <p class="section-intro">${esc(content.services.intro)}</p>
    <div class="service-rows">
      ${content.services.items
        .map(
          (item, index) => `<article class="service-row">
        <span class="num" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <div><h3>${esc(item.title)}</h3>${serviceEvidenceBadge(item.evidence)}</div>
        <p>${esc(item.description)}</p>
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
  <div class="container contact-inner">
    <p class="section-kicker">Get in touch</p>
    <h2>${esc(content.contact.heading)}</h2>
    <p class="section-intro" style="margin-left:auto;margin-right:auto">${esc(content.contact.intro)}</p>
    <div class="form-card">
      <h3 style="font-size:1.2rem;margin-bottom:18px">${esc(content.contact.formHeadline)}</h3>
      ${quoteForm(content)}
    </div>
    <div class="contact-direct">
      ${phone ? `<a href="${telHref(phone.e164)}" data-qa="contact-phone">${ICONS.phone}${esc(phone.display)}</a>` : ""}
      ${content.contact.addressLine ? `<span>${esc(content.contact.addressLine)}</span>` : locationLine ? `<span>${esc(locationLine)}</span>` : ""}
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
