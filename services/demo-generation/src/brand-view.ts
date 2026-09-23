/**
 * Defensive typed view over a persisted brand-profile-v1/v2 JSON document.
 * Demo generation never trusts stored JSON blindly: every field is
 * shape-checked, and anything malformed simply degrades to "absent" so a
 * bad profile can never break generation.
 */

import type { DemoImage, DemoPalette } from "./types.ts";

export type BrandConfidence = "high" | "medium" | "low" | "none";

export interface BrandLogoView {
  confidence: BrandConfidence;
  sourceUrl?: string;
  assetUrl: string;
  width: number;
  height: number;
}

export interface BrandImageView extends DemoImage {
  /** v1 profiles only ever carry hero/gallery; v2 adds service/about slots. */
  role: "hero" | "gallery" | "service" | "about";
  /** v2: the extracted service this photo illustrates. */
  serviceName?: string;
  sourceUrl: string;
  sourcePage: string;
  reasons: string[];
}

export interface BrandServiceView {
  name: string;
  sourceText: string;
  sourcePage: string;
  evidence: string;
}

export interface BrandProfileView {
  analysisId: string;
  profileVersion: string;
  collectedAt: string;
  artifactRef: string | null;
  logo?: BrandLogoView;
  logoStatus: string;
  logoConfidence: BrandConfidence;
  logoReasons: string[];
  palette?: DemoPalette;
  paletteStatus: string;
  paletteConfidence: BrandConfidence;
  paletteSources: string[];
  images: BrandImageView[];
  services: BrandServiceView[];
  fallbacks: string[];
  /** v2: the website forwarded to another company's domain. */
  foreignRedirect?: { requestedHost: string; finalHost: string };
  /** v2: the website refused automated access; no branding could be read. */
  accessBlocked?: string;
  /** The homepage <title> as collected (brand-name evidence). */
  siteTitle?: string;
}

const CONFIDENCES = new Set(["high", "medium", "low", "none"]);
const IMAGE_ROLES = new Set(["hero", "gallery", "service", "about"]);
/** Renderer route prefix for locally stored demo assets. */
export const DEMO_ASSET_URL_PREFIX = "/demo-assets";
const ASSET_REF_PATTERN = /^[0-9]{14}-[a-z0-9-]{1,60}$/;
const ASSET_FILE_PATTERN = /^[a-z0-9-]{1,40}\.(png|jpg|jpeg|webp)$/;

