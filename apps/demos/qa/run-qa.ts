/**
 * Automated demo QA (demo-qa-v2).
 *
 * Phase 8 shipped this as a script; Phase 10 makes it a reusable runner so the
 * operator can trigger it from the admin and the result becomes persisted
 * evidence attached to one exact DemoVersion (see @saltbox/demo-generation/qa).
 *
 * It starts the renderer in-process on an ephemeral loopback port, loads the
 * demo in headless Chromium at desktop and mobile viewports, and records the
 * checks that decide whether a demo is safe to put in front of a business
 * owner. Screenshots go to the git-ignored .data/demos/qa/<token>/ directory.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer";
import type { Database } from "@saltbox/database/client";
import { resolveDemoByLocator, type DemoResolutionMode } from "@saltbox/database/queries/demos";
import { DEMO_QA_RUNNER_VERSION, type DemoQaCheck, type DemoQaReport } from "@saltbox/demo-generation/qa";
import { createDemosServer } from "../server/app.ts";

export const QA_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface RunDemoQaOptions {
  db: Database;
  token: string;
  /** Local brand-asset root passed to the in-process renderer. */
  assetRoot?: string;
  /** Screenshot destination root; defaults to ../../.data/demos/qa. */
  artifactRoot?: string;
  mode?: DemoResolutionMode;
  log?: (line: string) => void;
}

export interface RunDemoQaResult {
  report: DemoQaReport;
  /** Lineage for the audit event, when the locator resolved. */
  prospectId?: string;
  businessId?: string;
  artifactDir: string;
}

const VIEWPORTS = [
  { name: "desktop", width: 1365, height: 900, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
] as const;

export async function runDemoQa(options: RunDemoQaOptions): Promise<RunDemoQaResult> {
  if (!QA_TOKEN_PATTERN.test(options.token)) throw new Error("Malformed demo locator token.");
  const log = options.log ?? (() => {});
  const artifactRoot = options.artifactRoot ?? resolve(process.cwd(), "../../.data/demos/qa");
  const mode: DemoResolutionMode = options.mode ?? "preview";
  const startedAt = new Date();

  const resolved = await resolveDemoByLocator(options.db, options.token, { mode });
  const lineage = resolved
    ? await options.db
        .selectFrom("demo")
        .innerJoin("prospect as p", "p.id", "demo.prospect_id")
        .select(["p.id as prospect_id", "p.business_id"])
        .where("demo.id", "=", resolved.demoId)
        .executeTakeFirst()
    : undefined;

  const checks: DemoQaCheck[] = [];
  const record = (viewport: string, name: string, passed: boolean, detail?: string) => {
    checks.push({ viewport, name, passed, ...(detail !== undefined ? { detail } : {}) });
    log(`  [${passed ? "PASS" : "FAIL"}] ${viewport} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const artifactDir = resolve(artifactRoot, options.token);
  mkdirSync(artifactDir, { recursive: true });

  const server = createDemosServer({
    db: options.db,
    mode,
    ...(options.assetRoot !== undefined ? { assetRoot: options.assetRoot } : {}),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not determine QA server port.");
  const url = `http://127.0.0.1:${address.port}/d/${options.token}`;
  log(`QA target: ${url}`);

  let errorMessage: string | undefined;
  try {
    const browser = await puppeteer.launch({ headless: true });
    try {
      for (const viewport of VIEWPORTS) {
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
        page.on("pageerror", (error: unknown) =>
          consoleErrors.push(error instanceof Error ? error.message : String(error)),
        );

        const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
        record(viewport.name, "HTTP 200", response?.status() === 200, `status ${response?.status() ?? "none"}`);

        // Scroll through the page so lazy-loaded below-fold images actually load.
        await page.evaluate(async () => {
          const step = window.innerHeight;
          for (let y = 0; y <= document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((done) => setTimeout(done, 120));
          }
          window.scrollTo(0, 0);
          await new Promise((done) => setTimeout(done, 400));
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

        record(viewport.name, "brand mark renders", await isVisible(page, '[data-qa="brand-mark"]'));
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
        log(`  saved ${screenshotPath}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    log(`  QA RUN ERROR — ${errorMessage}`);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  }

  const report: DemoQaReport = {
    runnerVersion: DEMO_QA_RUNNER_VERSION,
    demoVersionId: resolved?.version.demoVersionId ?? "",
    locatorToken: options.token,
    checks,
    artifactRef: `demos/qa/${options.token}`,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  };
  return {
    report,
    ...(lineage?.prospect_id ? { prospectId: lineage.prospect_id } : {}),
    ...(lineage?.business_id ? { businessId: lineage.business_id } : {}),
    artifactDir,
  };
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector);
}
