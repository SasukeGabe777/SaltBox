import { createHash } from "node:crypto";
import {
  getOsmCategoryMapping,
  OSM_CATEGORY_MAPPING_VERSION,
} from "../config/osm-category-mapping-v1.ts";
import { DiscoverySourceError } from "../errors.ts";
import { NominatimResolver } from "../location/nominatim.ts";
import { normalizeWebsite } from "../normalize/website.ts";
import type {
  DiscoveryBatch,
  DiscoveryQuery,
  DiscoveryResult,
  DiscoverySourceAdapter,
  ResolvedLocation,
} from "../types.ts";

export const OPENSTREETMAP_SOURCE = "openstreetmap";
export const OPENSTREETMAP_ADAPTER_VERSION = "openstreetmap-overpass-v1";
export const OPENSTREETMAP_POLICY_RESEARCH_DATE = "2026-08-26";
export const OPENSTREETMAP_ATTRIBUTION = "© OpenStreetMap contributors · ODbL 1.0";
export const OPENSTREETMAP_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const DEFAULT_DISCOVERY_USER_AGENT =
  "SaltBox-Discovery/0.1 (+https://github.com/SasukeGabe777/SaltBox)";

export interface OpenStreetMapAdapterOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  userAgent?: string;
  nominatimEndpoint?: string;
  overpassEndpoint?: string;
  nominatimTimeoutMs?: number;
  overpassTimeoutMs?: number;
  maxOverpassRetries?: number;
  retryDelayMs?: number;
  rateLimitDelayMs?: number;
}

export interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, unknown>;
}

interface OverpassPayload {
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
  elements?: unknown[];
}

const ALLOWED_OSM_TYPES = new Set(["node", "way", "relation"]);
const BOUNDED_TAG_KEYS = [
  "name",
  "official_name",
  "brand",
  "operator",
  "amenity",
  "craft",
  "shop",
  "website",
  "contact:website",
  "url",
  "phone",
  "contact:phone",
  "email",
  "contact:email",
  "addr:housenumber",
  "addr:street",
  "addr:city",
  "addr:state",
  "addr:postcode",
  "opening_hours",
] as const;

export class OpenStreetMapOverpassAdapter implements DiscoverySourceAdapter {
  readonly source = OPENSTREETMAP_SOURCE;
  readonly adapterVersion = OPENSTREETMAP_ADAPTER_VERSION;

  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly overpassEndpoint: string;
  private readonly overpassTimeoutMs: number;
  private readonly maxOverpassRetries: number;
  private readonly retryDelayMs: number;
  private readonly rateLimitDelayMs: number;
  private readonly nominatim: NominatimResolver;

  constructor(options: OpenStreetMapAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.userAgent = options.userAgent?.trim() || DEFAULT_DISCOVERY_USER_AGENT;
    this.overpassEndpoint = options.overpassEndpoint ?? "https://overpass-api.de/api/interpreter";
    this.overpassTimeoutMs = options.overpassTimeoutMs ?? 35_000;
    this.maxOverpassRetries = options.maxOverpassRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? 30_000;
    this.nominatim = new NominatimResolver({
      fetch: this.fetchImpl,
      userAgent: this.userAgent,
      ...(options.nominatimEndpoint !== undefined ? { endpoint: options.nominatimEndpoint } : {}),
      timeoutMs: options.nominatimTimeoutMs ?? 15_000,
    });
  }

  async resolveLocation(location: string): Promise<ResolvedLocation> {
    return this.nominatim.resolveLocation(location);
  }

