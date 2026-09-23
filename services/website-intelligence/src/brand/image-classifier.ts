/**
 * Zero-cost local visual classification (brand-intelligence-v2).
 *
 * A CLIP model (transformers.js, ONNX on CPU) scores each candidate photo
 * against category-specific "real work" labels and a shared set of
 * non-work labels (people portraits, vehicles, text graphics, logos,
 * interiors). No API, no per-image cost: the model downloads once into a
 * git-ignored cache and classifies in ~50 ms per image.
 *
 * The classifier is an injectable interface. Tests and offline runs pass a
 * stub or nothing at all; when it is absent or fails to load, selection
 * falls back to DOM-context and pixel heuristics and records that honestly.
 * A paid vision model could implement the same interface later.
 */

import type { ImageClassification } from "./types.ts";

export interface ImageClassifier {
  readonly model: string;
  classify(jpeg: Buffer, category: string | null): Promise<ImageClassification>;
}

export const CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";

type Kind = ImageClassification["kind"];

/** Labels describing the business's actual work, per category. */
const WORK_LABELS: Readonly<Record<string, readonly string[]>> = {
  roofing: [
    "a photo of a house with a new roof",
    "roofers working on a roof",
    "a close-up photo of roof shingles",
    "a photo of a home exterior",
  ],
  plumbing: [
    "a plumber working on pipes",
    "a photo of a modern bathroom",
    "a photo of a water heater",
    "a photo of a kitchen sink and faucet",
  ],
  hvac: [
    "an HVAC technician working on an air conditioner",
    "a photo of an outdoor air conditioning unit",
    "a photo of a furnace",
    "a photo of a home exterior",
  ],
  electrical: [
    "an electrician working on an electrical panel",
    "a photo of modern home lighting",
    "a photo of an electrical panel",
    "a photo of a home exterior",
  ],
  landscaping: [
    "a photo of a landscaped yard with a green lawn",
    "a photo of a garden with a stone patio",
    "workers doing landscaping",
    "a photo of a home exterior",
  ],
};

const GENERIC_WORK_LABELS: readonly string[] = [
  "a contractor working on a house",
  "a photo of a renovated home interior",
  "a photo of a home exterior",
  "a photo of construction work",
];

/** Shared labels for things that are not photographs of the work. */
const NON_WORK_LABELS: ReadonlyArray<{ label: string; kind: Kind }> = [
  { label: "a portrait photo of a smiling person", kind: "person" },
  { label: "a group of people posing for a photo", kind: "person" },
  { label: "a photo of a truck or delivery vehicle", kind: "vehicle" },
  { label: "a graphic with text or a banner advertisement", kind: "graphic" },
  { label: "a company logo", kind: "logo" },
  { label: "an illustration or icon", kind: "graphic" },
  { label: "a photo of an office or warehouse interior", kind: "interior" },
  { label: "a map", kind: "graphic" },
];

export function labelsFor(category: string | null): { work: readonly string[]; nonWork: typeof NON_WORK_LABELS } {
  const work = (category !== null ? WORK_LABELS[category] : undefined) ?? GENERIC_WORK_LABELS;
  return { work, nonWork: NON_WORK_LABELS };
}

/** Pure scoring step, exported for tests: probabilities -> classification. */
export function interpretScores(
  model: string,
  category: string | null,
  scores: ReadonlyArray<{ label: string; score: number }>,
): ImageClassification {
  const { work, nonWork } = labelsFor(category);
  const workSet = new Set(work);
  let relevance = 0;
  let top = { label: "", score: -1 };
  for (const entry of scores) {
    if (workSet.has(entry.label)) relevance += entry.score;
    if (entry.score > top.score) top = entry;
  }
  const kind: Kind = workSet.has(top.label) ? "work" : (nonWork.find((entry) => entry.label === top.label)?.kind ?? "other");
  return {
    model,
    kind,
    topLabel: top.label,
    topScore: Math.round(top.score * 1000) / 1000,
    relevance: Math.round(relevance * 1000) / 1000,
  };
}

export interface ClipClassifierOptions {
  /** Directory for the downloaded model (git-ignored, e.g. .data/models). */
  cacheDir: string;
}

/**
 * Lazily loads CLIP on first use. Throws from classify() if the runtime or
 * model cannot be loaded; callers treat that as "classifier unavailable".
 */
export function createClipClassifier(options: ClipClassifierOptions): ImageClassifier {
  type ZeroShot = (image: unknown, labels: string[]) => Promise<Array<{ label: string; score: number }>>;
  let loading: Promise<{ run: ZeroShot; fromBlob: (blob: Blob) => Promise<unknown> }> | undefined;
  const load = () => {
    loading ??= (async () => {
      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = options.cacheDir;
      const run = (await transformers.pipeline("zero-shot-image-classification", CLIP_MODEL_ID, {
        dtype: "q8",
      })) as unknown as ZeroShot;
      return { run, fromBlob: (blob: Blob) => transformers.RawImage.fromBlob(blob) };
    })();
    return loading;
  };
  return {
    model: CLIP_MODEL_ID,
    async classify(jpeg, category) {
      const { run, fromBlob } = await load();
      const { work, nonWork } = labelsFor(category);
      const image = await fromBlob(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
      const scores = await run(image, [...work, ...nonWork.map((entry) => entry.label)]);
      return interpretScores(CLIP_MODEL_ID, category, scores);
    },
  };
}
