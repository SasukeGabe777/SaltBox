/**
 * Bounded same-site link-health check: at most MAX_LINKS_CHECKED unique
 * internal links, HEAD first with GET fallback, SSRF-checked, sequential
 * with a small delay — deliberately gentle. No recursion.
 */

import { checkNavigationTarget, isSameSite, type UrlSafetyOptions } from "./url-safety.ts";
import { INTELLIGENCE_HTTP_UA, LINK_CHECK_TIMEOUT_MS, MAX_LINKS_CHECKED } from "./version.ts";
import type { LinkHealth } from "./types.ts";

const INTER_REQUEST_DELAY_MS = 150;

export interface LinkCheckOptions extends UrlSafetyOptions {
  sleep?: (ms: number) => Promise<void>;
}

export function collectInternalLinks(pageUrls: string[], hrefsByPage: string[][], homepage: URL): string[] {
  const unique = new Map<string, string>();
  for (let index = 0; index < hrefsByPage.length; index++) {
    const base = pageUrls[index] ?? homepage.toString();
    for (const href of hrefsByPage[index] ?? []) {
      let url: URL;
      try {
        url = new URL(href, base);
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (!isSameSite(url, homepage)) continue;
      url.hash = "";
      const key = url.toString();
      if (!unique.has(key)) unique.set(key, key);
      if (unique.size >= MAX_LINKS_CHECKED) return [...unique.keys()];
    }
  }
  return [...unique.keys()];
}

export async function checkLinkHealth(links: string[], options: LinkCheckOptions = {}): Promise<LinkHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const health: LinkHealth = {
    checked: 0,
    working: 0,
    redirecting: 0,
    broken: 0,
    timedOut: 0,
    blocked: 0,
    brokenExamples: [],
  };

  for (const link of links.slice(0, MAX_LINKS_CHECKED)) {
    if (health.checked > 0) await sleep(INTER_REQUEST_DELAY_MS);
    health.checked += 1;
    const url = new URL(link);
    const verdict = await checkNavigationTarget(url, options);
    if (!verdict.ok) {
      health.blocked += 1;
      continue;
    }
    const status = await requestStatus(fetchImpl, link, "HEAD");
    const effective =
      status.kind === "status" && (status.code === 405 || status.code === 501)
        ? await requestStatus(fetchImpl, link, "GET")
        : status;

    if (effective.kind === "timeout") {
      health.timedOut += 1;
    } else if (effective.kind === "error") {
      health.broken += 1;
      pushExample(health, link);
    } else if (effective.code >= 400) {
      health.broken += 1;
      pushExample(health, link);
    } else if (effective.code >= 300) {
      health.redirecting += 1;
    } else {
      health.working += 1;
    }
  }
  return health;
}

function pushExample(health: LinkHealth, link: string) {
  if (health.brokenExamples.length < 5) health.brokenExamples.push(link);
}

type StatusResult = { kind: "status"; code: number } | { kind: "timeout" } | { kind: "error" };

async function requestStatus(fetchImpl: typeof fetch, url: string, method: "HEAD" | "GET"): Promise<StatusResult> {
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
      headers: { "user-agent": INTELLIGENCE_HTTP_UA },
    });
    await response.body?.cancel();
    return { kind: "status", code: response.status };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError" ? { kind: "timeout" } : { kind: "error" };
  }
}
