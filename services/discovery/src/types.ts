export const DEFAULT_DISCOVERY_LIMIT = 10;
export const MAX_DISCOVERY_LIMIT = 25;
export const DEFAULT_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 25;
export const DEFAULT_QUALIFICATION_CONCURRENCY = 2;
export const MAX_QUALIFICATION_CONCURRENCY = 4;

export interface DiscoveryQueryInput {
  category: string;
  location: string;
  radiusKm?: number;
  limit?: number;
  source?: string;
}

export interface DiscoveryQuery {
  category: string;
  location: string;
  radiusKm: number;
  limit: number;
  source: string;
}

export interface ResolvedLocation {
  query: string;
  displayName: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  sourceLocator: string;
}

export interface DiscoveryResult {
  source: string;
  sourceType: string;
  sourceDescription: string;
  sourceRetentionClass: string;
  externalId: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  sourceLocator: string;
  retrievedAt: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface DiscoveryBatch {
  query: DiscoveryQuery;
  location: ResolvedLocation;
  source: string;
  adapterVersion: string;
  sourceDataTimestamp: string | null;
  candidates: DiscoveryResult[];
}

export interface DiscoverySourceAdapter {
  readonly source: string;
  readonly adapterVersion: string;
  resolveLocation(location: string): Promise<ResolvedLocation>;
  discover(query: DiscoveryQuery, location: ResolvedLocation): Promise<DiscoveryBatch>;
}

export function normalizeDiscoveryQuery(input: DiscoveryQueryInput): DiscoveryQuery {
  const category = input.category.trim().toLowerCase();
  const location = input.location.trim();
  if (category === "") throw new Error("Discovery category is required.");
  if (location === "") throw new Error("Discovery location is required.");

  const radiusKm = input.radiusKm ?? DEFAULT_RADIUS_KM;
  const limit = input.limit ?? DEFAULT_DISCOVERY_LIMIT;
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > MAX_RADIUS_KM) {
    throw new Error(`Radius must be between 1 and ${MAX_RADIUS_KM} km.`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISCOVERY_LIMIT) {
    throw new Error(`Limit must be an integer between 1 and ${MAX_DISCOVERY_LIMIT}.`);
  }

  return {
    category,
    location,
    radiusKm,
    limit,
    source: input.source?.trim().toLowerCase() || "openstreetmap",
  };
}
