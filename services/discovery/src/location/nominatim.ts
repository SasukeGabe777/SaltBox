import { DiscoverySourceError } from "../errors.ts";
import type { ResolvedLocation } from "../types.ts";

/**
 * Shared Nominatim forward-geocoder (Phase 5B policy: one identifying,
 * cached request per run; never autocomplete, grids, or parallel geocoding).
 * Both discovery adapters resolve the operator's human location through this
 * class so the etiquette and error semantics stay in one place.
 */
export interface NominatimResolverOptions {
  fetch?: typeof fetch;
  userAgent: string;
  endpoint?: string;
  timeoutMs?: number;
}

interface NominatimResult {
  place_id?: number | string;
  osm_type?: string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, unknown>;
}

export class NominatimResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, ResolvedLocation>();

  constructor(options: NominatimResolverOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.userAgent = options.userAgent;
    this.endpoint = options.endpoint ?? "https://nominatim.openstreetmap.org/search";
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async resolveLocation(location: string): Promise<ResolvedLocation> {
    const normalized = location.trim().toLowerCase();
    const cached = this.cache.get(normalized);
    if (cached) return cached;

    const url = new URL(this.endpoint);
    url.searchParams.set("q", location.trim());
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.8",
          "user-agent": this.userAgent,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new DiscoverySourceError("provider_timeout", "nominatim", `nominatim request timed out after ${this.timeoutMs} ms.`);
      }
      throw new DiscoverySourceError(
        "provider_request_failed",
        "nominatim",
        `nominatim request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      );
    }
    if (!response.ok) {
      if (response.status === 429 || response.status === 406) {
        throw new DiscoverySourceError("rate_limited", "nominatim", "nominatim rate limited the request.", response.status);
      }
      if (response.status >= 500) {
        throw new DiscoverySourceError("provider_server_error", "nominatim", `nominatim returned HTTP ${response.status}.`, response.status);
      }
      throw new DiscoverySourceError(
        "provider_request_failed",
        "nominatim",
        `nominatim rejected the request with HTTP ${response.status}.`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DiscoverySourceError("malformed_response", "nominatim", "nominatim returned invalid JSON.");
    }
    if (!Array.isArray(payload)) {
      throw new DiscoverySourceError("malformed_response", "nominatim", "Nominatim returned a non-array response.");
    }
    const raw = payload[0] as NominatimResult | undefined;
    if (!raw) {
      throw new DiscoverySourceError("location_not_found", "nominatim", `Location "${location}" was not found.`);
    }
    const latitude = Number(raw.lat);
    const longitude = Number(raw.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new DiscoverySourceError("malformed_response", "nominatim", "Nominatim returned invalid coordinates.");
    }

    const address = raw.address && typeof raw.address === "object" && !Array.isArray(raw.address) ? raw.address : null;
    const resolved: ResolvedLocation = {
      query: location.trim(),
      displayName: typeof raw.display_name === "string" ? raw.display_name : location.trim(),
      latitude,
      longitude,
      city: firstString(address, ["city", "town", "village", "municipality"]),
      state: firstString(address, ["state", "region"]),
      countryCode: firstString(address, ["country_code"]),
      sourceLocator: url.toString(),
    };
    this.cache.set(normalized, resolved);
    return resolved;
  }
}

function firstString(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}
