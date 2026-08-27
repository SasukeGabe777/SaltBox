/**
 * Navigation-target safety for browser analysis. Reuses the Phase 4 SSRF
 * baseline (checkHostSafety): every navigation and link-check target is
 * DNS-resolved and must be public before any connection. The primary site
 * host is additionally IP-pinned into Chrome via --host-resolver-rules so a
 * DNS-rebinding site cannot re-point the main origin after validation.
 * Subresource fetches inside Chrome are additionally screened by request
 * interception for private IP literals and blocked hostnames (documented
 * residual: a public-DNS subresource host could still rebind mid-session).
 */

import { isIP } from "node:net";
import {
  BLOCKED_HOSTNAMES,
  checkHostSafety,
  isPrivateAddress,
  type LookupFn,
} from "@saltbox/prospecting/net-safety";
import { HTTP_FETCH_TIMEOUT_MS, INTELLIGENCE_HTTP_UA, MAX_REDIRECT_HOPS } from "./version.ts";

export interface UrlSafetyOptions {
  /** ONLY for tests/local fixtures on 127.0.0.1. */
  allowPrivateNetworks?: boolean;
  lookup?: LookupFn;
  fetchImpl?: typeof fetch;
}

export interface SafeTargetResult {
  ok: boolean;
  reason?: string;
  /** Public addresses the hostname resolved to (for --host-resolver-rules pinning). */
  addresses?: string[];
}

/** Validate one URL as an allowed http(s) navigation target on a public host. */
export async function checkNavigationTarget(url: URL, options: UrlSafetyOptions = {}): Promise<SafeTargetResult> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol ${url.protocol}` };
  }
  if (options.allowPrivateNetworks) return { ok: true, addresses: [] };
  const safety = await checkHostSafety(url.hostname, options.lookup);
  if (!safety.ok) return { ok: false, reason: safety.detail };
  return { ok: true, addresses: safety.addresses };
}

/** Cheap synchronous screen used in request interception (no DNS). */
export function isObviouslyForbiddenHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (isIP(normalized) !== 0) return isPrivateAddress(normalized);
  return false;
}

export interface ResolvedHomepage {
  ok: boolean;
  reason?: string;
  finalUrl?: URL;
  redirectChain: string[];
  httpStatus?: number;
  lastModified?: string | null;
  /** hostname → verified public addresses, for Chrome IP pinning. */
  pinnedHosts: Map<string, string[]>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Resolve the homepage's redirect chain over plain HTTP with a per-hop SSRF
 * check, before any browser navigation. Returns the final URL plus every
 * validated hostname with its verified addresses.
 */
export async function resolveHomepage(url: string, options: UrlSafetyOptions = {}): Promise<ResolvedHomepage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pinnedHosts = new Map<string, string[]>();
  const redirectChain: string[] = [];
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, reason: `"${url}" is not a valid URL`, redirectChain, pinnedHosts };
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const safety = await checkNavigationTarget(current, options);
    if (!safety.ok) {
      return { ok: false, reason: safety.reason ?? "blocked target", redirectChain, pinnedHosts };
    }
    if (safety.addresses && safety.addresses.length > 0) {
      pinnedHosts.set(current.hostname.toLowerCase(), safety.addresses);
    }

    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
        headers: { "user-agent": INTELLIGENCE_HTTP_UA, accept: "text/html,*/*;q=0.8" },
      });
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "homepage request timed out"
          : `homepage request failed: ${error instanceof Error ? error.message : String(error)}`,
        redirectChain,
        pinnedHosts,
      };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        return { ok: false, reason: `redirect ${response.status} without Location`, redirectChain, pinnedHosts, httpStatus: response.status };
      }
      current = new URL(location, current);
      redirectChain.push(current.toString());
      continue;
    }

    const lastModified = response.headers.get("last-modified");
    await response.body?.cancel();
    return {
      ok: true,
      finalUrl: current,
      redirectChain,
      httpStatus: response.status,
      lastModified,
      pinnedHosts,
    };
  }
  return { ok: false, reason: `more than ${MAX_REDIRECT_HOPS} redirects`, redirectChain, pinnedHosts };
}

/** True when two URLs belong to the same site (host equal, ignoring www.). */
export function isSameSite(a: URL, b: URL): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}
