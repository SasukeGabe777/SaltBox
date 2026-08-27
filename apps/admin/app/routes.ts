import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("prospects/:prospectId", "routes/prospect-detail.tsx"),
] satisfies RouteConfig;
