import { createDatabase, type Database } from "@saltbox/database/client";
import {
  getProspectDetail,
  getProspectOverview,
  type ProspectDetail,
  type ProspectListFilters,
  type ProspectOverview,
} from "@saltbox/database/queries/admin";

export interface AdminQueryService {
  getOverview(filters: ProspectListFilters): Promise<ProspectOverview>;
  getDetail(prospectId: string): Promise<ProspectDetail | undefined>;
}

const globalDatabase = globalThis as typeof globalThis & { __saltboxAdminDatabase?: Database };
const database = globalDatabase.__saltboxAdminDatabase ?? createDatabase({ maxConnections: 6 });
if (process.env.NODE_ENV !== "production") globalDatabase.__saltboxAdminDatabase = database;

export const adminQueryService: AdminQueryService = {
  getOverview: (filters) => getProspectOverview(database, filters),
  getDetail: (prospectId) => getProspectDetail(database, prospectId),
};

export function parseProspectFilters(url: string): ProspectListFilters {
  const params = new URL(url).searchParams;
  const rawStatus = params.get("status");
  const status = rawStatus === "qualified" || rawStatus === "rejected" ? rawStatus : "all";
  const search = params.get("search")?.trim() || undefined;
  const source = params.get("source")?.trim() || undefined;
  const category = params.get("category")?.trim() || undefined;
  const rawIntelligence = params.get("intelligence");
  const intelligence = rawIntelligence === "analyzed" || rawIntelligence === "none" ? rawIntelligence : undefined;
  const minimumScore = parseScore(params.get("minScore"));
  const maximumScore = parseScore(params.get("maxScore"));
  return { status, search, source, category, intelligence, minimumScore, maximumScore };
}

export async function loadDashboardRequest(
  request: Request,
  service: AdminQueryService = adminQueryService
): Promise<{ overview: ProspectOverview; filters: ProspectListFilters }> {
  const filters = parseProspectFilters(request.url);
  return { overview: await service.getOverview(filters), filters };
}

/** Base URL of the local demo renderer (apps/demos); loopback by default. */
export function demosBaseUrl(): string {
  return (process.env.SALTBOX_DEMOS_BASE_URL ?? "http://127.0.0.1:5175").replace(/\/+$/, "");
}

export async function loadProspectRequest(
  prospectId: string | undefined,
  service: AdminQueryService = adminQueryService
): Promise<{ detail: ProspectDetail; loadedAt: string; demosBaseUrl: string }> {
  if (!prospectId || !isUuid(prospectId)) {
    throw new Response("Malformed prospect identifier.", { status: 400, statusText: "Invalid prospect ID" });
  }
  const detail = await service.getDetail(prospectId);
  if (!detail) {
    throw new Response("Prospect not found.", { status: 404, statusText: "Prospect not found" });
  }
  return { detail, loadedAt: new Date().toISOString(), demosBaseUrl: demosBaseUrl() };
}

export function rethrowAsOperatorResponse(error: unknown): never {
  if (error instanceof Response) throw error;
  console.error("SaltBox admin loader failed", error);
  throw new Response("Local PostgreSQL is unavailable.", {
    status: 503,
    statusText: "Database unavailable",
  });
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseScore(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}
