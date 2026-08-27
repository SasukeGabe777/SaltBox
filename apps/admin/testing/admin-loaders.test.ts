import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProspectDetail, ProspectOverview } from "@saltbox/database/queries/admin";
import {
  isUuid,
  loadDashboardRequest,
  loadProspectRequest,
  parseProspectFilters,
  type AdminQueryService,
} from "../app/data/admin-loaders.server.ts";

const VALID_ID = "01a040a2-56ee-7e41-aa55-e1684063e0b8";
const emptyOverview: ProspectOverview = {
  summary: { total: 0, qualified: 0, rejected: 0, analyzed: 0 },
  prospects: [],
  recentActivity: [],
  generatedAt: "2026-08-27T00:00:00.000Z",
};

test("dashboard loader parses lightweight URL filters and returns an empty state", async () => {
  let capturedFilters: unknown;
  const service: AdminQueryService = {
    getOverview: async (filters) => {
      capturedFilters = filters;
      return emptyOverview;
    },
    getDetail: async () => undefined,
  };
  const request = new Request("http://localhost:5174/?status=qualified&search=roof&minScore=60&maxScore=95");
  const result = await loadDashboardRequest(request, service);
  assert.deepEqual(capturedFilters, { status: "qualified", search: "roof", minimumScore: 60, maximumScore: 95 });
  assert.equal(result.overview.prospects.length, 0);
});

test("filter parsing clamps numeric scores and ignores unsupported decisions", () => {
  assert.deepEqual(parseProspectFilters("http://localhost/?status=won&minScore=-10&maxScore=500"), {
    status: "all",
    search: undefined,
    minimumScore: 0,
    maximumScore: 100,
  });
});

test("prospect loader rejects malformed route IDs before querying", async () => {
  let queried = false;
  const service: AdminQueryService = {
    getOverview: async () => emptyOverview,
    getDetail: async () => {
      queried = true;
      return undefined;
    },
  };
  await assert.rejects(() => loadProspectRequest("not-a-uuid", service), (error: unknown) => error instanceof Response && error.status === 400);
  assert.equal(queried, false);
});

test("prospect loader returns a useful 404 for a missing record", async () => {
  const service: AdminQueryService = {
    getOverview: async () => emptyOverview,
    getDetail: async () => undefined,
  };
  await assert.rejects(() => loadProspectRequest(VALID_ID, service), (error: unknown) => error instanceof Response && error.status === 404);
});

test("prospect loader returns qualified and rejected detail view models unchanged", async () => {
  for (const result of ["qualified", "rejected"] as const) {
    const detail = {
      prospectId: VALID_ID,
      businessName: result === "qualified" ? "Summit Ridge Roofing" : "Golden Crumb Bakery",
      lifecycleState: result,
      scoreHistory: [{ decisions: [{ result }] }],
    } as unknown as ProspectDetail;
    const service: AdminQueryService = {
      getOverview: async () => emptyOverview,
      getDetail: async () => detail,
    };
    const loaded = await loadProspectRequest(VALID_ID, service);
    assert.equal(loaded.detail.scoreHistory[0]!.decisions[0]!.result, result);
  }
});

test("UUID validation accepts SaltBox IDs and rejects arbitrary strings", () => {
  assert.equal(isUuid(VALID_ID), true);
  assert.equal(isUuid("../../database"), false);
});
