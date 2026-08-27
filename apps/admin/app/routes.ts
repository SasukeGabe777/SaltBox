import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("prospects/:prospectId", "routes/prospect-detail.tsx"),
  route("runs", "routes/runs.tsx"),
  route("runs/:runId", "routes/run-detail.tsx"),
  route("intelligence-artifacts/:ref/:file", "routes/intelligence-artifact.tsx"),
] satisfies RouteConfig;
