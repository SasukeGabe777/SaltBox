import { createHash } from "node:crypto";
import {
  getOvertureCategoryMapping,
  OVERTURE_CATEGORY_MAPPING_VERSION,
} from "../config/overture-category-mapping-v1.ts";
import {
  DEFAULT_OVERTURE_DATA_DIR,
  DuckDbQueryExecutor,
  findCoveringDataset,
  sqlStringLiteral,
  type BoundingBox,
  type LocalOvertureDataset,
  type OvertureQueryExecutor,
} from "../duckdb/overture-local-dataset.ts";
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

export const OVERTURE_SOURCE = "overture";
export const OVERTURE_ADAPTER_VERSION = "overture-places-local-v1";
export const OVERTURE_POLICY_RESEARCH_DATE = "2026-08-26";
export const OVERTURE_ATTRIBUTION = "Overture Maps Foundation, overturemaps.org";
export const OVERTURE_LICENCE = "CDLA Permissive 2.0 / Apache 2.0";
export const OVERTURE_LICENCE_URL = "https://docs.overturemaps.org/attribution/";
/** Release the extract script pins by default; extracts record their actual release. */
export const DEFAULT_OVERTURE_RELEASE = "2026-08-19.0";

/** Deterministic cap on candidate rows examined per query (dev-scale searches only). */
const MAX_EXAMINED_ROWS = 2_000;

export interface OvertureAdapterOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  nominatimEndpoint?: string;
  nominatimTimeoutMs?: number;
  dataDir?: string;
  executor?: OvertureQueryExecutor;
}

interface ExtractRow {
  externalId: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  categoryPrimary: string;
  confidence: number | null;
  operatingStatus: string | null;
  websites: string[];
  phones: string[];
  emails: string[];
  address: { freeform: string | null; locality: string | null; region: string | null; postcode: string | null } | null;
  sources: Array<{ dataset: string; recordId: string | null }>;
}

export class OvertureMapsPlacesAdapter implements DiscoverySourceAdapter {
  readonly source = OVERTURE_SOURCE;
  readonly adapterVersion = OVERTURE_ADAPTER_VERSION;

  private readonly nominatim: NominatimResolver;
  private readonly dataDir: string;
  private readonly executor: OvertureQueryExecutor;

  constructor(options: OvertureAdapterOptions = {}) {
    this.nominatim = new NominatimResolver({
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      userAgent: options.userAgent?.trim() || "SaltBox-Discovery/0.1 (+https://github.com/SasukeGabe777/SaltBox)",
      ...(options.nominatimEndpoint !== undefined ? { endpoint: options.nominatimEndpoint } : {}),
      ...(options.nominatimTimeoutMs !== undefined ? { timeoutMs: options.nominatimTimeoutMs } : {}),
    });
    this.dataDir = options.dataDir ?? DEFAULT_OVERTURE_DATA_DIR;
    this.executor = options.executor ?? new DuckDbQueryExecutor();
  }

  async resolveLocation(location: string): Promise<ResolvedLocation> {
    return this.nominatim.resolveLocation(location);
  }

  async discover(query: DiscoveryQuery, location: ResolvedLocation): Promise<DiscoveryBatch> {
    if (query.source !== this.source) {
      throw new DiscoverySourceError("unsupported_source", this.source, `Adapter cannot serve source "${query.source}".`);
    }
    const mapping = getOvertureCategoryMapping(query.category);
    if (!mapping) {
      throw new DiscoverySourceError(
        "unsupported_category",
        this.source,
        `Category "${query.category}" is not supported by ${OVERTURE_CATEGORY_MAPPING_VERSION}.`,
      );
    }

    const bbox = radiusBoundingBox(location.latitude, location.longitude, query.radiusKm);
    const dataset = findCoveringDataset(this.dataDir, bbox);
    if (!dataset) {
      throw new DiscoverySourceError(
        "dataset_unavailable",
        this.source,
        `No local Overture extract covers ${query.radiusKm} km around "${location.displayName}". ` +
          `Build one with: pnpm discovery:data --location "${location.query}" --radius-km ${Math.max(query.radiusKm, 15)}`,
      );
    }

    const rows = await this.queryExtract(dataset, bbox, mapping.categoryCodes, location);
    const retrievedAt = new Date().toISOString();
    const candidates = new Map<string, DiscoveryResult>();
    for (const row of rows) {
      if (row.distanceKm > query.radiusKm) continue;
      if (row.operatingStatus === "permanently_closed") continue;
      if (!candidates.has(row.externalId)) {
        candidates.set(row.externalId, this.normalizeRow(row, mapping.saltboxCategory, dataset, location, retrievedAt));
      }
      if (candidates.size >= query.limit) break;
    }

    return {
      query,
      location,
      source: this.source,
      adapterVersion: this.adapterVersion,
      sourceDataTimestamp: dataset.manifest.retrievedAt ?? null,
      candidates: [...candidates.values()],
    };
  }

