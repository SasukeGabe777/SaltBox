/**
 * Browser integration tests against deterministic local fixture sites
 * (127.0.0.1, allowPrivateNetworks). Real headless Chrome, no public
 * internet. Lighthouse is stubbed here (its own runtime is exercised by the
 * separate real-site smoke) so the normal suite stays fast and reliable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveLocalSite } from "../../prospecting/testing/fixture-server.ts";
import { analyzeWebsiteIntelligence } from "../src/analyze-website.ts";
import type { LabMetrics } from "../src/types.ts";

const CANNED_LAB: LabMetrics = {
  performance: 55,
  accessibility: 90,
  seo: 80,
  bestPractices: 75,
  firstContentfulPaintMs: 1200,
  largestContentfulPaintMs: 2400,
  totalBlockingTimeMs: 150,
  cumulativeLayoutShift: 0.02,
  speedIndexMs: 2100,
  accessibilityFailures: [{ id: "image-alt", title: "Images lack alt text" }],
};

const stubLighthouse = async () => ({ ok: true as const, lab: CANNED_LAB, rawJson: "{}" });
const failingLighthouse = async () => ({ ok: false as const, error: "lighthouse crashed (stub)" });

function richSiteHandler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? "/").split("?")[0]!;
  const html = (body: string, head = "") => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`);
  };
  if (path === "/") {
    html(
      `<nav><a href="/contact">Contact</a><a href="/services">Services</a><a href="/about">About</a><a href="/gone">Old page</a></nav>
       <h1>Wasatch Fixture Roofing</h1>
       <p>Serving Ogden since 2004. Visit us at 240 Main Street, Ogden.</p>
       <a href="tel:+18015550100">Call now</a>
       <a href="https://www.facebook.com/wasatchfixture">Facebook</a>
       <a class="cta" href="/contact">Get a Free Quote</a>
       <img src="/missing.png" alt="crew">
       <img src="/wp-content/uploads/logo.png" alt="logo">
       <script>console.error("fixture console error");</script>
       <script type="application/ld+json">{"@type":"RoofingContractor","name":"Wasatch Fixture Roofing"}</script>
       <footer>© 2021 Wasatch Fixture Roofing</footer>`,
      `<title>Wasatch Fixture Roofing</title>
       <meta name="description" content="Roof repair and replacement in Ogden.">
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <meta name="generator" content="WordPress 6.4">
       <link rel="icon" href="/favicon.ico">`,
    );
  } else if (path === "/contact") {
    html(
      `<h1>Contact us</h1>
       <form action="/submit"><input name="name"><input name="email"><textarea name="message"></textarea><button type="submit">Send</button></form>`,
      "<title>Contact</title>",
    );
  } else if (path === "/services") {
    html("<h1>Roofing services</h1><p>Shingles, metal, repairs.</p>", "<title>Services</title>");
  } else if (path === "/about") {
    html("<h1>About</h1><p>Family owned.</p>", "<title>About</title>");
  } else if (path === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("User-agent: *\nDisallow: /private/\n");
  } else if (path === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end("<urlset></urlset>");
  } else {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><head><title>404</title></head><body>gone</body></html>");
  }
}

function overflowSiteHandler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html><head></head><body><div style="width:2000px;height:50px;background:#eee">wide fixed content</div></body></html>`,
  );
}

test("rich fixture site: pages, conversion, SEO, assets, platform, robots, and console signals", { timeout: 120_000 }, async () => {
  const site = await serveLocalSite(richSiteHandler);
  try {
    const result = await analyzeWebsiteIntelligence(site.url, {
      safety: { allowPrivateNetworks: true },
      lighthouseRunner: stubLighthouse,
    });

    assert.equal(result.fatal, undefined);
    assert.equal(result.stages.homepage.status, "ok");
    // homepage + contact + services + about + "other" (/gone) = five-page cap
    assert.equal(result.pages.length, 5);
    assert.deepEqual(
      result.pages.map((page) => page.role),
      ["homepage", "contact", "services", "about", "other"],
    );
    const gone = result.pages.find((page) => page.role === "other");
    assert.equal(gone?.httpStatus, 404);
    assert.equal(gone?.reachable, false);

    assert.equal(result.seo?.titlePresent, true);
    assert.equal(result.seo?.metaDescriptionPresent, true);
    assert.equal(result.seo?.structuredDataPresent, true);
    assert.deepEqual(result.seo?.schemaTypes, ["RoofingContractor"]);

    assert.equal(result.conversion?.phoneLinkPresent, true);
    assert.equal(result.conversion?.contactPagePresent, true);
    assert.equal(result.conversion?.contactFormPresent, true);
    assert.equal(result.conversion?.formHasSubmit, true);
    assert.equal(result.conversion?.quoteCtaPresent, true);
    assert.equal(result.conversion?.visibleAddressPresent, true);

    assert.ok((result.technical?.consoleErrors ?? 0) >= 1);
    assert.ok((result.assets?.failedImages ?? 0) >= 1, "broken image must be detected");
    assert.equal(result.technical?.robotsTxtPresent, true);
    assert.equal(result.technical?.sitemapPresent, true);
    assert.equal(result.content?.copyrightYear, 2021);
    assert.equal(result.platform?.platform, "WordPress");
    assert.equal(result.social?.facebook, "https://www.facebook.com/wasatchfixture");

    assert.equal(result.stages.lighthouse.status, "ok");
    assert.equal(result.lab?.performance, 55);
    assert.equal(result.mobile?.viewportMetaPresent, true);
    assert.equal(result.mobile?.horizontalOverflow, false);
  } finally {
    await site.close();
  }
});

test("overflow fixture: missing title/meta, mobile overflow, and a Lighthouse failure stays partial", { timeout: 120_000 }, async () => {
  const site = await serveLocalSite(overflowSiteHandler);
  try {
    const result = await analyzeWebsiteIntelligence(site.url, {
      safety: { allowPrivateNetworks: true },
      lighthouseRunner: failingLighthouse,
    });

    assert.equal(result.fatal, undefined);
    assert.equal(result.stages.homepage.status, "ok");
    assert.equal(result.seo?.titlePresent, false);
    assert.equal(result.seo?.metaDescriptionPresent, false);
    assert.equal(result.mobile?.viewportMetaPresent, false);
    assert.equal(result.mobile?.horizontalOverflow, true, "fixed 2000px content must overflow the mobile viewport");

    // Analyzer-stage failure does not erase the successful DOM observations.
    assert.equal(result.stages.lighthouse.status, "failed");
    assert.match(result.stages.lighthouse.error ?? "", /lighthouse crashed/);
    assert.equal(result.lab, null);
    assert.ok(result.technical);
  } finally {
    await site.close();
  }
});
