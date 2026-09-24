/**
 * Owner-facing "what's improved" notes (demo-content-v3).
 *
 * The demo has to make obvious WHY it beats the current site. Each note pairs
 * one thing SaltBox actually measured on the business's current homepage
 * (the deficiencies in the plan, with their numbers) with what the demo does
 * instead. Nothing is generic: no deficiency, no note. Notes are ranked by
 * how much a homeowner would feel the problem, and capped so the page never
 * turns into a wall of red dots.
 */

import type { DemoImprovement, DemoPlan, DemoSourceFacts } from "./types.ts";

const MAX_NOTES = 6;

export function buildImprovements(facts: DemoSourceFacts, plan: DemoPlan, businessName: string): DemoImprovement[] {
  const codes = new Set(plan.deficiencies.map((deficiency) => deficiency.code));
  const findings = facts.intelligence?.findings ?? {};
  const lab = record(findings.lab);
  const content = record(findings.content);
  const notes: DemoImprovement[] = [];
  const add = (note: DemoImprovement) => notes.push(note);

  if (codes.has("WEBSITE_MISSING")) {
    add({
      id: "website",
      anchor: "hero",
      title: "A website customers can find",
      // Only the listing is verified: map listings often omit a site the
      // business does have (16 of 19 checked on 2026-09-24), so never claim
      // "you have no website".
      before: `The map listing we found for ${businessName} doesn't link to a website, so customers who find you there have nowhere to click through to.`,
      after: "A complete site with your services, service area, and a clear way to request an estimate.",
      evidence: ["WEBSITE_MISSING"],
    });
  }

  if (codes.has("WEBSITE_BROKEN")) {
    const notice = typeof content?.unavailableNotice === "string" && content.unavailableNotice !== "" ? content.unavailableNotice : undefined;
    add({
      id: "website",
      anchor: "hero",
      title: "A website that works",
      before: notice
        ? `When we opened your website, it showed "${notice}", so customers who click through from Google or your listing hit a dead end.`
        : "When we tried the website address on your listing, it didn't load at all, so customers who click through hit a dead end.",
      after: "A complete site with your services, service area, and a clear way to request an estimate.",
      evidence: ["WEBSITE_BROKEN"],
    });
  }

  const mobileCodes = ["MOBILE_OVERFLOW", "MOBILE_VIEWPORT_MISSING"].filter((code) => codes.has(code));
  if (mobileCodes.length > 0) {
    add({
      id: "mobile",
      anchor: "hero",
      title: "Fits every phone screen",
      before: codes.has("MOBILE_OVERFLOW")
        ? "When we opened your current homepage on a phone, it was wider than the screen, so visitors have to scroll sideways and some of it is cut off."
        : "Your current site isn't set up for phones, so they show a shrunken desktop page.",
      after: "This layout adapts to any screen, so nothing is cut off and every button is easy to tap.",
      evidence: mobileCodes,
    });
  }

  if (codes.has("CTA_MISSING")) {
    add({
      id: "quote",
      anchor: "header-cta",
      title: "An obvious way to get a quote",
      before: "We didn't find a quote, booking, or call button on your current homepage, on desktop or on a phone.",
      after: "\"Get a Quote\" is in the header, at the top of the page, and on every service.",
      evidence: ["CTA_MISSING"],
    });
  }

  const contactCodes = ["CONTACT_FORM_MISSING", "CONTACT_PATH_MISSING"].filter((code) => codes.has(code));
  if (contactCodes.length > 0) {
    add({
      id: "contact",
      anchor: "contact-form",
      title: "Customers can reach you without calling",
      before: codes.has("CONTACT_FORM_MISSING")
        ? "We didn't find a contact form, online booking, or email link on your current site, so customers have to call."
        : "We didn't find a contact page on your current site.",
      after: "An estimate request form, so customers can send their project details whenever it suits them.",
      evidence: contactCodes,
    });
  }

  const lcpMs = number(lab?.largestContentfulPaintMs);
  const performance = number(lab?.performance);
  const speedCodes = ["SLOW_LCP", "PERFORMANCE_WEAK"].filter((code) => codes.has(code));
  if (speedCodes.length > 0) {
    const measured =
      codes.has("SLOW_LCP") && lcpMs !== undefined
        ? `In Google's Lighthouse test, which simulates a typical phone on a mobile connection, your homepage's main content took ${(lcpMs / 1000).toFixed(1)} seconds to appear. Google recommends under 2.5.`
        : performance !== undefined
          ? `Google's Lighthouse speed test, which simulates a typical phone on a mobile connection, scored your homepage ${Math.round(performance)} out of 100.`
          : "In Google's Lighthouse test on a simulated phone connection, your homepage loaded slowly.";
    add({
      id: "speed",
      anchor: "hero",
      title: "Loads fast",
      before: measured,
      after: "This page is one lightweight file with no page-builder scripts, so it shows up quickly, even on a phone.",
      evidence: speedCodes,
    });
  }

  if (codes.has("PHONE_LINK_MISSING")) {
    add({
      id: "call",
      anchor: "hero-contact",
      title: "One tap to call",
      before: "On your current site, the phone number isn't a tap-to-call link, so mobile visitors have to copy it.",
      after: "Every phone number here is one tap to call.",
      evidence: ["PHONE_LINK_MISSING"],
    });
  }

  const words = number(content?.homepageWordCount);
  const serviceCodes = ["SERVICES_CONTENT_MISSING", "THIN_CONTENT"].filter((code) => codes.has(code));
  if (serviceCodes.length > 0) {
    add({
      id: "services",
      anchor: "services",
      title: "Your services, clearly laid out",
      before: codes.has("SERVICES_CONTENT_MISSING")
        ? "We didn't find a list of your services on your current site, so customers have to guess what you offer."
        : `Your current homepage has only about ${words ?? "a few dozen"} words, not much for customers (or Google) to go on.`,
      after: "Each service gets its own card with a description and a direct way to ask about it.",
      evidence: serviceCodes,
    });
  }

  const searchCodes = ["TITLE_MISSING", "META_DESCRIPTION_MISSING", "H1_MISSING"].filter((code) => codes.has(code));
  if (searchCodes.length > 0) {
    add({
      id: "search",
      anchor: "hero",
      title: "Easier to find on Google",
      before: `Your current homepage is missing ${listJoin(searchCodes.map(searchLabel))}, which search engines use to understand and display it.`,
      after: "A clear page title, description, and heading naming your business, trade, and town.",
      evidence: searchCodes,
    });
  }

  const copyrightYear = number(content?.copyrightYear);
  if (codes.has("COPYRIGHT_STALE") && copyrightYear !== undefined) {
    add({
      id: "current",
      anchor: "footer",
      title: "Looks current",
      before: `Your current site's footer still says ©${copyrightYear}, which makes the business look inactive.`,
      after: "The footer always shows the current year.",
      evidence: ["COPYRIGHT_STALE"],
    });
  }

  if (codes.has("ABOUT_CONTENT_MISSING")) {
    add({
      id: "about",
      anchor: "about",
      title: "Customers know who they're hiring",
      before: "We didn't find an about page or section on your current site.",
      after: "An about section that introduces the business and where it works.",
      evidence: ["ABOUT_CONTENT_MISSING"],
    });
  }

  return notes.slice(0, MAX_NOTES);
}

function searchLabel(code: string): string {
  if (code === "TITLE_MISSING") return "a page title";
  if (code === "META_DESCRIPTION_MISSING") return "a search description";
  return "a main heading";
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
