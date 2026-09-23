/**
 * Pure, deterministic slot assignment for analyzed photography
 * (brand-intelligence-v2). No network, no model — fully unit-testable.
 *
 * Each analyzed photo carries DOM context (which page block it sat in, any
 * text laid over it, the nearest card heading), pixel metrics, and an
 * optional local visual classification. Photos earn slots only when they
 * suit them:
 *
 *   hero     wide, bright enough, a real photo of the work, not decoration
 *   service  a work photo whose own card heading/alt names that service
 *   gallery  clean work photos (no text overlay, not darkened, not decor)
 *   about    a team/about-section photo (the only slot people photos get)
 *
 * Every photo is used at most once, near-duplicates collapse, and every
 * rejection keeps its reasons so "why wasn't this used?" is answerable.
 */

import { DECORATIVE_CONTEXTS, matchServiceNames, type ImageCandidate } from "./derive.ts";
import { hashDistance } from "./image-analysis.ts";
import {
  MAX_GALLERY_IMAGES,
  MAX_SERVICE_IMAGES,
  type BrandImageRole,
  type ImageAnalysis,
  type ImageClassification,
  type ImageVisualMetrics,
} from "./types.ts";

export interface AnalyzedPhoto {
  candidate: ImageCandidate;
  visual: ImageVisualMetrics;
  classification?: ImageClassification;
}

export interface SlotAssignment {
  /** Index into the input array. */
  index: number;
  role: BrandImageRole;
  serviceName?: string;
  reasons: string[];
}

export interface ImagerySelection {
  selected: SlotAssignment[];
  rejected: Array<{ index: number; reasons: string[] }>;
  /** Per-input structured analysis (flags included), aligned with input order. */
  analyses: ImageAnalysis[];
}

/** Tunables, exported so tests and docs reference one source of truth. */
export const IMAGERY_THRESHOLDS = {
  darkLuma: 70,
  heroMinLuma: 60,
  washedLuma: 238,
  flatEntropy: 5.5,
  letterboxFraction: 0.08,
  textOverlayChars: 60,
  heroMinWidth: 1000,
  heroMinAspect: 1.2,
  /** Minimum summed "work" probability for gallery/service slots. */
  workRelevance: 0.5,
  heroRelevance: 0.45,
  /** A non-work label this confident disqualifies the photo from work slots. */
  nonWorkConfidence: 0.5,
  duplicateHashDistance: 6,
} as const;

export function flagsFor(photo: AnalyzedPhoto): string[] {
  const t = IMAGERY_THRESHOLDS;
  const flags: string[] = [];
  const { visual, candidate, classification } = photo;
  if (visual.meanLuma < t.darkLuma) flags.push("dark");
  if (visual.meanLuma > t.washedLuma) flags.push("washed-out");
  if (visual.entropy < t.flatEntropy) flags.push("flat-graphic");
  if (visual.borderFraction > t.letterboxFraction) flags.push("letterboxed");
  if (candidate.overlayTextChars > t.textOverlayChars) flags.push("text-overlay");
  if (DECORATIVE_CONTEXTS.has(candidate.context)) flags.push(`decorative-context:${candidate.context}`);
  if (candidate.context === "team") flags.push("team-context");
  if (classification) {
    if (classification.kind !== "work" && classification.topScore >= t.nonWorkConfidence) {
      flags.push(`not-work:${classification.kind}`);
    }
    if (classification.relevance < t.workRelevance) flags.push("low-work-relevance");
  }
  return flags;
}

function workBlockers(photo: AnalyzedPhoto, flags: string[]): string[] {
  const blockers = flags.filter(
    (flag) =>
      flag === "dark" ||
      flag === "washed-out" ||
      flag === "flat-graphic" ||
      flag === "text-overlay" ||
      flag === "team-context" ||
      flag === "low-work-relevance" ||
      flag.startsWith("decorative-context:") ||
      flag.startsWith("not-work:"),
  );
  if (photo.classification && photo.classification.kind !== "work") {
    blockers.push(`classified as ${photo.classification.kind} ("${photo.classification.topLabel}")`);
  }
  return [...new Set(blockers)];
}