  private async queryExtract(
    dataset: LocalOvertureDataset,
    bbox: BoundingBox,
    categoryCodes: readonly string[],
    location: ResolvedLocation,
  ): Promise<ExtractRow[]> {
    const codes = categoryCodes.map((code) => sqlStringLiteral(code)).join(", ");
    const sql = [
      "SELECT external_id, name, lat, lon, category_primary, confidence, operating_status,",
      "  websites_json, phones_json, emails_json, address_json, sources_json",
      `FROM read_parquet(${sqlStringLiteral(dataset.parquetPath.replaceAll("\\", "/"))})`,
      `WHERE lon BETWEEN ${bbox.minLon} AND ${bbox.maxLon}`,
      `  AND lat BETWEEN ${bbox.minLat} AND ${bbox.maxLat}`,
      `  AND category_primary IN (${codes})`,
      "  AND name IS NOT NULL AND name <> ''",
      "ORDER BY external_id",
      `LIMIT ${MAX_EXAMINED_ROWS}`,
    ].join("\n");

    let raw: Array<Record<string, unknown>>;
    try {
      raw = await this.executor.queryRows(sql);
    } catch (error) {
      throw new DiscoverySourceError(
        "provider_request_failed",
        this.source,
        `Local Overture extract query failed: ${error instanceof Error ? error.message : "unknown DuckDB error"}`,
      );
    }
    if (!Array.isArray(raw)) {
      throw new DiscoverySourceError("malformed_response", this.source, "Overture extract query returned no row array.");
    }

    const rows: ExtractRow[] = [];
    for (const record of raw) {
      const parsed = parseExtractRow(record, location);
      if (parsed) rows.push(parsed);
    }
    rows.sort((a, b) => a.distanceKm - b.distanceKm || a.externalId.localeCompare(b.externalId));
    return rows;
  }

  private normalizeRow(
    row: ExtractRow,
    saltboxCategory: string,
    dataset: LocalOvertureDataset,
    location: ResolvedLocation,
    retrievedAt: string,
  ): DiscoveryResult {
    const websiteUrl = normalizeWebsite(row.websites.find((value) => value.trim() !== "") ?? null);
    const phone = row.phones.find((value) => value.trim() !== "") ?? null;
    const email = row.emails.find((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()))?.trim() ?? null;
    const street = row.address?.freeform ?? null;
    const city = row.address?.locality ?? location.city;
    const state = row.address?.region ?? location.state;
    const postalCode = row.address?.postcode ?? null;
    const boundedSources = row.sources.slice(0, 5);
    const identityPayload = JSON.stringify({
      externalId: row.externalId,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      categoryPrimary: row.categoryPrimary,
      websiteUrl,
      phone,
    });

    return {
      source: OVERTURE_SOURCE,
      sourceType: "map_dataset",
      sourceDescription:
        "Overture Maps places discovery from a bounded local regional extract (CDLA Permissive 2.0 / Apache 2.0).",
      sourceRetentionClass: "public-business-discovery",
      externalId: row.externalId,
      name: row.name,
      category: saltboxCategory,
      latitude: row.latitude,
      longitude: row.longitude,
      street,
      city,
      state,
      postalCode,
      phone,
      email,
      websiteUrl,
      sourceLocator: `https://explore.overturemaps.org/#17/${row.latitude.toFixed(5)}/${row.longitude.toFixed(5)}`,
      retrievedAt,
      contentHash: createHash("sha256").update(identityPayload).digest("hex"),
      metadata: {
        city,
        state,
        postalCode,
        street,
        latitude: row.latitude,
        longitude: row.longitude,
        gersId: row.externalId,
        categoryPrimary: row.categoryPrimary,
        confidence: row.confidence,
        operatingStatus: row.operatingStatus,
        providerSources: boundedSources,
        release: dataset.manifest.release,
        extractArea: dataset.manifest.area,
        sourceDataTimestamp: dataset.manifest.retrievedAt ?? null,
        adapterVersion: OVERTURE_ADAPTER_VERSION,
        categoryMappingVersion: OVERTURE_CATEGORY_MAPPING_VERSION,
        retrievalMethod: "local-overture-extract",
        policyResearchDate: OVERTURE_POLICY_RESEARCH_DATE,
        attribution: OVERTURE_ATTRIBUTION,
        licence: OVERTURE_LICENCE,
        licenceUrl: OVERTURE_LICENCE_URL,
      },
    };
  }
}

export function radiusBoundingBox(latitude: number, longitude: number, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  return {
    minLon: longitude - lonDelta,
    minLat: latitude - latDelta,
    maxLon: longitude + lonDelta,
    maxLat: latitude + latDelta,
  };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseExtractRow(record: Record<string, unknown>, location: ResolvedLocation): ExtractRow | null {
  const externalId = typeof record.external_id === "string" ? record.external_id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const latitude = toFiniteNumber(record.lat);
  const longitude = toFiniteNumber(record.lon);
  if (externalId.length < 8 || name === "" || latitude === null || longitude === null) return null;

  const address = parseJsonValue(record.address_json);
  const addressRecord =
    address && typeof address === "object" && !Array.isArray(address) ? (address as Record<string, unknown>) : null;
  const sourcesValue = parseJsonValue(record.sources_json);
  const sources: Array<{ dataset: string; recordId: string | null }> = [];
  if (Array.isArray(sourcesValue)) {
    for (const entry of sourcesValue) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const source = entry as Record<string, unknown>;
        if (typeof source.dataset === "string") {
          sources.push({
            dataset: source.dataset,
            recordId: typeof source.record_id === "string" ? source.record_id : null,
          });
        }
      }
    }
  }

  return {
    externalId,
    name,
    latitude,
    longitude,
    distanceKm: haversineKm(location.latitude, location.longitude, latitude, longitude),
    categoryPrimary: typeof record.category_primary === "string" ? record.category_primary : "",
    confidence: toFiniteNumber(record.confidence),
    operatingStatus: typeof record.operating_status === "string" ? record.operating_status : null,
    websites: parseStringArray(record.websites_json),
    phones: parseStringArray(record.phones_json),
    emails: parseStringArray(record.emails_json),
    address: addressRecord
      ? {
          freeform: typeof addressRecord.freeform === "string" ? addressRecord.freeform : null,
          locality: typeof addressRecord.locality === "string" ? addressRecord.locality : null,
          region: typeof addressRecord.region === "string" ? addressRecord.region : null,
          postcode: typeof addressRecord.postcode === "string" ? addressRecord.postcode : null,
        }
      : null,
    sources,
  };
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}
