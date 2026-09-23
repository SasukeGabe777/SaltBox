/**
 * Bounded deterministic brand/asset intelligence (brand-intelligence-v2):
 *
 *   resolve homepage safely -> refuse a redirect to another company's domain
 *   -> hardened Chromium visit of <= MAX_BRAND_PAGES pages (with per-image
 *   page-section context) -> pure derivation (logo ranking, palette,
 *   services) -> photo candidates downloaded, normalized, and measured in
 *   memory -> optional zero-cost local visual classification -> pure slot
 *   assignment (hero / service / gallery / about) -> only selected assets
 *   written to the local demo-asset store -> BrandProfile.
 *
 * Extraction failure is never fatal to demo generation: a site with nothing
 * usable yields an honest all-fallback profile with recorded reasons.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectAccessBlock } from "../access-block.ts";
import { launchBrowserSession } from "../browser-session.ts";
import { selectPages } from "../page-selection.ts";
import { parseRobotsTxt, permissiveRobots, type RobotsRules } from "../robots.ts";
import { resolveHomepage, type UrlSafetyOptions } from "../url-safety.ts";
import { HTTP_FETCH_TIMEOUT_MS, INTELLIGENCE_HTTP_UA, NAVIGATION_TIMEOUT_MS } from "../version.ts";
import {
  AssetRejectedError,
  extractLogoColors,
  fetchImageAsset,
  processLogoAsset,
} from "./assets.ts";
import { collectPageBrandEvidence } from "./collect.ts";
import type { ImageClassifier } from "./image-classifier.ts";
import { normalizeAndMeasurePhoto, type NormalizedPhoto } from "./image-analysis.ts";
import { selectImagery, type AnalyzedPhoto } from "./select-imagery.ts";
import {
  buildBrandPalette,
  deriveColorCandidates,
  extractServices,
  logoConfidenceFor,
  rankImageCandidates,
  rankLogoCandidates,
} from "./derive.ts";
import {
  BRAND_INTELLIGENCE_VERSION,
  BRAND_PROFILE_VERSION,
  MAX_ANALYZED_IMAGES,
  MAX_BRAND_PAGES,
  MAX_TOTAL_ASSET_BYTES,
  MIN_ICON_LOGO_DIMENSION,
  MIN_LOGO_DIMENSION,
  type BrandImage,
  type BrandLogo,
  type BrandProfile,
  type PageBrandEvidence,
} from "./types.ts";

export type BrandLog = (stage: string, detail?: Record<string, unknown>) => void;

export interface AnalyzeBrandOptions {
  /** Absolute directory that holds ALL demo-asset runs (.data/demo-assets). */
  assetRoot: string;
  /** Run directory name; generated when omitted. Must match /^[0-9]{14}-[a-z0-9-]{1,60}$/. */
  artifactRef?: string;
  businessName: string;
  category?: string | null;
  safety?: UrlSafetyOptions;
  log?: BrandLog;
  /**
   * Optional zero-cost visual classifier (local CLIP). Absent or failing, photo
   * selection uses DOM-context and pixel heuristics only and says so.
   */
  imageClassifier?: ImageClassifier;
}

/** Raw bytes fetched for photo analysis (normalized copies are far smaller). */
const MAX_ANALYSIS_FETCH_BYTES = 48 * 1024 * 1024;

/** Registrable-ish domain: last two labels, or three for short second levels (co.uk, com.au). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter((label) => label !== "");
  if (labels.length <= 2) return labels.join(".");
  const secondLevel = labels[labels.length - 2]!;
  const take = secondLevel.length <= 3 && labels[labels.length - 1]!.length <= 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Generic trade words that do not identify one business's domain. */
const GENERIC_NAME_TOKENS = new Set(["roofing", "roofers", "plumbing", "electric", "electrical", "services", "company", "supply", "home", "homes"]);

/**
 * A website that lands on a different company's domain (a dealer URL that
 * forwards to a national distributor, a parked domain, an acquirer) is not
 * this business's brand. A rebrand to a new domain that still carries the
 * business's name is allowed.
 */
export function detectForeignRedirect(
  requestedUrl: string,
  finalUrl: string,
  businessName: string,
): { requestedHost: string; finalHost: string } | null {
  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return null;
  }
  if (registrableDomain(requested.hostname) === registrableDomain(final.hostname)) return null;
  const finalLabel = registrableDomain(final.hostname).replace(/[^a-z0-9]/g, "");
  const nameTokens = businessName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !GENERIC_NAME_TOKENS.has(token));
  if (nameTokens.some((token) => finalLabel.includes(token))) return null;
  return { requestedHost: requested.hostname, finalHost: final.hostname };
}

