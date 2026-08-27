/**
 * Operator run parameters and their hard bounds.
 *
 * The admin never passes shell arguments to anything. It submits a small,
 * typed form; this module validates it against the same safe limits the
 * PowerShell commands enforce and produces the exact parameter object the
 * worker will execute. Anything outside the bounds is rejected here, before a
 * run row exists.
 *
 * Deliberately dependency-light so the admin can import it inside a request.
 */

import { supportedDiscoveryCategories } from "@saltbox/discovery/osm-categories";
import { supportedOvertureCategories } from "@saltbox/discovery/overture-categories";

/** Mirrors @saltbox/discovery acquire-v2 bounds (asserted equal in tests). */
export const DEFAULT_ACQUISITION_LIMIT = 3;
export const MAX_ACQUISITION_LIMIT = 10;
export const DEFAULT_ACQUISITION_CONCURRENCY = 1;
export const MAX_ACQUISITION_CONCURRENCY = 2;
export const DEFAULT_ACQUISITION_RADIUS_KM = 10;
export const MAX_ACQUISITION_RADIUS_KM = 25;

export const ACQUISITION_SOURCES = ["overture", "openstreetmap", "all"] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const COMPOSITION_KEYS = ["premium", "bold", "clean"] as const;
export type CompositionChoice = (typeof COMPOSITION_KEYS)[number];

export interface AcquisitionParameters {
  kind: "acquisition";
  category: string;
  location: string;
  radiusKm: number;
  limit: number;
  source: AcquisitionSource;
  concurrency: number;
}

export interface DemoGenerateParameters {
  kind: "demo_generate";
  prospectId: string;
  forceRegenerate: boolean;
  refreshBrand: boolean;
  composition?: CompositionChoice;
  reason?: string;
  /** Run automated QA immediately after generating (the normal flow). */
  runQa: boolean;
}

export interface DemoQaParameters {
  kind: "demo_qa";
  prospectId: string;
}

export interface DemoPublishParameters {
  kind: "demo_publish";
  prospectId: string;
  environment: "local" | "hosted";
  baseUrl?: string;
}

export interface RetryIntelligenceParameters {
  kind: "retry_intelligence";
  prospectId: string;
}

export type OperatorRunParameters =
  | AcquisitionParameters
  | DemoGenerateParameters
  | DemoQaParameters
  | DemoPublishParameters
  | RetryIntelligenceParameters;