function heroBlockers(photo: AnalyzedPhoto, flags: string[]): string[] {
  const t = IMAGERY_THRESHOLDS;
  const blockers: string[] = [];
  const { visual, candidate, classification } = photo;
  if (visual.width < t.heroMinWidth) blockers.push(`only ${visual.width}px wide`);
  if (visual.width / visual.height < t.heroMinAspect) blockers.push("not landscape");
  if (visual.meanLuma < t.heroMinLuma) blockers.push("too dark for a hero");
  if (flags.includes("flat-graphic")) blockers.push("flat-graphic");
  if (flags.includes("washed-out")) blockers.push("washed-out");
  // Contact/CTA backgrounds are often wide scenic shots and may lead a page;
  // testimonial, footer, header, partner, blog, and team imagery may not.
  if (DECORATIVE_CONTEXTS.has(candidate.context) && candidate.context !== "contact" && candidate.context !== "cta") {
    blockers.push(`decorates a ${candidate.context} block`);
  }
  if (candidate.context === "team") blockers.push("team photo");
  if (classification) {
    if (classification.kind !== "work") blockers.push(`classified as ${classification.kind}`);
    if (classification.relevance < t.heroRelevance) blockers.push("low work relevance");
  }
  return blockers;
}

/** The business naming a photo as its own team ("Genuine-Comfort-HVAC-Team.jpg", alt "Our crew"). */
const TEAM_NAMING = /(^|[^a-z])(team|crew|staff|employees?|our[-_ ]?people|technicians)([^a-z]|$)/i;

export function isTeamNamed(candidate: ImageCandidate): boolean {
  let file = "";
  try {
    file = decodeURIComponent(new URL(candidate.src).pathname.split("/").pop() ?? "");
  } catch {
    file = candidate.src;
  }
  return TEAM_NAMING.test(file) || TEAM_NAMING.test(candidate.alt);
}

function aboutBlockers(photo: AnalyzedPhoto, flags: string[]): string[] {
  const blockers: string[] = [];
  const teamNamed = isTeamNamed(photo.candidate);
  if (photo.candidate.context !== "team" && photo.candidate.context !== "about" && !teamNamed) {
    blockers.push("not in a team/about block and not named as the team");
  }
  if (DECORATIVE_CONTEXTS.has(photo.candidate.context)) blockers.push(`decorates a ${photo.candidate.context} block`);
  for (const flag of ["dark", "flat-graphic", "text-overlay", "washed-out"]) if (flags.includes(flag)) blockers.push(flag);
  const kind = photo.classification?.kind;
  // A crew posing with their branded trucks reads as "vehicle" to CLIP; when
  // the business itself names the photo as its team, it belongs in About.
  const allowedKinds = teamNamed ? ["person", "work", "vehicle"] : ["person", "work"];
  if (kind !== undefined && !allowedKinds.includes(kind)) blockers.push(`classified as ${kind}`);
  return blockers;
}

const relevanceOf = (photo: AnalyzedPhoto) => photo.classification?.relevance ?? 0.5;

function heroScore(photo: AnalyzedPhoto): number {
  const aspect = photo.visual.width / photo.visual.height;
  let score = photo.candidate.score + relevanceOf(photo) * 40;
  if (photo.candidate.context === "hero") score += 15;
  if (aspect >= 1.3 && aspect <= 2.4) score += 10;
  if (photo.candidate.context === "contact" || photo.candidate.context === "cta") score -= 15;
  if (photo.candidate.overlayTextChars > IMAGERY_THRESHOLDS.textOverlayChars) score -= 5;
  return score;
}

function galleryScore(photo: AnalyzedPhoto): number {
  let score = relevanceOf(photo) * 50 + photo.candidate.score * 0.3;
  if (photo.candidate.context === "gallery" || photo.candidate.context === "services") score += 15;
  return score;
}