export function newBrandArtifactRef(businessName: string, now: Date = new Date()): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${stamp}-${slug || randomUUID().slice(0, 8)}`;
}

export async function analyzeBrandIntelligence(websiteUrl: string, options: AnalyzeBrandOptions): Promise<BrandProfile> {
  const startedAt = Date.now();
  const log = options.log ?? (() => {});
  const safety = options.safety ?? {};
  const fallbacks: string[] = [];

  const base: Omit<BrandProfile, "logo" | "palette" | "imagery" | "services"> = {
    kind: "brand-intelligence",
    profileVersion: BRAND_PROFILE_VERSION,
    analyzerVersion: BRAND_INTELLIGENCE_VERSION,
    websiteUrl,
    finalUrl: null,
    collectedAt: new Date().toISOString(),
    durationMs: 0,
    pagesInspected: [],
    identity: { displayName: null, metaDescription: null },
    artifactRef: null,
    fallbacks,
    assetBytesDownloaded: 0,
  };
  const allFallback = (fatal: { stage: string; message: string; transient: boolean }): BrandProfile => ({
    ...base,
    durationMs: Date.now() - startedAt,
    logo: { status: "fallback", confidence: "none", reasons: [fatal.message], candidatesConsidered: 0 },
    palette: { status: "fallback", confidence: "none", sources: [], candidatesConsidered: 0 },
    imagery: { selected: [], consideredCount: 0, rejectedExamples: [] },
    services: { extracted: [], consideredCount: 0 },
    fatal,
  });

  log("brand-resolving", { websiteUrl });
  const homepage = await resolveHomepage(websiteUrl, safety);
  if (!homepage.ok || !homepage.finalUrl) {
    fallbacks.push(`site unreachable for brand extraction (${homepage.reason ?? "unknown"})`);
    return allFallback({
      stage: "homepage",
      message: homepage.reason ?? "homepage unreachable",
      transient: homepage.transient ?? false,
    });
  }
  base.finalUrl = homepage.finalUrl.toString();

  const foreign = detectForeignRedirect(websiteUrl, base.finalUrl, options.businessName);
  if (foreign) {
    const reason = `website redirects to a different company's domain (${foreign.requestedHost} -> ${foreign.finalHost}); none of its branding is used`;
    fallbacks.push(reason);
    log("brand-foreign-redirect", foreign);
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      identity: { displayName: null, metaDescription: null, foreignRedirect: foreign },
      logo: { status: "fallback", confidence: "none", reasons: [reason], candidatesConsidered: 0 },
      palette: { status: "fallback", confidence: "none", sources: [], candidatesConsidered: 0 },
      imagery: { selected: [], consideredCount: 0, rejectedExamples: [], rejected: [] },
      services: { extracted: [], consideredCount: 0 },
    };
  }

  // Robots gate the additional automated pages, exactly like Phase 6.
  let robots: RobotsRules = permissiveRobots();
  try {
    const robotsUrl = new URL("/robots.txt", homepage.finalUrl);
    const response = await (safety.fetchImpl ?? fetch)(robotsUrl.toString(), {
      signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
      headers: { "user-agent": INTELLIGENCE_HTTP_UA },
    });
    if (response.status === 200) robots = parseRobotsTxt(await response.text());
    else await response.body?.cancel();
  } catch {
    /* absent/unreadable robots.txt stays permissive */
  }

  const session = await launchBrowserSession({ pinnedHosts: homepage.pinnedHosts, safety });
  const pages: PageBrandEvidence[] = [];
  let accessBlocked: string | null = null;
  try {
    const visit = async (url: string, role: string) => {
      const page = await session.newHardenedPage();
      try {
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
        if (role === "homepage") {
          const wordCount = await page.evaluate(() => (document.body?.innerText ?? "").split(/\s+/).filter(Boolean).length);
          accessBlocked = detectAccessBlock({ status: response?.status() ?? null, title: await page.title(), wordCount });
          if (accessBlocked) return;
        }
        const evidence = await collectPageBrandEvidence(page, url, role);
        pages.push(evidence);
        base.pagesInspected.push({ url, role });
        log("brand-page-collected", { url, role, images: evidence.images.length, headings: evidence.headings.length });
      } finally {
        await page.close().catch(() => {});
      }
    };

    await visit(homepage.finalUrl.toString(), "homepage");
    if (accessBlocked) {
      await session.close();
      const reason = `website refused automated access (${accessBlocked}); none of its branding could be read`;
      fallbacks.push(reason);
      log("brand-access-blocked", { reason: accessBlocked });
      return {
        ...base,
        durationMs: Date.now() - startedAt,
        identity: { displayName: null, metaDescription: null, accessBlocked },
        logo: { status: "fallback", confidence: "none", reasons: [reason], candidatesConsidered: 0 },
        palette: { status: "fallback", confidence: "none", sources: [], candidatesConsidered: 0 },
        imagery: { selected: [], consideredCount: 0, rejectedExamples: [], rejected: [] },
        services: { extracted: [], consideredCount: 0 },
      };
    }
    const home = pages[0];
    if (home) {
      base.identity.displayName = home.title;
      base.identity.metaDescription = home.metaDescription;
      const selected = selectPages(homepage.finalUrl.toString(), home.internalHrefs, robots)
        .filter((page) => page.role !== "homepage")
        .slice(0, MAX_BRAND_PAGES - 1);
      for (const target of selected) {
        try {
          await visit(target.url, target.role);
        } catch (error) {
          fallbacks.push(`page ${target.url} skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } catch (error) {
    await session.close();
    fallbacks.push(`browser collection failed: ${error instanceof Error ? error.message : String(error)}`);
    return allFallback({
      stage: "browser",
      message: error instanceof Error ? error.message : String(error),
      transient: false,
    });
  }
  await session.close();

  // ---- Pure derivation ------------------------------------------------------
  const artifactRef = options.artifactRef ?? newBrandArtifactRef(options.businessName);
  const artifactDir = resolve(options.assetRoot, artifactRef);
  let bytesDownloaded = 0;
  const budgetLeft = () => MAX_TOTAL_ASSET_BYTES - bytesDownloaded;

  // Logo: try ranked candidates until one downloads and validates.
  const logoCandidates = rankLogoCandidates(pages, options.businessName);
  let logo: BrandLogo = {
    status: "fallback",
    confidence: "none",
    reasons: ["no credible logo candidate was found"],
    candidatesConsidered: logoCandidates.length,
  };
  let logoBytes: Buffer | null = null;
  for (const candidate of logoCandidates.slice(0, 4)) {
    const confidence = logoConfidenceFor(candidate);
    if (confidence === "none") break;
    try {
      const asset = await fetchImageAsset(candidate.src, safety);
      if (asset.bytes.byteLength > budgetLeft()) throw new AssetRejectedError("asset budget exhausted", "too_large");
      const minDimension = candidate.kind === "icon" ? MIN_ICON_LOGO_DIMENSION : MIN_LOGO_DIMENSION;
      const processed = await processLogoAsset(asset, artifactDir, "logo", minDimension);
      bytesDownloaded += processed.bytes;
      logo = {
        status: "selected",
        confidence,
        sourceUrl: candidate.src,
        assetFile: processed.file,
        width: processed.width,
        height: processed.height,
        kind: candidate.kind,
        reasons: candidate.reasons,
        candidatesConsidered: logoCandidates.length,
      };
      logoBytes = asset.bytes;
      log("brand-logo-selected", { src: candidate.src, confidence, score: candidate.score });
      break;
    } catch (error) {
      fallbacks.push(
        `logo candidate ${candidate.src} rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (logo.status === "fallback") {
    fallbacks.push("logo fell back to the deterministic initials logotype");
    log("brand-logo-fallback", { candidates: logoCandidates.length });
  }

  // Palette: CSS evidence plus measured logo colors.
  let logoColors: Array<{ r: number; g: number; b: number }> = [];
  if (logoBytes) {
    try {
      logoColors = await extractLogoColors(logoBytes);
    } catch {
      fallbacks.push("logo colors could not be measured");
    }
  }
  const palette = buildBrandPalette({ cssCandidates: deriveColorCandidates(pages), logoColors });
  if (palette.status === "fallback") fallbacks.push("palette fell back to the deterministic category theme");
  log("brand-palette", { status: palette.status, confidence: palette.confidence, sources: palette.sources });

  const services = extractServices(pages, options.category ?? null, options.businessName);
  log("brand-services", { extracted: services.extracted.map((service) => service.name) });

  // Photography: download, normalize, measure, and classify candidates in
  // memory, then assign slots; only winners are written to the asset store.
  const excluded = new Set<string>([...(logo.sourceUrl ? [logo.sourceUrl] : []), ...logoCandidates.map((c) => c.src)]);
  const photoCandidates = rankImageCandidates(pages, excluded);
  const rejectedExamples: string[] = [];
  const analyzed: Array<AnalyzedPhoto & { normalized: NormalizedPhoto }> = [];
  let fetchedBytes = 0;
  let classifierStatus: NonNullable<BrandProfile["imagery"]["classifier"]> = options.imageClassifier
    ? { status: "used", model: options.imageClassifier.model }
    : { status: "unavailable", detail: "no visual classifier configured; heuristics only" };
  for (const candidate of photoCandidates) {
    if (analyzed.length >= MAX_ANALYZED_IMAGES) break;
    try {
      const asset = await fetchImageAsset(candidate.src, safety);
      fetchedBytes += asset.bytes.byteLength;
      if (fetchedBytes > MAX_ANALYSIS_FETCH_BYTES) throw new AssetRejectedError("photo analysis budget exhausted", "too_large");
      const normalized = await normalizeAndMeasurePhoto(asset);
      let classification: AnalyzedPhoto["classification"];
      if (options.imageClassifier && classifierStatus.status === "used") {
        try {
          classification = await options.imageClassifier.classify(normalized.jpeg, options.category ?? null);
        } catch (error) {
          classifierStatus = {
            status: "unavailable",
            model: options.imageClassifier.model,
            detail: `classifier failed: ${error instanceof Error ? error.message : String(error)}`,
          };
          fallbacks.push(`visual classifier unavailable (${classifierStatus.detail}); photo selection used heuristics only`);
        }
      }
      analyzed.push({ candidate, visual: normalized.metrics, normalized, ...(classification ? { classification } : {}) });
    } catch (error) {
      if (rejectedExamples.length < 6) {
        rejectedExamples.push(`${candidate.src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // A classifier that failed midway leaves some photos unclassified; drop the
  // partial labels so every photo is judged by the same rules.
  if (classifierStatus.status === "unavailable") for (const photo of analyzed) delete photo.classification;

  const selection = selectImagery(analyzed, {
    category: options.category ?? null,
    services: services.extracted.map((service) => service.name),
  });
  const selectedImages: BrandImage[] = [];
  for (const assignment of selection.selected) {
    const photo = analyzed[assignment.index]!;
    if (photo.normalized.jpeg.byteLength > budgetLeft()) {
      rejectedExamples.push(`${photo.candidate.src}: asset budget exhausted`);
      continue;
    }
    const file = `image-${selectedImages.length + 1}.jpg`;
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(resolve(artifactDir, file), photo.normalized.jpeg);
    bytesDownloaded += photo.normalized.jpeg.byteLength;
    selectedImages.push({
      role: assignment.role,
      ...(assignment.serviceName !== undefined ? { serviceName: assignment.serviceName } : {}),
      sourceUrl: photo.candidate.src,
      sourcePage: photo.candidate.sourcePage,
      assetFile: file,
      width: photo.visual.width,
      height: photo.visual.height,
      alt: photo.candidate.alt,
      reasons: assignment.reasons,
      analysis: selection.analyses[assignment.index]!,
    });
  }
  const rejected = selection.rejected.slice(0, 16).map((entry) => ({
    sourceUrl: analyzed[entry.index]!.candidate.src,
    reasons: entry.reasons,
  }));
  if (selectedImages.length === 0) fallbacks.push("no usable business photography was found");
  log("brand-imagery", {
    considered: photoCandidates.length,
    analyzed: analyzed.length,
    selected: selectedImages.map((image) => (image.serviceName ? `${image.role}:${image.serviceName}` : image.role)),
    rejected: rejected.length,
    classifier: classifierStatus.status,
  });

  return {
    ...base,
    durationMs: Date.now() - startedAt,
    artifactRef: bytesDownloaded > 0 ? artifactRef : null,
    assetBytesDownloaded: bytesDownloaded,
    logo,
    palette,
    imagery: {
      selected: selectedImages,
      consideredCount: photoCandidates.length,
      rejectedExamples,
      rejected,
      classifier: classifierStatus,
    },
    services,
  };
}