export interface ParameterError {
  field: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: ParameterError[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOCATION_LENGTH = 120;
const MAX_REASON_LENGTH = 400;

/** Categories the operator may start an acquisition for, per source. */
export function supportedAcquisitionCategories(source: AcquisitionSource): string[] {
  const osm = supportedDiscoveryCategories();
  const overture = supportedOvertureCategories();
  if (source === "openstreetmap") return [...osm].sort();
  if (source === "overture") return [...overture].sort();
  return [...new Set([...osm, ...overture])].sort();
}

export function parseAcquisitionParameters(raw: Record<string, unknown>): ParseResult<AcquisitionParameters> {
  const errors: ParameterError[] = [];
  const source = asString(raw.source ?? "overture").toLowerCase();
  if (!(ACQUISITION_SOURCES as readonly string[]).includes(source)) {
    errors.push({ field: "source", message: `Source must be one of ${ACQUISITION_SOURCES.join(", ")}.` });
  }
  const category = asString(raw.category).trim().toLowerCase();
  const allowed = supportedAcquisitionCategories(
    (ACQUISITION_SOURCES as readonly string[]).includes(source) ? (source as AcquisitionSource) : "all",
  );
  if (category === "") errors.push({ field: "category", message: "A category is required." });
  else if (!allowed.includes(category)) {
    errors.push({ field: "category", message: `Category "${category}" is not supported by this source.` });
  }
  const location = asString(raw.location).trim();
  if (location === "") errors.push({ field: "location", message: "A location is required." });
  else if (location.length > MAX_LOCATION_LENGTH) {
    errors.push({ field: "location", message: `Location must be at most ${MAX_LOCATION_LENGTH} characters.` });
  }
  const radiusKm = integer(raw.radiusKm, DEFAULT_ACQUISITION_RADIUS_KM);
  if (radiusKm === undefined || radiusKm < 1 || radiusKm > MAX_ACQUISITION_RADIUS_KM) {
    errors.push({ field: "radiusKm", message: `Radius must be between 1 and ${MAX_ACQUISITION_RADIUS_KM} km.` });
  }
  const limit = integer(raw.limit, DEFAULT_ACQUISITION_LIMIT);
  if (limit === undefined || limit < 1 || limit > MAX_ACQUISITION_LIMIT) {
    errors.push({ field: "limit", message: `Limit must be between 1 and ${MAX_ACQUISITION_LIMIT} businesses.` });
  }
  const concurrency = integer(raw.concurrency, DEFAULT_ACQUISITION_CONCURRENCY);
  if (concurrency === undefined || concurrency < 1 || concurrency > MAX_ACQUISITION_CONCURRENCY) {
    errors.push({
      field: "concurrency",
      message: `Deep-analysis concurrency must be between 1 and ${MAX_ACQUISITION_CONCURRENCY}.`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: "acquisition",
      category,
      location,
      radiusKm: radiusKm!,
      limit: limit!,
      source: source as AcquisitionSource,
      concurrency: concurrency!,
    },
  };
}

export function parseDemoGenerateParameters(raw: Record<string, unknown>): ParseResult<DemoGenerateParameters> {
  const errors: ParameterError[] = [];
  const prospectId = asString(raw.prospectId).trim();
  if (!UUID.test(prospectId)) errors.push({ field: "prospectId", message: "A prospect id is required." });
  const rawComposition = asString(raw.composition ?? "").trim();
  let composition: CompositionChoice | undefined;
  if (rawComposition !== "" && rawComposition !== "auto") {
    if (!(COMPOSITION_KEYS as readonly string[]).includes(rawComposition)) {
      errors.push({ field: "composition", message: `Composition must be auto or one of ${COMPOSITION_KEYS.join(", ")}.` });
    } else {
      composition = rawComposition as CompositionChoice;
    }
  }
  const reason = asString(raw.reason ?? "").trim();
  if (reason.length > MAX_REASON_LENGTH) {
    errors.push({ field: "reason", message: `Reason must be at most ${MAX_REASON_LENGTH} characters.` });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: "demo_generate",
      prospectId,
      forceRegenerate: asBoolean(raw.forceRegenerate),
      refreshBrand: asBoolean(raw.refreshBrand),
      ...(composition ? { composition } : {}),
      ...(reason !== "" ? { reason } : {}),
      runQa: raw.runQa === undefined ? true : asBoolean(raw.runQa),
    },
  };
}

export function parseProspectScopedParameters<K extends "demo_qa" | "retry_intelligence">(
  kind: K,
  raw: Record<string, unknown>,
): ParseResult<{ kind: K; prospectId: string }> {
  const prospectId = asString(raw.prospectId).trim();
  if (!UUID.test(prospectId)) {
    return { ok: false, errors: [{ field: "prospectId", message: "A prospect id is required." }] };
  }
  return { ok: true, value: { kind, prospectId } };
}

export function parseDemoPublishParameters(raw: Record<string, unknown>): ParseResult<DemoPublishParameters> {
  const errors: ParameterError[] = [];
  const prospectId = asString(raw.prospectId).trim();
  if (!UUID.test(prospectId)) errors.push({ field: "prospectId", message: "A prospect id is required." });
  const environment = asString(raw.environment ?? "local").trim();
  if (environment !== "local" && environment !== "hosted") {
    errors.push({ field: "environment", message: 'Environment must be "local" or "hosted".' });
  }
  const baseUrl = asString(raw.baseUrl ?? "").trim();
  if (baseUrl !== "" && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    errors.push({ field: "baseUrl", message: "Base URL must be an http(s) origin." });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: "demo_publish",
      prospectId,
      environment: environment as "local" | "hosted",
      ...(baseUrl !== "" ? { baseUrl } : {}),
    },
  };
}

/** Stable dedupe key so a double-submitted form does not start two runs. */
export function requestKeyFor(parameters: OperatorRunParameters): string {
  switch (parameters.kind) {
    case "acquisition":
      return `acquisition:${parameters.source}:${parameters.category}:${parameters.location.toLowerCase()}:${parameters.radiusKm}:${parameters.limit}`;
    case "demo_generate":
      return `demo_generate:${parameters.prospectId}`;
    case "demo_qa":
      return `demo_qa:${parameters.prospectId}`;
    case "demo_publish":
      return `demo_publish:${parameters.prospectId}:${parameters.environment}`;
    case "retry_intelligence":
      return `retry_intelligence:${parameters.prospectId}`;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

function integer(value: unknown, fallback: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