  async discover(query: DiscoveryQuery, location: ResolvedLocation): Promise<DiscoveryBatch> {
    if (query.source !== this.source) {
      throw new DiscoverySourceError("unsupported_source", this.source, `Adapter cannot serve source "${query.source}".`);
    }
    const mapping = getOsmCategoryMapping(query.category);
    if (!mapping) {
      throw new DiscoverySourceError(
        "unsupported_category",
        this.source,
        `Category "${query.category}" is not supported by ${OSM_CATEGORY_MAPPING_VERSION}.`,
      );
    }

    const radiusMeters = Math.round(query.radiusKm * 1_000);
    // No [maxsize:...] here: a small cap (previously 2 MiB) starves Overpass of
    // working memory, and it reports the failure as HTTP 200 + "remark" with an
    // empty elements array. Output volume is already bounded by `out center <limit>`.
    const overpassQuery = [
      "[out:json][timeout:25];",
      `nwr(around:${radiusMeters},${location.latitude},${location.longitude})["${mapping.tagKey}"="${mapping.tagValue}"]["name"];`,
      `out center ${query.limit};`,
    ].join("\n");

    const payload = await this.requestJson(
      "overpass",
      this.overpassEndpoint,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: overpassQuery }).toString(),
      },
      this.overpassTimeoutMs,
      true,
    );
    const record = asRecord(payload) as OverpassPayload | null;
    if (!record || !Array.isArray(record.elements)) {
      throw new DiscoverySourceError("malformed_response", "overpass", "Overpass returned no elements array.");
    }
    // Overpass reports out-of-memory and query timeouts in-band as HTTP 200 with
    // a "remark" runtime error; treat that as a source failure, never an empty batch.
    if (typeof record.remark === "string" && /runtime error/i.test(record.remark)) {
      throw new DiscoverySourceError(
        /timed out/i.test(record.remark) ? "provider_timeout" : "provider_server_error",
        "overpass",
        `Overpass reported a runtime error instead of results: ${record.remark}`,
      );
    }

    const retrievedAt = new Date().toISOString();
    const sourceDataTimestamp =
      typeof record.osm3s?.timestamp_osm_base === "string" ? record.osm3s.timestamp_osm_base : null;
    const candidates = new Map<string, DiscoveryResult>();
    for (const raw of record.elements) {
      const normalized = normalizeOpenStreetMapElement(raw, {
        mappingCategory: mapping.saltboxCategory,
        location,
        retrievedAt,
        sourceDataTimestamp,
      });
      if (normalized && !candidates.has(normalized.externalId)) {
        candidates.set(normalized.externalId, normalized);
      }
      if (candidates.size >= query.limit) break;
    }

    return {
      query,
      location,
      source: this.source,
      adapterVersion: this.adapterVersion,
      sourceDataTimestamp,
      candidates: [...candidates.values()],
    };
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.8",
      "user-agent": this.userAgent,
    };
  }

  private async requestJson(
    source: "nominatim" | "overpass",
    input: string | URL,
    init: RequestInit,
    timeoutMs: number,
    allowRetry: boolean,
  ): Promise<unknown> {
    const attempts = allowRetry ? this.maxOverpassRetries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "AbortError" || name === "TimeoutError") {
          throw new DiscoverySourceError("provider_timeout", source, `${source} request timed out after ${timeoutMs} ms.`);
        }
        throw new DiscoverySourceError(
          "provider_request_failed",
          source,
          `${source} request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
        );
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new DiscoverySourceError("malformed_response", source, `${source} returned invalid JSON.`);
        }
      }

      const retryable = response.status === 429 || response.status === 406 || response.status >= 500;
      if (allowRetry && retryable && attempt + 1 < attempts) {
        await this.sleep(response.status === 429 || response.status === 406 ? this.rateLimitDelayMs : this.retryDelayMs);
        continue;
      }
      if (response.status === 429 || response.status === 406) {
        throw new DiscoverySourceError("rate_limited", source, `${source} rate limited the request.`, response.status);
      }
      if (response.status >= 500) {
        throw new DiscoverySourceError(
          "provider_server_error",
          source,
          `${source} returned HTTP ${response.status}.`,
          response.status,
        );
      }
      throw new DiscoverySourceError(
        "provider_request_failed",
        source,
        `${source} rejected the request with HTTP ${response.status}.`,
        response.status,
      );
    }
    throw new DiscoverySourceError("provider_request_failed", source, `${source} request exhausted its retry budget.`);
  }
}

export function normalizeOpenStreetMapElement(
  raw: unknown,
  context: {
    mappingCategory: string;
    location: ResolvedLocation;
    retrievedAt: string;
    sourceDataTimestamp: string | null;
  },
): DiscoveryResult | null {
  const element = asRecord(raw) as OverpassElement | null;
  if (!element || typeof element.type !== "string" || !ALLOWED_OSM_TYPES.has(element.type)) return null;
  if (!Number.isSafeInteger(element.id) || element.id! <= 0) return null;
  const tags = asRecord(element.tags);
  const name = firstString(tags, ["name", "official_name"]);
  if (!name) return null;

  const latitude = typeof element.lat === "number" ? element.lat : element.center?.lat;
  const longitude = typeof element.lon === "number" ? element.lon : element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const externalId = `${element.type}/${element.id}`;
  const sourceLocator = `https://www.openstreetmap.org/${externalId}`;
  const street = joinAddress(firstString(tags, ["addr:housenumber"]), firstString(tags, ["addr:street"]));
  const city = firstString(tags, ["addr:city"]) ?? context.location.city;
  const state = firstString(tags, ["addr:state"]) ?? context.location.state;
  const postalCode = firstString(tags, ["addr:postcode"]);
  const websiteUrl = normalizeWebsite(firstString(tags, ["contact:website", "website", "url"]));
  const phone = firstString(tags, ["contact:phone", "phone"]);
  const email = firstString(tags, ["contact:email", "email"]);
  const boundedTags = boundedTagRecord(tags);
  const identityPayload = JSON.stringify({ externalId, name, latitude, longitude, boundedTags });

  return {
    source: OPENSTREETMAP_SOURCE,
    sourceType: "map_dataset",
    sourceDescription: "OpenStreetMap business discovery through a bounded Overpass query (ODbL 1.0).",
    sourceRetentionClass: "public-business-discovery",
    externalId,
    name,
    category: context.mappingCategory,
    latitude: latitude!,
    longitude: longitude!,
    street,
    city,
    state,
    postalCode,
    phone,
    email,
    websiteUrl,
    sourceLocator,
    retrievedAt: context.retrievedAt,
    contentHash: createHash("sha256").update(identityPayload).digest("hex"),
    metadata: {
      city,
      state,
      postalCode,
      street,
      latitude,
      longitude,
      objectType: element.type,
      objectId: element.id,
      tags: boundedTags,
      sourceDataTimestamp: context.sourceDataTimestamp,
      adapterVersion: OPENSTREETMAP_ADAPTER_VERSION,
      categoryMappingVersion: OSM_CATEGORY_MAPPING_VERSION,
      retrievalMethod: "overpass-radius-query",
      policyResearchDate: OPENSTREETMAP_POLICY_RESEARCH_DATE,
      attribution: OPENSTREETMAP_ATTRIBUTION,
      licenceUrl: OPENSTREETMAP_COPYRIGHT_URL,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function joinAddress(houseNumber: string | null, street: string | null): string | null {
  const parts = [houseNumber, street].filter((part): part is string => Boolean(part));
  return parts.length === 0 ? null : parts.join(" ");
}

function boundedTagRecord(tags: Record<string, unknown> | null): Record<string, string> {
  if (!tags) return {};
  const bounded: Record<string, string> = {};
  for (const key of BOUNDED_TAG_KEYS) {
    const value = tags[key];
    if (typeof value === "string" && value.length <= 1_000) bounded[key] = value;
  }
  return bounded;
}
