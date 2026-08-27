/**
 * Phase 6 website-intelligence orchestrator: one bounded, hardened browser
 * analysis of a single business website.
 *
 * Stage failures are recorded per stage and never erase earlier successful
 * observations; only "cannot analyze at all" conditions are fatal. GET/HEAD
 * inspection only — no form submission, no mutation, no external-site crawl.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";
import { launchBrowserSession, type BrowserSession } from "./browser-session.ts";
import { extractDomSignals, type DomSignals } from "./dom-signals.ts";
import { checkLinkHealth, collectInternalLinks } from "./link-health.ts";
import { runLighthouse, type LighthouseRunner } from "./lighthouse-runner.ts";
import { selectPages, type SelectedPage } from "./page-selection.ts";
import { detectPlatform } from "./platform.ts";
import { isPathAllowed, parseRobotsTxt, permissiveRobots, type RobotsRules } from "./robots.ts";
import { resolveHomepage, type UrlSafetyOptions } from "./url-safety.ts";
import type {
  AnalyzedPage,
  ArtifactRefs,
  StageOutcome,
  WebsiteIntelligenceResult,
} from "./types.ts";
import {
  HTTP_FETCH_TIMEOUT_MS,
  INTELLIGENCE_HTTP_UA,
  MOBILE_VIEWPORT,
  DESKTOP_VIEWPORT,
  NAVIGATION_TIMEOUT_MS,
  SITE_TIME_BUDGET_MS,
  WEBSITE_INTELLIGENCE_VERSION,
} from "./version.ts";

export interface AnalyzeWebsiteOptions {
  safety?: UrlSafetyOptions;
  /** Directory for screenshots + raw Lighthouse JSON; omit to skip artifacts. */
  artifactDir?: string;
  /** Injectable for tests; null disables the Lighthouse stage entirely. */
  lighthouseRunner?: LighthouseRunner | null;
  log?: (message: string) => void;
  siteTimeBudgetMs?: number;
}

interface PageLoadTrace {
  consoleErrors: string[];
  failedRequests: Array<{ url: string; type: string; reason: string }>;
  responseCount: number;
  transferredBytes: number;
  mixedContentRequests: number;
  resourceUrls: string[];
}