export function selectImagery(
  photos: readonly AnalyzedPhoto[],
  options: { category: string | null; services: readonly string[] },
): ImagerySelection {
  const flags = photos.map(flagsFor);
  const analyses: ImageAnalysis[] = photos.map((photo, index) => ({
    context: photo.candidate.context,
    background: photo.candidate.background,
    overlayTextChars: photo.candidate.overlayTextChars,
    nearHeading: photo.candidate.nearHeading,
    visual: photo.visual,
    ...(photo.classification ? { classification: photo.classification } : {}),
    flags: flags[index]!,
  }));
  const rejectedReasons = new Map<number, string[]>();

  // Near-duplicates (same photo at another size/crop) collapse to the best.
  const order = photos.map((_, index) => index).sort((a, b) => photos[b]!.candidate.score - photos[a]!.candidate.score || a - b);
  const kept: number[] = [];
  for (const index of order) {
    const duplicateOf = kept.find(
      (other) => hashDistance(photos[index]!.visual.dhash, photos[other]!.visual.dhash) <= IMAGERY_THRESHOLDS.duplicateHashDistance,
    );
    if (duplicateOf !== undefined) rejectedReasons.set(index, [`near-duplicate of ${photos[duplicateOf]!.candidate.src}`]);
    else kept.push(index);
  }

  const used = new Set<number>();
  const selected: SlotAssignment[] = [];
  const byScore = (score: (photo: AnalyzedPhoto) => number) => (a: number, b: number) =>
    score(photos[b]!) - score(photos[a]!) || a - b;

  // Hero.
  const heroCandidates = kept.filter((index) => heroBlockers(photos[index]!, flags[index]!).length === 0).sort(byScore(heroScore));
  const hero = heroCandidates[0];
  if (hero !== undefined) {
    used.add(hero);
    selected.push({ index: hero, role: "hero", reasons: [...photos[hero]!.candidate.reasons, "best hero-grade work photo"] });
  }

  // Services: a work photo whose own card heading or alt text names the service.
  const workEligible = kept.filter((index) => workBlockers(photos[index]!, flags[index]!).length === 0);
  for (const service of options.services) {
    if (selected.filter((entry) => entry.role === "service").length >= MAX_SERVICE_IMAGES) break;
    const match = workEligible
      .filter((index) => !used.has(index))
      .filter((index) => {
        const candidate = photos[index]!.candidate;
        const text = `${candidate.nearHeading ?? ""} ${candidate.alt}`;
        return matchServiceNames(text, options.category).includes(service);
      })
      .sort(byScore(galleryScore))[0];
    if (match === undefined) continue;
    used.add(match);
    selected.push({
      index: match,
      role: "service",
      serviceName: service,
      reasons: [`card heading/alt names "${service}"`, ...photos[match]!.candidate.reasons],
    });
  }

  // Gallery: remaining clean work photos. A lone photo is not a gallery.
  const gallery = workEligible
    .filter((index) => !used.has(index))
    .sort(byScore(galleryScore))
    .slice(0, MAX_GALLERY_IMAGES);
  if (gallery.length >= 2) {
    for (const index of gallery) {
      used.add(index);
      selected.push({ index, role: "gallery", reasons: [...photos[index]!.candidate.reasons, "clean work photo"] });
    }
  }

  // About: a team/about-section photo.
  const about = kept
    .filter((index) => !used.has(index) && aboutBlockers(photos[index]!, flags[index]!).length === 0)
    .sort(byScore(galleryScore))[0];
  if (about !== undefined) {
    used.add(about);
    selected.push({ index: about, role: "about", reasons: [`from the site's ${photos[about]!.candidate.context} section`] });
  }

  const rejected: ImagerySelection["rejected"] = [];
  photos.forEach((photo, index) => {
    if (used.has(index)) return;
    const reasons = rejectedReasons.get(index) ?? [...new Set([...workBlockers(photo, flags[index]!), ...heroBlockers(photo, flags[index]!)])];
    rejected.push({ index, reasons: reasons.length > 0 ? reasons : ["eligible, but every slot was already filled"] });
  });
  return { selected, rejected, analyses };
}
