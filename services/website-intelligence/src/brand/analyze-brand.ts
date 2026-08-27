/**
 * Bounded deterministic brand/asset intelligence (brand-intelligence-v1):
 *
 *   resolve homepage safely -> hardened Chromium visit of <= MAX_BRAND_PAGES
 *   pages -> pure derivation (logo ranking, palette, photos, services) ->
 *   safe asset download/normalization into the local demo-asset store ->
 *   BrandProfile.
 *
 * Extraction failure is never fatal to demo generation: a site with nothing
 * usable yields an honest all-fallback profile with recorded reasons.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
  processPhotoAsset,
} from "./assets.ts";
import { collectPageBrandEvidence } from "./collect.ts";
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
  MAX_BRAND_PAGES,
  MAX_SELECTED_IMAGES,
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
  try {
    const visit = async (url: string, role: string) => {
      const page = await session.newHardenedPage();
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
        const evidence = await collectPageBrandEvidence(page, url, role);
        pages.push(evidence);
        base.pagesInspected.push({ url, role });
        log("brand-page-collected", { url, role, images: evidence.images.length, headings: evidence.headings.length });
      } finally {
        await page.close().catch(() => {});
      }
    };

    await visit(homepage.finalUrl.toString(), "homepage");
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

  // Photography: download the best-ranked candidates within budget.
  const excluded = new Set<string>([...(logo.sourceUrl ? [logo.sourceUrl] : []), ...logoCandidates.map((c) => c.src)]);
  const photoCandidates = rankImageCandidates(pages, excluded);
  const selectedImages: BrandImage[] = [];
  const rejectedExamples: string[] = [];
  for (const candidate of photoCandidates) {
    if (selectedImages.length >= MAX_SELECTED_IMAGES) break;
    try {
      const asset = await fetchImageAsset(candidate.src, safety);
      if (asset.bytes.byteLength > budgetLeft()) throw new AssetRejectedError("asset budget exhausted", "too_large");
      const processed = await processPhotoAsset(asset, artifactDir, `image-${selectedImages.length + 1}`);
      bytesDownloaded += processed.bytes;
      selectedImages.push({
        role: selectedImages.length === 0 ? "hero" : "gallery",
        sourceUrl: candidate.src,
        sourcePage: candidate.sourcePage,
        assetFile: processed.file,
        width: processed.width,
        height: processed.height,
        alt: candidate.alt,
        reasons: candidate.reasons,
      });
    } catch (error) {
      if (rejectedExamples.length < 6) {
        rejectedExamples.push(`${candidate.src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (selectedImages.length === 0) fallbacks.push("no usable business photography was found");
  log("brand-imagery", { considered: photoCandidates.length, selected: selectedImages.length });

  const services = extractServices(pages, options.category ?? null, options.businessName);
  log("brand-services", { extracted: services.extracted.map((service) => service.name) });

  return {
    ...base,
    durationMs: Date.now() - startedAt,
    artifactRef: bytesDownloaded > 0 ? artifactRef : null,
    assetBytesDownloaded: bytesDownloaded,
    logo,
    palette,
    imagery: { selected: selectedImages, consideredCount: photoCandidates.length, rejectedExamples },
    services,
  };
}