export async function analyzeWebsiteIntelligence(
  websiteUrl: string | undefined | null,
  options: AnalyzeWebsiteOptions = {},
): Promise<WebsiteIntelligenceResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + (options.siteTimeBudgetMs ?? SITE_TIME_BUDGET_MS);
  const log = options.log ?? (() => {});
  const safety = options.safety ?? {};
  const lighthouseRunner = options.lighthouseRunner === undefined ? runLighthouse : options.lighthouseRunner;

  const result = emptyResult(websiteUrl ?? "", startedAt);
  const finish = (): WebsiteIntelligenceResult => {
    const completed = new Date();
    result.completedAt = completed.toISOString();
    result.durationMs = completed.getTime() - startedAt.getTime();
    return result;
  };

  if (websiteUrl === undefined || websiteUrl === null || websiteUrl.trim() === "") {
    result.fatal = { stage: "no_website", message: "NO WEBSITE TO ANALYZE" };
    return finish();
  }

  // 1. SSRF-checked redirect resolution before any browser involvement.
  const homepage = await resolveHomepage(websiteUrl, safety);
  if (!homepage.ok || !homepage.finalUrl) {
    result.fatal = {
      stage: homepage.reason?.includes("private") || homepage.reason?.includes("blocked") ? "blocked_target" : "unreachable",
      message: homepage.reason ?? "homepage unreachable",
    };
    return finish();
  }
  const finalUrl = homepage.finalUrl;
  result.finalHomepageUrl = finalUrl.toString();
  log(`homepage reachable (${homepage.httpStatus})`);

  // 2. Crawl etiquette: robots rules gate the additional automated pages.
  const robots = await fetchRobots(finalUrl, safety);
  const sitemapPresent = await probeSitemap(finalUrl, safety);

  // 3. Hardened ephemeral browser.
  let session: BrowserSession;
  try {
    session = await launchBrowserSession({ pinnedHosts: homepage.pinnedHosts, safety });
  } catch (error) {
    result.fatal = {
      stage: "browser_unavailable",
      message: `Chromium launch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    return finish();
  }

  try {
    const page = await session.newHardenedPage();
    const trace = attachTrace(page);

    // 4. Homepage (desktop).
    let homepageDom: DomSignals | null = null;
    let homepageHtml = "";
    let homepageStatus: number | null = homepage.httpStatus ?? null;
    try {
      const response = await page.goto(finalUrl.toString(), { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
      homepageStatus = response?.status() ?? homepageStatus;
      homepageDom = await page.evaluate(extractDomSignals);
      homepageHtml = await page.content();
      result.stages.homepage = { status: "ok" };
    } catch (error) {
      result.stages.homepage = { status: "failed", error: shortError(error) };
    }

    const pages: AnalyzedPage[] = [];
    const hrefsByPage: string[][] = [];
    const pageUrls: string[] = [];
    const domByRole = new Map<string, DomSignals>();

    if (homepageDom) {
      pages.push(pageRecord(finalUrl.toString(), page.url(), "homepage", "entry page", homepageStatus, homepageDom, trace));
      hrefsByPage.push(homepageDom.links);
      pageUrls.push(finalUrl.toString());
      domByRole.set("homepage", homepageDom);
    }

    // 5. Deterministic page selection.
    let selected: SelectedPage[] = [];
    if (homepageDom) {
      selected = selectPages(finalUrl.toString(), homepageDom.links, robots);
      result.stages.pageSelection = { status: "ok" };
      log(`pages selected: ${selected.length}`);
    } else {
      result.stages.pageSelection = { status: "skipped", error: "homepage DOM unavailable" };
    }

    // 6. Bounded sub-page analysis.
    const subPages = selected.filter((entry) => entry.role !== "homepage");
    let subPageFailures = 0;
    for (const target of subPages) {
      if (Date.now() > deadline) {
        result.stages.subPages = { status: "partial", error: "site time budget exhausted" };
        break;
      }
      try {
        trace.reset();
        const response = await page.goto(target.url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
        const dom = await page.evaluate(extractDomSignals);
        pages.push(pageRecord(target.url, page.url(), target.role, target.selectedBecause, response?.status() ?? null, dom, trace));
        hrefsByPage.push(dom.links);
        pageUrls.push(target.url);
        if (!domByRole.has(target.role)) domByRole.set(target.role, dom);
      } catch (error) {
        subPageFailures += 1;
        pages.push({
          url: target.url,
          finalUrl: null,
          role: target.role,
          selectedBecause: target.selectedBecause,
          httpStatus: null,
          reachable: false,
          contentHash: null,
          title: null,
          wordCount: null,
          consoleErrorCount: 0,
          failedRequestCount: 0,
        });
        void error;
      }
    }
    if (result.stages.subPages.status === "skipped") {
      result.stages.subPages =
        subPages.length === 0
          ? { status: "ok" }
          : subPageFailures === 0
            ? { status: "ok" }
            : subPageFailures < subPages.length
              ? { status: "partial", error: `${subPageFailures}/${subPages.length} pages failed` }
              : { status: "failed", error: "every selected sub-page failed" };
    }
    result.pages = pages;

    // 7. Mobile pass on the homepage.
    let mobileDom: DomSignals | null = null;
    let mobileScreenshotTaken = false;
    if (homepageDom) {
      try {
        await page.setViewport({ ...MOBILE_VIEWPORT, isMobile: true, hasTouch: true });
        trace.reset();
        await page.goto(finalUrl.toString(), { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
        mobileDom = await page.evaluate(extractDomSignals);
        result.stages.mobile = { status: "ok" };
        if (options.artifactDir) {
          mkdirSync(options.artifactDir, { recursive: true });
          await page.screenshot({ path: join(options.artifactDir, "mobile.png") as `${string}.png`, fullPage: false });
          mobileScreenshotTaken = true;
        }
      } catch (error) {
        result.stages.mobile = { status: "failed", error: shortError(error) };
      }
    } else {
      result.stages.mobile = { status: "skipped", error: "homepage unavailable" };
    }

    // 8. Desktop screenshot (after mobile pass, fresh desktop render).
    let desktopScreenshotTaken = false;
    if (homepageDom && options.artifactDir) {
      try {
        await page.setViewport({ ...DESKTOP_VIEWPORT });
        await page.goto(finalUrl.toString(), { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
        mkdirSync(options.artifactDir, { recursive: true });
        await page.screenshot({ path: join(options.artifactDir, "desktop.png") as `${string}.png`, fullPage: false });
        desktopScreenshotTaken = true;
        result.stages.screenshots = { status: mobileScreenshotTaken ? "ok" : "partial" };
      } catch (error) {
        result.stages.screenshots = {
          status: mobileScreenshotTaken ? "partial" : "failed",
          error: shortError(error),
        };
      }
    } else if (!options.artifactDir) {
      result.stages.screenshots = { status: "skipped", error: "no artifact directory configured" };
    } else {
      result.stages.screenshots = { status: "skipped", error: "homepage unavailable" };
    }

    // 9. Link health across analyzed pages.
    if (hrefsByPage.length > 0 && Date.now() < deadline) {
      try {
        const links = collectInternalLinks(pageUrls, hrefsByPage, finalUrl);
        result.links = await checkLinkHealth(links, safety);
        result.stages.linkHealth = { status: "ok" };
      } catch (error) {
        result.stages.linkHealth = { status: "failed", error: shortError(error) };
      }
    } else if (hrefsByPage.length === 0) {
      result.stages.linkHealth = { status: "skipped", error: "no analyzed pages" };
    } else {
      result.stages.linkHealth = { status: "skipped", error: "site time budget exhausted" };
    }

    // 10. Lighthouse lab run (fresh non-intercepted page; main origin pinned).
    if (lighthouseRunner && homepageDom && Date.now() < deadline) {
      log("running Lighthouse...");
      try {
        const lighthousePage: Page = await session.browser.newPage();
        const outcome = await lighthouseRunner(lighthousePage, finalUrl.toString());
        await lighthousePage.close().catch(() => {});
        if (outcome.ok) {
          result.lab = outcome.lab;
          result.stages.lighthouse = { status: "ok" };
          if (options.artifactDir) {
            mkdirSync(options.artifactDir, { recursive: true });
            writeFileSync(join(options.artifactDir, "lighthouse.json"), outcome.rawJson);
          }
        } else {
          result.stages.lighthouse = { status: "failed", error: outcome.error };
        }
      } catch (error) {
        result.stages.lighthouse = { status: "failed", error: shortError(error) };
      }
    } else if (!lighthouseRunner) {
      result.stages.lighthouse = { status: "skipped", error: "lighthouse disabled" };
    } else if (!homepageDom) {
      result.stages.lighthouse = { status: "skipped", error: "homepage unavailable" };
    } else {
      result.stages.lighthouse = { status: "skipped", error: "site time budget exhausted" };
    }

    // 11. Aggregate signals.
    if (homepageDom) {
      aggregateSignals(result, {
        homepageDom,
        mobileDom,
        homepageHtml,
        homepageTrace: trace,
        homepageStatus,
        redirectChain: homepage.redirectChain,
        https: finalUrl.protocol === "https:",
        robotsTxtPresent: robots.fetched,
        sitemapPresent,
        lastModified: homepage.lastModified ?? null,
        domByRole,
        pages,
      });
    }

    if (options.artifactDir) {
      const artifacts: ArtifactRefs = {
        directory: options.artifactDir,
        desktopScreenshot: desktopScreenshotTaken ? "desktop.png" : null,
        mobileScreenshot: mobileScreenshotTaken ? "mobile.png" : null,
        lighthouseReport: result.stages.lighthouse.status === "ok" ? "lighthouse.json" : null,
      };
      result.artifacts = artifacts;
    }

    return finish();
  } catch (error) {
    result.fatal = { stage: "internal", message: shortError(error) };
    return finish();
  } finally {
    await session.close();
  }
}

function emptyResult(websiteUrl: string, startedAt: Date): WebsiteIntelligenceResult {
  const skipped: StageOutcome = { status: "skipped" };
  return {
    analyzerVersion: WEBSITE_INTELLIGENCE_VERSION,
    websiteUrl,
    finalHomepageUrl: null,
    startedAt: startedAt.toISOString(),
    completedAt: startedAt.toISOString(),
    durationMs: 0,
    pages: [],
    stages: {
      homepage: { ...skipped },
      pageSelection: { ...skipped },
      subPages: { ...skipped },
      lighthouse: { ...skipped },
      mobile: { ...skipped },
      linkHealth: { ...skipped },
      screenshots: { ...skipped },
    },
    lab: null,
    mobile: null,
    technical: null,
    seo: null,
    conversion: null,
    content: null,
    links: null,
    assets: null,
    platform: null,
    social: null,
    artifacts: null,
  };
}

interface TraceHandle extends PageLoadTrace {
  reset(): void;
}

function attachTrace(page: Page): TraceHandle {
  const trace: TraceHandle = {
    consoleErrors: [],
    failedRequests: [],
    responseCount: 0,
    transferredBytes: 0,
    mixedContentRequests: 0,
    resourceUrls: [],
    reset() {
      this.consoleErrors = [];
      this.failedRequests = [];
      this.responseCount = 0;
      this.transferredBytes = 0;
      this.mixedContentRequests = 0;
      this.resourceUrls = [];
    },
  };

  page.on("console", (message) => {
    if (message.type() === "error" && trace.consoleErrors.length < 20) {
      trace.consoleErrors.push(message.text().slice(0, 300));
    }
  });
  page.on("pageerror", (error) => {
    if (trace.consoleErrors.length < 20) trace.consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`);
  });
  page.on("requestfailed", (request) => {
    if (trace.failedRequests.length < 30) {
      trace.failedRequests.push({
        url: request.url().slice(0, 300),
        type: request.resourceType(),
        reason: request.failure()?.errorText ?? "failed",
      });
    }
  });
  page.on("response", (response) => {
    trace.responseCount += 1;
    const length = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(length)) trace.transferredBytes += length;
    if (trace.resourceUrls.length < 200) trace.resourceUrls.push(response.url().slice(0, 300));
    if (response.status() >= 400 && trace.failedRequests.length < 30) {
      trace.failedRequests.push({
        url: response.url().slice(0, 300),
        type: response.request().resourceType(),
        reason: `HTTP ${response.status()}`,
      });
    }
    if (page.url().startsWith("https:") && response.url().startsWith("http:")) {
      trace.mixedContentRequests += 1;
    }
  });
  return trace;
}

