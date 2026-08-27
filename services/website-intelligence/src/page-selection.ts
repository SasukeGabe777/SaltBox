/**
 * Deterministic bounded page selection (no semantic classification).
 *
 * From same-site links discovered on the homepage, choose at most
 * MAX_PAGES_PER_SITE pages by fixed role priority; within a role, the
 * shortest path wins, ties broken alphabetically. External links, mailto,
 * tel, downloads, logins, checkout, and booking actions are never selected.
 */

import { isPathAllowed, type RobotsRules } from "./robots.ts";
import { isSameSite } from "./url-safety.ts";
import { MAX_PAGES_PER_SITE } from "./version.ts";

export type PageRole = "homepage" | "contact" | "services" | "about" | "locations" | "other";

export interface SelectedPage {
  url: string;
  role: PageRole;
  selectedBecause: string;
}

const ROLE_PATTERNS: Array<{ role: Exclude<PageRole, "homepage" | "other">; patterns: RegExp[] }> = [
  { role: "contact", patterns: [/contact/, /get-in-touch/, /reach-us/] },
  {
    role: "services",
    patterns: [
      /services?\b/,
      /what-we-do/,
      /roof/,
      /plumb/,
      /hvac/,
      /heating/,
      /cooling/,
      /electric/,
      /landscap/,
      /repair/,
      /installation/,
    ],
  },
  { role: "about", patterns: [/about/, /our-story/, /who-we-are/, /company/] },
  { role: "locations", patterns: [/locations?/, /service-area/, /areas?-served/, /cities/] },
];

const EXCLUDED_PATH_PATTERNS = [
  /login/, /signin/, /sign-in/, /account/, /cart/, /checkout/, /wp-admin/, /admin/,
  /privacy/, /terms/, /cookie/, /\.(pdf|zip|jpg|jpeg|png|gif|webp|svg|mp4|doc|docx|xls|xlsx)$/,
];

const EXCLUDED_SCHEMES = /^(mailto:|tel:|sms:|javascript:|ftp:)/i;

export function selectPages(
  homepageUrl: string,
  discoveredHrefs: string[],
  robots: RobotsRules,
): SelectedPage[] {
  const homepage = new URL(homepageUrl);
  const selected: SelectedPage[] = [{ url: homepage.toString(), role: "homepage", selectedBecause: "entry page" }];
  const seenPaths = new Set<string>([normalizePath(homepage)]);

  const candidates = new Map<string, URL>();
  for (const href of discoveredHrefs) {
    if (EXCLUDED_SCHEMES.test(href.trim())) continue;
    let url: URL;
    try {
      url = new URL(href, homepage);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!isSameSite(url, homepage)) continue;
    url.hash = "";
    const path = normalizePath(url);
    if (seenPaths.has(path)) continue;
    if (EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(path.toLowerCase()))) continue;
    if (!isPathAllowed(robots, url.pathname)) continue;
    if (!candidates.has(path)) candidates.set(path, url);
  }

  const remaining = new Map(candidates);
  for (const { role, patterns } of ROLE_PATTERNS) {
    if (selected.length >= MAX_PAGES_PER_SITE) break;
    const match = pickBest(remaining, patterns);
    if (match) {
      remaining.delete(match.path);
      seenPaths.add(match.path);
      selected.push({
        url: match.url.toString(),
        role,
        selectedBecause: `path matched ${role} pattern`,
      });
    }
  }

  // Fill any remaining slot with the shortest-path other internal page.
  const leftovers = [...remaining.entries()].sort(
    (a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]),
  );
  for (const [path, url] of leftovers) {
    if (selected.length >= MAX_PAGES_PER_SITE) break;
    if (path === "/" || seenPaths.has(path)) continue;
    seenPaths.add(path);
    selected.push({ url: url.toString(), role: "other", selectedBecause: "additional internal page" });
  }

  return selected.slice(0, MAX_PAGES_PER_SITE);
}

function pickBest(candidates: Map<string, URL>, patterns: RegExp[]): { path: string; url: URL } | null {
  const matches = [...candidates.entries()]
    .filter(([path]) => patterns.some((pattern) => pattern.test(path.toLowerCase())))
    .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]));
  const first = matches[0];
  return first ? { path: first[0], url: first[1] } : null;
}

function normalizePath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return (path === "" ? "/" : path) + url.search;
}
