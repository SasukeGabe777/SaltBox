/**
 * Lightweight visual QA for a generated demo (Phase 8 acceptance checks,
 * not a visual-regression framework):
 *
 *   pnpm demo:qa --token <public-locator>
 *
 * Starts the renderer in-process on an ephemeral loopback port, loads the
 * demo in headless Chromium at desktop and mobile viewports, and verifies:
 * HTTP 200, no fatal console errors, no horizontal overflow, core sections
 * visible, a visible CTA, and a visible contact path. Screenshots are saved
 * under the git-ignored .data/demos/qa/<token>/ directory.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer, { type Page } from "puppeteer";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { createDemosServer } from "../server/app.ts";

const QA_ROOT = resolve(process.cwd(), "../../.data/demos/qa");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const { values } = parseArgs({
  options: {
    token: { type: "string", short: "t" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
if (values.help || !values.token || !TOKEN_PATTERN.test(values.token)) {
  console.error("Usage: pnpm demo:qa --token <public-locator>");
  process.exit(values.help ? 0 : 1);
}
const token = values.token;

interface CheckResult {
  name: string;
  viewport: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
const record = (viewport: string, name: string, passed: boolean, detail?: string) => {
  results.push({ name, viewport, passed, ...(detail !== undefined ? { detail } : {}) });
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${viewport} ${name}${detail ? ` — ${detail}` : ""}`);
};

const db = createDatabase({ connectionString: resolveDatabaseUrl(), maxConnections: 3 });
const server = createDemosServer({ db });
await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Could not determine QA server port.");
const url = `http://127.0.0.1:${address.port}/d/${token}`;
console.log(`\nSALTBOX DEMO QA\n${url}\n`);

const artifactDir = resolve(QA_ROOT, token);
mkdirSync(artifactDir, { recursive: true });

const browser = await puppeteer.launch({ headless: true });
try {
  for (const viewport of [
    { name: "desktop", width: 1365, height: 900, isMobile: false },
    { name: "mobile", width: 390, height: 844, isMobile: true },
  ]) {
    const page = await browser.newPage();
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      deviceScaleFactor: viewport.isMobile ? 2 : 1,
    });
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    record(viewport.name, "HTTP 200", response?.status() === 200, `status ${response?.status() ?? "none"}`);

    // Scroll through the page so lazy-loaded below-fold images actually load.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    record(viewport.name, "no horizontal overflow", overflow <= 1, `overflow ${overflow}px`);

    for (const section of ["hero", "services", "contact"]) {
      const present = await page.$(`[data-section="${section}"]`);
      record(viewport.name, `${section} section present`, present !== null);
    }
    record(viewport.name, "CTA visible", await isVisible(page, '[data-qa="primary-cta"]'));
    const contactPath =
      (await page.$('a[href^="tel:"]')) !== null || (await page.$('[data-section="contact"] form')) !== null;
    record(viewport.name, "contact path present", contactPath);

    // Phase 9: brand mark (real logo or logotype fallback) must render.
    record(viewport.name, "brand mark renders", await isVisible(page, '[data-qa="brand-mark"]'));
    // Every image (logo, hero, gallery) must actually load — no broken local assets.
    const brokenImages = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute("src") ?? "?")
        .slice(0, 4),
    );
    record(
      viewport.name,
      "all images load",
      brokenImages.length === 0,
      brokenImages.length > 0 ? brokenImages.join(" | ") : undefined,
    );
    const serviceCount = await page.evaluate(
      () => document.querySelectorAll('[data-section="services"] h3, [data-section="services"] article').length,
    );
    record(viewport.name, "services visible", serviceCount >= 1, `${serviceCount} entries`);
    record(viewport.name, "demo disclosure present", (await page.$('[data-qa="demo-disclosure"]')) !== null);
    const noindex = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    );
    record(viewport.name, "noindex directive", /noindex/.test(noindex), noindex);
    // No prospect script can ever execute: every script must be inline (no src).
    const externalScripts = await page.evaluate(() =>
      Array.from(document.scripts)
        .map((script) => script.src)
        .filter((src) => src !== ""),
    );
    record(
      viewport.name,
      "no external scripts",
      externalScripts.length === 0,
      externalScripts.length > 0 ? externalScripts.slice(0, 3).join(" | ") : undefined,
    );
    record(
      viewport.name,
      "no console errors",
      consoleErrors.length === 0,
      consoleErrors.length > 0 ? consoleErrors.slice(0, 3).join(" | ") : undefined,
    );

    const screenshotPath = resolve(artifactDir, `${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath as `${string}.png`, fullPage: true });
    console.log(`  saved ${screenshotPath}`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((resolvePromise, rejectPromise) =>
    server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
  );
  await db.destroy();
}

const failed = results.filter((result) => !result.passed);
console.log(`\nQA RESULT: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector);
}