function pageRecord(
  requestedUrl: string,
  finalUrl: string,
  role: AnalyzedPage["role"],
  selectedBecause: string,
  httpStatus: number | null,
  dom: DomSignals,
  trace: PageLoadTrace,
): AnalyzedPage {
  return {
    url: requestedUrl,
    finalUrl,
    role,
    selectedBecause,
    httpStatus,
    reachable: httpStatus !== null && httpStatus < 400,
    contentHash: createHash("sha256").update(`${finalUrl}:${dom.title ?? ""}:${dom.wordCount}`).digest("hex"),
    title: dom.title,
    wordCount: dom.wordCount,
    consoleErrorCount: trace.consoleErrors.length,
    failedRequestCount: trace.failedRequests.length,
  };
}

function aggregateSignals(
  result: WebsiteIntelligenceResult,
  input: {
    homepageDom: DomSignals;
    mobileDom: DomSignals | null;
    homepageHtml: string;
    homepageTrace: PageLoadTrace;
    homepageStatus: number | null;
    redirectChain: string[];
    https: boolean;
    robotsTxtPresent: boolean;
    sitemapPresent: boolean | null;
    lastModified: string | null;
    domByRole: Map<string, DomSignals>;
    pages: AnalyzedPage[];
  },
) {
  const { homepageDom, mobileDom, homepageTrace } = input;
  const allDoms = [...input.domByRole.values()];

  const headingOrderValid = homepageDom.headingLevels.every(
    (level, index, levels) => index === 0 || level <= (levels[index - 1] ?? 6) + 1,
  );
  result.seo = {
    titlePresent: homepageDom.title !== null,
    titleLength: homepageDom.title?.length ?? 0,
    metaDescriptionPresent: homepageDom.metaDescription !== null,
    metaDescriptionLength: homepageDom.metaDescription?.length ?? 0,
    canonicalPresent: homepageDom.canonical !== null,
    robotsMeta: homepageDom.robotsMeta,
    h1Count: homepageDom.h1Count,
    headingOrderValid,
    langPresent: homepageDom.lang !== null && homepageDom.lang.trim() !== "",
    openGraphPresent: homepageDom.openGraphPresent,
    structuredDataPresent: homepageDom.jsonLdPresent,
    schemaTypes: homepageDom.jsonLdTypes,
    indexable: !(homepageDom.robotsMeta ?? "").toLowerCase().includes("noindex"),
  };

  result.mobile = {
    viewportMetaPresent: homepageDom.viewportMeta !== null,
    horizontalOverflow: mobileDom?.horizontalOverflow ?? null,
    contentWiderThanViewport: mobileDom ? mobileDom.scrollWidth > mobileDom.clientWidth + 2 : null,
    navigationPresent: mobileDom?.navPresent ?? homepageDom.navPresent,
  };

  const failedByType = (types: string[]) =>
    homepageTrace.failedRequests.filter((request) => types.includes(request.type)).length;
  result.assets = {
    failedImages: failedByType(["image"]),
    failedStylesheets: failedByType(["stylesheet"]),
    failedScripts: failedByType(["script"]),
    otherFailed: homepageTrace.failedRequests.length - failedByType(["image", "stylesheet", "script"]),
    examples: homepageTrace.failedRequests.slice(0, 5).map((request) => `${request.url} (${request.reason})`),
  };

  result.technical = {
    https: input.https,
    httpStatus: input.homepageStatus,
    redirectChain: input.redirectChain,
    canonicalUrl: homepageDom.canonical,
    faviconPresent: homepageDom.faviconPresent,
    mixedContentRequests: homepageTrace.mixedContentRequests,
    consoleErrors: homepageTrace.consoleErrors.length,
    consoleErrorExamples: homepageTrace.consoleErrors.slice(0, 3),
    failedRequests: homepageTrace.failedRequests.length,
    failedRequestExamples: homepageTrace.failedRequests.slice(0, 3).map((request) => request.url),
    requestCount: homepageTrace.responseCount,
    transferredBytes: homepageTrace.transferredBytes,
    robotsTxtPresent: input.robotsTxtPresent,
    sitemapPresent: input.sitemapPresent,
  };

  const anyForm = allDoms.flatMap((dom) => dom.forms);
  const contactForms = anyForm.filter((form) => form.looksLikeContact);
  const ctaTexts = allDoms.flatMap((dom) => dom.ctaTexts);
  const quoteCta = ctaTexts.some((textValue) => /quote|estimate|consultation/i.test(textValue));
  const bookingCta = ctaTexts.some((textValue) => /book|schedule|appointment/i.test(textValue));
  result.conversion = {
    phoneLinkPresent: allDoms.some((dom) => dom.phoneLinks.length > 0),
    emailLinkPresent: allDoms.some((dom) => dom.emailLinks.length > 0),
    contactPagePresent: input.pages.some((pageEntry) => pageEntry.role === "contact" && pageEntry.reachable),
    contactFormPresent: contactForms.length > 0,
    formFieldCount: contactForms[0]?.fieldCount ?? 0,
    formHasSubmit: contactForms.some((form) => form.hasSubmit),
    quoteCtaPresent: quoteCta,
    bookingCtaPresent: bookingCta,
    prominentCtaPresent: homepageDom.ctaTexts.length > 0,
    visibleAddressPresent: allDoms.some((dom) => dom.addressSignal),
  };

  result.content = {
    homepageWordCount: homepageDom.wordCount,
    servicesPagePresent: input.pages.some((pageEntry) => pageEntry.role === "services" && pageEntry.reachable),
    aboutPagePresent: input.pages.some((pageEntry) => pageEntry.role === "about" && pageEntry.reachable),
    copyrightYear: homepageDom.copyrightYear,
    lastModifiedHeader: input.lastModified,
  };

  result.platform = detectPlatform({
    html: input.homepageHtml,
    generatorMeta: homepageDom.generatorMeta,
    resourceUrls: homepageTrace.resourceUrls,
  });

  const social = { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, googleMaps: null, other: [] as string[] } as NonNullable<WebsiteIntelligenceResult["social"]>;
  for (const link of allDoms.flatMap((dom) => dom.socialLinks)) {
    const lower = link.toLowerCase();
    if (lower.includes("facebook.com") && !social.facebook) social.facebook = link;
    else if (lower.includes("instagram.com") && !social.instagram) social.instagram = link;
    else if (lower.includes("linkedin.com") && !social.linkedin) social.linkedin = link;
    else if (lower.includes("youtube.com") && !social.youtube) social.youtube = link;
    else if (lower.includes("tiktok.com") && !social.tiktok) social.tiktok = link;
    else if ((lower.includes("twitter.com") || lower.includes("//x.com") || lower.startsWith("https://x.com")) && !social.x) social.x = link;
    else if ((lower.includes("maps.google.") || lower.includes("google.com/maps") || lower.includes("g.page") || lower.includes("maps.app.goo.gl")) && !social.googleMaps) social.googleMaps = link;
    else if (social.other.length < 5) social.other.push(link);
  }
  result.social = social;
}

async function fetchRobots(homepage: URL, safety: UrlSafetyOptions): Promise<RobotsRules> {
  const fetchImpl = safety.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL("/robots.txt", homepage).toString(), {
      signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
      headers: { "user-agent": INTELLIGENCE_HTTP_UA },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return permissiveRobots();
    }
    const body = (await response.text()).slice(0, 100_000);
    return parseRobotsTxt(body);
  } catch {
    return permissiveRobots();
  }
}

async function probeSitemap(homepage: URL, safety: UrlSafetyOptions): Promise<boolean | null> {
  const fetchImpl = safety.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL("/sitemap.xml", homepage).toString(), {
      method: "HEAD",
      signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
      headers: { "user-agent": INTELLIGENCE_HTTP_UA },
    });
    await response.body?.cancel();
    if (response.status === 405 || response.status === 501) return null;
    return response.status < 400;
  } catch {
    return null;
  }
}

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export { isPathAllowed };