export function parseBrandProfile(
  analysisId: string,
  collectedAt: string,
  raw: Record<string, unknown>,
): BrandProfileView | undefined {
  if (raw.kind !== "brand-intelligence" || typeof raw.profileVersion !== "string") return undefined;
  const artifactRef =
    typeof raw.artifactRef === "string" && ASSET_REF_PATTERN.test(raw.artifactRef) ? raw.artifactRef : null;
  const assetUrl = (file: unknown): string | undefined => {
    if (artifactRef === null || typeof file !== "string" || !ASSET_FILE_PATTERN.test(file)) return undefined;
    return `${DEMO_ASSET_URL_PREFIX}/${artifactRef}/${file}`;
  };

  const logoRaw = asRecord(raw.logo);
  const logoConfidence = confidence(logoRaw?.confidence);
  let logo: BrandLogoView | undefined;
  if (logoRaw?.status === "selected" && logoConfidence !== "none") {
    const url = assetUrl(logoRaw.assetFile);
    const width = numberOr(logoRaw.width, 0);
    const height = numberOr(logoRaw.height, 0);
    if (url !== undefined && width > 0 && height > 0) {
      logo = {
        confidence: logoConfidence,
        ...(typeof logoRaw.sourceUrl === "string" ? { sourceUrl: logoRaw.sourceUrl } : {}),
        assetUrl: url,
        width,
        height,
      };
    }
  }

  const paletteRaw = asRecord(raw.palette);
  const paletteColors = asRecord(paletteRaw?.colors);
  let palette: DemoPalette | undefined;
  if (paletteRaw?.status === "extracted" && paletteColors) {
    const color = (value: unknown): string | undefined =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    const parsed = {
      primary: color(paletteColors.primary),
      secondary: color(paletteColors.secondary),
      accent: color(paletteColors.accent),
      background: color(paletteColors.background),
      surface: color(paletteColors.surface),
      text: color(paletteColors.text),
      onPrimary: color(paletteColors.onPrimary),
      onAccent: color(paletteColors.onAccent),
    };
    if (Object.values(parsed).every((value) => value !== undefined)) {
      palette = parsed as DemoPalette;
    }
  }

  const imageryRaw = asRecord(raw.imagery);
  const images: BrandImageView[] = [];
  for (const entry of arrayOf(imageryRaw?.selected)) {
    const image = asRecord(entry);
    if (!image) continue;
    const url = assetUrl(image.assetFile);
    const width = numberOr(image.width, 0);
    const height = numberOr(image.height, 0);
    if (url === undefined || width <= 0 || height <= 0) continue;
    const role = typeof image.role === "string" && IMAGE_ROLES.has(image.role) ? (image.role as BrandImageView["role"]) : "gallery";
    images.push({
      role,
      ...(role === "service" && typeof image.serviceName === "string" && image.serviceName.trim() !== ""
        ? { serviceName: sanitizeText(image.serviceName, 60) }
        : {}),
      url,
      width,
      height,
      alt: typeof image.alt === "string" ? image.alt : "",
      sourceUrl: typeof image.sourceUrl === "string" ? image.sourceUrl : "",
      sourcePage: typeof image.sourcePage === "string" ? image.sourcePage : "",
      reasons: stringArray(image.reasons),
    });
  }

  const servicesRaw = asRecord(raw.services);
  const services: BrandServiceView[] = [];
  for (const entry of arrayOf(servicesRaw?.extracted)) {
    const service = asRecord(entry);
    if (!service || typeof service.name !== "string" || service.name.trim() === "") continue;
    services.push({
      name: sanitizeText(service.name, 60),
      sourceText: sanitizeText(typeof service.sourceText === "string" ? service.sourceText : "", 80),
      sourcePage: typeof service.sourcePage === "string" ? service.sourcePage : "",
      evidence: typeof service.evidence === "string" ? service.evidence : "unknown",
    });
  }

  return {
    analysisId,
    profileVersion: raw.profileVersion,
    collectedAt,
    artifactRef,
    ...(logo ? { logo } : {}),
    logoStatus: typeof logoRaw?.status === "string" ? logoRaw.status : "fallback",
    logoConfidence,
    logoReasons: stringArray(logoRaw?.reasons),
    ...(palette ? { palette } : {}),
    paletteStatus: typeof paletteRaw?.status === "string" ? paletteRaw.status : "fallback",
    paletteConfidence: confidence(paletteRaw?.confidence),
    paletteSources: stringArray(paletteRaw?.sources),
    images,
    services,
    fallbacks: stringArray(raw.fallbacks),
    ...foreignRedirectOf(asRecord(raw.identity)),
    ...(typeof asRecord(raw.identity)?.displayName === "string"
      ? { siteTitle: sanitizeText(asRecord(raw.identity)!.displayName as string, 160) }
      : {}),
    ...(typeof asRecord(raw.identity)?.accessBlocked === "string"
      ? { accessBlocked: sanitizeText(asRecord(raw.identity)!.accessBlocked as string, 200) }
      : {}),
  };
}

/** Plain-text sanitation for extracted site text: no markup, bounded length. */
export function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function foreignRedirectOf(identity: Record<string, unknown> | null): Pick<BrandProfileView, "foreignRedirect"> {
  const redirect = asRecord(identity?.foreignRedirect);
  if (redirect && typeof redirect.requestedHost === "string" && typeof redirect.finalHost === "string") {
    return { foreignRedirect: { requestedHost: redirect.requestedHost, finalHost: redirect.finalHost } };
  }
  return {};
}

function confidence(value: unknown): BrandConfidence {
  return typeof value === "string" && CONFIDENCES.has(value) ? (value as BrandConfidence) : "none";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
}
